// Supabase Edge Function: makes an AI podcast episode for the German app.
// Two recurring hosts, Lena and Jonas, talk for about six minutes about one
// of the learner's interests, at their level, using their flashcard words
// and the grammar they keep getting wrong.
//
// The request only starts the episode: it saves a "generating" entry and
// answers with its id, and the rest runs in the background, so the app can
// be closed meanwhile. In the background the script is written after a web
// search (for real facts, OpenAI), spoken as a two-voice dialogue by Gemini
// TTS through OpenRouter (in chunks of about a minute, a few at a time),
// stored as one WAV in the private german-audio bucket
// ("<user id>/podcast/<id>.wav", see _shared/wav.ts for why not mp3) and
// the entry becomes "ready" (or "failed" with a message).
//
// Episodes live in app_data under german / german-episodes, which only this
// function writes; the app just reads it (and hears about changes through
// Realtime). Its value is { episodes: Episode[] (newest first, the last
// KEEP), history: { interest, title, summary, at }[] (every episode's
// angle, so the next one on an interest takes a new one) }. All reads and
// writes use the caller's own token, so RLS and the storage policies keep
// each user to their own data.
//
// Needs the OPENAI_API_KEY and OPENROUTER_API_KEY secrets (see
// _shared/openai.ts and _shared/openrouter.ts); the speech model can be
// switched with the optional PODCAST_TTS_MODEL secret.
// Deploy with:
//   supabase functions deploy german-podcast

import { json, serveSignedIn } from "../_shared/http.ts";
import { AIError, searchedCompletion } from "../_shared/openai.ts";
import { dialogueSpeech } from "../_shared/openrouter.ts";
import { wavFile } from "../_shared/wav.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const APP_ID = "german";
const KEY = "german-episodes";
const BUCKET = "german-audio";
const KEEP = 10;
const HISTORY = 100;
// A "generating" entry older than this is taken as failed (the background
// task was killed); keep in sync with EPISODE_STALE_MS in german/model.js.
const STALE_MS = 10 * 60 * 1000;
const LEVELS = ["A1.1", "A1.2", "A2.1", "A2.2", "B1.1", "B1.2", "B2.1", "B2.2"];

const TTS_MODEL = "google/gemini-3.8-flash-tts";
// The dialogue is spoken in chunks of whole turns up to about this long
// (roughly a minute of audio), SPEAK_AT_ONCE at a time.
const CHUNK_CHARS = 1200;
const SPEAK_AT_ONCE = 4;
// Gemini prebuilt voices.
const VOICES: Record<string, string> = { Lena: "Aoede", Jonas: "Puck" };
// Gemini TTS has no speed setting; the pace is asked for in the delivery
// instructions, by the learner's choice in Settings, with a words-per-minute
// target (vague asks like "a little slower" barely change it: measured
// about 161 → 148 wpm) and their level as a reference.
const PACES: Record<string, (lvl: string) => string> = {
  slowest: lvl => `Speak slowly and very clearly, at about 100 words per minute: much slower than a normal conversation, like a German podcast for beginners. The listener is a German learner at level ${lvl} (CEFR) and must catch every word, so pronounce each word fully, never swallow endings, and pause for about a second after each sentence and between turns. Keep the voices warm and friendly, not robotic.`,
  slower: lvl => `Speak noticeably slower than a normal conversation, at about 120 words per minute, like a podcast made for German learners at level ${lvl} (CEFR). Speak clearly, don't swallow endings, and pause briefly after each sentence and between turns. Keep it natural and lively, not exaggerated.`,
  natural: lvl => `Speak at a relaxed, natural conversational pace, about 150 words per minute, still clear enough for a German learner at level ${lvl} (CEFR), with short natural pauses between turns.`,
};
const delivery = (pace: string, lvl: string) => `A casual German podcast between two friends in their twenties. Lena is curious and a little skeptical: amused, surprised, sometimes doubtful. Jonas is enthusiastic and gets excited when he explains things. Natural standard German (Hochdeutsch) with real reactions. ${(PACES[pace] ?? PACES.slower)(lvl)}`;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const list = (v: unknown, n: number, max: number) =>
  (Array.isArray(v) ? v : []).map(x => str(x, max)).filter(Boolean).slice(0, n);

interface Episode {
  id: string;
  interest: string;
  status: "generating" | "ready" | "failed";
  started: number;
  [field: string]: unknown;
}
interface Episodes {
  episodes: Episode[];
  history: { interest: string; title: string; summary: string; at: number }[];
}

