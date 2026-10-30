import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./testing.mjs";

let t;
before(async () => (t = await setup()));
after(() => t.close());

async function rpc(fn, args) {
  const res = await t.request(`/api/mo/rpc/${fn}`, { method: "POST", json: args ?? {} });
  return { status: res.status, body: await res.json() };
}

async function table(name) {
  return (await t.request(`/api/mo/${name}`)).json();
}

test("only allowlisted functions can be called", async () => {
  for (const fn of ["mo_assert_admin", "pg_sleep", "set_app_data_updated_at", "mo_points_summary;drop table users", "__proto__"]) {
    const res = await t.request(`/api/mo/rpc/${encodeURIComponent(fn)}`, { method: "POST", json: {} });
    assert.equal(res.status, 404, fn);
  }
});

test("unknown argument names are refused", async () => {
  const res = await rpc("mo_admin_login", { p_pin: "1234", "p_pin) ; drop table users; --": 1 });
  assert.deepEqual(res, { status: 400, body: { error: "invalid_arguments" } });
});

test("only the app's tables can be read", async () => {
  for (const name of ["mo_admin_pin", "mo_admin_sessions", "users", "sessions", "app_data"]) {
    assert.equal((await t.request(`/api/mo/${name}`)).status, 404, name);
  }
  assert.deepEqual(await table("mo_settings"), { id: true, display_name: "Klara" });
  assert.deepEqual(await table("mo_chores"), []);
});

test("the PIN flow: bootstrap once, log in, admin calls need a valid token", async () => {
  assert.deepEqual((await rpc("mo_admin_pin_status")).body, { configured: false });
  assert.deepEqual(await rpc("mo_admin_login", { p_pin: "1234" }), { status: 400, body: { error: "not_configured" } });
  assert.deepEqual(await rpc("mo_admin_bootstrap_pin", { p_pin: "12" }), { status: 400, body: { error: "pin_too_short" } });

  const boot = await rpc("mo_admin_bootstrap_pin", { p_pin: "1234" });
  assert.equal(boot.status, 200);
  assert.match(boot.body.token, /^[0-9a-f-]{36}$/);
  assert.deepEqual(await rpc("mo_admin_bootstrap_pin", { p_pin: "9999" }), { status: 400, body: { error: "already_configured" } });
  assert.deepEqual((await rpc("mo_admin_pin_status")).body, { configured: true });

  assert.deepEqual(await rpc("mo_admin_login", { p_pin: "0000" }), { status: 400, body: { error: "invalid_pin" } });
  const login = await rpc("mo_admin_login", { p_pin: "1234" });
  assert.equal(login.status, 200);
  const token = login.body.token;
  assert.equal((await rpc("mo_admin_session_valid", { p_token: token })).body, true);

  // Admin functions without a token, with a made-up one, or a malformed one.
  const args = { p_emoji: "🧹", p_name: "Hiša", p_color: "" };
  assert.deepEqual(await rpc("mo_admin_create_category", { ...args, p_token: null }), { status: 401, body: { error: "unauthorized" } });
  assert.deepEqual(
    await rpc("mo_admin_create_category", { ...args, p_token: "00000000-0000-0000-0000-000000000000" }),
    { status: 401, body: { error: "unauthorized" } }
  );
  assert.equal((await rpc("mo_admin_create_category", { ...args, p_token: "nope" })).status, 400);
  assert.deepEqual(await table("mo_categories"), []);

  // With the token: a row comes back as an object, like PostgREST's.
  const cat1 = await rpc("mo_admin_create_category", { ...args, p_token: token });
  assert.equal(cat1.status, 200);
  assert.equal(cat1.body.name, "Hiša");
  assert.equal(cat1.body.color, null);
  const cat2 = (await rpc("mo_admin_create_category", { ...args, p_name: "Vrt", p_token: token })).body;

  // uuid[] arguments and void results.
  const reorder = await rpc("mo_admin_reorder_categories", { p_token: token, p_ids: [cat2.id, cat1.body.id] });
  assert.deepEqual(reorder, { status: 200, body: null });
  assert.deepEqual((await table("mo_categories")).map((c) => c.name), ["Vrt", "Hiša"]);

  assert.equal((await rpc("mo_admin_logout", { p_token: token })).status, 200);
  assert.equal((await rpc("mo_admin_session_valid", { p_token: token })).body, false);
});

test("chores, rewards and points work through the user-side functions", async () => {
  const { token } = (await rpc("mo_admin_login", { p_pin: "1234" })).body;
  const chore = (await rpc("mo_admin_create_chore", {
    p_token: token, p_emoji: "🍽️", p_title: "Pomij", p_description: "", p_category_id: null, p_points: 5,
  })).body;
  const reward = (await rpc("mo_admin_create_reward", {
    p_token: token, p_emoji: "🍦", p_title: "Sladoled", p_description: null, p_cost: 4,
  })).body;

  assert.deepEqual(await rpc("mo_request_reward", { p_reward_id: reward.id }), { status: 400, body: { error: "insufficient_points" } });
  const done = await rpc("mo_complete_chore", { p_chore_id: chore.id });
  assert.equal(done.body.kind, "chore_completed");
  assert.deepEqual((await rpc("mo_points_summary")).body, { current_balance: 5, reserved: 0, available: 5, lifetime: 5 });

  const request = (await rpc("mo_request_reward", { p_reward_id: reward.id })).body;
  assert.equal(request.status, "pending");
  assert.deepEqual((await rpc("mo_points_summary")).body, { current_balance: 5, reserved: 4, available: 1, lifetime: 5 });
  assert.equal((await rpc("mo_admin_approve_request", { p_token: token, p_id: request.id, p_message: "Bravo" })).body.status, "approved");

  const log = await table("mo_activity_log");
  assert.deepEqual(log.map((r) => r.kind).sort(), ["chore_completed", "reward_approved", "reward_requested"]);
  assert.deepEqual(await rpc("mo_admin_adjust_points", { p_token: token, p_delta: -100 }), { status: 400, body: { error: "would_go_negative" } });
});
