import { s, C } from "../styles.js";
import { Icon } from "./Icons.jsx";
import { isInstalled, notificationState, requestNotifications } from "../restAlert.js";

const { useState, useEffect } = React;

const DISMISS_KEY = "climbing-tracker:notif-prompt-dismissed";

function readDismissed() {
  try { return localStorage.getItem(DISMISS_KEY) || ""; } catch { return ""; }
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

// Tracks the notification permission, including changes made outside the
// app (e.g. in system settings) - re-read whenever the page comes back.
function useNotificationState() {
  const [state, setState] = useState(notificationState);
  useEffect(() => {
    const refresh = () => setState(notificationState());
    document.addEventListener("visibilitychange", refresh);
    let status = null;
    navigator.permissions?.query({ name: "notifications" })
      .then(st => { status = st; st.onchange = refresh; })
      .catch(() => {});
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      if (status) status.onchange = null;
    };
  }, []);
  return [state, setState];
}

// Banner shown during a workout when rest notifications (the countdown in
// the shade and the "Rest over" alert) can't reach the user. A dismissal is
// remembered per state, so it comes back if things change - e.g. a "not now"
// on the ask still lets the "blocked" hint show after a later denial.
export function NotificationPrompt({ style }) {
  const [state, setState] = useNotificationState();
  const [dismissed, setDismissed] = useState(readDismissed);

  // iOS only offers web notifications to apps added to the Home Screen.
  const kind = state === "unsupported"
    ? (isIOS() && !isInstalled() ? "install" : null)
    : state === "granted" ? null : state;
  if (!kind || dismissed === kind) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, kind); } catch {}
    setDismissed(kind);
  };
  const enable = async () => setState(await requestNotifications());

  const text = {
    default: "Turn on notifications to see the rest countdown when the app is in the background.",
    denied: "Notifications are blocked, so you won't see the rest countdown in the background. Allow them for this site in your browser or system settings.",
    install: "Add this app to your Home Screen (Share → Add to Home Screen) to get rest countdown notifications.",
  }[kind];

  return (
    <div style={{ ...s.drift, marginTop: 0, marginBottom: 12, ...style }} role="status">
      <span style={s.driftText}>{text}</span>
      {kind === "default" && <button style={s.driftBtn} onClick={enable}>Enable</button>}
      <button style={{ ...s.restBarBtn, color: C.accent }} onClick={dismiss} aria-label="Dismiss">
        <Icon.x size={18} />
      </button>
    </div>
  );
}
