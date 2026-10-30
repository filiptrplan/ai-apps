# Stage 01: Server core

## Goal

A working `server/` that serves the static site and exposes the data, backup, storage and Marsova APIs on its own Postgres, with Pocket ID sign-in. Nothing in the existing apps changes yet, so production on Supabase is untouched.

## Depends on

Stage 00 (Pocket ID clients and the token-format answer).

## Deliverables

- [ ] `server/index.js`: Express app. Serves the repo's static files and maps extensionless paths (`/german` → `german.html`), as the Worker's asset binding does now. `GET /api/health` returns `{ ok, sha }`.
- [ ] `server/db.js`: `postgres` (porsager) client from `DATABASE_URL`.
- [ ] dbmate set up: `dbmate` as a dev dependency, `db/migrations/`, and a committed `db/schema.sql`.
- [ ] `db/migrations/<ts>_baseline.sql`: the schema translated from `supabase/migrations/*` (see Design notes).
- [ ] `server/auth.js`: Pocket ID sign-in with `openid-client`, session cookie, `GET /auth/login`, `GET /auth/callback`, `POST /auth/logout`, `GET /api/auth/session`, plus a `requireUser` middleware.
- [ ] `server/appData.js`: the one module that reads and writes `app_data`, always scoped to a user id.
- [ ] `server/routes/data.js`: `GET`/`PUT /api/data/:app/:key` with the `ifUpdatedAt` guard (409 on mismatch).
- [ ] `server/routes/backups.js` and the daily snapshot job: list, restore, snapshot once per user per day, prune after 7 days.
- [ ] `server/storage.js` and `server/routes/storage.js`: `GET`, `PUT`, `DELETE /api/storage/:bucket/*` on `/data/storage/<bucket>/<userId>/<path>`.
- [ ] `server/routes/mo.js`: `GET /api/mo/:table` (6 readable tables) and `POST /api/mo/rpc/:fn` (allowlisted `mo_*` functions).
- [ ] Dev setup: `deploy/compose.dev.yaml` (Postgres plus the app), `npm run dev:server`, and the env variables documented in `server/README.md`.
- [ ] `server/*.test.mjs`, run against a throwaway Postgres container (see Done when).
- [ ] `package.json` scripts: `test` covers the existing suites plus `server/*.test.mjs`.

## Files touched

New: `server/**`, `db/**`, `deploy/compose.dev.yaml`. Modified: `package.json`, lockfile.

## Design notes

### Server

