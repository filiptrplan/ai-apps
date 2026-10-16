import { useSyncedStorage } from "../shared/syncStorage.js";
import { EcgPaper, MIN_ZOOM, MAX_ZOOM } from "./EcgPaper.jsx";
import { QUESTIONS, GROUPS, DX, SOURCES, loadIndex, casesFor, diagnosesFor, isTwelveLead, loadCase, describeSource, explain } from "./cases.js";

const { useState, useMemo, useEffect, useRef } = React;

const APP_ID = "ekg-trainer";
const DEFAULT_SETTINGS = { twelve: true, disabled: [], adaptive: true, flagged: [] };
const EMPTY_STATS = { cases: 0, dxCorrect: 0, streak: 0, best: 0, perDx: {}, perQ: {} };
const TABS = [["practice", "Practice"], ["library", "Library"], ["stats", "Stats"]];
const QUESTION = Object.fromEntries(QUESTIONS.map((q) => [q.id, q]));

// Recordings she has flagged as mislabelled are left out everywhere.
function usableCases(index, settings) {
  const flagged = new Set((settings.flagged ?? []).map((f) => f.id));
  return casesFor(index, settings.twelve).filter((e) => !flagged.has(e.id));
}

function poolFor(index, settings) {
  const have = new Set(usableCases(index, settings).map((e) => e.dx));
  const base = diagnosesFor(index, settings.twelve).filter((d) => have.has(d.id));
  const enabled = base.filter((d) => !settings.disabled.includes(d.id));
  return enabled.length ? enabled : base;
}

// A recording of `dx`, preferring ones she hasn't seen lately.
function pickEntry(index, settings, dx, recent) {
  const all = usableCases(index, settings).filter((e) => e.dx === dx);
  const fresh = all.filter((e) => !recent.includes(e.id));
  const from = fresh.length ? fresh : all;
  return from[Math.floor(Math.random() * from.length)];
}

