// The stretch player's timeline and clock, kept free of React so they can be
// tested on their own (stretchPlayer.test.mjs).
//
// A stretch routine plays as a flat list of phases: a "ready" lead-in, then
// for each stretch a hold (two holds with a "switch" between them when it's
// two-sided), with a "break" before the next stretch. A switch or break of 0
// seconds is left out.
//
// The clock runs off wall-clock deadlines like IntervalCard's, so it stays
// right while the page is throttled in the background, and its state is
// plain JSON so a reload can resume it:
//   { index, endsAt, durationMs, remainingMs (while paused), paused, finished, done[] }
// durationMs is the current phase's full length (+10s extends it), and done
// lists the indexes of the hold phases that were done.

export const READY_SEC = 5;
export const DEFAULT_SWITCH_SEC = 5;
export const DEFAULT_BREAK_SEC = 5;
// ⏮ restarts the current hold after this long; before it, it goes back one.
const RESTART_AFTER_MS = 3000;

// `stretches` are exercises with their routine step applied ({ holdSec,
// twoSided }); `routine` gives switchSec/breakSec.
export function buildTimeline(stretches, routine = {}) {
  const switchSec = routine.switchSec ?? DEFAULT_SWITCH_SEC;
  const breakSec = routine.breakSec ?? DEFAULT_BREAK_SEC;
  const phases = [{ kind: "ready", step: 0, side: 1, sec: READY_SEC }];
  stretches.forEach((ex, step) => {
    const holdSec = Math.max(1, Number(ex.holdSec) || 0);
    phases.push({ kind: "hold", step, side: 1, sec: holdSec });
    if (ex.twoSided) {
      if (switchSec > 0) phases.push({ kind: "switch", step, side: 2, sec: switchSec });
      phases.push({ kind: "hold", step, side: 2, sec: holdSec });
    }
    if (step < stretches.length - 1 && breakSec > 0) phases.push({ kind: "break", step: step + 1, side: 1, sec: breakSec });
  });
  return phases;
}

export function startState(phases, now) {
  return enter({ done: [], paused: false, finished: false }, phases, 0, now);
}

function enter(state, phases, index, at) {
  if (index >= phases.length) return { ...state, index: phases.length, finished: true, paused: false, endsAt: 0, durationMs: 0, remainingMs: 0 };
  const durationMs = phases[index].sec * 1000;
  return { ...state, index, finished: false, durationMs, endsAt: at + durationMs, remainingMs: durationMs };
}

const countHold = (state, index) => state.done.includes(index) ? state : { ...state, done: [...state.done, index] };

export function remainingMs(state, now) {
  if (state.finished) return 0;
  return Math.max(0, state.paused ? state.remainingMs : state.endsAt - now);
}

// Moves past every phase whose deadline is at or before now, each next
// phase starting at the previous deadline. Returns the new state and the
// phases entered, each with the time it started, so the caller can play a
// sound for the ones happening live.
export function advance(state, phases, now) {
  const entered = [];
  let next = state;
  while (!next.finished && !next.paused && next.endsAt <= now) {
    if (phases[next.index].kind === "hold") next = countHold(next, next.index);
    const at = next.endsAt;
    next = enter(next, phases, next.index + 1, at);
    entered.push({ index: next.index, at });
  }
  return { state: next, entered };
}

export function togglePause(state, now) {
  if (state.finished) return state;
  return state.paused
    ? { ...state, paused: false, endsAt: now + state.remainingMs }
    : { ...state, paused: true, remainingMs: remainingMs(state, now) };
}

// +10s and the like: lengthens the current phase.
export function extend(state, ms, now) {
  if (state.finished) return state;
  return {
    ...state,
    durationMs: state.durationMs + ms,
    ...(state.paused ? { remainingMs: state.remainingMs + ms } : { endsAt: Math.max(state.endsAt, now) + ms }),
  };
}

// Leaving a hold early still counts it once at least half of it was held.
function leave(state, phases, now) {
  if (state.finished || phases[state.index].kind !== "hold") return state;
  const held = state.durationMs - remainingMs(state, now);
  return held >= state.durationMs / 2 ? countHold(state, state.index) : state;
}

// Jumps to a phase, keeping the paused state.
function jump(state, phases, index, now) {
  const next = enter(leave(state, phases, now), phases, index, now);
  return next.finished || !state.paused ? { ...next, paused: false } : { ...next, paused: true };
}

// ⏭: on to the next hold (past any switch or break), or the end.
export function skipForward(state, phases, now) {
  if (state.finished) return state;
  let i = state.index + 1;
  while (i < phases.length && phases[i].kind !== "hold") i++;
  return jump(state, phases, i, now);
}

// ⏮: back to the start of this hold, or to the previous hold when this one
// only just started (or this is a switch, break or the end). The first hold
// just restarts; the lead-in stays as it is.
export function skipBack(state, phases, now) {
  const current = state.finished ? phases.length : state.index;
  const held = state.finished ? 0 : state.durationMs - remainingMs(state, now);
  const onHold = !state.finished && phases[current].kind === "hold";
  let i = current - 1;
  while (i >= 0 && phases[i].kind !== "hold") i--;
  if (onHold && (held >= RESTART_AFTER_MS || i < 0)) i = current;
  if (i < 0) return state;
  // The holds gone back over are to be done again.
  const done = state.done.filter(k => k < i);
  return { ...enter({ ...state, done }, phases, i, now), paused: state.paused && !state.finished };
}

// How far through the whole routine (0..1), by time.
export function progressFraction(state, phases, now) {
  if (state.finished) return 1;
  const total = phases.reduce((sum, p) => sum + p.sec * 1000, 0);
  const before = phases.slice(0, state.index).reduce((sum, p) => sum + p.sec * 1000, 0);
  const inPhase = Math.min(phases[state.index].sec * 1000, state.durationMs - remainingMs(state, now));
  return total > 0 ? Math.min(1, (before + inPhase) / total) : 1;
}

// The stretches with at least one hold done, as { step, sidesDone }, in order.
export function completedSteps(state, phases) {
  const counts = new Map();
  state.done.forEach(i => counts.set(phases[i].step, (counts.get(phases[i].step) || 0) + 1));
  return [...counts].sort((a, b) => a[0] - b[0]).map(([step, sidesDone]) => ({ step, sidesDone }));
}
