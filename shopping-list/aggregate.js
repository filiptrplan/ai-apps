// Turns the per-recipe rows returned by /api/shopping-list into the
// combined, categorised shopping list. Rows with the same name are merged
// into one item, and amounts in the same unit are summed (200 g + 300 g ->
// 500 g); amounts in different units are kept side by side (2 pcs + 100 g).

// Supermarket order - matches CATEGORIES in api/shoppingList.js.
export const CATEGORY_ORDER = [
  "Vegetables",
  "Fruit",
  "Meat & Fish",
  "Dairy & Eggs",
  "Bakery",
  "Grains, Pasta & Legumes",
  "Canned & Jarred",
  "Baking",
  "Spices & Herbs",
  "Oils, Sauces & Condiments",
  "Nuts & Seeds",
  "Frozen",
  "Drinks",
  "Other",
];

const UNIT_ORDER = ["g", "ml", "pcs", "can", "bunch", "clove", "tbsp", "tsp", "pinch", "to taste"];

export function itemKey(name) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function round(n, digits = 2) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function plural(unit, qty) {
  if (qty === 1) return unit;
  return { clove: "cloves", can: "cans", bunch: "bunches", pinch: "pinches" }[unit] ?? unit;
}

// One amount, e.g. { unit: "g", qty: 1500 } -> "1.5 kg".
export function formatAmount({ unit, qty }) {
  if (unit === "to taste" || qty == null) return "to taste";
  if (unit === "g" && qty >= 1000) return `${round(qty / 1000)} kg`;
  if (unit === "ml" && qty >= 1000) return `${round(qty / 1000)} l`;
  const n = unit === "g" || unit === "ml" ? Math.round(qty) : round(qty);
  return `${n} ${plural(unit, n)}`;
}

// Sums a list of { unit, quantity } into one amount per unit, in UNIT_ORDER.
// "to taste" only survives when there's no real amount to show instead.
function sumAmounts(rows) {
  const byUnit = new Map();
  for (const { unit, quantity } of rows) {
    if (unit === "to taste" || quantity == null) {
      if (!byUnit.has("to taste")) byUnit.set("to taste", null);
      continue;
    }
    byUnit.set(unit, (byUnit.get(unit) ?? 0) + quantity);
  }
  if (byUnit.size > 1) byUnit.delete("to taste");
  return [...byUnit.entries()]
    .map(([unit, qty]) => ({ unit, qty }))
    .sort((a, b) => UNIT_ORDER.indexOf(a.unit) - UNIT_ORDER.indexOf(b.unit));
}

// result: { recipes: [{ index, title }], items: [{ recipeIndex, name,
// category, quantity, unit, note }] } as returned by the API.
// Returns [{ category, items: [{ key, name, amounts, notes, sources }] }]
// with categories in CATEGORY_ORDER and items alphabetical.
export function buildList(result) {
  if (!result) return [];
  const titles = new Map(result.recipes.map((r) => [r.index, r.title]));
  const byKey = new Map();

  for (const row of result.items) {
    const key = itemKey(row.name);
    if (!key) continue;
    let item = byKey.get(key);
    if (!item) {
      item = { key, name: row.name.trim(), category: row.category, rows: [], notes: new Set() };
      byKey.set(key, item);
    }
    item.rows.push(row);
    if (row.note?.trim()) item.notes.add(row.note.trim());
  }

  const groups = new Map();
  for (const item of byKey.values()) {
    const category = CATEGORY_ORDER.includes(item.category) ? item.category : "Other";
    const recipeIndexes = [...new Set(item.rows.map((r) => r.recipeIndex))];
    const entry = {
      key: item.key,
      name: item.name,
      amounts: sumAmounts(item.rows),
      notes: [...item.notes],
      sources: recipeIndexes.map((i) => ({
        title: titles.get(i) ?? `Recipe ${i + 1}`,
        amounts: sumAmounts(item.rows.filter((r) => r.recipeIndex === i)),
      })),
    };
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(entry);
  }

  return CATEGORY_ORDER.filter((c) => groups.has(c)).map((category) => ({
    category,
    items: groups.get(category).sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

// Plain-text version of the list, for pasting into notes/messages.
export function listToText(groups, checked = {}) {
  return groups
    .map(({ category, items }) => {
      const lines = items
        .filter((it) => !checked[it.key])
        .map((it) => `- ${it.name}: ${it.amounts.map(formatAmount).join(" + ")}`);
      return lines.length ? `${category}\n${lines.join("\n")}` : null;
    })
    .filter(Boolean)
    .join("\n\n");
}
