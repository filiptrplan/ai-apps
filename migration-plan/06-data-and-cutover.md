# Stage 06: Data migration and cutover

## Goal

Copy everything from Supabase to the new stack, rehearse on staging, then switch apps.trplan.si over.

## Depends on

Stage 05 (a deployed staging stack).

## Deliverables

- [x] `scripts/migrate-from-supabase.mjs` (see Design notes), with a `--dry-run` that only reports counts.
- [x] A staging dry run (staging's `users` already has the owner's row with their Supabase id, added by hand in stage 05; the script must upsert, not fail): the script runs against `apps-next.trplan.si`'s database and storage; every app is tested there.
- [x] A short written cutover checklist in the Notes below, with the rollback plan.
- [ ] `migration` merged to `master`; the `deploy` promotion now runs from `master`: the promote job's `if` and `HEALTH_URL` in `deploy.yml`, `HEALTH_URL` in `rollback.yml`, and the stack's `PUBLIC_URL` in Komodo (stage 05 Notes). In Pocket ID, add the API `https://apps.trplan.si/mcp` and give `ai-apps-mcp` access to it (server/README.md, MCP), or claude.ai's connector can't authorize. Then run the Rollback workflow once to an older sha and forward again (it can only be dispatched once it's on `master`).
- [ ] Cutover performed (see below) and verified.
- [ ] A final Supabase export taken just before the switch, stored on the NAS.
- [ ] Homelab note updated: `apps.trplan.si` now served by vps2.

## Files touched

New: `scripts/migrate-from-supabase.mjs`. Outside the repo, with the user's confirmation each time: Cloudflare (tunnel route, Worker route), the claude.ai connector, the Homelab note.

## Design notes

### The script (run once, from the workstation)

- **Reads** from Supabase with the session-pooler connection string, and the service-role key for storage downloads. Both come from env, never from the repo:
  - `auth.users`: `id`, `email`, `created_at` (no passwords needed). The owner's email becomes `filip@trplan.si`, their Pocket ID email (`accounts@trplan.si` on Supabase; decided in stage 01).
  - `public.app_data`, `app_data_backups` and every `mo_*` table
  - `auth.oauth_*` is skipped
  - `storage.objects` for the two buckets, downloaded through the Storage API
- **Writes** into the new Postgres over an SSH tunnel to the `db` container, keeping the user UUIDs so every `app_data` row still matches. Use `COPY`/upserts so the script can be re-run (fresh data at cutover) without duplicating; make the re-run replace, not merge, so deletions on the source are mirrored.
- **Files:** write to `~/container-data/ai-apps/storage/<bucket>/<name>` (via the SSH host or `rsync`), keeping the object paths exactly.
- **Checks** (printed at the end, non-zero exit on mismatch): row counts per table; a per-`(user, app_id, key)` hash of `value`; file count, bytes and sha256 per object.
- Don't print row contents or secrets. YubiKey SSH: use the shared socket from the `homelab` skill.
- `mo_admin_pin` and `mo_admin_sessions` hold the PIN hash and sessions: copy the PIN hash, skip sessions (admins log in again).
- Sequences/identity values aren't used (uuid keys), so nothing to reset.

### Staging dry run

- Run the script, sign in with Pocket ID as each user, and spot-check that the German deck, recipes and climbing history look the same as in production.
- Connect claude.ai (or MCP Inspector) to staging with the `ai-apps-mcp` client; run a few tools.
- Generate a podcast episode, upload a recipe photo, play migrated German audio.
- Time the whole run so the cutover window is known.

### Cutover (about 15 minutes)

1. Announce a short freeze to yourself: no edits during the switch.
2. Run the script again on fresh data and confirm all checks pass.
3. Point the `apps.trplan.si` route at `localhost:8090` on the VPS tunnel, and remove the Worker's custom domain or route.
4. Merge `migration` into `master`; confirm the first promotion to `deploy` happens and health reports the sha.
5. Sign in with Pocket ID on each device. The first sign-in links the account by email. Old Supabase sessions are gone.
6. Re-add the claude.ai MCP connector with the `ai-apps-mcp` client id and secret, and run one tool call per app.
7. Watch the logs for errors for an hour.

### Rollback plan

Until Supabase is deleted (stage 07) rolling back means: point the tunnel route away, re-enable the Worker route, and redeploy the last `master` commit from before the merge. Any data written after the switch exists only in the new database, so export it first with the script in reverse, or accept the loss. Decide this before cutover, not during it.

### Caveats

- Service workers on devices cache the old bundles. The bumped `CACHE_NAME`s from stage 02 fix this, but check on a phone that has the PWA installed.
- The cutover window shouldn't overlap 00:00–00:45 UTC (Pocket ID stalls).

## Done when

- The script's checks report equal counts, hashes and file digests, against both the staging and the final production runs.
- All eleven apps open on `https://apps.trplan.si` with the migrated data and no console errors.
- Both users signed in through Pocket ID and see their own data; `users.oidc_sub` is set for both.
- The claude.ai connector works again.
- A new edit on a phone and on desktop syncs live.

## REVIEW.md sections

3, 4, 6, 7 (re-run on production).

## Notes

### Source access (2026-10-31)

The script reads Supabase as a temporary role, not as `postgres`: `migrator` (LOGIN, BYPASSRLS, `valid until 2026-11-21`), created through the Supabase MCP with a SCRAM verifier, so the password was generated locally and never left the workstation. It has SELECT on every `public` table and `storage.objects`. `postgres` can't grant access to the `auth` schema (only `supabase_admin` can), so users come from the view `migration.auth_users` (`id`, `email`, `created_at`), owned by `postgres`, readable only by `migrator`. Pooler: `aws-0-eu-west-1.pooler.supabase.com:5432` as `migrator.zqxvlczqfqmcojbgwogs` (`aws-1` doesn't know the tenant). Drop both if the project outlives stage 07: `drop schema migration cascade; drop role migrator;`.

