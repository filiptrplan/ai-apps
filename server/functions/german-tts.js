// Speaks a German sentence for the German app with OpenAI text-to-speech
// and stores the mp3 in the user's german-audio folder, at the path the app
// chose ("<user id>/<sha-256 of the text>.mp3").
//
// Needs OPENAI_API_KEY (see _shared/openai.js).

import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { HttpError } from "./_shared/http.js";
import { speech } from "./_shared/openai.js";

const BUCKET = "german-audio";
const MAX_CHARS = 400;
const VOICE = "coral";
const INSTRUCTIONS = "Speak in clear, natural standard German (Hochdeutsch) at a normal conversational pace, like a friendly teacher.";

export const signedOut = "Sign in to hear sentences.";

export async function handle(body, { user, storage }) {
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) throw new HttpError(400, "Nothing to say.");
  if (text.length > MAX_CHARS) throw new HttpError(400, "That sentence is too long to speak.");
  // The path must be the one the app derives from the text.
  const path = `${user.id}/${createHash("sha256").update(text).digest("hex")}.mp3`;
  if (body.path !== path) throw new HttpError(400, "Invalid audio path.");

  const audio = await speech(text, VOICE, INSTRUCTIONS);
  await storage.write(BUCKET, path.split("/"), user.id, "audio/mpeg", Readable.from([audio]));
  return { path };
}
