// Copies everything from the Supabase project into the new Postgres and file
// storage (migration stage 06), then checks that both sides match:
//
//   node scripts/migrate-from-supabase.mjs [--dry-run]
//
// Reads from env (never from the repo):
//
//   SUPABASE_DB_URL            the session-pooler connection string
//   SUPABASE_URL               https://<project>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  for storage downloads
//   TARGET_DATABASE_URL        the new database, e.g. through an SSH tunnel
//   TARGET_STORAGE             the new STORAGE_DIR: a local path or an rsync
//                              remote (vps2:container-data/ai-apps/storage)
//   SSH_COMMAND                ssh for rsync and the remote checks (default "ssh")
//   FILES_DIR                  local copy of the files (default .supabase-export/storage)
//
// Re-running replaces the target's data, so rows and files deleted on Supabase
// disappear here too. Users are upserted by id, keeping a linked oidc_sub.
// Skipped: auth.oauth_*, mo_admin_sessions (admins log in again) and
// mo_admin_pin_attempts (the target keeps its own lockout state).
//
// --dry-run only reports counts on both sides. Nothing prints row contents or
// secrets. Exits non-zero if any check fails.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const BUCKETS = ["recipe-photos", "german-audio"];

// Copied in this order and cleared in reverse, so foreign keys hold.
const TABLES = [
  "app_data",
  "app_data_backups",
  "mo_categories",
  "mo_chores",
  "mo_rewards",
  "mo_reward_requests",
  "mo_activity_log",
  "mo_settings",
  "mo_admin_pin",
];

// The owner signs in to Pocket ID with a different email than on Supabase
// (decided in stage 01).
const EMAIL_OVERRIDES = {
  "b9ef8bfd-9ca7-4193-b2c8-4f7b09e42dd1": "filip@trplan.si",
};

const dryRun = process.argv.includes("--dry-run");

function env(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (!value) {
    console.error(`${name} is not set`);
    process.exit(2);
  }
  return value;
}

const supabaseUrl = env("SUPABASE_URL").replace(/\/+$/, "");
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
const targetStorage = env("TARGET_STORAGE");
const sshCommand = env("SSH_COMMAND", "ssh");
const filesDir = path.resolve(env("FILES_DIR", ".supabase-export/storage"));

const options = { connection: { TimeZone: "UTC" }, onnotice: () => {}, max: 1 };
const sourceUrl = env("SUPABASE_DB_URL");
const local = ["localhost", "127.0.0.1"].includes(new URL(sourceUrl).hostname);
const source = postgres(sourceUrl, { ...options, ssl: local ? false : "require" });
const target = postgres(env("TARGET_DATABASE_URL"), options);

