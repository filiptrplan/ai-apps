// POST /api/shopping-list - turns pasted recipes into a list of ingredients
// via Claude. Only signed-in users of the site may call it (the request
// carries their Supabase access token), since every call costs API credit.
//
// Claude extracts one row per ingredient per recipe, with names made
// consistent across recipes and quantities converted to a small set of
// units; the app sums matching rows itself, so the arithmetic stays exact.
//
// Needs the ANTHROPIC_API_KEY secret: `npx wrangler secret put ANTHROPIC_API_KEY`.

import Anthropic from "@anthropic-ai/sdk";

const SUPABASE_URL = "https://zqxvlczqfqmcojbgwogs.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_IYIQPdhNqRWKj2SCS3pHKA_kp4jbYVr";

const MAX_RECIPES = 20;
const MAX_TOTAL_CHARS = 60000;

export const CATEGORIES = [
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

export const UNITS = ["g", "ml", "pcs", "tsp", "tbsp", "pinch", "bunch", "clove", "can", "to taste"];

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

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function isSignedIn(request) {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: auth },
  });
  return res.ok;
}

export async function shoppingList(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!(await isSignedIn(request))) return json({ error: "Sign in to build a shopping list." }, 401);
  if (!env.ANTHROPIC_API_KEY) return json({ error: "The server has no Anthropic API key configured." }, 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const recipes = Array.isArray(body?.recipes)
    ? body.recipes.filter((r) => typeof r === "string" && r.trim())
    : [];
  if (recipes.length === 0) return json({ error: "Paste at least one recipe." }, 400);
  if (recipes.length > MAX_RECIPES) return json({ error: `At most ${MAX_RECIPES} recipes at once.` }, 400);
  if (recipes.reduce((n, r) => n + r.length, 0) > MAX_TOTAL_CHARS) {
    return json({ error: "Those recipes are too long - try fewer at once." }, 400);
  }

  const content = recipes
    .map((text, i) => `<recipe index="${i}">\n${text.trim()}\n</recipe>`)
    .join("\n\n");

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  let response;
  try {
    response = await client.beta.messages.create({
      model: "claude-opus-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [{ role: "user", content }],
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: SCHEMA },
      },
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json({ error: "Too many requests - try again in a minute." }, 429);
    if (err instanceof Anthropic.APIError) return json({ error: `AI request failed (${err.status ?? "network"}).` }, 502);
    throw err;
  }

  if (response.stop_reason === "refusal") return json({ error: "The AI declined to process these recipes." }, 422);
  if (response.stop_reason === "max_tokens") return json({ error: "Too many ingredients at once - try fewer recipes." }, 422);

  const text = response.content.find((b) => b.type === "text")?.text;
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    return json({ error: "The AI returned something unreadable - try again." }, 502);
  }
  return json(result);
}
