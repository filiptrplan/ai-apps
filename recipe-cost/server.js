// Server side of the Recipe Cost app, run by worker.js (never served as a
// static file — see .assetsignore).
//
// POST /api/recipe-cost with { recipe, servings } and the user's Supabase
// access token as a Bearer token. Claude reads the recipe, looks up each
// ingredient on aldi-suisse.ch with web search, and reports the matched
// products through the `report_breakdown` tool. The response is NDJSON:
//   {"type":"status","text":"..."}   progress (searches, pages read)
//   {"type":"result","breakdown":{}} the final breakdown
//   {"type":"error","error":"..."}   something went wrong
import Anthropic from "@anthropic-ai/sdk";

const SUPABASE_URL = "https://zqxvlczqfqmcojbgwogs.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_IYIQPdhNqRWKj2SCS3pHKA_kp4jbYVr";

const MODEL = "claude-opus-5";
const MAX_RECIPE_CHARS = 20000;
// Each request can pause (pause_turn) after the server-side tool loop hits its
// iteration limit, and needs one more to resume; this bounds the total.
const MAX_REQUESTS = 6;
const ALDI_DOMAINS = ["aldi-suisse.ch"];

const SYSTEM_PROMPT = `You price recipes for someone who shops at ALDI SUISSE (Aldi in Switzerland). Prices are in CHF.

For the recipe you're given:
1. Work out every ingredient and the quantity the recipe needs, scaled to the requested number of servings if one is given.
2. For each ingredient, find the product at ALDI SUISSE a home cook would most likely buy - the cheapest sensible everyday option (e.g. their own brands), not premium or organic unless the recipe asks for it. Use web_search (restricted to aldi-suisse.ch) to find it, and web_fetch on a product or category page when the search result doesn't show the price or pack size. Combine related ingredients into one search where that works (e.g. "Aldi Suisse Karotten Zwiebeln Preis"); searching in German usually works best.
3. Report the result with the report_breakdown tool, called exactly once at the end.

Rules for the breakdown:
- package_price_chf is the shelf price of one pack as listed by ALDI SUISSE, and package_size is its size as printed (e.g. "500 g", "1 l", "6 Stück").
- fraction_used is how much of one pack the recipe uses, as a decimal (250 g from a 500 g pack is 0.5; 750 g from a 500 g pack is 1.5). Convert units yourself (e.g. 1 tbsp olive oil ≈ 14 ml, 1 medium onion ≈ 150 g, 1 clove garlic ≈ 5 g).
- packages_to_buy is how many whole packs you'd have to buy (at least 1 for anything bought).
- status "found": you found this product and its price on aldi-suisse.ch. "estimated": you couldn't confirm it on the site, so give your best estimate of the ALDI SUISSE price and say so in the note. "pantry": water, or a pinch of salt/pepper-style amounts that cost essentially nothing - set its prices to 0 and packages_to_buy to 0.
- product_url must be a URL you actually saw in search or fetch results, otherwise null. Never invent URLs.
- Keep notes short and practical (e.g. "only sold as 1 kg bag", "seasonal - may be unavailable").`;

const REPORT_TOOL = {
  name: "report_breakdown",
  description:
    "Report the final cost breakdown of the recipe at ALDI SUISSE. Call this exactly once, after all the searching is done.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["recipe_title", "servings", "items", "notes"],
    properties: {
      recipe_title: { type: "string", description: "Short name of the recipe." },
      servings: {
        type: ["integer", "null"],
        description: "Number of servings the quantities are for, or null if unknown.",
      },
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "ingredient",
            "quantity_needed",
            "status",
            "product_name",
            "product_url",
            "package_size",
            "package_price_chf",
            "fraction_used",
            "packages_to_buy",
            "note",
          ],
          properties: {
            ingredient: { type: "string", description: "The ingredient as named in the recipe." },
            quantity_needed: { type: "string", description: 'e.g. "200 g" or "2 tbsp".' },
            status: { type: "string", enum: ["found", "estimated", "pantry"] },
            product_name: { type: ["string", "null"] },
            product_url: { type: ["string", "null"] },
            package_size: { type: ["string", "null"] },
            package_price_chf: { type: "number" },
            fraction_used: { type: "number" },
            packages_to_buy: { type: "integer" },
            note: { type: ["string", "null"] },
          },
        },
      },
      notes: {
        type: "string",
        description: "One or two sentences of overall caveats, or an empty string.",
      },
    },
  },
};

function tools() {
  return [
    {
      type: "web_search_20260209",
      name: "web_search",
      allowed_domains: ALDI_DOMAINS,
      user_location: { type: "approximate", country: "CH", city: "Zürich" },
      max_uses: 30,
    },
    {
      type: "web_fetch_20260209",
      name: "web_fetch",
      allowed_domains: ALDI_DOMAINS,
      max_uses: 20,
    },
    REPORT_TOOL,
  ];
}

