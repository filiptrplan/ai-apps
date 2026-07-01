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
    return (log.completedSets || 0) >= (exercise.sets || 1);
  }
  const rows = log.rows || [];
  return rows.length > 0 && rows.every(r => r.done);
}

// Turns a card's live log into a history "performed" record, or null if
// nothing was actually logged (so untouched cards are dropped silently).
export function buildPerformedFromLog(exercise, log) {
  if (!log) return null;
  if (exercise.type === "interval") {
    if (!log.completedSets) return null;
    return {
      type: "interval",
      workSec: exercise.workSec,
      restSec: exercise.restSec,
      targetSets: exercise.sets,
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
