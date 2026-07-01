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

// Compares a logged history step against the CURRENT exercise definition and
// returns { exercise, patch } describing how the exercise's own template
// differs from what was actually logged, or null if there's no (unambiguous)
// difference. Used to offer an "Update template" action from History.
export function computeTemplateDrift(step, exercises) {
  const ex = exercises.find(e => e.id === step.exerciseId);
  if (!ex) return null;
  const p = step.performed;
  const patch = {};

  if (p.type === "interval") {
    if (p.targetSets !== ex.sets) patch.sets = p.targetSets;
    if (p.workSec !== ex.workSec) patch.workSec = p.workSec;
    if (p.restSec !== ex.restSec) patch.restSec = p.restSec;
  } else {
    if (p.sets.length !== ex.sets) patch.sets = p.sets.length;
    const reps = uniformValue(p.sets.map(row => row.reps));
    if (reps !== null && reps !== ex.reps) patch.reps = reps;
    if (p.type === "weighted") {
      const weight = uniformValue(p.sets.map(row => row.weight));
      if (weight !== null && weight !== ex.weight) patch.weight = weight;
    }
  }

  return Object.keys(patch).length > 0 ? { exercise: ex, patch } : null;
}

export function formatDriftSummary(drift) {
  const { exercise: ex, patch } = drift;
  const parts = [];
  if ("sets" in patch) parts.push(`Sets: ${ex.sets}→${patch.sets}`);
  if ("reps" in patch) parts.push(`Reps: ${ex.reps}→${patch.reps}`);
  if ("weight" in patch) parts.push(`Weight: ${ex.weight}→${patch.weight}kg`);
  if ("workSec" in patch) parts.push(`Work: ${ex.workSec}s→${patch.workSec}s`);
  if ("restSec" in patch) parts.push(`Rest: ${ex.restSec}s→${patch.restSec}s`);
  return parts.join(" · ");
}
