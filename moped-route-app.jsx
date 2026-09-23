import { planRoute, checkRoute, locateStops } from "./moped-route/plan.js";
import { readSharedRoute, extractUrl } from "./moped-route/share.js";
import { autocomplete, placeLocation } from "./moped-route/google.js";

const { useState, useEffect, useRef, useMemo } = React;

const KEYS = {
  apiKey: "moped-route:apiKey",
  maxSpeed: "moped-route:maxSpeed",
  maxWaypoints: "moped-route:maxWaypoints",
  mode: "moped-route:mode",
};
const MAX_WAYPOINTS_LIMIT = 30;
const COORD_RE = /^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/;

function useLocalStorage(key, fallback) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable - setting lasts for this visit only */
    }
  }, [key, value]);
  return [value, setValue];
}

function newSessionToken() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const km = (m) => `${(m / 1000).toFixed(1)} km`;
const minutes = (s) => `${Math.round(s / 60)} min`;

function PlaceInput({ label, value, onChange, apiKey, withMyLocation }) {
  const [text, setText] = useState(value?.label ?? "");
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const session = useRef(newSessionToken());
  const lastQuery = useRef("");
  const typing = useRef(false);

  // Follow outside changes (swap, my location) but not our own edits.
  useEffect(() => {
    if (value) setText(value.label);
    else if (!typing.current) setText("");
    typing.current = false;
  }, [value]);

  useEffect(() => {
    const q = text.trim();
    if (!apiKey || q.length < 3 || q === value?.label || COORD_RE.test(q)) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      lastQuery.current = q;
      try {
        const results = await autocomplete(apiKey, q, session.current);
        if (lastQuery.current === q) setSuggestions(results);
      } catch {
        setSuggestions([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [text, apiKey]);

  const pick = async (s) => {
    setOpen(false);
    setText(s.label);
    setBusy(true);
    try {
      const point = await placeLocation(apiKey, s.placeId, session.current);
      onChange({ label: s.main, point });
    } catch (err) {
      console.error(err);
      onChange(null);
    } finally {
      session.current = newSessionToken();
      setBusy(false);
    }
  };

  const onInput = (e) => {
    const t = e.target.value;
    typing.current = true;
    setText(t);
    setOpen(true);
    const m = t.match(COORD_RE);
    onChange(m ? { label: t, point: [parseFloat(m[1]), parseFloat(m[2])] } : null);
  };

  const myLocation = () => {
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false);
        onChange({ label: "My location", point: [pos.coords.latitude, pos.coords.longitude] });
      },
      () => setBusy(false),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  return (
    <div className="place">
      <label className="field-label">{label}</label>
      <div className="place-row">
        <input
          className="input"
          value={text}
          onChange={onInput}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search a place or paste lat,lng"
          autoComplete="off"
        />
        {withMyLocation && navigator.geolocation && (
          <button type="button" className="icon-btn" onClick={myLocation} title="Use my location" aria-label="Use my location">
            ◎
          </button>
        )}
      </div>
      {busy && <div className="hint">Locating…</div>}
      {open && suggestions.length > 0 && (
        <ul className="suggestions">
          {suggestions.map((s) => (
            <li key={s.placeId}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s)}>
                <span className="s-main">{s.main}</span>
                <span className="s-sec">{s.secondary}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Leaflet map. lines: [{ points, kind: "osm" | "google" | "bad", tooltip }],
// markers: [{ point, kind: "start" | "end" | "stop" | "waypoint", tooltip }].
function RouteMap({ lines, markers }) {
  const el = useRef(null);
  useEffect(() => {
    const L = window.L;
    if (!L || !el.current) return;
    const map = L.map(el.current, { zoomControl: true, attributionControl: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);

    const css = getComputedStyle(document.documentElement);
    const color = (name) => css.getPropertyValue(name).trim();
    const LINE_STYLES = {
      osm: { color: color("--route-osm"), weight: 8, opacity: 0.45 },
      google: { color: color("--route-google"), weight: 3.5, opacity: 0.95 },
      bad: { color: color("--bad"), weight: 7, opacity: 0.9 },
    };
    const MARKER_FILLS = { start: "#16a34a", end: "#111", stop: "#6b21a8", waypoint: color("--accent") };

    const bounds = L.latLngBounds([]);
    for (const line of lines) {
      if (line.points.length < 2) continue;
      const pl = L.polyline(line.points, LINE_STYLES[line.kind]).addTo(map);
      if (line.tooltip) pl.bindTooltip(line.tooltip);
      if (line.kind !== "bad") bounds.extend(pl.getBounds());
    }
    for (const m of markers) {
      const big = m.kind !== "waypoint";
      const marker = L.circleMarker(m.point, {
        radius: big ? 8 : 7,
        color: "#fff",
        weight: big ? 3 : 2,
        fillColor: MARKER_FILLS[m.kind],
        fillOpacity: 1,
      }).addTo(map);
      if (m.tooltip) marker.bindTooltip(m.tooltip);
    }
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24] });
    return () => map.remove();
  }, [lines, markers]);
  return <div ref={el} className="map" />;
}

function Legend({ items }) {
  const swatches = {
    osm: <i style={{ background: "var(--route-osm)", opacity: 0.5 }} />,
    google: <i style={{ background: "var(--route-google)" }} />,
    bad: <i style={{ background: "var(--bad)" }} />,
    waypoint: <i className="dot" style={{ background: "var(--accent)" }} />,
    stop: <i className="dot" style={{ background: "#6b21a8" }} />,
  };
  return (
    <div className="legend">
      {items.map(([kind, label]) => (
        <span key={kind}>
          {swatches[kind]} {label}
        </span>
      ))}
    </div>
  );
}

function stopMarkers(stops) {
  return stops.map((s, i) => ({
    point: s.point,
    kind: i === 0 ? "start" : i === stops.length - 1 ? "end" : "stop",
    tooltip: s.label,
  }));
}

function Stretches({ stretches }) {
  return (
    <ul className="stretches">
      {stretches.map((s, i) => (
        <li key={i}>
          <span className="limit">{Math.round(s.limit)}</span>
          <span>
            {s.name}
            {s.assumed && (
              <span className="assumed" title="No limit tagged in OpenStreetMap; assumed from the road type">
                {" "}
                (assumed)
              </span>
            )}
          </span>
          <span className="muted">{Math.round(s.length)} m</span>
        </li>
      ))}
    </ul>
  );
}

function LinkButtons({ link, label }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this link", link);
    }
  };
  return (
    <div className="actions">
      <a className="btn primary" href={link} target="_blank" rel="noopener">
        {label}
      </a>
      <button type="button" className="btn" onClick={copy}>
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}

function tripLabel(stops) {
  const middle = stops.length - 2;
  return `${stops[0].label} → ${stops[stops.length - 1].label}` + (middle > 0 ? ` (${middle} stop${middle === 1 ? "" : "s"})` : "");
}

function CheckResult({ checked, maxSpeed, onOptimize, busy }) {
  const { stops, check, travelMode } = checked;
  const { route, stretches, byLimit, overLength } = check;
  const share = route.distance > 0 ? Math.round((overLength / route.distance) * 100) : 0;
  const lines = useMemo(
    () => [
      { points: route.points, kind: "google" },
      ...stretches.map((s) => ({ points: s.points, kind: "bad", tooltip: `${s.name}: ${Math.round(s.limit)} km/h` })),
    ],
    [check]
  );
  const markers = useMemo(() => stopMarkers(stops), [stops]);

  return (
    <section className="card result">
      <p className="trip-label">{tripLabel(stops)}</p>
      {travelMode && travelMode !== "driving" && (
        <p className="muted small">The shared route was for {travelMode}; it was checked as a driving route.</p>
      )}

      {stretches.length === 0 ? (
        <p className="status ok">Google's route stays on roads up to {maxSpeed} km/h.</p>
      ) : (
        <div className="status warn">
          <p>
            {km(overLength)} of this {km(route.distance)} route ({share}%) is on roads over {maxSpeed} km/h.
          </p>
          <div className="chips">
            {Object.entries(byLimit)
              .sort((a, b) => a[0] - b[0])
              .map(([limit, length]) => (
                <span key={limit} className="chip">
                  <b>{limit}</b> {km(length)}
                </span>
              ))}
          </div>
        </div>
      )}

      {stretches.length > 0 && (
        <button type="button" className="btn primary" disabled={busy} onClick={onOptimize}>
          {busy ? "Working…" : "Avoid fast roads"}
        </button>
      )}

      <dl className="stats two">
        <div>
          <dt>Google route</dt>
          <dd>
            {km(route.distance)} · {minutes(route.duration)}
          </dd>
        </div>
        <div>
          <dt>Fast sections</dt>
          <dd>{stretches.length}</dd>
        </div>
      </dl>

      {stretches.length > 0 && <Stretches stretches={stretches} />}

      <RouteMap lines={lines} markers={markers} />
      <Legend
        items={[["google", "Google route"], ["bad", `Over ${maxSpeed} km/h`], ...(stops.length > 2 ? [["stop", "Stop"]] : [])]}
      />
      <p className="muted small">
        This is Google's default driving route between the shared points, avoiding highways and tolls. If you picked an
        alternative route in Maps, it may differ.
      </p>
    </section>
  );
}

function Result({ result, stops, maxSpeed }) {
  const el = useRef(null);
  useEffect(() => {
    el.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [result]);
  const { final, original, waypoints, path, links } = result;
  const strayed = final.analysis.badStretches.filter((s) => !s.planned);
  const planned = path.overLimit;
  const avoided = original.analysis.badStretches.filter((s) => !s.planned);
  const plannedLength = planned.reduce((sum, s) => sum + s.length, 0);
  const added = waypoints.filter((w) => !w.fixed);
  const unsafe = added.some((w) => w.unsafe);
  const waypointText = added.length
    ? ` using ${added.length} extra waypoint${added.length === 1 ? "" : "s"}.`
    : "; no extra waypoints needed.";

  const lines = useMemo(
    () => [
      { points: path.points, kind: "osm" },
      { points: final.route.points, kind: "google" },
      ...final.analysis.badStretches.map((s) => ({ points: s.points, kind: "bad", tooltip: `${s.name}: ${Math.round(s.limit)} km/h` })),
    ],
    [result]
  );
  const markers = useMemo(
    () => [
      ...added.map((w, i) => ({ point: w.point, kind: "waypoint", tooltip: `Waypoint ${i + 1}` })),
      ...stopMarkers(stops),
    ],
    [result, stops]
  );

  return (
    <section className="card result" ref={el}>
      {strayed.length > 0 ? (
        <div className="status warn">
          <p>
            Google still strays onto {strayed.length} fast stretch{strayed.length === 1 ? "" : "es"} that the planned route
            avoids:
          </p>
          <Stretches stretches={strayed} />
        </div>
      ) : planned.length > 0 ? (
        <div className="status note">
          <p>
            Google follows the planned route{waypointText} It has {Math.round(plannedLength)} m over {maxSpeed} km/h where
            there's no reasonable way around:
          </p>
          <Stretches stretches={planned} />
        </div>
      ) : (
        <p className="status ok">
          Google follows a route with no roads over {maxSpeed} km/h{waypointText}
        </p>
      )}

      {links.length === 1 ? (
        <LinkButtons link={links[0]} label="Open in Google Maps" />
      ) : (
        <div className="parts">
          <p className="muted small">
            More than 9 waypoints don't fit in one Google Maps link, so the trip is split into {links.length} parts. Each
            part ends where the next one starts: when Maps says you've arrived, open the next part.
          </p>
          {links.map((link, i) => (
            <LinkButtons key={i} link={link} label={`Part ${i + 1} of ${links.length}`} />
          ))}
        </div>
      )}

      <dl className="stats">
        <div>
          <dt>New route</dt>
          <dd>
            {km(final.route.distance)} · {minutes(final.route.duration)}
          </dd>
        </div>
        <div>
          <dt>Google's own</dt>
          <dd>
            {km(original.route.distance)} · {minutes(original.route.duration)}
          </dd>
        </div>
        <div>
          <dt>Planned (OSM)</dt>
          <dd>
            {km(path.distance)} · {minutes(path.duration)}
          </dd>
        </div>
      </dl>

      {avoided.length > 0 && (
        <details className="avoided">
          <summary>
            Avoided {avoided.length} fast stretch{avoided.length === 1 ? "" : "es"} on Google's own route
          </summary>
          <Stretches stretches={avoided} />
        </details>
      )}

      <RouteMap lines={lines} markers={markers} />
      <Legend items={[["osm", "Planned"], ["google", "Google route"], ["bad", "Over limit"], ["waypoint", "Waypoint"]]} />

      {unsafe && (
        <p className="muted small">
          Some waypoints sit close to a fast road, so Google might snap onto it. Check the route in Maps before you ride.
        </p>
      )}
      <p className="muted small">
        Google Maps shows waypoints as stops. Keep “Avoid highways” and “Avoid tolls” switched on in the Maps app's
        route options, because links can't carry those settings.
      </p>
    </section>
  );
}

// Text shared into the app (Android share sheet, via the manifest's
// share_target), or null when the page was opened normally.
function readShareParams() {
  const q = new URLSearchParams(location.search);
  const text = ["title", "text", "url"].map((k) => q.get(k)).filter(Boolean).join("\n");
  return text || null;
}

function App() {
  const [apiKey, setApiKey] = useLocalStorage(KEYS.apiKey, "");
  const [maxSpeed, setMaxSpeed] = useLocalStorage(KEYS.maxSpeed, 50);
  const [maxWaypoints, setMaxWaypoints] = useLocalStorage(KEYS.maxWaypoints, 9);
  const [mode, setMode] = useLocalStorage(KEYS.mode, "check");
  const [shared] = useState(readShareParams);
  const [linkText, setLinkText] = useState(shared ? extractUrl(shared) ?? shared : "");
  const [origin, setOrigin] = useState(null);
  const [destination, setDestination] = useState(null);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState([]);
  const [error, setError] = useState("");
  const [checked, setChecked] = useState(null);
  const [plan, setPlan] = useState(null);
  const [showSettings, setShowSettings] = useState(!apiKey);
  const autoRan = useRef(false);

  const progress = (msg) =>
    setLog((l) =>
      l.length && l[l.length - 1].startsWith("Loading roads") && msg.startsWith("Loading roads")
        ? [...l.slice(0, -1), msg]
        : [...l, msg]
    );

  // Runs one pipeline step with shared progress/error handling.
  const task = async (fn, { keepLog = false } = {}) => {
    setRunning(true);
    setError("");
    if (!keepLog) setLog([]);
    try {
      await fn();
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
    } finally {
      setRunning(false);
    }
  };

  const check = (text = linkText) =>
    task(async () => {
      setChecked(null);
      setPlan(null);
      progress("Reading the link…");
      const { stops, travelMode } = await readSharedRoute(text);
      const located = await locateStops(apiKey, stops, progress);
      const result = await checkRoute({
        apiKey,
        stops: located.map((s) => s.point),
        maxSpeed: Number(maxSpeed),
        onProgress: progress,
      });
      setChecked({ stops: located, travelMode, check: result });
    });

  const optimize = (stops, source) =>
    task(
      async () => {
        setPlan(null);
        const result = await planRoute({
          apiKey,
          stops: stops.map((s) => s.point),
          maxSpeed: Number(maxSpeed),
          maxWaypoints: Math.max(0, Math.min(MAX_WAYPOINTS_LIMIT, Number(maxWaypoints) || 0)),
          onProgress: progress,
        });
        setPlan({ stops, result, source });
      },
      { keepLog: true }
    );

  // Opened from the share sheet: check the shared route straight away.
  useEffect(() => {
    if (!shared || autoRan.current || !apiKey) return;
    autoRan.current = true;
    setMode("check");
    history.replaceState(null, "", location.pathname);
    check(shared);
  }, [shared, apiKey]);

  const paste = async () => {
    try {
      setLinkText(await navigator.clipboard.readText());
    } catch {
      /* clipboard blocked - the field still accepts a normal paste */
    }
  };

  const switchMode = (m) => {
    setMode(m);
    setError("");
    setLog([]);
  };

  const plannedTrip = origin && destination ? [origin, destination] : null;

  return (
    <main>
      <header className="header">
        <div>
          <h1>Moped Route</h1>
          <p className="muted">Check Google Maps routes for roads over {maxSpeed} km/h, and avoid them.</p>
        </div>
        <button type="button" className="icon-btn" onClick={() => setShowSettings((s) => !s)} aria-label="Settings" title="Settings">
          ⚙
        </button>
      </header>

      {showSettings && (
        <section className="card settings">
          <label className="field-label" htmlFor="apikey">Google Maps API key</label>
          <input
            id="apikey"
            className="input"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value.trim())}
            placeholder="AIza…"
            autoComplete="off"
          />
          <p className="hint">
            Needs the Routes API and Places API (New) enabled. Restrict it to this site's address. It's saved only in this
            browser.
          </p>
          <label className="field-label" htmlFor="maxspeed">Max speed (km/h)</label>
          <input
            id="maxspeed"
            className="input narrow"
            type="number"
            min="10"
            max="120"
            step="10"
            value={maxSpeed}
            onChange={(e) => setMaxSpeed(e.target.value === "" ? "" : Number(e.target.value))}
          />
          <label className="field-label" htmlFor="maxwaypoints">Max waypoints</label>
          <input
            id="maxwaypoints"
            className="input narrow"
            type="number"
            min="0"
            max={MAX_WAYPOINTS_LIMIT}
            step="1"
            value={maxWaypoints}
            onChange={(e) => setMaxWaypoints(e.target.value === "" ? "" : Number(e.target.value))}
          />
          <p className="hint">
            Up to {MAX_WAYPOINTS_LIMIT}. A Google Maps link holds 9 waypoints, so more than that splits the trip into several
            links you open one after another. The app only uses as many as it needs.
          </p>
        </section>
      )}

      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={mode === "check"} onClick={() => switchMode("check")}>
          Check a route
        </button>
        <button type="button" role="tab" aria-selected={mode === "plan"} onClick={() => switchMode("plan")}>
          Plan A → B
        </button>
      </div>

      {mode === "check" ? (
        <section className="card trip">
          <label className="field-label" htmlFor="link">Google Maps link</label>
          <div className="place-row">
            <input
              id="link"
              className="input"
              value={linkText}
              onChange={(e) => setLinkText(e.target.value)}
              placeholder="https://maps.app.goo.gl/…"
              autoComplete="off"
            />
            {navigator.clipboard?.readText && (
              <button type="button" className="btn" onClick={paste}>
                Paste
              </button>
            )}
          </div>
          <p className="hint">In Google Maps, open directions and tap Share, then pick Moped Route. Or paste the link here.</p>
          <button type="button" className="btn primary wide" disabled={!apiKey || !linkText.trim() || running} onClick={() => check()}>
            {running && !checked ? "Checking…" : "Check route"}
          </button>
          {!apiKey && <p className="hint">Add your Google API key in settings first.</p>}
        </section>
      ) : (
        <section className="card trip">
          <PlaceInput label="From" value={origin} onChange={setOrigin} apiKey={apiKey} withMyLocation />
          <button
            type="button"
            className="swap"
            onClick={() => {
              setOrigin(destination);
              setDestination(origin);
            }}
            aria-label="Swap start and destination"
            title="Swap"
          >
            ⇅
          </button>
          <PlaceInput label="To" value={destination} onChange={setDestination} apiKey={apiKey} />
          <button
            type="button"
            className="btn primary wide"
            disabled={!apiKey || !plannedTrip || !(maxSpeed > 0) || running}
            onClick={() => {
              setLog([]);
              optimize(plannedTrip, "plan");
            }}
          >
            {running ? "Planning…" : "Plan route"}
          </button>
          {!apiKey && <p className="hint">Add your Google API key in settings first.</p>}
        </section>
      )}

      {(log.length > 0 || error) && (
        <section className="card log">
          {log.map((l, i) => (
            <p key={i} className={i === log.length - 1 && running ? "current" : "muted"}>{l}</p>
          ))}
          {error && <p className="error">{error}</p>}
        </section>
      )}

      {mode === "check" && checked && (
        <CheckResult checked={checked} maxSpeed={maxSpeed} busy={running} onOptimize={() => optimize(checked.stops, "check")} />
      )}
      {plan && plan.source === mode && <Result result={plan.result} stops={plan.stops} maxSpeed={maxSpeed} />}

      <footer className="muted small">
        Speed limits from OpenStreetMap. Untagged roads use Swiss defaults (50 in town, 80 on untagged main roads).
        Faster roads are used only when the detour would be much longer, and 60 is preferred over 80.
      </footer>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("app")).render(<App />);
