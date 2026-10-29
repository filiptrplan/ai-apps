// Data model for the German app: what's stored, plus the pure logic on top
// of it (daily tasks, the card session plan, the writing focus rotation and
// the stats). No React, so the MCP tools reuse it as is.
//
// Everything lives in app_data under APP_ID, one synced JSON value per key:
//
//   cards      Card[]          the deck, with each card's FSRS state
//   suggest    Suggestion[]    AI-suggested words waiting to become new cards
//   writing    Session[]       every writing session, newest first
//   draft      Draft | null    today's writing task in progress
//   log        { [day]: Day }  which tasks were done on each day
//   listening  Listening       resources, the current one, minutes log
//   podcast    { interests }   what AI podcast episodes are about (null until
//                              edited: the Settings topics)
//   episodes   Episodes        the AI podcast episodes; written only by the
//                              german-podcast edge function (see there)
//   settings   Settings
//
// Card: {
//   id, kind: "noun" | "verb" | "word" | "gap" | "rule",
//   en,                      English (question side); for gap cards the whole sentence
//   de,                      German answer: noun without article, verb infinitive, phrase
//   article?, plural?,       nouns: "der", "die Anträge"
//   perfekt?, separable?,    verbs: "hat eingereicht", true
//   example?,                one German sentence
//   text?, answer?,          gap cards: "Gestern ___ klettern gegangen.", "bin ich"
//   point?, examples?,       gap and rule cards: grammar point id; rule cards: your sentences
//   source: "own" | "ai" | "writing" | "podcast" | "claude",
//   added,                   ms timestamp
//   intro,                   day it was first studied, or null while new
//   srs,                     FSRS state (see fsrs.js), null while new
// }
import { review } from "./fsrs.js";
import { POINTS, POINT_IDS, pointById } from "./grammar.js";

export const APP_ID = "german";
export const KEYS = {
  cards: "german-cards",
  suggest: "german-suggest",
  writing: "german-writing",
  draft: "german-draft",
  log: "german-log",
  listening: "german-listening",
  podcast: "german-podcast",
  episodes: "german-episodes",
  settings: "german-settings",
};

export const LEVELS = ["A1.1", "A1.2", "A2.1", "A2.2", "B1.1", "B1.2", "B2.1", "B2.2"];
export const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
export const ARTICLES = ["der", "die", "das"];

export const DEFAULT_SETTINGS = {
  level: "A2.2",
  topics: ["Uni / ETH", "Klettern", "Kochen", "Bahn"],
  writingDays: [1, 3], // Di, Do
  podcastDays: [0, 2, 4], // Mo, Mi, Fr
  newPerDay: 6,
};

export const DEFAULT_LISTENING = {
  resources: [
    { id: "nicos-weg", name: "Nicos Weg", desc: "DW · video series with exercises", level: "A1–B1", url: "https://learngerman.dw.com/de/nicos-weg/c-36519789" },
    { id: "lgn", name: "Langsam gesprochene Nachrichten", desc: "DW · short daily news, read slowly", level: "B1", url: "https://learngerman.dw.com/de/langsam-gesprochene-nachrichten/s-60040332" },
    { id: "easy-german", name: "Easy German", desc: "Street interviews + podcast", level: "A2–B2", url: "https://www.youtube.com/@EasyGerman" },
  ],
  current: "nicos-weg",
  log: [],
};

// The card session stops growing at about this long; reviews beyond it wait
// for the next day and new cards pause until they're caught up.
export const SESSION_MINUTES = 15;
export const SECONDS_PER_CARD = 15;
export const SESSION_CAP = Math.round((SESSION_MINUTES * 60) / SECONDS_PER_CARD);
// How many AI-suggested words to keep ready for offline days.
export const SUGGEST_BUFFER = 10;
// A grammar point corrected this often since it was last the focus jumps
// the rotation.
export const JUMP_AFTER = 3;

const DAY_MS = 24 * 60 * 60 * 1000;
// Like Anki, a "day" runs from 4am to 4am, so a late session counts for the
// evening it started in.
const ROLLOVER_HOURS = 4;

export const uid = () => Math.random().toString(36).slice(2, 10);

const pad = n => String(n).padStart(2, "0");
const localKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// "2026-10-29" for the study day `now` falls in.
export function dayKey(now = Date.now()) {
  return localKey(new Date(now - ROLLOVER_HOURS * 3600 * 1000));
}

export function addDays(key, n) {
  const [y, m, d] = key.split("-").map(Number);
  return localKey(new Date(y, m - 1, d + n));
}

