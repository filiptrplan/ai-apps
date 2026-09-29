// Supabase Edge Function: estimates what a list of ingredients costs at
// Aldi Suisse, for the Recipes and Shopping List apps. Only signed-in users
// may call it (it checks their access token itself).
//
// Prices come from two places:
// - Aldi Suisse's product search (api.aldi-suisse.ch), for packaged goods.
//   An LLM turns each item into German search terms and then picks the
//   matching product and how many packs are needed.
// - The Federal Office for Agriculture's monthly Swiss retail prices for
//   fresh fruit, vegetables and potatoes (LINDAS SPARQL endpoint), since
//   Aldi doesn't publish its produce prices online. Those are averages over
//   classic retail (no discounters), so the apps label them as such.
// Items still unpriced get up to RETRY_ROUNDS more tries: the LLM sees which
// terms missed and what they turned up, suggests different ones, and picks
// again. Items found in neither get no price. Costs are worked out here from
// the fetched prices; the LLM only picks products and quantities.
//
// Needs the OPENROUTER_API_KEY secret (see _shared/openrouter.ts).
// Deploy with:
//   supabase functions deploy price-estimate

import { json, serveSignedIn } from "../_shared/http.ts";
import { AIError, structuredCompletion } from "../_shared/openrouter.ts";

const MAX_ITEMS = 100;
const MAX_TOTAL_CHARS = 10000;
const TITLE = "AI Apps - Prices";
const RETRY_ROUNDS = 2;

// ---- Fresh produce: BLW monthly consumer prices ----

const LINDAS = "https://lindas.admin.ch/query";
const PRODUCE_CUBE = "https://agriculture.ld.admin.ch/foag/cube/FruitsVegetablesPotatoes/Consumption_Price_Month";
const NON_ORGANIC = "https://agriculture.ld.admin.ch/foag/production-system/4";
const PRODUCE_TTL_MS = 12 * 3600 * 1000;

type Produce = { name: string; unit: string; price: number; month: string };
let produceCache: { at: number; rows: Produce[] } | null = null;

function monthsBack(n: number) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 7);
}

// The newest price of each product (CHF per kg, Stück or Bund), averaged
// over sales regions. Empty when the endpoint can't be reached.
async function producePrices(): Promise<Produce[]> {
  if (produceCache && Date.now() - produceCache.at < PRODUCE_TTL_MS) return produceCache.rows;
  const query = `PREFIX cube: <https://cube.link/>
PREFIX schema: <http://schema.org/>
PREFIX d: <https://agriculture.ld.admin.ch/foag/dimension/>
PREFIX m: <https://agriculture.ld.admin.ch/foag/measure/>
SELECT ?pn ?un ?date (AVG(?price) AS ?avg) WHERE {
  <${PRODUCE_CUBE}> cube:observationSet/cube:observation ?o .
  ?o d:date ?date ; m:price ?price ; d:product ?p ; d:unit ?u ; d:production-system <${NON_ORGANIC}> .
  FILTER(STR(?date) >= "https://ld.admin.ch/time/month/${monthsBack(3)}")
  ?p schema:name ?pn . FILTER(LANG(?pn) = "de")
  ?u schema:name ?un . FILTER(LANG(?un) = "de")
} GROUP BY ?pn ?un ?date`;
  try {
    const res = await fetch(LINDAS, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/sparql-results+json" },
      body: new URLSearchParams({ query }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return produceCache?.rows ?? [];
    const data = await res.json();
    const newest = new Map<string, Produce>();
    for (const b of data?.results?.bindings ?? []) {
      const row = {
        name: b.pn.value,
        unit: b.un.value,
        price: Number(b.avg.value),
        month: b.date.value.slice(-7),
      };
      const cur = newest.get(row.name);
      if (Number.isFinite(row.price) && (!cur || cur.month < row.month)) newest.set(row.name, row);
    }
    const rows = [...newest.values()].sort((a, b) => a.name.localeCompare(b.name));
    if (rows.length) produceCache = { at: Date.now(), rows };
    return rows;
  } catch {
    return produceCache?.rows ?? [];
  }
}

// ---- Packaged goods: Aldi Suisse product search ----

type Candidate = { key: string; sku: string; brand: string; name: string; size: string; price: number; per: string };

async function aldiSearch(term: string): Promise<Omit<Candidate, "key">[]> {
  const url = new URL("https://api.aldi-suisse.ch/v3/product-search");
  url.search = new URLSearchParams({
    currency: "CHF",
    serviceType: "walk-in",
    q: term,
    limit: "24",
    offset: "0",
    sort: "relevance",
  }).toString();
  try {
    // A browser-like User-Agent gets blocked; an honest one doesn't.
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "ai-apps price-estimate" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.data ?? [])
      .filter((p: any) => typeof p?.price?.amount === "number" && p.price.amount > 0)
      .map((p: any) => ({
        sku: String(p.sku),
        brand: p.brandName ?? "",
        name: p.name ?? "",
        size: p.sellingSize ?? "",
        price: p.price.amount / 100,
        per: p.price.comparisonDisplay ?? "",
      }));
  } catch {
    return [];
  }
}

// Runs fn over items with at most `limit` calls in flight.
async function pool<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ---- LLM steps ----

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "terms", "produce"],
        properties: {
          id: { type: "string" },
          terms: { type: "array", items: { type: "string" }, description: "1-3 German search terms for the Aldi Suisse shop." },
          produce: { type: "string", description: "Exact name from <produce> for loose fresh fruit/vegetables/potatoes, else empty." },
        },
      },
    },
  },
};

