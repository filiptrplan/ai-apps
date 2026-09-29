import { s, d, C } from "../styles.js";
import { formatTime, isStepComplete, groupSteps } from "../format.js";
import { ExerciseCard } from "./ExerciseCard.jsx";
import { Header, useIsDesktop } from "./Layout.jsx";
import { RestBar, RestDockContext } from "./RestBar.jsx";
import { useRestTimer } from "./useRestTimer.js";
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
// current display order, a non-blocking rest countdown starts - advisory
// only, it never locks the other cards. All rest bars (these and the cards'
// between-set rests) render in a dock pinned under the header.
//
// Supersets (consecutive exercises sharing a supersetGroup) are one block:
// they move together, their cards run with no per-set rest (an interval
// member runs one work phase per set, each started by a tap), and a "Next
// round" rest (the last member's restSec) starts once every member has one
// more set ticked. The last member's restAfterSec applies after the block.
export function SessionPage({ session, onCancel, onLogChange, onFinish }) {
  const [order, setOrder] = useState(() => groupSteps(session.exercises.map((_, i) => i), i => session.exercises[i].supersetGroup || null));
  const completedRef = useRef(session.exercises.map(() => false));
  const doneCountRef = useRef(session.exercises.map(() => 0));
  // Superset members log without their own between-set rest; the block's
  // round rest replaces it. Interval members keep restSec (so it isn't
  // logged as changed) and skip their rest phase via IntervalCard's superset mode.
  const [cardExercises] = useState(() => session.exercises.map(ex => ex.supersetGroup && ex.type !== "interval" ? { ...ex, restSec: 0 } : ex));
  const interRestTimer = useRestTimer();
  const interRest = interRestTimer.rest; // { label, timeLeft, total, paused }

  const [restDock, setRestDock] = useState(null);

  const desktop = useIsDesktop();
  useWakeLock();

  const startInterRest = (restAfterSec, label = "Next exercise in") => {
    const notice = label === "Next round in" ? "Next superset round" : "Next exercise";
    interRestTimer.start(restAfterSec, { label, notice });
  };
  const skipInterRest = interRestTimer.stop;

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
    const pos = order.findIndex(block => block.includes(exIdx));
    if (pos === -1) return;
    const block = order[pos];
    const last = session.exercises[block[block.length - 1]];
    const isLastPos = pos === order.length - 1;

    const wasBlockComplete = block.every(i => completedRef.current[i]);
    const prevRound = Math.min(...block.map(i => doneCountRef.current[i]));
    completedRef.current[exIdx] = isStepComplete(exercise, log);
    doneCountRef.current[exIdx] = exercise.type === "interval"
      ? (log?.completedSets || 0)
      : (log?.rows || []).filter(r => r.done).length;
    const blockComplete = block.every(i => completedRef.current[i]);
    const round = Math.min(...block.map(i => doneCountRef.current[i]));

    if (blockComplete && !wasBlockComplete) {
      if (last.restAfterSec > 0 && !isLastPos) startInterRest(last.restAfterSec);
    } else if (block.length > 1 && !blockComplete && round > prevRound && last.restSec > 0) {
      startInterRest(last.restSec, "Next round in");
    }
  };

  return (
    <RestDockContext.Provider value={restDock}>
      <div style={s.sessionTop}>
        <Header
          title={session.kind === "routine" ? session.refName : session.exercises[0]?.name}
          subtitle={<ElapsedTime since={session.startedAt} />}
          left={<button style={{ ...s.textBtn, color: C.muted }} onClick={onCancel}>Cancel</button>}
          right={null}
        />
        <div ref={setRestDock} style={{ ...s.restDock, ...(desktop && d.restDock) }} />
      </div>
      <div style={{ ...s.pageWithBottomBar, ...(desktop && { ...d.pageWithBottomBar, ...d.cardGrid }) }}>
        {order.map((block, position) => {
          const isSuperset = block.length > 1;
          const cards = block.map((exIdx, k) => (
            <ExerciseCard
              key={exIdx}
              exercise={cardExercises[exIdx]}
              position={position}
              total={order.length}
              label={isSuperset ? `${position + 1}${String.fromCharCode(65 + k)}` : null}
              onChange={log => handleCardChange(exIdx, log)}
              onMove={dir => moveCard(position, dir)}
            />
          ));
          return (
            <React.Fragment key={block[0]}>
              {isSuperset ? (
                <div style={{ ...s.supersetBlock, ...(desktop && { ...d.fullRow, marginBottom: 0 }) }}>
                  <div style={s.supersetLabel}><Icon.link size={14} /> Superset · alternate sets</div>
                  <div style={desktop ? d.cardGrid : undefined}>{cards}</div>
                </div>
              ) : cards}
            </React.Fragment>
          );
        })}
      </div>
      {interRest && (
        <RestBar
          label={interRest.label}
          tone="accent"
          timeLeft={interRest.timeLeft}
          total={interRest.total}
          paused={interRest.paused}
          onTogglePause={interRestTimer.togglePause}
          onSkip={skipInterRest}
        />
      )}
      <div style={{ ...s.bottomBar, ...(desktop && d.bottomBar) }}>
        <button style={{ ...s.btnPrimary, ...s.btnBlock, minHeight: 54, ...(desktop && d.bottomBarBtn) }} onClick={onFinish}>
          <Icon.flag size={20} /> Finish workout
        </button>
      </div>
    </RestDockContext.Provider>
  );
}
