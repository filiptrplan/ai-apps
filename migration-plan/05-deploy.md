# Stage 05: Ship it

## Goal

Everything needed to run and deploy the app on vps2: image, compose stack, Komodo stack and autodeploy procedure, GitHub workflows, and a staging hostname to test on.

## Depends on

Stages 01–04 merged on the `migration` branch.

## Deliverables

- [ ] `Dockerfile` (`node:22-alpine`, `npm ci --omit=dev`, `GIT_SHA` build arg, runs `server/index.js`) and `.dockerignore`.
- [ ] `deploy/compose.yaml` with these services:
  - `db`: `postgres:17-alpine`, internal network only, data in `~/container-data/ai-apps/pg`, healthcheck.
  - `migrate`: one-shot. First `pg_dump` to `dumps/pre-deploy-<timestamp>.sql.gz` (keeping the last 5), then `dbmate --wait up` (image `ghcr.io/amacneil/dbmate`, mounts `db/`).
  - `app`: `build: ..`, `127.0.0.1:8090`, `/data/storage` volume, `depends_on: migrate (service_completed_successfully)`.
  - `db-dump`: nightly `pg_dump` into `dumps/`, keeping 14.
- [ ] `GET /api/health` returns the sha baked into the image.
- [ ] `.github/workflows/deploy.yml` (see Design notes).
- [ ] `.github/workflows/rollback.yml`.
- [ ] GitHub ruleset on `deploy`: no deletion, no non-fast-forward pushes (the rollback workflow's actor is the exception).
- [ ] Komodo stack `ai-apps` on server `VPS`, linked repo `filiptrplan/ai-apps`, branch `deploy`, `deploy/compose.yaml`.
- [ ] Komodo procedure `ai-apps autodeploy`, scheduled every minute, running `DeployStackIfChanged ai-apps`. **Verified** to notice a code-only change (see Design notes).
- [ ] Stack secrets set via a scratchpad script the user runs: `POSTGRES_PASSWORD`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, model overrides, `PUBLIC_URL`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `MCP_OIDC_CLIENT_ID`.
- [ ] Staging: tunnel route `apps-next.trplan.si` → `http://localhost:8090` on the VPS tunnel (and its Pocket ID callback URL, from stage 00).
- [ ] `CLAUDE.md` build/test section updated for the new CI checks (full rewrite is stage 07).
- [ ] Homelab note updated with the new stack (vps2 table, tunnel hostnames, backups).

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

## REVIEW.md sections

8, 9, 5 (port exposure, secrets in image layers and logs).

## Notes

(Fill in as work lands.)
