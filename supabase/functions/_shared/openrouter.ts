// Structured-output LLM calls through OpenRouter, for the edge functions.
// The model must answer with JSON matching the given schema; the parsed
// object is returned. Failures throw AIError with a user-facing message and
// the HTTP status to pass on, plus a code for callers that want to reword it.
//
// Needs the OPENROUTER_API_KEY secret:
//   supabase secrets set OPENROUTER_API_KEY=...

export const DEFAULT_MODEL = "openai/gpt-6-luna";

export type AIErrorCode =
  | "no_key"
  | "unreachable"
  | "rate_limited"
  | "failed"
  | "empty"
  | "too_long"
  | "refused"
  | "unreadable";

export class AIError extends Error {
  constructor(public code: AIErrorCode, message: string, public status: number) {
    super(message);
  }
}

export interface StructuredRequest {
  system: string;
  user: string;
  // JSON Schema for the answer; strict mode needs additionalProperties: false
  // and every property listed in required.
  schema: Record<string, unknown>;
  schemaName: string;
  // Shown on the OpenRouter dashboard, e.g. "AI Apps - Shopping List".
  title: string;
  model?: string;
  maxTokens?: number;
}

export async function structuredCompletion<T = unknown>(req: StructuredRequest): Promise<T> {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) throw new AIError("no_key", "The server has no OpenRouter API key configured.", 500);

  let res;
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
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
