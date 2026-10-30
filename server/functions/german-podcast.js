// Makes an AI podcast episode for the German app. Two recurring hosts, Lena
// and Jonas, talk for three to four minutes about one of the learner's
// interests, at their level, using their flashcard words and the grammar
// they keep getting wrong.
//
// The request only starts the episode: it saves a "generating" entry and
// answers with its id, and the rest runs in the background in this process,
// so the app can be closed meanwhile. In the background the script is
// written after a web search (for real facts, OpenAI), spoken as a two-voice
// dialogue by Gemini TTS through OpenRouter (in chunks of about a minute, a
// few at a time), stored as one WAV in the user's german-audio folder
// ("<user id>/podcast/<id>.wav") and the entry becomes "ready" (or "failed"
// with a message). One episode at a time per user.
//
// Episodes live in app_data under german / german-episodes, which only this
// function writes; the app just reads it (and hears about changes through
// /api/events). Its value is { episodes: Episode[] (newest first, the last
// KEEP), history: { interest, title, summary, at }[] (every episode's angle,
// so the next one on an interest takes a new one) }. An episode is
// { id, interest, status: "generating" | "ready" | "failed", started, ... }.
//
// A restart kills the jobs in flight; recover() marks their entries as
// failed when the server starts.
//
// Needs OPENAI_API_KEY and OPENROUTER_API_KEY (see _shared/openai.js and
// _shared/openrouter.js); the speech model can be switched with
// PODCAST_TTS_MODEL.

import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { ConflictError } from "../appData.js";
import { levelGuide } from "./_shared/cefr.js";
import { HttpError } from "./_shared/http.js";
import { AIError, searchedCompletion } from "./_shared/openai.js";
import { dialogueSpeech } from "./_shared/openrouter.js";
import { wavFile } from "./_shared/wav.js";

const APP_ID = "german";
const KEY = "german-episodes";
const BUCKET = "german-audio";
const KEEP = 10;
const HISTORY = 100;
// A "generating" entry older than this is taken as failed; keep in sync with
// EPISODE_STALE_MS in german/model.js.
const STALE_MS = 10 * 60 * 1000;
const LEVELS = ["A1.1", "A1.2", "A2.1", "A2.2", "B1.1", "B1.2", "B2.1", "B2.2"];

const TTS_MODEL = "google/gemini-3.8-flash-tts";
// The dialogue is spoken in chunks of whole turns up to about this long
// (roughly a minute of audio), SPEAK_AT_ONCE at a time.
const CHUNK_CHARS = 1200;
const SPEAK_AT_ONCE = 4;
// Gemini prebuilt voices.
const VOICES = { Lena: "Aoede", Jonas: "Puck" };
// Gemini TTS has no speed setting; the pace is asked for in the delivery
// instructions, by the learner's choice in Settings, with a words-per-minute
// target (vague asks like "a little slower" barely change it: measured
// about 161 → 148 wpm) and their level as a reference.
const PACES = {
  slowest: lvl => `Speak slowly and very clearly, at about 100 words per minute: much slower than a normal conversation, like a German podcast for beginners. The listener is a German learner at level ${lvl} (CEFR) and must catch every word, so pronounce each word fully, never swallow endings, and pause for about a second after each sentence and between turns. Keep the voices warm and friendly, not robotic.`,
  slower: lvl => `Speak noticeably slower than a normal conversation, at about 120 words per minute, like a podcast made for German learners at level ${lvl} (CEFR). Speak clearly, don't swallow endings, and pause briefly after each sentence and between turns. Keep it natural and lively, not exaggerated.`,
  natural: lvl => `Speak at a relaxed, natural conversational pace, about 150 words per minute, still clear enough for a German learner at level ${lvl} (CEFR), with short natural pauses between turns.`,
};
const delivery = (pace, lvl) => `A casual German podcast between two friends in their twenties. Lena is curious and a little skeptical: amused, surprised, sometimes doubtful. Jonas is enthusiastic and gets excited when he explains things. Natural standard German (Hochdeutsch) with real reactions. ${(PACES[pace] ?? PACES.slower)(lvl)}`;

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const list = (v, n, max) =>
  (Array.isArray(v) ? v : []).map(x => str(x, max)).filter(Boolean).slice(0, n);

