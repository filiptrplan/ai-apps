import { after, before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import dns from "node:dns";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { FUNCTIONS } from "./routes/fn.js";
import { mockFetch, setup } from "./testing.mjs";

// The outside world: `answer(url, init, body)` is set per test.
let answer;
let fetchMock;
let t;
before(async () => {
  t = await setup();
  fetchMock = mockFetch((url, init, body) => answer(url, init, body));
});
after(async () => {
  fetchMock.restore();
  await t.close();
});
beforeEach(() => {
  fetchMock.calls.length = 0;
  answer = (url) => {
    throw new Error(`unexpected fetch ${url}`);
  };
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
});

const json = (value, status = 200) => Response.json(value, { status });
// A chat completion (OpenAI or OpenRouter) answering with `value`.
const chat = (value) => json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }] });
// A Responses API answer (OpenAI with web search).
const responses = (value) => json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }] });

const post = (name, body, headers) => t.request(`/api/fn/${name}`, { method: "POST", headers, json: body });
async function call(name, body, headers) {
  const res = await post(name, body, headers);
  return { status: res.status, body: await res.json() };
}

// ---------- the route ----------

test("signed out, every function answers 401 with its own message", async () => {
  const messages = {
    "german-ai": "Sign in to use the AI features.",
    "german-podcast": "Sign in to make podcast episodes.",
    "german-tts": "Sign in to hear sentences.",
    "price-estimate": "Sign in to estimate prices.",
    "recipe-import": "Sign in to use Magic.",
    "shopping-list": "Sign in to build a shopping list.",
    "shopping-merge": "Sign in to combine list items.",
  };
  assert.deepEqual(Object.keys(FUNCTIONS).sort(), Object.keys(messages).sort());
  for (const [name, error] of Object.entries(messages)) {
    assert.deepEqual(await call(name, {}), { status: 401, body: { error } }, name);
  }
  assert.equal(fetchMock.calls.length, 0);
});

test("an unknown function is a 404, signed in or not", async () => {
  const a = await t.signedIn();
  assert.equal((await post("nope", {}, a.headers)).status, 404);
  assert.equal((await post("nope", {})).status, 404);
  assert.equal((await post("__proto__", {}, a.headers)).status, 404);
  assert.equal((await t.request("/api/fn/german-ai", { headers: a.headers })).status, 404);
});

test("invalid JSON is a 400", async () => {
  const a = await t.signedIn();
  const res = await t.request("/api/fn/german-ai", {
    method: "POST",
    headers: { ...a.headers, "content-type": "application/json" },
    body: "{nope",
  });
  assert.deepEqual([res.status, await res.json()], [400, { error: "Invalid JSON." }]);
});

test("a function's unexpected crash is a plain 500", async () => {
  const a = await t.signedIn();
  // An answer without the options the schema asks for makes fill() throw.
  answer = () => chat({});
  const res = await call("german-ai", { task: "fill", input: "Haus" }, a.headers);
  assert.equal(res.status, 500);
  assert.equal(res.body.error, "Something went wrong on the server.");
});

// ---------- the model calls ----------

test("AI errors keep their messages and statuses", async () => {
  const a = await t.signedIn();
  const cases = [
    [() => new Response("", { status: 429 }), 429, "Too many requests - try again in a minute."],
    [() => new Response("", { status: 500 }), 502, "AI request failed (500)."],
    [() => { throw new TypeError("fetch failed"); }, 502, "Couldn't reach the AI service."],
    [() => json({ choices: [{ finish_reason: "length", message: {} }] }), 422, "The answer got too long - try less input."],
    [() => json({ choices: [{ finish_reason: "stop", message: { refusal: "no" } }] }), 422, "The AI declined this request."],
    [() => json({ choices: [{ finish_reason: "stop", message: { content: "not json" } }] }), 502, "The AI returned something unreadable - try again."],
    [() => json({ error: { message: "Model overloaded" } }), 502, "Model overloaded"],
  ];
  for (const [reply, status, error] of cases) {
    answer = reply;
    assert.deepEqual(await call("german-ai", { task: "example", card: { de: "Haus" } }, a.headers), { status, body: { error } });
  }
});

