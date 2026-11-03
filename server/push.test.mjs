import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import webpush from "web-push";
import { parseSubscription } from "./push.js";
import { setup } from "./testing.mjs";

const vapid = { ...webpush.generateVAPIDKeys(), subject: "https://apps.example.com" };

// What the push services answer: endpoint → status (default 201).
let statusFor = new Map();
let sent = [];
async function sendNotification(sub, body, options) {
  sent.push({ sub, body: JSON.parse(body), options });
  const status = statusFor.get(sub.endpoint) ?? 201;
  if (status >= 300) throw Object.assign(new Error(`status ${status}`), { statusCode: status });
  return { statusCode: status };
}

let t;
let off;
before(async () => {
  t = await setup({ vapid, sendNotification });
  off = await setup();
});
after(() => Promise.all([t.close(), off.close()]));
beforeEach(() => {
  statusFor = new Map();
  sent = [];
});

function subscription() {
  return {
    endpoint: `https://push.example.com/send/${randomBytes(8).toString("hex")}`,
    expirationTime: null,
    keys: { p256dh: randomBytes(65).toString("base64url"), auth: randomBytes(16).toString("base64url") },
  };
}

async function subscribe(user, appId, sub = subscription(), extra = {}) {
  const res = await t.request("/api/push/subscriptions", {
    method: "POST",
    headers: user.headers,
    json: { appId, subscription: sub, ...extra },
  });
  assert.equal(res.status, 204);
  return sub;
}

async function rows(userId) {
  return [...(await t.sql`select endpoint, app_id from public.push_subscriptions where user_id = ${userId} order by created_at`)];
}

test("the key is served without a session", async () => {
  const res = await t.request("/api/push/key");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { publicKey: vapid.publicKey });
});

test("send reaches the user's subscriptions for that app only", async () => {
  const a = await t.signedIn();
  const b = await t.signedIn();
  const phone = await subscribe(a, "german");
  const laptop = await subscribe(a, "german");
  await subscribe(a, "recipes");
  await subscribe(b, "german");

  const n = await t.push.send(a.id, "german", { title: "Hallo", url: "/german" }, { ttl: 60, urgency: "high" });
  assert.equal(n, 2);
  assert.deepEqual(sent.map((s) => s.sub.endpoint).sort(), [phone.endpoint, laptop.endpoint].sort());
  assert.deepEqual(sent[0].sub.keys, sent[0].sub.endpoint === phone.endpoint ? phone.keys : laptop.keys);
  assert.deepEqual(sent[0].body, { title: "Hallo", url: "/german" });
  assert.equal(sent[0].options.TTL, 60);
  assert.equal(sent[0].options.urgency, "high");
  assert.equal(sent[0].options.vapidDetails.publicKey, vapid.publicKey);
  assert.equal(sent[0].options.vapidDetails.subject, vapid.subject);
});

test("subscriptions the push service reports gone are deleted; other failures keep them", async () => {
  const a = await t.signedIn();
  const gone = await subscribe(a, "german");
  const missing = await subscribe(a, "german");
  const flaky = await subscribe(a, "german");
  const fine = await subscribe(a, "german");
  statusFor.set(gone.endpoint, 410);
  statusFor.set(missing.endpoint, 404);
  statusFor.set(flaky.endpoint, 500);

  assert.equal(await t.push.send(a.id, "german", { title: "x" }), 1);
  assert.deepEqual((await rows(a.id)).map((r) => r.endpoint).sort(), [flaky.endpoint, fine.endpoint].sort());
});

test("subscribing again updates the row, and another user can take the endpoint over", async () => {
  const a = await t.signedIn();
  const b = await t.signedIn();
  const sub = await subscribe(a, "german");
  await subscribe(a, "german", sub);
  assert.equal((await rows(a.id)).length, 1);

  // Same browser, signed in as b now.
  await subscribe(b, "german", sub);
  assert.deepEqual(await rows(a.id), []);
  assert.equal((await rows(b.id)).length, 1);
  assert.equal(await t.push.send(a.id, "german", { title: "x" }), 0);
});

test("a renewed subscription replaces the old one, but only the user's own", async () => {
  const a = await t.signedIn();
  const b = await t.signedIn();
  const old = await subscribe(a, "german");
  const others = await subscribe(b, "german");
  const renewed = await subscribe(a, "german", subscription(), { replaces: old.endpoint });
  assert.deepEqual((await rows(a.id)).map((r) => r.endpoint), [renewed.endpoint]);

  await subscribe(a, "german", subscription(), { replaces: others.endpoint });
  assert.deepEqual((await rows(b.id)).map((r) => r.endpoint), [others.endpoint]);
});

