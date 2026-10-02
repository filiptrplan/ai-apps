// Recipes tools. They read and write the same app_data blobs the Recipes
// app syncs (see recipes/App.jsx), and reuse the app's own helpers so
// recipes and shopping list rows come out exactly as the app would make them.
import { z } from "zod";
import { CATS, uid, normRecipe, allIngs, scaleQty, parseIng, ingToLine } from "../../recipes/format.js";
import { PRICE_TIERS, priceTotals } from "../../shared/prices.js";

const APP_ID = "recipes";
const KEYS = { lists: "recipes-lists", recipes: "recipes-recipes", tier: "recipes-price-tier" };
const DEFAULT_LISTS = [{ id: "default", name: "Groceries", items: [] }];
const APP_URL = "https://apps.trplan.si/recipes";
const TIERS = PRICE_TIERS.map(t => t.id);

export const instructions = `Recipes (recipes_* tools): the user's recipe notebook and shopping lists (${APP_URL}). Call recipes_get_overview first: it returns the recipe and list ids the other tools take. Recipes have ingredients and method steps, both split into optional named sections ("Sauce", "Dough", ...). Shopping list rows are a name plus an amount text ("2", "500 g"); ticked rows are "in the cart". Changes show up in the app right away.`;

// Thrown for anything the caller can fix; McpServer turns it into an
// isError tool result with this message.
function fail(message) {
  throw new Error(message);
}

