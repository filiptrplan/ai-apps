# Post-migration review: Supabase + Cloudflare Workers → vps2

A checklist that a separate agent works through after the migration (`migration-plan/`, stage 07). It confirms that apps.trplan.si runs entirely on vps2 and that nothing from Supabase or the Worker is left.

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

## 1. No Supabase left

- [ ] `git grep -niE 'supabase|zqxvlczq|sb_publishable|Deno\.|EdgeRuntime|wrangler' -- ':!REVIEW.md' ':!scripts/migrate-from-supabase.mjs'` prints nothing.
- [ ] `grep -n '@supabase' package.json pnpm-lock.yaml` prints nothing.
- [ ] `git grep -l 'supabase.co' -- '*-app.js'` prints nothing (no committed bundle talks to Supabase).
- [ ] `ls supabase worker.js wrangler.jsonc .assetsignore migration-plan 2>&1` reports each as missing.
- [ ] Every page loads without a request to `*.supabase.co` (Chrome network log on `/`, `/german`, `/recipes`).

## 2. Feature parity

One check per Supabase feature that was replaced. Run them in Chrome on the production site, signed in as the owner unless stated.

- [ ] **Sign-in:** `/` → Sign in → Pocket ID passkey → back on the site, signed in. `GET /api/auth/session` returns the user.
- [ ] **Sign-out:** Sign out clears the session; `GET /api/auth/session` returns no user, and `GET /api/data/german/settings` returns 401.
- [ ] **Allowed group:** a Pocket ID user outside the allowed group (create a throwaway one, with the user's confirmation, and delete it afterwards) is refused by Pocket ID or by `/auth/callback`, and no row is created for them.
- [ ] **Sync:** open `/shopping-list` in two tabs. A change in tab A shows up in tab B within a few seconds, without reloading.
- [ ] **Conflict prompt:** take tab B offline (DevTools → Network → Offline), edit the same list in both tabs, bring B back online. B shows the keep-local / keep-remote prompt, and both choices work.
- [ ] **Live German episodes:** start a podcast episode in `/german`; its status updates in a second tab without reloading.
- [ ] **Live Marsova:** a chore ticked in one `/marsova-opravila` tab appears in another tab without reloading.
- [ ] **Recipe photos:** add a photo to a recipe, reload, it shows; delete it, and the file is gone from `~/container-data/ai-apps/storage/recipe-photos/<user id>/`.
- [ ] **German audio:** an existing episode's audio plays; a new TTS clip plays.
- [ ] **AI functions**, each called once from its app with a real result (not an error toast):
  - [ ] `german-ai` (a writing check in `/german`)
  - [ ] `german-podcast` (see section 7)
  - [ ] `german-tts` (play a card's audio in `/german`)
  - [ ] `price-estimate` (price estimate in `/recipes` or `/shopping-list`)
  - [ ] `recipe-import` (import a recipe from a URL in `/recipes`)
  - [ ] `shopping-list` (generate a list from a recipe)
  - [ ] `shopping-merge` (merge items into an existing list)
- [ ] **Backups:** `/` lists the daily backups, and restoring one brings back its data (restore a backup, check one value, then restore the newest to undo).
- [ ] **Daily snapshot job:** `select user_id, created_at from app_data_backups order by created_at desc limit 5;` shows a row from today (or yesterday, before the job's time of day). The app log shows the job ran once per day.
- [ ] **Maps-link resolver:** `curl -s 'https://apps.trplan.si/api/resolve-maps-link?url=https://maps.app.goo.gl/<any short link>'` returns the resolved URL. A non-Google URL is rejected.
- [ ] **Extensionless routes:** `curl -sI https://apps.trplan.si/german` and `/recipes` return 200 with `text/html`; `/nonexistent` returns 404.
- [ ] **Service workers offline:** for each app with a `*-sw.js` (climbing-tracker, german, marsova-opravila, moped-route, recipes), load it, go offline in DevTools, reload: the app still opens.

## 3. Every app opens and saves

In Chrome, signed in, with the console open. For each app: it opens, a change saves and survives a reload, and the console shows no errors.

- [ ] climbing-tracker
- [ ] ekg-trainer
- [ ] german
- [ ] index (`/`)
- [ ] interval-timer
- [ ] marsova-opravila
- [ ] moped-route
- [ ] pdf-tools
- [ ] recipes
- [ ] semester-builder
- [ ] shopping-list

## 4. Data is complete

Compare against the final Supabase dump taken at cutover (on the NAS, see section 10).

- [ ] Row counts per table match the dump, for `app_data`, `app_data_backups` and every `mo_*` table.
- [ ] Per `(user_id, app_id, key)`, `md5(value::text)` in the new `app_data` matches the dump (`scripts/migrate-from-supabase.mjs` has a check mode; otherwise compare two sorted query outputs).
- [ ] Storage: file count, total bytes and sha256 per object match between the dump's storage export and `~/container-data/ai-apps/storage/` (buckets `german-audio` and `recipe-photos`).
- [ ] Both users sign in through Pocket ID and land on their own migrated data. In the `users` table both rows have `oidc_sub` set, and their ids are the old Supabase ids (listed in `migration-plan/00-prep.md` Notes, or in the dump's `auth.users`).

## 5. Security

- [ ] **Isolation:** signed in as user B, `GET`/`PUT /api/data/<app>/<key>` for user A's rows, `GET /api/storage/<bucket>/<user A id>/<file>`, and `POST /api/backups/<date>/restore` for A's backup all return 403 or 404, and A's data is unchanged.
- [ ] **Path traversal:** `GET /api/storage/recipe-photos/..%2f..%2fetc%2fpasswd`, `.../<own id>/../<other id>/x` and an absolute path all return 400 or 404, never a file.
- [ ] **Marsova admin:** `POST /api/mo/rpc/<an admin function>` without a session token, and with a made-up one, fail. A function not on the allowlist returns 404.
- [ ] **`/mcp` rejects:** no `Authorization` header (401 with `WWW-Authenticate` pointing at the resource metadata), an expired token, a token with the wrong `aud`, and a token issued to the `ai-apps` client.
- [ ] **OIDC callback:** `/auth/callback` with a missing or mismatched `state`, or a replayed `code`, is refused. The code verifies the nonce (show the line).
- [ ] **Cookies:** the session cookie has `HttpOnly`, `Secure` and `SameSite=Lax` (or `Strict`).
- [ ] **No auth server code:** `git grep -niE 'bcrypt|argon2|password_hash|/oauth/(authorize|token)|registration_endpoint'` finds nothing outside docs.
- [ ] **Ports:** from the workstation, `timeout 5 bash -c '</dev/tcp/178.105.22.185/5432'` and `.../8090` both fail. On vps2, `docker ps` shows `127.0.0.1:8090->8090` for `app` and no published port for `db`.
- [ ] **No secrets:** `git log -p | grep -iE 'sk-|sk_or|client_secret|POSTGRES_PASSWORD='` shows no real values; `docker history --no-trunc <app image>` shows no secret values; `docker logs` for `app` (last day) contains no tokens or cookies.

## 6. MCP

- [ ] claude.ai's connector points at `https://apps.trplan.si/mcp`, uses client `ai-apps-mcp`, and connects.
- [ ] Every tool in `mcp/apps/*.js` is called once with a valid result. List them with `grep -ho 'registerTool("[a-z_]*"' mcp/apps/*.js` and tick them here.
- [ ] The `updated_at` guard retries: while a tool call is writing, change the same key from the app (or simulate with a `PUT` between the read and write in a test). The tool's write retries and neither change is lost. The test in `mcp/*.test.mjs` covering this passes.

## 7. Long jobs

- [ ] A full podcast episode generates from `/german` without a timeout. Record its duration and the size of its audio file.
- [ ] `du -sh ~/container-data/ai-apps/storage/*` on vps2 is recorded here.

## 8. CI/CD

- [ ] A PR runs only the checks (tests, bundle check, dbmate check); `deploy` does not move.
- [ ] A merge to `master` fast-forwards `deploy`, the site is live within a few minutes, `/api/health` shows the new sha, and the workflow job waited for it (its log shows the poll).
- [ ] A failing test (on a throwaway branch/PR) leaves `deploy` untouched, and nothing redeploys.
- [ ] A code-only commit, with `deploy/compose.yaml` unchanged, is still picked up by the Komodo autodeploy procedure.
- [ ] The rollback workflow, given an older sha, redeploys it (`/api/health` shows that sha). Roll forward again afterwards.
- [ ] `gh api repos/filiptrplan/ai-apps/rulesets` shows the `deploy` ruleset blocking deletion and non-fast-forward pushes.
- [ ] `gh api users/filiptrplan/packages?package_type=container` lists no `ai-apps` package, and `gh secret list -R filiptrplan/ai-apps` lists no deploy secrets.

## 9. Ops

- [ ] Komodo shows stack `ai-apps` as `running`. After `km execute restart-stack ai-apps` (with the user's confirmation) it is running again and the data is intact (a known value still reads back).
- [ ] A nightly `pg_dump` exists in `~/container-data/ai-apps/dumps/` from the last 24 hours, and it restores into a scratch `postgres:17-alpine` container (row counts match). Remove the scratch container afterwards.
- [ ] `select version from schema_migrations order by 1;` lists every file in `db/migrations`.
- [ ] A deliberately broken migration on a test branch fails CI (the dbmate check). Delete the branch afterwards.
- [ ] A pre-deploy dump is written on each deploy (a dump with the deploy's timestamp exists).
- [ ] After the 03:30 rclone run, the dumps and storage show up on the NAS `backup-vps` share.
- [ ] Free disk on vps2 (`df -h /`) is recorded here (it was 22 GB free on 2026-10-30).

## 10. Decommission

- [ ] The Cloudflare Worker and its route for apps.trplan.si are deleted; `curl -sI https://apps.trplan.si` comes from the tunnel, not a Worker.
- [ ] A final Supabase dump (database and storage) is on the NAS, and its location is recorded here, before the project is deleted.
- [ ] The Supabase project `zqxvlczqfqmcojbgwogs` is deleted (or paused, if the user chose that).
- [ ] `supabase/`, `worker.js`, `wrangler.jsonc` and `migration-plan/` are removed from the repo.
- [ ] `CLAUDE.md` describes the new setup (server, dbmate, deploys, Pocket ID) and no longer mentions Supabase or the Worker.
- [ ] The Homelab note (`~/Obsidian/Claude/Homelab.md`) lists the `ai-apps` stack, its port, the tunnel route and its data folders.
- [ ] The `komodo` skill knows about the `ai-apps` stack and its autodeploy procedure.

## Findings

(Anything outside the checklist goes here, for the user to decide on.)
