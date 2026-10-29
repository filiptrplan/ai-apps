// Supabase Edge Function: speaks a German sentence for the German app with
// OpenAI text-to-speech and stores the mp3 in the private german-audio
// bucket, at the path the app chose ("<user id>/<sha-256 of the text>.mp3").
// The upload uses the caller's own token, so storage policies keep each
// user to their own folder. Only signed-in users may call it.
//
// Needs the OPENAI_API_KEY secret (see _shared/openai.ts).
// Deploy with:
//   supabase functions deploy german-tts

import { json, serveSignedIn } from "../_shared/http.ts";
import { AIError, speech } from "../_shared/openai.ts";

const BUCKET = "german-audio";
const MAX_CHARS = 400;
const VOICE = "coral";
const INSTRUCTIONS = "Speak in clear, natural standard German (Hochdeutsch) at a normal conversational pace, like a friendly teacher.";

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

serveSignedIn("Sign in to hear sentences.", async (body, user, request) => {
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return json({ error: "Nothing to say." }, 400);
  if (text.length > MAX_CHARS) return json({ error: "That sentence is too long to speak." }, 400);
  // The path must be the one the app derives from the text.
  const path = `${user.id}/${await sha256(text)}.mp3`;
  if (body.path !== path) return json({ error: "Invalid audio path." }, 400);

  let audio;
  try {
    audio = await speech(text, VOICE, INSTRUCTIONS);
  } catch (err) {
    if (!(err instanceof AIError)) throw err;
    return json({ error: err.message }, err.status);
  }

  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      Authorization: request.headers.get("authorization") ?? "",
      "Content-Type": "audio/mpeg",
      "x-upsert": "true",
    },
    body: audio,
  });
  if (!res.ok) return json({ error: `Couldn't store the audio (${res.status}).` }, 502);
  return json({ path });
});