test("unsubscribing removes only the user's own subscription", async () => {
  const a = await t.signedIn();
  const b = await t.signedIn();
  const sub = await subscribe(a, "german");
  const del = (user) =>
    t.request("/api/push/subscriptions", { method: "DELETE", headers: user.headers, json: { endpoint: sub.endpoint } });

  assert.equal((await del(b)).status, 404);
  assert.equal((await rows(a.id)).length, 1);
  assert.equal((await del(a)).status, 204);
  assert.deepEqual(await rows(a.id), []);
  assert.equal((await del(a)).status, 404);
});

test("the test endpoint pushes to the caller's own subscriptions", async () => {
  const a = await t.signedIn();
  const sub = await subscribe(a, "climbing-tracker");
  const res = await t.request("/api/push/test", { method: "POST", headers: a.headers, json: { appId: "climbing-tracker" } });
  assert.deepEqual(await res.json(), { sent: 1 });
  assert.equal(sent[0].sub.endpoint, sub.endpoint);
  assert.equal(sent[0].body.title, "Test notification");
});

test("the routes need a session and valid input", async () => {
  const json = { appId: "german", subscription: subscription() };
  assert.equal((await t.request("/api/push/subscriptions", { method: "POST", json })).status, 401);
  assert.equal((await t.request("/api/push/subscriptions", { method: "DELETE", json: { endpoint: "x" } })).status, 401);
  assert.equal((await t.request("/api/push/test", { method: "POST", json: { appId: "german" } })).status, 401);

  const a = await t.signedIn();
  const post = (body) => t.request("/api/push/subscriptions", { method: "POST", headers: a.headers, json: body });
  assert.equal((await post({ ...json, appId: "../x" })).status, 400);
  assert.equal((await post({ ...json, subscription: { ...json.subscription, endpoint: "http://push.example.com/x" } })).status, 400);
  assert.equal((await post({ ...json, subscription: { endpoint: json.subscription.endpoint } })).status, 400);
  assert.equal((await post({ ...json, replaces: 5 })).status, 400);
  assert.deepEqual(await rows(a.id), []);
});

test("parseSubscription keeps only what's needed", () => {
  const sub = subscription();
  assert.deepEqual(parseSubscription(sub), { endpoint: sub.endpoint, ...sub.keys });
  assert.equal(parseSubscription(null), null);
  assert.equal(parseSubscription({ ...sub, endpoint: "not a url" }), null);
  assert.equal(parseSubscription({ ...sub, keys: { ...sub.keys, auth: "has spaces" } }), null);
});

test("without VAPID keys push is off", async () => {
  const a = await off.signedIn();
  assert.equal(off.push.enabled, false);
  assert.equal((await off.request("/api/push/key")).status, 503);
  const res = await off.request("/api/push/subscriptions", {
    method: "POST",
    headers: a.headers,
    json: { appId: "german", subscription: subscription() },
  });
  assert.equal(res.status, 503);
  assert.equal(await off.push.send(a.id, "german", { title: "x" }), 0);
});

// ---------- scheduled pushes ----------

function schedule(user, appId, id, body) {
  return t.request(`/api/push/scheduled/${appId}/${id}`, { method: "PUT", headers: user.headers, json: body });
}

async function scheduledIds(userId) {
  return (await t.sql`select id from public.push_scheduled where user_id = ${userId} order by id`).map((r) => r.id);
}

test("a scheduled push goes out once it's due, and only once", async () => {
  const a = await t.signedIn();
  const sub = await subscribe(a, "climbing-tracker");
  const payload = { title: "Rest over", tag: "rest" };
  assert.equal((await schedule(a, "climbing-tracker", "r1", { at: Date.now() - 1000, payload, ttl: 120, urgency: "high" })).status, 204);
  assert.equal((await schedule(a, "climbing-tracker", "later", { at: Date.now() + 60 * 60 * 1000, payload })).status, 204);

  await t.push.flush();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].sub.endpoint, sub.endpoint);
  assert.deepEqual(sent[0].body, payload);
  assert.equal(sent[0].options.TTL, 120);
  assert.equal(sent[0].options.urgency, "high");
  assert.deepEqual(await scheduledIds(a.id), ["later"]);

  await t.push.flush();
  assert.equal(sent.length, 1);
  await t.sql`delete from public.push_scheduled where user_id = ${a.id}`;
});