// Only signed-in users of the site can spend API credits: the token is
// checked against Supabase Auth.
async function verifyUser(request) {
  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

const round2 = (n) => Math.round(n * 100) / 100;
const finite = (n) => (Number.isFinite(n) && n >= 0 ? n : 0);

// Costs are computed here rather than trusted from the model's arithmetic.
export function buildBreakdown(input) {
  const items = (Array.isArray(input?.items) ? input.items : []).map((item) => {
    const price = finite(item.package_price_chf);
    const fraction = finite(item.fraction_used);
    const pantry = item.status === "pantry";
    const packs = pantry ? 0 : Math.max(1, Math.round(finite(item.packages_to_buy)));
    return {
      ingredient: String(item.ingredient ?? ""),
      quantityNeeded: String(item.quantity_needed ?? ""),
      status: ["found", "estimated", "pantry"].includes(item.status) ? item.status : "estimated",
      productName: item.product_name || null,
      productUrl: /^https:\/\/([a-z0-9-]+\.)*aldi-suisse\.ch\//i.test(item.product_url ?? "")
        ? item.product_url
        : null,
      packageSize: item.package_size || null,
      packagePrice: pantry ? 0 : round2(price),
      fractionUsed: fraction,
      packagesToBuy: packs,
      costUsed: pantry ? 0 : round2(price * fraction),
      costToBuy: pantry ? 0 : round2(price * packs),
      note: item.note || null,
    };
  });
  const totalUsed = round2(items.reduce((sum, i) => sum + i.costUsed, 0));
  const totalToBuy = round2(items.reduce((sum, i) => sum + i.costToBuy, 0));
  const servings = Number.isInteger(input?.servings) && input.servings > 0 ? input.servings : null;
  return {
    title: String(input?.recipe_title || "Recipe"),
    servings,
    items,
    notes: String(input?.notes ?? ""),
    totalUsed,
    totalToBuy,
    perServing: servings ? round2(totalUsed / servings) : null,
  };
}

function statusFor(block) {
  if (block.type !== "server_tool_use") return null;
  if (block.name === "web_search" && block.input?.query) return `Searching Aldi: ${block.input.query}`;
  if (block.name === "web_fetch" && block.input?.url) return `Reading ${block.input.url}`;
  return null;
}

async function analyze(client, { recipe, servings }, send) {
  const ask = servings
    ? `Price this recipe for ${servings} serving${servings === 1 ? "" : "s"}.`
    : "Price this recipe for the number of servings it's written for.";
  const messages = [{ role: "user", content: `${ask}\n\n<recipe>\n${recipe}\n</recipe>` }];

  for (let i = 0; i < MAX_REQUESTS; i++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: SYSTEM_PROMPT,
      tools: tools(),
      messages,
    });
    stream.on("contentBlock", (block) => {
      const text = statusFor(block);
      if (text) send({ type: "status", text });
    });
    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      throw new Error("The model declined to analyze this recipe.");
    }
    const report = message.content.find(
      (b) => b.type === "tool_use" && b.name === REPORT_TOOL.name
    );
    if (report) return buildBreakdown(report.input);

    messages.push({ role: "assistant", content: message.content });
    if (message.stop_reason === "pause_turn") continue;
    if (message.stop_reason === "max_tokens") {
      throw new Error("The recipe was too long to finish analyzing.");
    }
    // Finished without reporting; ask once more for the tool call.
    send({ type: "status", text: "Putting the breakdown together…" });
    messages.push({
      role: "user",
      content: "Please report the breakdown now with the report_breakdown tool.",
    });
  }
  throw new Error("The analysis took too many steps. Try a shorter recipe.");
}

function errorMessage(err) {
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by the AI API — try again in a minute.";
  if (err instanceof Anthropic.AuthenticationError) return "The server's AI API key is invalid.";
  if (err instanceof Anthropic.APIError) return `AI API error${err.status ? ` (${err.status})` : ""}: ${err.message}`;
  return err?.message || "Something went wrong.";
}

const jsonError = (error, status) =>
  new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export async function handleRecipeCost(request, env, ctx) {
  if (request.method !== "POST") return jsonError("Use POST", 405);
  if (!env.ANTHROPIC_API_KEY) return jsonError("The server has no ANTHROPIC_API_KEY configured.", 500);
  if (!(await verifyUser(request))) return jsonError("Sign in to use Recipe Cost.", 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  const recipe = typeof body?.recipe === "string" ? body.recipe.trim() : "";
  if (!recipe) return jsonError("Paste a recipe first.", 400);
  if (recipe.length > MAX_RECIPE_CHARS) return jsonError("That recipe is too long.", 400);
  const servings = Number.isInteger(body.servings) && body.servings > 0 && body.servings <= 100 ? body.servings : null;

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  let open = true;
  const send = (obj) => {
    if (!open) return;
    writer.write(encoder.encode(`${JSON.stringify(obj)}\n`)).catch(() => {
      open = false;
    });
  };

  const task = (async () => {
    try {
      send({ type: "status", text: "Reading the recipe…" });
      const breakdown = await analyze(client, { recipe, servings }, send);
      send({ type: "result", breakdown });
    } catch (err) {
      send({ type: "error", error: errorMessage(err) });
    } finally {
      open = false;
      writer.close().catch(() => {});
    }
  })();
  ctx?.waitUntil?.(task);

  return new Response(readable, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
  });
}
