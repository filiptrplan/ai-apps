// The app's AI calls, all through the german-ai edge function (OpenAI).
// Each returns the function's JSON answer or throws an Error with a
// message that can be shown as is.
import { callAI } from "../shared/ai.js";
import { pointById } from "./grammar.js";

// German or English word → card fields. One option when the word is clear,
// 2–3 when an English word has several German translations.
// Option: { kind, de, article, plural, perfekt, separable, en, example, sense }
export async function fillWord(input, settings) {
  const { options } = await callAI("german-ai", { task: "fill", input, level: settings.level });
  return options;
}

export async function newExample(card, settings) {
  const { example } = await callAI("german-ai", {
    task: "example",
    level: settings.level,
    card: { kind: card.kind, de: card.de, article: card.article || null, en: card.en },
    avoid: card.example || "",
  });
  return example;
}

// `known` is the German side of cards already in the deck, so suggestions
// don't repeat them.
export async function suggestWords(n, known, settings) {
  const { words } = await callAI("german-ai", {
    task: "suggest",
    n,
    level: settings.level,
    topics: settings.topics,
    known: known.slice(-400),
  });
  return words;
}

export async function writingPrompt(focusId, recent, settings) {
  const p = pointById(focusId);
  const { prompt } = await callAI("german-ai", {
    task: "prompt",
    level: settings.level,
    topics: settings.topics,
    focus: { id: p.id, label: p.label, hint: p.hint },
    avoid: recent.slice(0, 12),
  });
  return prompt;
}

// { verdict, corrected, fixes: [{ from, to, why, point, sentence, gap }] }
export async function checkWriting({ text, prompt, focus }, settings) {
  const p = pointById(focus);
  return callAI("german-ai", {
    task: "check",
    level: settings.level,
    text,
    prompt,
    focus: p ? { id: p.id, label: p.label } : null,
  });
}
