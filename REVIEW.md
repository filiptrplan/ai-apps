# Post-migration review: Supabase + Cloudflare Workers → vps2

A checklist that a separate agent worked through after the migration (stage 07 of the migration plan, deleted once this review was done; see git history before the commit that removed `migration-plan/`). It confirms that apps.trplan.si runs entirely on vps2 and that nothing from Supabase or the Worker is left.

## How to use this file

- Work through the sections in order. Each item names what to run or do and what to expect.
- Tick an item (`- [x]`) only when the result matches, and put the evidence under it as an indented `Evidence:` line: the command output (trimmed), or what you saw in Chrome.
- **Only fix what an item lists.** Anything else you notice (bugs, cleanups, doubts) goes in **Findings** at the bottom, for the user to decide.
- Never print secrets (tokens, cookies, client secrets, `.env` values). Decode JWTs at the header and payload level only.
- Confirm with the user before any state-changing action outside the repo (Komodo, Cloudflare, Pocket ID, GitHub settings, the NAS).

Hosts and names used below:

| Name | Value |
|---|---|
| Site | `https://apps.trplan.si` (staging was `https://apps-next.trplan.si`) |
| vps2 public IP | `178.105.22.185` |
| Komodo stack | `ai-apps` (repo-linked to branch `deploy`, compose at `deploy/compose.yaml`) |
| Containers | `app` (Node, `127.0.0.1:8090`), `db` (Postgres 17, internal only), `migrate` (dbmate, one-shot) |
| Data on vps2 | `~/container-data/ai-apps/{pg,storage,dumps}` |
| Pocket ID | `https://id.trplan.si`, clients `ai-apps` (app sign-in) and `ai-apps-mcp` (claude.ai connector) |
| Old Supabase project | `zqxvlczqfqmcojbgwogs` |

SSH to vps2 needs a YubiKey touch; use the `homelab` skill's `ssh-socket` instructions. Run psql as `docker compose -p ai-apps exec db psql -U postgres -d app` on vps2 (adjust user and db to the names in `deploy/compose.yaml`).
Review run 2026-11-14 (11:20–12:45 UTC) by a separate agent, against `master` at `0dda154` (`deploy` and `/api/health` at the same sha). "Not run" items are left unticked with the reason.

## 1. No Supabase left

- [ ] `git grep -niE 'supabase|zqxvlczq|sb_publishable|Deno\.|EdgeRuntime|wrangler' -- ':!REVIEW.md' ':!scripts/migrate-from-supabase.mjs'` prints nothing.
  Evidence: not empty, but every hit is accepted or expected: the comments in `db/migrations/20261030130000_baseline.sql:3,4,9` and `20261030150000_change_notifications.sql:3` (migrations already on `master`, never to be edited; see Findings, accepted), all of `migration-plan/**` (deleted after this review), and `.claude/settings.local.json:13` (`mcp__claude_ai_Supabase__execute_sql`, committed in `0dda154`; see Findings). No hit in code.
  After the review: `.claude/settings.local.json` untracked (`3a0ad79`) and `migration-plan/` deleted; the only hits left are the four comment lines in the two migrations (accepted). `scripts/` no longer exists.
- [x] `grep -n '@supabase' package.json pnpm-lock.yaml` prints nothing.
  Evidence: no output, exit code 1.
- [x] `git grep -l 'supabase.co' -- '*-app.js'` prints nothing (no committed bundle talks to Supabase).
  Evidence: bundles are no longer committed (`git ls-files '*-app.js'` is empty; `.gitignore:8` `/*-app.js`), so checked the served ones instead: all 10 `https://apps.trplan.si/<app>-app.js` (climbing-tracker 473 kB … shopping-list 32 kB) have 0 matches for `supabase` (case-insensitive); nor do the served `*.html`, `*-sw.js` and `shared/*.js`.
- [x] `ls supabase worker.js wrangler.jsonc .assetsignore migration-plan 2>&1` reports each as missing.
  Evidence: `supabase`, `worker.js`, `wrangler.jsonc`, `.assetsignore`: "No such file or directory". `migration-plan/` still exists (9 files), as planned: it is deleted after this review. Then deleted in the final stage 07 commit, so all five are missing.
- [x] Every page loads without a request to `*.supabase.co` (Chrome network log on `/`, `/german`, `/recipes`).
  Evidence: Chrome, signed in: resource hosts on `/german` were apps.trplan.si (13), unpkg.com (2), fonts.googleapis.com, fonts.gstatic.com, static.cloudflareinsights.com; `/recipes` the same set (8 from apps.trplan.si); `/` apps.trplan.si (5) and cloudflareinsights. The network log filtered on `supabase` was empty. `getent ahostsv4 zqxvlczqfqmcojbgwogs.supabase.co` no longer resolves.

## 2. Feature parity

One check per Supabase feature that was replaced. Run them in Chrome on the production site, signed in as the owner unless stated.

- [ ] **Sign-in:** `/` → Sign in → Pocket ID passkey → back on the site, signed in. `GET /api/auth/session` returns the user.
  Evidence: partly. Before the sign-out test, `GET /api/auth/session` returned user `b9ef8bfd-…` (`f…@trplan.si`). After signing out, "Sign in with Pocket ID" went to `/auth/login` → `https://id.trplan.si/interaction?...` ("Sign in to AI Apps"), which needs the owner's passkey: not run (needs the user). `/auth/login` sends `client_id=ai-apps`, PKCE S256, `state` and `nonce` (curl). **The owner is now signed out of apps.trplan.si in Chrome and needs to sign in again.**
- [x] **Sign-out:** Sign out clears the session; `GET /api/auth/session` returns no user, and `GET /api/data/german/settings` returns 401.
  Evidence: in Chrome, `POST /auth/logout` (what the Log out button calls) → 204; then `/api/auth/session` → `{"user":null}`, `/api/data/german/settings` → 401; `/` then showed "Sign in with Pocket ID".
