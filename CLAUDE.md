# Notes for Claude

A collection of small personal apps served as a static site (apps.trplan.si) by a Cloudflare Worker (`wrangler.jsonc`, `worker.js`), with Supabase for sign-in, data, storage and AI edge functions.

## How an app is laid out

Each app `<name>` has:

- `<name>.html`: the page. It loads React 18 and ReactDOM as UMD scripts from unpkg, holds the app's CSS in a `<style>` block, and loads `<name>-app.js`. Production serves it at the extensionless path (`/german`).
- `<name>-app.jsx`: the entry point, usually just `ReactDOM.createRoot(...).render(<App />)`.
- `<name>/`: the app's code (`App.jsx`, screens, a framework-free `model.js` for data shapes and logic, `*.test.mjs` tests), plus its PWA files (`manifest.json`, icons).
- `<name>-sw.js`: the service worker for apps that work offline. It has a versioned `CACHE_NAME` and an `ASSETS` list.
- `<name>-app.js`: the bundle, built by esbuild and **committed**, since the site has no build step.

React is a global (`const { useState } = React;`), not an import. A new app also gets a card on `index.html`.

### Building

After editing any `.jsx`/`.js` an app imports, rebuild and commit the bundles:

```sh
npx pnpm@9 install --frozen-lockfile   # pnpm, to match the committed bundles
npm run build                          # every *-app.jsx → *-app.js
```

The build rewrites every app's bundle. Commit only the bundles of the apps you changed, and revert the others (`pdf-tools-app.js` in particular tends to differ).

Tests: `node --test mcp/*.test.mjs german/*.test.mjs moped-route/*.test.mjs`.

## Shared code

`shared/` is used by every app:

- `supabaseClient.js`: the Supabase client. The publishable key is meant to be public; Row Level Security protects the data.
- `auth.js`: `useSession()` (`undefined` while loading, `null` when logged out) and sign-in helpers.
- `syncStorage.js`: `useSyncedStorage(appId, key, fallback)`, see below.
- `backup.js`: a daily snapshot of the user's `app_data` into `app_data_backups` (kept for 7 days), restorable from `index.html`.
- `ai.js`: `callAI(functionName, body)` calls an edge function and throws an `Error` carrying the function's `{ error }` message, so apps can show it as is.
- `prices.js`: Aldi price estimates for the Recipes and Shopping List apps.

### Saving data: `app_data` and `useSyncedStorage`

Apps don't get their own tables. All app data lives in one generic table, `public.app_data`: one row per `(user_id, app_id, key)`, with a `jsonb` `value` and an `updated_at` that a trigger keeps up to date. RLS limits each user to their own rows.

`useSyncedStorage(appId, key, fallback)` works like `useState` with localStorage and returns `[value, save, conflict]`. When the user is signed in, it also syncs the value with that row: it pulls on load and login, pushes on every save, and picks up changes from other tabs and devices live through Supabase Realtime. If a remote value disagrees with a local edit made since the last sync, it sets `conflict` (`{ local, remote, keepLocal, keepRemote }`) and lets the app ask the user which to keep.

To store something new, pick a new key under the app's `APP_ID` (apps list their keys in one place, e.g. `KEYS` in `german/model.js`) and keep the value a plain JSON blob. Old stored values must keep working, so apps normalise what they read (e.g. `normSettings`).

The exception is Marsova opravila, which has its own `mo_*` tables (see its migrations).

### MCP server

`mcp/` is an MCP server mounted by `worker.js` at `/mcp`, so Claude can read and change the apps' data. It uses OAuth with Supabase Auth and the user's own token, so RLS applies. `mcp/appData.js` reads and writes the same `app_data` rows, with retries keyed on `updated_at` so a tool call never overwrites a save an open app made meanwhile. Each app's tools live in `mcp/apps/<app>.js` and reuse the app's `model.js` where they can.

## Supabase

### Edge functions

`supabase/functions/<name>/index.ts` (Deno), with shared code in `supabase/functions/_shared/`:

- `http.ts`: `serveSignedIn(message, handler)` handles CORS, JSON responses and the check that a real user is signed in. Functions that use it are set to `verify_jwt = false` in `supabase/config.toml`, because the gateway's JWT check would also let the public key through.
- `openrouter.ts`: LLM calls through OpenRouter (structured JSON output, multi-speaker TTS) and `AIError`, which carries a user-facing message and an HTTP status.
- `openai.ts`: direct OpenAI calls for the German app (structured output, web search, TTS).
- `cefr.ts`: CEFR level descriptors for the German app's prompts (documented in `german/LEVELS.md`).
- `wav.ts`: wraps PCM audio into a WAV file.

Secrets (`OPENROUTER_API_KEY`, `OPENAI_API_KEY`, optional model overrides) are set in Supabase, never in the repo. Edge functions have about 2 s of CPU time per request; longer work runs in the background with `EdgeRuntime.waitUntil`.

### Deploying

Supabase deploys automatically from the `master` branch: every push or merge to `master` applies the new migrations (`supabase/migrations`) and deploys all edge functions. There's no need to run `supabase db push` or `supabase functions deploy` by hand, or to tell the user to.

Because of this, a migration is live as soon as it reaches `master`. Never edit a migration that is already on `master`; add a new one instead.
