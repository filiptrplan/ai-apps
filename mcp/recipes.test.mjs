import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./server.js";

const K = { lists: "recipes-lists", recipes: "recipes-recipes", tier: "recipes-price-tier" };

// In-memory stand-in for createAppData().
function fakeAppData(initial = {}) {
  const rows = new Map(Object.entries(initial).map(([k, v]) => [k, structuredClone(v)]));
  return {
    rows,
    async read(appId, key, fallback) {
      assert.equal(appId, "recipes");
      return rows.has(key) ? structuredClone(rows.get(key)) : fallback;
    },
    async update(appId, key, fallback, mutate) {
      assert.equal(appId, "recipes");
      const next = mutate(rows.has(key) ? structuredClone(rows.get(key)) : fallback);
      rows.set(key, next);
      return next;
    },
  };
}

async function connect(initial, extra = {}) {
  const appData = fakeAppData(initial);
  const server = createMcpServer({ appData, ...extra });
  const client = new Client({ name: "test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name, args = {}) => {
    const res = await client.callTool({ name, arguments: args });
    const text = res.content[0].text;
    if (res.isError) return { error: text };
    return JSON.parse(text);
  };
  return { appData, client, call };
}

const pasta = {
  id: "r-pasta", name: "Spinach pasta", cat: "Dinner", tags: ["Dinner"], time: 25, serves: 2, photo: "u/p.webp",
  ingredients: [
    { id: "s1", name: "", items: [{ id: "g1", q: "200 g", n: "Pasta" }, { id: "g2", q: "2 cups", n: "Spinach" }, { id: "g3", q: "", n: "Salt" }] },
  ],
  method: [{ id: "m1", name: "", items: [{ id: "t1", text: "Boil pasta for 10 min." }, { id: "t2", text: "Stir in spinach." }] }],
};
// Saved before recipes had sections.
const oldToast = { id: "r-toast", name: "Toast", cat: "Breakfast", tags: ["Breakfast"], time: 5, serves: 1, ings: [{ q: "2", n: "Bread slices" }], steps: ["Toast it."] };
const seed = () => ({
  [K.recipes]: [pasta, oldToast],
  [K.lists]: [
    { id: "default", name: "Groceries", items: [
      { id: "i1", name: "Spinach", q: "1 bag", checked: false },
      { id: "i2", name: "Pasta", q: "500 g", checked: true },
    ] },
    { id: "l2", name: "Party", items: [] },
  ],
});

test("lists every recipes tool", async () => {
  const { client } = await connect(seed(), { callFunction: async () => ({}) });
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(t => t.name).filter(n => n.startsWith("recipes_")).sort(), [
    "recipes_add_to_list", "recipes_delete", "recipes_estimate_price", "recipes_get_list", "recipes_get_overview",
    "recipes_get_recipe", "recipes_save_list", "recipes_save_recipe", "recipes_update_list",
  ]);
});

test("overview reads old and new recipes and counts list rows", async () => {
  const { call } = await connect(seed());
  const o = await call("recipes_get_overview");
  assert.deepEqual(o.recipes.map(r => [r.name, r.ingredientCount]), [["Spinach pasta", 3], ["Toast", 1]]);
  assert.deepEqual(o.lists.map(l => [l.name, l.toGet, l.inCart]), [["Groceries", 1, 1], ["Party", 0, 0]]);
  assert.equal(o.priceTier, "normal");
});

test("get_recipe scales amounts", async () => {
  const { call } = await connect(seed());
  const r = await call("recipes_get_recipe", { id: "r-pasta", servings: 3 });
  assert.deepEqual(r.ingredients[0].items.map(g => g.amount), ["300 g", "3 cups", ""]);
  assert.deepEqual(r.method[0].steps, ["Boil pasta for 10 min.", "Stir in spinach."]);
});

test("save_recipe creates a recipe first, parsing ingredient lines", async () => {
  const { call, appData } = await connect(seed());
  const res = await call("recipes_save_recipe", {
    name: "Pancakes", category: "Breakfast", serves: 4,
    ingredients: [{ items: ["250 g flour", { amount: "2", name: "Eggs" }, "pinch salt"] }],
    method: [{ steps: ["Mix.", "Fry 2 min per side."] }],
  });
  assert.ok(res.created);
  const saved = appData.rows.get(K.recipes)[0];
  assert.equal(saved.name, "Pancakes");
  assert.deepEqual(saved.tags, ["Breakfast"]);
  assert.equal(saved.time, 20);
  assert.deepEqual(saved.ingredients[0].items.map(g => [g.q, g.n]), [["250 g", "flour"], ["2", "Eggs"], ["", "pinch salt"]]);

  const dup = await call("recipes_save_recipe", { name: "pancakes", ingredients: [{ items: ["x"] }], method: [{ steps: ["y"] }] });
  assert.match(dup.error, /already exists/);
});

test("save_recipe keeps ids of unchanged ingredients and other fields", async () => {
  const { call, appData } = await connect(seed());
  await call("recipes_save_recipe", { id: "r-pasta", ingredients: [{ items: ["300 g pasta", "Spinach", "Garlic"] }] });
  const saved = appData.rows.get(K.recipes).find(r => r.id === "r-pasta");
  assert.deepEqual(saved.ingredients[0].items.map(g => g.id).slice(0, 2), ["g1", "g2"]);
  assert.equal(saved.ingredients[0].id, "s1");
  assert.equal(saved.photo, "u/p.webp");
  assert.equal(saved.method[0].items.length, 2);
});

