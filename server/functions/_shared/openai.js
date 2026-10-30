// OpenAI calls for the functions that talk to OpenAI directly (the German
// app): structured-output chat completions (optionally after a web search)
// and text-to-speech. Failures throw AIError (see openrouter.js) with a
// user-facing message.
//
// Needs OPENAI_API_KEY in the environment; the models can be changed with
// OPENAI_MODEL and OPENAI_TTS_MODEL.

import { AIError } from "./openrouter.js";

export { AIError };

const DEFAULT_MODEL = "gpt-6.1-sol";
const DEFAULT_TTS_MODEL = "gpt-4o-mini-tts";

function apiKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new AIError("no_key", "The server has no OpenAI API key configured.", 500);
  return key;
}

async function post(path, body) {
  const key = apiKey();
  try {
    return await fetch(`https://api.openai.com/v1/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AIError("unreachable", "Couldn't reach the AI service.", 502);
  }
}

function checkStatus(res) {
  if (res.status === 429) throw new AIError("rate_limited", "Too many requests - try again in a minute.", 429);
  if (!res.ok) throw new AIError("failed", `AI request failed (${res.status}).`, 502);
}

// req: { system, user, schema, schemaName, maxTokens? }. `schema` is JSON
// Schema for the answer; strict mode needs additionalProperties: false and
// every property listed in required.
export async function structuredCompletion(req) {
  const res = await post("chat/completions", {
    model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
    max_completion_tokens: req.maxTokens ?? 8000,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: req.schemaName, strict: true, schema: req.schema },
    },
  });
  checkStatus(res);

  const data = await res.json().catch(() => null);
  const choice = data?.choices?.[0];
  if (!choice) throw new AIError("empty", data?.error?.message ?? "The AI returned no answer - try again.", 502);
  if (choice.finish_reason === "length") throw new AIError("too_long", "The answer got too long - try less input.", 422);
  if (choice.message?.refusal) throw new AIError("refused", "The AI declined this request.", 422);

  try {
    return JSON.parse(choice.message?.content);
  } catch {
    throw new AIError("unreadable", "The AI returned something unreadable - try again.", 502);
  }
}

// Like structuredCompletion, but the model may search the web first (the
// Responses API's web search tool), for answers that need current facts.
export async function searchedCompletion(req) {
  const res = await post("responses", {
    model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
    max_output_tokens: req.maxTokens ?? 8000,
    tools: [{ type: "web_search" }],
    instructions: req.system,
    input: req.user,
    text: { format: { type: "json_schema", name: req.schemaName, strict: true, schema: req.schema } },
  });
  checkStatus(res);

  const data = await res.json().catch(() => null);
  if (data?.status === "incomplete") {
    if (data.incomplete_details?.reason === "max_output_tokens") throw new AIError("too_long", "The answer got too long - try again.", 422);
    throw new AIError("empty", "The AI stopped early - try again.", 502);
  }
  const content = (data?.output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? []);
  if (content.some((c) => c.type === "refusal")) throw new AIError("refused", "The AI declined this request.", 422);
  const text = content.find((c) => c.type === "output_text")?.text;
  if (!text) throw new AIError("empty", data?.error?.message ?? "The AI returned no answer - try again.", 502);

  try {
    return JSON.parse(text);
  } catch {
    throw new AIError("unreadable", "The AI returned something unreadable - try again.", 502);
  }
}

// Speaks `text` and returns the mp3 bytes.
export async function speech(text, voice, instructions) {
  const res = await post("audio/speech", {
    model: process.env.OPENAI_TTS_MODEL || DEFAULT_TTS_MODEL,
    voice,
    input: text,
    instructions,
    response_format: "mp3",
  });
  checkStatus(res);
  return new Uint8Array(await res.arrayBuffer());
}
