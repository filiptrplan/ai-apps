import { test } from "node:test";
import assert from "node:assert/strict";
import { review, previews } from "./fsrs.js";
import {
  dayKey, addDays, weekdayOf, tasksFor, normSettings, makeCard, planSession, answerCard,
  nextFocus, cardsFromCheck, fixCounts, searchCards, findDuplicate, sentenceCount, SESSION_CAP,
  doneTasks, normPodcast, normEpisodes, nextInterest, podcastInput, logEpisode, tokenize, EPISODE_STALE_MS,
} from "./model.js";

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const settings = normSettings({});
const NOW = new Date(2026, 9, 29, 12).getTime(); // Thu 29 Oct 2026, noon

test("study days roll over at 4am", () => {
  assert.equal(dayKey(new Date(2026, 9, 29, 3, 59).getTime()), "2026-10-28");
  assert.equal(dayKey(new Date(2026, 9, 29, 4, 0).getTime()), "2026-10-29");
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(weekdayOf("2026-10-29"), 3); // Do
});

test("routine: cards on weekdays, writing and podcast on chosen days, weekends free", () => {
  assert.deepEqual(tasksFor("2026-10-29", settings), ["cards", "writing"]); // Do
  assert.deepEqual(tasksFor("2026-10-28", settings), ["cards", "podcast"]); // Mi
  assert.deepEqual(tasksFor("2026-10-27", settings), ["cards", "writing"]); // Di
  assert.deepEqual(tasksFor("2026-10-31", settings), []); // Sa
  assert.deepEqual(tasksFor("2026-10-31", { ...settings, writingDays: [5] }), ["writing"]);
  assert.deepEqual(tasksFor("2026-11-01", { ...settings, podcastDays: [6] }), ["podcast"]); // So
  assert.deepEqual(doneTasks({ "2026-10-28": { cards: true, podcast: true } }, "2026-10-28"), ["cards", "podcast"]);
  // Settings saved before the podcast existed get the default days.
  assert.deepEqual(normSettings({ level: "B1.1", writingDays: [0] }).podcastDays, [0, 2, 4]);
  assert.equal(normSettings({}).podcastPace, "slower");
  assert.equal(normSettings({ podcastPace: "natural" }).podcastPace, "natural");
  assert.equal(normSettings({ podcastPace: "slowest" }).podcastPace, "slowest");
  assert.equal(normSettings({ podcastPace: "fast" }).podcastPace, "slower");
});

test("podcast: interests start as the topics, then are their own list", () => {
  assert.deepEqual(normPodcast({ interests: null }, settings).interests, settings.topics);
  assert.deepEqual(normPodcast(undefined, settings).interests, settings.topics);
  assert.deepEqual(normPodcast({ interests: ["AI safety", " ", 3] }, settings).interests, ["AI safety"]);
  assert.deepEqual(normPodcast({ interests: [] }, settings).interests, []);
});

test("podcast: stuck episodes count as failed, surprise picks the longest unused interest", () => {
  const v = { episodes: [
    { id: "a", status: "generating", started: NOW - EPISODE_STALE_MS - 1 },
    { id: "b", status: "generating", started: NOW - 1000 },
  ] };
  const { episodes, history } = normEpisodes(v, NOW);
  assert.equal(episodes[0].status, "failed");
  assert.match(episodes[0].error, /too long/);
  assert.equal(episodes[1].status, "generating");
  assert.deepEqual(history, []);
  assert.deepEqual(normEpisodes(null), { episodes: [], history: [] });

  const hist = [{ interest: "Kochen" }, { interest: "Bahn" }, { interest: "Kochen" }];
  assert.equal(nextInterest(["Kochen", "Bahn", "Bouldern"], hist), "Bouldern"); // never had one
  assert.equal(nextInterest(["Kochen", "Bahn"], hist), "Bahn");
  assert.equal(nextInterest([], hist), null);
});

