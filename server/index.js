// Starts the server: the site, the APIs, /mcp and the background jobs.
// Configuration is read from the environment, see server/README.md.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { createOidcClient } from "./auth.js";
import { createDb } from "./db.js";
import { listenForChanges } from "./events.js";
import { pocketIdKeys } from "./mcp.js";
import { startSnapshotJob } from "./routes/backups.js";

function env(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`${name} is not set`);
  return value;
}

// The image's commit, written by the Dockerfile.
function gitShaFile() {
  try {
    return readFileSync(new URL("../.git-sha", import.meta.url), "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

const databaseUrl = env("DATABASE_URL");
const sql = createDb(databaseUrl);
const issuer = env("OIDC_ISSUER", "https://id.trplan.si");
const { app, appData, auth, events, fn } = createApp({
  sql,
  storageDir: env("STORAGE_DIR", "/data/storage"),
  siteRoot: path.resolve(fileURLToPath(import.meta.url), "../.."),
  publicUrl: env("PUBLIC_URL"),
  getOidcConfig: createOidcClient({
    issuer,
    clientId: env("OIDC_CLIENT_ID"),
    clientSecret: env("OIDC_CLIENT_SECRET"),
  }),
  mcp: { issuer, clientId: env("MCP_CLIENT_ID", "ai-apps-mcp"), keys: pocketIdKeys(issuer) },
  sha: env("GIT_SHA", gitShaFile() ?? "dev"),
});

startSnapshotJob(appData);
fn.recover().catch((err) => console.error("fn: couldn't recover interrupted episodes:", err));
const listener = listenForChanges(databaseUrl, { onChange: events.publish, onResync: events.resync });
setInterval(() => auth.pruneSessions().catch(() => {}), 24 * 60 * 60 * 1000).unref();

const port = Number(env("PORT", "8090"));
const server = app.listen(port, () => console.log(`ai-apps listening on :${port}`));

function shutdown() {
  // Open event streams would keep server.close() waiting; pages reconnect.
  events.closeAll();
  server.close(() => Promise.all([listener.stop(), sql.end({ timeout: 5 })]).then(() => process.exit(0)));
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
