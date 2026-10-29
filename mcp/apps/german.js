// German app tools. They read and write the same app_data blobs the app
// syncs (see german/App.jsx), and reuse the app's model so cards, stats and
// the writing history come out exactly as the app sees them.
import { z } from "zod";
import {
  APP_ID, KEYS, DEFAULT_SETTINGS, DEFAULT_LISTENING, DEFAULT_PODCAST, DEFAULT_EPISODES, WEEKDAYS,
  normSettings, normListening, normPodcast, normEpisodes, episodeMinutes,
  makeCard, editCard, findDuplicate, searchCards, germanOf, isNew, stats, tasksFor,
  doneTasks, dayKey, dayEnd, fixCounts, planSession,
} from "../../german/model.js";
import { pointLabel } from "../../german/grammar.js";

const APP_URL = "https://apps.trplan.si/german";

export const instructions = `German (german_* tools): the user's German practice app (${APP_URL}), a flashcard deck scheduled with spaced repetition (English → German), short writing checked by AI, a listening log, and an AI podcast (episodes about the user's interests, made in the app; the tools read them and edit the interests). Call german_get_overview first for the level, today's tasks, deck counts and recent mistakes. Cards added here join the queue of new cards, so they show up in the user's next sessions. Changes show up in the app right away.`;

function fail(message) {
  throw new Error(message);
}

