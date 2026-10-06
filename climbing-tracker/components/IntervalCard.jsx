import { s, C } from "../styles.js";
import { formatTime, formatWeightLabel } from "../format.js";
import { sounds, getAudioCtx } from "../sounds.js";
import { NumberField } from "./NumberField.jsx";
import { Icon } from "./Icons.jsx";
import { useDrain } from "./useDrain.js";

const { useState, useEffect, useRef } = React;

const PREP_SEC = 5; // "get ready" countdown before each tapped start
const RUNNING = ["prep", "work", "rest"]; // phases with a clock

// Reports its progress live via onChange (rather than a one-shot onComplete)
// so the containing page can read the current completedSets at any time,
// including mid-timer, when the workout is finished. Work/rest/sets are
// editable while idle (before Start), so a routine's timer values can be
// tweaked for this session without leaving to edit the exercise/routine.
// A "weightedInterval" exercise also gets an editable weight.
//
// With superset set, each set is a single work phase started by a tap; the
// card's own rest is skipped (the superset's round rest replaces it) but
// restSec is still reported unchanged so it doesn't look edited.
//
// Every tapped start (Start, or "Start set N" in a superset) runs a short
// prep countdown first so there's time to get into position.
//
// The clock runs off wall-clock deadlines (endsAt) rather than counting
// ticks, so it stays right while the page is backgrounded and its timers
// are throttled. Its state goes into the log (as `timer`), so a reload -
// say the phone discarded the app in the background - resumes it exactly:
// phases whose deadline passed while the page was gone are played through
// silently, each starting where the previous one ended.
//
// initialLog (a workout restored after a reload) brings back the edited
// values, completed sets and the timer. onChange's second argument is
// { restored: true } for the report that catches up after a reload.
export function IntervalCard({ exercise, initialLog, superset, onChange }) {
  const [init] = useState(() => {
    const cfg = {
      workSec: initialLog?.workSec ?? exercise.workSec,
      restSec: initialLog?.restSec ?? exercise.restSec,
      totalSets: initialLog?.targetSets ?? exercise.sets,
      weight: initialLog?.weight ?? exercise.weight,
    };
    const completed = initialLog?.completedSets || 0;
    const saved = initialLog?.timer;
    if (saved && RUNNING.includes(saved.phase)) {
      return { cfg, timer: { completed, phase: saved.phase, set: saved.set || 1, endsAt: saved.endsAt || 0, remainingMs: saved.remainingMs || 0, paused: !!saved.paused } };
    }
    // Older saves (no timer) come back waiting on "Start set N".
    const phase = completed === 0 ? "idle" : completed >= cfg.totalSets ? "done" : "next";
    return { cfg, timer: { completed, phase, set: phase === "next" ? completed + 1 : 1, endsAt: 0, remainingMs: 0, paused: false } };
  });
  const [workSec, setWorkSec] = useState(init.cfg.workSec);
  const [restSec, setRestSec] = useState(init.cfg.restSec);
  const [totalSets, setTotalSets] = useState(init.cfg.totalSets);
  const [weight, setWeight] = useState(init.cfg.weight);
  const weighted = exercise.type === "weightedInterval";
  // { completed, phase, set, endsAt, remainingMs (while paused), paused };
  // phase is idle | prep | work | rest | next | done.
  const timerRef = useRef(init.timer);
  const configRef = useRef(init.cfg);
  const intervalRef = useRef(null);
  const lastSecRef = useRef(0);
  const [, setFrame] = useState(0);
  const rerender = () => setFrame(f => f + 1);

  // Values edited before Start are reported too, so they survive a reload.
  useEffect(() => {
    configRef.current = { workSec, restSec, totalSets, weight };
    if (timerRef.current.phase === "idle") report();
  }, [workSec, restSec, totalSets, weight]);

  // Timer callbacks outlive the render that set them up.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const report = (meta) => {
    const t = timerRef.current;
    onChangeRef.current({
      type: exercise.type,
      completedSets: t.completed,
      workSec: configRef.current.workSec,
      restSec: configRef.current.restSec,
      targetSets: configRef.current.totalSets,
      ...(weighted && { weight: configRef.current.weight }),
      timer: RUNNING.includes(t.phase)
        ? { phase: t.phase, set: t.set, paused: t.paused, ...(t.paused ? { remainingMs: t.remainingMs } : { endsAt: t.endsAt }) }
        : null,
    }, meta);
  };

  const durationMs = (phase) => 1000 * (phase === "prep" ? PREP_SEC
    : phase === "work" ? Math.max(1, Number(configRef.current.workSec) || 0)
    : Math.max(0, Number(configRef.current.restSec) || 0));

  const clearTick = () => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  };
  const startTick = () => {
    clearTick();
    intervalRef.current = setInterval(tick, 250);
  };

  const enter = (phase, at) => {
    const t = timerRef.current;
    t.phase = phase;
    t.endsAt = at + durationMs(phase);
  };

  // Moves past every phase whose deadline is at or before now. Each next
  // phase starts at the previous deadline, not now, so time spent with the
  // page throttled or gone is accounted exactly. Sounds play only for a
  // change that's happening live (not one being caught up on). Returns
  // whether anything changed.
  const advance = (now, silent) => {
    const t = timerRef.current;
    let changed = false;
    while (RUNNING.includes(t.phase) && !t.paused && t.endsAt <= now) {
      const at = t.endsAt;
      const live = !silent && now - at < 1500;
      changed = true;
      if (t.phase === "prep") {
        enter("work", at);
        if (live) sounds.workStart();
      } else if (t.phase === "work") {
        t.completed += 1;
        if (t.set >= configRef.current.totalSets) {
          t.phase = "done";
          if (live) sounds.finish();
        } else if (superset) {
          // No rest phase in a superset: wait for a tap to start the next
          // set, since the other members and the round rest happen between.
          t.set += 1;
          t.phase = "next";
          if (live) sounds.restStart();
        } else {
          enter("rest", at);
          if (live) sounds.restStart();
        }
      } else {
        t.set += 1;
        enter("work", at);
        if (live) sounds.workStart();
      }
    }
    if (!RUNNING.includes(t.phase)) clearTick();
    return changed;
  };

  const tick = () => {
    const now = Date.now();
    if (advance(now, false)) { report(); rerender(); }
    const t = timerRef.current;
    if (!RUNNING.includes(t.phase) || t.paused) return;
    const sec = Math.ceil((t.endsAt - now) / 1000);
    if (sec === lastSecRef.current) return;
    lastSecRef.current = sec;
    if (sec <= 3 && sec >= 1) sounds.countdown();
    rerender();
  };

  // Resume a timer restored after a reload, catching up on whatever
  // happened while the page was gone.
  useEffect(() => {
    const t = timerRef.current;
    if (!RUNNING.includes(t.phase)) return;
    if (advance(Date.now(), true)) { report({ restored: true }); rerender(); }
    if (RUNNING.includes(t.phase) && !t.paused) startTick();
  }, []);

  // Coming back to the app, show the right phase at once rather than on
  // the next (possibly still throttled) tick.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible" && intervalRef.current) tick(); };
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
    getAudioCtx(); // unlock audio on user gesture
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
    const t = timerRef.current;
    if (t.paused) {
      t.endsAt = Date.now() + t.remainingMs;
      t.paused = false;
      startTick();
    } else {
      t.remainingMs = Math.max(0, t.endsAt - Date.now());
      t.paused = true;
      clearTick();
    }
    report();
    rerender();
  };

  // Skipping ends the current phase now. Only skipping the prep sounds the
  // start of work; skipping work or rest is silent.
  const skip = () => {
    const t = timerRef.current;
    if (!RUNNING.includes(t.phase)) return;
    const now = Date.now();
    const wasPrep = t.phase === "prep";
    t.paused = false;
    t.endsAt = now;
    advance(now, true);
    if (wasPrep) sounds.workStart();
    if (RUNNING.includes(t.phase)) startTick();
    report();
    rerender();
  };

  useEffect(() => () => clearTick(), []);

  const t = timerRef.current;
  const phase = t.phase;
  const currentSet = t.set;
  const paused = t.paused;
  const isRunning = RUNNING.includes(phase);
  const remainingMs = isRunning ? Math.max(0, paused ? t.remainingMs : t.endsAt - Date.now()) : 0;
  const timeLeft = isRunning ? Math.ceil(remainingMs / 1000) : workSec;

  const running = isRunning;
  const phaseColor = phase === "prep" ? C.text : phase === "work" ? C.accent : phase === "rest" ? C.green : phase === "done" ? C.green : C.muted;
  const phaseBg = phase === "work" ? "rgba(232,176,75,0.07)" : phase === "rest" ? "rgba(76,195,138,0.07)" : "transparent";
  const completed = phase === "done" ? Math.min(t.completed, totalSets) : t.completed;
  const phaseTotal = phase === "prep" ? PREP_SEC : phase === "rest" ? restSec : workSec;
  // While running the ring drains from the exact time left to where it'll
  // be when the display next changes (the next whole second).
  const fraction = running ? (phaseTotal > 0 ? remainingMs / 1000 / phaseTotal : 0) : phase === "done" ? 0 : 1;
  const nextFraction = running && phaseTotal > 0 ? (timeLeft - 1) / phaseTotal : fraction;
  const drainMs = running ? Math.max(0, Math.round(remainingMs - (timeLeft - 1) * 1000)) : 0;

  return (
    <div>
      {phase === "idle" && (
        <div style={s.fieldGrid}>
          <NumberField label="Work" value={workSec} onChange={setWorkSec} min={1} suffix="s" />
          {!superset && <NumberField label="Rest" value={restSec} onChange={setRestSec} min={0} suffix="s" />}
          <NumberField label="Sets" value={totalSets} onChange={setTotalSets} min={1} />
          {weighted && <NumberField label="Weight" value={weight} onChange={setWeight} min={0} step={0.5} inc={2.5} suffix="kg" />}
        </div>
      )}

      <div style={{ ...s.timer, background: phaseBg }}>
        <div style={s.timerRing}>
          <Ring
            key={`${phase}-${currentSet}`}
            fraction={fraction}
            nextFraction={nextFraction}
            color={phaseColor}
            ms={drainMs}
            animate={running && !paused}
          />
          <div style={s.timerCenter}>
            {phase === "idle" && (
              <>
                <div style={{ ...s.phaseLabel, color: C.muted }}>READY</div>
                <div style={s.timerDigits}>{formatTime(workSec || 0)}</div>
                <div style={s.timerSub}>{totalSets} &times; {workSec}s{superset ? "" : ` / ${restSec}s`}{weighted ? ` @ ${formatWeightLabel(exercise.weightMode, weight)}` : ""}</div>
              </>
            )}
            {running && (
              <>
                <div style={{ ...s.phaseLabel, color: paused ? C.muted : phaseColor }}>{paused ? "PAUSED" : phase === "prep" ? "GET READY" : phase.toUpperCase()}</div>
                <div style={{ ...s.timerDigits, color: phaseColor }}>{formatTime(timeLeft)}</div>
                <div style={s.timerSub}>Set {currentSet} of {totalSets}</div>
              </>
            )}
            {phase === "next" && (
              <>
                <div style={{ ...s.phaseLabel, color: C.muted }}>NEXT SET</div>
                <div style={s.timerDigits}>{formatTime(workSec || 0)}</div>
                <div style={s.timerSub}>Set {currentSet} of {totalSets}</div>
              </>
            )}
            {phase === "done" && (
              <>
                <div style={{ color: C.green, marginBottom: 6 }}><Icon.check size={44} /></div>
                <div style={{ ...s.phaseLabel, color: C.green }}>DONE</div>
                <div style={s.timerSub}>{completed} / {totalSets} sets</div>
              </>
            )}
          </div>
        </div>
      </div>

      <div style={s.controls}>
        {phase === "idle" && (
          <button style={{ ...s.btnPrimary, ...s.btnBlock, minHeight: 56, fontSize: 18 }} onClick={start}>
            <Icon.play size={20} /> Start
          </button>
        )}
        {running && (
          <>
            <button style={{ ...(paused ? s.btnPrimary : s.btnSecondary), flex: 2, minHeight: 56 }} onClick={togglePause}>
              {paused ? <><Icon.play size={20} /> Resume</> : <><Icon.pause size={20} /> Pause</>}
            </button>
            <button style={{ ...s.btnSecondary, flex: 1, minHeight: 56, padding: 0 }} onClick={skip} aria-label="Skip phase">
              <Icon.skip size={22} />
            </button>
            <button style={{ ...s.btnSecondary, flex: 1, minHeight: 56, padding: 0 }} onClick={finishNow} aria-label="Finish exercise now">
              <Icon.flag size={22} />
            </button>
          </>
        )}
        {phase === "next" && (
          <>
            <button style={{ ...s.btnPrimary, flex: 3, minHeight: 56, fontSize: 18 }} onClick={beginWork}>
              <Icon.play size={20} /> Start set {currentSet}
            </button>
            <button style={{ ...s.btnSecondary, flex: 1, minHeight: 56, padding: 0 }} onClick={finishNow} aria-label="Finish exercise now">
              <Icon.flag size={22} />
            </button>
          </>
        )}
        {phase === "done" && (
          <button style={{ ...s.btnSecondary, ...s.btnBlock }} onClick={restart}>
            <Icon.restart size={18} /> Restart
          </button>
        )}
      </div>
    </div>
  );
}

// Circular countdown. Remounted (via key) at each phase change so it snaps to
// full instead of animating backwards.
function Ring({ fraction, nextFraction, ms, color, animate }) {
  const drain = useDrain(fraction, nextFraction, ms, animate);
  const size = 220, stroke = 10, r = (size - stroke) / 2, circ = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.surface2} strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={circ} strokeDashoffset={circ * (1 - Math.max(0, Math.min(1, drain.value)))}
        style={{ transition: drain.ms ? `stroke-dashoffset ${drain.ms}ms linear` : "none" }}
      />
    </svg>
  );
}
