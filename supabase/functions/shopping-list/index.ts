// Supabase Edge Function: turns pasted recipes into shopping list rows via
// an LLM on OpenRouter. Only signed-in users may call it (it checks their
// access token itself), since every call costs API credit.
//
// The model extracts one row per ingredient per recipe, with names made
// consistent across recipes and quantities converted to a small set of
// units; the app sums matching rows itself, so the arithmetic stays exact.
//
// Needs the OPENROUTER_API_KEY secret (see _shared/openrouter.ts).
// Deploy with:
//   supabase functions deploy shopping-list

import { json, serveSignedIn } from "../_shared/http.ts";
import { AIError, structuredCompletion } from "../_shared/openrouter.ts";

const MAX_RECIPES = 20;
const MAX_TOTAL_CHARS = 60000;

// Keep in sync with CATEGORY_ORDER in shopping-list/aggregate.js.
const CATEGORIES = [
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

const UNITS = ["g", "ml", "pcs", "tsp", "tbsp", "pinch", "bunch", "clove", "can", "to taste"];

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["recipes", "items"],
  properties: {
    recipes: {
      type: "array",
      description: "One entry per input recipe, in input order.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "title"],
        properties: {
          index: { type: "integer" },
          title: { type: "string" },
        },
      },
    },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["recipeIndex", "name", "category", "quantity", "unit", "note"],
        properties: {
          recipeIndex: { type: "integer" },
          name: { type: "string" },
          category: { type: "string", enum: CATEGORIES },
          quantity: { type: ["number", "null"] },
          unit: { type: "string", enum: UNITS },
          note: { type: "string" },
        },
      },
    },
  },
};

const SYSTEM = `You turn recipes into rows for a combined shopping list. The app sums rows that share the exact same "name" and "unit", so consistency across recipes is what matters most.

For every ingredient of every recipe, output one row:
- recipeIndex: the index of the recipe it came from.
- name: a short, generic shopping name in the language the recipes are written in, singular, lowercase, without preparation words ("chicken breast", not "2 diced chicken breasts"). When two recipes need the same thing to buy, use the identical name for both, even if the recipes word it differently ("chicken breast fillets" and "chicken breasts" -> "chicken breast"). Keep genuinely different products separate ("chicken breast" vs "chicken thigh", "red onion" vs "onion").
- category: the supermarket section it's found in.
- quantity and unit: convert to the listed units. Weights go to "g" (1 kg = 1000 g, 1 lb = 454 g, 1 oz = 28 g), volumes of liquids go to "ml" (1 l = 1000 ml, 1 cup = 240 ml, 1 dl = 100 ml). Cups of dry ingredients (flour, sugar, rice, ...) go to "g" using a typical density. Countable items (eggs, onions, lemons) use "pcs". Keep small amounts of spices, baking powder etc. in "tsp"/"tbsp"/"pinch". Garlic uses "clove" unless the recipe gives whole bulbs or grams. Use "to taste" with quantity null when no amount is given. If a recipe gives a range, use the upper bound. If a recipe states the same ingredient more than once (e.g. for a sauce and a marinade), output a single row with the total for that recipe.
- note: very short extra detail worth knowing at the store (e.g. "boneless", "full-fat", "fresh"), otherwise "".

Also give each recipe a short title (use its own title if it has one).

Skip plain tap water. Skip lines that are clearly not ingredients (method steps, nutrition info, serving suggestions that aren't part of the recipe). Do not scale amounts: use them exactly as the recipe states.`;

serveSignedIn("Sign in to build a shopping list.", async (body) => {
  const recipes: string[] = Array.isArray(body?.recipes)
    ? body.recipes.filter((r: unknown) => typeof r === "string" && r.trim())
    : [];
  if (recipes.length === 0) return json({ error: "Paste at least one recipe." }, 400);
  if (recipes.length > MAX_RECIPES) return json({ error: `At most ${MAX_RECIPES} recipes at once.` }, 400);
  if (recipes.reduce((n, r) => n + r.length, 0) > MAX_TOTAL_CHARS) {
    return json({ error: "Those recipes are too long - try fewer at once." }, 400);
  }

  const user = recipes
    .map((text, i) => `<recipe index="${i}">\n${text.trim()}\n</recipe>`)
    .join("\n\n");

  try {
    const list = await structuredCompletion({
      system: SYSTEM,
      user,
      schema: SCHEMA,
      schemaName: "shopping_list",
      title: "AI Apps - Shopping List",
    });
    return json(list);
  } catch (err) {
    if (!(err instanceof AIError)) throw err;
    const message = {
      too_long: "Too many ingredients at once - try fewer recipes.",
      refused: "The AI declined to process these recipes.",
    }[err.code as string] ?? err.message;
    return json({ error: message }, err.status);
  }
});
