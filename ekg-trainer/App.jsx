import { useSyncedStorage } from "../shared/syncStorage.js";
import { EcgPaper } from "./EcgPaper.jsx";
import { QUESTIONS, GROUPS, DIAGNOSES, DX, generateCase, explain, stripDiagnoses } from "./cases.js";

const { useState, useMemo, useEffect, useRef } = React;

const APP_ID = "ekg-trainer";
const DEFAULT_SETTINGS = { twelve: true, disabled: [], adaptive: true };
const EMPTY_STATS = { cases: 0, dxCorrect: 0, streak: 0, best: 0, perDx: {}, perQ: {} };
const TABS = [["practice", "Practice"], ["library", "Library"], ["stats", "Stats"]];
const QUESTION = Object.fromEntries(QUESTIONS.map((q) => [q.id, q]));

function poolFor(settings) {
  const base = settings.twelve ? DIAGNOSES : stripDiagnoses();
  const enabled = base.filter((d) => !settings.disabled.includes(d.id));
  return enabled.length ? enabled : base;
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

      {tab === "practice" && <Practice settings={settings} setSettings={setSettings} stats={stats} setStats={setStats} />}
      {tab === "library" && <Library />}
      {tab === "stats" && <Stats stats={stats} setStats={setStats} />}
    </div>
  );
}

// --- Practice --------------------------------------------------------------

function Practice({ settings, setSettings, stats, setStats }) {
  const pool = poolFor(settings);
  const [kase, setKase] = useState(() => generateCase(pickDx(pool, stats, settings.adaptive), settings.twelve));
  const [picks, setPicks] = useState({});
  const [checked, setChecked] = useState(false);
  const [showFocus, setShowFocus] = useState(false);
  const topRef = useRef(null);
  const teachRef = useRef(null);

  function next(s = settings) {
    const p = poolFor(s);
    setKase(generateCase(pickDx(p, stats, s.adaptive, kase.dx), s.twelve));
    setPicks({});
    setChecked(false);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function changeSettings(patch) {
    const s = { ...settings, ...patch };
    setSettings(s);
    if ("twelve" in patch) next(s);
  }

  // The case was drawn for a mode or focus she has since changed.
  useEffect(() => {
    if (!checked && !pool.some((d) => d.id === kase.dx)) next();
  }, [settings.disabled]);

  const dxChoices = settings.twelve ? DIAGNOSES : stripDiagnoses();
  const result = useMemo(() => {
    if (!checked) return null;
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

      {showFocus && <FocusPanel settings={settings} changeSettings={changeSettings} />}

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

          {checked && <Teaching ref={teachRef} dx={dx} kase={kase} ok={result.dxOk} />}
        </div>
      </div>

      <div className="ek-actionbar">
        {checked ? (
          <>
            <span className="ek-score">
              <strong>{result.score}/{result.total}</strong> correct
            </span>
            <button className="ek-primary" onClick={() => next()}>Next EKG →</button>
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
      <EcgPaper signal={kase.signal} twelve={kase.twelve} zoom={zoom} calipers={calipers} />
      <div className="ek-ecg-tools">
        <button className={`ek-chip-button${calipers ? " on" : ""}`} onClick={() => setCalipers((v) => !v)}>
          📏 Calipers
        </button>
        {calipers && <span className="ek-muted ek-small">Drag across the paper to measure</span>}
        <span className="ek-grow" />
        <button className="ek-icon" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} disabled={zoom <= 1} aria-label="Zoom out">−</button>
        <span className="ek-small ek-zoom">{zoom}×</span>
        <button className="ek-icon" onClick={() => setZoom((z) => Math.min(3, z + 0.5))} disabled={zoom >= 3} aria-label="Zoom in">+</button>
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

const Teaching = React.forwardRef(function Teaching({ dx, kase, ok }, ref) {
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
    </section>
  );
});

function FocusPanel({ settings, changeSettings }) {
  const base = settings.twelve ? DIAGNOSES : stripDiagnoses();
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

function Library() {
  const [selected, setSelected] = useState(null);
  const [kase, setKase] = useState(null);

  function open(id) {
    setSelected(id);
    setKase(generateCase(id, true));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (selected) {
    const dx = DX[selected];
    return (
      <main className="ek-library">
        <button className="ek-link" onClick={() => setSelected(null)}>‹ All diagnoses</button>
        <h2 className="ek-lib-title">{dx.label}{kase.facts.note ? <span className="ek-muted"> — {kase.facts.note}</span> : null}</h2>
        <EcgViewer key={kase.id} kase={kase} />
        <section className="ek-teach neutral">
          <ul>
            {dx.features.map((t) => <li key={t}>{t}</li>)}
          </ul>
          <p className="ek-pearl">💡 {dx.pearl}</p>
        </section>
        <button className="ek-primary ek-another" onClick={() => open(selected)}>Another example</button>
      </main>
    );
  }

  return (
    <main className="ek-library">
      <p className="ek-muted ek-intro">Every diagnosis the trainer can draw, with the features to look for. Each example is freshly generated, so open one a few times to see the variation.</p>
      {GROUPS.map((g) => (
        <section key={g.id} className="ek-lib-group">
          <h3>{g.title}</h3>
          <div className="ek-lib-list">
            {DIAGNOSES.filter((d) => d.group === g.id).map((d) => (
              <button key={d.id} className="ek-lib-item" onClick={() => open(d.id)}>
                <span className="ek-lib-name">{d.label}</span>
                <span className="ek-muted ek-small">{d.features[0]}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}

// --- Stats -----------------------------------------------------------------

function Stats({ stats, setStats }) {
  const [confirmReset, setConfirmReset] = useState(false);
  const rows = DIAGNOSES.map((d) => ({ d, s: stats.perDx[d.id] ?? { seen: 0, correct: 0 } }))
    .filter((r) => r.s.seen > 0)
    .sort((a, b) => a.s.correct / a.s.seen - b.s.correct / b.s.seen || b.s.seen - a.s.seen);

  if (!stats.cases) {
    return <main className="ek-stats"><p className="ek-muted ek-intro">No EKGs checked yet. Your accuracy per diagnosis and per step shows up here once you've done a few.</p></main>;
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
