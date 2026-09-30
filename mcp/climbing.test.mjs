import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./server.js";

const K = {
  exercises: "climbing-tracker-exercises",
  routines: "climbing-tracker-routines",
  history: "climbing-tracker-history",
  settings: "climbing-tracker-settings",
};

// In-memory stand-in for createAppData(); `beforeWrite` lets a test change
// the row between a tool's read and its write, like an open app tab would.
function fakeAppData(initial = {}) {
  const rows = new Map(Object.entries(initial).map(([k, v]) => [k, structuredClone(v)]));
  const fake = {
    rows,
    beforeWrite: null,
    async read(appId, key, fallback) {
      assert.equal(appId, "climbing-tracker");
      return rows.has(key) ? structuredClone(rows.get(key)) : fallback;
    },
    async update(appId, key, fallback, mutate) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const seen = rows.get(key);
        const next = mutate(rows.has(key) ? structuredClone(seen) : fallback);
        if (fake.beforeWrite) { const hook = fake.beforeWrite; fake.beforeWrite = null; hook(); }
        if (rows.get(key) !== seen) continue; // changed meanwhile: retry
        rows.set(key, next);
        return next;
      }
      throw new Error("kept changing");
    },
  };
  return fake;
}

async function connect(initial) {
  const appData = fakeAppData(initial);
  const server = createMcpServer({ appData });
  const client = new Client({ name: "test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name, args = {}) => {
    const res = await client.callTool({ name, arguments: args });
    const text = res.content[0].text;
    if (res.isError) return { error: text };
    return JSON.parse(text);
  };
  return { appData, client, call };
}

const pullups = { id: "ex-pull", name: "Weighted pull-ups", type: "weighted", sets: 3, reps: 5, weight: 10, weightMode: "added", restSec: 120, notes: "" };
const pushups = { id: "ex-push", name: "Push-ups", type: "reps", sets: 3, reps: 15, restSec: 60, notes: "" };
const hangs = { id: "ex-hang", name: "Repeaters", type: "interval", workSec: 7, restSec: 3, sets: 6, notes: "" };
const routine = {
  id: "r-1", name: "Pull day",
  steps: [
    { id: "st-1", exerciseId: "ex-hang", sets: null, restSec: null, restAfterSec: 60, targetSets: null, supersetGroup: null },
    { id: "st-2", exerciseId: "ex-pull", sets: 3, restSec: 0, restAfterSec: null, targetSets: null, supersetGroup: "ss" },
    { id: "st-3", exerciseId: "ex-push", sets: 3, restSec: 90, restAfterSec: null, targetSets: null, supersetGroup: "ss" },
  ],
};
const seed = () => ({
  [K.exercises]: [pullups, pushups, hangs],
  [K.routines]: [routine],
  [K.history]: [],
  [K.settings]: { bodyweight: 70 },
});

test("lists every climbing tool", async () => {
  const { client } = await connect(seed());
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(t => t.name).sort(), [
    "climbing_delete", "climbing_get_exercise_progress", "climbing_get_history", "climbing_get_overview",
    "climbing_log_workout", "climbing_save_exercise", "climbing_save_routine", "climbing_set_bodyweight",
    "climbing_update_workout",
  ]);
  assert.equal(tools.find(t => t.name === "climbing_delete").annotations.destructiveHint, true);
});

test("overview describes exercises and routines", async () => {
  const { call } = await connect(seed());
  const o = await call("climbing_get_overview");
  assert.equal(o.bodyweightKg, 70);
  assert.equal(o.exercises.find(e => e.id === "ex-pull").target, "3 × 5 reps @ BW +10kg · 120s rest");
  assert.equal(o.routines[0].steps[1].exercise, "Weighted pull-ups");
  assert.equal(o.routines[0].steps[1].supersetGroup, "ss");
});

test("logs a routine workout like the app does", async () => {
  const { call, appData } = await connect(seed());
  const res = await call("climbing_log_workout", {
    routineId: "r-1",
    date: "2026-09-28T18:00:00+02:00",
    durationSec: 3600,
    steps: [
      { exerciseId: "ex-push", sets: [{ reps: 15 }, { reps: 15 }, { reps: 12 }] },
      { exerciseId: "ex-pull", sets: [{ reps: 5, weight: 12.5 }, { reps: 5, weight: 12.5 }, { reps: 5, weight: 12.5 }] },
    ],
  });
  const [entry] = appData.rows.get(K.history);
  assert.equal(entry.date, "2026-09-28T16:00:00.000Z");
  assert.equal(entry.kind, "routine");
  assert.equal(entry.refName, "Pull day");
  // Routine order, not input order; skipped steps left out.
  assert.deepEqual(entry.steps.map(s => s.routineStepId), ["st-2", "st-3"]);
  assert.deepEqual(entry.steps[0].performed, {
    type: "weighted", weightMode: "added", targetSets: 3, targetReps: 5, targetWeight: 10,
    sets: [{ reps: 5, weight: 12.5 }, { reps: 5, weight: 12.5 }, { reps: 5, weight: 12.5 }],
    bodyweight: 70,
  });
  const change = res.templateChanges.find(c => c.exerciseId === "ex-pull");
  assert.deepEqual(change.exerciseChanges, { weight: 12.5 });
  assert.ok(res.templateChanges.find(c => c.exerciseId === "ex-push").targetSets);
});

