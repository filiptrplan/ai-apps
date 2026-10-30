# Stage 04: MCP and the end of the Worker

## Goal

Serve `/mcp` from the Express app with Pocket ID as the authorization server, and delete the Cloudflare Worker code.

## Depends on

Stages 01 and 03 (data API, storage and the function modules). The token format is known from stage 00.

## Deliverables

- [ ] `server/mcp.js`: mounts the MCP Streamable HTTP transport at `/mcp` (stateless, POST only), reusing `createMcpServer` from `mcp/server.js`.
- [ ] Bearer validation:
  - if tokens are JWTs: `jose` `createRemoteJWKSet` against Pocket ID's JWKS, checking issuer, audience (the `ai-apps-mcp` client id) and expiry;
  - if they're opaque: Pocket ID's userinfo endpoint, cached per token for 5 minutes.
  - Then map `sub` to a user (`users.oidc_sub`), refusing unknown subjects.
- [ ] `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp`, with `authorization_servers: ["https://id.trplan.si"]`, and the 401 `WWW-Authenticate` header pointing at it.
- [ ] `mcp/http.js` reduced or removed; `mcp/appData.js` takes the db module instead of a Supabase client and keeps the `updated_at` retry logic.
- [ ] `removePhoto` → `storage.remove`; `callFunction` → the function modules directly.
- [ ] `resolveMapsLink` moved to `server/routes/maps.js` (`GET /api/resolve-maps-link`), with its existing tests.
- [ ] `worker.js`, `wrangler.jsonc` and `oauth-consent.html` deleted (Cloudflare keeps serving production from `master` until cutover, so the deletions only happen on the `migration` branch).
- [ ] `@supabase/supabase-js` removed from `package.json` and the lockfile (moved here from stage 02: `mcp/http.js` was its last user).
- [ ] Tests: bearer checks against a local JWKS (good token, expired, wrong `aud`, wrong `iss`, unknown `sub`), and `mcp/appData` against the new data layer.

## Files touched

`server/mcp.js`, `server/routes/maps.js`, `mcp/http.js`, `mcp/appData.js`, `mcp/server.js` (if the wiring changes), `mcp/apps/*.js` only if their imports change. Removed: `worker.js`, `wrangler.jsonc`, `oauth-consent.html`.

## Design notes

- `mcp/apps/*.js` and the apps' `model.js` reuse should not need changes: the seam is `appData`, `removePhoto` and `callFunction`.
- `appData.update` keeps its optimistic-concurrency loop. With the new API that's `ifUpdatedAt` on the update (or `UPDATE … WHERE updated_at = $1` directly in SQL), with the same `MAX_ATTEMPTS` and error messages.
- CORS on `/mcp` stays as in `mcp/http.js` (claude.ai connects from the browser side for some flows): `Access-Control-Allow-Origin: *`, the same allowed headers, and exposed `WWW-Authenticate`.
- The Pocket ID audience: confirm that the access token actually carries the MCP client id in `aud` (stage 00 notes). If Pocket ID puts something else there, validate against that value and record it.
- A token from the app client `ai-apps` must be rejected by `/mcp`, and the reverse isn't needed.
- No sessions on `/mcp`: GET and DELETE return 405.
- The claude.ai connector is configured with the `ai-apps-mcp` client id and secret in its advanced settings (Pocket ID has no dynamic registration).

## Done when

- `node --test mcp/*.test.mjs server/*.test.mjs` passes.
- Against the dev stack with MCP Inspector (or claude.ai against staging in stage 05/06): the OAuth flow through Pocket ID completes; `german_get_overview`, `recipes_save_list` and `climbing_log_workout` work, and the changes show up in the apps.
- A request with no token gets 401 plus the metadata link; an expired or wrong-audience token gets 401 with `invalid_token`.
- A concurrent edit made while a tool call runs is not overwritten (retry works).
- `git grep -iE 'wrangler|worker\.js'` finds nothing outside `migration-plan/` and `REVIEW.md`.

## REVIEW.md sections

1, 5 (`/mcp` token checks), 6.

## Notes

(Fill in as work lands.)
