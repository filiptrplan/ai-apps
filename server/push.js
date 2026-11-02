// Web Push: notifications that reach a phone or computer even when the app
// isn't open. A page subscribes through its app's service worker (see
// shared/push.js) and sends the subscription here; the server keeps it in
// push_subscriptions and later sends to it through the browser's push
// service, signed with the site's VAPID key and encrypted with the
// subscription's own keys (both done by the web-push package). The service
// worker shows what arrives (shared/push-sw.js).
//
//   const push = createPush({ sql, vapid });
//   await push.send(userId, "german", { title: "Episode ready", url: "/german" });
//
// Payload: { title, body?, tag?, url?, icon?, renotify?, requireInteraction?,
// silent?, vibrate? }. `url` is opened when the notification is tapped
// (default: the app). Push services take at most about 4 KB, so keep it small.
//
// Later sends: push.schedule(userId, appId, id, { at, payload, ttl, urgency })
// sends at `at` (ms timestamp), through the scheduler that index.js starts
// with push.startScheduler(); scheduling the same id again replaces it and
// push.cancel() drops it. A send more than `ttl` seconds late is dropped.
//
// Without `vapid` ({ publicKey, privateKey, subject }) push is off: send()
// does nothing and the routes answer 503.

import express from "express";
import webpush from "web-push";

const MAX_PAYLOAD = 3000;
// The push service keeps an undelivered message this long (seconds) while
// the device is offline, then drops it.
const DEFAULT_TTL = 24 * 60 * 60;

const APP_ID = /^[a-z0-9-]{1,64}$/;
const JOB_ID = /^[A-Za-z0-9_-]{1,100}$/;
const URGENCIES = ["very-low", "low", "normal", "high"];
// How far ahead a push may be scheduled, and how many a user may have waiting.
const MAX_AHEAD_MS = 24 * 60 * 60 * 1000;
const MAX_SCHEDULED = 50;
// The scheduler looks again at least this often, in case a wake-up was missed.
const SCHEDULER_MAX_SLEEP_MS = 60 * 1000;

// The subscription as PushSubscription.toJSON() gives it, or null.
export function parseSubscription(sub) {
  if (!sub || typeof sub !== "object") return null;
  const { endpoint, keys } = sub;
  if (typeof endpoint !== "string" || endpoint.length > 2000) return null;
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const { p256dh, auth } = keys ?? {};
  const b64url = /^[A-Za-z0-9_-]+={0,2}$/;
  if (typeof p256dh !== "string" || !b64url.test(p256dh) || p256dh.length > 200) return null;
  if (typeof auth !== "string" || !b64url.test(auth) || auth.length > 100) return null;
  return { endpoint, p256dh, auth };
}

