// Test helpers for server/*.test.mjs, run by server/runTests.mjs. Each
// setup() gets its own database (a copy of the migrated template), its own
// storage folder and the app listening on a free port.

import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { createApp } from "./app.js";
import { createDb } from "./db.js";

export const repo = path.resolve(fileURLToPath(import.meta.url), "../..");

// `publicUrl` defaults to the address the app listens on.
export async function setup({ getOidcConfig = async () => { throw new Error("no OIDC in this test"); }, publicUrl } = {}) {
  const { TEST_DATABASE_URL, TEST_TEMPLATE_DB } = process.env;
  if (!TEST_DATABASE_URL) throw new Error("Run the server tests with `node server/runTests.mjs`.");

  const dbName = `ai_apps_test_${randomBytes(4).toString("hex")}`;
  const admin = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await admin`create database ${admin(dbName)} template ${admin(TEST_TEMPLATE_DB)}`;
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${dbName}`;
  const sql = createDb(url.toString());

  const storageDir = await mkdtemp(path.join(tmpdir(), "ai-apps-storage-"));
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { app, appData, auth } = createApp({ sql, storageDir, siteRoot: repo, publicUrl: publicUrl ?? base, getOidcConfig });
  server.on("request", app);

  async function addUser(email, id) {
    const [user] = id
      ? await sql`insert into public.users (id, email) values (${id}, ${email}) returning id`
      : await sql`insert into public.users (email) values (${email}) returning id`;
    return user.id;
  }

  // A user with a session; `headers` carries its cookie.
  async function signedIn(email = `${randomBytes(4).toString("hex")}@example.com`) {
    const id = await addUser(email);
    const { token } = await auth.createSession(id);
    return { id, email, headers: { cookie: `${auth.SESSION_COOKIE}=${token}` } };
  }

  function request(pathname, { headers, json, ...init } = {}) {
    if (json !== undefined) {
      headers = { ...headers, "content-type": "application/json" };
      init.body = JSON.stringify(json);
    }
    return fetch(base + pathname, { redirect: "manual", ...init, headers });
  }

  async function close() {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await sql.end();
    await admin`drop database ${admin(dbName)} with (force)`;
    await admin.end();
    await rm(storageDir, { recursive: true, force: true });
  }

  return { sql, base, appData, auth, storageDir, addUser, signedIn, request, close };
}
