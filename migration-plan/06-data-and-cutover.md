# Stage 06: Data migration and cutover

## Goal

Copy everything from Supabase to the new stack, rehearse on staging, then switch apps.trplan.si over.

## Depends on

Stage 05 (a deployed staging stack).

## Deliverables

- [ ] `scripts/migrate-from-supabase.mjs` (see Design notes), with a `--dry-run` that only reports counts.
- [ ] A staging dry run (staging's `users` already has the owner's row with their Supabase id, added by hand in stage 05; the script must upsert, not fail): the script runs against `apps-next.trplan.si`'s database and storage; every app is tested there.
- [ ] A short written cutover checklist in the Notes below, with the rollback plan.
- [ ] `migration` merged to `master`; the `deploy` promotion now runs from `master`: the promote job's `if` and `HEALTH_URL` in `deploy.yml`, `HEALTH_URL` in `rollback.yml`, and the stack's `PUBLIC_URL` in Komodo (stage 05 Notes).
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

(Fill in as work lands.)