const norm = (v) => ({
  episodes: Array.isArray(v?.episodes) ? v.episodes : [],
  history: Array.isArray(v?.history) ? v.history : [],
});

const isBusy = (e, now) => e.status === "generating" && now - e.started < STALE_MS;

// The users whose episode is being made in this process right now.
const running = new Set();

// ---------- storage ----------

// The user's german-episodes row. update() is a read-modify-write guarded
// on updated_at (like mcp/appData.js), retried when the row changed
// meanwhile; `mutate` may run more than once.
function episodeStore(appData, userId) {
  async function update(mutate) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const row = await appData.get(userId, APP_ID, KEY);
      const current = norm(row?.value);
      const next = mutate(current);
      if (next === current) return;
      try {
        await appData.put(userId, APP_ID, KEY, next, row ? row.updated_at : null);
        return;
      } catch (err) {
        if (!(err instanceof ConflictError)) throw err;
      }
    }
    throw new Error("Couldn't save the episodes: they kept changing.");
  }

  return { read: async () => norm((await appData.get(userId, APP_ID, KEY))?.value), update };
}

function upload(storage, userId, path, bytes) {
  return storage.write(BUCKET, path.split("/"), userId, "audio/wav", Readable.from([bytes]));
}

async function removeAudio(storage, userId, paths) {
  for (const path of paths) await storage.remove(BUCKET, path.split("/"), userId).catch(console.error);
}

// ---------- the episode ----------

// The input is { interest, level, pace, words: string[], mistakes: string[] }.
// The answer: { title, summary, keyWords: { de, en }[], lines: { speaker, text }[] }.
const SCRIPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "keyWords", "lines"],
  properties: {
    title: { type: "string", description: "Short German episode title." },
    summary: { type: "string", description: "One English sentence on the angle this episode took." },
    keyWords: {
      type: "array",
      description: "4–6 important topic words from the episode.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["de", "en"],
        properties: {
          de: { type: "string", description: "As on a flashcard: nouns with article (\"die Ausrichtung\"), verbs in the infinitive." },
          en: { type: "string", description: "Short English meaning." },
        },
      },
    },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["speaker", "text"],
        properties: {
          speaker: { type: "string", enum: ["Lena", "Jonas"] },
          text: { type: "string", description: "What they say: 1–5 spoken sentences." },
        },
      },
    },
  },
};

// The episode should take three to four minutes at every pace, so slower
// paces get fewer words (targets as in PACES).
const WORDS = { slowest: 350, slower: 420, natural: 520 };

// Web search can leave source citations in the text ("([site](url))"), which
// the voices would read out; this removes links and bare URLs.
const stripLinks = (text) =>
  text
    .replace(/\(?\[([^\]]*)\]\([^)]*\)\)?/g, (m, label) => (m.startsWith("(") ? "" : label))
    .replace(/\(?https?:\/\/[^\s)]+\)?/g, "")
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();

