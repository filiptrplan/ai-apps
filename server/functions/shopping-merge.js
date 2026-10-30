// Finds ingredients just added to a Recipes app shopping list that are
// already on it, and works out the combined amount, via an LLM on
// OpenRouter. The app adds the new rows straight away and folds them into
// the matching ones when this answers.
//
// Needs OPENROUTER_API_KEY (see _shared/openrouter.js).

import { HttpError } from "./_shared/http.js";
import { structuredCompletion } from "./_shared/openrouter.js";

const MAX_ITEMS = 300;
const MAX_TOTAL_CHARS = 30000;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["groups"],
  properties: {
    groups: {
      type: "array",
      description: "One entry per set of rows that are the same thing to buy. Leave out rows that match nothing.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["keep", "merge", "q"],
        properties: {
          keep: { type: "string", description: "Id of the row that stays: the one from <list> if there is one, else the first new row." },
          merge: { type: "array", items: { type: "string" }, description: "Ids of the new rows folded into it." },
          q: { type: "string", description: "The combined amount." },
        },
      },
    },
  },
};

const SYSTEM = `You keep a shopping list free of duplicates. You get the rows already on the list (<list>) and rows just added from a recipe (<new>). Each row is "id | amount | name"; the amount may be empty.

Find each new row that is the same thing to buy as a row on the list, or as another new row, and group them. Match on what you'd pick up in the shop, not on exact wording: "Onion" and "onions", "Chicken breast" and "chicken breast fillets", "Olive oil" and "extra virgin olive oil" are the same; "Red onion" and "Onion", "Chicken breast" and "Chicken thigh", "Butter" and "Peanut butter" are not. When in doubt, don't group.

For each group give:
- keep: the id of the row on the list if there is one, else the first new row in the group.
- merge: the ids of the new rows folded into it (never the keep id, never an id from <list>).
- q: the total amount, written the way a person would write it on a list, in the units and language the rows use. Add up amounts in the same or convertible units ("200 g" + "1 kg" -> "1.2 kg", "1" + "2" -> "3", "1 tbsp" + "1 tsp" -> "4 tsp"). Amounts that can't be converted stay side by side ("2 cups + 100 g"). A row without an amount adds nothing ("2" + "" -> "2"); if no row has one, q is "".

Leave out rows that match nothing. Never group two rows that are both from <list>.`;

// Rows are { id, q, name }; null if `value` isn't a list of them.
function rows(value) {
  if (!Array.isArray(value)) return null;
  const out = [];
  for (const r of value) {
    if (typeof r?.id !== "string" || typeof r?.name !== "string") return null;
    out.push({ id: r.id, q: typeof r.q === "string" ? r.q : "", name: r.name });
  }
  return out;
}

const line = (r) => `${r.id} | ${r.q.trim()} | ${r.name.trim()}`;

export const signedOut = "Sign in to combine list items.";

export async function handle(body) {
  const list = rows(body?.list);
  const added = rows(body?.add);
  if (!list || !added) throw new HttpError(400, "Expected list and add arrays.");
  if (!added.length || (!list.length && added.length < 2)) return { groups: [] };
  const all = [...list, ...added];
  if (all.length > MAX_ITEMS || all.reduce((n, r) => n + r.name.length + r.q.length, 0) > MAX_TOTAL_CHARS) {
    throw new HttpError(400, "The list is too long to combine.");
  }

  const user = `<list>\n${list.map(line).join("\n")}\n</list>\n\n<new>\n${added.map(line).join("\n")}\n</new>`;

  return structuredCompletion({
    system: SYSTEM,
    user,
    schema: SCHEMA,
    schemaName: "shopping_merge",
    title: "AI Apps - Recipes",
    maxTokens: 4000,
  });
}
