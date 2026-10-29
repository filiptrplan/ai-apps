import { test } from "node:test";
import assert from "node:assert/strict";
import { review, previews } from "./fsrs.js";
import {
  dayKey, addDays, weekdayOf, tasksFor, normSettings, makeCard, planSession, answerCard,
  nextFocus, cardsFromCheck, fixCounts, searchCards, findDuplicate, sentenceCount, SESSION_CAP,
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

test("routine: cards on weekdays, writing on chosen days, weekends free", () => {
  assert.deepEqual(tasksFor("2026-10-29", settings), ["cards", "writing"]); // Do
  assert.deepEqual(tasksFor("2026-10-28", settings), ["cards"]); // Mi
  assert.deepEqual(tasksFor("2026-10-31", settings), []); // Sa
  assert.deepEqual(tasksFor("2026-10-31", { ...settings, writingDays: [5] }), ["writing"]);
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
