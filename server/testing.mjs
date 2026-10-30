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
import { listenForChanges } from "./events.js";

export const repo = path.resolve(fileURLToPath(import.meta.url), "../..");

// Replaces fetch for every host but 127.0.0.1 (the test's own requests to
// the app): `handler(url, init, body)` answers instead, with a Response;
// `body` is the request body, parsed when it's JSON. Each call is recorded
// in `calls` as { url, init, body }. `restore()` puts the real fetch back.
export function mockFetch(handler) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.hostname === "127.0.0.1") return real(input, init);
    let body = init.body;
    try {
      body = JSON.parse(body);
    } catch {}
    calls.push({ url, init, body });
    return handler(url, init, body);
  };
  return { calls, restore: () => (globalThis.fetch = real) };
}

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
  const { app, appData, auth, events, fn } = createApp({ sql, storageDir, siteRoot: repo, publicUrl: publicUrl ?? base, getOidcConfig });
  server.on("request", app);
  const listener = listenForChanges(url.toString(), { onChange: events.publish, onResync: events.resync });
  await listener.ready;

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

  // Opens GET /api/events and collects what arrives: `next()` resolves with
  // the next event ({ event, data }), `close()` ends the stream.
  async function stream(pathname, { headers } = {}) {
    const controller = new AbortController();
    const res = await fetch(base + pathname, { headers, signal: controller.signal });
    const queue = [];
    const waiting = [];
    (async () => {
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        for await (const chunk of res.body) {
          buffer += decoder.decode(chunk, { stream: true });
          let i;
          while ((i = buffer.indexOf("\n\n")) >= 0) {
            const block = buffer.slice(0, i);
            buffer = buffer.slice(i + 2);
            const lines = block.split("\n");
            const data = lines.filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n");
            if (!data) continue;
            const event = lines.find((l) => l.startsWith("event: "))?.slice(7) ?? "message";
            const item = { event, data: JSON.parse(data) };
            waiting.length ? waiting.shift()(item) : queue.push(item);
          }
        }
      } catch {}
    })();
    // Resolves with the next event, or null if none comes within `ms`.
    function next(ms = 2000) {
      if (queue.length) return Promise.resolve(queue.shift());
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiting.splice(waiting.indexOf(done), 1);
          resolve(null);
        }, ms);
        const done = (item) => {
          clearTimeout(timer);
          resolve(item);
        };
        waiting.push(done);
      });
    }
    return { res, next, close: () => controller.abort() };
  }

  async function close() {
    events.closeAll();
    await listener.stop();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await sql.end();
    await admin`drop database ${admin(dbName)} with (force)`;
    await admin.end();
    await rm(storageDir, { recursive: true, force: true });
  }

  return { sql, base, appData, auth, events, fn, listener, storageDir, addUser, signedIn, request, stream, close };
}
