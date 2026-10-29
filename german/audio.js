// Spoken example sentences. Each sentence is spoken once by the german-tts
// edge function (OpenAI TTS), which stores the mp3 in the private
// german-audio bucket at "<user id>/<sha-256 of the text>.mp3". The path
// follows from the text, so cards don't need to remember it. Played files
// are kept in the Cache API, so they also play offline.
import { supabase } from "../shared/supabaseClient.js";
import { callAI } from "../shared/ai.js";

const CACHE = "german-audio";
const BUCKET = "german-audio";

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text.trim()));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// A same-origin URL used only as the cache key.
const cacheKey = hash => new Request(`${location.origin}/__german-audio/${hash}.mp3`);

async function fromCache(hash) {
  try {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(cacheKey(hash));
    return hit ? await hit.blob() : null;
  } catch {
    return null;
  }
}

async function toCache(hash, blob) {
  try {
    const cache = await caches.open(CACHE);
    await cache.put(cacheKey(hash), new Response(blob, { headers: { "Content-Type": "audio/mpeg" } }));
  } catch {}
}

async function fetchAudio(text, session) {
  const hash = await sha256(text);
  const cached = await fromCache(hash);
  if (cached) return cached;
  if (!session) throw new Error("Sign in on the home page to hear sentences.");

  const path = `${session.user.id}/${hash}.mp3`;
  let { data } = await supabase.storage.from(BUCKET).download(path);
  if (!data) {
    await callAI("german-tts", { text: text.trim(), path });
    ({ data } = await supabase.storage.from(BUCKET).download(path));
  }
  if (!data) throw new Error("Couldn't load the audio.");
  await toCache(hash, data);
  return data;
}

let current = null;

// Plays `text`, generating the audio the first time. Resolves when playback
// starts; throws a showable Error.
export async function speak(text, session) {
  const blob = await fetchAudio(text, session);
  if (current) {
    current.pause();
    URL.revokeObjectURL(current.src);
  }
  current = new Audio(URL.createObjectURL(blob));
  await current.play();
}