function json(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

const ymd = ms => new Date(ms).toISOString().slice(0, 10);

function describeCard(c) {
  const out = { id: c.id, kind: c.kind, german: germanOf(c), english: c.en };
  if (c.kind === "noun") Object.assign(out, { article: c.article, word: c.de, plural: c.plural || "" });
  if (c.kind === "verb") Object.assign(out, { perfekt: c.perfekt || "", separable: !!c.separable });
  if (c.kind === "gap") Object.assign(out, { gapSentence: c.text, answer: c.answer });
  if (c.kind === "gap" || c.kind === "rule") out.grammar = pointLabel(c.point);
  if (c.kind === "rule") Object.assign(out, { rule: c.de, examples: c.examples || [] });
  if (c.example) out.example = c.example;
  out.source = c.source;
  out.status = isNew(c) ? "new" : { state: c.srs.state, due: ymd(c.srs.due), lapses: c.srs.lapses };
  return out;
}

const cardFields = {
  kind: z.enum(["noun", "verb", "word"]).optional().describe("word = anything that isn't a noun or verb."),
  german: z.string().optional().describe("Noun without article (\"Antrag\"), verb infinitive, or the word/phrase."),
  article: z.enum(["der", "die", "das"]).optional(),
  plural: z.string().optional().describe('With article: "die Anträge".'),
  perfekt: z.string().optional().describe('"hat eingereicht", "ist umgestiegen".'),
  separable: z.boolean().optional(),
  english: z.string().optional().describe('Short meaning: "the application (form)", "to submit".'),
  example: z.string().optional().describe("One German example sentence."),
};

// Tool input → model fields (only the ones given).
function toFields(input) {
  const f = {};
  if (input.kind) f.kind = input.kind;
  if (input.german !== undefined) f.de = input.german;
  if (input.english !== undefined) f.en = input.english;
  for (const k of ["article", "plural", "perfekt", "separable", "example"]) if (input[k] !== undefined) f[k] = input[k];
  return f;
}

export function register(server, { appData, callFunction }) {
  const read = (name, fallback) => appData.read(APP_ID, KEYS[name], fallback);
  const update = (name, fallback, mutate) => appData.update(APP_ID, KEYS[name], fallback, mutate);
  const readSettings = async () => normSettings(await read("settings", DEFAULT_SETTINGS));

  server.registerTool("german_get_overview", {
    title: "German: overview",
    description: "The user's level and topics, today's tasks and whether they're done, this week, deck counts (cards, new, due today), the most frequent writing mistakes and the last writing sessions' fixes.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => {
    const [cards, suggest, writing, log, listening, settings] = await Promise.all([
      read("cards", []), read("suggest", []), read("writing", []), read("log", {}),
      read("listening", DEFAULT_LISTENING).then(normListening), readSettings(),
    ]);
    const today = dayKey();
    const s = stats(cards, writing, listening, log, today);
    const plan = planSession(cards, suggest, settings, today);
    const current = listening.resources.find(r => r.id === listening.current);
    return json({
      appUrl: APP_URL,
      today,
      settings: {
        level: settings.level,
        topics: settings.topics,
        newCardsPerDay: settings.newPerDay,
        writingDays: settings.writingDays.map(d => WEEKDAYS[d]),
        podcastDays: settings.podcastDays.map(d => WEEKDAYS[d]),
        podcastPace: settings.podcastPace,
      },
      todayTasks: tasksFor(today, settings).map(t => ({ task: t, done: doneTasks(log, today).includes(t) })),
      cardsInTodaysSession: plan.reviews.length + plan.fresh.length + plan.fromSuggestions,
      thisWeek: { cardDays: s.cardDays, writingDays: s.writingDays, listeningMinutes: s.listeningMin },
      deck: {
        total: cards.length,
        learned: s.learned,
        new: s.newCount,
        dueToday: cards.filter(c => c.srs && c.srs.due < dayEnd(today)).length,
        dueTomorrow: s.dueTomorrow,
      },
      frequentMistakes: fixCounts(writing).slice(0, 5).map(f => ({ grammar: pointLabel(f.point), count: f.count })),
      recentWriting: writing.slice(0, 3).map(w => ({ id: w.id, day: w.day, focus: pointLabel(w.focus), fixes: w.fixes.map(f => `${f.from} → ${f.to}: ${f.why}`) })),
      listeningNow: current ? current.name : null,
    });
  });

  server.registerTool("german_get_podcast", {
    title: "German: podcast episodes",
    description: "The user's podcast interests and their AI podcast episodes, newest first (only the last 10 are kept): topic, title, the angle it took, length, whether it was listened to, and the key words with English. Pass episodeId for that episode's full transcript too (each line with its speaker, Lena or Jonas), e.g. to add words from it with german_add_cards.",
    inputSchema: {
      episodeId: z.string().optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ episodeId }) => {
    const [settings, podcast, data, listening] = await Promise.all([
      readSettings(), read("podcast", DEFAULT_PODCAST), read("episodes", DEFAULT_EPISODES),
      read("listening", DEFAULT_LISTENING).then(normListening),
    ]);
    const { episodes } = normEpisodes(data);
    const describe = e => {
      const out = { id: e.id, interest: e.interest, status: e.status, started: ymd(e.started) };
      if (e.status === "failed") out.error = e.error;
      if (e.status !== "ready") return out;
      const listened = listening.log.filter(l => l.episode === e.id).map(l => l.day);
      return { ...out, title: e.title, angle: e.summary, minutes: episodeMinutes(e), listened, keyWords: e.keyWords };
    };
    if (episodeId) {
      const ep = episodes.find(e => e.id === episodeId) || fail(`No episode with id "${episodeId}"; only the last 10 are kept.`);
      return json({ episode: { ...describe(ep), transcript: ep.lines || [] } });
    }
    return json({ interests: normPodcast(podcast, settings).interests, episodes: episodes.map(describe) });
  });

  server.registerTool("german_update_podcast_interests", {
    title: "German: edit podcast interests",
    description: "Add or remove the user's podcast interests (what episodes can be about; the user picks one in the app). Keep them evergreen (\"AI safety\", not \"AI safety in October 2026\"): each episode searches the web for what's current.",
    inputSchema: {
      add: z.array(z.string().min(1).max(80)).optional(),
      remove: z.array(z.string()).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ add = [], remove = [] }) => {
    const settings = await readSettings();
    let interests;
    await update("podcast", DEFAULT_PODCAST, p => {
      const current = normPodcast(p, settings).interests;
      const drop = new Set(remove.map(t => t.trim().toLowerCase()));
      interests = current.filter(t => !drop.has(t.toLowerCase()));
      for (const t of add.map(x => x.trim())) {
        if (t && !interests.some(k => k.toLowerCase() === t.toLowerCase())) interests.push(t);
      }
      return interests.length === current.length && interests.every((t, i) => t === current[i]) ? p : { ...p, interests };
    });
    return json({ interests });
  });

  server.registerTool("german_add_cards", {
    title: "German: add cards",
    description: "Add words to the user's deck as new cards (they're introduced in the next card sessions). Pass a word as a plain string (German or English) and the app's AI fills in article, plural, English and an example at the user's level; for an ambiguous English word it takes the most common translation, so prefer German. Or pass the fields yourself. Words already in the deck are skipped.",
    inputSchema: {
      words: z.array(z.union([
        z.string().min(1).describe('A German or English word, e.g. "der Antrag" or "umsteigen".'),
        z.object(cardFields),
      ])).min(1).max(30),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ words }) => {
    const settings = await readSettings();
    const filled = [];
    const failed = [];
    for (const w of words) {
      const given = typeof w === "string" ? {} : toFields(w);
      if (given.de && given.en && given.kind) {
        filled.push(given);
        continue;
      }
      // Anything missing is filled in by the AI; given fields win.
      const input = typeof w === "string" ? w.trim().replace(/^(der|die|das)\s+/i, "") : given.de;
      if (!input) fail("Each card object needs at least `german`; or pass the word as a string.");
      if (!callFunction) fail("Filling in words needs the AI service; pass german, english and kind yourself.");
      try {
        const { options } = await callFunction("german-ai", { task: "fill", input, level: settings.level });
        if (!options?.length) throw new Error(`No result for "${input}".`);
        const { sense, ...option } = options[0];
        filled.push({ ...option, ...given });
      } catch (e) {
        failed.push({ word: input, error: e.message });
      }
    }

    const added = [];
    const skipped = [];
    await update("cards", [], cards => {
      added.length = 0;
      skipped.length = 0;
      let deck = cards;
      for (const f of filled) {
        const dup = findDuplicate(deck, f);
        if (dup) {
          skipped.push({ german: germanOf(dup), reason: "already in the deck", id: dup.id });
          continue;
        }
        const card = makeCard(f, "claude");
        deck = [card, ...deck];
        added.push(describeCard(card));
      }
      return added.length ? deck : cards;
    });
    return json({ added, skipped, ...(failed.length ? { failed } : {}) });
  });

  server.registerTool("german_search_cards", {
    title: "German: search cards",
    description: "Find cards by German or English text (case and umlaut insensitive), optionally filtered. Empty query lists the newest cards.",
    inputSchema: {
      query: z.string().optional(),
      filter: z.enum(["all", "nouns", "verbs", "grammar", "hard"]).optional().describe("hard = cards the user often forgets."),
      limit: z.number().int().min(1).max(200).optional().describe("Defaults to 30."),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ query = "", filter = "all", limit = 30 }) => {
    const cards = await read("cards", []);
    const found = searchCards(cards, query, filter).sort((a, b) => b.added - a.added);
    return json({ total: found.length, cards: found.slice(0, limit).map(describeCard) });
  });

  server.registerTool("german_update_card", {
    title: "German: edit card",
    description: "Change a word card's fields (only the ones you pass). Its study progress is kept.",
    inputSchema: { id: z.string(), ...cardFields },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async input => {
    let saved;
    await update("cards", [], cards => {
      const card = cards.find(c => c.id === input.id) || fail(`No card with id "${input.id}". Use german_search_cards to find ids.`);
      saved = editCard(card, toFields(input));
      return cards.map(c => (c.id === card.id ? saved : c));
    });
    return json({ updated: describeCard(saved) });
  });

  server.registerTool("german_delete_cards", {
    title: "German: delete cards",
    description: "Delete cards from the deck by id. This also deletes their study progress.",
    inputSchema: { ids: z.array(z.string()).min(1) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ ids }) => {
    const deleted = [];
    await update("cards", [], cards => {
      deleted.length = 0;
      const drop = new Set(ids);
      cards.forEach(c => drop.has(c.id) && deleted.push(germanOf(c)));
      return deleted.length ? cards.filter(c => !drop.has(c.id)) : cards;
    });
    const missing = ids.length - deleted.length;
    return json({ deleted, ...(missing ? { notFound: missing } : {}) });
  });

  server.registerTool("german_get_writing", {
    title: "German: writing history",
    description: "The user's writing sessions, newest first: prompt, grammar focus, their text, the corrected text and each fix with its reason.",
    inputSchema: {
      limit: z.number().int().min(1).max(100).optional().describe("Defaults to 10."),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ limit = 10 }) => {
    const writing = await read("writing", []);
    return json({
      total: writing.length,
      sessions: writing.slice(0, limit).map(w => ({
        id: w.id,
        day: w.day,
        prompt: w.prompt,
        focus: pointLabel(w.focus),
        text: w.text,
        corrected: w.corrected,
        fixes: w.fixes.map(f => ({ from: f.from, to: f.to, why: f.why, grammar: pointLabel(f.point) })),
      })),
    });
  });
}