// Diagnoses she gets wrong come up more often (Laplace-smoothed accuracy).
function pickDx(pool, stats, adaptive, previous) {
  const options = pool.length > 1 ? pool.filter((d) => d.id !== previous) : pool;
  const weights = options.map((d) => {
    if (!adaptive) return 1;
    const s = stats.perDx[d.id] ?? { seen: 0, correct: 0 };
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
  return seen ? Math.round((100 * correct) / seen) : null;
}

export function EkgTrainerApp() {
  const [settings, setSettings] = useSyncedStorage(APP_ID, "ekg-trainer-settings", DEFAULT_SETTINGS);
  const [stats, setStats, statsConflict] = useSyncedStorage(APP_ID, "ekg-trainer-stats", EMPTY_STATS);
  const [tab, setTab] = useState("practice");
  const [index, setIndex] = useState(null);
  const [loadError, setLoadError] = useState(null);

  function fetchIndex() {
    setLoadError(null);
    loadIndex().then(setIndex, (e) => setLoadError(e.message));
  }
  useEffect(fetchIndex, []);

  return (
    <div className="ek">
      <header className="ek-header">
        <a className="ek-back" href="./" aria-label="All apps">‹</a>
        <h1>EKG Trainer</h1>
        <nav className="ek-tabs">
          {TABS.map(([id, title]) => (
            <button key={id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{title}</button>
          ))}
        </nav>
      </header>

      {statsConflict && (
        <div className="ek-conflict" role="alert">
          <span>Your stats changed on another device.</span>
          <button onClick={statsConflict.keepRemote}>Use theirs</button>
          <button onClick={statsConflict.keepLocal}>Keep mine</button>
        </div>
      )}

      {!index ? (
        <main className="ek-loading">
          {loadError ? (
            <>
              <p>{loadError}</p>
              <button className="ek-primary" onClick={fetchIndex}>Try again</button>
            </>
          ) : (
            <p className="ek-muted">Loading EKGs…</p>
          )}
        </main>
      ) : (
        <>
          {tab === "practice" && <Practice index={index} settings={settings} setSettings={setSettings} stats={stats} setStats={setStats} />}
          {tab === "library" && <Library index={index} />}
          {tab === "stats" && <Stats index={index} stats={stats} setStats={setStats} settings={settings} setSettings={setSettings} />}
        </>
      )}
    </div>
  );
}

// --- Practice --------------------------------------------------------------

function Practice({ index, settings, setSettings, stats, setStats }) {
  const pool = poolFor(index, settings);
  const [kase, setKase] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [picks, setPicks] = useState({});
  const [checked, setChecked] = useState(false);
  const [showFocus, setShowFocus] = useState(false);
  const recent = useRef([]); // recordings shown lately, newest last
  const request = useRef(0);
  const topRef = useRef(null);
  const teachRef = useRef(null);

  async function next(s = settings) {
    const dx = pickDx(poolFor(index, s), stats, s.adaptive, kase?.dx);
    const entry = pickEntry(index, s, dx, recent.current);
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
      topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      if (mine === request.current) setError(e.message);
    } finally {
      if (mine === request.current) setLoading(false);
    }
  }

  useEffect(() => {
    next();
  }, []);

  function changeSettings(patch) {
    const s = { ...settings, ...patch };
    setSettings(s);
    if ("twelve" in patch) next(s);
  }

  // The case was drawn for a mode or focus she has since changed.
  useEffect(() => {
    if (kase && !checked && !pool.some((d) => d.id === kase.dx)) next();
  }, [settings.disabled]);

  const dxChoices = diagnosesFor(index, settings.twelve);
  const result = useMemo(() => {
    if (!checked || !kase) return null;
    const perQ = kase.ask.map((q) => ({ q, ok: kase.answers[q].includes(picks[q]) }));
    return { perQ, dxOk: picks.dx === kase.dx, score: perQ.filter((r) => r.ok).length + (picks.dx === kase.dx ? 1 : 0), total: perQ.length + 1 };
  }, [checked, kase, picks]);

  function check() {
    const perQ = kase.ask.map((q) => ({ q, ok: kase.answers[q].includes(picks[q]) }));
    const dxOk = picks.dx === kase.dx;
    setChecked(true);
    setStats((s) => {
      const d = s.perDx[kase.dx] ?? { seen: 0, correct: 0 };
      const qs = { ...s.perQ };
      for (const { q, ok } of perQ) {
        const prev = qs[q] ?? { seen: 0, correct: 0 };
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
        perQ: qs,
      };
    });
  }

  // Bring the explanation into view once the answers are in.
  useEffect(() => {
    if (checked) teachRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [checked]);

  const choose = (q, v) => !checked && setPicks((p) => ({ ...p, [q]: p[q] === v ? undefined : v }));

  const flagged = kase && (settings.flagged ?? []).some((f) => f.id === kase.entry.id);
  function toggleFlag() {
    const rest = (settings.flagged ?? []).filter((f) => f.id !== kase.entry.id);
    setSettings({ ...settings, flagged: flagged ? rest : [...rest, { id: kase.entry.id, dx: kase.dx, at: new Date().toISOString() }] });
  }

  if (!kase) {
    return (
      <main className="ek-loading">
        {error ? (
          <>
            <p>{error}</p>
            <button className="ek-primary" onClick={() => next()}>Try again</button>
          </>
        ) : (
          <p className="ek-muted">Loading EKG…</p>
        )}
      </main>
    );
  }
  const dx = DX[kase.dx];

  return (
    <main className="ek-practice" ref={topRef}>
      <div className="ek-toolbar">
        <div className="ek-segmented" role="group" aria-label="Recording">
          <button className={!settings.twelve ? "on" : ""} onClick={() => changeSettings({ twelve: false })}>Rhythm strip</button>
          <button className={settings.twelve ? "on" : ""} onClick={() => changeSettings({ twelve: true })}>12-lead</button>
        </div>
        <button className={`ek-chip-button${showFocus ? " on" : ""}`} onClick={() => setShowFocus((v) => !v)} aria-expanded={showFocus}>
          Pick what to practise{settings.disabled.length ? ` · ${pool.length}` : ""}
        </button>
        <span className="ek-streak" title="Correct diagnoses in a row">🔥 {stats.streak}</span>
      </div>

      {showFocus && <FocusPanel index={index} settings={settings} changeSettings={changeSettings} />}

      {/* The EKG stays in view on the left while the questions scroll past on the right. */}
      <div className="ek-workspace">
        <div className="ek-workspace-ecg">
          <EcgViewer key={kase.id} kase={kase} />
        </div>
        <div className="ek-workspace-side">
          <section className="ek-questions">
            {kase.ask.map((qid) => (
              <QuestionBlock
                key={qid}
                q={QUESTION[qid]}
                picked={picks[qid]}
                answers={checked ? kase.answers[qid] : null}
                note={checked ? explain(kase, qid) : null}
                onPick={(v) => choose(qid, v)}
              />
            ))}
            {kase.ask.length === 0 && (
              <p className="ek-muted ek-small ek-span">No intervals to measure on this one — go straight to the diagnosis.</p>
            )}

            <div className="ek-q ek-span">
              <div className="ek-q-head">
                <h3>Diagnosis</h3>
              </div>
              {GROUPS.filter((g) => dxChoices.some((d) => d.group === g.id)).map((g) => (
                <div key={g.id} className="ek-dx-group">
                  <p className="ek-dx-group-title">{g.title}</p>
                  <div className="ek-options">
                    {dxChoices.filter((d) => d.group === g.id).map((d) => (
                      <Option
                        key={d.id}
                        label={d.label}
                        picked={picks.dx === d.id}
                        state={checked ? (d.id === kase.dx ? "right" : picks.dx === d.id ? "wrong" : "") : ""}
                        onClick={() => choose("dx", d.id)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {checked && <Teaching ref={teachRef} dx={dx} kase={kase} ok={result.dxOk} flagged={flagged} onFlag={toggleFlag} />}
        </div>
      </div>

      <div className="ek-actionbar">
        {checked ? (
          <>
            <span className="ek-score">
              <strong>{result.score}/{result.total}</strong> correct
            </span>
            {error && <span className="ek-small ek-error">{error}</span>}
            <button className="ek-primary" disabled={loading} onClick={() => next()}>{loading ? "Loading…" : "Next EKG →"}</button>
          </>
        ) : (
          <>
            <span className="ek-muted ek-small">
              {picks.dx ? "Ready when you are" : "Pick a diagnosis to check"}
            </span>
            <button className="ek-primary" disabled={!picks.dx} onClick={check}>Check answers</button>
          </>
        )}
      </div>
    </main>
  );
}

function EcgViewer({ kase }) {
  const [zoom, setZoom] = useState(1);
  const [calipers, setCalipers] = useState(false);
  return (
    <section className="ek-ecg">
      <EcgPaper signal={kase.signal} twelve={kase.twelve} zoom={zoom} onZoom={setZoom} calipers={calipers} />
      <div className="ek-ecg-tools">
        <button className={`ek-chip-button${calipers ? " on" : ""}`} onClick={() => setCalipers((v) => !v)}>
          📏 Calipers
        </button>
        <span className="ek-muted ek-small">{calipers ? "Drag across the paper to measure" : "Pinch to zoom"}</span>
        <span className="ek-grow" />
        <button className="ek-icon" onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - 0.5))} disabled={zoom <= MIN_ZOOM} aria-label="Zoom out">−</button>
        <span className="ek-small ek-zoom">{zoom.toFixed(1)}×</span>
        <button className="ek-icon" onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + 0.5))} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in">+</button>
      </div>
    </section>
  );
}

function Option({ label, picked, state, onClick }) {
  return (
    <button className={`ek-option${picked ? " picked" : ""}${state ? ` ${state}` : ""}`} onClick={onClick} aria-pressed={picked}>
      {label}
    </button>
  );
}

function QuestionBlock({ q, picked, answers, note, onPick }) {
  const ok = answers ? answers.includes(picked) : null;
  return (
    <div className={`ek-q${answers ? (ok ? " ok" : " bad") : ""}`}>
      <div className="ek-q-head">
        <h3>{q.title}</h3>
        {answers && <span className={`ek-mark ${ok ? "ok" : "bad"}`}>{ok ? "✓" : picked ? "✗" : "–"}</span>}
      </div>
      {!answers && <p className="ek-hint">{q.hint}</p>}
      <div className="ek-options">
        {q.options.map(([id, label]) => (
          <Option
            key={id}
            label={label}
            picked={picked === id}
            state={answers ? (answers.includes(id) ? "right" : picked === id ? "wrong" : "") : ""}
            onClick={() => onPick(id)}
          />
        ))}
      </div>
      {note && <p className="ek-note">{note}</p>}
    </div>
  );
}

const Teaching = React.forwardRef(function Teaching({ dx, kase, ok, flagged, onFlag }, ref) {
  const f = kase.facts;
  const numbers = [
    f.rate != null && `rate ${f.rate}`,
    typeof f.pr === "number" && `PR ${f.pr} ms`,
    f.qrs != null && `QRS ${f.qrs} ms`,
    kase.twelve && f.axis != null && `axis ${f.axis}°`,
    kase.twelve && f.qtc != null && kase.ask.includes("qt") && `QTc ${f.qtc} ms`,
  ].filter(Boolean);
  return (
    <section ref={ref} className={`ek-teach ${ok ? "ok" : "bad"}`}>
      <p className="ek-teach-verdict">{ok ? "Correct!" : "The answer was"}</p>
      <h2>{dx.label}{f.note ? <span className="ek-muted"> — {f.note}</span> : null}</h2>
      {numbers.length > 0 && <p className="ek-small ek-muted">This tracing: {numbers.join(" · ")}</p>}
      <ul>
        {dx.features.map((t) => <li key={t}>{t}</li>)}
      </ul>
      <p className="ek-pearl">💡 {dx.pearl}</p>
      <div className="ek-source">
        <span className="ek-muted ek-small">{describeSource(kase.entry)}</span>
        <span className="ek-grow" />
        <button className={`ek-link ek-flag${flagged ? " on" : ""}`} onClick={onFlag} aria-pressed={flagged}>
          {flagged ? "⚑ Flagged — won't come up again" : "⚑ Answer looks wrong for this EKG"}
        </button>
      </div>
    </section>
  );
});

function FocusPanel({ index, settings, changeSettings }) {
  const base = diagnosesFor(index, settings.twelve);
  const off = new Set(settings.disabled);
  const toggle = (ids, on) => {
    const next = new Set(off);
    for (const id of ids) on ? next.delete(id) : next.add(id);
    changeSettings({ disabled: [...next] });
  };
  return (
    <section className="ek-focus">
      <div className="ek-focus-head">
        <strong>Practise these</strong>
        <span className="ek-grow" />
        <button className="ek-link" onClick={() => toggle(base.map((d) => d.id), true)}>All</button>
        <button className="ek-link" onClick={() => toggle(base.map((d) => d.id), false)}>None</button>
      </div>
      {GROUPS.filter((g) => base.some((d) => d.group === g.id)).map((g) => {
        const ds = base.filter((d) => d.group === g.id);
        const allOn = ds.every((d) => !off.has(d.id));
        return (
          <div key={g.id} className="ek-focus-group">
            <label className="ek-check ek-check-group">
              <input type="checkbox" checked={allOn} onChange={() => toggle(ds.map((d) => d.id), !allOn)} />
              {g.title}
            </label>
            <div className="ek-focus-items">
              {ds.map((d) => (
                <label key={d.id} className="ek-check">
                  <input type="checkbox" checked={!off.has(d.id)} onChange={() => toggle([d.id], off.has(d.id))} />
                  {d.label}
                </label>
              ))}
            </div>
          </div>
        );
      })}
      <label className="ek-check ek-adaptive">
        <input type="checkbox" checked={settings.adaptive} onChange={() => changeSettings({ adaptive: !settings.adaptive })} />
        Show the ones I get wrong more often
      </label>
    </section>
  );
}

// --- Library ---------------------------------------------------------------

function Library({ index }) {
  const [selected, setSelected] = useState(null);
  const [kase, setKase] = useState(null);
  const [error, setError] = useState(null);
  const shown = useRef(0);

  // Steps through the recordings of a diagnosis, 12-leads first.
  async function open(id, step = 0) {
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
    return (
      <main className="ek-library">
        <button className="ek-link" onClick={() => (setSelected(null), setKase(null))}>‹ All diagnoses</button>
        <h2 className="ek-lib-title">{dx.label}</h2>
        {error && <p className="ek-error">{error}</p>}
        {kase && kase.dx === selected ? (
          <>
            <p className="ek-muted ek-small">
              Example {shown.current + 1} of {count(selected)} · {describeSource(kase.entry)}
            </p>
            <EcgViewer key={kase.id} kase={kase} />
          </>
        ) : (
          !error && <p className="ek-muted">Loading EKG…</p>
        )}
        <section className="ek-teach neutral">
          <ul>
            {dx.features.map((t) => <li key={t}>{t}</li>)}
          </ul>
          <p className="ek-pearl">💡 {dx.pearl}</p>
        </section>
        {count(selected) > 1 && (
          <button className="ek-primary ek-another" onClick={() => open(selected, 1)}>Next example</button>
        )}
      </main>
    );
  }

  return (
    <main className="ek-library">
      <p className="ek-muted ek-intro">Every diagnosis the trainer covers, with the features to look for. All examples are real patient recordings.</p>
      {GROUPS.map((g) => {
        const ds = Object.values(DX).filter((d) => d.group === g.id && available.has(d.id));
        if (!ds.length) return null;
        return (
          <section key={g.id} className="ek-lib-group">
            <h3>{g.title}</h3>
            <div className="ek-lib-list">
              {ds.map((d) => (
                <button key={d.id} className="ek-lib-item" onClick={() => open(d.id)}>
                  <span className="ek-lib-name">{d.label}</span>
                  <span className="ek-muted ek-small">{d.features[0]}</span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
      <Credits />
    </main>
  );
}

function Credits() {
  return (
    <p className="ek-muted ek-small ek-credits">
      Recordings from{" "}
      {Object.values(SOURCES).map((s, i, all) => (
        <React.Fragment key={s.url}>
          <a href={s.url} target="_blank" rel="noreferrer">{s.name}</a>
          {i < all.length - 2 ? ", " : i === all.length - 2 ? " and " : ""}
        </React.Fragment>
      ))}{" "}
      on PhysioNet (CC BY 4.0 / ODC-By), filtered for display. Answers come from the databases' labels and machine measurements, so the occasional one may be off — flag it.
    </p>
  );
}

// --- Stats -----------------------------------------------------------------

function Stats({ index, stats, setStats, settings, setSettings }) {
  const [confirmReset, setConfirmReset] = useState(false);
  const flagged = settings.flagged ?? [];
  const rows = Object.values(DX).map((d) => ({ d, s: stats.perDx[d.id] ?? { seen: 0, correct: 0 } }))
    .filter((r) => r.s.seen > 0)
    .sort((a, b) => a.s.correct / a.s.seen - b.s.correct / b.s.seen || b.s.seen - a.s.seen);

  const flaggedCard = flagged.length > 0 && (
    <section className="ek-card">
      <h3>Flagged EKGs <span className="ek-muted ek-small">left out of practice</span></h3>
      {flagged.map((f) => {
        const entry = index.find((e) => e.id === f.id);
        return (
          <div key={f.id} className="ek-flagged">
            <span>
              {DX[f.dx]?.label ?? f.dx}
              <span className="ek-muted ek-small"> · {entry ? describeSource(entry) : f.id}</span>
            </span>
            <button className="ek-link" onClick={() => setSettings({ ...settings, flagged: flagged.filter((x) => x.id !== f.id) })}>
              Unflag
            </button>
          </div>
        );
      })}
    </section>
  );

  if (!stats.cases) {
    return (
      <main className="ek-stats">
        <p className="ek-muted ek-intro">No EKGs checked yet. Your accuracy per diagnosis and per step shows up here once you've done a few.</p>
        {flaggedCard}
      </main>
    );
  }

  return (
    <main className="ek-stats">
      <div className="ek-tiles">
        <Tile value={stats.cases} label="EKGs read" />
        <Tile value={`${pct(stats.dxCorrect, stats.cases)}%`} label="Diagnosis correct" />
        <Tile value={stats.streak} label="Current streak" />
        <Tile value={stats.best} label="Best streak" />
      </div>

      <section className="ek-card">
        <h3>By step</h3>
        {QUESTIONS.filter((q) => stats.perQ[q.id]).map((q) => {
          const s = stats.perQ[q.id];
          return <Bar key={q.id} label={q.title} correct={s.correct} seen={s.seen} />;
        })}
      </section>

      <section className="ek-card">
        <h3>By diagnosis <span className="ek-muted ek-small">weakest first</span></h3>
        {rows.map(({ d, s }) => <Bar key={d.id} label={d.label} correct={s.correct} seen={s.seen} />)}
      </section>

      {flaggedCard}

      <button
        className={`ek-reset${confirmReset ? " armed" : ""}`}
        onClick={() => (confirmReset ? (setStats(EMPTY_STATS), setConfirmReset(false)) : setConfirmReset(true))}
        onBlur={() => setConfirmReset(false)}
      >
        {confirmReset ? "Tap again to reset all stats" : "Reset stats"}
      </button>
    </main>
  );
}

function Tile({ value, label }) {
  return (
    <div className="ek-tile">
      <span className="ek-tile-value">{value}</span>
      <span className="ek-muted ek-small">{label}</span>
    </div>
  );
}

function Bar({ label, correct, seen }) {
  const p = pct(correct, seen);
  return (
    <div className="ek-bar">
      <span className="ek-bar-label">{label}</span>
      <span className="ek-bar-track"><span className="ek-bar-fill" style={{ width: `${p}%` }} /></span>
      <span className="ek-bar-num">{p}% <span className="ek-muted">({correct}/{seen})</span></span>
    </div>
  );
}
