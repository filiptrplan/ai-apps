# Notes for Claude

A collection of small personal apps at apps.trplan.si, served by one self-hosted Node server (`server/`, see `server/README.md`) with its own Postgres and file storage, on vps2. They moved there from Supabase and a Cloudflare Worker on 2026-10-31; `supabase/` and `migration-plan/` stay until that's decommissioned (`migration-plan/07-decommission.md`) and are no longer used.

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

The build rewrites every app's bundle. With pnpm's `node_modules` every unchanged bundle comes out byte for byte the same, so commit the ones that changed.

Tests: `npm test` (the app and MCP tests, then the server's against a throwaway Postgres in Docker).

CI (`.github/workflows/deploy.yml`) runs on every push and PR: the tests, the migrations (up, rollback, up), and fails if a committed bundle or `db/schema.sql` differs from a fresh build or dump. A green push to `master` then fast-forwards `deploy`, and vps2 redeploys it (see `server/README.md`, Deploying). Migrations only roll forward, so code that the rollback workflow may go back to must still work with the newer schema. The rollback workflow can't go back across a change to `.github/workflows/` (`GITHUB_TOKEN` has no `workflows` permission); force-push `deploy` by hand then.

## Shared code

`shared/` is used by every app:

- `api.js`: `apiFetch(path, options)` calls the server's API with the session cookie and throws an `Error` carrying the server's `{ error }` message.
- `auth.js`: `useSession()` (`undefined` while loading, `null` when logged out) and sign-in through Pocket ID (`id.trplan.si`). There are no sign-ups: a user must exist in `users` first.
- `syncStorage.js`: `useSyncedStorage(appId, key, fallback)`, see below.
- `events.js`: live updates over Server-Sent Events (`/api/events`), one connection per page.
- `backup.js`: restoring the daily snapshots of the user's `app_data` (the server takes them and keeps 7 days), from `index.html`.
- `ai.js`: `callAI(functionName, body)` calls an AI function (`POST /api/fn/<name>`) and throws an `Error` carrying the function's `{ error }` message, so apps can show it as is.
- `prices.js`: Aldi price estimates for the Recipes and Shopping List apps.
- `push.js` and `push-sw.js`: push notifications. A page turns them on with `enablePush(appId)` (from a tap) and calls `syncPush(appId)` on load; the app's service worker sets `self.PUSH_APP` and imports `push-sw.js`; the server sends with `push.send(userId, appId, payload)` (`server/push.js`), and a page can have one sent later with `PUT /api/push/scheduled/:app/:id` (the climbing tracker's "Rest over" while it's in the background). Subscriptions are per app and per device.

### Saving data: `app_data` and `useSyncedStorage`

Apps don't get their own tables. All app data lives in one generic table, `public.app_data`: one row per `(user_id, app_id, key)`, with a `jsonb` `value` and an `updated_at` that a trigger keeps up to date. Only `server/appData.js` touches it, and every query is scoped to the signed-in user.

`useSyncedStorage(appId, key, fallback)` works like `useState` with localStorage and returns `[value, save, conflict]`. When the user is signed in, it also syncs the value with that row: it pulls on load and login, pushes on every save, and picks up changes from other tabs and devices live through `shared/events.js`. If a remote value disagrees with a local edit made since the last sync, it sets `conflict` (`{ local, remote, keepLocal, keepRemote }`) and lets the app ask the user which to keep.

To store something new, pick a new key under the app's `APP_ID` (apps list their keys in one place, e.g. `KEYS` in `german/model.js`) and keep the value a plain JSON blob. Old stored values must keep working, so apps normalise what they read (e.g. `normSettings`).

The exception is Marsova opravila, which has its own `mo_*` tables (see `db/migrations` and `server/routes/mo.js`).

### MCP server

`mcp/` is an MCP server mounted by `server/mcp.js` at `/mcp`, so Claude can read and change the apps' data. It uses OAuth with Pocket ID (`id.trplan.si`): the bearer token's `sub` picks the user, and every query is scoped to them. `mcp/appData.js` reads and writes the same `app_data` rows, with retries keyed on `updated_at` so a tool call never overwrites a save an open app made meanwhile. Each app's tools live in `mcp/apps/<app>.js` and reuse the app's `model.js` where they can.

## AI functions

`server/functions/<name>.js`, one per function, each exporting `handle(body, ctx)` that returns the JSON answer or throws `HttpError(status, message)` (`_shared/http.js`); `server/routes/fn.js` serves them at `POST /api/fn/<name>` to signed-in users. Shared code is in `server/functions/_shared/`:

- `openrouter.js`: LLM calls through OpenRouter (structured JSON output, multi-speaker TTS) and `AIError`, which carries a user-facing message and an HTTP status.
- `openai.js`: direct OpenAI calls for the German app (structured output, web search, TTS).
- `cefr.js`: CEFR level descriptors for the German app's prompts (documented in `german/LEVELS.md`).
- `wav.js`: wraps PCM audio into a WAV file.

The keys (`OPENROUTER_API_KEY`, `OPENAI_API_KEY`, optional model overrides) live in the Komodo stack's environment, never in the repo. Long work (the podcast) runs in the background in the server process and reports progress through `app_data`.

## Database migrations

dbmate, plain SQL in `db/migrations` (`npx dbmate new <name>`, then `npm run db:migrate` against the dev database, which also rewrites `db/schema.sql`; commit both). Every deploy applies new migrations before starting the new app, so a migration is live as soon as it reaches `master`. Never edit a migration that's already on `master`; add a new one instead.

Deploys need nothing by hand: CI moves `deploy`, and Komodo (`ai-apps autodeploy`) deploys it on vps2 within a minute. Don't run `docker compose` or Komodo deploys yourself unless asked. See `server/README.md` for local development, the environment and rollback.
