# Stage 04: MCP and the end of the Worker

## Goal

Serve `/mcp` from the Express app with Pocket ID as the authorization server, and delete the Cloudflare Worker code.

## Depends on

Stages 01 and 03 (data API, storage and the function modules). The token format is known from stage 00.

## Deliverables

- [x] `server/mcp.js`: mounts the MCP Streamable HTTP transport at `/mcp` (stateless, POST only), reusing `createMcpServer` from `mcp/server.js`.
- [x] Bearer validation:
  - if tokens are JWTs: `jose` `createRemoteJWKSet` against Pocket ID's JWKS, checking issuer, audience (the `ai-apps-mcp` client id) and expiry;
  - if they're opaque: Pocket ID's userinfo endpoint, cached per token for 5 minutes.
  - Then map `sub` to a user (`users.oidc_sub`), refusing unknown subjects.
- [x] `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp`, with `authorization_servers: ["https://id.trplan.si"]`, and the 401 `WWW-Authenticate` header pointing at it.
- [x] `mcp/http.js` reduced or removed; `mcp/appData.js` takes the db module instead of a Supabase client and keeps the `updated_at` retry logic.
- [x] `removePhoto` → `storage.remove`; `callFunction` → the function modules directly.
- [x] `resolveMapsLink` moved to `server/routes/maps.js` (`GET /api/resolve-maps-link`), with its existing tests.
- [x] `worker.js`, `wrangler.jsonc` and `oauth-consent.html` deleted (Cloudflare keeps serving production from `master` until cutover, so the deletions only happen on the `migration` branch).
- [x] `@supabase/supabase-js` removed from `package.json` and the lockfile (moved here from stage 02: `mcp/http.js` was its last user).
- [x] Tests: bearer checks against a local JWKS (good token, expired, wrong `aud`, wrong `iss`, unknown `sub`), and `mcp/appData` against the new data layer.

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

### Done-when evidence (2026-10-30)

- `npm run test:server`: 95/95 (new: `mcp.test.mjs` 12, `maps.test.mjs` 3); `node --test mcp/*.test.mjs german/*.test.mjs moped-route/*.test.mjs`: 74/74.
  - Tokens are signed with a local RS256 key and checked against a local JWKS: a good token lists the tools and `recipes_save_list` writes the user's own row; expired, wrong `iss`, wrong `aud`, `client_id` = `ai-apps`, an ID token (`typ: JWT`), another key, an unknown `sub` and garbage all get 401 with `error="invalid_token"` in `WWW-Authenticate`; no token gets 401 with only the metadata link.
  - Key fetch failing → 503 (no `WWW-Authenticate`), and the next call works again.
  - GET and DELETE → 405; OPTIONS → 204 with CORS.
  - `recipes_delete` removes the photo file; `german_add_cards` fills words through the `german-ai` module (a 429 comes back as the word's error).
  - `mcp/appData`: an app save landing between the tool's read and write is kept and the tool's change applied on top (2 runs of `mutate`); repeated conflicts give up with the old message.
- Mutation check: dropping the `client_id` check, the `typ` check, the 503 split, or the retry each failed its test; all restored.
- Dev stack (`localhost:8090`): `POST /mcp` without a token → 401 `Bearer resource_metadata="http://localhost:8090/.well-known/oauth-protected-resource/mcp"`; a garbage token → the same plus `error="invalid_token"`; the metadata lists `https://id.trplan.si`; `/oauth-consent` → 404; `/api/resolve-maps-link?url=https://example.com` → "Not a Google Maps short link".
- `git grep -iE 'wrangler|worker\.js'` outside `migration-plan/` and `REVIEW.md`: nothing.
- `npm run build` still builds every bundle (only `pdf-tools-app.js` differed, as usual, and was reverted); `vite` dev server starts with the renamed config.

**Not done yet (moved to stage 05's Done when):** the real OAuth flow through Pocket ID with claude.ai (or MCP Inspector) and tool calls showing up in the apps. It needs the user at the consent screen, and a callback URL on `ai-apps-mcp` for whatever host runs it.

### Decisions and findings

- **Token checks** (from stage 00's findings): `jwtVerify` with `issuer`, `audience: ai-apps-mcp` and `typ: at+jwt`, then `client_id === ai-apps-mcp` (aud also contains the issuer, and the app client's tokens carry `client_id: ai-apps`). `typ` keeps ID tokens out, whose `aud` is also the client id. `sub` → `users.oidc_sub`; an unknown `sub` is a 401 whose description says to sign in to the apps once first (the token has no email to link by).
- **Pocket ID outages** (the NAS stalls nightly): the JWKS is cached for 24 h (`cacheMaxAge`), and a key we don't know yet makes jose refetch, so key rotation still works. When the keys can't be fetched at all, `/mcp` answers 503 `temporarily_unavailable`, not `invalid_token`, so claude.ai doesn't drop a good token.
- `/mcp` is mounted before the session cookie middleware: it only ever acts on bearer tokens.
- `MCP_CLIENT_ID` (default `ai-apps-mcp`) is the env name; stage 05's secret list said `MCP_OIDC_CLIENT_ID`, now corrected there.
- **`"type": "module"`** in the root `package.json`: the server loads `mcp/` and the apps' `model.js` files directly, and Node warned on every start that it reparsed them as ESM. `build.js` and `vite.config.js` were the only CommonJS files and are now `.cjs`; `server/package.json` went away.
- **`package-lock.json` is stale** (last touched before stage 01; `pnpm-lock.yaml` is the real lockfile) and still lists supabase-js. Left alone here; delete it in stage 07 or whenever convenient (REVIEW.md only checks `package.json` and `pnpm-lock.yaml`).
- The maps resolver had no tests despite the plan's wording; `maps.test.mjs` adds them. Fetches now time out after 8 s.