test("a missing API key is a 500 that says so, and nothing is sent", async () => {
  const a = await t.signedIn();
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  assert.deepEqual(await call("german-ai", { task: "fill", input: "Haus" }, a.headers), {
    status: 500,
    body: { error: "The server has no OpenAI API key configured." },
  });
  assert.deepEqual(await call("shopping-list", { recipes: ["2 eggs"] }, a.headers), {
    status: 500,
    body: { error: "The server has no OpenRouter API key configured." },
  });
  assert.equal(fetchMock.calls.length, 0);
});

test("keys come from the environment at call time, and models can be overridden", async () => {
  const a = await t.signedIn();
  answer = () => chat({ example: "Das Haus ist alt." });
  process.env.OPENAI_API_KEY = "rotated";
  process.env.OPENAI_MODEL = "gpt-test";
  try {
    await call("german-ai", { task: "example", card: { de: "Haus" } }, a.headers);
  } finally {
    delete process.env.OPENAI_MODEL;
  }
  const [{ url, init, body }] = fetchMock.calls;
  assert.equal(url.href, "https://api.openai.com/v1/chat/completions");
  assert.equal(init.headers.Authorization, "Bearer rotated");
  assert.equal(body.model, "gpt-test");
});

// ---------- german-ai ----------

test("german-ai: fill sends the word at the user's level and keeps at most 3 options", async () => {
  const a = await t.signedIn();
  const option = { kind: "noun", de: "Antrag", article: "der", plural: "die Anträge", perfekt: "", separable: false, en: "the application", example: "", sense: "" };
  answer = () => chat({ options: [option, option, option, option] });
  const res = await call("german-ai", { task: "fill", input: "  application ", level: "B1.2" }, a.headers);
  assert.equal(res.status, 200);
  assert.equal(res.body.options.length, 3);

  const [{ body }] = fetchMock.calls;
  assert.equal(body.messages[1].content, "application");
  assert.match(body.messages[0].content, /Their level is B1\.2/);
  assert.match(body.messages[0].content, /CEFR B1\+/);
  assert.equal(body.response_format.json_schema.name, "word_fill");
});

test("german-ai: bad input is a 400 without a model call", async () => {
  const a = await t.signedIn();
  assert.deepEqual(await call("german-ai", { task: "dance" }, a.headers), { status: 400, body: { error: "Unknown task." } });
  assert.deepEqual(await call("german-ai", { task: "fill", input: " " }, a.headers), { status: 400, body: { error: "Type a word first." } });
  assert.deepEqual(await call("german-ai", { task: "check", text: "" }, a.headers), { status: 400, body: { error: "Write a few sentences first." } });
  assert.deepEqual(await call("german-ai", { task: "words", items: [] }, a.headers), { status: 400, body: { error: "Pick some words first." } });
  assert.equal(fetchMock.calls.length, 0);
});

test("german-ai: an unknown level falls back to A2.2", async () => {
  const a = await t.signedIn();
  answer = () => chat({ prompt: "Was hast du gestern gemacht?" });
  const res = await call("german-ai", { task: "prompt", level: "C2", focus: { label: "Perfekt" } }, a.headers);
  assert.deepEqual(res, { status: 200, body: { prompt: "Was hast du gestern gemacht?" } });
  assert.match(fetchMock.calls[0].body.messages[0].content, /Their level is A2\.2/);
});

// ---------- german-tts ----------

