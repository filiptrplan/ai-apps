// The service worker half of push notifications (see server/push.js and
// shared/push.js). An app's worker sets its details, then imports this:
//
//   self.PUSH_APP = { id: "german", icon: "./german/icon.png" };
//   importScripts("./shared/push-sw.js");
//
// A push carries JSON: { title, body?, tag?, url?, icon?, renotify?,
// requireInteraction?, silent?, vibrate?, key?, close? }. Tapping the
// notification focuses the app (on `url` if given) or opens it.
//
// `key` names what the notification is about: if the page already showed
// one with the same tag and key (a page that was still running got there
// first), the push replaces it without alerting again. The page sets the key
// in its notification's `data`. `close` lists tags of the app's own
// notifications to close (e.g. a countdown that's now over).

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data.text() };
  }
  const app = self.PUSH_APP || {};
  event.waitUntil(
    (async () => {
      const reg = self.registration;
      let seen = false;
      if (data.tag && data.key) {
        const same = await reg.getNotifications({ tag: data.tag }).catch(() => []);
        seen = same.some((n) => n.data && n.data.key === data.key);
      }
      for (const tag of Array.isArray(data.close) ? data.close : []) {
        const open = await reg.getNotifications({ tag }).catch(() => []);
        open.forEach((n) => n.close());
      }
      // A push must show something: browsers penalise (Chrome) or revoke
      // (Safari) pushes that don't, so even an empty or repeated one does.
      await reg.showNotification(data.title || app.name || "Notification", {
        body: data.body,
        icon: data.icon || app.icon,
        tag: data.tag,
        // Re-alerting needs a tag to replace; without one it's a TypeError.
        renotify: Boolean(data.renotify && data.tag && !seen),
        requireInteraction: Boolean(data.requireInteraction),
        silent: Boolean(data.silent || seen),
        vibrate: seen ? undefined : data.vibrate,
        data: { push: true, key: data.key, url: new URL(data.url || reg.scope, reg.scope).href },
      });
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  const data = event.notification.data;
  if (!data || !data.push) return; // the app's own notifications
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      const target = data.url;
      const exact = clients.find((c) => c.url.split("#")[0] === target.split("#")[0]);
      if (exact) return exact.focus();
      const inApp = clients.find((c) => c.url.startsWith(self.registration.scope));
      if (inApp) {
        const focused = await inApp.focus();
        return focused.navigate ? focused.navigate(target) : focused;
      }
      return self.clients.openWindow(target);
    })
  );
});

function keyBytes(base64url) {
  const b64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// The browser renewed (or dropped) the subscription: subscribe again and
// tell the server, which swaps out the old endpoint.
self.addEventListener("pushsubscriptionchange", (event) => {
  const app = self.PUSH_APP || {};
  if (!app.id) return;
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription;
      let sub = event.newSubscription;
      if (!sub) {
        const key = old && old.options && old.options.applicationServerKey
          ? old.options.applicationServerKey
          : keyBytes(await fetch("/api/push/key").then((r) => r.json()).then((j) => j.publicKey));
        sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      }
      await fetch("/api/push/subscriptions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId: app.id, subscription: sub.toJSON(), replaces: old ? old.endpoint : undefined }),
      });
    })().catch(() => {})
  );
});
