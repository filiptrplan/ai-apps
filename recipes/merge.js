// Folding new shopping list rows into matching ones, from the
// shopping-merge edge function's answer. No React, so it's easy to test.
//
// List items are { id, name, q, checked, src }, where q is the amount text
// ("" when there's none) and src lists the "recipeId:ingredientId" keys the
// row was added from.

// The rows sent to shopping-merge for a batch of just-added ids: the new
// rows still waiting to be bought, and every other row still to get.
export function mergeRequest(items, addedIds) {
  const added = new Set(addedIds);
  const row = (i) => ({ id: i.id, q: i.q || "", name: i.name });
  const todo = items.filter((i) => !i.checked);
  return {
    list: todo.filter((i) => !added.has(i.id)).map(row),
    add: todo.filter((i) => added.has(i.id)).map(row),
  };
}

// Applies shopping-merge's groups to the current items. `sent` is the
// request they answer; a group is skipped when its rows have since been
// ticked, removed or changed, or when the answer doesn't make sense.
// Returns { items, merged: [{ name, q }] } with the rows that were kept.
export function applyMerges(items, groups, sent) {
  const sentById = new Map([...sent.list, ...sent.add].map((r) => [r.id, r]));
  const addIds = new Set(sent.add.map((r) => r.id));
  const byId = new Map(items.map((i) => [i.id, i]));
  const unchanged = (id) => {
    const i = byId.get(id);
    const r = sentById.get(id);
    return i && r && !i.checked && i.name === r.name && (i.q || "") === r.q;
  };

  const drop = new Set();
  const update = new Map();
  const merged = [];
  for (const g of groups || []) {
    const ids = [...new Set((g.merge || []).filter((id) => id !== g.keep))];
    if (!ids.length || !unchanged(g.keep) || drop.has(g.keep) || update.has(g.keep)) continue;
    if (!ids.every((id) => addIds.has(id) && unchanged(id) && !drop.has(id) && !update.has(id))) continue;
    const keep = byId.get(g.keep);
    const src = [...new Set([keep, ...ids.map((id) => byId.get(id))].flatMap((i) => i.src || []))];
    update.set(g.keep, { ...keep, q: typeof g.q === "string" ? g.q.trim() : keep.q, src });
    ids.forEach((id) => drop.add(id));
    merged.push({ name: keep.name, q: update.get(g.keep).q });
  }

  return {
    items: items.filter((i) => !drop.has(i.id)).map((i) => update.get(i.id) || i),
    merged,
  };
}
