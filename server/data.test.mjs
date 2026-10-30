import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./testing.mjs";

let t;
before(async () => (t = await setup()));
after(() => t.close());

test("signed out, the data API answers 401", async () => {
  assert.equal((await t.request("/api/data/german/deck")).status, 401);
  assert.equal((await t.request("/api/data/german/deck", { method: "PUT", json: { value: 1 } })).status, 401);
});

test("a stale session cookie counts as signed out", async () => {
  const res = await t.request("/api/data/german/deck", { headers: { cookie: "session=nope" } });
  assert.equal(res.status, 401);
});

test("put then get returns the value and the database's updated_at", async () => {
  const a = await t.signedIn();
  const put = await t.request("/api/data/german/deck", { method: "PUT", headers: a.headers, json: { value: { cards: [1, 2] } } });
  assert.equal(put.status, 200);
  const { updated_at } = await put.json();
  // PostgREST's format, microseconds included.
  assert.match(updated_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,6})?\+00:00$/);

  const get = await t.request("/api/data/german/deck", { headers: a.headers });
  assert.deepEqual(await get.json(), { value: { cards: [1, 2] }, updated_at });
});

test("any JSON value round-trips, including strings and null", async () => {
  const a = await t.signedIn();
  for (const value of ["text", 0, null, [], { nested: { deep: true } }]) {
    await t.request("/api/data/app/k", { method: "PUT", headers: a.headers, json: { value } });
    const res = await t.request("/api/data/app/k", { headers: a.headers });
    assert.deepEqual((await res.json()).value, value);
  }
});

test("a missing row is a 404, a missing value a 400, a bad key a 400", async () => {
  const a = await t.signedIn();
  assert.equal((await t.request("/api/data/german/none", { headers: a.headers })).status, 404);
  assert.equal((await t.request("/api/data/german/x", { method: "PUT", headers: a.headers, json: {} })).status, 400);
  assert.equal((await t.request("/api/data/german/a%20b", { headers: a.headers })).status, 400);
});

test("each user only sees their own rows", async () => {
  const a = await t.signedIn();
  const b = await t.signedIn();
  await t.request("/api/data/recipes/list", { method: "PUT", headers: a.headers, json: { value: "a's" } });

  assert.equal((await t.request("/api/data/recipes/list", { headers: b.headers })).status, 404);
  await t.request("/api/data/recipes/list", { method: "PUT", headers: b.headers, json: { value: "b's" } });

  assert.equal((await (await t.request("/api/data/recipes/list", { headers: a.headers })).json()).value, "a's");
  assert.equal((await (await t.request("/api/data/recipes/list", { headers: b.headers })).json()).value, "b's");
});

test("ifUpdatedAt guards the write: a stale one is a 409", async () => {
  const a = await t.signedIn();
  const first = await (await t.request("/api/data/app/k", { method: "PUT", headers: a.headers, json: { value: 1 } })).json();
  const second = await t.request("/api/data/app/k", {
    method: "PUT", headers: a.headers, json: { value: 2, ifUpdatedAt: first.updated_at },
  });
  assert.equal(second.status, 200);
  const { updated_at } = await second.json();
  assert.notEqual(updated_at, first.updated_at);

  const stale = await t.request("/api/data/app/k", {
    method: "PUT", headers: a.headers, json: { value: 3, ifUpdatedAt: first.updated_at },
  });
  assert.equal(stale.status, 409);
  assert.equal((await (await t.request("/api/data/app/k", { headers: a.headers })).json()).value, 2);
});

test("ifUpdatedAt: null only creates a row that doesn't exist yet", async () => {
  const a = await t.signedIn();
  const create = { method: "PUT", headers: a.headers, json: { value: 1, ifUpdatedAt: null } };
  assert.equal((await t.request("/api/data/app/new", create)).status, 200);
  assert.equal((await t.request("/api/data/app/new", create)).status, 409);
});

test("ifUpdatedAt can't reach another user's row", async () => {
  const a = await t.signedIn();
  const b = await t.signedIn();
  const { updated_at } = await (await t.request("/api/data/app/k", { method: "PUT", headers: a.headers, json: { value: "a" } })).json();
  const res = await t.request("/api/data/app/k", { method: "PUT", headers: b.headers, json: { value: "b", ifUpdatedAt: updated_at } });
  assert.equal(res.status, 409);
  assert.equal((await (await t.request("/api/data/app/k", { headers: a.headers })).json()).value, "a");
});

test("a malformed ifUpdatedAt is a 400", async () => {
  const a = await t.signedIn();
  const res = await t.request("/api/data/app/k", { method: "PUT", headers: a.headers, json: { value: 1, ifUpdatedAt: "soon" } });
  assert.equal(res.status, 400);
});