const PLAN_SYSTEM = `You help price a shopping list at Aldi Suisse (Switzerland). Each item is "id | amount | name", in any language.

For every item give:
- terms: one to three short German search terms for Aldi Suisse's product search, the way the product is named on a Swiss shelf ("Chicken breast" -> "Pouletbrust", "Milk" -> "Vollmilch", "Olive oil" -> "Olivenöl", "Canned tomatoes" -> "Pelati", "Cream" -> "Vollrahm"). Use the plain product noun, no amounts or adjectives that aren't part of the product; ignore words like "a little", "small pack" or "heaped spoon" in the name. The search is by relevance and short, generic words also match many products that merely contain the item (a search for "Zucker" returns sweets), so add alternatives that name the plain product: "Zucker", "Kristallzucker", "Feinkristallzucker"; "Erdnussbutter", "Erdnusscreme"; "Kokosmilch", "Kokosnussmilch"; "Sesamöl", "Sesam Öl". Skip alternatives only for items that can't miss (e.g. "Vollmilch").
- produce: when the item is loose fresh fruit, vegetables, potatoes or fresh garlic, the exact name of the matching row in <produce> (e.g. "Onion" -> "Zwiebeln gelb", "Carrots" -> "Karotten", "Lemon" -> "Zitronen", "Potatoes" -> "Festkochend: Linie grün"). Otherwise, or when nothing in <produce> matches, an empty string.

Return every item once, with its id.`;

const PICK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "source", "product", "packs", "usedPacks", "produceQty", "note"],
        properties: {
          id: { type: "string" },
          source: { type: "string", enum: ["aldi", "produce", "none"] },
          product: { type: "string", description: "Key of the chosen Aldi product (e.g. \"p3\") when source is aldi, else empty." },
          packs: { type: "integer", description: "Whole packs to buy (aldi), at least 1." },
          usedPacks: { type: "number", description: "Packs the amount actually uses, e.g. 0.2 for 200 g of a 1 kg bag (aldi)." },
          produceQty: { type: "number", description: "Quantity in the produce row's unit (produce)." },
          note: { type: "string", description: "Short remark, e.g. an assumed weight. Empty if none." },
        },
      },
    },
  },
};

const PICK_SYSTEM = `You price a shopping list at Aldi Suisse. For each item (<item id | amount | name>) you get the Aldi products its search found (key | brand | name | pack size | CHF price | comparison price) and, for fresh produce, a Swiss retail price per unit.

For every item choose:
- source "aldi" with product = the key of the Aldi product that is really this item (not something that only contains it: "Vollmilch" is milk, not milk chocolate; "Pouletbrust" is not "Poulet-Hotdog"). Prefer the plain, cheapest suitable everyday product over premium, organic or seasonal-special ones unless the item asks for them. When there's no exact match, a close stand-in a cook would happily use is much better than no price: another variety or form of the same thing (brown or cane sugar for sugar, crunchy for smooth peanut butter, coconut cream for coconut milk, a bigger pack, an organic one); say so in the note. Then:
  - packs: whole packs needed to cover the amount (at least 1).
  - usedPacks: how many packs the amount uses, as a decimal (200 g from a 1 kg bag -> 0.2; 3 eggs from a 10-pack -> 0.3; 1 l from a 1 l pack -> 1). With no amount, packs = 1 and usedPacks is what a typical recipe uses (salt -> 0.02, a bunch of herbs -> 1).
  - produceQty: 0.
- source "produce" when there's no fitting Aldi product and the item has a produce price. produceQty: the amount in that price's unit (kg, Stück or Bund), converting counts to weight with typical sizes (1 onion ~ 0.15 kg, 1 carrot ~ 0.1 kg, 1 potato ~ 0.15 kg, 1 clove of garlic ~ 0.005 kg). With no amount, a typical quantity for one purchase. packs 1, usedPacks 0, product "".
- source "none" only when nothing listed is the item or a close stand-in. product "", packs 0, usedPacks 0, produceQty 0.

note: a short remark in English when you assumed something (e.g. "1 onion ~ 150 g", "sold in 500 g packs"), else "". Return every item once, with its id.`;

