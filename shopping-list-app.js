(() => {
  // shared/api.js
  async function apiFetch(path, { json, as, headers, ...init } = {}) {
    var _a, _b;
    if (json !== void 0) {
      init.body = JSON.stringify(json);
      (_a = init.method) != null ? _a : init.method = "POST";
      headers = { ...headers, "Content-Type": "application/json" };
    }
    const res = await fetch(path, { credentials: "same-origin", ...init, headers });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const err = new Error((_b = body == null ? void 0 : body.error) != null ? _b : `Request failed (${res.status}).`);
      err.status = res.status;
      throw err;
    }
    if (as === "blob") return res.blob();
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  // shared/auth.js
  var CACHE_KEY = "auth:session";
  var current;
  var loading = null;
  var listeners = /* @__PURE__ */ new Set();
  function readCached() {
    var _a;
    try {
      return (_a = JSON.parse(localStorage.getItem(CACHE_KEY))) != null ? _a : null;
    } catch {
      return null;
    }
  }
  function writeCached(session) {
    try {
      if (session) localStorage.setItem(CACHE_KEY, JSON.stringify(session));
      else localStorage.removeItem(CACHE_KEY);
    } catch {
    }
  }
  function same(a, b) {
    var _a, _b;
    return ((_a = a == null ? void 0 : a.user.id) != null ? _a : null) === ((_b = b == null ? void 0 : b.user.id) != null ? _b : null);
  }
  function set(session) {
    const changed = current !== void 0 && !same(current, session);
    current = session;
    writeCached(session);
    if (changed) listeners.forEach((fn) => fn(session));
  }
  async function load() {
    try {
      const { user } = await apiFetch("/api/auth/session");
      set(user ? { user } : null);
    } catch {
      current = readCached();
      window.addEventListener("online", () => load(), { once: true });
    }
    return current;
  }
  function getSession() {
    if (current !== void 0) return Promise.resolve(current);
    return loading != null ? loading : loading = load();
  }
  function onSessionChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  if (typeof window !== "undefined") {
    window.addEventListener("storage", (e) => {
      if (e.key === CACHE_KEY && current !== void 0) set(readCached());
    });
  }
  function useSession() {
    const { useState: useState3, useEffect: useEffect3 } = React;
    const [session, setSession] = useState3(current);
    useEffect3(() => {
      let cancelled = false;
      getSession().then((s) => {
        if (!cancelled) setSession(s);
      });
      const off = onSessionChange(setSession);
      return () => {
        cancelled = true;
        off();
      };
    }, []);
    return session;
  }

  // shared/events.js
  var RETRY_MS = 3e4;
  var subs = /* @__PURE__ */ new Set();
  var source = null;
  var openTopics = "";
  var queued = false;
  var forced = false;
  var retryTimer = null;
  function wantedTopics() {
    return [...new Set([...subs].map((s) => s.topic))].sort().join(",");
  }
  function dispatch(change) {
    const topic = change.resync ? null : change.table === "app_data" ? "data" : "mo";
    for (const s of [...subs]) if (!topic || s.topic === topic) s.fn(change);
  }
  function open(topics) {
    clearTimeout(retryTimer);
    source == null ? void 0 : source.close();
    source = null;
    openTopics = topics;
    if (!topics) return;
    const es = new EventSource(`/api/events?topics=${topics}`);
    source = es;
    let opened = false;
    es.onopen = () => {
      if (opened) dispatch({ resync: true });
      opened = true;
    };
    es.onmessage = (e) => {
      let change;
      try {
        change = JSON.parse(e.data);
      } catch {
        return;
      }
      dispatch(change);
    };
    es.addEventListener("resync", () => dispatch({ resync: true }));
    es.onerror = () => {
      if (es.readyState !== EventSource.CLOSED || source !== es) return;
      source = null;
      openTopics = "";
      retryTimer = setTimeout(() => {
        if (opened) dispatch({ resync: true });
        update();
      }, RETRY_MS);
    };
  }
  function update(force = false) {
    forced || (forced = force);
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      const topics = wantedTopics();
      if (forced || topics !== openTopics || topics && !source) open(topics);
      forced = false;
    });
  }
  function subscribe(topic, fn) {
    const sub = { topic, fn };
    subs.add(sub);
    update();
    return () => {
      subs.delete(sub);
      update();
    };
  }
  onSessionChange(() => {
    if (source) update(true);
  });

  // shared/syncStorage.js
  var { useState, useEffect, useRef, useCallback } = React;
  function readLocal(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }
  function writeLocal(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch {
    }
  }
  function markerKey(key) {
    return `${key}::synced-at`;
  }
  function syncedValueKey(key) {
    return `${key}::synced-value`;
  }
  function readSyncedValue(key) {
    try {
      const raw = localStorage.getItem(syncedValueKey(key));
      return raw ? JSON.parse(raw) : void 0;
    } catch {
      return void 0;
    }
  }
  function writeSyncedState(key, updatedAt, value) {
    localStorage.setItem(markerKey(key), updatedAt);
    try {
      localStorage.setItem(syncedValueKey(key), JSON.stringify(value));
    } catch {
    }
  }
  function sameValue(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  function dataPath(appId, key) {
    return `/api/data/${encodeURIComponent(appId)}/${encodeURIComponent(key)}`;
  }
  function useSyncedStorage(appId, key, fallback) {
    const [data, setData] = useState(() => readLocal(key, fallback));
    const [conflict, setConflict] = useState(null);
    const dataRef = useRef(data);
    dataRef.current = data;
    const pushQueueRef = useRef({ inFlight: false, pending: void 0, written: [] });
    const pushRemote = useCallback(async (val) => {
      const queue = pushQueueRef.current;
      if (queue.inFlight) {
        queue.pending = val;
        return;
      }
      queue.inFlight = true;
      try {
        let next = val;
        while (next !== void 0) {
          const session = await getSession();
          if (!session) {
            queue.pending = void 0;
            break;
          }
          const row = await apiFetch(dataPath(appId, key), { method: "PUT", json: { value: next } }).catch(() => null);
          if (row) {
            writeSyncedState(key, row.updated_at, next);
            queue.written = [...queue.written.slice(-19), row.updated_at];
          }
          next = queue.pending;
          queue.pending = void 0;
        }
      } finally {
        queue.inFlight = false;
      }
    }, [appId, key]);
    const save = useCallback((val) => {
      setConflict(null);
      const next = typeof val === "function" ? val(dataRef.current) : val;
      dataRef.current = next;
      setData(next);
      writeLocal(key, next);
      pushRemote(next);
    }, [key, pushRemote]);
    const reconcile = useCallback((row) => {
      if (pushQueueRef.current.inFlight) return;
      const localMarker = localStorage.getItem(markerKey(key));
      if (localMarker === row.updated_at) return;
      if (pushQueueRef.current.written.includes(row.updated_at)) return;
      if (sameValue(row.value, dataRef.current)) {
        writeSyncedState(key, row.updated_at, row.value);
        return;
      }
      const lastSynced = readSyncedValue(key);
      const localIsClean = lastSynced !== void 0 ? sameValue(dataRef.current, lastSynced) : sameValue(dataRef.current, fallback);
      if (localIsClean) {
        setData(row.value);
        writeLocal(key, row.value);
        writeSyncedState(key, row.updated_at, row.value);
        return;
      }
      setConflict({
        local: dataRef.current,
        remote: row.value,
        keepLocal: () => {
          setConflict(null);
          pushRemote(dataRef.current);
        },
        keepRemote: () => {
          setConflict(null);
          setData(row.value);
          writeLocal(key, row.value);
          writeSyncedState(key, row.updated_at, row.value);
        }
      });
    }, [key, fallback, pushRemote]);
    useEffect(() => {
      let cancelled = false;
      let unsubscribe = null;
      async function pullOnce() {
        let row;
        try {
          row = await apiFetch(dataPath(appId, key));
        } catch (err) {
          if (err.status !== 404) return;
          row = null;
        }
        if (cancelled) return;
        if (!row) {
          pushRemote(dataRef.current);
          return;
        }
        reconcile(row);
      }
      function onChange(change) {
        if (change.resync) {
          pullOnce();
          return;
        }
        if (change.app_id !== appId || change.key !== key) return;
        if (localStorage.getItem(markerKey(key)) === change.updated_at) return;
        if (pushQueueRef.current.written.includes(change.updated_at)) return;
        pullOnce();
      }
      function start(session) {
        if (unsubscribe) unsubscribe();
        unsubscribe = null;
        if (!session || cancelled) return;
        unsubscribe = subscribe("data", onChange);
        pullOnce();
      }
      getSession().then(start);
      const stopSession = onSessionChange(start);
      return () => {
        cancelled = true;
        if (unsubscribe) unsubscribe();
        stopSession();
      };
    }, [appId, key, pushRemote, reconcile]);
    return [data, save, conflict];
  }

  // shared/ai.js
  function callAI(functionName, body) {
    return apiFetch(`/api/fn/${encodeURIComponent(functionName)}`, { json: body != null ? body : {} });
  }

  // shopping-list/aggregate.js
  var CATEGORY_ORDER = [
    "Vegetables",
    "Fruit",
    "Meat & Fish",
    "Dairy & Eggs",
    "Bakery",
    "Grains, Pasta & Legumes",
    "Canned & Jarred",
    "Baking",
    "Spices & Herbs",
    "Oils, Sauces & Condiments",
    "Nuts & Seeds",
    "Frozen",
    "Drinks",
    "Other"
  ];
  var UNIT_ORDER = ["g", "ml", "pcs", "can", "bunch", "clove", "tbsp", "tsp", "pinch", "to taste"];
  function itemKey(name) {
    return name.trim().toLowerCase().replace(/\s+/g, " ");
  }
  function round(n, digits = 2) {
    const f = 10 ** digits;
    return Math.round(n * f) / f;
  }
  function plural(unit, qty) {
    var _a;
    if (qty === 1) return unit;
    return (_a = { clove: "cloves", can: "cans", bunch: "bunches", pinch: "pinches" }[unit]) != null ? _a : unit;
  }
  function formatAmount({ unit, qty }) {
    if (unit === "to taste" || qty == null) return "to taste";
    if (unit === "g" && qty >= 1e3) return `${round(qty / 1e3)} kg`;
    if (unit === "ml" && qty >= 1e3) return `${round(qty / 1e3)} l`;
    const n = unit === "g" || unit === "ml" ? Math.round(qty) : round(qty);
    return `${n} ${plural(unit, n)}`;
  }
  function sumAmounts(rows) {
    var _a;
    const byUnit = /* @__PURE__ */ new Map();
    for (const { unit, quantity } of rows) {
      if (unit === "to taste" || quantity == null) {
        if (!byUnit.has("to taste")) byUnit.set("to taste", null);
        continue;
      }
      byUnit.set(unit, ((_a = byUnit.get(unit)) != null ? _a : 0) + quantity);
    }
    if (byUnit.size > 1) byUnit.delete("to taste");
    return [...byUnit.entries()].map(([unit, qty]) => ({ unit, qty })).sort((a, b) => UNIT_ORDER.indexOf(a.unit) - UNIT_ORDER.indexOf(b.unit));
  }
  function amountLabel(item) {
    return item.extraId ? item.amountText : item.amounts.map(formatAmount).join(" + ");
  }
  function buildList(result, extras = []) {
    var _a, _b, _c, _d;
    const titles = new Map(((_a = result == null ? void 0 : result.recipes) != null ? _a : []).map((r) => [r.index, r.title]));
    const byKey = /* @__PURE__ */ new Map();
    for (const row of (_b = result == null ? void 0 : result.items) != null ? _b : []) {
      const key = itemKey(row.name);
      if (!key) continue;
      let item = byKey.get(key);
      if (!item) {
        item = { key, name: row.name.trim(), category: row.category, rows: [], notes: /* @__PURE__ */ new Set() };
        byKey.set(key, item);
      }
      item.rows.push(row);
      if ((_c = row.note) == null ? void 0 : _c.trim()) item.notes.add(row.note.trim());
    }
    const groups = /* @__PURE__ */ new Map();
    for (const item of byKey.values()) {
      const category = CATEGORY_ORDER.includes(item.category) ? item.category : "Other";
      const recipeIndexes = [...new Set(item.rows.map((r) => r.recipeIndex))];
      const entry = {
        key: item.key,
        name: item.name,
        amounts: sumAmounts(item.rows),
        notes: [...item.notes],
        sources: recipeIndexes.map((i) => {
          var _a2;
          return {
            title: (_a2 = titles.get(i)) != null ? _a2 : `Recipe ${i + 1}`,
            amounts: sumAmounts(item.rows.filter((r) => r.recipeIndex === i))
          };
        })
      };
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(entry);
    }
    for (const extra of extras) {
      const category = CATEGORY_ORDER.includes(extra.category) ? extra.category : "Other";
      const entry = {
        key: `extra:${extra.id}`,
        extraId: extra.id,
        name: extra.name,
        amountText: (_d = extra.amount) != null ? _d : "",
        amounts: [],
        notes: [],
        sources: []
      };
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(entry);
    }
    return CATEGORY_ORDER.filter((c) => groups.has(c)).map((category) => ({
      category,
      items: groups.get(category).sort((a, b) => a.name.localeCompare(b.name))
    }));
  }
  function listToText(groups, checked = {}) {
    return groups.map(({ category, items }) => {
      const lines = items.filter((it) => !checked[it.key]).map((it) => amountLabel(it) ? `- ${it.name}: ${amountLabel(it)}` : `- ${it.name}`);
      return lines.length ? `${category}
${lines.join("\n")}` : null;
    }).filter(Boolean).join("\n\n");
  }

  // shared/prices.js
  var estimatePrices = (items, tier = "normal") => callAI("price-estimate", { items, tier });
  var estimateKey = (items, tier = "normal") => JSON.stringify([tier, items.map((i) => [i.id, i.q, i.name])]);
  function runEstimate(items, set2, tier = "normal") {
    const key = estimateKey(items, tier);
    set2(() => ({ key, items, loading: true }));
    const done = (patch) => set2((cur) => cur && cur.key === key && cur.loading ? { key, items, ...patch } : cur);
    estimatePrices(items, tier).then(
      (result) => done({ result }),
      (err) => done({ error: err.message || "Couldn't estimate prices." })
    );
  }
  function priceTotals(result) {
    const items = (result == null ? void 0 : result.items) || [];
    const priced = items.filter((i) => i.source !== "none");
    return {
      buy: priced.reduce((n, i) => n + i.buy, 0),
      used: priced.reduce((n, i) => n + i.used, 0),
      priced: priced.length,
      missing: items.length - priced.length,
      produce: priced.some((i) => i.source === "produce")
    };
  }
  var chf = (n) => `CHF ${(Math.round(n * 20) / 20).toFixed(2)}`;
  function priceDetail(i) {
    if (i.source === "aldi") return `${i.qty} \xD7 ${chf(i.unitPrice)}`;
    if (i.source === "produce") return `${+i.qty.toFixed(3)} ${i.unit} \xD7 ${chf(i.unitPrice)}`;
    return "";
  }
  function monthLabel(m) {
    if (!m) return "";
    const [y, mo] = m.split("-").map(Number);
    return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString("en", { month: "short", year: "numeric", timeZone: "UTC" });
  }

  // shopping-list/App.jsx
  var { useState: useState2, useEffect: useEffect2, useMemo, useRef: useRef2 } = React;
  var APP_ID = "shopping-list";
  function newId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }
  function newRecipe() {
    return { id: newId(), text: "" };
  }
  var BUILD_STEPS = ["Reading recipes\u2026", "Matching ingredients\u2026", "Adding up amounts\u2026", "Sorting by aisle\u2026"];
  function BuildingList() {
    const [step, setStep] = useState2(0);
    const ref = useRef2(null);
    useEffect2(() => {
      var _a;
      (_a = ref.current) == null ? void 0 : _a.scrollIntoView({ block: "nearest", behavior: "smooth" });
      const t = setInterval(() => setStep((s) => Math.min(s + 1, BUILD_STEPS.length - 1)), 2200);
      return () => clearInterval(t);
    }, []);
    return /* @__PURE__ */ React.createElement("div", { className: "sl-loading", role: "status", "aria-live": "polite", ref }, /* @__PURE__ */ React.createElement("div", { className: "sl-loading-head" }, /* @__PURE__ */ React.createElement("span", { className: "sl-spinner", "aria-hidden": "true" }), /* @__PURE__ */ React.createElement("span", { className: "sl-loading-text", key: step }, BUILD_STEPS[step])), /* @__PURE__ */ React.createElement("div", { className: "sl-skeleton", "aria-hidden": "true" }, [62, 40, 54, 32, 48].map((w, i) => /* @__PURE__ */ React.createElement("div", { className: "sl-skel-row", key: i, style: { animationDelay: `${i * 0.12}s` } }, /* @__PURE__ */ React.createElement("span", { className: "sl-skel-box" }), /* @__PURE__ */ React.createElement("span", { className: "sl-skel-line", style: { width: `${w}%` } }), /* @__PURE__ */ React.createElement("span", { className: "sl-skel-amt" })))));
  }
  function AddItem({ onAdd }) {
    const [name, setName] = useState2("");
    const [amount, setAmount] = useState2("");
    const [category, setCategory] = useState2("Other");
    const submit = (e) => {
      e.preventDefault();
      if (!name.trim()) return;
      onAdd({ id: newId(), name: name.trim(), amount: amount.trim(), category });
      setName("");
      setAmount("");
      setCategory("Other");
    };
    return /* @__PURE__ */ React.createElement("form", { className: "sl-add", onSubmit: submit }, /* @__PURE__ */ React.createElement("div", { className: "sl-add-row" }, /* @__PURE__ */ React.createElement("input", { className: "sl-add-name", value: name, onChange: (e) => setName(e.target.value), placeholder: "Add an item, e.g. paper towels", "aria-label": "Item" }), /* @__PURE__ */ React.createElement("input", { className: "sl-add-amount", value: amount, onChange: (e) => setAmount(e.target.value), placeholder: "Amount", "aria-label": "Amount (optional)" })), /* @__PURE__ */ React.createElement("div", { className: "sl-add-row" }, /* @__PURE__ */ React.createElement("select", { value: category, onChange: (e) => setCategory(e.target.value), "aria-label": "Aisle" }, CATEGORY_ORDER.map((c) => /* @__PURE__ */ React.createElement("option", { key: c, value: c }, c))), /* @__PURE__ */ React.createElement("button", { type: "submit", className: "sl-add-btn", disabled: !name.trim() }, "Add")));
  }
  function PricePanel({ est, stale, onRefresh, onClose }) {
    if (est.loading) {
      return /* @__PURE__ */ React.createElement("div", { className: "sl-price", role: "status", "aria-live": "polite" }, /* @__PURE__ */ React.createElement("div", { className: "sl-loading-head" }, /* @__PURE__ */ React.createElement("span", { className: "sl-spinner", "aria-hidden": "true" }), /* @__PURE__ */ React.createElement("span", null, "Looking up Aldi prices\u2026")));
    }
    if (est.error) {
      return /* @__PURE__ */ React.createElement("div", { className: "sl-price" }, /* @__PURE__ */ React.createElement("p", { className: "sl-error" }, est.error), /* @__PURE__ */ React.createElement("div", { className: "sl-price-actions" }, /* @__PURE__ */ React.createElement("button", { className: "sl-link", onClick: onRefresh }, "Try again"), /* @__PURE__ */ React.createElement("button", { className: "sl-link", onClick: onClose }, "Close")));
    }
    const byId = new Map(est.result.items.map((i) => [i.id, i]));
    const t = priceTotals(est.result);
    return /* @__PURE__ */ React.createElement("div", { className: "sl-price" }, /* @__PURE__ */ React.createElement("div", { className: "sl-price-total" }, /* @__PURE__ */ React.createElement("span", null, "At Aldi Suisse"), /* @__PURE__ */ React.createElement("strong", null, chf(t.buy))), t.missing > 0 && /* @__PURE__ */ React.createElement("p", { className: "sl-note" }, t.missing === 1 ? "1 item has" : `${t.missing} items have`, " no price and ", t.missing === 1 ? "isn't" : "aren't", " counted."), stale && /* @__PURE__ */ React.createElement("p", { className: "sl-price-stale" }, "The list changed. ", /* @__PURE__ */ React.createElement("button", { className: "sl-link", onClick: onRefresh }, "Recalculate")), /* @__PURE__ */ React.createElement("ul", null, est.items.map((row) => {
      const p = byId.get(row.id) || { source: "none" };
      return /* @__PURE__ */ React.createElement("li", { key: row.id, className: p.source === "none" ? "none" : "" }, /* @__PURE__ */ React.createElement("span", { className: "sl-price-main" }, /* @__PURE__ */ React.createElement("span", { className: "sl-item-top" }, /* @__PURE__ */ React.createElement("span", { className: "sl-name" }, row.name), row.q && /* @__PURE__ */ React.createElement("span", { className: "sl-price-q" }, row.q)), /* @__PURE__ */ React.createElement("span", { className: "sl-sub" }, p.source === "aldi" && /* @__PURE__ */ React.createElement(React.Fragment, null, p.product, p.size ? ` \xB7 ${p.size}` : "", " \xB7 ", priceDetail(p)), p.source === "produce" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { className: "sl-price-tag" }, "Swiss avg."), p.product, " \xB7 ", priceDetail(p)), p.source === "none" && "No price found"), p.note && /* @__PURE__ */ React.createElement("span", { className: "sl-sub" }, p.note)), p.source !== "none" && /* @__PURE__ */ React.createElement("span", { className: "sl-amount" }, chf(p.buy)));
    })), /* @__PURE__ */ React.createElement("p", { className: "sl-note" }, "Prices from aldi-suisse.ch.", t.produce && ` Swiss avg.: fresh produce, Swiss retail average ${monthLabel(est.result.produceMonth)} (BLW), as Aldi doesn't list it online.`), /* @__PURE__ */ React.createElement("div", { className: "sl-price-actions" }, !stale && /* @__PURE__ */ React.createElement("button", { className: "sl-link", onClick: onRefresh }, "Refresh"), /* @__PURE__ */ React.createElement("button", { className: "sl-link", onClick: onClose }, "Close")));
  }
  function useStorage(key, fallback) {
    return useSyncedStorage(APP_ID, key, fallback);
  }
  function ShoppingListApp() {
    const session = useSession();
    const [recipes, setRecipes] = useStorage("shopping-list-recipes", [newRecipe()]);
    const [result, setResult] = useStorage("shopping-list-result", null);
    const [extras, setExtras] = useStorage("shopping-list-extras", []);
    const [checked, setChecked] = useStorage("shopping-list-checked", {});
    const [tab, setTab] = useState2(result || extras.length ? "list" : "recipes");
    const [loading2, setLoading] = useState2(false);
    const [error, setError] = useState2("");
    const [copied, setCopied] = useState2(false);
    const [confirmClear, setConfirmClear] = useState2(false);
    const [price, setPrice] = useState2(null);
    const groups = useMemo(() => buildList(result, extras), [result, extras]);
    const total = groups.reduce((n, g) => n + g.items.length, 0);
    const done = groups.reduce((n, g) => n + g.items.filter((it) => checked[it.key]).length, 0);
    const filled = recipes.filter((r) => r.text.trim());
    const priceItems = groups.flatMap((g) => g.items).filter((it) => !checked[it.key]).map((it) => ({ id: it.key, q: amountLabel(it) || "", name: it.name }));
    const estimate = () => runEstimate(priceItems, setPrice);
    const updateRecipe = (id, text) => setRecipes(recipes.map((r) => r.id === id ? { ...r, text } : r));
    const removeRecipe = (id) => {
      const rest = recipes.filter((r) => r.id !== id);
      setRecipes(rest.length ? rest : [newRecipe()]);
    };
    async function build() {
      setLoading(true);
      setError("");
      try {
        const data = await callAI("shopping-list", { recipes: filled.map((r) => r.text) });
        setResult(data);
        setChecked((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k.startsWith("extra:"))));
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
      } catch {
      }
    }
    const addExtra = (item) => setExtras((prev) => [...prev, item]);
    const removeExtra = (id) => {
      setExtras((prev) => prev.filter((x) => x.id !== id));
      setChecked((prev) => {
        const next = { ...prev };
        delete next[`extra:${id}`];
        return next;
      });
    };
    useEffect2(() => {
      if (!confirmClear) return;
      const t = setTimeout(() => setConfirmClear(false), 3e3);
      return () => clearTimeout(t);
    }, [confirmClear]);
    function clearList() {
      if (!confirmClear) return setConfirmClear(true);
      setResult(null);
      setExtras([]);
      setChecked({});
      setConfirmClear(false);
    }
    const toggle = (key) => {
      const next = { ...checked };
      if (next[key]) delete next[key];
      else next[key] = true;
      setChecked(next);
    };
    return /* @__PURE__ */ React.createElement("div", { className: "sl" }, /* @__PURE__ */ React.createElement("header", { className: "sl-header" }, /* @__PURE__ */ React.createElement("a", { className: "sl-back", href: "./", "aria-label": "All apps" }, "\u2039"), /* @__PURE__ */ React.createElement("h1", null, "Shopping List")), /* @__PURE__ */ React.createElement("nav", { className: "sl-tabs", role: "tablist" }, /* @__PURE__ */ React.createElement("button", { role: "tab", "aria-selected": tab === "recipes", className: tab === "recipes" ? "on" : "", onClick: () => setTab("recipes") }, "Recipes", filled.length ? ` (${filled.length})` : ""), /* @__PURE__ */ React.createElement("button", { role: "tab", "aria-selected": tab === "list", className: tab === "list" ? "on" : "", onClick: () => setTab("list") }, "List", total ? ` (${total - done})` : "")), tab === "recipes" && /* @__PURE__ */ React.createElement("main", { className: "sl-main" }, /* @__PURE__ */ React.createElement("p", { className: "sl-hint" }, "Paste each recipe (or just its ingredient list) into its own box. The AI merges them into one list, adding up matching ingredients and sorting them by aisle."), recipes.map((r, i) => /* @__PURE__ */ React.createElement("div", { className: "sl-recipe", key: r.id }, /* @__PURE__ */ React.createElement("div", { className: "sl-recipe-head" }, /* @__PURE__ */ React.createElement("span", null, "Recipe ", i + 1), (recipes.length > 1 || r.text) && /* @__PURE__ */ React.createElement("button", { className: "sl-link", onClick: () => removeRecipe(r.id) }, "Remove")), /* @__PURE__ */ React.createElement(
      "textarea",
      {
        value: r.text,
        onChange: (e) => updateRecipe(r.id, e.target.value),
        placeholder: "Chicken curry\n200 g chicken breast\n1 onion\n2 cloves garlic\n\u2026",
        rows: 7
      }
    ))), /* @__PURE__ */ React.createElement("button", { className: "sl-secondary", onClick: () => setRecipes([...recipes, newRecipe()]) }, "+ Add another recipe"), error && /* @__PURE__ */ React.createElement("p", { className: "sl-error" }, error), session === null && /* @__PURE__ */ React.createElement("p", { className: "sl-note" }, /* @__PURE__ */ React.createElement("a", { href: "./" }, "Sign in on the home page"), " to build lists with AI."), /* @__PURE__ */ React.createElement("button", { className: "sl-primary", disabled: !session || loading2 || filled.length === 0, onClick: build }, loading2 ? /* @__PURE__ */ React.createElement("span", { className: "sl-busy" }, /* @__PURE__ */ React.createElement("span", { className: "sl-spinner sl-spinner-sm", "aria-hidden": "true" }), "Building\u2026") : result ? "Rebuild shopping list" : "Build shopping list"), loading2 && /* @__PURE__ */ React.createElement(BuildingList, null), result && !loading2 && /* @__PURE__ */ React.createElement("p", { className: "sl-note" }, "Rebuilding replaces the recipe items and their ticks. Items you added yourself stay.")), tab === "list" && /* @__PURE__ */ React.createElement("main", { className: "sl-main" }, total === 0 ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "sl-empty" }, /* @__PURE__ */ React.createElement("p", null, "No list yet. Build one from recipes, or add items yourself below."), /* @__PURE__ */ React.createElement("button", { className: "sl-primary", onClick: () => setTab("recipes") }, "Add recipes")), /* @__PURE__ */ React.createElement(AddItem, { onAdd: addExtra })) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "sl-toolbar" }, /* @__PURE__ */ React.createElement("span", { className: "sl-progress" }, done, " of ", total, " in the basket"), /* @__PURE__ */ React.createElement("button", { className: "sl-link", onClick: copyList }, copied ? "Copied" : "Copy"), !price && priceItems.length > 0 && /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "sl-link",
        disabled: !session,
        title: session ? void 0 : "Sign in on the home page to estimate prices",
        onClick: estimate
      },
      "Estimate cost"
    ), done > 0 && /* @__PURE__ */ React.createElement("button", { className: "sl-link", onClick: () => setChecked({}) }, "Untick all"), /* @__PURE__ */ React.createElement("button", { className: `sl-link sl-danger${confirmClear ? " armed" : ""}`, onClick: clearList }, confirmClear ? "Tap to confirm" : "Clear list")), price && /* @__PURE__ */ React.createElement(
      PricePanel,
      {
        est: price,
        stale: !price.loading && price.key !== estimateKey(priceItems),
        onRefresh: estimate,
        onClose: () => setPrice(() => null)
      }
    ), /* @__PURE__ */ React.createElement(AddItem, { onAdd: addExtra }), (result == null ? void 0 : result.recipes.length) > 0 && /* @__PURE__ */ React.createElement("p", { className: "sl-from" }, "From: ", result.recipes.map((r) => r.title).join(" \xB7 ")), groups.map(({ category, items }) => {
      const sorted = [...items].sort((a, b) => !!checked[a.key] - !!checked[b.key]);
      return /* @__PURE__ */ React.createElement("section", { className: "sl-group", key: category }, /* @__PURE__ */ React.createElement("h2", null, category), /* @__PURE__ */ React.createElement("ul", null, sorted.map((it) => /* @__PURE__ */ React.createElement("li", { key: it.key, className: checked[it.key] ? "done" : "" }, /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: !!checked[it.key], onChange: () => toggle(it.key) }), /* @__PURE__ */ React.createElement("span", { className: "sl-item" }, /* @__PURE__ */ React.createElement("span", { className: "sl-item-top" }, /* @__PURE__ */ React.createElement("span", { className: "sl-name" }, it.name), /* @__PURE__ */ React.createElement("span", { className: "sl-amount" }, amountLabel(it))), (it.notes.length > 0 || it.sources.length > 1) && /* @__PURE__ */ React.createElement("span", { className: "sl-sub" }, [
        ...it.notes,
        ...it.sources.length > 1 ? [it.sources.map((s) => `${s.title}: ${s.amounts.map(formatAmount).join(" + ")}`).join(" \xB7 ")] : []
      ].join(" \u2014 ")))), it.extraId && /* @__PURE__ */ React.createElement("button", { className: "sl-remove", onClick: () => removeExtra(it.extraId), "aria-label": `Remove ${it.name}` }, "\xD7")))));
    }))));
  }

  // shopping-list-app.jsx
  ReactDOM.createRoot(document.getElementById("app")).render(/* @__PURE__ */ React.createElement(ShoppingListApp, null));
})();