function json(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

const norm = s => s.trim().toLowerCase();

function findRecipe(recipes, id) {
  return recipes.find(r => r.id === id)
    || fail(`No recipe with id "${id}". Call recipes_get_overview for valid ids.`);
}

// The list to act on: the given one, else the first, like the app on a
// fresh device.
function findList(lists, id) {
  if (!id) return lists[0] || fail("There are no shopping lists. Create one with recipes_save_list.");
  return lists.find(l => l.id === id)
    || fail(`No shopping list with id "${id}". Call recipes_get_overview for valid ids.`);
}

function describeRecipe(r, servings) {
  const k = servings ? servings / r.serves : 1;
  return {
    id: r.id,
    name: r.name,
    category: r.cat,
    timeMin: r.time,
    serves: r.serves,
    ...(servings && servings !== r.serves ? { scaledTo: servings } : {}),
    hasPhoto: !!r.photo,
    ingredients: r.ingredients.map(sec => ({
      section: sec.name || null,
      items: sec.items.map(g => ({ id: g.id, amount: scaleQty(g.q, k), name: g.n })),
    })),
    method: r.method.map(sec => ({
      section: sec.name || null,
      steps: sec.items.map(s => s.text),
    })),
    notes: r.notes || "",
  };
}

function describeList(l) {
  const row = i => ({ id: i.id, name: i.name, amount: i.q || "" });
  return {
    id: l.id,
    name: l.name,
    toGet: l.items.filter(i => !i.checked).map(row),
    inCart: l.items.filter(i => i.checked).map(row),
  };
}

// Builds recipe sections from tool input, keeping the ids of matching
// existing sections and items (by name, else position for sections; by
// ingredient name or step text for items) so step timers and the
// "already on the list" marks keep pointing at the same rows.
function buildSections(kind, input, existing) {
  const usedSections = new Set();
  const usedItems = new Set();
  return input
    .map((sec, i) => {
      const name = (sec.section || "").trim();
      const old = existing.find(s => !usedSections.has(s.id) && norm(s.name) === norm(name))
        || (existing[i] && !usedSections.has(existing[i].id) ? existing[i] : null);
      if (old) usedSections.add(old.id);
      const oldItems = existing.flatMap(s => s.items);
      const reuse = key => {
        const hit = oldItems.find(it => !usedItems.has(it.id) && key(it));
        if (!hit) return uid();
        usedItems.add(hit.id);
        return hit.id;
      };
      const items = kind === "ing"
        ? sec.items
            .map(g => (typeof g === "string" ? parseIng(g.trim()) : { q: (g.amount || "").trim(), n: g.name.trim() }))
            .filter(g => g.n)
            .map(g => ({ id: reuse(it => norm(it.n) === norm(g.n)), q: g.q, n: g.n }))
        : sec.steps
            .map(text => text.trim())
            .filter(Boolean)
            .map(text => ({ id: reuse(it => it.text === text), text }));
      return { id: old ? old.id : uid(), name, items };
    })
    .filter(sec => sec.items.length);
}

// Adds rows to the end of the list's "to get" rows, the way the app adds
// recipe ingredients: rows whose source ingredient is already waiting on the
// list are skipped, and ticked rows of the same name are taken out of the
// cart instead of being kept twice.
function appendRows(items, rows) {
  const have = new Set(items.filter(i => !i.checked).flatMap(i => i.src || []));
  const add = rows.filter(r => !(r.src || []).some(s => have.has(s)));
  const names = new Set(add.map(r => norm(r.name)));
  return {
    items: [
      ...items.filter(i => !i.checked),
      ...add,
      ...items.filter(i => i.checked && !names.has(norm(i.name))),
    ],
    added: add,
  };
}

const ingredientInput = z.union([
  z.string().describe('An ingredient line, amount first, e.g. "2 cups spinach" or "salt".'),
  z.object({
    amount: z.string().optional().describe('e.g. "200 g", "2", "1 tbsp". Leave out for "to taste" items.'),
    name: z.string().min(1),
  }),
]);

export function register(server, { appData, removePhoto, callFunction }) {
  const read = (name, fallback) => appData.read(APP_ID, KEYS[name], fallback);
  const update = (name, fallback, mutate) => appData.update(APP_ID, KEYS[name], fallback, mutate);
  const readRecipes = async () => (await read("recipes", [])).map(normRecipe);
  const readTier = async () => {
    const tier = await read("tier", "normal");
    return TIERS.includes(tier) ? tier : "normal";
  };

  server.registerTool("recipes_get_overview", {
    title: "Recipes: overview",
    description: "All of the user's recipes (name, category, time, servings) and shopping lists (with how many rows are left to get). Call this first: it has the ids the other recipes tools take.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => {
    const [recipes, lists, tier] = await Promise.all([readRecipes(), read("lists", DEFAULT_LISTS), readTier()]);
    return json({
      appUrl: APP_URL,
      categories: CATS,
      priceTier: tier,
      recipes: recipes.map(r => ({
        id: r.id,
        name: r.name,
        category: r.cat,
        timeMin: r.time,
        serves: r.serves,
        ingredientCount: allIngs(r).length,
      })),
      lists: lists.map(l => ({
        id: l.id,
        name: l.name,
        toGet: l.items.filter(i => !i.checked).length,
        inCart: l.items.filter(i => i.checked).length,
      })),
    });
  });

  server.registerTool("recipes_get_recipe", {
    title: "Recipes: get recipe",
    description: "One recipe in full: ingredients (with ids, for recipes_add_to_list), method and notes, optionally scaled to a number of servings.",
    inputSchema: {
      id: z.string(),
      servings: z.number().int().min(1).optional().describe("Scale ingredient amounts to this many servings."),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ id, servings }) => {
    return json(describeRecipe(findRecipe(await readRecipes(), id), servings));
  });

  server.registerTool("recipes_save_recipe", {
    title: "Recipes: save recipe",
    description: `Create a recipe (no id: name, ingredients and method required) or change an existing one (id: only the fields you pass change). \`ingredients\` and \`method\`, when given, replace the whole list, so repeat unchanged items too. Use a single section with no name unless the recipe really has parts. Check recipes_get_overview first so you don't create a duplicate.`,
    inputSchema: {
      id: z.string().optional().describe("Existing recipe to change. Leave out to create one."),
      name: z.string().min(1).optional(),
      category: z.enum(CATS).optional().describe("Defaults to Dinner."),
      timeMin: z.number().int().min(1).optional().describe("Total time in minutes. Defaults to 20."),
      serves: z.number().int().min(1).optional().describe("Servings the amounts are for. Defaults to 2."),
      ingredients: z.array(z.object({
        section: z.string().optional().describe('e.g. "Sauce". Leave out for a recipe without parts.'),
        items: z.array(ingredientInput).min(1),
      })).min(1).optional(),
      method: z.array(z.object({
        section: z.string().optional(),
        steps: z.array(z.string().min(1)).min(1).describe('One entry per step. Mention durations as "10 min" so the app offers a timer.'),
      })).min(1).optional(),
      notes: z.string().optional().describe('Free-form notes shown under the method (tips, substitutions, what to change next time). Replaces the existing notes; "" clears them.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async input => {
    let saved;
    let created = false;
    await update("recipes", [], stored => {
      const recipes = stored.map(normRecipe);
      const existing = input.id ? findRecipe(recipes, input.id) : null;
      if (!existing) {
        if (!input.name?.trim() || !input.ingredients || !input.method) fail("A new recipe needs a name, ingredients and method.");
        const duplicate = recipes.find(r => norm(r.name) === norm(input.name));
        if (duplicate) fail(`A recipe named "${duplicate.name}" already exists (id "${duplicate.id}"). Pass its id to change it.`);
      }
      const cat = input.category ?? existing?.cat ?? "Dinner";
      const r = {
        ...(existing ?? {}),
        id: existing?.id ?? uid(),
        name: (input.name ?? existing.name).trim(),
        cat,
        // Same rule as the app's editor: tags follow a category change.
        tags: existing && existing.cat === cat ? existing.tags : [cat],
        time: input.timeMin ?? existing?.time ?? 20,
        serves: input.serves ?? existing?.serves ?? 2,
        ingredients: input.ingredients ? buildSections("ing", input.ingredients, existing?.ingredients ?? []) : existing.ingredients,
        method: input.method ? buildSections("step", input.method, existing?.method ?? []) : existing.method,
      };
      // Like the app, empty notes aren't stored.
      const notes = (input.notes ?? existing?.notes ?? "").trim();
      if (notes) r.notes = notes;
      else delete r.notes;
      if (!r.ingredients.length) fail("The recipe needs at least one ingredient.");
      saved = r;
      created = !existing;
      // New recipes go first, like in the app.
      return existing ? recipes.map(x => (x.id === r.id ? r : x)) : [r, ...recipes];
    });
    return json({ [created ? "created" : "updated"]: describeRecipe(saved) });
  });

  server.registerTool("recipes_get_list", {
    title: "Recipes: get shopping list",
    description: "The rows of a shopping list: what's still to get and what's already in the cart (ticked).",
    inputSchema: {
      listId: z.string().optional().describe("Defaults to the first list."),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ listId }) => {
    return json(describeList(findList(await read("lists", DEFAULT_LISTS), listId)));
  });

  server.registerTool("recipes_add_to_list", {
    title: "Recipes: add to shopping list",
    description: "Add a recipe's ingredients (recipeId, optionally scaled and/or only some ingredientIds) and/or free-form items to a shopping list. Ingredients of that recipe already waiting on the list are skipped. Rows already on the list under the same name are returned as possibleDuplicates: combine those with recipes_update_list (set the kept row's amount to the sum, remove the other).",
    inputSchema: {
      listId: z.string().optional().describe("Defaults to the first list."),
      recipeId: z.string().optional(),
      servings: z.number().int().min(1).optional().describe("With recipeId: scale the amounts to this many servings."),
      ingredientIds: z.array(z.string()).min(1).optional().describe("With recipeId: only these ingredients (ids from recipes_get_recipe). Defaults to all."),
      items: z.array(ingredientInput).min(1).optional().describe("Free-form items to add."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ listId, recipeId, servings, ingredientIds, items }) => {
    if (!recipeId && !items) fail("Give recipeId and/or items.");
    if (!recipeId && (servings || ingredientIds)) fail("servings and ingredientIds only apply with recipeId.");
    const rows = [];
    if (recipeId) {
      const r = findRecipe(await readRecipes(), recipeId);
      const k = servings ? servings / r.serves : 1;
      let ings = allIngs(r);
      if (ingredientIds) {
        const unknown = ingredientIds.filter(id => !ings.some(g => g.id === id));
        if (unknown.length) fail(`"${r.name}" has no ingredient ${unknown.map(id => `"${id}"`).join(", ")}. Use recipes_get_recipe for ids.`);
        ings = ings.filter(g => ingredientIds.includes(g.id));
      }
      ings.forEach(g => rows.push({ id: uid(), name: g.n, q: scaleQty(g.q, k), checked: false, src: [`${r.id}:${g.id}`] }));
    }
    (items || []).forEach(g => {
      const { q, n } = typeof g === "string" ? parseIng(g.trim()) : { q: (g.amount || "").trim(), n: g.name.trim() };
      if (n) rows.push({ id: uid(), name: n, q, checked: false });
    });

    let result;
    await update("lists", DEFAULT_LISTS, lists => {
      const list = findList(lists, listId);
      const { items: next, added } = appendRows(list.items, rows);
      const addedIds = new Set(added.map(r => r.id));
      const addedNames = new Set(added.map(r => norm(r.name)));
      result = {
        list: { id: list.id, name: list.name },
        added: added.map(r => ({ id: r.id, name: r.name, amount: r.q })),
        skippedAlreadyOnList: rows.length - added.length,
        possibleDuplicates: next
          .filter(i => !i.checked && !addedIds.has(i.id) && addedNames.has(norm(i.name)))
          .map(i => ({ id: i.id, name: i.name, amount: i.q || "" })),
      };
      if (!added.length) return lists;
      return lists.map(l => (l.id === list.id ? { ...l, items: next } : l));
    });
    if (!result.possibleDuplicates.length) delete result.possibleDuplicates;
    return json(result);
  });

  server.registerTool("recipes_update_list", {
    title: "Recipes: update shopping list",
    description: "Change rows on a shopping list: rename, change the amount, tick (into the cart) or untick, or remove. clearInCart removes every ticked row, clearAll empties the list (confirm with the user first).",
    inputSchema: {
      listId: z.string().optional().describe("Defaults to the first list."),
      changes: z.array(z.object({
        id: z.string().describe("Row id from recipes_get_list."),
        name: z.string().min(1).optional(),
        amount: z.string().optional().describe('New amount text, "" for none.'),
        checked: z.boolean().optional().describe("true puts it in the cart, false back on the to-get list."),
        remove: z.boolean().optional(),
      })).optional(),
      clearInCart: z.boolean().optional(),
      clearAll: z.boolean().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ listId, changes = [], clearInCart, clearAll }) => {
    let updated;
    await update("lists", DEFAULT_LISTS, lists => {
      const list = findList(lists, listId);
      let items = list.items;
      changes.forEach(c => {
        const row = items.find(i => i.id === c.id)
          || fail(`"${list.name}" has no row "${c.id}". Use recipes_get_list for ids.`);
        if (c.remove) {
          items = items.filter(i => i.id !== c.id);
          return;
        }
        const next = {
          ...row,
          ...(c.name !== undefined ? { name: c.name.trim() } : {}),
          ...(c.amount !== undefined ? { q: c.amount.trim() } : {}),
        };
        if (c.checked === undefined || c.checked === row.checked) {
          items = items.map(i => (i.id === c.id ? next : i));
        } else {
          // Like ticking in the app: the row goes to the end of the to-get
          // rows, i.e. the top of the cart or the bottom of what's left.
          const rest = items.filter(i => i.id !== c.id);
          items = [...rest.filter(i => !i.checked), { ...next, checked: c.checked }, ...rest.filter(i => i.checked)];
        }
      });
      if (clearInCart) items = items.filter(i => !i.checked);
      if (clearAll) items = [];
      updated = { ...list, items };
      return lists.map(l => (l.id === list.id ? updated : l));
    });
    return json(describeList(updated));
  });

  server.registerTool("recipes_save_list", {
    title: "Recipes: save shopping list",
    description: "Create a shopping list (no id) or rename one (id).",
    inputSchema: {
      id: z.string().optional(),
      name: z.string().min(1),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ id, name }) => {
    let saved;
    await update("lists", DEFAULT_LISTS, lists => {
      if (id) {
        findList(lists, id);
        saved = { ...lists.find(l => l.id === id), name: name.trim() };
        return lists.map(l => (l.id === id ? saved : l));
      }
      saved = { id: uid(), name: name.trim(), items: [] };
      return [...lists, saved];
    });
    return json({ id: saved.id, name: saved.name });
  });

  server.registerTool("recipes_delete", {
    title: "Recipes: delete",
    description: "Permanently delete a recipe (and its photo) or a whole shopping list. The last remaining list can't be deleted. Confirm with the user first.",
    inputSchema: {
      kind: z.enum(["recipe", "list"]),
      id: z.string(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ kind, id }) => {
    let name;
    if (kind === "recipe") {
      let photo;
      await update("recipes", [], recipes => {
        const r = findRecipe(recipes, id);
        name = r.name;
        photo = r.photo;
        return recipes.filter(x => x.id !== id);
      });
      // Best effort, like the app: a leftover file only costs a little storage.
      if (photo && removePhoto) await removePhoto(photo).catch(() => {});
    } else {
      await update("lists", DEFAULT_LISTS, lists => {
        name = findList(lists, id).name;
        if (lists.length === 1) fail(`"${name}" is the only list, so it can't be deleted. Clear it with recipes_update_list instead.`);
        return lists.filter(l => l.id !== id);
      });
    }
    return json({ deleted: { kind, id, name } });
  });

  if (callFunction) {
    server.registerTool("recipes_estimate_price", {
      title: "Recipes: estimate price",
      description: "Estimate what a recipe (optionally scaled) or the to-get rows of a shopping list cost at Aldi Suisse, in CHF, with a per-item breakdown. buy is what you'd pay at the till (whole packs), used the share the amounts actually use. Takes up to a minute.",
      inputSchema: {
        recipeId: z.string().optional(),
        servings: z.number().int().min(1).optional().describe("With recipeId: price this many servings."),
        listId: z.string().optional().describe("Price this list's to-get rows instead of a recipe."),
        tier: z.enum(TIERS).optional().describe("cheapest, normal or premium products. Defaults to the user's setting in the app."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    }, async ({ recipeId, servings, listId, tier }) => {
      if (!!recipeId === !!listId) fail("Give either recipeId or listId.");
      let items;
      let what;
      if (recipeId) {
        const r = findRecipe(await readRecipes(), recipeId);
        const k = servings ? servings / r.serves : 1;
        items = allIngs(r).map(g => ({ id: g.id, q: scaleQty(g.q, k), name: g.n }));
        what = { recipe: r.name, servings: servings ?? r.serves };
      } else {
        const list = findList(await read("lists", DEFAULT_LISTS), listId);
        items = list.items.filter(i => !i.checked).map(i => ({ id: i.id, q: i.q || "", name: i.name }));
        what = { list: list.name };
      }
      if (!items.length) fail("There's nothing to price.");
      const usedTier = tier ?? await readTier();
      const result = await callFunction("price-estimate", { items, tier: usedTier });
      const totals = priceTotals(result);
      const sent = new Map(items.map(i => [i.id, i]));
      return json({
        ...what,
        tier: usedTier,
        currency: "CHF",
        buy: Math.round(totals.buy * 100) / 100,
        used: Math.round(totals.used * 100) / 100,
        unpriced: totals.missing,
        ...(result.produceMonth ? { producePricesFrom: result.produceMonth } : {}),
        items: (result.items || []).map(i => ({
          item: sent.has(i.id) ? ingToLine({ q: sent.get(i.id).q, n: sent.get(i.id).name }) : i.id,
          ...i,
        })),
      });
    });
  }
}
