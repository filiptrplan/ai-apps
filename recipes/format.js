// Pure helpers for the Recipes app: quantity scaling, ingredient parsing and
// timer formatting. No React, so they're easy to reuse.

export const CATS = ["Breakfast", "Lunch", "Dinner"];

export const uid = () => Math.random().toString(36).slice(2, 9);

const UNI = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3 };

// "1½ cups" -> { v: 1.5, rest: " cups" }; null when there's no leading number.
function parseQty(q) {
  const m = q.match(/^(\d+)?\s*([½¼¾⅓⅔]|\d+\/\d+)?(?:[.,](\d+))?(.*)$/);
  if (!m || (!m[1] && !m[2])) return null;
  let v = m[1] ? parseFloat(m[1] + (m[3] ? "." + m[3] : "")) : 0;
  if (m[2]) {
    if (UNI[m[2]]) v += UNI[m[2]];
    else {
      const [a, b] = m[2].split("/");
      v += a / b;
    }
  }
  return { v, rest: m[4] };
}

const FR = [[0, ""], [0.25, "¼"], [1 / 3, "⅓"], [0.5, "½"], [2 / 3, "⅔"], [0.75, "¾"], [1, ""]];

function fmtQty(v) {
  if (v >= 10) return String(Math.round(v));
  let w = Math.floor(v);
  let best = FR[0];
  FR.forEach((p) => {
    if (Math.abs(p[0] - (v - w)) < Math.abs(best[0] - (v - w))) best = p;
  });
  if (best[0] === 1) {
    w += 1;
    best = FR[0];
  }
  return (w ? String(w) : "") + best[1] || "0";
}

// Scales the leading number of a quantity like "2 cups" by k.
export function scaleQty(q, k) {
  if (k === 1) return q;
  const p = parseQty(q);
  if (!p) return q;
  return fmtQty(p.v * k) + (p.rest && !/^\s/.test(p.rest) ? " " : "") + p.rest;
}

const UNITS = "cups?|tbsp|tsp|cans?|g|kg|ml|dl|l|oz|lb|pcs|pinch|bunch|handful|cloves?|fillets?|heads?|ears?|slices?";
const ING_RE = new RegExp(`^([\\d½¼¾⅓⅔/.,\\-]+\\s*(?:${UNITS})?)\\s+(.+)$`, "i");

// "2 cups Spinach" -> { q: "2 cups", n: "Spinach" }
export function parseIng(line) {
  const m = line.match(ING_RE);
  return m ? { q: m[1], n: m[2] } : { q: "", n: line };
}

export const ingToLine = (g) => [g.q, g.n].filter(Boolean).join(" ");

// The minutes a method step mentions ("simmer for 10–12 minutes" -> 12).
export function stepMin(s) {
  const m = s.match(/(\d+)(?:\s*[–-]\s*(\d+))?\s*min/i);
  return m ? parseInt(m[2] || m[1], 10) : null;
}

export function fmtClock(sec) {
  sec = Math.max(0, Math.ceil(sec));
  return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