const RETRY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "terms"],
        properties: {
          id: { type: "string" },
          terms: { type: "array", items: { type: "string" }, description: "1-3 new German search terms, none of them already tried." },
        },
      },
    },
  },
};

const RETRY_SYSTEM = `You help price a shopping list at Aldi Suisse (Switzerland). Searching Aldi Suisse's shop for these items found nothing that fits. For each item (<item id | amount | name>) you get the German terms already tried and some of the products they returned, which show how the shop names things.

For every item give one to three different short German search terms that are more likely to find the plain product: another common Swiss or German name ("Kristallzucker", "Feinzucker", "Rohrzucker"), the product type plus what it's made from ("Erdnuss Creme", "Kokosnuss Milch"), a broader word ("Sesam", "Kokos", "Asia"), or the way a brand would label it. Never repeat a term already tried. Return every item once, with its id.`;

// ---- Request handling ----

type Item = { id: string; q: string; name: string };

function items(value: unknown): Item[] | null {
  if (!Array.isArray(value)) return null;
  const out: Item[] = [];
  for (const r of value) {
    if (typeof r?.id !== "string" || typeof r?.name !== "string" || !r.name.trim()) return null;
    out.push({ id: r.id, q: typeof r.q === "string" ? r.q.trim() : "", name: r.name.trim() });
  }
  return out;
}

const line = (i: Item) => `${i.id} | ${i.q} | ${i.name}`;
const round05 = (n: number) => Math.round(n * 20) / 20;
const num = (n: unknown, min = 0) => (typeof n === "number" && Number.isFinite(n) ? Math.max(min, n) : min);

