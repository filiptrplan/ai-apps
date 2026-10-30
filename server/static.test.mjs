import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./testing.mjs";

let t;
before(async () => (t = await setup()));
after(() => t.close());

test("health answers with ok and the sha", async () => {
  const res = await t.request("/api/health");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, sha: "dev" });
});

test("pages are served at extensionless paths", async () => {
  for (const [p, marker] of [["/", "<html"], ["/german", "german-app.js"], ["/recipes", "recipes-app.js"]]) {
    const res = await t.request(p);
    assert.equal(res.status, 200, p);
    assert.match(res.headers.get("content-type"), /text\/html/);
    assert.equal(res.headers.get("cache-control"), "no-cache");
    assert.ok((await res.text()).includes(marker), p);
  }
});

test(".html and trailing-slash paths redirect to the extensionless one", async () => {
  for (const [from, to] of [["/german.html", "/german"], ["/german/", "/german"], ["/index.html", "/"], ["/german.html?x=1", "/german?x=1"]]) {
    const res = await t.request(from);
    assert.equal(res.status, 307, from);
    assert.equal(res.headers.get("location"), to, from);
  }
});

test("bundles, service workers and app assets are served", async () => {
  const sw = await t.request("/german-sw.js");
  assert.equal(sw.status, 200);
  assert.equal(sw.headers.get("cache-control"), "no-cache");
  assert.equal(sw.headers.get("service-worker-allowed"), null);

  for (const p of ["/german-app.js", "/climbing-tracker-app.css", "/german/manifest.json", "/german/icon.svg", "/shared/backup.js", "/ekg-trainer/cases/index.json", "/marsova-opravila/mars-idle.jpg"]) {
    const res = await t.request(p);
    assert.equal(res.status, 200, p);
    assert.equal(res.headers.get("cache-control"), "public, max-age=0, must-revalidate", p);
  }
});

test("nothing outside the allowlist is served", async () => {
  for (const p of [
    "/server/index.js", "/server/auth.js", "/db/migrations/20261030130000_baseline.sql", "/deploy/compose.dev.yaml",
    "/package.json", "/pnpm-lock.yaml", "/.gitignore", "/.git/config", "/.env", "/node_modules/postgres/package.json",
    "/worker.js", "/build.js", "/german-app.jsx", "/german/App.jsx", "/german/model.test.mjs", "/migration-plan/PLAN.md",
    "/supabase/config.toml", "/mcp/server.js", "/ekg-trainer/tools/build_cases.py", "/README.md", "/%2e%2e/etc/passwd",
    "/german/%2e%2e/server/auth.js", "/shared/..%2Fserver%2Fauth.js",
  ]) {
    const res = await t.request(p);
    assert.equal(res.status, 404, p);
  }
});

test("unknown API paths are JSON 404s", async () => {
  const res = await t.request("/api/nope");
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "Not found." });
});
