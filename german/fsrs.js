// FSRS-5 spaced repetition (https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm),
// with Anki-style learning steps for new and lapsed cards. Pure functions on
// a card's `srs` state, so the app and the MCP tools schedule the same way.
//
// srs: { state, due, stability, difficulty, step, reps, lapses, last }
//   state: "learning" | "review" | "relearning"
//   due, last: ms timestamps
// A card that has never been studied has srs = null.

const W = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925,
  1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
];
const DECAY = -0.5;
const FACTOR = 19 / 81;
const RETENTION = 0.9;
const MAX_DAYS = 365 * 5;

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
// Steps before a card graduates to day intervals, and for relearning.
const LEARN_STEPS = [1 * MIN, 10 * MIN];
const RELEARN_STEPS = [10 * MIN];

export const RATINGS = { again: 1, hard: 2, good: 3, easy: 4 };

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

function initStability(g) {
  return Math.max(W[g - 1], 0.1);
}

function initDifficulty(g) {
  return clamp(W[4] - Math.exp(W[5] * (g - 1)) + 1, 1, 10);
}

function nextDifficulty(d, g) {
  const delta = -W[6] * (g - 3);
  const d1 = d + delta * ((10 - d) / 9);
  return clamp(W[7] * initDifficulty(4) + (1 - W[7]) * d1, 1, 10);
}

export function retrievability(elapsedDays, s) {
  return Math.pow(1 + (FACTOR * elapsedDays) / s, DECAY);
}

function recallStability(d, s, r, g) {
  const hard = g === 2 ? W[15] : 1;
  const easy = g === 4 ? W[16] : 1;
  return s * (1 + Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * (Math.exp(W[10] * (1 - r)) - 1) * hard * easy);
}

function forgetStability(d, s, r) {
  const sf = W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r));
  return Math.min(sf, s);
}

function shortTermStability(s, g) {
  return s * Math.exp(W[17] * (g - 3 + W[18]));
}

// Days until recall probability drops to RETENTION.
function intervalDays(s) {
  const days = (s / FACTOR) * (Math.pow(RETENTION, 1 / DECAY) - 1);
  return clamp(Math.round(days), 1, MAX_DAYS);
}

// Graduated intervals for Hard < Good < Easy must stay in that order.
function reviewIntervals(s, d, r, g, prevInterval) {
  const iv = {
    2: intervalDays(recallStability(d, s, r, 2)),
    3: intervalDays(recallStability(d, s, r, 3)),
    4: intervalDays(recallStability(d, s, r, 4)),
  };
  iv[2] = Math.min(iv[2], Math.max(prevInterval, 1));
  iv[3] = Math.max(iv[3], iv[2] + 1);
  iv[4] = Math.max(iv[4], iv[3] + 1);
  return iv[g];
}

// The card's next srs state after answering with grade g (1-4) at `now`.
export function review(srs, g, now = Date.now()) {
  if (!srs) {
    const s = initStability(g);
    const d = initDifficulty(g);
    const base = { stability: s, difficulty: d, reps: 1, lapses: 0, last: now };
    if (g === 4) return { ...base, state: "review", step: 0, due: now + intervalDays(s) * DAY };
    const step = g === 3 ? 1 : 0;
    const wait = g === 2 ? (LEARN_STEPS[0] + LEARN_STEPS[1]) / 2 : LEARN_STEPS[step];
    return { ...base, state: "learning", step, due: now + wait };
  }

  const elapsed = Math.max(0, (now - srs.last) / DAY);
  const r = retrievability(elapsed, srs.stability);
  const reps = srs.reps + 1;
  const d = nextDifficulty(srs.difficulty, g);

  if (srs.state === "learning" || srs.state === "relearning") {
    const steps = srs.state === "learning" ? LEARN_STEPS : RELEARN_STEPS;
    const s = shortTermStability(srs.stability, g);
    const base = { ...srs, stability: s, difficulty: d, reps, last: now };
    if (g === 1) return { ...base, step: 0, due: now + steps[0] };
    if (g === 2) return { ...base, due: now + (steps[srs.step] ?? steps[steps.length - 1]) };
    const next = srs.step + 1;
    if (g === 3 && next < steps.length) return { ...base, step: next, due: now + steps[next] };
    const days = g === 4 ? Math.max(intervalDays(s), 2) : intervalDays(s);
    return { ...base, state: "review", step: 0, due: now + days * DAY };
  }

  if (g === 1) {
    const s = forgetStability(srs.difficulty, srs.stability, r);
    return { ...srs, state: "relearning", step: 0, stability: s, difficulty: d, reps, lapses: srs.lapses + 1, last: now, due: now + RELEARN_STEPS[0] };
  }
  const s = recallStability(srs.difficulty, srs.stability, r, g);
  const prev = Math.round((srs.due - srs.last) / DAY);
  const days = reviewIntervals(srs.stability, srs.difficulty, r, g, prev);
  return { ...srs, state: "review", step: 0, stability: s, difficulty: d, reps, last: now, due: now + days * DAY };
}

// What each answer would schedule, as short labels for the rating buttons:
// { again: "1m", hard: "2d", good: "5d", easy: "12d" }.
export function previews(srs, now = Date.now()) {
  const out = {};
  for (const [name, g] of Object.entries(RATINGS)) out[name] = formatWait(review(srs, g, now).due - now);
  return out;
}

export function formatWait(ms) {
  if (ms < 60 * MIN) return `${Math.max(1, Math.round(ms / MIN))}m`;
  if (ms < DAY) return `${Math.round(ms / (60 * MIN))}h`;
  const days = Math.round(ms / DAY);
  if (days < 31) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1).replace(/\.0$/, "")}y`;
}
