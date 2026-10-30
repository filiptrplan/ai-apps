// Spoken example sentences and podcast episodes. Each sentence is spoken
// once by the german-tts function (OpenAI TTS), which stores the mp3 in the
// private german-audio bucket at "<user id>/<sha-256 of the text>.mp3".
// The path follows from the text, so cards don't need to remember it.
// Episodes (WAV) are stored by the german-podcast function at the path
// their entry holds. Played files are kept in the Cache API, so they also play
// offline.
import { apiFetch } from "../shared/api.js";
import { callAI } from "../shared/ai.js";

const CACHE = "german-audio";
const BUCKET = "german-audio";

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text.trim()));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// A same-origin URL used only as the cache key: "<hash>" for sentences,
// "podcast/<id>" for episodes.
const cacheKey = name => new Request(`${location.origin}/__german-audio/${name}.mp3`);
const episodeName = path => `podcast/${path.split("/").pop().replace(/\.\w+$/, "")}`;

async function fromCache(name) {
  try {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(cacheKey(name));
    return hit ? await hit.blob() : null;
  } catch {
    return null;
  }
}

async function toCache(name, blob) {
  try {
    const cache = await caches.open(CACHE);
    await cache.put(cacheKey(name), new Response(blob, { headers: { "Content-Type": blob.type || "audio/mpeg" } }));
  } catch {}
}

// The stored file as a Blob, or null if there's none (or it can't be read).
function download(path) {
  return apiFetch(`/api/storage/${BUCKET}/${path}`, { as: "blob" }).catch(() => null);
}

async function fetchAudio(text, session) {
  const hash = await sha256(text);
  const cached = await fromCache(hash);
  if (cached) return cached;
  if (!session) throw new Error("Sign in on the home page to hear sentences.");

  const path = `${session.user.id}/${hash}.mp3`;
  let data = await download(path);
  if (!data) {
    await callAI("german-tts", { text: text.trim(), path });
    data = await download(path);
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

// An episode's audio as a Blob, from the cache or else downloaded (and then
// cached). Throws a showable Error.
export async function episodeAudio(path, session) {
  const name = episodeName(path);
  const cached = await fromCache(name);
  if (cached) return cached;
  if (!session) throw new Error("Sign in on the home page to play episodes.");
  const data = await download(path);
  if (!data) throw new Error("Couldn't load the episode.");
  await toCache(name, data);
  return data;
}

// Drops cached episodes that are no longer kept (the server keeps the last
// few), so old ones don't pile up on the device.
export async function forgetEpisodes(keepPaths) {
  try {
    const keep = new Set(keepPaths.map(p => cacheKey(episodeName(p)).url));
    const cache = await caches.open(CACHE);
    for (const req of await cache.keys()) {
      if (req.url.includes("/__german-audio/podcast/") && !keep.has(req.url)) await cache.delete(req);
    }
  } catch {}
}