const norm = (v: any): Episodes => ({
  episodes: Array.isArray(v?.episodes) ? v.episodes : [],
  history: Array.isArray(v?.history) ? v.history : [],
});

const isBusy = (e: Episode, now: number) => e.status === "generating" && now - e.started < STALE_MS;

// ---------- storage ----------

// The caller's german-episodes row. update() is a read-modify-write guarded
// on updated_at (like mcp/appData.js), retried when the row changed
// meanwhile; `mutate` may run more than once.
function episodeStore(request: Request, userId: string) {
  const base = `${Deno.env.get("SUPABASE_URL")}/rest/v1/app_data`;
  const headers = {
    apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    Authorization: request.headers.get("authorization") ?? "",
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  const filter = `user_id=eq.${userId}&app_id=eq.${APP_ID}&key=eq.${KEY}`;

  async function readRow(): Promise<{ value: unknown; updated_at: string } | null> {
    const res = await fetch(`${base}?select=value,updated_at&${filter}`, { headers });
    if (!res.ok) throw new Error(`Couldn't read the episodes (${res.status}).`);
    return (await res.json())[0] ?? null;
  }

  async function update(mutate: (v: Episodes) => Episodes) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const row = await readRow();
      const current = norm(row?.value);
      const next = mutate(current);
      if (next === current) return;
      const res = row
        ? await fetch(`${base}?${filter}&updated_at=eq.${encodeURIComponent(row.updated_at)}`, {
          method: "PATCH", headers, body: JSON.stringify({ value: next }),
        })
        : await fetch(base, {
          method: "POST", headers, body: JSON.stringify({ user_id: userId, app_id: APP_ID, key: KEY, value: next }),
        });
      if (res.status === 409) continue; // created meanwhile
      if (!res.ok) throw new Error(`Couldn't save the episodes (${res.status}).`);
      if ((await res.json()).length === 1) return;
    }
    throw new Error("Couldn't save the episodes: they kept changing.");
  }

  return { read: async () => norm((await readRow())?.value), update };
}

function storageFetch(request: Request, path: string, init: RequestInit) {
  return fetch(`${Deno.env.get("SUPABASE_URL")}/storage/v1/object/${path}`, {
    ...init,
    headers: {
      apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      Authorization: request.headers.get("authorization") ?? "",
      ...init.headers,
    },
  });
}

async function upload(request: Request, path: string, bytes: Uint8Array) {
  const res = await storageFetch(request, `${BUCKET}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "audio/wav", "x-upsert": "true" },
    body: bytes.buffer as ArrayBuffer, // wavFile's bytes fill their whole buffer
  });
  if (!res.ok) throw new Error(`Couldn't store the audio (${res.status}).`);
}

async function removeAudio(request: Request, paths: string[]) {
  await storageFetch(request, BUCKET, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: paths }),
  });
}

// ---------- the episode ----------

interface Input {
  interest: string;
  level: string;
  pace: string;
  words: string[];
  mistakes: string[];
}
interface Script {
  title: string;
  summary: string;
  keyWords: { de: string; en: string }[];
  lines: { speaker: "Lena" | "Jonas"; text: string }[];
}

const SCRIPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "keyWords", "lines"],
  properties: {
    title: { type: "string", description: "Short German episode title." },
    summary: { type: "string", description: "One English sentence on the angle this episode took." },
    keyWords: {
      type: "array",
      description: "5–8 important topic words from the episode.",
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

function writeScript(input: Input, earlier: string[]) {
  const lvl = input.level;
  return searchedCompletion<Script>({
    system: `You write a short German podcast episode for one listener: an adult English speaker who lives in Zürich, studies at ETH and is learning German. Their level is ${lvl} (CEFR).

The show has two recurring hosts, who are friends (casual "du", teasing, real reactions like "Echt?", "Moment mal", "Na ja"):
- Lena: curious and a little skeptical. She asks what the listener would ask, pushes back, jokes, and sometimes admits she doesn't get something.
- Jonas: has read up on today's topic and gets excited about it. He explains with concrete examples and small stories, and sometimes goes too deep until Lena brings him back.
They don't just agree politely: a bit of disagreement and opinion makes it a real conversation.

Search the web for the topic first, so facts, names and numbers are real and current. Don't invent facts; when unsure, stay general.

Language:
- Natural spoken standard German (Hochdeutsch) pitched at ${lvl}: mostly short main clauses, everyday words, Perfekt for the past. The listener should follow about 90%.
- Topic words above ${lvl} are fine on purpose: the first time one comes up, a host explains it in simple German. Those words go in keyWords.
- Use some of the listener's flashcard words where they fit naturally (don't force them all in).
- Use the listener's problem grammar correctly, several times each, without pointing it out.
- No English in the dialogue. Write numbers as they're spoken.

Length and shape: about 800 words in total (six minutes of audio), 40–70 turns, most of them 1–3 sentences; nobody talks for more than about 5 sentences in a row. Lena opens by greeting the listener and naming today's topic ("Hallo und willkommen …"); the end is a short wrap-up and goodbye.`,
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
function chunkLines(lines: Script["lines"]) {
  const chunks: Script["lines"][] = [];
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
async function speakDialogue(lines: Script["lines"], pace: string, lvl: string) {
  const model = Deno.env.get("PODCAST_TTS_MODEL") || TTS_MODEL;
  const instructions = delivery(pace, lvl);
  const chunks = chunkLines(lines);
  const audio: Awaited<ReturnType<typeof dialogueSpeech>>[] = new Array(chunks.length);
  async function speakOne(i: number) {
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

async function make(id: string, input: Input, request: Request, userId: string) {
  const store = episodeStore(request, userId);
  try {
    const { history } = await store.read();
    const earlier = history.filter(h => h.interest === input.interest).slice(0, 12).map(h => h.summary);
    const script = await writeScript(input, earlier);
    const lines = script.lines.filter(l => l.text.trim());
    if (!lines.length) throw new AIError("empty", "The AI wrote an empty episode - try again.", 502);
    const { bytes, seconds } = await speakDialogue(lines, input.pace, input.level);
    const path = `${userId}/podcast/${id}.wav`;
    await upload(request, path, bytes);

    const ready = {
      status: "ready" as const,
      title: script.title,
      summary: script.summary,
      keyWords: script.keyWords.slice(0, 8),
      lines,
      seconds: Math.round(seconds),
      path,
    };
    let dropped: string[] = [];
    await store.update(v => {
      const episodes = v.episodes.some(e => e.id === id)
        ? v.episodes.map(e => (e.id === id ? { ...e, ...ready } : e))
        : [{ id, interest: input.interest, started: Date.now(), ...ready }, ...v.episodes];
      dropped = episodes.slice(KEEP).map(e => e.path as string).filter(Boolean);
      return {
        episodes: episodes.slice(0, KEEP),
        history: [{ interest: input.interest, title: script.title, summary: script.summary, at: Date.now() }, ...v.history].slice(0, HISTORY),
      };
    });
    if (dropped.length) await removeAudio(request, dropped);
  } catch (err) {
    console.error(err);
    const error = err instanceof AIError ? err.message : "Something went wrong making the episode - try again.";
    await store.update(v => ({
      ...v,
      episodes: v.episodes.map(e => (e.id === id ? { ...e, status: "failed" as const, error } : e)),
    })).catch(console.error);
  }
}

serveSignedIn("Sign in to make podcast episodes.", async (body, user, request) => {
  const interest = str(body?.interest, 80);
  if (!interest) return json({ error: "Pick an interest first." }, 400);
  const input: Input = {
    interest,
    level: LEVELS.includes(body.level) ? body.level : "A2.2",
    pace: Object.hasOwn(PACES, body.pace) ? body.pace : "slower",
    words: list(body.words, 20, 80),
    mistakes: list(body.mistakes, 5, 200),
  };

  // Saves the "generating" entry, unless one is already on its way. Failed
  // and stale entries make way for it.
  const id = crypto.randomUUID().slice(0, 8);
  const now = Date.now();
  let busy = false;
  try {
    await episodeStore(request, user.id).update(v => {
      busy = v.episodes.some(e => isBusy(e, now));
      if (busy) return v;
      const keep = v.episodes.filter(e => e.status === "ready");
      return { ...v, episodes: [{ id, interest, status: "generating", started: now }, ...keep] };
    });
  } catch (err) {
    console.error(err);
    return json({ error: "Couldn't start the episode - try again." }, 502);
  }
  if (busy) return json({ error: "An episode is already being made." }, 409);

  EdgeRuntime.waitUntil(make(id, input, request, user.id));
  return json({ id });
});
