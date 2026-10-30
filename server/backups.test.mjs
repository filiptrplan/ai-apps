import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./testing.mjs";

let t;
before(async () => (t = await setup()));
after(() => t.close());

function day(offset) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

async function backupsOf(user) {
  return (await t.request("/api/backups", { headers: user.headers })).json();
}

test("the daily snapshot is idempotent, scoped per user, and prunes after 7 days", async () => {
  const a = await t.signedIn();
  const b = await t.signedIn();
  await t.appData.put(a.id, "german", "deck", { v: 1 });
  await t.appData.put(b.id, "recipes", "list", { v: "b" });

  // Eight days of snapshots, oldest first; the value changes each day.
  for (let i = -7; i <= 0; i++) {
    await t.appData.put(a.id, "german", "deck", { v: i });
    assert.ok((await t.appData.snapshotAll(day(i))) >= 2);
  }
  // A second run on the same day changes nothing.
  await t.appData.put(a.id, "german", "deck", { v: "later" });
  assert.equal(await t.appData.snapshotAll(day(0)), 0);

  const list = await backupsOf(a);
  assert.deepEqual(list.map((r) => r.backup_date), [0, -1, -2, -3, -4, -5, -6].map(day));
  assert.equal((await backupsOf(b)).length, 7);

  const [today] = await t.sql`
    select data from public.app_data_backups where user_id = ${a.id} and backup_date = ${day(0)}::date
  `;
  assert.deepEqual(today.data, [{ app_id: "german", key: "deck", value: { v: 0 } }]);
});

test("restore writes the backup's rows back, only for the signed-in user", async () => {
  const a = await t.signedIn();
  const b = await t.signedIn();
  await t.appData.put(a.id, "german", "deck", "old");
  await t.appData.put(b.id, "german", "deck", "b's");
  await t.sql`delete from public.app_data_backups`;
  await t.appData.snapshotAll(day(0));
  await t.appData.put(a.id, "german", "deck", "new");
  await t.appData.put(a.id, "german", "other", "made later");

  const res = await t.request(`/api/backups/${day(0)}/restore`, { method: "POST", headers: a.headers });
  assert.equal(res.status, 204);
  assert.equal((await t.appData.get(a.id, "german", "deck")).value, "old");
  assert.equal((await t.appData.get(a.id, "german", "other")).value, "made later");
  assert.equal((await t.appData.get(b.id, "german", "deck")).value, "b's");
});

test("a user can't list or restore another user's backups", async () => {
  const a = await t.signedIn();
  const b = await t.signedIn();
  await t.appData.put(a.id, "german", "deck", "a's");
  await t.sql`delete from public.app_data_backups`;
  await t.appData.snapshotAll(day(-1));
  await t.appData.put(a.id, "german", "deck", "a's, changed");

  assert.deepEqual(await backupsOf(b), []);
  const res = await t.request(`/api/backups/${day(-1)}/restore`, { method: "POST", headers: b.headers });
  assert.equal(res.status, 404);
  assert.equal(await t.appData.get(b.id, "german", "deck"), null);
  assert.equal((await t.appData.get(a.id, "german", "deck")).value, "a's, changed");
});

test("backups need a session and a valid date", async () => {
  assert.equal((await t.request("/api/backups")).status, 401);
  assert.equal((await t.request(`/api/backups/${day(0)}/restore`, { method: "POST" })).status, 401);
  const a = await t.signedIn();
  assert.equal((await t.request("/api/backups/yesterday/restore", { method: "POST", headers: a.headers })).status, 400);
});