- [ ] **Allowed group:** a Pocket ID user outside the allowed group (create a throwaway one, with the user's confirmation, and delete it afterwards) is refused by Pocket ID or by `/auth/callback`, and no row is created for them.
  Evidence: not run: not approved (no Pocket ID users may be created). Covered by `server/auth.test.mjs:160` "an unknown email, or none, gets a 403 and no session" (green in CI run 43589929874); the code path is `server/auth.js` `/auth/callback` → `findUser` → 403 "This account doesn't have access to the apps."
- [x] **Sync:** open `/shopping-list` in two tabs. A change in tab A shows up in tab B within a few seconds, without reloading.
  Evidence: **failed.** Ticking "onion" in tab A saved (server row `shopping-list-checked` = `{"onion":true}`, and it survived a reload in both tabs), but tab B kept showing "0 of 13 in the basket" for 10+ s. Same with two `/recipes` tabs (ticking "Korenje"): the server's SSE stream did deliver the change (a test `EventSource('/api/events?topics=data')` in tab B got `{"table":"app_data","app_id":"recipes","key":"recipes-lists",...}`), but B's UI never updated. Also, every open `/shopping-list` tab polls `GET /api/data/shopping-list/{recipes,extras,checked}` in a tight loop (~40 requests/s per tab). See Findings F1 and F2. Changes were reverted (see Findings, state changes).
  Evidence (re-check after fixing F1/F2 in `f01ce80`, 2026-11-14): two `/shopping-list` tabs on the fixed bundle. Ticking Onion in tab A showed in tab B within 1.5 s ("1 of 13 in the basket", Onion ticked); unticking it in B cleared A ("0 of 13"); server value back to `{}`. 0 `/api/data/` requests in 5 s at rest per tab (was 405).
- [ ] **Conflict prompt:** take tab B offline (DevTools → Network → Offline), edit the same list in both tabs, bring B back online. B shows the keep-local / keep-remote prompt, and both choices work.
  Evidence: not run: the Chrome extension can't toggle DevTools offline mode, and two tabs of one browser share localStorage (F2), so this test can't be done as written in one browser; use two browsers/devices.
- [ ] **Live German episodes:** start a podcast episode in `/german`; its status updates in a second tab without reloading.
  Evidence: not run: not approved (generating an episode costs money and adds an episode).
- [ ] **Live Marsova:** a chore ticked in one `/marsova-opravila` tab appears in another tab without reloading.
  Evidence: not run: completing and undoing a chore leaves two permanent rows (`chore_completed` + `chore_undone`) in `mo_activity_log`, which the other user sees in her history, so it can't be fully reverted.
- [ ] **Recipe photos:** add a photo to a recipe, reload, it shows; delete it, and the file is gone from `~/container-data/ai-apps/storage/recipe-photos/<user id>/`.
  Evidence: partly, through the storage API from the signed-in page rather than a recipe: `PUT /api/storage/recipe-photos/<own id>/review-test-….webp` (554 B, `image/webp`) → 200, `GET` → 200 `image/webp` 554 B, file present on vps2 (`554 b9ef8bfd…/review-test-1794656420141.webp`); `DELETE` → 204, `GET` → 404, and the folder is back to its 2 original files. (A PNG upload is refused with 415: only webp/jpeg are allowed.) Not done through the recipe UI (file upload).
- [x] **German audio:** an existing episode's audio plays; a new TTS clip plays.
  Evidence: in Chrome: `GET /api/storage/german-audio/<own id>/podcast/2b6eb18c.wav` → 200 `audio/wav` 13,008,044 B, `<audio>` played (t=0.76 s of 271 s). New clip: `POST /api/fn/german-tts` with "Das ist ein kurzer Test." → 200 with the expected path (`…/77c205c9029d….mp3`), fetched `audio/mpeg` 39,168 B, played (2.45 s). The clip was deleted afterwards (204, then 404; no new files in storage).
- [ ] **AI functions**, each called once from its app with a real result (not an error toast):
  Evidence: called from the signed-in app page with `fetch('/api/fn/<name>')` (same request the apps send), not through each app's UI, so nothing was saved.
  - [x] `german-ai` (a writing check in `/german`)
    Evidence: `task:"check"`, "Ich habe gestern ins Kino gegangen." → 200 in 3.5 s, `{"verdict":"Okay","corrected":"Ich bin gestern ins Kino gegangen.","fixes":[{"from":"habe","to":"bin",...`
  - [ ] `german-podcast` (see section 7)
    Evidence: not run: not approved.
  - [x] `german-tts` (play a card's audio in `/german`)
    Evidence: see German audio above (200, clip played, then deleted).
  - [x] `price-estimate` (price estimate in `/recipes` or `/shopping-list`)
    Evidence: carrots 1 kg + 6 eggs → 200 in 10.6 s, `{"items":[{"id":"a","source":"produce","product":"Karotten",...,"buy":2.05,...},{"id":"b","source":"aldi","product":"Eier Bodenhaltung",...`
  - [x] `recipe-import` (import a recipe from a URL in `/recipes`)
    Evidence: link `https://www.bbcgoodfood.com/recipes/easy-pancakes` → 200 in 7.1 s, `{"name":"Easy pancakes","cat":"Breakfast","time":30,"serves":12,"ingredients":[{"name":"","items":["100g Plain flour","2 Large eggs","300ml Milk",...` (not saved).
  - [x] `shopping-list` (generate a list from a recipe)
    Evidence: "Pancakes: 200 g flour, 2 eggs, 300 ml milk" → 200 in 3.2 s, `{"recipes":[{"index":0,"title":"Pancakes"}],"items":[{"recipeIndex":0,"name":"flour","category":"Baking","quantity":200,"unit":"g"...`
  - [x] `shopping-merge` (merge items into an existing list)
    Evidence: list `2 eggs` + added `3 eggs`, `1 l milk` → 200 in 2.6 s, `{"groups":[{"keep":"x1","merge":["n1"],"q":"5"}]}`.
- [ ] **Backups:** `/` lists the daily backups, and restoring one brings back its data (restore a backup, check one value, then restore the newest to undo).
  Evidence: listing works: `/` shows 7 backups (Sat 14 Nov … Sun 8 Nov 2026), `GET /api/backups` → 200 with `backup_date` 2026-11-14 … 2026-11-08. Restore: not run: not approved.
- [x] **Daily snapshot job:** `select user_id, created_at from app_data_backups order by created_at desc limit 5;` shows a row from today (or yesterday, before the job's time of day). The app log shows the job ran once per day.
  Evidence: `b9ef8bfd…|2026-11-14 00:32:35`, `…|2026-11-13 00:32:34`, `…|2026-11-12 00:32:34`, `…|2026-11-11 00:32:34`, `…|2026-11-10 00:32:34` (one row per day; 7 kept). The app log couldn't be checked: the deploy at 11:28 today recreated the container and its log starts then (see F5).
- [ ] **Maps-link resolver:** `curl -s 'https://apps.trplan.si/api/resolve-maps-link?url=https://maps.app.goo.gl/<any short link>'` returns the resolved URL. A non-Google URL is rejected.
  Evidence: partly. Rejections work: `url=https://example.com/x` → 400 `{"error":"Not a Google Maps short link"}`; `url=https://maps.app.goo.gl.evil.com/x` → 400 (same); a made-up short link `https://maps.app.goo.gl/nonexistent123` → 422 `{"error":"Link didn't lead to Google Maps"}` (so it does follow the link). No real short link was at hand to check a successful resolve.
- [x] **Extensionless routes:** `curl -sI https://apps.trplan.si/german` and `/recipes` return 200 with `text/html`; `/nonexistent` returns 404.
  Evidence: `/` 200, `/german` 200, `/recipes` 200, `/shopping-list` 200, all `text/html; charset=utf-8`; `/nonexistent` 404 `text/plain`; `/german.html` 307 → `/german`.
- [ ] **Service workers offline:** for each app with a `*-sw.js` (climbing-tracker, german, marsova-opravila, moped-route, recipes), load it, go offline in DevTools, reload: the app still opens.
  Evidence: not run: the Chrome extension can't switch DevTools to offline. Seen: `/german` and `/recipes` are controlled by a service worker (`navigator.serviceWorker.controller` set), and the caches `german-app-v4`, `recipes-v2`, `marsova-opravila-v2`, `climbing-tracker-v4`, `climbing-photos`, `moped-route-v3` exist.

## 3. Every app opens and saves

In Chrome, signed in, with the console open. For each app: it opens, a change saves and survives a reload, and the console shows no errors.

Evidence for all: each app below was opened in Chrome while signed in; the console had no errors or exceptions on any of them. Where a save wasn't tried, the item stays unticked.

- [ ] climbing-tracker
  Evidence: opens ("Climbing · Plan · Day 1 · Power …", 4 sessions in the last 7 days), no console errors. Save not tried (no change that reverts cleanly without leaving history/plan entries).
- [ ] ekg-trainer
  Evidence: opens (Practice, 12-lead strip), no console errors. Save not tried.
- [ ] german
  Evidence: opens ("Samstag, 14. November · Frei heute · Review 37 cards anyway"), no console errors. Save not tried (a review session would change the spaced-repetition schedule).
- [x] index (`/`)
  Evidence: opens, shows "Signed in as f…@trplan.si", the 7 backups and every app card; no console errors. It has nothing of its own to save.
- [ ] interval-timer
  Evidence: opens (Work 30 s / Rest 15 s / 5 sets, History (1)), no console errors. Save not tried.
- [ ] marsova-opravila
  Evidence: opens ("Živjo, Klara", 193 points available, 546 lifetime), no console errors. Save not tried (see Live Marsova).
- [ ] moped-route
  Evidence: opens (asks for the Google Maps API key), no console errors. Save not tried.
- [ ] pdf-tools
  Evidence: opens (Margin extender, Splitter, …), no console errors. Has no saved data.
- [x] recipes
  Evidence: ticking "Korenje" in Groceries saved (`recipes-lists` updated_at 11:37:35, `checked:true`) and showed after a reload; unticked again. Unticking moves the item to the end of the list, so the original value was put back with `PUT /api/data/recipes/recipes-lists` (byte-identical to the value read before; `recipes_get_list` over MCP shows the original order). No console errors.
- [ ] semester-builder
  Evidence: opens ("Degree Ledger 109/120 ECTS"), no console errors. Save not tried.
- [ ] shopping-list
  Evidence: opens and saves (ticking "onion" → server `{"onion":true}`, still ticked after reloading both tabs; unticked → server `{}` as before), no console errors, **but** the page polls `/api/data/shopping-list/*` in a tight loop (F1) and live sync between tabs fails (F2). Left unticked because of F1.

## 4. Data is complete

Compare against the final Supabase dump taken at cutover (on the NAS, see section 10).

Method: the Supabase project is deleted, so the final export `vps2:~/container-data/ai-apps/supabase-export-20261031/final-20261031T1739Z.sql.gz` was restored into a scratch `postgres:17-alpine` container on vps2 (`--network none`, stub roles anon/authenticated/service_role/migrator, stub `auth` schema with `auth.uid()` and an empty `auth.users`, `extensions` schema with pgcrypto), next to `nightly-20261101T010000Z` (the first nightly after cutover), `pre-deploy-20261114T112604Z` and `nightly-20261114T010000Z`. Expected restore errors only: the `app_data*` → `auth.users` foreign keys (stub table empty), the `migration.auth_users` view, and `role "ai_apps" does not exist` for ownership. The scratch container was removed afterwards (`docker ps -a | grep review-scratch` → 0).

- [x] Row counts per table match the dump, for `app_data`, `app_data_backups` and every `mo_*` table.
  Evidence (supa | nightly 11-01 | pre-deploy 11-14 | live): app_data 26|26|26|26; app_data_backups 6|6|7|7; mo_activity_log 47|47|47|47; mo_admin_pin 1|1|1|1; mo_admin_pin_attempts 1|1|1|1; mo_admin_sessions **4|0|0|0**; mo_categories 3|3|3|3; mo_chores 19|19|19|19; mo_reward_requests 5|5|5|5; mo_rewards 6|6|6|6; mo_settings 1|1|1|1. Backups: the 6 dump rows (2026-10-25…31) match the 11-01 nightly by md5(data) except 10-25, which the 7-day retention dropped when 11-01 was added. Content hashes of all 8 copied `mo_*` tables (md5 over sorted row md5s) are identical in the dump and the 11-01 nightly. `mo_admin_sessions` (4 admin sessions, last expiring 2026-11-13) weren't carried over: see F7.
- [x] Per `(user_id, app_id, key)`, `md5(value::text)` in the new `app_data` matches the dump (`scripts/migrate-from-supabase.mjs` has a check mode; otherwise compare two sorted query outputs).
  Evidence: sorted `user_id app_id key md5(value) updated_at` from the dump and from the 11-01 nightly: `diff` is empty (all 26 rows identical, `updated_at` included). Against live today: same 26 keys (none only on one side); 15 keys unchanged, 11 changed, each with a live `updated_at` after cutover (2026-11-02 … 11-13: climbing history/plan/exercises/routines and the german keys), i.e. normal use. (The migration script is deleted.)
- [x] Storage: file count, total bytes and sha256 per object match between the dump's storage export and `~/container-data/ai-apps/storage/` (buckets `german-audio` and `recipe-photos`).
  Evidence: export 9 files, 78,941,898 B (german-audio 7, recipe-photos 2); all 9 have the same sha256 in live storage. Live has 13 files, 100,012,494 B: the 4 extra are new since cutover (`german-audio/b9ef8bfd…/7fbd69a0….mp3`, `podcast/88c157a6.wav`, `a1707b3b.wav`, `b268a852.wav`, matching episodes from 11-02, 11-04, 11-09).
- [ ] Both users sign in through Pocket ID and land on their own migrated data. In the `users` table both rows have `oidc_sub` set, and their ids are the old Supabase ids (listed in `migration-plan/00-prep.md` Notes, or in the dump's `auth.users`).
  Evidence: `users`: `b9ef8bfd-…|has_sub=t|created 2026-07-04` and `488e26ac-…|has_sub=f|created 2026-09-28`. The owner has signed in (sub set, ids match the dump's `app_data.user_id`); the second user has **never signed in** (`oidc_sub` null). The dump has no `auth.users` rows to compare the ids with. All dumped `app_data` rows belong to `b9ef8bfd…`; the second user has no app data. See F6.

## 5. Security

- [ ] **Isolation:** signed in as user B, `GET`/`PUT /api/data/<app>/<key>` for user A's rows, `GET /api/storage/<bucket>/<user A id>/<file>`, and `POST /api/backups/<date>/restore` for A's backup all return 403 or 404, and A's data is unchanged.
  Evidence: not run as user B (needs a second real user). Signed in as the owner, `GET /api/storage/recipe-photos/<other user id>/x` → 403 `{"error":"Not your file."}`. The data and backup routes take no user id (`/api/data/:app/:key`, `/api/backups/:date/restore`; every query scoped to `req.user`). Covered by server tests: `server/data.test.mjs`, `server/backups.test.mjs`, `server/storage.test.mjs` (green in CI).
- [x] **Path traversal:** `GET /api/storage/recipe-photos/..%2f..%2fetc%2fpasswd`, `.../<own id>/../<other id>/x` and an absolute path all return 400 or 404, never a file.
  Evidence (signed in): `recipe-photos/..%2f..%2fetc%2fpasswd` → 400 "Invalid path."; `<own>/../<other>/x` → 403 "Not your file." (the browser normalises `..`); `<own>/..%2f<other>%2fx` → 400; `%2fetc%2fpasswd` → 400; `//etc/passwd` → 400; `<own>/%2e%2e/%2e%2e/%2e%2e/etc/passwd` → 404; `/api/storage/..%2f..%2f..%2fetc/passwd` → 400 (Cloudflare). Signed out: 401.
- [x] **Marsova admin:** `POST /api/mo/rpc/<an admin function>` without a session token, and with a made-up one, fail. A function not on the allowlist returns 404.
  Evidence: `mo_admin_adjust_points` with `{"p_delta":0}` (no token) → 400 (function with those args doesn't exist); with token `00000000-0000-0000-0000-000000000000` → 401 `{"error":"unauthorized"}`; with token `madeup` → 400 (invalid uuid). `pg_sleep` and `mo_admin_reset_everything` → 404 `{"error":"not_found"}`.
- [x] **`/mcp` rejects:** no `Authorization` header (401 with `WWW-Authenticate` pointing at the resource metadata), an expired token, a token with the wrong `aud`, and a token issued to the `ai-apps` client.
  Evidence: live: `POST /mcp` without a token → 401, `www-authenticate: Bearer resource_metadata="https://apps.trplan.si/.well-known/oauth-protected-resource/mcp"`; the metadata names `https://id.trplan.si`, resource `https://apps.trplan.si/mcp`. A forged RS256 JWT → 401 `error="invalid_token"`. Expired, wrong-`aud` ("another server's token", "no resource asked for") and `client_id: "ai-apps"` tokens are covered by `server/mcp.test.mjs:118` "bad tokens get 401 invalid_token" (green in CI run 43589929874); the checks are `jwtVerify(..., { issuer, audience: resource, typ: "at+jwt" })` and `payload.client_id !== clientId` in `server/mcp.js:66,73`. Not tried live with real Pocket ID tokens.
- [ ] **OIDC callback:** `/auth/callback` with a missing or mismatched `state`, or a replayed `code`, is refused. The code verifies the nonce (show the line).
  Evidence: live: no flow cookie → 400 "This sign-in link has expired"; with a fresh flow cookie and `state=wrong` → 400 "Sign-in failed"; with the flow cookie and no `state` → 400. Nonce: `server/auth.js:184` `expectedNonce: flow.nonce,` (with `expectedState: flow.state` and `pkceCodeVerifier` in `oidc.authorizationCodeGrant`). Replayed code: not tested live (needs a real code); the flow cookie is cleared on the first callback (`server/auth.js:173`), so a replay without it gets the 400 above, but a replay with a copied flow cookie relies on Pocket ID refusing a used code. `server/auth.test.mjs:186` covers wrong state/nonce/verifier.
- [x] **Cookies:** the session cookie has `HttpOnly`, `Secure` and `SameSite=Lax` (or `Strict`).
  Evidence: `server/auth.js:70-72`: over https the cookie is `__Host-session` with `{ httpOnly: true, secure, sameSite: "lax", path: "/" }` (also used for the flow cookie). Live `/auth/login` sets `__Host-auth-flow=…; Max-Age=600; Path=/; …; HttpOnly; Secure; SameSite=Lax`. In Chrome while signed in, `document.cookie` was empty (the session cookie isn't readable from JS). `server/auth.test.mjs:252` covers it.
- [x] **No auth server code:** `git grep -niE 'bcrypt|argon2|password_hash|/oauth/(authorize|token)|registration_endpoint'` finds nothing outside docs.
  Evidence: hits only in `REVIEW.md:95` and `migration-plan/00-prep.md:94,129`, `migration-plan/PLAN.md:97` (docs).
- [x] **Ports:** from the workstation, `timeout 5 bash -c '</dev/tcp/178.105.22.185/5432'` and `.../8090` both fail. On vps2, `docker ps` shows `127.0.0.1:8090->8090` for `app` and no published port for `db`.
  Evidence: 5432 and 8090 both time out (rc 124). `docker ps`: `ai-apps-app-1 127.0.0.1:8090->8090/tcp`, `ai-apps-db-1 5432/tcp` (exposed, not published), `ai-apps-db-dump-1 5432/tcp`.
- [x] **No secrets:** `git log -p | grep -iE 'sk-|sk_or|client_secret|POSTGRES_PASSWORD='` shows no real values; `docker history --no-trunc <app image>` shows no secret values; `docker logs` for `app` (last day) contains no tokens or cookies.
  Evidence: `git log -p --all` gives 27 matching lines, all env var names, empty `.env.example` entries, docs, or test values (`CLIENT_SECRET = "test-secret"`, `POSTGRES_PASSWORD=test`); 0 matches for `sk-or-v1-…`/`sk-proj-…`/`sk-ant-…` keys. `docker history --no-trunc` of the running app image: 0 lines matching secret/password/api_key/token assignments; only `ENV NODE_ENV/NODE_VERSION/YARN_VERSION`. `docker logs --since 24h ai-apps-app-1`: 3 lines ("listening on :8090", two "auth: sign-in failed: OAUTH_INVALID_RESPONSE" from this review's bad-state tests), 0 matches for bearer tokens, JWTs, cookies or keys (the log only covers the time since the 11:28 recreate).

## 6. MCP

- [ ] claude.ai's connector points at `https://apps.trplan.si/mcp`, uses client `ai-apps-mcp`, and connects. Pocket ID has the API `https://apps.trplan.si/mcp`, and `ai-apps-mcp` has user-delegated access to it.
  Evidence: partly. The claude.ai "AI Apps" connector connects and works (this review called 9 of its tools successfully, below). Its URL/client id in claude.ai settings and the Pocket ID API/client settings were not looked at (Pocket ID admin needs a passkey sign-in). The live server only accepts tokens with `aud` = `https://apps.trplan.si/mcp` and `client_id` = `MCP_CLIENT_ID` (default `ai-apps-mcp` in `deploy/compose.yaml`), so a working connector implies both.
- [ ] Every tool in `mcp/apps/*.js` is called once with a valid result. List them with `grep -ho 'registerTool("[a-z_]*"' mcp/apps/*.js` and tick them here.
  Evidence: 28 tools. Called through the claude.ai connector with valid results (read-only): `german_get_overview` (level A2.2, 84 cards, 31 due), `german_get_podcast` (9 episodes), `german_get_writing`, `german_search_cards`, `recipes_get_overview` (4 recipes, 2 lists), `recipes_get_recipe` (cwzpv3f), `recipes_get_list` (Groceries, 8 to get), `climbing_get_history` (42 workouts), `climbing_get_exercise_progress`. Not called (they write the user's data or cost money): `german_update_podcast_interests`, `german_add_cards`, `german_update_card`, `german_delete_cards`, `recipes_save_recipe`, `recipes_add_to_list`, `recipes_update_list`, `recipes_save_list`, `recipes_delete`, `recipes_estimate_price`, `climbing_get_overview` (skipped for size), `climbing_log_workout`, `climbing_update_workout`, `climbing_save_exercise`, `climbing_save_category`, `climbing_save_routine`, `climbing_save_plan`, `climbing_delete`, `climbing_set_bodyweight`. All 28 are exercised by `mcp/*.test.mjs` (green in CI).
- [x] The `updated_at` guard retries: while a tool call is writing, change the same key from the app (or simulate with a `PUT` between the read and write in a test). The tool's write retries and neither change is lost. The test in `mcp/*.test.mjs` covering this passes.
  Evidence: simulated in tests, not live: `server/mcp.test.mjs:211` "mcp/appData retries when the row changes during a tool's update", `:237` "creates a missing row, and gives up after repeated conflicts", and `mcp/climbing.test.mjs:265` "retries a write when the row changed meanwhile" all pass in CI ("App and MCP tests" and "Server tests" green in run 43589929874).

## 7. Long jobs

- [ ] A full podcast episode generates from `/german` without a timeout. Record its duration and the size of its audio file.
  Evidence: not run: not approved. Episodes generated on the new stack exist: `a1707b3b` (2026-11-09, 2 min), `88c157a6` (11-04), `b268a852` (11-02), all `ready` with audio in storage.
- [x] `du -sh ~/container-data/ai-apps/storage/*` on vps2 is recorded here.
  Evidence: `96M german-audio`, `216K recipe-photos` (2026-11-14 11:26 UTC).

## 8. CI/CD

Baseline: `deploy` = `0dda154a0f7b…` before the PR tests and after cleanup; the app container's start time (11:28:10 UTC) and the pre-deploy dumps didn't change during them.

- [x] A PR runs only the checks (tests, bundle check, dbmate check); `deploy` does not move.
  Evidence: draft PR #42 (`review/harmless-pr`, one comment line in `server/README.md`): run 43590599576, job `checks` success (build bundles, app+MCP tests, server tests with migrations up/rollback/up, `db/schema.sql` check), job `promote` skipped. `deploy` stayed `0dda154`.
- [x] A merge to `master` fast-forwards `deploy`, the site is live within a few minutes, `/api/health` shows the new sha, and the workflow job waited for it (its log shows the poll).
  Evidence: the pushes to `master` this morning. Run 43589888644 (`ec87cfa`): `promote` fast-forwarded `deploy` 11:25:15, `deploy/wait-for-sha.sh` polled every 10 s ("live: 6af02c6…" ×9, "live: unreachable" ×2 during the switch, then "11:27:12 live: ec87cfa…"), ~2 min. Run 43589929874 (`0dda154`) likewise; `/api/health` → `{"ok":true,"sha":"0dda154a0f7b251bd6703e0b252299fa94b47b89"}`. Note the 502s while the containers are swapped (F4).
- [x] A failing test (on a throwaway branch/PR) leaves `deploy` untouched, and nothing redeploys.
  Evidence: draft PR #43 (`review/failing-test`, `german/review-fail.test.mjs` asserting 1 = 2): run 43590601846, "App and MCP tests" failed (`not ok 17 - review: deliberately failing test`), later steps skipped, `promote` skipped. `deploy` stayed `0dda154`, app container still started 11:28:10.
- [x] A code-only commit, with `deploy/compose.yaml` unchanged, is still picked up by the Komodo autodeploy procedure (it runs the Action `github autodeploy`, whose code matches `deploy/komodo-autodeploy.ts`).
  Evidence: `0dda154` only changed `.claude/settings.local.json`, and it was deployed (pre-deploy dump `pre-deploy-20261114T112804Z`, app recreated 11:28:09, `/api/health` sha `0dda154…`). `km ls procedures`: `github autodeploy` Ok, schedule `0 * * * * *`, enabled, one stage `RunAction` of the Action `github autodeploy`. The Action's `file_contents` (Komodo API `GetAction`) differs from `deploy/komodo-autodeploy.ts` at `ea6139b` only by one extra trailing blank line.
- [ ] The rollback workflow, given an older sha, redeploys it (`/api/health` shows that sha). Roll forward again afterwards.
  Evidence: not run: not approved. `.github/workflows/rollback.yml` exists.
- [x] `gh api repos/filiptrplan/ai-apps/rulesets` shows the `deploy` ruleset blocking deletion. (Force pushes stay allowed for the rollback workflow: a personal repo can't let GitHub Actions bypass a rule.)
  Evidence: ruleset 26222200 `deploy`, target branch, enforcement active, include `refs/heads/deploy`, rules `["deletion"]`, no bypass actors.
- [x] `.github/workflows/deploy.yml` promotes from `master` and polls `https://apps.trplan.si/api/health`; the Komodo stack's `PUBLIC_URL` is `https://apps.trplan.si`.
  Evidence: `deploy.yml:9-10` `push: branches: [master]`, `:13` `HEALTH_URL: https://apps.trplan.si/api/health`, `:60` promote only for `push` to `refs/heads/master`, `:88` `sh deploy/wait-for-sha.sh "$HEALTH_URL" "$GITHUB_SHA"`. Komodo stack `ai-apps` environment line `PUBLIC_URL=https://apps.trplan.si` (only that line printed); stack repo `filiptrplan/ai-apps`, branch `deploy`, run dir `deploy`, pre-deploy `docker compose run --rm migrate`.
- [x] `gh api users/filiptrplan/packages?package_type=container` lists no `ai-apps` package, and `gh secret list -R filiptrplan/ai-apps` lists no deploy secrets.
  Evidence: `gh api …/packages` → 403 (token lacks `read:packages`), so checked in Chrome: github.com/filiptrplan?tab=packages (signed in) shows "Get started with GitHub Packages", i.e. no packages; `github.com/users/filiptrplan/packages/container/package/ai-apps` → 404. `gh secret list` → empty.

## 9. Ops

- [ ] Komodo shows stack `ai-apps` as `running`. After `km execute restart-stack ai-apps` (with the user's confirmation) it is running again and the data is intact (a known value still reads back).
  Evidence: `km ls stacks -n ai-apps` → `ai-apps running VPS`. Restart: not run: not approved. (Two real deploys today recreated all containers and the data read back: row counts identical in the pre-deploy dump and live.)
- [x] A nightly `pg_dump` exists in `~/container-data/ai-apps/dumps/` from the last 24 hours, and it restores into a scratch `postgres:17-alpine` container (row counts match). Remove the scratch container afterwards.
  Evidence: `nightly-20261114T010000Z.sql.gz` (378,691 B, 01:00 UTC; 14 nightlies kept, 11-01…11-14). Restored into the scratch container with 0 errors besides the missing `ai_apps` role: app_data=26 app_data_backups=7 mo_activity_log=47 mo_chores=19 push_subscriptions=4 schema_migrations=3 users=2, identical to live. Container removed.
- [x] `select version from schema_migrations order by 1;` lists every file in `db/migrations`.
  Evidence: `20261030130000 20261030150000 20261102120000`, matching the 3 files in `db/migrations`.
- [x] A deliberately broken migration on a test branch fails CI (the dbmate check). Delete the branch afterwards.
  Evidence: draft PR #44 (`review/broken-migration`, `db/migrations/20261114120000_review_broken.sql` altering a missing table): run 43590605010, "Server tests (migrations up, rollback, up)" failed with `pq: relation "public.review_table_that_does_not_exist" does not exist (42P01)`, schema check skipped, `promote` skipped. PR closed, branch deleted.
- [x] A pre-deploy dump is written on each deploy (a dump with the deploy's timestamp exists).
  Evidence: today's two deploys each wrote one: `pre-deploy-20261114T112604Z.sql.gz` (`ec87cfa`, deploy moved 11:25:15, live 11:27:12) and `pre-deploy-20261114T112804Z.sql.gz` (`0dda154`, app recreated 11:28:09). Earlier ones: 11-02 09:52, 11-02 23:25, 11-03 09:53, 11-03 10:16 (5 kept).
- [x] After the 03:30 rclone run, the dumps and storage show up on the NAS `backup-vps` share.
  Evidence: `~/backup-script/logs/backup-20261114-033001.log`: `ai-apps/dumps/nightly-20261114T010000Z.sql.gz: Copied (new)` and `nightly-20261031…: Deleted` (sync of `~/container-data` → `nas:backup-vps/container-data`); `backup-cron.log` ends "Backup completed successfully" (daily since at least 11-10). `backup-20261101-033002.log` shows all of `ai-apps/supabase-export-20261031/` (the dump and the 9 storage files) "Copied (new)". Not listed on the NAS side directly.
- [x] Free disk on vps2 (`df -h /`) is recorded here (it was 22 GB free on 2026-10-30).
  Evidence: `/dev/sda1 38G 20G 16G 56% /` (2026-11-14 11:26 UTC): 16 GB free.

## 10. Decommission

- [x] The Cloudflare Worker and its route for apps.trplan.si are deleted; `curl -sI https://apps.trplan.si` comes from the tunnel, not a Worker.
  Evidence: responses come from the Node app through the tunnel: `/api/health` returns the deployed git sha, 404s carry Express's `etag: W/"9-…"` and `text/plain` "Not found", `/german.html` → 307 with `vary: Accept`. `ai-apps.filiptrplan.workers.dev` doesn't answer (curl 000). The Cloudflare dashboard wasn't opened (deletion reported done on 2026-11-14). `apps-next.trplan.si` no longer resolves.
- [x] A final Supabase dump (database and storage) is on the NAS, and its location is recorded here, before the project is deleted.
  Evidence: `vps2:~/container-data/ai-apps/supabase-export-20261031/` (`final-20261031T1739Z.sql.gz` 147,780 B + `storage/`, 9 files 78.9 MB), mirrored to the NAS as `backup-vps/container-data/ai-apps/supabase-export-20261031/` (copied 2026-11-01 03:30, see 9.6). It restores and matches (section 4).
- [x] The Supabase project `zqxvlczqfqmcojbgwogs` is deleted (or paused, if the user chose that).
  Evidence: `getent ahostsv4 zqxvlczqfqmcojbgwogs.supabase.co` → no address; `curl https://zqxvlczqfqmcojbgwogs.supabase.co/rest/v1/` fails to connect (exit 6, could not resolve host).
- [x] `supabase/`, `worker.js`, `wrangler.jsonc` and `migration-plan/` are removed from the repo.
  Evidence: `supabase/`, `worker.js`, `wrangler.jsonc` gone; `migration-plan/` still present (removed after this review, by plan). `migration-plan/` removed in the final stage 07 commit.
- [x] `CLAUDE.md` describes the new setup (server, dbmate, deploys, Pocket ID) and no longer mentions Supabase or the Worker.
  Evidence: `grep -niE 'supabase|worker|wrangler' CLAUDE.md` → only `<name>-sw.js: the service worker…` and `push-sw.js`/"service worker" (not the Cloudflare Worker). It describes `server/`, Pocket ID (`id.trplan.si`), dbmate migrations, CI → `deploy` → Komodo, and that bundles are built, not committed.
- [x] The Homelab note (`~/Obsidian/Claude/Homelab.md`) lists the `ai-apps` stack, its port, the tunnel route and its data folders.
  Evidence: line 35 diagram `ai-apps :8090`; line 59 tunnel route `apps.trplan.si` → vps2 `localhost:8090`; line 98 stack row (`app` `127.0.0.1:8090`, `db`, `db-dump`, `predeploy-dump` + `migrate`), data in `~/container-data/ai-apps/{pg,storage,dumps}`, the Supabase export location, and the `github autodeploy` procedure.
- [x] The `komodo` skill knows about the `ai-apps` stack and its autodeploy procedure.
  Evidence: `~/.claude/skills/komodo/SKILL.md`: stacks table row `ai-apps` (repo `filiptrplan/ai-apps@deploy`, `deploy/compose.yaml`, services, "GitHub Actions fast-forwards `deploy` after green checks"); "Procedure `github autodeploy` (every minute) runs the Action of the same name … (`ai-apps`, `personal-mcp`) … `<STACK>_LAST_ATTEMPTED` … code kept in `deploy/komodo-autodeploy.ts`".

## Findings

(Anything outside the checklist goes here, for the user to decide on.)

**F1. High, fixed in `f01ce80`: `/shopping-list` polled the API in a tight loop.** (`useSyncedStorage` now reads the fallback through a ref; verified: 0 requests in 5 s.) Each open tab sends `GET /api/data/shopping-list/shopping-list-{recipes,extras,checked}` continuously: 204 requests in 5 s in one tab, 126 in 3 s in another (~40/s per tab), for as long as the page is open; the other apps measured 0 requests in 3 s at rest (climbing-tracker, german, recipes, semester-builder). Likely cause: `shopping-list/App.jsx:165-170` passes fresh literals as fallbacks (`[newRecipe()]`, `[]`, `{}`), `shared/syncStorage.js` lists `fallback` in `reconcile`'s dependencies (`[key, fallback, pushRemote]`), and the pull effect depends on `reconcile`, so every render tears down the SSE subscription and pulls again; something on this page re-renders continually (the `result` key, whose fallback is `null`, doesn't loop). Fix: hoist the fallbacks to module constants (as recipes/german do), and/or keep `fallback` in a ref inside `useSyncedStorage` so it isn't an effect dependency. Climbing-tracker also passes `[]`/`{}` literals (`climbing-tracker/App.jsx:93-98`) and would loop the same way if it re-rendered continually.

**F2. High, fixed in `f01ce80`: live sync didn't update a second tab in the same browser (data-loss risk).** (`useSyncedStorage` now applies other tabs' writes from the `storage` event; verified in two tabs, see 2.4.) With two `/recipes` (or `/shopping-list`) tabs, a change in tab A reaches the server and the SSE event reaches tab B, but B's UI never updates until reload. Cause: tabs of one browser share localStorage. Tab A writes `<key>::synced-at` = the new `updated_at`; B's `onChange` (`shared/syncStorage.js`) sees `localStorage.getItem(markerKey(key)) === change.updated_at` and returns without pulling, and nothing listens for `storage` events to refresh B's React state. B then holds a stale value; its next edit pushes stale-value-plus-edit and silently overwrites A's change (B's `::synced-value` was also updated by A, so no conflict is raised). Across devices it works (different localStorage). Fix: keep the last-synced marker per tab (in a ref) rather than only in localStorage, or add a `storage` event listener that applies changes other tabs wrote to `key`; add a test with two hook instances sharing one localStorage. Probably predates the migration (the marker logic dates from July), but REVIEW.md 2.4 fails on it.

**F3. Medium, fixed in `3a0ad79` (untracked and gitignored): `.claude/settings.local.json` was committed** (`0dda154` "chore: capture remaining local changes", added automatically). It's a per-machine permissions file (git/pnpm commands, a leftover `mcp__claude_ai_Supabase__execute_sql` allow, which also makes item 1.1 match). No secrets in it. Fix: `git rm --cached .claude/settings.local.json` and add it to `.gitignore` (left alone here: told not to touch `.claude/`).

**F4. Low: each deploy has ~20–40 s of 502s.** During `ec87cfa`'s deploy the poll saw "live: unreachable" (502) from ~11:26:51 to 11:27:12, and `curl /api/health` returned `error code: 502` while the stack swapped containers. This deploy also recreated `db` and `db-dump` (created 11:26:49), not only `app`. Fine for a personal site; if it matters, build the image before stopping the old app (e.g. `docker compose build app` in the pre-deploy step) and check why `db` was recreated (image or config change).

**F5. Low: app logs don't survive a deploy.** The app container is recreated on every deploy, so `docker logs` only covers the time since the last deploy (today: since 11:28). The "job ran once per day" log check and "last day of logs" checks can't be done after a deploy. Fix if wanted: a persistent logging driver/volume, or log the backup job to the database (the `app_data_backups` rows already show one run per day).

**F6. Medium (or accepted): the second user never signed in.** `users` row `488e26ac-…` has `oidc_sub` null; she has no `app_data` rows (all dumped rows are the owner's) and only uses Marsova opravila, which needs no sign-in. Item 4.4 can't pass until she signs in once through Pocket ID (her Pocket ID account must use the same email as the `users` row). Decide whether she needs an account at all.

**F7. Low: Marsova admin sessions weren't migrated.** The final dump had 4 `mo_admin_sessions` (last expiry 2026-11-13); the new DB had 0 from the first nightly on. Effect: admins had to enter the PIN again after cutover; all are expired by now anyway. Nothing to fix unless it was meant to be copied.

**F8. Low: CI doesn't run the climbing-tracker tests.** `package.json` `npm test` runs `climbing-tracker/*.test.mjs`, but `.github/workflows/deploy.yml` "App and MCP tests" runs only `mcp/ german/ moped-route/`. They pass locally (9/9). Fix: add `climbing-tracker/*.test.mjs` to the workflow (needs a push with `workflow` scope).

**F9. Info: Komodo Action vs repo file.** The `github autodeploy` Action in Komodo matches `deploy/komodo-autodeploy.ts` except for one extra trailing blank line. The user's change to this file was committed as `ea6139b` ("feat(deploy): autodeploy multiple stacks") rather than left in the working tree, so the tree was clean at the start of the review.

**F10. Info: older backup-cron errors.** `~/backup-script/logs/backup-cron.log` has many "ERROR: One or more rclone sync operations failed (exit code 6)" and "Missing or invalid sources.openclaw_repo" lines from earlier runs; every run since at least 2026-11-10 ends "Backup completed successfully".

**F11. Medium: browsers keep app bundles for up to 4 hours after a deploy.** The server sends `Cache-Control: public, max-age=0, must-revalidate` for static files, but through Cloudflare the browser gets `max-age=14400` (the zone's Browser Cache TTL overrides it). After the F1/F2 deploy, Chrome kept running the old `shopping-list-app.js` from its HTTP cache (old ETag `W/"7e84-…"`, while the origin served `W/"80f3-…"`). So fixes reach users up to 4 h late, and a page can pair new HTML with an old bundle. Fix (a Cloudflare change, for the user to confirm): set Browser Cache TTL to "Respect existing headers", or add a Cache Rule for `apps.trplan.si` that does so.

**Accepted exceptions**
- Supabase mentions in comments of `db/migrations/20261030130000_baseline.sql` and `20261030150000_change_notifications.sql`: migrations already on `master`, never to be edited.
- `migration-plan/` still exists during this review; it is deleted afterwards (items 1.4 and 10.4 tick then).
- `scripts/migrate-from-supabase.mjs` is deleted, so section 4 used a restore of the final dump instead of its check mode.
- App bundles are no longer committed; 1.3 checked the served bundles.

**State changes made by this review (all reverted)**
- GitHub: branches `review/harmless-pr`, `review/failing-test`, `review/broken-migration` and draft PRs #42, #43, #44 (closed unmerged, remote and local branches and worktrees deleted). `deploy` was `0dda154` before and after; nothing redeployed.
- `/shopping-list`: ticked then unticked "onion" (`shopping-list-checked` back to `{}`).
- `/recipes`: ticked then unticked "Korenje", then put the original `recipes-lists` value back with `PUT /api/data/recipes/recipes-lists` (byte-identical; unticking had moved the item to the end of the list). `updated_at` is now 2026-11-14.
- Storage: one TTS clip (`german-audio/<owner>/77c205c9….mp3`) and one test photo (`recipe-photos/<owner>/review-test-1794656420141.webp`) created and deleted; storage holds the same 13 files as before.
- AI calls: one each of german-ai, german-tts, price-estimate, recipe-import, shopping-list, shopping-merge (nothing saved).
- vps2: scratch container `review-scratch-pg` (restores of the Supabase dump and three nightlies) created and removed; temporary scripts in `/tmp` removed.
- Signed out of apps.trplan.si in Chrome for the sign-out test; signing back in needs the owner's passkey, so **the owner is currently signed out there**.
