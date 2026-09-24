import { s, C } from "../styles.js";
import { formatTime } from "../format.js";
import { sounds, getAudioCtx } from "../sounds.js";
import { NumberField } from "./NumberField.jsx";
import { Icon } from "./Icons.jsx";

const { useState, useEffect, useRef } = React;

// Reports its progress live via onChange (rather than a one-shot onComplete)
// so the containing page can read the current completedSets at any time,
// including mid-timer, when the workout is finished. Work/rest/sets are
// editable while idle (before Start), so a routine's timer values can be
// tweaked for this session without leaving to edit the exercise/routine.
export function IntervalCard({ exercise, onChange }) {
  const [phase, setPhase] = useState("idle"); // idle | work | rest | done
  const [workSec, setWorkSec] = useState(exercise.workSec);
  const [restSec, setRestSec] = useState(exercise.restSec);
  const [totalSets, setTotalSets] = useState(exercise.sets);
  const [currentSet, setCurrentSet] = useState(1);
  const [timeLeft, setTimeLeft] = useState(exercise.workSec);
  const [paused, setPaused] = useState(false);
  const intervalRef = useRef(null);
  const phaseRef = useRef("idle");
  const currentSetRef = useRef(1);
  const timeLeftRef = useRef(exercise.workSec);
  const completedRef = useRef(0);
  const configRef = useRef({ workSec: exercise.workSec, restSec: exercise.restSec, totalSets: exercise.sets });

  useEffect(() => {
    configRef.current = { workSec, restSec, totalSets };
  }, [workSec, restSec, totalSets]);

  const report = () => onChange({
    type: "interval",
    completedSets: completedRef.current,
    workSec: configRef.current.workSec,
    restSec: configRef.current.restSec,
    targetSets: configRef.current.totalSets,
  });

  const clearTick = () => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  };

  const finishNow = () => {
    clearTick();
    setPhase("done");
    report();
  };

  const runTick = () => {
    timeLeftRef.current -= 1;
    if (timeLeftRef.current <= 0) {
      if (phaseRef.current === "work") {
        completedRef.current += 1;
        report();
        if (currentSetRef.current >= configRef.current.totalSets) {
          phaseRef.current = "done";
          setPhase("done");
          clearTick();
          sounds.finish();
          return;
        }
        phaseRef.current = "rest";
        timeLeftRef.current = configRef.current.restSec;
        setPhase("rest");
        setTimeLeft(configRef.current.restSec);
        sounds.restStart();
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

  const start = () => {
    getAudioCtx();
    phaseRef.current = "work";
    currentSetRef.current = 1;
    timeLeftRef.current = configRef.current.workSec;
    completedRef.current = 0;
    setPhase("work");
    setCurrentSet(1);
    setTimeLeft(configRef.current.workSec);
    setPaused(false);
    sounds.workStart();
    intervalRef.current = setInterval(runTick, 1000);
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
    if (phaseRef.current === "rest") {
      currentSetRef.current += 1;
      phaseRef.current = "work";
      timeLeftRef.current = configRef.current.workSec;
      setPhase("work");
      setCurrentSet(currentSetRef.current);
      setTimeLeft(configRef.current.workSec);
    } else if (phaseRef.current === "work") {
      completedRef.current += 1;
      report();
      if (currentSetRef.current >= configRef.current.totalSets) {
        finishNow();
      } else {
        phaseRef.current = "rest";
        timeLeftRef.current = configRef.current.restSec;
        setPhase("rest");
        setTimeLeft(configRef.current.restSec);
      }
    }
  };

  useEffect(() => () => clearTick(), []);

  const running = phase === "work" || phase === "rest";
  const phaseColor = phase === "work" ? C.accent : phase === "rest" ? C.green : phase === "done" ? C.green : C.muted;
  const phaseBg = phase === "work" ? "rgba(232,176,75,0.07)" : phase === "rest" ? "rgba(76,195,138,0.07)" : "transparent";
  const completed = phase === "done" ? (completedRef.current >= totalSets ? totalSets : completedRef.current) : completedRef.current;
  const phaseTotal = phase === "rest" ? restSec : workSec;
  const fraction = running ? (phaseTotal > 0 ? timeLeft / phaseTotal : 0) : phase === "done" ? 0 : 1;

  return (
    <div>
      {phase === "idle" && (
        <div style={s.fieldGrid}>
          <NumberField label="Work" value={workSec} onChange={setWorkSec} min={1} suffix="s" />
          <NumberField label="Rest" value={restSec} onChange={setRestSec} min={0} suffix="s" />
          <NumberField label="Sets" value={totalSets} onChange={setTotalSets} min={1} />
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
                <div style={s.timerSub}>{totalSets} &times; {workSec}s / {restSec}s</div>
              </>
            )}
            {running && (
              <>
                <div style={{ ...s.phaseLabel, color: paused ? C.muted : phaseColor }}>{paused ? "PAUSED" : phase.toUpperCase()}</div>
                <div style={{ ...s.timerDigits, color: phaseColor }}>{formatTime(timeLeft)}</div>
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
