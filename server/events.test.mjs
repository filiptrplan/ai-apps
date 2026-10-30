import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./testing.mjs";

let t;
before(async () => (t = await setup()));
after(() => t.close());

function put(user, app, key, value) {
  return t.request(`/api/data/${app}/${key}`, { method: "PUT", headers: user.headers, json: { value } }).then((r) => r.json());
}

test("topics are checked, and the data topic needs a session", async () => {
  assert.equal((await t.request("/api/events")).status, 400);
  assert.equal((await t.request("/api/events?topics=data,nope")).status, 400);
  assert.equal((await t.request("/api/events?topics=data")).status, 401);
});

test("the stream has the SSE headers", async () => {
  const s = await t.stream("/api/events?topics=mo");
  assert.equal(s.res.status, 200);
  assert.equal(s.res.headers.get("content-type"), "text/event-stream");
  assert.match(s.res.headers.get("cache-control"), /no-cache/);
  assert.equal(s.res.headers.get("x-accel-buffering"), "no");
  s.close();
});

test("an app_data write reaches only its owner's streams", async () => {
  const a = await t.signedIn();
  const b = await t.signedIn();
  const sa = await t.stream("/api/events?topics=data", { headers: a.headers });
  const sb = await t.stream("/api/events?topics=data,mo", { headers: b.headers });
  const smo = await t.stream("/api/events?topics=mo");

  const { updated_at } = await put(a, "german", "cards", [1]);
  const got = await sa.next();
  // Same updated_at as the PUT returned, so the page can spot its own echo.
  assert.deepEqual(got, { event: "message", data: { table: "app_data", app_id: "german", key: "cards", updated_at } });

  assert.equal(await sb.next(300), null);
  assert.equal(await smo.next(300), null);
  for (const s of [sa, sb, smo]) s.close();
});

test("a signed-in stream without the data topic gets no app_data events", async () => {
  const a = await t.signedIn();
  const s = await t.stream("/api/events?topics=mo", { headers: a.headers });
  await put(a, "recipes", "list", "x");
  assert.equal(await s.next(300), null);
  s.close();
});

test("updated_at in the event matches the API's format, whatever the writer's time zone", async () => {
  const a = await t.signedIn();
  const s = await t.stream("/api/events?topics=data", { headers: a.headers });
  await t.sql.begin(async (tx) => {
    await tx`set local time zone 'Europe/Ljubljana'`;
    await tx`insert into public.app_data (user_id, app_id, key, value) values (${a.id}, 'app', 'tz', '1'::jsonb)`;
  });
  const { data } = await s.next();
  const row = await (await t.request("/api/data/app/tz", { headers: a.headers })).json();
  assert.equal(data.updated_at, row.updated_at);
  s.close();
});

test("Marsova changes reach every mo stream, signed in or not", async () => {
  const a = await t.signedIn();
  const anon = await t.stream("/api/events?topics=mo");
  const signed = await t.stream("/api/events?topics=data,mo", { headers: a.headers });
  const dataOnly = await t.stream("/api/events?topics=data", { headers: a.headers });

  // An RPC that writes two tables in one transaction.
  const login = await t.request("/api/mo/rpc/mo_admin_bootstrap_pin", { method: "POST", json: { p_pin: "1234" } });
  const { token } = await login.json();
  await t.request("/api/mo/rpc/mo_admin_create_category", {
    method: "POST", json: { p_token: token, p_emoji: "🧹", p_name: "Kuhinja", p_color: "#fff" },
  });

  for (const s of [anon, signed]) {
    assert.deepEqual((await s.next()).data, { table: "mo_categories" });
  }
  assert.equal(await dataOnly.next(300), null);
  for (const s of [anon, signed, dataOnly]) s.close();
});

test("a statement touching many rows sends one event", async () => {
  const s = await t.stream("/api/events?topics=mo");
  await t.sql`insert into public.mo_categories (emoji, name, color, sort_order) values ('a', 'A', '#000', 1), ('b', 'B', '#000', 2)`;
  assert.deepEqual((await s.next()).data, { table: "mo_categories" });
  assert.equal(await s.next(300), null);
  s.close();
});

test("when the LISTEN connection drops, streams get a resync and events keep coming", async () => {
  const a = await t.signedIn();
  const s = await t.stream("/api/events?topics=data", { headers: a.headers });
  await t.sql`
    select pg_terminate_backend(pid) from pg_stat_activity
    where application_name = 'ai-apps-listen' and datname = current_database()
  `;
  assert.equal((await s.next(5000))?.event, "resync");

  const { updated_at } = await put(a, "app", "after", 1);
  assert.equal((await s.next()).data.updated_at, updated_at);
  s.close();
});

test("closed streams are forgotten", async () => {
  async function settled(size) {
    for (let i = 0; i < 50 && t.events.size !== size; i++) await new Promise((r) => setTimeout(r, 20));
    return t.events.size;
  }
  // The earlier tests' streams close in the background.
  assert.equal(await settled(0), 0);
  const s = await t.stream("/api/events?topics=mo");
  assert.equal(t.events.size, 1);
  s.close();
  assert.equal(await settled(0), 0);
});
