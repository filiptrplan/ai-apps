// Supabase Edge Function: turns screenshots, pasted text and/or a recipe link
// into one structured recipe for the Recipes app ("✦ Magic"), via an LLM on
// OpenRouter. Only signed-in users may call it (it checks their access token
// itself), since every call costs API credit.
//
// Links are fetched here (browsers can't read other sites' pages) and reduced
// to the page's schema.org Recipe data when it has one, else its plain text.
//
// Needs the OPENROUTER_API_KEY secret (shared with the shopping-list function):
//   supabase secrets set OPENROUTER_API_KEY=...
// Deploy with:
//   supabase functions deploy recipe-import

const MODEL = "openai/gpt-6-luna";

const MAX_IMAGES = 8;
const MAX_IMAGE_CHARS = 3_000_000; // base64, per image
const MAX_TEXT_CHARS = 30000;
const MAX_PAGE_BYTES = 3_000_000;
const PAGE_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 5;

const SECTION = {
  type: "object",
  additionalProperties: false,
  required: ["name", "items"],
  properties: {
    name: { type: "string" },
    items: { type: "array", items: { type: "string" } },
  },
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "cat", "time", "serves", "ingredients", "method", "notes"],
  properties: {
    name: { type: "string" },
    cat: { type: "string", enum: ["Breakfast", "Lunch", "Dinner"] },
    time: { type: "integer", description: "Total minutes." },
    serves: { type: "integer" },
    ingredients: { type: "array", items: SECTION },
    method: { type: "array", items: SECTION },
    notes: { type: "string" },
  },
};

const SYSTEM = `You turn the sources a user gives you (screenshots, photos of a cookbook page, pasted text, the content of a recipe web page) into one recipe.

- name: the recipe's own title, or a short descriptive one.
- cat: the meal it best fits.
- time: total time in minutes (prep + cooking). Estimate if not stated.
- serves: number of servings as stated, else a sensible estimate.
- ingredients: sections of ingredients. Each item is one ingredient, quantity first, then the ingredient name in Title case, e.g. "2 cups Spinach", "200 g Chicken breast", "1 Lemon". Keep the recipe's own units and amounts. Leave the quantity out if there is none ("Salt").
- method: sections of steps. Each item is one concise step, without numbering. Keep durations in the text ("simmer for 10 minutes") since the app turns them into timers.
- notes: tips, substitutions, storage or make-ahead advice the source gives outside the steps, as short plain text (one per line). Empty if there are none; don't invent any.

Sections: when the recipe groups its ingredients or method by component (e.g. "Sauce", "Dough", "Topping"), make one section per group, named as the recipe names it. Otherwise use a single section with an empty name. Ingredients and method are grouped independently.

Use the language the recipe is written in. If the sources contain no recipe at all, return an empty name and empty lists.`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// True when the request carries a signed-in user's access token (not just
// the public key, which is also sent as a bearer token when logged out).
async function isSignedIn(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, {
    headers: { apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "", Authorization: auth },
  });
  return res.ok;
}

// Finds a schema.org Recipe object in a page's JSON-LD blocks, which most
// recipe sites include for search engines.
function findJsonLdRecipe(html: string): unknown {
  const blocks = html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi);
  const isRecipe = (x: any) => x && (x["@type"] === "Recipe" || (Array.isArray(x["@type"]) && x["@type"].includes("Recipe")));
  for (const [, body] of blocks) {
    let data: any;
    try {
      data = JSON.parse(body.trim());
    } catch {
      continue;
    }
    const candidates = [data, ...(Array.isArray(data) ? data : []), ...(Array.isArray(data?.["@graph"]) ? data["@graph"] : [])];
    const found = candidates.find(isRecipe);
    if (found) return found;
  }
  return null;
}

function htmlToText(html: string) {
  return html
    .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|li|h\d|div|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

// Rejects non-web schemes, IP literals and local names, so a link can't be
// used to probe internal services.
function isPublicWebUrl(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) return false;
  if (/^[\d.]+$/.test(host) || host.startsWith("[")) return false;
  return true;
}

