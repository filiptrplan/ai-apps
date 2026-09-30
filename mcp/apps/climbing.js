// Climbing Tracker tools. They read and write the same app_data blobs the
// app syncs (see climbing-tracker/data.js), and reuse the app's own
// helpers so logged workouts, stats and template changes come out exactly
// as the app itself would produce them.
import { z } from "zod";
import { APP_ID, STORAGE_KEYS, uid } from "../../climbing-tracker/data.js";
import {
  applyRoutineStep,
  buildPerformedFromLog,
  isIntervalType,
  computeTemplateDrift,
  defaultFieldsForType,
  formatDriftSummary,
  formatPerformedSummary,
  formatTargetSummary,
  groupSteps,
  normalizeSupersets,
} from "../../climbing-tracker/format.js";
import { RANGES, collectExerciseSessions, filterByRange, metricsFor, personalRecords } from "../../climbing-tracker/stats.js";
import { EXERCISE_GUIDANCE, ROUTINE_GUIDANCE } from "../../climbing-tracker/llmGuidance.js";

const APP_URL = "https://apps.trplan.si/climbing-tracker";
const DAY_MS = 24 * 3600 * 1000;
const MAX_PROGRESS_SESSIONS = 60;

const TYPE_FIELDS = {
  reps: ["sets", "reps", "restSec"],
  weighted: ["sets", "reps", "weight", "weightMode", "restSec"],
  interval: ["workSec", "restSec", "sets"],
  weightedInterval: ["workSec", "restSec", "sets", "weight", "weightMode"],
};
const TYPES = Object.keys(TYPE_FIELDS);
const ALL_TYPE_FIELDS = ["sets", "reps", "weight", "weightMode", "workSec", "restSec"];

export const instructions = `Climbing Tracker (climbing_* tools): the user's climbing training app (${APP_URL}) with exercises, routines (ordered exercise steps, optionally supersets) and a history of logged workouts. Call climbing_get_overview first: it returns the ids every other tool takes. Weights are in kg, durations in seconds. Changes show up in the app right away.`;

// Thrown for anything the caller can fix; McpServer turns it into an
// isError tool result with this message.
function fail(message) {
  throw new Error(message);
}

function json(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function pick(obj, keys) {
  return Object.fromEntries(keys.filter(k => obj[k] !== undefined && obj[k] !== null).map(k => [k, obj[k]]));
}

function withoutNulls(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));
}

function findExercise(exercises, id) {
  return exercises.find(e => e.id === id)
    || fail(`No exercise with id "${id}". Call climbing_get_overview for valid ids.`);
}

function findRoutine(routines, id) {
  return routines.find(r => r.id === id)
    || fail(`No routine with id "${id}". Call climbing_get_overview for valid ids.`);
}

function bodyweightOf(settings) {
  return settings.bodyweight > 0 ? settings.bodyweight : null;
}

// ISO datetime (any offset) or a bare YYYY-MM-DD; stored as UTC ISO like
// the app does. Defaults to now.
function parseDate(input) {
  if (input === undefined) return new Date().toISOString();
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(input) ? `${input}T12:00:00Z` : input);
  if (Number.isNaN(d.getTime())) fail(`"${input}" isn't a valid date. Use ISO 8601, e.g. 2026-09-29T18:30:00+02:00.`);
  if (d.getTime() > Date.now() + DAY_MS) fail(`${input} is in the future.`);
  return d.toISOString();
}

// History is kept newest first, which is also the order the app shows it in.
function insertByDate(history, entry) {
  const time = new Date(entry.date).getTime();
  const i = history.findIndex(h => new Date(h.date).getTime() < time);
  return i < 0 ? [...history, entry] : [...history.slice(0, i), entry, ...history.slice(i)];
}

function describeExercise(ex) {
  return { ...ex, target: formatTargetSummary(ex) };
}