let failed = false;
function check(label, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `: ${detail}` : ""}`);
  if (!ok) failed = true;
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// A row's digest is the md5 of its jsonb text, which sorts keys, so column
// order doesn't matter, and timestamps print the same since both run in UTC.
async function rowDigests(sql, table) {
  const rows = await sql`select md5(to_jsonb(t)::text) as d from ${sql("public." + table)} t`;
  return rows.map((r) => r.d).sort();
}

function sameList(a, b) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

// --- Users ---------------------------------------------------------------

async function sourceUsers() {
  const rows = await source`select id, lower(email) as email, created_at from auth.users order by id`;
  return rows.map((u) => ({ ...u, email: EMAIL_OVERRIDES[u.id] ?? u.email }));
}

async function copyUsers(tx, users) {
  await tx`delete from public.users where id <> all(${users.map((u) => u.id)}::uuid[])`;
  for (const u of users) {
    await tx`
      insert into public.users (id, email, created_at) values (${u.id}, ${u.email}, ${u.created_at})
      on conflict (id) do update set email = excluded.email, created_at = excluded.created_at
    `;
  }
}

async function checkUsers(users) {
  const rows = await target`select id, email, created_at from public.users order by id`;
  const key = (u) => `${u.id} ${u.email} ${new Date(u.created_at).toISOString()}`;
  check("users", sameList(users.map(key), rows.map(key)), `${users.length} source, ${rows.length} target`);
}

// --- Tables --------------------------------------------------------------

async function copyTable(tx, table) {
  const rows = await source`select to_json(t)::text as j from ${source("public." + table)} t`;
  // json_populate_recordset keeps jsonb values and numbers exactly as they were.
  for (let i = 0; i < rows.length; i += 200) {
    const batch = `[${rows.slice(i, i + 200).map((r) => r.j).join(",")}]`;
    await tx`
      insert into ${tx("public." + table)}
      select * from json_populate_recordset(null::${tx("public." + table)}, ${batch}::text::json)
    `;
  }
}

async function checkTable(table) {
  const [a, b] = await Promise.all([rowDigests(source, table), rowDigests(target, table)]);
  check(table, sameList(a, b), `${a.length} source, ${b.length} target`);
}

// Per (user, app_id, key), so a mismatch says which value differs.
async function checkAppDataValues() {
  const query = (sql) => sql`
    select user_id || ' ' || app_id || ' ' || key as k, md5(value::text) as d from public.app_data
  `;
  const [a, b] = await Promise.all([query(source), query(target)]);
  const theirs = new Map(b.map((r) => [r.k, r.d]));
  const bad = a.filter((r) => theirs.get(r.k) !== r.d).map((r) => r.k);
  check("app_data values by key", bad.length === 0 && a.length === b.length, bad.join(", "));
}

// --- Files ---------------------------------------------------------------

async function sourceObjects() {
  return source`
    select bucket_id as bucket, name, (metadata->>'size')::bigint as size
    from storage.objects where bucket_id = any(${BUCKETS}) order by bucket_id, name
  `;
}

async function download(objects) {
  for (const bucket of BUCKETS) await rm(path.join(filesDir, bucket), { recursive: true, force: true });
  const digests = new Map();
  for (const o of objects) {
    const url = `${supabaseUrl}/storage/v1/object/authenticated/${o.bucket}/${o.name.split("/").map(encodeURIComponent).join("/")}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey } });
    if (!res.ok) throw new Error(`Download of ${o.bucket}/${o.name} failed: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length !== Number(o.size)) throw new Error(`${o.bucket}/${o.name}: got ${buf.length} bytes, expected ${o.size}`);
    const file = path.join(filesDir, o.bucket, o.name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file + ".part", buf);
    await rename(file + ".part", file);
    digests.set(`${o.bucket}/${o.name}`, sha256(buf));
  }
  return digests;
}

function remote() {
  const m = /^([^/:]+):(.*)$/.exec(targetStorage);
  return m && { host: m[1], dir: m[2] };
}

function upload() {
  for (const bucket of BUCKETS) {
    const from = path.join(filesDir, bucket) + "/";
    execFileSync("mkdir", ["-p", from]);
    const to = `${targetStorage.replace(/\/+$/, "")}/${bucket}/`;
    execFileSync("rsync", ["-a", "--delete", "--checksum", "--mkpath", "-e", sshCommand, from, to], { stdio: "inherit" });
  }
}

// "<sha256>  ./<bucket>/<name>" lines for every file under the target's buckets.
async function targetDigests() {
  const r = remote();
  let out;
  if (r) {
    const dirs = BUCKETS.map((b) => `'${b}'`).join(" ");
    const cmd = `cd '${r.dir}' && for d in ${dirs}; do [ -d "$d" ] && find "$d" -type f -exec sha256sum {} +; done; true`;
    out = execFileSync("sh", ["-c", `${sshCommand} ${r.host} "$0"`, cmd], { encoding: "utf8" });
  } else {
    const lines = [];
    for (const bucket of BUCKETS) {
      const dir = path.join(targetStorage, bucket);
      const files = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
      for (const f of files) {
        if (!f.isFile()) continue;
        const full = path.join(f.parentPath, f.name);
        lines.push(`${sha256(await readFile(full))}  ${path.relative(targetStorage, full)}`);
      }
    }
    out = lines.join("\n");
  }
  return new Map(
    out
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [digest, ...rest] = line.split("  ");
        return [rest.join("  ").replace(/^\.\//, ""), digest];
      })
  );
}

function checkFiles(objects, ours, theirs) {
  const bytes = objects.reduce((n, o) => n + Number(o.size), 0);
  const bad = [...ours].filter(([k, d]) => theirs.get(k) !== d).map(([k]) => k);
  const extra = [...theirs.keys()].filter((k) => !ours.has(k));
  check("files", bad.length === 0 && extra.length === 0, `${ours.size} source (${bytes} bytes), ${theirs.size} target`);
  if (bad.length) console.log(`     differ or missing: ${bad.join(", ")}`);
  if (extra.length) console.log(`     only on target: ${extra.join(", ")}`);
}

// --- Main ----------------------------------------------------------------

async function counts(sql, table) {
  const [{ n }] = await sql`select count(*)::int as n from ${sql("public." + table)}`;
  return n;
}

try {
  const started = Date.now();
  const users = await sourceUsers();
  const objects = await sourceObjects();

  if (dryRun) {
    console.log(`${"table".padEnd(20)} source  target`);
    const [targetUsers] = await target`select count(*)::int as n from public.users`;
    console.log(`${"users".padEnd(20)} ${String(users.length).padStart(6)}  ${String(targetUsers.n).padStart(6)}`);
    for (const table of TABLES) {
      const [a, b] = await Promise.all([counts(source, table), counts(target, table)]);
      console.log(`${table.padEnd(20)} ${String(a).padStart(6)}  ${String(b).padStart(6)}`);
    }
    for (const bucket of BUCKETS) {
      const mine = objects.filter((o) => o.bucket === bucket);
      const bytes = mine.reduce((n, o) => n + Number(o.size), 0);
      console.log(`files in ${bucket}: ${mine.length} (${bytes} bytes)`);
    }
    const theirs = await targetDigests();
    console.log(`files on target: ${theirs.size}`);
  } else {
    await target.begin(async (tx) => {
      await copyUsers(tx, users);
      for (const table of [...TABLES].reverse()) await tx`delete from ${tx("public." + table)}`;
      for (const table of TABLES) await copyTable(tx, table);
    });
    console.log(`database copied in ${((Date.now() - started) / 1000).toFixed(1)} s`);

    const ours = await download(objects);
    upload();
    console.log(`files copied in ${((Date.now() - started) / 1000).toFixed(1)} s`);

    await checkUsers(users);
    for (const table of TABLES) await checkTable(table);
    await checkAppDataValues();
    checkFiles(objects, ours, await targetDigests());
    console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }
} catch (err) {
  console.error(err.message);
  failed = true;
} finally {
  await Promise.all([source.end(), target.end()]);
}
process.exit(failed ? 1 : 0);
