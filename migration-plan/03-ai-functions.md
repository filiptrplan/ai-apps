# Stage 03: AI functions

## Goal

Port the seven Deno edge functions to Node modules served at `POST /api/fn/:name`, without the 2 s CPU limit.

## Depends on

Stage 01. Can run in parallel with stage 02.

## Deliverables

- [ ] `server/functions/_shared/`: `http.js` (replaced by Express middleware), `openrouter.js`, `openai.js`, `cefr.js`, `wav.js`, ported from `supabase/functions/_shared/*.ts`.
- [ ] `server/functions/<name>.js` for each of: `german-ai`, `german-podcast`, `german-tts`, `price-estimate`, `recipe-import`, `shopping-list`, `shopping-merge`.
- [ ] `server/routes/fn.js`: `POST /api/fn/:name` behind `requireUser`, with JSON parse errors and a registry of the seven names. Unknown name → 404.
- [ ] The Supabase REST and Storage `fetch`es inside the functions replaced by direct calls to `server/appData.js` and `server/storage.js`.
- [ ] `german-podcast` runs its job in-process after responding, with no time limit, writing progress into `app_data`.
- [ ] Env variables documented: `OPENROUTER_API_KEY`, `OPENAI_API_KEY` and the optional model overrides.
- [ ] Tests for each function's request handling with the model calls mocked.

## Files touched

New: `server/functions/**`, `server/routes/fn.js`. Modified: `server/index.js`. The Deno originals stay until stage 07 (they are the reference and the production fallback).

## Design notes

- The code is mostly fetch-based and moves almost line for line: `Deno.env.get` → `process.env`; `serveSignedIn` → Express middleware; `Deno.serve` handlers become `(body, user, req) => Response-like`.
- Error contract: functions throw `AIError` (user-facing message plus HTTP status). The route turns it into `{ error: message }` with that status, which `callAI` surfaces as is. Keep the same messages.
- CORS is gone: same origin now.
- Signed-in check is the session cookie, not a bearer token. MCP calls these functions directly as modules (stage 04), not through HTTP.
- **Podcast job:** respond immediately with the episode id, then run `make(...)` in the background. Guard against the process dying mid-job: on startup, mark episodes still in a "generating" state as failed (or resume), otherwise they stay stuck. Progress writes go through `appData` so SSE delivers them (`german/episodes.js` listens on `app_data`).
- Long generation: set no request timeout on the HTTP side for this route, and keep the Cloudflare 100 s limit in mind: the response returns immediately, so it doesn't apply.
- TTS output is WAV via `wav.js`; audio is stored under `german-audio/<userId>/...` with the same paths as today so migrated files keep working.
- Concurrency: limit simultaneous podcast jobs per user (one) so a double-tap doesn't start two.
- OpenAI/OpenRouter keys are read from env at call time, never logged.

## Done when

- `node --test server/*.test.mjs` passes for the new function tests.
- Against the dev stack with real keys (set locally, not committed), each function is called once from the app or with `curl` and a session cookie:
  - German: AI check, TTS, a full podcast episode (longer than 2 s of CPU, finishing without a timeout; note the duration and storage size).
  - Recipes: import from a URL, price estimate.
  - Shopping list: list and merge.
- Signed-out calls get 401 with the same message each function used before.

## REVIEW.md sections

2 (all 7 AI functions), 7 (long jobs).

## Notes

(Fill in as work lands.)