function describeRoutine(r, exercises) {
  return {
    id: r.id,
    name: r.name,
    steps: (r.steps || []).map(step => {
      const ex = exercises.find(e => e.id === step.exerciseId);
      return withoutNulls({
        ...step,
        exercise: ex ? ex.name : "(deleted exercise)",
        target: ex ? formatTargetSummary(applyRoutineStep(ex, step)) : null,
      });
    }),
  };
}

function describeEntry(h) {
  return {
    id: h.id,
    date: h.date,
    kind: h.kind,
    name: h.refName,
    [h.kind === "routine" ? "routineId" : "exerciseId"]: h.refId,
    durationSec: h.durationSec ?? null,
    steps: h.steps.map(step => withoutNulls({
      exerciseId: step.exerciseId,
      exercise: step.exerciseName,
      routineStepId: step.routineStepId,
      summary: formatPerformedSummary(step),
      performed: step.performed,
    })),
  };
}

function describeDrift(d) {
  return withoutNulls({
    exerciseId: d.exercise.id,
    exercise: d.exercise.name,
    routineId: d.routine?.id,
    routineStepId: d.routineStep?.id,
    change: formatDriftSummary(d),
    ...(d.targetSetsPatch
      ? { targetSets: d.targetSetsPatch }
      : { exerciseChanges: d.exercisePatch, routineStepChanges: d.routinePatch }),
  });
}

function templateChanges(entry, exercises, routines) {
  const drifts = entry.steps
    .map(step => computeTemplateDrift(entry, step, exercises, routines))
    .filter(Boolean)
    .map(describeDrift);
  return drifts.length > 0
    ? {
        templateChanges: drifts,
        hint: "What was performed differs from the saved targets. Ask the user whether to update them (climbing_save_exercise for exercise changes, climbing_save_routine for routine step changes or targetSets).",
      }
    : {};
}

// A performed record built by the app's own buildPerformedFromLog, from a
// tool-call step instead of a session card's live log. `ex` carries the
// targets (already merged with any routine step overrides).
function performedFromInput(ex, input, bodyweight) {
  let log;
  if (isIntervalType(ex.type)) {
    if (input.sets) fail(`"${ex.name}" is an ${ex.type} exercise: give completedSets (plus workSec/restSec if they differed), not sets.`);
    if (input.completedSets == null) fail(`"${ex.name}" is an ${ex.type} exercise: give completedSets.`);
    if (input.weight != null && ex.type !== "weightedInterval") fail(`"${ex.name}" is an interval exercise and has no weight.`);
    log = { completedSets: input.completedSets, workSec: input.workSec, restSec: input.restSec, weight: input.weight };
  } else {
    if (input.completedSets != null) fail(`"${ex.name}" is a ${ex.type} exercise: give sets (one entry per set), not completedSets.`);
    if (input.weight != null) fail(`"${ex.name}" is a ${ex.type} exercise: give the weight per set in sets, not weight.`);
    if (!input.sets || input.sets.length === 0) fail(`"${ex.name}" is a ${ex.type} exercise: give the performed sets.`);
    if (ex.type === "reps" && input.sets.some(s => s.weight != null)) fail(`"${ex.name}" is a reps exercise and has no weight.`);
    log = { rows: input.sets.map(s => ({ reps: s.reps, weight: s.weight ?? ex.weight, done: true })) };
  }
  let performed = buildPerformedFromLog(ex, log);
  if (!performed) fail(`Nothing was completed for "${ex.name}"; leave that step out instead.`);
  if (performed.weightMode === "added" && bodyweight) performed = { ...performed, bodyweight };
  return performed;
}

// The targets as they were recorded with an earlier log, so correcting a
// workout doesn't reset them to today's template.
function targetsFromPerformed(ex, p) {
  if (isIntervalType(p.type)) return { ...ex, type: p.type, sets: p.targetSets, workSec: p.workSec, restSec: p.restSec, weight: p.weight, weightMode: p.weightMode };
  return { ...ex, type: p.type, sets: p.targetSets, reps: p.targetReps, weight: p.targetWeight, weightMode: p.weightMode };
}

