// Every text AI task of the German app, via OpenAI. The body's `task`
// picks one:
//   fill     a German or English word → card fields (or 2–3 options)
//   example  a new example sentence for a card
//   suggest  new words at the user's level, general + their topics
//   prompt   a writing prompt for today's grammar focus
//   check    corrections for a short text, with gap sentences for cards
//   words    words tapped in a podcast transcript → card fields, using the
//            sentence each came from
// Everything is pitched at the user's level (A1.1–B2.2).
//
// Needs OPENAI_API_KEY (see _shared/openai.js).

import { levelGuide } from "./_shared/cefr.js";
import { HttpError } from "./_shared/http.js";
import { structuredCompletion } from "./_shared/openai.js";

const LEVELS = ["A1.1", "A1.2", "A2.1", "A2.2", "B1.1", "B1.2", "B2.1", "B2.2"];

// Grammar point ids and labels; keep in sync with german/grammar.js.
const POINTS = {
  "v2": "verb second (after time words, in main clauses)",
  "perfekt": "Perfekt with haben / sein, participles",
  "weil": "weil → verb at the end",
  "dativ-praep": "mit, bei, nach, von, zu, aus, seit + Dativ",
  "modal": "modal verb → infinitive at the end",
  "trennbar": "separable verbs",
  "wechsel": "in, an, auf, … : Akkusativ (wohin) or Dativ (wo)",
  "dass": "dass, wenn, ob, … → verb at the end",
  "praeteritum": "Präteritum of sein, haben, modal verbs",
  "adj": "adjective endings",
  "komparativ": "comparison: -er als, am -sten",
  "reflexiv": "reflexive verbs and pronouns",
  "zu-inf": "zu + infinitive",
  "relativ": "relative clauses",
  "konjunktiv": "Konjunktiv II: würde, hätte, wäre",
};
const POINT_LIST = Object.entries(POINTS).map(([id, label]) => `- ${id}: ${label}`).join("\n");

const MAX_TEXT = 3000;
const MAX_WORD = 80;

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const level = (v) => (LEVELS.includes(v) ? v : "A2.2");
const list = (v, n, max) =>
  (Array.isArray(v) ? v : []).map(x => str(x, max)).filter(Boolean).slice(0, n);

const WORD = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "de", "article", "plural", "perfekt", "separable", "en", "example", "sense"],
  properties: {
    kind: { type: "string", enum: ["noun", "verb", "word"], description: "word = anything that isn't a noun or verb (adjective, adverb, phrase, ...)" },
    de: { type: "string", description: "Noun without article, singular; verb infinitive; other words in their base form." },
    article: { type: ["string", "null"], enum: ["der", "die", "das", null], description: "Nouns only, else null." },
    plural: { type: "string", description: "Nouns: plural with article, e.g. \"die Anträge\"; \"(kein Plural)\" if none. Others: empty." },
    perfekt: { type: "string", description: "Verbs: Perfekt as \"hat eingereicht\" / \"ist umgestiegen\". Others: empty." },
    separable: { type: "boolean", description: "Verbs with a separable prefix (ankommen, einkaufen). False for everything else." },
    en: { type: "string", description: "Short English meaning: \"the application (form)\", \"to submit\". Nouns start with \"the\"; verbs with \"to\". A bracketed hint only when needed to tell senses apart." },
    example: { type: "string", description: "One natural German sentence using the word, at the learner's level." },
    sense: { type: "string", description: "A few English words saying which meaning this is, e.g. \"a form or request to an office\"." },
  },
};

// `skills` picks the CEFR scales that describe the level for the task (see
// _shared/cefr.js).
const SYSTEM_BASE = (lvl, skills) =>
  `You help an adult English speaker who lives in Zürich (ETH student) learn German. Their level is ${lvl} (CEFR). Write standard German (Germany/Switzerland spelling with ß is fine). Keep vocabulary and sentence structure at or slightly above ${lvl}.

${levelGuide(lvl, skills)}`;

