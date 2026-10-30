// LLM calls through OpenRouter, for the AI functions: structured output
// (the model must answer with JSON matching the given schema; the parsed
// object is returned) and multi-speaker text-to-speech. Failures throw
// AIError with a user-facing message and the HTTP status to pass on, plus a
// code for callers that want to reword it.
//
// Needs OPENROUTER_API_KEY in the environment.

import { HttpError } from "./http.js";

export const DEFAULT_MODEL = "openai/gpt-6-luna";

// code: "no_key" | "unreachable" | "rate_limited" | "failed" | "empty" |
// "too_long" | "refused" | "unreadable"
export class AIError extends HttpError {
  constructor(code, message, status) {
    super(status, message);
    this.code = code;
  }
}

function apiKey() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new AIError("no_key", "The server has no OpenRouter API key configured.", 500);
  return key;
}

// req: { system, user, schema, schemaName, title, model?, maxTokens? }.
// `user` is the user message: a string, or a content array (text and
// image_url parts). `schema` is JSON Schema for the answer; strict mode needs
// additionalProperties: false and every property listed in required.
// `title` is shown on the OpenRouter dashboard, e.g. "AI Apps - Shopping List".
export async function structuredCompletion(req) {
  const key = apiKey();
  let res;
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        "X-Title": req.title,
      },
      body: JSON.stringify({
        model: req.model ?? DEFAULT_MODEL,
        max_tokens: req.maxTokens ?? 16000,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: req.schemaName, strict: true, schema: req.schema },
        },
        // Only route to providers that enforce the schema.
        provider: { require_parameters: true },
      }),
    });
  } catch {
    throw new AIError("unreachable", "Couldn't reach the AI service.", 502);
  }
  if (res.status === 429) throw new AIError("rate_limited", "Too many requests - try again in a minute.", 429);
  if (!res.ok) throw new AIError("failed", `AI request failed (${res.status}).`, 502);

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

// Speaks a dialogue in one call (multi-speaker input, Gemini TTS) through
// OpenRouter's speech endpoint. `turns` are { text, voice }; `instructions`
// direct the delivery of the whole thing; the text is read as is. Returns raw
// 16-bit little-endian PCM and its format, from the response's Content-Type
// ("audio/pcm;rate=24000;channels=1").
export async function dialogueSpeech(turns, instructions, model) {
  const key = apiKey();
  let res;
  try {
    res = await fetch("https://openrouter.ai/api/v1/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "X-Title": "AI Apps - German" },
      body: JSON.stringify({ model, input: turns, instructions, response_format: "pcm" }),
    });
  } catch {
    throw new AIError("unreachable", "Couldn't reach the speech service.", 502);
  }
  if (res.status === 429) throw new AIError("rate_limited", "Too many requests - try again in a minute.", 429);
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new AIError("failed", data?.error?.message ?? `Speech request failed (${res.status}).`, 502);
  }
  const type = res.headers.get("content-type") ?? "";
  const param = (name, fallback) => Number(type.match(new RegExp(`${name}=(\\d+)`))?.[1] ?? fallback);
  const pcm = new Uint8Array(await res.arrayBuffer());
  if (!pcm.length) throw new AIError("empty", "The speech service returned no audio - try again.", 502);
  return { pcm, sampleRate: param("rate", 24000), channels: param("channels", 1) };
}
