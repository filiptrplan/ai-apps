import { uid } from "./storage.js";

export const EXERCISE_TYPES = [
  { value: "reps", label: "Reps" },
  { value: "weighted", label: "Weighted" },
  { value: "interval", label: "Interval" },
];

export function defaultFieldsForType(type) {
  if (type === "weighted") return { sets: 3, reps: 5, weight: 10, weightMode: "added", restSec: 0 };
  if (type === "interval") return { workSec: 10, restSec: 5, sets: 6 };
  return { sets: 3, reps: 10, restSec: 0 };
}

export function formatWeightLabel(weightMode, weight) {
  return weightMode === "added" ? `BW +${weight}kg` : `${weight}kg`;
}

export function formatTargetSummary(ex) {
  const restPart = ex.type !== "interval" && ex.restSec > 0 ? ` · ${ex.restSec}s rest` : "";
  if (ex.type === "weighted") return `${ex.sets} × ${ex.reps} reps @ ${formatWeightLabel(ex.weightMode, ex.weight)}${restPart}`;
  if (ex.type === "interval") return `${ex.sets} sets · ${ex.workSec}s on / ${ex.restSec}s off`;
  return `${ex.sets} × ${ex.reps} reps${restPart}`;
}

export function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) +
    " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function stripCodeFence(text) {
  const trimmed = text.trim();
  const match = trimmed.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
  return match ? match[1] : trimmed;
}

export function mergeById(existing, incoming) {
  const result = [...existing];
  incoming.forEach(item => {
    if (!item) return;
    const withId = item.id ? item : { ...item, id: uid() };
    const idx = result.findIndex(e => e.id === withId.id);
    if (idx >= 0) result[idx] = withId; else result.push(withId);
  });
  return result;
}

// Whether every set of this exercise has been ticked/completed, used to
// trigger the "rest before the next exercise" countdown in a session.
export function isStepComplete(exercise, log) {
  if (!log) return false;
  if (exercise.type === "interval") {
    const target = log.targetSets ?? exercise.sets ?? 1;
    return (log.completedSets || 0) >= target;
  }
  const rows = log.rows || [];
  return rows.length > 0 && rows.every(r => r.done);
}

// Turns a card's live log into a history "performed" record, or null if
// nothing was actually logged (so untouched cards are dropped silently).
// For interval exercises, work/rest/sets are read from the log (not the
// exercise prop) since IntervalCard lets those be edited before starting.
export function buildPerformedFromLog(exercise, log) {
  if (!log) return null;
  if (exercise.type === "interval") {
    if (!log.completedSets) return null;
    return {
      type: "interval",
      workSec: log.workSec ?? exercise.workSec,
      restSec: log.restSec ?? exercise.restSec,
      targetSets: log.targetSets ?? exercise.sets,
      completedSets: log.completedSets,
    };
  }
  const doneRows = (log.rows || []).filter(r => r.done);
  if (doneRows.length === 0) return null;
  if (exercise.type === "weighted") {
    return {
      type: "weighted",
      weightMode: exercise.weightMode,
      targetSets: exercise.sets,
      targetReps: exercise.reps,
      targetWeight: exercise.weight,
      sets: doneRows.map(r => ({ reps: Number(r.reps) || 0, weight: Number(r.weight) || 0 })),
    };
  }
  return {
    type: "reps",
    targetSets: exercise.sets,
    targetReps: exercise.reps,
    sets: doneRows.map(r => ({ reps: Number(r.reps) || 0 })),
  };
}

export function formatPerformedSummary(step) {
  const p = step.performed;
  if (p.type === "weighted") {
    return `${p.sets.length} sets: ` + p.sets.map(s => `${s.reps}×${formatWeightLabel(p.weightMode, s.weight)}`).join(", ");
  }
  if (p.type === "interval") {
    return `${p.completedSets}/${p.targetSets} sets · ${p.workSec}s on / ${p.restSec}s off`;
  }
  return `${p.sets.length} sets: ` + p.sets.map(s => s.reps).join(", ") + " reps";
}

// A value is "uniform" across an array when every entry matches the first -
// used below to only suggest a new reps/weight default when every logged set
// actually agrees on one number (a mixed pyramid set is left alone).
function uniformValue(values) {
  return values.length > 0 && values.every(v => v === values[0]) ? values[0] : null;
}

// Compares a logged history step against the values that actually applied
// during that session - a routine step's sets/restSec overrides when this
// came from a routine (matching how startRoutine() resolves them), falling
// back to the exercise's own defaults otherwise (standalone exercise, or a
// routine/step that's since been deleted). Returns null if there's no
// (unambiguous) difference. Used to offer an "Update" action from History
// and the post-session prompt, which can patch the routine step, the
// exercise, or both - whichever the differing fields actually live on.
export function computeTemplateDrift(entry, step, exercises, routines) {
  const ex = exercises.find(e => e.id === step.exerciseId);
  if (!ex) return null;

  let routine = null;
  let routineStep = null;
  if (entry.kind === "routine") {
    routine = routines.find(r => r.id === entry.refId) || null;
    routineStep = (routine && step.routineStepId)
      ? routine.steps.find(s => s.id === step.routineStepId) || null
      : null;
  }

  // sets/restSec can be overridden per routine step; reps/weight/workSec
  // have no routine-level override and always come from the exercise.
  const target = {
    sets: routineStep ? (routineStep.sets ?? ex.sets) : ex.sets,
    reps: ex.reps,
    weight: ex.weight,
    workSec: ex.workSec,
    restSec: routineStep ? (routineStep.restSec ?? (ex.restSec ?? 0)) : ex.restSec,
  };

  const p = step.performed;
  const patch = {};

  if (p.type === "interval") {
    if (p.targetSets !== target.sets) patch.sets = p.targetSets;
    if (p.workSec !== target.workSec) patch.workSec = p.workSec;
    if (p.restSec !== target.restSec) patch.restSec = p.restSec;
  } else {
    if (p.sets.length !== target.sets) patch.sets = p.sets.length;
    const reps = uniformValue(p.sets.map(row => row.reps));
    if (reps !== null && reps !== target.reps) patch.reps = reps;
    if (p.type === "weighted") {
      const weight = uniformValue(p.sets.map(row => row.weight));
      if (weight !== null && weight !== target.weight) patch.weight = weight;
    }
  }

  if (Object.keys(patch).length === 0) return null;

  const routinePatch = {};
  const exercisePatch = {};
  for (const [key, value] of Object.entries(patch)) {
    if (routineStep && (key === "sets" || key === "restSec")) routinePatch[key] = value;
    else exercisePatch[key] = value;
  }

  return { exercise: ex, routine, routineStep, target, patch, routinePatch, exercisePatch };
}

export function formatDriftSummary(drift) {
  const { target, patch } = drift;
  const parts = [];
  if ("sets" in patch) parts.push(`Sets: ${target.sets}→${patch.sets}`);
  if ("reps" in patch) parts.push(`Reps: ${target.reps}→${patch.reps}`);
  if ("weight" in patch) parts.push(`Weight: ${target.weight}→${patch.weight}kg`);
  if ("workSec" in patch) parts.push(`Work: ${target.workSec}s→${patch.workSec}s`);
  if ("restSec" in patch) parts.push(`Rest: ${target.restSec}s→${patch.restSec}s`);
  return parts.join(" · ");
}
