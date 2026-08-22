// Slovenian date/time/number formatting shared by the user and admin apps.

export function formatPoints(n) {
  return Math.round(n).toLocaleString("sl-SI");
}

export function formatTime(iso) {
  return new Date(iso).toLocaleTimeString("sl-SI", { hour: "2-digit", minute: "2-digit" });
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// "Danes" / "Včeraj" / a full Slovenian date for anything older.
export function formatDayLabel(iso) {
  const d = new Date(iso);
  const now = new Date();
  if (isSameDay(d, now)) return "Danes";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(d, yesterday)) return "Včeraj";
  return d.toLocaleDateString("sl-SI", { day: "numeric", month: "long" });
}

export function dayKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
