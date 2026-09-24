import { s, C } from "../styles.js";
import { formatTime, isStepComplete } from "../format.js";
import { sounds } from "../sounds.js";
import { ExerciseCard } from "./ExerciseCard.jsx";
import { Header } from "./Layout.jsx";
import { RestBar } from "./RestBar.jsx";
import { Icon } from "./Icons.jsx";

const { useState, useEffect, useRef } = React;

function ElapsedTime({ since }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return formatTime(Math.max(0, Math.floor((now - since) / 1000)));
}

// Keep the screen on during a workout - timers and rest beeps are useless if
// the phone locks between sets. The lock is dropped by the browser whenever
// the page is hidden, so re-acquire it on return.
function useWakeLock() {
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let lock = null;
    let active = true;
    const acquire = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const l = await navigator.wakeLock.request("screen");
        if (active) lock = l; else l.release().catch(() => {});
      } catch {}
    };
    const onVisible = () => { if (document.visibilityState === "visible") acquire(); };
    acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisible);
      if (lock) lock.release().catch(() => {});
    };
  }, []);
}

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
  const [interRest, setInterRest] = useState(null); // { afterPos, timeLeft, total, paused }
  const intervalRef = useRef(null);
  const timeLeftRef = useRef(0);

  useWakeLock();

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
    setInterRest({ afterPos, timeLeft: restAfterSec, total: restAfterSec, paused: false });
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
    <>
      <Header
        title={session.kind === "routine" ? session.refName : session.exercises[0]?.name}
        subtitle={<ElapsedTime since={session.startedAt} />}
        left={<button style={{ ...s.textBtn, color: C.muted }} onClick={onCancel}>Cancel</button>}
        right={null}
      />
      <div style={s.pageWithBottomBar}>
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
              <RestBar
                label="Next exercise in"
                tone="accent"
                timeLeft={interRest.timeLeft}
                total={interRest.total}
                paused={interRest.paused}
                onTogglePause={toggleInterRestPause}
                onSkip={skipInterRest}
              />
            )}
          </React.Fragment>
        ))}
      </div>
      <div style={s.bottomBar}>
        <button style={{ ...s.btnPrimary, ...s.btnBlock, minHeight: 54 }} onClick={onFinish}>
          <Icon.flag size={20} /> Finish workout
        </button>
      </div>
    </>
  );
}
