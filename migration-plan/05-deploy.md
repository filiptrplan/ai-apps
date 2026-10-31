# Stage 05: Ship it

## Goal

Everything needed to run and deploy the app on vps2: image, compose stack, Komodo stack and autodeploy procedure, GitHub workflows, and a staging hostname to test on.

## Depends on

Stages 01–04 merged on the `migration` branch.

## Deliverables

- [x] `Dockerfile` (`node:22-alpine`, `npm ci --omit=dev`, `GIT_SHA` build arg, runs `server/index.js`) and `.dockerignore`.
- [x] `deploy/compose.yaml` with these services:
  - `db`: `postgres:17-alpine`, internal network only, data in `~/container-data/ai-apps/pg`, healthcheck.
  - `migrate`: one-shot. First `pg_dump` to `dumps/pre-deploy-<timestamp>.sql.gz` (keeping the last 5), then `dbmate --wait up` (image `ghcr.io/amacneil/dbmate`, mounts `db/`).
  - `app`: `build: ..`, `127.0.0.1:8090`, `/data/storage` volume, `depends_on: migrate (service_completed_successfully)`.
  - `db-dump`: nightly `pg_dump` into `dumps/`, keeping 14.
- [x] `GET /api/health` returns the sha baked into the image.
- [x] `.github/workflows/deploy.yml` (see Design notes).
- [x] `.github/workflows/rollback.yml`.
- [x] GitHub ruleset on `deploy`: no deletion. (No non-fast-forward rule: see Notes.)
- [x] Komodo stack `ai-apps` on server `VPS`, linked repo `filiptrplan/ai-apps`, branch `deploy`, `deploy/compose.yaml`.
- [x] Komodo procedure `ai-apps autodeploy`, scheduled every minute. `DeployStackIfChanged` did **not** notice a code-only change, so it runs the Action `ai-apps autodeploy` instead (see Notes).
- [x] Stack secrets set via a scratchpad script the user runs: `POSTGRES_PASSWORD`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, model overrides, `PUBLIC_URL`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, and `MCP_CLIENT_ID` only if it isn't `ai-apps-mcp` (the default).
- [x] Staging: tunnel route `apps-next.trplan.si` → `http://localhost:8090` on the VPS tunnel (and its Pocket ID callback URL, from stage 00).
- [x] `CLAUDE.md` build/test section updated for the new CI checks (full rewrite is stage 07).
- [x] Homelab note updated with the new stack (vps2 table, tunnel hostnames, backups).

## Files touched

New: `Dockerfile`, `.dockerignore`, `deploy/compose.yaml`, `.github/workflows/*.yml`. Outside the repo, with the user's confirmation each time: Komodo (stack, procedure), Cloudflare (tunnel route), GitHub (ruleset), the Homelab note.

## Design notes

### `deploy.yml`

- **On a PR or a push:** `pnpm install --frozen-lockfile` → `node --test …` → `npm run build`. Fail if the committed bundles differ from a fresh build (`git diff --exit-code '*-app.js'`). A `postgres:17` service container runs `dbmate up`, then `down` and `up` again on the newest migration, then `dbmate dump` and `git diff --exit-code db/schema.sql`, then the server tests.
- **On a push to `master`, after the checks pass: promote to `deploy`.**
  1. `permissions: contents: write` and `concurrency: deploy` so runs don't overlap.
  2. `git push origin HEAD:refs/heads/deploy` (fast-forward, no `-f`). If a newer run already moved `deploy` further ahead, the push is rejected and the step treats that as "nothing to do", so an older commit can never overwrite a newer one.
  3. Poll `https://apps.trplan.si/api/health` every 10 s for up to 10 minutes until the response contains `github.sha`; otherwise the job goes red.