// Pairs each input step with a routine step: by routineStepId when given,
// else the first not-yet-used step for that exercise. Explicit ids go
// first so an automatic match can't take a step claimed by id.
function matchRoutineSteps(routine, routineSteps, inputs, exercises) {
  const used = new Set();
  const matched = new Map();
  const claim = (input, step) => {
    if (used.has(step.id)) fail(`Routine step "${step.id}" was given twice.`);
    used.add(step.id);
    matched.set(input, step);
  };
  inputs.filter(input => input.routineStepId).forEach(input => {
    const step = routineSteps.find(s => s.id === input.routineStepId)
      || fail(`Routine "${routine.name}" has no step "${input.routineStepId}".`);
    if (step.exerciseId !== input.exerciseId) fail(`Routine step "${step.id}" is for a different exercise than "${input.exerciseId}".`);
    claim(input, step);
  });
  inputs.filter(input => !input.routineStepId).forEach(input => {
    const step = routineSteps.find(s => s.exerciseId === input.exerciseId && !used.has(s.id));
    if (!step) {
      const name = exercises.find(e => e.id === input.exerciseId)?.name ?? input.exerciseId;
      fail(routineSteps.some(s => s.exerciseId === input.exerciseId)
        ? `"${name}" was given more times than it appears in routine "${routine.name}".`
        : `"${name}" isn't in routine "${routine.name}". Log it as a separate single-exercise workout, or add it to the routine first.`);
    }
    claim(input, step);
  });
  return inputs
    .map(input => ({ input, step: matched.get(input) }))
    .sort((a, b) => routineSteps.indexOf(a.step) - routineSteps.indexOf(b.step));
}

function buildRoutineSteps(inputs, exercises, existing) {
  const existingIds = new Set((existing?.steps || []).map(s => s.id));
  const seen = new Set();
  const steps = inputs.map((input, i) => {
    const ex = findExercise(exercises, input.exerciseId);
    const where = `Step ${i + 1} (${ex.name})`;
    if (input.id && !existingIds.has(input.id)) fail(`${where}: "${input.id}" isn't a step of this routine. Leave id out for new steps.`);
    if (input.id && seen.has(input.id)) fail(`${where}: step id "${input.id}" is used twice.`);
    const id = input.id ?? uid();
    seen.add(id);
    let targetSets = null;
    if (input.workSec != null && !isIntervalType(ex.type)) fail(`${where}: workSec only applies to interval exercises.`);
    if (input.targetSets) {
      if (isIntervalType(ex.type)) fail(`${where}: targetSets isn't supported for ${ex.type} exercises, use sets.`);
      if (ex.type === "weighted" && input.targetSets.some(t => t.weight == null)) fail(`${where}: every targetSets entry needs a weight for a weighted exercise.`);
      targetSets = input.targetSets.map(t => ex.type === "weighted" ? { reps: t.reps, weight: t.weight } : { reps: t.reps });
    }
    return {
      id,
      exerciseId: ex.id,
      sets: targetSets ? null : (input.sets ?? null),
      workSec: isIntervalType(ex.type) ? (input.workSec ?? null) : null,
      restSec: input.restSec ?? null,
      restAfterSec: input.restAfterSec ?? null,
      targetSets,
      supersetGroup: input.supersetGroup || null,
    };
  });

  const seenGroups = new Set();
  groupSteps(steps, s => s.supersetGroup).forEach(block => {
    const group = block[0].supersetGroup;
    if (!group) return;
    if (seenGroups.has(group)) fail(`Superset "${group}": its steps must be next to each other.`);
    seenGroups.add(group);
    if (block.length < 2) fail(`Superset "${group}" needs at least 2 steps.`);
    const counts = block.map(s => applyRoutineStep(findExercise(exercises, s.exerciseId), s).sets);
    if (new Set(counts).size > 1) fail(`Superset "${group}": every member needs the same number of sets (got ${counts.join(", ")}).`);
  });
  return steps;
}

