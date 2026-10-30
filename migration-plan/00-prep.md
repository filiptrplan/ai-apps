# Stage 00: Groundwork

## Goal

Write down what "done" means (`REVIEW.md`), and settle the unknowns that decide later design: Pocket ID setup, the format of its access tokens, and whether vps2 has room.

## Depends on

Nothing.

## Deliverables

- [x] `REVIEW.md` in the repo root, with the ten sections listed under Design notes.
- [x] Branch `migration` created from `master`. Stages 01–05 land there.
- [ ] Pocket ID clients, created by the user in the admin UI:
  - `ai-apps`: confidential, redirect URIs `https://apps.trplan.si/auth/callback` and `https://apps-next.trplan.si/auth/callback` (plus `http://localhost:8090/auth/callback` for dev).
  - `ai-apps-mcp`: redirect URI is claude.ai's connector callback; public or confidential, whichever claude.ai's connector settings accept.
  - A group of allowed users, attached to both clients.
  - The second user invited, using the same email as their Supabase account, and their passkey set up.
- [x] Pocket ID access-token format checked: are tokens issued to `ai-apps-mcp` JWTs (verifiable against the JWKS) or opaque? Record the answer and the claims (`iss`, `aud`, `sub`, `exp`) in the Notes below.
- [x] vps2 free disk and memory recorded in the Notes.
- [x] Both Supabase users' ids and emails recorded in the Notes (ids are needed to link users; emails must match the Pocket ID accounts).

## Files touched

- `REVIEW.md` (new)

## Design notes

### REVIEW.md contents

A checklist that a separate agent works through after the migration. Each item has a command or action to run and the expected result, and the agent ticks it with the evidence it got. The reviewing agent may only fix what's listed in `REVIEW.md`; anything else it finds goes in a "Findings" section at the bottom.

1. **No Supabase left.**
   - `git grep -iE 'supabase|zqxvlczq|sb_publishable|Deno\.|EdgeRuntime|wrangler'` finds nothing outside `REVIEW.md` and the migration script.
   - `package.json` and the lockfile have no `@supabase/*`.
   - No committed bundle contains `supabase.co`.
2. **Feature parity.** Each row of the Supabase table in `PLAN.md` maps to its replacement, with a manual check:
   - Pocket ID sign-in and sign-out, and a user outside the allowed group being refused
   - sync and conflict prompt in two tabs
   - live updates in German episodes and Marsova
   - photos and audio
   - all 7 AI functions
   - backup list and restore
   - the daily snapshot job ran
   - the maps-link resolver
   - extensionless routes and the service workers offline
3. **Every app opens and saves**, with no console errors, checked in Chrome: climbing-tracker, ekg-trainer, german, index, interval-timer, marsova-opravila, moped-route, pdf-tools, recipes, semester-builder, shopping-list.
4. **Data is complete.**
   - Row counts per table, and per `(user, app_id, key)` hashes of `value`, match the final Supabase dump.
   - File count, bytes and sha256 per storage object match.
   - Both users sign in through Pocket ID and land on their own migrated data, with `oidc_sub` linked.
5. **Security.**
   - User B can't read or write user A's data, files or backups (403 or 404).
   - Storage path traversal is rejected.
   - Marsova admin functions fail without a valid token.
   - `/mcp` rejects a missing, expired or wrong-audience token, and a token from the `ai-apps` client.
   - The `/auth/callback` route checks state and nonce.
   - Cookies are `HttpOnly` and `Secure`.
   - There's no password or OAuth-server code in the repo.
   - Postgres and port 8090 aren't reachable from the internet (port probe against `178.105.22.185`).
   - No secrets in the repo, the image layers (`docker history`) or the logs.
6. **MCP.**
   - claude.ai is reconnected.
   - Every tool in `mcp/apps/*.js` is called once.
   - The `updated_at` guard is shown to retry on a concurrent edit.
7. **Long jobs.** A full podcast episode generates without a timeout, and its storage usage is recorded.
8. **CI/CD.**
   - A PR runs only the checks.
   - A merge to master fast-forwards `deploy` and is live within a few minutes. `/api/health` shows the new sha, and the job waits for it.
   - A failing test leaves `deploy` untouched, and nothing redeploys.
   - A code-only commit, with the compose file unchanged, is picked up by the autodeploy procedure.
   - The rollback workflow redeploys an older sha.
   - The `deploy` ruleset blocks deletion.
   - No GHCR package exists, and the repo holds no deploy secrets.
