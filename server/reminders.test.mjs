import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import webpush from "web-push";
import { KEYS } from "../german/model.js";
import { localClock } from "./reminders.js";
import { setup } from "./testing.mjs";

const vapid = { ...webpush.generateVAPIDKeys(), subject: "https://apps.example.com" };
let sent = [];
async function sendNotification(sub, body) {
  sent.push({ endpoint: sub.endpoint, body: JSON.parse(body) });
  return { statusCode: 201 };
}

let t;
before(async () => (t = await setup({ vapid, sendNotification })));
after(() => t.close());
beforeEach(async () => {
  sent = [];
  // Every test's users are checked on every run; start each from none.
  await t.sql`delete from public.app_data where app_id = 'german'`;
});

// Mon 2 Nov 2026, 18:05 in Zurich (UTC+1).
const NOW = Date.UTC(2026, 10, 2, 17, 5);
const MIN = 60 * 1000;

const settings = (reminder) => ({ writingDays: [], podcastDays: [], reminder: { on: true, time: "18:00", tz: "Europe/Zurich", ...reminder } });
const dueCard = { id: "c1", kind: "word", en: "house", de: "Haus", added: 0, intro: "2026-10-01", srs: { due: NOW - 60 * MIN } };

async function user({ reminder, cards = [dueCard], log = {} } = {}) {
  const u = await t.signedIn();
  await t.sql`
    insert into public.push_subscriptions (endpoint, user_id, app_id, p256dh, auth)
    values (${`https://push.example.com/${randomBytes(6).toString("hex")}`}, ${u.id}, 'german', 'k', 'a')
  `;
  await t.appData.put(u.id, "german", KEYS.settings, settings(reminder));
  await t.appData.put(u.id, "german", KEYS.cards, cards);
  await t.appData.put(u.id, "german", KEYS.log, log);
  return u;
}

test("the reminder goes out once, after its time, with what's left", async () => {
  await user();
  assert.equal(await t.reminders.run(NOW - 10 * MIN), 0); // 17:55
  assert.equal(await t.reminders.run(NOW), 1);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].body, { title: "Deutsch", body: "Still to do today: cards (about 1 min).", tag: "german-daily", url: "/german" });
  assert.equal(await t.reminders.run(NOW + 5 * MIN), 0);
  assert.equal(sent.length, 1);
});

test("it lists every open task of the day", async () => {
  await user({ reminder: {}, log: {} });
  await t.appData.put((await t.sql`select user_id from public.app_data where app_id = 'german' limit 1`)[0].user_id, "german", KEYS.settings, {
    ...settings({}),
    writingDays: [0],
    podcastDays: [0],
  });
  await t.reminders.run(NOW);
  assert.equal(sent[0].body.body, "Still to do today: cards (about 1 min), writing and the podcast.");
});

test("nothing is sent when it's all done, off, late, or on a day without tasks", async () => {
  await user({ log: { "2026-11-02": { cards: true } } });
  await user({ cards: [] }); // a card day with no cards to study
  await user({ reminder: { on: false } });
  await user({ reminder: { tz: "Not/AZone" } });
  await user({ reminder: { time: "16:00" } }); // over an hour ago
  assert.equal(await t.reminders.run(NOW), 0);
  // Saturday: no tasks.
  await t.sql`delete from public.app_data where app_id = 'german'`;
  await user();
  assert.equal(await t.reminders.run(NOW + 5 * 24 * 60 * MIN), 0);
  assert.equal(sent.length, 0);
});

test("the time is the reminder's own time zone, and late at night counts for the evening's study day", async () => {
  await user({ reminder: { time: "12:00", tz: "America/New_York" } }); // 12:05 there
  assert.equal(await t.reminders.run(NOW), 1);
  // 01:30 Tuesday in Zurich is still Monday's study day: Monday's log counts.
  await user({ reminder: { time: "01:30" }, log: { "2026-11-02": { cards: true } } });
  assert.equal(await t.reminders.run(Date.UTC(2026, 10, 3, 0, 30)), 0);
  assert.equal(sent.length, 1);
});

test("localClock", () => {
  assert.deepEqual(localClock(NOW, "Europe/Zurich"), { date: "2026-11-02", minutes: 18 * 60 + 5 });
  assert.deepEqual(localClock(Date.UTC(2026, 6, 1, 22, 30), "Europe/Zurich"), { date: "2026-07-02", minutes: 30 });
  assert.deepEqual(localClock(NOW, ""), { date: "2026-11-02", minutes: 17 * 60 + 5 });
  assert.equal(localClock(NOW, "Not/AZone"), null);
});
