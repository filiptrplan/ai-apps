// System notifications for rests: a silent countdown that stays in the
// notification shade while a rest runs with the app in the background, then
// a loud "Rest over" when it ends. Permission is asked for explicitly from
// NotificationPrompt rather than sprung on the user mid-workout.
//
// A page in the background can be frozen or discarded (iOS does it quickly),
// and then its own "Rest over" never fires. So while the page is hidden, each
// running rest also has a push scheduled on the server for when it ends
// (server/push.js), cancelled as soon as the page is back. Both carry the
// rest's end time as their key, and whichever comes second replaces the
// first quietly instead of alerting twice.
import { apiFetch } from "../shared/api.js";
import { enablePush } from "../shared/push.js";
import { APP_ID } from "./data.js";

const OVER_TAG = "climbing-tracker-rest";
const COUNTDOWN_TAG = "climbing-tracker-rest-countdown";
const ICON = "./climbing-tracker/icon.svg";

export function isInstalled() {
  return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

export function notificationsSupported() {
  return "Notification" in window && "serviceWorker" in navigator;
}

// "unsupported" | "default" | "granted" | "denied"
export function notificationState() {
  return notificationsSupported() ? Notification.permission : "unsupported";
}

// Must be called from a tap so the browser treats the prompt as user-initiated.
// Once allowed, also subscribes this device to pushes (needs a sign-in).
export async function requestNotifications() {
  if (!notificationsSupported()) return "unsupported";
  let state;
  try { state = await Notification.requestPermission(); } catch { state = Notification.permission; }
  if (state === "granted") subscribePush();
  return state;
}

// Subscribes this device to the app's pushes if notifications are allowed;
// App calls it once signed in. Quietly does nothing when it can't.
export function subscribePush() {
  if (!canNotify()) return;
  enablePush(APP_ID).catch(() => {});
  syncPushes(); // also drops what a discarded page left scheduled
}

function canNotify() {
  return notificationsSupported() && Notification.permission === "granted";
}

// Which notification a rest's "Rest over" is: the same for the local one
// and the push.
const restKey = endsAt => `rest-${endsAt}`;

async function show(title, options) {
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, { icon: ICON, ...options });
  } catch {}
}

async function close(tag) {
  try {
    const reg = await navigator.serviceWorker.ready;
    (await reg.getNotifications({ tag })).forEach(n => n.close());
  } catch {}
}

// Every running rest timer registers here, so the countdown notification can
// show whichever ends first when several overlap (a set rest and a
// between-exercise rest, say).
const rests = new Map(); // id -> { endsAt, remainingMs, paused, label }
let ticker = null;
let lastShown = "";

function mmss(sec) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

function secondsLeft(r) {
  return Math.max(0, Math.ceil((r.paused ? r.remainingMs : r.endsAt - Date.now()) / 1000));
}

function updateCountdown() {
  if (!canNotify() || document.visibilityState === "visible" || rests.size === 0) return;
  const r = [...rests.values()].sort((a, b) => secondsLeft(a) - secondsLeft(b))[0];
  const sec = secondsLeft(r);
  if (sec <= 0) return;
  const title = r.paused ? `Rest paused · ${mmss(sec)} left` : `Rest · ${mmss(sec)}`;
  if (title === lastShown) return;
  lastShown = title;
  // Same tag, no renotify: the shade entry is replaced in place, silently.
  show(title, { body: r.label, tag: COUNTDOWN_TAG, silent: true, renotify: false });
}

function clearCountdown() {
  lastShown = "";
  if (canNotify()) close(COUNTDOWN_TAG);
}

// Hidden pages get their timers throttled to about once a second, which is
// all a whole-second countdown needs.
function syncTicker() {
  const want = rests.size > 0 && document.visibilityState !== "visible";
  if (want && !ticker) {
    ticker = setInterval(updateCountdown, 500);
    updateCountdown();
  } else if (!want && ticker) {
    clearInterval(ticker);
    ticker = null;
  }
  if (rests.size === 0 || document.visibilityState === "visible") clearCountdown();
}