test("german-tts stores the mp3 at the path derived from the text", async () => {
  const a = await t.signedIn();
  const text = "Ich gehe nach Hause.";
  const hash = createHash("sha256").update(text).digest("hex");
  const mp3 = new Uint8Array([0xff, 0xfb, 1, 2, 3]);
  answer = () => new Response(mp3);

  assert.deepEqual(await call("german-tts", { text, path: `${a.id}/wrong.mp3` }, a.headers), {
    status: 400,
    body: { error: "Invalid audio path." },
  });
  assert.equal(fetchMock.calls.length, 0);

  const res = await call("german-tts", { text: ` ${text} `, path: `${a.id}/${hash}.mp3` }, a.headers);
  assert.deepEqual(res, { status: 200, body: { path: `${a.id}/${hash}.mp3` } });
  assert.equal(fetchMock.calls[0].url.href, "https://api.openai.com/v1/audio/speech");
  assert.equal(fetchMock.calls[0].body.input, text);

  const file = await t.request(`/api/storage/german-audio/${a.id}/${hash}.mp3`, { headers: a.headers });
  assert.equal(file.headers.get("content-type"), "audio/mpeg");
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), mp3);
});

test("german-tts refuses another user's folder and long text", async () => {
  const a = await t.signedIn();
  const b = await t.signedIn();
  const text = "Hallo";
  const hash = createHash("sha256").update(text).digest("hex");
  assert.equal((await call("german-tts", { text, path: `${b.id}/${hash}.mp3` }, a.headers)).status, 400);
  assert.deepEqual(await call("german-tts", { text: "a".repeat(401), path: "" }, a.headers), {
    status: 400,
    body: { error: "That sentence is too long to speak." },
  });
  assert.equal(fetchMock.calls.length, 0);
});

// ---------- german-podcast ----------

const SCRIPT = {
  title: "Berge",
  summary: "Why the Alps grow.",
  keyWords: [{ de: "die Gebirgsbildung", en: "mountain building" }],
  lines: [
    { speaker: "Lena", text: "Hallo und willkommen! Heute geht es um Berge ([srf.ch](https://srf.ch/x))." },
    { speaker: "Jonas", text: "Die Alpen wachsen jedes Jahr ein bisschen." },
    { speaker: "Lena", text: "Echt? " + "Das wusste ich nicht. ".repeat(60) },
  ],
};
const PCM = new Uint8Array(48000); // a second of 24 kHz mono 16-bit audio

// Answers the script and the speech calls; `speech` can be swapped.
function podcastWorld({ speech = () => new Response(PCM, { headers: { "content-type": "audio/pcm;rate=24000;channels=1" } }) } = {}) {
  return (url) => {
    if (url.href === "https://api.openai.com/v1/responses") return responses(SCRIPT);
    if (url.href === "https://openrouter.ai/api/v1/audio/speech") return speech();
    throw new Error(`unexpected fetch ${url}`);
  };
}

const episodesOf = async (userId) => (await t.appData.get(userId, "german", "german-episodes"))?.value;

test("german-podcast answers at once, then makes the episode in the background", async () => {
  const a = await t.signedIn();
  answer = podcastWorld();
  const res = await call("german-podcast", { interest: "Berge", level: "B1.1", pace: "slowest", words: ["der Gipfel"] }, a.headers);
  assert.equal(res.status, 200);
  const { id } = res.body;
  assert.match(id, /^[0-9a-f]{8}$/);

  await t.fn.idle();
  const { episodes, history } = await episodesOf(a.id);
  assert.equal(episodes.length, 1);
  const ep = episodes[0];
  assert.equal(ep.status, "ready");
  assert.equal(ep.id, id);
  assert.equal(ep.path, `${a.id}/podcast/${id}.wav`);
  // Links from the web search are gone from what's spoken.
  assert.equal(ep.lines[0].text, "Hallo und willkommen! Heute geht es um Berge.");
  assert.deepEqual(history.map((h) => h.summary), ["Why the Alps grow."]);

  // Two chunks (the last line is long), each a second of audio.
  const speech = fetchMock.calls.filter((c) => c.url.pathname.endsWith("/audio/speech"));
  assert.equal(speech.length, 2);
  assert.deepEqual(speech[0].body.input.map((l) => l.voice), ["Aoede", "Puck"]);
  assert.match(speech[0].body.instructions, /about 100 words per minute/);
  assert.equal(ep.seconds, 2);

  const wav = await readFile(path.join(t.storageDir, "german-audio", a.id, "podcast", `${id}.wav`));
  assert.equal(wav.length, 44 + 2 * PCM.length);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.readUInt32LE(24), 24000);
});

