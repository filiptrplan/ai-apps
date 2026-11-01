import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTimeline, startState, advance, togglePause, extend, skipForward, skipBack,
  remainingMs, progressFraction, completedSteps, READY_SEC,
} from "./stretchPlayer.js";
import { applyRoutineStep, buildPerformedFromLog, formatPerformedSummary, formatTargetSummary } from "./format.js";

const S = 1000;
const one = { holdSec: 30, twoSided: false };
const two = { holdSec: 20, twoSided: true };
const kinds = phases => phases.map(p => `${p.kind}:${p.step}.${p.side}:${p.sec}`);

test("the timeline has a lead-in, a hold per side, switches and breaks", () => {
  const phases = buildTimeline([two, one], { switchSec: 3, breakSec: 4 });
  assert.deepEqual(kinds(phases), [
    `ready:0.1:${READY_SEC}`, "hold:0.1:20", "switch:0.2:3", "hold:0.2:20", "break:1.1:4", "hold:1.1:30",
  ]);
});

test("zero-second switches and breaks are left out, and the defaults are 5s", () => {
  assert.deepEqual(kinds(buildTimeline([two, one], { switchSec: 0, breakSec: 0 })), [
    "ready:0.1:5", "hold:0.1:20", "hold:0.2:20", "hold:1.1:30",
  ]);
  assert.deepEqual(kinds(buildTimeline([one, one])), ["ready:0.1:5", "hold:0.1:30", "break:1.1:5", "hold:1.1:30"]);
});

test("the clock plays through the phases and counts the holds", () => {
  const phases = buildTimeline([two, one], { switchSec: 3, breakSec: 4 });
  let state = startState(phases, 0);
  assert.equal(state.index, 0);
  assert.equal(remainingMs(state, 2 * S), 3 * S);

  // Catching up across several phases at once: each starts where the last ended.
  const { state: later, entered } = advance(state, phases, 30 * S);
  assert.deepEqual(entered.map(e => [e.index, e.at]), [[1, 5 * S], [2, 25 * S], [3, 28 * S]]);
  assert.equal(later.index, 3);
  assert.equal(remainingMs(later, 30 * S), 18 * S);
  assert.deepEqual(completedSteps(later, phases), [{ step: 0, sidesDone: 1 }]);

  state = advance(later, phases, 1000 * S).state;
  assert.equal(state.finished, true);
  assert.deepEqual(completedSteps(state, phases), [{ step: 0, sidesDone: 2 }, { step: 1, sidesDone: 1 }]);
  assert.equal(progressFraction(state, phases, 1000 * S), 1);
});

test("pausing stops the clock, and +10s lengthens the phase", () => {
  const phases = buildTimeline([one]);
  let state = advance(startState(phases, 0), phases, 5 * S).state; // the hold starts at 5s
  state = togglePause(state, 10 * S);
  assert.equal(remainingMs(state, 100 * S), 25 * S);
  assert.equal(advance(state, phases, 100 * S).state.index, 1);
  state = togglePause(state, 100 * S);
  assert.equal(remainingMs(state, 100 * S), 25 * S);
  state = extend(state, 10 * S, 100 * S);
  assert.equal(remainingMs(state, 100 * S), 35 * S);
  assert.equal(state.durationMs, 40 * S);
});

test("skipping forward goes to the next hold, counting a hold that was mostly done", () => {
  const phases = buildTimeline([two, one], { switchSec: 3, breakSec: 4 });
  let state = startState(phases, 0);
  state = skipForward(state, phases, 1 * S); // lead-in → first hold
  assert.equal(state.index, 1);
  state = skipForward(state, phases, 13 * S); // 12 of 20s held: counts, past the switch
  assert.equal(state.index, 3);
  state = skipForward(state, phases, 14 * S); // 1s held: doesn't count, past the break
  assert.equal(state.index, 5);
  assert.deepEqual(completedSteps(state, phases), [{ step: 0, sidesDone: 1 }]);
  state = skipForward(state, phases, 15 * S);
  assert.equal(state.finished, true);
});

test("skipping back restarts the hold, or goes to the previous one and uncounts it", () => {
  const phases = buildTimeline([two, one], { switchSec: 3, breakSec: 4 });
  let state = advance(startState(phases, 0), phases, 26 * S).state; // in the switch, side 1 done
  assert.equal(state.index, 2);
  state = skipBack(state, phases, 26 * S);
  assert.equal(state.index, 1);
  assert.deepEqual(completedSteps(state, phases), []);
  assert.equal(remainingMs(state, 26 * S), 20 * S);

  // Well into a hold, ⏮ restarts it; right at its start, it goes back.
  state = skipBack(state, phases, 36 * S);
  assert.equal(state.index, 1);
  assert.equal(remainingMs(state, 36 * S), 20 * S);

  // The first hold has nothing before it, so it restarts.
  state = skipBack(state, phases, 37 * S);
  assert.equal(state.index, 1);
});

test("a skipped-over side stays undone when going back past it", () => {
  const phases = buildTimeline([two, one], { switchSec: 3, breakSec: 4 });
  let state = advance(startState(phases, 0), phases, 28 * S).state; // side 1 done, side 2 starts at 28s
  state = skipForward(state, phases, 29 * S); // side 2 skipped early
  assert.equal(state.index, 5);
  state = skipBack(state, phases, 29 * S); // back to side 2
  assert.equal(state.index, 3);
  assert.deepEqual(completedSteps(state, phases), [{ step: 0, sidesDone: 1 }]);
});

test("finishing from the end goes back to the last hold", () => {
  const phases = buildTimeline([one]);
  let state = advance(startState(phases, 0), phases, 100 * S).state;
  assert.equal(state.finished, true);
  state = skipBack(state, phases, 100 * S);
  assert.equal(state.finished, false);
  assert.equal(state.index, 1);
  assert.deepEqual(completedSteps(state, phases), []);
});

test("stretch exercises format, apply a routine hold, and log", () => {
  const ex = { id: "a", name: "Pigeon", type: "stretch", holdSec: 30, twoSided: true };
  assert.equal(formatTargetSummary(ex), "30s per side");
  assert.equal(formatTargetSummary({ ...ex, twoSided: false }), "30s hold");
  const inRoutine = applyRoutineStep(ex, { id: "st", exerciseId: "a", holdSec: 45 });
  assert.equal(inRoutine.holdSec, 45);
  assert.equal(inRoutine.routineStepId, "st");
  assert.equal(applyRoutineStep(ex, { id: "st", exerciseId: "a", holdSec: null }).holdSec, 30);

  const performed = buildPerformedFromLog(inRoutine, { sidesDone: 1 });
  assert.deepEqual(performed, { type: "stretch", holdSec: 45, twoSided: true, sidesDone: 1 });
  assert.equal(formatPerformedSummary({ performed }), "45s, one side only");
  assert.equal(formatPerformedSummary({ performed: { ...performed, sidesDone: 2 } }), "45s per side");
  assert.equal(buildPerformedFromLog(inRoutine, { sidesDone: 0 }), null);
});