// ---------- the server-side "Rest over" ----------

// Scheduled push ids are `<device>-<n>`, so a page that comes back (or is
// reloaded after being discarded) can cancel whatever this device left.
const DEVICE_KEY = "climbing-tracker:push-device";
let device = null;
function deviceId() {
  if (device) return device;
  try {
    device = localStorage.getItem(DEVICE_KEY);
    if (!device) localStorage.setItem(DEVICE_KEY, (device = Math.random().toString(36).slice(2, 12)));
  } catch {
    device = Math.random().toString(36).slice(2, 12);
  }
  return device;
}

let scheduled = new Map(); // push id -> rest key, as last sent to the server
let clearedStale = false;

// keepalive: these often go out as the page is being hidden.
function request(path, init) {
  return apiFetch(path, { keepalive: true, ...init }).catch(() => {});
}

// Hidden: one push per running rest. Visible: none.
function syncPushes() {
  if (!canNotify()) return;
  const hidden = document.visibilityState !== "visible";
  const want = new Map();
  if (hidden) {
    [...rests.values()]
      .filter(r => !r.paused && r.endsAt > Date.now())
      .sort((a, b) => a.endsAt - b.endsAt)
      .forEach((r, i) => want.set(`${deviceId()}-${i}`, r));
  }
  if (!hidden && !clearedStale) {
    clearedStale = true;
    request(`/api/push/scheduled/${APP_ID}?prefix=${deviceId()}-`, { method: "DELETE" });
    scheduled = new Map();
  }
  for (const [id, r] of want) {
    if (scheduled.get(id) === restKey(r.endsAt)) continue;
    request(`/api/push/scheduled/${APP_ID}/${id}`, {
      method: "PUT",
      json: {
        at: r.endsAt,
        ttl: 5 * 60,
        urgency: "high",
        payload: {
          title: r.overTitle || "Rest over",
          body: r.label,
          tag: OVER_TAG,
          key: restKey(r.endsAt),
          close: [COUNTDOWN_TAG],
          renotify: true,
          requireInteraction: true,
          vibrate: [400, 150, 400, 150, 400],
          url: "/climbing-tracker",
        },
      },
    });
  }
  for (const id of scheduled.keys()) {
    if (!want.has(id)) request(`/api/push/scheduled/${APP_ID}/${id}`, { method: "DELETE" });
  }
  scheduled = new Map([...want].map(([id, r]) => [id, restKey(r.endsAt)]));
}

// label: what the rest is for, shown under the countdown; overTitle: the
// "Rest over" title, if not that.
export function trackRest(id, { endsAt = 0, remainingMs = 0, paused = false, label = "", overTitle }) {
  rests.set(id, { endsAt, remainingMs, paused, label, overTitle });
  lastShown = "";
  syncTicker();
  updateCountdown();
  syncPushes();
}

export function untrackRest(id) {
  if (!rests.delete(id)) return;
  syncTicker();
  if (rests.size > 0) { lastShown = ""; updateCountdown(); }
  syncPushes();
}

// endsAt: when the rest was due to end, to recognise its push.
export async function notifyRestOver(body, title = "Rest over", endsAt) {
  if (!canNotify()) return;
  // In the foreground the in-app beep and rest bar already cover it.
  if (document.visibilityState === "visible") return;
  const key = endsAt ? restKey(endsAt) : undefined;
  // The push got here first: leave it be.
  if (key) {
    try {
      const reg = await navigator.serviceWorker.ready;
      if ((await reg.getNotifications({ tag: OVER_TAG })).some(n => n.data?.key === key)) return;
    } catch {}
  }
  await show(title, {
    body,
    tag: OVER_TAG,
    data: { key },
    renotify: true,
    requireInteraction: true,
    vibrate: [400, 150, 400, 150, 400],
  });
}

export async function clearRestAlerts() {
  if (canNotify()) close(OVER_TAG);
}

// Once back in the app the notifications have done their job; on leaving it,
// the countdown takes over from the rest bar.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") clearRestAlerts();
    syncTicker();
    syncPushes();
  });
}