9. **Ops.**
   - The Komodo stack is `running` and restarts after `restart-stack`, with data intact.
   - A nightly `pg_dump` exists and restores into a scratch container.
   - `schema_migrations` lists every file in `db/migrations`.
   - A deliberately broken migration on a test branch fails CI.
   - A pre-deploy dump is written on each deploy.
   - The dumps and storage show up on the NAS `backup-vps` share after the 03:30 run.
   - Free disk space on vps2 is noted.
10. **Decommission.**
    - The Worker and its route are deleted.
    - A final Supabase dump is on the NAS before the project is deleted.
    - `supabase/`, `worker.js`, `wrangler.jsonc` and `migration-plan/` are removed.
    - `CLAUDE.md`, the Homelab note and the komodo skill are updated.

### Pocket ID facts (checked 2026-10-30 at `/.well-known/openid-configuration`)

- PKCE `S256` is supported; token endpoint auth methods are `client_secret_basic`, `client_secret_post` and `none`.
- Grants: `authorization_code`, `refresh_token`, device code and `client_credentials`. Scopes include `offline_access`.
- `registration_endpoint` is null: no dynamic client registration.

### Checking the token format

Run the authorization-code flow for `ai-apps-mcp` by hand (a browser plus `curl` against the token endpoint, or the MCP Inspector). Decode the access token at the JWT level (header and payload only; don't paste it anywhere). If it isn't a JWT, stage 04 falls back to calling Pocket ID's userinfo endpoint and caching the result per token for 5 minutes.

## Done when

- `REVIEW.md` exists and covers all ten sections.
- Both Pocket ID clients and the group exist, and the user confirms the second user can sign in to Pocket ID.
- The Notes below state JWT vs opaque, the claims, vps2's free disk (at least 10 GB) and the two user ids.

## REVIEW.md sections

Creates the file itself; nothing to satisfy yet.

## Notes

### vps2 (2026-10-30)

`df -h /`: 38 GB, 15 GB used, **22 GB free** (40%). Memory: 3.7 GiB total, 2.4 GiB available, swap 2 GiB (384 MiB used). 2 vCPU. `docker system df`: images 7.8 GB (7.7 GB reclaimable), build cache 3.1 GB (2.0 GB reclaimable), volumes 0.7 GB. Enough room; `docker image prune` and `docker builder prune` would free about 9 GB more if needed.

### Supabase users (2026-10-30, from `auth.users`)

The repo is public, so full emails aren't written here; stage 06's script reads them from `auth.users`. The Pocket ID accounts must use the same emails.

| Supabase id | Email | Created | Last sign-in | Data |
|---|---|---|---|---|
| `b9ef8bfd-9ca7-4193-b2c8-4f7b09e42dd1` | owner, `accounts@` on trplan.si | 2026-07-04 | 2026-10-26 | 26 `app_data` rows (climbing-tracker, german, interval-timer, recipes, semester-builder, shopping-list), all 7 storage objects |
| `488e26ac-7eec-4907-9044-a930fed5cc27` | second user, an outlook.com address | 2026-09-28 | never | none |

Only `app_data` and `app_data_backups` reference users; the `mo_*` tables don't (Marsova uses its admin PIN and sessions).

### Pocket ID (2026-10-30)

Issuer `https://id.trplan.si`, JWKS at `/.well-known/jwks.json`, ID tokens signed `RS256`, `registration_endpoint` null.

Clients `ai-apps` (confidential) and `ai-apps-mcp` (public, PKCE) created by the user with custom client ids, each limited to the allowed group.

### Access-token format (2026-10-30)

Checked by running the authorization-code + PKCE flow for `ai-apps-mcp` (a scratchpad script with a temporary `http://localhost:8765/callback` redirect URI) and decoding the token's header and payload:

- **JWT**, not opaque. Header `{"alg":"RS256","kid":"gCz3DdRG_mI","typ":"at+jwt"}`; the signature verifies against the JWKS.
- Claims: `iss` = `https://id.trplan.si`; `aud` = `["ai-apps-mcp", "https://id.trplan.si"]` (an array); `sub` = the Pocket ID user id (a UUID, not the Supabase id); `client_id` = `ai-apps-mcp`; `exp` - `iat` = 3600 s; also `jti`, `scope`, `scp`. **No `email` claim.**
- The token response also has `id_token` and `refresh_token` (with `offline_access`).

For stage 04: verify with `jose` against the JWKS, require `iss`, `aud` containing `ai-apps-mcp` **and** `client_id` = `ai-apps-mcp` (a token for `ai-apps` would carry its own id there), and map `sub` to our user through `users.oidc_sub`. No userinfo fallback is needed. Since there's no email in the token, a user must have signed in to the app once (which links `oidc_sub`) before MCP works for them.
