# Migration plan: Supabase + Cloudflare Workers → vps2 (Komodo)

> Temporary. This directory is deleted in stage 07, once the migration is verified. `REVIEW.md` in the repo root outlasts it.

## Context

apps.trplan.si is a static site on a Cloudflare Worker (`worker.js` also serves `/mcp` and `/api/resolve-maps-link`). Its backend is Supabase project `zqxvlczqfqmcojbgwogs`. Supabase is getting in the way:

- Edge functions have about 2 s of CPU per request, so the podcast job needs `EdgeRuntime.waitUntil` workarounds.
- Storage is capped at 500 MB, and `german-audio` already holds 68 MB in only 5 WAV files.
- A free project that sits unused gets paused.

**Goal:** one self-hosted service on vps2, run as a Komodo stack, that holds the site, the API, the MCP server and the AI functions, with its own Postgres and file storage. GitHub Actions replaces both the Supabase auto-deploy and Cloudflare Workers.

**Current footprint** (read from the live project on 2026-10-30): database 14 MB; storage 68 MB in `german-audio` and 200 kB in `recipe-photos`; 2 users; 1 OAuth client (claude.ai's MCP connector); no pg_cron. The data move itself is trivial. The work is replacing the Supabase surface the code uses:

| Supabase feature | Where it's used | Replaced in stage |
|---|---|---|
| Auth: email + password, `getSession`, `onAuthStateChange` | `shared/auth.js` | 01, 02 |
| Auth: OAuth 2.1 server for MCP | `oauth-consent.html`, `mcp/http.js` | 04 |
| PostgREST queries | `shared/syncStorage.js`, `shared/backup.js`, `mcp/appData.js`, a few apps | 01, 02 |
| RPC calls (~25 `mo_*` functions) | `marsova-opravila/api.js` | 01, 02 |
| Realtime | `syncStorage.js`, `german/episodes.js`, `marsova-opravila/api.js` | 02 |
| Storage (paths prefixed with the user id) | `recipes/photos.js`, `german/audio.js` | 01, 02 |
| Edge functions (Deno), 7 of them | `supabase/functions/*` | 03 |

## Decisions already made

- **Rewrite onto plain Postgres + Node**, not self-hosted Supabase.
- **Site and `/mcp` run in a container on vps2**, exposed as apps.trplan.si through the existing `VPS_TUNNEL`. `worker.js` and `wrangler.jsonc` are deleted.
- **Auth is Pocket ID** (`id.trplan.si`), not our own. App sign-in uses `openid-client`. `/mcp` validates Pocket ID bearer tokens with `jose`. No passwords or OAuth server in our code.
- **DB migrations use dbmate**, run by a one-shot `migrate` compose service before the app starts.
- **Deploys:** GitHub Actions runs the checks, then fast-forwards the `deploy` branch. A Komodo procedure polls every minute and redeploys when `deploy` moves. The image is built on vps2 from the repo; no registry. The Action waits for `/api/health` to report the new sha.
- **No Komodo exposure** and no deploy secrets in GitHub, beyond the built-in `GITHUB_TOKEN`.

## Target architecture

```
GitHub push to master
  → Actions: tests, bundle check, dbmate check
  → on green: fast-forward the `deploy` branch to this commit
  → Komodo procedure (every 1 min): DeployStackIfChanged ai-apps
  → Komodo pulls `deploy` on vps2, runs `docker compose up --build`
    (migrate first, then app; no registry)
  → the Action waits for /api/health to report the new sha

vps2, Komodo stack "ai-apps" (repo-linked to branch `deploy`, compose at deploy/compose.yaml, `app` has `build: ..`):
  app  (node:22-alpine, Express)  127.0.0.1:8090
       static files · /api/* · /api/fn/* · /mcp · OIDC client · SSE events
  auth: Pocket ID at id.trplan.si (NAS), for the app login and the MCP OAuth
  db   (postgres:17-alpine)        internal network only
  volumes: ~/container-data/ai-apps/{pg,storage,dumps}
           (already mirrored to the NAS by the 03:30 rclone backup)

Cloudflare: VPS_TUNNEL ingress apps.trplan.si → http://localhost:8090
            (replaces the Worker's custom domain)
```

vps2: 2 vCPU, 3.7 GB RAM, 38 GB disk. Postgres plus Node need about 300 MB of RAM.

## Layout

- `PLAN.md` (this file): context, decisions, architecture, stage index, rules.
- `NN-name.md`: one file per stage, all with the same sections: **Goal**, **Depends on**, **Deliverables** (checkboxes), **Files touched**, **Design notes**, **Done when** (runnable checks), **REVIEW.md sections**.
- `../REVIEW.md` (repo root, written in stage 00): the post-migration checklist a separate agent runs to confirm the migration is 100% done.

## Stage index

| # | File | Stage | Depends on | Status |
|---|---|---|---|---|
| 00 | [00-prep.md](00-prep.md) | Groundwork: `REVIEW.md`, Pocket ID clients, token format, disk check | none | in progress |
| 01 | [01-server-and-db.md](01-server-and-db.md) | Server core: Express, dbmate, baseline schema, Pocket ID sign-in, data/backup/storage/Marsova APIs | 00 | todo |
| 02 | [02-realtime-and-client.md](02-realtime-and-client.md) | SSE events, `shared/*` and app call sites rewritten, Supabase removed from the client | 01 | todo |
| 03 | [03-ai-functions.md](03-ai-functions.md) | The 7 edge functions ported to `server/functions/` | 01 | todo |
| 04 | [04-mcp.md](04-mcp.md) | `/mcp` on Express with Pocket ID bearer checks; worker deleted | 01, 03 | todo |
| 05 | [05-deploy.md](05-deploy.md) | Dockerfile, compose, Komodo stack, deploy workflows, staging hostname | 01–04 | todo |
| 06 | [06-data-and-cutover.md](06-data-and-cutover.md) | Data migration script, dry run, cutover | 05 | todo |
| 07 | [07-decommission.md](07-decommission.md) | After 2 stable weeks: delete Supabase and the Worker, docs, final review, delete `migration-plan/` | 06 | todo |

02 and 03 can run in parallel once 01 is done.

## Working rules

1. One stage at a time. Don't start a stage before its dependencies are done, unless the index says it can run in parallel.
2. Commit per deliverable (Conventional Commits). Tick the checkbox in the stage file as each deliverable lands, and update the Status column here.
3. A stage is done only when every "Done when" check passes. Paste the evidence (command output or what you saw in Chrome) into the stage file's "Notes" section at the bottom.
4. Never print or commit secrets. Secrets that Komodo needs are set through a scratchpad script the user runs.
5. Confirm with the user before state-changing actions outside the repo: Komodo stacks and procedures, Cloudflare tunnel routes, Pocket ID changes, GitHub rulesets, and anything on the NAS or Supabase.
6. Production keeps running on Supabase until stage 06. Don't break it before then: the Supabase code stays in place until its replacement works, and `master` keeps deploying to Cloudflare until cutover. Stages 01–05 land on a long-lived branch, `migration`, merged to `master` at cutover.
7. Never edit a DB migration that is already on `master`. Add a new one.
8. Update the Homelab note (`~/Obsidian/Claude/Homelab.md`) when infrastructure changes (stages 05–07).
9. Rebuild the bundles (`npm run build`) after any `.jsx`/`.js` change that an app imports, and commit only the bundles of the apps that changed.

## Known risks

- **Pocket ID runs on the NAS**, which stalls between 00:00 and 00:45 UTC (Homelab issue 4). New sign-ins and MCP token refreshes fail in that window. Existing app sessions keep working because they are our own cookies. Fixing the stall is a separate task.
- **Pocket ID has no dynamic client registration** (`registration_endpoint` is null, checked 2026-10-30). claude.ai must use a pre-registered client (`ai-apps-mcp`), entered in the connector's advanced settings.
- **A rollback across a migration** must stay compatible with the newer schema; migrations only roll forward.
- **vps2 disk** is 38 GB. Check free space before cutover, since Docker image builds and dumps add up.
