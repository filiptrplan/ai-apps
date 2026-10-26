// The week plan: numbered days, each with linked routines and free-text
// notes, ticked off in any order and reset as a new cycle. Pure functions
// with no React/Supabase imports, so the app and the MCP server share them.
//
// plan = { days: [{ id, title, description, doneAt, items: [{ id, routineId } | { id, text }] }],
//          cycleStartedAt, cycles: [{ startedAt, endedAt }] }
import { uid } from "./data.js";

const DAY_MS = 24 * 3600 * 1000;
const AVG_CYCLES = 6;

const time = iso => new Date(iso).getTime();

export function emptyPlan(now = new Date().toISOString()) {
  return { days: [], cycleStartedAt: now, cycles: [] };
}

export function newDay() {
  return { id: uid(), title: "", description: "", doneAt: null, items: [] };
}

export function dayLabel(plan, index) {
  const title = (plan.days[index].title || "").trim();
  return title ? `Day ${index + 1} · ${title}` : `Day ${index + 1}`;
}

export const isRoutineItem = item => item.routineId != null;

// Which routine items count as logged this cycle. Nothing is stored: each
// routine workout since the cycle started is credited, oldest first, to the
// first day that still has that routine unlogged and is either unticked or
// was ticked after the workout (so ticking a day doesn't push its credit
// onto the next day, and a day ticked by hand doesn't absorb later workouts).
export function planProgress(plan, history) {
  const days = plan.days.map(() => new Set());
  const since = time(plan.cycleStartedAt);
  const entries = history
    .filter(h => h.kind === "routine" && time(h.date) >= since)
    .sort((a, b) => time(a.date) - time(b.date));
  for (const entry of entries) {
    for (let i = 0; i < plan.days.length; i++) {
      const day = plan.days[i];
      if (day.doneAt && time(day.doneAt) < time(entry.date)) continue;
      const item = day.items.find(it => it.routineId === entry.refId && !days[i].has(it.id));
      if (item) { days[i].add(item.id); break; }
    }
  }
  return plan.days.map((day, i) => {
    const routines = day.items.filter(isRoutineItem);
    return {
      credited: days[i],
      allRoutinesLogged: routines.length > 0 && routines.every(it => days[i].has(it.id)),
    };
  });
}

// The first unticked day that `entry` (just added to `history`) completes.
export function dayCompletedBy(plan, history, entry) {
  if (!plan) return null;
  const before = planProgress(plan, history);
  const after = planProgress(plan, [entry, ...history]);
  const i = plan.days.findIndex((day, k) => !day.doneAt && after[k].allRoutinesLogged && !before[k].allRoutinesLogged);
  return i === -1 ? null : plan.days[i].id;
}

export function toggleDay(plan, dayId, now = new Date().toISOString()) {
  return { ...plan, days: plan.days.map(d => d.id === dayId ? { ...d, doneAt: d.doneAt ? null : now } : d) };
}

export const allDaysDone = plan => plan.days.length > 0 && plan.days.every(d => d.doneAt);

export function startNewCycle(plan, now = new Date().toISOString()) {
  return {
    ...plan,
    days: plan.days.map(d => ({ ...d, doneAt: null })),
    cycleStartedAt: now,
    cycles: [...plan.cycles, { startedAt: plan.cycleStartedAt, endedAt: now }],
  };
}

export function removeRoutineFromPlan(plan, routineId) {
  return { ...plan, days: plan.days.map(d => ({ ...d, items: d.items.filter(it => it.routineId !== routineId) })) };
}

export function cycleSummary(plan) {
  const recent = plan.cycles.slice(-AVG_CYCLES);
  const avgDays = recent.length === 0 ? null
    : Math.round(recent.reduce((sum, c) => sum + (time(c.endedAt) - time(c.startedAt)) / DAY_MS, 0) / recent.length * 10) / 10;
  return { number: plan.cycles.length + 1, startedAt: plan.cycleStartedAt, avgDays };
}
