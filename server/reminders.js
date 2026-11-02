// Daily reminders: once a minute, every user whose German settings have the
// reminder on and whose local time (in the reminder's time zone) has just
// passed the chosen time gets a push listing what's left of today's tasks
// (german/model.js reminderFor); nothing when all of it is done. Each user
// gets at most one per local day, recorded in push_reminders_sent, so a
// restart doesn't send it twice. One missed while the server was down is
// still sent if it's back within WINDOW_MIN.

import { APP_ID, KEYS, normSettings, reminderFor } from "../german/model.js";

const KIND = "german-daily";
const WINDOW_MIN = 60;
const ROLLOVER_HOURS = 4; // as german/model.js: a study day runs 4am to 4am
const MINUTE_MS = 60 * 1000;

// { date: "2026-11-02", minutes } for `now` on the wall clock of `tz`, or
// null when tz isn't a valid time zone.
export function localClock(now, tz) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(now));
  } catch {
    return null;
  }
  const get = (type) => parts.find((p) => p.type === type).value;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

export function createReminders({ sql, appData, push }) {
  async function read(userId, key, fallback) {
    return (await appData.get(userId, APP_ID, key))?.value ?? fallback;
  }

  async function remind(userId, now) {
    const settings = normSettings(await read(userId, KEYS.settings, null));
    const { on, time, tz } = settings.reminder;
    if (!on) return false;
    const clock = localClock(now, tz);
    if (!clock) return false;
    const [h, m] = time.split(":").map(Number);
    const target = h * 60 + m;
    if (clock.minutes < target || clock.minutes >= target + WINDOW_MIN) return false;

    const claimed = await sql`
      insert into public.push_reminders_sent (user_id, kind, day) values (${userId}, ${KIND}, ${clock.date})
      on conflict do nothing returning 1
    `;
    if (!claimed.length) return false;

    const studyDay = localClock(now - ROLLOVER_HOURS * 60 * MINUTE_MS, tz).date;
    const [cards, suggest, log] = await Promise.all([
      read(userId, KEYS.cards, []),
      read(userId, KEYS.suggest, []),
      read(userId, KEYS.log, {}),
    ]);
    const reminder = reminderFor({ settings, cards, suggest, log }, studyDay, now);
    if (!reminder) return false;
    await push.send(userId, APP_ID, { ...reminder, tag: KIND, url: "/german" }, { ttl: 6 * 60 * 60 });
    return true;
  }

  // Resolves with how many reminders went out.
  async function run(now = Date.now()) {
    if (!push.enabled) return 0;
    await sql`delete from public.push_reminders_sent where day < current_date - 7`;
    let sent = 0;
    for (const userId of await appData.usersWith(APP_ID, KEYS.settings)) {
      try {
        if (await remind(userId, now)) sent++;
      } catch (err) {
        console.error("reminders: failed for a user:", err.message);
      }
    }
    return sent;
  }

  function start({ intervalMs = MINUTE_MS } = {}) {
    if (!push.enabled) return () => {};
    const tick = () => run().catch((err) => console.error("reminders:", err.message));
    tick();
    const timer = setInterval(tick, intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }

  return { run, start };
}
