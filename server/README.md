# Server

An Express app that serves the site, its APIs and the MCP server from one process, on its own Postgres and file storage. It replaces Supabase and the Cloudflare Worker (see `migration-plan/`).

| File | What it does |
|---|---|
| `index.js` | Reads the environment and starts everything. |
| `app.js` | Puts the app together; tests build it with their own database. |
| `db.js` | The Postgres pool (`postgres`, porsager). |
| `auth.js` | Pocket ID sign-in and the session cookie: `/auth/login`, `/auth/callback`, `/auth/logout`, `/api/auth/session`, `requireUser`. |
| `appData.js` | The only module that touches `app_data` and its backups; every query is scoped to a user id. |
| `storage.js` | Files at `<STORAGE_DIR>/<bucket>/<userId>/<path>`, with the bucket limits. |
| `static.js` | The site, from an allowlist of what the pages use. |
| `events.js` | Live updates: one `LISTEN` connection on the database's `changes` notifications, passed on to the pages over Server-Sent Events at `GET /api/events?topics=data,mo`. |
| `routes/data.js` | `GET`/`PUT /api/data/:app/:key` |
| `routes/backups.js` | `GET /api/backups`, `POST /api/backups/:date/restore`, and the daily snapshot job. |
| `routes/storage.js` | `GET`/`PUT`/`DELETE /api/storage/:bucket/<userId>/<path>` |
| `routes/mo.js` | Marsova opravila: `GET /api/mo/:table`, `POST /api/mo/rpc/:fn` |
| `mcp.js` | `/mcp`: the MCP server (`mcp/server.js`) over stateless Streamable HTTP, for Pocket ID access tokens of the `ai-apps-mcp` client, plus the OAuth protected resource metadata. |
| `routes/maps.js` | `GET /api/resolve-maps-link?url=…`: follows a Google Maps short link (for Moped Route). |
| `routes/fn.js` | The AI functions: `POST /api/fn/:name`, and `call()` for running them in-process. |
| `functions/<name>.js` | One AI function each (`german-ai`, `german-podcast`, `german-tts`, `price-estimate`, `recipe-import`, `shopping-list`, `shopping-merge`): `handle(body, ctx)` returns the JSON answer or throws `HttpError`. Shared code (OpenAI, OpenRouter, CEFR levels, WAV) is in `functions/_shared/`. |

Database migrations aren't run by the server; dbmate runs them first (`db/migrations`, see below).

## Environment

| Variable | Default | |
|---|---|---|
| `DATABASE_URL` | (required) | `postgres://user:password@host:5432/db` |
| `PUBLIC_URL` | (required) | The site's address, e.g. `https://apps.trplan.si`. Builds the OIDC redirect URI. Over `https` the cookies are `Secure` and `__Host-` prefixed; over `http` (dev) they aren't. |
| `OIDC_ISSUER` | `https://id.trplan.si` | Pocket ID. |
| `OIDC_CLIENT_ID` | (required) | The `ai-apps` client's id. |
| `OIDC_CLIENT_SECRET` | (required) | Its secret. Never commit it. |
| `MCP_CLIENT_ID` | `ai-apps-mcp` | The Pocket ID client claude.ai connects with; `/mcp` only takes its tokens. |
| `STORAGE_DIR` | `/data/storage` | Where uploaded files live. |
| `PORT` | `8090` | |
| `GIT_SHA` | `dev` | Reported by `/api/health`. |
| `OPENROUTER_API_KEY` | | For `recipe-import`, `shopping-list`, `shopping-merge`, `price-estimate` and the podcast's voices. Without it those functions answer 500 with a message saying so. |
| `OPENAI_API_KEY` | | For `german-ai`, `german-tts` and the podcast's script. |
| `OPENAI_MODEL` | `gpt-6.1-sol` | The German app's text model. |
| `OPENAI_TTS_MODEL` | `gpt-4o-mini-tts` | Spoken example sentences. |
| `PODCAST_TTS_MODEL` | `google/gemini-3.8-flash-tts` | The podcast's voices, on OpenRouter. |

The keys are read when a function runs, never logged, and never committed.

## Development

```sh
cp .env.example .env        # then fill in OIDC_CLIENT_ID and OIDC_CLIENT_SECRET
docker compose -f deploy/compose.dev.yaml up -d db migrate
npm run dev:server          # http://localhost:8090
```

