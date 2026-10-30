// Runs server/*.test.mjs against a throwaway Postgres:
//
//   node server/runTests.mjs
//
// Starts postgres:17-alpine in Docker (or uses TEST_DATABASE_URL, a server
// where we may create databases), applies db/migrations to a template
// database with dbmate (up, rollback, up, so the down migration is tested
// too), and each test file then works on its own copy of the template.

import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const repo = path.resolve(fileURLToPath(import.meta.url), "../..");
const TEMPLATE = "ai_apps_test_template";

function docker(...args) {
  return execFileSync("docker", args, { encoding: "utf8" }).trim();
}

let container;
let adminUrl = process.env.TEST_DATABASE_URL;
if (!adminUrl) {
  container = docker("run", "-d", "--rm", "-e", "POSTGRES_PASSWORD=test", "-p", "127.0.0.1::5432", "postgres:17-alpine");
  const port = docker("port", container, "5432/tcp").split("\n")[0].split(":").pop();
  adminUrl = `postgres://postgres:test@127.0.0.1:${port}/postgres`;
}

function dbmate(...args) {
  const url = new URL(adminUrl);
  url.pathname = `/${TEMPLATE}`;
  url.searchParams.set("sslmode", "disable");
  execFileSync(path.join(repo, "node_modules/.bin/dbmate"), ["--url", url.toString(), "--no-dump-schema", "--wait", ...args], {
    cwd: repo,
    stdio: ["ignore", "inherit", "inherit"],
  });
}

let status = 1;
try {
  // The container accepts connections a moment before it's really ready.
  for (let i = 0; ; i++) {
    const admin = postgres(adminUrl, { onnotice: () => {}, max: 1 });
    try {
      await admin`drop database if exists ${admin(TEMPLATE)}`;
      await admin`create database ${admin(TEMPLATE)}`;
      await admin.end();
      break;
    } catch (err) {
      await admin.end();
      if (i >= 30) throw err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  dbmate("up");
  dbmate("rollback");
  dbmate("up");

  const result = spawnSync(process.execPath, ["--test", "--test-concurrency=4", ...process.argv.slice(2), "server/*.test.mjs"], {
    cwd: repo,
    stdio: "inherit",
    env: { ...process.env, TEST_DATABASE_URL: adminUrl, TEST_TEMPLATE_DB: TEMPLATE },
  });
  status = result.status ?? 1;
} finally {
  if (container) docker("rm", "-f", container);
}
process.exit(status);
