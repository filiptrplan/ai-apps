import { s, C } from "../styles.js";
import { formatTime, formatWeightLabel } from "../format.js";
import { sounds, getAudioCtx } from "../sounds.js";
import { NumberField } from "./NumberField.jsx";
import { Icon } from "./Icons.jsx";

const { useState, useEffect, useRef } = React;

const PREP_SEC = 5; // "get ready" countdown before each tapped start

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
// initialLog (a workout restored after a reload) brings back the edited
// values and completed sets. A timer that was mid-run comes back waiting on
// "Start set N" (the "next" phase), resuming at the first unfinished set.
export function IntervalCard({ exercise, initialLog, superset, onChange }) {
  const [init] = useState(() => {
    const cfg = {
      workSec: initialLog?.workSec ?? exercise.workSec,
      restSec: initialLog?.restSec ?? exercise.restSec,
      totalSets: initialLog?.targetSets ?? exercise.sets,
      weight: initialLog?.weight ?? exercise.weight,
    };
    const completed = initialLog?.completedSets || 0;
    const phase = completed === 0 ? "idle" : completed >= cfg.totalSets ? "done" : "next";
    return { cfg, completed, phase, currentSet: phase === "next" ? completed + 1 : 1 };
  });
  const [phase, setPhase] = useState(init.phase); // idle | prep | work | rest | next | done
  const [workSec, setWorkSec] = useState(init.cfg.workSec);
  const [restSec, setRestSec] = useState(init.cfg.restSec);
  const [totalSets, setTotalSets] = useState(init.cfg.totalSets);
  const [weight, setWeight] = useState(init.cfg.weight);
  const weighted = exercise.type === "weightedInterval";
  const [currentSet, setCurrentSet] = useState(init.currentSet);
  const [timeLeft, setTimeLeft] = useState(init.cfg.workSec);
  const [paused, setPaused] = useState(false);
  const intervalRef = useRef(null);
  const phaseRef = useRef(init.phase);
  const currentSetRef = useRef(init.currentSet);
  const timeLeftRef = useRef(init.cfg.workSec);
  const completedRef = useRef(init.completed);
  const configRef = useRef(init.cfg);

  // Values edited before Start are reported too, so they survive a reload.
  useEffect(() => {
    configRef.current = { workSec, restSec, totalSets, weight };
    if (phaseRef.current === "idle") report();
  }, [workSec, restSec, totalSets, weight]);

  const report = () => onChange({
    type: exercise.type,
    completedSets: completedRef.current,
    workSec: configRef.current.workSec,
    restSec: configRef.current.restSec,
    targetSets: configRef.current.totalSets,
    ...(weighted && { weight: configRef.current.weight }),
  });

  const clearTick = () => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  };

  const finishNow = () => {
    clearTick();
    phaseRef.current = "done";
    setPhase("done");
    report();
  };

  // Ends the current work phase and counts it. In a superset there's no rest
  // phase: the card waits for a tap to start the next set, since the other
  // members and the round rest happen in between.
  const endWork = (silent) => {
    completedRef.current += 1;
    report();
    if (currentSetRef.current >= configRef.current.totalSets) {
      clearTick();
      phaseRef.current = "done";
      setPhase("done");
      if (!silent) sounds.finish();
      return;
    }
    if (superset) {
      clearTick();
      currentSetRef.current += 1;
      phaseRef.current = "next";
      timeLeftRef.current = configRef.current.workSec;
      setPhase("next");
      setCurrentSet(currentSetRef.current);
      setTimeLeft(configRef.current.workSec);
      if (!silent) sounds.restStart();
      return;
    }
    phaseRef.current = "rest";
    timeLeftRef.current = configRef.current.restSec;
    setPhase("rest");
    setTimeLeft(configRef.current.restSec);
    if (!silent) sounds.restStart();
  };

  const runTick = () => {
    timeLeftRef.current -= 1;
    if (timeLeftRef.current <= 0) {
      if (phaseRef.current === "prep") {
        enterWork();
      } else if (phaseRef.current === "work") {
        endWork(false);
      } else if (phaseRef.current === "rest") {
        currentSetRef.current += 1;
        phaseRef.current = "work";
        timeLeftRef.current = configRef.current.workSec;
        setPhase("work");
        setCurrentSet(currentSetRef.current);
        setTimeLeft(configRef.current.workSec);
        sounds.workStart();
      }
    } else {
      setTimeLeft(timeLeftRef.current);
      if (timeLeftRef.current <= 3 && timeLeftRef.current >= 1) sounds.countdown();
    }
  };

  const enterWork = () => {
    phaseRef.current = "work";
    timeLeftRef.current = configRef.current.workSec;
    setPhase("work");
    setTimeLeft(configRef.current.workSec);
    sounds.workStart();
  };

  const beginWork = () => {
    getAudioCtx(); // unlock audio on user gesture
    clearTick();
    phaseRef.current = "prep";
    timeLeftRef.current = PREP_SEC;
    setPhase("prep");
    setTimeLeft(PREP_SEC);
    setPaused(false);
    intervalRef.current = setInterval(runTick, 1000);
  };

  const start = () => {
    currentSetRef.current = 1;
    completedRef.current = 0;
    setCurrentSet(1);
    beginWork();
  };

  const restart = () => {
    clearTick();
    completedRef.current = 0;
    phaseRef.current = "idle";
    currentSetRef.current = 1;
    timeLeftRef.current = configRef.current.workSec;
    setPhase("idle");
    setCurrentSet(1);
    setTimeLeft(configRef.current.workSec);
    setPaused(false);
    report();
  };

  const togglePause = () => {
    if (paused) {
      intervalRef.current = setInterval(runTick, 1000);
      setPaused(false);
    } else {
      clearTick();
      setPaused(true);
    }
  };

  const skip = () => {
    if (phaseRef.current === "prep") {
      enterWork();
    } else if (phaseRef.current === "rest") {
      currentSetRef.current += 1;
      phaseRef.current = "work";
      timeLeftRef.current = configRef.current.workSec;
      setPhase("work");
      setCurrentSet(currentSetRef.current);
      setTimeLeft(configRef.current.workSec);
    } else if (phaseRef.current === "work") {
      endWork(true);
    }
  };

  useEffect(() => () => clearTick(), []);

  const running = phase === "prep" || phase === "work" || phase === "rest";
  const phaseColor = phase === "prep" ? C.text : phase === "work" ? C.accent : phase === "rest" ? C.green : phase === "done" ? C.green : C.muted;
  const phaseBg = phase === "work" ? "rgba(232,176,75,0.07)" : phase === "rest" ? "rgba(76,195,138,0.07)" : "transparent";
  const completed = phase === "done" ? (completedRef.current >= totalSets ? totalSets : completedRef.current) : completedRef.current;
  const phaseTotal = phase === "prep" ? PREP_SEC : phase === "rest" ? restSec : workSec;
  const fraction = running ? (phaseTotal > 0 ? timeLeft / phaseTotal : 0) : phase === "done" ? 0 : 1;

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
            color={phaseColor}
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
function Ring({ fraction, color, animate }) {
  const size = 220, stroke = 10, r = (size - stroke) / 2, circ = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.surface2} strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={circ} strokeDashoffset={circ * (1 - Math.max(0, Math.min(1, fraction)))}
        style={{ transition: animate ? "stroke-dashoffset 1s linear" : "none" }}
      />
    </svg>
  );
}