test("podcast: episode input uses new and shaky words and top mistakes", () => {
  const word = (de, srs, added = 1) => ({ ...makeCard({ kind: "word", de, en: de }, "own", added), srs });
  const cards = [
    word("neu", null, 2),
    word("sicher", { stability: 30 }),
    word("wackelig", { stability: 0.5 }),
    { ...makeCard({ kind: "gap", text: "Ich ___", answer: "bin" }, "writing"), srs: null },
  ];
  const writing = [{ fixes: [{ point: "konjunktiv" }, { point: "konjunktiv" }, { point: "v2" }, { point: "other" }] }];
  const { words, mistakes } = podcastInput(cards, writing);
  assert.deepEqual(words, ["neu", "wackelig", "sicher"]);
  assert.equal(mistakes.length, 2);
  assert.match(mistakes[0], /würde/);
});

test("podcast: finishing logs the episode's minutes", () => {
  const listening = { resources: [], current: null, log: [] };
  const next = logEpisode(listening, { id: "ep1", title: "Klettern in Zürich", seconds: 371 }, "2026-10-28");
  assert.equal(next.log.length, 1);
  assert.deepEqual({ ...next.log[0], id: "x" }, { id: "x", day: "2026-10-28", res: "podcast", episode: "ep1", title: "Klettern in Zürich", min: 6 });
  assert.equal(logEpisode(listening, { id: "e", title: "t", seconds: 10 }, "2026-10-28").log[0].min, 1);
});

test("podcast: transcript lines split into words and punctuation", () => {
  assert.deepEqual(tokenize("„Echt?“, sagt Lena. Anime-Episode, geht's?"), [
    { pre: "„", word: "Echt", post: "?“," },
    { pre: "", word: "sagt", post: "" },
    { pre: "", word: "Lena", post: "." },
    { pre: "", word: "Anime-Episode", post: "," },
    { pre: "", word: "geht's", post: "?" },
  ]);
  assert.deepEqual(tokenize("… na ja"), [{ pre: "…", word: "", post: "" }, { pre: "", word: "na", post: "" }, { pre: "", word: "ja", post: "" }]);
});

test("fsrs: new card steps, graduation and growing intervals", () => {
  const a = review(null, 1, NOW);
  assert.equal(a.state, "learning");
  assert.equal(a.due - NOW, 1 * MIN);
  const g = review(null, 3, NOW);
  assert.equal(g.due - NOW, 10 * MIN);
  const grad = review(g, 3, NOW + 10 * MIN);
  assert.equal(grad.state, "review");
  assert.ok(grad.due - (NOW + 10 * MIN) >= DAY);
  const later = review(grad, 3, grad.due);
  assert.ok(later.due - grad.due > grad.due - grad.last, "interval grows after a good review");
  const lapse = review(later, 1, later.due);
  assert.equal(lapse.state, "relearning");
  assert.equal(lapse.lapses, 1);
  assert.equal(previews(later, later.due).again, "10m");
  const [hard, good, easy] = [2, 3, 4].map(g => review(later, g, later.due).due);
  assert.ok(hard < good && good < easy);
});

test("session plan caps reviews and pauses new cards when behind", () => {
  const key = dayKey(NOW);
  const due = Array.from({ length: SESSION_CAP + 5 }, (_, i) => ({ ...makeCard({ kind: "word", de: `w${i}`, en: "x" }, "own"), srs: { ...review(null, 4, NOW - 30 * DAY), due: NOW - i * MIN } }));
  const fresh = [makeCard({ kind: "word", de: "neu", en: "new" }, "own")];
  const behind = planSession([...due, ...fresh], [], settings, key, NOW);
  assert.equal(behind.reviews.length, SESSION_CAP);
  assert.equal(behind.leftover, 5);
  assert.equal(behind.fresh.length, 0);
  assert.equal(behind.reviews[0], due[due.length - 1].id, "most overdue first");

  const ok = planSession([...due.slice(0, 3), ...fresh], [{ de: "a" }, { de: "b" }, { de: "c" }, { de: "d" }, { de: "e" }, { de: "f" }], settings, key, NOW);
  assert.equal(ok.reviews.length, 3);
  assert.equal(ok.fresh.length, 1);
  assert.equal(ok.fromSuggestions, settings.newPerDay - 1);
});

