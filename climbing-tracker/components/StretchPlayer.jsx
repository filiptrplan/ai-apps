import { s, d, C } from "../styles.js";
import { formatTime, formatDuration, formatTargetSummary } from "../format.js";
import {
  buildTimeline, startState, advance, togglePause, extend, skipForward, skipBack,
  remainingMs, progressFraction, completedSteps,
} from "../stretchPlayer.js";
import { sounds, getAudioCtx } from "../sounds.js";
import { Icon } from "./Icons.jsx";
import { useDrain } from "./useDrain.js";
import { useWakeLock } from "./useWakeLock.js";
import { useIsDesktop } from "./Layout.jsx";
import { useExercisePhotos, PhotoViewer } from "./ExercisePhoto.jsx";

const { useState, useEffect, useRef } = React;

const PHASE_LABEL = { ready: "Get ready", hold: "Hold", switch: "Switch sides", break: "Break" };
const EXTEND_MS = 10 * 1000;

// The full-screen stretch player: plays a stretch routine (or one stretch)
// on its own, hold by hold (see stretchPlayer.js for the timeline and the
// clock). The picture sits in a rounded frame whose border drains as the
// phase runs out; between stretches it shows the next one.
//
// session.exercises are the stretches with their routine steps applied,
// session.timing the routine's { switchSec, breakSec }. The clock state is
// reported through onStateChange so a reload resumes it (initialState).
// Finishing calls onFinish with [{ index, sidesDone }] for the stretches
// done; closing early asks whether to log what's done or discard it.
export function StretchPlayer({ session, initialState, onStateChange, onFinish, onDiscard }) {
  const desktop = useIsDesktop();
  const [phases] = useState(() => buildTimeline(session.exercises, session.timing));
  const [state, setState] = useState(() => {
    const restored = initialState && initialState.index != null ? initialState : startState(phases, Date.now());
    return advance(restored, phases, Date.now()).state;
  });
  const [closing, setClosing] = useState(null); // { wasPaused } while the close dialog is up
  const [viewing, setViewing] = useState(null);
  const [, setFrame] = useState(0);
  const stateRef = useRef(state);
  const lastSecRef = useRef(null);
  useWakeLock();

  // The tick outlives the render that set it up.
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;
  const commit = (next) => {
    stateRef.current = next;
    setState(next);
    onStateChangeRef.current(next);
  };
  useEffect(() => { onStateChange(state); }, []);

  // Each tick plays through whatever phases have ended, with a sound for a
  // change happening now (not one caught up on after the page was away).
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const current = stateRef.current;
      const { state: next, entered } = advance(current, phases, now);
      if (next !== current) {
        const live = entered.filter(e => now - e.at < 1500);
        if (live.length > 0) {
          const last = live[live.length - 1];
          if (next.finished) sounds.finish();
          else if (phases[last.index].kind === "hold") sounds.workStart();
          else sounds.restStart();
        }
        commit(next);
        return;
      }
      if (next.finished || next.paused) return;
      const sec = Math.ceil((next.endsAt - now) / 1000);
      if (sec !== lastSecRef.current) {
        lastSecRef.current = sec;
        if (sec <= 3 && sec >= 1) sounds.countdown();
        setFrame(f => f + 1);
      }
    };
    const id = setInterval(tick, 250);
    const onVisible = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  const act = (fn) => () => {
    getAudioCtx(); // unlock audio on a tap
    commit(fn(stateRef.current, Date.now()));
  };
  const pauseToggle = act(togglePause);
  const back = act((st, now) => skipBack(st, phases, now));
  const forward = act((st, now) => skipForward(st, phases, now));
  const plusTen = act((st, now) => extend(st, EXTEND_MS, now));

  const done = completedSteps(state, phases);
  const total = session.exercises.length;
  const finish = () => onFinish(done.map(x => ({ index: x.step, sidesDone: x.sidesDone })));
  const requestClose = () => {
    if (done.length === 0 && !state.finished) return onDiscard();
    const wasPaused = stateRef.current.paused;
    if (!wasPaused && !state.finished) commit(togglePause(stateRef.current, Date.now()));
    setClosing({ wasPaused });
  };
  const keepGoing = () => {
    if (!closing.wasPaused && stateRef.current.paused) commit(togglePause(stateRef.current, Date.now()));
    setClosing(null);
  };

  const now = Date.now();
  const phase = state.finished ? null : phases[state.index];
  const exercise = session.exercises[phase ? phase.step : total - 1];
  const left = remainingMs(state, now);
  const timeLeft = Math.ceil(left / 1000);
  const durationMs = state.durationMs || 1;
  const fraction = left / durationMs;
  const nextFraction = Math.max(0, (timeLeft - 1) * 1000 / durationMs);
  const drainMs = Math.max(0, Math.round(left - (timeLeft - 1) * 1000));
  const running = !!phase && !state.paused;
  const holding = phase?.kind === "hold";
  const color = state.paused ? C.muted : holding ? C.accent : C.green;
  const upNext = phase && (phase.kind === "ready" || phase.kind === "break");

  const shell = { ...s.player, ...(desktop && d.player) };

  if (state.finished) {
    const sides = done.reduce((sum, x) => sum + x.sidesDone, 0);
    return (
      <div style={shell}>
        <div style={s.playerDone}>
          <div style={{ color: C.green }}><Icon.check size={64} /></div>
          <div style={s.playerDoneTitle}>Done</div>
          <div style={s.playerDoneSub}>
            {formatDuration(Math.round((Date.now() - session.startedAt) / 1000))} · {done.length} of {total} stretch{total === 1 ? "" : "es"}
            {sides > done.length ? ` · ${sides} holds` : ""}
          </div>
          <div style={{ ...s.btnRow, width: "100%", maxWidth: 360, marginTop: 28 }}>
            <button style={{ ...s.btnSecondary, flex: 1, minHeight: 54 }} onClick={back}>
              <Icon.skipBack size={20} /> Back
            </button>
            <button style={{ ...s.btnPrimary, flex: 2, minHeight: 54 }} onClick={done.length > 0 ? finish : onDiscard}>
              {done.length > 0 ? "Save & close" : "Close"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={shell}>
      <div style={s.playerTop}>
        <button style={{ ...s.iconBtn, color: C.text }} onClick={requestClose} aria-label="Close"><Icon.x /></button>
        <div style={s.playerTitle}>{session.refName}</div>
        <div style={s.playerCount}>{phase.step + 1} / {total}</div>
      </div>
      <div style={s.playerProgress}>
        <div style={{ ...s.playerProgressFill, width: `${progressFraction(state, phases, now) * 100}%` }} />
      </div>

      <div style={s.playerMain}>
        <FramedPicture
          key={`${state.index}`}
          exercise={exercise}
          label={upNext ? "Up next" : null}
          color={color}
          fraction={fraction}
          nextFraction={nextFraction}
          ms={drainMs}
          animate={running}
        />

        <div style={{ ...s.phaseLabel, color, marginTop: 22 }}>{state.paused ? "PAUSED" : PHASE_LABEL[phase.kind].toUpperCase()}</div>
        <div style={{ ...s.playerDigits, color: holding ? C.text : color }}>{formatTime(timeLeft)}</div>
        <button style={s.playerName} onClick={() => setViewing(exercise)}>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{exercise.name}</span>
          <span style={{ color: C.dim, display: "flex", flexShrink: 0 }}><Icon.info size={18} /></span>
        </button>
        <div style={s.playerSub}>
          {upNext ? formatTargetSummary(exercise) : exercise.twoSided ? `Side ${phase.side} of 2` : " "}
        </div>
      </div>

      <div style={s.playerControls}>
        <button style={s.playerBtn} onClick={back} aria-label="Previous"><Icon.skipBack size={24} /></button>
        <button style={{ ...s.playerBtn, ...s.playerBtnMain }} onClick={pauseToggle} aria-label={state.paused ? "Resume" : "Pause"}>
          {state.paused ? <Icon.play size={30} /> : <Icon.pause size={30} />}
        </button>
        <button style={s.playerBtn} onClick={forward} aria-label="Next"><Icon.skip size={24} /></button>
        <button style={{ ...s.playerBtn, fontSize: 15, fontWeight: 700 }} onClick={plusTen} aria-label="Add 10 seconds">+10s</button>
      </div>

      {closing && (
        <div style={s.overlay} onClick={keepGoing}>
          <div style={{ ...s.sheet, padding: "20px 20px calc(20px + env(safe-area-inset-bottom, 0px))" }} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Stop stretching?">
            <div style={{ ...s.sheetTitle, marginBottom: 8 }}>Stop stretching?</div>
            <p style={s.sheetMessage}>
              {done.length > 0
                ? `You've done ${done.length} of ${total} stretch${total === 1 ? "" : "es"}. Log what's done to your history?`
                : "Nothing is done yet, so there's nothing to log."}
            </p>
            {done.length > 0 && (
              <button style={{ ...s.btnPrimary, ...s.btnBlock, marginBottom: 10 }} onClick={finish}>
                Log {done.length} of {total}
              </button>
            )}
            <div style={s.btnRow}>
              <button style={{ ...s.btnSecondary, flex: 1, color: C.danger }} onClick={onDiscard}>Discard</button>
              <button style={{ ...s.btnSecondary, flex: 1 }} onClick={keepGoing}>Keep going</button>
            </div>
          </div>
        </div>
      )}

      {viewing && <PhotoViewer exercise={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

// The border of a 100×100 rounded square, starting at the top centre and
// going clockwise, so the countdown empties like a clock hand sweeping round.
const FRAME_INSET = 1.5, FRAME_RADIUS = 7;
const FRAME_PATH = (() => {
  const a = FRAME_INSET, b = 100 - FRAME_INSET, r = FRAME_RADIUS;
  return `M 50 ${a} H ${b - r} A ${r} ${r} 0 0 1 ${b} ${a + r} V ${b - r} A ${r} ${r} 0 0 1 ${b - r} ${b}`
    + ` H ${a + r} A ${r} ${r} 0 0 1 ${a} ${b - r} V ${a + r} A ${r} ${r} 0 0 1 ${a + r} ${a} Z`;
})();

// The stretch's picture in a rounded frame whose border is the countdown.
// Remounted (via key) at each phase so it snaps back to full. Tapping the
// picture shows the other photo.
function FramedPicture({ exercise, label, color, fraction, nextFraction, ms, animate }) {
  const urls = useExercisePhotos(exercise);
  const [photo, setPhoto] = useState(0);
  const drain = useDrain(fraction, nextFraction, ms, animate);
  const value = Math.max(0, Math.min(1, drain.value));
  return (
    <div style={s.frame}>
      <button
        style={s.frameInner}
        onClick={() => urls.length > 1 && setPhoto((photo + 1) % urls.length)}
        aria-label={urls.length > 1 ? "Show the other picture" : exercise.name}
      >
        {urls.length > 0
          ? <img src={urls[photo]} alt="" style={s.frameImg} />
          : <span style={s.framePlaceholder}><Icon.stretch size={56} /><span>{exercise.name}</span></span>}
        {label && <span style={s.frameLabel}>{label}</span>}
      </button>
      {/* Dash 100, gap 100 over a path of length 100: an offset of -k hides
          the first k, so what's left runs from k round to the top. */}
      <svg style={s.frameRing} viewBox="0 0 100 100" aria-hidden="true">
        <path d={FRAME_PATH} fill="none" stroke={C.surface2} strokeWidth={FRAME_INSET * 2} />
        <path
          d={FRAME_PATH} fill="none" stroke={color} strokeWidth={FRAME_INSET * 2}
          pathLength="100" strokeDasharray="100 100" strokeDashoffset={-100 * (1 - value)}
          style={{ transition: drain.ms ? `stroke-dashoffset ${drain.ms}ms linear` : "none" }}
        />
      </svg>
    </div>
  );
}
