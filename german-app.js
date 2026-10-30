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
    const text2 = await res.text();
    return text2 ? JSON.parse(text2) : null;
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
    const { useState: useState12, useEffect: useEffect9 } = React;
    const [session, setSession] = useState12(current);
    useEffect9(() => {
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
  async function signOut() {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch (error) {
      return { error };
    }
    set(null);
    return { error: null };
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

  // german/fsrs.js
  var W = [
    0.40255,
    1.18385,
    3.173,
    15.69105,
    7.1949,
    0.5345,
    1.4604,
    46e-4,
    1.54575,
    0.1192,
    1.01925,
    1.9395,
    0.11,
    0.29605,
    2.2698,
    0.2315,
    2.9898,
    0.51655,
    0.6621
  ];
  var DECAY = -0.5;
  var FACTOR = 19 / 81;
  var RETENTION = 0.9;
  var MAX_DAYS = 365 * 5;
  var MIN = 60 * 1e3;
  var DAY = 24 * 60 * MIN;
  var LEARN_STEPS = [1 * MIN, 10 * MIN];
  var RELEARN_STEPS = [10 * MIN];
  var RATINGS = { again: 1, hard: 2, good: 3, easy: 4 };
  var clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  function initStability(g) {
    return Math.max(W[g - 1], 0.1);
  }
  function initDifficulty(g) {
    return clamp(W[4] - Math.exp(W[5] * (g - 1)) + 1, 1, 10);
  }
  function nextDifficulty(d, g) {
    const delta = -W[6] * (g - 3);
    const d1 = d + delta * ((10 - d) / 9);
    return clamp(W[7] * initDifficulty(4) + (1 - W[7]) * d1, 1, 10);
  }
  function retrievability(elapsedDays, s) {
    return Math.pow(1 + FACTOR * elapsedDays / s, DECAY);
  }
  function recallStability(d, s, r, g) {
    const hard = g === 2 ? W[15] : 1;
    const easy = g === 4 ? W[16] : 1;
    return s * (1 + Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * (Math.exp(W[10] * (1 - r)) - 1) * hard * easy);
  }
  function forgetStability(d, s, r) {
    const sf = W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r));
    return Math.min(sf, s);
  }
  function shortTermStability(s, g) {
    return s * Math.exp(W[17] * (g - 3 + W[18]));
  }
  function intervalDays(s) {
    const days = s / FACTOR * (Math.pow(RETENTION, 1 / DECAY) - 1);
    return clamp(Math.round(days), 1, MAX_DAYS);
  }
  function reviewIntervals(s, d, r, g, prevInterval) {
    const iv = {
      2: intervalDays(recallStability(d, s, r, 2)),
      3: intervalDays(recallStability(d, s, r, 3)),
      4: intervalDays(recallStability(d, s, r, 4))
    };
    iv[2] = Math.min(iv[2], Math.max(prevInterval, 1));
    iv[3] = Math.max(iv[3], iv[2] + 1);
    iv[4] = Math.max(iv[4], iv[3] + 1);
    return iv[g];
  }
  function review(srs, g, now = Date.now()) {
    var _a;
    if (!srs) {
      const s2 = initStability(g);
      const d2 = initDifficulty(g);
      const base = { stability: s2, difficulty: d2, reps: 1, lapses: 0, last: now };
      if (g === 4) return { ...base, state: "review", step: 0, due: now + intervalDays(s2) * DAY };
      const step = g === 3 ? 1 : 0;
      const wait = g === 2 ? (LEARN_STEPS[0] + LEARN_STEPS[1]) / 2 : LEARN_STEPS[step];
      return { ...base, state: "learning", step, due: now + wait };
    }
    const elapsed = Math.max(0, (now - srs.last) / DAY);
    const r = retrievability(elapsed, srs.stability);
    const reps = srs.reps + 1;
    const d = nextDifficulty(srs.difficulty, g);
    if (srs.state === "learning" || srs.state === "relearning") {
      const steps = srs.state === "learning" ? LEARN_STEPS : RELEARN_STEPS;
      const s2 = shortTermStability(srs.stability, g);
      const base = { ...srs, stability: s2, difficulty: d, reps, last: now };
      if (g === 1) return { ...base, step: 0, due: now + steps[0] };
      if (g === 2) return { ...base, due: now + ((_a = steps[srs.step]) != null ? _a : steps[steps.length - 1]) };
      const next = srs.step + 1;
      if (g === 3 && next < steps.length) return { ...base, step: next, due: now + steps[next] };
      const days2 = g === 4 ? Math.max(intervalDays(s2), 2) : intervalDays(s2);
      return { ...base, state: "review", step: 0, due: now + days2 * DAY };
    }
    if (g === 1) {
      const s2 = forgetStability(srs.difficulty, srs.stability, r);
      return { ...srs, state: "relearning", step: 0, stability: s2, difficulty: d, reps, lapses: srs.lapses + 1, last: now, due: now + RELEARN_STEPS[0] };
    }
    const s = recallStability(srs.difficulty, srs.stability, r, g);
    const prev = Math.round((srs.due - srs.last) / DAY);
    const days = reviewIntervals(srs.stability, srs.difficulty, r, g, prev);
    return { ...srs, state: "review", step: 0, stability: s, difficulty: d, reps, last: now, due: now + days * DAY };
  }
  function previews(srs, now = Date.now()) {
    const out = {};
    for (const [name, g] of Object.entries(RATINGS)) out[name] = formatWait(review(srs, g, now).due - now);
    return out;
  }
  function formatWait(ms) {
    if (ms < 60 * MIN) return `${Math.max(1, Math.round(ms / MIN))}m`;
    if (ms < DAY) return `${Math.round(ms / (60 * MIN))}h`;
    const days = Math.round(ms / DAY);
    if (days < 31) return `${days}d`;
    if (days < 365) return `${Math.round(days / 30)}mo`;
    return `${(days / 365).toFixed(1).replace(/\.0$/, "")}y`;
  }

  // german/grammar.js
  var POINTS = [
    {
      id: "v2",
      level: "A1.2",
      label: "Verb second after time words",
      hint: "Start one sentence with a time word, then the verb.",
      model: "Gestern bin ich \u2026",
      rule: { q: "A sentence starts with \u201CGestern\u201D. Where does the verb go?", a: "Second \u2014 right after the first part: Gestern bin ich \u2026" }
    },
    {
      id: "perfekt",
      level: "A2.1",
      label: "Perfekt with haben / sein",
      hint: "Tell what you did in the Perfekt; movement and change take sein.",
      model: "Ich bin gefahren, ich habe gegessen.",
      rule: { q: "Perfekt: when do you use sein instead of haben?", a: "With movement or change of state (gehen, fahren, werden, bleiben): Ich bin gefahren." }
    },
    {
      id: "weil",
      level: "A2.1",
      label: "weil \u2192 verb at the end",
      hint: "Try weil once: the verb goes to the end.",
      model: "\u2026, weil ich m\xFCde war.",
      rule: { q: "After \u201Cweil\u201D, where does the verb go?", a: "To the very end: \u2026, weil ich frei hatte." }
    },
    {
      id: "dativ-praep",
      level: "A2.1",
      label: "mit, bei, nach, von, zu, aus + Dativ",
      hint: "Use mit, bei or nach once \u2014 they always take the dative.",
      model: "mit meinen Freunden",
      rule: { q: "Which case comes after mit, bei, nach, von, zu, aus, seit?", a: "Always the dative: mit dem Zug, mit meinen Freunden." }
    },
    {
      id: "modal",
      level: "A2.1",
      label: "Modal verb \u2192 infinitive at the end",
      hint: "Use k\xF6nnen, m\xFCssen or wollen; the second verb goes to the end.",
      model: "Ich muss morgen fr\xFCh aufstehen.",
      rule: { q: "With a modal verb (k\xF6nnen, m\xFCssen, \u2026), where does the other verb go?", a: "Infinitive at the end: Ich muss heute lernen." }
    },
    {
      id: "trennbar",
      level: "A2.1",
      label: "Separable verbs",
      hint: "Use a separable verb (ankommen, einkaufen); the prefix goes to the end.",
      model: "Der Zug kommt um acht an.",
      rule: { q: "Separable verb in a main clause: where does the prefix go?", a: "To the end: Ich kaufe heute ein. (Perfekt: eingekauft)" }
    },
    {
      id: "wechsel",
      level: "A2.2",
      label: "in, an, auf: Akkusativ or Dativ",
      hint: "Say where something is (Dativ) and where it goes (Akkusativ).",
      model: "Ich gehe in die Halle. Ich bin in der Halle.",
      rule: { q: "in / an / auf: when Akkusativ, when Dativ?", a: "Wohin? (movement) \u2192 Akkusativ: in die Stadt. Wo? (place) \u2192 Dativ: in der Stadt." }
    },
    {
      id: "dass",
      level: "A2.2",
      label: "dass, wenn, ob \u2192 verb at the end",
      hint: "Use dass or wenn once; the verb goes to the end.",
      model: "Ich glaube, dass es morgen regnet.",
      rule: { q: "After \u201Cdass\u201D, \u201Cwenn\u201D or \u201Cob\u201D, where does the verb go?", a: "To the end, like after weil: \u2026, dass es regnet." }
    },
    {
      id: "praeteritum",
      level: "A2.2",
      label: "Pr\xE4teritum of sein, haben, modals",
      hint: "Use war, hatte or konnte once.",
      model: "Gestern war ich m\xFCde.",
      rule: { q: "Past of sein, haben and modal verbs in speech?", a: "Pr\xE4teritum: war, hatte, konnte, musste \u2014 not \u201Cbin gewesen\u201D." }
    },
    {
      id: "adj",
      level: "A2.2",
      label: "Adjective endings",
      hint: "Describe something with an adjective before a noun.",
      model: "ein sch\xF6ner Tag, mit dem neuen Rad",
      rule: { q: "Adjective after \u201Cein\u201D / \u201Cdem\u201D: which ending?", a: "ein sch\xF6ner Tag (Nom. m.), mit dem neuen Rad (Dativ \u2192 -en)." }
    },
    {
      id: "komparativ",
      level: "A2.2",
      label: "Comparing: -er als, am -sten",
      hint: "Compare two things once.",
      model: "Der Zug ist schneller als der Bus.",
      rule: { q: "How do you compare two things?", a: "Adjective + -er + als: schneller als; the most: am schnellsten." }
    },
    {
      id: "reflexiv",
      level: "B1.1",
      label: "Reflexive verbs",
      hint: "Use a reflexive verb (sich freuen, sich treffen).",
      model: "Ich freue mich auf das Wochenende.",
      rule: { q: "sich freuen: which pronoun goes with \u201Cich\u201D?", a: "mich: Ich freue mich. (du \u2192 dich, wir \u2192 uns)" }
    },
    {
      id: "zu-inf",
      level: "B1.1",
      label: "zu + infinitive",
      hint: "Use a zu + infinitive phrase (Ich habe keine Zeit, \u2026 zu \u2026).",
      model: "Ich habe keine Lust, heute zu kochen.",
      rule: { q: "\u201CIch habe keine Lust, \u2026 (kochen)\u201D \u2014 how does it end?", a: "With zu + infinitive at the end: \u2026, heute zu kochen." }
    },
    {
      id: "relativ",
      level: "B1.1",
      label: "Relative clauses",
      hint: "Describe a person or thing with der/die/das + verb at the end.",
      model: "Das ist der Kurs, der mir hilft.",
      rule: { q: "Relative clause: which word starts it and where does the verb go?", a: "der/die/das (matching the noun), verb at the end: der Kurs, der mir hilft." }
    },
    {
      id: "konjunktiv",
      level: "B1.2",
      label: "w\xFCrde, h\xE4tte, w\xE4re",
      hint: "Say what you would do: w\xFCrde / h\xE4tte / w\xE4re.",
      model: "Wenn ich Zeit h\xE4tte, w\xFCrde ich mehr klettern.",
      rule: { q: "How do you say what you would do or would have?", a: "w\xFCrde + infinitive, h\xE4tte, w\xE4re: Ich w\xFCrde gern reisen." }
    }
  ];
  var POINT_IDS = POINTS.map((p) => p.id);
  var pointById = (id) => POINTS.find((p) => p.id === id) || null;
  function pointLabel(id) {
    var _a;
    return ((_a = pointById(id)) == null ? void 0 : _a.label) || "Other";
  }

  // german/model.js
  var APP_ID = "german";
  var KEYS = {
    cards: "german-cards",
    suggest: "german-suggest",
    writing: "german-writing",
    draft: "german-draft",
    log: "german-log",
    listening: "german-listening",
    podcast: "german-podcast",
    episodes: "german-episodes",
    settings: "german-settings"
  };
  var LEVELS = ["A1.1", "A1.2", "A2.1", "A2.2", "B1.1", "B1.2", "B2.1", "B2.2"];
  var WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  var ARTICLES = ["der", "die", "das"];
  var PODCAST_PACES = ["slowest", "slower", "natural"];
  var DEFAULT_SETTINGS = {
    level: "A2.2",
    topics: ["Uni / ETH", "Klettern", "Kochen", "Bahn"],
    writingDays: [1, 3],
    // Di, Do
    podcastDays: [0, 2, 4],
    // Mo, Mi, Fr
    podcastPace: "slower",
    // how fast the podcast hosts speak: one of PODCAST_PACES
    newPerDay: 6
  };
  var DEFAULT_LISTENING = {
    resources: [
      { id: "nicos-weg", name: "Nicos Weg", desc: "DW \xB7 video series with exercises", level: "A1\u2013B1", url: "https://learngerman.dw.com/de/nicos-weg/c-36519789" },
      { id: "lgn", name: "Langsam gesprochene Nachrichten", desc: "DW \xB7 short daily news, read slowly", level: "B1", url: "https://learngerman.dw.com/de/langsam-gesprochene-nachrichten/s-60040332" },
      { id: "easy-german", name: "Easy German", desc: "Street interviews + podcast", level: "A2\u2013B2", url: "https://www.youtube.com/@EasyGerman" }
    ],
    current: "nicos-weg",
    log: []
  };
  var SESSION_MINUTES = 15;
  var SECONDS_PER_CARD = 15;
  var SESSION_CAP = Math.round(SESSION_MINUTES * 60 / SECONDS_PER_CARD);
  var SUGGEST_BUFFER = 10;
  var JUMP_AFTER = 3;
  var DAY_MS = 24 * 60 * 60 * 1e3;
  var ROLLOVER_HOURS = 4;
  var uid = () => Math.random().toString(36).slice(2, 10);
  var pad = (n) => String(n).padStart(2, "0");
  var localKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  function dayKey(now = Date.now()) {
    return localKey(new Date(now - ROLLOVER_HOURS * 3600 * 1e3));
  }
  function addDays(key, n) {
    const [y, m, d] = key.split("-").map(Number);
    return localKey(new Date(y, m - 1, d + n));
  }
  function weekdayOf(key) {
    const [y, m, d] = key.split("-").map(Number);
    return (new Date(y, m - 1, d).getDay() + 6) % 7;
  }
  function dayEnd(key) {
    const [y, m, d] = addDays(key, 1).split("-").map(Number);
    return new Date(y, m - 1, d, ROLLOVER_HOURS).getTime();
  }
  function weekKeys(key) {
    const monday = addDays(key, -weekdayOf(key));
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  }
  function normSettings(s) {
    const v = { ...DEFAULT_SETTINGS, ...s || {} };
    return {
      level: LEVELS.includes(v.level) ? v.level : DEFAULT_SETTINGS.level,
      topics: Array.isArray(v.topics) ? v.topics.filter((t) => typeof t === "string" && t.trim()) : [],
      writingDays: Array.isArray(v.writingDays) ? v.writingDays.filter((d) => d >= 0 && d < 7) : [],
      podcastDays: Array.isArray(v.podcastDays) ? v.podcastDays.filter((d) => d >= 0 && d < 7) : [],
      podcastPace: PODCAST_PACES.includes(v.podcastPace) ? v.podcastPace : "slower",
      newPerDay: Math.min(30, Math.max(0, Math.round(Number(v.newPerDay) || 0)))
    };
  }
  var levelIndex = (l) => Math.max(0, LEVELS.indexOf(l));
  function tasksFor(key, settings) {
    const wd2 = weekdayOf(key);
    const tasks = [];
    if (wd2 < 5) tasks.push("cards");
    if (settings.writingDays.includes(wd2)) tasks.push("writing");
    if (settings.podcastDays.includes(wd2)) tasks.push("podcast");
    return tasks;
  }
  function doneTasks(log, key) {
    const day = log[key] || {};
    return ["cards", "writing", "podcast"].filter((t) => day[t]);
  }
  var text = (v) => typeof v === "string" ? v.trim() : "";
  function makeCard(fields, source2, now = Date.now()) {
    const kind = ["noun", "verb", "word", "gap", "rule"].includes(fields.kind) ? fields.kind : "word";
    const card = { id: uid(), kind, en: text(fields.en), de: text(fields.de), source: source2, added: now, intro: null, srs: null };
    if (kind === "noun") {
      card.article = ARTICLES.includes(fields.article) ? fields.article : "der";
      card.plural = text(fields.plural);
    }
    if (kind === "verb") {
      card.perfekt = text(fields.perfekt);
      card.separable = !!fields.separable;
    }
    if (kind === "gap") {
      card.text = text(fields.text);
      card.answer = text(fields.answer);
    }
    if (kind === "gap" || kind === "rule") card.point = fields.point || null;
    if (kind === "rule") card.examples = Array.isArray(fields.examples) ? fields.examples.filter(Boolean) : [];
    if (fields.writing) card.writing = fields.writing;
    const example = text(fields.example);
    if (example) card.example = example;
    return card;
  }
  var isNew = (c) => !c.srs;
  function germanOf(c) {
    var _a;
    if (c.kind === "noun") return `${c.article} ${c.de}`;
    if (c.kind === "gap") return c.text.replace("___", c.answer);
    if (c.kind === "rule") return ((_a = pointById(c.point)) == null ? void 0 : _a.label) || c.de;
    return c.de;
  }
  var fold = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
  function findDuplicate(cards, fields) {
    const de = fold(text(fields.de));
    if (!de || fields.kind === "gap" || fields.kind === "rule") return null;
    return cards.find((c) => c.kind !== "gap" && c.kind !== "rule" && fold(c.de) === de) || null;
  }
  function searchCards(cards, query, filter = "all", now = Date.now()) {
    const q = fold(query.trim());
    return cards.filter((c) => {
      if (filter === "nouns" && c.kind !== "noun") return false;
      if (filter === "verbs" && c.kind !== "verb") return false;
      if (filter === "grammar" && c.kind !== "gap" && c.kind !== "rule") return false;
      if (filter === "hard" && !(c.srs && (c.srs.lapses >= 2 || c.srs.difficulty >= 7.5))) return false;
      if (!q) return true;
      return [c.de, c.en, c.plural, c.example, c.text, c.answer, germanOf(c)].some((v) => v && fold(v).includes(q));
    });
  }
  function newOrder(a, b) {
    const rank = (c) => c.source === "ai" ? 1 : 0;
    return rank(a) - rank(b) || a.added - b.added;
  }
  function planSession(cards, suggestions, settings, key, now = Date.now()) {
    const end = dayEnd(key);
    const due = cards.filter((c) => c.srs && c.srs.due < end).sort((a, b) => a.srs.due - b.srs.due);
    const reviews = due.slice(0, SESSION_CAP);
    const leftover = due.length - reviews.length;
    const introducedToday = cards.filter((c) => c.intro === key).length;
    let slots = leftover > 0 ? 0 : Math.min(settings.newPerDay - introducedToday, SESSION_CAP - reviews.length);
    slots = Math.max(0, slots);
    const fresh = cards.filter(isNew).sort(newOrder).slice(0, slots);
    const fromSuggestions = Math.min(slots - fresh.length, suggestions.length);
    return { reviews: reviews.map((c) => c.id), fresh: fresh.map((c) => c.id), fromSuggestions, leftover };
  }
  function sessionMinutes(count) {
    return Math.max(1, Math.round(count * SECONDS_PER_CARD / 60));
  }
  function answerCard(card, grade, key, now = Date.now()) {
    return { ...card, srs: review(card.srs, grade, now), intro: card.intro || key };
  }
  function fixCounts(writing) {
    const counts = {};
    writing.forEach((s) => s.fixes.forEach((f) => {
      if (f.point && f.point !== "other") counts[f.point] = (counts[f.point] || 0) + 1;
    }));
    return Object.entries(counts).map(([point, count]) => ({ point, count })).sort((a, b) => b.count - a.count);
  }
  function nextFocus(writing, level) {
    const eligible = POINTS.filter((p) => levelIndex(p.level) <= levelIndex(level)).map((p) => p.id);
    const pool = eligible.length ? eligible : [POINT_IDS[0]];
    const since = {};
    const seenFocus = /* @__PURE__ */ new Set();
    for (const s of writing) {
      s.fixes.forEach((f) => {
        if (pool.includes(f.point) && !seenFocus.has(f.point)) since[f.point] = (since[f.point] || 0) + 1;
      });
      if (s.focus) seenFocus.add(s.focus);
    }
    const jump = Object.entries(since).filter(([, n]) => n >= JUMP_AFTER).sort((a, b) => b[1] - a[1])[0];
    if (jump) return jump[0];
    const last = writing.find((s) => s.focus && pool.includes(s.focus));
    if (!last) return pool[0];
    return pool[(pool.indexOf(last.focus) + 1) % pool.length];
  }
  function sentenceCount(t) {
    return (t.match(/[^.!?…]+[.!?…]+/g) || []).length + (/[^\s.!?…]\s*$/.test(t.trim()) ? 1 : 0);
  }
  function cardsFromCheck(cards, session, now = Date.now()) {
    var _a;
    let deck = cards;
    const made = [];
    for (const f of session.fixes) {
      if (!f.gap || !f.gap.text.includes("___")) continue;
      const card = makeCard({ kind: "gap", en: f.gap.en, de: f.to, text: f.gap.text, answer: f.gap.answer, point: f.point, writing: session.id }, "writing", now);
      deck = [card, ...deck];
      made.push({ type: "gap", id: card.id, label: card.text });
    }
    const points = [...new Set(session.fixes.map((f) => f.point).filter((p) => pointById(p)))];
    for (const point of points) {
      const p = pointById(point);
      const sentence = ((_a = session.fixes.find((f) => f.point === point)) == null ? void 0 : _a.sentence) || "";
      const existing = deck.find((c) => c.kind === "rule" && c.point === point);
      if (existing) {
        const examples = sentence && !existing.examples.includes(sentence) ? [sentence, ...existing.examples].slice(0, 5) : existing.examples;
        deck = deck.map((c) => c.id === existing.id ? { ...c, examples, srs: resetSrs(c.srs, now) } : c);
        made.push({ type: "rule", id: existing.id, label: p.label, repeat: true });
      } else {
        const card = makeCard({ kind: "rule", en: p.rule.q, de: p.rule.a, point, examples: sentence ? [sentence] : [], writing: session.id }, "writing", now);
        deck = [card, ...deck];
        made.push({ type: "rule", id: card.id, label: p.label, repeat: false });
      }
    }
    return { cards: deck, made };
  }
  function resetSrs(srs, now) {
    if (!srs) return null;
    return { ...srs, state: "relearning", step: 0, due: now, stability: Math.min(srs.stability, 1), lapses: srs.lapses + 1 };
  }
  function normListening(l) {
    var _a;
    const v = { ...DEFAULT_LISTENING, ...l || {} };
    const resources = Array.isArray(v.resources) ? v.resources : [];
    return {
      resources,
      current: resources.some((r) => r.id === v.current) ? v.current : ((_a = resources[0]) == null ? void 0 : _a.id) || null,
      log: Array.isArray(v.log) ? v.log : []
    };
  }
  function minutesIn(log, keys) {
    const set2 = new Set(keys);
    return log.filter((e) => set2.has(e.day)).reduce((n, e) => n + e.min, 0);
  }
  var EPISODE_STALE_MS = 10 * 60 * 1e3;
  var DEFAULT_PODCAST = { interests: null };
  var DEFAULT_EPISODES = { episodes: [], history: [] };
  function normPodcast(p, settings) {
    const interests = Array.isArray(p == null ? void 0 : p.interests) ? p.interests : settings.topics;
    return { interests: interests.filter((t) => typeof t === "string" && t.trim()) };
  }
  function normEpisodes(v, now = Date.now()) {
    const episodes = (Array.isArray(v == null ? void 0 : v.episodes) ? v.episodes : []).map((e) => e.status === "generating" && now - e.started >= EPISODE_STALE_MS ? { ...e, status: "failed", error: "Making the episode took too long - try again." } : e);
    return { episodes, history: Array.isArray(v == null ? void 0 : v.history) ? v.history : [] };
  }
  var episodeMinutes = (ep) => Math.max(1, Math.round((ep.seconds || 0) / 60));
  function nextInterest(interests, history2) {
    if (!interests.length) return null;
    const last = (t) => {
      const i = history2.findIndex((h) => h.interest === t);
      return i === -1 ? Infinity : i;
    };
    return [...interests].sort((a, b) => last(b) - last(a))[0];
  }
  function podcastInput(cards, writing) {
    const words = cards.filter((c) => c.kind !== "gap" && c.kind !== "rule");
    const fresh = words.filter(isNew).sort(newOrder).slice(0, 5);
    const shaky = words.filter((c) => c.srs).sort((a, b) => a.srs.stability - b.srs.stability).slice(0, 7);
    const mistakes = fixCounts(writing).slice(0, 3).map((f) => pointById(f.point)).filter(Boolean).map((p) => `${p.label} (e.g. ${p.model})`);
    return { words: [...fresh, ...shaky].map(germanOf), mistakes };
  }
  function logEpisode(listening, ep, key) {
    const entry = { id: uid(), day: key, res: "podcast", episode: ep.id, title: ep.title, min: episodeMinutes(ep) };
    return { ...listening, log: [entry, ...listening.log] };
  }
  function tokenize(line) {
    return line.split(/\s+/).filter(Boolean).map((t) => {
      const m = t.match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u);
      return { pre: m[1], word: m[2], post: m[3] };
    });
  }
  function stats(cards, writing, listening, log, key, now = Date.now()) {
    const week = weekKeys(key);
    const tomorrowEnd = dayEnd(addDays(key, 1));
    const todayEnd = dayEnd(key);
    return {
      week: week.map((k) => {
        var _a, _b;
        return { key: k, cards: !!((_a = log[k]) == null ? void 0 : _a.cards), writing: !!((_b = log[k]) == null ? void 0 : _b.writing), future: k > key };
      }),
      cardDays: week.filter((k) => {
        var _a;
        return (_a = log[k]) == null ? void 0 : _a.cards;
      }).length,
      writingDays: week.filter((k) => {
        var _a;
        return (_a = log[k]) == null ? void 0 : _a.writing;
      }).length,
      learned: cards.filter((c) => c.srs && c.srs.state === "review").length,
      total: cards.length,
      newCount: cards.filter(isNew).length,
      dueTomorrow: cards.filter((c) => c.srs && c.srs.due >= todayEnd && c.srs.due < tomorrowEnd).length,
      listeningMin: minutesIn(listening.log, week),
      writingSessions: writing.length,
      topFix: fixCounts(writing)[0] || null,
      now
    };
  }

  // shared/ai.js
  function callAI(functionName, body) {
    return apiFetch(`/api/fn/${encodeURIComponent(functionName)}`, { json: body != null ? body : {} });
  }

  // german/ai.js
  async function fillWord(input, settings) {
    const { options } = await callAI("german-ai", { task: "fill", input, level: settings.level });
    return options;
  }
  async function newExample(card, settings) {
    const { example } = await callAI("german-ai", {
      task: "example",
      level: settings.level,
      card: { kind: card.kind, de: card.de, article: card.article || null, en: card.en },
      avoid: card.example || ""
    });
    return example;
  }
  async function suggestWords(n, known, settings) {
    const { words } = await callAI("german-ai", {
      task: "suggest",
      n,
      level: settings.level,
      topics: settings.topics,
      known: known.slice(-400)
    });
    return words;
  }
  async function writingPrompt(focusId, recent, settings) {
    const p = pointById(focusId);
    const { prompt } = await callAI("german-ai", {
      task: "prompt",
      level: settings.level,
      topics: settings.topics,
      focus: { id: p.id, label: p.label, hint: p.hint },
      avoid: recent.slice(0, 12)
    });
    return prompt;
  }
  async function checkWriting({ text: text2, prompt, focus }, settings) {
    const p = pointById(focus);
    return callAI("german-ai", {
      task: "check",
      level: settings.level,
      text: text2,
      prompt,
      focus: p ? { id: p.id, label: p.label } : null
    });
  }
  function startEpisode(interest, cards, writing, settings) {
    return callAI("german-podcast", { interest, level: settings.level, pace: settings.podcastPace, ...podcastInput(cards, writing) });
  }
  async function wordsFromTranscript(items, settings) {
    const { items: out } = await callAI("german-ai", { task: "words", items, level: settings.level });
    return out;
  }

  // german/ui.jsx
  var { useEffect: useEffect2 } = React;
  var cx = (...c) => c.filter(Boolean).join(" ");
  var PATHS = {
    close: /* @__PURE__ */ React.createElement("path", { d: "M6 6l12 12M18 6L6 18" }),
    back: /* @__PURE__ */ React.createElement("path", { d: "M15 5l-7 7 7 7" }),
    chevron: /* @__PURE__ */ React.createElement("path", { d: "M9 6l6 6-6 6" }),
    plus: /* @__PURE__ */ React.createElement("path", { d: "M12 5v14M5 12h14" }),
    edit: /* @__PURE__ */ React.createElement("path", { d: "M4 20h4L19 9l-4-4L4 16v4z" }),
    wand: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M4 20L15 9" }), /* @__PURE__ */ React.createElement("path", { d: "M15 9l2-2 2 2-2 2z" }), /* @__PURE__ */ React.createElement("path", { d: "M10 4v2M9 5h2M19 14v2M18 15h2" })),
    refresh: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M20 11a8 8 0 1 0-2.3 5.7" }), /* @__PURE__ */ React.createElement("path", { d: "M20 5v6h-6" })),
    check: /* @__PURE__ */ React.createElement("path", { d: "M5 12.5l4.5 4.5L19 7.5" }),
    cards: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("rect", { x: "4", y: "6", width: "13", height: "14", rx: "2" }), /* @__PURE__ */ React.createElement("path", { d: "M8 3h10a2 2 0 0 1 2 2v12" })),
    pen: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M4 20h16" }), /* @__PURE__ */ React.createElement("path", { d: "M14.5 4.5l3 3L8 17H5v-3z" })),
    sun: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "4" }), /* @__PURE__ */ React.createElement("path", { d: "M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" })),
    today: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "8" }), /* @__PURE__ */ React.createElement("path", { d: "M12 8v4l3 2" })),
    progress: /* @__PURE__ */ React.createElement("path", { d: "M4 20V10M10 20V4M16 20v-7M22 20H2" }),
    trash: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M4 7h16M10 11v6M14 11v6" }), /* @__PURE__ */ React.createElement("path", { d: "M6 7l1 13h10l1-13M9 7V4h6v3" })),
    up: /* @__PURE__ */ React.createElement("path", { d: "M6 15l6-6 6 6" }),
    down: /* @__PURE__ */ React.createElement("path", { d: "M6 9l6 6 6-6" }),
    external: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M14 4h6v6M20 4l-9 9" }), /* @__PURE__ */ React.createElement("path", { d: "M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" })),
    headphones: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M4 15v-3a8 8 0 0 1 16 0v3" }), /* @__PURE__ */ React.createElement("rect", { x: "3", y: "14", width: "5", height: "7", rx: "2" }), /* @__PURE__ */ React.createElement("rect", { x: "16", y: "14", width: "5", height: "7", rx: "2" }))
  };
  function Icon({ name, size = 20, stroke = 2.2 }) {
    if (name === "play") {
      return /* @__PURE__ */ React.createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("path", { d: "M8 5v14l11-7z" }));
    }
    return /* @__PURE__ */ React.createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: stroke, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" }, PATHS[name]);
  }
  function Spinner() {
    return /* @__PURE__ */ React.createElement("span", { className: "g-spin", "aria-hidden": "true" });
  }
  function IconButton({ icon, label, onClick, href, variant, round, small, busy, disabled, iconSize }) {
    const className = cx("g-iconbtn", variant, round && "round", small && "sm");
    const inner = busy ? /* @__PURE__ */ React.createElement(Spinner, null) : /* @__PURE__ */ React.createElement(Icon, { name: icon, size: iconSize || (small ? 16 : 20) });
    if (href) return /* @__PURE__ */ React.createElement("a", { className, href, "aria-label": label, title: label }, inner);
    return /* @__PURE__ */ React.createElement("button", { type: "button", className, onClick, "aria-label": label, title: label, disabled: disabled || busy }, inner);
  }
  function Button({ children, onClick, href, variant, size, busy, disabled, type = "button", className }) {
    const cls = cx("g-btn", variant, size, className);
    const inner = /* @__PURE__ */ React.createElement(React.Fragment, null, busy && /* @__PURE__ */ React.createElement(Spinner, null), children);
    if (href) return /* @__PURE__ */ React.createElement("a", { className: cls, href }, inner);
    return /* @__PURE__ */ React.createElement("button", { type, className: cls, onClick, disabled: disabled || busy }, inner);
  }
  function LinkButton({ children, onClick, href, mint }) {
    const cls = cx("g-link", mint && "mint");
    if (href) return /* @__PURE__ */ React.createElement("a", { className: cls, href, target: href.startsWith("http") ? "_blank" : void 0, rel: "noreferrer" }, children);
    return /* @__PURE__ */ React.createElement("button", { type: "button", className: cls, onClick }, children);
  }
  function ScreenHeader({ back: back2, close, title, big, meta, children }) {
    return /* @__PURE__ */ React.createElement("header", { className: "g-head" }, close && /* @__PURE__ */ React.createElement(IconButton, { icon: "close", label: "Pause and go back", href: close }), back2 && /* @__PURE__ */ React.createElement(IconButton, { icon: "back", label: "Back", href: back2 }), title && (big ? /* @__PURE__ */ React.createElement("h1", null, title) : /* @__PURE__ */ React.createElement("span", { className: "g-head-title" }, title)), meta && /* @__PURE__ */ React.createElement("span", { className: "g-head-meta" }, meta), children && /* @__PURE__ */ React.createElement("div", { className: "g-head-right" }, children));
  }
  function Screen({ children, wide, center, tab, label }) {
    return /* @__PURE__ */ React.createElement("main", { className: cx("g-screen", wide && "wide", center && "center", tab && "g-tab-screen"), "aria-label": label }, children);
  }
  function Card({ children, big, amber, tight, label, className, as: Tag2 = "section" }) {
    return /* @__PURE__ */ React.createElement(Tag2, { className: cx("g-card", big && "big", amber && "amber", tight && "tight", className), "aria-label": label }, children);
  }
  function Label({ children, htmlFor }) {
    if (htmlFor) return /* @__PURE__ */ React.createElement("label", { className: "g-label", htmlFor }, children);
    return /* @__PURE__ */ React.createElement("span", { className: "g-label" }, children);
  }
  function Field({ id, label, children, right }) {
    return /* @__PURE__ */ React.createElement("div", { className: "g-field" }, right ? /* @__PURE__ */ React.createElement("div", { className: "g-between", style: { margin: "-12px -10px -8px 0" } }, /* @__PURE__ */ React.createElement("label", { htmlFor: id }, label), right) : /* @__PURE__ */ React.createElement("label", { htmlFor: id }, label), children);
  }
  function Input({ id, value, onChange, ...rest }) {
    return /* @__PURE__ */ React.createElement("input", { id, className: "g-input", value, onChange: (e) => onChange(e.target.value), ...rest });
  }
  function TextArea({ id, value, onChange, rows = 2, ...rest }) {
    return /* @__PURE__ */ React.createElement("textarea", { id, className: "g-input", rows, value, onChange: (e) => onChange(e.target.value), ...rest });
  }
  function ArticlePicker({ value, onChange }) {
    return /* @__PURE__ */ React.createElement("div", { className: "g-radio3", role: "radiogroup", "aria-label": "Article" }, ARTICLES.map((a) => /* @__PURE__ */ React.createElement("button", { key: a, type: "button", role: "radio", "aria-checked": value === a, className: a, onClick: () => onChange(a) }, a)));
  }
  function Choice({ value, onChange, options, label }) {
    return /* @__PURE__ */ React.createElement("div", { className: "g-radio3", role: "radiogroup", "aria-label": label, style: { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` } }, options.map(([v, text2]) => /* @__PURE__ */ React.createElement("button", { key: v, type: "button", role: "radio", "aria-checked": value === v, className: "plain", onClick: () => onChange(v) }, text2)));
  }
  function Chip({ children, pressed, onClick, onRemove, removeLabel, dashed }) {
    if (onRemove) {
      return /* @__PURE__ */ React.createElement("span", { className: "g-chip soft" }, children, /* @__PURE__ */ React.createElement("button", { type: "button", className: "x", "aria-label": removeLabel, onClick: onRemove }, "\xD7"));
    }
    return /* @__PURE__ */ React.createElement("button", { type: "button", className: cx("g-chip", dashed && "dashed"), "aria-pressed": pressed === void 0 ? void 0 : pressed, onClick }, children);
  }
  function Stepper({ value, onChange, min = 0, max = 30 }) {
    return /* @__PURE__ */ React.createElement("div", { className: "g-stepper" }, /* @__PURE__ */ React.createElement("button", { type: "button", "aria-label": "Fewer", disabled: value <= min, onClick: () => onChange(value - 1) }, "\u2212"), /* @__PURE__ */ React.createElement("span", { "aria-live": "polite" }, value), /* @__PURE__ */ React.createElement("button", { type: "button", "aria-label": "More", disabled: value >= max, onClick: () => onChange(value + 1) }, "+"));
  }
  function Noun({ article, children }) {
    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { className: article }, article), " ", children);
  }
  function ProgressBar({ value, max }) {
    const pct = max ? Math.min(100, value / max * 100) : 0;
    return /* @__PURE__ */ React.createElement("div", { className: "g-bar", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": max, "aria-valuenow": value }, /* @__PURE__ */ React.createElement("div", { style: { width: `${pct}%` } }));
  }
  function Tag({ children, tone }) {
    return /* @__PURE__ */ React.createElement("span", { className: cx("g-tag", tone) }, children);
  }
  function Stat({ label, value, note }) {
    return /* @__PURE__ */ React.createElement("section", { className: "g-stat" }, /* @__PURE__ */ React.createElement("span", { className: "k" }, label), /* @__PURE__ */ React.createElement("span", { className: "v" }, value), note && /* @__PURE__ */ React.createElement("span", { className: "g-small" }, note));
  }
  function NavList({ items, label }) {
    return /* @__PURE__ */ React.createElement("nav", { className: "g-navlist", "aria-label": label }, items.map((it) => /* @__PURE__ */ React.createElement("a", { key: it.href, href: it.href }, /* @__PURE__ */ React.createElement("span", null, it.label, it.note && /* @__PURE__ */ React.createElement("small", null, it.note)), /* @__PURE__ */ React.createElement(Icon, { name: "chevron", size: 18, stroke: 2 }))));
  }
  function Empty({ children }) {
    return /* @__PURE__ */ React.createElement("p", { className: "g-empty" }, children);
  }
  function Toast({ message }) {
    if (!message) return null;
    return /* @__PURE__ */ React.createElement("div", { className: "g-toast", role: "status" }, message);
  }
  function useScrollTop(key) {
    useEffect2(() => {
      window.scrollTo(0, 0);
    }, [key]);
  }

  // german/route.js
  var { useState: useState2, useEffect: useEffect3 } = React;
  function parseHash() {
    const [name = "", param = null] = location.hash.replace(/^#\/?/, "").split("/");
    return { name, param: param && decodeURIComponent(param) };
  }
  function useRoute() {
    const [route, setRoute] = useState2(parseHash);
    useEffect3(() => {
      const on = () => setRoute(parseHash());
      window.addEventListener("hashchange", on);
      return () => window.removeEventListener("hashchange", on);
    }, []);
    return route;
  }
  function go(href) {
    location.hash = href.replace(/^#/, "");
  }

  // german/Today.jsx
  var TASK = {
    cards: { name: "Flashcards", icon: "cards", href: "#/cards", variant: "mint" },
    writing: { name: "Writing", icon: "pen", href: "#/write", variant: "amber" },
    podcast: { name: "Podcast", icon: "headphones", href: "#/podcast", variant: "mint" }
  };
  var TASK_WORD = { cards: "cards", writing: "writing", podcast: "the podcast" };
  var andList = (items) => items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}` : items[0] || "";
  function germanDate(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
  }
  function cardPlanSize(app) {
    const plan = planSession(app.cards, app.suggest, app.settings, app.today);
    return plan.reviews.length + plan.fresh.length + plan.fromSuggestions;
  }
  function taskMeta(task, cardCount) {
    if (task === "cards") return `${sessionMinutes(cardCount)} min`;
    if (task === "podcast") return "4 min";
    return "10 min";
  }
  function Hero({ icon, title, sub, children }) {
    return /* @__PURE__ */ React.createElement("section", { className: "g-hero" }, /* @__PURE__ */ React.createElement("span", { style: { color: "var(--mint)" } }, /* @__PURE__ */ React.createElement(Icon, { name: icon, size: 52, stroke: 1.6 })), /* @__PURE__ */ React.createElement("h1", null, title), /* @__PURE__ */ React.createElement("p", null, sub), children);
  }
  function TaskList({ tasks, done, now, cardCount }) {
    return /* @__PURE__ */ React.createElement("ol", { className: "g-tasks", "aria-label": "Today's tasks" }, tasks.map((t, i) => {
      const state = done.includes(t) ? "done" : t === now ? "now" : "";
      return /* @__PURE__ */ React.createElement("li", { key: t, className: state }, /* @__PURE__ */ React.createElement("span", { className: "n" }, state === "done" ? /* @__PURE__ */ React.createElement(Icon, { name: "check", size: 14, stroke: 3 }) : i + 1), /* @__PURE__ */ React.createElement("span", { className: "name" }, TASK[t].name), /* @__PURE__ */ React.createElement("span", { className: "meta" }, state === "done" ? "Done" : taskMeta(t, cardCount)), state === "now" && /* @__PURE__ */ React.createElement("span", { className: "tagnow" }, "Now"));
    }));
  }
  function ListenLog({ app }) {
    const { listening, today } = app;
    const res = listening.resources.find((r) => r.id === listening.current);
    if (!res) return null;
    const add = () => {
      app.setListening((l) => ({ ...l, current: res.id, resources: listening.resources, log: [{ id: uid(), day: today, res: res.id, min: 15 }, ...listening.log] }));
      app.showToast(`Logged 15 min \xB7 ${res.name}`);
    };
    return /* @__PURE__ */ React.createElement(Card, { className: "g-between", label: "Listening" }, /* @__PURE__ */ React.createElement("div", { className: "g-between", style: { width: "100%", textAlign: "left" } }, /* @__PURE__ */ React.createElement("div", { className: "g-stack", style: { gap: 2 } }, /* @__PURE__ */ React.createElement("b", { style: { fontSize: 14 } }, "Listened to something?"), /* @__PURE__ */ React.createElement("span", { className: "g-small", style: { fontSize: 13 } }, res.name, " \xB7 optional")), /* @__PURE__ */ React.createElement(Button, { size: "sm", onClick: add }, "+15 min")));
  }
  function Done({ app, tasks }) {
    const tomorrow = addDays(app.today, 1);
    const next = tasksFor(tomorrow, app.settings);
    const dueTomorrow = app.cards.filter((c) => c.srs && c.srs.due < dayEnd(tomorrow)).length;
    const nextCount = Math.min(dueTomorrow + app.settings.newPerDay, 60);
    const names = tasks.map((t) => TASK_WORD[t]);
    const tomorrowText = next.length ? `Tomorrow: ${next.map((t) => t === "cards" ? `cards, about ${sessionMinutes(nextCount)} min` : TASK_WORD[t]).join(" + ")}.` : "Tomorrow is free.";
    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "g-done-mark" }, /* @__PURE__ */ React.createElement(Icon, { name: "check", size: 48, stroke: 2.4 })), /* @__PURE__ */ React.createElement("h1", { style: { marginTop: 8, fontSize: 34, fontWeight: 800, letterSpacing: "-0.02em" } }, "Fertig f\xFCr heute."), /* @__PURE__ */ React.createElement("p", { className: "g-muted", style: { fontSize: 16 } }, andList(names).replace(/^./, (c) => c.toUpperCase()), " done.", /* @__PURE__ */ React.createElement("br", null), tomorrowText), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 24, width: "100%" } }, /* @__PURE__ */ React.createElement(ListenLog, { app })));
  }
  function Today({ app }) {
    const { today, settings, log } = app;
    const tasks = tasksFor(today, settings);
    const done = doneTasks(log, today);
    const pending = tasks.filter((t) => !done.includes(t));
    const now = pending[0];
    const cardCount = cardPlanSize(app);
    let body;
    if (tasks.length && !now) {
      body = /* @__PURE__ */ React.createElement(Done, { app, tasks });
    } else if (!tasks.length) {
      body = /* @__PURE__ */ React.createElement(Hero, { icon: "sun", title: "Frei heute", sub: "Nothing planned today." }, cardCount > 0 && !done.includes("cards") && /* @__PURE__ */ React.createElement(Button, { href: "#/cards", variant: "outline" }, "Review ", cardCount, " cards anyway"));
    } else {
      const t = TASK[now];
      const sub = now === "cards" ? cardCount ? `${cardCount} ${cardCount === 1 ? "card" : "cards"} \xB7 about ${sessionMinutes(cardCount)} min` : app.refilling ? "Getting new words ready\u2026" : "Nothing due right now" : now === "podcast" ? "One episode \xB7 3\u20134 min" : "3\u20135 sentences \xB7 about 10 min";
      body = /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Hero, { icon: t.icon, title: t.name, sub }, /* @__PURE__ */ React.createElement(Button, { href: t.href, variant: t.variant }, "Start")), /* @__PURE__ */ React.createElement(TaskList, { tasks, done, now, cardCount }));
    }
    return /* @__PURE__ */ React.createElement(Screen, { tab: true, label: "Today" }, /* @__PURE__ */ React.createElement("header", { className: "g-between g-mobile-only" }, /* @__PURE__ */ React.createElement("span", { className: "g-date", style: { paddingLeft: 4 } }, germanDate(today)), /* @__PURE__ */ React.createElement(IconButton, { icon: "plus", label: "Add a word", href: "#/add", variant: "accent" })), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 16, maxWidth: 520, width: "100%", margin: "0 auto", textAlign: "center", paddingBottom: 48 } }, /* @__PURE__ */ React.createElement("span", { className: "g-date g-desktop-only" }, germanDate(today)), body));
  }

  // german/audio.js
  var CACHE = "german-audio";
  var BUCKET = "german-audio";
  async function sha256(text2) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text2.trim()));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  var cacheKey = (name) => new Request(`${location.origin}/__german-audio/${name}.mp3`);
  var episodeName = (path) => `podcast/${path.split("/").pop().replace(/\.\w+$/, "")}`;
  async function fromCache(name) {
    try {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(cacheKey(name));
      return hit ? await hit.blob() : null;
    } catch {
      return null;
    }
  }
  async function toCache(name, blob) {
    try {
      const cache = await caches.open(CACHE);
      await cache.put(cacheKey(name), new Response(blob, { headers: { "Content-Type": blob.type || "audio/mpeg" } }));
    } catch {
    }
  }
  function download(path) {
    return apiFetch(`/api/storage/${BUCKET}/${path}`, { as: "blob" }).catch(() => null);
  }
  async function fetchAudio(text2, session) {
    const hash = await sha256(text2);
    const cached = await fromCache(hash);
    if (cached) return cached;
    if (!session) throw new Error("Sign in on the home page to hear sentences.");
    const path = `${session.user.id}/${hash}.mp3`;
    let data = await download(path);
    if (!data) {
      await callAI("german-tts", { text: text2.trim(), path });
      data = await download(path);
    }
    if (!data) throw new Error("Couldn't load the audio.");
    await toCache(hash, data);
    return data;
  }
  var current2 = null;
  async function speak(text2, session) {
    const blob = await fetchAudio(text2, session);
    if (current2) {
      current2.pause();
      URL.revokeObjectURL(current2.src);
    }
    current2 = new Audio(URL.createObjectURL(blob));
    await current2.play();
  }
  async function episodeAudio(path, session) {
    const name = episodeName(path);
    const cached = await fromCache(name);
    if (cached) return cached;
    if (!session) throw new Error("Sign in on the home page to play episodes.");
    const data = await download(path);
    if (!data) throw new Error("Couldn't load the episode.");
    await toCache(name, data);
    return data;
  }
  async function forgetEpisodes(keepPaths) {
    try {
      const keep = new Set(keepPaths.map((p) => cacheKey(episodeName(p)).url));
      const cache = await caches.open(CACHE);
      for (const req of await cache.keys()) {
        if (req.url.includes("/__german-audio/podcast/") && !keep.has(req.url)) await cache.delete(req);
      }
    } catch {
    }
  }

  // german/Review.jsx
  var { useState: useState3, useEffect: useEffect4, useMemo, useRef: useRef2 } = React;
  function interleave(reviews, fresh) {
    if (!fresh.length) return reviews;
    const every = Math.max(1, Math.floor(reviews.length / (fresh.length + 1)));
    const out = [];
    let f = 0;
    reviews.forEach((id, i) => {
      out.push(id);
      if ((i + 1) % every === 0 && f < fresh.length) out.push(fresh[f++]);
    });
    return [...out, ...fresh.slice(f)];
  }
  var LEARNING = /* @__PURE__ */ new Set(["learning", "relearning"]);
  function pickNext(ids, byId, shown, end, now) {
    const live = ids.map((id) => byId.get(id)).filter(Boolean);
    const learning = live.filter((c) => shown.has(c.id) && c.srs && LEARNING.has(c.srs.state) && c.srs.due < end).sort((a, b) => a.srs.due - b.srs.due);
    if (learning[0] && learning[0].srs.due <= now) return learning[0];
    return live.find((c) => !shown.has(c.id)) || learning[0] || null;
  }
  function splitEnglish(en) {
    const m = en.match(/^(.*?)\s*(\(.*\))$/);
    return m && m[1] ? [m[1], m[2]] : [en, null];
  }
  function Front({ card }) {
    if (card.kind === "gap") {
      return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("p", { className: "g-q sentence" }, card.text), /* @__PURE__ */ React.createElement("p", { className: "g-sub" }, card.en));
    }
    if (card.kind === "rule") return /* @__PURE__ */ React.createElement("p", { className: "g-q sentence" }, card.en);
    const [main, note] = splitEnglish(card.en);
    return /* @__PURE__ */ React.createElement("p", { className: "g-q" }, main, note && /* @__PURE__ */ React.createElement("small", null, note));
  }
  function Back({ card }) {
    var _a;
    if (card.kind === "noun") {
      return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("p", { className: "g-a" }, /* @__PURE__ */ React.createElement(Noun, { article: card.article }, card.de)), card.plural && /* @__PURE__ */ React.createElement("p", { className: "g-sub" }, "Plural: ", card.plural));
    }
    if (card.kind === "verb") {
      return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("p", { className: "g-a" }, card.de), (card.perfekt || card.separable) && /* @__PURE__ */ React.createElement("p", { className: "g-sub" }, card.perfekt, card.perfekt && card.separable && " \xB7 ", card.separable && "separable"));
    }
    if (card.kind === "gap") {
      const [before, after] = card.text.split("___");
      return /* @__PURE__ */ React.createElement("p", { className: "g-a sentence" }, before, /* @__PURE__ */ React.createElement("span", { className: "hl" }, card.answer), after);
    }
    if (card.kind === "rule") {
      return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("p", { className: "g-a sentence", style: { fontSize: 22 } }, card.de), ((_a = card.examples) == null ? void 0 : _a.length) > 0 && /* @__PURE__ */ React.createElement("ul", { className: "g-rule-ex", "aria-label": "Your sentences" }, card.examples.map((e) => /* @__PURE__ */ React.createElement("li", { key: e }, e))));
    }
    return /* @__PURE__ */ React.createElement("p", { className: "g-a" }, card.de);
  }
  function PlayRow({ text: text2, session, showToast }) {
    const [busy, setBusy] = useState3(false);
    const play = () => {
      setBusy(true);
      speak(text2, session).catch((e) => showToast(e.message)).finally(() => setBusy(false));
    };
    return /* @__PURE__ */ React.createElement("div", { className: "g-example" }, /* @__PURE__ */ React.createElement(IconButton, { icon: "play", label: "Play sentence", variant: "mint", round: true, busy, onClick: play, iconSize: 18 }), /* @__PURE__ */ React.createElement("p", null, text2));
  }
  var RATE = [
    ["again", "Again", "1"],
    ["hard", "Hard", "2"],
    ["good", "Good", "space"],
    ["easy", "Easy", "4"]
  ];
  function Review({ app }) {
    const { today } = app;
    const end = dayEnd(today);
    const [start, setStart] = useState3(null);
    const plan = planSession(app.cards, app.suggest, app.settings, today);
    const empty = !plan.reviews.length && !plan.fresh.length && !plan.fromSuggestions;
    useEffect4(() => {
      if (start || empty && app.refilling) return;
      const made = app.suggest.slice(0, plan.fromSuggestions).map((s) => makeCard(s, "ai"));
      setStart({ made, ids: interleave(plan.reviews, [...plan.fresh, ...made.map((c) => c.id)]) });
      if (!made.length) return;
      const used = new Set(made.map((c) => c.de));
      app.setCards((cs) => [...cs, ...made]);
      app.setSuggest((s) => s.filter((x) => !used.has(x.de)));
    }, [start, empty, app.refilling]);
    const ids = start ? start.ids : [];
    const [shown, setShown] = useState3(() => /* @__PURE__ */ new Set());
    const [flipped, setFlipped] = useState3(false);
    const [now, setNow] = useState3(Date.now);
    const finishedRef = useRef2(false);
    const byId = useMemo(() => new Map([...start ? start.made : [], ...app.cards].map((c) => [c.id, c])), [app.cards, start]);
    const card = pickNext(ids, byId, shown, end, now);
    const done = ids.filter((id) => {
      const c = byId.get(id);
      return !c || c.srs && c.srs.due >= end;
    }).length;
    const progress = done + ids.filter((id) => {
      const c = byId.get(id);
      return c && shown.has(id) && c.srs && c.srs.due < end;
    }).length / 2;
    const finish = () => {
      finishedRef.current = true;
      app.markDone("cards");
      const writingLeft = tasksFor(today, app.settings).includes("writing") && !doneTasks(app.log, today).includes("writing");
      go(writingLeft ? "#/write" : "#/");
    };
    useEffect4(() => {
      if (card || !ids.length || finishedRef.current) return;
      finish();
    }, [card, ids.length]);
    const rate = (name) => {
      if (!card) return;
      const t = Date.now();
      app.updateCard(card.id, (c) => answerCard(c, RATINGS[name], today, t));
      setShown((s) => new Set(s).add(card.id));
      setFlipped(false);
      setNow(t);
    };
    const keys = useRef2();
    keys.current = (e) => {
      if (e.target.closest("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!flipped && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        setFlipped(true);
        return;
      }
      if (!flipped) return;
      const name = { 1: "again", 2: "hard", 3: "good", 4: "easy", " ": "good", Enter: "good" }[e.key];
      if (name) {
        e.preventDefault();
        rate(name);
      }
    };
    useEffect4(() => {
      const on = (e) => keys.current(e);
      window.addEventListener("keydown", on);
      return () => window.removeEventListener("keydown", on);
    }, []);
    if (!start) {
      return /* @__PURE__ */ React.createElement(Screen, { center: true, label: "Flashcards" }, /* @__PURE__ */ React.createElement("div", { className: "g-stack", style: { alignItems: "center", textAlign: "center", gap: 12 } }, /* @__PURE__ */ React.createElement(Spinner, null), /* @__PURE__ */ React.createElement("p", { className: "g-muted" }, "Getting new words ready\u2026")));
    }
    if (!ids.length) {
      return /* @__PURE__ */ React.createElement(Screen, { label: "Flashcards" }, /* @__PURE__ */ React.createElement(ScreenHeader, { close: "#/" }), /* @__PURE__ */ React.createElement("div", { className: "g-stack", style: { flex: 1, justifyContent: "center", alignItems: "center", textAlign: "center", gap: 12 } }, /* @__PURE__ */ React.createElement("p", { style: { fontSize: 22, fontWeight: 800 } }, "No cards to study"), /* @__PURE__ */ React.createElement("p", { className: "g-muted" }, app.session ? "Nothing is due and there are no new words yet. Add a word, or try again in a minute." : "Nothing is due. Sign in on the home page to get suggested words.")), /* @__PURE__ */ React.createElement(Button, { href: "#/add", variant: "mint" }, "Add a word"));
    }
    if (!card) return /* @__PURE__ */ React.createElement(Screen, null);
    const wait = previews(card.srs, now);
    const spoken = card.kind === "gap" ? germanOf(card) : card.example;
    return /* @__PURE__ */ React.createElement(Screen, { label: "Flashcards" }, /* @__PURE__ */ React.createElement("header", { className: "g-head" }, /* @__PURE__ */ React.createElement(IconButton, { icon: "close", label: "Pause and go back", href: "#/" }), /* @__PURE__ */ React.createElement(ProgressBar, { value: progress, max: ids.length }), /* @__PURE__ */ React.createElement("span", { className: "g-count" }, done, "/", ids.length)), /* @__PURE__ */ React.createElement("section", { className: "g-flash", "aria-label": "Card", "aria-live": "polite" }, flipped && /* @__PURE__ */ React.createElement("div", { className: "g-flash-top" }, /* @__PURE__ */ React.createElement("span", null, card.en), /* @__PURE__ */ React.createElement(IconButton, { icon: "edit", label: "Edit card", href: `#/card/${card.id}`, variant: "ghost", iconSize: 18 })), /* @__PURE__ */ React.createElement("div", { className: "g-flash-mid" }, flipped ? /* @__PURE__ */ React.createElement(Back, { card }) : /* @__PURE__ */ React.createElement(Front, { card })), flipped && spoken && /* @__PURE__ */ React.createElement(PlayRow, { key: spoken, text: spoken, session: app.session, showToast: app.showToast })), flipped ? /* @__PURE__ */ React.createElement("div", { className: "g-grid4 g-rate" }, RATE.map(([name, label, key]) => /* @__PURE__ */ React.createElement("button", { key: name, type: "button", className: name, onClick: () => rate(name) }, /* @__PURE__ */ React.createElement("b", null, label), /* @__PURE__ */ React.createElement("span", null, wait[name], /* @__PURE__ */ React.createElement("span", { className: "g-keys" }, " \xB7 ", key === "space" ? "space" : `key ${key}`))))) : /* @__PURE__ */ React.createElement("button", { type: "button", className: "g-btn", style: { minHeight: 68 }, onClick: () => setFlipped(true) }, "Show answer"));
  }

  // german/CardEditor.jsx
  var { useState: useState4 } = React;
  var BLANK = { kind: "noun", de: "", article: "der", plural: "", perfekt: "", separable: false, en: "", example: "", text: "", answer: "", examples: [] };
  function fieldsOf(card) {
    return { ...BLANK, ...card, examples: card.examples || [] };
  }
  function back() {
    if (history.length > 1) history.back();
    else location.hash = "/";
  }
  function cleanFields(f) {
    const out = { kind: f.kind, de: f.de, en: f.en, example: f.example };
    if (f.kind === "noun") Object.assign(out, { article: f.article, plural: f.plural });
    if (f.kind === "verb") Object.assign(out, { perfekt: f.perfekt, separable: f.separable });
    if (f.kind === "gap") Object.assign(out, { text: f.text, answer: f.answer, point: f.point });
    if (f.kind === "rule") Object.assign(out, { point: f.point, examples: f.examples });
    return out;
  }
  function Options({ options, onPick }) {
    return /* @__PURE__ */ React.createElement("section", { "aria-label": "Which meaning?", className: "g-stack" }, /* @__PURE__ */ React.createElement("span", { className: "g-label" }, "Which one do you mean?"), options.map((o, i) => /* @__PURE__ */ React.createElement("button", { key: i, type: "button", className: "g-option", onClick: () => onPick(o) }, /* @__PURE__ */ React.createElement("b", null, o.kind === "noun" ? /* @__PURE__ */ React.createElement(Noun, { article: o.article }, o.de) : o.de), /* @__PURE__ */ React.createElement("span", null, o.sense || o.en))));
  }
  function Form({ f, set: set2, onExample, exampleBusy, editing }) {
    return /* @__PURE__ */ React.createElement(React.Fragment, null, f.kind === "noun" && /* @__PURE__ */ React.createElement(ArticlePicker, { value: f.article, onChange: (v) => set2({ article: v }) }), editing && (f.kind === "noun" || f.kind === "verb" || f.kind === "word") && /* @__PURE__ */ React.createElement(Field, { id: "de", label: "German" }, /* @__PURE__ */ React.createElement(Input, { id: "de", value: f.de, onChange: (v) => set2({ de: v }) })), f.kind === "gap" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Field, { id: "text", label: "Sentence (___ marks the gap)" }, /* @__PURE__ */ React.createElement(Input, { id: "text", value: f.text, onChange: (v) => set2({ text: v }) })), /* @__PURE__ */ React.createElement(Field, { id: "answer", label: "Answer" }, /* @__PURE__ */ React.createElement(Input, { id: "answer", value: f.answer, onChange: (v) => set2({ answer: v }) }))), f.kind === "rule" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Field, { id: "en", label: "Question" }, /* @__PURE__ */ React.createElement(TextArea, { id: "en", value: f.en, onChange: (v) => set2({ en: v }) })), /* @__PURE__ */ React.createElement(Field, { id: "de", label: "Rule" }, /* @__PURE__ */ React.createElement(TextArea, { id: "de", value: f.de, onChange: (v) => set2({ de: v }) })), /* @__PURE__ */ React.createElement(Field, { id: "examples", label: "Your sentences, one per line" }, /* @__PURE__ */ React.createElement(TextArea, { id: "examples", rows: 3, value: f.examples.join("\n"), onChange: (v) => set2({ examples: v.split("\n") }) }))), f.kind !== "rule" && /* @__PURE__ */ React.createElement("div", { className: "g-grid2" }, f.kind === "noun" && /* @__PURE__ */ React.createElement(Field, { id: "plural", label: "Plural" }, /* @__PURE__ */ React.createElement(Input, { id: "plural", value: f.plural, onChange: (v) => set2({ plural: v }) })), f.kind === "verb" && /* @__PURE__ */ React.createElement(Field, { id: "perfekt", label: "Perfekt" }, /* @__PURE__ */ React.createElement(Input, { id: "perfekt", value: f.perfekt, placeholder: "hat gemacht", onChange: (v) => set2({ perfekt: v }) })), /* @__PURE__ */ React.createElement("div", { className: "g-field", style: f.kind === "noun" || f.kind === "verb" ? null : { gridColumn: "1 / -1" } }, /* @__PURE__ */ React.createElement("label", { htmlFor: "english" }, "English"), /* @__PURE__ */ React.createElement(Input, { id: "english", value: f.en, onChange: (v) => set2({ en: v }) }))), f.kind === "verb" && /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement(Chip, { pressed: f.separable, onClick: () => set2({ separable: !f.separable }) }, "Separable verb")), (f.kind === "noun" || f.kind === "verb" || f.kind === "word") && /* @__PURE__ */ React.createElement(
      Field,
      {
        id: "example",
        label: "Example",
        right: /* @__PURE__ */ React.createElement(IconButton, { icon: "refresh", label: "New example", variant: "ghost", small: true, iconSize: 16, busy: exampleBusy, onClick: onExample })
      },
      /* @__PURE__ */ React.createElement(TextArea, { id: "example", value: f.example, onChange: (v) => set2({ example: v }) })
    ));
  }
  function CardEditor({ app, cardId }) {
    const existing = cardId ? app.cards.find((c) => c.id === cardId) : null;
    const editing = !!cardId;
    const [input, setInput] = useState4("");
    const [f, setF] = useState4(() => existing ? fieldsOf(existing) : BLANK);
    const [stage, setStage] = useState4(editing ? "form" : "empty");
    const [options, setOptions] = useState4([]);
    const [filled, setFilled] = useState4(false);
    const [busy, setBusy] = useState4(null);
    const [error, setError] = useState4(null);
    const [confirmDelete, setConfirmDelete] = useState4(false);
    const set2 = (patch) => setF((prev) => ({ ...prev, ...patch }));
    if (editing && !existing) {
      return /* @__PURE__ */ React.createElement(Screen, null, /* @__PURE__ */ React.createElement(ScreenHeader, { back: "#/deck", title: "Card", big: true }), /* @__PURE__ */ React.createElement("p", { className: "g-empty" }, "This card was deleted."));
    }
    const fill = () => {
      const word = input.trim();
      if (!word) return;
      if (!app.session) {
        setError("Sign in on the home page to fill in words \u2014 or fill them in by hand.");
        return;
      }
      setBusy("fill");
      setError(null);
      fillWord(word, app.settings).then((opts) => {
        if (opts.length === 1) {
          pick(opts[0]);
        } else {
          setOptions(opts);
          setStage("choose");
        }
      }).catch((e) => setError(e.message)).finally(() => setBusy(null));
    };
    const pick = (o) => {
      setF({ ...BLANK, ...o });
      setInput(o.de);
      setFilled(true);
      setStage("form");
    };
    const regenerate = () => {
      if (!app.session) return setError("Sign in on the home page to get a new example.");
      setBusy("example");
      setError(null);
      newExample(editing ? f : { ...f, de: input.trim() }, app.settings).then((example) => set2({ example })).catch((e) => setError(e.message)).finally(() => setBusy(null));
    };
    const byHand = () => {
      setF(BLANK);
      setFilled(false);
      setStage("form");
    };
    const current3 = editing ? f : { ...f, de: input };
    const canSave = current3.kind === "gap" ? current3.text.includes("___") && current3.answer.trim() : current3.de.trim() && current3.en.trim();
    const save = () => {
      const fields = cleanFields(current3);
      if (editing) {
        app.updateCard(existing.id, (c) => {
          var _a, _b;
          return { ...c, ...fields, examples: (_b = (_a = fields.examples) == null ? void 0 : _a.map((x) => x.trim()).filter(Boolean)) != null ? _b : c.examples };
        });
        app.showToast("Card saved");
        back();
        return;
      }
      const { card, duplicate } = app.addCard(fields, "own");
      app.showToast(duplicate ? `${germanOf(card)} is already in your deck` : `Added ${germanOf(card)}`);
      if (duplicate) location.hash = `/card/${card.id}`;
      else back();
    };
    const remove = () => {
      if (!confirmDelete) return setConfirmDelete(true);
      app.deleteCard(existing.id);
      app.showToast("Card deleted");
      back();
    };
    return /* @__PURE__ */ React.createElement(Screen, { label: editing ? "Edit card" : "Add word" }, /* @__PURE__ */ React.createElement("header", { className: "g-head" }, /* @__PURE__ */ React.createElement(IconButton, { icon: "close", label: "Close", onClick: back }), /* @__PURE__ */ React.createElement("h1", { style: { fontSize: 20 } }, editing ? "Edit card" : "Add word"), editing && /* @__PURE__ */ React.createElement("div", { className: "g-head-right" }, /* @__PURE__ */ React.createElement(Button, { size: "sm", variant: "outline", className: confirmDelete ? "danger" : void 0, onClick: remove }, confirmDelete ? "Delete?" : "Delete"))), !editing && /* @__PURE__ */ React.createElement("div", { className: "g-stack", style: { gap: 6 } }, /* @__PURE__ */ React.createElement("label", { htmlFor: "word", className: "g-label" }, "German or English"), /* @__PURE__ */ React.createElement("form", { className: "g-bigfield", onSubmit: (e) => {
      e.preventDefault();
      fill();
    } }, /* @__PURE__ */ React.createElement("input", { id: "word", value: input, autoFocus: true, autoComplete: "off", autoCapitalize: "off", spellCheck: "false", onChange: (e) => setInput(e.target.value) }), /* @__PURE__ */ React.createElement(IconButton, { icon: "wand", label: "Fill in details", variant: "wand", busy: busy === "fill", disabled: !input.trim(), onClick: fill }))), error && /* @__PURE__ */ React.createElement("p", { className: "g-error", role: "alert" }, error), stage === "empty" && /* @__PURE__ */ React.createElement("div", { className: "g-stack", style: { alignItems: "flex-start" } }, /* @__PURE__ */ React.createElement("p", { className: "g-muted", style: { padding: "0 4px" } }, "Type a word and tap the wand: article, plural, English and an example get filled in."), /* @__PURE__ */ React.createElement(LinkButton, { mint: true, onClick: byHand }, "Fill in by hand")), stage === "choose" && /* @__PURE__ */ React.createElement(Options, { options, onPick: pick }), stage === "form" && /* @__PURE__ */ React.createElement(Card, { label: "Card details" }, !editing && (filled ? /* @__PURE__ */ React.createElement("span", { className: "g-small", style: { fontWeight: 700, color: "var(--mint)" } }, "Filled in \u2014 check and save") : /* @__PURE__ */ React.createElement(Choice, { label: "Kind of word", value: f.kind, onChange: (kind) => set2({ kind }), options: [["noun", "Noun"], ["verb", "Verb"], ["word", "Other"]] })), /* @__PURE__ */ React.createElement(Form, { f, set: set2, onExample: regenerate, exampleBusy: busy === "example", editing })), stage === "form" && /* @__PURE__ */ React.createElement("div", { className: "g-push" }, /* @__PURE__ */ React.createElement(Button, { variant: "mint", disabled: !canSave, onClick: save }, editing ? "Save" : "Save card")));
  }

  // german/Deck.jsx
  var { useState: useState5, useMemo: useMemo2 } = React;
  var FILTERS = [["all", "All"], ["nouns", "Nouns"], ["verbs", "Verbs"], ["grammar", "Grammar"], ["hard", "Hard ones"]];
  var PAGE = 150;
  function when(card, today) {
    if (!card.srs) return "new";
    const due = card.srs.due;
    if (due < dayEnd(today)) return "today";
    if (due < dayEnd(addDays(today, 1))) return "tomorrow";
    return `in ${formatWait(due - Date.now())}`;
  }
  function Title({ card }) {
    if (card.kind === "noun") return /* @__PURE__ */ React.createElement(Noun, { article: card.article }, card.de);
    if (card.kind === "gap") return germanOf(card);
    if (card.kind === "rule") return pointLabel(card.point);
    return card.de;
  }
  function subtitle(card) {
    if (card.kind === "verb") return [card.en, card.perfekt].filter(Boolean).join(" \xB7 ");
    if (card.kind === "gap") return "grammar \xB7 from your writing";
    if (card.kind === "rule") return "grammar rule";
    return card.en;
  }
  function Deck({ app }) {
    const [query, setQuery] = useState5("");
    const [filter, setFilter] = useState5("all");
    const [limit, setLimit] = useState5(PAGE);
    const found = useMemo2(
      () => searchCards(app.cards, query, filter).sort((a, b) => b.added - a.added),
      [app.cards, query, filter]
    );
    return /* @__PURE__ */ React.createElement(Screen, { label: "Deck" }, /* @__PURE__ */ React.createElement(ScreenHeader, { back: "#/progress", title: "Deck", big: true }, /* @__PURE__ */ React.createElement(IconButton, { icon: "plus", label: "Add a word", href: "#/add", variant: "mint" })), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", { htmlFor: "deck-search", className: "sr" }, "Search cards"), /* @__PURE__ */ React.createElement("input", { id: "deck-search", type: "search", className: "g-input g-search", placeholder: "Search German or English", value: query, onChange: (e) => {
      setQuery(e.target.value);
      setLimit(PAGE);
    } })), /* @__PURE__ */ React.createElement("div", { className: "g-chips", role: "group", "aria-label": "Filter" }, FILTERS.map(([k, label]) => /* @__PURE__ */ React.createElement(Chip, { key: k, pressed: filter === k, onClick: () => {
      setFilter(k);
      setLimit(PAGE);
    } }, label))), found.length ? /* @__PURE__ */ React.createElement("ul", { className: "g-list" }, found.slice(0, limit).map((c) => /* @__PURE__ */ React.createElement("li", { key: c.id }, /* @__PURE__ */ React.createElement("a", { href: `#/card/${c.id}` }, /* @__PURE__ */ React.createElement("span", { className: "t" }, /* @__PURE__ */ React.createElement("b", null, /* @__PURE__ */ React.createElement(Title, { card: c })), /* @__PURE__ */ React.createElement("span", null, subtitle(c))), /* @__PURE__ */ React.createElement("span", { className: "r" }, when(c, app.today))))), found.length > limit && /* @__PURE__ */ React.createElement("li", null, /* @__PURE__ */ React.createElement("button", { type: "button", onClick: () => setLimit((l) => l + PAGE) }, /* @__PURE__ */ React.createElement("span", { className: "g-muted" }, "Show more (", found.length - limit, ")")))) : /* @__PURE__ */ React.createElement(Empty, null, app.cards.length ? "No cards match." : "No cards yet. Add a word, or start today's cards to get suggested words."));
  }

  // german/Write.jsx
  var { useState: useState6, useEffect: useEffect5, useRef: useRef3 } = React;
  var OFFLINE_PROMPTS = [
    "Was hast du am Wochenende gemacht?",
    "Wie war dein Tag heute?",
    "Was hast du gestern gegessen?",
    "Was machst du morgen nach der Uni?",
    "Beschreib deinen Weg zur Uni.",
    "Was hast du letzte Woche Neues gelernt?"
  ];
  var quote = (p) => /^[„"]/.test(p) ? p : `\u201E${p}\u201C`;
  function Marked({ text: text2, fixes, focus }) {
    const parts = [];
    let rest = text2;
    let key = 0;
    for (const f of fixes) {
      const i = f.to ? rest.indexOf(f.to) : -1;
      if (i < 0) continue;
      parts.push(rest.slice(0, i));
      parts.push(/* @__PURE__ */ React.createElement("mark", { key: key++, className: f.point === focus ? "focus" : void 0 }, f.to));
      rest = rest.slice(i + f.to.length);
    }
    parts.push(rest);
    return /* @__PURE__ */ React.createElement(React.Fragment, null, parts);
  }
  var UMLAUTS = ["\xE4", "\xF6", "\xFC", "\xDF"];
  function UmlautKeys({ onType }) {
    const [upper, setUpper] = useState6(false);
    useEffect5(() => {
      const sync = (e) => setUpper(e.getModifierState("Shift") !== e.getModifierState("CapsLock"));
      window.addEventListener("keydown", sync);
      window.addEventListener("keyup", sync);
      return () => {
        window.removeEventListener("keydown", sync);
        window.removeEventListener("keyup", sync);
      };
    }, []);
    return /* @__PURE__ */ React.createElement("div", { className: "g-umlauts", role: "group", "aria-label": "Type umlauts" }, UMLAUTS.map((ch) => {
      const out = upper && ch !== "\xDF" ? ch.toUpperCase() : ch;
      return /* @__PURE__ */ React.createElement(
        "button",
        {
          key: ch,
          type: "button",
          tabIndex: -1,
          title: `Type ${out}`,
          onMouseDown: (e) => e.preventDefault(),
          onClick: (e) => onType(e.shiftKey && ch !== "\xDF" ? ch.toUpperCase() : out)
        },
        out
      );
    }));
  }
  function Feedback({ session, onFinish }) {
    var _a;
    const n = session.fixes.length;
    const title = n ? `${session.verdict} \u2014 ${n} ${n === 1 ? "fix" : "fixes"}` : `${session.verdict} \u2014 no fixes`;
    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("h2", { style: { fontSize: 18, fontWeight: 800 } }, title), /* @__PURE__ */ React.createElement("section", { className: "g-corrected", "aria-label": "Your text, corrected" }, /* @__PURE__ */ React.createElement(Marked, { text: session.corrected, fixes: session.fixes, focus: session.focus })), n > 0 && /* @__PURE__ */ React.createElement("ul", { className: "g-fixes", "aria-label": "Why" }, session.fixes.map((f, i) => /* @__PURE__ */ React.createElement("li", { key: i, className: f.point === session.focus ? "focus" : void 0 }, f.from && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("s", null, f.from), " \u2192 "), /* @__PURE__ */ React.createElement("span", { className: "to" }, f.to), /* @__PURE__ */ React.createElement("br", null), f.why))), ((_a = session.made) == null ? void 0 : _a.length) > 0 && /* @__PURE__ */ React.createElement("div", { className: "g-stack" }, /* @__PURE__ */ React.createElement(Label, null, "These become cards"), /* @__PURE__ */ React.createElement("ul", { className: "g-made" }, session.made.map((m) => /* @__PURE__ */ React.createElement("li", { key: m.id + m.type, className: m.type }, /* @__PURE__ */ React.createElement(Tag, { tone: m.type === "rule" ? "amber" : void 0 }, m.type === "rule" ? "Rule" : "Gap"), /* @__PURE__ */ React.createElement("span", null, m.label, m.repeat && /* @__PURE__ */ React.createElement("span", { className: "g-small" }, " \xB7 example added, card reset")))))), onFinish && /* @__PURE__ */ React.createElement("div", { className: "g-push" }, /* @__PURE__ */ React.createElement(Button, { variant: "mint", onClick: onFinish }, "Finish")));
  }
  function Write({ app }) {
    const { today, settings, writing } = app;
    const draft = app.draft && app.draft.day === today ? app.draft : null;
    const [busy, setBusy] = useState6(null);
    const [error, setError] = useState6(null);
    const answerRef = useRef3(null);
    const topicRef = useRef3(null);
    const lastField = useRef3("text");
    const setDraft = (patch) => app.setDraft((d) => ({ ...d, ...patch }));
    const fetchPrompt = () => {
      const recent = writing.map((s) => s.prompt);
      if (!app.session || !navigator.onLine) {
        const pick = OFFLINE_PROMPTS.find((p) => !recent.slice(0, 5).includes(p)) || OFFLINE_PROMPTS[0];
        setDraft({ prompt: pick });
        return;
      }
      setBusy("prompt");
      setError(null);
      writingPrompt(app.draft.focus, recent, settings).then((prompt2) => setDraft({ prompt: prompt2 })).catch((e) => {
        setError(e.message);
        setDraft({ prompt: OFFLINE_PROMPTS[Math.floor(Math.random() * OFFLINE_PROMPTS.length)] });
      }).finally(() => setBusy(null));
    };
    useEffect5(() => {
      if (!draft) {
        app.setDraft({ day: today, focus: nextFocus(writing, settings.level), prompt: null, own: false, topic: "", text: "", sessionId: null });
      } else if (!draft.prompt && !draft.own && busy !== "prompt") {
        fetchPrompt();
      }
    }, [draft == null ? void 0 : draft.day, draft == null ? void 0 : draft.prompt, draft == null ? void 0 : draft.own]);
    if (!draft) return /* @__PURE__ */ React.createElement(Screen, { center: true }, /* @__PURE__ */ React.createElement(Spinner, null));
    const point = pointById(draft.focus);
    const checked = draft.sessionId && writing.find((s) => s.id === draft.sessionId);
    const tasks = tasksFor(today, settings);
    const meta = tasks.includes("writing") && tasks.length > 1 ? `Task ${tasks.indexOf("writing") + 1} of ${tasks.length}` : null;
    const count = sentenceCount(draft.text);
    const prompt = draft.own ? `Own topic: ${draft.topic.trim() || "\u2026"}` : draft.prompt;
    const typeChar = (ch) => {
      const el = (lastField.current === "topic" && draft.own ? topicRef : answerRef).current;
      if (!el) return;
      el.focus();
      if (document.execCommand("insertText", false, ch)) return;
      el.setRangeText(ch, el.selectionStart, el.selectionEnd, "end");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const check = () => {
      if (!app.session) return setError("Sign in on the home page to check your German.");
      setBusy("check");
      setError(null);
      checkWriting({ text: draft.text.trim(), prompt, focus: draft.focus }, settings).then((result) => {
        const session = {
          id: uid(),
          day: today,
          at: Date.now(),
          prompt,
          own: draft.own,
          focus: draft.focus,
          text: draft.text.trim(),
          corrected: result.corrected,
          verdict: result.verdict,
          fixes: result.fixes
        };
        session.made = cardsFromCheck(app.cards, session).made;
        app.setCards((cs) => cardsFromCheck(cs, session).cards);
        app.setWriting((ws) => [session, ...ws]);
        setDraft({ sessionId: session.id });
        app.markDone("writing");
      }).catch((e) => setError(e.message)).finally(() => setBusy(null));
    };
    return /* @__PURE__ */ React.createElement(Screen, { wide: true, label: "Writing" }, /* @__PURE__ */ React.createElement(ScreenHeader, { close: "#/", title: "Writing", meta }), /* @__PURE__ */ React.createElement("div", { className: "g-write-cols" }, /* @__PURE__ */ React.createElement("section", { className: checked ? "g-hide-mobile" : void 0 }, /* @__PURE__ */ React.createElement(Card, null, draft.own ? /* @__PURE__ */ React.createElement("div", { className: "g-field" }, /* @__PURE__ */ React.createElement("label", { htmlFor: "topic" }, "Your topic"), /* @__PURE__ */ React.createElement("input", { id: "topic", ref: topicRef, onFocus: () => lastField.current = "topic", className: "g-input", style: { fontSize: 18, fontWeight: 700 }, placeholder: "z. B. meine Vorlesung heute", value: draft.topic, disabled: !!checked, onChange: (e) => setDraft({ topic: e.target.value }) })) : /* @__PURE__ */ React.createElement("p", { className: "g-prompt" }, draft.prompt ? quote(draft.prompt) : /* @__PURE__ */ React.createElement(Spinner, null)), point && /* @__PURE__ */ React.createElement("div", { className: "g-hint" }, point.hint, /* @__PURE__ */ React.createElement("br", null), /* @__PURE__ */ React.createElement("i", null, point.model)), !checked && /* @__PURE__ */ React.createElement("div", { className: "g-row", style: { gap: 16 } }, !draft.own && /* @__PURE__ */ React.createElement(LinkButton, { onClick: fetchPrompt }, busy === "prompt" ? "Getting a prompt\u2026" : "New prompt"), /* @__PURE__ */ React.createElement(LinkButton, { onClick: () => setDraft({ own: !draft.own }) }, draft.own ? "Use a prompt instead" : "Write about my own topic"))), /* @__PURE__ */ React.createElement("label", { htmlFor: "answer", className: "g-label" }, "Your sentences"), /* @__PURE__ */ React.createElement("textarea", { id: "answer", ref: answerRef, onFocus: () => lastField.current = "text", className: "g-write", lang: "de", spellCheck: "false", value: checked ? checked.text : draft.text, readOnly: !!checked, onChange: (e) => setDraft({ text: e.target.value }) }), /* @__PURE__ */ React.createElement("div", { className: "g-between" }, /* @__PURE__ */ React.createElement("span", { className: "g-small", style: { fontSize: 13, padding: "0 4px" } }, checked ? `${sentenceCount(checked.text)} sentences \xB7 checked` : `${count} ${count === 1 ? "sentence" : "sentences"} \xB7 aim for 3\u20135`), !checked && /* @__PURE__ */ React.createElement(UmlautKeys, { onType: typeChar })), error && /* @__PURE__ */ React.createElement("p", { className: "g-error", role: "alert" }, error), !checked && /* @__PURE__ */ React.createElement(Button, { variant: "amber", busy: busy === "check", disabled: !draft.text.trim() || draft.own && !draft.topic.trim(), onClick: check }, busy === "check" ? "Checking\u2026" : "Check my German")), checked && /* @__PURE__ */ React.createElement("section", { "aria-label": "Feedback" }, /* @__PURE__ */ React.createElement(Feedback, { session: checked, onFinish: () => go("#/") }))));
  }

  // german/History.jsx
  function shortDate(day) {
    const [y, m, d] = day.split("-").map(Number);
    const wd2 = new Date(y, m - 1, d).toLocaleDateString("de-DE", { weekday: "short" }).replace(".", "");
    return `${wd2} ${d}.${m}.`;
  }
  function Excerpt({ s }) {
    const marks = s.fixes.map((f) => f.to).filter(Boolean);
    if (!marks.length) return /* @__PURE__ */ React.createElement("p", null, s.corrected);
    const re = new RegExp(`(${marks.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`);
    return /* @__PURE__ */ React.createElement("p", null, s.corrected.split(re).map((part, i) => i % 2 ? /* @__PURE__ */ React.createElement("mark", { key: i }, part) : part));
  }
  function History({ app, sessionId }) {
    const { writing } = app;
    const open2 = sessionId && writing.find((s) => s.id === sessionId);
    if (open2) {
      return /* @__PURE__ */ React.createElement(Screen, { label: "Writing session" }, /* @__PURE__ */ React.createElement(ScreenHeader, { back: "#/history", title: shortDate(open2.day), big: true }), /* @__PURE__ */ React.createElement(Card, null, /* @__PURE__ */ React.createElement("p", { className: "g-prompt", style: { fontSize: 18 } }, open2.prompt), /* @__PURE__ */ React.createElement("p", { className: "g-muted", style: { fontSize: 15 } }, open2.text)), /* @__PURE__ */ React.createElement(Feedback, { session: open2 }));
    }
    const top = fixCounts(writing).slice(0, 3);
    return /* @__PURE__ */ React.createElement(Screen, { label: "Writing history" }, /* @__PURE__ */ React.createElement(ScreenHeader, { back: "#/progress", title: "Writing history", big: true }), top.length > 0 && /* @__PURE__ */ React.createElement(Card, { amber: true, label: "Recurring mistakes" }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, fontWeight: 700, color: "var(--amber)" } }, "Most frequent fixes"), /* @__PURE__ */ React.createElement("div", { className: "g-stack", style: { gap: 6 } }, top.map((t) => /* @__PURE__ */ React.createElement("div", { key: t.point, className: "g-between", style: { fontSize: 14 } }, /* @__PURE__ */ React.createElement("span", null, pointLabel(t.point)), /* @__PURE__ */ React.createElement("span", { style: { color: "var(--amber-muted)" } }, t.count, "\xD7"))))), writing.length ? writing.map((s) => /* @__PURE__ */ React.createElement("a", { key: s.id, href: `#/history/${s.id}`, className: "g-session", style: { textDecoration: "none" } }, /* @__PURE__ */ React.createElement("div", { className: "g-between g-small", style: { fontWeight: 600 } }, /* @__PURE__ */ React.createElement("span", null, shortDate(s.day)), /* @__PURE__ */ React.createElement("span", null, s.fixes.length, " ", s.fixes.length === 1 ? "fix" : "fixes", " \xB7 ", s.own ? "own topic" : `focus: ${pointLabel(s.focus)}`)), /* @__PURE__ */ React.createElement("b", { style: { fontSize: 15 } }, s.prompt), /* @__PURE__ */ React.createElement(Excerpt, { s }))) : /* @__PURE__ */ React.createElement(Empty, null, "Your writing sessions show up here."));
  }

  // german/Listening.jsx
  var { useState: useState7 } = React;
  var wd = (day) => {
    const [y, m, d] = day.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("de-DE", { weekday: "short" }).replace(".", "");
  };
  function AddResource({ onAdd, onCancel }) {
    const [r, setR] = useState7({ name: "", desc: "", level: "", url: "" });
    const set2 = (patch) => setR((v) => ({ ...v, ...patch }));
    return /* @__PURE__ */ React.createElement(Card, { label: "Add a resource" }, /* @__PURE__ */ React.createElement(Field, { id: "res-name", label: "Name" }, /* @__PURE__ */ React.createElement(Input, { id: "res-name", value: r.name, autoFocus: true, onChange: (v) => set2({ name: v }) })), /* @__PURE__ */ React.createElement("div", { className: "g-grid2" }, /* @__PURE__ */ React.createElement(Field, { id: "res-level", label: "Level" }, /* @__PURE__ */ React.createElement(Input, { id: "res-level", value: r.level, placeholder: "B1", onChange: (v) => set2({ level: v }) })), /* @__PURE__ */ React.createElement(Field, { id: "res-desc", label: "What it is" }, /* @__PURE__ */ React.createElement(Input, { id: "res-desc", value: r.desc, placeholder: "Podcast", onChange: (v) => set2({ desc: v }) }))), /* @__PURE__ */ React.createElement(Field, { id: "res-url", label: "Link" }, /* @__PURE__ */ React.createElement(Input, { id: "res-url", type: "url", value: r.url, placeholder: "https://", onChange: (v) => set2({ url: v }) })), /* @__PURE__ */ React.createElement("div", { className: "g-row" }, /* @__PURE__ */ React.createElement(Button, { size: "sm", variant: "mint", disabled: !r.name.trim(), onClick: () => onAdd({ id: uid(), name: r.name.trim(), desc: r.desc.trim(), level: r.level.trim(), url: r.url.trim() }) }, "Add"), /* @__PURE__ */ React.createElement(LinkButton, { onClick: onCancel }, "Cancel")));
  }
  function Listening({ app }) {
    const { listening, today } = app;
    const { resources, current: current3, log } = listening;
    const [adding, setAdding] = useState7(false);
    const res = resources.find((r) => r.id === current3);
    const idx = resources.indexOf(res);
    const save = (patch) => app.setListening((l) => ({ ...listening, ...patch }));
    const week = weekKeys(today);
    const weekLog = log.filter((e) => week.includes(e.day));
    const name = (e) => {
      var _a;
      return e.res === "podcast" ? `Podcast \xB7 ${e.title}` : ((_a = resources.find((r) => r.id === e.res)) == null ? void 0 : _a.name) || "Removed resource";
    };
    const logMinutes = (min) => {
      save({ log: [{ id: uid(), day: today, res: current3, min }, ...log] });
      app.showToast(`Logged ${min} min \xB7 ${res.name}`);
    };
    const move = (i, d) => {
      const next = [...resources];
      [next[i], next[i + d]] = [next[i + d], next[i]];
      save({ resources: next });
    };
    return /* @__PURE__ */ React.createElement(Screen, { label: "Listening" }, /* @__PURE__ */ React.createElement(ScreenHeader, { back: "#/progress", title: "Listening", big: true }), /* @__PURE__ */ React.createElement("p", { className: "g-muted", style: { margin: "0 4px" } }, "Aim to follow about 70%. German subtitles, not English. Doesn't count toward your daily time."), /* @__PURE__ */ React.createElement(NavList, { label: "Podcast", items: [{ href: "#/podcast", label: "AI podcast", note: "Episodes about your interests" }] }), res && /* @__PURE__ */ React.createElement(Card, { big: true, label: "Current resource" }, /* @__PURE__ */ React.createElement("div", { className: "g-between" }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, fontWeight: 700, color: "var(--mint)" } }, "Listening now"), res.level && /* @__PURE__ */ React.createElement(Tag, null, res.level)), /* @__PURE__ */ React.createElement("div", { className: "g-stack", style: { gap: 2 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 24, fontWeight: 800 } }, res.name), res.desc && /* @__PURE__ */ React.createElement("span", { className: "g-muted" }, res.desc)), /* @__PURE__ */ React.createElement("div", { className: "g-grid2", style: { gap: 8 } }, /* @__PURE__ */ React.createElement(Button, { size: "md", variant: "mint", onClick: () => logMinutes(15) }, "+15 min"), /* @__PURE__ */ React.createElement(Button, { size: "md", onClick: () => logMinutes(30) }, "+30 min")), /* @__PURE__ */ React.createElement("div", { className: "g-between" }, res.url ? /* @__PURE__ */ React.createElement(LinkButton, { href: res.url }, "Open \u2197") : /* @__PURE__ */ React.createElement("span", null), idx < resources.length - 1 && /* @__PURE__ */ React.createElement(Button, { size: "sm", variant: "outline", onClick: () => save({ current: resources[idx + 1].id }) }, "Feels easy \u2014 move up"))), /* @__PURE__ */ React.createElement("section", { "aria-label": "Your list", className: "g-stack" }, /* @__PURE__ */ React.createElement(Label, null, "Your list"), resources.length > 0 && /* @__PURE__ */ React.createElement("ul", { className: "g-list" }, resources.map((r, i) => /* @__PURE__ */ React.createElement("li", { key: r.id }, /* @__PURE__ */ React.createElement("div", { className: "g-between", style: { padding: "10px 8px 10px 18px", borderBottom: i < resources.length - 1 ? "1px solid var(--line)" : 0 } }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "t", style: { background: "none", border: 0, padding: 0, textAlign: "left", flex: 1 }, onClick: () => save({ current: r.id }), "aria-label": `Listen to ${r.name} now` }, /* @__PURE__ */ React.createElement("b", { style: { fontSize: 15, color: r.id === current3 ? "var(--mint)" : void 0 } }, r.name), /* @__PURE__ */ React.createElement("span", null, [r.level, r.desc].filter(Boolean).join(" \xB7 "))), /* @__PURE__ */ React.createElement("div", { className: "g-row", style: { gap: 0 } }, /* @__PURE__ */ React.createElement(IconButton, { icon: "up", label: `Move ${r.name} up`, variant: "ghost", small: true, disabled: i === 0, onClick: () => move(i, -1) }), /* @__PURE__ */ React.createElement(IconButton, { icon: "down", label: `Move ${r.name} down`, variant: "ghost", small: true, disabled: i === resources.length - 1, onClick: () => move(i, 1) }), /* @__PURE__ */ React.createElement(IconButton, { icon: "trash", label: `Remove ${r.name}`, variant: "ghost", small: true, iconSize: 16, onClick: () => save({ resources: resources.filter((x) => x.id !== r.id) }) })))))), adding ? /* @__PURE__ */ React.createElement(AddResource, { onCancel: () => setAdding(false), onAdd: (r) => {
      save({ resources: [...resources, r], current: current3 || r.id });
      setAdding(false);
    } }) : /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement(LinkButton, { mint: true, onClick: () => setAdding(true) }, "+ Add a resource"))), /* @__PURE__ */ React.createElement("section", { "aria-label": "This week", className: "g-stack", style: { gap: 6 } }, /* @__PURE__ */ React.createElement("div", { className: "g-between" }, /* @__PURE__ */ React.createElement(Label, null, "This week"), /* @__PURE__ */ React.createElement("span", { className: "g-small" }, minutesIn(log, week), " min")), weekLog.length ? weekLog.map((e) => /* @__PURE__ */ React.createElement("div", { key: e.id, className: "g-between", style: { fontSize: 14, padding: "0 4px" } }, /* @__PURE__ */ React.createElement("span", null, wd(e.day), " \xB7 ", name(e)), /* @__PURE__ */ React.createElement("span", { className: "g-row", style: { gap: 4, color: "var(--muted)" } }, e.min, " min", /* @__PURE__ */ React.createElement(IconButton, { icon: "close", label: "Remove this entry", variant: "ghost", small: true, iconSize: 14, onClick: () => save({ log: log.filter((x) => x.id !== e.id) }) })))) : /* @__PURE__ */ React.createElement("p", { className: "g-muted", style: { padding: "0 4px" } }, "Nothing logged yet this week.")));
  }

  // german/episodes.js
  var { useState: useState8, useEffect: useEffect6, useCallback: useCallback2 } = React;
  function readLocal2() {
    try {
      return JSON.parse(localStorage.getItem(KEYS.episodes)) || DEFAULT_EPISODES;
    } catch {
      return DEFAULT_EPISODES;
    }
  }
  function useEpisodes(session) {
    const [value, setValue] = useState8(readLocal2);
    const userId = session == null ? void 0 : session.user.id;
    const apply = useCallback2((v) => {
      setValue(v);
      try {
        localStorage.setItem(KEYS.episodes, JSON.stringify(v));
      } catch {
      }
    }, []);
    const refresh = useCallback2(async () => {
      if (!userId) return;
      const row = await apiFetch(`/api/data/${APP_ID}/${KEYS.episodes}`).catch(() => null);
      if (row) apply(row.value);
    }, [userId, apply]);
    useEffect6(() => {
      if (!userId) return;
      refresh();
      const unsubscribe = subscribe("data", (change) => {
        if (change.resync || change.app_id === APP_ID && change.key === KEYS.episodes) refresh();
      });
      const onVisible = () => document.visibilityState === "visible" && refresh();
      document.addEventListener("visibilitychange", onVisible);
      return () => {
        unsubscribe();
        document.removeEventListener("visibilitychange", onVisible);
      };
    }, [userId, refresh]);
    return [value, refresh];
  }

  // german/Podcast.jsx
  var { useState: useState9, useEffect: useEffect7, useRef: useRef4, Fragment } = React;
  var shortDate2 = (ms) => new Date(ms).toLocaleDateString("de-DE", { day: "numeric", month: "short" });
  var cardLabel = (c) => c.kind === "noun" ? `${c.article} ${c.de}` : c.de;
  function NewEpisode({ app, history: history2, pending, failed, onStarted }) {
    const { interests } = app.podcast;
    const [picked, setPicked] = useState9(null);
    const [adding, setAdding] = useState9(null);
    const [busy, setBusy] = useState9(false);
    const [error, setError] = useState9(null);
    const topic = interests.includes(picked) ? picked : null;
    const surprise = nextInterest(interests, history2);
    async function start(interest) {
      setBusy(true);
      setError(null);
      try {
        await startEpisode(interest, app.cards, app.writing, app.settings);
        await onStarted();
        setPicked(null);
      } catch (e) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    }
    const add = () => {
      const t = (adding || "").trim();
      if (t && !interests.includes(t)) app.setPodcast((p) => ({ ...p, interests: [...p.interests, t] }));
      if (t) setPicked(t);
      setAdding(null);
    };
    const remove = (t) => {
      app.setPodcast((p) => ({ ...p, interests: p.interests.filter((x) => x !== t) }));
      setPicked(null);
    };
    if (pending) {
      return /* @__PURE__ */ React.createElement(Card, { big: true, label: "New episode" }, /* @__PURE__ */ React.createElement("div", { className: "g-row" }, /* @__PURE__ */ React.createElement(Spinner, null), /* @__PURE__ */ React.createElement("b", null, "Making an episode about ", pending.interest, "\u2026")), /* @__PURE__ */ React.createElement("p", { className: "g-muted" }, "This takes a minute or two. You can close the app; the episode will be here when you're back."));
    }
    return /* @__PURE__ */ React.createElement(Card, { big: true, label: "New episode" }, /* @__PURE__ */ React.createElement("div", { className: "g-between", style: { alignItems: "baseline" } }, /* @__PURE__ */ React.createElement("b", { style: { fontSize: 17 } }, "New episode"), /* @__PURE__ */ React.createElement("span", { className: "g-small" }, "Lena & Jonas \xB7 3\u20134 min")), failed && /* @__PURE__ */ React.createElement("p", { className: "g-error" }, "The episode about ", failed.interest, " didn't work out: ", failed.error), /* @__PURE__ */ React.createElement("div", { className: "g-chips" }, interests.map((t) => /* @__PURE__ */ React.createElement(Chip, { key: t, pressed: t === topic, onClick: () => setPicked(t === topic ? null : t) }, t)), adding === null ? /* @__PURE__ */ React.createElement(Chip, { dashed: true, onClick: () => setAdding("") }, "+ Interest") : /* @__PURE__ */ React.createElement("form", { onSubmit: (e) => {
      e.preventDefault();
      add();
    }, style: { display: "flex" } }, /* @__PURE__ */ React.createElement("label", { htmlFor: "interest", className: "sr" }, "New interest"), /* @__PURE__ */ React.createElement("input", { id: "interest", className: "g-input", style: { minHeight: 36, padding: "0 12px", borderRadius: 999, width: 180 }, autoFocus: true, value: adding, placeholder: "e.g. AI safety", onChange: (e) => setAdding(e.target.value), onBlur: add }))), /* @__PURE__ */ React.createElement(Button, { variant: "mint", size: "md", busy, disabled: !app.session || !topic && !surprise, onClick: () => start(topic || surprise) }, topic ? `Make an episode about ${topic}` : surprise ? "Surprise me" : "Add an interest first"), topic && /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement(LinkButton, { onClick: () => remove(topic) }, "Remove \u201C", topic, "\u201D from your interests")), !app.session && /* @__PURE__ */ React.createElement("p", { className: "g-small" }, "Sign in on the home page to make episodes."), error && /* @__PURE__ */ React.createElement("p", { className: "g-error" }, error));
  }
  function AddWords({ app, items, onDone, onCancel }) {
    const [rows, setRows] = useState9(null);
    const [error, setError] = useState9(null);
    useEffect7(() => {
      let alive = true;
      wordsFromTranscript(items, app.settings).then((out) => alive && setRows(out.map((o) => ({ ...o, useAlt: false, skip: false })))).catch((e) => alive && setError(e.message));
      return () => {
        alive = false;
      };
    }, []);
    const chosen = (r) => r.useAlt && r.alt ? r.alt : r.main;
    const set2 = (i, patch) => setRows((rs) => rs.map((r, j) => j === i ? { ...r, ...patch } : r));
    const seen = /* @__PURE__ */ new Set();
    const adds = (rows || []).map((r) => {
      const c = chosen(r);
      const dup = !!findDuplicate(app.cards, c);
      const key = c.de.toLowerCase();
      const add2 = !r.skip && !dup && !seen.has(key);
      if (add2) seen.add(key);
      return { dup, add: add2 };
    });
    const count = adds.filter((a) => a.add).length;
    const add = () => {
      rows.forEach((r, i) => {
        if (!adds[i].add) return;
        const { sense, ...fields } = chosen(r);
        app.addCard(fields, "podcast");
      });
      app.showToast(`Added ${count} ${count === 1 ? "card" : "cards"}`);
      onDone();
    };
    return /* @__PURE__ */ React.createElement(Card, { label: "Add to your deck" }, /* @__PURE__ */ React.createElement("b", { style: { fontSize: 17 } }, "Add to your deck"), !rows && !error && /* @__PURE__ */ React.createElement("div", { className: "g-row" }, /* @__PURE__ */ React.createElement(Spinner, null), /* @__PURE__ */ React.createElement("span", { className: "g-muted" }, "Making cards\u2026")), error && /* @__PURE__ */ React.createElement("p", { className: "g-error" }, error), rows && /* @__PURE__ */ React.createElement("ul", { className: "g-picks" }, rows.map((r, i) => {
      const c = chosen(r);
      return /* @__PURE__ */ React.createElement("li", { key: i, className: adds[i].add ? void 0 : "off" }, /* @__PURE__ */ React.createElement("div", { className: "g-stack", style: { gap: 4, flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("b", null, c.kind === "noun" ? /* @__PURE__ */ React.createElement(Noun, { article: c.article }, c.de) : c.de), /* @__PURE__ */ React.createElement("span", { className: "g-small" }, c.en, adds[i].dup ? " \xB7 already in your deck" : ""), r.alt && /* @__PURE__ */ React.createElement("div", { className: "g-chips" }, /* @__PURE__ */ React.createElement(Chip, { pressed: !r.useAlt, onClick: () => set2(i, { useAlt: false }) }, cardLabel(r.main)), /* @__PURE__ */ React.createElement(Chip, { pressed: r.useAlt, onClick: () => set2(i, { useAlt: true }) }, cardLabel(r.alt)))), !adds[i].dup && /* @__PURE__ */ React.createElement(IconButton, { icon: r.skip ? "plus" : "close", label: r.skip ? `Add ${cardLabel(c)}` : `Skip ${cardLabel(c)}`, variant: "ghost", small: true, onClick: () => set2(i, { skip: !r.skip }) }));
    })), /* @__PURE__ */ React.createElement("div", { className: "g-row" }, /* @__PURE__ */ React.createElement(Button, { size: "sm", variant: "mint", disabled: !count, onClick: add }, "Add ", count, " ", count === 1 ? "card" : "cards"), /* @__PURE__ */ React.createElement(LinkButton, { onClick: onCancel }, "Cancel")));
  }
  function EpisodeView({ app, ep }) {
    var _a;
    const [url, setUrl] = useState9(null);
    const [loadError, setLoadError] = useState9(null);
    const [rate, setRate] = useState9(1);
    const [showText, setShowText] = useState9(false);
    const [picks, setPicks] = useState9({});
    const [reviewing, setReviewing] = useState9(false);
    const audio = useRef4(null);
    const signedIn = !!app.session;
    useEffect7(() => {
      let alive = true;
      let objectUrl;
      setLoadError(null);
      episodeAudio(ep.path, app.session).then((blob) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      }).catch((e) => alive && setLoadError(e.message));
      return () => {
        alive = false;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
    }, [ep.path, signedIn]);
    useEffect7(() => {
      if (audio.current) audio.current.playbackRate = rate;
    }, [rate, url]);
    const listened = app.listening.log.some((e) => e.episode === ep.id && e.day === app.today);
    const toggle = (key, pick) => setPicks((p) => {
      const next = { ...p };
      if (next[key]) delete next[key];
      else next[key] = pick;
      return next;
    });
    const lineWith = (word) => {
      var _a2;
      const stem = word.replace(/^(der|die|das)\s+/i, "").toLowerCase();
      return ((_a2 = ep.lines.find((l) => l.text.toLowerCase().includes(stem))) == null ? void 0 : _a2.text) || "";
    };
    const picked = Object.values(picks);
    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Card, { big: true, label: "Episode" }, /* @__PURE__ */ React.createElement("div", { className: "g-stack", style: { gap: 2 } }, /* @__PURE__ */ React.createElement("span", { className: "g-small" }, ep.interest, " \xB7 ", shortDate2(ep.started), " \xB7 ", episodeMinutes(ep), " min", listened ? " \xB7 listened today" : ""), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 22, fontWeight: 800, letterSpacing: "-0.01em" } }, ep.title)), url ? /* @__PURE__ */ React.createElement("audio", { ref: audio, src: url, controls: true, preload: "metadata", style: { width: "100%" }, onEnded: () => app.finishEpisode(ep) }) : loadError ? /* @__PURE__ */ React.createElement("p", { className: "g-error" }, loadError) : /* @__PURE__ */ React.createElement("div", { className: "g-row" }, /* @__PURE__ */ React.createElement(Spinner, null), /* @__PURE__ */ React.createElement("span", { className: "g-muted" }, "Loading the episode\u2026")), /* @__PURE__ */ React.createElement("div", { className: "g-between" }, /* @__PURE__ */ React.createElement("div", { style: { width: 210 } }, /* @__PURE__ */ React.createElement(Choice, { label: "Speed", value: rate, onChange: setRate, options: [[0.75, "0.75\xD7"], [0.9, "0.9\xD7"], [1, "1\xD7"]] })), !listened && /* @__PURE__ */ React.createElement(LinkButton, { mint: true, onClick: () => app.finishEpisode(ep) }, "Mark as listened"))), ((_a = ep.keyWords) == null ? void 0 : _a.length) > 0 && /* @__PURE__ */ React.createElement("section", { "aria-label": "Key words", className: "g-stack" }, /* @__PURE__ */ React.createElement(Label, null, "Key words \xB7 tap to pick"), /* @__PURE__ */ React.createElement("ul", { className: "g-list" }, ep.keyWords.map((k, i) => /* @__PURE__ */ React.createElement("li", { key: i }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "g-kw", "aria-pressed": !!picks[`k${i}`], onClick: () => toggle(`k${i}`, { word: k.de, sentence: lineWith(k.de) }) }, /* @__PURE__ */ React.createElement("span", { className: "t" }, /* @__PURE__ */ React.createElement("b", null, k.de), /* @__PURE__ */ React.createElement("span", null, k.en)), /* @__PURE__ */ React.createElement("span", { className: "r" }, picks[`k${i}`] ? "Picked" : "")))))), /* @__PURE__ */ React.createElement("section", { "aria-label": "Transcript", className: "g-stack" }, /* @__PURE__ */ React.createElement("div", { className: "g-between" }, /* @__PURE__ */ React.createElement(Label, null, "Transcript"), /* @__PURE__ */ React.createElement(LinkButton, { mint: true, onClick: () => setShowText((v) => !v) }, showText ? "Hide" : "Show")), showText && /* @__PURE__ */ React.createElement(Card, { className: "g-transcript" }, /* @__PURE__ */ React.createElement("p", { className: "g-small" }, "Tap words to pick them for your deck."), ep.lines.map((l, li) => /* @__PURE__ */ React.createElement("p", { key: li }, /* @__PURE__ */ React.createElement("b", { className: l.speaker === "Lena" ? "lena" : "jonas" }, l.speaker), " ", tokenize(l.text).map((t, ti) => /* @__PURE__ */ React.createElement(Fragment, { key: ti }, t.pre, t.word && /* @__PURE__ */ React.createElement("button", { type: "button", className: "g-word", "aria-pressed": !!picks[`${li}:${ti}`], onClick: () => toggle(`${li}:${ti}`, { word: t.word, sentence: l.text }) }, t.word), t.post, " ")))))), reviewing ? /* @__PURE__ */ React.createElement(AddWords, { app, items: picked, onCancel: () => setReviewing(false), onDone: () => {
      setPicks({});
      setReviewing(false);
    } }) : picked.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "g-selbar", role: "region", "aria-label": "Picked words" }, /* @__PURE__ */ React.createElement("span", null, picked.length, " ", picked.length === 1 ? "word" : "words", " picked"), /* @__PURE__ */ React.createElement(LinkButton, { onClick: () => setPicks({}) }, "Clear"), /* @__PURE__ */ React.createElement(Button, { size: "sm", variant: "mint", disabled: !signedIn, onClick: () => setReviewing(true) }, "Add to deck")));
  }
  function Podcast({ app, episodeId }) {
    var _a;
    const [data, refresh] = useEpisodes(app.session);
    const { episodes, history: history2 } = normEpisodes(data);
    const pending = episodes.find((e) => e.status === "generating");
    const failed = ((_a = episodes[0]) == null ? void 0 : _a.status) === "failed" ? episodes[0] : null;
    const ready = episodes.filter((e) => e.status === "ready");
    const shown = episodeId ? ready.find((e) => e.id === episodeId) : ready[0];
    const readyIds = ready.map((e) => e.id).join();
    useEffect7(() => {
      if (!pending) return;
      const t = setInterval(refresh, 15 * 1e3);
      return () => clearInterval(t);
    }, [pending == null ? void 0 : pending.id, refresh]);
    useEffect7(() => {
      if (ready.length) forgetEpisodes(ready.map((e) => e.path));
    }, [readyIds]);
    const others = ready.filter((e) => e !== shown);
    return /* @__PURE__ */ React.createElement(Screen, { label: "Podcast" }, /* @__PURE__ */ React.createElement(ScreenHeader, { back: "#/", title: "Podcast", big: true }), /* @__PURE__ */ React.createElement(NewEpisode, { app, history: history2, pending, failed, onStarted: refresh }), shown ? /* @__PURE__ */ React.createElement(EpisodeView, { key: shown.id, app, ep: shown }) : episodeId ? /* @__PURE__ */ React.createElement(Empty, null, "That episode is gone; only the last 10 are kept.") : !pending && /* @__PURE__ */ React.createElement(Empty, null, "No episodes yet. Pick an interest and make your first one."), others.length > 0 && /* @__PURE__ */ React.createElement("section", { "aria-label": "Earlier episodes", className: "g-stack" }, /* @__PURE__ */ React.createElement(Label, null, "Earlier episodes"), /* @__PURE__ */ React.createElement("ul", { className: "g-list" }, others.map((e) => /* @__PURE__ */ React.createElement("li", { key: e.id }, /* @__PURE__ */ React.createElement("a", { href: `#/podcast/${e.id}` }, /* @__PURE__ */ React.createElement("span", { className: "t" }, /* @__PURE__ */ React.createElement("b", null, e.title), /* @__PURE__ */ React.createElement("span", null, e.interest, " \xB7 ", shortDate2(e.started))), /* @__PURE__ */ React.createElement("span", { className: "r" }, episodeMinutes(e), " min")))))));
  }

  // german/Progress.jsx
  var fmtMinutes = (m) => m < 60 ? `${m} min` : `${(m / 60).toFixed(1).replace(/\.0$/, "")} h`;
  var LINKS = [
    { href: "#/deck", label: "Deck", note: "Browse and edit cards" },
    { href: "#/listening", label: "Listening", note: "Podcast, resources and log" },
    { href: "#/history", label: "Writing history", note: "Past texts and fixes" },
    { href: "#/settings", label: "Settings", note: "Level, topics, routine" }
  ];
  function Progress({ app }) {
    const s = stats(app.cards, app.writing, app.listening, app.log, app.today);
    const current3 = app.listening.resources.find((r) => r.id === app.listening.current);
    return /* @__PURE__ */ React.createElement(Screen, { tab: true, wide: true, label: "Progress" }, /* @__PURE__ */ React.createElement("h1", { className: "g-title g-mobile-only" }, "Progress"), /* @__PURE__ */ React.createElement(Card, { label: "This week" }, /* @__PURE__ */ React.createElement("div", { className: "g-between", style: { alignItems: "baseline" } }, /* @__PURE__ */ React.createElement("span", { style: { fontWeight: 700, fontSize: 15 } }, "This week"), /* @__PURE__ */ React.createElement("span", { className: "g-small", style: { fontSize: 13 } }, s.cardDays, " card ", s.cardDays === 1 ? "day" : "days", " \xB7 ", s.writingDays, " writing")), /* @__PURE__ */ React.createElement("div", { className: "g-week" }, s.week.map((d, i) => /* @__PURE__ */ React.createElement("div", { key: d.key }, /* @__PURE__ */ React.createElement("span", { className: ["sq", d.cards && "cards", d.writing && "writing", d.future && !d.cards && !d.writing && "future"].filter(Boolean).join(" ") }), /* @__PURE__ */ React.createElement("span", { className: d.key === app.today ? "today" : void 0 }, WEEKDAYS[i])))), /* @__PURE__ */ React.createElement("div", { className: "g-legend" }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("i", null), "Cards"), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("i", { className: "amber" }), "Writing"))), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 } }, /* @__PURE__ */ React.createElement(Stat, { label: "Cards learned", value: s.learned, note: `${s.dueTomorrow} due tomorrow` }), /* @__PURE__ */ React.createElement(Stat, { label: "Listening", value: fmtMinutes(s.listeningMin), note: current3 ? `this week \xB7 ${current3.name}` : "this week" }), /* @__PURE__ */ React.createElement("div", { className: "g-hide-mobile", style: { display: "contents" } }, /* @__PURE__ */ React.createElement(Stat, { label: "Writing sessions", value: s.writingSessions, note: s.topFix ? `Most common fix: ${pointLabel(s.topFix.point)}` : null }))), /* @__PURE__ */ React.createElement(NavList, { label: "More", items: LINKS }));
  }

  // german/Settings.jsx
  var { useState: useState10 } = React;
  function exportCards(cards) {
    const clean = (v) => (v || "").replace(/[\t\n]+/g, " ").trim();
    const rows = cards.filter((c) => c.kind !== "rule").map((c) => [germanOf(c), c.kind === "noun" ? [c.en, c.plural].filter(Boolean).join(" \xB7 ") : c.en, c.example].map(clean).join("	"));
    const blob = new Blob([["German	English	Example", ...rows].join("\n")], { type: "text/tab-separated-values" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `deutsch-cards-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.tsv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1e3);
  }
  function Settings({ app }) {
    const { settings, setSettings } = app;
    const [topic, setTopic] = useState10(null);
    const update2 = (patch) => setSettings((s) => ({ ...s, ...patch }));
    const addTopic = () => {
      const t = (topic || "").trim();
      if (t && !settings.topics.includes(t)) update2({ topics: [...settings.topics, t] });
      setTopic(null);
    };
    const toggleDay = (field, i) => update2({
      [field]: settings[field].includes(i) ? settings[field].filter((d) => d !== i) : [...settings[field], i].sort()
    });
    return /* @__PURE__ */ React.createElement(Screen, { label: "Settings" }, /* @__PURE__ */ React.createElement(ScreenHeader, { back: "#/progress", title: "Settings", big: true }), /* @__PURE__ */ React.createElement(Card, { label: "Level and topics" }, /* @__PURE__ */ React.createElement("div", { className: "g-setting" }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("label", { htmlFor: "level" }, /* @__PURE__ */ React.createElement("b", null, "Your level")), /* @__PURE__ */ React.createElement("span", { className: "g-small" }, "Words, prompts, examples, corrections")), /* @__PURE__ */ React.createElement("select", { id: "level", className: "g-input", value: settings.level, onChange: (e) => update2({ level: e.target.value }) }, LEVELS.map((l) => /* @__PURE__ */ React.createElement("option", { key: l }, l)))), /* @__PURE__ */ React.createElement("span", { className: "g-muted", style: { fontSize: 13 } }, "Topics for new words (mixed with general words)"), /* @__PURE__ */ React.createElement("div", { className: "g-chips" }, settings.topics.map((t) => /* @__PURE__ */ React.createElement(Chip, { key: t, removeLabel: `Remove ${t}`, onRemove: () => update2({ topics: settings.topics.filter((x) => x !== t) }) }, t)), topic === null ? /* @__PURE__ */ React.createElement(Chip, { dashed: true, onClick: () => setTopic("") }, "+ Topic") : /* @__PURE__ */ React.createElement("form", { onSubmit: (e) => {
      e.preventDefault();
      addTopic();
    }, style: { display: "flex" } }, /* @__PURE__ */ React.createElement("label", { htmlFor: "topic", className: "sr" }, "New topic"), /* @__PURE__ */ React.createElement("input", { id: "topic", className: "g-input", style: { minHeight: 36, padding: "0 12px", borderRadius: 999, width: 160 }, autoFocus: true, value: topic, onChange: (e) => setTopic(e.target.value), onBlur: addTopic })))), /* @__PURE__ */ React.createElement(Card, { label: "Routine" }, /* @__PURE__ */ React.createElement("b", { style: { fontSize: 15 } }, "Writing days"), /* @__PURE__ */ React.createElement("div", { className: "g-days", role: "group", "aria-label": "Writing days" }, WEEKDAYS.map((d, i) => /* @__PURE__ */ React.createElement("button", { key: d, type: "button", "aria-pressed": settings.writingDays.includes(i), onClick: () => toggleDay("writingDays", i) }, d))), /* @__PURE__ */ React.createElement("b", { style: { fontSize: 15 } }, "Podcast days"), /* @__PURE__ */ React.createElement("div", { className: "g-days", role: "group", "aria-label": "Podcast days" }, WEEKDAYS.map((d, i) => /* @__PURE__ */ React.createElement("button", { key: d, type: "button", "aria-pressed": settings.podcastDays.includes(i), onClick: () => toggleDay("podcastDays", i) }, d))), /* @__PURE__ */ React.createElement("span", { className: "g-small" }, "Cards are every weekday; weekends are optional.")), /* @__PURE__ */ React.createElement(Card, { label: "Podcast" }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("b", { style: { fontSize: 15 } }, "Podcast pace"), /* @__PURE__ */ React.createElement("span", { className: "g-small", style: { display: "block" } }, "How fast new episodes are spoken")), /* @__PURE__ */ React.createElement(Choice, { label: "Podcast pace", value: settings.podcastPace, onChange: (v) => update2({ podcastPace: v }), options: [["slowest", "Slowest"], ["slower", "Slower"], ["natural", "Natural"]] })), /* @__PURE__ */ React.createElement(Card, { tight: true, label: "Cards" }, /* @__PURE__ */ React.createElement("div", { className: "g-setting" }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("b", null, "New cards per day"), /* @__PURE__ */ React.createElement("span", { className: "g-small" }, "Your words first, AI fills the rest")), /* @__PURE__ */ React.createElement(Stepper, { value: settings.newPerDay, onChange: (n) => update2({ newPerDay: n }) }))), /* @__PURE__ */ React.createElement("nav", { className: "g-navlist", "aria-label": "Data", style: { display: "flex" } }, /* @__PURE__ */ React.createElement("button", { type: "button", onClick: () => exportCards(app.cards), disabled: !app.cards.length }, "Export cards"), app.session ? /* @__PURE__ */ React.createElement("button", { type: "button", className: "danger", onClick: () => signOut() }, "Sign out") : /* @__PURE__ */ React.createElement("a", { href: "./" }, "Sign in on the home page")));
  }

  // german/App.jsx
  var { useState: useState11, useEffect: useEffect8, useRef: useRef5, useMemo: useMemo3 } = React;
  var NONE = [];
  var NO_LOG = {};
  function useToday() {
    const [key, setKey] = useState11(() => dayKey());
    useEffect8(() => {
      const t = setInterval(() => setKey(dayKey()), 60 * 1e3);
      return () => clearInterval(t);
    }, []);
    return key;
  }
  var TABS = [["", "Today", "today"], ["progress", "Progress", "progress"]];
  function TopBar({ route }) {
    return /* @__PURE__ */ React.createElement("header", { className: "g-topbar" }, /* @__PURE__ */ React.createElement("a", { className: "g-brand", href: "#/" }, /* @__PURE__ */ React.createElement("span", { className: "g-brand-mark" }, "D"), "Deutsch"), /* @__PURE__ */ React.createElement("div", { className: "g-topbar-right" }, /* @__PURE__ */ React.createElement("nav", { className: "g-seg", "aria-label": "Main" }, TABS.map(([name, label]) => /* @__PURE__ */ React.createElement("a", { key: label, href: `#/${name}`, "aria-current": route.name === name ? "page" : void 0 }, label))), /* @__PURE__ */ React.createElement("a", { className: "g-pill-link", href: "#/add" }, /* @__PURE__ */ React.createElement(Icon, { name: "plus", size: 16, stroke: 2.4 }), "Word")));
  }
  function TabBar({ route }) {
    return /* @__PURE__ */ React.createElement("nav", { className: "g-tabbar", "aria-label": "Main" }, TABS.map(([name, label, icon]) => /* @__PURE__ */ React.createElement("a", { key: label, href: `#/${name}`, "aria-current": route.name === name ? "page" : void 0 }, /* @__PURE__ */ React.createElement(Icon, { name: icon, size: 24, stroke: 2 }), label)));
  }
  function GermanApp() {
    const session = useSession();
    const route = useRoute();
    const today = useToday();
    useScrollTop(`${route.name}/${route.param}`);
    const [cards, setCards, cardsConflict] = useSyncedStorage(APP_ID, KEYS.cards, NONE);
    const [suggest, setSuggest] = useSyncedStorage(APP_ID, KEYS.suggest, NONE);
    const [writing, setWriting, writingConflict] = useSyncedStorage(APP_ID, KEYS.writing, NONE);
    const [draft, setDraft] = useSyncedStorage(APP_ID, KEYS.draft, null);
    const [log, setLog] = useSyncedStorage(APP_ID, KEYS.log, NO_LOG);
    const [storedListening, setListening] = useSyncedStorage(APP_ID, KEYS.listening, DEFAULT_LISTENING);
    const [storedPodcast, setPodcast] = useSyncedStorage(APP_ID, KEYS.podcast, DEFAULT_PODCAST);
    const [storedSettings, setSettings] = useSyncedStorage(APP_ID, KEYS.settings, DEFAULT_SETTINGS);
    const settings = useMemo3(() => normSettings(storedSettings), [storedSettings]);
    const listening = useMemo3(() => normListening(storedListening), [storedListening]);
    const podcast = useMemo3(() => normPodcast(storedPodcast, settings), [storedPodcast, settings]);
    const [toast, setToast] = useState11(null);
    const toastT = useRef5(null);
    function showToast(msg) {
      clearTimeout(toastT.current);
      setToast(msg);
      toastT.current = setTimeout(() => setToast(null), 2400);
    }
    const fitKey = `${settings.level}|${settings.topics.join(",")}`;
    const usable = useMemo3(() => suggest.filter((s) => s.for === fitKey), [suggest, fitKey]);
    const [refilling, setRefilling] = useState11(false);
    const [retry, setRetry] = useState11(0);
    const cardsRef = useRef5(cards);
    cardsRef.current = cards;
    useEffect8(() => {
      const missing = SUGGEST_BUFFER - usable.length;
      if (!session || missing <= 0 || refilling || !navigator.onLine) return;
      setRefilling(true);
      const known = [...cardsRef.current.map((c) => c.de), ...usable.map((s) => s.de)].filter(Boolean);
      let retryT;
      suggestWords(missing, known, settings).then((words) => {
        const fresh = words.filter((w) => !findDuplicate(cardsRef.current, w)).map(({ sense, ...w }) => ({ ...w, for: fitKey }));
        setSuggest((s) => {
          const keep = s.filter((x) => x.for === fitKey);
          return [...keep, ...fresh.filter((w) => !keep.some((x) => x.de === w.de))].slice(0, SUGGEST_BUFFER * 2);
        });
      }).catch(() => {
        retryT = setTimeout(() => setRetry((n) => n + 1), 60 * 1e3);
      }).finally(() => setRefilling(false));
      return () => clearTimeout(retryT);
    }, [session, usable.length, fitKey, retry]);
    const app = {
      session,
      today,
      route,
      settings,
      cards,
      writing,
      draft,
      log,
      listening,
      podcast,
      showToast,
      // Suggested words that fit the current level and topics, and whether
      // more are on their way.
      suggest: usable,
      refilling,
      setCards,
      setSuggest,
      setWriting,
      setDraft,
      setListening,
      setSettings: (fn) => setSettings((s) => typeof fn === "function" ? fn(normSettings(s)) : fn),
      setPodcast: (fn) => setPodcast((p) => fn(normPodcast(p, settings))),
      // Marks one of today's tasks as done.
      markDone: (task) => setLog((l) => ({ ...l, [today]: { ...l[today] || {}, [task]: true } })),
      // A podcast episode was listened to: logs its minutes and ticks off
      // today's podcast task.
      finishEpisode(ep) {
        setListening((l) => logEpisode(normListening(l), ep, today));
        app.markDone("podcast");
        showToast(`Logged ${episodeMinutes(ep)} min \xB7 ${ep.title}`);
      },
      // Adds a card unless the same German word is already in the deck.
      addCard(fields, source2) {
        const dup = findDuplicate(cards, fields);
        if (dup) return { card: dup, duplicate: true };
        const card = makeCard(fields, source2);
        setCards((cs) => [card, ...cs]);
        return { card, duplicate: false };
      },
      updateCard: (id, fn) => setCards((cs) => cs.map((c) => c.id === id ? fn(c) : c)),
      deleteCard: (id) => setCards((cs) => cs.filter((c) => c.id !== id))
    };
    const conflict = cardsConflict || writingConflict;
    let screen;
    let tabs = false;
    switch (route.name) {
      case "cards":
        screen = /* @__PURE__ */ React.createElement(Review, { app });
        break;
      case "write":
        screen = /* @__PURE__ */ React.createElement(Write, { app });
        break;
      case "add":
        screen = /* @__PURE__ */ React.createElement(CardEditor, { key: "new", app });
        break;
      case "card":
        screen = /* @__PURE__ */ React.createElement(CardEditor, { key: route.param, app, cardId: route.param });
        break;
      case "deck":
        screen = /* @__PURE__ */ React.createElement(Deck, { app });
        break;
      case "history":
        screen = /* @__PURE__ */ React.createElement(History, { app, sessionId: route.param });
        break;
      case "listening":
        screen = /* @__PURE__ */ React.createElement(Listening, { app });
        break;
      case "podcast":
        screen = /* @__PURE__ */ React.createElement(Podcast, { app, episodeId: route.param });
        break;
      case "settings":
        screen = /* @__PURE__ */ React.createElement(Settings, { app });
        break;
      case "progress":
        screen = /* @__PURE__ */ React.createElement(Progress, { app });
        tabs = true;
        break;
      default:
        screen = /* @__PURE__ */ React.createElement(Today, { app });
        tabs = true;
    }
    return /* @__PURE__ */ React.createElement("div", { className: "g-shell" }, conflict && /* @__PURE__ */ React.createElement("div", { className: "g-banner", role: "alert" }, /* @__PURE__ */ React.createElement("span", null, "Your ", cardsConflict ? "cards" : "writing", " changed on another device."), /* @__PURE__ */ React.createElement("button", { onClick: conflict.keepRemote }, "Use theirs"), /* @__PURE__ */ React.createElement("button", { onClick: conflict.keepLocal }, "Keep mine")), tabs && /* @__PURE__ */ React.createElement(TopBar, { route }), screen, tabs && /* @__PURE__ */ React.createElement(TabBar, { route }), /* @__PURE__ */ React.createElement(Toast, { message: toast }));
  }

  // german-app.jsx
  ReactDOM.createRoot(document.getElementById("app")).render(/* @__PURE__ */ React.createElement(GermanApp, null));
})();