test("logs an interval single-exercise workout", async () => {
  const { call, appData } = await connect(seed());
  const res = await call("climbing_log_workout", { steps: [{ exerciseId: "ex-hang", completedSets: 6 }] });
  const [entry] = appData.rows.get(K.history);
  assert.equal(entry.kind, "exercise");
  assert.equal(entry.refId, "ex-hang");
  assert.equal(entry.durationSec, null);
  assert.deepEqual(entry.steps[0].performed, { type: "interval", workSec: 7, restSec: 3, targetSets: 6, completedSets: 6 });
  assert.equal(res.templateChanges, undefined);
});

test("a routine step can override an interval's work time", async () => {
  const { call, appData } = await connect(seed());
  const err = (await call("climbing_save_routine", { id: "r-1", steps: [{ exerciseId: "ex-push", workSec: 10 }] })).error;
  assert.match(err, /only applies to interval/);
  await call("climbing_save_routine", { id: "r-1", steps: [{ id: "st-1", exerciseId: "ex-hang", workSec: 10, restSec: 5 }] });
  const [step] = appData.rows.get(K.routines)[0].steps;
  assert.equal(step.workSec, 10);

  // Doing the routine's 10s is no drift; changing it patches the step, not the exercise.
  const same = await call("climbing_log_workout", { routineId: "r-1", steps: [{ exerciseId: "ex-hang", completedSets: 6 }] });
  assert.equal(same.templateChanges, undefined);
  assert.equal(appData.rows.get(K.history)[0].steps[0].performed.workSec, 10);
  const longer = await call("climbing_log_workout", { routineId: "r-1", steps: [{ exerciseId: "ex-hang", completedSets: 6, workSec: 12 }] });
  assert.deepEqual(longer.templateChanges[0].routineStepChanges, { workSec: 12 });
  assert.deepEqual(longer.templateChanges[0].exerciseChanges, {});
});

