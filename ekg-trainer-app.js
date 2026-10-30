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

  // ekg-trainer/EcgPaper.jsx
  var { useState: useState2, useRef: useRef2, useMemo, useEffect: useEffect2, useLayoutEffect } = React;
  var MIN_ZOOM = 1;
  var MAX_ZOOM = 4;
  var clampZoom = (z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
  var SPEED = 25;
  var GAIN = 10;
  var LEFT = 10;
  var ROW = 40;
  var TOP = 25;
  var TWELVE_LAYOUT = [
    ["I", "aVR", "V1", "V4"],
    ["II", "aVL", "V2", "V5"],
    ["III", "aVF", "V3", "V6"]
  ];
  function tracePath(samples, fs, from, to, x0, base) {
    const i0 = Math.max(0, Math.round(from * fs));
    const i1 = Math.min(samples.length - 1, Math.round(to * fs));
    let d = "";
    for (let i = i0; i <= i1; i++) {
      const x = x0 + (i - i0) / fs * SPEED;
      const y = base - samples[i] * GAIN;
      d += (i === i0 ? "M" : "L") + x.toFixed(2) + " " + y.toFixed(2);
    }
    return d;
  }
  function layout(twelve, duration, strip) {
    if (!twelve) {
      return strip.map((lead) => ({ segments: [{ lead, from: 0, to: duration, x: LEFT }] }));
    }
    const col = duration / 4;
    const rows = TWELVE_LAYOUT.map((leads) => ({
      segments: leads.map((lead, j) => ({ lead, from: j * col, to: (j + 1) * col, x: LEFT + j * col * SPEED }))
    }));
    rows.push({ segments: [{ lead: "II", from: 0, to: duration, x: LEFT }] });
    return rows;
  }
  function EcgPaper({ signal, twelve, zoom = 1, onZoom, calipers = false }) {
    const { leads, fs, duration, strip } = signal;
    const rows = layout(twelve, duration, strip);
    const width = LEFT + duration * SPEED + 4;
    const height = TOP + (rows.length - 1) * ROW + 18;
    const svgRef = useRef2(null);
    const boxRef = useRef2(null);
    const [measure, setMeasure] = useState2(null);
    const dragPointer = useRef2(null);
    const beforeDrag = useRef2(null);
    const [boxW, setBoxW] = useState2(0);
    useLayoutEffect(() => {
      const box = boxRef.current;
      setBoxW(box.offsetWidth);
      const ro = new ResizeObserver(() => setBoxW(box.offsetWidth));
      ro.observe(box);
      return () => ro.disconnect();
    }, []);
    const baseW = Math.max(boxW, twelve ? 760 : 640);
    const baseH = baseW * height / width;
    const zoomRef = useRef2(zoom);
    const shownZoom = useRef2(zoom);
    const pending = useRef2(null);
    const onZoomRef = useRef2(onZoom);
    onZoomRef.current = onZoom;
    useLayoutEffect(() => {
      const box = boxRef.current;
      const prev = shownZoom.current;
      shownZoom.current = zoom;
      zoomRef.current = zoom;
      let p = pending.current;
      pending.current = null;
      if (!p && prev !== zoom) {
        const cx = box.clientWidth / 2;
        const cy = box.clientHeight / 2;
        p = { left: (box.scrollLeft + cx) * zoom / prev - cx, top: (box.scrollTop + cy) * zoom / prev - cy };
      }
      if (p) {
        box.scrollLeft = p.left;
        box.scrollTop = p.top;
      }
    }, [zoom]);
    const view = useRef2(null);
    view.current = {
      scroll() {
        const box = boxRef.current;
        return pending.current || { left: box.scrollLeft, top: box.scrollTop };
      },
      set(z, left, top) {
        var _a;
        z = clampZoom(z);
        if (z === zoomRef.current) {
          boxRef.current.scrollLeft = left;
          boxRef.current.scrollTop = top;
          return;
        }
        pending.current = { left, top };
        zoomRef.current = z;
        (_a = onZoomRef.current) == null ? void 0 : _a.call(onZoomRef, z);
      },
      cancelDrag() {
        if (dragPointer.current == null) return;
        dragPointer.current = null;
        setMeasure(beforeDrag.current);
      }
    };
    useEffect2(() => {
      const box = boxRef.current;
      let pinch = null;
      function fingers(touches) {
        const r = box.getBoundingClientRect();
        const [a, b] = touches;
        return {
          x: (a.clientX + b.clientX) / 2 - r.left,
          y: (a.clientY + b.clientY) / 2 - r.top,
          d: Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY))
        };
      }
      function start(e) {
        if (e.touches.length !== 2) return;
        e.preventDefault();
        view.current.cancelDrag();
        const f = fingers(e.touches);
        const s = view.current.scroll();
        const z = zoomRef.current;
        pinch = { z, d: f.d, ux: (s.left + f.x) / z, uy: (s.top + f.y) / z };
      }
      function move(e) {
        if (!pinch || e.touches.length !== 2) return;
        e.preventDefault();
        const f = fingers(e.touches);
        const z = clampZoom(pinch.z * f.d / pinch.d);
        view.current.set(z, pinch.ux * z - f.x, pinch.uy * z - f.y);
      }
      function end(e) {
        if (e.touches.length < 2) pinch = null;
      }
      function wheel(e) {
        if (!e.ctrlKey) return;
        e.preventDefault();
        const r = box.getBoundingClientRect();
        const x = e.clientX - r.left;
        const y = e.clientY - r.top;
        const s = view.current.scroll();
        const z0 = zoomRef.current;
        const z = clampZoom(z0 * Math.exp(-e.deltaY * 0.01));
        view.current.set(z, (s.left + x) * z / z0 - x, (s.top + y) * z / z0 - y);
      }
      const stop = (e) => e.preventDefault();
      box.addEventListener("touchstart", start, { passive: false });
      box.addEventListener("touchmove", move, { passive: false });
      box.addEventListener("touchend", end);
      box.addEventListener("touchcancel", end);
      box.addEventListener("wheel", wheel, { passive: false });
      box.addEventListener("gesturestart", stop);
      box.addEventListener("gesturechange", stop);
      return () => {
        box.removeEventListener("touchstart", start);
        box.removeEventListener("touchmove", move);
        box.removeEventListener("touchend", end);
        box.removeEventListener("touchcancel", end);
        box.removeEventListener("wheel", wheel);
        box.removeEventListener("gesturestart", stop);
        box.removeEventListener("gesturechange", stop);
      };
    }, []);
    const traces = useMemo(
      () => rows.map((row, r) => {
        const base = TOP + r * ROW;
        return row.segments.map((s) => ({ ...s, base, d: tracePath(leads[s.lead], fs, s.from, s.to, s.x, base) }));
      }),
      [signal, twelve]
    );
    function toPaper(e) {
      const svg = svgRef.current;
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const p = pt.matrixTransform(svg.getScreenCTM().inverse());
      return { x: p.x, y: p.y };
    }
    const handlers = calipers ? {
      onPointerDown: (e) => {
        if (dragPointer.current != null) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        dragPointer.current = e.pointerId;
        beforeDrag.current = measure;
        const p = toPaper(e);
        setMeasure({ a: p, b: p });
      },
      onPointerMove: (e) => {
        if (e.pointerId !== dragPointer.current) return;
        const p = toPaper(e);
        setMeasure((m) => m ? { ...m, b: p } : m);
      },
      onPointerUp: (e) => {
        if (e.pointerId !== dragPointer.current) return;
        dragPointer.current = null;
        setMeasure((m) => m && Math.abs(m.b.x - m.a.x) < 1 ? null : m);
      },
      onPointerCancel: (e) => {
        if (e.pointerId === dragPointer.current) view.current.cancelDrag();
      }
    } : {};
    let label = null;
    if (measure && Math.abs(measure.b.x - measure.a.x) >= 0.5) {
      const ms = Math.abs(measure.b.x - measure.a.x) / SPEED * 1e3;
      const mv = (measure.a.y - measure.b.y) / GAIN;
      label = `${Math.round(ms)} ms \xB7 ${Math.round(6e4 / ms)} bpm${Math.abs(mv) >= 0.05 ? ` \xB7 ${mv > 0 ? "+" : ""}${mv.toFixed(1)} mV` : ""}`;
    }
    return /* @__PURE__ */ React.createElement("div", { className: "ek-paper-scroll", ref: boxRef, style: boxW ? { height: `${baseH}px` } : void 0 }, /* @__PURE__ */ React.createElement(
      "svg",
      {
        ref: svgRef,
        className: `ek-paper${twelve ? " ek-paper-12" : ""}${calipers ? " ek-calipers" : ""}`,
        viewBox: `0 0 ${width} ${height}`,
        style: boxW ? { width: `${baseW * zoom}px`, height: `${baseH * zoom}px` } : void 0,
        role: "img",
        "aria-label": twelve ? "12-lead ECG" : `Rhythm strip, leads ${strip.join(" and ")}`,
        ...handlers
      },
      /* @__PURE__ */ React.createElement("defs", null, /* @__PURE__ */ React.createElement("pattern", { id: "ek-minor", width: "1", height: "1", patternUnits: "userSpaceOnUse", x: LEFT, y: TOP }, /* @__PURE__ */ React.createElement("path", { d: "M1 0H0V1", fill: "none", stroke: "var(--grid-minor)", strokeWidth: "0.06" })), /* @__PURE__ */ React.createElement("pattern", { id: "ek-major", width: "5", height: "5", patternUnits: "userSpaceOnUse", x: LEFT, y: TOP }, /* @__PURE__ */ React.createElement("rect", { width: "5", height: "5", fill: "url(#ek-minor)" }), /* @__PURE__ */ React.createElement("path", { d: "M5 0H0V5", fill: "none", stroke: "var(--grid-major)", strokeWidth: "0.16" }))),
      /* @__PURE__ */ React.createElement("rect", { width, height, fill: "var(--paper)" }),
      /* @__PURE__ */ React.createElement("rect", { width, height, fill: "url(#ek-major)" }),
      traces.map((row, r) => /* @__PURE__ */ React.createElement("g", { key: r }, /* @__PURE__ */ React.createElement(
        "path",
        {
          d: `M1.5 ${row[0].base}h2v${-GAIN}h5v${GAIN}h1.5`,
          fill: "none",
          stroke: "var(--trace)",
          strokeWidth: "0.3",
          strokeLinejoin: "round"
        }
      ), row.map((s, j) => /* @__PURE__ */ React.createElement("g", { key: s.lead + j }, /* @__PURE__ */ React.createElement("path", { d: s.d, fill: "none", stroke: "var(--trace)", strokeWidth: "0.32", strokeLinejoin: "round" }), j > 0 && /* @__PURE__ */ React.createElement("path", { d: `M${s.x} ${s.base - 4}v8`, stroke: "var(--trace)", strokeWidth: "0.3" }), /* @__PURE__ */ React.createElement("text", { x: s.x + 1.5, y: s.base - 10, className: "ek-lead" }, s.lead))))),
      /* @__PURE__ */ React.createElement("text", { x: width - 2, y: height - 3, textAnchor: "end", className: "ek-scale" }, "25 mm/s \xB7 10 mm/mV"),
      measure && /* @__PURE__ */ React.createElement("g", { className: "ek-measure" }, /* @__PURE__ */ React.createElement("path", { d: `M${measure.a.x} ${measure.a.y - 6}v12M${measure.b.x} ${measure.b.y - 6}v12` }), /* @__PURE__ */ React.createElement("path", { d: `M${measure.a.x} ${measure.a.y}L${measure.b.x} ${measure.b.y}`, strokeDasharray: "1 0.8" }), label && /* @__PURE__ */ React.createElement("text", { x: (measure.a.x + measure.b.x) / 2, y: Math.min(measure.a.y, measure.b.y) - 7, textAnchor: "middle" }, label))
    ));
  }

  // ekg-trainer/cases.js
  var QUESTIONS = [
    {
      id: "rate",
      title: "Rate",
      hint: "300 \xF7 large boxes between R waves, or QRS count in the 10 s strip \xD7 6",
      options: [["slow", "< 60"], ["normal", "60\u2013100"], ["fast", "> 100"]]
    },
    {
      id: "rhythm",
      title: "Rhythm",
      hint: "March out the R\u2013R intervals",
      options: [["regular", "Regular"], ["regIrreg", "Regularly irregular / patterned"], ["irregIrreg", "Irregularly irregular"]]
    },
    {
      id: "p",
      title: "P waves",
      hint: "Look in II and V1",
      options: [
        ["normal", "Normal, one before each QRS"],
        ["more", "More P waves than QRS"],
        ["absent", "Absent / not visible"],
        ["retro", "Inverted / retrograde"],
        ["fib", "Fibrillatory baseline"],
        ["flutter", "Flutter (sawtooth) waves"]
      ]
    },
    {
      id: "pr",
      title: "PR interval",
      hint: "Normal is 3\u20135 small boxes",
      options: [
        ["normal", "Normal (120\u2013200 ms)"],
        ["short", "Short (< 120 ms)"],
        ["long", "Prolonged, fixed (> 200 ms)"],
        ["progressive", "Progressively lengthening"],
        ["variable", "Variable, no relation to QRS"],
        ["na", "Not measurable"]
      ]
    },
    {
      id: "qrs",
      title: "QRS width",
      hint: "3 small boxes = 120 ms",
      options: [["narrow", "Narrow (< 120 ms)"], ["wide", "Wide (\u2265 120 ms)"]]
    },
    {
      id: "axis",
      title: "Axis",
      hint: "Net QRS in I and aVF",
      twelve: true,
      options: [
        ["normal", "Normal (\u221230\xB0 to +90\xB0)"],
        ["left", "Left (\u221230\xB0 to \u221290\xB0)"],
        ["right", "Right (+90\xB0 to +180\xB0)"],
        ["extreme", "Extreme (\u221290\xB0 to \xB1180\xB0)"]
      ]
    },
    {
      id: "st",
      title: "ST segments & T waves",
      hint: "Compare the ST segment with the PR/TP baseline",
      twelve: true,
      options: [
        ["normal", "Normal"],
        ["regional", "ST elevation in one territory"],
        ["diffuse", "Diffuse ST elevation"],
        ["depression", "ST depression / T inversion"],
        ["peaked", "Peaked T waves"],
        ["flatU", "Flat T waves, U waves"],
        ["secondary", "Secondary to wide QRS"]
      ]
    },
    {
      id: "qt",
      title: "QTc",
      hint: "T ending past halfway between R waves = long",
      twelve: true,
      options: [["normal", "Normal"], ["long", "Prolonged"]]
    }
  ];
  var GROUPS = [
    { id: "sinus", title: "Sinus & atrial" },
    { id: "ventricular", title: "Ventricular" },
    { id: "block", title: "AV block" },
    { id: "conduction", title: "Conduction & hypertrophy" },
    { id: "ischaemia", title: "Ischaemia" },
    { id: "metabolic", title: "QT" }
  ];
  var STRIP_GROUPS = /* @__PURE__ */ new Set(["sinus", "ventricular", "block"]);
  var TWELVE_ONLY = new Set(QUESTIONS.filter((q) => q.twelve).map((q) => q.id));
  var DIAGNOSES = [
    {
      id: "nsr",
      group: "sinus",
      label: "Normal sinus rhythm",
      features: ["Rate 60\u2013100, regular", "Upright P wave in II before every QRS, PR 120\u2013200 ms", "Narrow QRS (< 120 ms)"],
      pearl: "Read every ECG the same way \u2014 rate, rhythm, P, PR, QRS, axis, ST/T, QT \u2014 and normal becomes easy to call."
    },
    {
      id: "sinus_brady",
      group: "sinus",
      label: "Sinus bradycardia",
      features: ["Sinus P waves with a normal PR", "Rate < 60"],
      pearl: "Normal in athletes and during sleep. Otherwise think \u03B2-blockers, hypothyroidism, hypothermia, raised ICP, inferior MI."
    },
    {
      id: "sinus_tachy",
      group: "sinus",
      label: "Sinus tachycardia",
      features: ["Sinus P waves before every QRS (may merge into the preceding T at higher rates)", "Rate > 100, usually \u2264 150 at rest"],
      pearl: "Treat the cause: pain, fever, hypovolaemia, PE, anaemia, thyrotoxicosis. A rate fixed at ~150 should make you look for flutter with 2:1 block."
    },
    {
      id: "sinus_arrhythmia",
      group: "sinus",
      label: "Sinus arrhythmia",
      features: ["Identical sinus P waves and PR intervals", "R\u2013R interval varies cyclically (shortens with inspiration)"],
      pearl: "A normal finding, especially in young people."
    },
    {
      id: "pac",
      group: "sinus",
      label: "Premature atrial complexes",
      features: ["Early beat with a P wave of different shape", "Narrow QRS identical to the sinus beats", "Non-compensatory pause \u2014 the sinus node resets"],
      pearl: "Usually benign (caffeine, stress, alcohol). Frequent PACs can herald atrial fibrillation."
    },
    {
      id: "af",
      group: "sinus",
      label: "Atrial fibrillation",
      features: ["Irregularly irregular R\u2013R intervals", "No P waves \u2014 fine or coarse fibrillatory baseline, often best seen in V1", "Narrow QRS"],
      pearl: "Decide on rate vs rhythm control, and score CHA\u2082DS\u2082-VASc for anticoagulation."
    },
    {
      id: "aflutter",
      group: "sinus",
      label: "Atrial flutter",
      features: ["Sawtooth flutter waves at ~300/min \u2014 negative in II, III, aVF, positive in V1", "Fixed block gives a regular rhythm (2:1 \u2192 ~150, 4:1 \u2192 ~75); variable block is irregular"],
      pearl: "A regular narrow tachycardia at ~150 is flutter with 2:1 block until proven otherwise \u2014 hunt for the second flutter wave hidden in the QRS or T."
    },
    {
      id: "svt",
      group: "sinus",
      label: "Supraventricular tachycardia",
      features: ["Regular narrow-complex tachycardia, usually 150\u2013220", "No visible P waves \u2014 in AVNRT the retrograde P hides in or just after the QRS (pseudo-r\u2032 in V1, pseudo-S in II)"],
      pearl: "Vagal manoeuvres (modified Valsalva) first, then adenosine."
    },
    {
      id: "junctional",
      group: "sinus",
      label: "Junctional rhythm",
      features: ["Regular, narrow QRS at 40\u201360", "P waves absent, or inverted in II/III/aVF with a short PR (retrograde activation)"],
      pearl: "An escape rhythm when the sinus node fails \u2014 look for digoxin toxicity, \u03B2-blockers, ischaemia, sick sinus."
    },
    {
      id: "pvc",
      group: "ventricular",
      label: "Premature ventricular complexes",
      features: ["Early wide, bizarre QRS (\u2265 120 ms) with no P wave before it", "ST/T pointing opposite to the PVC's QRS", "Full compensatory pause \u2014 the sinus P that falls inside the PVC isn't conducted"],
      pearl: "Every other beat = bigeminy. If frequent, check K\u207A and Mg\xB2\u207A, look for ischaemia and structural heart disease."
    },
    {
      id: "vt",
      group: "ventricular",
      label: "Ventricular tachycardia",
      features: ["Regular wide-complex tachycardia, usually 120\u2013250", "AV dissociation: P waves march through independently; capture or fusion beats clinch it", "Often extreme axis and concordance across the chest leads"],
      pearl: "Treat any wide-complex tachycardia as VT until proven otherwise. Pulseless \u2192 defibrillate; pulse but unstable \u2192 synchronised cardioversion."
    },
    {
      id: "vf",
      group: "ventricular",
      label: "Ventricular fibrillation",
      features: ["Chaotic deflections of varying amplitude and shape", "No identifiable P waves, QRS complexes or T waves"],
      pearl: "Cardiac arrest: CPR and immediate defibrillation."
    },
    {
      id: "avb1",
      group: "block",
      label: "First-degree AV block",
      features: ["Every P wave is followed by a QRS", "Fixed PR > 200 ms (more than one large box)"],
      pearl: "Usually benign: athletes, AV-nodal blocking drugs, inferior MI."
    },
    {
      id: "mobitz1",
      group: "block",
      label: "Second-degree AV block, Mobitz I (Wenckebach)",
      features: ["PR lengthens beat by beat until a P wave isn't conducted", "The PR after the dropped beat is the shortest", "Grouped beating"],
      pearl: "Block in the AV node \u2014 often benign (high vagal tone, inferior MI)."
    },
    {
      id: "mobitz2",
      group: "block",
      label: "Second-degree AV block, Mobitz II",
      features: ["Constant PR in the conducted beats", "P waves suddenly fail to conduct, with no PR lengthening beforehand", "Often with a bundle branch block (wide QRS)"],
      pearl: "Block below the AV node with a high risk of complete heart block \u2014 needs a pacemaker."
    },
    {
      id: "avb3",
      group: "block",
      label: "Third-degree (complete) AV block",
      features: ["P waves and QRS complexes are completely dissociated \u2014 the PR varies at random", "Atrial rate faster than the ventricular rate, both regular", "Escape rhythm: junctional (narrow, 40\u201360) or ventricular (wide, 20\u201340)"],
      pearl: "Needs pacing. Atropine rarely helps a wide ventricular escape."
    },
    {
      id: "lbbb",
      group: "conduction",
      label: "Left bundle branch block",
      features: ["QRS \u2265 120 ms", "Broad, notched or slurred R in I, aVL, V5\u2013V6 with no septal q waves", "Deep QS or rS in V1\u2013V3", "ST/T discordant \u2014 opposite the main QRS deflection"],
      pearl: "Mnemonic WiLLiaM: W in V1, M in V6. Use the Sgarbossa criteria to look for MI on top of LBBB."
    },
    {
      id: "rbbb",
      group: "conduction",
      label: "Right bundle branch block",
      features: ["QRS \u2265 120 ms", "rSR\u2032 (\u201CM\u201D) in V1\u2013V2", "Wide, slurred S wave in I, aVL, V5\u2013V6", "T inversion in V1\u2013V3 is secondary"],
      pearl: "Mnemonic MaRRoW: M in V1, W in V6. Can be normal; also PE, RV strain, ASD."
    },
    {
      id: "lafb",
      group: "conduction",
      label: "Left anterior fascicular block",
      features: ["Left axis deviation (\u221245\xB0 to \u221290\xB0)", "qR in I and aVL, rS in II, III, aVF", "QRS < 120 ms"],
      pearl: "The commonest cause of left axis deviation. LAFB + RBBB = bifascicular block."
    },
    {
      id: "wpw",
      group: "conduction",
      label: "Wolff-Parkinson-White",
      features: ["Short PR (< 120 ms)", "Delta wave: slurred upstroke at the start of the QRS", "Wide QRS with secondary ST/T changes"],
      pearl: "Accessory pathway. In pre-excited AF avoid AV-nodal blockers (adenosine, verapamil, digoxin, \u03B2-blockers) \u2014 risk of VF."
    },
    {
      id: "lvh",
      group: "conduction",
      label: "Left ventricular hypertrophy",
      features: ["Voltage, e.g. Sokolow-Lyon: S in V1 + R in V5 or V6 \u2265 35 mm, or R in aVL \u2265 11 mm", "\u201CStrain\u201D: asymmetric ST depression and T inversion in I, aVL, V5\u2013V6"],
      pearl: "Hypertension and aortic stenosis. High voltage alone in a young, thin patient can be normal."
    },
    {
      id: "rvh",
      group: "conduction",
      label: "Right ventricular hypertrophy",
      features: ["Right axis deviation (> +90\xB0)", "Dominant R in V1 (R/S > 1), deep S in V5\u2013V6", "RV strain: ST depression / T inversion in V1\u2013V3"],
      pearl: "Pulmonary hypertension, chronic lung disease, pulmonary stenosis, congenital heart disease."
    },
    {
      id: "stemi_inf",
      group: "ischaemia",
      label: "Inferior STEMI",
      features: ["ST elevation in II, III, aVF (III > II suggests the RCA)", "Reciprocal ST depression in aVL (and I)", "Hyperacute T waves"],
      pearl: "Record right-sided leads (V4R) for RV infarction \u2014 avoid nitrates; watch for AV block and bradycardia."
    },
    {
      id: "stemi_ant",
      group: "ischaemia",
      label: "Anterior STEMI",
      features: ["ST elevation in V1\u2013V4 (septal V1\u2013V2, anterior V3\u2013V4)", "Hyperacute T waves", "Culprit: the LAD"],
      pearl: "Elevation across V1\u2013V6 plus I and aVL = extensive anterior MI (proximal LAD)."
    },
    {
      id: "stemi_lat",
      group: "ischaemia",
      label: "Lateral STEMI",
      features: ["ST elevation in I, aVL, V5\u2013V6", "Reciprocal ST depression in III and aVF", "Culprit: circumflex or a diagonal branch"],
      pearl: "Reciprocal inferior depression is what separates a lateral STEMI from pericarditis."
    },
    {
      id: "stemi_post",
      group: "ischaemia",
      label: "Posterior STEMI",
      features: ["Horizontal ST depression in V1\u2013V3 with upright T waves", "Tall, broad R waves in V1\u2013V2 (R/S > 1)", "Confirm with ST elevation in V7\u2013V9"],
      pearl: "ST depression maximal in V1\u2013V3 is posterior STEMI until proven otherwise \u2014 flip the page over and look again."
    },
    {
      id: "long_qt",
      group: "metabolic",
      label: "Long QT",
      features: ["QTc > 470 ms (men) / > 480 ms (women); > 500 ms is high risk", "Quick check: the T wave ends past halfway between consecutive R waves"],
      pearl: "Risk of torsades de pointes. Check drugs (macrolides, antipsychotics, ondansetron, methadone), K\u207A, Mg\xB2\u207A, Ca\xB2\u207A, and congenital LQTS."
    }
  ];
  var DX = Object.fromEntries(DIAGNOSES.map((d) => [d.id, d]));
  var SOURCES = {
    ptbxl: { name: "PTB-XL", url: "https://physionet.org/content/ptb-xl/" },
    sx: { name: "Shaoxing/Ningbo arrhythmia database", url: "https://physionet.org/content/ecg-arrhythmia/" },
    vfdb: { name: "MIT-BIH Malignant Ventricular Ectopy Database", url: "https://physionet.org/content/vfdb/" },
    mitdb: { name: "MIT-BIH Arrhythmia Database", url: "https://physionet.org/content/mitdb/" }
  };
  var BASE = "./ekg-trainer/cases/";
  var indexPromise = null;
  function loadIndex() {
    indexPromise != null ? indexPromise : indexPromise = fetch(`${BASE}index.json`).then((r) => {
      if (!r.ok) throw new Error(`Couldn't load the case list (${r.status})`);
      return r.json();
    }).catch((e) => {
      indexPromise = null;
      throw e;
    });
    return indexPromise;
  }
  var isTwelveLead = (entry) => entry.leads.length === 8;
  function casesFor(index, twelve) {
    return index.filter((e) => {
      var _a;
      return (twelve ? isTwelveLead(e) : STRIP_GROUPS.has((_a = DX[e.dx]) == null ? void 0 : _a.group)) && DX[e.dx];
    });
  }
  function diagnosesFor(index, twelve) {
    const have = new Set(casesFor(index, twelve).map((e) => e.dx));
    return DIAGNOSES.filter((d) => have.has(d.id));
  }
  var caseCounter = 0;
  async function loadCase(entry, twelve) {
    const r = await fetch(`${BASE}${entry.id}.bin`);
    if (!r.ok) throw new Error(`Couldn't load the EKG (${r.status})`);
    const raw = new Int16Array(await r.arrayBuffer());
    const leads = {};
    entry.leads.forEach((name, i) => {
      const out = new Float32Array(entry.n);
      for (let j = 0; j < entry.n; j++) out[j] = raw[i * entry.n + j] / 1e3;
      leads[name] = out;
    });
    if (isTwelveLead(entry)) addDerivedLeads(leads, entry.n);
    const strip = isTwelveLead(entry) ? ["II", "V1"] : entry.leads;
    const ask = QUESTIONS.map((q) => q.id).filter((q) => entry.answers[q] && (twelve || !TWELVE_ONLY.has(q)));
    const f = entry.facts;
    return {
      id: ++caseCounter,
      entry,
      dx: entry.dx,
      twelve,
      signal: { leads, fs: entry.fs, duration: entry.n / entry.fs, strip },
      ask,
      answers: entry.answers,
      facts: { rate: f.hr, atrialRate: f.atrial, pr: f.pr, qrs: f.qrs, axis: f.axis, qt: f.qt, qtc: f.qtc }
    };
  }
  function addDerivedLeads(leads, n) {
    const { I, II } = leads;
    const III = new Float32Array(n), aVR = new Float32Array(n), aVL = new Float32Array(n), aVF = new Float32Array(n);
    for (let j = 0; j < n; j++) {
      III[j] = II[j] - I[j];
      aVR[j] = -(I[j] + II[j]) / 2;
      aVL[j] = I[j] - II[j] / 2;
      aVF[j] = II[j] - I[j] / 2;
    }
    Object.assign(leads, { III, aVR, aVL, aVF });
  }
  function describeSource(entry) {
    const who = [entry.age != null && `${entry.age} y`, entry.sex === "M" ? "male" : entry.sex === "F" ? "female" : null].filter(Boolean).join(", ");
    return `${SOURCES[entry.src].name} \xB7 ${entry.src === "ptbxl" ? "#" : "record "}${entry.ref}${who ? ` \xB7 ${who}` : ""}`;
  }
  function explain(c, qid) {
    var _a;
    const f = c.facts;
    const a = (_a = c.answers[qid]) != null ? _a : [];
    switch (qid) {
      case "rate":
        return `Ventricular rate \u2248 ${f.rate} bpm${f.atrialRate ? `, atrial \u2248 ${f.atrialRate}` : ""}.`;
      case "rhythm":
        return {
          regular: "R\u2013R intervals are constant.",
          regIrreg: "R\u2013R intervals vary, but in a repeating pattern or because of individual early/dropped beats.",
          irregIrreg: "No two R\u2013R intervals are alike and there is no pattern."
        }[a[0]];
      case "p":
        return {
          normal: "Upright in II, same shape each time, one before every (conducted) QRS.",
          more: `P waves${f.atrialRate ? ` at \u2248 ${f.atrialRate}/min` : ""} outnumber the QRS complexes.`,
          absent: "No P waves can be seen before the QRS complexes.",
          retro: "P waves are inverted in II \u2014 the atria are activated from below.",
          fib: "No organised atrial activity \u2014 just an irregular, wavy baseline.",
          flutter: `Regular sawtooth flutter waves${f.atrialRate ? ` at \u2248 ${f.atrialRate}/min` : ""}, clearest in II and V1.`
        }[a[0]];
      case "pr":
        if (a[0] === "progressive") return "The PR grows beat by beat until a P wave isn't conducted.";
        if (a[0] === "na") return "There are no P waves linked to the QRS, so there is no PR interval.";
        if (a[0] === "variable") return "P waves and QRS complexes beat independently, so the PR changes all the time.";
        return f.pr ? `PR \u2248 ${f.pr} ms.` : { normal: "PR 120\u2013200 ms and constant.", short: "PR < 120 ms.", long: "PR > 200 ms and constant." }[a[0]];
      case "qrs":
        return f.qrs ? `QRS \u2248 ${f.qrs} ms.` : a[0] === "wide" ? "QRS \u2265 120 ms." : "QRS < 120 ms.";
      case "axis":
        return `Axis \u2248 ${f.axis}\xB0.`;
      case "st":
        return {
          normal: "ST segments sit on the baseline and T waves follow the QRS.",
          regional: "ST elevation confined to one coronary territory, usually with reciprocal depression.",
          diffuse: "ST elevation across most leads, without a single territory.",
          depression: "ST depression and/or inverted T waves.",
          peaked: "Tall, narrow, symmetrical T waves.",
          flatU: "Low, flat T waves followed by a prominent U wave.",
          secondary: "ST/T changes caused by the abnormal depolarisation, pointing opposite the QRS."
        }[a[0]];
      case "qt":
        return `QT \u2248 ${f.qt} ms, QTc \u2248 ${f.qtc} ms (Bazett).`;
      default:
        return "";
    }
  }

  // ekg-trainer/App.jsx
  var { useState: useState3, useMemo: useMemo2, useEffect: useEffect3, useRef: useRef3 } = React;
  var APP_ID = "ekg-trainer";
  var DEFAULT_SETTINGS = { twelve: true, disabled: [], adaptive: true, flagged: [] };
  var EMPTY_STATS = { cases: 0, dxCorrect: 0, streak: 0, best: 0, perDx: {}, perQ: {} };
  var TABS = [["practice", "Practice"], ["library", "Library"], ["stats", "Stats"]];
  var QUESTION = Object.fromEntries(QUESTIONS.map((q) => [q.id, q]));
  function usableCases(index, settings) {
    var _a;
    const flagged = new Set(((_a = settings.flagged) != null ? _a : []).map((f) => f.id));
    return casesFor(index, settings.twelve).filter((e) => !flagged.has(e.id));
  }
  function poolFor(index, settings) {
    const have = new Set(usableCases(index, settings).map((e) => e.dx));
    const base = diagnosesFor(index, settings.twelve).filter((d) => have.has(d.id));
    const enabled = base.filter((d) => !settings.disabled.includes(d.id));
    return enabled.length ? enabled : base;
  }
  function pickEntry(index, settings, dx, recent) {
    const all = usableCases(index, settings).filter((e) => e.dx === dx);
    const fresh = all.filter((e) => !recent.includes(e.id));
    const from = fresh.length ? fresh : all;
    return from[Math.floor(Math.random() * from.length)];
  }
  function pickDx(pool, stats, adaptive, previous) {
    const options = pool.length > 1 ? pool.filter((d) => d.id !== previous) : pool;
    const weights = options.map((d) => {
      var _a;
      if (!adaptive) return 1;
      const s = (_a = stats.perDx[d.id]) != null ? _a : { seen: 0, correct: 0 };
      return 1 + 3 * (1 - (s.correct + 1) / (s.seen + 2));
    });
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < options.length; i++) {
      r -= weights[i];
      if (r <= 0) return options[i].id;
    }
    return options[options.length - 1].id;
  }
  function pct(correct, seen) {
    return seen ? Math.round(100 * correct / seen) : null;
  }
  function EkgTrainerApp() {
    const [settings, setSettings] = useSyncedStorage(APP_ID, "ekg-trainer-settings", DEFAULT_SETTINGS);
    const [stats, setStats, statsConflict] = useSyncedStorage(APP_ID, "ekg-trainer-stats", EMPTY_STATS);
    const [tab, setTab] = useState3("practice");
    const [index, setIndex] = useState3(null);
    const [loadError, setLoadError] = useState3(null);
    function fetchIndex() {
      setLoadError(null);
      loadIndex().then(setIndex, (e) => setLoadError(e.message));
    }
    useEffect3(fetchIndex, []);
    return /* @__PURE__ */ React.createElement("div", { className: "ek" }, /* @__PURE__ */ React.createElement("header", { className: "ek-header" }, /* @__PURE__ */ React.createElement("a", { className: "ek-back", href: "./", "aria-label": "All apps" }, "\u2039"), /* @__PURE__ */ React.createElement("h1", null, "EKG Trainer"), /* @__PURE__ */ React.createElement("nav", { className: "ek-tabs" }, TABS.map(([id, title]) => /* @__PURE__ */ React.createElement("button", { key: id, className: tab === id ? "on" : "", onClick: () => setTab(id) }, title)))), statsConflict && /* @__PURE__ */ React.createElement("div", { className: "ek-conflict", role: "alert" }, /* @__PURE__ */ React.createElement("span", null, "Your stats changed on another device."), /* @__PURE__ */ React.createElement("button", { onClick: statsConflict.keepRemote }, "Use theirs"), /* @__PURE__ */ React.createElement("button", { onClick: statsConflict.keepLocal }, "Keep mine")), !index ? /* @__PURE__ */ React.createElement("main", { className: "ek-loading" }, loadError ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("p", null, loadError), /* @__PURE__ */ React.createElement("button", { className: "ek-primary", onClick: fetchIndex }, "Try again")) : /* @__PURE__ */ React.createElement("p", { className: "ek-muted" }, "Loading EKGs\u2026")) : /* @__PURE__ */ React.createElement(React.Fragment, null, tab === "practice" && /* @__PURE__ */ React.createElement(Practice, { index, settings, setSettings, stats, setStats }), tab === "library" && /* @__PURE__ */ React.createElement(Library, { index }), tab === "stats" && /* @__PURE__ */ React.createElement(Stats, { index, stats, setStats, settings, setSettings })));
  }
  function Practice({ index, settings, setSettings, stats, setStats }) {
    var _a;
    const pool = poolFor(index, settings);
    const [kase, setKase] = useState3(null);
    const [loading2, setLoading] = useState3(false);
    const [error, setError] = useState3(null);
    const [picks, setPicks] = useState3({});
    const [checked, setChecked] = useState3(false);
    const [showFocus, setShowFocus] = useState3(false);
    const recent = useRef3([]);
    const request = useRef3(0);
    const topRef = useRef3(null);
    const teachRef = useRef3(null);
    async function next(s = settings) {
      var _a2;
      const dx2 = pickDx(poolFor(index, s), stats, s.adaptive, kase == null ? void 0 : kase.dx);
      const entry = pickEntry(index, s, dx2, recent.current);
      const mine = ++request.current;
      setLoading(true);
      setError(null);
      try {
        const k = await loadCase(entry, s.twelve);
        if (mine !== request.current) return;
        recent.current = [...recent.current.filter((id) => id !== entry.id), entry.id].slice(-40);
        setKase(k);
        setPicks({});
        setChecked(false);
        (_a2 = topRef.current) == null ? void 0 : _a2.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (e) {
        if (mine === request.current) setError(e.message);
      } finally {
        if (mine === request.current) setLoading(false);
      }
    }
    useEffect3(() => {
      next();
    }, []);
    function changeSettings(patch) {
      const s = { ...settings, ...patch };
      setSettings(s);
      if ("twelve" in patch) next(s);
    }
    useEffect3(() => {
      if (kase && !checked && !pool.some((d) => d.id === kase.dx)) next();
    }, [settings.disabled]);
    const dxChoices = diagnosesFor(index, settings.twelve);
    const result = useMemo2(() => {
      if (!checked || !kase) return null;
      const perQ = kase.ask.map((q) => ({ q, ok: kase.answers[q].includes(picks[q]) }));
      return { perQ, dxOk: picks.dx === kase.dx, score: perQ.filter((r) => r.ok).length + (picks.dx === kase.dx ? 1 : 0), total: perQ.length + 1 };
    }, [checked, kase, picks]);
    function check() {
      const perQ = kase.ask.map((q) => ({ q, ok: kase.answers[q].includes(picks[q]) }));
      const dxOk = picks.dx === kase.dx;
      setChecked(true);
      setStats((s) => {
        var _a2, _b;
        const d = (_a2 = s.perDx[kase.dx]) != null ? _a2 : { seen: 0, correct: 0 };
        const qs = { ...s.perQ };
        for (const { q, ok } of perQ) {
          const prev = (_b = qs[q]) != null ? _b : { seen: 0, correct: 0 };
          qs[q] = { seen: prev.seen + 1, correct: prev.correct + (ok ? 1 : 0) };
        }
        const streak = dxOk ? s.streak + 1 : 0;
        return {
          ...s,
          cases: s.cases + 1,
          dxCorrect: s.dxCorrect + (dxOk ? 1 : 0),
          streak,
          best: Math.max(s.best, streak),
          perDx: { ...s.perDx, [kase.dx]: { seen: d.seen + 1, correct: d.correct + (dxOk ? 1 : 0) } },
          perQ: qs
        };
      });
    }
    useEffect3(() => {
      var _a2;
      if (checked) (_a2 = teachRef.current) == null ? void 0 : _a2.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, [checked]);
    const choose = (q, v) => !checked && setPicks((p) => ({ ...p, [q]: p[q] === v ? void 0 : v }));
    const flagged = kase && ((_a = settings.flagged) != null ? _a : []).some((f) => f.id === kase.entry.id);
    function toggleFlag() {
      var _a2;
      const rest = ((_a2 = settings.flagged) != null ? _a2 : []).filter((f) => f.id !== kase.entry.id);
      setSettings({ ...settings, flagged: flagged ? rest : [...rest, { id: kase.entry.id, dx: kase.dx, at: (/* @__PURE__ */ new Date()).toISOString() }] });
    }
    if (!kase) {
      return /* @__PURE__ */ React.createElement("main", { className: "ek-loading" }, error ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("p", null, error), /* @__PURE__ */ React.createElement("button", { className: "ek-primary", onClick: () => next() }, "Try again")) : /* @__PURE__ */ React.createElement("p", { className: "ek-muted" }, "Loading EKG\u2026"));
    }
    const dx = DX[kase.dx];
    return /* @__PURE__ */ React.createElement("main", { className: "ek-practice", ref: topRef }, /* @__PURE__ */ React.createElement("div", { className: "ek-toolbar" }, /* @__PURE__ */ React.createElement("div", { className: "ek-segmented", role: "group", "aria-label": "Recording" }, /* @__PURE__ */ React.createElement("button", { className: !settings.twelve ? "on" : "", onClick: () => changeSettings({ twelve: false }) }, "Rhythm strip"), /* @__PURE__ */ React.createElement("button", { className: settings.twelve ? "on" : "", onClick: () => changeSettings({ twelve: true }) }, "12-lead")), /* @__PURE__ */ React.createElement("button", { className: `ek-chip-button${showFocus ? " on" : ""}`, onClick: () => setShowFocus((v) => !v), "aria-expanded": showFocus }, "Pick what to practise", settings.disabled.length ? ` \xB7 ${pool.length}` : ""), /* @__PURE__ */ React.createElement("span", { className: "ek-streak", title: "Correct diagnoses in a row" }, "\u{1F525} ", stats.streak)), showFocus && /* @__PURE__ */ React.createElement(FocusPanel, { index, settings, changeSettings }), /* @__PURE__ */ React.createElement("div", { className: "ek-workspace" }, /* @__PURE__ */ React.createElement("div", { className: "ek-workspace-ecg" }, /* @__PURE__ */ React.createElement(EcgViewer, { key: kase.id, kase })), /* @__PURE__ */ React.createElement("div", { className: "ek-workspace-side" }, /* @__PURE__ */ React.createElement("section", { className: "ek-questions" }, kase.ask.map((qid) => /* @__PURE__ */ React.createElement(
      QuestionBlock,
      {
        key: qid,
        q: QUESTION[qid],
        picked: picks[qid],
        answers: checked ? kase.answers[qid] : null,
        note: checked ? explain(kase, qid) : null,
        onPick: (v) => choose(qid, v)
      }
    )), kase.ask.length === 0 && /* @__PURE__ */ React.createElement("p", { className: "ek-muted ek-small ek-span" }, "No intervals to measure on this one \u2014 go straight to the diagnosis."), /* @__PURE__ */ React.createElement("div", { className: "ek-q ek-span" }, /* @__PURE__ */ React.createElement("div", { className: "ek-q-head" }, /* @__PURE__ */ React.createElement("h3", null, "Diagnosis")), GROUPS.filter((g) => dxChoices.some((d) => d.group === g.id)).map((g) => /* @__PURE__ */ React.createElement("div", { key: g.id, className: "ek-dx-group" }, /* @__PURE__ */ React.createElement("p", { className: "ek-dx-group-title" }, g.title), /* @__PURE__ */ React.createElement("div", { className: "ek-options" }, dxChoices.filter((d) => d.group === g.id).map((d) => /* @__PURE__ */ React.createElement(
      Option,
      {
        key: d.id,
        label: d.label,
        picked: picks.dx === d.id,
        state: checked ? d.id === kase.dx ? "right" : picks.dx === d.id ? "wrong" : "" : "",
        onClick: () => choose("dx", d.id)
      }
    ))))))), checked && /* @__PURE__ */ React.createElement(Teaching, { ref: teachRef, dx, kase, ok: result.dxOk, flagged, onFlag: toggleFlag }))), /* @__PURE__ */ React.createElement("div", { className: "ek-actionbar" }, checked ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { className: "ek-score" }, /* @__PURE__ */ React.createElement("strong", null, result.score, "/", result.total), " correct"), error && /* @__PURE__ */ React.createElement("span", { className: "ek-small ek-error" }, error), /* @__PURE__ */ React.createElement("button", { className: "ek-primary", disabled: loading2, onClick: () => next() }, loading2 ? "Loading\u2026" : "Next EKG \u2192")) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { className: "ek-muted ek-small" }, picks.dx ? "Ready when you are" : "Pick a diagnosis to check"), /* @__PURE__ */ React.createElement("button", { className: "ek-primary", disabled: !picks.dx, onClick: check }, "Check answers"))));
  }
  function EcgViewer({ kase }) {
    const [zoom, setZoom] = useState3(1);
    const [calipers, setCalipers] = useState3(false);
    return /* @__PURE__ */ React.createElement("section", { className: "ek-ecg" }, /* @__PURE__ */ React.createElement(EcgPaper, { signal: kase.signal, twelve: kase.twelve, zoom, onZoom: setZoom, calipers }), /* @__PURE__ */ React.createElement("div", { className: "ek-ecg-tools" }, /* @__PURE__ */ React.createElement("button", { className: `ek-chip-button${calipers ? " on" : ""}`, onClick: () => setCalipers((v) => !v) }, "\u{1F4CF} Calipers"), /* @__PURE__ */ React.createElement("span", { className: "ek-muted ek-small" }, calipers ? "Drag across the paper to measure" : "Pinch to zoom"), /* @__PURE__ */ React.createElement("span", { className: "ek-grow" }), /* @__PURE__ */ React.createElement("button", { className: "ek-icon", onClick: () => setZoom((z) => Math.max(MIN_ZOOM, z - 0.5)), disabled: zoom <= MIN_ZOOM, "aria-label": "Zoom out" }, "\u2212"), /* @__PURE__ */ React.createElement("span", { className: "ek-small ek-zoom" }, zoom.toFixed(1), "\xD7"), /* @__PURE__ */ React.createElement("button", { className: "ek-icon", onClick: () => setZoom((z) => Math.min(MAX_ZOOM, z + 0.5)), disabled: zoom >= MAX_ZOOM, "aria-label": "Zoom in" }, "+")));
  }
  function Option({ label, picked, state, onClick }) {
    return /* @__PURE__ */ React.createElement("button", { className: `ek-option${picked ? " picked" : ""}${state ? ` ${state}` : ""}`, onClick, "aria-pressed": picked }, label);
  }
  function QuestionBlock({ q, picked, answers, note, onPick }) {
    const ok = answers ? answers.includes(picked) : null;
    return /* @__PURE__ */ React.createElement("div", { className: `ek-q${answers ? ok ? " ok" : " bad" : ""}` }, /* @__PURE__ */ React.createElement("div", { className: "ek-q-head" }, /* @__PURE__ */ React.createElement("h3", null, q.title), answers && /* @__PURE__ */ React.createElement("span", { className: `ek-mark ${ok ? "ok" : "bad"}` }, ok ? "\u2713" : picked ? "\u2717" : "\u2013")), !answers && /* @__PURE__ */ React.createElement("p", { className: "ek-hint" }, q.hint), /* @__PURE__ */ React.createElement("div", { className: "ek-options" }, q.options.map(([id, label]) => /* @__PURE__ */ React.createElement(
      Option,
      {
        key: id,
        label,
        picked: picked === id,
        state: answers ? answers.includes(id) ? "right" : picked === id ? "wrong" : "" : "",
        onClick: () => onPick(id)
      }
    ))), note && /* @__PURE__ */ React.createElement("p", { className: "ek-note" }, note));
  }
  var Teaching = React.forwardRef(function Teaching2({ dx, kase, ok, flagged, onFlag }, ref) {
    const f = kase.facts;
    const numbers = [
      f.rate != null && `rate ${f.rate}`,
      typeof f.pr === "number" && `PR ${f.pr} ms`,
      f.qrs != null && `QRS ${f.qrs} ms`,
      kase.twelve && f.axis != null && `axis ${f.axis}\xB0`,
      kase.twelve && f.qtc != null && kase.ask.includes("qt") && `QTc ${f.qtc} ms`
    ].filter(Boolean);
    return /* @__PURE__ */ React.createElement("section", { ref, className: `ek-teach ${ok ? "ok" : "bad"}` }, /* @__PURE__ */ React.createElement("p", { className: "ek-teach-verdict" }, ok ? "Correct!" : "The answer was"), /* @__PURE__ */ React.createElement("h2", null, dx.label, f.note ? /* @__PURE__ */ React.createElement("span", { className: "ek-muted" }, " \u2014 ", f.note) : null), numbers.length > 0 && /* @__PURE__ */ React.createElement("p", { className: "ek-small ek-muted" }, "This tracing: ", numbers.join(" \xB7 ")), /* @__PURE__ */ React.createElement("ul", null, dx.features.map((t) => /* @__PURE__ */ React.createElement("li", { key: t }, t))), /* @__PURE__ */ React.createElement("p", { className: "ek-pearl" }, "\u{1F4A1} ", dx.pearl), /* @__PURE__ */ React.createElement("div", { className: "ek-source" }, /* @__PURE__ */ React.createElement("span", { className: "ek-muted ek-small" }, describeSource(kase.entry)), /* @__PURE__ */ React.createElement("span", { className: "ek-grow" }), /* @__PURE__ */ React.createElement("button", { className: `ek-link ek-flag${flagged ? " on" : ""}`, onClick: onFlag, "aria-pressed": flagged }, flagged ? "\u2691 Flagged \u2014 won't come up again" : "\u2691 Answer looks wrong for this EKG")));
  });
  function FocusPanel({ index, settings, changeSettings }) {
    const base = diagnosesFor(index, settings.twelve);
    const off = new Set(settings.disabled);
    const toggle = (ids, on) => {
      const next = new Set(off);
      for (const id of ids) on ? next.delete(id) : next.add(id);
      changeSettings({ disabled: [...next] });
    };
    return /* @__PURE__ */ React.createElement("section", { className: "ek-focus" }, /* @__PURE__ */ React.createElement("div", { className: "ek-focus-head" }, /* @__PURE__ */ React.createElement("strong", null, "Practise these"), /* @__PURE__ */ React.createElement("span", { className: "ek-grow" }), /* @__PURE__ */ React.createElement("button", { className: "ek-link", onClick: () => toggle(base.map((d) => d.id), true) }, "All"), /* @__PURE__ */ React.createElement("button", { className: "ek-link", onClick: () => toggle(base.map((d) => d.id), false) }, "None")), GROUPS.filter((g) => base.some((d) => d.group === g.id)).map((g) => {
      const ds = base.filter((d) => d.group === g.id);
      const allOn = ds.every((d) => !off.has(d.id));
      return /* @__PURE__ */ React.createElement("div", { key: g.id, className: "ek-focus-group" }, /* @__PURE__ */ React.createElement("label", { className: "ek-check ek-check-group" }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: allOn, onChange: () => toggle(ds.map((d) => d.id), !allOn) }), g.title), /* @__PURE__ */ React.createElement("div", { className: "ek-focus-items" }, ds.map((d) => /* @__PURE__ */ React.createElement("label", { key: d.id, className: "ek-check" }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: !off.has(d.id), onChange: () => toggle([d.id], off.has(d.id)) }), d.label))));
    }), /* @__PURE__ */ React.createElement("label", { className: "ek-check ek-adaptive" }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: settings.adaptive, onChange: () => changeSettings({ adaptive: !settings.adaptive }) }), "Show the ones I get wrong more often"));
  }
  function Library({ index }) {
    const [selected, setSelected] = useState3(null);
    const [kase, setKase] = useState3(null);
    const [error, setError] = useState3(null);
    const shown = useRef3(0);
    async function open2(id, step = 0) {
      const all = index.filter((e) => e.dx === id).sort((a, b) => isTwelveLead(b) - isTwelveLead(a));
      shown.current = id === selected ? (shown.current + step) % all.length : 0;
      const entry = all[shown.current];
      setSelected(id);
      setError(null);
      if (step === 0) window.scrollTo({ top: 0, behavior: "smooth" });
      try {
        setKase(await loadCase(entry, isTwelveLead(entry)));
      } catch (e) {
        setError(e.message);
      }
    }
    const available = new Set(index.map((e) => e.dx));
    const count = (id) => index.filter((e) => e.dx === id).length;
    if (selected) {
      const dx = DX[selected];
      return /* @__PURE__ */ React.createElement("main", { className: "ek-library" }, /* @__PURE__ */ React.createElement("button", { className: "ek-link", onClick: () => (setSelected(null), setKase(null)) }, "\u2039 All diagnoses"), /* @__PURE__ */ React.createElement("h2", { className: "ek-lib-title" }, dx.label), error && /* @__PURE__ */ React.createElement("p", { className: "ek-error" }, error), kase && kase.dx === selected ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("p", { className: "ek-muted ek-small" }, "Example ", shown.current + 1, " of ", count(selected), " \xB7 ", describeSource(kase.entry)), /* @__PURE__ */ React.createElement(EcgViewer, { key: kase.id, kase })) : !error && /* @__PURE__ */ React.createElement("p", { className: "ek-muted" }, "Loading EKG\u2026"), /* @__PURE__ */ React.createElement("section", { className: "ek-teach neutral" }, /* @__PURE__ */ React.createElement("ul", null, dx.features.map((t) => /* @__PURE__ */ React.createElement("li", { key: t }, t))), /* @__PURE__ */ React.createElement("p", { className: "ek-pearl" }, "\u{1F4A1} ", dx.pearl)), count(selected) > 1 && /* @__PURE__ */ React.createElement("button", { className: "ek-primary ek-another", onClick: () => open2(selected, 1) }, "Next example"));
    }
    return /* @__PURE__ */ React.createElement("main", { className: "ek-library" }, /* @__PURE__ */ React.createElement("p", { className: "ek-muted ek-intro" }, "Every diagnosis the trainer covers, with the features to look for. All examples are real patient recordings."), GROUPS.map((g) => {
      const ds = Object.values(DX).filter((d) => d.group === g.id && available.has(d.id));
      if (!ds.length) return null;
      return /* @__PURE__ */ React.createElement("section", { key: g.id, className: "ek-lib-group" }, /* @__PURE__ */ React.createElement("h3", null, g.title), /* @__PURE__ */ React.createElement("div", { className: "ek-lib-list" }, ds.map((d) => /* @__PURE__ */ React.createElement("button", { key: d.id, className: "ek-lib-item", onClick: () => open2(d.id) }, /* @__PURE__ */ React.createElement("span", { className: "ek-lib-name" }, d.label), /* @__PURE__ */ React.createElement("span", { className: "ek-muted ek-small" }, d.features[0])))));
    }), /* @__PURE__ */ React.createElement(Credits, null));
  }
  function Credits() {
    return /* @__PURE__ */ React.createElement("p", { className: "ek-muted ek-small ek-credits" }, "Recordings from", " ", Object.values(SOURCES).map((s, i, all) => /* @__PURE__ */ React.createElement(React.Fragment, { key: s.url }, /* @__PURE__ */ React.createElement("a", { href: s.url, target: "_blank", rel: "noreferrer" }, s.name), i < all.length - 2 ? ", " : i === all.length - 2 ? " and " : "")), " ", "on PhysioNet (CC BY 4.0 / ODC-By), filtered for display. Answers come from the databases' labels and machine measurements, so the occasional one may be off \u2014 flag it.");
  }
  function Stats({ index, stats, setStats, settings, setSettings }) {
    var _a;
    const [confirmReset, setConfirmReset] = useState3(false);
    const flagged = (_a = settings.flagged) != null ? _a : [];
    const rows = Object.values(DX).map((d) => {
      var _a2;
      return { d, s: (_a2 = stats.perDx[d.id]) != null ? _a2 : { seen: 0, correct: 0 } };
    }).filter((r) => r.s.seen > 0).sort((a, b) => a.s.correct / a.s.seen - b.s.correct / b.s.seen || b.s.seen - a.s.seen);
    const flaggedCard = flagged.length > 0 && /* @__PURE__ */ React.createElement("section", { className: "ek-card" }, /* @__PURE__ */ React.createElement("h3", null, "Flagged EKGs ", /* @__PURE__ */ React.createElement("span", { className: "ek-muted ek-small" }, "left out of practice")), flagged.map((f) => {
      var _a2, _b;
      const entry = index.find((e) => e.id === f.id);
      return /* @__PURE__ */ React.createElement("div", { key: f.id, className: "ek-flagged" }, /* @__PURE__ */ React.createElement("span", null, (_b = (_a2 = DX[f.dx]) == null ? void 0 : _a2.label) != null ? _b : f.dx, /* @__PURE__ */ React.createElement("span", { className: "ek-muted ek-small" }, " \xB7 ", entry ? describeSource(entry) : f.id)), /* @__PURE__ */ React.createElement("button", { className: "ek-link", onClick: () => setSettings({ ...settings, flagged: flagged.filter((x) => x.id !== f.id) }) }, "Unflag"));
    }));
    if (!stats.cases) {
      return /* @__PURE__ */ React.createElement("main", { className: "ek-stats" }, /* @__PURE__ */ React.createElement("p", { className: "ek-muted ek-intro" }, "No EKGs checked yet. Your accuracy per diagnosis and per step shows up here once you've done a few."), flaggedCard);
    }
    return /* @__PURE__ */ React.createElement("main", { className: "ek-stats" }, /* @__PURE__ */ React.createElement("div", { className: "ek-tiles" }, /* @__PURE__ */ React.createElement(Tile, { value: stats.cases, label: "EKGs read" }), /* @__PURE__ */ React.createElement(Tile, { value: `${pct(stats.dxCorrect, stats.cases)}%`, label: "Diagnosis correct" }), /* @__PURE__ */ React.createElement(Tile, { value: stats.streak, label: "Current streak" }), /* @__PURE__ */ React.createElement(Tile, { value: stats.best, label: "Best streak" })), /* @__PURE__ */ React.createElement("section", { className: "ek-card" }, /* @__PURE__ */ React.createElement("h3", null, "By step"), QUESTIONS.filter((q) => stats.perQ[q.id]).map((q) => {
      const s = stats.perQ[q.id];
      return /* @__PURE__ */ React.createElement(Bar, { key: q.id, label: q.title, correct: s.correct, seen: s.seen });
    })), /* @__PURE__ */ React.createElement("section", { className: "ek-card" }, /* @__PURE__ */ React.createElement("h3", null, "By diagnosis ", /* @__PURE__ */ React.createElement("span", { className: "ek-muted ek-small" }, "weakest first")), rows.map(({ d, s }) => /* @__PURE__ */ React.createElement(Bar, { key: d.id, label: d.label, correct: s.correct, seen: s.seen }))), flaggedCard, /* @__PURE__ */ React.createElement(
      "button",
      {
        className: `ek-reset${confirmReset ? " armed" : ""}`,
        onClick: () => confirmReset ? (setStats(EMPTY_STATS), setConfirmReset(false)) : setConfirmReset(true),
        onBlur: () => setConfirmReset(false)
      },
      confirmReset ? "Tap again to reset all stats" : "Reset stats"
    ));
  }
  function Tile({ value, label }) {
    return /* @__PURE__ */ React.createElement("div", { className: "ek-tile" }, /* @__PURE__ */ React.createElement("span", { className: "ek-tile-value" }, value), /* @__PURE__ */ React.createElement("span", { className: "ek-muted ek-small" }, label));
  }
  function Bar({ label, correct, seen }) {
    const p = pct(correct, seen);
    return /* @__PURE__ */ React.createElement("div", { className: "ek-bar" }, /* @__PURE__ */ React.createElement("span", { className: "ek-bar-label" }, label), /* @__PURE__ */ React.createElement("span", { className: "ek-bar-track" }, /* @__PURE__ */ React.createElement("span", { className: "ek-bar-fill", style: { width: `${p}%` } })), /* @__PURE__ */ React.createElement("span", { className: "ek-bar-num" }, p, "% ", /* @__PURE__ */ React.createElement("span", { className: "ek-muted" }, "(", correct, "/", seen, ")")));
  }

  // ekg-trainer-app.jsx
  ReactDOM.createRoot(document.getElementById("app")).render(/* @__PURE__ */ React.createElement(EkgTrainerApp, null));
})();