test("save_recipe converts an old recipe when changed", async () => {
  const { call, appData } = await connect(seed());
  await call("recipes_save_recipe", { id: "r-toast", category: "Lunch" });
  const saved = appData.rows.get(K.recipes).find(r => r.id === "r-toast");
  assert.deepEqual(saved.tags, ["Lunch"]);
  assert.equal(saved.ingredients[0].items[0].n, "Bread slices");
  assert.equal(saved.ings, undefined);
});

test("add_to_list adds a scaled recipe, skipping what's already from it and un-ticking cart copies", async () => {
  const { call, appData } = await connect(seed());
  const res = await call("recipes_add_to_list", { recipeId: "r-pasta", servings: 4 });
  assert.deepEqual(res.added.map(r => [r.name, r.amount]), [["Pasta", "400 g"], ["Spinach", "4 cups"], ["Salt", ""]]);
  assert.deepEqual(res.possibleDuplicates, [{ id: "i1", name: "Spinach", amount: "1 bag" }]);
  const items = appData.rows.get(K.lists)[0].items;
  // The ticked "Pasta" row is gone from the cart.
  assert.deepEqual(items.map(i => [i.name, i.checked]), [["Spinach", false], ["Pasta", false], ["Spinach", false], ["Salt", false]]);
  assert.deepEqual(items[1].src, ["r-pasta:g1"]);

  const again = await call("recipes_add_to_list", { recipeId: "r-pasta", ingredientIds: ["g3"] });
  assert.equal(again.added.length, 0);
  assert.equal(again.skippedAlreadyOnList, 1);
});

test("add_to_list adds free-form items to another list", async () => {
  const { call, appData } = await connect(seed());
  await call("recipes_add_to_list", { listId: "l2", items: ["6 beers", { name: "Chips" }] });
  assert.deepEqual(appData.rows.get(K.lists)[1].items.map(i => [i.q, i.name]), [["6", "beers"], ["", "Chips"]]);
});

test("update_list ticks, edits, removes and clears", async () => {
  const { call } = await connect(seed());
  let l = await call("recipes_update_list", { changes: [{ id: "i1", checked: true, amount: "2 bags" }, { id: "i2", checked: false }] });
  assert.deepEqual(l.toGet.map(r => r.name), ["Pasta"]);
  assert.deepEqual(l.inCart, [{ id: "i1", name: "Spinach", amount: "2 bags" }]);
  l = await call("recipes_update_list", { changes: [{ id: "i2", remove: true }], clearInCart: true });
  assert.deepEqual([l.toGet, l.inCart], [[], []]);
  const bad = await call("recipes_update_list", { changes: [{ id: "nope", remove: true }] });
  assert.match(bad.error, /no row/);
});

test("lists can be created, renamed and deleted, but not the last one", async () => {
  const { call, appData } = await connect(seed());
  const made = await call("recipes_save_list", { name: "Camping" });
  await call("recipes_save_list", { id: made.id, name: "Camping trip" });
  assert.deepEqual(appData.rows.get(K.lists).map(l => l.name), ["Groceries", "Party", "Camping trip"]);
  await call("recipes_delete", { kind: "list", id: "l2" });
  await call("recipes_delete", { kind: "list", id: made.id });
  const last = await call("recipes_delete", { kind: "list", id: "default" });
  assert.match(last.error, /only list/);
});

test("deleting a recipe removes its photo", async () => {
  const removed = [];
  const { call, appData } = await connect(seed(), { removePhoto: async p => removed.push(p) });
  const res = await call("recipes_delete", { kind: "recipe", id: "r-pasta" });
  assert.equal(res.deleted.name, "Spinach pasta");
  assert.deepEqual(removed, ["u/p.webp"]);
  assert.deepEqual(appData.rows.get(K.recipes).map(r => r.id), ["r-toast"]);
});

test("estimate_price sends scaled ingredients with the saved tier", async () => {
  let sent;
  const callFunction = async (name, body) => {
    sent = { name, body };
    return {
      produceMonth: "2026-09",
      items: [
        { id: "g1", source: "aldi", product: "Spaghetti", qty: 1, unitPrice: 1.2, buy: 1.2, used: 0.96 },
        { id: "g2", source: "produce", qty: 0.2, unit: "kg", unitPrice: 10, buy: 2, used: 2 },
        { id: "g3", source: "none" },
      ],
    };
  };
  const { call } = await connect({ ...seed(), [K.tier]: "cheapest" }, { callFunction });
  const res = await call("recipes_estimate_price", { recipeId: "r-pasta", servings: 4 });
  assert.equal(sent.name, "price-estimate");
  assert.equal(sent.body.tier, "cheapest");
  assert.deepEqual(sent.body.items[0], { id: "g1", q: "400 g", name: "Pasta" });
  assert.equal(res.buy, 3.2);
  assert.equal(res.unpriced, 1);
  assert.equal(res.items[0].item, "400 g Pasta");
});