test("german-podcast: one episode at a time, even once a slow one's entry looks stale", async () => {
  const a = await t.signedIn();
  let release;
  const gate = new Promise((r) => (release = r));
  answer = podcastWorld({
    speech: async () => {
      await gate;
      return new Response(PCM, { headers: { "content-type": "audio/pcm;rate=24000;channels=1" } });
    },
  });
  try {
    const first = await call("german-podcast", { interest: "Berge" }, a.headers);
    assert.equal(first.status, 200);
    const busy = { status: 409, body: { error: "An episode is already being made." } };
    assert.deepEqual(await call("german-podcast", { interest: "Seen" }, a.headers), busy);

    // Past the 10 minutes after which the app shows the entry as failed, the
    // job is still running here, so a new one still has to wait.
    const row = await t.appData.get(a.id, "german", "german-episodes");
    row.value.episodes[0].started -= 11 * 60 * 1000;
    await t.appData.put(a.id, "german", "german-episodes", row.value);
    assert.deepEqual(await call("german-podcast", { interest: "Seen" }, a.headers), busy);

    // Another user isn't held up.
    const b = await t.signedIn();
    assert.equal((await call("german-podcast", { interest: "Seen" }, b.headers)).status, 200);
  } finally {
    release();
    await t.fn.idle();
  }
  assert.equal((await episodesOf(a.id)).episodes[0].status, "ready");
  // Done, so the next one may start.
  assert.equal((await call("german-podcast", { interest: "Seen" }, a.headers)).status, 200);
  await t.fn.idle();
});

test("german-podcast: a failed job marks the entry failed with the AI's message", async () => {
  const a = await t.signedIn();
  answer = podcastWorld({ speech: () => new Response("", { status: 429 }) });
  const { body } = await call("german-podcast", { interest: "Berge" }, a.headers);
  await t.fn.idle();
  const [ep] = (await episodesOf(a.id)).episodes;
  assert.equal(ep.id, body.id);
  assert.equal(ep.status, "failed");
  assert.equal(ep.error, "Too many requests - try again in a minute.");
  // A rate-limited chunk is retried once, after a pause.
  assert.ok(fetchMock.calls.filter((c) => c.url.pathname.endsWith("/audio/speech")).length >= 3);
});

test("german-podcast keeps 10 episodes and deletes the audio of older ones", async () => {
  const a = await t.signedIn();
  const old = Array.from({ length: 10 }, (_, i) => ({
    id: `old${i}`, interest: "x", status: "ready", started: i, path: `${a.id}/podcast/old${i}.wav`,
  }));
  await t.appData.put(a.id, "german", "german-episodes", { episodes: old, history: [] });
  for (const e of old.slice(8)) {
    await t.request(`/api/storage/german-audio/${e.path}`, { method: "PUT", headers: { ...a.headers, "content-type": "audio/wav" }, body: "x" });
  }
  answer = podcastWorld();
  await call("german-podcast", { interest: "Berge" }, a.headers);
  await t.fn.idle();

  const { episodes } = await episodesOf(a.id);
  assert.equal(episodes.length, 10);
  assert.equal(episodes[0].status, "ready");
  assert.equal(episodes.at(-1).id, "old8");
  assert.equal((await t.request(`/api/storage/german-audio/${a.id}/podcast/old9.wav`, { headers: a.headers })).status, 404);
  assert.equal((await t.request(`/api/storage/german-audio/${a.id}/podcast/old8.wav`, { headers: a.headers })).status, 200);
});

