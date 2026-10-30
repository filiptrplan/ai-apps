# Stage 02: Realtime and client

## Goal

Replace Supabase Realtime with Server-Sent Events, and rewrite every client-side use of `supabase-js` against the new API, so no app imports Supabase any more. Bundles are rebuilt.

## Depends on

Stage 01.

## Deliverables

- [x] Migration: `NOTIFY` triggers on `app_data` and every `mo_*` table, sending `{table, user_id, app_id, key, updated_at}`.
- [x] `server/events.js` and `GET /api/events`: one `LISTEN` connection fanned out to SSE clients.
- [x] `shared/api.js` replaces `shared/supabaseClient.js`: `apiFetch(path, opts)` with the same-origin cookie, throwing `Error(body.error)`.
- [x] `shared/events.js`: one shared `EventSource` with subscribe/unsubscribe by filter.
- [x] `shared/auth.js`: same `useSession()` contract; `signIn()` redirects to `/auth/login?next=…`; `signUp` removed; small event emitter replaces `onAuthStateChange`.
- [x] `shared/syncStorage.js`: only the I/O changes (pull, push, subscribe). The queue and conflict logic stays.
- [x] `shared/ai.js`: `callAI` posts to `/api/fn/:name` (the endpoint arrives in stage 03; keep the same throw-the-`{error}` behaviour).
- [x] `shared/backup.js`: `runDailyBackupIfNeeded` removed; `listBackups` and `restoreBackup` become API calls.
- [x] App call sites updated:
  - `recipes/photos.js`, `recipes/App.jsx`, `recipes/Compose.jsx`
  - `german/audio.js`, `german/episodes.js`, `german/App.jsx`
  - `marsova-opravila/api.js` (`unwrap(supabase.rpc(...))` → `rpc(name, args)`; realtime → SSE)
  - `climbing-tracker/App.jsx`, `shopping-list/App.jsx`, `interval-timer-app.jsx`, `semester-builder-app.jsx`
  - `index.html` (backup list and restore)
  - the sign-in forms: one "Sign in with Pocket ID" button
- [x] ~~`@supabase/supabase-js` removed from `package.json` and the lockfile~~ (moved to stage 04: `mcp/http.js` still needs it); `vite.config.js` updated.
- [x] All bundles rebuilt; only the bundles of changed apps committed; every offline app's `CACHE_NAME` bumped in `*-sw.js`.
- [x] Tests: SSE fan-out (owner-only for `app_data`, broadcast for `mo_*`), and the `syncStorage` logic where it already has tests.

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

### Done-when evidence (2026-10-30)

- `grep -rln supabase --include='*.js' --include='*.jsx' --include='*.html' . --exclude-dir=node_modules --exclude-dir=supabase` → only `oauth-consent.html`, `mcp/http.js` and `mcp/appData.js`, which stage 04 replaces (the grep in "Done when" couldn't pass before 04).
- `npm run build` succeeded; `grep -l supabase.co *-app.js` finds nothing. Each rebuilt bundle is ~20k lines smaller. `pdf-tools-app.js` reverted (it imports nothing from `shared/`).
- `npm test`: existing suites 74/74, server suites 54/54 (new `events.test.mjs`: topic checks and 401, SSE headers, owner-only `app_data`, `mo_*` to every mo stream, one event per statement, `updated_at` format under a non-UTC writer, resync after `pg_terminate_backend` on the LISTEN connection, closed streams dropped).
- `npm run db:migrate` applied `20261030150000_change_notifications.sql` to the dev DB and rewrote `db/schema.sql`.
- In Chrome, against the dev stack (`localhost:8090`, signed in as filip@trplan.si):
  - All 10 apps open with no console errors; opening them created all 27 `app_data` rows.
  - Recipes in two tabs: an item added in one appeared in the other without a reload.
  - Conflict: with tab 1's PUTs failing, an item added there plus a direct DB write (like an MCP tool) showed "Your lists changed on another device"; "Use theirs" took the remote list.
  - Server stopped, row changed, server started: the open tab showed the change after EventSource reconnected (resync).
  - Marsova: `mo_settings` changed in the DB → the greeting changed live.
  - `index.html`: Restore of today's backup put back a deleted item, and the open Recipes tab picked it up live.
  - Cache Storage has only the five bumped caches (`*-v2`/`v3`/`v4`), none holding `/api` or `/auth` responses.
  - Log out on `index.html` → "Sign in with Pocket ID", the other tab's session cleared too; the button went through Pocket ID and back, signed in.

### Decisions and findings

- **supabase-js stays in `package.json` until stage 04**: `mcp/http.js` (the Worker's `/mcp`, still live on `master`) imports it. No app bundle includes it any more.
- **Events carry no value**; a page that sees a change it doesn't have (`updated_at` not its marker or one of its own writes) does a GET. `updated_at` is formatted in UTC in the trigger, so it matches the API's whatever the writer's time zone.
- **Topics** in the URL (`?topics=data,mo`): `data` needs a session (401 otherwise), `mo` doesn't. The client opens one EventSource for whatever its subscribers want and reopens it when the session changes.
- **Resync**: sent by the server when its LISTEN connection comes back, and raised by the client when EventSource reconnects or after a refused stream is retried (30 s). `syncStorage` and episodes re-pull; Marsova refetches every table.
- **Session cache**: `shared/auth.js` remembers the last session in localStorage (`auth:session`) and uses it when `/api/auth/session` can't be reached, so offline apps still know who's signed in; it re-checks when the browser comes back online. Sign-in/out in another tab arrives through the `storage` event.
- **Recipe photos** are now plain `<img src="/api/storage/recipe-photos/…">` URLs (the cookie authorises them), so the signed-URL cache is gone. Old `recipes-photo-url:*` localStorage keys are left behind (harmless).
- **Service workers**: none of them skipped same-origin `/api/*` (only moped-route did), which would have cached API responses and buffered the event stream forever, so all five now skip `/api/` and `/auth/`. Climbing's and Marsova's `activate` deleted every other cache on the origin, the German audio cache included; they now only delete their own old versions.
- **Two tabs in one browser** share localStorage, so an edit in one tab updates the other tab's sync marker, and that tab takes the event as already seen. A dirty edit there isn't flagged as a conflict. Supabase behaved the same (`localMarker === row.updated_at` check); the real cross-device conflict works (see above).
- The "Sign in on the home page" links in the apps are kept: the home page has the Pocket ID button.