// `sendNotification` is web-push's, replaced in tests.
export function createPush({ sql, vapid, sendNotification = webpush.sendNotification.bind(webpush) }) {
  const enabled = Boolean(vapid?.publicKey && vapid?.privateKey);
  const vapidDetails = enabled ? { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey } : null;

  async function subscribe(userId, appId, sub, { replaces } = {}) {
    await sql.begin(async (sql) => {
      // A browser that was signed in as someone else hands its endpoint over.
      await sql`
        insert into public.push_subscriptions (endpoint, user_id, app_id, p256dh, auth)
        values (${sub.endpoint}, ${userId}, ${appId}, ${sub.p256dh}, ${sub.auth})
        on conflict (endpoint) do update
          set user_id = excluded.user_id, app_id = excluded.app_id,
              p256dh = excluded.p256dh, auth = excluded.auth
      `;
      if (replaces && replaces !== sub.endpoint) {
        await sql`delete from public.push_subscriptions where endpoint = ${replaces} and user_id = ${userId}`;
      }
    });
  }

  async function unsubscribe(userId, endpoint) {
    const rows = await sql`
      delete from public.push_subscriptions where endpoint = ${endpoint} and user_id = ${userId} returning 1
    `;
    return rows.length > 0;
  }

  // Sends to every subscription the user has for the app. Resolves with
  // how many accepted it; never throws for a failed delivery. `ttl` is in
  // seconds; `urgency` is "very-low" | "low" | "normal" | "high".
  async function send(userId, appId, payload, { ttl = DEFAULT_TTL, urgency = "normal" } = {}) {
    if (!enabled) return 0;
    const body = JSON.stringify(payload);
    checkPayload(payload);
    const subs = await sql`
      select endpoint, p256dh, auth from public.push_subscriptions
      where user_id = ${userId} and app_id = ${appId}
    `;
    const results = await Promise.all(
      subs.map(async (s) => {
        try {
          await sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
            vapidDetails,
            TTL: ttl,
            urgency,
          });
          return true;
        } catch (err) {
          // 404/410: the subscription is gone (unsubscribed, app removed,
          // expired). Anything else may pass, so the row stays.
          if (err.statusCode === 404 || err.statusCode === 410) {
            await sql`delete from public.push_subscriptions where endpoint = ${s.endpoint}`;
          } else {
            console.warn(`push: sending to ${new URL(s.endpoint).host} failed:`, err.statusCode ?? err.message);
          }
          return false;
        }
      })
    );
    return results.filter(Boolean).length;
  }

  function checkPayload(payload) {
    if (Buffer.byteLength(JSON.stringify(payload)) > MAX_PAYLOAD) throw new Error(`push: payload over ${MAX_PAYLOAD} bytes`);
  }

  // Resolves false (and schedules nothing) when the user has MAX_SCHEDULED
  // other pushes waiting.
  async function schedule(userId, appId, id, { at, payload, ttl = 60 * 60, urgency = "normal" }) {
    checkPayload(payload);
    const ok = await sql.begin(async (sql) => {
      const [{ count }] = await sql`
        select count(*)::int as count from public.push_scheduled
        where user_id = ${userId} and not (app_id = ${appId} and id = ${id})
      `;
      if (count >= MAX_SCHEDULED) return false;
      await sql`
        insert into public.push_scheduled (user_id, app_id, id, send_at, payload, ttl, urgency)
        values (${userId}, ${appId}, ${id}, ${new Date(at)}, ${sql.json(payload)}, ${ttl}, ${urgency})
        on conflict (user_id, app_id, id) do update
          set send_at = excluded.send_at, payload = excluded.payload, ttl = excluded.ttl, urgency = excluded.urgency
      `;
      return true;
    });
    if (ok) wake();
    return ok;
  }

  // Drops the scheduled push `id`, or with { prefix } every one whose id
  // starts with it.
  async function cancel(userId, appId, id, { prefix } = {}) {
    if (prefix !== undefined) {
      const pattern = prefix.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
      await sql`delete from public.push_scheduled where user_id = ${userId} and app_id = ${appId} and id like ${pattern}`;
    } else {
      await sql`delete from public.push_scheduled where user_id = ${userId} and app_id = ${appId} and id = ${id}`;
    }
  }

  // Sends what's due, then sleeps until the next one (or a wake()). A row
  // is deleted as it's taken, so two servers overlapping during a deploy
  // never both send it.
  let timer = null;
  let started = false;
  let running = null;
  let again = false;

  async function sendDue() {
    const due = await sql`
      delete from public.push_scheduled where send_at <= now() + interval '200 milliseconds'
      returning user_id, app_id, payload, ttl, urgency, send_at
    `;
    await Promise.all(
      due.map(async (job) => {
        if (Date.now() - job.send_at.getTime() > job.ttl * 1000) return;
        try {
          await send(job.user_id, job.app_id, job.payload, { ttl: job.ttl, urgency: job.urgency });
        } catch (err) {
          console.error("push: scheduled send failed:", err.message);
        }
      })
    );
    const [{ next }] = await sql`select min(send_at) as next from public.push_scheduled`;
    return next ? next.getTime() - Date.now() : SCHEDULER_MAX_SLEEP_MS;
  }

  function arm(ms) {
    clearTimeout(timer);
    timer = setTimeout(tick, Math.min(Math.max(ms, 0), SCHEDULER_MAX_SLEEP_MS));
    timer.unref?.();
  }

  function tick() {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      let sleep = SCHEDULER_MAX_SLEEP_MS;
      try {
        do {
          again = false;
          sleep = await sendDue();
        } while (again);
      } catch (err) {
        console.error("push: scheduler:", err.message);
        sleep = 5000;
      }
      running = null;
      if (started) arm(sleep);
    })();
    return running;
  }

  function wake() {
    if (started) tick();
  }

  function startScheduler() {
    if (!enabled || started) return () => {};
    started = true;
    tick();
    return () => {
      started = false;
      clearTimeout(timer);
    };
  }

  return {
    enabled,
    publicKey: enabled ? vapid.publicKey : null,
    subscribe,
    unsubscribe,
    send,
    schedule,
    cancel,
    startScheduler,
    // Resolves once the scheduler has looked at what's due (for tests).
    flush: () => tick(),
  };
}