test("german-podcast: recover() fails the episodes a restart interrupted", async () => {
  const a = await t.signedIn();
  const b = await t.signedIn();
  await t.appData.put(a.id, "german", "german-episodes", {
    episodes: [{ id: "x", interest: "Berge", status: "generating", started: Date.now() }, { id: "y", status: "ready" }],
    history: [],
  });
  await t.appData.put(b.id, "german", "german-episodes", { episodes: [{ id: "z", status: "ready" }], history: [] });
  const before = await t.appData.get(b.id, "german", "german-episodes");

  await t.fn.recover();
  const [x, y] = (await episodesOf(a.id)).episodes;
  assert.deepEqual([x.status, x.error, y.status], ["failed", "The server restarted while making the episode - try again.", "ready"]);
  // Untouched rows aren't rewritten.
  assert.deepEqual(await t.appData.get(b.id, "german", "german-episodes"), before);
  // And a new episode may start.
  answer = podcastWorld();
  assert.equal((await call("german-podcast", { interest: "Berge" }, a.headers)).status, 200);
  await t.fn.idle();
});

test("german-podcast needs an interest", async () => {
  const a = await t.signedIn();
  assert.deepEqual(await call("german-podcast", { interest: " " }, a.headers), { status: 400, body: { error: "Pick an interest first." } });
});

// ---------- recipe-import ----------

const RECIPE = {
  name: "Pancakes",
  cat: "Breakfast",
  time: 20,
  serves: 2,
  ingredients: [{ name: "", items: ["2 Eggs"] }],
  method: [{ name: "", items: ["Mix."] }],
  notes: "",
};

function lookupAs(address) {
  return mock.method(dns.promises, "lookup", async () => [{ address, family: address.includes(":") ? 6 : 4 }]);
}