test("the running scheduler sends at the scheduled time", async () => {
  const a = await t.signedIn();
  await subscribe(a, "climbing-tracker");
  const stop = t.push.startScheduler();
  try {
    await t.push.flush();
    const at = Date.now() + 400;
    await schedule(a, "climbing-tracker", "soon", { at, payload: { title: "Rest over" } });
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(sent.length, 0);
    for (let i = 0; i < 40 && !sent.length; i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(sent.length, 1);
    assert.ok(Date.now() >= at - 250);
  } finally {
    stop();
  }
});

test("scheduling an id again replaces it; cancelling drops it, by id or prefix, only the user's own", async () => {
  const a = await t.signedIn();
  const b = await t.signedIn();
  const at = Date.now() + 60 * 60 * 1000;
  const payload = { title: "x" };
  for (const id of ["dev1-0", "dev1-1", "dev2-0"]) await schedule(a, "climbing-tracker", id, { at, payload });
  await schedule(b, "climbing-tracker", "dev1-0", { at, payload });
  await schedule(a, "climbing-tracker", "dev1-0", { at: at + 1000, payload: { title: "y" } });
  const [row] = await t.sql`select send_at, payload from public.push_scheduled where user_id = ${a.id} and id = 'dev1-0'`;
  assert.equal(row.send_at.getTime(), at + 1000);
  assert.deepEqual(row.payload, { title: "y" });

  const del = (user, path) => t.request(`/api/push/scheduled/${path}`, { method: "DELETE", headers: user.headers });
  assert.equal((await del(a, "climbing-tracker?prefix=dev1-")).status, 204);
  assert.deepEqual(await scheduledIds(a.id), ["dev2-0"]);
  assert.deepEqual(await scheduledIds(b.id), ["dev1-0"]);
  assert.equal((await del(a, "climbing-tracker/dev2-0")).status, 204);
  assert.equal((await del(a, "climbing-tracker/dev2-0")).status, 204);
  assert.deepEqual(await scheduledIds(a.id), []);
  // A prefix with LIKE wildcards in it matches them literally.
  await schedule(a, "climbing-tracker", "aXb", { at, payload });
  await del(a, "climbing-tracker?prefix=a_");
  assert.deepEqual(await scheduledIds(a.id), ["aXb"]);
  await t.sql`delete from public.push_scheduled where user_id in (${a.id}, ${b.id})`;
});

test("a scheduled push more than its ttl late is dropped", async () => {
  const a = await t.signedIn();
  await subscribe(a, "climbing-tracker");
  await t.sql`
    insert into public.push_scheduled (user_id, app_id, id, send_at, payload, ttl, urgency)
    values (${a.id}, 'climbing-tracker', 'stale', now() - interval '10 minutes', ${t.sql.json({ title: "x" })}, 60, 'high')
  `;
  await t.push.flush();
  assert.equal(sent.length, 0);
  assert.deepEqual(await scheduledIds(a.id), []);
});

test("scheduling checks its input and how many are waiting", async () => {
  const body = { at: Date.now() + 1000, payload: { title: "x" } };
  assert.equal((await t.request("/api/push/scheduled/climbing-tracker/x", { method: "PUT", json: body })).status, 401);
  assert.equal((await t.request("/api/push/scheduled/climbing-tracker/x", { method: "DELETE" })).status, 401);

  const a = await t.signedIn();
  const bad = [
    ["climbing-tracker", "x", { ...body, at: Date.now() + 2 * 24 * 60 * 60 * 1000 }],
    ["climbing-tracker", "x", { ...body, at: Date.now() - 5 * 60 * 1000 }],
    ["climbing-tracker", "x", { ...body, at: "soon" }],
    ["climbing-tracker", "x", { ...body, payload: { body: "no title" } }],
    ["climbing-tracker", "x", { ...body, payload: { title: "x".repeat(4000) } }],
    ["climbing-tracker", "x", { ...body, urgency: "now" }],
    ["climbing-tracker", "x", { ...body, ttl: -1 }],
    ["climbing-tracker", "x.y", body],
  ];
  for (const [app, id, b] of bad) assert.equal((await schedule(a, app, id, b)).status, 400, JSON.stringify(b).slice(0, 80));
  assert.equal((await t.request("/api/push/scheduled/climbing-tracker", { method: "DELETE", headers: a.headers })).status, 400);

  await t.sql`
    insert into public.push_scheduled (user_id, app_id, id, send_at, payload, ttl, urgency)
    select ${a.id}, 'climbing-tracker', 'n' || i, now() + interval '1 hour', '{"title":"x"}', 60, 'normal'
    from generate_series(1, 50) i
  `;
  assert.equal((await schedule(a, "climbing-tracker", "one-more", body)).status, 429);
  // Replacing one that's already there is fine.
  assert.equal((await schedule(a, "climbing-tracker", "n1", body)).status, 204);
  await t.sql`delete from public.push_scheduled where user_id = ${a.id}`;
});