// 0 = Monday … 6 = Sunday.
export function weekdayOf(key) {
  const [y, m, d] = key.split("-").map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

// ms timestamp when the study day `key` ends (4am the next morning).
export function dayEnd(key) {
  const [y, m, d] = addDays(key, 1).split("-").map(Number);
  return new Date(y, m - 1, d, ROLLOVER_HOURS).getTime();
}

export function weekKeys(key) {
  const monday = addDays(key, -weekdayOf(key));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

// ---------- settings ----------

export function normSettings(s) {
  const v = { ...DEFAULT_SETTINGS, ...(s || {}) };
  return {
    level: LEVELS.includes(v.level) ? v.level : DEFAULT_SETTINGS.level,
    topics: Array.isArray(v.topics) ? v.topics.filter(t => typeof t === "string" && t.trim()) : [],
    writingDays: Array.isArray(v.writingDays) ? v.writingDays.filter(d => d >= 0 && d < 7) : [],
    podcastDays: Array.isArray(v.podcastDays) ? v.podcastDays.filter(d => d >= 0 && d < 7) : [],
    newPerDay: Math.min(30, Math.max(0, Math.round(Number(v.newPerDay) || 0))),
  };
}

const levelIndex = l => Math.max(0, LEVELS.indexOf(l));

// ---------- daily tasks ----------

// The day's fixed tasks, in order: cards on weekdays, writing and the
// podcast on their chosen days. Weekends without either have none (cards
// are optional then).
export function tasksFor(key, settings) {
  const wd = weekdayOf(key);
  const tasks = [];
  if (wd < 5) tasks.push("cards");
  if (settings.writingDays.includes(wd)) tasks.push("writing");
  if (settings.podcastDays.includes(wd)) tasks.push("podcast");
  return tasks;
}

export function doneTasks(log, key) {
  const day = log[key] || {};
  return ["cards", "writing", "podcast"].filter(t => day[t]);
}

// ---------- cards ----------

const text = v => (typeof v === "string" ? v.trim() : "");

// A new card from filled-in fields. Unknown kinds become plain words.
export function makeCard(fields, source, now = Date.now()) {
  const kind = ["noun", "verb", "word", "gap", "rule"].includes(fields.kind) ? fields.kind : "word";
  const card = { id: uid(), kind, en: text(fields.en), de: text(fields.de), source, added: now, intro: null, srs: null };
  if (kind === "noun") {
    card.article = ARTICLES.includes(fields.article) ? fields.article : "der";
    card.plural = text(fields.plural);
  }
  if (kind === "verb") {
    card.perfekt = text(fields.perfekt);
    card.separable = !!fields.separable;
  }
  if (kind === "gap") {
    card.text = text(fields.text);
    card.answer = text(fields.answer);
  }
  if (kind === "gap" || kind === "rule") card.point = fields.point || null;
  if (kind === "rule") card.examples = Array.isArray(fields.examples) ? fields.examples.filter(Boolean) : [];
  if (fields.writing) card.writing = fields.writing;
  const example = text(fields.example);
  if (example) card.example = example;
  return card;
}

// Applies an edit from the card editor or a tool, keeping the id and the
// study state.
export function editCard(card, fields) {
  const next = makeCard({ ...card, ...fields, kind: fields.kind || card.kind }, card.source, card.added);
  return { ...next, id: card.id, intro: card.intro, srs: card.srs };
}

export const isNew = c => !c.srs;
export const isDue = (c, now = Date.now()) => !!c.srs && c.srs.due <= now;

// The German side as one line, e.g. "der Antrag", "einreichen".
export function germanOf(c) {
  if (c.kind === "noun") return `${c.article} ${c.de}`;
  if (c.kind === "gap") return c.text.replace("___", c.answer);
  if (c.kind === "rule") return pointById(c.point)?.label || c.de;
  return c.de;
}

// Case- and accent-insensitive form for matching, so "antrage" finds
// "Anträge" and "strasse" finds "Straße".
const fold = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");

export function findDuplicate(cards, fields) {
  const de = fold(text(fields.de));
  if (!de || fields.kind === "gap" || fields.kind === "rule") return null;
  return cards.find(c => c.kind !== "gap" && c.kind !== "rule" && fold(c.de) === de) || null;
}

export function searchCards(cards, query, filter = "all", now = Date.now()) {
  const q = fold(query.trim());
  return cards.filter(c => {
    if (filter === "nouns" && c.kind !== "noun") return false;
    if (filter === "verbs" && c.kind !== "verb") return false;
    if (filter === "grammar" && c.kind !== "gap" && c.kind !== "rule") return false;
    if (filter === "hard" && !(c.srs && (c.srs.lapses >= 2 || c.srs.difficulty >= 7.5))) return false;
    if (!q) return true;
    return [c.de, c.en, c.plural, c.example, c.text, c.answer, germanOf(c)].some(v => v && fold(v).includes(q));
  });
}

// Order new cards are introduced in: your own (typed, from writing, from
// Claude) before AI suggestions, oldest first.
function newOrder(a, b) {
  const rank = c => (c.source === "ai" ? 1 : 0);
  return rank(a) - rank(b) || a.added - b.added;
}

// What today's card session holds. Reviews due by the end of the day, most
// overdue first, up to SESSION_CAP; new cards fill what's left of the cap
// and of the daily new-card limit, but only once the reviews are caught up.
// `fromSuggestions` is how many AI suggestions to turn into cards to fill
// open new-card slots.
export function planSession(cards, suggestions, settings, key, now = Date.now()) {
  const end = dayEnd(key);
  const due = cards.filter(c => c.srs && c.srs.due < end).sort((a, b) => a.srs.due - b.srs.due);
  const reviews = due.slice(0, SESSION_CAP);
  const leftover = due.length - reviews.length;
  const introducedToday = cards.filter(c => c.intro === key).length;
  let slots = leftover > 0 ? 0 : Math.min(settings.newPerDay - introducedToday, SESSION_CAP - reviews.length);
  slots = Math.max(0, slots);
  const fresh = cards.filter(isNew).sort(newOrder).slice(0, slots);
  const fromSuggestions = Math.min(slots - fresh.length, suggestions.length);
  return { reviews: reviews.map(c => c.id), fresh: fresh.map(c => c.id), fromSuggestions, leftover };
}

export function sessionMinutes(count) {
  return Math.max(1, Math.round((count * SECONDS_PER_CARD) / 60));
}

// Answers a card: new FSRS state, and the day it was first studied.
export function answerCard(card, grade, key, now = Date.now()) {
  return { ...card, srs: review(card.srs, grade, now), intro: card.intro || key };
}

// ---------- writing ----------

// Fixes per grammar point over all sessions: [{ point, count }], most first.
export function fixCounts(writing) {
  const counts = {};
  writing.forEach(s => s.fixes.forEach(f => {
    if (f.point && f.point !== "other") counts[f.point] = (counts[f.point] || 0) + 1;
  }));
  return Object.entries(counts).map(([point, count]) => ({ point, count })).sort((a, b) => b.count - a.count);
}

// Today's grammar focus: a point corrected JUMP_AFTER+ times since it was
// last the focus goes first; otherwise the next point in the rotation after
// the last session's. Only points at or below your level are used.
// `writing` is newest first.
export function nextFocus(writing, level) {
  const eligible = POINTS.filter(p => levelIndex(p.level) <= levelIndex(level)).map(p => p.id);
  const pool = eligible.length ? eligible : [POINT_IDS[0]];

  const since = {};
  const seenFocus = new Set();
  for (const s of writing) {
    s.fixes.forEach(f => {
      if (pool.includes(f.point) && !seenFocus.has(f.point)) since[f.point] = (since[f.point] || 0) + 1;
    });
    if (s.focus) seenFocus.add(s.focus);
  }
  const jump = Object.entries(since).filter(([, n]) => n >= JUMP_AFTER).sort((a, b) => b[1] - a[1])[0];
  if (jump) return jump[0];

  const last = writing.find(s => s.focus && pool.includes(s.focus));
  if (!last) return pool[0];
  return pool[(pool.indexOf(last.focus) + 1) % pool.length];
}

export function sentenceCount(t) {
  return (t.match(/[^.!?…]+[.!?…]+/g) || []).length + (/[^\s.!?…]\s*$/.test(t.trim()) ? 1 : 0);
}

// Turns a checked text into cards: a gap card per fix, and per grammar
// point one rule card — created the first time, and on a repeat mistake
// given your sentence as an example and sent back for review. Returns the
// new deck and what changed, for the "These become cards" list.
export function cardsFromCheck(cards, session, now = Date.now()) {
  let deck = cards;
  const made = [];
  for (const f of session.fixes) {
    if (!f.gap || !f.gap.text.includes("___")) continue;
    const card = makeCard({ kind: "gap", en: f.gap.en, de: f.to, text: f.gap.text, answer: f.gap.answer, point: f.point, writing: session.id }, "writing", now);
    deck = [card, ...deck];
    made.push({ type: "gap", id: card.id, label: card.text });
  }
  const points = [...new Set(session.fixes.map(f => f.point).filter(p => pointById(p)))];
  for (const point of points) {
    const p = pointById(point);
    const sentence = session.fixes.find(f => f.point === point)?.sentence || "";
    const existing = deck.find(c => c.kind === "rule" && c.point === point);
    if (existing) {
      const examples = sentence && !existing.examples.includes(sentence) ? [sentence, ...existing.examples].slice(0, 5) : existing.examples;
      deck = deck.map(c => (c.id === existing.id ? { ...c, examples, srs: resetSrs(c.srs, now) } : c));
      made.push({ type: "rule", id: existing.id, label: p.label, repeat: true });
    } else {
      const card = makeCard({ kind: "rule", en: p.rule.q, de: p.rule.a, point, examples: sentence ? [sentence] : [], writing: session.id }, "writing", now);
      deck = [card, ...deck];
      made.push({ type: "rule", id: card.id, label: p.label, repeat: false });
    }
  }
  return { cards: deck, made };
}

// Sends a studied card back to relearning, due now. New cards stay new.
function resetSrs(srs, now) {
  if (!srs) return null;
  return { ...srs, state: "relearning", step: 0, due: now, stability: Math.min(srs.stability, 1), lapses: srs.lapses + 1 };
}

// ---------- listening ----------

export function normListening(l) {
  const v = { ...DEFAULT_LISTENING, ...(l || {}) };
  const resources = Array.isArray(v.resources) ? v.resources : [];
  return {
    resources,
    current: resources.some(r => r.id === v.current) ? v.current : resources[0]?.id || null,
    log: Array.isArray(v.log) ? v.log : [],
  };
}

export function minutesIn(log, keys) {
  const set = new Set(keys);
  return log.filter(e => set.has(e.day)).reduce((n, e) => n + e.min, 0);
}

// ---------- podcast ----------

// A "generating" episode older than this is taken as failed (its background
// task was killed); keep in sync with STALE_MS in the german-podcast edge
// function.
export const EPISODE_STALE_MS = 10 * 60 * 1000;
export const DEFAULT_PODCAST = { interests: null };
export const DEFAULT_EPISODES = { episodes: [], history: [] };

// Podcast interests start out as the Settings topics and are their own
// list from the first edit on.
export function normPodcast(p, settings) {
  const interests = Array.isArray(p?.interests) ? p.interests : settings.topics;
  return { interests: interests.filter(t => typeof t === "string" && t.trim()) };
}

export function normEpisodes(v, now = Date.now()) {
  const episodes = (Array.isArray(v?.episodes) ? v.episodes : []).map(e =>
    e.status === "generating" && now - e.started >= EPISODE_STALE_MS
      ? { ...e, status: "failed", error: "Making the episode took too long - try again." }
      : e);
  return { episodes, history: Array.isArray(v?.history) ? v.history : [] };
}

export const episodeMinutes = ep => Math.max(1, Math.round((ep.seconds || 0) / 60));

// "Surprise me": the interest with no episode for the longest (never first).
// `history` is newest first.
export function nextInterest(interests, history) {
  if (!interests.length) return null;
  const last = t => {
    const i = history.findIndex(h => h.interest === t);
    return i === -1 ? Infinity : i;
  };
  return [...interests].sort((a, b) => last(b) - last(a))[0];
}

// What the next episode is built from: some of your words (the next new
// cards and the studied ones you hold least well) and the grammar you're
// corrected on most.
export function podcastInput(cards, writing) {
  const words = cards.filter(c => c.kind !== "gap" && c.kind !== "rule");
  const fresh = words.filter(isNew).sort(newOrder).slice(0, 5);
  const shaky = words.filter(c => c.srs).sort((a, b) => a.srs.stability - b.srs.stability).slice(0, 7);
  const mistakes = fixCounts(writing).slice(0, 3).map(f => pointById(f.point)).filter(Boolean)
    .map(p => `${p.label} (e.g. ${p.model})`);
  return { words: [...fresh, ...shaky].map(germanOf), mistakes };
}

// A finished episode: its length goes in the listening log.
export function logEpisode(listening, ep, key) {
  const entry = { id: uid(), day: key, res: "podcast", episode: ep.id, title: ep.title, min: episodeMinutes(ep) };
  return { ...listening, log: [entry, ...listening.log] };
}

// Splits a transcript line into words (tappable) and what's between them.
// [{ word, pre, post }] where pre/post hold spaces and punctuation.
export function tokenize(line) {
  return line.split(/\s+/).filter(Boolean).map(t => {
    const m = t.match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u);
    return { pre: m[1], word: m[2], post: m[3] };
  });
}

// ---------- stats ----------

export function stats(cards, writing, listening, log, key, now = Date.now()) {
  const week = weekKeys(key);
  const tomorrowEnd = dayEnd(addDays(key, 1));
  const todayEnd = dayEnd(key);
  return {
    week: week.map(k => ({ key: k, cards: !!log[k]?.cards, writing: !!log[k]?.writing, future: k > key })),
    cardDays: week.filter(k => log[k]?.cards).length,
    writingDays: week.filter(k => log[k]?.writing).length,
    learned: cards.filter(c => c.srs && c.srs.state === "review").length,
    total: cards.length,
    newCount: cards.filter(isNew).length,
    dueTomorrow: cards.filter(c => c.srs && c.srs.due >= todayEnd && c.srs.due < tomorrowEnd).length,
    listeningMin: minutesIn(listening.log, week),
    writingSessions: writing.length,
    topFix: fixCounts(writing)[0] || null,
    now,
  };
}