test("recipe-import reads a link's JSON-LD recipe and sends it with the images", async () => {
  const a = await t.signedIn();
  const lookup = lookupAs("93.184.215.14");
  const page = `<html><head><script type="application/ld+json">{"@graph":[{"@type":"Recipe","name":"Pancakes","recipeIngredient":["2 eggs"]}]}</script></head><body>…</body></html>`;
  answer = (url) => {
    if (url.hostname === "recipes.example.com") {
      if (url.pathname === "/old") return new Response(null, { status: 301, headers: { location: "/pancakes" } });
      return new Response(page, { headers: { "content-type": "text/html" } });
    }
    if (url.href === "https://openrouter.ai/api/v1/chat/completions") return chat(RECIPE);
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    const res = await call("recipe-import", { link: "https://recipes.example.com/old", images: [{ media: "image/jpeg", data: "AAAA" }] }, a.headers);
    assert.deepEqual(res, { status: 200, body: RECIPE });
  } finally {
    lookup.mock.restore();
  }
  const model = fetchMock.calls.at(-1).body;
  assert.equal(model.model, "openai/gpt-6-luna");
  const [image, text] = model.messages[1].content;
  assert.equal(image.image_url.url, "data:image/jpeg;base64,AAAA");
  assert.match(text.text, /<web_page url="https:\/\/recipes\.example\.com\/old">\n\{"@type":"Recipe","name":"Pancakes"/);
  assert.match(text.text, /1 image\(s\) attached\./);
});

test("recipe-import won't fetch links that lead to private addresses", async () => {
  const a = await t.signedIn();
  const blocked = { status: 422, body: { error: "Only public web links are supported." } };
  for (const link of ["http://localhost:8090/api/health", "http://127.0.0.1/", "http://[::1]/", "file:///etc/passwd", "http://db/"]) {
    assert.deepEqual(await call("recipe-import", { link }, a.headers), blocked, link);
  }

  // A public-looking name that resolves to the LAN.
  let lookup = lookupAs("192.168.1.10");
  try {
    assert.deepEqual(await call("recipe-import", { link: "https://nas.example.com/" }, a.headers), blocked);
  } finally {
    lookup.mock.restore();
  }

  // A public page redirecting to an internal one.
  lookup = mock.method(dns.promises, "lookup", async (host) => [{ address: host === "evil.example.com" ? "93.184.215.14" : "100.101.102.103", family: 4 }]);
  answer = (url) => {
    if (url.hostname === "evil.example.com") return new Response(null, { status: 302, headers: { location: "http://tailnet.example.com/" } });
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    assert.deepEqual(await call("recipe-import", { link: "https://evil.example.com/" }, a.headers), blocked);
  } finally {
    lookup.mock.restore();
  }
  assert.deepEqual(fetchMock.calls.map((c) => c.url.hostname), ["evil.example.com"]);
});

test("recipe-import: input checks and its own wording of AI errors", async () => {
  const a = await t.signedIn();
  assert.deepEqual(await call("recipe-import", {}, a.headers), { status: 400, body: { error: "Add a screenshot, some text or a link." } });
  assert.deepEqual(await call("recipe-import", { text: "x".repeat(30001) }, a.headers), { status: 400, body: { error: "That text is too long." } });
  assert.equal(fetchMock.calls.length, 0);

  answer = () => json({ choices: [{ finish_reason: "length", message: {} }] });
  assert.deepEqual(await call("recipe-import", { text: "pancakes" }, a.headers), { status: 422, body: { error: "That recipe is too long to read in one go." } });
  answer = () => chat({ ...RECIPE, name: "", ingredients: [] });
  assert.deepEqual(await call("recipe-import", { text: "hello" }, a.headers), {
    status: 422,
    body: { error: "Couldn't find a recipe in that. Try more text or a clearer screenshot." },
  });
});

test("recipe-import takes large screenshots", async () => {
  const a = await t.signedIn();
  answer = () => chat(RECIPE);
  const images = Array.from({ length: 8 }, () => ({ media: "image/png", data: "A".repeat(2_900_000) }));
  assert.equal((await call("recipe-import", { images }, a.headers)).status, 200);
});

// ---------- shopping-list and shopping-merge ----------

test("shopping-list sends the recipes and passes the rows on", async () => {
  const a = await t.signedIn();
  const rows = { recipes: [{ index: 0, title: "Pancakes" }], items: [] };
  answer = () => chat(rows);
  assert.deepEqual(await call("shopping-list", { recipes: ["2 eggs", " ", 5] }, a.headers), { status: 200, body: rows });
  const { body, init } = fetchMock.calls[0];
  assert.equal(body.messages[1].content, '<recipe index="0">\n2 eggs\n</recipe>');
  assert.equal(init.headers["X-Title"], "AI Apps - Shopping List");
  assert.equal(init.headers.Authorization, "Bearer test-openrouter-key");

  answer = () => json({ choices: [{ finish_reason: "stop", message: { refusal: "no" } }] });
  assert.deepEqual(await call("shopping-list", { recipes: ["x"] }, a.headers), { status: 422, body: { error: "The AI declined to process these recipes." } });
  assert.deepEqual(await call("shopping-list", { recipes: [] }, a.headers), { status: 400, body: { error: "Paste at least one recipe." } });
});

test("shopping-merge skips the model when there's nothing to merge", async () => {
  const a = await t.signedIn();
  assert.deepEqual(await call("shopping-merge", { list: [], add: [{ id: "a", name: "Eggs" }] }, a.headers), { status: 200, body: { groups: [] } });
  assert.deepEqual(await call("shopping-merge", { list: "x", add: [] }, a.headers), { status: 400, body: { error: "Expected list and add arrays." } });
  assert.equal(fetchMock.calls.length, 0);

  const groups = { groups: [{ keep: "l1", merge: ["n1"], q: "3" }] };
  answer = () => chat(groups);
  const res = await call("shopping-merge", { list: [{ id: "l1", q: "1", name: "Eggs" }], add: [{ id: "n1", q: "2", name: "eggs" }] }, a.headers);
  assert.deepEqual(res, { status: 200, body: groups });
  assert.equal(fetchMock.calls[0].body.messages[1].content, "<list>\nl1 | 1 | Eggs\n</list>\n\n<new>\nn1 | 2 | eggs\n</new>");
});

// ---------- price-estimate ----------

test("price-estimate prices from Aldi and the produce table, and works out the costs", async () => {
  const a = await t.signedIn();
  answer = (url, init, body) => {
    if (url.hostname === "lindas.admin.ch") {
      return json({
        results: {
          bindings: [
            { pn: { value: "Zwiebeln gelb" }, un: { value: "kg" }, avg: { value: "2.4" }, date: { value: "https://ld.admin.ch/time/month/2026-09" } },
            { pn: { value: "Zwiebeln gelb" }, un: { value: "kg" }, avg: { value: "9" }, date: { value: "https://ld.admin.ch/time/month/2026-07" } },
          ],
        },
      });
    }
    if (url.hostname === "api.aldi-suisse.ch") {
      const q = url.searchParams.get("q");
      if (q === "Vollmilch") {
        return json({ data: [{ sku: "123456789012345678", brandName: "MILSANI", name: "Vollmilch", sellingSize: "1 l", price: { amount: 125, comparisonDisplay: "1 l = 1.25" } }] });
      }
      return json({ data: [] });
    }
    if (url.hostname === "openrouter.ai") {
      const name = body.response_format.json_schema.name;
      if (name === "price_plan") {
        return chat({ items: [{ id: "m", terms: ["Vollmilch"], produce: "" }, { id: "o", terms: ["Zwiebeln"], produce: "Zwiebeln gelb" }, { id: "x", terms: ["Drachenfrucht"], produce: "" }] });
      }
      if (name === "price_pick") {
        return chat({
          items: [
            { id: "m", source: "aldi", product: "p1", packs: 2, usedPacks: 1.5, produceQty: 0, note: "" },
            { id: "o", source: "produce", product: "", packs: 1, usedPacks: 0, produceQty: 0.3, note: "2 onions ~ 300 g" },
            { id: "x", source: "none", product: "", packs: 0, usedPacks: 0, produceQty: 0, note: "" },
          ],
        });
      }
      if (name === "price_retry") return chat({ items: [{ id: "x", terms: ["Pitahaya"] }] });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const items = [{ id: "m", q: "1.5 l", name: "Milk" }, { id: "o", q: "2", name: "Onion" }, { id: "x", q: "1", name: "Dragon fruit" }];
  const res = await call("price-estimate", { items, tier: "cheapest" }, a.headers);
  assert.equal(res.status, 200);
  assert.equal(res.body.produceMonth, "2026-09");
  const [milk, onion, dragon] = res.body.items;
  assert.deepEqual(milk, { id: "m", source: "aldi", product: "MILSANI Vollmilch", size: "1 l", unitPrice: 1.25, unit: "pack", qty: 2, buy: 2.5, used: 1.9, note: "" });
  assert.deepEqual(onion, { id: "o", source: "produce", product: "Zwiebeln gelb", size: "", unitPrice: 2.4, unit: "kg", qty: 0.3, buy: 0.7, used: 0.7, note: "2 onions ~ 300 g" });
  assert.equal(dragon.source, "none");

  const pick = fetchMock.calls.find((c) => c.body?.response_format?.json_schema.name === "price_pick");
  assert.match(pick.body.messages[0].content, /Pick the cheapest suitable product/);
  // The retry searched the new term, found nothing, and didn't pick again.
  assert.ok(fetchMock.calls.some((c) => c.url.searchParams?.get("q") === "Pitahaya"));
  assert.equal(fetchMock.calls.filter((c) => c.body?.response_format?.json_schema.name === "price_pick").length, 1);
});

test("price-estimate: an empty list needs no model, a bad one is a 400", async () => {
  const a = await t.signedIn();
  assert.deepEqual(await call("price-estimate", { items: [] }, a.headers), { status: 200, body: { items: [], produceMonth: null } });
  assert.deepEqual(await call("price-estimate", { items: [{ id: "a" }] }, a.headers), { status: 400, body: { error: "Expected an items array." } });
  assert.equal(fetchMock.calls.length, 0);
});
