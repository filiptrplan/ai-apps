# Stage 03: AI functions

## Goal

Port the seven Deno edge functions to Node modules served at `POST /api/fn/:name`, without the 2 s CPU limit.

## Depends on

Stage 01. Can run in parallel with stage 02.

## Deliverables

- [x] `server/functions/_shared/`: `http.js` (replaced by Express middleware), `openrouter.js`, `openai.js`, `cefr.js`, `wav.js`, ported from `supabase/functions/_shared/*.ts`.
- [x] `server/functions/<name>.js` for each of: `german-ai`, `german-podcast`, `german-tts`, `price-estimate`, `recipe-import`, `shopping-list`, `shopping-merge`.
- [x] `server/routes/fn.js`: `POST /api/fn/:name` behind `requireUser`, with JSON parse errors and a registry of the seven names. Unknown name → 404.
- [x] The Supabase REST and Storage `fetch`es inside the functions replaced by direct calls to `server/appData.js` and `server/storage.js`.
- [x] `german-podcast` runs its job in-process after responding, with no time limit, writing progress into `app_data`.
- [x] Env variables documented: `OPENROUTER_API_KEY`, `OPENAI_API_KEY` and the optional model overrides.
- [x] Tests for each function's request handling with the model calls mocked.

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

### Done-when evidence (2026-10-30)

- `npm run test:server`: 80/80, 26 of them new in `fn.test.mjs` (every function's 401 message, unknown name 404, invalid JSON, AI error statuses and messages, missing keys, env model overrides, each function's input checks and request shape, TTS stored and served back, a full podcast episode with WAV size and header checked, one job per user, failed jobs, keeping 10 episodes and deleting old audio, restart recovery, recipe links with JSON-LD and redirects, the private-address block, price-estimate costs and retries). Existing suites 74/74.
- Each port was compared with its Deno original by compiling both with esbuild and diffing: only the intended changes (imports, `json()` → return/throw, Supabase REST/Storage → `appData`/`storage`, `waitUntil` → `background`).
- Mutation check: removing the DNS check, the per-user running guard, or the recovery each made its test fail; all restored.
- Real keys, against the dev server on the host (`npm run dev:server` with the keys from the shell env, signed in as filip@trplan.si, calls made from a `localhost:8090` page):
  - `german-ai` `fill` "application" at A2.2 → 200 in 4.7 s: der Antrag / die Bewerbung / die Anwendung, each with its sense.
  - `german-ai` `check` → 200 in 4.8 s: "Good", corrected to "Gestern bin ich in die Stadt gegangen und habe einen Kaffee getrunken.", 2 fixes.
  - `german-tts` → 200 in 1.2 s; the mp3 served back from `/api/storage/german-audio/…`: 52 kB, `audio/mpeg`, plays (3.3 s).
  - Signed out: `german-tts` → 401 "Sign in to hear sentences."
  - Found and fixed on the way: with `STORAGE_DIR=.dev-storage`, every stored file was a 404 (`sendFile` refuses dotfile paths). Production's `/data/storage` wasn't affected; the tests now use a dot folder.

### Still to do (the user, later)

The shell's `OPENROUTER_API_KEY` is rejected by OpenRouter (401 on `/api/v1/key`), so everything on OpenRouter is unchecked with real keys. Put a valid key in `.env` (`OPENROUTER_API_KEY=…`, plus `OPENAI_API_KEY`), run `npm run dev:server` (or recreate the dev `app` container), then call each once and paste the results above:

- [ ] `german-podcast`: a full episode (note how long it took, the WAV's size and seconds).
- [ ] `recipe-import`: from a URL.
- [ ] `price-estimate`: a few items.
- [ ] `shopping-list` and `shopping-merge`.

### Decisions and findings

- **Functions are `{ signedOut, handle(body, ctx) }`** modules (`ctx` = `{ user, appData, storage, background }`), registered in `server/routes/fn.js`. `call(name, body, user)` runs one in-process; stage 04's MCP tools use it instead of HTTP.
- **Errors:** `HttpError(status, message)` (in `functions/_shared/http.js`); `AIError` extends it. Anything else is the app's generic 500. Every message is the same as on Supabase; `recipe-import` and `shopping-list` keep their own wording for `too_long`/`refused`.
- **The 401 comes before JSON parsing**, so signed-out callers get the function's message whatever they send. The JSON limit for `/api/fn` is 30 MB (8 screenshots of up to 3 MB base64).
- **recipe-import now blocks private addresses:** on Supabase a link couldn't reach anything of ours; on vps2 it could reach the database, Komodo or the tailnet. Every hop's host must resolve only to public addresses (`net.BlockList`: loopback, RFC 1918, 100.64/10, link-local, ULA, …). The fetch resolves the name again, so a hostile DNS server could still rebind between the check and the fetch; accepted (it also needs a signed-in user).
- **Podcast job:** in-process with no time limit. `running` (per process) stops a second job for the same user even after the entry passes the app's 10-minute stale mark, which a long job can now actually reach. On startup `recover()` marks every leftover `generating` entry failed ("The server restarted while making the episode - try again."). `appData.usersWith(appId, key)` was added for that scan.
- `german/model.js` still says to keep `EPISODE_STALE_MS` in sync with the Deno function; that comment moves to the Node file in stage 07, when the Deno code goes (changing it now would rebuild the German bundle for a comment).

