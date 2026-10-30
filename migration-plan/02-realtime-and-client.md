# Stage 02: Realtime and client

## Goal

Replace Supabase Realtime with Server-Sent Events, and rewrite every client-side use of `supabase-js` against the new API, so no app imports Supabase any more. Bundles are rebuilt.

## Depends on

Stage 01.

## Deliverables

- [ ] Migration: `NOTIFY` triggers on `app_data` and every `mo_*` table, sending `{table, user_id, app_id, key, updated_at}`.
- [ ] `server/events.js` and `GET /api/events`: one `LISTEN` connection fanned out to SSE clients.
- [ ] `shared/api.js` replaces `shared/supabaseClient.js`: `apiFetch(path, opts)` with the same-origin cookie, throwing `Error(body.error)`.
- [ ] `shared/events.js`: one shared `EventSource` with subscribe/unsubscribe by filter.
- [ ] `shared/auth.js`: same `useSession()` contract; `signIn()` redirects to `/auth/login?next=…`; `signUp` removed; small event emitter replaces `onAuthStateChange`.
- [ ] `shared/syncStorage.js`: only the I/O changes (pull, push, subscribe). The queue and conflict logic stays.
- [ ] `shared/ai.js`: `callAI` posts to `/api/fn/:name` (the endpoint arrives in stage 03; keep the same throw-the-`{error}` behaviour).
- [ ] `shared/backup.js`: `runDailyBackupIfNeeded` removed; `listBackups` and `restoreBackup` become API calls.
- [ ] App call sites updated:
  - `recipes/photos.js`, `recipes/App.jsx`, `recipes/Compose.jsx`
  - `german/audio.js`, `german/episodes.js`, `german/App.jsx`
  - `marsova-opravila/api.js` (`unwrap(supabase.rpc(...))` → `rpc(name, args)`; realtime → SSE)
  - `climbing-tracker/App.jsx`, `shopping-list/App.jsx`, `interval-timer-app.jsx`, `semester-builder-app.jsx`
  - `index.html` (backup list and restore)
  - the sign-in forms: one "Sign in with Pocket ID" button
- [ ] `@supabase/supabase-js` removed from `package.json` and the lockfile; `vite.config.js` updated.
- [ ] All bundles rebuilt; only the bundles of changed apps committed; every offline app's `CACHE_NAME` bumped in `*-sw.js`.
- [ ] Tests: SSE fan-out (owner-only for `app_data`, broadcast for `mo_*`), and the `syncStorage` logic where it already has tests.

## Files touched

`shared/*`, the call sites above, `*-sw.js`, committed `*-app.js` bundles, `package.json`, lockfile, `vite.config.js`, a new migration, `server/events.js`.

## Design notes

### SSE

- One dedicated `LISTEN` connection (not from the query pool), reconnecting with backoff and re-issuing `LISTEN`.
- `app_data` events go only to the row owner's streams, so never broadcast one without checking `user_id`. `mo_*` events go to every `mo` stream (no login, like the reads).
- The stream needs `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`, and a comment heartbeat about every 25 s so the Cloudflare tunnel doesn't close it.
- `EventSource` reconnects by itself. On reconnect the client should re-pull its keys, since events during the gap are lost.
- Event payload carries `updated_at` so `syncStorage`'s echo detection (`written`) works as today.

### Client behaviour to preserve

- `syncStorage.js`'s conflict handling depends on `updated_at` markers: pull returns it, push returns it, and the SSE event carries it. Keep the exact meaning (database-assigned timestamp).
- `useSession()`: `undefined` while loading, `null` signed out, otherwise `{ user: { id, email } }`.
- Offline apps keep working offline; API failures must not break local-only use (as today with a missing session).
- `callAI` keeps throwing an `Error` carrying the function's `{ error }` message.

### Service workers

Every app that has an `*-sw.js` caches assets under a versioned `CACHE_NAME`. Bump all of them, or users keep the old Supabase bundles. Check that the SW doesn't cache `/api/*` or `/auth/*`.

## Done when

- `grep -r "supabase" --include='*.js' --include='*.jsx' --include='*.html' . --exclude-dir=node_modules --exclude-dir=supabase` finds nothing outside the stage-06 script (a leftover in `supabase/` itself is fine until stage 07).
- `npm run build` succeeds and `grep -l "supabase.co" *-app.js` finds nothing.
- Against the dev stack, in Chrome:
  - Every app opens with no console errors, and saves data.
  - Edit in two tabs: the change arrives live, and the conflict prompt still appears when it should.
  - Marsova updates arrive live.
  - Restore a backup from `index.html`.
- Tests pass (existing suites plus the new ones).

## REVIEW.md sections

1, 2 (sync, live updates, backup restore, offline), 3.

## Notes

(Fill in as work lands.)
