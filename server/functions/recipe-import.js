// Turns screenshots, pasted text and/or a recipe link into one structured
// recipe for the Recipes app ("✦ Magic"), via an LLM on OpenRouter.
//
// Links are fetched here (browsers can't read other sites' pages) and reduced
// to the page's schema.org Recipe data when it has one, else its plain text.
// Since this runs next to our own services, a link may only lead to public
// addresses (see isPublicAddress).
//
// Needs OPENROUTER_API_KEY (see _shared/openrouter.js).

import dns from "node:dns";
import { BlockList, isIP } from "node:net";
import { HttpError } from "./_shared/http.js";
import { AIError, structuredCompletion } from "./_shared/openrouter.js";

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

// Finds a schema.org Recipe object in a page's JSON-LD blocks, which most
// recipe sites include for search engines.
function findJsonLdRecipe(html) {
  const blocks = html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi);
  const isRecipe = (x) => x && (x["@type"] === "Recipe" || (Array.isArray(x["@type"]) && x["@type"].includes("Recipe")));
  for (const [, body] of blocks) {
    let data;
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

function htmlToText(html) {
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
function isPublicWebUrl(url) {
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) return false;
  if (/^[\d.]+$/.test(host) || host.startsWith("[")) return false;
  return true;
}

// Addresses a link must not lead to: this machine, private networks
// (Docker, the LAN, Tailscale's 100.64/10), link-local and the like.
const PRIVATE = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3],
]) PRIVATE.addSubnet(net, bits, "ipv4");
// IPv4-mapped addresses (::ffff:a.b.c.d) aren't listed: BlockList would
// then match every IPv4 address too. isPublicAddress checks their IPv4 part.
for (const [net, bits] of [["::", 127], ["64:ff9b::", 96], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]]) {
  PRIVATE.addSubnet(net, bits, "ipv6");
}

export function isPublicAddress(address) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) address = mapped[1];
  const family = isIP(address);
  if (!family) return false;
  return !PRIVATE.check(address, family === 4 ? "ipv4" : "ipv6");
}

// True when every address the host name resolves to is public. The fetch
// resolves the name again, so a DNS server answering differently the second
// time could still slip through; that needs a hostile DNS server and a
// signed-in user.
async function resolvesPublic(host) {
  try {
    const addresses = await dns.promises.lookup(host, { all: true, verbatim: true });
    return addresses.length > 0 && addresses.every((a) => isPublicAddress(a.address));
  } catch {
    return false;
  }
}

// Returns the recipe content of a web page as { text }, or { error }.
async function readPage(link) {
  let url;
  try {
    url = new URL(link);
  } catch {
    return { error: "That link isn't a valid URL." };
  }

  // Follows redirects by hand so every hop gets the public-host check.
  let res = null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isPublicWebUrl(url) || !(await resolvesPublic(url.hostname))) return { error: "Only public web links are supported." };
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

export const signedOut = "Sign in to use Magic.";

export async function handle(body) {
  const images = Array.isArray(body?.images)
    ? body.images.filter((im) => typeof im?.data === "string" && /^image\/[a-z+.-]+$/.test(im?.media ?? ""))
    : [];
  const link = typeof body?.link === "string" ? body.link.trim() : "";
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!images.length && !link && !text) throw new HttpError(400, "Add a screenshot, some text or a link.");
  if (images.length > MAX_IMAGES) throw new HttpError(400, `At most ${MAX_IMAGES} images at once.`);
  if (images.some((im) => im.data.length > MAX_IMAGE_CHARS)) throw new HttpError(400, "One of the images is too large.");
  if (text.length > MAX_TEXT_CHARS) throw new HttpError(400, "That text is too long.");

  const parts = [];
  if (link) {
    const page = await readPage(link);
    if (page.error && !images.length && !text) throw new HttpError(422, page.error);
    if (page.text) parts.push(`<web_page url="${link}">\n${page.text}\n</web_page>`);
  }
  if (text) parts.push(`<pasted_text>\n${text}\n</pasted_text>`);
  if (images.length) parts.push(`${images.length} image(s) attached.`);

  let recipe;
  try {
    recipe = await structuredCompletion({
      system: SYSTEM,
      user: [
        ...images.map((im) => ({ type: "image_url", image_url: { url: `data:${im.media};base64,${im.data}` } })),
        { type: "text", text: parts.join("\n\n") },
      ],
      schema: SCHEMA,
      schemaName: "recipe",
      title: "AI Apps - Recipes",
      model: MODEL,
      maxTokens: 8000,
    });
  } catch (err) {
    if (!(err instanceof AIError)) throw err;
    const message = {
      too_long: "That recipe is too long to read in one go.",
      refused: "The AI declined to process this.",
    }[err.code] ?? err.message;
    throw new AIError(err.code, message, err.status);
  }
  if (!recipe.name && !recipe.ingredients?.some((s) => s.items.length)) {
    throw new HttpError(422, "Couldn't find a recipe in that. Try more text or a clearer screenshot.");
  }
  return recipe;
}
