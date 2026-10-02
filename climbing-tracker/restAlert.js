// System notifications for rests: a silent countdown that stays in the
// notification shade while a rest runs with the app in the background, then
// a loud "Rest over" when it ends. Permission is asked for explicitly from
// NotificationPrompt rather than sprung on the user mid-workout.
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
export async function requestNotifications() {
  if (!notificationsSupported()) return "unsupported";
  try { return await Notification.requestPermission(); } catch { return Notification.permission; }
}

function canNotify() {
  return notificationsSupported() && Notification.permission === "granted";
}

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

// label: what the rest is for, shown under the countdown.
export function trackRest(id, { endsAt = 0, remainingMs = 0, paused = false, label = "" }) {
  rests.set(id, { endsAt, remainingMs, paused, label });
  lastShown = "";
  syncTicker();
  updateCountdown();
}

export function untrackRest(id) {
  if (!rests.delete(id)) return;
  syncTicker();
  if (rests.size > 0) { lastShown = ""; updateCountdown(); }
}

export async function notifyRestOver(body) {
  if (!canNotify()) return;
  // In the foreground the in-app beep and rest bar already cover it.
  if (document.visibilityState === "visible") return;
  await show("Rest over", {
    body,
    tag: OVER_TAG,
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
  });
}
