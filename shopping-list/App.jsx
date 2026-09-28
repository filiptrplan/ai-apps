import { useSyncedStorage } from "../shared/syncStorage.js";
import { useSession } from "../shared/auth.js";
import { supabase } from "../shared/supabaseClient.js";
import { runDailyBackupIfNeeded } from "../shared/backup.js";
import { buildList, formatAmount, listToText } from "./aggregate.js";

const { useState, useEffect, useMemo } = React;

const APP_ID = "shopping-list";

function newRecipe() {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text: "" };
}

function useStorage(key, fallback) {
  return useSyncedStorage(APP_ID, key, fallback);
}

export function ShoppingListApp() {
  const session = useSession();
  const [recipes, setRecipes] = useStorage("shopping-list-recipes", [newRecipe()]);
  // The raw API result; the combined list is derived from it on render.
  const [result, setResult] = useStorage("shopping-list-result", null);
  const [checked, setChecked] = useStorage("shopping-list-checked", {});
  const [tab, setTab] = useState(result ? "list" : "recipes");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (session) runDailyBackupIfNeeded(supabase, session);
  }, [session]);

  const groups = useMemo(() => buildList(result), [result]);
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const done = groups.reduce((n, g) => n + g.items.filter((it) => checked[it.key]).length, 0);
  const filled = recipes.filter((r) => r.text.trim());

  const updateRecipe = (id, text) => setRecipes(recipes.map((r) => (r.id === id ? { ...r, text } : r)));
  const removeRecipe = (id) => {
    const rest = recipes.filter((r) => r.id !== id);
    setRecipes(rest.length ? rest : [newRecipe()]);
  };

  async function build() {
    setLoading(true);
    setError("");
    try {
      const { data, error: fnError } = await supabase.functions.invoke("shopping-list", {
        body: { recipes: filled.map((r) => r.text) },
      });
      if (fnError) {
        // Non-2xx responses carry the function's { error } message in the body.
        const details = await fnError.context?.json?.().catch(() => null);
        throw new Error(details?.error ?? fnError.message);
      }
      setResult(data);
      setChecked({});
      setTab("list");
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function copyList() {
    try {
      await navigator.clipboard.writeText(listToText(groups, checked));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  const toggle = (key) => {
    const next = { ...checked };
    if (next[key]) delete next[key];
    else next[key] = true;
    setChecked(next);
  };

  return (
    <div className="sl">
      <header className="sl-header">
        <a className="sl-back" href="./" aria-label="All apps">‹</a>
        <h1>Shopping List</h1>
      </header>

      <nav className="sl-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "recipes"} className={tab === "recipes" ? "on" : ""} onClick={() => setTab("recipes")}>
          Recipes{filled.length ? ` (${filled.length})` : ""}
        </button>
        <button role="tab" aria-selected={tab === "list"} className={tab === "list" ? "on" : ""} onClick={() => setTab("list")}>
          List{total ? ` (${total - done})` : ""}
        </button>
      </nav>

      {tab === "recipes" && (
        <main className="sl-main">
          <p className="sl-hint">
            Paste each recipe (or just its ingredient list) into its own box. The AI merges them into one list, adding up
            matching ingredients and sorting them by aisle.
          </p>
          {recipes.map((r, i) => (
            <div className="sl-recipe" key={r.id}>
              <div className="sl-recipe-head">
                <span>Recipe {i + 1}</span>
                {(recipes.length > 1 || r.text) && (
                  <button className="sl-link" onClick={() => removeRecipe(r.id)}>Remove</button>
                )}
              </div>
              <textarea
                value={r.text}
                onChange={(e) => updateRecipe(r.id, e.target.value)}
                placeholder={"Chicken curry\n200 g chicken breast\n1 onion\n2 cloves garlic\n…"}
                rows={7}
              />
            </div>
          ))}
          <button className="sl-secondary" onClick={() => setRecipes([...recipes, newRecipe()])}>+ Add another recipe</button>

          {error && <p className="sl-error">{error}</p>}
          {session === null && (
            <p className="sl-note">
              <a href="./">Sign in on the home page</a> to build lists with AI.
            </p>
          )}
          <button className="sl-primary" disabled={!session || loading || filled.length === 0} onClick={build}>
            {loading ? "Reading recipes…" : result ? "Rebuild shopping list" : "Build shopping list"}
          </button>
          {result && !loading && <p className="sl-note">Rebuilding replaces the current list and its ticks.</p>}
        </main>
      )}

      {tab === "list" && (
        <main className="sl-main">
          {total === 0 ? (
            <div className="sl-empty">
              <p>No list yet.</p>
              <button className="sl-primary" onClick={() => setTab("recipes")}>Add recipes</button>
            </div>
          ) : (
            <>
              <div className="sl-toolbar">
                <span className="sl-progress">{done} of {total} in the basket</span>
                <button className="sl-link" onClick={copyList}>{copied ? "Copied" : "Copy"}</button>
                {done > 0 && <button className="sl-link" onClick={() => setChecked({})}>Untick all</button>}
              </div>
              {result.recipes.length > 0 && (
                <p className="sl-from">From: {result.recipes.map((r) => r.title).join(" · ")}</p>
              )}
              {groups.map(({ category, items }) => {
                const sorted = [...items].sort((a, b) => !!checked[a.key] - !!checked[b.key]);
                return (
                  <section className="sl-group" key={category}>
                    <h2>{category}</h2>
                    <ul>
                      {sorted.map((it) => (
                        <li key={it.key} className={checked[it.key] ? "done" : ""}>
                          <label>
                            <input type="checkbox" checked={!!checked[it.key]} onChange={() => toggle(it.key)} />
                            <span className="sl-item">
                              <span className="sl-item-top">
                                <span className="sl-name">{it.name}</span>
                                <span className="sl-amount">{it.amounts.map(formatAmount).join(" + ")}</span>
                              </span>
                              {(it.notes.length > 0 || it.sources.length > 1) && (
                                <span className="sl-sub">
                                  {[
                                    ...it.notes,
                                    ...(it.sources.length > 1
                                      ? [it.sources.map((s) => `${s.title}: ${s.amounts.map(formatAmount).join(" + ")}`).join(" · ")]
                                      : []),
                                  ].join(" — ")}
                                </span>
                              )}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </>
          )}
        </main>
      )}
    </div>
  );
}
