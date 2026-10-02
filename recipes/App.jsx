import { useSyncedStorage } from "../shared/syncStorage.js";
import { useSession } from "../shared/auth.js";
import { supabase } from "../shared/supabaseClient.js";
import { runDailyBackupIfNeeded } from "../shared/backup.js";
import { PRICE_TIERS } from "../shared/prices.js";
import { callAI } from "../shared/ai.js";
import { uid, plural, normRecipe } from "./format.js";
import { ListTab } from "./ListTab.jsx";
import { Notebook } from "./Notebook.jsx";
import { RecipeDetail } from "./RecipeDetail.jsx";
import { Compose } from "./Compose.jsx";
import { removePhoto } from "./photos.js";
import { mergeRequest, applyMerges } from "./merge.js";

const { useState, useEffect, useRef, useMemo } = React;

const APP_ID = "recipes";
const DEFAULT_LISTS = [{ id: "default", name: "Groceries", items: [] }];
const NO_RECIPES = [];
const ACTIVE_KEY = "recipes-active-list";

function readActive() {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function RecipesApp() {
  const session = useSession();
  const [lists, setLists, listsConflict] = useSyncedStorage(APP_ID, "recipes-lists", DEFAULT_LISTS);
  const [storedRecipes, setRecipes, recipesConflict] = useSyncedStorage(APP_ID, "recipes-recipes", NO_RECIPES);
  const recipes = useMemo(() => storedRecipes.map(normRecipe), [storedRecipes]);
  // Which list is open is per device, not synced.
  const [activeId, setActiveIdState] = useState(readActive);
  const [tab, setTab] = useState("list");
  const [recipeId, setRecipeId] = useState(null);
  // null, or { recipe } where recipe is null for a new one.
  const [compose, setCompose] = useState(null);
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("All");
  const [servings, setServings] = useState({});
  // Price estimates by recipe id (and "list:<id>" for lists), kept while
  // the app is open.
  const [prices, setPrices] = useState({});
  // Whether estimates look for the cheapest, normal or premium products.
  // Synced with the account.
  const [storedTier, setTier] = useSyncedStorage(APP_ID, "recipes-price-tier", "normal");
  const tier = PRICE_TIERS.some((t) => t.id === storedTier) ? storedTier : "normal";
  const [timers, setTimers] = useState({});
  const [, setNow] = useState(0);
  const [toast, setToast] = useState(null);
  const toastT = useRef(null);
  const timersRef = useRef(timers);
  timersRef.current = timers;
  // Batches of just-added rows, { listId, ids }, waiting for the AI to fold
  // them into matching rows. One runs at a time, so each sees the last one's
  // result.
  const [mergeJobs, setMergeJobs] = useState([]);
  const merging = useRef(false);
  const listsRef = useRef(lists);
  listsRef.current = lists;

  useEffect(() => {
    if (session) runDailyBackupIfNeeded(supabase, session);
  }, [session]);

  const list = lists.find((l) => l.id === activeId) || lists[0];
  const recipe = recipes.find((r) => r.id === recipeId);

  function setActive(id) {
    setActiveIdState(id);
    try {
      localStorage.setItem(ACTIVE_KEY, id);
    } catch {}
  }

  function showToast(msg) {
    clearTimeout(toastT.current);
    setToast(msg);
    toastT.current = setTimeout(() => setToast(null), 2200);
  }

  const updateItems = (listId, fn) =>
    setLists((ls) => ls.map((l) => (l.id === listId ? { ...l, items: fn(l.items) } : l)));

  // When signed in, has the AI fold just-added rows that are already on the
  // list into the existing row, adding up the amounts.
  const queueMerge = (listId, ids) => {
    if (session) setMergeJobs((js) => [...js, { listId, ids }]);
  };

  // Adds recipe ingredients ({ q, n, src }) to the end of the active list's
  // "to get" items, taking any ticked copies out of the cart instead of
  // duplicating them, then queues them to be combined with matching rows.
  function addToList(ings) {
    const have = new Set(list.items.filter((i) => !i.checked).flatMap((i) => i.src || []));
    const add = ings.filter((g) => !have.has(g.src));
    if (!add.length) return;
    const rows = add.map((g) => ({ id: uid(), name: g.n, q: g.q, checked: false, src: [g.src] }));
    const names = new Set(add.map((g) => g.n.toLowerCase()));
    updateItems(list.id, (items) => [
      ...items.filter((i) => !i.checked),
      ...rows,
      ...items.filter((i) => i.checked && !names.has(i.name.toLowerCase())),
    ]);
    queueMerge(list.id, rows.map((r) => r.id));
    showToast(add.length === 1 ? `Added ${add[0].n} to ${list.name}` : `Added ${plural(add.length, "item")} to ${list.name}`);
  }

  useEffect(() => {
    if (merging.current || !mergeJobs.length) return;
    const job = mergeJobs[0];
    const target = lists.find((l) => l.id === job.listId);
    const sent = target && mergeRequest(target.items, job.ids);
    const next = () => {
      merging.current = false;
      setMergeJobs((js) => js.slice(1));
    };
    if (!sent || !sent.add.length || (!sent.list.length && sent.add.length < 2)) return next();
    merging.current = true;
    callAI("shopping-merge", sent)
      .then(({ groups }) => {
        const cur = listsRef.current.find((l) => l.id === job.listId);
        if (!cur) return;
        const { merged } = applyMerges(cur.items, groups, sent);
        if (!merged.length) return;
        updateItems(job.listId, (items) => applyMerges(items, groups, sent).items);
        const [m] = merged;
        showToast(
          merged.length === 1
            ? `${m.name} was already on ${cur.name}${m.q ? ` · now ${m.q}` : ""}`
            : `Combined ${plural(merged.length, "item")} already on ${cur.name}`
        );
      })
      // The rows just stay separate if the AI can't be reached.
      .catch(() => {})
      .finally(next);
  }, [mergeJobs, lists]);

  function setTimer(key, fn) {
    setTimers((ts) => {
      const next = { ...ts };
      const v = fn(next[key]);
      if (v) next[key] = v;
      else delete next[key];
      return next;
    });
  }

  // Ticks running step timers and announces the ones that finish.
  const anyRunning = Object.values(timers).some((x) => x.running);
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(() => {
      const now = Date.now();
      setNow(now);
      const ts = timersRef.current;
      const finished = Object.keys(ts).filter((k) => ts[k].running && ts[k].endAt <= now);
      if (!finished.length) return;
      finished.forEach((k) => setTimer(k, (o) => o && { ...o, running: false, left: 0, done: true }));
      showToast(`Timer done · ${ts[finished[0]].label}`);
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    }, 500);
    return () => clearInterval(t);
  }, [anyRunning]);

  function saveRecipe(r) {
    const exists = recipes.some((x) => x.id === r.id);
    setRecipes((rs) => (exists ? rs.map((x) => (x.id === r.id ? r : x)) : [r, ...rs]));
    setCompose(null);
    setRecipeId(r.id);
    if (!exists) {
      setCat("All");
      setQuery("");
    }
    showToast("Recipe saved");
  }

  function deleteRecipe(id) {
    const r = recipes.find((x) => x.id === id);
    if (r && r.photo) removePhoto(r.photo);
    setRecipes((rs) => rs.filter((x) => x.id !== id));
    setTimers((ts) => Object.fromEntries(Object.entries(ts).filter(([k]) => !k.startsWith(id + ":"))));
    setCompose(null);
    setRecipeId(null);
    showToast("Recipe deleted");
  }

  function switchTab(k) {
    // Tapping Notebook again goes back to the recipe index.
    if (k === "book" && tab === "book") {
      setRecipeId(null);
      setCompose(null);
    }
    setTab(k);
  }

  const conflict = listsConflict || recipesConflict;

  let screen;
  if (tab === "list") {
    screen = (
      <ListTab
        lists={lists}
        list={list}
        setActive={setActive}
        setLists={setLists}
        updateItems={updateItems}
        queueMerge={queueMerge}
        showToast={showToast}
        session={session}
        price={prices[`list:${list.id}`]}
        setPrice={(fn) => setPrices((ps) => ({ ...ps, [`list:${list.id}`]: fn(ps[`list:${list.id}`]) }))}
        tier={tier}
        setTier={setTier}
      />
    );
  } else if (compose) {
    screen = (
      <Compose
        key={compose.recipe ? compose.recipe.id : "new"}
        initial={compose.recipe}
        session={session}
        onCancel={() => setCompose(null)}
        onSave={saveRecipe}
        onDelete={deleteRecipe}
      />
    );
  } else if (recipe) {
    screen = (
      <RecipeDetail
        key={recipe.id}
        recipe={recipe}
        session={session}
        list={list}
        servings={servings[recipe.id]}
        setServings={(n) => setServings((s) => ({ ...s, [recipe.id]: n }))}
        price={prices[recipe.id]}
        setPrice={(fn) => setPrices((ps) => ({ ...ps, [recipe.id]: fn(ps[recipe.id]) }))}
        tier={tier}
        setTier={setTier}
        timers={timers}
        setTimer={setTimer}
        onBack={() => setRecipeId(null)}
        onEdit={() => setCompose({ recipe })}
        addToList={addToList}
      />
    );
  } else {
    screen = (
      <Notebook
        recipes={recipes}
        session={session}
        query={query}
        setQuery={setQuery}
        cat={cat}
        setCat={setCat}
        openRecipe={setRecipeId}
        openCompose={() => setCompose({ recipe: null })}
      />
    );
  }

  return (
    <div className="ra">
      {conflict && (
        <div className="ra-conflict" role="alert">
          <span>Your {listsConflict ? "lists" : "recipes"} changed on another device.</span>
          <button onClick={conflict.keepRemote}>Use theirs</button>
          <button onClick={conflict.keepLocal}>Keep mine</button>
        </div>
      )}
      {screen}
      {toast && <div className="ra-toast" role="status">{toast}</div>}
      <nav className="ra-nav">
        {[["list", "List"], ["book", "Notebook"]].map(([k, label]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => switchTab(k)} aria-current={tab === k ? "page" : undefined}>
            <span className="ra-nav-dot" />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