function writeScript(input, earlier) {
  const lvl = input.level;
  const words = WORDS[input.pace] ?? WORDS.slower;
  return searchedCompletion({
    system: `You write a short German podcast episode for one listener: an adult English speaker who lives in Zürich, studies at ETH and is learning German. Their level is ${lvl} (CEFR).

The show has two recurring hosts, who are friends (casual "du", teasing, real reactions like "Echt?", "Moment mal", "Na ja"):
- Lena: curious and a little skeptical. She asks what the listener would ask, pushes back, jokes, and sometimes admits she doesn't get something.
- Jonas: has read up on today's topic and gets excited about it. He explains with concrete examples and small stories, and sometimes goes too deep until Lena brings him back.
They don't just agree politely: a bit of disagreement and opinion makes it a real conversation.

Search the web for the topic first, so facts, names and numbers are real and current. Don't invent facts; when unsure, stay general. Never put sources, citations, links or URLs anywhere in your answer (not in the dialogue, title or summary): everything is read out loud.

Language: natural spoken standard German (Hochdeutsch) that a learner at level ${lvl} can follow (about 90%).
${levelGuide(lvl, ["listening", "language"])}
- Words above ${lvl} are fine on purpose, but at most 6 in the whole episode: the first time one comes up, a host explains it in simple German. Exactly those words go in keyWords. Everything else stays at the level.
- Use some of the listener's flashcard words where they fit naturally (don't force them all in).
- Use the listener's problem grammar correctly, several times each, without pointing it out.
- No English in the dialogue. Write numbers as they're spoken.

Length and shape: short, three to four minutes of audio: about ${words} words in total (stay within ±10%), 20–35 turns, most of them 1–2 sentences; nobody talks for more than about 3 sentences in a row. Stick to one focused angle on the topic rather than covering everything. Lena opens by greeting the listener and naming today's topic in one line ("Hallo und willkommen …"); the end is a quick wrap-up and goodbye.`,
    user: `Topic: ${input.interest}
Earlier episodes on this topic (take a different angle): ${earlier.length ? `\n${earlier.map(s => `- ${s}`).join("\n")}` : "none"}
Flashcard words: ${input.words.join(", ") || "-"}
Grammar to use correctly: ${input.mistakes.join("; ") || "-"}`,
    schema: SCRIPT_SCHEMA,
    schemaName: "podcast_episode",
    maxTokens: 16000,
  });
}

// Whole turns, grouped into chunks of up to CHUNK_CHARS.
function chunkLines(lines) {
  const chunks = [];
  let size = Infinity;
  for (const line of lines) {
    if (size + line.text.length > CHUNK_CHARS) {
      chunks.push([]);
      size = 0;
    }
    chunks[chunks.length - 1].push(line);
    size += line.text.length;
  }
  return chunks;
}

// Speaks the dialogue chunk by chunk, a few at a time, and joins the audio
// in order. A chunk that hits the rate limit is retried once after a pause.
async function speakDialogue(lines, pace, lvl) {
  const model = process.env.PODCAST_TTS_MODEL || TTS_MODEL;
  const instructions = delivery(pace, lvl);
  const chunks = chunkLines(lines);
  const audio = new Array(chunks.length);
  async function speakOne(i) {
    const turns = chunks[i].map(l => ({ text: l.text.slice(0, 4000), voice: VOICES[l.speaker] ?? VOICES.Lena }));
    try {
      return await dialogueSpeech(turns, instructions, model);
    } catch (err) {
      if (!(err instanceof AIError) || err.status !== 429) throw err;
      await new Promise(r => setTimeout(r, 3000));
      return dialogueSpeech(turns, instructions, model);
    }
  }
  let next = 0;
  async function worker() {
    while (next < chunks.length) {
      const i = next++;
      audio[i] = await speakOne(i);
    }
  }
  await Promise.all(Array.from({ length: SPEAK_AT_ONCE }, worker));

  const { sampleRate, channels } = audio[0];
  if (audio.some(a => a.sampleRate !== sampleRate || a.channels !== channels)) {
    throw new AIError("failed", "The speech service changed audio formats mid-episode - try again.", 502);
  }
  // Whole 16-bit frames only, so a stray byte can't shift the next chunk.
  const frame = channels * 2;
  return wavFile(audio.map(a => a.pcm.subarray(0, a.pcm.length - (a.pcm.length % frame))), sampleRate, channels);
}

