// Aldi Suisse price estimates from the price-estimate edge function, shared
// by the Recipes and Shopping List apps. No React.
//
// estimatePrices takes [{ id, q, name }] (q is the amount text) and returns
// { items, produceMonth }. Each item is { id, source, product, size,
// unitPrice, unit, qty, buy, used, note }: source is "aldi" (qty packs of
// product at unitPrice), "produce" (qty kg/Stück/Bund at the Swiss retail
// average for produceMonth) or "none" (no price found). buy is what you'd
// pay for it, used the share of that the amount uses.
import { callAI } from "./ai.js";

// How the picker leans: the cheapest products, everyday ones, or premium.
export const PRICE_TIERS = [
  { id: "cheapest", label: "Cheapest" },
  { id: "normal", label: "Normal" },
  { id: "premium", label: "Premium" },
];
const TIER_KEY = "recipes-price-tier";

export function readTier() {
  try {
    const t = localStorage.getItem(TIER_KEY);
    if (PRICE_TIERS.some((x) => x.id === t)) return t;
  } catch {}
  return "normal";
}

export function saveTier(tier) {
  try {
    localStorage.setItem(TIER_KEY, tier);
  } catch {}
}

export const estimatePrices = (items, tier = "normal") => callAI("price-estimate", { items, tier });

// Apps keep an estimate as { key, items, loading?, error?, result? }, where
// items are the rows sent and key identifies them, so a screen can tell when
// what it shows no longer matches the recipe or list.
export const estimateKey = (items, tier = "normal") => JSON.stringify([tier, items.map((i) => [i.id, i.q, i.name])]);

// Starts an estimate. `set` is a functional setter for the estimate; a late
// answer is dropped when a newer estimate has started or it was closed.
export function runEstimate(items, set, tier = "normal") {
  const key = estimateKey(items, tier);
  set(() => ({ key, items, loading: true }));
  const done = (patch) => set((cur) => (cur && cur.key === key && cur.loading ? { key, items, ...patch } : cur));
  estimatePrices(items, tier).then(
    (result) => done({ result }),
    (err) => done({ error: err.message || "Couldn't estimate prices." })
  );
}

export function priceTotals(result) {
  const items = result?.items || [];
  const priced = items.filter((i) => i.source !== "none");
  return {
    buy: priced.reduce((n, i) => n + i.buy, 0),
    used: priced.reduce((n, i) => n + i.used, 0),
    priced: priced.length,
    missing: items.length - priced.length,
    produce: priced.some((i) => i.source === "produce"),
  };
}

export const chf = (n) => `CHF ${(Math.round(n * 20) / 20).toFixed(2)}`;

// "2 × CHF 1.35", "0.3 kg × CHF 1.79" or "".
export function priceDetail(i) {
  if (i.source === "aldi") return `${i.qty} × ${chf(i.unitPrice)}`;
  if (i.source === "produce") return `${+i.qty.toFixed(3)} ${i.unit} × ${chf(i.unitPrice)}`;
  return "";
}

// "Aug 2026" from "2026-08".
export function monthLabel(m) {
  if (!m) return "";
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString("en", { month: "short", year: "numeric", timeZone: "UTC" });
}