// Returns the recipe content of a web page as text, or an error message.
async function readPage(link: string): Promise<{ text?: string; error?: string }> {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return { error: "That link isn't a valid URL." };
  }

  // Follows redirects by hand so every hop gets the public-host check.
  let res: Response | null = null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isPublicWebUrl(url)) return { error: "Only public web links are supported." };
    try {
      res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; RecipesApp/1.0)", Accept: "text/html" },
        redirect: "manual",
        signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      });
    } catch {
      return { error: "Couldn't open that link." };
    }
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) break;
    url = new URL(location, url);
  }
  if (!res || !res.ok) return { error: `That link returned an error (${res?.status ?? "redirect loop"}).` };
  const buf = await res.arrayBuffer();
  const html = new TextDecoder().decode(buf.byteLength > MAX_PAGE_BYTES ? buf.slice(0, MAX_PAGE_BYTES) : buf);

  const recipe = findJsonLdRecipe(html);
  if (recipe) return { text: JSON.stringify(recipe).slice(0, MAX_TEXT_CHARS) };
  return { text: htmlToText(html).slice(0, MAX_TEXT_CHARS) };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!(await isSignedIn(request))) return json({ error: "Sign in to use Magic." }, 401);
  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) return json({ error: "The server has no OpenRouter API key configured." }, 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const images: { media: string; data: string }[] = Array.isArray(body?.images)
    ? body.images.filter((im: any) => typeof im?.data === "string" && /^image\/[a-z+.-]+$/.test(im?.media ?? ""))
    : [];
  const link = typeof body?.link === "string" ? body.link.trim() : "";
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!images.length && !link && !text) return json({ error: "Add a screenshot, some text or a link." }, 400);
  if (images.length > MAX_IMAGES) return json({ error: `At most ${MAX_IMAGES} images at once.` }, 400);
  if (images.some((im) => im.data.length > MAX_IMAGE_CHARS)) return json({ error: "One of the images is too large." }, 400);
  if (text.length > MAX_TEXT_CHARS) return json({ error: "That text is too long." }, 400);

  const parts: string[] = [];
  if (link) {
    const page = await readPage(link);
    if (page.error && !images.length && !text) return json({ error: page.error }, 422);
    if (page.text) parts.push(`<web_page url="${link}">\n${page.text}\n</web_page>`);
  }
  if (text) parts.push(`<pasted_text>\n${text}\n</pasted_text>`);
  if (images.length) parts.push(`${images.length} image(s) attached.`);

  const content = [
    ...images.map((im) => ({ type: "image_url", image_url: { url: `data:${im.media};base64,${im.data}` } })),
    { type: "text", text: parts.join("\n\n") },
  ];

  let res;
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-Title": "AI Apps - Recipes",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8000,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "recipe", strict: true, schema: SCHEMA },
        },
        // Only route to providers that enforce the schema.
        provider: { require_parameters: true },
      }),
    });
  } catch {
    return json({ error: "Couldn't reach the AI service." }, 502);
  }
  if (res.status === 429) return json({ error: "Too many requests - try again in a minute." }, 429);
  if (!res.ok) return json({ error: `AI request failed (${res.status}).` }, 502);

  const data = await res.json().catch(() => null);
  const choice = data?.choices?.[0];
  if (!choice) return json({ error: data?.error?.message ?? "The AI returned no answer - try again." }, 502);
  if (choice.finish_reason === "length") return json({ error: "That recipe is too long to read in one go." }, 422);
  if (choice.message?.refusal) return json({ error: "The AI declined to process this." }, 422);

  let recipe;
  try {
    recipe = JSON.parse(choice.message?.content);
  } catch {
    return json({ error: "The AI returned something unreadable - try again." }, 502);
  }
  if (!recipe.name && !recipe.ingredients?.some((s: { items: string[] }) => s.items.length)) {
    return json({ error: "Couldn't find a recipe in that. Try more text or a clearer screenshot." }, 422);
  }
  return json(recipe);
});