test("own words go before AI words, and the daily limit counts cards already started", () => {
  const key = dayKey(NOW);
  const ai = { ...makeCard({ kind: "word", de: "ai", en: "x" }, "ai", NOW - 5000) };
  const own = { ...makeCard({ kind: "word", de: "own", en: "x" }, "own", NOW) };
  const started = Array.from({ length: 5 }, () => answerCard(makeCard({ kind: "word", de: "s", en: "x" }, "own"), 3, key, NOW));
  const plan = planSession([ai, own, ...started], [], settings, key, NOW);
  assert.deepEqual(plan.fresh, [own.id]);
});

const session = (focus, points, id = Math.random().toString(36)) => ({
  id, focus, fixes: points.map(point => ({ point, from: "a", to: "b", why: "", sentence: `Satz ${point}.` })),
});

test("focus rotates, and a repeated mistake jumps ahead", () => {
  assert.equal(nextFocus([], "A2.2"), "v2");
  assert.equal(nextFocus([session("v2", [])], "A2.2"), "perfekt");
  // Three dative fixes since dativ-praep was last the focus.
  const hist = [session("perfekt", ["dativ-praep"]), session("v2", ["dativ-praep", "dativ-praep"])];
  assert.equal(nextFocus(hist, "A2.2"), "dativ-praep");
  // Points above the level are skipped.
  assert.equal(nextFocus([session("komparativ", [])], "A2.2"), "v2");
  assert.equal(fixCounts(hist)[0].point, "dativ-praep");
});

test("a check makes gap cards and one rule card per point; repeats reset the rule card", () => {
  const s1 = {
    id: "w1", fixes: [
      { point: "weil", from: "hatte frei", to: "frei hatte", sentence: "…, weil ich frei hatte.", gap: { text: "…, weil ich frei ___.", answer: "hatte", en: "…, because I was off." } },
      { point: "other", from: "Halle", to: "die Halle", sentence: "Die Halle war voll.", gap: { text: "___ Halle war voll.", answer: "Die", en: "The gym was full." } },
    ],
  };
  const first = cardsFromCheck([], s1, NOW);
  assert.deepEqual(first.made.map(m => m.type), ["gap", "gap", "rule"]);
  const rule = first.cards.find(c => c.kind === "rule");
  assert.equal(rule.point, "weil");

  const studied = first.cards.map(c => (c.id === rule.id ? answerCard(answerCard(c, 4, "2026-10-29", NOW), 3, "2026-11-02", NOW + 4 * DAY) : c));
  const s2 = { id: "w2", fixes: [{ point: "weil", from: "x", to: "y", sentence: "…, weil es regnet.", gap: null }] };
  const second = cardsFromCheck(studied, s2, NOW + 6 * DAY);
  assert.equal(second.cards.filter(c => c.kind === "rule").length, 1);
  const r2 = second.cards.find(c => c.kind === "rule");
  assert.deepEqual(r2.examples, ["…, weil es regnet.", "…, weil ich frei hatte."]);
  assert.equal(r2.srs.state, "relearning");
  assert.equal(r2.srs.due, NOW + 6 * DAY);
  assert.deepEqual(second.made, [{ type: "rule", id: r2.id, label: "weil → verb at the end", repeat: true }]);
});

test("search, filters and duplicates ignore case and umlauts", () => {
  const cards = [
    makeCard({ kind: "noun", de: "Antrag", article: "der", plural: "die Anträge", en: "application (form)" }, "own"),
    makeCard({ kind: "verb", de: "umsteigen", perfekt: "ist umgestiegen", separable: true, en: "to change trains" }, "own"),
  ];
  assert.equal(searchCards(cards, "antrage").length, 1);
  assert.equal(searchCards(cards, "", "verbs")[0].de, "umsteigen");
  assert.equal(findDuplicate(cards, { kind: "noun", de: "antrag" })?.id, cards[0].id);
  assert.equal(sentenceCount("Gestern ich bin klettern gegangen, weil ich hatte frei. Die Halle war sehr voll."), 2);
  assert.equal(sentenceCount("Eins. Zwei"), 2);
});
