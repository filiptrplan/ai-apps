# Server

An Express app that serves the site and its APIs from one process, on its own Postgres and file storage. It replaces Supabase and the Cloudflare Worker (see `migration-plan/`).

| File | What it does |
|---|---|
| `index.js` | Reads the environment and starts everything. |
| `app.js` | Puts the app together; tests build it with their own database. |
| `db.js` | The Postgres pool (`postgres`, porsager). |
| `auth.js` | Pocket ID sign-in and the session cookie: `/auth/login`, `/auth/callback`, `/auth/logout`, `/api/auth/session`, `requireUser`. |
| `appData.js` | The only module that touches `app_data` and its backups; every query is scoped to a user id. |
| `storage.js` | Files at `<STORAGE_DIR>/<bucket>/<userId>/<path>`, with the bucket limits. |
| `static.js` | The site, from an allowlist of what the pages use. |
| `routes/data.js` | `GET`/`PUT /api/data/:app/:key` |
| `routes/backups.js` | `GET /api/backups`, `POST /api/backups/:date/restore`, and the daily snapshot job. |
| `routes/storage.js` | `GET`/`PUT`/`DELETE /api/storage/:bucket/<userId>/<path>` |
| `routes/mo.js` | Marsova opravila: `GET /api/mo/:table`, `POST /api/mo/rpc/:fn` |

Database migrations aren't run by the server; dbmate runs them first (`db/migrations`, see below).

## Environment

| Variable | Default | |
|---|---|---|
| `DATABASE_URL` | (required) | `postgres://user:password@host:5432/db` |
| `PUBLIC_URL` | (required) | The site's address, e.g. `https://apps.trplan.si`. Builds the OIDC redirect URI. Over `https` the cookies are `Secure` and `__Host-` prefixed; over `http` (dev) they aren't. |
| `OIDC_ISSUER` | `https://id.trplan.si` | Pocket ID. |
| `OIDC_CLIENT_ID` | (required) | The `ai-apps` client's id. |
| `OIDC_CLIENT_SECRET` | (required) | Its secret. Never commit it. |
| `STORAGE_DIR` | `/data/storage` | Where uploaded files live. |
| `PORT` | `8090` | |
| `GIT_SHA` | `dev` | Reported by `/api/health`. |

## Development

```sh
cp .env.example .env        # then fill in OIDC_CLIENT_ID and OIDC_CLIENT_SECRET
docker compose -f deploy/compose.dev.yaml up -d db migrate
npm run dev:server          # http://localhost:8090
```

Or run all of it in Docker: `docker compose -f deploy/compose.dev.yaml up`.

There are no sign-ups: add yourself before signing in, with the email of your Pocket ID account (it's linked to your Pocket ID user on the first sign-in, if Pocket ID reports the email as verified):

```sh
docker compose -f deploy/compose.dev.yaml exec db \
  psql -U ai_apps -c "insert into users (email) values ('you@example.com')"
```

## Migrations

dbmate, with plain SQL files in `db/migrations` (`-- migrate:up` / `-- migrate:down`, each in a transaction). Applied versions are recorded in `schema_migrations`.

```sh
npx dbmate new add_something   # new file in db/migrations
npm run db:migrate             # applies it to the dev database and rewrites db/schema.sql
```

Commit `db/schema.sql` with the migration. Never edit a migration that's already on `master`; add a new one.

## Tests

```sh
npm run test:server   # or `npm test` for every suite
```

`runTests.mjs` starts a throwaway `postgres:17-alpine` container (or uses `TEST_DATABASE_URL`), applies the migrations to a template database with dbmate (up, rollback, up), and runs `server/*.test.mjs`, each file on its own copy. Needs Docker.
