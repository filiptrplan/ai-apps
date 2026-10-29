import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./server.js";

const K = {
  cards: "german-cards", writing: "german-writing", settings: "german-settings",
  podcast: "german-podcast", episodes: "german-episodes", listening: "german-listening",
};

// In-memory stand-in for createAppData().
function fakeAppData(initial = {}) {
  const rows = new Map(Object.entries(initial).map(([k, v]) => [k, structuredClone(v)]));
  return {
    rows,
    async read(appId, key, fallback) {
      assert.equal(appId, "german");
      return rows.has(key) ? structuredClone(rows.get(key)) : fallback;
    },
    async update(appId, key, fallback, mutate) {
      assert.equal(appId, "german");
      const next = mutate(rows.has(key) ? structuredClone(rows.get(key)) : fallback);
      rows.set(key, next);
      return next;
    },
  };
}

async function connect(initial, extra = {}) {
  const appData = fakeAppData(initial);
  const server = createMcpServer({ appData, ...extra });
  const client = new Client({ name: "test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name, args = {}) => {
    const res = await client.callTool({ name, arguments: args });
    const text = res.content[0].text;
    if (res.isError) return { error: text };
    return JSON.parse(text);
  };
  return { appData, client, call };
}

const DAY = 864e5;
const antrag = {
  id: "c1", kind: "noun", de: "Antrag", article: "der", plural: "die Anträge", en: "the application (form)",
  example: "Ich habe den Antrag abgeschickt.", source: "own", added: 1, intro: "2026-10-20",
  srs: { state: "review", due: Date.now() - DAY, stability: 4, difficulty: 5, step: 0, reps: 3, lapses: 2, last: Date.now() - 5 * DAY },
};
const seed = () => ({
  [K.cards]: [antrag],
  [K.writing]: [{
    id: "w1", day: "2026-10-27", prompt: "Was hast du gemacht?", focus: "weil", text: "…", corrected: "…",
    fixes: [{ from: "hatte frei", to: "frei hatte", why: "weil sends the verb to the end.", point: "weil" }],
  }],
  [K.settings]: { level: "B1.1" },
});

test("lists every german tool", async () => {
  const { client } = await connect(seed());
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(t => t.name).filter(n => n.startsWith("german_")).sort(), [
    "german_add_cards", "german_delete_cards", "german_get_overview", "german_get_podcast", "german_get_writing",
    "german_search_cards", "german_update_card", "german_update_podcast_interests",
  ]);
});

test("overview reports level, deck counts and mistakes", async () => {
  const { call } = await connect(seed());
  const o = await call("german_get_overview");
  assert.equal(o.settings.level, "B1.1");
  assert.equal(o.deck.total, 1);
  assert.equal(o.deck.dueToday, 1);
  assert.deepEqual(o.frequentMistakes, [{ grammar: "weil → verb at the end", count: 1 }]);
  assert.deepEqual(o.settings.podcastDays, ["Mo", "Mi", "Fr"]);
});

test("add_cards fills strings with the AI at the user's level and skips duplicates", async () => {
  const calls = [];
  const callFunction = async (name, body) => {
    calls.push([name, body]);
    return { options: [{ kind: "verb", de: "umsteigen", article: null, plural: "", perfekt: "ist umgestiegen", separable: true, en: "to change trains", example: "Ich steige in Bern um.", sense: "trains" }] };
  };
  const { call, appData } = await connect(seed(), { callFunction });
  const r = await call("german_add_cards", { words: ["umsteigen", { german: "antrag", english: "x", kind: "noun" }] });
  assert.deepEqual(calls, [["german-ai", { task: "fill", input: "umsteigen", level: "B1.1" }]]);
  assert.equal(r.added.length, 1);
  assert.equal(r.added[0].german, "umsteigen");
  assert.equal(r.added[0].status, "new");
  assert.equal(r.skipped[0].id, "c1");
  const card = appData.rows.get(K.cards)[0];
  assert.equal(card.source, "claude");
  assert.equal(card.srs, null);
  assert.equal("sense" in card, false);
});

test("search, update and delete keep study progress until deleted", async () => {
  const { call, appData } = await connect(seed());
  const s = await call("german_search_cards", { query: "antrage", filter: "hard" });
  assert.equal(s.cards[0].id, "c1");
  assert.equal(s.cards[0].status.lapses, 2);

  const u = await call("german_update_card", { id: "c1", example: "Der Antrag ist fertig." });
  assert.equal(u.updated.example, "Der Antrag ist fertig.");
  assert.equal(appData.rows.get(K.cards)[0].srs.reps, 3);
  assert.equal(appData.rows.get(K.cards)[0].plural, "die Anträge");

  const bad = await call("german_update_card", { id: "nope", english: "x" });
  assert.match(bad.error, /No card/);

  const d = await call("german_delete_cards", { ids: ["c1", "zz"] });
  assert.deepEqual(d, { deleted: ["der Antrag"], notFound: 1 });
  assert.equal(appData.rows.get(K.cards).length, 0);
});

test("writing history lists sessions with labelled fixes", async () => {
  const { call } = await connect(seed());
  const w = await call("german_get_writing");
  assert.equal(w.sessions[0].fixes[0].grammar, "weil → verb at the end");
});

const episode = {
  id: "ep1", interest: "Bouldern", status: "ready", started: Date.UTC(2026, 9, 28, 9), title: "Bouldern in Zürich",
  summary: "Where to boulder in Zürich and how the grades work.", seconds: 362, path: "u/podcast/ep1.mp3",
  keyWords: [{ de: "der Griff", en: "the hold" }],
  lines: [{ speaker: "Lena", text: "Hallo und willkommen!" }, { speaker: "Jonas", text: "Heute geht es ums Bouldern." }],
};

test("get_podcast lists interests and episodes, with the transcript on request", async () => {
  const { call } = await connect({
    ...seed(),
    [K.episodes]: { episodes: [{ id: "ep2", interest: "Kochen", status: "generating", started: Date.now() }, episode], history: [] },
    [K.listening]: { resources: [], current: null, log: [{ id: "l1", day: "2026-10-28", res: "podcast", episode: "ep1", title: "x", min: 6 }] },
  });
  const p = await call("german_get_podcast");
  assert.deepEqual(p.interests, ["Uni / ETH", "Klettern", "Kochen", "Bahn"]); // the default topics until edited
  assert.deepEqual(p.episodes[0], { id: "ep2", interest: "Kochen", status: "generating", started: p.episodes[0].started });
  assert.equal(p.episodes[1].minutes, 6);
  assert.deepEqual(p.episodes[1].listened, ["2026-10-28"]);
  assert.equal("transcript" in p.episodes[1], false);

  const one = await call("german_get_podcast", { episodeId: "ep1" });
  assert.equal(one.episode.transcript[1].speaker, "Jonas");
  assert.match((await call("german_get_podcast", { episodeId: "gone" })).error, /only the last 10/);
});

test("update_podcast_interests adds and removes, starting from the topics", async () => {
  const { call, appData } = await connect(seed());
  const r = await call("german_update_podcast_interests", { add: ["AI safety", "ai safety", "Kochen"], remove: ["bahn"] });
  assert.deepEqual(r.interests, ["Uni / ETH", "Klettern", "Kochen", "AI safety"]);
  assert.deepEqual(appData.rows.get(K.podcast).interests, r.interests);
  const again = await call("german_update_podcast_interests", { add: ["AI safety"] });
  assert.deepEqual(again.interests, r.interests);
});