Local, gitignored, in `.supabase-export/`: `run-migration.sh` opens a tunnel to `ai-apps-db-1` over the vps2 control socket, reads the target password from the container without printing it, and runs the script with `TARGET_STORAGE=vps2:container-data/ai-apps/storage`. Secrets live in `~/.config/ai-apps/supabase-migration.env` (mode 600: `SUPABASE_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY`).

### Staging run (2026-10-31)

- Local test first, against a scratch Postgres with a fake `auth`/`storage` and a stub Storage API: re-runs replace (stale rows, users and files removed), a linked `oidc_sub` survives, a 30-digit jsonb number keeps its precision, and the rsync-remote path works.
- Dry run: Supabase has 2 users, 26 `app_data`, 5 backups, `mo_*` 3/19/6/5/47/1/1, 9 files (2 photos, 7 audio, 78.9 MB).
- First real run: everything matched except `german german-suggest`. The staging row had been rewritten at 17:20:43 UTC, about 10 s after the copy, by an open app on `apps-next` (its value differed from Supabase's; the copy was right). The second run passed every check: users, all 9 tables by row digest, `app_data` values by key, 9 files by sha256. **About 11 s end to end** (DB 2 s, files 8 s). The owner kept `oidc_sub`; the second user's row is copied too (not invited, so they can't sign in, but no re-run is needed once they are).
- Chrome on `apps-next`, signed in as the owner: all 11 pages load with no console errors. German ("Frei heute", 10 cards) and Marsova (193 available, 546 total) match production; recipes, shopping list, climbing plan, semester builder and interval timer show the migrated data. Migrated audio is served as `audio/wav`/`audio/mpeg` and plays (271 s episode); both recipe photos decode; a PUT into the migrated photo folder works.
- Staging MCP (claude.ai connector): `german_get_overview`, `recipes_get_overview`, `climbing_get_overview` return the migrated data (15 cards, 4 recipes, 32 workouts).
- Final export rehearsed: `pg_dump -n public -n migration --no-owner --no-privileges` as `migrator` from `postgres:17-alpine` → 148 kB gzip, 11 tables plus the users view.
- Podcast on staging, in Chrome (the user asked me to run it): "Bouldern" → `POST /api/fn/german-podcast` 200, spinner, and about 1.5 min later the episode "Bouldern: Erst mal klein anfangen" (2:34, 5 key words) with its WAV (7.4 MB) in the migrated user's `podcast/` folder; the player loads it fully, no console errors. The migrated episodes are listed below it. (The cutover run removes this test episode, since Supabase doesn't have it.)

### Cutover checklist

Not between 00:00 and 00:45 UTC (Pocket ID stalls). About 15 minutes.

1. Close every `apps-next` tab and stop editing on any device.
2. Final export: `pg_dump` as above into `.supabase-export/final-<date>.sql.gz`.
3. `bash .supabase-export/run-migration.sh` → every check `ok`. Copy the dump and `.supabase-export/storage/` (just refreshed) to the NAS `backup-vps` share.
4. Komodo: set the stack's `PUBLIC_URL` to `https://apps.trplan.si` and redeploy (sign-in callbacks and the MCP `aud` follow it). Pocket ID: add the API `https://apps.trplan.si/mcp` and give `ai-apps-mcp` access to it.
5. Cloudflare: route `apps.trplan.si` → `http://localhost:8090` on the VPS tunnel; remove the Worker's custom domain. Check `curl -s https://apps.trplan.si/api/health`.
6. Merge `migration` into `master`, switching the promotion in the same push: the promote job's `if` and `HEALTH_URL` in `deploy.yml`, `HEALTH_URL` in `rollback.yml`. Confirm `deploy` moves and health reports the sha.
7. Sign in with Pocket ID on each device (old Supabase sessions are gone); check that an installed PWA picks up the new bundles.
8. Re-add the claude.ai connector (`https://apps.trplan.si/mcp`, `ai-apps-mcp`); one tool call per app.
9. Run the Rollback workflow once to an older sha and forward again.
10. Watch `docker logs ai-apps-app-1` for an hour; update the Homelab note.

### Rollback plan

Until stage 07 deletes Supabase: point the `apps.trplan.si` tunnel route away, re-add the Worker's custom domain, and redeploy the last pre-merge `master` (Supabase's own deploy of `master` is unaffected by the merge, since nothing under `supabase/` changes). Data written on the new stack after the switch stays in its database but isn't copied back (the script only goes one way, and `migrator` is read-only).