- Only `GITHUB_TOKEN` is used. No Tailscale, no Komodo key, nothing new exposed to the internet.
- During staging, the health poll targets `apps-next.trplan.si`, or the promote step is gated until cutover (decide in this stage; before cutover, `master` still deploys to Cloudflare, so don't let the workflow move `deploy` from `master` on the old code). Simplest: the `migration` branch workflow promotes to `deploy`, and the trigger switches to `master` at cutover.

### `rollback.yml`

`workflow_dispatch` with a sha input; force-pushes that sha to `deploy`; Komodo redeploys within a minute. Migrations only roll forward, so a rollback across a migration must stay compatible with the newer schema (noted in `CLAUDE.md`).

### Komodo

- Create the stack and procedure through the Komodo API (`km` can't create resources): see the `komodo` skill. Confirm with the user first.
- Komodo needs read access to the repo: the same git account that `chore-bot` and `study-spaces` use.
- **Check that `DeployStackIfChanged` notices a code-only change**, meaning a new commit hash with the compose file unchanged. Test with a throwaway commit to `deploy`.
  - If it only compares compose contents, use a small Komodo **Action** instead: it compares the stack's latest and deployed commit hashes and calls `DeployStack` when they differ.
  - Komodo's own "poll for updates" on the stack is the third choice, after checking the global `KOMODO_RESOURCE_POLL_INTERVAL`.
- Optional: a Komodo alerter (e.g. ntfy) for failed deploys.
- Build args: if Komodo can't pass `GIT_SHA`, the app reads the sha from the clone's `.git` instead; make the Dockerfile cope with either.

### Operations

- Building on vps2 adds a short CPU spike per deploy; the image is small.
- Docker image pruning: add `prune-images` to the nightly Komodo routine so the 38 GB disk doesn't fill.
- Backups: `~/container-data/ai-apps/{pg,storage,dumps}` is already under the 03:30 rclone mirror. A running Postgres data folder may copy inconsistently, so the `dumps/` folder is the reliable backup. Say so in the Homelab note.
- Firewall: the app binds `127.0.0.1:8090` only, and `db` publishes no port. Probe `178.105.22.185:8090` and `:5432` from outside afterwards.

## Done when

- A PR runs only the checks; a failing test leaves `deploy` untouched.
- A merge fast-forwards `deploy`; Komodo redeploys within a few minutes; `https://apps-next.trplan.si/api/health` reports the new sha; the job waits for it.
- A code-only commit (compose unchanged) triggers a redeploy.
- A deliberately broken migration on a test branch fails CI, and a broken migration on `deploy` leaves the old app running.
- The rollback workflow redeploys an older sha.
- A pre-deploy dump appears on each deploy, and the nightly dump exists and restores into a scratch Postgres container.
- `restart-stack` keeps data intact.
- Port probes show 8090 and 5432 closed from the internet.
- Sign-in with Pocket ID works on staging.
- Deferred from stage 04: claude.ai connects to `https://apps-next.trplan.si/mcp` with the `ai-apps-mcp` client (add the staging host's callback to that client in Pocket ID first, with the user's OK); the OAuth flow completes; `german_get_overview`, `recipes_save_list` and `climbing_log_workout` work and the changes show up in the open apps.
- Deferred from stage 03, if not done locally by then: the OpenRouter functions (podcast, recipe import, price estimate, shopping list and merge) called once each on staging with the real keys.

## REVIEW.md sections

8, 9, 5 (port exposure, secrets in image layers and logs).

## Notes

### Evidence so far (2026-10-30)

- **Image:** `docker build --build-context git=.git .` locally: 254 MB, runs as `node` (uid 1000), `.git-sha` = HEAD. On vps2 Komodo builds it in the clone (no build args), and `/api/health` reports the full sha.
- **Compose, locally** (scratch `DATA_DIR`, `APP_PORT=8091`): `compose run --rm migrate` → pre-deploy dump, both migrations; `up -d --build` → app healthy, `/german` 200, `db` publishes no port. A broken migration (`select from nonexistent_table`): `run migrate` exits 2 and the app container id is unchanged, still serving. The newest pre-deploy dump restores into a scratch `postgres:17-alpine` (`create role ai_apps`, `gunzip | psql -v ON_ERROR_STOP=1` exit 0) with the inserted row and 2 `schema_migrations`. `dump.sh daily <next minute>` wrote `nightly-*.sql.gz` on time.
- **CI:** run 41093251374 green (tests, server tests with up/rollback/up, bundle check, schema check); promote pushed `deploy` = `56ff00c`, polled through the 502s and passed at 16:50:52 when staging reported it.
- **First deploy** (`km x deploy-stack ai-apps`, 62 s): clone of `deploy`, `.env` written to `deploy/`, pre-deploy ran in `deploy/` (dump + migrations), build, up. `https://apps-next.trplan.si/api/health` → `{"ok":true,"sha":"56ff00c…"}`; `schema_migrations` lists both files; `~/container-data/ai-apps/pg` owned by filip.
- **Code-only change:** after `deploy` moved to `7b93993`, Komodo's stack info had `latest_hash 7b93993`, `deployed_hash 56ff00c`, and the every-minute `DeployStackIfChanged` ran several times without deploying (it compares compose contents only). The Action (`deploy/komodo-autodeploy.ts`) deployed `7b93993` on its first run (log: `deploying 7b93993 (deployed: 56ff00c)`); a second run was a no-op in 1.9 s.
- **Ports:** from the workstation, `178.105.22.185:8090` and `:5432` closed. `docker ps`: `app` on `127.0.0.1:8090`, `db` unpublished.
- vps2 disk after the first build: 21 GB free of 38.

### Decisions and findings

- **Two-step deploy.** `docker compose up` removes the old app container *before* it waits on `migrate` (`service_completed_successfully`), so a failed migration left no app running at all (seen locally). `predeploy-dump` and `migrate` are therefore in a `migrate` profile that `up` skips, and the stack's pre-deploy command runs `docker compose run --rm migrate` (path empty = the run directory, `deploy/`); if it fails, Komodo stops before `up`.
- **Dumps use `postgres:17-alpine`**, not the dbmate image (its `pg_dump` is 18, whose dumps a 17 `psql` may not read), so the plan's single `migrate` service became `predeploy-dump` + `migrate`.
- **Everything runs as uid 1000** (`db`, dumps, `app` as `node`), so the 03:30 rclone backup (user filip) can read `pg/`; a root/uid-70 Postgres folder would give rclone IO errors, and `rclone sync` then skips its deletions for the whole run.
- **Separate `git` build context:** `.git` stays out of the main context (and the image); only the `sha` stage reads it. `COPY --exclude` isn't available on the local BuildKit.
- **Autodeploy Action** instead of `DeployStackIfChanged`: refreshes the stack cache, deploys when `latest_hash` ≠ `deployed_hash`, and records the hash in the Komodo variable `AI_APPS_LAST_ATTEMPTED` first, so a failing commit is tried once rather than rebuilt every minute. A new commit (or a rollback) is a new hash and deploys.
- **Ruleset without non-fast-forward:** a personal repo can't name GitHub Actions as a bypass actor ("must be part of the ruleset source or owner organization"), so blocking force pushes would block the rollback workflow too. Only deletion is blocked; the promote step only fast-forwards by construction.
- **No `package-lock.json`:** the image and CI install with pnpm 9 from `pnpm-lock.yaml`; the stale npm lockfile is gone. `pdf-tools-app.js` was rebuilt with pnpm (only `node_modules` path comments changed), so every bundle now matches a fresh build.
- **Staging user:** the owner's row (`b9ef8bfd-…`, `filip@trplan.si`) was inserted by hand into staging's `users` for the sign-in and MCP checks. Stage 06's script must cope with the row already existing.
- `APP_PORT` (default 8090) only exists to test the stack next to the dev server.
- `Global Auto Update` (03:00) now also runs `PruneImages` on VPS.
- vps2 dropped off the tailnet during this stage ("Logged out" in `tailscale status`, cause unknown without the journal); the user logged it back in. Komodo's UI was unreachable meanwhile, while SSH and the API over the public IP worked.

### Still to check

- [x] The scheduled procedure (not a manual run) deploys a code-only commit, and CI's wait passes: docs commit `e0ec5bf`, run 41095089090. CI moved `deploy` 7b93993..e0ec5bf at about 17:01:45 UTC+1; the poll saw `7b93993` three times, then `e0ec5bf` at 17:02:21; the whole run took 1m13s.
- [x] A PR runs only the checks; a failing test leaves `deploy` untouched: PR #38 (run 41204808878), `checks` failed at "App and MCP tests", `promote` skipped, `deploy` stayed at `03959b2`.
- [x] A broken migration on a test branch fails CI: PR #39 (run 41204811520) failed at "Server tests (migrations up, rollback, up)". Both PRs closed, branches deleted.
- [x] A broken migration on `deploy` leaves the old app running on vps2: pushed `c4b0ddc` (a broken migration on top of `03959b2`) to `deploy` at 14:01:30 UTC. The Action deployed it once at 14:02:01: the pre-deploy dump ran, then dbmate failed (`relation "nonexistent_table" does not exist`), and the app stayed up and healthy on `03959b2`. At 14:03 the Action skipped it (already attempted).
- [ ] (Moved to stage 06.) The rollback workflow redeploys an older sha, then forward again. GitHub only dispatches workflows that exist on the default branch, so `rollback.yml` can't run before the merge to `master` (stage 06). Done by hand instead with the workflow's steps: force-pushed `deploy` from the broken `c4b0ddc` to `7b93993` at 14:05:45 UTC, live at 14:06:15. Forward again through CI: pushing `d438bfd` to `migration` fast-forwarded `deploy` (run 41208579858, both jobs green), live at 14:07:22. One poll in between got `unreachable`: a redeploy has a few seconds of downtime while the app container is recreated.
- [x] The first nightly dump (01:00 UTC) exists and restores into a scratch container: `nightly-20261031T010000Z.sql.gz` restored with `ON_ERROR_STOP` into a throwaway `postgres:17-alpine` on vps2 (role `ai_apps` created first): 14 tables, the users row, 2 migrations.
- [x] `restart-stack` keeps data intact: RestartStack at 14:02:40 UTC, all containers restarted, the users row (`b9ef8bfd…`) and the dumps still there, health back on `03959b2`. `docker compose restart` also restarts the exited `predeploy-dump` container, so a restart makes one extra pre-deploy dump (harmless, 5 kept).
- [x] Sign-in with Pocket ID works on staging (user check, 2026-10-31; their row's `oidc_sub` got linked).
- [x] claude.ai connects to `https://apps-next.trplan.si/mcp` with `ai-apps-mcp`; `german_get_overview`, `recipes_save_list`, `climbing_log_workout` work. It first failed: claude.ai sends `resource=<PUBLIC_URL>/mcp` (RFC 8707), which Pocket ID refuses (`invalid_request`) unless that URL is set up as an API the client may use, and the token's `aud` is then that URL. The user added the API in Pocket ID; `/mcp` now checks `aud` against its own URL (`5b85c7f`). Checked from Claude Code on 2026-10-31: the three overviews, `recipes_save_list`, `recipes_add_to_list`, `climbing_save_exercise`, `climbing_log_workout`, and `recipes_estimate_price` (an OpenRouter call).
- [x] The OpenRouter functions, once each on staging (user check, 2026-10-31; `recipes_estimate_price` over MCP too).
- [x] Homelab note updated.

### Komodo Core ran out of processes (2026-10-31)

The push of `03959b2` didn't deploy: from about 09:55 UTC every Action run failed with `Os { code: 11, kind: WouldBlock }`. Komodo Core runs as PID 1 in its container without an init, so the `git` processes it spawns were never reaped: 4,533 zombies, about 6 an hour from the other stacks' polling since 18 Oct and about 130 an hour from this Action's per-minute `RefreshStackCache`. Fixed with `init: true` on `core` in `~/komodo/mongo.compose.yaml` on vps2 (backup `mongo.compose.yaml.bak-2026-10-31`) and recreating Core (same image). Zombies dropped to periphery's handful, and the next run deployed `03959b2` at 14:01:18. The failed promote run (41204788623) was correct: it reported that the commit never went live.
