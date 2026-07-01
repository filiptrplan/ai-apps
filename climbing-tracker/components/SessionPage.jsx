import { s } from "../styles.js";
import { formatTime, isStepComplete } from "../format.js";
import { sounds } from "../sounds.js";
import { ExerciseCard } from "./ExerciseCard.jsx";

const { useState, useEffect, useRef } = React;

// All exercises in the session are shown on one page at once, so a routine
// can be worked through in whatever order feels right rather than a forced
// step-by-step sequence. Each card reports its live progress via onLogChange;
// "Finish workout" reads whatever has been ticked/logged so far.
//
// A step can carry a "restAfterSec" (set per-routine-step, see startRoutine):
// when a card newly becomes fully complete, and it isn't the last card in the
// current display order, a non-blocking rest countdown appears before the
// next card - advisory only, it never locks the other cards.
export function SessionPage({ session, onCancel, onLogChange, onFinish }) {
  const [order, setOrder] = useState(() => session.exercises.map((_, i) => i));
  const completedRef = useRef(session.exercises.map(() => false));
  const [interRest, setInterRest] = useState(null); // { afterPos, timeLeft, paused }
  const intervalRef = useRef(null);
  const timeLeftRef = useRef(0);

  const clearTick = () => { if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; } };

  const tick = () => {
    timeLeftRef.current -= 1;
    if (timeLeftRef.current <= 0) {
      clearTick();
      sounds.workStart();
      setInterRest(null);
    } else {
      setInterRest(r => r && { ...r, timeLeft: timeLeftRef.current });
      if (timeLeftRef.current <= 3 && timeLeftRef.current >= 1) sounds.countdown();
    }
  };

  const startInterRest = (afterPos, restAfterSec) => {
    clearTick();
    timeLeftRef.current = restAfterSec;
    setInterRest({ afterPos, timeLeft: restAfterSec, paused: false });
    sounds.restStart();
    intervalRef.current = setInterval(tick, 1000);
  };

  const skipInterRest = () => { clearTick(); setInterRest(null); };
  const toggleInterRestPause = () => {
    setInterRest(r => {
      if (!r) return r;
      if (r.paused) { intervalRef.current = setInterval(tick, 1000); return { ...r, paused: false }; }
      clearTick();
      return { ...r, paused: true };
    });
  };

  useEffect(() => () => clearTick(), []);

  const moveCard = (position, dir) => {
    skipInterRest();
    setOrder(o => {
      const arr = [...o];
      const j = position + dir;
      if (j < 0 || j >= arr.length) return o;
      [arr[position], arr[j]] = [arr[j], arr[position]];
      return arr;
    });
  };

  const handleCardChange = (exIdx, log) => {
    onLogChange(exIdx, log);
    const exercise = session.exercises[exIdx];
    const wasComplete = completedRef.current[exIdx];
    const nowComplete = isStepComplete(exercise, log);
    completedRef.current[exIdx] = nowComplete;
    if (nowComplete && !wasComplete && exercise.restAfterSec > 0) {
      const pos = order.indexOf(exIdx);
      if (pos !== -1 && pos < order.length - 1) startInterRest(pos, exercise.restAfterSec);
    }
  };

  return (
    <div style={s.page}>
      <div style={s.sessionTopBar}>
        <button style={s.cancelBtn} onClick={onCancel}>Cancel</button>
        <div style={s.sessionTitle}>{session.kind === "routine" ? session.refName : "Exercise"}</div>
      </div>
      {order.map((exIdx, position) => (
        <React.Fragment key={exIdx}>
          <ExerciseCard
            exercise={session.exercises[exIdx]}
            position={position}
            total={order.length}
            onChange={log => handleCardChange(exIdx, log)}
            onMove={dir => moveCard(position, dir)}
          />
          {interRest && interRest.afterPos === position && (
            <div style={s.interRestBanner}>
              <span style={s.interRestLabel}>Rest before next exercise: {formatTime(interRest.timeLeft)}</span>
              <button style={s.restBtn} onClick={toggleInterRestPause}>{interRest.paused ? "Resume" : "Pause"}</button>
              <button style={s.restBtn} onClick={skipInterRest}>Skip</button>
            </div>
          )}
        </React.Fragment>
      ))}
      <button style={s.startBtn} onClick={onFinish}>Finish workout</button>
    </div>
  );
}