async function make(id, input, { user, appData, storage }) {
  const store = episodeStore(appData, user.id);
  try {
    const { history } = await store.read();
    const earlier = history.filter((h) => h.interest === input.interest).slice(0, 12).map((h) => h.summary);
    const script = await writeScript(input, earlier);
    const lines = script.lines.map((l) => ({ ...l, text: stripLinks(l.text) })).filter((l) => l.text);
    if (!lines.length) throw new AIError("empty", "The AI wrote an empty episode - try again.", 502);
    const { bytes, seconds } = await speakDialogue(lines, input.pace, input.level);
    const path = `${user.id}/podcast/${id}.wav`;
    await upload(storage, user.id, path, bytes);

    const ready = {
      status: "ready",
      title: stripLinks(script.title),
      summary: stripLinks(script.summary),
      keyWords: script.keyWords.slice(0, 8),
      lines,
      seconds: Math.round(seconds),
      path,
    };
    let dropped = [];
    await store.update((v) => {
      const episodes = v.episodes.some((e) => e.id === id)
        ? v.episodes.map((e) => (e.id === id ? { ...e, ...ready } : e))
        : [{ id, interest: input.interest, started: Date.now(), ...ready }, ...v.episodes];
      dropped = episodes.slice(KEEP).map((e) => e.path).filter(Boolean);
      return {
        episodes: episodes.slice(0, KEEP),
        history: [{ interest: input.interest, title: ready.title, summary: ready.summary, at: Date.now() }, ...v.history].slice(0, HISTORY),
      };
    });
    if (dropped.length) await removeAudio(storage, user.id, dropped);
  } catch (err) {
    console.error(err);
    const error = err instanceof AIError ? err.message : "Something went wrong making the episode - try again.";
    await store.update((v) => ({
      ...v,
      episodes: v.episodes.map((e) => (e.id === id ? { ...e, status: "failed", error } : e)),
    })).catch(console.error);
  }
}

export const signedOut = "Sign in to make podcast episodes.";

export async function handle(body, ctx) {
  const { user, appData } = ctx;
  const interest = str(body?.interest, 80);
  if (!interest) throw new HttpError(400, "Pick an interest first.");
  const input = {
    interest,
    level: LEVELS.includes(body.level) ? body.level : "A2.2",
    pace: Object.hasOwn(PACES, body.pace) ? body.pace : "slower",
    words: list(body.words, 20, 80),
    mistakes: list(body.mistakes, 5, 200),
  };
  if (running.has(user.id)) throw new HttpError(409, "An episode is already being made.");

  // Saves the "generating" entry, unless one is already on its way. Failed
  // and stale entries make way for it.
  const id = randomUUID().slice(0, 8);
  const now = Date.now();
  let busy = false;
  running.add(user.id);
  try {
    await episodeStore(appData, user.id).update((v) => {
      busy = v.episodes.some((e) => isBusy(e, now));
      if (busy) return v;
      const keep = v.episodes.filter((e) => e.status === "ready");
      return { ...v, episodes: [{ id, interest, status: "generating", started: now }, ...keep] };
    });
  } catch (err) {
    running.delete(user.id);
    console.error(err);
    throw new HttpError(502, "Couldn't start the episode - try again.");
  }
  if (busy) {
    running.delete(user.id);
    throw new HttpError(409, "An episode is already being made.");
  }

  ctx.background(make(id, input, ctx).finally(() => running.delete(user.id)));
  return { id };
}

// At startup: entries still "generating" belong to jobs a restart killed, so
// they become failed (instead of spinning until they go stale).
export async function recover(appData) {
  for (const userId of await appData.usersWith(APP_ID, KEY)) {
    await episodeStore(appData, userId).update((v) =>
      v.episodes.some((e) => e.status === "generating")
        ? {
          ...v,
          episodes: v.episodes.map((e) =>
            e.status === "generating" ? { ...e, status: "failed", error: "The server restarted while making the episode - try again." } : e),
        }
        : v);
  }
}