test("rejects workouts that don't fit", async () => {
  const { call, appData } = await connect(seed());
  assert.match((await call("climbing_log_workout", { steps: [{ exerciseId: "ex-hang", completedSets: 1 }, { exerciseId: "ex-push", sets: [{ reps: 3 }] }] })).error, /exactly one step/);
  assert.match((await call("climbing_log_workout", { steps: [{ exerciseId: "ex-hang", sets: [{ reps: 3 }] }] })).error, /interval exercise/);
  assert.match((await call("climbing_log_workout", { routineId: "r-1", steps: [{ exerciseId: "ex-nope", sets: [{ reps: 3 }] }] })).error, /isn't in routine/);
  assert.match((await call("climbing_log_workout", { routineId: "r-1", steps: [{ exerciseId: "ex-push", sets: [{ reps: 3 }] }, { exerciseId: "ex-push", sets: [{ reps: 3 }] }] })).error, /more times/);
  assert.match((await call("climbing_log_workout", { date: "2099-01-01", steps: [{ exerciseId: "ex-push", sets: [{ reps: 3 }] }] })).error, /future/);
  assert.deepEqual(appData.rows.get(K.history), []);
});

test("keeps history sorted by date when backdating", async () => {
  const { call, appData } = await connect(seed());
  await call("climbing_log_workout", { date: "2026-09-20", steps: [{ exerciseId: "ex-push", sets: [{ reps: 10 }] }] });
  await call("climbing_log_workout", { date: "2026-09-25", steps: [{ exerciseId: "ex-push", sets: [{ reps: 11 }] }] });
  await call("climbing_log_workout", { date: "2026-09-10", steps: [{ exerciseId: "ex-push", sets: [{ reps: 9 }] }] });
  assert.deepEqual(appData.rows.get(K.history).map(h => h.date.slice(0, 10)), ["2026-09-25", "2026-09-20", "2026-09-10"]);
  const hist = await call("climbing_get_history", { from: "2026-09-15", to: "2026-09-20" });
  assert.equal(hist.matching, 1);
  assert.equal(hist.workouts[0].steps[0].summary, "1 sets: 10 reps");
});

test("corrects a workout keeping its recorded targets and bodyweight", async () => {
  const { call, appData } = await connect(seed());
  const { logged } = await call("climbing_log_workout", {
    routineId: "r-1", date: "2026-09-20",
    steps: [{ exerciseId: "ex-pull", sets: [{ reps: 5 }, { reps: 5 }, { reps: 5 }] }],
  });
  // Template and bodyweight change after the workout was logged.
  await call("climbing_save_exercise", { id: "ex-pull", weight: 20 });
  await call("climbing_set_bodyweight", { kg: 72 });

  const res = await call("climbing_update_workout", {
    id: logged.id,
    durationSec: 1800,
    steps: [
      { exerciseId: "ex-pull", sets: [{ reps: 5 }, { reps: 5 }, { reps: 4 }] },
      { exerciseId: "ex-hang", completedSets: 5 },
    ],
  });
  const [entry] = appData.rows.get(K.history);
  assert.equal(entry.id, logged.id);
  assert.equal(entry.durationSec, 1800);
  assert.deepEqual(entry.steps.map(s => s.routineStepId), ["st-1", "st-2"]);
  const pull = entry.steps[1].performed;
  assert.equal(pull.targetWeight, 10);
  assert.equal(pull.bodyweight, 70);
  assert.deepEqual(pull.sets.map(s => s.weight), [10, 10, 10]);
  assert.equal(entry.steps[0].performed.completedSets, 5);
  assert.equal(res.updated.steps.length, 2);

  assert.match((await call("climbing_update_workout", { id: "nope", durationSec: 1 })).error, /No workout/);
});

test("creates and edits exercises", async () => {
  const { call, appData } = await connect(seed());
  const { created } = await call("climbing_save_exercise", { name: "Dead hang", type: "interval", workSec: 10 });
  assert.equal(created.sets, 6);
  assert.equal(created.restSec, 5);
  assert.match((await call("climbing_save_exercise", { name: "dead hang", type: "reps" })).error, /already exists/);
  assert.match((await call("climbing_save_exercise", { name: "Rows", type: "reps", weight: 5 })).error, /weight doesn't apply/);

  const { updated } = await call("climbing_save_exercise", { id: "ex-push", type: "weighted", weight: 10, weightMode: "total", notes: "  vest " });
  assert.deepEqual(
    { ...updated, target: undefined },
    { id: "ex-push", name: "Push-ups", type: "weighted", sets: 3, reps: 15, weight: 10, weightMode: "total", restSec: 60, notes: "vest", target: undefined }
  );
  const hang = appData.rows.get(K.exercises).find(e => e.name === "Dead hang");
  await call("climbing_save_exercise", { id: hang.id, type: "reps" });
  const asReps = appData.rows.get(K.exercises).find(e => e.id === hang.id);
  assert.equal(asReps.workSec, undefined);
  assert.equal(asReps.reps, 10);
});

test("saves routines and validates supersets", async () => {
  const { call, appData } = await connect(seed());
  const { created } = await call("climbing_save_routine", {
    name: "Push day",
    steps: [
      { exerciseId: "ex-push", targetSets: [{ reps: 12 }, { reps: 12 }, { reps: 24 }], sets: 3 },
      { exerciseId: "ex-hang", restAfterSec: 30 },
    ],
  });
  assert.equal(created.steps.length, 2);
  const saved = appData.rows.get(K.routines).find(r => r.name === "Push day");
  assert.deepEqual(saved.steps[0].targetSets, [{ reps: 12 }, { reps: 12 }, { reps: 24 }]);
  assert.equal(saved.steps[0].sets, null);

  const err = async steps => (await call("climbing_save_routine", { id: "r-1", steps })).error;
  assert.match(await err([{ exerciseId: "ex-hang", targetSets: [{ reps: 1 }] }]), /interval/);
  assert.match(await err([{ exerciseId: "ex-pull", supersetGroup: "a" }, { exerciseId: "ex-hang" }]), /at least 2/);
  assert.match(await err([{ exerciseId: "ex-pull", supersetGroup: "a" }, { exerciseId: "ex-push", supersetGroup: "a", sets: 4 }]), /same number of sets/);
  assert.match(await err([{ exerciseId: "ex-pull", supersetGroup: "a" }, { exerciseId: "ex-push", supersetGroup: "a" }, { exerciseId: "ex-hang" }, { exerciseId: "ex-push", supersetGroup: "a" }]), /next to each other/);
  assert.match(await err([{ id: "st-x", exerciseId: "ex-pull" }]), /isn't a step/);

  // Keeping a step by id keeps it; renaming only leaves steps alone.
  await call("climbing_save_routine", { id: "r-1", steps: [{ id: "st-1", exerciseId: "ex-hang" }, { exerciseId: "ex-push" }] });
  await call("climbing_save_routine", { id: "r-1", name: "Pull day v2" });
  const r = appData.rows.get(K.routines).find(x => x.id === "r-1");
  assert.equal(r.name, "Pull day v2");
  assert.equal(r.steps[0].id, "st-1");
  assert.equal(r.steps[0].restAfterSec, null);
  assert.equal(r.steps.length, 2);
});

test("deleting an exercise removes it from routines", async () => {
  const { call, appData } = await connect(seed());
  const res = await call("climbing_delete", { kind: "exercise", id: "ex-push" });
  assert.deepEqual(res.removedFromRoutines, ["Pull day"]);
  const [r] = appData.rows.get(K.routines);
  assert.deepEqual(r.steps.map(s => s.id), ["st-1", "st-2"]);
  assert.equal(r.steps[1].supersetGroup, null); // lone superset member unlinked
  assert.equal(appData.rows.get(K.exercises).length, 2);
  assert.match((await call("climbing_delete", { kind: "workout", id: "nope" })).error, /No workout/);
});

test("retries a write when the row changed meanwhile", async () => {
  const { call, appData } = await connect(seed());
  appData.beforeWrite = () => {
    appData.rows.set(K.history, [{ id: "from-app", date: "2026-09-01T10:00:00.000Z", kind: "exercise", refId: "ex-push", refName: "Push-ups", durationSec: 60, steps: [] }]);
  };
  await call("climbing_log_workout", { date: "2026-09-05", steps: [{ exerciseId: "ex-push", sets: [{ reps: 10 }] }] });
  assert.deepEqual(appData.rows.get(K.history).map(h => h.id === "from-app"), [false, true]);
});

test("reports exercise progress with the app's metrics", async () => {
  const { call } = await connect(seed());
  for (const [date, weight] of [["2026-09-01", 10], ["2026-09-08", 15], ["2026-09-15", 12.5]]) {
    await call("climbing_log_workout", { date, steps: [{ exerciseId: "ex-pull", sets: [{ reps: 5, weight }] }] });
  }
  const p = await call("climbing_get_exercise_progress", { exerciseId: "ex-pull", range: "all" });
  assert.equal(p.sessionCount, 3);
  const top = p.metrics.find(m => m.id === "topWeight");
  assert.deepEqual([top.first, top.latest, top.best.value], ["BW +10kg", "BW +12.5kg", "BW +15kg"]);
  assert.equal(p.metrics.find(m => m.id === "totalLoad").best.value, "85kg");
  assert.deepEqual(p.sessions.map(s => s.topWeight), [10, 15, 12.5]);
});

test("weighted intervals: create, log with a weight, drift and progress", async () => {
  const { call, appData } = await connect(seed());
  const { created } = await call("climbing_save_exercise", { name: "Weighted hangs", type: "weightedInterval", weight: 10 });
  assert.equal(created.weightMode, "added");
  assert.equal(created.workSec, 10);
  assert.equal(created.target, "6 sets · 10s on / 5s off @ BW +10kg");
  assert.match((await call("climbing_save_exercise", { name: "Hangs 2", type: "interval", weight: 5 })).error, /weight doesn't apply/);

  const res = await call("climbing_log_workout", { date: "2026-09-28", steps: [{ exerciseId: created.id, completedSets: 6, weight: 12.5 }] });
  const [entry] = appData.rows.get(K.history);
  assert.deepEqual(entry.steps[0].performed, {
    type: "weightedInterval", workSec: 10, restSec: 5, targetSets: 6, completedSets: 6, weight: 12.5, weightMode: "added", bodyweight: 70,
  });
  assert.equal(res.logged.steps[0].summary, "6/6 sets · 10s on / 5s off @ BW +12.5kg");
  assert.deepEqual(res.templateChanges[0].exerciseChanges, { weight: 12.5 });

  // Without a weight it falls back to the target; a plain interval rejects one.
  await call("climbing_log_workout", { steps: [{ exerciseId: created.id, completedSets: 4 }] });
  assert.equal(appData.rows.get(K.history)[0].steps[0].performed.weight, 10);
  assert.match((await call("climbing_log_workout", { steps: [{ exerciseId: "ex-hang", completedSets: 6, weight: 5 }] })).error, /has no weight/);

  // Routine steps can override work time but not use targetSets.
  assert.match((await call("climbing_save_routine", { name: "Fingers", steps: [{ exerciseId: created.id, targetSets: [{ reps: 1 }] }] })).error, /targetSets isn't supported/);
  await call("climbing_save_routine", { name: "Fingers", steps: [{ exerciseId: created.id, workSec: 7 }] });

  const progress = await call("climbing_get_exercise_progress", { exerciseId: created.id, range: "all" });
  assert.deepEqual(progress.metrics.map(m => m.id), ["topWeight", "totalLoad", "timeOn", "completedSets", "workSec"]);
  assert.equal(progress.metrics[0].best.value, "BW +12.5kg");
  assert.equal(progress.metrics[1].best.value, "82.5kg");
});