async function fill(body) {
  const input = str(body.input, MAX_WORD);
  if (!input) throw new HttpError(400, "Type a word first.");
  const lvl = level(body.level);
  const result = await structuredCompletion({
    system: `${SYSTEM_BASE(lvl, ["language"])}

The learner typed a word to add to their flashcards. It may be German or English (or a short phrase).
- German input: one option for that word (fix spelling and capitalisation; nouns in the singular).
- English input with one clear German translation: one option.
- English input with several common German translations that mean different things (e.g. "application" → der Antrag, die Bewerbung, die Anwendung): 2–3 options, most useful first, each with its sense.
Never more than 3 options.`,
    user: input,
    schema: { type: "object", additionalProperties: false, required: ["options"], properties: { options: { type: "array", items: WORD } } },
    schemaName: "word_fill",
    maxTokens: 2000,
  });
  return { options: result.options.slice(0, 3) };
}

async function example(body) {
  const card = body.card || {};
  const de = str(card.de, MAX_WORD);
  if (!de) throw new HttpError(400, "The card has no German word.");
  const word = card.kind === "noun" && card.article ? `${str(card.article, 3)} ${de}` : de;
  const result = await structuredCompletion({
    system: `${SYSTEM_BASE(level(body.level), ["reading", "language"])}

Write one new, natural example sentence for a flashcard, using the given word (in any needed form). Everyday situations: studying, the city, trains, food, sport, friends. Different from the sentence to avoid. 6–14 words.`,
    user: `Word: ${word} (${str(card.en, 120)})\nAvoid: ${str(body.avoid, 300) || "-"}`,
    schema: { type: "object", additionalProperties: false, required: ["example"], properties: { example: { type: "string" } } },
    schemaName: "example",
    maxTokens: 500,
  });
  return result;
}

async function suggest(body) {
  const n = Math.min(15, Math.max(1, Math.round(Number(body.n) || 10)));
  const topics = list(body.topics, 12, 40);
  const known = list(body.known, 400, MAX_WORD);
  const result = await structuredCompletion({
    system: `${SYSTEM_BASE(level(body.level), ["language"])}

Suggest new words for the learner's flashcards. Pick useful, frequent words they likely don't know yet but need next, in line with the vocabulary range at their level and the one above it: roughly half general everyday vocabulary, half from their topics. Mostly nouns and verbs, a few adjectives/adverbs. Don't repeat anything from the known list (in any form).`,
    user: `Number of words: ${n}\nTopics: ${topics.join(", ") || "(none, use general words)"}\nKnown: ${known.join(", ") || "-"}`,
    schema: { type: "object", additionalProperties: false, required: ["words"], properties: { words: { type: "array", items: WORD } } },
    schemaName: "suggestions",
    maxTokens: 6000,
  });
  return { words: result.words.slice(0, n) };
}

async function prompt(body) {
  const focus = body.focus || {};
  const topics = list(body.topics, 12, 40);
  const avoid = list(body.avoid, 12, 200);
  const result = await structuredCompletion({
    system: `${SYSTEM_BASE(level(body.level), ["writing", "language"])}

Write one short writing prompt in German: a question the learner answers in 3–5 sentences about their own life. It should naturally invite today's grammar focus (without naming it) and the kind of text the learner can write at their level (see the writing descriptors above). Sometimes use one of their topics, sometimes everyday life. One sentence, under 12 words, ending with "?". Don't reuse the earlier prompts.`,
    user: `Grammar focus: ${str(focus.label, 120)} (${str(focus.hint, 200)})\nTopics: ${topics.join(", ") || "-"}\nEarlier prompts:\n${avoid.join("\n") || "-"}`,
    schema: { type: "object", additionalProperties: false, required: ["prompt"], properties: { prompt: { type: "string" } } },
    schemaName: "prompt",
    maxTokens: 500,
  });
  return result;
}