Or run all of it in Docker: `docker compose -f deploy/compose.dev.yaml up`.

There are no sign-ups: add yourself before signing in, with the email of your Pocket ID account (it's linked to your Pocket ID user on the first sign-in):

```sh
docker compose -f deploy/compose.dev.yaml exec db \
  psql -U ai_apps -c "insert into users (email) values ('you@example.com')"
```

## AI functions

`POST /api/fn/:name` with the function's JSON input; `shared/ai.js`'s `callAI` calls it. Signed-out calls get a 401 with the function's own message ("Sign in to use Magic."), errors are `{ error }` with a status, and `callAI` shows that message as is.

The podcast answers at once with the episode's id and makes the episode in the background, in this process, writing progress into `app_data` (so `/api/events` tells the app). One episode at a time per user. A restart kills the jobs in flight; on startup their entries are marked failed.

`recipe-import` fetches the links users give it, and only follows them (and their redirects) to hosts whose addresses are all public, so a link can't reach the database, the tailnet or anything else next to the server.

## MCP

`/mcp` takes `Authorization: Bearer <access token>` from Pocket ID. The token must be a signed `at+jwt` from `OIDC_ISSUER` with `aud` and `client_id` = `MCP_CLIENT_ID`, and its `sub` must belong to a user who has signed in to the apps at least once (that's when `users.oidc_sub` is linked; the token has no email). Anything else gets a 401 with `WWW-Authenticate` pointing at `/.well-known/oauth-protected-resource/mcp`, which names Pocket ID as the authorization server.

Pocket ID's signing keys are kept for a day, so `/mcp` keeps working while the NAS is down; if they can't be fetched at all, `/mcp` answers 503 rather than a token error, so the client doesn't throw its token away.

claude.ai connects with the pre-registered public client `ai-apps-mcp` (Pocket ID has no dynamic client registration), entered in the connector's advanced settings.

## Migrations

dbmate, with plain SQL files in `db/migrations` (`-- migrate:up` / `-- migrate:down`, each in a transaction). Applied versions are recorded in `schema_migrations`.

```sh
npx dbmate new add_something   # new file in db/migrations
npm run db:migrate             # applies it to the dev database and rewrites db/schema.sql
```

Commit `db/schema.sql` with the migration. Never edit a migration that's already on `master`; add a new one.

## Deploying

vps2 runs the Komodo stack `ai-apps` from the `deploy` branch (`deploy/compose.yaml`, run from `deploy/`). Nothing deploys by hand:

1. A push to the deploying branch (`migration` until the cutover, then `master`) runs CI. When it's green, CI fast-forwards `deploy` to the commit and waits for `/api/health` to report it (`deploy/wait-for-sha.sh`).
2. Komodo's procedure `ai-apps autodeploy` runs the Action of the same name every minute (`deploy/komodo-autodeploy.ts`, kept here for reference; the copy in Komodo is the one that runs). When `deploy` has a commit that isn't deployed, it deploys it, once per commit. Komodo's own `DeployStackIfChanged` isn't used, because it only notices compose file changes.
3. The deploy runs `docker compose run --rm migrate` first (the stack's pre-deploy command): a dump into `dumps/pre-deploy-*.sql.gz` (the newest 5 are kept), then dbmate. If that fails, the old app keeps running. Then `docker compose up -d --build` builds the image in the clone and replaces the app.

Rollback: run the **Rollback** workflow with a commit sha; it force-pushes `deploy` there and waits for it to go live. The next green push moves `deploy` forward again.

The stack's environment (in Komodo) holds `POSTGRES_PASSWORD`, `PUBLIC_URL`, the OIDC client and the AI keys. Data is in `~/container-data/ai-apps/` on vps2: `pg` (Postgres, running as uid 1000), `storage` and `dumps`, all mirrored to the NAS at 03:30. The `db-dump` service writes `dumps/nightly-*.sql.gz` at 01:00 UTC and keeps 14. Restore one into an empty database:

```sh
gunzip -c dumps/nightly-<time>.sql.gz | docker exec -i ai-apps-db-1 psql -U ai_apps -d <empty db>
```

## Tests

```sh
npm run test:server   # or `npm test` for every suite
```

`runTests.mjs` starts a throwaway `postgres:17-alpine` container (or uses `TEST_DATABASE_URL`), applies the migrations to a template database with dbmate (up, rollback, up), and runs `server/*.test.mjs`, each file on its own copy. Needs Docker.
