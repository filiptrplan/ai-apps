// Push notifications for an app, from the page side (the server half is
// server/push.js, the service worker half shared/push-sw.js). Kept free of
// React so any page can import it.
//
// A subscription belongs to one app's service worker on one browser, so it's
// per app and per device: turning notifications on in German on a phone
// doesn't turn them on for Recipes, or for German on the laptop.
//
//   await pushState()            → "unsupported" | "denied" | "off" | "on"
//   await enablePush("german")   → "on" | "denied" | "unsupported"; call from a tap
//   await disablePush()          → turns them off on this browser, for this page's app
//   syncPush("german")           → on load when signed in: re-registers an existing
//                                  subscription for whoever is signed in now
//
// On iPhone and iPad, push only exists in the app added to the home screen
// (iOS 16.4+); in a Safari tab pushState() says "unsupported".
import { apiFetch } from "./api.js";

export function pushSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

// The page's own service worker registration (its app's).
async function registration() {
  return navigator.serviceWorker.ready;
}

function keyBytes(base64url) {
  const b64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function sameKey(buffer, bytes) {
  if (!buffer) return false;
  const a = new Uint8Array(buffer);
  return a.length === bytes.length && a.every((v, i) => v === bytes[i]);
}

export async function pushState() {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "off";
  const sub = await (await registration()).pushManager.getSubscription();
  return sub ? "on" : "off";
}

function save(appId, sub) {
  return apiFetch("/api/push/subscriptions", { json: { appId, subscription: sub.toJSON() } });
}

// Asks for permission if needed (so call it from a tap: browsers ignore or
// block prompts that aren't), subscribes this browser and tells the server.
// Throws if the server refuses or can't be reached.
export async function enablePush(appId) {
  if (!pushSupported()) return "unsupported";
  const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";

  const { publicKey } = await apiFetch("/api/push/key");
  const key = keyBytes(publicKey);
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  // Made with another server key (rotated since): it can't be pushed to.
  if (sub && !sameKey(sub.options?.applicationServerKey, key)) {
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await save(appId, sub);
  return "on";
}

export async function disablePush() {
  if (!pushSupported()) return;
  const sub = await (await registration()).pushManager.getSubscription();
  if (!sub) return;
  await apiFetch("/api/push/subscriptions", { method: "DELETE", json: { endpoint: sub.endpoint } }).catch((err) => {
    if (err.status !== 404) throw err;
  });
  await sub.unsubscribe();
}

// Re-sends an existing subscription, so it follows whoever is signed in on
// this browser and the server has it even if it lost it. Never throws.
export async function syncPush(appId) {
  try {
    if (!pushSupported() || Notification.permission !== "granted") return;
    const sub = await (await registration()).pushManager.getSubscription();
    if (sub) await save(appId, sub);
  } catch {}
}