const FIX = {
  type: "object",
  additionalProperties: false,
  required: ["from", "to", "why", "point", "sentence", "gap"],
  properties: {
    from: { type: "string", description: "The wrong words exactly as they appear in the learner's text (empty if something was only added)." },
    to: { type: "string", description: "The corrected words exactly as they appear in `corrected`." },
    why: { type: "string", description: "One short English reason, friendly, max ~15 words. Bold nothing." },
    point: { type: "string", enum: [...Object.keys(POINTS), "other"] },
    sentence: { type: "string", description: "The whole corrected sentence this fix is in." },
    gap: {
      description: "A flashcard testing this fix: the corrected sentence (may be shortened with …) with the corrected words replaced by ___ exactly once. null when the fix is a pure spelling/typo fix not worth a card.",
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["text", "answer", "en"],
          properties: {
            text: { type: "string" },
            answer: { type: "string", description: "What goes in the gap." },
            en: { type: "string", description: "English translation of the full sentence." },
          },
        },
        { type: "null" },
      ],
    },
  },
};

async function check(body) {
  const text = str(body.text, MAX_TEXT);
  if (!text) throw new HttpError(400, "Write a few sentences first.");
  const lvl = level(body.level);
  const focus = body.focus ? `${str(body.focus.id, 20)} (${str(body.focus.label, 120)})` : "none";
  const result = await structuredCompletion({
    system: `${SYSTEM_BASE(lvl, ["writing", "language"])}

Correct the learner's short text. Change as little as possible: keep their words and ideas, fix only what's wrong. At A1/A2 levels fix grammar, word order, gender, case and spelling but don't polish style; from B1 also fix unidiomatic phrasing.

Return:
- verdict: one word or two for the overall result, judged against what the descriptors above expect at this level (not against a native speaker): "Great", "Good", "Okay" or "Keep going".
- corrected: the full corrected text.
- fixes: one entry per correction, in text order. Merge corrections that belong together (e.g. a verb moved to the end) into one fix. Tag each with the grammar point it practises, or "other" (gender, spelling, word choice, ...):
${POINT_LIST}

Today's focus is ${focus}; mention it in the reason ("Today's focus") when a fix is about it.`,
    user: `Prompt: ${str(body.prompt, 300)}\n\nText:\n${text}`,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["verdict", "corrected", "fixes"],
      properties: { verdict: { type: "string" }, corrected: { type: "string" }, fixes: { type: "array", items: FIX } },
    },
    schemaName: "writing_check",
    maxTokens: 6000,
  });
  return result;
}

const MAX_PICKS = 30;

async function words(body) {
  const picks = (Array.isArray(body.items) ? body.items : [])
    .map((it) => ({ word: str(it?.word, MAX_WORD), sentence: str(it?.sentence, 600) }))
    .filter((it) => it.word)
    .slice(0, MAX_PICKS);
  if (!picks.length) throw new HttpError(400, "Pick some words first.");
  const result = await structuredCompletion({
    system: `${SYSTEM_BASE(level(body.level), ["reading", "language"])}

The learner tapped words in the transcript of a German podcast to turn them into flashcards. For each tapped word (in order) you get the line it was in. Return one item per word, in the same order:
- main: the card the learner most likely wants. Use the sentence: a separable verb split across the sentence becomes the whole infinitive (tapped "stehe" in "Ich stehe um sieben auf" → aufstehen; tapped "auf" there → aufstehen too); a word that is part of a fixed phrase or idiom becomes the whole phrase (tapped "Fall" in "auf jeden Fall" → "auf jeden Fall", kind word); otherwise the word's base form (nouns singular, verbs infinitive, adjectives uninflected), in the meaning it has in this sentence.
- alt: when main is a phrase or a different word than the tapped one, the tapped word on its own as a card; otherwise null.
For both, the example is the podcast line itself, shortened with … to at most about 15 words if it's longer (it must still contain the word), with spelling fixed if needed.`,
    user: picks.map((p, i) => `${i + 1}. Tapped: ${p.word}\n   Line: ${p.sentence || "-"}`).join("\n"),
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["items"],
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["main", "alt"],
            properties: { main: WORD, alt: { anyOf: [WORD, { type: "null" }] } },
          },
        },
      },
    },
    schemaName: "transcript_words",
    maxTokens: 12000,
  });
  return { items: result.items.slice(0, picks.length) };
}

const TASKS = { fill, example, suggest, prompt, check, words };

export const signedOut = "Sign in to use the AI features.";

export async function handle(body) {
  const task = TASKS[body?.task];
  if (!task) throw new HttpError(400, "Unknown task.");
  return task(body);
}
