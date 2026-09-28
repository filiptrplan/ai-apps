// System notification for when a rest runs out while the app is in the
// background. Only used when installed as a PWA: in a browser tab the page is
// easy to lose track of and a permission prompt would be noise.
const TAG = "climbing-tracker-rest";

function isInstalled() {
  return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

function supported() {
  return isInstalled() && "Notification" in window && "serviceWorker" in navigator;
}

// Called from the tap that starts a rest, so the browser treats the prompt
// as user-initiated. Only ever asks once.
export function requestRestAlertPermission() {
  if (supported() && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}

export async function notifyRestOver(body) {
  if (!supported() || Notification.permission !== "granted") return;
  // In the foreground the in-app beep and rest bar already cover it.
  if (document.visibilityState === "visible") return;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification("Rest over", {
      body,
      tag: TAG,
      renotify: true,
      requireInteraction: true,
      vibrate: [400, 150, 400, 150, 400],
      icon: "./climbing-tracker/icon.svg",
    });
  } catch {}
}

export async function clearRestAlerts() {
  if (!supported() || Notification.permission !== "granted") return;
  try {
    const reg = await navigator.serviceWorker.ready;
    (await reg.getNotifications({ tag: TAG })).forEach(n => n.close());
  } catch {}
}

// Once back in the app the notification has done its job.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") clearRestAlerts();
  });
}
