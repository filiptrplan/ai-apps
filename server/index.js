// Starts the server: the site, the APIs and the daily backup job.
// Configuration is read from the environment, see server/README.md.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { createOidcClient } from "./auth.js";
import { createDb } from "./db.js";
import { startSnapshotJob } from "./routes/backups.js";

function env(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`${name} is not set`);
  return value;
}

const sql = createDb(env("DATABASE_URL"));
const { app, appData, auth } = createApp({
  sql,
  storageDir: env("STORAGE_DIR", "/data/storage"),
  siteRoot: path.resolve(fileURLToPath(import.meta.url), "../.."),
  publicUrl: env("PUBLIC_URL"),
  getOidcConfig: createOidcClient({
    issuer: env("OIDC_ISSUER", "https://id.trplan.si"),
    clientId: env("OIDC_CLIENT_ID"),
    clientSecret: env("OIDC_CLIENT_SECRET"),
  }),
  sha: env("GIT_SHA", "dev"),
});

startSnapshotJob(appData);
setInterval(() => auth.pruneSessions().catch(() => {}), 24 * 60 * 60 * 1000).unref();

const port = Number(env("PORT", "8090"));
const server = app.listen(port, () => console.log(`ai-apps listening on :${port}`));

function shutdown() {
  server.close(() => sql.end({ timeout: 5 }).then(() => process.exit(0)));
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