serveSignedIn("Sign in to estimate prices.", async (body) => {
  const list = items(body?.items);
  if (!list) return json({ error: "Expected an items array." }, 400);
  if (!list.length) return json({ items: [], produceMonth: null });
  if (list.length > MAX_ITEMS || list.reduce((n, i) => n + i.name.length + i.q.length, 0) > MAX_TOTAL_CHARS) {
    return json({ error: "The list is too long to price." }, 400);
  }

  try {
    const produce = await producePrices();
    const produceByName = new Map(produce.map((p) => [p.name, p]));

    const plan = await structuredCompletion<{ items: { id: string; terms: string[]; produce: string }[] }>({
      system: PLAN_SYSTEM,
      user: `<produce>\n${produce.map((p) => p.name).join("\n")}\n</produce>\n\n<items>\n${list.map(line).join("\n")}\n</items>`,
      schema: PLAN_SCHEMA,
      schemaName: "price_plan",
      title: TITLE,
      maxTokens: 8000,
    });
    const planById = new Map(plan.items.map((p) => [p.id, p]));

    const termsById = new Map(
      list.map((i) => [i.id, [...new Set((planById.get(i.id)?.terms ?? []).map((t) => t.trim()).filter(Boolean))].slice(0, 3)])
    );

    // Short keys for products, so the LLM doesn't have to copy 18-digit SKUs.
    const bySku = new Map<string, Candidate>();
    const byKey = new Map<string, Candidate>();
    const searched = new Map<string, Omit<Candidate, "key">[]>();
    const tried = new Map(list.map((i) => [i.id, new Set<string>()]));
    const candidates = new Map(list.map((i) => [i.id, [] as Candidate[]]));

    // Searches the given items' new terms and returns the products that
    // turned up for each item that it hadn't been shown before.
    const search = async (want: Item[], termsFor: (id: string) => string[]) => {
      const fresh = new Map<string, string[]>();
      for (const i of want) {
        const seen = tried.get(i.id)!;
        const t = termsFor(i.id).filter((t) => !seen.has(t.toLowerCase()));
        t.forEach((x) => seen.add(x.toLowerCase()));
        fresh.set(i.id, t);
      }
      const todo = [...new Set([...fresh.values()].flat())].filter((t) => !searched.has(t));
      const got = await pool(todo, 6, aldiSearch);
      todo.forEach((t, n) => searched.set(t, got[n]));

      const added = new Map<string, Candidate[]>();
      for (const i of want) {
        const mine = candidates.get(i.id)!;
        const now: Candidate[] = [];
        for (const t of fresh.get(i.id)!) {
          for (const p of searched.get(t) ?? []) {
            let c = bySku.get(p.sku);
            if (!c) {
              c = { ...p, key: `p${bySku.size + 1}` };
              bySku.set(p.sku, c);
              byKey.set(c.key, c);
            }
            if (mine.includes(c)) continue;
            mine.push(c);
            now.push(c);
          }
        }
        added.set(i.id, now);
      }
      return added;
    };

    type Pick = { id: string; source: string; product: string; packs: number; usedPacks: number; produceQty: number; note: string };
    const pickFor = async (want: Item[], shown: Map<string, Candidate[]>) => {
      const pickInput = want
        .map((i) => {
          const cands = shown.get(i.id)!;
          const pr = produceByName.get(planById.get(i.id)?.produce ?? "");
          return [
            `<item ${line(i)}>`,
            cands.length
              ? cands.map((c) => `${c.key} | ${c.brand} | ${c.name} | ${c.size || "?"} | ${c.price.toFixed(2)} | ${c.per}`).join("\n")
              : "(no Aldi products found)",
            pr ? `produce: ${pr.name}, CHF ${pr.price.toFixed(2)} per ${pr.unit}` : "",
            `</item>`,
          ]
            .filter(Boolean)
            .join("\n");
        })
        .join("\n\n");
      const pick = await structuredCompletion<{ items: Pick[] }>({
        system: PICK_SYSTEM,
        user: pickInput,
        schema: PICK_SCHEMA,
        schemaName: "price_pick",
        title: TITLE,
        maxTokens: 12000,
      });
      // Only products this item's own search returned.
      return pick.items.filter((p) => {
        if (p.source !== "aldi") return true;
        const c = byKey.get(p.product);
        return c && candidates.get(p.id)?.includes(c);
      });
    };

    const pickById = new Map<string, Pick>();
    // Same tests the answer below applies, so a pick that would come out as
    // "no price" gets retried.
    const priced = (id: string) => {
      const p = pickById.get(id);
      if (p?.source === "aldi") return true;
      return p?.source === "produce" && produceByName.has(planById.get(id)?.produce ?? "") && num(p.produceQty) > 0;
    };

    const first = await search(list, (id) => termsById.get(id) ?? []);
    for (const p of await pickFor(list, first)) pickById.set(p.id, p);

    // Keep looking for what's still missing, with new terms each round.
    for (let round = 0; round < RETRY_ROUNDS; round++) {
      const missing = list.filter((i) => !priced(i.id));
      if (!missing.length) break;
      const retry = await structuredCompletion<{ items: { id: string; terms: string[] }[] }>({
        system: RETRY_SYSTEM,
        user: missing
          .map((i) =>
            [
              `<item ${line(i)}>`,
              `tried: ${[...tried.get(i.id)!].join(", ") || "(nothing)"}`,
              ...candidates.get(i.id)!.slice(0, 15).map((c) => `found: ${c.brand} ${c.name}`.trim()),
              `</item>`,
            ].join("\n")
          )
          .join("\n\n"),
        schema: RETRY_SCHEMA,
        schemaName: "price_retry",
        title: TITLE,
        maxTokens: 4000,
      });
      const retryTerms = new Map(retry.items.map((r) => [r.id, r.terms.map((t) => t.trim()).filter(Boolean).slice(0, 3)]));
      const added = await search(missing, (id) => retryTerms.get(id) ?? []);
      const again = missing.filter((i) => added.get(i.id)!.length);
      if (!again.length) continue;
      for (const p of await pickFor(again, added)) {
        // A new miss mustn't hide a note from the earlier pick.
        if (p.source !== "none" || !pickById.has(p.id)) pickById.set(p.id, p);
      }
    }

    const out = list.map((i) => {
      const p = pickById.get(i.id);
      const none = { id: i.id, source: "none", product: "", size: "", unitPrice: 0, unit: "", qty: 0, buy: 0, used: 0, note: p?.note ?? "" };
      if (!p) return none;
      if (p.source === "aldi") {
        const c = byKey.get(p.product);
        if (!c) return none;
        const packs = Math.max(1, Math.round(num(p.packs, 1)));
        const buy = packs * c.price;
        return {
          id: i.id,
          source: "aldi",
          product: [c.brand, c.name].filter(Boolean).join(" "),
          size: c.size,
          unitPrice: c.price,
          unit: "pack",
          qty: packs,
          buy: round05(buy),
          used: round05(Math.min(num(p.usedPacks) * c.price, buy)),
          note: p.note,
        };
      }
      if (p.source === "produce") {
        const pr = produceByName.get(planById.get(i.id)?.produce ?? "");
        const qty = num(p.produceQty);
        if (!pr || !qty) return none;
        const cost = round05(qty * pr.price);
        return {
          id: i.id,
          source: "produce",
          product: pr.name,
          size: "",
          unitPrice: pr.price,
          unit: pr.unit,
          qty: Math.round(qty * 1000) / 1000,
          buy: cost,
          used: cost,
          note: p.note,
        };
      }
      return none;
    });

    const months = produce.map((p) => p.month).sort();
    return json({ items: out, produceMonth: months[months.length - 1] ?? null });
  } catch (err) {
    if (!(err instanceof AIError)) throw err;
    return json({ error: err.message }, err.status);
  }
});