const dateInput = z.string().describe("ISO 8601 date-time with offset, e.g. 2026-09-29T18:30:00+02:00, or a bare YYYY-MM-DD");

const performedStep = z.object({
  exerciseId: z.string(),
  routineStepId: z.string().optional()
    .describe("Only needed when the routine has the same exercise in several steps; otherwise steps are matched in routine order."),
  sets: z.array(z.object({
    reps: z.number().int().min(0),
    weight: z.number().min(0).optional()
      .describe("kg. For weightMode \"added\", the weight on top of bodyweight. Defaults to the target weight."),
  })).optional().describe("reps/weighted exercises: one entry per completed set, in order."),
  completedSets: z.number().int().min(1).optional().describe("interval/weightedInterval exercises: number of work phases completed."),
  workSec: z.number().int().min(1).optional().describe("interval/weightedInterval exercises: only if it differed from the target."),
  restSec: z.number().int().min(0).optional().describe("interval/weightedInterval exercises: only if it differed from the target."),
  weight: z.number().min(0).optional()
    .describe("weightedInterval exercises: kg used (on top of bodyweight for weightMode \"added\"), only if it differed from the target."),
});

export function register(server, { appData }) {
  const read = (name, fallback) => appData.read(APP_ID, STORAGE_KEYS[name], fallback);
  const update = (name, fallback, mutate) => appData.update(APP_ID, STORAGE_KEYS[name], fallback, mutate);
  const readAll = () => Promise.all([read("exercises", []), read("routines", []), read("history", []), read("settings", {})]);

  server.registerTool("climbing_get_overview", {
    title: "Climbing: overview",
    description: "All of the user's climbing exercises (with targets and notes), routines (with their steps), bodyweight, and a summary of recent training. Call this first: it has the ids the other climbing tools take.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => {
    const [exercises, routines, history, settings] = await readAll();
    const now = Date.now();
    const since = days => history.filter(h => new Date(h.date).getTime() >= now - days * DAY_MS).length;
    const lastEntry = pred => history.find(pred)?.date ?? null;
    return json({
      appUrl: APP_URL,
      bodyweightKg: bodyweightOf(settings),
      exercises: exercises.map(ex => ({
        ...describeExercise(ex),
        lastDone: lastEntry(h => h.steps.some(s => s.exerciseId === ex.id)),
      })),
      routines: routines.map(r => ({
        ...describeRoutine(r, exercises),
        lastDone: lastEntry(h => h.kind === "routine" && h.refId === r.id),
      })),
      history: {
        totalWorkouts: history.length,
        last7Days: since(7),
        last30Days: since(30),
        latest: history.slice(0, 5).map(h => ({ id: h.id, date: h.date, name: h.refName })),
      },
    });
  });

  server.registerTool("climbing_get_history", {
    title: "Climbing: workout history",
    description: "Logged workouts, newest first, with every performed set. Filter by date range, exercise or routine.",
    inputSchema: {
      from: dateInput.optional().describe("Only workouts on or after this date/time."),
      to: dateInput.optional().describe("Only workouts on or before this date/time (a bare date includes that whole day)."),
      exerciseId: z.string().optional().describe("Only workouts that include this exercise."),
      routineId: z.string().optional().describe("Only workouts of this routine."),
      limit: z.number().int().min(1).max(200).default(20),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ from, to, exerciseId, routineId, limit }) => {
    const history = await read("history", []);
    const fromTime = from ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(from) ? `${from}T00:00:00Z` : from).getTime() : -Infinity;
    const toTime = to ? (/^\d{4}-\d{2}-\d{2}$/.test(to) ? new Date(`${to}T00:00:00Z`).getTime() + DAY_MS - 1 : new Date(to).getTime()) : Infinity;
    if (Number.isNaN(fromTime) || Number.isNaN(toTime)) fail("from/to must be ISO 8601 dates.");
    const matches = history.filter(h => {
      const t = new Date(h.date).getTime();
      if (t < fromTime || t > toTime) return false;
      if (exerciseId && !h.steps.some(s => s.exerciseId === exerciseId)) return false;
      if (routineId && !(h.kind === "routine" && h.refId === routineId)) return false;
      return true;
    });
    return json({ matching: matches.length, returned: Math.min(limit, matches.length), workouts: matches.slice(0, limit).map(describeEntry) });
  });

  server.registerTool("climbing_get_exercise_progress", {
    title: "Climbing: exercise progress",
    description: "Progress of one exercise over time: a per-workout series of the app's stats metrics (e.g. top weight, total load, volume, best set, time on), with the first, latest and best value of each.",
    inputSchema: {
      exerciseId: z.string(),
      range: z.enum(RANGES.map(r => r.value)).default("90d"),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ exerciseId, range }) => {
    const [exercises, , history, settings] = await readAll();
    const ex = findExercise(exercises, exerciseId);
    const sessions = filterByRange(collectExerciseSessions(history, ex), range);
    if (sessions.length === 0) return json({ exercise: describeExercise(ex), range, sessionCount: 0 });
    const metrics = metricsFor(ex, bodyweightOf(settings));
    const records = personalRecords(sessions, metrics);
    const latest = sessions[sessions.length - 1];
    return json({
      exercise: describeExercise(ex),
      range,
      sessionCount: sessions.length,
      metrics: metrics.map(m => {
        const record = records.find(pr => pr.metric.id === m.id);
        return {
          id: m.id,
          label: m.label,
          first: m.format(m.value(sessions[0])),
          latest: m.format(m.value(latest)),
          best: record ? { value: m.format(record.value), date: record.date } : null,
        };
      }),
      sessions: sessions.slice(-MAX_PROGRESS_SESSIONS).map(x => ({
        date: x.date,
        workoutId: x.entryId,
        routine: x.refName,
        ...Object.fromEntries(metrics.map(m => [m.id, m.value(x)])),
      })),
    });
  });

  server.registerTool("climbing_log_workout", {
    title: "Climbing: log workout",
    description: "Log a completed workout to the history. With routineId it's a routine workout: give the steps that were actually done (skipped ones left out); targets come from the routine. Without routineId it's a single-exercise workout: give exactly one step. Only log what the user actually did. Returns any differences from the saved targets.",
    inputSchema: {
      routineId: z.string().optional(),
      date: dateInput.optional().describe("When the workout was done. Defaults to now."),
      durationSec: z.number().int().min(0).optional().describe("Total workout duration, if known."),
      steps: z.array(performedStep).min(1),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ routineId, date, durationSec, steps }) => {
    const [exercises, routines, , settings] = await readAll();
    const bodyweight = bodyweightOf(settings);
    let ref;
    let results;
    if (routineId) {
      const routine = findRoutine(routines, routineId);
      const routineSteps = normalizeSupersets(routine.steps || []);
      results = matchRoutineSteps(routine, routineSteps, steps, exercises).map(({ input, step }) => {
        const ex = applyRoutineStep(findExercise(exercises, step.exerciseId), step);
        return { exerciseId: ex.id, exerciseName: ex.name, performed: performedFromInput(ex, input, bodyweight), routineStepId: step.id };
      });
      ref = { kind: "routine", refId: routine.id, refName: routine.name || "Untitled routine" };
    } else {
      if (steps.length !== 1) fail("Without routineId a workout is a single exercise, so give exactly one step. Log other exercises as their own workouts, or pass the routine they belong to.");
      const ex = findExercise(exercises, steps[0].exerciseId);
      results = [{ exerciseId: ex.id, exerciseName: ex.name, performed: performedFromInput(ex, steps[0], bodyweight) }];
      ref = { kind: "exercise", refId: ex.id, refName: ex.name };
    }
    const entry = { id: uid(), date: parseDate(date), ...ref, durationSec: durationSec ?? null, steps: results };
    await update("history", [], history => insertByDate(history, entry));
    return json({ logged: describeEntry(entry), ...templateChanges(entry, exercises, routines) });
  });

  server.registerTool("climbing_update_workout", {
    title: "Climbing: correct workout",
    description: "Correct a logged workout: its date, duration and/or performed steps. `steps`, when given, replaces the whole list, so repeat unchanged steps too (get them from climbing_get_history); steps left out are removed. Corrected steps keep the targets recorded with the original log.",
    inputSchema: {
      id: z.string().describe("Workout id from climbing_get_history."),
      date: dateInput.optional(),
      durationSec: z.number().int().min(0).nullable().optional(),
      steps: z.array(performedStep).min(1).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ id, date, durationSec, steps }) => {
    const [exercises, routines, , settings] = await readAll();
    const bodyweight = bodyweightOf(settings);
    const newDate = date === undefined ? undefined : parseDate(date);

    const rebuildSteps = entry => {
      const routine = entry.kind === "routine" ? routines.find(r => r.id === entry.refId) : null;
      if (entry.kind === "exercise" && (steps.length !== 1 || steps[0].exerciseId !== entry.refId)) {
        fail(`This is a single-exercise workout of "${entry.refName}": give exactly one step for exerciseId "${entry.refId}".`);
      }
      const unused = [...entry.steps];
      const takeOriginal = input => {
        const i = unused.findIndex(s => input.routineStepId ? s.routineStepId === input.routineStepId : s.exerciseId === input.exerciseId);
        return i < 0 ? null : unused.splice(i, 1)[0];
      };
      const withOriginal = [...steps.filter(s => s.routineStepId), ...steps.filter(s => !s.routineStepId)]
        .map(input => ({ input, original: takeOriginal(input) }));

      // Steps that weren't in the original log are matched to the routine
      // like a new log would be.
      const added = withOriginal.filter(x => !x.original);
      if (added.length > 0) {
        if (!routine) fail(`"${entry.refName}" no longer exists, so steps can't be added to this workout, only corrected.`);
        const taken = new Set(withOriginal.filter(x => x.original).map(x => x.original.routineStepId));
        const free = normalizeSupersets(routine.steps || []).filter(s => !taken.has(s.id));
        const matched = matchRoutineSteps(routine, free, added.map(x => x.input), exercises);
        matched.forEach(({ input, step }) => { added.find(x => x.input === input).routineStep = step; });
      }

      const order = routine ? normalizeSupersets(routine.steps || []).map(s => s.id) : [];
      const position = x => {
        const stepId = x.original?.routineStepId ?? x.routineStep?.id;
        const i = order.indexOf(stepId);
        return i < 0 ? entry.steps.indexOf(x.original) : i;
      };
      return withOriginal.sort((a, b) => position(a) - position(b)).map(x => {
        if (x.original) {
          const p = x.original.performed;
          const current = exercises.find(e => e.id === x.original.exerciseId) ?? { id: x.original.exerciseId, name: x.original.exerciseName };
          const performed = performedFromInput(targetsFromPerformed(current, p), x.input, p.bodyweight ?? bodyweight);
          return { ...x.original, performed };
        }
        const ex = applyRoutineStep(findExercise(exercises, x.routineStep.exerciseId), x.routineStep);
        return { exerciseId: ex.id, exerciseName: ex.name, performed: performedFromInput(ex, x.input, bodyweight), routineStepId: x.routineStep.id };
      });
    };

    let updated;
    await update("history", [], history => {
      const entry = history.find(h => h.id === id) || fail(`No workout with id "${id}". Use climbing_get_history to find it.`);
      updated = {
        ...entry,
        ...(newDate !== undefined ? { date: newDate } : {}),
        ...(durationSec !== undefined ? { durationSec } : {}),
        ...(steps ? { steps: rebuildSteps(entry) } : {}),
      };
      return insertByDate(history.filter(h => h.id !== id), updated);
    });
    return json({ updated: describeEntry(updated), ...templateChanges(updated, exercises, routines) });
  });

  server.registerTool("climbing_save_exercise", {
    title: "Climbing: save exercise",
    description: `Create an exercise (no id: name and type required; unset targets get the app's defaults) or change an existing one (id: only the fields you pass change). Changing type drops the fields that don't apply to the new type. Check climbing_get_overview first so you don't create a duplicate of an existing exercise.

The exercise data model (ids are assigned by the server, so ignore the "id" fields below):

${EXERCISE_GUIDANCE}`,
    inputSchema: {
      id: z.string().optional().describe("Existing exercise to change. Leave out to create one."),
      name: z.string().min(1).optional(),
      type: z.enum(TYPES).optional(),
      sets: z.number().int().min(1).optional(),
      reps: z.number().int().min(1).optional().describe("reps/weighted only"),
      weight: z.number().min(0).optional().describe("weighted/weightedInterval only, kg"),
      weightMode: z.enum(["added", "total"]).optional().describe("weighted/weightedInterval only"),
      workSec: z.number().int().min(1).optional().describe("interval/weightedInterval only"),
      restSec: z.number().int().min(0).optional(),
      notes: z.string().optional().describe("Free-form notes shown with the exercise. Replaces the existing notes."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async input => {
    let saved;
    let created = false;
    await update("exercises", [], exercises => {
      const existing = input.id ? findExercise(exercises, input.id) : null;
      if (!existing) {
        if (!input.name?.trim() || !input.type) fail("A new exercise needs a name and a type.");
        const duplicate = exercises.find(e => e.name.trim().toLowerCase() === input.name.trim().toLowerCase());
        if (duplicate) fail(`An exercise named "${duplicate.name}" already exists (id "${duplicate.id}"). Pass its id to change it.`);
      }
      const type = input.type ?? existing.type;
      const stray = ALL_TYPE_FIELDS.filter(k => input[k] != null && !TYPE_FIELDS[type].includes(k));
      if (stray.length > 0) fail(`${stray.join(", ")} ${stray.length === 1 ? "doesn't" : "don't"} apply to ${type} exercises.`);

      const ex = {
        ...(existing ?? {}),
        id: existing?.id ?? uid(),
        name: (input.name ?? existing.name).trim(),
        type,
        ...defaultFieldsForType(type),
        ...pick(existing ?? {}, TYPE_FIELDS[type]),
        ...pick(input, TYPE_FIELDS[type]),
        notes: (input.notes ?? existing?.notes ?? "").trim(),
      };
      ALL_TYPE_FIELDS.filter(k => !TYPE_FIELDS[type].includes(k)).forEach(k => delete ex[k]);
      saved = ex;
      created = !existing;
      return existing ? exercises.map(e => e.id === ex.id ? ex : e) : [...exercises, ex];
    });
    return json({ [created ? "created" : "updated"]: describeExercise(saved) });
  });

  server.registerTool("climbing_save_routine", {
    title: "Climbing: save routine",
    description: `Create a routine (no id: name and steps required) or change an existing one (id: pass name and/or steps). \`steps\` replaces the whole list: to keep an existing step (and its link to past logs), include it with its id from climbing_get_overview; leave id out for new steps. Every exerciseId must be an existing exercise, so create missing ones with climbing_save_exercise first.

The routine data model (the server assigns routine and new step ids):

${ROUTINE_GUIDANCE}`,
    inputSchema: {
      id: z.string().optional().describe("Existing routine to change. Leave out to create one."),
      name: z.string().min(1).optional(),
      steps: z.array(z.object({
        id: z.string().optional().describe("Existing step id, to keep that step. Leave out for new steps."),
        exerciseId: z.string(),
        sets: z.number().int().min(1).nullable().optional(),
        workSec: z.number().int().min(1).nullable().optional().describe("interval/weightedInterval only"),
        restSec: z.number().int().min(0).nullable().optional(),
        restAfterSec: z.number().int().min(0).nullable().optional(),
        targetSets: z.array(z.object({
          reps: z.number().int().min(1),
          weight: z.number().min(0).optional(),
        })).min(1).nullable().optional(),
        supersetGroup: z.string().nullable().optional(),
      })).min(1).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ id, name, steps }) => {
    const exercises = await read("exercises", []);
    let saved;
    let created = false;
    await update("routines", [], routines => {
      const existing = id ? findRoutine(routines, id) : null;
      if (!existing) {
        if (!name?.trim() || !steps) fail("A new routine needs a name and steps.");
        const duplicate = routines.find(r => (r.name || "").trim().toLowerCase() === name.trim().toLowerCase());
        if (duplicate) fail(`A routine named "${duplicate.name}" already exists (id "${duplicate.id}"). Pass its id to change it.`);
      }
      const routine = {
        ...(existing ?? {}),
        id: existing?.id ?? uid(),
        name: (name ?? existing.name ?? "").trim(),
        steps: steps ? buildRoutineSteps(steps, exercises, existing) : existing.steps,
      };
      saved = routine;
      created = !existing;
      return existing ? routines.map(r => r.id === routine.id ? routine : r) : [...routines, routine];
    });
    return json({ [created ? "created" : "updated"]: describeRoutine(saved, exercises) });
  });

  server.registerTool("climbing_delete", {
    title: "Climbing: delete",
    description: "Permanently delete an exercise (also removed from every routine; its logged workouts stay in history), a routine (its logged workouts stay), or a logged workout. Confirm with the user first.",
    inputSchema: {
      kind: z.enum(["exercise", "routine", "workout"]),
      id: z.string(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ kind, id }) => {
    if (kind === "exercise") {
      const ex = findExercise(await read("exercises", []), id);
      let affected = [];
      // Routines first, so a routine never points at a missing exercise.
      await update("routines", [], routines => {
        affected = routines.filter(r => (r.steps || []).some(s => s.exerciseId === id));
        if (affected.length === 0) return routines;
        return routines.map(r => affected.includes(r)
          ? { ...r, steps: normalizeSupersets(r.steps.filter(s => s.exerciseId !== id)) }
          : r);
      });
      await update("exercises", [], exercises => exercises.filter(e => e.id !== id));
      return json({ deleted: { kind, id, name: ex.name }, removedFromRoutines: affected.map(r => r.name) });
    }
    if (kind === "routine") {
      let name;
      await update("routines", [], routines => {
        name = findRoutine(routines, id).name;
        return routines.filter(r => r.id !== id);
      });
      return json({ deleted: { kind, id, name } });
    }
    let entry;
    await update("history", [], history => {
      entry = history.find(h => h.id === id) || fail(`No workout with id "${id}". Use climbing_get_history to find it.`);
      return history.filter(h => h.id !== id);
    });
    return json({ deleted: { kind, id, name: entry.refName, date: entry.date } });
  });

  server.registerTool("climbing_set_bodyweight", {
    title: "Climbing: set bodyweight",
    description: "Set the user's current bodyweight. It's used for \"BW +\" (weightMode \"added\") exercises: total-load stats, and it's recorded with each such workout logged from now on.",
    inputSchema: {
      kg: z.number().positive().nullable().describe("Bodyweight in kg, or null to clear it."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ kg }) => {
    await update("settings", {}, settings => ({ ...settings, bodyweight: kg }));
    return json({ bodyweightKg: kg });
  });
}
