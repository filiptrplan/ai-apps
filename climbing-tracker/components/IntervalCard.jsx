import { s } from "../styles.js";
import { formatTime } from "../format.js";
import { sounds, getAudioCtx } from "../sounds.js";
import { NumberField } from "./NumberField.jsx";

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
  const phaseColor = phase === "work" ? "#D9A441" : phase === "rest" ? "#3A9E6E" : "#888";
  const phaseBg = phase === "work" ? "rgba(217,164,65,0.08)" : phase === "rest" ? "rgba(58,158,110,0.08)" : "transparent";
  const completed = phase === "done" ? (completedRef.current >= totalSets ? totalSets : completedRef.current) : completedRef.current;

  return (
    <div>
      {phase === "idle" && (
        <div style={s.fieldRow}>
          <NumberField label="Work" value={workSec} onChange={setWorkSec} min={1} suffix="s" />
          <NumberField label="Rest" value={restSec} onChange={setRestSec} min={0} suffix="s" />
          <NumberField label="Sets" value={totalSets} onChange={setTotalSets} min={1} />
        </div>
      )}

      <div style={{ ...s.timerBox, background: phaseBg }}>
        {phase === "idle" && (
          <>
            <div style={s.timerDigits}>{formatTime(workSec)}</div>
            <div style={s.timerSub}>{totalSets} sets &middot; {formatTime(workSec)} on &middot; {formatTime(restSec)} off</div>
          </>
        )}
        {running && (
          <>
            <div style={{ ...s.phaseLabel, color: phaseColor }}>{phase.toUpperCase()}</div>
            <div style={{ ...s.timerDigits, color: phaseColor }}>{formatTime(timeLeft)}</div>
            <div style={s.timerSub}>Set {currentSet} / {totalSets}</div>
            {paused && <div style={{ ...s.phaseLabel, color: "#F0AD4E", marginTop: 8, fontSize: 13 }}>PAUSED</div>}
          </>
        )}
        {phase === "done" && (
          <>
            <div style={{ ...s.phaseLabel, color: "#3A9E6E" }}>DONE</div>
            <div style={s.timerSub}>{completed} / {totalSets} sets completed</div>
          </>
        )}
      </div>

      <div style={s.controls}>
        {phase === "idle" && <button style={s.startBtn} onClick={start}>Start</button>}
        {running && (
          <>
            <button style={s.pauseBtn} onClick={togglePause}>{paused ? "Resume" : "Pause"}</button>
            <button style={s.skipBtn} onClick={skip}>Skip</button>
            <button style={s.stopBtn} onClick={finishNow}>Finish now</button>
          </>
        )}
        {phase === "done" && (
          <button style={s.exportBtn} onClick={restart}>Restart</button>
        )}
      </div>
    </div>
  );
}