- All server code is plain ESM JS, like the rest of the repo. It doesn't run migrations; dbmate does that before the app starts.
- Express serves the repo root as static files, but never serves `server/`, `db/`, `deploy/`, `migration-plan/`, `.git`, `node_modules` or dotfiles. Prefer an explicit allowlist of what the site actually uses (`*.html`, `*-app.js`, `*-sw.js`, the app directories' assets, `shared/`, `manifest.json`, icons).
- Service workers need `Service-Worker-Allowed` untouched and sensible cache headers: `no-cache` on HTML and `*-sw.js`.

### Baseline migration

- `users`: `id uuid` (keeps the Supabase id), `email` unique, `oidc_sub` unique and nullable, `created_at`. No passwords.
- `sessions`: hash of the token, `user_id`, `expires_at`.
- `app_data` and `app_data_backups`: as today, with the foreign key on `users`. Keep the `updated_at` trigger.
- `mo_*` tables and plpgsql functions: copied as they are from the three `20260822*` migrations. Drop the `anon`/`authenticated` grants and the `supabase_realtime` publication. Keep `pgcrypto`; fix the schema-qualified `extensions.crypt` / `extensions.gen_salt` calls to match where pgcrypto lives in the new database.
- RLS is removed. The server scopes every query to the session user, and `app_data` access exists only in `server/appData.js`.
- The `NOTIFY` triggers are added in stage 02, not here.
- Storage buckets aren't in the database any more; bucket rules live in code (`server/storage.js`).

### dbmate

- Plain SQL files, `-- migrate:up` / `-- migrate:down`. Each runs in a transaction; applied versions go in `schema_migrations`.
- New migration: `npx dbmate new <name>`. Rule stays: never edit a migration already on `master`.
- `dbmate dump` writes `db/schema.sql`; CI (stage 05) fails if it's out of date.

### Auth (Pocket ID)

- `ai-apps` is a confidential client. Routes: `GET /auth/login?next=…` → Pocket ID → `/auth/callback` (code, PKCE, state and nonce checked by `openid-client`) → look up the user → set the cookie → redirect to `next`.
- Validate `next`: same-origin relative paths only, to avoid an open redirect.
- Cookie: random token, only its hash is stored; `HttpOnly; Secure; SameSite=Lax`; 30-day expiry. In dev over http, `Secure` is off by env.
- Linking: on first sign-in, match a migrated user by verified email and store `oidc_sub`; after that, match on `sub` only. An unknown email gets a 403, not a new account (no sign-up).
- Who may sign in is controlled by the Pocket ID group on the client.

### Data API

- `GET /api/data/:app/:key` → `{ value, updated_at }` or 404.
- `PUT /api/data/:app/:key` with `{ value, ifUpdatedAt? }` → `{ updated_at }`; with `ifUpdatedAt` set and not matching → 409. Without it, an upsert.
- `updated_at` must come from the database's trigger so the client's marker logic in `syncStorage.js` keeps working.
- Backups: `GET /api/backups`, `POST /api/backups/:date/restore`. The daily snapshot replaces `runDailyBackupIfNeeded`: a once-a-day job (in-process timer, safe to run twice) snapshots every user's `app_data` and prunes backups older than 7 days.

### Storage

- Files at `/data/storage/<bucket>/<userId>/<path>`. The first path segment must equal the session user (mirrors `storage.foldername(name)[1] = auth.uid()`).
- Reject path traversal (`..`, absolute paths, NUL, backslashes); resolve and check the final path is inside the user's folder.
- Per-bucket limits copied from the bucket migrations: `recipe-photos` 2 MiB, `image/webp` and `image/jpeg`; `german-audio` allowed types `audio/mpeg` and the WAV type the later migrations added, with the size limit from `20261030090000_german_podcast_audio.sql` / `20261031090000_german_podcast_wav.sql` (read them to get the exact values).
- Write to a temp file and rename, so a partial upload is never served.

### Marsova opravila

- `GET /api/mo/:table` for `mo_categories`, `mo_chores`, `mo_rewards`, `mo_reward_requests`, `mo_activity_log`, `mo_settings`: no login, same as the current link-only model (read the migration for which tables are readable).
- `POST /api/mo/rpc/:fn` calls an allowlisted `mo_*` function with named arguments. The allowlist is the list in `marsova-opravila/api.js`. The plpgsql functions keep enforcing the admin PIN and session.
- `mo_points_summary` and the `.single()` calls: return the first row as an object where the client expects `.single()`.

## Done when

- `docker compose -f deploy/compose.dev.yaml up` starts, migrations apply from empty, and `GET /api/health` answers.
- `dbmate up`, `dbmate down` and `dbmate up` again on the newest migration all succeed.
- `node --test server/*.test.mjs` passes, covering:
  - Data access is scoped per user: user B gets 403 or 404 on user A's data, files and backups.
  - The 409 on a stale `ifUpdatedAt`.
  - Storage path traversal is rejected, and bucket MIME and size limits are enforced.
  - The Marsova RPC allowlist (an unlisted function is refused) and the PIN flow.
  - The session cookie flow with the OIDC client mocked, including state and nonce mismatches, a bad `next`, and an unknown email.
  - The daily snapshot is idempotent and prunes after 7 days.
- Manual: real sign-in against Pocket ID from `http://localhost:8090` works and `GET /api/auth/session` returns the user.
- The existing suites still pass: `node --test mcp/*.test.mjs german/*.test.mjs moped-route/*.test.mjs`.

## REVIEW.md sections

1 (partly), 5 (user scoping, path traversal, Marsova auth, cookies, state/nonce), 9 (`schema_migrations`).

## Notes

(Fill in as work lands.)
