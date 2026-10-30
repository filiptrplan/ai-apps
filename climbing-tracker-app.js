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

  // shared/events.js
  var RETRY_MS = 3e4;
  var subs = /* @__PURE__ */ new Set();
  var source = null;
  var openTopics = "";
  var queued = false;
  var forced = false;
  var retryTimer = null;
  function wantedTopics() {
    return [...new Set([...subs].map((s2) => s2.topic))].sort().join(",");
  }
  function dispatch(change2) {
    const topic = change2.resync ? null : change2.table === "app_data" ? "data" : "mo";
    for (const s2 of [...subs]) if (!topic || s2.topic === topic) s2.fn(change2);
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
      let change2;
      try {
        change2 = JSON.parse(e.data);
      } catch {
        return;
      }
      dispatch(change2);
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
      function onChange(change2) {
        if (change2.resync) {
          pullOnce();
          return;
        }
        if (change2.app_id !== appId || change2.key !== key) return;
        if (localStorage.getItem(markerKey(key)) === change2.updated_at) return;
        if (pushQueueRef.current.written.includes(change2.updated_at)) return;
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

  // climbing-tracker/data.js
  var APP_ID = "climbing-tracker";
  var STORAGE_KEYS = {
    exercises: "climbing-tracker-exercises",
    routines: "climbing-tracker-routines",
    history: "climbing-tracker-history",
    settings: "climbing-tracker-settings",
    plan: "climbing-tracker-plan",
    categories: "climbing-tracker-categories"
  };
  function uid() {
    return globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  // climbing-tracker/storage.js
  function useStorage(key, fallback) {
    return useSyncedStorage(APP_ID, key, fallback);
  }

  // climbing-tracker/format.js
  var EXERCISE_TYPES = [
    { value: "reps", label: "Reps" },
    { value: "weighted", label: "Weighted" },
    { value: "interval", label: "Interval" },
    { value: "weightedInterval", label: "Interval +kg" }
  ];
  function isIntervalType(type) {
    return type === "interval" || type === "weightedInterval";
  }
  function defaultFieldsForType(type) {
    if (type === "weighted") return { sets: 3, reps: 5, weight: 10, weightMode: "added", restSec: 0 };
    if (type === "interval") return { workSec: 10, restSec: 5, sets: 6 };
    if (type === "weightedInterval") return { workSec: 10, restSec: 5, sets: 6, weight: 5, weightMode: "added" };
    return { sets: 3, reps: 10, restSec: 0 };
  }
  function formatWeightLabel(weightMode, weight) {
    return weightMode === "added" ? `BW +${weight}kg` : `${weight}kg`;
  }
  function formatTargetSummary(ex) {
    const restPart = !isIntervalType(ex.type) && ex.restSec > 0 ? ` \xB7 ${ex.restSec}s rest` : "";
    if (isIntervalType(ex.type)) {
      const weightPart = ex.type === "weightedInterval" ? ` @ ${formatWeightLabel(ex.weightMode, ex.weight)}` : "";
      return (ex.supersetGroup ? `${ex.sets} sets \xB7 ${ex.workSec}s on` : `${ex.sets} sets \xB7 ${ex.workSec}s on / ${ex.restSec}s off`) + weightPart;
    }
    if (ex.targetSets) {
      const isWeighted = ex.type === "weighted";
      return `${ex.targetSets.length} sets: ${formatSetsPattern(ex.targetSets, isWeighted)}${isWeighted ? "" : " reps"}${restPart}`;
    }
    if (ex.type === "weighted") return `${ex.sets} \xD7 ${ex.reps} reps @ ${formatWeightLabel(ex.weightMode, ex.weight)}${restPart}`;
    return `${ex.sets} \xD7 ${ex.reps} reps${restPart}`;
  }
  function formatDate(iso) {
    const d2 = new Date(iso);
    return d2.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) + " " + d2.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }
  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s2 = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s2).padStart(2, "0")}`;
  }
  function formatDuration(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor(sec % 3600 / 60);
    const s2 = sec % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s2}s`;
    return `${s2}s`;
  }
  function stripCodeFence(text) {
    const trimmed = text.trim();
    const match = trimmed.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
    return match ? match[1] : trimmed;
  }
  function groupByCategory(exercises, categories) {
    const known = new Set(categories.map((c) => c.id));
    const groups = categories.map((category) => ({ category, exercises: exercises.filter((e) => e.categoryId === category.id) })).filter((g) => g.exercises.length > 0);
    const rest = exercises.filter((e) => !known.has(e.categoryId));
    return rest.length > 0 ? [...groups, { category: null, exercises: rest }] : groups;
  }
  function mergeById(existing, incoming) {
    const result = [...existing];
    incoming.forEach((item) => {
      if (!item) return;
      const withId = item.id ? item : { ...item, id: uid() };
      const idx = result.findIndex((e) => e.id === withId.id);
      if (idx >= 0) result[idx] = withId;
      else result.push(withId);
    });
    return result;
  }
  function isStepComplete(exercise, log) {
    var _a, _b;
    if (!log) return false;
    if (isIntervalType(exercise.type)) {
      const target = (_b = (_a = log.targetSets) != null ? _a : exercise.sets) != null ? _b : 1;
      return (log.completedSets || 0) >= target;
    }
    const rows = log.rows || [];
    return rows.length > 0 && rows.every((r) => r.done);
  }
  function buildPerformedFromLog(exercise, log) {
    var _a, _b, _c, _d, _e;
    if (!log) return null;
    if (isIntervalType(exercise.type)) {
      if (!log.completedSets) return null;
      return {
        type: exercise.type,
        workSec: (_a = log.workSec) != null ? _a : exercise.workSec,
        restSec: (_b = log.restSec) != null ? _b : exercise.restSec,
        targetSets: (_c = log.targetSets) != null ? _c : exercise.sets,
        completedSets: log.completedSets,
        ...exercise.type === "weightedInterval" && {
          weight: Number((_d = log.weight) != null ? _d : exercise.weight) || 0,
          weightMode: exercise.weightMode
        }
      };
    }
    const doneRows = (log.rows || []).filter((r) => r.done);
    if (doneRows.length === 0) return null;
    const rest = exercise.supersetGroup ? {} : { restSec: Number((_e = log.restSec) != null ? _e : exercise.restSec) || 0 };
    if (exercise.type === "weighted") {
      return {
        type: "weighted",
        weightMode: exercise.weightMode,
        targetSets: exercise.sets,
        targetReps: exercise.reps,
        targetWeight: exercise.weight,
        sets: doneRows.map((r) => ({ reps: Number(r.reps) || 0, weight: Number(r.weight) || 0 })),
        ...rest
      };
    }
    return {
      type: "reps",
      targetSets: exercise.sets,
      targetReps: exercise.reps,
      sets: doneRows.map((r) => ({ reps: Number(r.reps) || 0 })),
      ...rest
    };
  }
  function formatPerformedSummary(step) {
    const p = step.performed;
    if (p.type === "weighted") {
      return `${p.sets.length} sets: ` + p.sets.map((s2) => `${s2.reps}\xD7${formatWeightLabel(p.weightMode, s2.weight)}`).join(", ");
    }
    if (isIntervalType(p.type)) {
      const weightPart = p.type === "weightedInterval" ? ` @ ${formatWeightLabel(p.weightMode, p.weight)}` : "";
      return `${p.completedSets}/${p.targetSets} sets \xB7 ${p.workSec}s on / ${p.restSec}s off${weightPart}`;
    }
    return `${p.sets.length} sets: ` + p.sets.map((s2) => s2.reps).join(", ") + " reps";
  }
  function uniformValue(values) {
    return values.length > 0 && values.every((v) => v === values[0]) ? values[0] : null;
  }
  function resolveStepTargetSets(step, ex) {
    var _a;
    if (step.targetSets) return step.targetSets;
    const count = (_a = step.sets) != null ? _a : ex.sets;
    return Array.from({ length: count }, () => ({ reps: ex.reps, weight: ex.weight }));
  }
  function formatSetsPattern(sets, isWeighted) {
    return sets.map((row) => isWeighted ? `${row.reps}\xD7${row.weight}kg` : `${row.reps}`).join(", ");
  }
  function computeTemplateDrift(entry, step, exercises, routines) {
    var _a, _b, _c, _d, _e;
    const ex = exercises.find((e) => e.id === step.exerciseId);
    if (!ex) return null;
    let routine = null;
    let routineStep = null;
    if (entry.kind === "routine") {
      routine = routines.find((r) => r.id === entry.refId) || null;
      routineStep = routine && step.routineStepId ? routine.steps.find((s2) => s2.id === step.routineStepId) || null : null;
    }
    const p = step.performed;
    if (routineStep && routineStep.targetSets && !isIntervalType(p.type)) {
      const isWeighted = p.type === "weighted";
      const previous = routineStep.targetSets;
      const changed = previous.length !== p.sets.length || p.sets.some((row, i) => {
        var _a2;
        const t = previous[i];
        if (!t) return true;
        if (row.reps !== t.reps) return true;
        if (isWeighted && row.weight !== ((_a2 = t.weight) != null ? _a2 : 0)) return true;
        return false;
      });
      if (!changed) return null;
      const targetSetsPatch = p.sets.map((row) => isWeighted ? { reps: row.reps, weight: row.weight } : { reps: row.reps });
      return { exercise: ex, routine, routineStep, isWeighted, previousTargetSets: previous, targetSetsPatch };
    }
    const target = {
      sets: routineStep ? (_a = routineStep.sets) != null ? _a : ex.sets : ex.sets,
      reps: ex.reps,
      weight: ex.weight,
      workSec: routineStep ? (_b = routineStep.workSec) != null ? _b : ex.workSec : ex.workSec,
      restSec: routineStep ? (_d = routineStep.restSec) != null ? _d : (_c = ex.restSec) != null ? _c : 0 : ex.restSec
    };
    const patch = {};
    if (isIntervalType(p.type)) {
      if (p.targetSets !== target.sets) patch.sets = p.targetSets;
      if (p.workSec !== target.workSec) patch.workSec = p.workSec;
      if (p.restSec !== target.restSec) patch.restSec = p.restSec;
      if (p.type === "weightedInterval" && p.weight !== target.weight) patch.weight = p.weight;
    } else {
      const isWeighted = p.type === "weighted";
      if (p.sets.length !== target.sets) patch.sets = p.sets.length;
      if (p.restSec != null && p.restSec !== ((_e = target.restSec) != null ? _e : 0)) patch.restSec = p.restSec;
      const reps = uniformValue(p.sets.map((row) => row.reps));
      if (reps !== null && reps !== target.reps) patch.reps = reps;
      const weight = isWeighted ? uniformValue(p.sets.map((row) => row.weight)) : null;
      if (isWeighted && weight !== null && weight !== target.weight) patch.weight = weight;
      if (reps === null || isWeighted && weight === null) {
        const previous = Array.from({ length: target.sets }, () => ({ reps: target.reps, weight: target.weight }));
        const patternChanged = previous.length !== p.sets.length || p.sets.some((row) => {
          var _a2;
          if (row.reps !== target.reps) return true;
          if (isWeighted && row.weight !== ((_a2 = target.weight) != null ? _a2 : 0)) return true;
          return false;
        });
        if (patternChanged) {
          const targetSetsPatch = p.sets.map((row) => isWeighted ? { reps: row.reps, weight: row.weight } : { reps: row.reps });
          return { exercise: ex, routine, routineStep, isWeighted, previousTargetSets: previous, targetSetsPatch };
        }
      }
    }
    if (Object.keys(patch).length === 0) return null;
    const routinePatch = {};
    const exercisePatch = {};
    for (const [key, value] of Object.entries(patch)) {
      if (routineStep && (key === "sets" || key === "restSec" || key === "workSec")) routinePatch[key] = value;
      else exercisePatch[key] = value;
    }
    return { exercise: ex, routine, routineStep, target, patch, routinePatch, exercisePatch };
  }
  function formatDriftSummary(drift) {
    if (drift.targetSetsPatch) {
      return `Sets: ${formatSetsPattern(drift.previousTargetSets, drift.isWeighted)} \u2192 ${formatSetsPattern(drift.targetSetsPatch, drift.isWeighted)}`;
    }
    const { target, patch } = drift;
    const parts = [];
    if ("sets" in patch) parts.push(`Sets: ${target.sets}\u2192${patch.sets}`);
    if ("reps" in patch) parts.push(`Reps: ${target.reps}\u2192${patch.reps}`);
    if ("weight" in patch) parts.push(`Weight: ${target.weight}\u2192${patch.weight}kg`);
    if ("workSec" in patch) parts.push(`Work: ${target.workSec}s\u2192${patch.workSec}s`);
    if ("restSec" in patch) parts.push(`Rest: ${target.restSec}s\u2192${patch.restSec}s`);
    return parts.join(" \xB7 ");
  }
  function applyRoutineStep(ex, step) {
    var _a, _b, _c, _d, _e, _f;
    return {
      ...ex,
      ...isIntervalType(ex.type) && { workSec: (_a = step.workSec) != null ? _a : ex.workSec },
      sets: step.targetSets ? step.targetSets.length : (_b = step.sets) != null ? _b : ex.sets,
      targetSets: (_c = step.targetSets) != null ? _c : null,
      restSec: (_e = step.restSec) != null ? _e : (_d = ex.restSec) != null ? _d : 0,
      restAfterSec: (_f = step.restAfterSec) != null ? _f : 0,
      routineStepId: step.id,
      supersetGroup: step.supersetGroup || null
    };
  }
  function groupSteps(items, getGroup) {
    const blocks = [];
    items.forEach((item) => {
      const g = getGroup(item);
      const last = blocks[blocks.length - 1];
      if (g && last && getGroup(last[last.length - 1]) === g) last.push(item);
      else blocks.push([item]);
    });
    return blocks;
  }
  function normalizeSupersets(steps) {
    return groupSteps(steps, (step) => step.supersetGroup || null).flatMap(
      (block) => block.length === 1 && block[0].supersetGroup ? [{ ...block[0], supersetGroup: null }] : block
    );
  }

  // climbing-tracker/plan.js
  var DAY_MS = 24 * 3600 * 1e3;
  var AVG_CYCLES = 6;
  var time = (iso) => new Date(iso).getTime();
  function emptyPlan(now = (/* @__PURE__ */ new Date()).toISOString()) {
    return { days: [], cycleStartedAt: now, cycles: [] };
  }
  function newDay() {
    return { id: uid(), title: "", description: "", doneAt: null, items: [] };
  }
  function dayLabel(plan, index) {
    const title = (plan.days[index].title || "").trim();
    return title ? `Day ${index + 1} \xB7 ${title}` : `Day ${index + 1}`;
  }
  var isRoutineItem = (item) => item.routineId != null;
  function planProgress(plan, history) {
    const days2 = plan.days.map(() => /* @__PURE__ */ new Set());
    const since = time(plan.cycleStartedAt);
    const entries = history.filter((h) => h.kind === "routine" && time(h.date) >= since).sort((a, b) => time(a.date) - time(b.date));
    for (const entry of entries) {
      for (let i = 0; i < plan.days.length; i++) {
        const day = plan.days[i];
        if (day.doneAt && time(day.doneAt) < time(entry.date)) continue;
        const item = day.items.find((it) => it.routineId === entry.refId && !days2[i].has(it.id));
        if (item) {
          days2[i].add(item.id);
          break;
        }
      }
    }
    return plan.days.map((day, i) => {
      const routines = day.items.filter(isRoutineItem);
      return {
        credited: days2[i],
        allRoutinesLogged: routines.length > 0 && routines.every((it) => days2[i].has(it.id))
      };
    });
  }
  function dayCompletedBy(plan, history, entry) {
    if (!plan) return null;
    const before = planProgress(plan, history);
    const after = planProgress(plan, [entry, ...history]);
    const i = plan.days.findIndex((day, k) => !day.doneAt && after[k].allRoutinesLogged && !before[k].allRoutinesLogged);
    return i === -1 ? null : plan.days[i].id;
  }
  function toggleDay(plan, dayId, now = (/* @__PURE__ */ new Date()).toISOString()) {
    return { ...plan, days: plan.days.map((d2) => d2.id === dayId ? { ...d2, doneAt: d2.doneAt ? null : now } : d2) };
  }
  var allDaysDone = (plan) => plan.days.length > 0 && plan.days.every((d2) => d2.doneAt);
  function startNewCycle(plan, now = (/* @__PURE__ */ new Date()).toISOString()) {
    return {
      ...plan,
      days: plan.days.map((d2) => ({ ...d2, doneAt: null })),
      cycleStartedAt: now,
      cycles: [...plan.cycles, { startedAt: plan.cycleStartedAt, endedAt: now }]
    };
  }
  function removeRoutineFromPlan(plan, routineId) {
    return { ...plan, days: plan.days.map((d2) => ({ ...d2, items: d2.items.filter((it) => it.routineId !== routineId) })) };
  }
  function cycleSummary(plan) {
    const recent = plan.cycles.slice(-AVG_CYCLES);
    const avgDays = recent.length === 0 ? null : Math.round(recent.reduce((sum2, c) => sum2 + (time(c.endedAt) - time(c.startedAt)) / DAY_MS, 0) / recent.length * 10) / 10;
    return { number: plan.cycles.length + 1, startedAt: plan.cycleStartedAt, avgDays };
  }

  // climbing-tracker/llmGuidance.js
  var EXERCISE_GUIDANCE = `Exercise objects use one of four "type" values:

1) "reps" - plain bodyweight reps, e.g. pull-ups, push-ups, core work:
{
  "id": "<unique string>",
  "name": "<exercise name>",
  "type": "reps",
  "sets": <integer, number of sets>,
  "reps": <integer, target reps per set>,
  "restSec": <integer, seconds of rest between sets, 0 for no timed rest>
}

2) "weighted" - sets of reps with a weight, either added to bodyweight (weighted pull-up belt, weight vest) or an absolute total weight (barbell, dumbbell, machine):
{
  "id": "<unique string>",
  "name": "<exercise name>",
  "type": "weighted",
  "sets": <integer>,
  "reps": <integer, target reps per set>,
  "weight": <number, kg>,
  "weightMode": "added" | "total",
  "restSec": <integer, seconds of rest between sets, 0 for no timed rest>
}
Use "added" when the weight is extra load on top of the climber's own bodyweight. Use "total" when it's the full weight being lifted.

3) "interval" - timed work/rest sets, e.g. hangboard repeaters, dead hangs, plank holds, rest-pause finger boarding:
{
  "id": "<unique string>",
  "name": "<exercise name>",
  "type": "interval",
  "workSec": <integer, seconds of work per set>,
  "restSec": <integer, seconds of rest between sets>,
  "sets": <integer, number of work/rest cycles>
}

4) "weightedInterval" - the same timed work/rest sets as "interval", but with a weight, e.g. weighted hangs (weight on a harness/belt), one-arm block lifts, weighted plank holds:
{
  "id": "<unique string>",
  "name": "<exercise name>",
  "type": "weightedInterval",
  "workSec": <integer, seconds of work per set>,
  "restSec": <integer, seconds of rest between sets>,
  "sets": <integer, number of work/rest cycles>,
  "weight": <number, kg>,
  "weightMode": "added" | "total"
}
Use "added" when the weight hangs on the climber on top of bodyweight (the usual case for weighted hangs), "total" for a lifted weight like a block pulled off the floor. Everything said about "interval" exercises below also applies to "weightedInterval" ones.`;
  var ROUTINE_GUIDANCE = `Routine objects group exercises into an ordered sequence of steps to perform together. Each step points at an exercise and can optionally override that exercise's "sets" and "restSec" (and, for "interval"/"weightedInterval" exercises, "workSec") just for this routine (leave them null to use the exercise's own defaults). The same exerciseId can appear in multiple steps, e.g. to do a couple of warm-up sets early in the routine and more later:
{
  "id": "<unique string>",
  "name": "<routine name>",
  "steps": [
    { "id": "<unique string>", "exerciseId": "<id of an exercise in the exercises array>", "sets": <integer or null>, "workSec": <integer or null, interval/weightedInterval exercises only>, "restSec": <integer or null>, "restAfterSec": <integer or null>, "targetSets": <array or null>, "supersetGroup": <string or null> },
    ...
  ]
}

For "reps" and "weighted" exercise steps only, "targetSets" can specify a heterogeneous per-set pattern instead of a uniform "sets" count - e.g. a pyramid of 2 sets of 12 reps then 1 set of 24 reps. When present it fully replaces "sets" (and "reps"/"weight") for that step. Leave it null for a plain uniform sets x reps target. Format: an array with one entry per set, in order:
- "reps" type: [ { "reps": <integer> }, ... ]
- "weighted" type: [ { "reps": <integer>, "weight": <number, kg> }, ... ]
Do not use "targetSets" for "interval" or "weightedInterval" exercises - they only support the uniform "sets"/"workSec"/"restSec" overrides above, e.g. "workSec": 10 to hang longer in this routine than the exercise's default. A "weightedInterval" exercise's weight can't be overridden per step; it always comes from the exercise.

IMPORTANT - there are TWO different kinds of rest, don't mix them up:
- "restSec" (on the exercise or overridden on a step) fires ONLY between repeated sets of that SAME exercise within that SAME step, and ONLY when that step's "sets" is 2 or more. If a step has "sets": 1, its "restSec" is completely inert (for "interval" exercises, a rest phase only ever happens between work cycles of that SAME timer, so "sets": 1 means the rest phase never triggers either). Only set "restSec" above 0 when that same step also has "sets" of 2 or more.
- "restAfterSec" (only settable per routine step, defaults to 0/null) is the rest countdown shown after this step is fully finished, before moving on to the NEXT exercise (or superset) in the routine. Use it for pauses between separate exercises, e.g. "5 exercises with 20s between each exercise" - give every step "restAfterSec": 20 (it is harmless to leave it on the very last step too, since it is simply never shown after the last card). For alternating sets of two or more exercises, use "supersetGroup" (below) instead. Do not set "restAfterSec" on a step and expect it to do anything other than pause AFTER that step completes and BEFORE the next one - it has no effect on rest within the step itself, that is still "restSec"'s job.

SUPERSETS - "supersetGroup" (optional, per routine step, default null) links consecutive steps into a superset that is performed in alternating rounds: one set of the first exercise, one set of the next, and so on, then a rest, then the next round (A1, B1, rest, A2, B2, rest, ...). Give every member step the same short string (e.g. "ss-1"); use a different string for each separate superset, and null for steps that aren't in one. Rules for supersets:
- Any exercise type can be in a superset. For an "interval" member, one set is ONE work phase (e.g. one hang), started by the user each round - its own rest phase is skipped, and its "sets" is the number of rounds like any other member.
- Members must be directly next to each other in "steps", and a superset needs at least 2 members.
- Give every member the same number of sets (same "sets", or "targetSets" arrays of the same length).
- The rest between rounds is the LAST member's "restSec" (also when the last member is an "interval" step). Set "restSec" to 0 on all other members - there is no rest between exercises inside a round.
- The rest after the whole superset (before the next exercise) is the LAST member's "restAfterSec". "restAfterSec" on the other members is ignored.
Example: weighted pull-ups superset with push-ups, 3 rounds, 90s between rounds, then 2 min before the next exercise:
  { "id": "st-1", "exerciseId": "ex-weighted-pullups", "sets": 3, "restSec": 0, "restAfterSec": null, "targetSets": null, "supersetGroup": "ss-1" },
  { "id": "st-2", "exerciseId": "ex-pushups", "sets": 3, "restSec": 90, "restAfterSec": 120, "targetSets": null, "supersetGroup": "ss-1" }`;
  var BASE_GUIDANCE = `You are generating data for the "Climbing Tracker" web app. The app stores exercises and routines as JSON that gets pasted into its "Import exercises & routines" dialog.

Output the JSON inside a single fenced code block (\`\`\`json ... \`\`\`) so it's easy to copy, with no commentary before or after the block and no trailing commas. The JSON must match this exact shape:

{
  "exercises": [ <Exercise>, ... ],
  "routines": [ <Routine>, ... ]
}

${EXERCISE_GUIDANCE}

${ROUTINE_GUIDANCE}

Rules:
- Every "id" must be unique within the file (e.g. "ex-dead-hangs-01").
- Every "exerciseId" referenced by a routine step must either appear as an exercise in the "exercises" array of the same JSON, or be the id of one of the user's EXISTING exercises listed below.
- Leave "exercises" or "routines" as an empty array (or omit the key) if you have nothing to add for it.
- Do not invent extra fields beyond the ones described above ("supersetGroup" is allowed on routine steps). Put the JSON in exactly one \`\`\`json code block and nothing else outside it.
- Unless told otherwise, pick sensible default sets/reps/weights/durations/rests for an intermediate climber.`;
  function existingExercisesSection(exercises) {
    if (!exercises.length) {
      return 'EXISTING EXERCISES: the user has no exercises yet, so define every exercise you need in the "exercises" array.';
    }
    const lines = exercises.map((ex) => JSON.stringify(ex)).join("\n");
    return `EXISTING EXERCISES - the user already has these exercises in the app:
${lines}

Do NOT create duplicates of these. If an exercise you need is the same as (or essentially the same as) one of the above, even under a slightly different name, reference its existing "id" from routine steps and leave it out of the "exercises" array; use per-step "sets"/"workSec"/"restSec"/"targetSets" overrides if the routine needs different targets. Only add genuinely new exercises to the "exercises" array, with ids that don't clash with the ones above. Only include an existing exercise in the "exercises" array (with its same "id") if the user explicitly asks to change it - that overwrites it.`;
  }
  function buildLlmGuidance(exercises) {
    return `${BASE_GUIDANCE}

${existingExercisesSection(exercises || [])}

Now generate the exercises and/or routines described by the user's request that follows this prompt.`;
  }

  // climbing-tracker/styles.js
  var C = {
    bg: "#0E0E10",
    surface: "#17171A",
    surface2: "#202024",
    border: "#2A2A2F",
    text: "#F2F2F3",
    muted: "#8E8E96",
    dim: "#5E5E66",
    accent: "#E8B04B",
    accentInk: "#1B1400",
    accentSoft: "rgba(232,176,75,0.12)",
    green: "#4CC38A",
    greenInk: "#04140C",
    greenSoft: "rgba(76,195,138,0.12)",
    danger: "#F0604D",
    dangerSoft: "rgba(240,96,77,0.12)"
  };
  var SAFE_TOP = "env(safe-area-inset-top, 0px)";
  var SAFE_BOTTOM = "env(safe-area-inset-bottom, 0px)";
  var TAB_BAR_HEIGHT = 60;
  var btnBase = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 48,
    padding: "0 18px",
    borderRadius: 12,
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
    border: "none",
    whiteSpace: "nowrap"
  };
  var s = {
    root: {
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', 'Segoe UI', Roboto, sans-serif",
      maxWidth: 480,
      margin: "0 auto",
      minHeight: "100dvh",
      background: C.bg,
      color: C.text,
      WebkitFontSmoothing: "antialiased"
    },
    // App chrome
    header: {
      position: "sticky",
      top: 0,
      zIndex: 20,
      display: "flex",
      alignItems: "center",
      gap: 8,
      minHeight: 56,
      padding: `calc(${SAFE_TOP} + 8px) 16px 8px`,
      background: "rgba(14,14,16,0.86)",
      backdropFilter: "blur(14px)",
      WebkitBackdropFilter: "blur(14px)",
      borderBottom: `1px solid ${C.border}`
    },
    headerTitle: { flex: 1, minWidth: 0, fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em" },
    headerTitleSmall: {
      flex: 1,
      minWidth: 0,
      fontSize: 17,
      fontWeight: 600,
      textAlign: "center",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    },
    headerSub: { fontSize: 12, color: C.muted, fontWeight: 500, fontVariantNumeric: "tabular-nums", marginTop: 1 },
    headerSide: { minWidth: 72, display: "flex", alignItems: "center" },
    tabBar: {
      position: "fixed",
      bottom: 0,
      left: "50%",
      transform: "translateX(-50%)",
      width: "100%",
      maxWidth: 480,
      zIndex: 30,
      display: "flex",
      paddingBottom: SAFE_BOTTOM,
      background: "rgba(20,20,23,0.92)",
      backdropFilter: "blur(14px)",
      WebkitBackdropFilter: "blur(14px)",
      borderTop: `1px solid ${C.border}`
    },
    tab: {
      flex: 1,
      height: TAB_BAR_HEIGHT,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 3,
      background: "none",
      border: "none",
      color: C.dim,
      fontSize: 11,
      fontWeight: 600,
      cursor: "pointer"
    },
    tabActive: { color: C.accent },
    page: { padding: `16px 16px calc(${TAB_BAR_HEIGHT + 28}px + ${SAFE_BOTTOM})` },
    pagePlain: { padding: `16px 16px calc(28px + ${SAFE_BOTTOM})` },
    pageWithBottomBar: { padding: `16px 16px calc(104px + ${SAFE_BOTTOM})` },
    bottomBar: {
      position: "fixed",
      bottom: 0,
      left: "50%",
      transform: "translateX(-50%)",
      width: "100%",
      maxWidth: 480,
      zIndex: 30,
      padding: `12px 16px calc(12px + ${SAFE_BOTTOM})`,
      background: "linear-gradient(to top, rgba(14,14,16,1) 65%, rgba(14,14,16,0))"
    },
    // Buttons
    btnPrimary: { ...btnBase, background: C.accent, color: C.accentInk, fontWeight: 700 },
    btnSecondary: { ...btnBase, background: C.surface2, color: C.text, border: `1px solid ${C.border}` },
    btnDanger: { ...btnBase, background: C.danger, color: "#fff", fontWeight: 700 },
    btnDangerText: { ...btnBase, background: "transparent", color: C.danger, fontWeight: 600 },
    btnDashed: { ...btnBase, width: "100%", background: "transparent", color: C.muted, border: `1.5px dashed ${C.border}` },
    btnBlock: { width: "100%" },
    btnSmall: { minHeight: 40, padding: "0 14px", fontSize: 14, borderRadius: 10 },
    textBtn: {
      display: "inline-flex",
      alignItems: "center",
      gap: 2,
      minHeight: 40,
      padding: "0 6px",
      marginLeft: -6,
      background: "none",
      border: "none",
      color: C.accent,
      fontSize: 16,
      fontWeight: 500,
      cursor: "pointer"
    },
    iconBtn: {
      width: 40,
      height: 40,
      flexShrink: 0,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 20,
      border: "none",
      background: "transparent",
      color: C.muted,
      cursor: "pointer"
    },
    iconBtnFilled: {
      width: 40,
      height: 40,
      flexShrink: 0,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 20,
      border: "none",
      background: C.accent,
      color: C.accentInk,
      cursor: "pointer"
    },
    playBtn: {
      width: 46,
      height: 46,
      flexShrink: 0,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 23,
      border: "none",
      background: C.accent,
      color: C.accentInk,
      cursor: "pointer"
    },
    btnRow: { display: "flex", gap: 10 },
    // Lists
    list: { display: "flex", flexDirection: "column", gap: 10 },
    row: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 16,
      padding: "6px 12px 6px 4px"
    },
    rowMain: {
      flex: 1,
      minWidth: 0,
      textAlign: "left",
      background: "none",
      border: "none",
      color: "inherit",
      padding: "10px 12px",
      cursor: "pointer",
      font: "inherit"
    },
    rowTitle: {
      fontSize: 16,
      fontWeight: 600,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      display: "flex",
      alignItems: "center",
      gap: 8
    },
    rowMeta: {
      fontSize: 13,
      color: C.muted,
      marginTop: 3,
      lineHeight: 1.35,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    },
    badge: {
      fontSize: 10,
      fontWeight: 700,
      color: C.muted,
      background: C.surface2,
      borderRadius: 6,
      padding: "3px 6px",
      textTransform: "uppercase",
      letterSpacing: "0.05em",
      flexShrink: 0
    },
    empty: { textAlign: "center", padding: "56px 24px", color: C.muted },
    emptyIcon: {
      width: 64,
      height: 64,
      borderRadius: 32,
      margin: "0 auto 16px",
      background: C.surface,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: C.dim
    },
    emptyTitle: { fontSize: 17, fontWeight: 600, color: C.text, marginBottom: 6 },
    emptyText: { fontSize: 14, lineHeight: 1.5, marginBottom: 20 },
    // Cards / sections
    card: {
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 16,
      padding: 16,
      marginBottom: 12
    },
    sectionLabel: {
      fontSize: 12,
      color: C.muted,
      textTransform: "uppercase",
      letterSpacing: "0.07em",
      fontWeight: 600,
      margin: "4px 4px 8px"
    },
    sectionTitle: { fontSize: 16, fontWeight: 600, marginBottom: 4 },
    hint: { fontSize: 13, color: C.muted, lineHeight: 1.5, marginBottom: 14 },
    stats: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 },
    stat: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: "14px 16px" },
    statValue: { fontSize: 26, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 },
    statLabel: { fontSize: 12, color: C.muted, marginTop: 4, fontWeight: 500 },
    // Exercise stats chart: the hovered (or latest) session's value above the plot.
    chartReadout: { display: "flex", alignItems: "baseline", gap: 8, margin: "0 2px 8px" },
    chartReadoutValue: { fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums" },
    chartReadoutDate: { fontSize: 13, color: C.muted },
    // Form controls
    label: {
      display: "block",
      fontSize: 12,
      color: C.muted,
      textTransform: "uppercase",
      letterSpacing: "0.06em",
      fontWeight: 600,
      marginBottom: 8
    },
    input: {
      width: "100%",
      height: 48,
      padding: "0 14px",
      borderRadius: 12,
      border: `1px solid ${C.border}`,
      background: C.surface2,
      color: C.text,
      fontSize: 16,
      outline: "none"
    },
    titleInput: {
      width: "100%",
      padding: "4px 0 12px",
      marginBottom: 12,
      border: "none",
      borderBottom: `1px solid ${C.border}`,
      borderRadius: 0,
      background: "transparent",
      color: C.text,
      fontSize: 24,
      fontWeight: 700,
      outline: "none"
    },
    field: { marginBottom: 18 },
    fieldGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(136px, 1fr))",
      gap: 14,
      marginBottom: 18
    },
    segmented: {
      display: "flex",
      padding: 3,
      gap: 3,
      borderRadius: 12,
      background: C.surface2,
      border: `1px solid ${C.border}`
    },
    segment: {
      flex: 1,
      minHeight: 40,
      borderRadius: 9,
      border: "none",
      background: "transparent",
      color: C.muted,
      fontSize: 14,
      fontWeight: 600,
      cursor: "pointer"
    },
    segmentActive: { background: C.accent, color: C.accentInk },
    chipRow: { display: "flex", flexWrap: "wrap", gap: 8 },
    chip: {
      minHeight: 36,
      padding: "0 14px",
      borderRadius: 18,
      border: `1px solid ${C.border}`,
      background: C.surface2,
      color: C.muted,
      fontSize: 14,
      fontWeight: 600,
      cursor: "pointer"
    },
    chipActive: { background: C.accent, color: C.accentInk, borderColor: C.accent },
    categoryRow: { display: "flex", alignItems: "center", gap: 4, marginBottom: 8 },
    categoryCount: { fontSize: 13, color: C.muted, flexShrink: 0, minWidth: 18, textAlign: "right" },
    stepper: {
      display: "flex",
      alignItems: "center",
      height: 48,
      borderRadius: 12,
      background: C.surface2,
      border: `1px solid ${C.border}`,
      overflow: "hidden"
    },
    stepperBtn: {
      width: 44,
      height: "100%",
      flexShrink: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      border: "none",
      background: "transparent",
      color: C.text,
      cursor: "pointer"
    },
    stepperValue: { flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", justifyContent: "center", gap: 2 },
    stepperInput: {
      width: "100%",
      minWidth: 0,
      border: "none",
      outline: "none",
      background: "transparent",
      color: C.text,
      fontSize: 17,
      fontWeight: 600,
      textAlign: "center",
      fontVariantNumeric: "tabular-nums",
      padding: 0
    },
    stepperSuffix: { fontSize: 13, color: C.muted, flexShrink: 0, paddingRight: 4 },
    // Bottom sheet
    overlay: {
      position: "fixed",
      inset: 0,
      zIndex: 100,
      background: "rgba(0,0,0,0.6)",
      display: "flex",
      alignItems: "flex-end",
      justifyContent: "center",
      animation: "ct-fade .18s ease-out"
    },
    sheet: {
      width: "100%",
      maxWidth: 480,
      maxHeight: "88dvh",
      display: "flex",
      flexDirection: "column",
      background: C.surface,
      borderRadius: "20px 20px 0 0",
      borderTop: `1px solid ${C.border}`,
      animation: "ct-sheet .24s cubic-bezier(.2,.8,.2,1)"
    },
    sheetHandle: { width: 36, height: 5, borderRadius: 3, background: C.border, margin: "8px auto 0" },
    sheetHeader: { display: "flex", alignItems: "center", gap: 8, padding: "8px 8px 4px 20px" },
    sheetTitle: { flex: 1, fontSize: 18, fontWeight: 700 },
    sheetBody: {
      overflowY: "auto",
      WebkitOverflowScrolling: "touch",
      padding: `8px 20px calc(20px + ${SAFE_BOTTOM})`
    },
    sheetMessage: { fontSize: 15, color: "#C8C8CE", lineHeight: 1.5, margin: "0 0 20px" },
    pickerItem: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      width: "100%",
      textAlign: "left",
      padding: "14px 4px",
      background: "none",
      border: "none",
      borderBottom: `1px solid ${C.border}`,
      color: C.text,
      cursor: "pointer",
      font: "inherit"
    },
    transferArea: {
      width: "100%",
      height: 220,
      resize: "vertical",
      background: C.bg,
      color: "#C8C8CE",
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      padding: 12,
      fontSize: 13,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      outline: "none",
      marginBottom: 12
    },
    error: { color: C.danger, fontSize: 14, margin: "-4px 0 12px" },
    // Template drift
    drift: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "10px 12px",
      marginTop: 8,
      borderRadius: 12,
      background: C.accentSoft,
      border: `1px solid rgba(232,176,75,0.3)`
    },
    driftText: { flex: 1, minWidth: 0, fontSize: 13, color: C.accent, lineHeight: 1.4 },
    driftBtn: {
      minHeight: 34,
      padding: "0 12px",
      borderRadius: 9,
      border: "none",
      flexShrink: 0,
      background: C.accent,
      color: C.accentInk,
      fontSize: 13,
      fontWeight: 700,
      cursor: "pointer"
    },
    // History
    historyCard: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, marginBottom: 10, overflow: "hidden" },
    historyHead: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      width: "100%",
      textAlign: "left",
      padding: "14px 12px 14px 16px",
      background: "none",
      border: "none",
      color: "inherit",
      cursor: "pointer",
      font: "inherit"
    },
    historyBody: { padding: "0 16px 14px" },
    historySteps: { borderTop: `1px solid ${C.border}`, paddingTop: 10, marginTop: 4 },
    historyStep: { display: "flex", gap: 10, padding: "6px 0", fontSize: 14, lineHeight: 1.4 },
    historyStepName: { color: C.text, fontWeight: 600, flexShrink: 0, maxWidth: "45%" },
    historyStepValue: { color: C.muted, flex: 1, minWidth: 0 },
    historyStepLink: {
      background: "none",
      border: "none",
      padding: 0,
      font: "inherit",
      textAlign: "left",
      cursor: "pointer",
      textDecoration: "underline",
      textDecorationColor: C.dim,
      textUnderlineOffset: 3
    },
    // Session / exercise cards
    exerciseCard: {
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 18,
      marginBottom: 12,
      overflow: "hidden",
      transition: "border-color .2s"
    },
    exerciseCardDone: { borderColor: "rgba(76,195,138,0.45)" },
    exerciseCardHeader: { display: "flex", alignItems: "center", gap: 4, padding: "6px 6px 6px 0" },
    exerciseCardHeaderMain: {
      flex: 1,
      minWidth: 0,
      textAlign: "left",
      background: "none",
      border: "none",
      color: "inherit",
      padding: "10px 8px 10px 16px",
      cursor: "pointer",
      font: "inherit"
    },
    exerciseCardName: { fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em", display: "flex", alignItems: "center", gap: 8 },
    exerciseCardTarget: { fontSize: 13, color: C.muted, marginTop: 3, lineHeight: 1.35 },
    exerciseCardBody: { padding: "4px 16px 16px" },
    notes: {
      display: "block",
      width: "100%",
      textAlign: "left",
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
      padding: "10px 12px",
      marginBottom: 12,
      borderRadius: 12,
      background: C.surface2,
      border: `1px solid ${C.border}`,
      color: C.muted,
      fontSize: 14,
      lineHeight: 1.45,
      cursor: "pointer",
      font: "inherit"
    },
    notesArea: {
      display: "block",
      width: "100%",
      minHeight: 84,
      resize: "vertical",
      padding: "10px 12px",
      marginBottom: 12,
      borderRadius: 12,
      background: C.surface2,
      border: `1px solid ${C.border}`,
      color: C.text,
      fontSize: 16,
      lineHeight: 1.45,
      fontFamily: "inherit",
      outline: "none"
    },
    stepNumber: {
      minWidth: 26,
      height: 26,
      padding: "0 6px",
      borderRadius: 13,
      flexShrink: 0,
      background: C.surface2,
      color: C.muted,
      fontSize: 13,
      fontWeight: 700,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center"
    },
    progressPill: {
      flexShrink: 0,
      minWidth: 44,
      height: 28,
      padding: "0 10px",
      borderRadius: 14,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
      background: C.surface2,
      color: C.muted,
      fontSize: 13,
      fontWeight: 700,
      fontVariantNumeric: "tabular-nums"
    },
    progressPillDone: { background: C.greenSoft, color: C.green },
    hidden: { display: "none" },
    // Superset: consecutive steps performed in alternating rounds, bracketed
    // by an accent rule down the left edge.
    supersetBlock: { borderLeft: `3px solid ${C.accent}`, paddingLeft: 10, marginBottom: 12 },
    supersetHeader: { display: "flex", alignItems: "center", gap: 2, margin: "-6px 0 4px -6px" },
    // Grip for drag-to-reorder; a full 40px touch target around a small icon.
    dragHandle: {
      width: 36,
      height: 40,
      flexShrink: 0,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      border: "none",
      borderRadius: 10,
      background: "transparent",
      color: C.dim,
      userSelect: "none",
      WebkitUserSelect: "none",
      WebkitTouchCallout: "none"
    },
    supersetLabel: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      fontSize: 12,
      fontWeight: 700,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      color: C.accent,
      margin: "2px 0 8px"
    },
    supersetFooter: { padding: "4px 4px 2px" },
    supersetHint: { fontSize: 13, color: C.muted, lineHeight: 1.4, marginBottom: 10 },
    // Link/unlink chip sitting in the gap between two routine editor cards.
    linkChip: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      width: "fit-content",
      margin: "-2px auto 10px",
      minHeight: 32,
      padding: "0 12px",
      borderRadius: 16,
      fontSize: 13,
      fontWeight: 600,
      cursor: "pointer",
      background: "none",
      border: `1px dashed ${C.border}`,
      color: C.muted
    },
    linkChipActive: { borderStyle: "solid", borderColor: "rgba(232,176,75,0.45)", background: C.accentSoft, color: C.accent },
    setRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 },
    setIndex: { width: 22, flexShrink: 0, fontSize: 14, fontWeight: 700, color: C.dim, textAlign: "center" },
    setInputWrap: {
      flex: 1,
      minWidth: 0,
      display: "flex",
      alignItems: "center",
      height: 48,
      padding: "0 12px",
      borderRadius: 12,
      background: C.surface2,
      border: `1px solid ${C.border}`,
      transition: "opacity .15s"
    },
    setInput: {
      flex: 1,
      minWidth: 0,
      width: "100%",
      border: "none",
      outline: "none",
      background: "transparent",
      color: C.text,
      fontSize: 17,
      fontWeight: 600,
      fontVariantNumeric: "tabular-nums",
      padding: 0
    },
    setInputSuffix: { fontSize: 13, color: C.muted, flexShrink: 0, marginLeft: 4 },
    setDone: { opacity: 0.45 },
    checkBtn: {
      width: 52,
      height: 48,
      flexShrink: 0,
      borderRadius: 12,
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: C.surface2,
      border: `1.5px solid ${C.border}`,
      color: C.dim
    },
    checkBtnDone: { background: C.green, borderColor: C.green, color: C.greenInk },
    setFooter: { display: "flex", gap: 8, marginTop: 4 },
    restBar: {
      position: "relative",
      overflow: "hidden",
      display: "flex",
      alignItems: "center",
      gap: 6,
      margin: "0 0 10px",
      padding: "6px 6px 6px 14px",
      borderRadius: 12,
      background: C.greenSoft,
      border: "1px solid rgba(76,195,138,0.35)"
    },
    restBarDocked: { margin: "8px 0" },
    // Sticky block holding the session header and the rest dock beneath it.
    sessionTop: { position: "sticky", top: 0, zIndex: 20 },
    // flow-root keeps the bars' margins inside the tinted background, and an
    // empty dock still collapses to zero height.
    restDock: {
      display: "flow-root",
      padding: "0 16px",
      background: "rgba(14,14,16,0.86)",
      backdropFilter: "blur(14px)",
      WebkitBackdropFilter: "blur(14px)"
    },
    restBarFill: { position: "absolute", left: 0, top: 0, bottom: 0 },
    restBarLabel: { position: "relative", flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
    restBarTime: { position: "relative", fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums", marginRight: 4 },
    restBarBtn: {
      position: "relative",
      width: 40,
      height: 40,
      borderRadius: 10,
      border: "none",
      flexShrink: 0,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(0,0,0,0.25)",
      cursor: "pointer"
    },
    // Interval timer
    timer: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      borderRadius: 16,
      padding: "20px 0 22px",
      marginBottom: 14,
      transition: "background .3s"
    },
    timerRing: { position: "relative", width: 220, height: 220 },
    timerCenter: {
      position: "absolute",
      inset: 0,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center"
    },
    phaseLabel: { fontSize: 13, fontWeight: 800, letterSpacing: "0.16em", marginBottom: 6 },
    timerDigits: { fontSize: 60, fontWeight: 300, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.03em", lineHeight: 1 },
    timerSub: { marginTop: 8, fontSize: 14, color: C.muted, fontVariantNumeric: "tabular-nums" },
    controls: { display: "flex", gap: 10 },
    // Week plan
    dayCard: {
      display: "flex",
      alignItems: "flex-start",
      gap: 4,
      background: C.surface,
      borderWidth: 1,
      borderStyle: "solid",
      borderColor: C.border,
      borderRadius: 16,
      padding: "10px 8px 10px 4px",
      transition: "border-color .2s"
    },
    dayCardDone: { borderColor: "rgba(76,195,138,0.45)" },
    tickBtn: {
      width: 44,
      height: 44,
      flexShrink: 0,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 22,
      borderWidth: 2,
      borderStyle: "solid",
      borderColor: C.border,
      background: "transparent",
      color: "transparent",
      cursor: "pointer",
      margin: "2px 6px 0 8px",
      padding: 0
    },
    tickBtnDone: { background: C.green, borderColor: C.green, color: C.greenInk },
    dayDescription: { fontSize: 13, color: C.muted, marginTop: 3, lineHeight: 1.4, whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
    dayItems: { marginTop: 8, display: "flex", flexDirection: "column", gap: 4 },
    dayItem: { display: "flex", alignItems: "center", gap: 8, minHeight: 32, fontSize: 14 },
    dayItemNote: { color: C.muted, fontStyle: "italic" },
    loggedMark: {
      width: 18,
      height: 18,
      flexShrink: 0,
      borderRadius: 9,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      background: C.surface2,
      color: C.dim
    },
    loggedMarkDone: { background: C.greenSoft, color: C.green },
    miniPlay: {
      width: 32,
      height: 32,
      flexShrink: 0,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 16,
      border: "none",
      background: C.accentSoft,
      color: C.accent,
      cursor: "pointer",
      marginLeft: "auto"
    },
    descriptionArea: {
      display: "block",
      width: "100%",
      minHeight: 72,
      resize: "vertical",
      padding: "10px 12px",
      marginBottom: 18,
      borderRadius: 12,
      background: C.surface2,
      border: `1px solid ${C.border}`,
      color: C.text,
      fontSize: 16,
      lineHeight: 1.45,
      fontFamily: "inherit",
      outline: "none"
    },
    planItemRow: {
      display: "flex",
      alignItems: "center",
      gap: 4,
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 14,
      padding: "4px 4px 4px 0",
      marginBottom: 8
    },
    planNoteInput: {
      flex: 1,
      minWidth: 0,
      height: 40,
      padding: "0 4px",
      border: "none",
      background: "transparent",
      color: C.text,
      fontSize: 16,
      outline: "none"
    }
  };
  var DESKTOP_QUERY = "(min-width: 900px)";
  var SIDEBAR_WIDTH = 232;
  var CONTENT_MAX = 1120;
  var d = {
    root: { maxWidth: "none", margin: 0 },
    main: { flex: 1, minWidth: 0, marginLeft: SIDEBAR_WIDTH },
    // Full-screen pages without the sidebar (active workout).
    focus: { maxWidth: CONTENT_MAX, margin: "0 auto" },
    sidebar: {
      position: "fixed",
      top: 0,
      bottom: 0,
      left: 0,
      width: SIDEBAR_WIDTH,
      zIndex: 30,
      display: "flex",
      flexDirection: "column",
      gap: 2,
      padding: "20px 12px",
      background: C.surface,
      borderRight: `1px solid ${C.border}`
    },
    brand: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "4px 10px 22px",
      fontSize: 17,
      fontWeight: 700,
      letterSpacing: "-0.01em"
    },
    navItem: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      width: "100%",
      minHeight: 42,
      padding: "0 12px",
      borderRadius: 10,
      border: "none",
      background: "transparent",
      color: C.muted,
      fontSize: 15,
      fontWeight: 600,
      textAlign: "left",
      cursor: "pointer"
    },
    navItemActive: { background: C.accentSoft, color: C.accent },
    sidebarStat: {
      margin: "0 4px",
      padding: "12px 14px",
      borderRadius: 12,
      background: C.surface2,
      border: `1px solid ${C.border}`
    },
    // Right padding keeps header actions aligned with the capped content width.
    header: { padding: "18px 40px 14px", paddingRight: `max(40px, calc(100% - ${CONTENT_MAX - 40}px))`, minHeight: 72 },
    headerTitle: { fontSize: 28 },
    restDock: { padding: "0 40px", paddingRight: `max(40px, calc(100% - ${CONTENT_MAX - 40}px))` },
    page: { padding: "28px 40px 56px", maxWidth: CONTENT_MAX },
    pageNarrow: { padding: "28px 40px 56px", maxWidth: 820 },
    pageWithBottomBar: { padding: "28px 40px 24px", maxWidth: CONTENT_MAX },
    // Sticky within the content column instead of pinned to a 480px phone frame.
    bottomBar: {
      position: "sticky",
      left: "auto",
      transform: "none",
      maxWidth: CONTENT_MAX,
      padding: "16px 40px 24px",
      display: "flex",
      justifyContent: "flex-end"
    },
    bottomBarBtn: { width: "auto", minWidth: 260 },
    grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 },
    cardGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", gap: 16, alignItems: "start" },
    fullRow: { gridColumn: "1 / -1" },
    // Routine editor stays one column: link chips sit between consecutive cards.
    editorColumn: { maxWidth: 760 },
    stats: { gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 },
    settingsGrid: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16, maxWidth: 900 },
    overlay: { alignItems: "center", padding: 24 },
    sheet: {
      maxWidth: 520,
      maxHeight: "84dvh",
      borderRadius: 20,
      border: `1px solid ${C.border}`,
      boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
      animation: "ct-pop .18s ease-out"
    },
    sheetBody: { padding: "8px 20px 20px" }
  };

  // climbing-tracker/components/Icons.jsx
  function Svg({ size = 22, strokeWidth = 2, children }) {
    return /* @__PURE__ */ React.createElement(
      "svg",
      {
        width: size,
        height: size,
        viewBox: "0 0 24 24",
        "aria-hidden": "true",
        fill: "none",
        stroke: "currentColor",
        strokeWidth,
        strokeLinecap: "round",
        strokeLinejoin: "round"
      },
      children
    );
  }
  var Icon = {
    plan: (p) => /* @__PURE__ */ React.createElement(Svg, { ...p }, /* @__PURE__ */ React.createElement("path", { d: "M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-11zM4 10.5h16M8 4v4M16 4v4M9.5 15l2 2 3.5-3.5" })),
    exercises: (p) => /* @__PURE__ */ React.createElement(Svg, { ...p }, /* @__PURE__ */ React.createElement("path", { d: "M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11" })),
    routines: (p) => /* @__PURE__ */ React.createElement(Svg, { ...p }, /* @__PURE__ */ React.createElement("path", { d: "M9 6h11M9 12h11M9 18h11" }), /* @__PURE__ */ React.createElement("circle", { cx: "4.5", cy: "6", r: "1.2" }), /* @__PURE__ */ React.createElement("circle", { cx: "4.5", cy: "12", r: "1.2" }), /* @__PURE__ */ React.createElement("circle", { cx: "4.5", cy: "18", r: "1.2" })),
    history: (p) => /* @__PURE__ */ React.createElement(Svg, { ...p }, /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "8.5" }), /* @__PURE__ */ React.createElement("path", { d: "M12 7.5V12l3 2" })),
    settings: (p) => /* @__PURE__ */ React.createElement(Svg, { ...p }, /* @__PURE__ */ React.createElement("path", { d: "M4 7h9M17 7h3M4 17h3M11 17h9" }), /* @__PURE__ */ React.createElement("circle", { cx: "15", cy: "7", r: "2" }), /* @__PURE__ */ React.createElement("circle", { cx: "9", cy: "17", r: "2" })),
    play: ({ size = 20 }) => /* @__PURE__ */ React.createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("path", { d: "M8 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L9.2 4.5A.8.8 0 0 0 8 5.2z", fill: "currentColor" })),
    pause: ({ size = 20 }) => /* @__PURE__ */ React.createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("rect", { x: "6.5", y: "5", width: "4", height: "14", rx: "1", fill: "currentColor" }), /* @__PURE__ */ React.createElement("rect", { x: "13.5", y: "5", width: "4", height: "14", rx: "1", fill: "currentColor" })),
    skip: (p) => /* @__PURE__ */ React.createElement(Svg, { ...p }, /* @__PURE__ */ React.createElement("path", { d: "M6 6l9 6-9 6V6zM18 6v12" })),
    plus: (p) => /* @__PURE__ */ React.createElement(Svg, { ...p }, /* @__PURE__ */ React.createElement("path", { d: "M12 5v14M5 12h14" })),
    minus: (p) => /* @__PURE__ */ React.createElement(Svg, { ...p }, /* @__PURE__ */ React.createElement("path", { d: "M5 12h14" })),
    x: (p) => /* @__PURE__ */ React.createElement(Svg, { ...p }, /* @__PURE__ */ React.createElement("path", { d: "M6 6l12 12M18 6L6 18" })),
    check: (p) => /* @__PURE__ */ React.createElement(Svg, { strokeWidth: 2.6, ...p }, /* @__PURE__ */ React.createElement("path", { d: "M5 12.5l4.5 4.5L19 7.5" })),
    back: (p) => /* @__PURE__ */ React.createElement(Svg, { strokeWidth: 2.4, ...p }, /* @__PURE__ */ React.createElement("path", { d: "M15 5l-7 7 7 7" })),
    chevronDown: (p) => /* @__PURE__ */ React.createElement(Svg, { ...p }, /* @__PURE__ */ React.createElement("path", { d: "M6 9l6 6 6-6" })),
    up: (p) => /* @__PURE__ */ React.createElement(Svg, { ...p }, /* @__PURE__ */ React.createElement("path", { d: "M12 19V5M6 11l6-6 6 6" })),
    down: (p) => /* @__PURE__ */ React.createElement(Svg, { ...p }, /* @__PURE__ */ React.createElement("path", { d: "M12 5v14M6 13l6 6 6-6" })),
    trash: (p) => /* @__PURE__ */ React.createElement(Svg, { ...p }, /* @__PURE__ */ React.createElement("path", { d: "M4 7h16M10 11v6M14 11v6M6 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4.5h6V7" })),
    restart: (p) => /* @__PURE__ */ React.createElement(Svg, { ...p }, /* @__PURE__ */ React.createElement("path", { d: "M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" })),
    link: (p) => /* @__PURE__ */ React.createElement(Svg, { ...p }, /* @__PURE__ */ React.createElement("path", { d: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" })),
    grip: (p) => /* @__PURE__ */ React.createElement("svg", { width: p.size || 22, height: p.size || 22, viewBox: "0 0 24 24", "aria-hidden": "true", fill: "currentColor" }, [6, 12, 18].flatMap((y) => [9, 15].map((x) => /* @__PURE__ */ React.createElement("circle", { key: `${x}-${y}`, cx: x, cy: y, r: "1.6" })))),
    chart: (p) => /* @__PURE__ */ React.createElement(Svg, { ...p }, /* @__PURE__ */ React.createElement("path", { d: "M4 19h16M5 15l4.5-5 3.5 3 6-7" })),
    pencil: (p) => /* @__PURE__ */ React.createElement(Svg, { ...p }, /* @__PURE__ */ React.createElement("path", { d: "M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4zM13.5 6.5l4 4" })),
    timer: (p) => /* @__PURE__ */ React.createElement(Svg, { ...p }, /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "13.5", r: "7.5" }), /* @__PURE__ */ React.createElement("path", { d: "M12 9.5v4l2.5 1.5M10 3h4" })),
    flag: (p) => /* @__PURE__ */ React.createElement(Svg, { ...p }, /* @__PURE__ */ React.createElement("path", { d: "M5 21V4M5 4h11l-2 4 2 4H5" }))
  };

  // climbing-tracker/components/NumberField.jsx
  function NumberField({ label, value, onChange, min: min2 = 0, step = 1, inc, suffix = "" }) {
    const delta = inc != null ? inc : step;
    const num2 = typeof value === "number" && !isNaN(value) ? value : min2;
    const bump = (dir) => {
      const next = Math.round((num2 + dir * delta) * 100) / 100;
      onChange(Math.max(min2, next));
    };
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", { style: s.label }, label), /* @__PURE__ */ React.createElement("div", { style: s.stepper }, /* @__PURE__ */ React.createElement("button", { style: s.stepperBtn, onClick: () => bump(-1), disabled: num2 <= min2, "aria-label": `Decrease ${label}` }, /* @__PURE__ */ React.createElement(Icon.minus, { size: 20 })), /* @__PURE__ */ React.createElement("div", { style: s.stepperValue }, /* @__PURE__ */ React.createElement(
      "input",
      {
        style: s.stepperInput,
        type: "number",
        inputMode: step % 1 === 0 ? "numeric" : "decimal",
        min: min2,
        step,
        value,
        onFocus: (e) => e.target.select(),
        onChange: (e) => onChange(e.target.value === "" ? "" : parseFloat(e.target.value)),
        "aria-label": label
      }
    ), suffix && /* @__PURE__ */ React.createElement("span", { style: s.stepperSuffix }, suffix)), /* @__PURE__ */ React.createElement("button", { style: s.stepperBtn, onClick: () => bump(1), "aria-label": `Increase ${label}` }, /* @__PURE__ */ React.createElement(Icon.plus, { size: 20 }))));
  }

  // climbing-tracker/components/ExerciseForm.jsx
  function Segmented({ options, value, onChange }) {
    return /* @__PURE__ */ React.createElement("div", { style: s.segmented }, options.map((o) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: o.value,
        style: { ...s.segment, ...value === o.value ? s.segmentActive : {} },
        onClick: () => onChange(o.value)
      },
      o.label
    )));
  }
  var WEIGHT_MODES = [{ value: "added", label: "Bodyweight + kg" }, { value: "total", label: "Total weight" }];
  function ExerciseForm({ draft, categories = [], onChange, onSave, onDelete }) {
    const set2 = (patch) => onChange({ ...draft, ...patch });
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: s.field }, /* @__PURE__ */ React.createElement("label", { style: s.label }, "Name"), /* @__PURE__ */ React.createElement(
      "input",
      {
        style: s.input,
        placeholder: "e.g. Max hangs 20mm",
        value: draft.name,
        onChange: (e) => set2({ name: e.target.value }),
        onKeyDown: (e) => e.key === "Enter" && e.target.blur(),
        autoFocus: !draft.name
      }
    )), /* @__PURE__ */ React.createElement("div", { style: s.field }, /* @__PURE__ */ React.createElement("label", { style: s.label }, "Type"), /* @__PURE__ */ React.createElement(
      Segmented,
      {
        options: EXERCISE_TYPES,
        value: draft.type,
        onChange: (type) => set2({ type, ...defaultFieldsForType(type) })
      }
    )), categories.length > 0 && /* @__PURE__ */ React.createElement("div", { style: s.field }, /* @__PURE__ */ React.createElement("label", { style: s.label }, "Category"), /* @__PURE__ */ React.createElement("div", { style: s.chipRow }, [{ id: null, name: "None" }, ...categories].map((c) => {
      var _a;
      return /* @__PURE__ */ React.createElement(
        "button",
        {
          key: (_a = c.id) != null ? _a : "none",
          style: { ...s.chip, ...(draft.categoryId || null) === c.id ? s.chipActive : {} },
          onClick: () => set2({ categoryId: c.id })
        },
        c.name
      );
    }))), draft.type === "reps" && /* @__PURE__ */ React.createElement("div", { style: s.fieldGrid }, /* @__PURE__ */ React.createElement(NumberField, { label: "Sets", value: draft.sets, onChange: (v) => set2({ sets: v }), min: 1 }), /* @__PURE__ */ React.createElement(NumberField, { label: "Reps", value: draft.reps, onChange: (v) => set2({ reps: v }), min: 1 }), /* @__PURE__ */ React.createElement(NumberField, { label: "Rest", value: draft.restSec, onChange: (v) => set2({ restSec: v }), min: 0, inc: 15, suffix: "s" })), draft.type === "weighted" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: s.field }, /* @__PURE__ */ React.createElement(
      Segmented,
      {
        options: WEIGHT_MODES,
        value: draft.weightMode,
        onChange: (weightMode) => set2({ weightMode })
      }
    )), /* @__PURE__ */ React.createElement("div", { style: s.fieldGrid }, /* @__PURE__ */ React.createElement(NumberField, { label: "Sets", value: draft.sets, onChange: (v) => set2({ sets: v }), min: 1 }), /* @__PURE__ */ React.createElement(NumberField, { label: "Reps", value: draft.reps, onChange: (v) => set2({ reps: v }), min: 1 }), /* @__PURE__ */ React.createElement(NumberField, { label: "Weight", value: draft.weight, onChange: (v) => set2({ weight: v }), min: 0, step: 0.5, inc: 2.5, suffix: "kg" }), /* @__PURE__ */ React.createElement(NumberField, { label: "Rest", value: draft.restSec, onChange: (v) => set2({ restSec: v }), min: 0, inc: 15, suffix: "s" }))), (draft.type === "interval" || draft.type === "weightedInterval") && /* @__PURE__ */ React.createElement(React.Fragment, null, draft.type === "weightedInterval" && /* @__PURE__ */ React.createElement("div", { style: s.field }, /* @__PURE__ */ React.createElement(
      Segmented,
      {
        options: WEIGHT_MODES,
        value: draft.weightMode,
        onChange: (weightMode) => set2({ weightMode })
      }
    )), /* @__PURE__ */ React.createElement("div", { style: s.fieldGrid }, /* @__PURE__ */ React.createElement(NumberField, { label: "Work", value: draft.workSec, onChange: (v) => set2({ workSec: v }), min: 1, suffix: "s" }), /* @__PURE__ */ React.createElement(NumberField, { label: "Rest", value: draft.restSec, onChange: (v) => set2({ restSec: v }), min: 0, suffix: "s" }), /* @__PURE__ */ React.createElement(NumberField, { label: "Sets", value: draft.sets, onChange: (v) => set2({ sets: v }), min: 1 }), draft.type === "weightedInterval" && /* @__PURE__ */ React.createElement(NumberField, { label: "Weight", value: draft.weight, onChange: (v) => set2({ weight: v }), min: 0, step: 0.5, inc: 2.5, suffix: "kg" }))), /* @__PURE__ */ React.createElement("div", { style: s.field }, /* @__PURE__ */ React.createElement("label", { style: s.label }, "Notes"), /* @__PURE__ */ React.createElement(
      "textarea",
      {
        style: s.notesArea,
        placeholder: "Grip, setup, cues, how it went\u2026",
        value: draft.notes || "",
        onChange: (e) => set2({ notes: e.target.value }),
        rows: 3
      }
    )), /* @__PURE__ */ React.createElement("button", { style: { ...s.btnPrimary, ...s.btnBlock }, onClick: onSave, disabled: !draft.name.trim() }, "Save exercise"), onDelete && /* @__PURE__ */ React.createElement("button", { style: { ...s.btnDangerText, ...s.btnBlock, marginTop: 8 }, onClick: onDelete }, /* @__PURE__ */ React.createElement(Icon.trash, { size: 18 }), " Delete exercise"));
  }

  // climbing-tracker/components/useDrain.js
  var { useState: useState2, useEffect: useEffect2, useRef: useRef2 } = React;
  function useDrain(from, to, ms, running) {
    const [shown, setShown] = useState2({ value: from, ms: 0 });
    const primedRef = useRef2(false);
    useEffect2(() => {
      if (!running) {
        primedRef.current = false;
        setShown({ value: from, ms: 0 });
        return;
      }
      if (primedRef.current) {
        setShown({ value: to, ms });
        return;
      }
      setShown({ value: from, ms: 0 });
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => {
          primedRef.current = true;
          setShown({ value: to, ms });
        });
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }, [from, to, ms, running]);
    return shown;
  }

  // climbing-tracker/components/RestBar.jsx
  var { createContext, useContext } = React;
  var RestDockContext = createContext(null);
  function RestBar({ label, timeLeft, remainingMs, total, paused, onTogglePause, onSkip, tone = "green" }) {
    const dock = useContext(RestDockContext);
    const color = tone === "green" ? C.green : C.accent;
    const soft = tone === "green" ? "rgba(76,195,138,0.18)" : "rgba(232,176,75,0.18)";
    const pctOf = (sec) => total > 0 ? Math.max(0, Math.min(100, sec / total * 100)) : 0;
    const exactSec = remainingMs != null ? remainingMs / 1e3 : timeLeft;
    const drain = useDrain(pctOf(exactSec), pctOf(timeLeft - 1), Math.round((exactSec - (timeLeft - 1)) * 1e3), !paused);
    const bar = /* @__PURE__ */ React.createElement("div", { style: {
      ...s.restBar,
      ...tone === "green" ? {} : { background: "rgba(232,176,75,0.08)", borderColor: "rgba(232,176,75,0.35)" },
      ...dock && s.restBarDocked
    } }, /* @__PURE__ */ React.createElement("div", { style: { ...s.restBarFill, width: `${drain.value}%`, background: soft, transition: drain.ms ? `width ${drain.ms}ms linear` : "none" } }), /* @__PURE__ */ React.createElement("span", { style: { ...s.restBarLabel, color } }, paused ? "Paused" : label), /* @__PURE__ */ React.createElement("span", { style: { ...s.restBarTime, color } }, formatTime(timeLeft)), /* @__PURE__ */ React.createElement("button", { style: { ...s.restBarBtn, color }, onClick: onTogglePause, "aria-label": paused ? "Resume rest" : "Pause rest" }, paused ? /* @__PURE__ */ React.createElement(Icon.play, { size: 18 }) : /* @__PURE__ */ React.createElement(Icon.pause, { size: 18 })), /* @__PURE__ */ React.createElement("button", { style: { ...s.restBarBtn, color }, onClick: onSkip, "aria-label": "Skip rest" }, /* @__PURE__ */ React.createElement(Icon.skip, { size: 18 })));
    return dock ? ReactDOM.createPortal(bar, dock) : bar;
  }

  // climbing-tracker/sounds.js
  var audioCtx = null;
  function getAudioCtx() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }
  function beep(freq, duration, volume = 0.2, type = "sine", delay = 0) {
    try {
      const ctx = getAudioCtx();
      const t0 = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(volume, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(1e-3, t0 + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + duration + 0.02);
    } catch {
    }
  }
  var sounds = {
    countdown: () => beep(880, 0.1, 0.18, "sine"),
    workStart: () => beep(660, 0.18, 0.22, "square"),
    restStart: () => beep(440, 0.18, 0.22, "sine"),
    finish: () => {
      beep(523, 0.15, 0.22, "sine", 0);
      beep(659, 0.15, 0.22, "sine", 0.15);
      beep(784, 0.3, 0.24, "sine", 0.3);
    }
  };

  // climbing-tracker/restAlert.js
  var OVER_TAG = "climbing-tracker-rest";
  var COUNTDOWN_TAG = "climbing-tracker-rest-countdown";
  var ICON = "./climbing-tracker/icon.svg";
  function isInstalled() {
    return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  }
  function notificationsSupported() {
    return "Notification" in window && "serviceWorker" in navigator;
  }
  function notificationState() {
    return notificationsSupported() ? Notification.permission : "unsupported";
  }
  async function requestNotifications() {
    if (!notificationsSupported()) return "unsupported";
    try {
      return await Notification.requestPermission();
    } catch {
      return Notification.permission;
    }
  }
  function canNotify() {
    return notificationsSupported() && Notification.permission === "granted";
  }
  async function show(title, options) {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, { icon: ICON, ...options });
    } catch {
    }
  }
  async function close(tag) {
    try {
      const reg = await navigator.serviceWorker.ready;
      (await reg.getNotifications({ tag })).forEach((n) => n.close());
    } catch {
    }
  }
  var rests = /* @__PURE__ */ new Map();
  var ticker = null;
  var lastShown = "";
  function mmss(sec) {
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  }
  function secondsLeft(r) {
    return Math.max(0, Math.ceil((r.paused ? r.remainingMs : r.endsAt - Date.now()) / 1e3));
  }
  function updateCountdown() {
    if (!canNotify() || document.visibilityState === "visible" || rests.size === 0) return;
    const r = [...rests.values()].sort((a, b) => secondsLeft(a) - secondsLeft(b))[0];
    const sec = secondsLeft(r);
    if (sec <= 0) return;
    const title = r.paused ? `Rest paused \xB7 ${mmss(sec)} left` : `Rest \xB7 ${mmss(sec)}`;
    if (title === lastShown) return;
    lastShown = title;
    show(title, { body: r.label, tag: COUNTDOWN_TAG, silent: true, renotify: false });
  }
  function clearCountdown() {
    lastShown = "";
    if (canNotify()) close(COUNTDOWN_TAG);
  }
  function syncTicker() {
    const want = rests.size > 0 && document.visibilityState !== "visible";
    if (want && !ticker) {
      ticker = setInterval(updateCountdown, 500);
      updateCountdown();
    } else if (!want && ticker) {
      clearInterval(ticker);
      ticker = null;
    }
    if (rests.size === 0 || document.visibilityState === "visible") clearCountdown();
  }
  function trackRest(id, { endsAt = 0, remainingMs = 0, paused = false, label = "" }) {
    rests.set(id, { endsAt, remainingMs, paused, label });
    lastShown = "";
    syncTicker();
    updateCountdown();
  }
  function untrackRest(id) {
    if (!rests.delete(id)) return;
    syncTicker();
    if (rests.size > 0) {
      lastShown = "";
      updateCountdown();
    }
  }
  async function notifyRestOver(body, title = "Rest over") {
    if (!canNotify()) return;
    if (document.visibilityState === "visible") return;
    await show(title, {
      body,
      tag: OVER_TAG,
      renotify: true,
      requireInteraction: true,
      vibrate: [400, 150, 400, 150, 400]
    });
  }
  async function clearRestAlerts() {
    if (canNotify()) close(OVER_TAG);
  }
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") clearRestAlerts();
      syncTicker();
    });
  }

  // climbing-tracker/components/useRestTimer.js
  var { useState: useState3, useEffect: useEffect3, useRef: useRef3 } = React;
  function useRestTimer({ saved, onSave } = {}) {
    const [rest, setRest] = useState3(null);
    const endsAtRef = useRef3(0);
    const remainingMsRef = useRef3(0);
    const tickRef = useRef3(null);
    const endRef = useRef3(null);
    const noticeRef = useRef3("");
    const overTitleRef = useRef3(void 0);
    const metaRef = useRef3({});
    const totalRef = useRef3(0);
    const lastSecRef = useRef3(0);
    const idRef = useRef3({});
    const onSaveRef = useRef3(onSave);
    onSaveRef.current = onSave;
    const save = (paused) => onSaveRef.current && onSaveRef.current(paused == null ? null : {
      total: totalRef.current,
      notice: noticeRef.current,
      overTitle: overTitleRef.current,
      meta: metaRef.current,
      paused,
      ...paused ? { remainingMs: remainingMsRef.current } : { endsAt: endsAtRef.current }
    });
    const clearTimers = () => {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      if (endRef.current) {
        clearTimeout(endRef.current);
        endRef.current = null;
      }
    };
    const finish = () => {
      clearTimers();
      untrackRest(idRef.current);
      sounds.workStart();
      notifyRestOver(noticeRef.current, overTitleRef.current);
      setRest(null);
      save(null);
    };
    const tick = () => {
      const sec = Math.ceil((endsAtRef.current - Date.now()) / 1e3);
      if (sec <= 0) {
        finish();
        return;
      }
      if (sec === lastSecRef.current) return;
      lastSecRef.current = sec;
      setRest((r) => r && { ...r, timeLeft: sec, remainingMs: endsAtRef.current - Date.now() });
      if (sec <= 3) sounds.countdown();
    };
    const run = (ms) => {
      endsAtRef.current = Date.now() + ms;
      lastSecRef.current = Math.ceil(ms / 1e3);
      tickRef.current = setInterval(tick, 250);
      endRef.current = setTimeout(finish, ms);
      trackRest(idRef.current, { endsAt: endsAtRef.current, label: noticeRef.current });
    };
    const start = (sec, { notice = "", overTitle, ...meta } = {}) => {
      clearTimers();
      noticeRef.current = notice;
      overTitleRef.current = overTitle;
      metaRef.current = meta;
      totalRef.current = sec;
      setRest({ ...meta, total: sec, timeLeft: sec, remainingMs: sec * 1e3, paused: false });
      sounds.restStart();
      run(sec * 1e3);
      save(false);
    };
    const stop = () => {
      clearTimers();
      untrackRest(idRef.current);
      setRest(null);
      save(null);
    };
    const togglePause = () => {
      if (!rest) return;
      if (rest.paused) {
        run(remainingMsRef.current);
        setRest({ ...rest, remainingMs: remainingMsRef.current, paused: false });
        save(false);
      } else {
        remainingMsRef.current = Math.max(0, endsAtRef.current - Date.now());
        clearTimers();
        trackRest(idRef.current, { paused: true, remainingMs: remainingMsRef.current, label: noticeRef.current });
        setRest({ ...rest, remainingMs: remainingMsRef.current, paused: true });
        save(true);
      }
    };
    useEffect3(() => {
      if (!saved || !(saved.total > 0)) return;
      noticeRef.current = saved.notice || "";
      overTitleRef.current = saved.overTitle;
      metaRef.current = saved.meta || {};
      totalRef.current = saved.total;
      const ms = saved.paused ? saved.remainingMs : saved.endsAt - Date.now();
      if (!(ms > 0)) {
        save(null);
        return;
      }
      const base = { ...metaRef.current, total: saved.total, timeLeft: Math.ceil(ms / 1e3), remainingMs: ms };
      if (saved.paused) {
        remainingMsRef.current = ms;
        trackRest(idRef.current, { paused: true, remainingMs: ms, label: noticeRef.current });
        setRest({ ...base, paused: true });
      } else {
        run(ms);
        setRest({ ...base, paused: false });
      }
    }, []);
    useEffect3(() => () => {
      clearTimers();
      untrackRest(idRef.current);
    }, []);
    return { rest, start, stop, togglePause };
  }

  // climbing-tracker/components/SetsCard.jsx
  var { useState: useState4, useEffect: useEffect4 } = React;
  function SetValueInput({ value, onChange, suffix, decimal, dim, label }) {
    return /* @__PURE__ */ React.createElement("div", { style: { ...s.setInputWrap, ...dim ? s.setDone : {} } }, /* @__PURE__ */ React.createElement(
      "input",
      {
        style: s.setInput,
        type: "number",
        inputMode: decimal ? "decimal" : "numeric",
        min: 0,
        step: decimal ? 0.5 : 1,
        value,
        onFocus: (e) => e.target.select(),
        onChange: (e) => onChange(e.target.value),
        "aria-label": label
      }
    ), /* @__PURE__ */ React.createElement("span", { style: s.setInputSuffix }, suffix));
  }
  function SetsCard({ exercise, initialLog, onChange }) {
    const targetSets = exercise.sets || 1;
    const [restInput, setRestInput] = useState4(() => {
      var _a;
      return (_a = initialLog == null ? void 0 : initialLog.restSec) != null ? _a : exercise.restSec || 0;
    });
    const restSec = Number(restInput) || 0;
    const isWeighted = exercise.type === "weighted";
    const makeRow = (i) => {
      var _a, _b;
      const t = exercise.targetSets && exercise.targetSets[i];
      return { reps: t ? t.reps : exercise.reps || 0, weight: t ? (_b = (_a = t.weight) != null ? _a : exercise.weight) != null ? _b : 0 : exercise.weight || 0, done: false };
    };
    const [rows, setRows] = useState4(() => {
      var _a;
      return ((_a = initialLog == null ? void 0 : initialLog.rows) == null ? void 0 : _a.length) ? initialLog.rows : Array.from({ length: targetSets }, (_2, i) => makeRow(i));
    });
    const [savedRest, setSavedRest] = useState4(() => (initialLog == null ? void 0 : initialLog.rest) || null);
    const restTimer = useRestTimer({ saved: initialLog == null ? void 0 : initialLog.rest, onSave: setSavedRest });
    const restRowIndex = restTimer.rest ? restTimer.rest.row : null;
    useEffect4(() => {
      onChange({ rows, restSec, rest: savedRest });
    }, [rows, restSec, savedRest]);
    const startRest = (row) => restTimer.start(restSec, { row, notice: `Next set: ${exercise.name}` });
    const skipRest = restTimer.stop;
    const updateRow = (i, patch) => setRows(rows.map((r, idx) => idx === i ? { ...r, ...patch } : r));
    const removeLastRow = () => {
      const last = rows.length - 1;
      setRows(rows.slice(0, last));
      if (restRowIndex === last) skipRest();
    };
    const addRow = () => setRows([...rows, { ...rows[rows.length - 1] || makeRow(), done: false }]);
    const toggleDone = (i) => {
      const nowDone = !rows[i].done;
      updateRow(i, { done: nowDone });
      const otherSetsRemain = rows.some((r, idx) => idx !== i && !r.done);
      if (nowDone && restSec > 0 && otherSetsRemain) startRest(i);
      else if (!nowDone && restRowIndex === i) skipRest();
    };
    return /* @__PURE__ */ React.createElement("div", null, rows.map((row, i) => /* @__PURE__ */ React.createElement(React.Fragment, { key: i }, /* @__PURE__ */ React.createElement("div", { style: s.setRow }, /* @__PURE__ */ React.createElement("span", { style: s.setIndex }, i + 1), /* @__PURE__ */ React.createElement(
      SetValueInput,
      {
        value: row.reps,
        onChange: (v) => updateRow(i, { reps: v }),
        suffix: "reps",
        dim: row.done,
        label: `Set ${i + 1} reps`
      }
    ), isWeighted && /* @__PURE__ */ React.createElement(
      SetValueInput,
      {
        value: row.weight,
        onChange: (v) => updateRow(i, { weight: v }),
        suffix: "kg",
        decimal: true,
        dim: row.done,
        label: `Set ${i + 1} weight`
      }
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        style: { ...s.checkBtn, ...row.done ? s.checkBtnDone : {} },
        onClick: () => toggleDone(i),
        "aria-pressed": row.done,
        "aria-label": `Set ${i + 1} ${row.done ? "done" : "not done"}`
      },
      /* @__PURE__ */ React.createElement(Icon.check, { size: 24 })
    )), restRowIndex === i && /* @__PURE__ */ React.createElement(
      RestBar,
      {
        label: `Rest \xB7 ${exercise.name}`,
        timeLeft: restTimer.rest.timeLeft,
        remainingMs: restTimer.rest.remainingMs,
        total: restTimer.rest.total,
        paused: restTimer.rest.paused,
        onTogglePause: restTimer.togglePause,
        onSkip: skipRest
      }
    ))), /* @__PURE__ */ React.createElement("div", { style: s.setFooter }, /* @__PURE__ */ React.createElement("button", { style: { ...s.btnSecondary, ...s.btnSmall, flex: 1 }, onClick: addRow }, /* @__PURE__ */ React.createElement(Icon.plus, { size: 18 }), " Add set"), /* @__PURE__ */ React.createElement("button", { style: { ...s.btnSecondary, ...s.btnSmall }, onClick: removeLastRow, disabled: rows.length <= 1, "aria-label": "Remove last set" }, /* @__PURE__ */ React.createElement(Icon.minus, { size: 18 }))), !exercise.supersetGroup && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 12 } }, /* @__PURE__ */ React.createElement(NumberField, { label: "Rest between sets", value: restInput, onChange: setRestInput, min: 0, inc: 15, suffix: "s" })));
  }

  // climbing-tracker/components/IntervalCard.jsx
  var { useState: useState5, useEffect: useEffect5, useRef: useRef4 } = React;
  var PREP_SEC = 5;
  var RUNNING = ["prep", "work", "rest"];
  function IntervalCard({ exercise, initialLog, superset, onChange }) {
    const [init] = useState5(() => {
      var _a, _b, _c, _d;
      const cfg = {
        workSec: (_a = initialLog == null ? void 0 : initialLog.workSec) != null ? _a : exercise.workSec,
        restSec: (_b = initialLog == null ? void 0 : initialLog.restSec) != null ? _b : exercise.restSec,
        totalSets: (_c = initialLog == null ? void 0 : initialLog.targetSets) != null ? _c : exercise.sets,
        weight: (_d = initialLog == null ? void 0 : initialLog.weight) != null ? _d : exercise.weight
      };
      const completed2 = (initialLog == null ? void 0 : initialLog.completedSets) || 0;
      const saved = initialLog == null ? void 0 : initialLog.timer;
      if (saved && RUNNING.includes(saved.phase)) {
        return { cfg, timer: { completed: completed2, phase: saved.phase, set: saved.set || 1, endsAt: saved.endsAt || 0, remainingMs: saved.remainingMs || 0, paused: !!saved.paused } };
      }
      const phase2 = completed2 === 0 ? "idle" : completed2 >= cfg.totalSets ? "done" : "next";
      return { cfg, timer: { completed: completed2, phase: phase2, set: phase2 === "next" ? completed2 + 1 : 1, endsAt: 0, remainingMs: 0, paused: false } };
    });
    const [workSec, setWorkSec] = useState5(init.cfg.workSec);
    const [restSec, setRestSec] = useState5(init.cfg.restSec);
    const [totalSets, setTotalSets] = useState5(init.cfg.totalSets);
    const [weight, setWeight] = useState5(init.cfg.weight);
    const weighted = exercise.type === "weightedInterval";
    const timerRef = useRef4(init.timer);
    const configRef = useRef4(init.cfg);
    const intervalRef = useRef4(null);
    const lastSecRef = useRef4(0);
    const [, setFrame] = useState5(0);
    const rerender = () => setFrame((f) => f + 1);
    useEffect5(() => {
      configRef.current = { workSec, restSec, totalSets, weight };
      if (timerRef.current.phase === "idle") report();
    }, [workSec, restSec, totalSets, weight]);
    const onChangeRef = useRef4(onChange);
    onChangeRef.current = onChange;
    const report = (meta) => {
      const t2 = timerRef.current;
      onChangeRef.current({
        type: exercise.type,
        completedSets: t2.completed,
        workSec: configRef.current.workSec,
        restSec: configRef.current.restSec,
        targetSets: configRef.current.totalSets,
        ...weighted && { weight: configRef.current.weight },
        timer: RUNNING.includes(t2.phase) ? { phase: t2.phase, set: t2.set, paused: t2.paused, ...t2.paused ? { remainingMs: t2.remainingMs } : { endsAt: t2.endsAt } } : null
      }, meta);
    };
    const durationMs = (phase2) => 1e3 * (phase2 === "prep" ? PREP_SEC : phase2 === "work" ? Math.max(1, Number(configRef.current.workSec) || 0) : Math.max(0, Number(configRef.current.restSec) || 0));
    const clearTick = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
    const startTick = () => {
      clearTick();
      intervalRef.current = setInterval(tick, 250);
    };
    const enter = (phase2, at) => {
      const t2 = timerRef.current;
      t2.phase = phase2;
      t2.endsAt = at + durationMs(phase2);
    };
    const advance = (now, silent) => {
      const t2 = timerRef.current;
      let changed = false;
      while (RUNNING.includes(t2.phase) && !t2.paused && t2.endsAt <= now) {
        const at = t2.endsAt;
        const live = !silent && now - at < 1500;
        changed = true;
        if (t2.phase === "prep") {
          enter("work", at);
          if (live) sounds.workStart();
        } else if (t2.phase === "work") {
          t2.completed += 1;
          if (t2.set >= configRef.current.totalSets) {
            t2.phase = "done";
            if (live) sounds.finish();
          } else if (superset) {
            t2.set += 1;
            t2.phase = "next";
            if (live) sounds.restStart();
          } else {
            enter("rest", at);
            if (live) sounds.restStart();
          }
        } else {
          t2.set += 1;
          enter("work", at);
          if (live) sounds.workStart();
        }
      }
      if (!RUNNING.includes(t2.phase)) clearTick();
      return changed;
    };
    const tick = () => {
      const now = Date.now();
      if (advance(now, false)) {
        report();
        rerender();
      }
      const t2 = timerRef.current;
      if (!RUNNING.includes(t2.phase) || t2.paused) return;
      const sec = Math.ceil((t2.endsAt - now) / 1e3);
      if (sec === lastSecRef.current) return;
      lastSecRef.current = sec;
      if (sec <= 3 && sec >= 1) sounds.countdown();
      rerender();
    };
    useEffect5(() => {
      const t2 = timerRef.current;
      if (!RUNNING.includes(t2.phase)) return;
      if (advance(Date.now(), true)) {
        report({ restored: true });
        rerender();
      }
      if (RUNNING.includes(t2.phase) && !t2.paused) startTick();
    }, []);
    useEffect5(() => {
      const onVisible = () => {
        if (document.visibilityState === "visible" && intervalRef.current) tick();
      };
      document.addEventListener("visibilitychange", onVisible);
      return () => document.removeEventListener("visibilitychange", onVisible);
    }, []);
    const finishNow = () => {
      clearTick();
      timerRef.current.phase = "done";
      timerRef.current.paused = false;
      report();
      rerender();
    };
    const beginWork = () => {
      getAudioCtx();
      timerRef.current.paused = false;
      enter("prep", Date.now());
      startTick();
      report();
      rerender();
    };
    const start = () => {
      timerRef.current.set = 1;
      timerRef.current.completed = 0;
      beginWork();
    };
    const restart = () => {
      clearTick();
      timerRef.current = { completed: 0, phase: "idle", set: 1, endsAt: 0, remainingMs: 0, paused: false };
      report();
      rerender();
    };
    const togglePause = () => {
      const t2 = timerRef.current;
      if (t2.paused) {
        t2.endsAt = Date.now() + t2.remainingMs;
        t2.paused = false;
        startTick();
      } else {
        t2.remainingMs = Math.max(0, t2.endsAt - Date.now());
        t2.paused = true;
        clearTick();
      }
      report();
      rerender();
    };
    const skip = () => {
      const t2 = timerRef.current;
      if (!RUNNING.includes(t2.phase)) return;
      const now = Date.now();
      const wasPrep = t2.phase === "prep";
      t2.paused = false;
      t2.endsAt = now;
      advance(now, true);
      if (wasPrep) sounds.workStart();
      if (RUNNING.includes(t2.phase)) startTick();
      report();
      rerender();
    };
    useEffect5(() => () => clearTick(), []);
    const t = timerRef.current;
    const phase = t.phase;
    const currentSet = t.set;
    const paused = t.paused;
    const isRunning = RUNNING.includes(phase);
    const remainingMs = isRunning ? Math.max(0, paused ? t.remainingMs : t.endsAt - Date.now()) : 0;
    const timeLeft = isRunning ? Math.ceil(remainingMs / 1e3) : workSec;
    const running = isRunning;
    const phaseColor = phase === "prep" ? C.text : phase === "work" ? C.accent : phase === "rest" ? C.green : phase === "done" ? C.green : C.muted;
    const phaseBg = phase === "work" ? "rgba(232,176,75,0.07)" : phase === "rest" ? "rgba(76,195,138,0.07)" : "transparent";
    const completed = phase === "done" ? Math.min(t.completed, totalSets) : t.completed;
    const phaseTotal = phase === "prep" ? PREP_SEC : phase === "rest" ? restSec : workSec;
    const fraction = running ? phaseTotal > 0 ? remainingMs / 1e3 / phaseTotal : 0 : phase === "done" ? 0 : 1;
    const nextFraction = running && phaseTotal > 0 ? (timeLeft - 1) / phaseTotal : fraction;
    const drainMs = running ? Math.max(0, Math.round(remainingMs - (timeLeft - 1) * 1e3)) : 0;
    return /* @__PURE__ */ React.createElement("div", null, phase === "idle" && /* @__PURE__ */ React.createElement("div", { style: s.fieldGrid }, /* @__PURE__ */ React.createElement(NumberField, { label: "Work", value: workSec, onChange: setWorkSec, min: 1, suffix: "s" }), !superset && /* @__PURE__ */ React.createElement(NumberField, { label: "Rest", value: restSec, onChange: setRestSec, min: 0, suffix: "s" }), /* @__PURE__ */ React.createElement(NumberField, { label: "Sets", value: totalSets, onChange: setTotalSets, min: 1 }), weighted && /* @__PURE__ */ React.createElement(NumberField, { label: "Weight", value: weight, onChange: setWeight, min: 0, step: 0.5, inc: 2.5, suffix: "kg" })), /* @__PURE__ */ React.createElement("div", { style: { ...s.timer, background: phaseBg } }, /* @__PURE__ */ React.createElement("div", { style: s.timerRing }, /* @__PURE__ */ React.createElement(
      Ring,
      {
        key: `${phase}-${currentSet}`,
        fraction,
        nextFraction,
        color: phaseColor,
        ms: drainMs,
        animate: running && !paused
      }
    ), /* @__PURE__ */ React.createElement("div", { style: s.timerCenter }, phase === "idle" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { ...s.phaseLabel, color: C.muted } }, "READY"), /* @__PURE__ */ React.createElement("div", { style: s.timerDigits }, formatTime(workSec || 0)), /* @__PURE__ */ React.createElement("div", { style: s.timerSub }, totalSets, " \xD7 ", workSec, "s", superset ? "" : ` / ${restSec}s`, weighted ? ` @ ${formatWeightLabel(exercise.weightMode, weight)}` : "")), running && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { ...s.phaseLabel, color: paused ? C.muted : phaseColor } }, paused ? "PAUSED" : phase === "prep" ? "GET READY" : phase.toUpperCase()), /* @__PURE__ */ React.createElement("div", { style: { ...s.timerDigits, color: phaseColor } }, formatTime(timeLeft)), /* @__PURE__ */ React.createElement("div", { style: s.timerSub }, "Set ", currentSet, " of ", totalSets)), phase === "next" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { ...s.phaseLabel, color: C.muted } }, "NEXT SET"), /* @__PURE__ */ React.createElement("div", { style: s.timerDigits }, formatTime(workSec || 0)), /* @__PURE__ */ React.createElement("div", { style: s.timerSub }, "Set ", currentSet, " of ", totalSets)), phase === "done" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { color: C.green, marginBottom: 6 } }, /* @__PURE__ */ React.createElement(Icon.check, { size: 44 })), /* @__PURE__ */ React.createElement("div", { style: { ...s.phaseLabel, color: C.green } }, "DONE"), /* @__PURE__ */ React.createElement("div", { style: s.timerSub }, completed, " / ", totalSets, " sets"))))), /* @__PURE__ */ React.createElement("div", { style: s.controls }, phase === "idle" && /* @__PURE__ */ React.createElement("button", { style: { ...s.btnPrimary, ...s.btnBlock, minHeight: 56, fontSize: 18 }, onClick: start }, /* @__PURE__ */ React.createElement(Icon.play, { size: 20 }), " Start"), running && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("button", { style: { ...paused ? s.btnPrimary : s.btnSecondary, flex: 2, minHeight: 56 }, onClick: togglePause }, paused ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Icon.play, { size: 20 }), " Resume") : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Icon.pause, { size: 20 }), " Pause")), /* @__PURE__ */ React.createElement("button", { style: { ...s.btnSecondary, flex: 1, minHeight: 56, padding: 0 }, onClick: skip, "aria-label": "Skip phase" }, /* @__PURE__ */ React.createElement(Icon.skip, { size: 22 })), /* @__PURE__ */ React.createElement("button", { style: { ...s.btnSecondary, flex: 1, minHeight: 56, padding: 0 }, onClick: finishNow, "aria-label": "Finish exercise now" }, /* @__PURE__ */ React.createElement(Icon.flag, { size: 22 }))), phase === "next" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("button", { style: { ...s.btnPrimary, flex: 3, minHeight: 56, fontSize: 18 }, onClick: beginWork }, /* @__PURE__ */ React.createElement(Icon.play, { size: 20 }), " Start set ", currentSet), /* @__PURE__ */ React.createElement("button", { style: { ...s.btnSecondary, flex: 1, minHeight: 56, padding: 0 }, onClick: finishNow, "aria-label": "Finish exercise now" }, /* @__PURE__ */ React.createElement(Icon.flag, { size: 22 }))), phase === "done" && /* @__PURE__ */ React.createElement("button", { style: { ...s.btnSecondary, ...s.btnBlock }, onClick: restart }, /* @__PURE__ */ React.createElement(Icon.restart, { size: 18 }), " Restart")));
  }
  function Ring({ fraction, nextFraction, ms, color, animate }) {
    const drain = useDrain(fraction, nextFraction, ms, animate);
    const size = 220, stroke = 10, r = (size - stroke) / 2, circ = 2 * Math.PI * r;
    return /* @__PURE__ */ React.createElement("svg", { width: size, height: size, viewBox: `0 0 ${size} ${size}`, style: { transform: "rotate(-90deg)" }, "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("circle", { cx: size / 2, cy: size / 2, r, fill: "none", stroke: C.surface2, strokeWidth: stroke }), /* @__PURE__ */ React.createElement(
      "circle",
      {
        cx: size / 2,
        cy: size / 2,
        r,
        fill: "none",
        stroke: color,
        strokeWidth: stroke,
        strokeLinecap: "round",
        strokeDasharray: circ,
        strokeDashoffset: circ * (1 - Math.max(0, Math.min(1, drain.value))),
        style: { transition: drain.ms ? `stroke-dashoffset ${drain.ms}ms linear` : "none" }
      }
    ));
  }

  // climbing-tracker/components/ExerciseNotes.jsx
  var { useState: useState6 } = React;
  function ExerciseNotes({ notes, onSave }) {
    const [draft, setDraft] = useState6(null);
    if (draft !== null) {
      const commit = () => {
        const text = draft.trim();
        if (text !== (notes || "")) onSave(text);
        setDraft(null);
      };
      return /* @__PURE__ */ React.createElement(
        "textarea",
        {
          style: s.notesArea,
          value: draft,
          onChange: (e) => setDraft(e.target.value),
          onBlur: commit,
          placeholder: "Grip, setup, cues, how it went\u2026",
          autoFocus: true,
          rows: 3
        }
      );
    }
    return notes ? /* @__PURE__ */ React.createElement("button", { style: s.notes, onClick: () => setDraft(notes), "aria-label": "Edit notes" }, notes) : /* @__PURE__ */ React.createElement("button", { style: { ...s.textBtn, ...s.btnSmall, marginLeft: -14 }, onClick: () => setDraft("") }, /* @__PURE__ */ React.createElement(Icon.plus, { size: 16 }), " Add note");
  }

  // climbing-tracker/components/ExerciseCard.jsx
  var { useState: useState7 } = React;
  function progressOf(exercise, log) {
    var _a, _b;
    if (isIntervalType(exercise.type)) {
      return { done: (log == null ? void 0 : log.completedSets) || 0, total: (_b = (_a = log == null ? void 0 : log.targetSets) != null ? _a : exercise.sets) != null ? _b : 1 };
    }
    const rows = (log == null ? void 0 : log.rows) || [];
    return { done: rows.filter((r) => r.done).length, total: rows.length || exercise.sets || 1 };
  }
  function ExerciseCard({ exercise, initialLog, notes, position, total, label, onChange, onMove, onNotesChange }) {
    const [collapsed, setCollapsed] = useState7(false);
    const [progress, setProgress] = useState7(() => progressOf(exercise, initialLog));
    const complete = progress.total > 0 && progress.done >= progress.total;
    const handleChange = (log, meta) => {
      setProgress(progressOf(exercise, log));
      onChange(log, meta);
    };
    return /* @__PURE__ */ React.createElement("div", { style: { ...s.exerciseCard, ...complete ? s.exerciseCardDone : {} } }, /* @__PURE__ */ React.createElement("div", { style: s.exerciseCardHeader }, /* @__PURE__ */ React.createElement("button", { style: s.exerciseCardHeaderMain, onClick: () => setCollapsed(!collapsed), "aria-expanded": !collapsed }, /* @__PURE__ */ React.createElement("div", { style: s.exerciseCardName }, (label || total > 1) && /* @__PURE__ */ React.createElement("span", { style: s.stepNumber }, label || position + 1), /* @__PURE__ */ React.createElement("span", { style: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" } }, exercise.name)), /* @__PURE__ */ React.createElement("div", { style: s.exerciseCardTarget }, formatTargetSummary(exercise))), /* @__PURE__ */ React.createElement("span", { style: { ...s.progressPill, ...complete ? s.progressPillDone : {} } }, complete ? /* @__PURE__ */ React.createElement(Icon.check, { size: 16 }) : `${progress.done}/${progress.total}`), total > 1 && !collapsed && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("button", { style: s.iconBtn, onClick: () => onMove(-1), disabled: position === 0, "aria-label": "Move up" }, /* @__PURE__ */ React.createElement(Icon.up, { size: 20 })), /* @__PURE__ */ React.createElement("button", { style: s.iconBtn, onClick: () => onMove(1), disabled: position === total - 1, "aria-label": "Move down" }, /* @__PURE__ */ React.createElement(Icon.down, { size: 20 }))), collapsed && /* @__PURE__ */ React.createElement("button", { style: s.iconBtn, onClick: () => setCollapsed(false), "aria-label": "Expand" }, /* @__PURE__ */ React.createElement(Icon.chevronDown, { size: 20 }))), /* @__PURE__ */ React.createElement("div", { style: collapsed ? s.hidden : s.exerciseCardBody }, /* @__PURE__ */ React.createElement(ExerciseNotes, { notes, onSave: onNotesChange }), isIntervalType(exercise.type) ? /* @__PURE__ */ React.createElement(IntervalCard, { exercise, initialLog, superset: !!exercise.supersetGroup, onChange: handleChange }) : /* @__PURE__ */ React.createElement(SetsCard, { exercise, initialLog, onChange: handleChange })));
  }

  // climbing-tracker/components/Layout.jsx
  var { useEffect: useEffect6, useState: useState8 } = React;
  function useIsDesktop() {
    const [matches, setMatches] = useState8(() => window.matchMedia(DESKTOP_QUERY).matches);
    useEffect6(() => {
      const mq = window.matchMedia(DESKTOP_QUERY);
      const onChange = () => setMatches(mq.matches);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }, []);
    return matches;
  }
  function Header({ title, subtitle, left, right }) {
    const desktop = useIsDesktop();
    const compact = left !== void 0;
    return /* @__PURE__ */ React.createElement("div", { style: { ...s.header, ...desktop && d.header } }, compact && /* @__PURE__ */ React.createElement("div", { style: s.headerSide }, left), /* @__PURE__ */ React.createElement("div", { style: compact ? s.headerTitleSmall : { ...s.headerTitle, ...desktop && d.headerTitle } }, title, subtitle && /* @__PURE__ */ React.createElement("div", { style: s.headerSub }, subtitle)), compact ? /* @__PURE__ */ React.createElement("div", { style: { ...s.headerSide, justifyContent: "flex-end" } }, right) : right);
  }
  function TabBar({ tabs, active, onChange }) {
    return /* @__PURE__ */ React.createElement("nav", { style: s.tabBar }, tabs.map((t) => {
      const TabIcon = Icon[t.icon];
      return /* @__PURE__ */ React.createElement(
        "button",
        {
          key: t.id,
          style: { ...s.tab, ...active === t.id ? s.tabActive : {} },
          onClick: () => onChange(t.id),
          "aria-current": active === t.id ? "page" : void 0
        },
        /* @__PURE__ */ React.createElement(TabIcon, { size: 24 }),
        t.label
      );
    }));
  }
  function Sidebar({ tabs, active, onChange, footer }) {
    return /* @__PURE__ */ React.createElement("nav", { style: d.sidebar }, /* @__PURE__ */ React.createElement("div", { style: d.brand }, /* @__PURE__ */ React.createElement("img", { src: "./climbing-tracker/icon.svg", alt: "", width: 32, height: 32, style: { borderRadius: 8 } }), "Climbing"), tabs.map((t) => {
      const TabIcon = Icon[t.icon];
      const isActive = active === t.id;
      return /* @__PURE__ */ React.createElement(
        "button",
        {
          key: t.id,
          style: { ...d.navItem, ...isActive ? d.navItemActive : {} },
          onClick: () => onChange(t.id),
          "aria-current": isActive ? "page" : void 0
        },
        /* @__PURE__ */ React.createElement(TabIcon, { size: 20 }),
        t.label
      );
    }), /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }), footer);
  }
  function Sheet({ title, onClose, children }) {
    const desktop = useIsDesktop();
    useEffect6(() => {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }, []);
    useEffect6(() => {
      const onKey = (e) => {
        if (e.key === "Escape") onClose();
      };
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    }, [onClose]);
    return /* @__PURE__ */ React.createElement("div", { style: { ...s.overlay, ...desktop && d.overlay }, onClick: onClose }, /* @__PURE__ */ React.createElement("div", { style: { ...s.sheet, ...desktop && d.sheet }, onClick: (e) => e.stopPropagation(), role: "dialog", "aria-modal": "true", "aria-label": title }, !desktop && /* @__PURE__ */ React.createElement("div", { style: s.sheetHandle }), /* @__PURE__ */ React.createElement("div", { style: s.sheetHeader }, /* @__PURE__ */ React.createElement("span", { style: s.sheetTitle }, title), /* @__PURE__ */ React.createElement("button", { style: s.iconBtn, onClick: onClose, "aria-label": "Close" }, /* @__PURE__ */ React.createElement(Icon.x, null))), /* @__PURE__ */ React.createElement("div", { style: { ...s.sheetBody, ...desktop && d.sheetBody } }, children)));
  }
  function EmptyState({ icon, title, text, action }) {
    const EmptyIcon = Icon[icon];
    return /* @__PURE__ */ React.createElement("div", { style: s.empty }, /* @__PURE__ */ React.createElement("div", { style: s.emptyIcon }, /* @__PURE__ */ React.createElement(EmptyIcon, { size: 28 })), /* @__PURE__ */ React.createElement("div", { style: s.emptyTitle }, title), /* @__PURE__ */ React.createElement("div", { style: s.emptyText }, text), action);
  }

  // climbing-tracker/components/NotificationPrompt.jsx
  var { useState: useState9, useEffect: useEffect7 } = React;
  var DISMISS_KEY = "climbing-tracker:notif-prompt-dismissed";
  function readDismissed() {
    try {
      return localStorage.getItem(DISMISS_KEY) || "";
    } catch {
      return "";
    }
  }
  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  }
  function useNotificationState() {
    const [state, setState] = useState9(notificationState);
    useEffect7(() => {
      var _a;
      const refresh = () => setState(notificationState());
      document.addEventListener("visibilitychange", refresh);
      let status = null;
      (_a = navigator.permissions) == null ? void 0 : _a.query({ name: "notifications" }).then((st) => {
        status = st;
        st.onchange = refresh;
      }).catch(() => {
      });
      return () => {
        document.removeEventListener("visibilitychange", refresh);
        if (status) status.onchange = null;
      };
    }, []);
    return [state, setState];
  }
  function NotificationPrompt({ style }) {
    const [state, setState] = useNotificationState();
    const [dismissed, setDismissed] = useState9(readDismissed);
    const kind = state === "unsupported" ? isIOS() && !isInstalled() ? "install" : null : state === "granted" ? null : state;
    if (!kind || dismissed === kind) return null;
    const dismiss = () => {
      try {
        localStorage.setItem(DISMISS_KEY, kind);
      } catch {
      }
      setDismissed(kind);
    };
    const enable = async () => setState(await requestNotifications());
    const text = {
      default: "Turn on notifications to see the rest countdown when the app is in the background.",
      denied: "Notifications are blocked, so you won't see the rest countdown in the background. Allow them for this site in your browser or system settings.",
      install: "Add this app to your Home Screen (Share \u2192 Add to Home Screen) to get rest countdown notifications."
    }[kind];
    return /* @__PURE__ */ React.createElement("div", { style: { ...s.drift, marginTop: 0, marginBottom: 12, ...style }, role: "status" }, /* @__PURE__ */ React.createElement("span", { style: s.driftText }, text), kind === "default" && /* @__PURE__ */ React.createElement("button", { style: s.driftBtn, onClick: enable }, "Enable"), /* @__PURE__ */ React.createElement("button", { style: { ...s.restBarBtn, color: C.accent }, onClick: dismiss, "aria-label": "Dismiss" }, /* @__PURE__ */ React.createElement(Icon.x, { size: 18 })));
  }

  // climbing-tracker/components/TimerSheet.jsx
  var { useState: useState10 } = React;
  var PRESETS = [30, 60, 120, 180, 300];
  var presetLabel = (sec) => sec < 60 ? `${sec}s` : `${sec / 60} min`;
  function TimerSheet({ initialSec = 60, onStart, onClose }) {
    const [min2, setMin] = useState10(Math.floor(initialSec / 60));
    const [sec, setSec] = useState10(initialSec % 60);
    const total = (Number(min2) || 0) * 60 + (Number(sec) || 0);
    return /* @__PURE__ */ React.createElement(Sheet, { title: "Start a timer", onClose }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 } }, PRESETS.map((p) => /* @__PURE__ */ React.createElement("button", { key: p, style: { ...s.btnSecondary, ...s.btnSmall }, onClick: () => onStart(p) }, presetLabel(p)))), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 } }, /* @__PURE__ */ React.createElement(NumberField, { label: "Minutes", value: min2, onChange: setMin }), /* @__PURE__ */ React.createElement(NumberField, { label: "Seconds", value: sec, onChange: setSec, inc: 15 })), /* @__PURE__ */ React.createElement("button", { style: { ...s.btnPrimary, ...s.btnBlock }, disabled: total <= 0, onClick: () => onStart(total) }, /* @__PURE__ */ React.createElement(Icon.play, { size: 18 }), " Start"));
  }

  // climbing-tracker/components/SessionPage.jsx
  var { useState: useState11, useEffect: useEffect8, useRef: useRef5 } = React;
  function ElapsedTime({ since }) {
    const [now, setNow] = useState11(Date.now());
    useEffect8(() => {
      const id = setInterval(() => setNow(Date.now()), 1e3);
      return () => clearInterval(id);
    }, []);
    return formatTime(Math.max(0, Math.floor((now - since) / 1e3)));
  }
  function useWakeLock() {
    useEffect8(() => {
      if (!("wakeLock" in navigator)) return;
      let lock = null;
      let active = true;
      const acquire = async () => {
        if (document.visibilityState !== "visible") return;
        try {
          const l = await navigator.wakeLock.request("screen");
          if (active) lock = l;
          else l.release().catch(() => {
          });
        } catch {
        }
      };
      const onVisible = () => {
        if (document.visibilityState === "visible") acquire();
      };
      acquire();
      document.addEventListener("visibilitychange", onVisible);
      return () => {
        active = false;
        document.removeEventListener("visibilitychange", onVisible);
        if (lock) lock.release().catch(() => {
        });
      };
    }, []);
  }
  var SCROLL_KEY = "climbing-tracker-session-scroll";
  function useRestoredScroll(sessionId) {
    useEffect8(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(SCROLL_KEY));
        if (saved && saved.id === sessionId && saved.y > 0) requestAnimationFrame(() => window.scrollTo(0, saved.y));
      } catch {
      }
      const save = () => {
        if (document.visibilityState !== "hidden") return;
        try {
          localStorage.setItem(SCROLL_KEY, JSON.stringify({ id: sessionId, y: window.scrollY }));
        } catch {
        }
      };
      document.addEventListener("visibilitychange", save);
      return () => document.removeEventListener("visibilitychange", save);
    }, [sessionId]);
  }
  function SessionPage({ session, initialLogs = [], initialOrder, initialInterRest, initialTimer, notesById, onCancel, onLogChange, onOrderChange, onInterRestChange, onTimerChange, onFinish, onNotesChange }) {
    var _a, _b;
    const [order, setOrder] = useState11(() => initialOrder || groupSteps(session.exercises.map((_2, i) => i), (i) => session.exercises[i].supersetGroup || null));
    const doneCountOf = (ex, log) => isIntervalType(ex.type) ? (log == null ? void 0 : log.completedSets) || 0 : ((log == null ? void 0 : log.rows) || []).filter((r) => r.done).length;
    const completedRef = useRef5(session.exercises.map((ex, i) => !!initialLogs[i] && isStepComplete(ex, initialLogs[i])));
    const doneCountRef = useRef5(session.exercises.map((ex, i) => doneCountOf(ex, initialLogs[i])));
    const firstOrderRef = useRef5(true);
    useEffect8(() => {
      if (firstOrderRef.current) {
        firstOrderRef.current = false;
        return;
      }
      onOrderChange && onOrderChange(order);
    }, [order]);
    const [cardExercises] = useState11(() => session.exercises.map((ex) => ex.supersetGroup && !isIntervalType(ex.type) ? { ...ex, restSec: 0 } : ex));
    const interRestTimer = useRestTimer({ saved: initialInterRest, onSave: onInterRestChange });
    const interRest = interRestTimer.rest;
    const customTimer = useRestTimer({ saved: initialTimer, onSave: onTimerChange });
    const [timerSheetOpen, setTimerSheetOpen] = useState11(false);
    const startCustomTimer = (sec) => {
      setTimerSheetOpen(false);
      customTimer.start(sec, { label: "Timer", notice: `${formatTime(sec)} timer`, overTitle: "Timer done" });
    };
    const [restDock, setRestDock] = useState11(null);
    const desktop = useIsDesktop();
    useWakeLock();
    useRestoredScroll(session.id);
    const startInterRest = (restAfterSec, label = "Next exercise in") => {
      const notice = label === "Next round in" ? "Next superset round" : "Next exercise";
      interRestTimer.start(restAfterSec, { label, notice });
    };
    const skipInterRest = interRestTimer.stop;
    const moveCard = (position, dir) => {
      skipInterRest();
      setOrder((o) => {
        const arr = [...o];
        const j = position + dir;
        if (j < 0 || j >= arr.length) return o;
        [arr[position], arr[j]] = [arr[j], arr[position]];
        return arr;
      });
    };
    const handleCardChange = (exIdx, log, meta) => {
      onLogChange(exIdx, log);
      const exercise = session.exercises[exIdx];
      const pos = order.findIndex((block2) => block2.includes(exIdx));
      if (pos === -1) return;
      const block = order[pos];
      const last = session.exercises[block[block.length - 1]];
      const isLastPos = pos === order.length - 1;
      const wasBlockComplete = block.every((i) => completedRef.current[i]);
      const prevRound = Math.min(...block.map((i) => doneCountRef.current[i]));
      completedRef.current[exIdx] = isStepComplete(exercise, log);
      doneCountRef.current[exIdx] = doneCountOf(exercise, log);
      const blockComplete = block.every((i) => completedRef.current[i]);
      const round2 = Math.min(...block.map((i) => doneCountRef.current[i]));
      if (meta == null ? void 0 : meta.restored) return;
      if (blockComplete && !wasBlockComplete) {
        if (last.restAfterSec > 0 && !isLastPos) startInterRest(last.restAfterSec);
      } else if (block.length > 1 && !blockComplete && round2 > prevRound && last.restSec > 0) {
        startInterRest(last.restSec, "Next round in");
      }
    };
    return /* @__PURE__ */ React.createElement(RestDockContext.Provider, { value: restDock }, /* @__PURE__ */ React.createElement("div", { style: s.sessionTop }, /* @__PURE__ */ React.createElement(
      Header,
      {
        title: session.kind === "routine" ? session.refName : (_a = session.exercises[0]) == null ? void 0 : _a.name,
        subtitle: /* @__PURE__ */ React.createElement(ElapsedTime, { since: session.startedAt }),
        left: /* @__PURE__ */ React.createElement("button", { style: { ...s.textBtn, color: C.muted }, onClick: onCancel }, "Cancel"),
        right: /* @__PURE__ */ React.createElement("button", { style: { ...s.iconBtn, color: C.accent }, onClick: () => setTimerSheetOpen(true), "aria-label": "Start a timer" }, /* @__PURE__ */ React.createElement(Icon.timer, null))
      }
    ), /* @__PURE__ */ React.createElement("div", { ref: setRestDock, style: { ...s.restDock, ...desktop && d.restDock } })), /* @__PURE__ */ React.createElement("div", { style: { ...s.pageWithBottomBar, ...desktop && { ...d.pageWithBottomBar, ...d.cardGrid } } }, /* @__PURE__ */ React.createElement(NotificationPrompt, { style: desktop ? d.fullRow : void 0 }), order.map((block, position) => {
      const isSuperset = block.length > 1;
      const cards = block.map((exIdx, k) => /* @__PURE__ */ React.createElement(
        ExerciseCard,
        {
          key: exIdx,
          exercise: cardExercises[exIdx],
          initialLog: initialLogs[exIdx],
          notes: notesById[session.exercises[exIdx].id],
          position,
          total: order.length,
          label: isSuperset ? `${position + 1}${String.fromCharCode(65 + k)}` : null,
          onChange: (log, meta) => handleCardChange(exIdx, log, meta),
          onMove: (dir) => moveCard(position, dir),
          onNotesChange: (text) => onNotesChange(session.exercises[exIdx].id, text)
        }
      ));
      return /* @__PURE__ */ React.createElement(React.Fragment, { key: block[0] }, isSuperset ? /* @__PURE__ */ React.createElement("div", { style: { ...s.supersetBlock, ...desktop && { ...d.fullRow, marginBottom: 0 } } }, /* @__PURE__ */ React.createElement("div", { style: s.supersetLabel }, /* @__PURE__ */ React.createElement(Icon.link, { size: 14 }), " Superset \xB7 alternate sets"), /* @__PURE__ */ React.createElement("div", { style: desktop ? d.cardGrid : void 0 }, cards)) : cards);
    })), interRest && /* @__PURE__ */ React.createElement(
      RestBar,
      {
        label: interRest.label,
        tone: "accent",
        timeLeft: interRest.timeLeft,
        remainingMs: interRest.remainingMs,
        total: interRest.total,
        paused: interRest.paused,
        onTogglePause: interRestTimer.togglePause,
        onSkip: skipInterRest
      }
    ), customTimer.rest && /* @__PURE__ */ React.createElement(
      RestBar,
      {
        label: customTimer.rest.label,
        tone: "accent",
        timeLeft: customTimer.rest.timeLeft,
        remainingMs: customTimer.rest.remainingMs,
        total: customTimer.rest.total,
        paused: customTimer.rest.paused,
        onTogglePause: customTimer.togglePause,
        onSkip: customTimer.stop
      }
    ), timerSheetOpen && /* @__PURE__ */ React.createElement(
      TimerSheet,
      {
        initialSec: ((_b = customTimer.rest) == null ? void 0 : _b.total) || 60,
        onStart: startCustomTimer,
        onClose: () => setTimerSheetOpen(false)
      }
    ), /* @__PURE__ */ React.createElement("div", { style: { ...s.bottomBar, ...desktop && d.bottomBar } }, /* @__PURE__ */ React.createElement("button", { style: { ...s.btnPrimary, ...s.btnBlock, minHeight: 54, ...desktop && d.bottomBarBtn }, onClick: onFinish }, /* @__PURE__ */ React.createElement(Icon.flag, { size: 20 }), " Finish workout")));
  }

  // climbing-tracker/components/SetTargetsEditor.jsx
  function SetTargetsEditor({ sets, isWeighted, onChange }) {
    const updateRow = (i, patch) => onChange(sets.map((row, idx) => idx === i ? { ...row, ...patch } : row));
    const removeRow = (i) => onChange(sets.filter((_2, idx) => idx !== i));
    const addRow = () => onChange([...sets, { ...sets[sets.length - 1] || { reps: 10, weight: 0 } }]);
    return /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 18 } }, sets.map((row, i) => /* @__PURE__ */ React.createElement("div", { key: i, style: s.setRow }, /* @__PURE__ */ React.createElement("span", { style: s.setIndex }, i + 1), /* @__PURE__ */ React.createElement(
      SetValueInput,
      {
        value: row.reps,
        onChange: (v) => updateRow(i, { reps: v === "" ? "" : parseInt(v, 10) || 0 }),
        suffix: "reps",
        label: `Set ${i + 1} reps`
      }
    ), isWeighted && /* @__PURE__ */ React.createElement(
      SetValueInput,
      {
        value: row.weight,
        onChange: (v) => updateRow(i, { weight: v === "" ? "" : parseFloat(v) || 0 }),
        suffix: "kg",
        decimal: true,
        label: `Set ${i + 1} weight`
      }
    ), /* @__PURE__ */ React.createElement("button", { style: s.iconBtn, onClick: () => removeRow(i), disabled: sets.length <= 1, "aria-label": `Remove set ${i + 1}` }, /* @__PURE__ */ React.createElement(Icon.x, { size: 20 })))), /* @__PURE__ */ React.createElement("button", { style: { ...s.btnSecondary, ...s.btnSmall, ...s.btnBlock, marginTop: 4 }, onClick: addRow }, /* @__PURE__ */ React.createElement(Icon.plus, { size: 18 }), " Add set"));
  }

  // climbing-tracker/components/useDragReorder.js
  var { useRef: useRef6, useState: useState12 } = React;
  var EDGE = 80;
  function useDragReorder(onDrop) {
    const drag = useRef6(null);
    const [draggingList, setDraggingList] = useState12(null);
    const siblings = (listId) => [...document.querySelectorAll(`[data-drag-list="${listId}"]`)];
    const layout = (st) => {
      const { els, rects, from, pointerY, startY } = st;
      const dy = pointerY + window.scrollY - startY;
      const self = rects[from];
      const center = self.top + self.height / 2 + dy;
      let to = 0;
      rects.forEach((r, i) => {
        if (i !== from && r.top + r.height / 2 < center) to++;
      });
      const shift = from < rects.length - 1 ? rects[from + 1].top - self.top : self.top - rects[from - 1].top;
      els.forEach((el, i) => {
        if (i === from) {
          el.style.transform = `translateY(${dy}px)`;
          return;
        }
        const offset = from < to && i > from && i <= to ? -shift : to < from && i >= to && i < from ? shift : 0;
        el.style.transform = offset ? `translateY(${offset}px)` : "";
      });
      st.to = to;
    };
    const onPointerMove = (e) => {
      const st = drag.current;
      if (!st || e.pointerId !== st.pointerId) return;
      st.pointerY = e.clientY;
      if (e.clientY < EDGE) window.scrollBy(0, -12);
      else if (e.clientY > window.innerHeight - EDGE) window.scrollBy(0, 12);
      layout(st);
    };
    const finish = (e) => {
      const st = drag.current;
      if (!st || e.pointerId !== st.pointerId) return;
      drag.current = null;
      e.currentTarget.removeEventListener("pointermove", onPointerMove);
      st.els.forEach((el) => {
        el.style.transform = "";
        el.style.transition = "";
        el.style.zIndex = "";
        el.style.position = "";
        el.style.boxShadow = "";
      });
      setDraggingList(null);
      if (st.to !== st.from) onDrop(st.listId, st.from, st.to);
    };
    const handleProps = (listId, index) => ({
      style: { touchAction: "none", cursor: draggingList === listId ? "grabbing" : "grab" },
      onPointerDown: (e) => {
        if (e.button !== 0 || drag.current) return;
        e.preventDefault();
        const els = siblings(listId);
        if (els.length < 2) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.addEventListener("pointermove", onPointerMove);
        els.forEach((el, i) => {
          el.style.transition = i === index ? "none" : "transform .15s ease";
          if (i === index) Object.assign(el.style, { position: "relative", zIndex: 20, boxShadow: "0 12px 32px rgba(0,0,0,0.5)" });
        });
        drag.current = {
          listId,
          els,
          from: index,
          to: index,
          pointerId: e.pointerId,
          startY: e.clientY + window.scrollY,
          pointerY: e.clientY,
          rects: els.map((el) => {
            const r = el.getBoundingClientRect();
            return { top: r.top + window.scrollY, height: r.height };
          })
        };
        setDraggingList(listId);
      },
      onPointerUp: finish,
      onPointerCancel: finish,
      onKeyDown: (e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const to = index + (e.key === "ArrowUp" ? -1 : 1);
          if (to >= 0 && to < siblings(listId).length) onDrop(listId, index, to);
        }
      }
    });
    return { handleProps, draggingList };
  }

  // climbing-tracker/components/RoutineEditPage.jsx
  var { useState: useState13 } = React;
  var toStepValue = (v) => v === "" ? null : Math.round(v);
  function RoutineEditPage({ routine, exercises, categories = [], onBack, onStart, onDelete, onRename, onAddStep, onUpdateStep, onRemoveStep, onMoveStep, onToggleLink }) {
    const desktop = useIsDesktop();
    const [pickerOpen, setPickerOpen] = useState13(false);
    const resolved = routine.steps.map((step) => ({ step, exercise: exercises.find((e) => e.id === step.exerciseId) })).filter((x) => x.exercise).map((x, i) => ({ ...x, i }));
    const blocks = groupSteps(resolved, (x) => x.step.supersetGroup || null);
    const { handleProps, draggingList } = useDragReorder((listId, from, to) => {
      if (listId === "top") onMoveStep(blocks[from][0].i, to - from, true);
      else onMoveStep(blocks.find((block) => block[0].step.id === listId)[from].i, to - from, false);
    });
    const grip = (listId, index, name) => /* @__PURE__ */ React.createElement("button", { ...handleProps(listId, index), style: { ...s.dragHandle, ...handleProps(listId, index).style }, "aria-label": `Reorder ${name}` }, /* @__PURE__ */ React.createElement(Icon.grip, { size: 20 }));
    const restFields = (step, ex, restLabel) => {
      var _a, _b, _c;
      return /* @__PURE__ */ React.createElement("div", { style: { ...s.fieldGrid, marginBottom: 0 } }, /* @__PURE__ */ React.createElement(NumberField, { label: restLabel, value: (_b = step.restSec) != null ? _b : (_a = ex.restSec) != null ? _a : 0, onChange: (v) => onUpdateStep(step.id, { restSec: toStepValue(v) }), min: 0, inc: 15, suffix: "s" }), /* @__PURE__ */ React.createElement(NumberField, { label: "Rest after", value: (_c = step.restAfterSec) != null ? _c : 0, onChange: (v) => onUpdateStep(step.id, { restAfterSec: toStepValue(v) }), min: 0, inc: 15, suffix: "s" }));
    };
    const linkChip = (i, linked, label) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: `link-${i}`,
        style: { ...s.linkChip, ...linked ? s.linkChipActive : {}, ...draggingList && { visibility: "hidden" } },
        onClick: () => onToggleLink(i),
        "aria-pressed": linked
      },
      /* @__PURE__ */ React.createElement(Icon.link, { size: 16 }),
      " ",
      label
    );
    const renderCard = ({ step, exercise: ex, i }, label, listId, index, inSuperset) => {
      var _a, _b, _c, _d, _e;
      return /* @__PURE__ */ React.createElement("div", { key: step.id, "data-drag-list": listId, style: s.exerciseCard }, /* @__PURE__ */ React.createElement("div", { style: { ...s.exerciseCardHeader, paddingLeft: 6 } }, grip(listId, index, ex.name), /* @__PURE__ */ React.createElement("div", { style: { ...s.exerciseCardHeaderMain, cursor: "default", paddingLeft: 2 } }, /* @__PURE__ */ React.createElement("div", { style: s.exerciseCardName }, /* @__PURE__ */ React.createElement("span", { style: s.stepNumber }, label), /* @__PURE__ */ React.createElement("span", { style: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" } }, ex.name))), /* @__PURE__ */ React.createElement("button", { style: s.iconBtn, onClick: () => onRemoveStep(i), "aria-label": `Remove ${ex.name}` }, /* @__PURE__ */ React.createElement(Icon.x, { size: 20 }))), /* @__PURE__ */ React.createElement("div", { style: s.exerciseCardBody }, isIntervalType(ex.type) ? /* @__PURE__ */ React.createElement("div", { style: { ...s.fieldGrid, marginBottom: 0 } }, /* @__PURE__ */ React.createElement(NumberField, { label: "Work", value: (_a = step.workSec) != null ? _a : ex.workSec, onChange: (v) => onUpdateStep(step.id, { workSec: toStepValue(v) }), min: 1, suffix: "s" }), /* @__PURE__ */ React.createElement(NumberField, { label: "Sets", value: (_b = step.sets) != null ? _b : ex.sets, onChange: (v) => onUpdateStep(step.id, { sets: toStepValue(v) }), min: 1 }), !inSuperset && /* @__PURE__ */ React.createElement(NumberField, { label: "Rest", value: (_d = step.restSec) != null ? _d : (_c = ex.restSec) != null ? _c : 0, onChange: (v) => onUpdateStep(step.id, { restSec: toStepValue(v) }), min: 0, suffix: "s" }), !inSuperset && /* @__PURE__ */ React.createElement(NumberField, { label: "Rest after", value: (_e = step.restAfterSec) != null ? _e : 0, onChange: (v) => onUpdateStep(step.id, { restAfterSec: toStepValue(v) }), min: 0, inc: 15, suffix: "s" })) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
        SetTargetsEditor,
        {
          sets: resolveStepTargetSets(step, ex),
          isWeighted: ex.type === "weighted",
          onChange: (targetSets) => onUpdateStep(step.id, { targetSets })
        }
      ), !inSuperset && restFields(step, ex, "Rest / set"))));
    };
    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
      Header,
      {
        title: "Edit routine",
        left: /* @__PURE__ */ React.createElement("button", { style: s.textBtn, onClick: onBack }, /* @__PURE__ */ React.createElement(Icon.back, { size: 20 }), " Routines"),
        right: null
      }
    ), /* @__PURE__ */ React.createElement("div", { style: { ...s.pageWithBottomBar, ...desktop && { ...d.pageWithBottomBar, ...d.editorColumn } } }, /* @__PURE__ */ React.createElement(
      "input",
      {
        style: s.titleInput,
        value: routine.name,
        onChange: (e) => onRename(e.target.value),
        onKeyDown: (e) => e.key === "Enter" && e.target.blur(),
        placeholder: "Routine name",
        autoFocus: !routine.name
      }
    ), blocks.map((block, b) => {
      var _a, _b;
      const first = block[0], last = block[block.length - 1];
      const nextFirst = (_a = blocks[b + 1]) == null ? void 0 : _a[0];
      const joinsSuperset = block.length > 1 || ((_b = blocks[b + 1]) == null ? void 0 : _b.length) > 1;
      const after = nextFirst ? linkChip(last.i, false, joinsSuperset ? "Add to superset" : "Make superset") : null;
      if (block.length === 1) {
        return /* @__PURE__ */ React.createElement(React.Fragment, { key: first.step.id }, renderCard(first, b + 1, "top", b, false), nextFirst && after);
      }
      return /* @__PURE__ */ React.createElement(React.Fragment, { key: `ss-${first.step.id}` }, /* @__PURE__ */ React.createElement("div", { "data-drag-list": "top", style: { ...s.supersetBlock, background: C.bg } }, /* @__PURE__ */ React.createElement("div", { style: s.supersetHeader }, grip("top", b, `superset ${b + 1}`), /* @__PURE__ */ React.createElement("div", { style: { ...s.supersetLabel, margin: 0, flex: 1 } }, /* @__PURE__ */ React.createElement(Icon.link, { size: 14 }), " Superset ", b + 1, " \xB7 alternate sets")), block.map((x, k) => /* @__PURE__ */ React.createElement(React.Fragment, { key: x.step.id }, renderCard(x, `${b + 1}${String.fromCharCode(65 + k)}`, first.step.id, k, true), k < block.length - 1 && linkChip(x.i, true, "Unlink"))), /* @__PURE__ */ React.createElement("div", { style: s.supersetFooter }, /* @__PURE__ */ React.createElement("div", { style: s.supersetHint }, "No rest between exercises. Rest after each full round:"), restFields(last.step, last.exercise, "Rest / round"))), nextFirst && after);
    }), /* @__PURE__ */ React.createElement("button", { style: { ...s.btnDashed, marginTop: resolved.length ? 12 : 0 }, onClick: () => setPickerOpen(true) }, /* @__PURE__ */ React.createElement(Icon.plus, { size: 20 }), " Add exercise"), /* @__PURE__ */ React.createElement("button", { style: { ...s.btnDangerText, ...desktop ? {} : s.btnBlock, marginTop: 28 }, onClick: onDelete }, /* @__PURE__ */ React.createElement(Icon.trash, { size: 18 }), " Delete routine")), /* @__PURE__ */ React.createElement("div", { style: { ...s.bottomBar, ...desktop && d.bottomBar } }, /* @__PURE__ */ React.createElement("button", { style: { ...s.btnPrimary, ...s.btnBlock, minHeight: 54, ...desktop && d.bottomBarBtn }, onClick: onStart, disabled: resolved.length === 0 }, /* @__PURE__ */ React.createElement(Icon.play, { size: 18 }), " Start routine")), pickerOpen && /* @__PURE__ */ React.createElement(Sheet, { title: "Add exercise", onClose: () => setPickerOpen(false) }, exercises.length === 0 && /* @__PURE__ */ React.createElement("p", { style: s.sheetMessage }, "No exercises yet \u2014 create some in the Exercises tab first."), groupByCategory(exercises, categories).map(({ category, exercises: group }) => {
      var _a, _b;
      return /* @__PURE__ */ React.createElement("div", { key: (_a = category == null ? void 0 : category.id) != null ? _a : "none" }, categories.length > 0 && /* @__PURE__ */ React.createElement("div", { style: s.sectionLabel }, (_b = category == null ? void 0 : category.name) != null ? _b : "Uncategorized"), group.map((ex) => /* @__PURE__ */ React.createElement(
        "button",
        {
          key: ex.id,
          style: s.pickerItem,
          onClick: () => {
            onAddStep(ex.id);
            setPickerOpen(false);
          }
        },
        /* @__PURE__ */ React.createElement("span", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("span", { style: { display: "block", fontSize: 16, fontWeight: 600 } }, ex.name), /* @__PURE__ */ React.createElement("span", { style: { display: "block", fontSize: 13, color: C.muted, marginTop: 2 } }, formatTargetSummary(ex))),
        /* @__PURE__ */ React.createElement("span", { style: { color: C.accent } }, /* @__PURE__ */ React.createElement(Icon.plus, { size: 22 }))
      )));
    })));
  }

  // climbing-tracker/components/DayEditPage.jsx
  var { useState: useState14 } = React;
  function DayEditPage({ label, day, routines, onBack, onDelete, onChange, onMoveItem }) {
    const desktop = useIsDesktop();
    const [pickerOpen, setPickerOpen] = useState14(false);
    const { handleProps } = useDragReorder((_2, from, to) => onMoveItem(from, to));
    const setItems = (items) => onChange({ items });
    const addRoutine = (routineId) => setItems([...day.items, { id: uid(), routineId }]);
    const addNote = () => setItems([...day.items, { id: uid(), text: "" }]);
    const updateNote = (id, text) => setItems(day.items.map((it) => it.id === id ? { ...it, text } : it));
    const removeItem = (id) => setItems(day.items.filter((it) => it.id !== id));
    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
      Header,
      {
        title: "Edit day",
        left: /* @__PURE__ */ React.createElement("button", { style: s.textBtn, onClick: onBack }, /* @__PURE__ */ React.createElement(Icon.back, { size: 20 }), " Plan"),
        right: null
      }
    ), /* @__PURE__ */ React.createElement("div", { style: { ...s.pagePlain, ...desktop && d.editorColumn } }, /* @__PURE__ */ React.createElement("div", { style: { ...s.rowMeta, marginBottom: 4 } }, label), /* @__PURE__ */ React.createElement(
      "input",
      {
        style: s.titleInput,
        value: day.title,
        onChange: (e) => onChange({ title: e.target.value }),
        onKeyDown: (e) => e.key === "Enter" && e.target.blur(),
        placeholder: "Title (optional)"
      }
    ), /* @__PURE__ */ React.createElement(
      "textarea",
      {
        style: s.descriptionArea,
        value: day.description,
        onChange: (e) => onChange({ description: e.target.value }),
        placeholder: "Short description"
      }
    ), /* @__PURE__ */ React.createElement("div", { style: s.label }, "Routines & notes"), day.items.map((item, i) => {
      const routine = isRoutineItem(item) ? routines.find((r) => r.id === item.routineId) : null;
      return /* @__PURE__ */ React.createElement("div", { key: item.id, "data-drag-list": "items", style: s.planItemRow }, /* @__PURE__ */ React.createElement("button", { ...handleProps("items", i), style: { ...s.dragHandle, ...handleProps("items", i).style }, "aria-label": "Reorder" }, /* @__PURE__ */ React.createElement(Icon.grip, { size: 20 })), isRoutineItem(item) ? /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0, fontSize: 16, fontWeight: 600, padding: "8px 4px" } }, routine ? routine.name || "Untitled routine" : "Missing routine") : /* @__PURE__ */ React.createElement(
        "input",
        {
          style: s.planNoteInput,
          value: item.text,
          onChange: (e) => updateNote(item.id, e.target.value),
          placeholder: "Note, e.g. Run 5k",
          autoFocus: !item.text
        }
      ), /* @__PURE__ */ React.createElement("button", { style: s.iconBtn, onClick: () => removeItem(item.id), "aria-label": "Remove" }, /* @__PURE__ */ React.createElement(Icon.x, { size: 20 })));
    }), /* @__PURE__ */ React.createElement("div", { style: { ...s.btnRow, marginTop: day.items.length ? 12 : 0 } }, /* @__PURE__ */ React.createElement("button", { style: { ...s.btnDashed, flex: 1 }, onClick: () => setPickerOpen(true) }, /* @__PURE__ */ React.createElement(Icon.plus, { size: 20 }), " Routine"), /* @__PURE__ */ React.createElement("button", { style: { ...s.btnDashed, flex: 1 }, onClick: addNote }, /* @__PURE__ */ React.createElement(Icon.plus, { size: 20 }), " Note")), /* @__PURE__ */ React.createElement("button", { style: { ...s.btnDangerText, ...desktop ? {} : s.btnBlock, marginTop: 28 }, onClick: onDelete }, /* @__PURE__ */ React.createElement(Icon.trash, { size: 18 }), " Delete day")), pickerOpen && /* @__PURE__ */ React.createElement(Sheet, { title: "Add routine", onClose: () => setPickerOpen(false) }, routines.length === 0 && /* @__PURE__ */ React.createElement("p", { style: s.sheetMessage }, "No routines yet \u2014 create some in the Routines tab first."), routines.map((r) => /* @__PURE__ */ React.createElement("button", { key: r.id, style: s.pickerItem, onClick: () => {
      addRoutine(r.id);
      setPickerOpen(false);
    } }, /* @__PURE__ */ React.createElement("span", { style: { flex: 1, minWidth: 0, fontSize: 16, fontWeight: 600 } }, r.name || "Untitled routine"), /* @__PURE__ */ React.createElement("span", { style: { color: C.accent } }, /* @__PURE__ */ React.createElement(Icon.plus, { size: 22 }))))));
  }

  // climbing-tracker/stats.js
  var DAY_MS2 = 24 * 3600 * 1e3;
  var RANGES = [
    { value: "30d", label: "30d", days: 30 },
    { value: "90d", label: "90d", days: 90 },
    { value: "1y", label: "1y", days: 365 },
    { value: "all", label: "All", days: null }
  ];
  function collectExerciseSessions(history, exercise) {
    const sessions = [];
    history.forEach((entry) => {
      const performed = entry.steps.filter((step) => {
        var _a;
        return step.exerciseId === exercise.id && ((_a = step.performed) == null ? void 0 : _a.type) === exercise.type;
      }).map((step) => step.performed);
      if (performed.length === 0) return;
      sessions.push({
        entryId: entry.id,
        date: entry.date,
        time: new Date(entry.date).getTime(),
        refName: entry.kind === "routine" ? entry.refName : null,
        performed
      });
    });
    return sessions.sort((a, b) => a.time - b.time);
  }
  function filterByRange(sessions, range) {
    var _a;
    const days2 = (_a = RANGES.find((r) => r.value === range)) == null ? void 0 : _a.days;
    if (!days2) return sessions;
    const cutoff = Date.now() - days2 * DAY_MS2;
    return sessions.filter((x) => x.time >= cutoff);
  }
  var allSets = (session) => session.performed.flatMap((p) => p.sets);
  var sum = (values) => values.reduce((a, b) => a + b, 0);
  var round1 = (v) => Math.round(v * 10) / 10;
  function metricsFor(exercise, bodyweight) {
    if (exercise.type === "weighted") {
      const withBw = exercise.weightMode === "added" && bodyweight > 0;
      const bwOf = (x) => {
        var _a, _b;
        return (_b = (_a = x.performed.find((p) => p.bodyweight > 0)) == null ? void 0 : _a.bodyweight) != null ? _b : bodyweight;
      };
      const topWeight = (x) => Math.max(...allSets(x).map((set2) => set2.weight));
      return [
        {
          id: "topWeight",
          label: "Top weight",
          value: topWeight,
          format: (v) => formatWeightLabel(exercise.weightMode, v),
          axis: (v) => `${v}kg`
        },
        ...withBw ? [{
          id: "totalLoad",
          label: "Total load",
          value: (x) => round1(bwOf(x) + topWeight(x)),
          format: (v) => `${v}kg`,
          axis: (v) => `${v}kg`
        }] : [],
        {
          id: "volume",
          label: "Volume",
          value: (x) => round1(sum(allSets(x).map((set2) => set2.reps * (set2.weight + (withBw ? bwOf(x) : 0))))),
          format: (v) => `${v}kg`,
          axis: (v) => `${v}`
        },
        {
          id: "totalReps",
          label: "Total reps",
          value: (x) => sum(allSets(x).map((set2) => set2.reps)),
          format: (v) => `${v} reps`,
          axis: (v) => `${v}`
        }
      ];
    }
    if (isIntervalType(exercise.type)) {
      const weighted = exercise.type === "weightedInterval";
      const withBw = weighted && exercise.weightMode === "added" && bodyweight > 0;
      const bwOf = (x) => {
        var _a, _b;
        return (_b = (_a = x.performed.find((p) => p.bodyweight > 0)) == null ? void 0 : _a.bodyweight) != null ? _b : bodyweight;
      };
      const topWeight = (x) => Math.max(...x.performed.map((p) => {
        var _a;
        return (_a = p.weight) != null ? _a : 0;
      }));
      return [
        ...weighted ? [{
          id: "topWeight",
          label: "Top weight",
          value: topWeight,
          format: (v) => formatWeightLabel(exercise.weightMode, v),
          axis: (v) => `${v}kg`
        }] : [],
        ...withBw ? [{
          id: "totalLoad",
          label: "Total load",
          value: (x) => round1(bwOf(x) + topWeight(x)),
          format: (v) => `${v}kg`,
          axis: (v) => `${v}kg`
        }] : [],
        {
          id: "timeOn",
          label: "Time on",
          value: (x) => sum(x.performed.map((p) => p.completedSets * p.workSec)),
          format: (v) => `${v}s`,
          axis: (v) => `${v}s`
        },
        {
          id: "completedSets",
          label: "Sets",
          value: (x) => sum(x.performed.map((p) => p.completedSets)),
          format: (v) => `${v} sets`,
          axis: (v) => `${v}`
        },
        {
          id: "workSec",
          label: "Work interval",
          value: (x) => Math.max(...x.performed.map((p) => p.workSec)),
          format: (v) => `${v}s`,
          axis: (v) => `${v}s`
        }
      ];
    }
    return [
      {
        id: "bestSet",
        label: "Best set",
        value: (x) => Math.max(...allSets(x).map((set2) => set2.reps)),
        format: (v) => `${v} reps`,
        axis: (v) => `${v}`
      },
      {
        id: "totalReps",
        label: "Total reps",
        value: (x) => sum(allSets(x).map((set2) => set2.reps)),
        format: (v) => `${v} reps`,
        axis: (v) => `${v}`
      }
    ];
  }
  function personalRecords(sessions, metrics) {
    return metrics.map((metric) => {
      let best = null;
      sessions.forEach((x) => {
        const value = metric.value(x);
        if (best === null || value > best.value) best = { value, date: x.date };
      });
      return { metric, ...best };
    }).filter((pr) => pr.date);
  }

  // node_modules/.pnpm/uplot@1.6.32/node_modules/uplot/dist/uPlot.esm.js
  var FEAT_TIME = true;
  var pre = "u-";
  var UPLOT = "uplot";
  var ORI_HZ = pre + "hz";
  var ORI_VT = pre + "vt";
  var TITLE = pre + "title";
  var WRAP = pre + "wrap";
  var UNDER = pre + "under";
  var OVER = pre + "over";
  var AXIS = pre + "axis";
  var OFF = pre + "off";
  var SELECT = pre + "select";
  var CURSOR_X = pre + "cursor-x";
  var CURSOR_Y = pre + "cursor-y";
  var CURSOR_PT = pre + "cursor-pt";
  var LEGEND = pre + "legend";
  var LEGEND_LIVE = pre + "live";
  var LEGEND_INLINE = pre + "inline";
  var LEGEND_SERIES = pre + "series";
  var LEGEND_MARKER = pre + "marker";
  var LEGEND_LABEL = pre + "label";
  var LEGEND_VALUE = pre + "value";
  var WIDTH = "width";
  var HEIGHT = "height";
  var TOP = "top";
  var BOTTOM = "bottom";
  var LEFT = "left";
  var RIGHT = "right";
  var hexBlack = "#000";
  var transparent = hexBlack + "0";
  var mousemove = "mousemove";
  var mousedown = "mousedown";
  var mouseup = "mouseup";
  var mouseenter = "mouseenter";
  var mouseleave = "mouseleave";
  var dblclick = "dblclick";
  var resize = "resize";
  var scroll = "scroll";
  var change = "change";
  var dppxchange = "dppxchange";
  var LEGEND_DISP = "--";
  var domEnv = typeof window != "undefined";
  var doc = domEnv ? document : null;
  var win = domEnv ? window : null;
  var nav = domEnv ? navigator : null;
  var pxRatio;
  var query;
  function setPxRatio() {
    let _pxRatio = devicePixelRatio;
    if (pxRatio != _pxRatio) {
      pxRatio = _pxRatio;
      query && off(change, query, setPxRatio);
      query = matchMedia(`(min-resolution: ${pxRatio - 1e-3}dppx) and (max-resolution: ${pxRatio + 1e-3}dppx)`);
      on(change, query, setPxRatio);
      win.dispatchEvent(new CustomEvent(dppxchange));
    }
  }
  function addClass(el, c) {
    if (c != null) {
      let cl = el.classList;
      !cl.contains(c) && cl.add(c);
    }
  }
  function remClass(el, c) {
    let cl = el.classList;
    cl.contains(c) && cl.remove(c);
  }
  function setStylePx(el, name, value) {
    el.style[name] = value + "px";
  }
  function placeTag(tag, cls, targ, refEl) {
    let el = doc.createElement(tag);
    if (cls != null)
      addClass(el, cls);
    if (targ != null)
      targ.insertBefore(el, refEl);
    return el;
  }
  function placeDiv(cls, targ) {
    return placeTag("div", cls, targ);
  }
  var xformCache = /* @__PURE__ */ new WeakMap();
  function elTrans(el, xPos, yPos, xMax, yMax) {
    let xform = "translate(" + xPos + "px," + yPos + "px)";
    let xformOld = xformCache.get(el);
    if (xform != xformOld) {
      el.style.transform = xform;
      xformCache.set(el, xform);
      if (xPos < 0 || yPos < 0 || xPos > xMax || yPos > yMax)
        addClass(el, OFF);
      else
        remClass(el, OFF);
    }
  }
  var colorCache = /* @__PURE__ */ new WeakMap();
  function elColor(el, background, borderColor) {
    let newColor = background + borderColor;
    let oldColor = colorCache.get(el);
    if (newColor != oldColor) {
      colorCache.set(el, newColor);
      el.style.background = background;
      el.style.borderColor = borderColor;
    }
  }
  var sizeCache = /* @__PURE__ */ new WeakMap();
  function elSize(el, newWid, newHgt, centered) {
    let newSize = newWid + "" + newHgt;
    let oldSize = sizeCache.get(el);
    if (newSize != oldSize) {
      sizeCache.set(el, newSize);
      el.style.height = newHgt + "px";
      el.style.width = newWid + "px";
      el.style.marginLeft = centered ? -newWid / 2 + "px" : 0;
      el.style.marginTop = centered ? -newHgt / 2 + "px" : 0;
    }
  }
  var evOpts = { passive: true };
  var evOpts2 = { ...evOpts, capture: true };
  function on(ev, el, cb, capt) {
    el.addEventListener(ev, cb, capt ? evOpts2 : evOpts);
  }
  function off(ev, el, cb, capt) {
    el.removeEventListener(ev, cb, evOpts);
  }
  domEnv && setPxRatio();
  function closestIdx(num2, arr, lo, hi) {
    let mid;
    lo = lo || 0;
    hi = hi || arr.length - 1;
    let bitwise = hi <= 2147483647;
    while (hi - lo > 1) {
      mid = bitwise ? lo + hi >> 1 : floor((lo + hi) / 2);
      if (arr[mid] < num2)
        lo = mid;
      else
        hi = mid;
    }
    if (num2 - arr[lo] <= arr[hi] - num2)
      return lo;
    return hi;
  }
  function makeIndexOfs(predicate) {
    let indexOfs = (data, _i0, _i1) => {
      let i0 = -1;
      let i1 = -1;
      for (let i = _i0; i <= _i1; i++) {
        if (predicate(data[i])) {
          i0 = i;
          break;
        }
      }
      for (let i = _i1; i >= _i0; i--) {
        if (predicate(data[i])) {
          i1 = i;
          break;
        }
      }
      return [i0, i1];
    };
    return indexOfs;
  }
  var notNullish = (v) => v != null;
  var isPositive = (v) => v != null && v > 0;
  var nonNullIdxs = makeIndexOfs(notNullish);
  var positiveIdxs = makeIndexOfs(isPositive);
  function getMinMax(data, _i0, _i1, sorted = 0, log = false) {
    let getEdgeIdxs = log ? positiveIdxs : nonNullIdxs;
    let predicate = log ? isPositive : notNullish;
    [_i0, _i1] = getEdgeIdxs(data, _i0, _i1);
    let _min = data[_i0];
    let _max = data[_i0];
    if (_i0 > -1) {
      if (sorted == 1) {
        _min = data[_i0];
        _max = data[_i1];
      } else if (sorted == -1) {
        _min = data[_i1];
        _max = data[_i0];
      } else {
        for (let i = _i0; i <= _i1; i++) {
          let v = data[i];
          if (predicate(v)) {
            if (v < _min)
              _min = v;
            else if (v > _max)
              _max = v;
          }
        }
      }
    }
    return [_min != null ? _min : inf, _max != null ? _max : -inf];
  }
  function rangeLog(min2, max2, base, fullMags) {
    let minSign = sign(min2);
    let maxSign = sign(max2);
    if (min2 == max2) {
      if (minSign == -1) {
        min2 *= base;
        max2 /= base;
      } else {
        min2 /= base;
        max2 *= base;
      }
    }
    let logFn = base == 10 ? log10 : log2;
    let growMinAbs = minSign == 1 ? floor : ceil;
    let growMaxAbs = maxSign == 1 ? ceil : floor;
    let minExp = growMinAbs(logFn(abs(min2)));
    let maxExp = growMaxAbs(logFn(abs(max2)));
    let minIncr = pow(base, minExp);
    let maxIncr = pow(base, maxExp);
    if (base == 10) {
      if (minExp < 0)
        minIncr = roundDec(minIncr, -minExp);
      if (maxExp < 0)
        maxIncr = roundDec(maxIncr, -maxExp);
    }
    if (fullMags || base == 2) {
      min2 = minIncr * minSign;
      max2 = maxIncr * maxSign;
    } else {
      min2 = incrRoundDn(min2, minIncr);
      max2 = incrRoundUp(max2, maxIncr);
    }
    return [min2, max2];
  }
  function rangeAsinh(min2, max2, base, fullMags) {
    let minMax = rangeLog(min2, max2, base, fullMags);
    if (min2 == 0)
      minMax[0] = 0;
    if (max2 == 0)
      minMax[1] = 0;
    return minMax;
  }
  var rangePad = 0.1;
  var autoRangePart = {
    mode: 3,
    pad: rangePad
  };
  var _eqRangePart = {
    pad: 0,
    soft: null,
    mode: 0
  };
  var _eqRange = {
    min: _eqRangePart,
    max: _eqRangePart
  };
  function rangeNum(_min, _max, mult, extra) {
    if (isObj(mult))
      return _rangeNum(_min, _max, mult);
    _eqRangePart.pad = mult;
    _eqRangePart.soft = extra ? 0 : null;
    _eqRangePart.mode = extra ? 3 : 0;
    return _rangeNum(_min, _max, _eqRange);
  }
  function ifNull(lh, rh) {
    return lh == null ? rh : lh;
  }
  function hasData(data, idx0, idx1) {
    idx0 = ifNull(idx0, 0);
    idx1 = ifNull(idx1, data.length - 1);
    while (idx0 <= idx1) {
      if (data[idx0] != null)
        return true;
      idx0++;
    }
    return false;
  }
  function _rangeNum(_min, _max, cfg) {
    let cmin = cfg.min;
    let cmax = cfg.max;
    let padMin = ifNull(cmin.pad, 0);
    let padMax = ifNull(cmax.pad, 0);
    let hardMin = ifNull(cmin.hard, -inf);
    let hardMax = ifNull(cmax.hard, inf);
    let softMin = ifNull(cmin.soft, inf);
    let softMax = ifNull(cmax.soft, -inf);
    let softMinMode = ifNull(cmin.mode, 0);
    let softMaxMode = ifNull(cmax.mode, 0);
    let delta = _max - _min;
    let deltaMag = log10(delta);
    let scalarMax = max(abs(_min), abs(_max));
    let scalarMag = log10(scalarMax);
    let scalarMagDelta = abs(scalarMag - deltaMag);
    if (delta < 1e-24 || scalarMagDelta > 10) {
      delta = 0;
      if (_min == 0 || _max == 0) {
        delta = 1e-24;
        if (softMinMode == 2 && softMin != inf)
          padMin = 0;
        if (softMaxMode == 2 && softMax != -inf)
          padMax = 0;
      }
    }
    let nonZeroDelta = delta || scalarMax || 1e3;
    let mag = log10(nonZeroDelta);
    let base = pow(10, floor(mag));
    let _padMin = nonZeroDelta * (delta == 0 ? _min == 0 ? 0.1 : 1 : padMin);
    let _newMin = roundDec(incrRoundDn(_min - _padMin, base / 10), 24);
    let _softMin = _min >= softMin && (softMinMode == 1 || softMinMode == 3 && _newMin <= softMin || softMinMode == 2 && _newMin >= softMin) ? softMin : inf;
    let minLim = max(hardMin, _newMin < _softMin && _min >= _softMin ? _softMin : min(_softMin, _newMin));
    let _padMax = nonZeroDelta * (delta == 0 ? _max == 0 ? 0.1 : 1 : padMax);
    let _newMax = roundDec(incrRoundUp(_max + _padMax, base / 10), 24);
    let _softMax = _max <= softMax && (softMaxMode == 1 || softMaxMode == 3 && _newMax >= softMax || softMaxMode == 2 && _newMax <= softMax) ? softMax : -inf;
    let maxLim = min(hardMax, _newMax > _softMax && _max <= _softMax ? _softMax : max(_softMax, _newMax));
    if (minLim == maxLim && minLim == 0)
      maxLim = 100;
    return [minLim, maxLim];
  }
  var numFormatter = new Intl.NumberFormat(domEnv ? nav.language : "en-US");
  var fmtNum = (val) => numFormatter.format(val);
  var M = Math;
  var PI = M.PI;
  var abs = M.abs;
  var floor = M.floor;
  var round = M.round;
  var ceil = M.ceil;
  var min = M.min;
  var max = M.max;
  var pow = M.pow;
  var sign = M.sign;
  var log10 = M.log10;
  var log2 = M.log2;
  var sinh = (v, linthresh = 1) => M.sinh(v) * linthresh;
  var asinh = (v, linthresh = 1) => M.asinh(v / linthresh);
  var inf = Infinity;
  function numIntDigits(x) {
    return (log10((x ^ x >> 31) - (x >> 31)) | 0) + 1;
  }
  function clamp(num2, _min, _max) {
    return min(max(num2, _min), _max);
  }
  function isFn(v) {
    return typeof v == "function";
  }
  function fnOrSelf(v) {
    return isFn(v) ? v : () => v;
  }
  var noop = () => {
  };
  var retArg0 = (_0) => _0;
  var retArg1 = (_0, _1) => _1;
  var retNull = (_2) => null;
  var retTrue = (_2) => true;
  var retEq = (a, b) => a == b;
  var regex6 = /\.\d*?(?=9{6,}|0{6,})/gm;
  var fixFloat = (val) => {
    if (isInt(val) || fixedDec.has(val))
      return val;
    const str = `${val}`;
    const match = str.match(regex6);
    if (match == null)
      return val;
    let len = match[0].length - 1;
    if (str.indexOf("e-") != -1) {
      let [num2, exp] = str.split("e");
      return +`${fixFloat(num2)}e${exp}`;
    }
    return roundDec(val, len);
  };
  function incrRound(num2, incr) {
    return fixFloat(roundDec(fixFloat(num2 / incr)) * incr);
  }
  function incrRoundUp(num2, incr) {
    return fixFloat(ceil(fixFloat(num2 / incr)) * incr);
  }
  function incrRoundDn(num2, incr) {
    return fixFloat(floor(fixFloat(num2 / incr)) * incr);
  }
  function roundDec(val, dec = 0) {
    if (isInt(val))
      return val;
    let p = 10 ** dec;
    let n = val * p * (1 + Number.EPSILON);
    return round(n) / p;
  }
  var fixedDec = /* @__PURE__ */ new Map();
  function guessDec(num2) {
    return (("" + num2).split(".")[1] || "").length;
  }
  function genIncrs(base, minExp, maxExp, mults) {
    let incrs = [];
    let multDec = mults.map(guessDec);
    for (let exp = minExp; exp < maxExp; exp++) {
      let expa = abs(exp);
      let mag = roundDec(pow(base, exp), expa);
      for (let i = 0; i < mults.length; i++) {
        let _incr = base == 10 ? +`${mults[i]}e${exp}` : mults[i] * mag;
        let dec = (exp >= 0 ? 0 : expa) + (exp >= multDec[i] ? 0 : multDec[i]);
        let incr = base == 10 ? _incr : roundDec(_incr, dec);
        incrs.push(incr);
        fixedDec.set(incr, dec);
      }
    }
    return incrs;
  }
  var EMPTY_OBJ = {};
  var EMPTY_ARR = [];
  var nullNullTuple = [null, null];
  var isArr = Array.isArray;
  var isInt = Number.isInteger;
  var isUndef = (v) => v === void 0;
  function isStr(v) {
    return typeof v == "string";
  }
  function isObj(v) {
    let is = false;
    if (v != null) {
      let c = v.constructor;
      is = c == null || c == Object;
    }
    return is;
  }
  function fastIsObj(v) {
    return v != null && typeof v == "object";
  }
  var TypedArray = Object.getPrototypeOf(Uint8Array);
  var __proto__ = "__proto__";
  function copy(o, _isObj = isObj) {
    let out;
    if (isArr(o)) {
      let val = o.find((v) => v != null);
      if (isArr(val) || _isObj(val)) {
        out = Array(o.length);
        for (let i = 0; i < o.length; i++)
          out[i] = copy(o[i], _isObj);
      } else
        out = o.slice();
    } else if (o instanceof TypedArray)
      out = o.slice();
    else if (_isObj(o)) {
      out = {};
      for (let k in o) {
        if (k != __proto__)
          out[k] = copy(o[k], _isObj);
      }
    } else
      out = o;
    return out;
  }
  function assign(targ) {
    let args = arguments;
    for (let i = 1; i < args.length; i++) {
      let src = args[i];
      for (let key in src) {
        if (key != __proto__) {
          if (isObj(targ[key]))
            assign(targ[key], copy(src[key]));
          else
            targ[key] = copy(src[key]);
        }
      }
    }
    return targ;
  }
  var NULL_REMOVE = 0;
  var NULL_RETAIN = 1;
  var NULL_EXPAND = 2;
  function nullExpand(yVals, nullIdxs, alignedLen) {
    for (let i = 0, xi, lastNullIdx = -1; i < nullIdxs.length; i++) {
      let nullIdx = nullIdxs[i];
      if (nullIdx > lastNullIdx) {
        xi = nullIdx - 1;
        while (xi >= 0 && yVals[xi] == null)
          yVals[xi--] = null;
        xi = nullIdx + 1;
        while (xi < alignedLen && yVals[xi] == null)
          yVals[lastNullIdx = xi++] = null;
      }
    }
  }
  function join(tables, nullModes) {
    if (allHeadersSame(tables)) {
      let table = tables[0].slice();
      for (let i = 1; i < tables.length; i++)
        table.push(...tables[i].slice(1));
      if (!isAsc(table[0]))
        table = sortCols(table);
      return table;
    }
    let xVals = /* @__PURE__ */ new Set();
    for (let ti = 0; ti < tables.length; ti++) {
      let t = tables[ti];
      let xs = t[0];
      let len = xs.length;
      for (let i = 0; i < len; i++)
        xVals.add(xs[i]);
    }
    let data = [Array.from(xVals).sort((a, b) => a - b)];
    let alignedLen = data[0].length;
    let xIdxs = /* @__PURE__ */ new Map();
    for (let i = 0; i < alignedLen; i++)
      xIdxs.set(data[0][i], i);
    for (let ti = 0; ti < tables.length; ti++) {
      let t = tables[ti];
      let xs = t[0];
      for (let si = 1; si < t.length; si++) {
        let ys = t[si];
        let yVals = Array(alignedLen).fill(void 0);
        let nullMode = nullModes ? nullModes[ti][si] : NULL_RETAIN;
        let nullIdxs = [];
        for (let i = 0; i < ys.length; i++) {
          let yVal = ys[i];
          let alignedIdx = xIdxs.get(xs[i]);
          if (yVal === null) {
            if (nullMode != NULL_REMOVE) {
              yVals[alignedIdx] = yVal;
              if (nullMode == NULL_EXPAND)
                nullIdxs.push(alignedIdx);
            }
          } else
            yVals[alignedIdx] = yVal;
        }
        nullExpand(yVals, nullIdxs, alignedLen);
        data.push(yVals);
      }
    }
    return data;
  }
  var microTask = typeof queueMicrotask == "undefined" ? (fn) => Promise.resolve().then(fn) : queueMicrotask;
  function sortCols(table) {
    let head = table[0];
    let rlen = head.length;
    let idxs = Array(rlen);
    for (let i = 0; i < idxs.length; i++)
      idxs[i] = i;
    idxs.sort((i0, i1) => head[i0] - head[i1]);
    let table2 = [];
    for (let i = 0; i < table.length; i++) {
      let row = table[i];
      let row2 = Array(rlen);
      for (let j = 0; j < rlen; j++)
        row2[j] = row[idxs[j]];
      table2.push(row2);
    }
    return table2;
  }
  function allHeadersSame(tables) {
    let vals0 = tables[0][0];
    let len0 = vals0.length;
    for (let i = 1; i < tables.length; i++) {
      let vals1 = tables[i][0];
      if (vals1.length != len0)
        return false;
      if (vals1 != vals0) {
        for (let j = 0; j < len0; j++) {
          if (vals1[j] != vals0[j])
            return false;
        }
      }
    }
    return true;
  }
  function isAsc(vals, samples = 100) {
    const len = vals.length;
    if (len <= 1)
      return true;
    let firstIdx = 0;
    let lastIdx = len - 1;
    while (firstIdx <= lastIdx && vals[firstIdx] == null)
      firstIdx++;
    while (lastIdx >= firstIdx && vals[lastIdx] == null)
      lastIdx--;
    if (lastIdx <= firstIdx)
      return true;
    const stride = max(1, floor((lastIdx - firstIdx + 1) / samples));
    for (let prevVal = vals[firstIdx], i = firstIdx + stride; i <= lastIdx; i += stride) {
      const v = vals[i];
      if (v != null) {
        if (v <= prevVal)
          return false;
        prevVal = v;
      }
    }
    return true;
  }
  var months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ];
  var days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday"
  ];
  function slice3(str) {
    return str.slice(0, 3);
  }
  var days3 = days.map(slice3);
  var months3 = months.map(slice3);
  var engNames = {
    MMMM: months,
    MMM: months3,
    WWWW: days,
    WWW: days3
  };
  function zeroPad2(int) {
    return (int < 10 ? "0" : "") + int;
  }
  function zeroPad3(int) {
    return (int < 10 ? "00" : int < 100 ? "0" : "") + int;
  }
  var subs2 = {
    // 2019
    YYYY: (d2) => d2.getFullYear(),
    // 19
    YY: (d2) => (d2.getFullYear() + "").slice(2),
    // July
    MMMM: (d2, names) => names.MMMM[d2.getMonth()],
    // Jul
    MMM: (d2, names) => names.MMM[d2.getMonth()],
    // 07
    MM: (d2) => zeroPad2(d2.getMonth() + 1),
    // 7
    M: (d2) => d2.getMonth() + 1,
    // 09
    DD: (d2) => zeroPad2(d2.getDate()),
    // 9
    D: (d2) => d2.getDate(),
    // Monday
    WWWW: (d2, names) => names.WWWW[d2.getDay()],
    // Mon
    WWW: (d2, names) => names.WWW[d2.getDay()],
    // 03
    HH: (d2) => zeroPad2(d2.getHours()),
    // 3
    H: (d2) => d2.getHours(),
    // 9 (12hr, unpadded)
    h: (d2) => {
      let h = d2.getHours();
      return h == 0 ? 12 : h > 12 ? h - 12 : h;
    },
    // AM
    AA: (d2) => d2.getHours() >= 12 ? "PM" : "AM",
    // am
    aa: (d2) => d2.getHours() >= 12 ? "pm" : "am",
    // a
    a: (d2) => d2.getHours() >= 12 ? "p" : "a",
    // 09
    mm: (d2) => zeroPad2(d2.getMinutes()),
    // 9
    m: (d2) => d2.getMinutes(),
    // 09
    ss: (d2) => zeroPad2(d2.getSeconds()),
    // 9
    s: (d2) => d2.getSeconds(),
    // 374
    fff: (d2) => zeroPad3(d2.getMilliseconds())
  };
  function fmtDate(tpl, names) {
    names = names || engNames;
    let parts = [];
    let R = /\{([a-z]+)\}|[^{]+/gi, m;
    while (m = R.exec(tpl))
      parts.push(m[0][0] == "{" ? subs2[m[1]] : m[0]);
    return (d2) => {
      let out = "";
      for (let i = 0; i < parts.length; i++)
        out += typeof parts[i] == "string" ? parts[i] : parts[i](d2, names);
      return out;
    };
  }
  var localTz = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  function tzDate(date, tz) {
    let date2;
    if (tz == "UTC" || tz == "Etc/UTC")
      date2 = new Date(+date + date.getTimezoneOffset() * 6e4);
    else if (tz == localTz)
      date2 = date;
    else {
      date2 = new Date(date.toLocaleString("en-US", { timeZone: tz }));
      date2.setMilliseconds(date.getMilliseconds());
    }
    return date2;
  }
  var onlyWhole = (v) => v % 1 == 0;
  var allMults = [1, 2, 2.5, 5];
  var decIncrs = genIncrs(10, -32, 0, allMults);
  var oneIncrs = genIncrs(10, 0, 32, allMults);
  var wholeIncrs = oneIncrs.filter(onlyWhole);
  var numIncrs = decIncrs.concat(oneIncrs);
  var NL = "\n";
  var yyyy = "{YYYY}";
  var NLyyyy = NL + yyyy;
  var md = "{M}/{D}";
  var NLmd = NL + md;
  var NLmdyy = NLmd + "/{YY}";
  var aa = "{aa}";
  var hmm = "{h}:{mm}";
  var hmmaa = hmm + aa;
  var NLhmmaa = NL + hmmaa;
  var ss = ":{ss}";
  var _ = null;
  function genTimeStuffs(ms) {
    let s2 = ms * 1e3, m = s2 * 60, h = m * 60, d2 = h * 24, mo = d2 * 30, y = d2 * 365;
    let subSecIncrs = ms == 1 ? genIncrs(10, 0, 3, allMults).filter(onlyWhole) : genIncrs(10, -3, 0, allMults);
    let timeIncrs = subSecIncrs.concat([
      // minute divisors (# of secs)
      s2,
      s2 * 5,
      s2 * 10,
      s2 * 15,
      s2 * 30,
      // hour divisors (# of mins)
      m,
      m * 5,
      m * 10,
      m * 15,
      m * 30,
      // day divisors (# of hrs)
      h,
      h * 2,
      h * 3,
      h * 4,
      h * 6,
      h * 8,
      h * 12,
      // month divisors TODO: need more?
      d2,
      d2 * 2,
      d2 * 3,
      d2 * 4,
      d2 * 5,
      d2 * 6,
      d2 * 7,
      d2 * 8,
      d2 * 9,
      d2 * 10,
      d2 * 15,
      // year divisors (# months, approx)
      mo,
      mo * 2,
      mo * 3,
      mo * 4,
      mo * 6,
      // century divisors
      y,
      y * 2,
      y * 5,
      y * 10,
      y * 25,
      y * 50,
      y * 100
    ]);
    const _timeAxisStamps = [
      //   tick incr    default          year                    month   day                   hour    min       sec   mode
      [y, yyyy, _, _, _, _, _, _, 1],
      [d2 * 28, "{MMM}", NLyyyy, _, _, _, _, _, 1],
      [d2, md, NLyyyy, _, _, _, _, _, 1],
      [h, "{h}" + aa, NLmdyy, _, NLmd, _, _, _, 1],
      [m, hmmaa, NLmdyy, _, NLmd, _, _, _, 1],
      [s2, ss, NLmdyy + " " + hmmaa, _, NLmd + " " + hmmaa, _, NLhmmaa, _, 1],
      [ms, ss + ".{fff}", NLmdyy + " " + hmmaa, _, NLmd + " " + hmmaa, _, NLhmmaa, _, 1]
    ];
    function timeAxisSplits(tzDate2) {
      return (self, axisIdx, scaleMin, scaleMax, foundIncr, foundSpace) => {
        let splits = [];
        let isYr = foundIncr >= y;
        let isMo = foundIncr >= mo && foundIncr < y;
        let minDate = tzDate2(scaleMin);
        let minDateTs = roundDec(minDate * ms, 3);
        let minMin = mkDate(minDate.getFullYear(), isYr ? 0 : minDate.getMonth(), isMo || isYr ? 1 : minDate.getDate());
        let minMinTs = roundDec(minMin * ms, 3);
        if (isMo || isYr) {
          let moIncr = isMo ? foundIncr / mo : 0;
          let yrIncr = isYr ? foundIncr / y : 0;
          let split = minDateTs == minMinTs ? minDateTs : roundDec(mkDate(minMin.getFullYear() + yrIncr, minMin.getMonth() + moIncr, 1) * ms, 3);
          let splitDate = new Date(round(split / ms));
          let baseYear = splitDate.getFullYear();
          let baseMonth = splitDate.getMonth();
          for (let i = 0; split <= scaleMax; i++) {
            let next = mkDate(baseYear + yrIncr * i, baseMonth + moIncr * i, 1);
            let offs = next - tzDate2(roundDec(next * ms, 3));
            split = roundDec((+next + offs) * ms, 3);
            if (split <= scaleMax)
              splits.push(split);
          }
        } else {
          let incr0 = foundIncr >= d2 ? d2 : foundIncr;
          let tzOffset = floor(scaleMin) - floor(minDateTs);
          let split = minMinTs + tzOffset + incrRoundUp(minDateTs - minMinTs, incr0);
          splits.push(split);
          let date0 = tzDate2(split);
          let prevHour = date0.getHours() + date0.getMinutes() / m + date0.getSeconds() / h;
          let incrHours = foundIncr / h;
          let minSpace = self.axes[axisIdx]._space;
          let pctSpace = foundSpace / minSpace;
          while (1) {
            split = roundDec(split + foundIncr, ms == 1 ? 0 : 3);
            if (split > scaleMax)
              break;
            if (incrHours > 1) {
              let expectedHour = floor(roundDec(prevHour + incrHours, 6)) % 24;
              let splitDate = tzDate2(split);
              let actualHour = splitDate.getHours();
              let dstShift = actualHour - expectedHour;
              if (dstShift > 1)
                dstShift = -1;
              split -= dstShift * h;
              prevHour = (prevHour + incrHours) % 24;
              let prevSplit = splits[splits.length - 1];
              let pctIncr = roundDec((split - prevSplit) / foundIncr, 3);
              if (pctIncr * pctSpace >= 0.7)
                splits.push(split);
            } else
              splits.push(split);
          }
        }
        return splits;
      };
    }
    return [
      timeIncrs,
      _timeAxisStamps,
      timeAxisSplits
    ];
  }
  var [timeIncrsMs, _timeAxisStampsMs, timeAxisSplitsMs] = genTimeStuffs(1);
  var [timeIncrsS, _timeAxisStampsS, timeAxisSplitsS] = genTimeStuffs(1e-3);
  genIncrs(2, -53, 53, [1]);
  function timeAxisStamps(stampCfg, fmtDate2) {
    return stampCfg.map((s2) => s2.map(
      (v, i) => i == 0 || i == 8 || v == null ? v : fmtDate2(i == 1 || s2[8] == 0 ? v : s2[1] + v)
    ));
  }
  function timeAxisVals(tzDate2, stamps) {
    return (self, splits, axisIdx, foundSpace, foundIncr) => {
      let s2 = stamps.find((s3) => foundIncr >= s3[0]) || stamps[stamps.length - 1];
      let prevYear;
      let prevMnth;
      let prevDate;
      let prevHour;
      let prevMins;
      let prevSecs;
      return splits.map((split) => {
        let date = tzDate2(split);
        let newYear = date.getFullYear();
        let newMnth = date.getMonth();
        let newDate = date.getDate();
        let newHour = date.getHours();
        let newMins = date.getMinutes();
        let newSecs = date.getSeconds();
        let stamp = newYear != prevYear && s2[2] || newMnth != prevMnth && s2[3] || newDate != prevDate && s2[4] || newHour != prevHour && s2[5] || newMins != prevMins && s2[6] || newSecs != prevSecs && s2[7] || s2[1];
        prevYear = newYear;
        prevMnth = newMnth;
        prevDate = newDate;
        prevHour = newHour;
        prevMins = newMins;
        prevSecs = newSecs;
        return stamp(date);
      });
    };
  }
  function timeAxisVal(tzDate2, dateTpl) {
    let stamp = fmtDate(dateTpl);
    return (self, splits, axisIdx, foundSpace, foundIncr) => splits.map((split) => stamp(tzDate2(split)));
  }
  function mkDate(y, m, d2) {
    return new Date(y, m, d2);
  }
  function timeSeriesStamp(stampCfg, fmtDate2) {
    return fmtDate2(stampCfg);
  }
  var _timeSeriesStamp = "{YYYY}-{MM}-{DD} {h}:{mm}{aa}";
  function timeSeriesVal(tzDate2, stamp) {
    return (self, val, seriesIdx, dataIdx) => dataIdx == null ? LEGEND_DISP : stamp(tzDate2(val));
  }
  function legendStroke(self, seriesIdx) {
    let s2 = self.series[seriesIdx];
    return s2.width ? s2.stroke(self, seriesIdx) : s2.points.width ? s2.points.stroke(self, seriesIdx) : null;
  }
  function legendFill(self, seriesIdx) {
    return self.series[seriesIdx].fill(self, seriesIdx);
  }
  var legendOpts = {
    show: true,
    live: true,
    isolate: false,
    mount: noop,
    markers: {
      show: true,
      width: 2,
      stroke: legendStroke,
      fill: legendFill,
      dash: "solid"
    },
    idx: null,
    idxs: null,
    values: []
  };
  function cursorPointShow(self, si) {
    let o = self.cursor.points;
    let pt = placeDiv();
    let size = o.size(self, si);
    setStylePx(pt, WIDTH, size);
    setStylePx(pt, HEIGHT, size);
    let mar = size / -2;
    setStylePx(pt, "marginLeft", mar);
    setStylePx(pt, "marginTop", mar);
    let width = o.width(self, si, size);
    width && setStylePx(pt, "borderWidth", width);
    return pt;
  }
  function cursorPointFill(self, si) {
    let sp = self.series[si].points;
    return sp._fill || sp._stroke;
  }
  function cursorPointStroke(self, si) {
    let sp = self.series[si].points;
    return sp._stroke || sp._fill;
  }
  function cursorPointSize(self, si) {
    let sp = self.series[si].points;
    return sp.size;
  }
  var moveTuple = [0, 0];
  function cursorMove(self, mouseLeft1, mouseTop1) {
    moveTuple[0] = mouseLeft1;
    moveTuple[1] = mouseTop1;
    return moveTuple;
  }
  function filtBtn0(self, targ, handle, onlyTarg = true) {
    return (e) => {
      e.button == 0 && (!onlyTarg || e.target == targ) && handle(e);
    };
  }
  function filtTarg(self, targ, handle, onlyTarg = true) {
    return (e) => {
      (!onlyTarg || e.target == targ) && handle(e);
    };
  }
  var cursorOpts = {
    show: true,
    x: true,
    y: true,
    lock: false,
    move: cursorMove,
    points: {
      one: false,
      show: cursorPointShow,
      size: cursorPointSize,
      width: 0,
      stroke: cursorPointStroke,
      fill: cursorPointFill
    },
    bind: {
      mousedown: filtBtn0,
      mouseup: filtBtn0,
      click: filtBtn0,
      // legend clicks, not .u-over clicks
      dblclick: filtBtn0,
      mousemove: filtTarg,
      mouseleave: filtTarg,
      mouseenter: filtTarg
    },
    drag: {
      setScale: true,
      x: true,
      y: false,
      dist: 0,
      uni: null,
      click: (self, e) => {
        e.stopPropagation();
        e.stopImmediatePropagation();
      },
      _x: false,
      _y: false
    },
    focus: {
      dist: (self, seriesIdx, dataIdx, valPos, curPos) => valPos - curPos,
      prox: -1,
      bias: 0
    },
    hover: {
      skip: [void 0],
      prox: null,
      bias: 0
    },
    left: -10,
    top: -10,
    idx: null,
    dataIdx: null,
    idxs: null,
    event: null
  };
  var axisLines = {
    show: true,
    stroke: "rgba(0,0,0,0.07)",
    width: 2
    //	dash: [],
  };
  var grid = assign({}, axisLines, {
    filter: retArg1
  });
  var ticks = assign({}, grid, {
    size: 10
  });
  var border = assign({}, axisLines, {
    show: false
  });
  var font = '12px system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"';
  var labelFont = "bold " + font;
  var lineGap = 1.5;
  var xAxisOpts = {
    show: true,
    scale: "x",
    stroke: hexBlack,
    space: 50,
    gap: 5,
    alignTo: 1,
    size: 50,
    labelGap: 0,
    labelSize: 30,
    labelFont,
    side: 2,
    //	class: "x-vals",
    //	incrs: timeIncrs,
    //	values: timeVals,
    //	filter: retArg1,
    grid,
    ticks,
    border,
    font,
    lineGap,
    rotate: 0
  };
  var numSeriesLabel = "Value";
  var timeSeriesLabel = "Time";
  var xSeriesOpts = {
    show: true,
    scale: "x",
    auto: false,
    sorted: 1,
    //	label: "Time",
    //	value: v => stamp(new Date(v * 1e3)),
    // internal caches
    min: inf,
    max: -inf,
    idxs: []
  };
  function numAxisVals(self, splits, axisIdx, foundSpace, foundIncr) {
    return splits.map((v) => v == null ? "" : fmtNum(v));
  }
  function numAxisSplits(self, axisIdx, scaleMin, scaleMax, foundIncr, foundSpace, forceMin) {
    let splits = [];
    let numDec = fixedDec.get(foundIncr) || 0;
    scaleMin = forceMin ? scaleMin : roundDec(incrRoundUp(scaleMin, foundIncr), numDec);
    for (let val = scaleMin; val <= scaleMax; val = roundDec(val + foundIncr, numDec))
      splits.push(Object.is(val, -0) ? 0 : val);
    return splits;
  }
  function logAxisSplits(self, axisIdx, scaleMin, scaleMax, foundIncr, foundSpace, forceMin) {
    const splits = [];
    const logBase = self.scales[self.axes[axisIdx].scale].log;
    const logFn = logBase == 10 ? log10 : log2;
    const exp = floor(logFn(scaleMin));
    foundIncr = pow(logBase, exp);
    if (logBase == 10)
      foundIncr = numIncrs[closestIdx(foundIncr, numIncrs)];
    let split = scaleMin;
    let nextMagIncr = foundIncr * logBase;
    if (logBase == 10)
      nextMagIncr = numIncrs[closestIdx(nextMagIncr, numIncrs)];
    do {
      splits.push(split);
      split = split + foundIncr;
      if (logBase == 10 && !fixedDec.has(split))
        split = roundDec(split, fixedDec.get(foundIncr));
      if (split >= nextMagIncr) {
        foundIncr = split;
        nextMagIncr = foundIncr * logBase;
        if (logBase == 10)
          nextMagIncr = numIncrs[closestIdx(nextMagIncr, numIncrs)];
      }
    } while (split <= scaleMax);
    return splits;
  }
  function asinhAxisSplits(self, axisIdx, scaleMin, scaleMax, foundIncr, foundSpace, forceMin) {
    let sc = self.scales[self.axes[axisIdx].scale];
    let linthresh = sc.asinh;
    let posSplits = scaleMax > linthresh ? logAxisSplits(self, axisIdx, max(linthresh, scaleMin), scaleMax, foundIncr) : [linthresh];
    let zero = scaleMax >= 0 && scaleMin <= 0 ? [0] : [];
    let negSplits = scaleMin < -linthresh ? logAxisSplits(self, axisIdx, max(linthresh, -scaleMax), -scaleMin, foundIncr) : [linthresh];
    return negSplits.reverse().map((v) => -v).concat(zero, posSplits);
  }
  var RE_ALL = /./;
  var RE_12357 = /[12357]/;
  var RE_125 = /[125]/;
  var RE_1 = /1/;
  var _filt = (splits, distr, re, keepMod) => splits.map((v, i) => distr == 4 && v == 0 || i % keepMod == 0 && re.test(v.toExponential()[v < 0 ? 1 : 0]) ? v : null);
  function log10AxisValsFilt(self, splits, axisIdx, foundSpace, foundIncr) {
    let axis = self.axes[axisIdx];
    let scaleKey = axis.scale;
    let sc = self.scales[scaleKey];
    let valToPos = self.valToPos;
    let minSpace = axis._space;
    let _10 = valToPos(10, scaleKey);
    let re = valToPos(9, scaleKey) - _10 >= minSpace ? RE_ALL : valToPos(7, scaleKey) - _10 >= minSpace ? RE_12357 : valToPos(5, scaleKey) - _10 >= minSpace ? RE_125 : RE_1;
    if (re == RE_1) {
      let magSpace = abs(valToPos(1, scaleKey) - _10);
      if (magSpace < minSpace)
        return _filt(splits.slice().reverse(), sc.distr, re, ceil(minSpace / magSpace)).reverse();
    }
    return _filt(splits, sc.distr, re, 1);
  }
  function log2AxisValsFilt(self, splits, axisIdx, foundSpace, foundIncr) {
    let axis = self.axes[axisIdx];
    let scaleKey = axis.scale;
    let minSpace = axis._space;
    let valToPos = self.valToPos;
    let magSpace = abs(valToPos(1, scaleKey) - valToPos(2, scaleKey));
    if (magSpace < minSpace)
      return _filt(splits.slice().reverse(), 3, RE_ALL, ceil(minSpace / magSpace)).reverse();
    return splits;
  }
  function numSeriesVal(self, val, seriesIdx, dataIdx) {
    return dataIdx == null ? LEGEND_DISP : val == null ? "" : fmtNum(val);
  }
  var yAxisOpts = {
    show: true,
    scale: "y",
    stroke: hexBlack,
    space: 30,
    gap: 5,
    alignTo: 1,
    size: 50,
    labelGap: 0,
    labelSize: 30,
    labelFont,
    side: 3,
    //	class: "y-vals",
    //	incrs: numIncrs,
    //	values: (vals, space) => vals,
    //	filter: retArg1,
    grid,
    ticks,
    border,
    font,
    lineGap,
    rotate: 0
  };
  function ptDia(width, mult) {
    let dia = 3 + (width || 1) * 2;
    return roundDec(dia * mult, 3);
  }
  function seriesPointsShow(self, si) {
    let { scale, idxs } = self.series[0];
    let xData = self._data[0];
    let p0 = self.valToPos(xData[idxs[0]], scale, true);
    let p1 = self.valToPos(xData[idxs[1]], scale, true);
    let dim = abs(p1 - p0);
    let s2 = self.series[si];
    let maxPts = dim / (s2.points.space * pxRatio);
    return idxs[1] - idxs[0] <= maxPts;
  }
  var facet = {
    scale: null,
    auto: true,
    sorted: 0,
    // internal caches
    min: inf,
    max: -inf
  };
  var gaps = (self, seriesIdx, idx0, idx1, nullGaps) => nullGaps;
  var xySeriesOpts = {
    show: true,
    auto: true,
    sorted: 0,
    gaps,
    alpha: 1,
    facets: [
      assign({}, facet, { scale: "x" }),
      assign({}, facet, { scale: "y" })
    ]
  };
  var ySeriesOpts = {
    scale: "y",
    auto: true,
    sorted: 0,
    show: true,
    spanGaps: false,
    gaps,
    alpha: 1,
    points: {
      show: seriesPointsShow,
      filter: null
      //  paths:
      //	stroke: "#000",
      //	fill: "#fff",
      //	width: 1,
      //	size: 10,
    },
    //	label: "Value",
    //	value: v => v,
    values: null,
    // internal caches
    min: inf,
    max: -inf,
    idxs: [],
    path: null,
    clip: null
  };
  function clampScale(self, val, scaleMin, scaleMax, scaleKey) {
    return scaleMin / 10;
  }
  var xScaleOpts = {
    time: FEAT_TIME,
    auto: true,
    distr: 1,
    log: 10,
    asinh: 1,
    min: null,
    max: null,
    dir: 1,
    ori: 0
  };
  var yScaleOpts = assign({}, xScaleOpts, {
    time: false,
    ori: 1
  });
  var syncs = {};
  function _sync(key, opts) {
    let s2 = syncs[key];
    if (!s2) {
      s2 = {
        key,
        plots: [],
        sub(plot) {
          s2.plots.push(plot);
        },
        unsub(plot) {
          s2.plots = s2.plots.filter((c) => c != plot);
        },
        pub(type, self, x, y, w, h, i) {
          for (let j = 0; j < s2.plots.length; j++)
            s2.plots[j] != self && s2.plots[j].pub(type, self, x, y, w, h, i);
        }
      };
      if (key != null)
        syncs[key] = s2;
    }
    return s2;
  }
  var BAND_CLIP_FILL = 1 << 0;
  var BAND_CLIP_STROKE = 1 << 1;
  function orient(u, seriesIdx, cb) {
    const mode = u.mode;
    const series = u.series[seriesIdx];
    const data = mode == 2 ? u._data[seriesIdx] : u._data;
    const scales = u.scales;
    const bbox = u.bbox;
    let dx = data[0], dy = mode == 2 ? data[1] : data[seriesIdx], sx = mode == 2 ? scales[series.facets[0].scale] : scales[u.series[0].scale], sy = mode == 2 ? scales[series.facets[1].scale] : scales[series.scale], l = bbox.left, t = bbox.top, w = bbox.width, h = bbox.height, H = u.valToPosH, V = u.valToPosV;
    return sx.ori == 0 ? cb(
      series,
      dx,
      dy,
      sx,
      sy,
      H,
      V,
      l,
      t,
      w,
      h,
      moveToH,
      lineToH,
      rectH,
      arcH,
      bezierCurveToH
    ) : cb(
      series,
      dx,
      dy,
      sx,
      sy,
      V,
      H,
      t,
      l,
      h,
      w,
      moveToV,
      lineToV,
      rectV,
      arcV,
      bezierCurveToV
    );
  }
  function bandFillClipDirs(self, seriesIdx) {
    let fillDir = 0;
    let clipDirs = 0;
    let bands = ifNull(self.bands, EMPTY_ARR);
    for (let i = 0; i < bands.length; i++) {
      let b = bands[i];
      if (b.series[0] == seriesIdx)
        fillDir = b.dir;
      else if (b.series[1] == seriesIdx) {
        if (b.dir == 1)
          clipDirs |= 1;
        else
          clipDirs |= 2;
      }
    }
    return [
      fillDir,
      clipDirs == 1 ? -1 : (
        // neg only
        clipDirs == 2 ? 1 : (
          // pos only
          clipDirs == 3 ? 2 : (
            // both
            0
          )
        )
      )
    ];
  }
  function seriesFillTo(self, seriesIdx, dataMin, dataMax, bandFillDir) {
    let mode = self.mode;
    let series = self.series[seriesIdx];
    let scaleKey = mode == 2 ? series.facets[1].scale : series.scale;
    let scale = self.scales[scaleKey];
    return bandFillDir == -1 ? scale.min : bandFillDir == 1 ? scale.max : scale.distr == 3 ? scale.dir == 1 ? scale.min : scale.max : 0;
  }
  function clipBandLine(self, seriesIdx, idx0, idx1, strokePath, clipDir) {
    return orient(self, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
      let pxRound = series.pxRound;
      const dir = scaleX.dir * (scaleX.ori == 0 ? 1 : -1);
      const lineTo = scaleX.ori == 0 ? lineToH : lineToV;
      let frIdx, toIdx;
      if (dir == 1) {
        frIdx = idx0;
        toIdx = idx1;
      } else {
        frIdx = idx1;
        toIdx = idx0;
      }
      let x0 = pxRound(valToPosX(dataX[frIdx], scaleX, xDim, xOff));
      let y0 = pxRound(valToPosY(dataY[frIdx], scaleY, yDim, yOff));
      let x1 = pxRound(valToPosX(dataX[toIdx], scaleX, xDim, xOff));
      let yLimit = pxRound(valToPosY(clipDir == 1 ? scaleY.max : scaleY.min, scaleY, yDim, yOff));
      let clip = new Path2D(strokePath);
      lineTo(clip, x1, yLimit);
      lineTo(clip, x0, yLimit);
      lineTo(clip, x0, y0);
      return clip;
    });
  }
  function clipGaps(gaps2, ori, plotLft, plotTop, plotWid, plotHgt) {
    let clip = null;
    if (gaps2.length > 0) {
      clip = new Path2D();
      const rect2 = ori == 0 ? rectH : rectV;
      let prevGapEnd = plotLft;
      for (let i = 0; i < gaps2.length; i++) {
        let g = gaps2[i];
        if (g[1] > g[0]) {
          let w2 = g[0] - prevGapEnd;
          w2 > 0 && rect2(clip, prevGapEnd, plotTop, w2, plotTop + plotHgt);
          prevGapEnd = g[1];
        }
      }
      let w = plotLft + plotWid - prevGapEnd;
      let maxStrokeWidth = 10;
      w > 0 && rect2(clip, prevGapEnd, plotTop - maxStrokeWidth / 2, w, plotTop + plotHgt + maxStrokeWidth);
    }
    return clip;
  }
  function addGap(gaps2, fromX, toX) {
    let prevGap = gaps2[gaps2.length - 1];
    if (prevGap && prevGap[0] == fromX)
      prevGap[1] = toX;
    else
      gaps2.push([fromX, toX]);
  }
  function findGaps(xs, ys, idx0, idx1, dir, pixelForX, align) {
    let gaps2 = [];
    let len = xs.length;
    for (let i = dir == 1 ? idx0 : idx1; i >= idx0 && i <= idx1; i += dir) {
      let yVal = ys[i];
      if (yVal === null) {
        let fr = i, to = i;
        if (dir == 1) {
          while (++i <= idx1 && ys[i] === null)
            to = i;
        } else {
          while (--i >= idx0 && ys[i] === null)
            to = i;
        }
        let frPx = pixelForX(xs[fr]);
        let toPx = to == fr ? frPx : pixelForX(xs[to]);
        let fri2 = fr - dir;
        let frPx2 = align <= 0 && fri2 >= 0 && fri2 < len ? pixelForX(xs[fri2]) : frPx;
        frPx = frPx2;
        let toi2 = to + dir;
        let toPx2 = align >= 0 && toi2 >= 0 && toi2 < len ? pixelForX(xs[toi2]) : toPx;
        toPx = toPx2;
        if (toPx >= frPx)
          gaps2.push([frPx, toPx]);
      }
    }
    return gaps2;
  }
  function pxRoundGen(pxAlign) {
    return pxAlign == 0 ? retArg0 : pxAlign == 1 ? round : (v) => incrRound(v, pxAlign);
  }
  function rect(ori) {
    let moveTo = ori == 0 ? moveToH : moveToV;
    let arcTo = ori == 0 ? (p, x1, y1, x2, y2, r) => {
      p.arcTo(x1, y1, x2, y2, r);
    } : (p, y1, x1, y2, x2, r) => {
      p.arcTo(x1, y1, x2, y2, r);
    };
    let rect2 = ori == 0 ? (p, x, y, w, h) => {
      p.rect(x, y, w, h);
    } : (p, y, x, h, w) => {
      p.rect(x, y, w, h);
    };
    return (p, x, y, w, h, endRad = 0, baseRad = 0) => {
      if (endRad == 0 && baseRad == 0)
        rect2(p, x, y, w, h);
      else {
        endRad = min(endRad, w / 2, h / 2);
        baseRad = min(baseRad, w / 2, h / 2);
        moveTo(p, x + endRad, y);
        arcTo(p, x + w, y, x + w, y + h, endRad);
        arcTo(p, x + w, y + h, x, y + h, baseRad);
        arcTo(p, x, y + h, x, y, baseRad);
        arcTo(p, x, y, x + w, y, endRad);
        p.closePath();
      }
    };
  }
  var moveToH = (p, x, y) => {
    p.moveTo(x, y);
  };
  var moveToV = (p, y, x) => {
    p.moveTo(x, y);
  };
  var lineToH = (p, x, y) => {
    p.lineTo(x, y);
  };
  var lineToV = (p, y, x) => {
    p.lineTo(x, y);
  };
  var rectH = rect(0);
  var rectV = rect(1);
  var arcH = (p, x, y, r, startAngle, endAngle) => {
    p.arc(x, y, r, startAngle, endAngle);
  };
  var arcV = (p, y, x, r, startAngle, endAngle) => {
    p.arc(x, y, r, startAngle, endAngle);
  };
  var bezierCurveToH = (p, bp1x, bp1y, bp2x, bp2y, p2x, p2y) => {
    p.bezierCurveTo(bp1x, bp1y, bp2x, bp2y, p2x, p2y);
  };
  var bezierCurveToV = (p, bp1y, bp1x, bp2y, bp2x, p2y, p2x) => {
    p.bezierCurveTo(bp1x, bp1y, bp2x, bp2y, p2x, p2y);
  };
  function points(opts) {
    return (u, seriesIdx, idx0, idx1, filtIdxs) => {
      return orient(u, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
        let { pxRound, points: points2 } = series;
        let moveTo, arc;
        if (scaleX.ori == 0) {
          moveTo = moveToH;
          arc = arcH;
        } else {
          moveTo = moveToV;
          arc = arcV;
        }
        const width = roundDec(points2.width * pxRatio, 3);
        let rad = (points2.size - points2.width) / 2 * pxRatio;
        let dia = roundDec(rad * 2, 3);
        let fill = new Path2D();
        let clip = new Path2D();
        let { left: lft, top, width: wid, height: hgt } = u.bbox;
        rectH(
          clip,
          lft - dia,
          top - dia,
          wid + dia * 2,
          hgt + dia * 2
        );
        const drawPoint = (pi) => {
          if (dataY[pi] != null) {
            let x = pxRound(valToPosX(dataX[pi], scaleX, xDim, xOff));
            let y = pxRound(valToPosY(dataY[pi], scaleY, yDim, yOff));
            moveTo(fill, x + rad, y);
            arc(fill, x, y, rad, 0, PI * 2);
          }
        };
        if (filtIdxs)
          filtIdxs.forEach(drawPoint);
        else {
          for (let pi = idx0; pi <= idx1; pi++)
            drawPoint(pi);
        }
        return {
          stroke: width > 0 ? fill : null,
          fill,
          clip,
          flags: BAND_CLIP_FILL | BAND_CLIP_STROKE
        };
      });
    };
  }
  function _drawAcc(lineTo) {
    return (stroke, accX, minY, maxY, inY, outY) => {
      if (minY != maxY) {
        if (inY != minY && outY != minY)
          lineTo(stroke, accX, minY);
        if (inY != maxY && outY != maxY)
          lineTo(stroke, accX, maxY);
        lineTo(stroke, accX, outY);
      }
    };
  }
  var drawAccH = _drawAcc(lineToH);
  var drawAccV = _drawAcc(lineToV);
  function linear(opts) {
    const alignGaps = ifNull(opts == null ? void 0 : opts.alignGaps, 0);
    return (u, seriesIdx, idx0, idx1) => {
      return orient(u, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
        [idx0, idx1] = nonNullIdxs(dataY, idx0, idx1);
        let pxRound = series.pxRound;
        let pixelForX = (val) => pxRound(valToPosX(val, scaleX, xDim, xOff));
        let pixelForY = (val) => pxRound(valToPosY(val, scaleY, yDim, yOff));
        let lineTo, drawAcc;
        if (scaleX.ori == 0) {
          lineTo = lineToH;
          drawAcc = drawAccH;
        } else {
          lineTo = lineToV;
          drawAcc = drawAccV;
        }
        const dir = scaleX.dir * (scaleX.ori == 0 ? 1 : -1);
        const _paths = { stroke: new Path2D(), fill: null, clip: null, band: null, gaps: null, flags: BAND_CLIP_FILL };
        const stroke = _paths.stroke;
        let hasGap = false;
        const decimate = idx1 - idx0 >= xDim * 4;
        if (decimate) {
          let xForPixel = (pos) => u.posToVal(pos, scaleX.key, true);
          let minY = null, maxY = null, inY, outY, drawnAtX;
          let accX = pixelForX(dataX[dir == 1 ? idx0 : idx1]);
          let idx0px = pixelForX(dataX[idx0]);
          let idx1px = pixelForX(dataX[idx1]);
          let nextAccXVal = xForPixel(dir == 1 ? idx0px + 1 : idx1px - 1);
          for (let i = dir == 1 ? idx0 : idx1; i >= idx0 && i <= idx1; i += dir) {
            let xVal = dataX[i];
            let reuseAccX = dir == 1 ? xVal < nextAccXVal : xVal > nextAccXVal;
            let x = reuseAccX ? accX : pixelForX(xVal);
            let yVal = dataY[i];
            if (x == accX) {
              if (yVal != null) {
                outY = yVal;
                if (minY == null) {
                  lineTo(stroke, x, pixelForY(outY));
                  inY = minY = maxY = outY;
                } else {
                  if (outY < minY)
                    minY = outY;
                  else if (outY > maxY)
                    maxY = outY;
                }
              } else {
                if (yVal === null)
                  hasGap = true;
              }
            } else {
              if (minY != null)
                drawAcc(stroke, accX, pixelForY(minY), pixelForY(maxY), pixelForY(inY), pixelForY(outY));
              if (yVal != null) {
                outY = yVal;
                lineTo(stroke, x, pixelForY(outY));
                minY = maxY = inY = outY;
              } else {
                minY = maxY = null;
                if (yVal === null)
                  hasGap = true;
              }
              accX = x;
              nextAccXVal = xForPixel(accX + dir);
            }
          }
          if (minY != null && minY != maxY && drawnAtX != accX)
            drawAcc(stroke, accX, pixelForY(minY), pixelForY(maxY), pixelForY(inY), pixelForY(outY));
        } else {
          for (let i = dir == 1 ? idx0 : idx1; i >= idx0 && i <= idx1; i += dir) {
            let yVal = dataY[i];
            if (yVal === null)
              hasGap = true;
            else if (yVal != null)
              lineTo(stroke, pixelForX(dataX[i]), pixelForY(yVal));
          }
        }
        let [bandFillDir, bandClipDir] = bandFillClipDirs(u, seriesIdx);
        if (series.fill != null || bandFillDir != 0) {
          let fill = _paths.fill = new Path2D(stroke);
          let fillToVal = series.fillTo(u, seriesIdx, series.min, series.max, bandFillDir);
          let fillToY = pixelForY(fillToVal);
          let frX = pixelForX(dataX[idx0]);
          let toX = pixelForX(dataX[idx1]);
          if (dir == -1)
            [toX, frX] = [frX, toX];
          lineTo(fill, toX, fillToY);
          lineTo(fill, frX, fillToY);
        }
        if (!series.spanGaps) {
          let gaps2 = [];
          hasGap && gaps2.push(...findGaps(dataX, dataY, idx0, idx1, dir, pixelForX, alignGaps));
          _paths.gaps = gaps2 = series.gaps(u, seriesIdx, idx0, idx1, gaps2);
          _paths.clip = clipGaps(gaps2, scaleX.ori, xOff, yOff, xDim, yDim);
        }
        if (bandClipDir != 0) {
          _paths.band = bandClipDir == 2 ? [
            clipBandLine(u, seriesIdx, idx0, idx1, stroke, -1),
            clipBandLine(u, seriesIdx, idx0, idx1, stroke, 1)
          ] : clipBandLine(u, seriesIdx, idx0, idx1, stroke, bandClipDir);
        }
        return _paths;
      });
    };
  }
  function stepped(opts) {
    const align = ifNull(opts.align, 1);
    const ascDesc = ifNull(opts.ascDesc, false);
    const alignGaps = ifNull(opts.alignGaps, 0);
    const extend = ifNull(opts.extend, false);
    return (u, seriesIdx, idx0, idx1) => {
      return orient(u, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
        [idx0, idx1] = nonNullIdxs(dataY, idx0, idx1);
        let pxRound = series.pxRound;
        let { left, width } = u.bbox;
        let pixelForX = (val) => pxRound(valToPosX(val, scaleX, xDim, xOff));
        let pixelForY = (val) => pxRound(valToPosY(val, scaleY, yDim, yOff));
        let lineTo = scaleX.ori == 0 ? lineToH : lineToV;
        const _paths = { stroke: new Path2D(), fill: null, clip: null, band: null, gaps: null, flags: BAND_CLIP_FILL };
        const stroke = _paths.stroke;
        const dir = scaleX.dir * (scaleX.ori == 0 ? 1 : -1);
        let prevYPos = pixelForY(dataY[dir == 1 ? idx0 : idx1]);
        let firstXPos = pixelForX(dataX[dir == 1 ? idx0 : idx1]);
        let prevXPos = firstXPos;
        let firstXPosExt = firstXPos;
        if (extend && align == -1) {
          firstXPosExt = left;
          lineTo(stroke, firstXPosExt, prevYPos);
        }
        lineTo(stroke, firstXPos, prevYPos);
        for (let i = dir == 1 ? idx0 : idx1; i >= idx0 && i <= idx1; i += dir) {
          let yVal1 = dataY[i];
          if (yVal1 == null)
            continue;
          let x1 = pixelForX(dataX[i]);
          let y1 = pixelForY(yVal1);
          if (align == 1)
            lineTo(stroke, x1, prevYPos);
          else
            lineTo(stroke, prevXPos, y1);
          lineTo(stroke, x1, y1);
          prevYPos = y1;
          prevXPos = x1;
        }
        let prevXPosExt = prevXPos;
        if (extend && align == 1) {
          prevXPosExt = left + width;
          lineTo(stroke, prevXPosExt, prevYPos);
        }
        let [bandFillDir, bandClipDir] = bandFillClipDirs(u, seriesIdx);
        if (series.fill != null || bandFillDir != 0) {
          let fill = _paths.fill = new Path2D(stroke);
          let fillTo = series.fillTo(u, seriesIdx, series.min, series.max, bandFillDir);
          let fillToY = pixelForY(fillTo);
          lineTo(fill, prevXPosExt, fillToY);
          lineTo(fill, firstXPosExt, fillToY);
        }
        if (!series.spanGaps) {
          let gaps2 = [];
          gaps2.push(...findGaps(dataX, dataY, idx0, idx1, dir, pixelForX, alignGaps));
          let halfStroke = series.width * pxRatio / 2;
          let startsOffset = ascDesc || align == 1 ? halfStroke : -halfStroke;
          let endsOffset = ascDesc || align == -1 ? -halfStroke : halfStroke;
          gaps2.forEach((g) => {
            g[0] += startsOffset;
            g[1] += endsOffset;
          });
          _paths.gaps = gaps2 = series.gaps(u, seriesIdx, idx0, idx1, gaps2);
          _paths.clip = clipGaps(gaps2, scaleX.ori, xOff, yOff, xDim, yDim);
        }
        if (bandClipDir != 0) {
          _paths.band = bandClipDir == 2 ? [
            clipBandLine(u, seriesIdx, idx0, idx1, stroke, -1),
            clipBandLine(u, seriesIdx, idx0, idx1, stroke, 1)
          ] : clipBandLine(u, seriesIdx, idx0, idx1, stroke, bandClipDir);
        }
        return _paths;
      });
    };
  }
  function findColWidth(dataX, dataY, valToPosX, scaleX, xDim, xOff, colWid = inf) {
    if (dataX.length > 1) {
      let prevIdx = null;
      for (let i = 0, minDelta = Infinity; i < dataX.length; i++) {
        if (dataY[i] !== void 0) {
          if (prevIdx != null) {
            let delta = abs(dataX[i] - dataX[prevIdx]);
            if (delta < minDelta) {
              minDelta = delta;
              colWid = abs(valToPosX(dataX[i], scaleX, xDim, xOff) - valToPosX(dataX[prevIdx], scaleX, xDim, xOff));
            }
          }
          prevIdx = i;
        }
      }
    }
    return colWid;
  }
  function bars(opts) {
    opts = opts || EMPTY_OBJ;
    const size = ifNull(opts.size, [0.6, inf, 1]);
    const align = opts.align || 0;
    const _extraGap = opts.gap || 0;
    let ro = opts.radius;
    ro = // [valueRadius, baselineRadius]
    ro == null ? [0, 0] : typeof ro == "number" ? [ro, 0] : ro;
    const radiusFn = fnOrSelf(ro);
    const gapFactor = 1 - size[0];
    const _maxWidth = ifNull(size[1], inf);
    const _minWidth = ifNull(size[2], 1);
    const disp = ifNull(opts.disp, EMPTY_OBJ);
    const _each = ifNull(opts.each, (_2) => {
    });
    const { fill: dispFills, stroke: dispStrokes } = disp;
    return (u, seriesIdx, idx0, idx1) => {
      return orient(u, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
        var _a, _b;
        let pxRound = series.pxRound;
        let _align = align;
        let extraGap = _extraGap * pxRatio;
        let maxWidth = _maxWidth * pxRatio;
        let minWidth = _minWidth * pxRatio;
        let valRadius, baseRadius;
        if (scaleX.ori == 0)
          [valRadius, baseRadius] = radiusFn(u, seriesIdx);
        else
          [baseRadius, valRadius] = radiusFn(u, seriesIdx);
        const _dirX = scaleX.dir * (scaleX.ori == 0 ? 1 : -1);
        let rect2 = scaleX.ori == 0 ? rectH : rectV;
        let each = scaleX.ori == 0 ? _each : (u2, seriesIdx2, i, top, lft, hgt, wid) => {
          _each(u2, seriesIdx2, i, lft, top, wid, hgt);
        };
        let band = ifNull(u.bands, EMPTY_ARR).find((b) => b.series[0] == seriesIdx);
        let fillDir = band != null ? band.dir : 0;
        let fillTo = series.fillTo(u, seriesIdx, series.min, series.max, fillDir);
        let fillToY = pxRound(valToPosY(fillTo, scaleY, yDim, yOff));
        let xShift, barWid, fullGap, colWid = xDim;
        let strokeWidth = pxRound(series.width * pxRatio);
        let multiPath = false;
        let fillColors = null;
        let fillPaths = null;
        let strokeColors = null;
        let strokePaths = null;
        if (dispFills != null && (strokeWidth == 0 || dispStrokes != null)) {
          multiPath = true;
          fillColors = dispFills.values(u, seriesIdx, idx0, idx1);
          fillPaths = /* @__PURE__ */ new Map();
          new Set(fillColors).forEach((color) => {
            if (color != null)
              fillPaths.set(color, new Path2D());
          });
          if (strokeWidth > 0) {
            strokeColors = dispStrokes.values(u, seriesIdx, idx0, idx1);
            strokePaths = /* @__PURE__ */ new Map();
            new Set(strokeColors).forEach((color) => {
              if (color != null)
                strokePaths.set(color, new Path2D());
            });
          }
        }
        let { x0, size: size2 } = disp;
        if (x0 != null && size2 != null) {
          _align = 1;
          dataX = x0.values(u, seriesIdx, idx0, idx1);
          if (x0.unit == 2)
            dataX = dataX.map((pct) => u.posToVal(xOff + pct * xDim, scaleX.key, true));
          let sizes = size2.values(u, seriesIdx, idx0, idx1);
          if (size2.unit == 2)
            barWid = sizes[0] * xDim;
          else
            barWid = valToPosX(sizes[0], scaleX, xDim, xOff) - valToPosX(0, scaleX, xDim, xOff);
          colWid = findColWidth(dataX, dataY, valToPosX, scaleX, xDim, xOff, colWid);
          let gapWid = colWid - barWid;
          fullGap = gapWid + extraGap;
        } else {
          colWid = findColWidth(dataX, dataY, valToPosX, scaleX, xDim, xOff, colWid);
          let gapWid = colWid * gapFactor;
          fullGap = gapWid + extraGap;
          barWid = colWid - fullGap;
        }
        if (fullGap < 1)
          fullGap = 0;
        if (strokeWidth >= barWid / 2)
          strokeWidth = 0;
        if (fullGap < 5)
          pxRound = retArg0;
        let insetStroke = fullGap > 0;
        let rawBarWid = colWid - fullGap - (insetStroke ? strokeWidth : 0);
        barWid = pxRound(clamp(rawBarWid, minWidth, maxWidth));
        xShift = (_align == 0 ? barWid / 2 : _align == _dirX ? 0 : barWid) - _align * _dirX * ((_align == 0 ? extraGap / 2 : 0) + (insetStroke ? strokeWidth / 2 : 0));
        const _paths = { stroke: null, fill: null, clip: null, band: null, gaps: null, flags: 0 };
        const stroke = multiPath ? null : new Path2D();
        let dataY0 = null;
        if (band != null)
          dataY0 = u.data[band.series[1]];
        else {
          let { y0, y1 } = disp;
          if (y0 != null && y1 != null) {
            dataY = y1.values(u, seriesIdx, idx0, idx1);
            dataY0 = y0.values(u, seriesIdx, idx0, idx1);
          }
        }
        let radVal = valRadius * barWid;
        let radBase = baseRadius * barWid;
        for (let i = _dirX == 1 ? idx0 : idx1; i >= idx0 && i <= idx1; i += _dirX) {
          let yVal = dataY[i];
          if (yVal == null)
            continue;
          if (dataY0 != null) {
            let yVal0 = (_a = dataY0[i]) != null ? _a : 0;
            if (yVal - yVal0 == 0)
              continue;
            fillToY = valToPosY(yVal0, scaleY, yDim, yOff);
          }
          let xVal = scaleX.distr != 2 || disp != null ? dataX[i] : i;
          let xPos = valToPosX(xVal, scaleX, xDim, xOff);
          let yPos = valToPosY(ifNull(yVal, fillTo), scaleY, yDim, yOff);
          let lft = pxRound(xPos - xShift);
          let btm = pxRound(max(yPos, fillToY));
          let top = pxRound(min(yPos, fillToY));
          let barHgt = btm - top;
          if (yVal != null) {
            let rv = yVal < 0 ? radBase : radVal;
            let rb = yVal < 0 ? radVal : radBase;
            if (multiPath) {
              if (strokeWidth > 0 && strokeColors[i] != null)
                rect2(strokePaths.get(strokeColors[i]), lft, top + floor(strokeWidth / 2), barWid, max(0, barHgt - strokeWidth), rv, rb);
              if (fillColors[i] != null)
                rect2(fillPaths.get(fillColors[i]), lft, top + floor(strokeWidth / 2), barWid, max(0, barHgt - strokeWidth), rv, rb);
            } else
              rect2(stroke, lft, top + floor(strokeWidth / 2), barWid, max(0, barHgt - strokeWidth), rv, rb);
            each(
              u,
              seriesIdx,
              i,
              lft - strokeWidth / 2,
              top,
              barWid + strokeWidth,
              barHgt
            );
          }
        }
        if (strokeWidth > 0)
          _paths.stroke = multiPath ? strokePaths : stroke;
        else if (!multiPath) {
          _paths._fill = series.width == 0 ? series._fill : (_b = series._stroke) != null ? _b : series._fill;
          _paths.width = 0;
        }
        _paths.fill = multiPath ? fillPaths : stroke;
        return _paths;
      });
    };
  }
  function splineInterp(interp, opts) {
    const alignGaps = ifNull(opts == null ? void 0 : opts.alignGaps, 0);
    return (u, seriesIdx, idx0, idx1) => {
      return orient(u, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
        [idx0, idx1] = nonNullIdxs(dataY, idx0, idx1);
        let pxRound = series.pxRound;
        let pixelForX = (val) => pxRound(valToPosX(val, scaleX, xDim, xOff));
        let pixelForY = (val) => pxRound(valToPosY(val, scaleY, yDim, yOff));
        let moveTo, bezierCurveTo, lineTo;
        if (scaleX.ori == 0) {
          moveTo = moveToH;
          lineTo = lineToH;
          bezierCurveTo = bezierCurveToH;
        } else {
          moveTo = moveToV;
          lineTo = lineToV;
          bezierCurveTo = bezierCurveToV;
        }
        const dir = scaleX.dir * (scaleX.ori == 0 ? 1 : -1);
        let firstXPos = pixelForX(dataX[dir == 1 ? idx0 : idx1]);
        let prevXPos = firstXPos;
        let xCoords = [];
        let yCoords = [];
        for (let i = dir == 1 ? idx0 : idx1; i >= idx0 && i <= idx1; i += dir) {
          let yVal = dataY[i];
          if (yVal != null) {
            let xVal = dataX[i];
            let xPos = pixelForX(xVal);
            xCoords.push(prevXPos = xPos);
            yCoords.push(pixelForY(dataY[i]));
          }
        }
        const _paths = { stroke: interp(xCoords, yCoords, moveTo, lineTo, bezierCurveTo, pxRound), fill: null, clip: null, band: null, gaps: null, flags: BAND_CLIP_FILL };
        const stroke = _paths.stroke;
        let [bandFillDir, bandClipDir] = bandFillClipDirs(u, seriesIdx);
        if (series.fill != null || bandFillDir != 0) {
          let fill = _paths.fill = new Path2D(stroke);
          let fillTo = series.fillTo(u, seriesIdx, series.min, series.max, bandFillDir);
          let fillToY = pixelForY(fillTo);
          lineTo(fill, prevXPos, fillToY);
          lineTo(fill, firstXPos, fillToY);
        }
        if (!series.spanGaps) {
          let gaps2 = [];
          gaps2.push(...findGaps(dataX, dataY, idx0, idx1, dir, pixelForX, alignGaps));
          _paths.gaps = gaps2 = series.gaps(u, seriesIdx, idx0, idx1, gaps2);
          _paths.clip = clipGaps(gaps2, scaleX.ori, xOff, yOff, xDim, yDim);
        }
        if (bandClipDir != 0) {
          _paths.band = bandClipDir == 2 ? [
            clipBandLine(u, seriesIdx, idx0, idx1, stroke, -1),
            clipBandLine(u, seriesIdx, idx0, idx1, stroke, 1)
          ] : clipBandLine(u, seriesIdx, idx0, idx1, stroke, bandClipDir);
        }
        return _paths;
      });
    };
  }
  function monotoneCubic(opts) {
    return splineInterp(_monotoneCubic, opts);
  }
  function _monotoneCubic(xs, ys, moveTo, lineTo, bezierCurveTo, pxRound) {
    const n = xs.length;
    if (n < 2)
      return null;
    const path = new Path2D();
    moveTo(path, xs[0], ys[0]);
    if (n == 2)
      lineTo(path, xs[1], ys[1]);
    else {
      let ms = Array(n), ds = Array(n - 1), dys = Array(n - 1), dxs = Array(n - 1);
      for (let i = 0; i < n - 1; i++) {
        dys[i] = ys[i + 1] - ys[i];
        dxs[i] = xs[i + 1] - xs[i];
        ds[i] = dys[i] / dxs[i];
      }
      ms[0] = ds[0];
      for (let i = 1; i < n - 1; i++) {
        if (ds[i] === 0 || ds[i - 1] === 0 || ds[i - 1] > 0 !== ds[i] > 0)
          ms[i] = 0;
        else {
          ms[i] = 3 * (dxs[i - 1] + dxs[i]) / ((2 * dxs[i] + dxs[i - 1]) / ds[i - 1] + (dxs[i] + 2 * dxs[i - 1]) / ds[i]);
          if (!isFinite(ms[i]))
            ms[i] = 0;
        }
      }
      ms[n - 1] = ds[n - 2];
      for (let i = 0; i < n - 1; i++) {
        bezierCurveTo(
          path,
          xs[i] + dxs[i] / 3,
          ys[i] + ms[i] * dxs[i] / 3,
          xs[i + 1] - dxs[i] / 3,
          ys[i + 1] - ms[i + 1] * dxs[i] / 3,
          xs[i + 1],
          ys[i + 1]
        );
      }
    }
    return path;
  }
  var cursorPlots = /* @__PURE__ */ new Set();
  function invalidateRects() {
    for (let u of cursorPlots)
      u.syncRect(true);
  }
  if (domEnv) {
    on(resize, win, invalidateRects);
    on(scroll, win, invalidateRects, true);
    on(dppxchange, win, () => {
      uPlot.pxRatio = pxRatio;
    });
  }
  var linearPath = linear();
  var pointsPath = points();
  function setDefaults(d2, xo, yo, initY) {
    let d22 = initY ? [d2[0], d2[1]].concat(d2.slice(2)) : [d2[0]].concat(d2.slice(1));
    return d22.map((o, i) => setDefault(o, i, xo, yo));
  }
  function setDefaults2(d2, xyo) {
    return d2.map((o, i) => i == 0 ? {} : assign({}, xyo, o));
  }
  function setDefault(o, i, xo, yo) {
    return assign({}, i == 0 ? xo : yo, o);
  }
  function snapNumX(self, dataMin, dataMax) {
    return dataMin == null ? nullNullTuple : [dataMin, dataMax];
  }
  var snapTimeX = snapNumX;
  function snapNumY(self, dataMin, dataMax) {
    return dataMin == null ? nullNullTuple : rangeNum(dataMin, dataMax, rangePad, true);
  }
  function snapLogY(self, dataMin, dataMax, scale) {
    return dataMin == null ? nullNullTuple : rangeLog(dataMin, dataMax, self.scales[scale].log, false);
  }
  var snapLogX = snapLogY;
  function snapAsinhY(self, dataMin, dataMax, scale) {
    return dataMin == null ? nullNullTuple : rangeAsinh(dataMin, dataMax, self.scales[scale].log, false);
  }
  var snapAsinhX = snapAsinhY;
  function findIncr(minVal, maxVal, incrs, dim, minSpace) {
    let intDigits = max(numIntDigits(minVal), numIntDigits(maxVal));
    let delta = maxVal - minVal;
    let incrIdx = closestIdx(minSpace / dim * delta, incrs);
    do {
      let foundIncr = incrs[incrIdx];
      let foundSpace = dim * foundIncr / delta;
      if (foundSpace >= minSpace && intDigits + (foundIncr < 5 ? fixedDec.get(foundIncr) : 0) <= 17)
        return [foundIncr, foundSpace];
    } while (++incrIdx < incrs.length);
    return [0, 0];
  }
  function pxRatioFont(font2) {
    let fontSize, fontSizeCss;
    font2 = font2.replace(/(\d+)px/, (m, p1) => (fontSize = round((fontSizeCss = +p1) * pxRatio)) + "px");
    return [font2, fontSize, fontSizeCss];
  }
  function syncFontSize(axis) {
    if (axis.show) {
      [axis.font, axis.labelFont].forEach((f) => {
        let size = roundDec(f[2] * pxRatio, 1);
        f[0] = f[0].replace(/[0-9.]+px/, size + "px");
        f[1] = size;
      });
    }
  }
  function uPlot(opts, data, then) {
    var _a, _b;
    const self = {
      mode: ifNull(opts.mode, 1)
    };
    const mode = self.mode;
    function getHPos(val, scale, dim, off2) {
      let pct = scale.valToPct(val);
      return off2 + dim * (scale.dir == -1 ? 1 - pct : pct);
    }
    function getVPos(val, scale, dim, off2) {
      let pct = scale.valToPct(val);
      return off2 + dim * (scale.dir == -1 ? pct : 1 - pct);
    }
    function getPos(val, scale, dim, off2) {
      return scale.ori == 0 ? getHPos(val, scale, dim, off2) : getVPos(val, scale, dim, off2);
    }
    self.valToPosH = getHPos;
    self.valToPosV = getVPos;
    let ready = false;
    self.status = 0;
    const root = self.root = placeDiv(UPLOT);
    if (opts.id != null)
      root.id = opts.id;
    addClass(root, opts.class);
    if (opts.title) {
      let title = placeDiv(TITLE, root);
      title.textContent = opts.title;
    }
    const can = placeTag("canvas");
    const ctx = self.ctx = can.getContext("2d");
    const wrap = placeDiv(WRAP, root);
    on("click", wrap, (e) => {
      if (e.target === over) {
        let didDrag = mouseLeft1 != mouseLeft0 || mouseTop1 != mouseTop0;
        didDrag && drag.click(self, e);
      }
    }, true);
    const under = self.under = placeDiv(UNDER, wrap);
    wrap.appendChild(can);
    const over = self.over = placeDiv(OVER, wrap);
    opts = copy(opts);
    const pxAlign = +ifNull(opts.pxAlign, 1);
    const pxRound = pxRoundGen(pxAlign);
    (opts.plugins || []).forEach((p) => {
      if (p.opts)
        opts = p.opts(self, opts) || opts;
    });
    const ms = opts.ms || 1e-3;
    const series = self.series = mode == 1 ? setDefaults(opts.series || [], xSeriesOpts, ySeriesOpts, false) : setDefaults2(opts.series || [null], xySeriesOpts);
    const axes = self.axes = setDefaults(opts.axes || [], xAxisOpts, yAxisOpts, true);
    const scales = self.scales = {};
    const bands = self.bands = opts.bands || [];
    bands.forEach((b) => {
      b.fill = fnOrSelf(b.fill || null);
      b.dir = ifNull(b.dir, -1);
    });
    const xScaleKey = mode == 2 ? series[1].facets[0].scale : series[0].scale;
    const drawOrderMap = {
      axes: drawAxesGrid,
      series: drawSeries
    };
    const drawOrder = (opts.drawOrder || ["axes", "series"]).map((key2) => drawOrderMap[key2]);
    function initValToPct(sc) {
      const getVal = sc.distr == 3 ? (val) => log10(val > 0 ? val : sc.clamp(self, val, sc.min, sc.max, sc.key)) : sc.distr == 4 ? (val) => asinh(val, sc.asinh) : sc.distr == 100 ? (val) => sc.fwd(val) : (val) => val;
      return (val) => {
        let _val = getVal(val);
        let { _min, _max } = sc;
        let delta = _max - _min;
        return (_val - _min) / delta;
      };
    }
    function initScale(scaleKey) {
      let sc = scales[scaleKey];
      if (sc == null) {
        let scaleOpts = (opts.scales || EMPTY_OBJ)[scaleKey] || EMPTY_OBJ;
        if (scaleOpts.from != null) {
          initScale(scaleOpts.from);
          let sc2 = assign({}, scales[scaleOpts.from], scaleOpts, { key: scaleKey });
          sc2.valToPct = initValToPct(sc2);
          scales[scaleKey] = sc2;
        } else {
          sc = scales[scaleKey] = assign({}, scaleKey == xScaleKey ? xScaleOpts : yScaleOpts, scaleOpts);
          sc.key = scaleKey;
          let isTime = sc.time;
          let rn = sc.range;
          let rangeIsArr = isArr(rn);
          if (scaleKey != xScaleKey || mode == 2 && !isTime) {
            if (rangeIsArr && (rn[0] == null || rn[1] == null)) {
              rn = {
                min: rn[0] == null ? autoRangePart : {
                  mode: 1,
                  hard: rn[0],
                  soft: rn[0]
                },
                max: rn[1] == null ? autoRangePart : {
                  mode: 1,
                  hard: rn[1],
                  soft: rn[1]
                }
              };
              rangeIsArr = false;
            }
            if (!rangeIsArr && isObj(rn)) {
              let cfg = rn;
              rn = (self2, dataMin, dataMax) => dataMin == null ? nullNullTuple : rangeNum(dataMin, dataMax, cfg);
            }
          }
          sc.range = fnOrSelf(rn || (isTime ? snapTimeX : scaleKey == xScaleKey ? sc.distr == 3 ? snapLogX : sc.distr == 4 ? snapAsinhX : snapNumX : sc.distr == 3 ? snapLogY : sc.distr == 4 ? snapAsinhY : snapNumY));
          sc.auto = fnOrSelf(rangeIsArr ? false : sc.auto);
          sc.clamp = fnOrSelf(sc.clamp || clampScale);
          sc._min = sc._max = null;
          sc.valToPct = initValToPct(sc);
        }
      }
    }
    initScale("x");
    initScale("y");
    if (mode == 1) {
      series.forEach((s2) => {
        initScale(s2.scale);
      });
    }
    axes.forEach((a) => {
      initScale(a.scale);
    });
    for (let k in opts.scales)
      initScale(k);
    const scaleX = scales[xScaleKey];
    const xScaleDistr = scaleX.distr;
    let valToPosX, valToPosY;
    if (scaleX.ori == 0) {
      addClass(root, ORI_HZ);
      valToPosX = getHPos;
      valToPosY = getVPos;
    } else {
      addClass(root, ORI_VT);
      valToPosX = getVPos;
      valToPosY = getHPos;
    }
    const pendScales = {};
    for (let k in scales) {
      let sc = scales[k];
      if (sc.min != null || sc.max != null) {
        pendScales[k] = { min: sc.min, max: sc.max };
        sc.min = sc.max = null;
      }
    }
    const _tzDate = opts.tzDate || ((ts) => new Date(round(ts / ms)));
    const _fmtDate = opts.fmtDate || fmtDate;
    const _timeAxisSplits = ms == 1 ? timeAxisSplitsMs(_tzDate) : timeAxisSplitsS(_tzDate);
    const _timeAxisVals = timeAxisVals(_tzDate, timeAxisStamps(ms == 1 ? _timeAxisStampsMs : _timeAxisStampsS, _fmtDate));
    const _timeSeriesVal = timeSeriesVal(_tzDate, timeSeriesStamp(_timeSeriesStamp, _fmtDate));
    const activeIdxs = [];
    const legend = self.legend = assign({}, legendOpts, opts.legend);
    const cursor = self.cursor = assign({}, cursorOpts, { drag: { y: mode == 2 } }, opts.cursor);
    const showLegend = legend.show;
    const showCursor = cursor.show;
    const markers = legend.markers;
    {
      legend.idxs = activeIdxs;
      markers.width = fnOrSelf(markers.width);
      markers.dash = fnOrSelf(markers.dash);
      markers.stroke = fnOrSelf(markers.stroke);
      markers.fill = fnOrSelf(markers.fill);
    }
    let legendTable;
    let legendHead;
    let legendBody;
    let legendRows = [];
    let legendCells = [];
    let legendCols;
    let multiValLegend = false;
    let NULL_LEGEND_VALUES = {};
    if (legend.live) {
      const getMultiVals = series[1] ? series[1].values : null;
      multiValLegend = getMultiVals != null;
      legendCols = multiValLegend ? getMultiVals(self, 1, 0) : { _: 0 };
      for (let k in legendCols)
        NULL_LEGEND_VALUES[k] = LEGEND_DISP;
    }
    if (showLegend) {
      legendTable = placeTag("table", LEGEND, root);
      legendBody = placeTag("tbody", null, legendTable);
      legend.mount(self, legendTable);
      if (multiValLegend) {
        legendHead = placeTag("thead", null, legendTable, legendBody);
        let head = placeTag("tr", null, legendHead);
        placeTag("th", null, head);
        for (var key in legendCols)
          placeTag("th", LEGEND_LABEL, head).textContent = key;
      } else {
        addClass(legendTable, LEGEND_INLINE);
        legend.live && addClass(legendTable, LEGEND_LIVE);
      }
    }
    const son = { show: true };
    const soff = { show: false };
    function initLegendRow(s2, i) {
      if (i == 0 && (multiValLegend || !legend.live || mode == 2))
        return nullNullTuple;
      let cells = [];
      let row = placeTag("tr", LEGEND_SERIES, legendBody, legendBody.childNodes[i]);
      addClass(row, s2.class);
      if (!s2.show)
        addClass(row, OFF);
      let label = placeTag("th", null, row);
      if (markers.show) {
        let indic = placeDiv(LEGEND_MARKER, label);
        if (i > 0) {
          let width = markers.width(self, i);
          if (width)
            indic.style.border = width + "px " + markers.dash(self, i) + " " + markers.stroke(self, i);
          indic.style.background = markers.fill(self, i);
        }
      }
      let text = placeDiv(LEGEND_LABEL, label);
      if (s2.label instanceof HTMLElement)
        text.appendChild(s2.label);
      else
        text.textContent = s2.label;
      if (i > 0) {
        if (!markers.show)
          text.style.color = s2.width > 0 ? markers.stroke(self, i) : markers.fill(self, i);
        onMouse("click", label, (e) => {
          if (cursor._lock)
            return;
          setCursorEvent(e);
          let seriesIdx = series.indexOf(s2);
          if ((e.ctrlKey || e.metaKey) != legend.isolate) {
            let isolate = series.some((s3, i2) => i2 > 0 && i2 != seriesIdx && s3.show);
            series.forEach((s3, i2) => {
              i2 > 0 && setSeries(i2, isolate ? i2 == seriesIdx ? son : soff : son, true, syncOpts.setSeries);
            });
          } else
            setSeries(seriesIdx, { show: !s2.show }, true, syncOpts.setSeries);
        }, false);
        if (cursorFocus) {
          onMouse(mouseenter, label, (e) => {
            if (cursor._lock)
              return;
            setCursorEvent(e);
            setSeries(series.indexOf(s2), FOCUS_TRUE, true, syncOpts.setSeries);
          }, false);
        }
      }
      for (var key2 in legendCols) {
        let v = placeTag("td", LEGEND_VALUE, row);
        v.textContent = "--";
        cells.push(v);
      }
      return [row, cells];
    }
    const mouseListeners = /* @__PURE__ */ new Map();
    function onMouse(ev, targ, fn, onlyTarg = true) {
      const targListeners = mouseListeners.get(targ) || {};
      const listener = cursor.bind[ev](self, targ, fn, onlyTarg);
      if (listener) {
        on(ev, targ, targListeners[ev] = listener);
        mouseListeners.set(targ, targListeners);
      }
    }
    function offMouse(ev, targ, fn) {
      const targListeners = mouseListeners.get(targ) || {};
      for (let k in targListeners) {
        if (ev == null || k == ev) {
          off(k, targ, targListeners[k]);
          delete targListeners[k];
        }
      }
      if (ev == null)
        mouseListeners.delete(targ);
    }
    let fullWidCss = 0;
    let fullHgtCss = 0;
    let plotWidCss = 0;
    let plotHgtCss = 0;
    let plotLftCss = 0;
    let plotTopCss = 0;
    let _plotLftCss = plotLftCss;
    let _plotTopCss = plotTopCss;
    let _plotWidCss = plotWidCss;
    let _plotHgtCss = plotHgtCss;
    let plotLft = 0;
    let plotTop = 0;
    let plotWid = 0;
    let plotHgt = 0;
    self.bbox = {};
    let shouldSetScales = false;
    let shouldSetSize = false;
    let shouldConvergeSize = false;
    let shouldSetCursor = false;
    let shouldSetSelect = false;
    let shouldSetLegend = false;
    function _setSize(width, height, force) {
      if (force || (width != self.width || height != self.height))
        calcSize(width, height);
      resetYSeries(false);
      shouldConvergeSize = true;
      shouldSetSize = true;
      commit();
    }
    function calcSize(width, height) {
      self.width = fullWidCss = plotWidCss = width;
      self.height = fullHgtCss = plotHgtCss = height;
      plotLftCss = plotTopCss = 0;
      calcPlotRect();
      calcAxesRects();
      let bb = self.bbox;
      plotLft = bb.left = incrRound(plotLftCss * pxRatio, 0.5);
      plotTop = bb.top = incrRound(plotTopCss * pxRatio, 0.5);
      plotWid = bb.width = incrRound(plotWidCss * pxRatio, 0.5);
      plotHgt = bb.height = incrRound(plotHgtCss * pxRatio, 0.5);
    }
    const CYCLE_LIMIT = 3;
    function convergeSize() {
      let converged = false;
      let cycleNum = 0;
      while (!converged) {
        cycleNum++;
        let axesConverged = axesCalc(cycleNum);
        let paddingConverged = paddingCalc(cycleNum);
        converged = cycleNum == CYCLE_LIMIT || axesConverged && paddingConverged;
        if (!converged) {
          calcSize(self.width, self.height);
          shouldSetSize = true;
        }
      }
    }
    function setSize({ width, height }) {
      _setSize(width, height);
    }
    self.setSize = setSize;
    function calcPlotRect() {
      let hasTopAxis = false;
      let hasBtmAxis = false;
      let hasRgtAxis = false;
      let hasLftAxis = false;
      axes.forEach((axis, i) => {
        if (axis.show && axis._show) {
          let { side, _size } = axis;
          let isVt = side % 2;
          let labelSize = axis.label != null ? axis.labelSize : 0;
          let fullSize = _size + labelSize;
          if (fullSize > 0) {
            if (isVt) {
              plotWidCss -= fullSize;
              if (side == 3) {
                plotLftCss += fullSize;
                hasLftAxis = true;
              } else
                hasRgtAxis = true;
            } else {
              plotHgtCss -= fullSize;
              if (side == 0) {
                plotTopCss += fullSize;
                hasTopAxis = true;
              } else
                hasBtmAxis = true;
            }
          }
        }
      });
      sidesWithAxes[0] = hasTopAxis;
      sidesWithAxes[1] = hasRgtAxis;
      sidesWithAxes[2] = hasBtmAxis;
      sidesWithAxes[3] = hasLftAxis;
      plotWidCss -= _padding[1] + _padding[3];
      plotLftCss += _padding[3];
      plotHgtCss -= _padding[2] + _padding[0];
      plotTopCss += _padding[0];
    }
    function calcAxesRects() {
      let off1 = plotLftCss + plotWidCss;
      let off2 = plotTopCss + plotHgtCss;
      let off3 = plotLftCss;
      let off0 = plotTopCss;
      function incrOffset(side, size) {
        switch (side) {
          case 1:
            off1 += size;
            return off1 - size;
          case 2:
            off2 += size;
            return off2 - size;
          case 3:
            off3 -= size;
            return off3 + size;
          case 0:
            off0 -= size;
            return off0 + size;
        }
      }
      axes.forEach((axis, i) => {
        if (axis.show && axis._show) {
          let side = axis.side;
          axis._pos = incrOffset(side, axis._size);
          if (axis.label != null)
            axis._lpos = incrOffset(side, axis.labelSize);
        }
      });
    }
    if (cursor.dataIdx == null) {
      let hov = cursor.hover;
      let skip = hov.skip = new Set((_a = hov.skip) != null ? _a : []);
      skip.add(void 0);
      let prox = hov.prox = fnOrSelf(hov.prox);
      let bias = (_b = hov.bias) != null ? _b : hov.bias = 0;
      cursor.dataIdx = (self2, seriesIdx, cursorIdx, valAtPosX) => {
        var _a2;
        if (seriesIdx == 0)
          return cursorIdx;
        let idx2 = cursorIdx;
        let _prox = (_a2 = prox(self2, seriesIdx, cursorIdx, valAtPosX)) != null ? _a2 : inf;
        let withProx = _prox >= 0 && _prox < inf;
        let xDim = scaleX.ori == 0 ? plotWidCss : plotHgtCss;
        let cursorLft = cursor.left;
        let xValues = data[0];
        let yValues = data[seriesIdx];
        if (skip.has(yValues[cursorIdx])) {
          idx2 = null;
          let nonNullLft = null, nonNullRgt = null, j;
          if (bias == 0 || bias == -1) {
            j = cursorIdx;
            while (nonNullLft == null && j-- > 0) {
              if (!skip.has(yValues[j]))
                nonNullLft = j;
            }
          }
          if (bias == 0 || bias == 1) {
            j = cursorIdx;
            while (nonNullRgt == null && j++ < yValues.length) {
              if (!skip.has(yValues[j]))
                nonNullRgt = j;
            }
          }
          if (nonNullLft != null || nonNullRgt != null) {
            if (withProx) {
              let lftPos = nonNullLft == null ? -Infinity : valToPosX(xValues[nonNullLft], scaleX, xDim, 0);
              let rgtPos = nonNullRgt == null ? Infinity : valToPosX(xValues[nonNullRgt], scaleX, xDim, 0);
              let lftDelta = cursorLft - lftPos;
              let rgtDelta = rgtPos - cursorLft;
              if (lftDelta <= rgtDelta) {
                if (lftDelta <= _prox)
                  idx2 = nonNullLft;
              } else {
                if (rgtDelta <= _prox)
                  idx2 = nonNullRgt;
              }
            } else {
              idx2 = nonNullRgt == null ? nonNullLft : nonNullLft == null ? nonNullRgt : cursorIdx - nonNullLft <= nonNullRgt - cursorIdx ? nonNullLft : nonNullRgt;
            }
          }
        } else if (withProx) {
          let dist = abs(cursorLft - valToPosX(xValues[cursorIdx], scaleX, xDim, 0));
          if (dist > _prox)
            idx2 = null;
        }
        return idx2;
      };
    }
    const setCursorEvent = (e) => {
      cursor.event = e;
    };
    cursor.idxs = activeIdxs;
    cursor._lock = false;
    let points2 = cursor.points;
    points2.show = fnOrSelf(points2.show);
    points2.size = fnOrSelf(points2.size);
    points2.stroke = fnOrSelf(points2.stroke);
    points2.width = fnOrSelf(points2.width);
    points2.fill = fnOrSelf(points2.fill);
    const focus = self.focus = assign({}, opts.focus || { alpha: 0.3 }, cursor.focus);
    const cursorFocus = focus.prox >= 0;
    const cursorOnePt = cursorFocus && points2.one;
    let cursorPts = [];
    let cursorPtsLft = [];
    let cursorPtsTop = [];
    function initCursorPt(s2, si) {
      let pt = points2.show(self, si);
      if (pt instanceof HTMLElement) {
        addClass(pt, CURSOR_PT);
        addClass(pt, s2.class);
        elTrans(pt, -10, -10, plotWidCss, plotHgtCss);
        over.insertBefore(pt, cursorPts[si]);
        return pt;
      }
    }
    function initSeries(s2, i) {
      if (mode == 1 || i > 0) {
        let isTime = mode == 1 && scales[s2.scale].time;
        let sv = s2.value;
        s2.value = isTime ? isStr(sv) ? timeSeriesVal(_tzDate, timeSeriesStamp(sv, _fmtDate)) : sv || _timeSeriesVal : sv || numSeriesVal;
        s2.label = s2.label || (isTime ? timeSeriesLabel : numSeriesLabel);
      }
      if (cursorOnePt || i > 0) {
        s2.width = s2.width == null ? 1 : s2.width;
        s2.paths = s2.paths || linearPath || retNull;
        s2.fillTo = fnOrSelf(s2.fillTo || seriesFillTo);
        s2.pxAlign = +ifNull(s2.pxAlign, pxAlign);
        s2.pxRound = pxRoundGen(s2.pxAlign);
        s2.stroke = fnOrSelf(s2.stroke || null);
        s2.fill = fnOrSelf(s2.fill || null);
        s2._stroke = s2._fill = s2._paths = s2._focus = null;
        let _ptDia = ptDia(max(1, s2.width), 1);
        let points3 = s2.points = assign({}, {
          size: _ptDia,
          width: max(1, _ptDia * 0.2),
          stroke: s2.stroke,
          space: _ptDia * 2,
          paths: pointsPath,
          _stroke: null,
          _fill: null
        }, s2.points);
        points3.show = fnOrSelf(points3.show);
        points3.filter = fnOrSelf(points3.filter);
        points3.fill = fnOrSelf(points3.fill);
        points3.stroke = fnOrSelf(points3.stroke);
        points3.paths = fnOrSelf(points3.paths);
        points3.pxAlign = s2.pxAlign;
      }
      if (showLegend) {
        let rowCells = initLegendRow(s2, i);
        legendRows.splice(i, 0, rowCells[0]);
        legendCells.splice(i, 0, rowCells[1]);
        legend.values.push(null);
      }
      if (showCursor) {
        activeIdxs.splice(i, 0, null);
        let pt = null;
        if (cursorOnePt) {
          if (i == 0)
            pt = initCursorPt(s2, i);
        } else if (i > 0)
          pt = initCursorPt(s2, i);
        cursorPts.splice(i, 0, pt);
        cursorPtsLft.splice(i, 0, 0);
        cursorPtsTop.splice(i, 0, 0);
      }
      fire("addSeries", i);
    }
    function addSeries(opts2, si) {
      si = si == null ? series.length : si;
      opts2 = mode == 1 ? setDefault(opts2, si, xSeriesOpts, ySeriesOpts) : setDefault(opts2, si, {}, xySeriesOpts);
      series.splice(si, 0, opts2);
      initSeries(series[si], si);
    }
    self.addSeries = addSeries;
    function delSeries(i) {
      series.splice(i, 1);
      if (showLegend) {
        legend.values.splice(i, 1);
        legendCells.splice(i, 1);
        let tr = legendRows.splice(i, 1)[0];
        offMouse(null, tr.firstChild);
        tr.remove();
      }
      if (showCursor) {
        activeIdxs.splice(i, 1);
        cursorPts.splice(i, 1)[0].remove();
        cursorPtsLft.splice(i, 1);
        cursorPtsTop.splice(i, 1);
      }
      fire("delSeries", i);
    }
    self.delSeries = delSeries;
    const sidesWithAxes = [false, false, false, false];
    function initAxis(axis, i) {
      axis._show = axis.show;
      if (axis.show) {
        let isVt = axis.side % 2;
        let sc = scales[axis.scale];
        if (sc == null) {
          axis.scale = isVt ? series[1].scale : xScaleKey;
          sc = scales[axis.scale];
        }
        let isTime = sc.time;
        axis.size = fnOrSelf(axis.size);
        axis.space = fnOrSelf(axis.space);
        axis.rotate = fnOrSelf(axis.rotate);
        if (isArr(axis.incrs)) {
          axis.incrs.forEach((incr) => {
            !fixedDec.has(incr) && fixedDec.set(incr, guessDec(incr));
          });
        }
        axis.incrs = fnOrSelf(axis.incrs || (sc.distr == 2 ? wholeIncrs : isTime ? ms == 1 ? timeIncrsMs : timeIncrsS : numIncrs));
        axis.splits = fnOrSelf(axis.splits || (isTime && sc.distr == 1 ? _timeAxisSplits : sc.distr == 3 ? logAxisSplits : sc.distr == 4 ? asinhAxisSplits : numAxisSplits));
        axis.stroke = fnOrSelf(axis.stroke);
        axis.grid.stroke = fnOrSelf(axis.grid.stroke);
        axis.ticks.stroke = fnOrSelf(axis.ticks.stroke);
        axis.border.stroke = fnOrSelf(axis.border.stroke);
        let av = axis.values;
        axis.values = // static array of tick values
        isArr(av) && !isArr(av[0]) ? fnOrSelf(av) : (
          // temporal
          isTime ? (
            // config array of fmtDate string tpls
            isArr(av) ? timeAxisVals(_tzDate, timeAxisStamps(av, _fmtDate)) : (
              // fmtDate string tpl
              isStr(av) ? timeAxisVal(_tzDate, av) : av || _timeAxisVals
            )
          ) : av || numAxisVals
        );
        axis.filter = fnOrSelf(axis.filter || (sc.distr >= 3 && sc.log == 10 ? log10AxisValsFilt : sc.distr == 3 && sc.log == 2 ? log2AxisValsFilt : retArg1));
        axis.font = pxRatioFont(axis.font);
        axis.labelFont = pxRatioFont(axis.labelFont);
        axis._size = axis.size(self, null, i, 0);
        axis._space = axis._rotate = axis._incrs = axis._found = // foundIncrSpace
        axis._splits = axis._values = null;
        if (axis._size > 0) {
          sidesWithAxes[i] = true;
          axis._el = placeDiv(AXIS, wrap);
        }
      }
    }
    function autoPadSide(self2, side, sidesWithAxes2, cycleNum) {
      let [hasTopAxis, hasRgtAxis, hasBtmAxis, hasLftAxis] = sidesWithAxes2;
      let ori = side % 2;
      let size = 0;
      if (ori == 0 && (hasLftAxis || hasRgtAxis))
        size = side == 0 && !hasTopAxis || side == 2 && !hasBtmAxis ? round(xAxisOpts.size / 3) : 0;
      if (ori == 1 && (hasTopAxis || hasBtmAxis))
        size = side == 1 && !hasRgtAxis || side == 3 && !hasLftAxis ? round(yAxisOpts.size / 2) : 0;
      return size;
    }
    const padding = self.padding = (opts.padding || [autoPadSide, autoPadSide, autoPadSide, autoPadSide]).map((p) => fnOrSelf(ifNull(p, autoPadSide)));
    const _padding = self._padding = padding.map((p, i) => p(self, i, sidesWithAxes, 0));
    let dataLen;
    let i0 = null;
    let i1 = null;
    const idxs = mode == 1 ? series[0].idxs : null;
    let data0 = null;
    let viaAutoScaleX = false;
    function setData(_data, _resetScales) {
      data = _data == null ? [] : _data;
      self.data = self._data = data;
      if (mode == 2) {
        dataLen = 0;
        for (let i = 1; i < series.length; i++)
          dataLen += data[i][0].length;
      } else {
        if (data.length == 0)
          self.data = self._data = data = [[]];
        data0 = data[0];
        dataLen = data0.length;
        let scaleData = data;
        if (xScaleDistr == 2) {
          scaleData = data.slice();
          let _data0 = scaleData[0] = Array(dataLen);
          for (let i = 0; i < dataLen; i++)
            _data0[i] = i;
        }
        self._data = data = scaleData;
      }
      resetYSeries(true);
      fire("setData");
      if (xScaleDistr == 2) {
        shouldConvergeSize = true;
      }
      if (_resetScales !== false) {
        let xsc = scaleX;
        if (xsc.auto(self, viaAutoScaleX))
          autoScaleX();
        else
          _setScale(xScaleKey, xsc.min, xsc.max);
        shouldSetCursor = shouldSetCursor || cursor.left >= 0;
        shouldSetLegend = true;
        commit();
      }
    }
    self.setData = setData;
    function autoScaleX() {
      viaAutoScaleX = true;
      let _min, _max;
      if (mode == 1) {
        if (dataLen > 0) {
          i0 = idxs[0] = 0;
          i1 = idxs[1] = dataLen - 1;
          _min = data[0][i0];
          _max = data[0][i1];
          if (xScaleDistr == 2) {
            _min = i0;
            _max = i1;
          } else if (_min == _max) {
            if (xScaleDistr == 3)
              [_min, _max] = rangeLog(_min, _min, scaleX.log, false);
            else if (xScaleDistr == 4)
              [_min, _max] = rangeAsinh(_min, _min, scaleX.log, false);
            else if (scaleX.time)
              _max = _min + round(86400 / ms);
            else
              [_min, _max] = rangeNum(_min, _max, rangePad, true);
          }
        } else {
          i0 = idxs[0] = _min = null;
          i1 = idxs[1] = _max = null;
        }
      }
      _setScale(xScaleKey, _min, _max);
    }
    let ctxStroke, ctxFill, ctxWidth, ctxDash, ctxJoin, ctxCap, ctxFont, ctxAlign, ctxBaseline;
    let ctxAlpha;
    function setCtxStyle(stroke, width, dash, cap, fill, join2) {
      stroke != null ? stroke : stroke = transparent;
      dash != null ? dash : dash = EMPTY_ARR;
      cap != null ? cap : cap = "butt";
      fill != null ? fill : fill = transparent;
      join2 != null ? join2 : join2 = "round";
      if (stroke != ctxStroke)
        ctx.strokeStyle = ctxStroke = stroke;
      if (fill != ctxFill)
        ctx.fillStyle = ctxFill = fill;
      if (width != ctxWidth)
        ctx.lineWidth = ctxWidth = width;
      if (join2 != ctxJoin)
        ctx.lineJoin = ctxJoin = join2;
      if (cap != ctxCap)
        ctx.lineCap = ctxCap = cap;
      if (dash != ctxDash)
        ctx.setLineDash(ctxDash = dash);
    }
    function setFontStyle(font2, fill, align, baseline) {
      if (fill != ctxFill)
        ctx.fillStyle = ctxFill = fill;
      if (font2 != ctxFont)
        ctx.font = ctxFont = font2;
      if (align != ctxAlign)
        ctx.textAlign = ctxAlign = align;
      if (baseline != ctxBaseline)
        ctx.textBaseline = ctxBaseline = baseline;
    }
    function accScale(wsc, psc, facet2, data2, sorted = 0) {
      if (data2.length > 0 && wsc.auto(self, viaAutoScaleX) && (psc == null || psc.min == null)) {
        let _i0 = ifNull(i0, 0);
        let _i1 = ifNull(i1, data2.length - 1);
        let minMax = facet2.min == null ? getMinMax(data2, _i0, _i1, sorted, wsc.distr == 3) : [facet2.min, facet2.max];
        wsc.min = min(wsc.min, facet2.min = minMax[0]);
        wsc.max = max(wsc.max, facet2.max = minMax[1]);
      }
    }
    const AUTOSCALE = { min: null, max: null };
    function setScales() {
      for (let k in scales) {
        let sc = scales[k];
        if (pendScales[k] == null && // scales that have never been set (on init)
        (sc.min == null || // or auto scales when the x scale was explicitly set
        pendScales[xScaleKey] != null && sc.auto(self, viaAutoScaleX))) {
          pendScales[k] = AUTOSCALE;
        }
      }
      for (let k in scales) {
        let sc = scales[k];
        if (pendScales[k] == null && sc.from != null && pendScales[sc.from] != null)
          pendScales[k] = AUTOSCALE;
      }
      if (pendScales[xScaleKey] != null)
        resetYSeries(true);
      let wipScales = {};
      for (let k in pendScales) {
        let psc = pendScales[k];
        if (psc != null) {
          let wsc = wipScales[k] = copy(scales[k], fastIsObj);
          if (psc.min != null)
            assign(wsc, psc);
          else if (k != xScaleKey || mode == 2) {
            if (dataLen == 0 && wsc.from == null) {
              let minMax = wsc.range(self, null, null, k);
              wsc.min = minMax[0];
              wsc.max = minMax[1];
            } else {
              wsc.min = inf;
              wsc.max = -inf;
            }
          }
        }
      }
      if (dataLen > 0) {
        series.forEach((s2, i) => {
          if (mode == 1) {
            let k = s2.scale;
            let psc = pendScales[k];
            if (psc == null)
              return;
            let wsc = wipScales[k];
            if (i == 0) {
              let minMax = wsc.range(self, wsc.min, wsc.max, k);
              wsc.min = minMax[0];
              wsc.max = minMax[1];
              i0 = closestIdx(wsc.min, data[0]);
              i1 = closestIdx(wsc.max, data[0]);
              if (i1 - i0 > 1) {
                if (data[0][i0] < wsc.min)
                  i0++;
                if (data[0][i1] > wsc.max)
                  i1--;
              }
              s2.min = data0[i0];
              s2.max = data0[i1];
            } else if (s2.show && s2.auto)
              accScale(wsc, psc, s2, data[i], s2.sorted);
            s2.idxs[0] = i0;
            s2.idxs[1] = i1;
          } else {
            if (i > 0) {
              if (s2.show && s2.auto) {
                let [xFacet, yFacet] = s2.facets;
                let xScaleKey2 = xFacet.scale;
                let yScaleKey = yFacet.scale;
                let [xData, yData] = data[i];
                let wscx = wipScales[xScaleKey2];
                let wscy = wipScales[yScaleKey];
                wscx != null && accScale(wscx, pendScales[xScaleKey2], xFacet, xData, xFacet.sorted);
                wscy != null && accScale(wscy, pendScales[yScaleKey], yFacet, yData, yFacet.sorted);
                s2.min = yFacet.min;
                s2.max = yFacet.max;
              }
            }
          }
        });
        for (let k in wipScales) {
          let wsc = wipScales[k];
          let psc = pendScales[k];
          if (wsc.from == null && (psc == null || psc.min == null)) {
            let minMax = wsc.range(
              self,
              wsc.min == inf ? null : wsc.min,
              wsc.max == -inf ? null : wsc.max,
              k
            );
            wsc.min = minMax[0];
            wsc.max = minMax[1];
          }
        }
      }
      for (let k in wipScales) {
        let wsc = wipScales[k];
        if (wsc.from != null) {
          let base = wipScales[wsc.from];
          if (base.min == null)
            wsc.min = wsc.max = null;
          else {
            let minMax = wsc.range(self, base.min, base.max, k);
            wsc.min = minMax[0];
            wsc.max = minMax[1];
          }
        }
      }
      let changed = {};
      let anyChanged = false;
      for (let k in wipScales) {
        let wsc = wipScales[k];
        let sc = scales[k];
        if (sc.min != wsc.min || sc.max != wsc.max) {
          sc.min = wsc.min;
          sc.max = wsc.max;
          let distr = sc.distr;
          sc._min = distr == 3 ? log10(sc.min) : distr == 4 ? asinh(sc.min, sc.asinh) : distr == 100 ? sc.fwd(sc.min) : sc.min;
          sc._max = distr == 3 ? log10(sc.max) : distr == 4 ? asinh(sc.max, sc.asinh) : distr == 100 ? sc.fwd(sc.max) : sc.max;
          changed[k] = anyChanged = true;
        }
      }
      if (anyChanged) {
        series.forEach((s2, i) => {
          if (mode == 2) {
            if (i > 0 && changed.y)
              s2._paths = null;
          } else {
            if (changed[s2.scale])
              s2._paths = null;
          }
        });
        for (let k in changed) {
          shouldConvergeSize = true;
          fire("setScale", k);
        }
        if (showCursor && cursor.left >= 0)
          shouldSetCursor = shouldSetLegend = true;
      }
      for (let k in pendScales)
        pendScales[k] = null;
    }
    function getOuterIdxs(ydata) {
      let _i0 = clamp(i0 - 1, 0, dataLen - 1);
      let _i1 = clamp(i1 + 1, 0, dataLen - 1);
      while (ydata[_i0] == null && _i0 > 0)
        _i0--;
      while (ydata[_i1] == null && _i1 < dataLen - 1)
        _i1++;
      return [_i0, _i1];
    }
    function drawSeries() {
      if (dataLen > 0) {
        let shouldAlpha = series.some((s2) => s2._focus) && ctxAlpha != focus.alpha;
        if (shouldAlpha)
          ctx.globalAlpha = ctxAlpha = focus.alpha;
        series.forEach((s2, i) => {
          if (i > 0 && s2.show) {
            cacheStrokeFill(i, false);
            cacheStrokeFill(i, true);
            if (s2._paths == null) {
              let _ctxAlpha = ctxAlpha;
              if (ctxAlpha != s2.alpha)
                ctx.globalAlpha = ctxAlpha = s2.alpha;
              let _idxs = mode == 2 ? [0, data[i][0].length - 1] : getOuterIdxs(data[i]);
              s2._paths = s2.paths(self, i, _idxs[0], _idxs[1]);
              if (ctxAlpha != _ctxAlpha)
                ctx.globalAlpha = ctxAlpha = _ctxAlpha;
            }
          }
        });
        series.forEach((s2, i) => {
          if (i > 0 && s2.show) {
            let _ctxAlpha = ctxAlpha;
            if (ctxAlpha != s2.alpha)
              ctx.globalAlpha = ctxAlpha = s2.alpha;
            s2._paths != null && drawPath(i, false);
            {
              let _gaps = s2._paths != null ? s2._paths.gaps : null;
              let show2 = s2.points.show(self, i, i0, i1, _gaps);
              let idxs2 = s2.points.filter(self, i, show2, _gaps);
              if (show2 || idxs2) {
                s2.points._paths = s2.points.paths(self, i, i0, i1, idxs2);
                drawPath(i, true);
              }
            }
            if (ctxAlpha != _ctxAlpha)
              ctx.globalAlpha = ctxAlpha = _ctxAlpha;
            fire("drawSeries", i);
          }
        });
        if (shouldAlpha)
          ctx.globalAlpha = ctxAlpha = 1;
      }
    }
    function cacheStrokeFill(si, _points) {
      let s2 = _points ? series[si].points : series[si];
      s2._stroke = s2.stroke(self, si);
      s2._fill = s2.fill(self, si);
    }
    function drawPath(si, _points) {
      let s2 = _points ? series[si].points : series[si];
      let {
        stroke,
        fill,
        clip: gapsClip,
        flags,
        _stroke: strokeStyle = s2._stroke,
        _fill: fillStyle = s2._fill,
        _width: width = s2.width
      } = s2._paths;
      width = roundDec(width * pxRatio, 3);
      let boundsClip = null;
      let offset = width % 2 / 2;
      if (_points && fillStyle == null)
        fillStyle = width > 0 ? "#fff" : strokeStyle;
      let _pxAlign = s2.pxAlign == 1 && offset > 0;
      _pxAlign && ctx.translate(offset, offset);
      if (!_points) {
        let lft = plotLft - width / 2, top = plotTop - width / 2, wid = plotWid + width, hgt = plotHgt + width;
        boundsClip = new Path2D();
        boundsClip.rect(lft, top, wid, hgt);
      }
      if (_points)
        strokeFill(strokeStyle, width, s2.dash, s2.cap, fillStyle, stroke, fill, flags, gapsClip);
      else
        fillStroke(si, strokeStyle, width, s2.dash, s2.cap, fillStyle, stroke, fill, flags, boundsClip, gapsClip);
      _pxAlign && ctx.translate(-offset, -offset);
    }
    function fillStroke(si, strokeStyle, lineWidth, lineDash, lineCap, fillStyle, strokePath, fillPath, flags, boundsClip, gapsClip) {
      let didStrokeFill = false;
      flags != 0 && bands.forEach((b, bi) => {
        if (b.series[0] == si) {
          let lowerEdge = series[b.series[1]];
          let lowerData = data[b.series[1]];
          let bandClip = (lowerEdge._paths || EMPTY_OBJ).band;
          if (isArr(bandClip))
            bandClip = b.dir == 1 ? bandClip[0] : bandClip[1];
          let gapsClip2;
          let _fillStyle = null;
          if (lowerEdge.show && bandClip && hasData(lowerData, i0, i1)) {
            _fillStyle = b.fill(self, bi) || fillStyle;
            gapsClip2 = lowerEdge._paths.clip;
          } else
            bandClip = null;
          strokeFill(strokeStyle, lineWidth, lineDash, lineCap, _fillStyle, strokePath, fillPath, flags, boundsClip, gapsClip, gapsClip2, bandClip);
          didStrokeFill = true;
        }
      });
      if (!didStrokeFill)
        strokeFill(strokeStyle, lineWidth, lineDash, lineCap, fillStyle, strokePath, fillPath, flags, boundsClip, gapsClip);
    }
    const CLIP_FILL_STROKE = BAND_CLIP_FILL | BAND_CLIP_STROKE;
    function strokeFill(strokeStyle, lineWidth, lineDash, lineCap, fillStyle, strokePath, fillPath, flags, boundsClip, gapsClip, gapsClip2, bandClip) {
      setCtxStyle(strokeStyle, lineWidth, lineDash, lineCap, fillStyle);
      if (boundsClip || gapsClip || bandClip) {
        ctx.save();
        boundsClip && ctx.clip(boundsClip);
        gapsClip && ctx.clip(gapsClip);
      }
      if (bandClip) {
        if ((flags & CLIP_FILL_STROKE) == CLIP_FILL_STROKE) {
          ctx.clip(bandClip);
          gapsClip2 && ctx.clip(gapsClip2);
          doFill(fillStyle, fillPath);
          doStroke(strokeStyle, strokePath, lineWidth);
        } else if (flags & BAND_CLIP_STROKE) {
          doFill(fillStyle, fillPath);
          ctx.clip(bandClip);
          doStroke(strokeStyle, strokePath, lineWidth);
        } else if (flags & BAND_CLIP_FILL) {
          ctx.save();
          ctx.clip(bandClip);
          gapsClip2 && ctx.clip(gapsClip2);
          doFill(fillStyle, fillPath);
          ctx.restore();
          doStroke(strokeStyle, strokePath, lineWidth);
        }
      } else {
        doFill(fillStyle, fillPath);
        doStroke(strokeStyle, strokePath, lineWidth);
      }
      if (boundsClip || gapsClip || bandClip)
        ctx.restore();
    }
    function doStroke(strokeStyle, strokePath, lineWidth) {
      if (lineWidth > 0) {
        if (strokePath instanceof Map) {
          strokePath.forEach((strokePath2, strokeStyle2) => {
            ctx.strokeStyle = ctxStroke = strokeStyle2;
            ctx.stroke(strokePath2);
          });
        } else
          strokePath != null && strokeStyle && ctx.stroke(strokePath);
      }
    }
    function doFill(fillStyle, fillPath) {
      if (fillPath instanceof Map) {
        fillPath.forEach((fillPath2, fillStyle2) => {
          ctx.fillStyle = ctxFill = fillStyle2;
          ctx.fill(fillPath2);
        });
      } else
        fillPath != null && fillStyle && ctx.fill(fillPath);
    }
    function getIncrSpace(axisIdx, min2, max2, fullDim) {
      let axis = axes[axisIdx];
      let incrSpace;
      if (fullDim <= 0)
        incrSpace = [0, 0];
      else {
        let minSpace = axis._space = axis.space(self, axisIdx, min2, max2, fullDim);
        let incrs = axis._incrs = axis.incrs(self, axisIdx, min2, max2, fullDim, minSpace);
        incrSpace = findIncr(min2, max2, incrs, fullDim, minSpace);
      }
      return axis._found = incrSpace;
    }
    function drawOrthoLines(offs, filts, ori, side, pos0, len, width, stroke, dash, cap) {
      let offset = width % 2 / 2;
      pxAlign == 1 && ctx.translate(offset, offset);
      setCtxStyle(stroke, width, dash, cap, stroke);
      ctx.beginPath();
      let x0, y0, x1, y1, pos1 = pos0 + (side == 0 || side == 3 ? -len : len);
      if (ori == 0) {
        y0 = pos0;
        y1 = pos1;
      } else {
        x0 = pos0;
        x1 = pos1;
      }
      for (let i = 0; i < offs.length; i++) {
        if (filts[i] != null) {
          if (ori == 0)
            x0 = x1 = offs[i];
          else
            y0 = y1 = offs[i];
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
        }
      }
      ctx.stroke();
      pxAlign == 1 && ctx.translate(-offset, -offset);
    }
    function axesCalc(cycleNum) {
      let converged = true;
      axes.forEach((axis, i) => {
        if (!axis.show)
          return;
        let scale = scales[axis.scale];
        if (scale.min == null) {
          if (axis._show) {
            converged = false;
            axis._show = false;
            resetYSeries(false);
          }
          return;
        } else {
          if (!axis._show) {
            converged = false;
            axis._show = true;
            resetYSeries(false);
          }
        }
        let side = axis.side;
        let ori = side % 2;
        let { min: min2, max: max2 } = scale;
        let [_incr, _space] = getIncrSpace(i, min2, max2, ori == 0 ? plotWidCss : plotHgtCss);
        if (_space == 0)
          return;
        let forceMin = scale.distr == 2;
        let _splits = axis._splits = axis.splits(self, i, min2, max2, _incr, _space, forceMin);
        let splits = scale.distr == 2 ? _splits.map((i2) => data0[i2]) : _splits;
        let incr = scale.distr == 2 ? data0[_splits[1]] - data0[_splits[0]] : _incr;
        let values = axis._values = axis.values(self, axis.filter(self, splits, i, _space, incr), i, _space, incr);
        axis._rotate = side == 2 ? axis.rotate(self, values, i, _space) : 0;
        let oldSize = axis._size;
        axis._size = ceil(axis.size(self, values, i, cycleNum));
        if (oldSize != null && axis._size != oldSize)
          converged = false;
      });
      return converged;
    }
    function paddingCalc(cycleNum) {
      let converged = true;
      padding.forEach((p, i) => {
        let _p = p(self, i, sidesWithAxes, cycleNum);
        if (_p != _padding[i])
          converged = false;
        _padding[i] = _p;
      });
      return converged;
    }
    function drawAxesGrid() {
      for (let i = 0; i < axes.length; i++) {
        let axis = axes[i];
        if (!axis.show || !axis._show)
          continue;
        let side = axis.side;
        let ori = side % 2;
        let x, y;
        let fillStyle = axis.stroke(self, i);
        let shiftDir = side == 0 || side == 3 ? -1 : 1;
        let [_incr, _space] = axis._found;
        if (axis.label != null) {
          let shiftAmt2 = axis.labelGap * shiftDir;
          let baseLpos = round((axis._lpos + shiftAmt2) * pxRatio);
          setFontStyle(axis.labelFont[0], fillStyle, "center", side == 2 ? TOP : BOTTOM);
          ctx.save();
          if (ori == 1) {
            x = y = 0;
            ctx.translate(
              baseLpos,
              round(plotTop + plotHgt / 2)
            );
            ctx.rotate((side == 3 ? -PI : PI) / 2);
          } else {
            x = round(plotLft + plotWid / 2);
            y = baseLpos;
          }
          let _label = isFn(axis.label) ? axis.label(self, i, _incr, _space) : axis.label;
          ctx.fillText(_label, x, y);
          ctx.restore();
        }
        if (_space == 0)
          continue;
        let scale = scales[axis.scale];
        let plotDim = ori == 0 ? plotWid : plotHgt;
        let plotOff = ori == 0 ? plotLft : plotTop;
        let _splits = axis._splits;
        let splits = scale.distr == 2 ? _splits.map((i2) => data0[i2]) : _splits;
        let incr = scale.distr == 2 ? data0[_splits[1]] - data0[_splits[0]] : _incr;
        let ticks2 = axis.ticks;
        let border2 = axis.border;
        let _tickSize = ticks2.show ? ticks2.size : 0;
        let tickSize = round(_tickSize * pxRatio);
        let axisGap = round((axis.alignTo == 2 ? axis._size - _tickSize - axis.gap : axis.gap) * pxRatio);
        let angle = axis._rotate * -PI / 180;
        let basePos = pxRound(axis._pos * pxRatio);
        let shiftAmt = (tickSize + axisGap) * shiftDir;
        let finalPos = basePos + shiftAmt;
        y = ori == 0 ? finalPos : 0;
        x = ori == 1 ? finalPos : 0;
        let font2 = axis.font[0];
        let textAlign = axis.align == 1 ? LEFT : axis.align == 2 ? RIGHT : angle > 0 ? LEFT : angle < 0 ? RIGHT : ori == 0 ? "center" : side == 3 ? RIGHT : LEFT;
        let textBaseline = angle || ori == 1 ? "middle" : side == 2 ? TOP : BOTTOM;
        setFontStyle(font2, fillStyle, textAlign, textBaseline);
        let lineHeight = axis.font[1] * axis.lineGap;
        let canOffs = _splits.map((val) => pxRound(getPos(val, scale, plotDim, plotOff)));
        let _values = axis._values;
        for (let i2 = 0; i2 < _values.length; i2++) {
          let val = _values[i2];
          if (val != null) {
            if (ori == 0)
              x = canOffs[i2];
            else
              y = canOffs[i2];
            val = "" + val;
            let _parts = val.indexOf("\n") == -1 ? [val] : val.split(/\n/gm);
            for (let j = 0; j < _parts.length; j++) {
              let text = _parts[j];
              if (angle) {
                ctx.save();
                ctx.translate(x, y + j * lineHeight);
                ctx.rotate(angle);
                ctx.fillText(text, 0, 0);
                ctx.restore();
              } else
                ctx.fillText(text, x, y + j * lineHeight);
            }
          }
        }
        if (ticks2.show) {
          drawOrthoLines(
            canOffs,
            ticks2.filter(self, splits, i, _space, incr),
            ori,
            side,
            basePos,
            tickSize,
            roundDec(ticks2.width * pxRatio, 3),
            ticks2.stroke(self, i),
            ticks2.dash,
            ticks2.cap
          );
        }
        let grid2 = axis.grid;
        if (grid2.show) {
          drawOrthoLines(
            canOffs,
            grid2.filter(self, splits, i, _space, incr),
            ori,
            ori == 0 ? 2 : 1,
            ori == 0 ? plotTop : plotLft,
            ori == 0 ? plotHgt : plotWid,
            roundDec(grid2.width * pxRatio, 3),
            grid2.stroke(self, i),
            grid2.dash,
            grid2.cap
          );
        }
        if (border2.show) {
          drawOrthoLines(
            [basePos],
            [1],
            ori == 0 ? 1 : 0,
            ori == 0 ? 1 : 2,
            ori == 1 ? plotTop : plotLft,
            ori == 1 ? plotHgt : plotWid,
            roundDec(border2.width * pxRatio, 3),
            border2.stroke(self, i),
            border2.dash,
            border2.cap
          );
        }
      }
      fire("drawAxes");
    }
    function resetYSeries(minMax) {
      series.forEach((s2, i) => {
        if (i > 0) {
          s2._paths = null;
          if (minMax) {
            if (mode == 1) {
              s2.min = null;
              s2.max = null;
            } else {
              s2.facets.forEach((f) => {
                f.min = null;
                f.max = null;
              });
            }
          }
        }
      });
    }
    let queuedCommit = false;
    let deferHooks = false;
    let hooksQueue = [];
    function flushHooks() {
      deferHooks = false;
      for (let i = 0; i < hooksQueue.length; i++)
        fire(...hooksQueue[i]);
      hooksQueue.length = 0;
    }
    function commit() {
      if (!queuedCommit) {
        microTask(_commit);
        queuedCommit = true;
      }
    }
    function batch(fn, _deferHooks = false) {
      queuedCommit = true;
      deferHooks = _deferHooks;
      fn(self);
      _commit();
      if (_deferHooks && hooksQueue.length > 0)
        queueMicrotask(flushHooks);
    }
    self.batch = batch;
    function _commit() {
      if (shouldSetScales) {
        setScales();
        shouldSetScales = false;
      }
      if (shouldConvergeSize) {
        convergeSize();
        shouldConvergeSize = false;
      }
      if (shouldSetSize) {
        setStylePx(under, LEFT, plotLftCss);
        setStylePx(under, TOP, plotTopCss);
        setStylePx(under, WIDTH, plotWidCss);
        setStylePx(under, HEIGHT, plotHgtCss);
        setStylePx(over, LEFT, plotLftCss);
        setStylePx(over, TOP, plotTopCss);
        setStylePx(over, WIDTH, plotWidCss);
        setStylePx(over, HEIGHT, plotHgtCss);
        setStylePx(wrap, WIDTH, fullWidCss);
        setStylePx(wrap, HEIGHT, fullHgtCss);
        can.width = round(fullWidCss * pxRatio);
        can.height = round(fullHgtCss * pxRatio);
        axes.forEach(({ _el, _show, _size, _pos, side }) => {
          if (_el != null) {
            if (_show) {
              let posOffset = side === 3 || side === 0 ? _size : 0;
              let isVt = side % 2 == 1;
              setStylePx(_el, isVt ? "left" : "top", _pos - posOffset);
              setStylePx(_el, isVt ? "width" : "height", _size);
              setStylePx(_el, isVt ? "top" : "left", isVt ? plotTopCss : plotLftCss);
              setStylePx(_el, isVt ? "height" : "width", isVt ? plotHgtCss : plotWidCss);
              remClass(_el, OFF);
            } else
              addClass(_el, OFF);
          }
        });
        ctxStroke = ctxFill = ctxWidth = ctxJoin = ctxCap = ctxFont = ctxAlign = ctxBaseline = ctxDash = null;
        ctxAlpha = 1;
        syncRect(true);
        if (plotLftCss != _plotLftCss || plotTopCss != _plotTopCss || plotWidCss != _plotWidCss || plotHgtCss != _plotHgtCss) {
          resetYSeries(false);
          let pctWid = plotWidCss / _plotWidCss;
          let pctHgt = plotHgtCss / _plotHgtCss;
          if (showCursor && !shouldSetCursor && cursor.left >= 0) {
            cursor.left *= pctWid;
            cursor.top *= pctHgt;
            vCursor && elTrans(vCursor, round(cursor.left), 0, plotWidCss, plotHgtCss);
            hCursor && elTrans(hCursor, 0, round(cursor.top), plotWidCss, plotHgtCss);
            for (let i = 0; i < cursorPts.length; i++) {
              let pt = cursorPts[i];
              if (pt != null) {
                cursorPtsLft[i] *= pctWid;
                cursorPtsTop[i] *= pctHgt;
                elTrans(pt, ceil(cursorPtsLft[i]), ceil(cursorPtsTop[i]), plotWidCss, plotHgtCss);
              }
            }
          }
          if (select.show && !shouldSetSelect && select.left >= 0 && select.width > 0) {
            select.left *= pctWid;
            select.width *= pctWid;
            select.top *= pctHgt;
            select.height *= pctHgt;
            for (let prop in _hideProps)
              setStylePx(selectDiv, prop, select[prop]);
          }
          _plotLftCss = plotLftCss;
          _plotTopCss = plotTopCss;
          _plotWidCss = plotWidCss;
          _plotHgtCss = plotHgtCss;
        }
        fire("setSize");
        shouldSetSize = false;
      }
      if (fullWidCss > 0 && fullHgtCss > 0) {
        ctx.clearRect(0, 0, can.width, can.height);
        fire("drawClear");
        drawOrder.forEach((fn) => fn());
        fire("draw");
      }
      if (select.show && shouldSetSelect) {
        setSelect(select);
        shouldSetSelect = false;
      }
      if (showCursor && shouldSetCursor) {
        updateCursor(null, true, false);
        shouldSetCursor = false;
      }
      if (legend.show && legend.live && shouldSetLegend) {
        setLegend();
        shouldSetLegend = false;
      }
      if (!ready) {
        ready = true;
        self.status = 1;
        fire("ready");
      }
      viaAutoScaleX = false;
      queuedCommit = false;
    }
    self.redraw = (rebuildPaths, recalcAxes) => {
      shouldConvergeSize = recalcAxes || false;
      if (rebuildPaths !== false)
        _setScale(xScaleKey, scaleX.min, scaleX.max);
      else
        commit();
    };
    function setScale(key2, opts2) {
      let sc = scales[key2];
      if (sc.from == null) {
        if (dataLen == 0) {
          let minMax = sc.range(self, opts2.min, opts2.max, key2);
          opts2.min = minMax[0];
          opts2.max = minMax[1];
        }
        if (opts2.min > opts2.max) {
          let _min = opts2.min;
          opts2.min = opts2.max;
          opts2.max = _min;
        }
        if (dataLen > 1 && opts2.min != null && opts2.max != null && opts2.max - opts2.min < 1e-16)
          return;
        if (key2 == xScaleKey) {
          if (sc.distr == 2 && dataLen > 0) {
            opts2.min = closestIdx(opts2.min, data[0]);
            opts2.max = closestIdx(opts2.max, data[0]);
            if (opts2.min == opts2.max)
              opts2.max++;
          }
        }
        pendScales[key2] = opts2;
        shouldSetScales = true;
        commit();
      }
    }
    self.setScale = setScale;
    let xCursor;
    let yCursor;
    let vCursor;
    let hCursor;
    let rawMouseLeft0;
    let rawMouseTop0;
    let mouseLeft0;
    let mouseTop0;
    let rawMouseLeft1;
    let rawMouseTop1;
    let mouseLeft1;
    let mouseTop1;
    let dragging = false;
    const drag = cursor.drag;
    let dragX = drag.x;
    let dragY = drag.y;
    if (showCursor) {
      if (cursor.x)
        xCursor = placeDiv(CURSOR_X, over);
      if (cursor.y)
        yCursor = placeDiv(CURSOR_Y, over);
      if (scaleX.ori == 0) {
        vCursor = xCursor;
        hCursor = yCursor;
      } else {
        vCursor = yCursor;
        hCursor = xCursor;
      }
      mouseLeft1 = cursor.left;
      mouseTop1 = cursor.top;
    }
    const select = self.select = assign({
      show: true,
      over: true,
      left: 0,
      width: 0,
      top: 0,
      height: 0
    }, opts.select);
    const selectDiv = select.show ? placeDiv(SELECT, select.over ? over : under) : null;
    function setSelect(opts2, _fire) {
      if (select.show) {
        for (let prop in opts2) {
          select[prop] = opts2[prop];
          if (prop in _hideProps)
            setStylePx(selectDiv, prop, opts2[prop]);
        }
        _fire !== false && fire("setSelect");
      }
    }
    self.setSelect = setSelect;
    function toggleDOM(i) {
      let s2 = series[i];
      if (s2.show)
        showLegend && remClass(legendRows[i], OFF);
      else {
        showLegend && addClass(legendRows[i], OFF);
        if (showCursor) {
          let pt = cursorOnePt ? cursorPts[0] : cursorPts[i];
          pt != null && elTrans(pt, -10, -10, plotWidCss, plotHgtCss);
        }
      }
    }
    function _setScale(key2, min2, max2) {
      setScale(key2, { min: min2, max: max2 });
    }
    function setSeries(i, opts2, _fire, _pub) {
      if (opts2.focus != null)
        setFocus(i);
      if (opts2.show != null) {
        series.forEach((s2, si) => {
          if (si > 0 && (i == si || i == null)) {
            s2.show = opts2.show;
            toggleDOM(si);
            if (mode == 2) {
              _setScale(s2.facets[0].scale, null, null);
              _setScale(s2.facets[1].scale, null, null);
            } else
              _setScale(s2.scale, null, null);
            commit();
          }
        });
      }
      _fire !== false && fire("setSeries", i, opts2);
      _pub && pubSync("setSeries", self, i, opts2);
    }
    self.setSeries = setSeries;
    function setBand(bi, opts2) {
      assign(bands[bi], opts2);
    }
    function addBand(opts2, bi) {
      opts2.fill = fnOrSelf(opts2.fill || null);
      opts2.dir = ifNull(opts2.dir, -1);
      bi = bi == null ? bands.length : bi;
      bands.splice(bi, 0, opts2);
    }
    function delBand(bi) {
      if (bi == null)
        bands.length = 0;
      else
        bands.splice(bi, 1);
    }
    self.addBand = addBand;
    self.setBand = setBand;
    self.delBand = delBand;
    function setAlpha(i, value) {
      series[i].alpha = value;
      if (showCursor && cursorPts[i] != null)
        cursorPts[i].style.opacity = value;
      if (showLegend && legendRows[i])
        legendRows[i].style.opacity = value;
    }
    let closestDist;
    let closestSeries;
    let focusedSeries;
    const FOCUS_TRUE = { focus: true };
    function setFocus(i) {
      if (i != focusedSeries) {
        let allFocused = i == null;
        let _setAlpha = focus.alpha != 1;
        series.forEach((s2, i2) => {
          if (mode == 1 || i2 > 0) {
            let isFocused = allFocused || i2 == 0 || i2 == i;
            s2._focus = allFocused ? null : isFocused;
            _setAlpha && setAlpha(i2, isFocused ? 1 : focus.alpha);
          }
        });
        focusedSeries = i;
        _setAlpha && commit();
      }
    }
    if (showLegend && cursorFocus) {
      onMouse(mouseleave, legendTable, (e) => {
        if (cursor._lock)
          return;
        setCursorEvent(e);
        if (focusedSeries != null)
          setSeries(null, FOCUS_TRUE, true, syncOpts.setSeries);
      });
    }
    function posToVal(pos, scale, can2) {
      let sc = scales[scale];
      if (can2)
        pos = pos / pxRatio - (sc.ori == 1 ? plotTopCss : plotLftCss);
      let dim = plotWidCss;
      if (sc.ori == 1) {
        dim = plotHgtCss;
        pos = dim - pos;
      }
      if (sc.dir == -1)
        pos = dim - pos;
      let _min = sc._min, _max = sc._max, pct = pos / dim;
      let sv = _min + (_max - _min) * pct;
      let distr = sc.distr;
      return distr == 3 ? pow(10, sv) : distr == 4 ? sinh(sv, sc.asinh) : distr == 100 ? sc.bwd(sv) : sv;
    }
    function closestIdxFromXpos(pos, can2) {
      let v = posToVal(pos, xScaleKey, can2);
      return closestIdx(v, data[0], i0, i1);
    }
    self.valToIdx = (val) => closestIdx(val, data[0]);
    self.posToIdx = closestIdxFromXpos;
    self.posToVal = posToVal;
    self.valToPos = (val, scale, can2) => scales[scale].ori == 0 ? getHPos(
      val,
      scales[scale],
      can2 ? plotWid : plotWidCss,
      can2 ? plotLft : 0
    ) : getVPos(
      val,
      scales[scale],
      can2 ? plotHgt : plotHgtCss,
      can2 ? plotTop : 0
    );
    self.setCursor = (opts2, _fire, _pub) => {
      mouseLeft1 = opts2.left;
      mouseTop1 = opts2.top;
      updateCursor(null, _fire, _pub);
    };
    function setSelH(off2, dim) {
      setStylePx(selectDiv, LEFT, select.left = off2);
      setStylePx(selectDiv, WIDTH, select.width = dim);
    }
    function setSelV(off2, dim) {
      setStylePx(selectDiv, TOP, select.top = off2);
      setStylePx(selectDiv, HEIGHT, select.height = dim);
    }
    let setSelX = scaleX.ori == 0 ? setSelH : setSelV;
    let setSelY = scaleX.ori == 1 ? setSelH : setSelV;
    function syncLegend() {
      if (showLegend && legend.live) {
        for (let i = mode == 2 ? 1 : 0; i < series.length; i++) {
          if (i == 0 && multiValLegend)
            continue;
          let vals = legend.values[i];
          let j = 0;
          for (let k in vals)
            legendCells[i][j++].firstChild.nodeValue = vals[k];
        }
      }
    }
    function setLegend(opts2, _fire) {
      if (opts2 != null) {
        if (opts2.idxs) {
          opts2.idxs.forEach((didx, sidx) => {
            activeIdxs[sidx] = didx;
          });
        } else if (!isUndef(opts2.idx))
          activeIdxs.fill(opts2.idx);
        legend.idx = activeIdxs[0];
      }
      if (showLegend && legend.live) {
        for (let sidx = 0; sidx < series.length; sidx++) {
          if (sidx > 0 || mode == 1 && !multiValLegend)
            setLegendValues(sidx, activeIdxs[sidx]);
        }
        syncLegend();
      }
      shouldSetLegend = false;
      _fire !== false && fire("setLegend");
    }
    self.setLegend = setLegend;
    function setLegendValues(sidx, idx) {
      var _a2;
      let s2 = series[sidx];
      let src = sidx == 0 && xScaleDistr == 2 ? data0 : data[sidx];
      let val;
      if (multiValLegend)
        val = (_a2 = s2.values(self, sidx, idx)) != null ? _a2 : NULL_LEGEND_VALUES;
      else {
        val = s2.value(self, idx == null ? null : src[idx], sidx, idx);
        val = val == null ? NULL_LEGEND_VALUES : { _: val };
      }
      legend.values[sidx] = val;
    }
    function updateCursor(src, _fire, _pub) {
      rawMouseLeft1 = mouseLeft1;
      rawMouseTop1 = mouseTop1;
      [mouseLeft1, mouseTop1] = cursor.move(self, mouseLeft1, mouseTop1);
      cursor.left = mouseLeft1;
      cursor.top = mouseTop1;
      if (showCursor) {
        vCursor && elTrans(vCursor, round(mouseLeft1), 0, plotWidCss, plotHgtCss);
        hCursor && elTrans(hCursor, 0, round(mouseTop1), plotWidCss, plotHgtCss);
      }
      let idx;
      let noDataInRange = i0 > i1;
      closestDist = inf;
      closestSeries = null;
      let xDim = scaleX.ori == 0 ? plotWidCss : plotHgtCss;
      let yDim = scaleX.ori == 1 ? plotWidCss : plotHgtCss;
      if (mouseLeft1 < 0 || dataLen == 0 || noDataInRange) {
        idx = cursor.idx = null;
        for (let i = 0; i < series.length; i++) {
          let pt = cursorPts[i];
          pt != null && elTrans(pt, -10, -10, plotWidCss, plotHgtCss);
        }
        if (cursorFocus)
          setSeries(null, FOCUS_TRUE, true, src == null && syncOpts.setSeries);
        if (legend.live) {
          activeIdxs.fill(idx);
          shouldSetLegend = true;
        }
      } else {
        let mouseXPos, valAtPosX, xPos;
        if (mode == 1) {
          mouseXPos = scaleX.ori == 0 ? mouseLeft1 : mouseTop1;
          valAtPosX = posToVal(mouseXPos, xScaleKey);
          idx = cursor.idx = closestIdx(valAtPosX, data[0], i0, i1);
          xPos = valToPosX(data[0][idx], scaleX, xDim, 0);
        }
        let _ptLft = -10;
        let _ptTop = -10;
        let _ptWid = 0;
        let _ptHgt = 0;
        let _centered = true;
        let _ptFill = "";
        let _ptStroke = "";
        for (let i = mode == 2 ? 1 : 0; i < series.length; i++) {
          let s2 = series[i];
          let idx1 = activeIdxs[i];
          let yVal1 = idx1 == null ? null : mode == 1 ? data[i][idx1] : data[i][1][idx1];
          let idx2 = cursor.dataIdx(self, i, idx, valAtPosX);
          let yVal2 = idx2 == null ? null : mode == 1 ? data[i][idx2] : data[i][1][idx2];
          shouldSetLegend = shouldSetLegend || yVal2 != yVal1 || idx2 != idx1;
          activeIdxs[i] = idx2;
          if (i > 0 && s2.show) {
            let xPos2 = idx2 == null ? -10 : idx2 == idx ? xPos : valToPosX(mode == 1 ? data[0][idx2] : data[i][0][idx2], scaleX, xDim, 0);
            let yPos = yVal2 == null ? -10 : valToPosY(yVal2, mode == 1 ? scales[s2.scale] : scales[s2.facets[1].scale], yDim, 0);
            if (cursorFocus && yVal2 != null) {
              let mouseYPos = scaleX.ori == 1 ? mouseLeft1 : mouseTop1;
              let dist = abs(focus.dist(self, i, idx2, yPos, mouseYPos));
              if (dist < closestDist) {
                let bias = focus.bias;
                if (bias != 0) {
                  let mouseYVal = posToVal(mouseYPos, s2.scale);
                  let seriesYValSign = yVal2 >= 0 ? 1 : -1;
                  let mouseYValSign = mouseYVal >= 0 ? 1 : -1;
                  if (mouseYValSign == seriesYValSign && (mouseYValSign == 1 ? bias == 1 ? yVal2 >= mouseYVal : yVal2 <= mouseYVal : (
                    // >= 0
                    bias == 1 ? yVal2 <= mouseYVal : yVal2 >= mouseYVal
                  ))) {
                    closestDist = dist;
                    closestSeries = i;
                  }
                } else {
                  closestDist = dist;
                  closestSeries = i;
                }
              }
            }
            if (shouldSetLegend || cursorOnePt) {
              let hPos, vPos;
              if (scaleX.ori == 0) {
                hPos = xPos2;
                vPos = yPos;
              } else {
                hPos = yPos;
                vPos = xPos2;
              }
              let ptWid, ptHgt, ptLft, ptTop, ptStroke, ptFill, centered = true, getBBox = points2.bbox;
              if (getBBox != null) {
                centered = false;
                let bbox = getBBox(self, i);
                ptLft = bbox.left;
                ptTop = bbox.top;
                ptWid = bbox.width;
                ptHgt = bbox.height;
              } else {
                ptLft = hPos;
                ptTop = vPos;
                ptWid = ptHgt = points2.size(self, i);
              }
              ptFill = points2.fill(self, i);
              ptStroke = points2.stroke(self, i);
              if (cursorOnePt) {
                if (i == closestSeries && closestDist <= focus.prox) {
                  _ptLft = ptLft;
                  _ptTop = ptTop;
                  _ptWid = ptWid;
                  _ptHgt = ptHgt;
                  _centered = centered;
                  _ptFill = ptFill;
                  _ptStroke = ptStroke;
                }
              } else {
                let pt = cursorPts[i];
                if (pt != null) {
                  cursorPtsLft[i] = ptLft;
                  cursorPtsTop[i] = ptTop;
                  elSize(pt, ptWid, ptHgt, centered);
                  elColor(pt, ptFill, ptStroke);
                  elTrans(pt, ceil(ptLft), ceil(ptTop), plotWidCss, plotHgtCss);
                }
              }
            }
          }
        }
        if (cursorOnePt) {
          let p = focus.prox;
          let focusChanged = focusedSeries == null ? closestDist <= p : closestDist > p || closestSeries != focusedSeries;
          if (shouldSetLegend || focusChanged) {
            let pt = cursorPts[0];
            if (pt != null) {
              cursorPtsLft[0] = _ptLft;
              cursorPtsTop[0] = _ptTop;
              elSize(pt, _ptWid, _ptHgt, _centered);
              elColor(pt, _ptFill, _ptStroke);
              elTrans(pt, ceil(_ptLft), ceil(_ptTop), plotWidCss, plotHgtCss);
            }
          }
        }
      }
      if (select.show && dragging) {
        if (src != null) {
          let [xKey, yKey] = syncOpts.scales;
          let [matchXKeys, matchYKeys] = syncOpts.match;
          let [xKeySrc, yKeySrc] = src.cursor.sync.scales;
          let sdrag = src.cursor.drag;
          dragX = sdrag._x;
          dragY = sdrag._y;
          if (dragX || dragY) {
            let { left, top, width, height } = src.select;
            let sori = src.scales[xKeySrc].ori;
            let sPosToVal = src.posToVal;
            let sOff, sDim, sc, a, b;
            let matchingX = xKey != null && matchXKeys(xKey, xKeySrc);
            let matchingY = yKey != null && matchYKeys(yKey, yKeySrc);
            if (matchingX && dragX) {
              if (sori == 0) {
                sOff = left;
                sDim = width;
              } else {
                sOff = top;
                sDim = height;
              }
              sc = scales[xKey];
              a = valToPosX(sPosToVal(sOff, xKeySrc), sc, xDim, 0);
              b = valToPosX(sPosToVal(sOff + sDim, xKeySrc), sc, xDim, 0);
              setSelX(min(a, b), abs(b - a));
            } else
              setSelX(0, xDim);
            if (matchingY && dragY) {
              if (sori == 1) {
                sOff = left;
                sDim = width;
              } else {
                sOff = top;
                sDim = height;
              }
              sc = scales[yKey];
              a = valToPosY(sPosToVal(sOff, yKeySrc), sc, yDim, 0);
              b = valToPosY(sPosToVal(sOff + sDim, yKeySrc), sc, yDim, 0);
              setSelY(min(a, b), abs(b - a));
            } else
              setSelY(0, yDim);
          } else
            hideSelect();
        } else {
          let rawDX = abs(rawMouseLeft1 - rawMouseLeft0);
          let rawDY = abs(rawMouseTop1 - rawMouseTop0);
          if (scaleX.ori == 1) {
            let _rawDX = rawDX;
            rawDX = rawDY;
            rawDY = _rawDX;
          }
          dragX = drag.x && rawDX >= drag.dist;
          dragY = drag.y && rawDY >= drag.dist;
          let uni = drag.uni;
          if (uni != null) {
            if (dragX && dragY) {
              dragX = rawDX >= uni;
              dragY = rawDY >= uni;
              if (!dragX && !dragY) {
                if (rawDY > rawDX)
                  dragY = true;
                else
                  dragX = true;
              }
            }
          } else if (drag.x && drag.y && (dragX || dragY))
            dragX = dragY = true;
          let p0, p1;
          if (dragX) {
            if (scaleX.ori == 0) {
              p0 = mouseLeft0;
              p1 = mouseLeft1;
            } else {
              p0 = mouseTop0;
              p1 = mouseTop1;
            }
            setSelX(min(p0, p1), abs(p1 - p0));
            if (!dragY)
              setSelY(0, yDim);
          }
          if (dragY) {
            if (scaleX.ori == 1) {
              p0 = mouseLeft0;
              p1 = mouseLeft1;
            } else {
              p0 = mouseTop0;
              p1 = mouseTop1;
            }
            setSelY(min(p0, p1), abs(p1 - p0));
            if (!dragX)
              setSelX(0, xDim);
          }
          if (!dragX && !dragY) {
            setSelX(0, 0);
            setSelY(0, 0);
          }
        }
      }
      drag._x = dragX;
      drag._y = dragY;
      if (src == null) {
        if (_pub) {
          if (syncKey != null) {
            let [xSyncKey, ySyncKey] = syncOpts.scales;
            syncOpts.values[0] = xSyncKey != null ? posToVal(scaleX.ori == 0 ? mouseLeft1 : mouseTop1, xSyncKey) : null;
            syncOpts.values[1] = ySyncKey != null ? posToVal(scaleX.ori == 1 ? mouseLeft1 : mouseTop1, ySyncKey) : null;
          }
          pubSync(mousemove, self, mouseLeft1, mouseTop1, plotWidCss, plotHgtCss, idx);
        }
        if (cursorFocus) {
          let shouldPub = _pub && syncOpts.setSeries;
          let p = focus.prox;
          if (focusedSeries == null) {
            if (closestDist <= p)
              setSeries(closestSeries, FOCUS_TRUE, true, shouldPub);
          } else {
            if (closestDist > p)
              setSeries(null, FOCUS_TRUE, true, shouldPub);
            else if (closestSeries != focusedSeries)
              setSeries(closestSeries, FOCUS_TRUE, true, shouldPub);
          }
        }
      }
      if (shouldSetLegend) {
        legend.idx = idx;
        setLegend();
      }
      _fire !== false && fire("setCursor");
    }
    let rect2 = null;
    Object.defineProperty(self, "rect", {
      get() {
        if (rect2 == null)
          syncRect(false);
        return rect2;
      }
    });
    function syncRect(defer = false) {
      if (defer)
        rect2 = null;
      else {
        rect2 = over.getBoundingClientRect();
        fire("syncRect", rect2);
      }
    }
    function mouseMove(e, src, _l, _t, _w, _h, _i) {
      if (cursor._lock)
        return;
      if (dragging && e != null && e.movementX == 0 && e.movementY == 0)
        return;
      cacheMouse(e, src, _l, _t, _w, _h, _i, false, e != null);
      if (e != null)
        updateCursor(null, true, true);
      else
        updateCursor(src, true, false);
    }
    function cacheMouse(e, src, _l, _t, _w, _h, _i, initial, snap) {
      if (rect2 == null)
        syncRect(false);
      setCursorEvent(e);
      if (e != null) {
        _l = e.clientX - rect2.left;
        _t = e.clientY - rect2.top;
      } else {
        if (_l < 0 || _t < 0) {
          mouseLeft1 = -10;
          mouseTop1 = -10;
          return;
        }
        let [xKey, yKey] = syncOpts.scales;
        let syncOptsSrc = src.cursor.sync;
        let [xValSrc, yValSrc] = syncOptsSrc.values;
        let [xKeySrc, yKeySrc] = syncOptsSrc.scales;
        let [matchXKeys, matchYKeys] = syncOpts.match;
        let rotSrc = src.axes[0].side % 2 == 1;
        let xDim = scaleX.ori == 0 ? plotWidCss : plotHgtCss, yDim = scaleX.ori == 1 ? plotWidCss : plotHgtCss, _xDim = rotSrc ? _h : _w, _yDim = rotSrc ? _w : _h, _xPos = rotSrc ? _t : _l, _yPos = rotSrc ? _l : _t;
        if (xKeySrc != null)
          _l = matchXKeys(xKey, xKeySrc) ? getPos(xValSrc, scales[xKey], xDim, 0) : -10;
        else
          _l = xDim * (_xPos / _xDim);
        if (yKeySrc != null)
          _t = matchYKeys(yKey, yKeySrc) ? getPos(yValSrc, scales[yKey], yDim, 0) : -10;
        else
          _t = yDim * (_yPos / _yDim);
        if (scaleX.ori == 1) {
          let __l = _l;
          _l = _t;
          _t = __l;
        }
      }
      if (snap && (src == null || src.cursor.event.type == mousemove)) {
        if (_l <= 1 || _l >= plotWidCss - 1)
          _l = incrRound(_l, plotWidCss);
        if (_t <= 1 || _t >= plotHgtCss - 1)
          _t = incrRound(_t, plotHgtCss);
      }
      if (initial) {
        rawMouseLeft0 = _l;
        rawMouseTop0 = _t;
        [mouseLeft0, mouseTop0] = cursor.move(self, _l, _t);
      } else {
        mouseLeft1 = _l;
        mouseTop1 = _t;
      }
    }
    const _hideProps = {
      width: 0,
      height: 0,
      left: 0,
      top: 0
    };
    function hideSelect() {
      setSelect(_hideProps, false);
    }
    let downSelectLeft;
    let downSelectTop;
    let downSelectWidth;
    let downSelectHeight;
    function mouseDown(e, src, _l, _t, _w, _h, _i) {
      dragging = true;
      dragX = dragY = drag._x = drag._y = false;
      cacheMouse(e, src, _l, _t, _w, _h, _i, true, false);
      if (e != null) {
        onMouse(mouseup, doc, mouseUp, false);
        pubSync(mousedown, self, mouseLeft0, mouseTop0, plotWidCss, plotHgtCss, null);
      }
      let { left, top, width, height } = select;
      downSelectLeft = left;
      downSelectTop = top;
      downSelectWidth = width;
      downSelectHeight = height;
    }
    function mouseUp(e, src, _l, _t, _w, _h, _i) {
      dragging = drag._x = drag._y = false;
      cacheMouse(e, src, _l, _t, _w, _h, _i, false, true);
      let { left, top, width, height } = select;
      let hasSelect = width > 0 || height > 0;
      let chgSelect = downSelectLeft != left || downSelectTop != top || downSelectWidth != width || downSelectHeight != height;
      hasSelect && chgSelect && setSelect(select);
      if (drag.setScale && hasSelect && chgSelect) {
        let xOff = left, xDim = width, yOff = top, yDim = height;
        if (scaleX.ori == 1) {
          xOff = top, xDim = height, yOff = left, yDim = width;
        }
        if (dragX) {
          _setScale(
            xScaleKey,
            posToVal(xOff, xScaleKey),
            posToVal(xOff + xDim, xScaleKey)
          );
        }
        if (dragY) {
          for (let k in scales) {
            let sc = scales[k];
            if (k != xScaleKey && sc.from == null && sc.min != inf) {
              _setScale(
                k,
                posToVal(yOff + yDim, k),
                posToVal(yOff, k)
              );
            }
          }
        }
        hideSelect();
      } else if (cursor.lock) {
        cursor._lock = !cursor._lock;
        updateCursor(src, true, e != null);
      }
      if (e != null) {
        offMouse(mouseup, doc);
        pubSync(mouseup, self, mouseLeft1, mouseTop1, plotWidCss, plotHgtCss, null);
      }
    }
    function mouseLeave(e, src, _l, _t, _w, _h, _i) {
      if (cursor._lock)
        return;
      setCursorEvent(e);
      let _dragging = dragging;
      if (dragging) {
        let snapH = true;
        let snapV = true;
        let snapProx = 10;
        let dragH, dragV;
        if (scaleX.ori == 0) {
          dragH = dragX;
          dragV = dragY;
        } else {
          dragH = dragY;
          dragV = dragX;
        }
        if (dragH && dragV) {
          snapH = mouseLeft1 <= snapProx || mouseLeft1 >= plotWidCss - snapProx;
          snapV = mouseTop1 <= snapProx || mouseTop1 >= plotHgtCss - snapProx;
        }
        if (dragH && snapH)
          mouseLeft1 = mouseLeft1 < mouseLeft0 ? 0 : plotWidCss;
        if (dragV && snapV)
          mouseTop1 = mouseTop1 < mouseTop0 ? 0 : plotHgtCss;
        updateCursor(null, true, true);
        dragging = false;
      }
      mouseLeft1 = -10;
      mouseTop1 = -10;
      activeIdxs.fill(null);
      updateCursor(null, true, true);
      if (_dragging)
        dragging = _dragging;
    }
    function dblClick(e, src, _l, _t, _w, _h, _i) {
      if (cursor._lock)
        return;
      setCursorEvent(e);
      autoScaleX();
      hideSelect();
      if (e != null)
        pubSync(dblclick, self, mouseLeft1, mouseTop1, plotWidCss, plotHgtCss, null);
    }
    function syncPxRatio() {
      axes.forEach(syncFontSize);
      _setSize(self.width, self.height, true);
    }
    on(dppxchange, win, syncPxRatio);
    const events = {};
    events.mousedown = mouseDown;
    events.mousemove = mouseMove;
    events.mouseup = mouseUp;
    events.dblclick = dblClick;
    events["setSeries"] = (e, src, idx, opts2) => {
      let seriesIdxMatcher2 = syncOpts.match[2];
      idx = seriesIdxMatcher2(self, src, idx);
      idx != -1 && setSeries(idx, opts2, true, false);
    };
    if (showCursor) {
      onMouse(mousedown, over, mouseDown);
      onMouse(mousemove, over, mouseMove);
      onMouse(mouseenter, over, (e) => {
        setCursorEvent(e);
        syncRect(false);
      });
      onMouse(mouseleave, over, mouseLeave);
      onMouse(dblclick, over, dblClick);
      cursorPlots.add(self);
      self.syncRect = syncRect;
    }
    const hooks = self.hooks = opts.hooks || {};
    function fire(evName, a1, a2) {
      if (deferHooks)
        hooksQueue.push([evName, a1, a2]);
      else {
        if (evName in hooks) {
          hooks[evName].forEach((fn) => {
            fn.call(null, self, a1, a2);
          });
        }
      }
    }
    (opts.plugins || []).forEach((p) => {
      for (let evName in p.hooks)
        hooks[evName] = (hooks[evName] || []).concat(p.hooks[evName]);
    });
    const seriesIdxMatcher = (self2, src, srcSeriesIdx) => srcSeriesIdx;
    const syncOpts = assign({
      key: null,
      setSeries: false,
      filters: {
        pub: retTrue,
        sub: retTrue
      },
      scales: [xScaleKey, series[1] ? series[1].scale : null],
      match: [retEq, retEq, seriesIdxMatcher],
      values: [null, null]
    }, cursor.sync);
    if (syncOpts.match.length == 2)
      syncOpts.match.push(seriesIdxMatcher);
    cursor.sync = syncOpts;
    const syncKey = syncOpts.key;
    const sync = _sync(syncKey);
    function pubSync(type, src, x, y, w, h, i) {
      if (syncOpts.filters.pub(type, src, x, y, w, h, i))
        sync.pub(type, src, x, y, w, h, i);
    }
    sync.sub(self);
    function pub(type, src, x, y, w, h, i) {
      if (syncOpts.filters.sub(type, src, x, y, w, h, i))
        events[type](null, src, x, y, w, h, i);
    }
    self.pub = pub;
    function destroy() {
      sync.unsub(self);
      cursorPlots.delete(self);
      mouseListeners.clear();
      off(dppxchange, win, syncPxRatio);
      root.remove();
      legendTable == null ? void 0 : legendTable.remove();
      fire("destroy");
    }
    self.destroy = destroy;
    function _init() {
      fire("init", opts, data);
      setData(data || opts.data, false);
      if (pendScales[xScaleKey])
        setScale(xScaleKey, pendScales[xScaleKey]);
      else
        autoScaleX();
      shouldSetSelect = select.show && (select.width > 0 || select.height > 0);
      shouldSetCursor = shouldSetLegend = true;
      _setSize(opts.width, opts.height);
    }
    series.forEach(initSeries);
    axes.forEach(initAxis);
    if (then) {
      if (then instanceof HTMLElement) {
        then.appendChild(root);
        _init();
      } else
        then(self, _init);
    } else
      _init();
    return self;
  }
  uPlot.assign = assign;
  uPlot.fmtNum = fmtNum;
  uPlot.rangeNum = rangeNum;
  uPlot.rangeLog = rangeLog;
  uPlot.rangeAsinh = rangeAsinh;
  uPlot.orient = orient;
  uPlot.pxRatio = pxRatio;
  {
    uPlot.join = join;
  }
  {
    uPlot.fmtDate = fmtDate;
    uPlot.tzDate = tzDate;
  }
  uPlot.sync = _sync;
  {
    uPlot.addGap = addGap;
    uPlot.clipGaps = clipGaps;
    let paths = uPlot.paths = {
      points
    };
    paths.linear = linear;
    paths.stepped = stepped;
    paths.bars = bars;
    paths.spline = monotoneCubic;
  }

  // climbing-tracker/components/LineChart.jsx
  var { useEffect: useEffect9, useRef: useRef7 } = React;
  var HEIGHT2 = 220;
  var FONT = "12px -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif";
  function LineChart({ times, values, formatAxis, onCursor }) {
    const ref = useRef7(null);
    const onCursorRef = useRef7(onCursor);
    onCursorRef.current = onCursor;
    useEffect9(() => {
      const el = ref.current;
      const axis = {
        stroke: C.muted,
        font: FONT,
        grid: { stroke: C.border, width: 1 },
        ticks: { show: false }
      };
      const chart = new uPlot({
        width: el.clientWidth,
        height: HEIGHT2,
        padding: [12, 12, 0, 0],
        legend: { show: false },
        cursor: {
          drag: { x: false, y: false },
          points: { size: 10, fill: C.accent, stroke: C.bg, width: 2 }
        },
        scales: { x: { time: true } },
        axes: [
          { ...axis, space: 60 },
          { ...axis, size: 52, values: (u, ticks2) => ticks2.map(formatAxis) }
        ],
        series: [
          {},
          {
            stroke: C.accent,
            width: 2,
            fill: C.accentSoft,
            points: { show: true, size: 6, fill: C.accent, stroke: C.accent }
          }
        ],
        hooks: {
          setCursor: [(u) => {
            var _a, _b;
            return (_b = onCursorRef.current) == null ? void 0 : _b.call(onCursorRef, (_a = u.cursor.idx) != null ? _a : null);
          }]
        }
      }, [times.map((t) => t / 1e3), values], el);
      const resize2 = new ResizeObserver(() => chart.setSize({ width: el.clientWidth, height: HEIGHT2 }));
      resize2.observe(el);
      return () => {
        resize2.disconnect();
        chart.destroy();
      };
    }, [times, values, formatAxis]);
    return /* @__PURE__ */ React.createElement("div", { ref, style: { width: "100%", minHeight: HEIGHT2 } });
  }

  // climbing-tracker/components/ExerciseStatsPage.jsx
  var { useState: useState15, useMemo } = React;
  var shortDate = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  function ExerciseStatsPage({ exercise, history, bodyweight, backLabel, onBack, onEdit, onStart, onNotesChange }) {
    const desktop = useIsDesktop();
    const [range, setRange] = useState15("all");
    const [metricId, setMetricId] = useState15(null);
    const [cursorIdx, setCursorIdx] = useState15(null);
    const allSessions = useMemo(() => collectExerciseSessions(history, exercise), [history, exercise]);
    const sessions = useMemo(() => filterByRange(allSessions, range), [allSessions, range]);
    const metrics = useMemo(() => metricsFor(exercise, bodyweight), [exercise, bodyweight]);
    const metric = metrics.find((m) => m.id === metricId) || metrics[0];
    const records = personalRecords(sessions, metrics);
    const times = useMemo(() => sessions.map((x) => x.time), [sessions]);
    const values = useMemo(() => sessions.map(metric.value), [sessions, metric]);
    const readoutIdx = cursorIdx != null ? cursorIdx : sessions.length - 1;
    const cardStyle = desktop ? { ...s.card, marginBottom: 0 } : s.card;
    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
      Header,
      {
        title: exercise.name,
        subtitle: formatTargetSummary(exercise),
        left: /* @__PURE__ */ React.createElement("button", { style: s.textBtn, onClick: onBack }, /* @__PURE__ */ React.createElement(Icon.back, { size: 20 }), " ", backLabel),
        right: /* @__PURE__ */ React.createElement("button", { style: s.textBtn, onClick: onEdit }, "Edit")
      }
    ), /* @__PURE__ */ React.createElement("div", { style: { ...s.pageWithBottomBar, ...desktop && d.pageWithBottomBar } }, /* @__PURE__ */ React.createElement("div", { style: desktop ? { maxWidth: 560 } : void 0 }, /* @__PURE__ */ React.createElement(ExerciseNotes, { notes: exercise.notes, onSave: onNotesChange })), allSessions.length === 0 ? /* @__PURE__ */ React.createElement(EmptyState, { icon: "chart", title: "No sessions logged yet", text: "Finish a workout with this exercise to start tracking progress." }) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { ...s.segmented, marginBottom: 14, ...desktop && { maxWidth: 360 } } }, RANGES.map((r) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: r.value,
        style: { ...s.segment, ...range === r.value ? s.segmentActive : {} },
        onClick: () => {
          setRange(r.value);
          setCursorIdx(null);
        }
      },
      r.label
    ))), sessions.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: { ...s.card, ...s.hint, marginBottom: 0 } }, "No sessions in this range. Last one was ", shortDate(allSessions[allSessions.length - 1].date), ".") : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { ...s.stats, ...desktop && d.stats } }, /* @__PURE__ */ React.createElement("div", { style: s.stat }, /* @__PURE__ */ React.createElement("div", { style: s.statValue }, sessions.length), /* @__PURE__ */ React.createElement("div", { style: s.statLabel }, "Sessions \xB7 last ", shortDate(sessions[sessions.length - 1].date))), records.map((pr) => /* @__PURE__ */ React.createElement("div", { key: pr.metric.id, style: s.stat }, /* @__PURE__ */ React.createElement("div", { style: s.statValue }, pr.metric.format(pr.value)), /* @__PURE__ */ React.createElement("div", { style: s.statLabel }, pr.metric.label, " \xB7 PR ", shortDate(pr.date))))), /* @__PURE__ */ React.createElement("div", { style: desktop ? d.cardGrid : void 0 }, /* @__PURE__ */ React.createElement("div", { style: cardStyle }, metrics.length > 1 && /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 14 } }, /* @__PURE__ */ React.createElement(
      Segmented,
      {
        options: metrics.map((m) => ({ value: m.id, label: m.label })),
        value: metric.id,
        onChange: (id) => {
          setMetricId(id);
          setCursorIdx(null);
        }
      }
    )), /* @__PURE__ */ React.createElement("div", { style: s.chartReadout }, /* @__PURE__ */ React.createElement("span", { style: s.chartReadoutValue }, metric.format(values[readoutIdx])), /* @__PURE__ */ React.createElement("span", { style: s.chartReadoutDate }, shortDate(sessions[readoutIdx].date))), sessions.length < 2 ? /* @__PURE__ */ React.createElement("div", { style: { ...s.hint, marginBottom: 0 } }, "Log another session to see a trend.") : /* @__PURE__ */ React.createElement(LineChart, { times, values, formatAxis: metric.axis, onCursor: setCursorIdx })), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: s.sectionLabel }, "Sessions"), [...sessions].reverse().map((x) => /* @__PURE__ */ React.createElement("div", { key: x.entryId, style: { ...s.historyCard, padding: "12px 16px" } }, /* @__PURE__ */ React.createElement("div", { style: { ...s.rowTitle, fontSize: 15 } }, shortDate(x.date), x.refName && /* @__PURE__ */ React.createElement("span", { style: s.badge }, x.refName)), x.performed.map((p, i) => /* @__PURE__ */ React.createElement("div", { key: i, style: { ...s.historyStepValue, fontSize: 14, marginTop: 4 } }, formatPerformedSummary({ performed: p })))))))))), /* @__PURE__ */ React.createElement("div", { style: { ...s.bottomBar, ...desktop && d.bottomBar } }, /* @__PURE__ */ React.createElement("button", { style: { ...s.btnPrimary, ...s.btnBlock, minHeight: 54, ...desktop && d.bottomBarBtn }, onClick: onStart }, /* @__PURE__ */ React.createElement(Icon.play, { size: 18 }), " Start exercise")));
  }

  // climbing-tracker/components/ConfirmModal.jsx
  function ConfirmModal({ confirm, onCancel }) {
    if (!confirm) return null;
    return /* @__PURE__ */ React.createElement(Sheet, { title: confirm.title, onClose: onCancel }, /* @__PURE__ */ React.createElement("p", { style: s.sheetMessage }, confirm.message), /* @__PURE__ */ React.createElement("div", { style: s.btnRow }, /* @__PURE__ */ React.createElement("button", { style: { ...s.btnSecondary, flex: 1 }, onClick: onCancel }, "Cancel"), /* @__PURE__ */ React.createElement("button", { style: { ...confirm.tone === "primary" ? s.btnPrimary : s.btnDanger, flex: 1 }, onClick: () => {
      confirm.onConfirm();
      onCancel();
    } }, confirm.confirmLabel || "Delete")));
  }

  // climbing-tracker/components/HistoryEditForm.jsx
  var { useState: useState16 } = React;
  function toLocalInput(iso) {
    const d2 = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d2.getFullYear()}-${pad(d2.getMonth() + 1)}-${pad(d2.getDate())}T${pad(d2.getHours())}:${pad(d2.getMinutes())}`;
  }
  var num = (v) => Number(v) || 0;
  function HistoryEditForm({ entry, onSave, onCancel }) {
    const [date, setDate] = useState16(() => toLocalInput(entry.date));
    const [durationMin, setDurationMin] = useState16(() => entry.durationSec != null ? Math.round(entry.durationSec / 60) : "");
    const [steps, setSteps] = useState16(() => entry.steps.map((step) => ({
      ...step,
      performed: { ...step.performed, ...step.performed.sets && { sets: step.performed.sets.map((x) => ({ ...x })) } }
    })));
    const updatePerformed = (i, patch) => setSteps(steps.map((st, k) => k === i ? { ...st, performed: { ...st.performed, ...patch } } : st));
    const updateSet = (i, j, patch) => updatePerformed(i, { sets: steps[i].performed.sets.map((x, k) => k === j ? { ...x, ...patch } : x) });
    const addSet = (i) => {
      const sets = steps[i].performed.sets;
      updatePerformed(i, { sets: [...sets, { ...sets[sets.length - 1] }] });
    };
    const removeSet = (i, j) => updatePerformed(i, { sets: steps[i].performed.sets.filter((_2, k) => k !== j) });
    const removeStep = (i) => setSteps(steps.filter((_2, k) => k !== i));
    const save = () => {
      const cleaned = steps.map((st) => {
        const p = st.performed;
        if (isIntervalType(p.type)) {
          return { ...st, performed: {
            ...p,
            completedSets: num(p.completedSets),
            targetSets: num(p.targetSets),
            workSec: num(p.workSec),
            restSec: num(p.restSec),
            ...p.type === "weightedInterval" && { weight: num(p.weight) }
          } };
        }
        return { ...st, performed: {
          ...p,
          sets: p.sets.map((x) => p.type === "weighted" ? { reps: num(x.reps), weight: num(x.weight) } : { reps: num(x.reps) })
        } };
      });
      const dateChanged = date !== toLocalInput(entry.date);
      onSave({
        ...entry,
        date: dateChanged && date ? new Date(date).toISOString() : entry.date,
        durationSec: durationMin === "" ? entry.durationSec : Math.round(num(durationMin) * 60),
        steps: cleaned
      });
    };
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: s.field }, /* @__PURE__ */ React.createElement("label", { style: s.label }, "Date"), /* @__PURE__ */ React.createElement("input", { style: { ...s.input, colorScheme: "dark" }, type: "datetime-local", value: date, onChange: (e) => setDate(e.target.value) })), /* @__PURE__ */ React.createElement("div", { style: s.field }, /* @__PURE__ */ React.createElement(NumberField, { label: "Duration", value: durationMin, onChange: setDurationMin, min: 0, suffix: "min" })), steps.map((st, i) => {
      const p = st.performed;
      return /* @__PURE__ */ React.createElement("div", { key: i, style: { ...s.card, padding: 14, marginBottom: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 } }, /* @__PURE__ */ React.createElement("span", { style: { flex: 1, minWidth: 0, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis" } }, st.exerciseName), steps.length > 1 && /* @__PURE__ */ React.createElement("button", { style: { ...s.iconBtn, color: C.danger }, onClick: () => removeStep(i), "aria-label": `Remove ${st.exerciseName}` }, /* @__PURE__ */ React.createElement(Icon.trash, { size: 18 }))), isIntervalType(p.type) ? /* @__PURE__ */ React.createElement("div", { style: { ...s.fieldGrid, marginBottom: 0 } }, /* @__PURE__ */ React.createElement(NumberField, { label: "Sets done", value: p.completedSets, onChange: (v) => updatePerformed(i, { completedSets: v }), min: 0 }), /* @__PURE__ */ React.createElement(NumberField, { label: "Target sets", value: p.targetSets, onChange: (v) => updatePerformed(i, { targetSets: v }), min: 1 }), /* @__PURE__ */ React.createElement(NumberField, { label: "Work", value: p.workSec, onChange: (v) => updatePerformed(i, { workSec: v }), min: 1, suffix: "s" }), /* @__PURE__ */ React.createElement(NumberField, { label: "Rest", value: p.restSec, onChange: (v) => updatePerformed(i, { restSec: v }), min: 0, suffix: "s" }), p.type === "weightedInterval" && /* @__PURE__ */ React.createElement(NumberField, { label: "Weight", value: p.weight, onChange: (v) => updatePerformed(i, { weight: v }), min: 0, step: 0.5, inc: 2.5, suffix: "kg" })) : /* @__PURE__ */ React.createElement(React.Fragment, null, p.sets.map((set2, j) => /* @__PURE__ */ React.createElement("div", { key: j, style: s.setRow }, /* @__PURE__ */ React.createElement("span", { style: s.setIndex }, j + 1), /* @__PURE__ */ React.createElement(SetValueInput, { value: set2.reps, onChange: (v) => updateSet(i, j, { reps: v }), suffix: "reps", label: `${st.exerciseName} set ${j + 1} reps` }), p.type === "weighted" && /* @__PURE__ */ React.createElement(SetValueInput, { value: set2.weight, onChange: (v) => updateSet(i, j, { weight: v }), suffix: "kg", decimal: true, label: `${st.exerciseName} set ${j + 1} weight` }), /* @__PURE__ */ React.createElement("button", { style: s.iconBtn, onClick: () => removeSet(i, j), disabled: p.sets.length <= 1, "aria-label": `Remove set ${j + 1}` }, /* @__PURE__ */ React.createElement(Icon.minus, { size: 18 })))), /* @__PURE__ */ React.createElement("button", { style: { ...s.btnSecondary, ...s.btnSmall, ...s.btnBlock }, onClick: () => addSet(i) }, /* @__PURE__ */ React.createElement(Icon.plus, { size: 18 }), " Add set")));
    }), /* @__PURE__ */ React.createElement("div", { style: { ...s.btnRow, marginTop: 8 } }, /* @__PURE__ */ React.createElement("button", { style: { ...s.btnSecondary, flex: 1 }, onClick: onCancel }, "Cancel"), /* @__PURE__ */ React.createElement("button", { style: { ...s.btnPrimary, flex: 1 }, onClick: save }, "Save")));
  }

  // climbing-tracker/App.jsx
  var { useState: useState17, useEffect: useEffect10, useRef: useRef8 } = React;
  var roundRests = ({ restSec, restAfterSec }) => ({ restSec, restAfterSec });
  var ACTIVE_SESSION_KEY = "climbing-tracker-active-session";
  function readActiveSession() {
    try {
      const saved = JSON.parse(localStorage.getItem(ACTIVE_SESSION_KEY));
      return saved && saved.session && Array.isArray(saved.session.exercises) ? saved : null;
    } catch {
      return null;
    }
  }
  function writeActiveSession(saved) {
    try {
      if (saved) localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(saved));
      else localStorage.removeItem(ACTIVE_SESSION_KEY);
    } catch {
    }
  }
  var TABS = [
    { id: "Plan", label: "Plan", icon: "plan" },
    { id: "Exercises", label: "Exercises", icon: "exercises" },
    { id: "Routines", label: "Routines", icon: "routines" },
    { id: "History", label: "History", icon: "history" },
    { id: "Settings", label: "Settings", icon: "settings" }
  ];
  function ClimbingTrackerApp() {
    var _a;
    const desktop = useIsDesktop();
    const [tab, setTab] = useState17("Plan");
    const [exercises, setExercises] = useStorage(STORAGE_KEYS.exercises, []);
    const [routines, setRoutines] = useStorage(STORAGE_KEYS.routines, []);
    const [history, setHistory] = useStorage(STORAGE_KEYS.history, []);
    const [settings, setSettings] = useStorage(STORAGE_KEYS.settings, {});
    const [plan, setPlan] = useStorage(STORAGE_KEYS.plan, null);
    const [categories, setCategories] = useStorage(STORAGE_KEYS.categories, []);
    const bodyweight = settings.bodyweight > 0 ? settings.bodyweight : null;
    const [restored] = useState17(readActiveSession);
    const [activeSession, setActiveSessionState] = useState17(() => (restored == null ? void 0 : restored.session) || null);
    const [confirm, setConfirm] = useState17(null);
    const requestConfirm = (title, message, onConfirm, confirmLabel, tone) => {
      setConfirm({ title, message, onConfirm, confirmLabel, tone });
    };
    const [formOpen, setFormOpen] = useState17(false);
    const [editingId, setEditingId] = useState17(null);
    const [draft, setDraft] = useState17({ name: "", type: "reps", ...defaultFieldsForType("reps") });
    const openNewExercise = () => {
      setDraft({ name: "", type: "reps", ...defaultFieldsForType("reps") });
      setEditingId(null);
      setFormOpen(true);
    };
    const openEditExercise = (ex) => {
      setDraft({ ...ex });
      setEditingId(ex.id);
      setFormOpen(true);
    };
    const saveExercise = () => {
      if (!draft.name.trim()) return;
      const ex = { ...draft, notes: (draft.notes || "").trim() };
      if (editingId) {
        setExercises(exercises.map((e) => e.id === editingId ? { ...ex, id: editingId } : e));
      } else {
        setExercises([...exercises, { ...ex, id: uid() }]);
      }
      setFormOpen(false);
    };
    const deleteExercise = (id) => {
      setExercises(exercises.filter((e) => e.id !== id));
      setRoutines(routines.map((r) => ({ ...r, steps: r.steps.filter((step) => step.exerciseId !== id) })));
    };
    const addCategory = (name) => {
      const trimmed = name.trim();
      if (!trimmed || categories.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) return false;
      setCategories([...categories, { id: uid(), name: trimmed }]);
      return true;
    };
    const renameCategory = (id, name) => setCategories((prev) => prev.map((c) => c.id === id ? { ...c, name } : c));
    const deleteCategory = (id) => {
      setCategories((prev) => prev.filter((c) => c.id !== id));
      setExercises((prev) => prev.map((e) => e.categoryId === id ? { ...e, categoryId: null } : e));
    };
    const requestDeleteCategory = (c) => {
      const count = exercises.filter((e) => e.categoryId === c.id).length;
      if (count === 0) return deleteCategory(c.id);
      requestConfirm("Delete category?", `"${c.name}" will be removed. Its ${count} exercise${count === 1 ? "" : "s"} become${count === 1 ? "s" : ""} uncategorized.`, () => deleteCategory(c.id));
    };
    const [newCategory, setNewCategory] = useState17("");
    const submitNewCategory = () => {
      if (addCategory(newCategory)) setNewCategory("");
    };
    const [editingRoutineId, setEditingRoutineId] = useState17(null);
    const [statsExerciseId, setStatsExerciseId] = useState17(null);
    const openStats = (id) => {
      setStatsExerciseId(id);
      window.scrollTo(0, 0);
    };
    useEffect10(() => {
      if (routines.some((r) => !Array.isArray(r.steps))) {
        setRoutines(routines.map((r) => Array.isArray(r.steps) ? r : {
          id: r.id,
          name: r.name,
          steps: (r.exerciseIds || []).map((exerciseId) => ({ id: uid(), exerciseId, sets: null, restSec: null, restAfterSec: null }))
        }));
      }
    }, []);
    const createRoutine = () => {
      const r = { id: uid(), name: "", steps: [] };
      setRoutines([...routines, r]);
      setEditingRoutineId(r.id);
    };
    const closeRoutineEditor = () => {
      const r = routines.find((x) => x.id === editingRoutineId);
      if (r && !r.name.trim() && r.steps.length === 0) deleteRoutine(r.id);
      setEditingRoutineId(null);
    };
    const deleteRoutine = (id) => {
      setRoutines(routines.filter((r) => r.id !== id));
      setPlan((p) => p && removeRoutineFromPlan(p, id));
    };
    const [editingDayId, setEditingDayId] = useState17(null);
    const [postSessionDayId, setPostSessionDayId] = useState17(null);
    const updatePlanDays = (mutate) => setPlan((p) => {
      const base = p || emptyPlan();
      return { ...base, days: mutate(base.days) };
    });
    const updateDay = (id, patch) => updatePlanDays((days2) => days2.map((day) => day.id === id ? { ...day, ...patch } : day));
    const moveInList = (list, from, to) => {
      const next = [...list];
      next.splice(to, 0, next.splice(from, 1)[0]);
      return next;
    };
    const categoryDrag = useDragReorder((_2, from, to) => setCategories((prev) => moveInList(prev, from, to)));
    const dayDrag = useDragReorder((_2, from, to) => updatePlanDays((days2) => moveInList(days2, from, to)));
    const createDay = () => {
      const day = newDay();
      updatePlanDays((days2) => [...days2, day]);
      setEditingDayId(day.id);
    };
    const closeDayEditor = () => {
      const day = plan == null ? void 0 : plan.days.find((x) => x.id === editingDayId);
      if (day && !day.title.trim() && !day.description.trim() && day.items.length === 0) deleteDay(day.id);
      setEditingDayId(null);
    };
    const deleteDay = (id) => updatePlanDays((days2) => days2.filter((day) => day.id !== id));
    const toggleDayDone = (id) => {
      const next = toggleDay(plan, id);
      setPlan(next);
      if (allDaysDone(next)) {
        requestConfirm(
          "Start a new cycle?",
          "Every day is done. Untick them all and begin the next cycle?",
          () => setPlan((p) => startNewCycle(p)),
          "Start new cycle",
          "primary"
        );
      }
    };
    const renameRoutine = (id, name) => setRoutines(routines.map((r) => r.id === id ? { ...r, name } : r));
    const addStepToRoutine = (routineId, exerciseId) => {
      if (!exerciseId) return;
      const step = { id: uid(), exerciseId, sets: null, workSec: null, restSec: null, restAfterSec: null, targetSets: null };
      setRoutines(routines.map((r) => r.id === routineId ? { ...r, steps: [...r.steps, step] } : r));
    };
    const updateRoutineStepById = (routineId, stepId, patch) => {
      setRoutines((prev) => prev.map((r) => r.id === routineId ? { ...r, steps: r.steps.map((step) => step.id === stepId ? { ...step, ...patch } : step) } : r));
    };
    const removeFromRoutine = (routineId, idx) => {
      setRoutines(routines.map((r) => r.id === routineId ? { ...r, steps: normalizeSupersets(r.steps.filter((_2, i) => i !== idx)) } : r));
    };
    const toggleSupersetLink = (routineId, idx) => {
      setRoutines(routines.map((r) => {
        if (r.id !== routineId) return r;
        const steps = [...r.steps];
        const a = steps[idx], b = steps[idx + 1];
        if (!a || !b) return r;
        if (a.supersetGroup && a.supersetGroup === b.supersetGroup) {
          const fresh = uid();
          let i = idx + 1;
          for (; i < steps.length && steps[i].supersetGroup === a.supersetGroup; i++) {
            steps[i] = { ...steps[i], supersetGroup: fresh };
          }
          steps[idx] = { ...steps[idx], ...roundRests(steps[i - 1]) };
        } else {
          const group = a.supersetGroup || uid();
          steps[idx] = { ...a, supersetGroup: group };
          const old = b.supersetGroup;
          for (let i = idx + 1; i < steps.length && (i === idx + 1 || old && steps[i].supersetGroup === old); i++) {
            steps[i] = { ...steps[i], supersetGroup: group };
          }
          if (a.supersetGroup && !old) steps[idx + 1] = { ...steps[idx + 1], ...roundRests(a) };
        }
        return { ...r, steps: normalizeSupersets(steps) };
      }));
    };
    const moveInRoutine = (routineId, idx, delta, wholeBlock) => {
      setRoutines(routines.map((r) => {
        if (r.id !== routineId) return r;
        const blocks = groupSteps(r.steps, (step) => step.supersetGroup || null);
        let end = 0;
        const b = blocks.findIndex((block2) => (end += block2.length) > idx);
        if (b < 0) return r;
        const block = blocks[b];
        const clamp2 = (v, max2) => Math.max(0, Math.min(max2, v));
        if (block.length > 1 && !wholeBlock) {
          const k = idx - (end - block.length), j = clamp2(k + delta, block.length - 1);
          if (j === k) return r;
          const rests2 = roundRests(block[block.length - 1]);
          block.splice(j, 0, block.splice(k, 1)[0]);
          block[block.length - 1] = { ...block[block.length - 1], ...rests2 };
        } else {
          const c = clamp2(b + delta, blocks.length - 1);
          if (c === b) return r;
          blocks.splice(c, 0, blocks.splice(b, 1)[0]);
        }
        return { ...r, steps: normalizeSupersets(blocks.flat()) };
      }));
    };
    const sessionLogsRef = useRef8((restored == null ? void 0 : restored.logs) || []);
    const sessionOrderRef = useRef8((restored == null ? void 0 : restored.order) || null);
    const sessionInterRestRef = useRef8((restored == null ? void 0 : restored.interRest) || null);
    const sessionTimerRef = useRef8((restored == null ? void 0 : restored.timer) || null);
    const persistSession = (session = activeSession) => writeActiveSession(session && {
      session,
      logs: sessionLogsRef.current,
      order: sessionOrderRef.current,
      interRest: sessionInterRestRef.current,
      timer: sessionTimerRef.current
    });
    const setActiveSession = (session) => {
      sessionInterRestRef.current = null;
      sessionTimerRef.current = null;
      if (!session) {
        sessionLogsRef.current = [];
        sessionOrderRef.current = null;
      }
      setActiveSessionState(session);
      persistSession(session);
    };
    const startExercise = (ex) => {
      sessionLogsRef.current = [null];
      sessionOrderRef.current = null;
      setActiveSession({ id: uid(), kind: "exercise", refId: ex.id, refName: ex.name, exercises: [ex], startedAt: Date.now() });
    };
    const startRoutine = (r) => {
      const exs = normalizeSupersets(r.steps).map((step) => {
        const ex = exercises.find((e) => e.id === step.exerciseId);
        return ex ? applyRoutineStep(ex, step) : null;
      }).filter(Boolean);
      if (exs.length === 0) return;
      sessionLogsRef.current = exs.map(() => null);
      sessionOrderRef.current = null;
      setActiveSession({ id: uid(), kind: "routine", refId: r.id, refName: r.name || "Untitled routine", exercises: exs, startedAt: Date.now() });
    };
    const cancelSession = () => setActiveSession(null);
    const requestCancelSession = () => {
      const hasProgress = sessionLogsRef.current.some((log) => {
        if (!log) return false;
        if (isIntervalType(log.type)) return (log.completedSets || 0) > 0;
        return (log.rows || []).some((r) => r.done);
      });
      if (hasProgress) {
        requestConfirm("Cancel workout?", "You'll lose any sets you've logged in this session.", cancelSession, "Discard");
      } else {
        cancelSession();
      }
    };
    const handleLogChange = (i, log) => {
      sessionLogsRef.current[i] = log;
      persistSession();
    };
    const handleOrderChange = (order) => {
      sessionOrderRef.current = order;
      persistSession();
    };
    const handleInterRestChange = (rest) => {
      sessionInterRestRef.current = rest;
      persistSession();
    };
    const handleTimerChange = (timer) => {
      sessionTimerRef.current = timer;
      persistSession();
    };
    const finishSession = () => {
      const current2 = activeSession;
      const results = [];
      current2.exercises.forEach((ex, i) => {
        let performed = buildPerformedFromLog(ex, sessionLogsRef.current[i]);
        if (performed && performed.weightMode === "added" && bodyweight) performed = { ...performed, bodyweight };
        if (performed) results.push({ exerciseId: ex.id, exerciseName: ex.name, performed, routineStepId: ex.routineStepId });
      });
      if (results.length > 0) {
        const entry = {
          id: uid(),
          date: (/* @__PURE__ */ new Date()).toISOString(),
          kind: current2.kind,
          refId: current2.refId,
          refName: current2.refName,
          durationSec: Math.round((Date.now() - current2.startedAt) / 1e3),
          steps: results
        };
        setHistory([entry, ...history]);
        const drifts = entry.steps.map((step) => computeTemplateDrift(entry, step, exercises, routines)).filter(Boolean);
        if (drifts.length > 0) setPostSessionDrifts(drifts);
        setPostSessionDayId(dayCompletedBy(plan, history, entry));
      }
      setActiveSession(null);
    };
    const requestFinishSession = () => {
      const { exercises: exs } = activeSession;
      const left = exs.filter((ex, i) => !isStepComplete(ex, sessionLogsRef.current[i])).length;
      const message = left === 0 ? "Everything's done. Save this workout to your history?" : `${left} of ${exs.length} exercise${exs.length === 1 ? " has" : "s have"} sets left. Save what you've logged so far?`;
      requestConfirm("Finish workout?", message, finishSession, "Finish", "primary");
    };
    const [postSessionDrifts, setPostSessionDrifts] = useState17([]);
    const [expandedHistoryId, setExpandedHistoryId] = useState17(null);
    const deleteHistoryEntry = (id) => setHistory(history.filter((h) => h.id !== id));
    const [editingHistoryId, setEditingHistoryId] = useState17(null);
    const saveHistoryEntry = (entry) => {
      setHistory(history.map((h) => h.id === entry.id ? entry : h).sort((a, b) => new Date(b.date) - new Date(a.date)));
      setEditingHistoryId(null);
    };
    const requestDeleteHistoryEntry = (id) => {
      requestConfirm("Delete history entry?", "This workout log will be permanently removed.", () => deleteHistoryEntry(id));
    };
    const clearHistory = () => setHistory([]);
    const requestClearHistory = () => {
      requestConfirm("Clear all history?", "All logged workouts will be permanently deleted. This cannot be undone.", clearHistory, "Clear all");
    };
    const updateExerciseTemplate = (exerciseId, patch) => {
      setExercises((prev) => prev.map((e) => e.id === exerciseId ? { ...e, ...patch } : e));
    };
    const applyDrift = (drift) => {
      if (drift.targetSetsPatch) {
        if (drift.routineStep) {
          updateRoutineStepById(drift.routine.id, drift.routineStep.id, { targetSets: drift.targetSetsPatch });
        } else {
          updateExerciseTemplate(drift.exercise.id, { targetSets: drift.targetSetsPatch });
        }
        return;
      }
      if (Object.keys(drift.routinePatch).length > 0 && drift.routine && drift.routineStep) {
        updateRoutineStepById(drift.routine.id, drift.routineStep.id, drift.routinePatch);
      }
      if (Object.keys(drift.exercisePatch).length > 0) {
        updateExerciseTemplate(drift.exercise.id, drift.exercisePatch);
      }
    };
    const driftKey = (drift) => drift.routineStep ? drift.routineStep.id : drift.exercise.id;
    const applyPostSessionDrift = (drift) => {
      applyDrift(drift);
      setPostSessionDrifts(postSessionDrifts.filter((d2) => driftKey(d2) !== driftKey(drift)));
    };
    const applyAllPostSessionDrifts = () => {
      postSessionDrifts.forEach(applyDrift);
      setPostSessionDrifts([]);
    };
    const fileInputRef = useRef8(null);
    const [transferMode, setTransferMode] = useState17(null);
    const [transferScope, setTransferScope] = useState17("all");
    const [transferText, setTransferText] = useState17("");
    const [copied, setCopied] = useState17(false);
    const [importError, setImportError] = useState17("");
    const [llmCopied, setLlmCopied] = useState17(false);
    const openExport = (scope) => {
      const payload = scope === "all" ? { exercises, routines, history, settings, plan, categories } : { exercises, routines, categories };
      setTransferText(JSON.stringify(payload, null, 2));
      setTransferScope(scope);
      setCopied(false);
      setTransferMode("export");
    };
    const openImport = (scope) => {
      setTransferText("");
      setTransferScope(scope);
      setImportError("");
      setTransferMode("import");
    };
    const copyExport = async () => {
      try {
        await navigator.clipboard.writeText(transferText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2e3);
      } catch {
        const ta = document.querySelector("[data-transfer-text]");
        if (ta) {
          ta.select();
          document.execCommand("copy");
          setCopied(true);
          setTimeout(() => setCopied(false), 2e3);
        }
      }
    };
    const downloadExport = () => {
      const blob = new Blob([transferText], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `climbing-tracker-${transferScope === "all" ? "all" : "exercises-routines"}-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    };
    const commitImport = (data) => {
      if (transferScope === "all") {
        if (Array.isArray(data.exercises)) setExercises(data.exercises);
        if (Array.isArray(data.routines)) setRoutines(data.routines);
        if (Array.isArray(data.history)) setHistory(data.history);
        if (data.settings && typeof data.settings === "object") setSettings(data.settings);
        if (data.plan && typeof data.plan === "object") setPlan(data.plan);
        if (Array.isArray(data.categories)) setCategories(data.categories);
      } else {
        if (Array.isArray(data.categories)) setCategories(mergeById(categories, data.categories));
        if (Array.isArray(data.exercises)) setExercises(mergeById(exercises, data.exercises));
        if (Array.isArray(data.routines)) setRoutines(mergeById(routines, data.routines));
      }
      setTransferMode(null);
      setImportError("");
    };
    const applyImport = (text) => {
      try {
        const data = JSON.parse(stripCodeFence(text || transferText));
        if (transferScope === "all") {
          requestConfirm(
            "Replace all data?",
            "This will overwrite all your exercises, routines, plan, and history with the imported data. This cannot be undone.",
            () => commitImport(data),
            "Replace"
          );
        } else {
          commitImport(data);
        }
      } catch {
        setImportError("Invalid JSON");
      }
    };
    const importFromFile = (e) => {
      var _a2;
      const file = (_a2 = e.target.files) == null ? void 0 : _a2[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target.result;
        setTransferText(text);
        applyImport(text);
      };
      reader.readAsText(file);
      e.target.value = "";
    };
    const copyLlmGuidance = async () => {
      const guidance = buildLlmGuidance(exercises);
      try {
        await navigator.clipboard.writeText(guidance);
        setLlmCopied(true);
        setTimeout(() => setLlmCopied(false), 2e3);
      } catch {
        const ta = document.createElement("textarea");
        ta.value = guidance;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setLlmCopied(true);
        setTimeout(() => setLlmCopied(false), 2e3);
      }
    };
    const rootStyle = { ...s.root, ...desktop && d.root };
    if (activeSession) {
      return /* @__PURE__ */ React.createElement("div", { style: rootStyle }, /* @__PURE__ */ React.createElement("div", { style: desktop ? d.focus : void 0 }, /* @__PURE__ */ React.createElement(
        SessionPage,
        {
          key: activeSession.id || activeSession.startedAt,
          session: activeSession,
          initialLogs: sessionLogsRef.current,
          initialOrder: sessionOrderRef.current,
          initialInterRest: sessionInterRestRef.current,
          initialTimer: sessionTimerRef.current,
          onOrderChange: handleOrderChange,
          onInterRestChange: handleInterRestChange,
          onTimerChange: handleTimerChange,
          notesById: Object.fromEntries(exercises.map((e) => [e.id, e.notes || ""])),
          onCancel: requestCancelSession,
          onLogChange: handleLogChange,
          onFinish: requestFinishSession,
          onNotesChange: (id, notes) => updateExerciseTemplate(id, { notes })
        }
      )), /* @__PURE__ */ React.createElement(ConfirmModal, { confirm, onCancel: () => setConfirm(null) }));
    }
    const editingRoutine = editingRoutineId ? routines.find((r) => r.id === editingRoutineId) : null;
    const editingDay = editingDayId ? plan == null ? void 0 : plan.days.find((x) => x.id === editingDayId) : null;
    const progress = plan ? planProgress(plan, history) : [];
    const postSessionDay = postSessionDayId ? plan == null ? void 0 : plan.days.find((x) => x.id === postSessionDayId && !x.doneAt) : null;
    const closePostSession = () => {
      setPostSessionDrifts([]);
      setPostSessionDayId(null);
    };
    const editingHistoryEntry = editingHistoryId ? history.find((h) => h.id === editingHistoryId) : null;
    const statsExercise = statsExerciseId ? exercises.find((e) => e.id === statsExerciseId) : null;
    const changeTab = (t) => {
      if (editingRoutine) closeRoutineEditor();
      if (editingDay) closeDayEditor();
      setStatsExerciseId(null);
      setTab(t);
      window.scrollTo(0, 0);
    };
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1e3;
    const monthAgo = Date.now() - 30 * 24 * 3600 * 1e3;
    const sessionsThisWeek = history.filter((h) => new Date(h.date).getTime() >= weekAgo).length;
    const sessionsThisMonth = history.filter((h) => new Date(h.date).getTime() >= monthAgo).length;
    const totalTrainingSec = history.reduce((sum2, h) => sum2 + (h.durationSec || 0), 0);
    const addButton = (onClick, label) => /* @__PURE__ */ React.createElement("button", { style: s.iconBtnFilled, onClick, "aria-label": label }, /* @__PURE__ */ React.createElement(Icon.plus, { size: 22 }));
    const pageStyle = { ...s.page, ...desktop && d.page };
    const listStyle = desktop ? d.grid : s.list;
    const cardStyle = desktop ? { ...s.card, marginBottom: 0 } : s.card;
    return /* @__PURE__ */ React.createElement("div", { style: rootStyle }, desktop && /* @__PURE__ */ React.createElement(
      Sidebar,
      {
        tabs: TABS,
        active: tab,
        onChange: changeTab,
        footer: history.length > 0 && /* @__PURE__ */ React.createElement("div", { style: d.sidebarStat }, /* @__PURE__ */ React.createElement("div", { style: { ...s.statValue, fontSize: 22 } }, sessionsThisWeek), /* @__PURE__ */ React.createElement("div", { style: s.statLabel }, "Sessions, last 7 days"))
      }
    ), /* @__PURE__ */ React.createElement("main", { style: desktop ? d.main : void 0 }, editingDay ? /* @__PURE__ */ React.createElement(
      DayEditPage,
      {
        label: dayLabel(plan, plan.days.indexOf(editingDay)),
        day: editingDay,
        routines,
        onBack: closeDayEditor,
        onDelete: () => requestConfirm(
          "Delete day?",
          `Delete ${dayLabel(plan, plan.days.indexOf(editingDay))}? This cannot be undone.`,
          () => {
            deleteDay(editingDay.id);
            setEditingDayId(null);
          }
        ),
        onChange: (patch) => updateDay(editingDay.id, patch),
        onMoveItem: (from, to) => updateDay(editingDay.id, { items: moveInList(editingDay.items, from, to) })
      }
    ) : editingRoutine ? /* @__PURE__ */ React.createElement(
      RoutineEditPage,
      {
        routine: editingRoutine,
        exercises,
        categories,
        onBack: closeRoutineEditor,
        onStart: () => {
          closeRoutineEditor();
          startRoutine(editingRoutine);
        },
        onDelete: () => requestConfirm(
          "Delete routine?",
          `Delete "${editingRoutine.name || "Untitled routine"}"? This cannot be undone.`,
          () => {
            deleteRoutine(editingRoutine.id);
            setEditingRoutineId(null);
          }
        ),
        onRename: (name) => renameRoutine(editingRoutine.id, name),
        onAddStep: (exerciseId) => addStepToRoutine(editingRoutine.id, exerciseId),
        onUpdateStep: (stepId, patch) => updateRoutineStepById(editingRoutine.id, stepId, patch),
        onRemoveStep: (idx) => removeFromRoutine(editingRoutine.id, idx),
        onMoveStep: (idx, delta, wholeBlock) => moveInRoutine(editingRoutine.id, idx, delta, wholeBlock),
        onToggleLink: (idx) => toggleSupersetLink(editingRoutine.id, idx)
      }
    ) : statsExercise ? /* @__PURE__ */ React.createElement(
      ExerciseStatsPage,
      {
        exercise: statsExercise,
        history,
        bodyweight,
        backLabel: tab,
        onBack: () => setStatsExerciseId(null),
        onEdit: () => openEditExercise(statsExercise),
        onStart: () => startExercise(statsExercise),
        onNotesChange: (notes) => updateExerciseTemplate(statsExercise.id, { notes })
      }
    ) : /* @__PURE__ */ React.createElement(React.Fragment, null, tab === "Exercises" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Header, { title: "Exercises", right: exercises.length > 0 && addButton(openNewExercise, "New exercise") }), /* @__PURE__ */ React.createElement("div", { style: pageStyle }, exercises.length === 0 ? /* @__PURE__ */ React.createElement(
      EmptyState,
      {
        icon: "exercises",
        title: "No exercises yet",
        text: "Add hangs, pull-ups, core work \u2014 anything you want to track.",
        action: /* @__PURE__ */ React.createElement("button", { style: s.btnPrimary, onClick: openNewExercise }, /* @__PURE__ */ React.createElement(Icon.plus, { size: 20 }), " New exercise")
      }
    ) : groupByCategory(exercises, categories).map(({ category, exercises: group }) => {
      var _a2, _b;
      return /* @__PURE__ */ React.createElement("div", { key: (_a2 = category == null ? void 0 : category.id) != null ? _a2 : "none" }, categories.length > 0 && /* @__PURE__ */ React.createElement("div", { style: s.sectionLabel }, (_b = category == null ? void 0 : category.name) != null ? _b : "Uncategorized"), /* @__PURE__ */ React.createElement("div", { style: { ...listStyle, marginBottom: 16 } }, group.map((ex) => /* @__PURE__ */ React.createElement("div", { key: ex.id, style: s.row }, /* @__PURE__ */ React.createElement("button", { style: s.rowMain, onClick: () => openStats(ex.id) }, /* @__PURE__ */ React.createElement("div", { style: s.rowTitle }, ex.name), /* @__PURE__ */ React.createElement("div", { style: s.rowMeta }, formatTargetSummary(ex))), /* @__PURE__ */ React.createElement("button", { style: s.playBtn, onClick: () => startExercise(ex), "aria-label": `Start ${ex.name}` }, /* @__PURE__ */ React.createElement(Icon.play, { size: 20 }))))));
    }))), tab === "Routines" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Header, { title: "Routines", right: routines.length > 0 && addButton(createRoutine, "New routine") }), /* @__PURE__ */ React.createElement("div", { style: pageStyle }, routines.length === 0 ? /* @__PURE__ */ React.createElement(
      EmptyState,
      {
        icon: "routines",
        title: "No routines yet",
        text: "Chain exercises into a session with per-set targets and rests.",
        action: /* @__PURE__ */ React.createElement("button", { style: s.btnPrimary, onClick: createRoutine }, /* @__PURE__ */ React.createElement(Icon.plus, { size: 20 }), " New routine")
      }
    ) : /* @__PURE__ */ React.createElement("div", { style: listStyle }, routines.map((r) => {
      const nameOf = (step) => {
        var _a2;
        return (_a2 = exercises.find((e) => e.id === step.exerciseId)) == null ? void 0 : _a2.name;
      };
      const names = r.steps.map(nameOf).filter(Boolean);
      const blocks = groupSteps(r.steps.filter(nameOf), (step) => step.supersetGroup || null).map((block) => block.map(nameOf).join(" + "));
      return /* @__PURE__ */ React.createElement("div", { key: r.id, style: s.row }, /* @__PURE__ */ React.createElement("button", { style: s.rowMain, onClick: () => setEditingRoutineId(r.id) }, /* @__PURE__ */ React.createElement("div", { style: s.rowTitle }, r.name || "Untitled routine"), /* @__PURE__ */ React.createElement("div", { style: s.rowMeta }, names.length === 0 ? "No exercises" : `${names.length} \xB7 ${blocks.join(", ")}`)), /* @__PURE__ */ React.createElement(
        "button",
        {
          style: s.playBtn,
          onClick: () => startRoutine(r),
          disabled: names.length === 0,
          "aria-label": `Start ${r.name || "routine"}`
        },
        /* @__PURE__ */ React.createElement(Icon.play, { size: 20 })
      ));
    })))), tab === "Plan" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Header, { title: "Plan", right: (plan == null ? void 0 : plan.days.length) > 0 && addButton(createDay, "New day") }), /* @__PURE__ */ React.createElement("div", { style: { ...pageStyle, ...desktop && d.pageNarrow } }, !plan || plan.days.length === 0 ? /* @__PURE__ */ React.createElement(
      EmptyState,
      {
        icon: "plan",
        title: "No plan yet",
        text: "Lay out the days of your training week and link routines to each. Tick them off in any order.",
        action: /* @__PURE__ */ React.createElement("button", { style: s.btnPrimary, onClick: createDay }, /* @__PURE__ */ React.createElement(Icon.plus, { size: 20 }), " New day")
      }
    ) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: s.list }, plan.days.map((day, i) => {
      const done = !!day.doneAt;
      const label = dayLabel(plan, i);
      return /* @__PURE__ */ React.createElement("div", { key: day.id, "data-drag-list": "days", style: { ...s.dayCard, ...done && s.dayCardDone } }, /* @__PURE__ */ React.createElement("button", { ...dayDrag.handleProps("days", i), style: { ...s.dragHandle, ...dayDrag.handleProps("days", i).style }, "aria-label": `Reorder ${label}` }, /* @__PURE__ */ React.createElement(Icon.grip, { size: 20 })), /* @__PURE__ */ React.createElement(
        "button",
        {
          style: { ...s.tickBtn, ...done && s.tickBtnDone },
          onClick: () => toggleDayDone(day.id),
          "aria-pressed": done,
          "aria-label": `${label} done`
        },
        /* @__PURE__ */ React.createElement(Icon.check, { size: 22 })
      ), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("button", { style: { ...s.rowMain, width: "100%", padding: "6px 8px 0 4px" }, onClick: () => setEditingDayId(day.id) }, /* @__PURE__ */ React.createElement("div", { style: s.rowTitle }, label), day.description && /* @__PURE__ */ React.createElement("div", { style: s.dayDescription }, day.description)), day.items.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { ...s.dayItems, paddingLeft: 4 } }, day.items.map((item) => {
        var _a2;
        if (!isRoutineItem(item)) {
          return /* @__PURE__ */ React.createElement("div", { key: item.id, style: { ...s.dayItem, ...s.dayItemNote } }, item.text);
        }
        const routine = routines.find((r) => r.id === item.routineId);
        if (!routine) return null;
        const logged = (_a2 = progress[i]) == null ? void 0 : _a2.credited.has(item.id);
        return /* @__PURE__ */ React.createElement("div", { key: item.id, style: s.dayItem }, /* @__PURE__ */ React.createElement("span", { style: { ...s.loggedMark, ...logged && s.loggedMarkDone }, "aria-label": logged ? "Logged this cycle" : "Not logged yet" }, logged && /* @__PURE__ */ React.createElement(Icon.check, { size: 12 })), /* @__PURE__ */ React.createElement("span", { style: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, routine.name || "Untitled routine"), /* @__PURE__ */ React.createElement(
          "button",
          {
            style: s.miniPlay,
            onClick: () => startRoutine(routine),
            disabled: routine.steps.length === 0,
            "aria-label": `Start ${routine.name || "routine"}`
          },
          /* @__PURE__ */ React.createElement(Icon.play, { size: 14 })
        ));
      }))));
    })), (() => {
      const summary = cycleSummary(plan);
      return /* @__PURE__ */ React.createElement("div", { style: { ...s.hint, marginTop: 16, textAlign: "center" } }, "Cycle ", summary.number, " \xB7 started ", new Date(summary.startedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }), summary.avgDays != null ? ` \xB7 avg ${summary.avgDays} days` : "");
    })(), allDaysDone(plan) && /* @__PURE__ */ React.createElement(
      "button",
      {
        style: { ...s.btnPrimary, ...s.btnBlock },
        onClick: () => setPlan(startNewCycle(plan))
      },
      /* @__PURE__ */ React.createElement(Icon.restart, { size: 18 }),
      " Start new cycle"
    )))), tab === "History" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Header, { title: "History" }), /* @__PURE__ */ React.createElement("div", { style: { ...pageStyle, ...desktop && d.pageNarrow } }, history.length === 0 ? /* @__PURE__ */ React.createElement(EmptyState, { icon: "history", title: "Nothing logged yet", text: "Finished workouts show up here." }) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { ...s.stats, ...desktop && d.stats } }, /* @__PURE__ */ React.createElement("div", { style: s.stat }, /* @__PURE__ */ React.createElement("div", { style: s.statValue }, sessionsThisWeek), /* @__PURE__ */ React.createElement("div", { style: s.statLabel }, "Last 7 days")), desktop && /* @__PURE__ */ React.createElement("div", { style: s.stat }, /* @__PURE__ */ React.createElement("div", { style: s.statValue }, sessionsThisMonth), /* @__PURE__ */ React.createElement("div", { style: s.statLabel }, "Last 30 days")), /* @__PURE__ */ React.createElement("div", { style: s.stat }, /* @__PURE__ */ React.createElement("div", { style: s.statValue }, history.length), /* @__PURE__ */ React.createElement("div", { style: s.statLabel }, "Total sessions")), desktop && /* @__PURE__ */ React.createElement("div", { style: s.stat }, /* @__PURE__ */ React.createElement("div", { style: s.statValue }, formatDuration(totalTrainingSec)), /* @__PURE__ */ React.createElement("div", { style: s.statLabel }, "Total time"))), history.map((h) => {
      const expanded = expandedHistoryId === h.id;
      const drifts = h.steps.map((step) => ({ step, drift: computeTemplateDrift(h, step, exercises, routines) })).filter((x) => x.drift);
      return /* @__PURE__ */ React.createElement("div", { key: h.id, style: s.historyCard }, /* @__PURE__ */ React.createElement("button", { style: s.historyHead, onClick: () => setExpandedHistoryId(expanded ? null : h.id), "aria-expanded": expanded }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: s.rowTitle }, /* @__PURE__ */ React.createElement("span", { style: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" } }, h.refName), h.kind === "routine" && /* @__PURE__ */ React.createElement("span", { style: s.badge }, "Routine")), /* @__PURE__ */ React.createElement("div", { style: s.rowMeta }, formatDate(h.date), h.durationSec != null ? ` \xB7 ${formatDuration(h.durationSec)}` : "")), /* @__PURE__ */ React.createElement("span", { style: { color: C.dim, transform: expanded ? "rotate(180deg)" : "none", transition: "transform .2s", display: "flex" } }, /* @__PURE__ */ React.createElement(Icon.chevronDown, { size: 20 }))), (drifts.length > 0 || expanded) && /* @__PURE__ */ React.createElement("div", { style: s.historyBody }, drifts.map(({ step, drift }, i) => /* @__PURE__ */ React.createElement("div", { key: `drift-${i}`, style: { ...s.drift, marginTop: i === 0 ? 0 : 8 } }, /* @__PURE__ */ React.createElement("span", { style: s.driftText }, h.kind === "routine" ? `${step.exerciseName}: ` : "", "differs from template (", formatDriftSummary(drift), ")"), /* @__PURE__ */ React.createElement("button", { style: s.driftBtn, onClick: () => applyDrift(drift) }, "Update"))), expanded && /* @__PURE__ */ React.createElement("div", { style: { ...s.historySteps, ...drifts.length > 0 ? { marginTop: 12 } : {} } }, h.steps.map((step, i) => {
        const exists = exercises.some((e) => e.id === step.exerciseId);
        return /* @__PURE__ */ React.createElement("div", { key: i, style: s.historyStep }, h.kind === "routine" && (exists ? /* @__PURE__ */ React.createElement("button", { style: { ...s.historyStepName, ...s.historyStepLink }, onClick: () => openStats(step.exerciseId) }, step.exerciseName) : /* @__PURE__ */ React.createElement("span", { style: s.historyStepName }, step.exerciseName)), /* @__PURE__ */ React.createElement("span", { style: s.historyStepValue }, formatPerformedSummary(step)));
      }), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", marginTop: 6, marginLeft: -14 } }, h.kind === "exercise" && exercises.some((e) => e.id === h.refId) && /* @__PURE__ */ React.createElement("button", { style: { ...s.textBtn, ...s.btnSmall, marginLeft: 0 }, onClick: () => openStats(h.refId) }, /* @__PURE__ */ React.createElement(Icon.chart, { size: 16 }), " Stats"), /* @__PURE__ */ React.createElement("button", { style: { ...s.textBtn, ...s.btnSmall, marginLeft: 0 }, onClick: () => setEditingHistoryId(h.id) }, /* @__PURE__ */ React.createElement(Icon.pencil, { size: 16 }), " Edit"), /* @__PURE__ */ React.createElement(
        "button",
        {
          style: { ...s.btnDangerText, ...s.btnSmall },
          onClick: () => requestDeleteHistoryEntry(h.id)
        },
        /* @__PURE__ */ React.createElement(Icon.trash, { size: 16 }),
        " Delete entry"
      )))));
    })))), tab === "Settings" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Header, { title: "Settings" }), /* @__PURE__ */ React.createElement("div", { style: pageStyle }, /* @__PURE__ */ React.createElement("div", { style: desktop ? d.settingsGrid : void 0 }, /* @__PURE__ */ React.createElement("div", { style: cardStyle }, /* @__PURE__ */ React.createElement("div", { style: s.sectionTitle }, "Bodyweight"), /* @__PURE__ */ React.createElement("div", { style: s.hint }, 'Used for "BW +" exercises: adds total load to their stats and counts bodyweight in volume. Each workout records the value at the time.'), /* @__PURE__ */ React.createElement(
      NumberField,
      {
        label: "Current bodyweight",
        value: (_a = settings.bodyweight) != null ? _a : "",
        onChange: (v) => setSettings({ ...settings, bodyweight: v === "" ? null : v }),
        min: 0,
        step: 0.1,
        inc: 0.5,
        suffix: "kg"
      }
    )), /* @__PURE__ */ React.createElement("div", { style: cardStyle }, /* @__PURE__ */ React.createElement("div", { style: s.sectionTitle }, "Exercise categories"), /* @__PURE__ */ React.createElement("div", { style: s.hint }, "Group your exercises into sections. Drag to reorder; deleting a category keeps its exercises."), categories.map((c, i) => /* @__PURE__ */ React.createElement("div", { key: c.id, "data-drag-list": "categories", style: s.categoryRow }, /* @__PURE__ */ React.createElement("button", { ...categoryDrag.handleProps("categories", i), style: { ...s.dragHandle, ...categoryDrag.handleProps("categories", i).style }, "aria-label": `Reorder ${c.name}` }, /* @__PURE__ */ React.createElement(Icon.grip, { size: 20 })), /* @__PURE__ */ React.createElement(
      "input",
      {
        style: s.input,
        value: c.name,
        "aria-label": "Category name",
        onChange: (e) => renameCategory(c.id, e.target.value),
        onBlur: (e) => {
          if (!e.target.value.trim()) renameCategory(c.id, "Untitled");
          else renameCategory(c.id, e.target.value.trim());
        },
        onKeyDown: (e) => e.key === "Enter" && e.target.blur()
      }
    ), /* @__PURE__ */ React.createElement("span", { style: s.categoryCount }, exercises.filter((e) => e.categoryId === c.id).length), /* @__PURE__ */ React.createElement("button", { style: s.iconBtn, onClick: () => requestDeleteCategory(c), "aria-label": `Delete ${c.name}` }, /* @__PURE__ */ React.createElement(Icon.trash, { size: 18 })))), /* @__PURE__ */ React.createElement("div", { style: { ...s.categoryRow, marginBottom: 0, marginTop: categories.length ? 12 : 0 } }, /* @__PURE__ */ React.createElement(
      "input",
      {
        style: s.input,
        placeholder: "New category, e.g. Fingers",
        value: newCategory,
        onChange: (e) => setNewCategory(e.target.value),
        onKeyDown: (e) => e.key === "Enter" && submitNewCategory()
      }
    ), /* @__PURE__ */ React.createElement("button", { style: { ...s.btnSecondary, flexShrink: 0 }, onClick: submitNewCategory, disabled: !newCategory.trim() }, "Add"))), /* @__PURE__ */ React.createElement("div", { style: cardStyle }, /* @__PURE__ */ React.createElement("div", { style: s.sectionTitle }, "Generate with AI"), /* @__PURE__ */ React.createElement("div", { style: s.hint }, 'Copy this prompt into an LLM along with what you want (e.g. "a finger-strength routine with dead hangs and weighted pull-ups"), then paste the JSON it gives you into Import below.'), /* @__PURE__ */ React.createElement("button", { style: { ...s.btnSecondary, ...s.btnBlock }, onClick: copyLlmGuidance }, llmCopied ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Icon.check, { size: 18 }), " Copied") : "Copy AI prompt")), /* @__PURE__ */ React.createElement("div", { style: cardStyle }, /* @__PURE__ */ React.createElement("div", { style: s.sectionTitle }, "Exercises & routines"), /* @__PURE__ */ React.createElement("div", { style: s.hint }, "Imported items are added to (or update) your existing ones \u2014 nothing is deleted."), /* @__PURE__ */ React.createElement("div", { style: s.btnRow }, /* @__PURE__ */ React.createElement("button", { style: { ...s.btnSecondary, flex: 1 }, onClick: () => openExport("partial") }, "Export"), /* @__PURE__ */ React.createElement("button", { style: { ...s.btnSecondary, flex: 1 }, onClick: () => openImport("partial") }, "Import"))), /* @__PURE__ */ React.createElement("div", { style: cardStyle }, /* @__PURE__ */ React.createElement("div", { style: s.sectionTitle }, "All data"), /* @__PURE__ */ React.createElement("div", { style: s.hint }, "Full backup including history. Importing replaces everything."), /* @__PURE__ */ React.createElement("div", { style: s.btnRow }, /* @__PURE__ */ React.createElement("button", { style: { ...s.btnSecondary, flex: 1 }, onClick: () => openExport("all") }, "Export"), /* @__PURE__ */ React.createElement("button", { style: { ...s.btnSecondary, flex: 1 }, onClick: () => openImport("all") }, "Import"))), history.length > 0 && /* @__PURE__ */ React.createElement("div", { style: cardStyle }, /* @__PURE__ */ React.createElement("div", { style: s.sectionTitle }, "Danger zone"), /* @__PURE__ */ React.createElement("div", { style: s.hint }, "Permanently delete all ", history.length, " logged workouts."), /* @__PURE__ */ React.createElement("button", { style: { ...s.btnSecondary, ...s.btnBlock, color: C.danger }, onClick: requestClearHistory }, "Clear history"))))))), !desktop && !editingRoutine && !editingDay && !statsExercise && /* @__PURE__ */ React.createElement(TabBar, { tabs: TABS, active: tab, onChange: changeTab }), formOpen && /* @__PURE__ */ React.createElement(Sheet, { title: editingId ? "Edit exercise" : "New exercise", onClose: () => setFormOpen(false) }, /* @__PURE__ */ React.createElement(
      ExerciseForm,
      {
        draft,
        categories,
        onChange: setDraft,
        onSave: saveExercise,
        onDelete: editingId ? () => requestConfirm(
          "Delete exercise?",
          `Delete "${draft.name}"? This also removes it from any routines that use it.`,
          () => {
            deleteExercise(editingId);
            setFormOpen(false);
            setStatsExerciseId(null);
          }
        ) : null
      }
    )), transferMode && /* @__PURE__ */ React.createElement(
      Sheet,
      {
        title: `${transferMode === "export" ? "Export" : "Import"} ${transferScope === "all" ? "all data" : "exercises & routines"}`,
        onClose: () => setTransferMode(null)
      },
      transferMode === "export" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("textarea", { "data-transfer-text": true, style: s.transferArea, value: transferText, readOnly: true, onFocus: (e) => e.target.select() }), /* @__PURE__ */ React.createElement("div", { style: s.btnRow }, /* @__PURE__ */ React.createElement("button", { style: { ...s.btnPrimary, flex: 1 }, onClick: copyExport }, copied ? "Copied!" : "Copy"), /* @__PURE__ */ React.createElement("button", { style: { ...s.btnSecondary, flex: 1 }, onClick: downloadExport }, "Download"))),
      transferMode === "import" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
        "textarea",
        {
          style: s.transferArea,
          value: transferText,
          onChange: (e) => {
            setTransferText(e.target.value);
            setImportError("");
          },
          placeholder: "Paste exported JSON here..."
        }
      ), importError && /* @__PURE__ */ React.createElement("div", { style: s.error }, importError), /* @__PURE__ */ React.createElement("div", { style: s.btnRow }, /* @__PURE__ */ React.createElement("button", { style: { ...s.btnPrimary, flex: 1 }, onClick: () => applyImport(), disabled: !transferText.trim() }, "Apply"), /* @__PURE__ */ React.createElement("button", { style: { ...s.btnSecondary, flex: 1 }, onClick: () => {
        var _a2;
        return (_a2 = fileInputRef.current) == null ? void 0 : _a2.click();
      } }, "From file"), /* @__PURE__ */ React.createElement("input", { ref: fileInputRef, type: "file", accept: ".json,application/json", onChange: importFromFile, style: { display: "none" } })))
    ), editingHistoryEntry && /* @__PURE__ */ React.createElement(Sheet, { title: `Edit ${editingHistoryEntry.refName}`, onClose: () => setEditingHistoryId(null) }, /* @__PURE__ */ React.createElement(HistoryEditForm, { entry: editingHistoryEntry, onSave: saveHistoryEntry, onCancel: () => setEditingHistoryId(null) })), (postSessionDrifts.length > 0 || postSessionDay) && /* @__PURE__ */ React.createElement(Sheet, { title: postSessionDrifts.length > 0 ? "Update templates?" : "Day complete", onClose: closePostSession }, postSessionDay && /* @__PURE__ */ React.createElement("div", { style: { ...s.drift, marginBottom: 12 } }, /* @__PURE__ */ React.createElement("span", { style: s.driftText }, dayLabel(plan, plan.days.indexOf(postSessionDay)), ": all routines done"), /* @__PURE__ */ React.createElement("button", { style: s.driftBtn, onClick: () => {
      toggleDayDone(postSessionDay.id);
      setPostSessionDayId(null);
    } }, "Mark done")), postSessionDrifts.length > 0 && /* @__PURE__ */ React.createElement("p", { style: s.sheetMessage }, "What you just logged differs from the saved targets."), postSessionDrifts.map((drift) => /* @__PURE__ */ React.createElement("div", { key: driftKey(drift), style: s.drift }, /* @__PURE__ */ React.createElement("span", { style: s.driftText }, drift.exercise.name, ": ", formatDriftSummary(drift)), /* @__PURE__ */ React.createElement("button", { style: s.driftBtn, onClick: () => applyPostSessionDrift(drift) }, "Update"))), /* @__PURE__ */ React.createElement("div", { style: { ...s.btnRow, marginTop: 16 } }, postSessionDrifts.length > 1 && /* @__PURE__ */ React.createElement("button", { style: { ...s.btnPrimary, flex: 1 }, onClick: applyAllPostSessionDrifts }, "Update all"), /* @__PURE__ */ React.createElement("button", { style: { ...s.btnSecondary, flex: 1 }, onClick: closePostSession }, "Done"))), /* @__PURE__ */ React.createElement(ConfirmModal, { confirm, onCancel: () => setConfirm(null) }));
  }

  // climbing-tracker-app.jsx
  ReactDOM.createRoot(document.getElementById("app")).render(/* @__PURE__ */ React.createElement(ClimbingTrackerApp, null));
})();
