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
    const { useState: useState6, useEffect: useEffect6 } = React;
    const [session, setSession] = useState6(current);
    useEffect6(() => {
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

  // shared/prices.js
  var PRICE_TIERS = [
    { id: "cheapest", label: "Cheapest" },
    { id: "normal", label: "Normal" },
    { id: "premium", label: "Premium" }
  ];
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

  // recipes/format.js
  var CATS = ["Breakfast", "Lunch", "Dinner"];
  var uid = () => Math.random().toString(36).slice(2, 9);
  var UNI = { "\xBD": 0.5, "\xBC": 0.25, "\xBE": 0.75, "\u2153": 1 / 3, "\u2154": 2 / 3 };
  function parseQty(q) {
    const m = q.match(/^(\d+)?\s*([½¼¾⅓⅔]|\d+\/\d+)?(?:[.,](\d+))?(.*)$/);
    if (!m || !m[1] && !m[2]) return null;
    let v = m[1] ? parseFloat(m[1] + (m[3] ? "." + m[3] : "")) : 0;
    if (m[2]) {
      if (UNI[m[2]]) v += UNI[m[2]];
      else {
        const [a, b] = m[2].split("/");
        v += a / b;
      }
    }
    return { v, rest: m[4] };
  }
  var FR = [[0, ""], [0.25, "\xBC"], [1 / 3, "\u2153"], [0.5, "\xBD"], [2 / 3, "\u2154"], [0.75, "\xBE"], [1, ""]];
  function fmtQty(v) {
    if (v >= 10) return String(Math.round(v));
    let w = Math.floor(v);
    let best = FR[0];
    FR.forEach((p) => {
      if (Math.abs(p[0] - (v - w)) < Math.abs(best[0] - (v - w))) best = p;
    });
    if (best[0] === 1) {
      w += 1;
      best = FR[0];
    }
    return (w ? String(w) : "") + best[1] || "0";
  }
  function scaleQty(q, k) {
    if (k === 1) return q;
    const p = parseQty(q);
    if (!p) return q;
    return fmtQty(p.v * k) + (p.rest && !/^\s/.test(p.rest) ? " " : "") + p.rest;
  }
  var UNITS = "cups?|tbsp|tsp|cans?|g|kg|ml|dl|l|oz|lb|pcs|pinch|bunch|handful|cloves?|fillets?|heads?|ears?|slices?";
  var ING_RE = new RegExp(`^([\\d\xBD\xBC\xBE\u2153\u2154/.,\\-]+\\s*(?:${UNITS})?)\\s+(.+)$`, "i");
  function parseIng(line) {
    const m = line.match(ING_RE);
    return m ? { q: m[1], n: m[2] } : { q: "", n: line };
  }
  var ingToLine = (g) => [g.q, g.n].filter(Boolean).join(" ");
  function stepMin(s) {
    const m = s.match(/(\d+)(?:\s*[–-]\s*(\d+))?\s*min/i);
    return m ? parseInt(m[2] || m[1], 10) : null;
  }
  function fmtClock(sec) {
    sec = Math.max(0, Math.ceil(sec));
    return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
  }
  var plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  function normRecipe(r) {
    if (r.ingredients) return r;
    const { ings = [], steps = [], ...rest } = r;
    return {
      ...rest,
      ingredients: [{ id: "i", name: "", items: ings.map((g, i) => ({ id: `i${i}`, q: g.q, n: g.n })) }],
      method: [{ id: "m", name: "", items: steps.map((text, i) => ({ id: `m${i}`, text })) }]
    };
  }
  var allIngs = (r) => r.ingredients.flatMap((s) => s.items);

  // recipes/Prices.jsx
  function TierPicker({ tier, setTier }) {
    return /* @__PURE__ */ React.createElement("div", { className: "ra-chips tight", role: "group", "aria-label": "Price level" }, PRICE_TIERS.map((t) => /* @__PURE__ */ React.createElement("button", { key: t.id, className: `ra-chip sm${tier === t.id ? " on" : ""}`, "aria-pressed": tier === t.id, onClick: () => setTier(t.id) }, t.label)));
  }
  function PriceBreakdown({ est, servings, stale, tier, setTier, onRefresh, onClose }) {
    if (est.loading) {
      return /* @__PURE__ */ React.createElement("div", { className: "ra-price", role: "status", "aria-live": "polite" }, /* @__PURE__ */ React.createElement("p", { className: "ra-muted" }, "Looking up Aldi prices\u2026"));
    }
    if (est.error) {
      return /* @__PURE__ */ React.createElement("div", { className: "ra-price" }, /* @__PURE__ */ React.createElement("p", { className: "ra-error" }, est.error), /* @__PURE__ */ React.createElement("div", { className: "ra-price-actions" }, /* @__PURE__ */ React.createElement("button", { className: "ra-small-btn", onClick: onRefresh }, "Try again"), /* @__PURE__ */ React.createElement("button", { className: "ra-small-btn", onClick: onClose }, "Close")));
    }
    const byId = new Map(est.result.items.map((i) => [i.id, i]));
    const t = priceTotals(est.result);
    const recipe = servings != null;
    return /* @__PURE__ */ React.createElement("div", { className: "ra-price" }, /* @__PURE__ */ React.createElement("div", { className: "ra-price-totals" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", { className: "ra-muted sm" }, "At the till"), /* @__PURE__ */ React.createElement("strong", null, chf(t.buy))), recipe && /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", { className: "ra-muted sm" }, "Used"), /* @__PURE__ */ React.createElement("strong", null, chf(t.used))), recipe && servings > 0 && /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", { className: "ra-muted sm" }, "Per serving"), /* @__PURE__ */ React.createElement("strong", null, chf(t.used / servings)))), t.missing > 0 && /* @__PURE__ */ React.createElement("p", { className: "ra-muted sm" }, t.missing === 1 ? "1 item has" : `${t.missing} items have`, " no price and ", t.missing === 1 ? "isn't" : "aren't", " counted."), stale && /* @__PURE__ */ React.createElement("p", { className: "ra-price-stale" }, recipe ? "Servings, ingredients or price level changed." : "The list or price level changed.", " ", /* @__PURE__ */ React.createElement("button", { className: "ra-link", onClick: onRefresh }, "Recalculate")), /* @__PURE__ */ React.createElement(TierPicker, { tier, setTier }), /* @__PURE__ */ React.createElement("ul", { className: "ra-price-rows" }, est.items.map((row) => {
      const p = byId.get(row.id) || { source: "none" };
      return /* @__PURE__ */ React.createElement("li", { key: row.id, className: p.source === "none" ? "none" : "" }, /* @__PURE__ */ React.createElement("div", { className: "ra-price-main" }, /* @__PURE__ */ React.createElement("span", { className: "ra-price-name" }, row.name, row.q && /* @__PURE__ */ React.createElement("span", { className: "ra-row-q" }, row.q)), /* @__PURE__ */ React.createElement("span", { className: "ra-price-sub" }, p.source === "aldi" && /* @__PURE__ */ React.createElement(React.Fragment, null, p.product, p.size ? ` \xB7 ${p.size}` : ""), p.source === "produce" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { className: "ra-price-tag" }, "Swiss avg."), p.product), p.source === "none" && "No price found", p.source !== "none" && /* @__PURE__ */ React.createElement("span", { className: "ra-price-calc" }, " \xB7 ", priceDetail(p))), p.note && /* @__PURE__ */ React.createElement("span", { className: "ra-price-note" }, p.note)), p.source !== "none" && /* @__PURE__ */ React.createElement("div", { className: "ra-price-cost" }, /* @__PURE__ */ React.createElement("span", null, chf(recipe ? p.used : p.buy)), recipe && p.buy !== p.used && /* @__PURE__ */ React.createElement("span", { className: "ra-muted sm" }, "of ", chf(p.buy))));
    })), /* @__PURE__ */ React.createElement("p", { className: "ra-muted sm ra-price-src" }, "Prices from aldi-suisse.ch.", t.produce && ` Swiss avg.: fresh produce, Swiss retail average ${monthLabel(est.result.produceMonth)} (BLW), as Aldi doesn't list it online.`), /* @__PURE__ */ React.createElement("div", { className: "ra-price-actions" }, !stale && /* @__PURE__ */ React.createElement("button", { className: "ra-small-btn", onClick: onRefresh }, "Refresh"), /* @__PURE__ */ React.createElement("button", { className: "ra-small-btn", onClick: onClose }, "Close")));
  }

  // recipes/ListTab.jsx
  var { useState: useState2, useRef: useRef2, useEffect: useEffect2 } = React;
  var ROW_H = 54;
  var HOLD_MS = 300;
  var SETTLE_MS = 380;
  var focusRef = (el) => el && el.focus();
  var selectRef = (el) => {
    if (el) {
      el.focus();
      el.select();
    }
  };
  var stop = (e) => e.stopPropagation();
  function ListTab({ lists, list, setActive, setLists, updateItems, queueMerge, showToast, session, price, setPrice, tier, setTier }) {
    const [editingId, setEditingId] = useState2(null);
    const [editingTitle, setEditingTitle] = useState2(false);
    const [draft, setDraft] = useState2("");
    const [addDraft, setAddDraft] = useState2("");
    const [confirmClear, setConfirmClear] = useState2(false);
    const [settle, setSettle] = useState2(null);
    const settleRef = useRef2(null);
    const settleT = useRef2(null);
    const [drag, setDrag] = useState2(null);
    const dragRef = useRef2(null);
    const pressRef = useRef2(null);
    const pressT = useRef2(null);
    const justDragged = useRef2(false);
    const latest = useRef2({});
    latest.current = { list, updateItems };
    function finishSettle() {
      const st = settleRef.current;
      if (!st) return;
      clearTimeout(settleT.current);
      settleRef.current = null;
      setSettle(null);
      latest.current.updateItems(st.listId, (items) => {
        const it = items.find((i) => i.id === st.id);
        if (!it) return items;
        const moved = { ...it, checked: !it.checked };
        const rest = items.filter((i) => i.id !== st.id);
        const todo2 = rest.filter((i) => !i.checked);
        return [...todo2, moved, ...rest.filter((i) => i.checked)];
      });
    }
    function toggle(id) {
      finishSettle();
      settleRef.current = { id, listId: list.id };
      setSettle(id);
      settleT.current = setTimeout(finishSettle, SETTLE_MS);
    }
    useEffect2(() => {
      function onMove(e) {
        const d = dragRef.current;
        if (d) {
          e.preventDefault();
          let off = e.clientY - d.y;
          const steps = Math.round(off / ROW_H);
          if (steps) {
            const idx = d.order.indexOf(d.id);
            const ni = Math.max(0, Math.min(d.order.length - 1, idx + steps));
            if (ni !== idx) {
              const order = d.order.filter((x) => x !== d.id);
              order.splice(ni, 0, d.id);
              d.order = order;
              d.y += (ni - idx) * ROW_H;
              off -= (ni - idx) * ROW_H;
            }
          }
          setDrag({ id: d.id, order: d.order, off });
        } else if (pressRef.current) {
          const p = pressRef.current;
          if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) {
            clearTimeout(pressT.current);
            pressRef.current = null;
          }
        }
      }
      function onUp() {
        clearTimeout(pressT.current);
        pressRef.current = null;
        const d = dragRef.current;
        if (!d) return;
        dragRef.current = null;
        justDragged.current = true;
        setTimeout(() => justDragged.current = false, 60);
        setDrag(null);
        latest.current.updateItems(d.listId, (items) => {
          const byId = new Map(items.map((i) => [i.id, i]));
          const todo2 = d.order.map((id) => byId.get(id)).filter((i) => i && !i.checked);
          const seen = new Set(todo2.map((i) => i.id));
          return [...todo2, ...items.filter((i) => !seen.has(i.id))];
        });
      }
      function onTouchMove(e) {
        if (dragRef.current) e.preventDefault();
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      window.addEventListener("touchmove", onTouchMove, { passive: false });
      return () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        window.removeEventListener("touchmove", onTouchMove);
        clearTimeout(pressT.current);
        clearTimeout(settleT.current);
      };
    }, []);
    function down(id, e) {
      if (editingId || e.button > 0) return;
      pressRef.current = { x: e.clientX, y: e.clientY };
      clearTimeout(pressT.current);
      pressT.current = setTimeout(() => {
        if (!pressRef.current) return;
        const cur = latest.current.list;
        const order = cur.items.filter((i) => !i.checked).map((i) => i.id);
        dragRef.current = { id, listId: cur.id, y: pressRef.current.y, order };
        pressRef.current = null;
        setDrag({ id, order, off: 0 });
        if (navigator.vibrate) navigator.vibrate(8);
      }, HOLD_MS);
    }
    function edit(item) {
      if (justDragged.current || drag) return;
      finishSettle();
      setEditingTitle(false);
      setEditingId(item.id);
      setDraft(ingToLine({ q: item.q, n: item.name }));
    }
    function commitItem() {
      if (!editingId) return;
      const v = draft.trim();
      const { q, n } = parseIng(v);
      updateItems(
        list.id,
        (items) => v ? items.map((i) => i.id === editingId ? { ...i, name: n, q } : i) : items.filter((i) => i.id !== editingId)
      );
      setEditingId(null);
    }
    const onItemKey = (e) => {
      if (e.key === "Enter") commitItem();
      if (e.key === "Escape") setEditingId(null);
    };
    function startTitleEdit() {
      setEditingId(null);
      setEditingTitle(true);
      setDraft(list.name);
    }
    function commitTitle() {
      if (!editingTitle) return;
      setEditingTitle(false);
      const v = draft.trim();
      if (v) {
        setLists((ls) => ls.map((l) => l.id === list.id ? { ...l, name: v } : l));
      } else if (lists.length > 1) {
        const rest = lists.filter((l) => l.id !== list.id);
        setLists(rest);
        setActive(rest[0].id);
        showToast(`Deleted ${list.name}`);
      }
    }
    const onTitleKey = (e) => {
      if (e.key === "Enter") commitTitle();
      if (e.key === "Escape") setEditingTitle(false);
    };
    function addList() {
      finishSettle();
      const id = uid();
      setLists((ls) => [...ls, { id, name: "New list", items: [] }]);
      setActive(id);
      setEditingId(null);
      setEditingTitle(true);
      setDraft("New list");
    }
    function switchList(id) {
      if (id === list.id) return startTitleEdit();
      finishSettle();
      setEditingId(null);
      setEditingTitle(false);
      setConfirmClear(false);
      setActive(id);
    }
    function addItem(e) {
      e.preventDefault();
      const v = addDraft.trim();
      if (!v) return;
      const { q, n } = parseIng(v);
      const id = uid();
      updateItems(list.id, (items) => [{ id, name: n, q, checked: false }, ...items]);
      queueMerge(list.id, [id]);
      setAddDraft("");
    }
    function clearDone() {
      finishSettle();
      const n = list.items.filter((i) => i.checked).length;
      if (!n) return;
      updateItems(list.id, (items) => items.filter((i) => !i.checked));
      showToast(`Cleared ${plural(n, "item")}`);
    }
    function clearAll() {
      if (!confirmClear) {
        setConfirmClear(true);
        return;
      }
      setConfirmClear(false);
      finishSettle();
      const n = list.items.length;
      updateItems(list.id, () => []);
      showToast(`Cleared ${plural(n, "item")}`);
    }
    const inCart = (i) => i.checked;
    const shownChecked = (i) => settle === i.id ? !i.checked : i.checked;
    let todo = list.items.filter((i) => !inCart(i));
    if (drag) {
      const byId = new Map(todo.map((i) => [i.id, i]));
      todo = drag.order.map((id) => byId.get(id)).filter(Boolean);
    }
    const done = list.items.filter(inCart);
    const priceItems = list.items.filter((i) => !i.checked).map((i) => ({ id: i.id, q: i.q || "", name: i.name }));
    const estimate = () => runEstimate(priceItems, setPrice, tier);
    const renderRow = (i, draggable) => {
      const dragging = draggable && drag && drag.id === i.id;
      const checked = shownChecked(i);
      return /* @__PURE__ */ React.createElement(
        "div",
        {
          key: i.id,
          className: `ra-row${draggable ? " drag" : ""}${dragging ? " dragging" : ""}`,
          style: dragging ? { transform: `translateY(${drag.off}px) scale(1.02)` } : void 0,
          onPointerDown: draggable ? (e) => down(i.id, e) : void 0,
          onContextMenu: draggable ? (e) => e.preventDefault() : void 0
        },
        /* @__PURE__ */ React.createElement(
          "button",
          {
            className: `ra-check${checked ? " on" : ""}`,
            onPointerDown: stop,
            onClick: () => toggle(i.id),
            "aria-label": checked ? `Untick ${i.name}` : `Tick ${i.name}`
          },
          checked ? "\u2713" : ""
        ),
        editingId === i.id ? /* @__PURE__ */ React.createElement(
          "input",
          {
            ref: focusRef,
            className: "ra-row-input",
            value: draft,
            onChange: (e) => setDraft(e.target.value),
            onKeyDown: onItemKey,
            onBlur: commitItem,
            onPointerDown: stop
          }
        ) : /* @__PURE__ */ React.createElement("span", { className: `ra-row-name${checked ? " done" : ""}`, onClick: () => edit(i) }, i.name, i.q && /* @__PURE__ */ React.createElement("span", { className: "ra-row-q" }, i.q)),
        draggable && /* @__PURE__ */ React.createElement("span", { className: "ra-grip", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("span", null), /* @__PURE__ */ React.createElement("span", null), /* @__PURE__ */ React.createElement("span", null))
      );
    };
    return /* @__PURE__ */ React.createElement("main", { className: "ra-screen" }, /* @__PURE__ */ React.createElement("div", { className: "ra-eyebrow" }, /* @__PURE__ */ React.createElement("a", { href: "./", "aria-label": "All apps" }, "\u2039"), "Shopping list"), editingTitle ? /* @__PURE__ */ React.createElement(
      "input",
      {
        ref: selectRef,
        className: "ra-title ra-title-input",
        value: draft,
        onChange: (e) => setDraft(e.target.value),
        onKeyDown: onTitleKey,
        onBlur: commitTitle,
        "aria-label": "List name"
      }
    ) : /* @__PURE__ */ React.createElement("h1", { className: "ra-title editable", onClick: startTitleEdit }, list.name), /* @__PURE__ */ React.createElement("div", { className: "ra-chips" }, lists.map((l) => {
      const n = l.items.filter((i) => !i.checked).length;
      return /* @__PURE__ */ React.createElement("button", { key: l.id, className: `ra-chip${l.id === list.id ? " on" : ""}`, onClick: () => switchList(l.id) }, l.name, n > 0 && /* @__PURE__ */ React.createElement("span", { className: "ra-chip-count" }, n));
    }), /* @__PURE__ */ React.createElement("button", { className: "ra-chip dashed", onClick: addList }, "+ New list")), /* @__PURE__ */ React.createElement("form", { className: "ra-add", onSubmit: addItem }, /* @__PURE__ */ React.createElement("input", { value: addDraft, onChange: (e) => setAddDraft(e.target.value), placeholder: "Add an item, e.g. 2 Lemons", "aria-label": "New item" }), /* @__PURE__ */ React.createElement("button", { type: "submit", "aria-label": "Add item" }, "+")), /* @__PURE__ */ React.createElement("div", { className: "ra-section-head" }, /* @__PURE__ */ React.createElement("span", null, todo.length ? `${todo.length} to get` : "All set"), /* @__PURE__ */ React.createElement("span", { className: "ra-section-btns" }, todo.length > 0 && !price && /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "ra-small-btn",
        disabled: !session,
        title: session ? void 0 : "Sign in on the home page to estimate prices",
        onClick: estimate
      },
      "Estimate cost"
    ), list.items.length > 0 && /* @__PURE__ */ React.createElement(
      "button",
      {
        className: `ra-small-btn${confirmClear ? " confirm" : ""}`,
        onClick: clearAll,
        onBlur: () => setConfirmClear(false)
      },
      confirmClear ? "Tap again to clear" : "Clear list"
    ))), !price && todo.length > 0 && /* @__PURE__ */ React.createElement(TierPicker, { tier, setTier }), price && /* @__PURE__ */ React.createElement(
      PriceBreakdown,
      {
        est: price,
        stale: !price.loading && price.key !== estimateKey(priceItems, tier),
        tier,
        setTier,
        onRefresh: estimate,
        onClose: () => setPrice(() => null)
      }
    ), /* @__PURE__ */ React.createElement("div", null, todo.map((i) => renderRow(i, true))), todo.length === 0 && /* @__PURE__ */ React.createElement("p", { className: "ra-empty" }, "Nothing left to get."), done.length > 0 && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "ra-section-head cart" }, /* @__PURE__ */ React.createElement("span", null, "In the cart \xB7 ", done.length), /* @__PURE__ */ React.createElement("button", { className: "ra-small-btn", onClick: clearDone }, "Clear")), done.map((i) => renderRow(i, false))));
  }

  // recipes/photos.js
  var BUCKET = "recipe-photos";
  var PHOTO_MAX_SIDE = 1280;
  var PHOTO_QUALITY = 0.8;
  function drawScaled(file, maxSide) {
    return new Promise((resolve, reject) => {
      const src = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(src);
        resolve(canvas);
      };
      img.onerror = () => {
        URL.revokeObjectURL(src);
        reject(new Error("Couldn't read that image."));
      };
      img.src = src;
    });
  }
  var toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  async function compressPhoto(file) {
    const canvas = await drawScaled(file, PHOTO_MAX_SIDE);
    let blob = await toBlob(canvas, "image/webp", PHOTO_QUALITY);
    if (!blob || blob.type !== "image/webp") blob = await toBlob(canvas, "image/jpeg", PHOTO_QUALITY);
    if (!blob) throw new Error("Couldn't compress that image.");
    return { blob, preview: URL.createObjectURL(blob) };
  }
  var photoUrl = (path) => `/api/storage/${BUCKET}/${path}`;
  async function uploadPhoto(session, blob) {
    const ext = blob.type === "image/webp" ? "webp" : "jpg";
    const path = `${session.user.id}/${Date.now()}-${uid()}.${ext}`;
    try {
      await apiFetch(photoUrl(path), { method: "PUT", body: blob, headers: { "Content-Type": blob.type } });
    } catch (err) {
      throw new Error(`Photo upload failed: ${err.message}`);
    }
    return path;
  }
  async function removePhoto(path) {
    if (!path) return;
    await apiFetch(photoUrl(path), { method: "DELETE" }).catch(() => {
    });
  }
  function usePhotoUrl(path, session) {
    return path && session ? photoUrl(path) : null;
  }

  // recipes/Photo.jsx
  function Photo({ path, session, className = "", children }) {
    const url = usePhotoUrl(path, session);
    return /* @__PURE__ */ React.createElement("div", { className: `ra-ph ${className}` }, url && /* @__PURE__ */ React.createElement("img", { className: "ra-photo", src: url, alt: "", loading: "lazy" }), children);
  }

  // recipes/Notebook.jsx
  var meta = (r) => `${r.time} min \xB7 Serves ${r.serves}`;
  function Tags({ tags }) {
    return /* @__PURE__ */ React.createElement("div", { className: "ra-tags" }, tags.map((tg) => /* @__PURE__ */ React.createElement("span", { key: tg, className: "ra-tag" }, tg)));
  }
  function Notebook({ recipes, session, query, setQuery, cat, setCat, openRecipe, openCompose }) {
    const q = query.trim().toLowerCase();
    const filtered = recipes.filter(
      (r) => (cat === "All" || r.cat === cat) && (!q || r.name.toLowerCase().includes(q) || allIngs(r).some((g) => g.n.toLowerCase().includes(q)))
    );
    const [featured, ...rest] = filtered;
    return /* @__PURE__ */ React.createElement("main", { className: "ra-screen" }, /* @__PURE__ */ React.createElement("div", { className: "ra-eyebrow" }, /* @__PURE__ */ React.createElement("a", { href: "./", "aria-label": "All apps" }, "\u2039"), "Notebook"), /* @__PURE__ */ React.createElement("div", { className: "ra-title-row" }, /* @__PURE__ */ React.createElement("h1", { className: "ra-title" }, "Recipes"), /* @__PURE__ */ React.createElement("button", { className: "ra-accent-btn", onClick: openCompose }, /* @__PURE__ */ React.createElement("span", null, "+"), "Add recipe")), recipes.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "ra-empty big" }, /* @__PURE__ */ React.createElement("p", null, "No recipes yet."), /* @__PURE__ */ React.createElement("p", { className: "ra-muted" }, "Add one by hand, or let \u2726 Magic read it from a screenshot, text or link.")) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
      "input",
      {
        className: "ra-field ra-search",
        type: "search",
        value: query,
        onChange: (e) => setQuery(e.target.value),
        placeholder: "Search recipes or ingredients"
      }
    ), /* @__PURE__ */ React.createElement("div", { className: "ra-chips" }, ["All", ...CATS].map((c) => /* @__PURE__ */ React.createElement("button", { key: c, className: `ra-chip sm${cat === c ? " on" : ""}`, onClick: () => setCat(c) }, c))), featured && /* @__PURE__ */ React.createElement("button", { className: "ra-card featured", onClick: () => openRecipe(featured.id) }, /* @__PURE__ */ React.createElement(Photo, { path: featured.photo, session }), /* @__PURE__ */ React.createElement("div", { className: "ra-card-body" }, /* @__PURE__ */ React.createElement(Tags, { tags: featured.tags }), /* @__PURE__ */ React.createElement("div", { className: "ra-card-title" }, featured.name), /* @__PURE__ */ React.createElement("div", { className: "ra-card-meta" }, meta(featured)))), /* @__PURE__ */ React.createElement("div", { className: "ra-grid" }, rest.map((r) => /* @__PURE__ */ React.createElement("button", { key: r.id, className: "ra-card", onClick: () => openRecipe(r.id) }, /* @__PURE__ */ React.createElement(Photo, { path: r.photo, session }), /* @__PURE__ */ React.createElement("div", { className: "ra-card-body" }, /* @__PURE__ */ React.createElement("div", { className: "ra-card-name" }, r.name), /* @__PURE__ */ React.createElement("div", { className: "ra-card-meta" }, meta(r)))))), filtered.length === 0 && /* @__PURE__ */ React.createElement("p", { className: "ra-empty" }, "No recipes match.")));
  }

  // recipes/RecipeDetail.jsx
  function StepTimer({ tm, detected, open: open2, update: update2, close }) {
    if (!tm) {
      return /* @__PURE__ */ React.createElement("button", { className: "ra-timer-open", onClick: open2 }, detected ? `Timer \xB7 ${detected} min` : "+ Timer");
    }
    if (!tm.started) {
      return /* @__PURE__ */ React.createElement("div", { className: "ra-timer-set" }, /* @__PURE__ */ React.createElement("button", { onClick: () => update2((o) => ({ ...o, dur: Math.max(60, o.dur - 60) })), "aria-label": "One minute less" }, "\u2212"), /* @__PURE__ */ React.createElement("span", null, Math.round(tm.dur / 60), " min"), /* @__PURE__ */ React.createElement("button", { onClick: () => update2((o) => ({ ...o, dur: o.dur + 60 })), "aria-label": "One minute more" }, "+"), /* @__PURE__ */ React.createElement(
        "button",
        {
          className: "start",
          onClick: () => update2((o) => ({ ...o, started: true, running: true, endAt: Date.now() + o.dur * 1e3, left: o.dur }))
        },
        "Start"
      ), /* @__PURE__ */ React.createElement("button", { className: "close", onClick: close, "aria-label": "Close timer" }, "\u2715"));
    }
    const left = tm.running ? (tm.endAt - Date.now()) / 1e3 : tm.left;
    const progress = Math.min(100, 100 - left / tm.dur * 100);
    const pause = () => update2(
      (o) => o.done ? { ...o, done: false, running: true, endAt: Date.now() + o.dur * 1e3, left: o.dur } : o.running ? { ...o, running: false, left: Math.max(0, (o.endAt - Date.now()) / 1e3) } : { ...o, running: true, endAt: Date.now() + o.left * 1e3 }
    );
    return /* @__PURE__ */ React.createElement("div", { className: `ra-timer-run${tm.done ? " done" : ""}` }, /* @__PURE__ */ React.createElement("span", { className: "ra-timer-bar", style: { width: `${progress}%` } }), /* @__PURE__ */ React.createElement("span", { className: "ra-timer-clock" }, tm.done ? "Time's up" : fmtClock(left)), /* @__PURE__ */ React.createElement("button", { className: "pause", onClick: pause }, tm.done ? "Restart" : tm.running ? "Pause" : "Resume"), /* @__PURE__ */ React.createElement("button", { className: "reset", onClick: () => update2((o) => ({ dur: o.dur, label: o.label })) }, "Reset"));
  }
  function RecipeDetail({ recipe, session, list, servings, setServings, timers, setTimer, price, setPrice, tier, setTier, onBack, onEdit, addToList }) {
    const sv = servings != null ? servings : recipe.serves;
    const k = sv > 0 ? sv / recipe.serves : 1;
    const have = new Set(list.items.filter((i) => !i.checked).flatMap((i) => i.src || []));
    const src = (g) => `${recipe.id}:${g.id}`;
    const toAdd = (g) => ({ q: scaleQty(g.q, k), n: g.n, src: src(g) });
    const missing = allIngs(recipe).filter((g) => !have.has(src(g)));
    const priceItems = allIngs(recipe).map((g) => ({ id: g.id, q: scaleQty(g.q, k), name: g.n }));
    const estimate = () => runEstimate(priceItems, setPrice, tier);
    return /* @__PURE__ */ React.createElement("main", { className: "ra-detail" }, /* @__PURE__ */ React.createElement(Photo, { path: recipe.photo, session, className: `ra-detail-ph${recipe.photo ? " has-photo" : ""}` }, /* @__PURE__ */ React.createElement("button", { className: "ra-round-btn", onClick: onBack, "aria-label": "Back" }, "\u2190"), /* @__PURE__ */ React.createElement("button", { className: "ra-round-btn text", onClick: onEdit }, "Edit")), /* @__PURE__ */ React.createElement("div", { className: "ra-detail-body" }, /* @__PURE__ */ React.createElement(Tags, { tags: recipe.tags }), /* @__PURE__ */ React.createElement("h1", { className: "ra-title detail" }, recipe.name), /* @__PURE__ */ React.createElement("div", { className: "ra-servings" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", { className: "ra-muted sm" }, "Servings"), /* @__PURE__ */ React.createElement("span", { className: "ra-muted" }, recipe.time, " min")), /* @__PURE__ */ React.createElement("div", { className: "ra-stepper" }, /* @__PURE__ */ React.createElement("button", { onClick: () => setServings(Math.max(1, (sv || 1) - 1)), "aria-label": "Fewer servings" }, "\u2212"), /* @__PURE__ */ React.createElement(
      "input",
      {
        value: sv || "",
        inputMode: "numeric",
        "aria-label": "Servings",
        onChange: (e) => {
          const v = e.target.value.replace(/\D/g, "").slice(0, 2);
          setServings(v ? parseInt(v, 10) : 0);
        }
      }
    ), /* @__PURE__ */ React.createElement("button", { className: "plus", onClick: () => setServings(Math.min(99, (sv || 0) + 1)), "aria-label": "More servings" }, "+"))), /* @__PURE__ */ React.createElement("div", { className: "ra-sub-head" }, /* @__PURE__ */ React.createElement("h2", null, "Ingredients"), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: `ra-pill-btn${missing.length ? " accent" : ""}`,
        disabled: !missing.length,
        onClick: () => addToList(missing.map(toAdd))
      },
      missing.length ? `Add ${missing.length} to ${list.name}` : `All on ${list.name}`
    )), recipe.ingredients.map((sec) => /* @__PURE__ */ React.createElement("section", { key: sec.id }, sec.name && /* @__PURE__ */ React.createElement("h3", { className: "ra-sec-head" }, sec.name), sec.items.map((g) => /* @__PURE__ */ React.createElement("div", { key: g.id, className: "ra-ing" }, /* @__PURE__ */ React.createElement("span", { className: "ra-ing-q" }, scaleQty(g.q, k)), /* @__PURE__ */ React.createElement("span", { className: "ra-ing-n" }, g.n), have.has(src(g)) ? /* @__PURE__ */ React.createElement("span", { className: "ra-on-list" }, "On list") : /* @__PURE__ */ React.createElement("button", { className: "ra-ing-add", onClick: () => addToList([toAdd(g)]), "aria-label": `Add ${g.n} to shopping list` }, "+"))))), priceItems.length > 0 && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "ra-sub-head" }, /* @__PURE__ */ React.createElement("h2", null, "Cost"), !price && /* @__PURE__ */ React.createElement("button", { className: "ra-pill-btn", disabled: !session, onClick: estimate }, "Estimate at Aldi")), !price && /* @__PURE__ */ React.createElement(TierPicker, { tier, setTier }), !price && session === null && /* @__PURE__ */ React.createElement("p", { className: "ra-muted sm ra-price-hint" }, /* @__PURE__ */ React.createElement("a", { href: "./" }, "Sign in on the home page"), " to estimate prices."), price && /* @__PURE__ */ React.createElement(
      PriceBreakdown,
      {
        est: price,
        servings: sv,
        stale: !price.loading && price.key !== estimateKey(priceItems, tier),
        tier,
        setTier,
        onRefresh: estimate,
        onClose: () => setPrice(() => null)
      }
    )), recipe.method.some((sec) => sec.items.length) && /* @__PURE__ */ React.createElement("h2", { className: "ra-method-head" }, "Method"), recipe.method.map((sec) => /* @__PURE__ */ React.createElement("section", { key: sec.id }, sec.name && /* @__PURE__ */ React.createElement("h3", { className: "ra-sec-head" }, sec.name), /* @__PURE__ */ React.createElement("ol", { className: "ra-steps" }, sec.items.map((step, i) => {
      const key = `${recipe.id}:${step.id}`;
      const detected = stepMin(step.text);
      const label = `${recipe.name}, ${sec.name ? `${sec.name} ` : ""}step ${i + 1}`;
      return /* @__PURE__ */ React.createElement("li", { key: step.id }, /* @__PURE__ */ React.createElement("span", { className: "ra-step-n" }, i + 1), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", null, step.text), /* @__PURE__ */ React.createElement(
        StepTimer,
        {
          tm: timers[key],
          detected,
          open: () => setTimer(key, () => ({ dur: (detected || 5) * 60, label })),
          update: (fn) => setTimer(key, fn),
          close: () => setTimer(key, () => null)
        }
      )));
    })))), recipe.notes && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("h2", { className: "ra-method-head" }, "Notes"), /* @__PURE__ */ React.createElement("p", { className: "ra-notes" }, recipe.notes))));
  }

  // recipes/SectionEditor.jsx
  var { useState: useState3, useRef: useRef3, useEffect: useEffect3 } = React;
  var EDGE_PX = 80;
  var SCROLL_PX = 12;
  var KINDS = {
    ing: {
      blank: () => ({ id: uid(), q: "", n: "" }),
      fromLine: (line) => ({ id: uid(), ...parseIng(line) }),
      isEmpty: (g) => !g.q.trim() && !g.n.trim(),
      add: "Add ingredient"
    },
    step: {
      blank: () => ({ id: uid(), text: "" }),
      fromLine: (text) => ({ id: uid(), text }),
      isEmpty: (s) => !s.text.trim(),
      add: "Add step"
    }
  };
  var blankSection = (kind) => ({ id: uid(), name: "", items: [KINDS[kind].blank()] });
  function cleanSections(kind, sections) {
    const k = KINDS[kind];
    return sections.map((sec) => ({
      id: sec.id,
      name: sec.name.trim(),
      items: sec.items.filter((it) => !k.isEmpty(it)).map((it) => kind === "ing" ? { id: it.id, q: it.q.trim(), n: it.n.trim() } : { id: it.id, text: it.text.trim() })
    })).filter((sec) => sec.items.length);
  }
  function autosize(el) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }
  function nearestGap(gaps, y) {
    let best = gaps[0];
    gaps.forEach((g) => {
      if (Math.abs(g.y - y) < Math.abs(best.y - y)) best = g;
    });
    return best;
  }
  function SectionEditor({ kind, sections, setSections, disabled }) {
    var _a;
    const k = KINDS[kind];
    const [focusId, setFocusId] = useState3(null);
    const [confirmSec, setConfirmSec] = useState3(null);
    const [drag, setDrag] = useState3(null);
    const rootRef = useRef3(null);
    const rowEls = useRef3(/* @__PURE__ */ new Map());
    const listEls = useRef3(/* @__PURE__ */ new Map());
    const sectionsRef = useRef3(sections);
    sectionsRef.current = sections;
    const showHeads = sections.length > 1 || !!((_a = sections[0]) == null ? void 0 : _a.name);
    useEffect3(() => {
      if (!focusId) return;
      const el = rootRef.current && rootRef.current.querySelector(`[data-focus="${focusId}"]`);
      if (el) {
        el.focus();
        const end = el.value.length;
        el.setSelectionRange(end, end);
      }
      setFocusId(null);
    }, [focusId]);
    const updateSec = (secId, fn) => setSections((ss) => ss.map((s) => s.id === secId ? fn(s) : s));
    const updateItem = (secId, id, patch) => updateSec(secId, (s) => ({ ...s, items: s.items.map((it) => it.id === id ? { ...it, ...patch } : it) }));
    function insertAfter(secId, afterId, items) {
      updateSec(secId, (s) => {
        const at = afterId ? s.items.findIndex((it) => it.id === afterId) + 1 : s.items.length;
        return { ...s, items: [...s.items.slice(0, at), ...items, ...s.items.slice(at)] };
      });
      setFocusId(items[items.length - 1].id);
    }
    function removeItem(secId, id) {
      const sec = sections.find((s) => s.id === secId);
      const i = sec.items.findIndex((it) => it.id === id);
      updateSec(secId, (s) => ({ ...s, items: s.items.filter((it) => it.id !== id) }));
      return sec.items[i - 1] || sec.items[i + 1];
    }
    function addSection() {
      const sec = { ...blankSection(kind), items: [] };
      setSections((ss) => [...ss, sec]);
      setFocusId(sec.id);
    }
    function removeSection(sec) {
      if (sec.items.some((it) => !k.isEmpty(it)) && confirmSec !== sec.id) {
        setConfirmSec(sec.id);
        return;
      }
      setConfirmSec(null);
      setSections((ss) => ss.filter((s) => s.id !== sec.id));
    }
    function onKeyDown(e, sec, it) {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        insertAfter(sec.id, it.id, [k.blank()]);
      } else if (e.key === "Backspace" && k.isEmpty(it) && sec.items.length > 1) {
        e.preventDefault();
        const next = removeItem(sec.id, it.id);
        if (next) setFocusId(next.id);
      }
    }
    function onPaste(e, sec, it) {
      const lines = e.clipboardData.getData("text").split("\n").map((x) => x.trim()).filter(Boolean);
      const empty = k.isEmpty(it);
      if (!lines.length || lines.length === 1 && !(empty && kind === "ing")) return;
      e.preventDefault();
      const rows = lines.map(k.fromLine);
      if (empty) {
        const [first, ...rest] = rows;
        updateItem(sec.id, it.id, { ...first, id: it.id });
        if (rest.length) insertAfter(sec.id, it.id, rest);
        else setFocusId(it.id);
      } else {
        insertAfter(sec.id, it.id, rows);
      }
    }
    function startDrag(e, secId, id) {
      if (disabled || e.button > 0) return;
      e.preventDefault();
      const pageY = (el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top + window.scrollY, bottom: r.bottom + window.scrollY };
      };
      const dragged = pageY(rowEls.current.get(id));
      const gaps = [];
      sectionsRef.current.forEach((sec) => {
        const rest = sec.items.filter((it) => it.id !== id);
        const from = sec.items.findIndex((it) => it.id === id);
        for (let j = 0; j <= rest.length; j++) {
          let y;
          if (sec.id === secId && j === from) y = (dragged.top + dragged.bottom) / 2;
          else if (rest[j - 1] && rest[j]) y = (pageY(rowEls.current.get(rest[j - 1].id)).bottom + pageY(rowEls.current.get(rest[j].id)).top) / 2;
          else if (rest[j]) y = pageY(rowEls.current.get(rest[j].id)).top;
          else if (rest[j - 1]) y = pageY(rowEls.current.get(rest[j - 1].id)).bottom;
          else y = pageY(listEls.current.get(sec.id)).top;
          gaps.push({ secId: sec.id, index: j, y });
        }
      });
      const home = { secId, index: sectionsRef.current.find((s) => s.id === secId).items.findIndex((it) => it.id === id) };
      const d = { id, secId, startY: e.clientY + window.scrollY, centre: (dragged.top + dragged.bottom) / 2, clientY: e.clientY, target: home };
      let raf = 0;
      function update2() {
        const off = d.clientY + window.scrollY - d.startY;
        d.target = nearestGap(gaps, d.centre + off);
        setDrag({ id, secId, off, target: d.target, home });
      }
      function tick() {
        const dir = d.clientY < EDGE_PX ? -1 : d.clientY > window.innerHeight - EDGE_PX ? 1 : 0;
        if (dir) {
          window.scrollBy(0, dir * SCROLL_PX);
          update2();
        }
        raf = requestAnimationFrame(tick);
      }
      function onMove(ev) {
        d.clientY = ev.clientY;
        update2();
      }
      function onTouchMove(ev) {
        ev.preventDefault();
      }
      function onUp() {
        cancelAnimationFrame(raf);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        window.removeEventListener("touchmove", onTouchMove);
        setDrag(null);
        const t = d.target;
        if (t.secId === home.secId && t.index === home.index) return;
        setSections((ss) => {
          const item = ss.find((s) => s.id === secId).items.find((it) => it.id === id);
          const out = ss.map((s) => ({ ...s, items: s.items.filter((it) => it.id !== id) }));
          return out.map((s) => s.id === t.secId ? { ...s, items: [...s.items.slice(0, t.index), item, ...s.items.slice(t.index)] } : s);
        });
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      window.addEventListener("touchmove", onTouchMove, { passive: false });
      if (navigator.vibrate) navigator.vibrate(8);
      update2();
      raf = requestAnimationFrame(tick);
    }
    const moved = drag && (drag.target.secId !== drag.home.secId || drag.target.index !== drag.home.index);
    function renderRow(sec, it, n) {
      const dragging = drag && drag.id === it.id;
      return /* @__PURE__ */ React.createElement(
        "div",
        {
          ref: (el) => el ? rowEls.current.set(it.id, el) : rowEls.current.delete(it.id),
          className: `ra-ed-row${dragging ? " dragging" : ""}`,
          style: dragging ? { transform: `translateY(${drag.off}px)` } : void 0
        },
        /* @__PURE__ */ React.createElement(
          "button",
          {
            className: "ra-ed-grip",
            onPointerDown: (e) => startDrag(e, sec.id, it.id),
            onContextMenu: (e) => e.preventDefault(),
            "aria-label": "Drag to reorder",
            tabIndex: -1
          },
          /* @__PURE__ */ React.createElement("span", { className: "ra-grip" }, /* @__PURE__ */ React.createElement("span", null), /* @__PURE__ */ React.createElement("span", null), /* @__PURE__ */ React.createElement("span", null))
        ),
        kind === "ing" ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
          "input",
          {
            className: "ra-ed-field q",
            value: it.q,
            onChange: (e) => updateItem(sec.id, it.id, { q: e.target.value }),
            onPaste: (e) => onPaste(e, sec, it),
            placeholder: "Qty",
            "aria-label": "Quantity",
            disabled
          }
        ), /* @__PURE__ */ React.createElement(
          "input",
          {
            className: "ra-ed-field",
            "data-focus": it.id,
            value: it.n,
            onChange: (e) => updateItem(sec.id, it.id, { n: e.target.value }),
            onKeyDown: (e) => onKeyDown(e, sec, it),
            onPaste: (e) => onPaste(e, sec, it),
            placeholder: "Ingredient",
            "aria-label": "Ingredient",
            disabled
          }
        )) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { className: "ra-step-n sm" }, n), /* @__PURE__ */ React.createElement(
          "textarea",
          {
            className: "ra-ed-field step",
            "data-focus": it.id,
            ref: (el) => autosize(el),
            rows: 1,
            value: it.text,
            onChange: (e) => {
              autosize(e.target);
              updateItem(sec.id, it.id, { text: e.target.value });
            },
            onKeyDown: (e) => onKeyDown(e, sec, it),
            onPaste: (e) => onPaste(e, sec, it),
            placeholder: "Describe this step",
            "aria-label": `Step ${n}`,
            disabled
          }
        )),
        /* @__PURE__ */ React.createElement("button", { className: "ra-ed-remove", onClick: () => removeItem(sec.id, it.id), "aria-label": "Remove", disabled }, "\u2715")
      );
    }
    return /* @__PURE__ */ React.createElement("div", { className: "ra-ed", ref: rootRef }, sections.map((sec) => {
      const rest = drag ? sec.items.filter((it) => it.id !== drag.id) : sec.items;
      const dropAt = moved && drag.target.secId === sec.id ? drag.target.index : -1;
      const dropBefore = dropAt >= 0 && rest[dropAt] ? rest[dropAt].id : null;
      return /* @__PURE__ */ React.createElement("div", { key: sec.id, className: "ra-ed-sec" }, showHeads && /* @__PURE__ */ React.createElement("div", { className: "ra-ed-head" }, /* @__PURE__ */ React.createElement(
        "input",
        {
          className: "ra-ed-name",
          "data-focus": sec.id,
          value: sec.name,
          onChange: (e) => updateSec(sec.id, (s) => ({ ...s, name: e.target.value })),
          onKeyDown: (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              insertAfter(sec.id, null, [k.blank()]);
            }
          },
          placeholder: "Section name, e.g. Sauce",
          "aria-label": "Section name",
          disabled
        }
      ), sections.length > 1 && /* @__PURE__ */ React.createElement(
        "button",
        {
          className: `ra-ed-sec-remove${confirmSec === sec.id ? " confirm" : ""}`,
          onClick: () => removeSection(sec),
          onBlur: () => setConfirmSec(null),
          disabled
        },
        confirmSec === sec.id ? "Remove section?" : "Remove"
      )), /* @__PURE__ */ React.createElement("div", { className: "ra-ed-list", ref: (el) => el ? listEls.current.set(sec.id, el) : listEls.current.delete(sec.id) }, sec.items.map((it, i) => /* @__PURE__ */ React.createElement(React.Fragment, { key: it.id }, dropBefore === it.id && /* @__PURE__ */ React.createElement("div", { className: "ra-ed-drop" }), renderRow(sec, it, i + 1))), dropAt >= 0 && !dropBefore && /* @__PURE__ */ React.createElement("div", { className: "ra-ed-drop" })), /* @__PURE__ */ React.createElement("button", { className: "ra-ed-add", onClick: () => insertAfter(sec.id, null, [k.blank()]), disabled }, "+ ", k.add));
    }), /* @__PURE__ */ React.createElement("button", { className: "ra-ed-add-sec", onClick: addSection, disabled }, "+ Add section"));
  }

  // recipes/Compose.jsx
  var { useState: useState4, useRef: useRef4, useEffect: useEffect4 } = React;
  var MAX_IMAGES = 8;
  var MAX_IMAGE_SIDE = 1600;
  var emptyForm = () => ({
    name: "",
    cat: "Dinner",
    time: "",
    serves: "",
    ingredients: [blankSection("ing")],
    method: [blankSection("step")],
    notes: ""
  });
  var EMPTY_MAGIC = { images: [], link: "", text: "", loading: false, error: "" };
  var orBlank = (kind, sections) => sections.length ? sections : [blankSection(kind)];
  function toForm(r) {
    return {
      name: r.name,
      cat: r.cat,
      time: String(r.time),
      serves: String(r.serves),
      ingredients: orBlank("ing", r.ingredients),
      method: orBlank("step", r.method),
      notes: r.notes || ""
    };
  }
  function magicSections(kind, sections, flat, toItem) {
    const secs = sections || [{ name: "", items: flat || [] }];
    return orBlank(
      kind,
      secs.map((sec) => ({ id: uid(), name: sec.name || "", items: (sec.items || []).map(toItem) }))
    );
  }
  async function readImage(file) {
    const canvas = await drawScaled(file, MAX_IMAGE_SIDE);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    return { id: uid(), url: dataUrl, media: "image/jpeg", data: dataUrl.split(",")[1] };
  }
  function PhotoField({ photo, setPhoto, session, disabled }) {
    const savedUrl = usePhotoUrl(photo && photo.path, session);
    const [error, setError] = useState4("");
    const url = photo ? photo.preview || savedUrl : null;
    if (!session) {
      return /* @__PURE__ */ React.createElement("div", { className: "ra-ph ra-photo-field" }, session === null && /* @__PURE__ */ React.createElement("span", { className: "ra-photo-hint" }, /* @__PURE__ */ React.createElement("a", { href: "./" }, "Sign in"), " to add photos"));
    }
    async function pick(e) {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      setError("");
      try {
        setPhoto(await compressPhoto(file));
      } catch (err) {
        setError(err.message);
      }
    }
    return /* @__PURE__ */ React.createElement("div", { className: "ra-photo-wrap" }, /* @__PURE__ */ React.createElement("label", { className: `ra-ph ra-photo-field${disabled ? " disabled" : ""}` }, /* @__PURE__ */ React.createElement("input", { type: "file", accept: "image/*", onChange: pick, disabled }), url ? /* @__PURE__ */ React.createElement("img", { className: "ra-photo", src: url, alt: "" }) : !photo && /* @__PURE__ */ React.createElement("span", { className: "ra-photo-hint" }, "+ add photo"), photo && /* @__PURE__ */ React.createElement("span", { className: "ra-photo-change" }, "Change")), photo && !disabled && /* @__PURE__ */ React.createElement("button", { className: "ra-photo-remove", onClick: () => setPhoto(null), "aria-label": "Remove photo" }, "\u2715"), error && /* @__PURE__ */ React.createElement("p", { className: "ra-error" }, error));
  }
  function Compose({ initial, session, onCancel, onSave, onDelete }) {
    const [form, setFormState] = useState4(() => initial ? toForm(initial) : emptyForm());
    const [mode, setMode] = useState4("manual");
    const [magic, setMagicState] = useState4(EMPTY_MAGIC);
    const [fromMagic, setFromMagic] = useState4(false);
    const [confirmDelete, setConfirmDelete] = useState4(false);
    const [photo, setPhoto] = useState4(() => initial && initial.photo ? { path: initial.photo } : null);
    const [saving, setSaving] = useState4(false);
    const [saveError, setSaveError] = useState4("");
    const magicRef = useRef4(magic);
    magicRef.current = magic;
    const setForm = (k, v) => setFormState((f) => ({ ...f, [k]: v }));
    const setMagic = (p) => setMagicState((m) => ({ ...m, ...p }));
    const canSave = !!form.name.trim() && !saving;
    useEffect4(() => () => photo && photo.preview && URL.revokeObjectURL(photo.preview), [photo]);
    const hasSources = magic.images.length > 0 || !!magic.link.trim() || !!magic.text.trim();
    const canRunMagic = !!session && !magic.loading && hasSources;
    async function save() {
      if (!canSave) return;
      const oldPath = initial && initial.photo;
      let path = photo && photo.path;
      if (photo && photo.blob) {
        setSaving(true);
        setSaveError("");
        try {
          path = await uploadPhoto(session, photo.blob);
        } catch (err) {
          setSaving(false);
          setSaveError(err.message);
          return;
        }
      }
      if (oldPath && oldPath !== path) removePhoto(oldPath);
      const notes = form.notes.trim();
      onSave({
        id: initial ? initial.id : uid(),
        ...path ? { photo: path } : {},
        name: form.name.trim(),
        cat: form.cat,
        tags: initial && initial.cat === form.cat ? initial.tags : [form.cat],
        time: parseInt(form.time, 10) || 20,
        serves: parseInt(form.serves, 10) || 2,
        ingredients: cleanSections("ing", form.ingredients),
        method: cleanSections("step", form.method),
        ...notes ? { notes } : {}
      });
    }
    function addFiles(files) {
      const room = MAX_IMAGES - magicRef.current.images.length;
      [...files].filter((f) => f.type.startsWith("image/")).slice(0, Math.max(0, room)).forEach(
        (file) => readImage(file).then(
          (im) => setMagicState((m) => ({ ...m, images: [...m.images, im].slice(0, MAX_IMAGES) })),
          (err) => setMagic({ error: err.message })
        )
      );
    }
    async function runMagic() {
      if (!canRunMagic) return;
      setMagic({ loading: true, error: "" });
      try {
        const data = await callAI("recipe-import", {
          images: magic.images.map((im) => ({ media: im.media, data: im.data })),
          link: magic.link.trim(),
          text: magic.text.trim()
        });
        setFormState({
          name: data.name || "",
          cat: CATS.includes(data.cat) ? data.cat : "Dinner",
          time: data.time ? String(data.time) : "",
          serves: data.serves ? String(data.serves) : "",
          ingredients: magicSections("ing", data.ingredients, data.ings, (line) => ({ id: uid(), ...parseIng(line) })),
          method: magicSections("step", data.method, data.steps, (text) => ({ id: uid(), text })),
          notes: data.notes || ""
        });
        setMagicState(EMPTY_MAGIC);
        setFromMagic(true);
        setMode("manual");
      } catch (err) {
        setMagic({ loading: false, error: err.message || "Couldn't read a recipe from that." });
      }
    }
    return /* @__PURE__ */ React.createElement("main", { className: "ra-screen ra-slide" }, /* @__PURE__ */ React.createElement("div", { className: "ra-compose-bar" }, /* @__PURE__ */ React.createElement("button", { className: "ra-text-btn", onClick: onCancel }, "Cancel"), /* @__PURE__ */ React.createElement("button", { className: `ra-pill-btn${canSave ? " accent" : ""}`, disabled: !canSave, onClick: save }, saving ? "Saving\u2026" : "Save")), /* @__PURE__ */ React.createElement("h1", { className: "ra-title" }, initial ? "Edit recipe" : "New recipe"), saveError && /* @__PURE__ */ React.createElement("p", { className: "ra-error ra-save-error" }, saveError), /* @__PURE__ */ React.createElement("div", { className: "ra-segmented" }, /* @__PURE__ */ React.createElement("button", { className: mode === "manual" ? "on" : "", onClick: () => setMode("manual") }, "Manual"), /* @__PURE__ */ React.createElement("button", { className: mode === "magic" ? "on magic" : "", onClick: () => setMode("magic") }, "\u2726 Magic")), mode === "magic" && /* @__PURE__ */ React.createElement("div", { className: "ra-form" }, /* @__PURE__ */ React.createElement("p", { className: "ra-muted" }, "Add screenshots, photos of a cookbook page, pasted text or a link. It gets turned into a recipe you can check before saving."), /* @__PURE__ */ React.createElement("label", { className: "ra-drop" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "file",
        accept: "image/*",
        multiple: true,
        onChange: (e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }
      }
    ), /* @__PURE__ */ React.createElement("span", { className: "ra-drop-plus" }, "+"), /* @__PURE__ */ React.createElement("strong", null, "Add screenshots or photos"), /* @__PURE__ */ React.createElement("span", { className: "ra-muted sm" }, "Or paste images into the text box")), magic.images.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "ra-thumbs" }, magic.images.map((im) => /* @__PURE__ */ React.createElement("div", { key: im.id, className: "ra-thumb" }, /* @__PURE__ */ React.createElement("img", { src: im.url, alt: "" }), /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => setMagicState((m) => ({ ...m, images: m.images.filter((x) => x.id !== im.id) })),
        "aria-label": "Remove image"
      },
      "\u2715"
    )))), /* @__PURE__ */ React.createElement(
      "input",
      {
        className: "ra-field",
        value: magic.link,
        onChange: (e) => setMagic({ link: e.target.value }),
        placeholder: "Paste a recipe link",
        inputMode: "url"
      }
    ), /* @__PURE__ */ React.createElement(
      "textarea",
      {
        className: "ra-field",
        value: magic.text,
        onChange: (e) => setMagic({ text: e.target.value }),
        onPaste: (e) => {
          const fl = e.clipboardData && e.clipboardData.files;
          if (fl && fl.length) {
            e.preventDefault();
            addFiles(fl);
          }
        },
        rows: 6,
        placeholder: "Paste recipe text, notes, anything"
      }
    ), magic.error && /* @__PURE__ */ React.createElement("p", { className: "ra-error" }, magic.error), session === null && /* @__PURE__ */ React.createElement("p", { className: "ra-muted sm" }, /* @__PURE__ */ React.createElement("a", { href: "./" }, "Sign in on the home page"), " to use Magic."), /* @__PURE__ */ React.createElement("button", { className: `ra-big-btn${canRunMagic ? " accent" : ""}`, disabled: !canRunMagic, onClick: runMagic }, magic.loading ? "Reading your recipe\u2026" : "\u2726 Create recipe")), mode === "manual" && /* @__PURE__ */ React.createElement("div", { className: "ra-form" }, fromMagic && /* @__PURE__ */ React.createElement("div", { className: "ra-notice" }, "Draft filled in from your sources. Check it over, then save."), /* @__PURE__ */ React.createElement(PhotoField, { photo, setPhoto, session, disabled: saving }), /* @__PURE__ */ React.createElement("label", { className: "ra-label" }, "Name", /* @__PURE__ */ React.createElement(
      "input",
      {
        className: "ra-field",
        value: form.name,
        onChange: (e) => setForm("name", e.target.value),
        placeholder: "e.g. Roasted veggie traybake"
      }
    )), /* @__PURE__ */ React.createElement("div", { className: "ra-label" }, "Meal", /* @__PURE__ */ React.createElement("div", { className: "ra-chips tight" }, CATS.map((c) => /* @__PURE__ */ React.createElement("button", { key: c, className: `ra-chip sm${form.cat === c ? " on" : ""}`, onClick: () => setForm("cat", c) }, c)))), /* @__PURE__ */ React.createElement("div", { className: "ra-two" }, /* @__PURE__ */ React.createElement("label", { className: "ra-label" }, "Time (min)", /* @__PURE__ */ React.createElement("input", { className: "ra-field", value: form.time, onChange: (e) => setForm("time", e.target.value), inputMode: "numeric", placeholder: "30" })), /* @__PURE__ */ React.createElement("label", { className: "ra-label" }, "Serves", /* @__PURE__ */ React.createElement("input", { className: "ra-field", value: form.serves, onChange: (e) => setForm("serves", e.target.value), inputMode: "numeric", placeholder: "2" }))), /* @__PURE__ */ React.createElement("div", { className: "ra-label" }, "Ingredients", /* @__PURE__ */ React.createElement(
      SectionEditor,
      {
        kind: "ing",
        sections: form.ingredients,
        setSections: (fn) => setFormState((f) => ({ ...f, ingredients: fn(f.ingredients) })),
        disabled: saving
      }
    )), /* @__PURE__ */ React.createElement("div", { className: "ra-label" }, "Method", /* @__PURE__ */ React.createElement(
      SectionEditor,
      {
        kind: "step",
        sections: form.method,
        setSections: (fn) => setFormState((f) => ({ ...f, method: fn(f.method) })),
        disabled: saving
      }
    )), /* @__PURE__ */ React.createElement("label", { className: "ra-label" }, "Notes", /* @__PURE__ */ React.createElement(
      "textarea",
      {
        className: "ra-field",
        value: form.notes,
        onChange: (e) => setForm("notes", e.target.value),
        rows: 4,
        placeholder: "Tips, substitutions, what to change next time\u2026",
        disabled: saving
      }
    )), initial && /* @__PURE__ */ React.createElement(
      "button",
      {
        className: `ra-delete${confirmDelete ? " confirm" : ""}`,
        onClick: () => confirmDelete ? onDelete(initial.id) : setConfirmDelete(true),
        onBlur: () => setConfirmDelete(false)
      },
      confirmDelete ? "Tap again to delete" : "Delete recipe"
    )));
  }

  // recipes/merge.js
  function mergeRequest(items, addedIds) {
    const added = new Set(addedIds);
    const row = (i) => ({ id: i.id, q: i.q || "", name: i.name });
    const todo = items.filter((i) => !i.checked);
    return {
      list: todo.filter((i) => !added.has(i.id)).map(row),
      add: todo.filter((i) => added.has(i.id)).map(row)
    };
  }
  function applyMerges(items, groups, sent) {
    const sentById = new Map([...sent.list, ...sent.add].map((r) => [r.id, r]));
    const addIds = new Set(sent.add.map((r) => r.id));
    const byId = new Map(items.map((i) => [i.id, i]));
    const unchanged = (id) => {
      const i = byId.get(id);
      const r = sentById.get(id);
      return i && r && !i.checked && i.name === r.name && (i.q || "") === r.q;
    };
    const drop = /* @__PURE__ */ new Set();
    const update2 = /* @__PURE__ */ new Map();
    const merged = [];
    for (const g of groups || []) {
      const ids = [...new Set((g.merge || []).filter((id) => id !== g.keep))];
      if (!ids.length || !unchanged(g.keep) || drop.has(g.keep) || update2.has(g.keep)) continue;
      if (!ids.every((id) => addIds.has(id) && unchanged(id) && !drop.has(id) && !update2.has(id))) continue;
      const keep = byId.get(g.keep);
      const src = [...new Set([keep, ...ids.map((id) => byId.get(id))].flatMap((i) => i.src || []))];
      update2.set(g.keep, { ...keep, q: typeof g.q === "string" ? g.q.trim() : keep.q, src });
      ids.forEach((id) => drop.add(id));
      merged.push({ name: keep.name, q: update2.get(g.keep).q });
    }
    return {
      items: items.filter((i) => !drop.has(i.id)).map((i) => update2.get(i.id) || i),
      merged
    };
  }

  // recipes/App.jsx
  var { useState: useState5, useEffect: useEffect5, useRef: useRef5, useMemo } = React;
  var APP_ID = "recipes";
  var DEFAULT_LISTS = [{ id: "default", name: "Groceries", items: [] }];
  var NO_RECIPES = [];
  var ACTIVE_KEY = "recipes-active-list";
  function readActive() {
    try {
      return localStorage.getItem(ACTIVE_KEY);
    } catch {
      return null;
    }
  }
  function RecipesApp() {
    const session = useSession();
    const [lists, setLists, listsConflict] = useSyncedStorage(APP_ID, "recipes-lists", DEFAULT_LISTS);
    const [storedRecipes, setRecipes, recipesConflict] = useSyncedStorage(APP_ID, "recipes-recipes", NO_RECIPES);
    const recipes = useMemo(() => storedRecipes.map(normRecipe), [storedRecipes]);
    const [activeId, setActiveIdState] = useState5(readActive);
    const [tab, setTab] = useState5("list");
    const [recipeId, setRecipeId] = useState5(null);
    const [compose, setCompose] = useState5(null);
    const [query, setQuery] = useState5("");
    const [cat, setCat] = useState5("All");
    const [servings, setServings] = useState5({});
    const [prices, setPrices] = useState5({});
    const [storedTier, setTier] = useSyncedStorage(APP_ID, "recipes-price-tier", "normal");
    const tier = PRICE_TIERS.some((t) => t.id === storedTier) ? storedTier : "normal";
    const [timers, setTimers] = useState5({});
    const [, setNow] = useState5(0);
    const [toast, setToast] = useState5(null);
    const toastT = useRef5(null);
    const timersRef = useRef5(timers);
    timersRef.current = timers;
    const [mergeJobs, setMergeJobs] = useState5([]);
    const merging = useRef5(false);
    const listsRef = useRef5(lists);
    listsRef.current = lists;
    const list = lists.find((l) => l.id === activeId) || lists[0];
    const recipe = recipes.find((r) => r.id === recipeId);
    function setActive(id) {
      setActiveIdState(id);
      try {
        localStorage.setItem(ACTIVE_KEY, id);
      } catch {
      }
    }
    function showToast(msg) {
      clearTimeout(toastT.current);
      setToast(msg);
      toastT.current = setTimeout(() => setToast(null), 2200);
    }
    const updateItems = (listId, fn) => setLists((ls) => ls.map((l) => l.id === listId ? { ...l, items: fn(l.items) } : l));
    const queueMerge = (listId, ids) => {
      if (session) setMergeJobs((js) => [...js, { listId, ids }]);
    };
    function addToList(ings) {
      const have = new Set(list.items.filter((i) => !i.checked).flatMap((i) => i.src || []));
      const add = ings.filter((g) => !have.has(g.src));
      if (!add.length) return;
      const rows = add.map((g) => ({ id: uid(), name: g.n, q: g.q, checked: false, src: [g.src] }));
      const names = new Set(add.map((g) => g.n.toLowerCase()));
      updateItems(list.id, (items) => [
        ...items.filter((i) => !i.checked),
        ...rows,
        ...items.filter((i) => i.checked && !names.has(i.name.toLowerCase()))
      ]);
      queueMerge(list.id, rows.map((r) => r.id));
      showToast(add.length === 1 ? `Added ${add[0].n} to ${list.name}` : `Added ${plural(add.length, "item")} to ${list.name}`);
    }
    useEffect5(() => {
      if (merging.current || !mergeJobs.length) return;
      const job = mergeJobs[0];
      const target = lists.find((l) => l.id === job.listId);
      const sent = target && mergeRequest(target.items, job.ids);
      const next = () => {
        merging.current = false;
        setMergeJobs((js) => js.slice(1));
      };
      if (!sent || !sent.add.length || !sent.list.length && sent.add.length < 2) return next();
      merging.current = true;
      callAI("shopping-merge", sent).then(({ groups }) => {
        const cur = listsRef.current.find((l) => l.id === job.listId);
        if (!cur) return;
        const { merged } = applyMerges(cur.items, groups, sent);
        if (!merged.length) return;
        updateItems(job.listId, (items) => applyMerges(items, groups, sent).items);
        const [m] = merged;
        showToast(
          merged.length === 1 ? `${m.name} was already on ${cur.name}${m.q ? ` \xB7 now ${m.q}` : ""}` : `Combined ${plural(merged.length, "item")} already on ${cur.name}`
        );
      }).catch(() => {
      }).finally(next);
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
    const anyRunning = Object.values(timers).some((x) => x.running);
    useEffect5(() => {
      if (!anyRunning) return;
      const t = setInterval(() => {
        const now = Date.now();
        setNow(now);
        const ts = timersRef.current;
        const finished = Object.keys(ts).filter((k) => ts[k].running && ts[k].endAt <= now);
        if (!finished.length) return;
        finished.forEach((k) => setTimer(k, (o) => o && { ...o, running: false, left: 0, done: true }));
        showToast(`Timer done \xB7 ${ts[finished[0]].label}`);
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      }, 500);
      return () => clearInterval(t);
    }, [anyRunning]);
    function saveRecipe(r) {
      const exists = recipes.some((x) => x.id === r.id);
      setRecipes((rs) => exists ? rs.map((x) => x.id === r.id ? r : x) : [r, ...rs]);
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
      if (k === "book" && tab === "book") {
        setRecipeId(null);
        setCompose(null);
      }
      setTab(k);
    }
    const conflict = listsConflict || recipesConflict;
    let screen;
    if (tab === "list") {
      screen = /* @__PURE__ */ React.createElement(
        ListTab,
        {
          lists,
          list,
          setActive,
          setLists,
          updateItems,
          queueMerge,
          showToast,
          session,
          price: prices[`list:${list.id}`],
          setPrice: (fn) => setPrices((ps) => ({ ...ps, [`list:${list.id}`]: fn(ps[`list:${list.id}`]) })),
          tier,
          setTier
        }
      );
    } else if (compose) {
      screen = /* @__PURE__ */ React.createElement(
        Compose,
        {
          key: compose.recipe ? compose.recipe.id : "new",
          initial: compose.recipe,
          session,
          onCancel: () => setCompose(null),
          onSave: saveRecipe,
          onDelete: deleteRecipe
        }
      );
    } else if (recipe) {
      screen = /* @__PURE__ */ React.createElement(
        RecipeDetail,
        {
          key: recipe.id,
          recipe,
          session,
          list,
          servings: servings[recipe.id],
          setServings: (n) => setServings((s) => ({ ...s, [recipe.id]: n })),
          price: prices[recipe.id],
          setPrice: (fn) => setPrices((ps) => ({ ...ps, [recipe.id]: fn(ps[recipe.id]) })),
          tier,
          setTier,
          timers,
          setTimer,
          onBack: () => setRecipeId(null),
          onEdit: () => setCompose({ recipe }),
          addToList
        }
      );
    } else {
      screen = /* @__PURE__ */ React.createElement(
        Notebook,
        {
          recipes,
          session,
          query,
          setQuery,
          cat,
          setCat,
          openRecipe: setRecipeId,
          openCompose: () => setCompose({ recipe: null })
        }
      );
    }
    return /* @__PURE__ */ React.createElement("div", { className: "ra" }, conflict && /* @__PURE__ */ React.createElement("div", { className: "ra-conflict", role: "alert" }, /* @__PURE__ */ React.createElement("span", null, "Your ", listsConflict ? "lists" : "recipes", " changed on another device."), /* @__PURE__ */ React.createElement("button", { onClick: conflict.keepRemote }, "Use theirs"), /* @__PURE__ */ React.createElement("button", { onClick: conflict.keepLocal }, "Keep mine")), screen, toast && /* @__PURE__ */ React.createElement("div", { className: "ra-toast", role: "status" }, toast), /* @__PURE__ */ React.createElement("nav", { className: "ra-nav" }, [["list", "List"], ["book", "Notebook"]].map(([k, label]) => /* @__PURE__ */ React.createElement("button", { key: k, className: tab === k ? "on" : "", onClick: () => switchTab(k), "aria-current": tab === k ? "page" : void 0 }, /* @__PURE__ */ React.createElement("span", { className: "ra-nav-dot" }), label))));
  }

  // recipes-app.jsx
  ReactDOM.createRoot(document.getElementById("app")).render(/* @__PURE__ */ React.createElement(RecipesApp, null));
})();
