import { formatWeightLabel, isIntervalType } from "./format.js";

const DAY_MS = 24 * 3600 * 1000;

export const RANGES = [
  { value: "30d", label: "30d", days: 30 },
  { value: "90d", label: "90d", days: 90 },
  { value: "1y", label: "1y", days: 365 },
  { value: "all", label: "All", days: null },
];

// One point per workout: every history step logged for this exercise, oldest
// first. An exercise that appears more than once in a routine contributes all
// its logs to that workout's session. Logs of a different type (the exercise
// was switched from reps to weighted, say) aren't comparable and are skipped.
export function collectExerciseSessions(history, exercise) {
  const sessions = [];
  history.forEach(entry => {
    const performed = entry.steps
      .filter(step => step.exerciseId === exercise.id && step.performed?.type === exercise.type)
      .map(step => step.performed);
    if (performed.length === 0) return;
    sessions.push({
      entryId: entry.id,
      date: entry.date,
      time: new Date(entry.date).getTime(),
      refName: entry.kind === "routine" ? entry.refName : null,
      performed,
    });
  });
  return sessions.sort((a, b) => a.time - b.time);
}

export function filterByRange(sessions, range) {
  const days = RANGES.find(r => r.value === range)?.days;
  if (!days) return sessions;
  const cutoff = Date.now() - days * DAY_MS;
  return sessions.filter(x => x.time >= cutoff);
}

const allSets = session => session.performed.flatMap(p => p.sets);
const sum = values => values.reduce((a, b) => a + b, 0);
const round1 = v => Math.round(v * 10) / 10;

// Chartable per-session metrics for each exercise type; the first one is the
// default. format() renders a value for tiles and the chart readout, axis()
// a compact version for the y-axis.
//
// For "BW +" exercises, a known bodyweight adds a total-load metric and
// counts bodyweight into volume. Each session uses the bodyweight recorded
// when it was logged, falling back to the current setting for older logs.
export function metricsFor(exercise, bodyweight) {
  if (exercise.type === "weighted") {
    const withBw = exercise.weightMode === "added" && bodyweight > 0;
    const bwOf = x => x.performed.find(p => p.bodyweight > 0)?.bodyweight ?? bodyweight;
    const topWeight = x => Math.max(...allSets(x).map(set => set.weight));
    return [
      {
        id: "topWeight", label: "Top weight",
        value: topWeight,
        format: v => formatWeightLabel(exercise.weightMode, v),
        axis: v => `${v}kg`,
      },
      ...(withBw ? [{
        id: "totalLoad", label: "Total load",
        value: x => round1(bwOf(x) + topWeight(x)),
        format: v => `${v}kg`,
        axis: v => `${v}kg`,
      }] : []),
      {
        id: "volume", label: "Volume",
        value: x => round1(sum(allSets(x).map(set => set.reps * (set.weight + (withBw ? bwOf(x) : 0))))),
        format: v => `${v}kg`,
        axis: v => `${v}`,
      },
      {
        id: "totalReps", label: "Total reps",
        value: x => sum(allSets(x).map(set => set.reps)),
        format: v => `${v} reps`,
        axis: v => `${v}`,
      },
    ];
  }
  if (isIntervalType(exercise.type)) {
    const weighted = exercise.type === "weightedInterval";
    const withBw = weighted && exercise.weightMode === "added" && bodyweight > 0;
    const bwOf = x => x.performed.find(p => p.bodyweight > 0)?.bodyweight ?? bodyweight;
    const topWeight = x => Math.max(...x.performed.map(p => p.weight ?? 0));
    return [
      ...(weighted ? [{
        id: "topWeight", label: "Top weight",
        value: topWeight,
        format: v => formatWeightLabel(exercise.weightMode, v),
        axis: v => `${v}kg`,
      }] : []),
      ...(withBw ? [{
        id: "totalLoad", label: "Total load",
        value: x => round1(bwOf(x) + topWeight(x)),
        format: v => `${v}kg`,
        axis: v => `${v}kg`,
      }] : []),
      {
        id: "timeOn", label: "Time on",
        value: x => sum(x.performed.map(p => p.completedSets * p.workSec)),
        format: v => `${v}s`,
        axis: v => `${v}s`,
      },
      {
        id: "completedSets", label: "Sets",
        value: x => sum(x.performed.map(p => p.completedSets)),
        format: v => `${v} sets`,
        axis: v => `${v}`,
      },
      {
        id: "workSec", label: "Work interval",
        value: x => Math.max(...x.performed.map(p => p.workSec)),
        format: v => `${v}s`,
        axis: v => `${v}s`,
      },
    ];
  }
  return [
    {
      id: "bestSet", label: "Best set",
      value: x => Math.max(...allSets(x).map(set => set.reps)),
      format: v => `${v} reps`,
      axis: v => `${v}`,
    },
    {
      id: "totalReps", label: "Total reps",
      value: x => sum(allSets(x).map(set => set.reps)),
      format: v => `${v} reps`,
      axis: v => `${v}`,
    },
  ];
}

// The best value of each metric across sessions, dated to the first session
// that reached it.
export function personalRecords(sessions, metrics) {
  return metrics.map(metric => {
    let best = null;
    sessions.forEach(x => {
      const value = metric.value(x);
      if (best === null || value > best.value) best = { value, date: x.date };
    });
    return { metric, ...best };
  }).filter(pr => pr.date);
}