//   GET    /api/push/key           → { publicKey }, the VAPID key to subscribe with
//   POST   /api/push/subscriptions { appId, subscription, replaces? } → 204
//   DELETE /api/push/subscriptions { endpoint } → 204, or 404 if it isn't the user's
//   POST   /api/push/test          { appId } → { sent }: a test notification to the
//                                   user's own subscriptions for the app
//   PUT    /api/push/scheduled/:appId/:id { at, payload, ttl?, urgency? } → 204:
//                                   send `payload` at `at` (ms timestamp, within a day),
//                                   replacing what was scheduled under that id
//   DELETE /api/push/scheduled/:appId/:id → 204, scheduled or not
//   DELETE /api/push/scheduled/:appId?prefix=… → 204: every id starting with prefix
//
// All but the key need a session. `replaces` is the endpoint a renewed
// subscription takes over from (pushsubscriptionchange in the worker).
export function pushRoutes({ push, requireUser }) {
  const router = express.Router();

  router.use("/api/push", (req, res, next) => {
    if (!push.enabled) return res.status(503).json({ error: "Push notifications aren't set up on this server." });
    next();
  });

  router.get("/api/push/key", (req, res) => {
    res.json({ publicKey: push.publicKey });
  });

  router.post("/api/push/subscriptions", requireUser, async (req, res) => {
    const { appId, subscription, replaces } = req.body ?? {};
    if (typeof appId !== "string" || !APP_ID.test(appId)) return res.status(400).json({ error: "Invalid app." });
    const sub = parseSubscription(subscription);
    if (!sub) return res.status(400).json({ error: "Invalid subscription." });
    if (replaces !== undefined && typeof replaces !== "string") return res.status(400).json({ error: "Invalid replaces." });
    await push.subscribe(req.user.id, appId, sub, { replaces });
    res.status(204).end();
  });

  router.delete("/api/push/subscriptions", requireUser, async (req, res) => {
    const { endpoint } = req.body ?? {};
    if (typeof endpoint !== "string") return res.status(400).json({ error: "Invalid endpoint." });
    if (!(await push.unsubscribe(req.user.id, endpoint))) return res.status(404).json({ error: "No such subscription." });
    res.status(204).end();
  });

  router.post("/api/push/test", requireUser, async (req, res) => {
    const { appId } = req.body ?? {};
    if (typeof appId !== "string" || !APP_ID.test(appId)) return res.status(400).json({ error: "Invalid app." });
    const sent = await push.send(req.user.id, appId, {
      title: "Test notification",
      body: "Push notifications work on this device.",
      tag: "push-test",
    });
    res.json({ sent });
  });

  function validPayload(p) {
    return p && typeof p === "object" && !Array.isArray(p) && typeof p.title === "string" && Buffer.byteLength(JSON.stringify(p)) <= MAX_PAYLOAD;
  }

  router.put("/api/push/scheduled/:appId/:id", requireUser, async (req, res) => {
    const { appId, id } = req.params;
    if (!APP_ID.test(appId) || !JOB_ID.test(id)) return res.status(400).json({ error: "Invalid app or id." });
    const { at, payload, ttl = 60 * 60, urgency = "normal" } = req.body ?? {};
    const now = Date.now();
    if (!Number.isFinite(at) || at < now - 60_000 || at > now + MAX_AHEAD_MS) return res.status(400).json({ error: "Invalid time." });
    if (!validPayload(payload)) return res.status(400).json({ error: "Invalid payload." });
    if (!Number.isInteger(ttl) || ttl < 0 || ttl > 24 * 60 * 60) return res.status(400).json({ error: "Invalid ttl." });
    if (!URGENCIES.includes(urgency)) return res.status(400).json({ error: "Invalid urgency." });
    if (!(await push.schedule(req.user.id, appId, id, { at, payload, ttl, urgency }))) {
      return res.status(429).json({ error: "Too many scheduled notifications." });
    }
    res.status(204).end();
  });

  router.delete("/api/push/scheduled/:appId/:id", requireUser, async (req, res) => {
    const { appId, id } = req.params;
    if (!APP_ID.test(appId) || !JOB_ID.test(id)) return res.status(400).json({ error: "Invalid app or id." });
    await push.cancel(req.user.id, appId, id);
    res.status(204).end();
  });

  router.delete("/api/push/scheduled/:appId", requireUser, async (req, res) => {
    const { appId } = req.params;
    const { prefix } = req.query;
    if (!APP_ID.test(appId) || typeof prefix !== "string" || !JOB_ID.test(prefix)) {
      return res.status(400).json({ error: "Invalid app or prefix." });
    }
    await push.cancel(req.user.id, appId, null, { prefix });
    res.status(204).end();
  });

  return router;
}
