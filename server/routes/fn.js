// POST /api/fn/:name: the AI functions (server/functions/<name>.js), as
// shared/ai.js's callAI uses them. The body is the function's JSON input and
// the answer its JSON output, or { error } with the status it chose
// (HttpError); callAI shows that message as is. Signed-out callers get a 401
// with the function's own message.
//
// call() runs a function directly, for the MCP server (stage 04).

import express from "express";
import { HttpError } from "../functions/_shared/http.js";
import * as germanAi from "../functions/german-ai.js";
import * as germanPodcast from "../functions/german-podcast.js";
import * as germanTts from "../functions/german-tts.js";
import * as priceEstimate from "../functions/price-estimate.js";
import * as recipeImport from "../functions/recipe-import.js";
import * as shoppingList from "../functions/shopping-list.js";
import * as shoppingMerge from "../functions/shopping-merge.js";

// Each is { signedOut, handle(body, ctx) }.
export const FUNCTIONS = {
  "german-ai": germanAi,
  "german-podcast": germanPodcast,
  "german-tts": germanTts,
  "price-estimate": priceEstimate,
  "recipe-import": recipeImport,
  "shopping-list": shoppingList,
  "shopping-merge": shoppingMerge,
};

export function fnRoutes({ appData, storage }) {
  // Work a function carries on with after answering (the podcast job).
  const pending = new Set();
  function background(promise) {
    const p = promise.catch((err) => console.error("fn: background job failed:", err));
    pending.add(p);
    p.finally(() => pending.delete(p));
  }

  // Runs `name` for `user` ({ id, email }). Throws HttpError for an unknown
  // name and whatever the function throws.
  async function call(name, body, user) {
    if (!Object.hasOwn(FUNCTIONS, name)) throw new HttpError(404, "No such function.");
    return FUNCTIONS[name].handle(body, { user, appData, storage, background });
  }

  const router = express.Router();
  // Recipe screenshots come as base64: up to 8 images of 3 MB each.
  const parseJson = express.json({ limit: "30mb" });

  router.post(
    "/api/fn/:name",
    (req, res, next) => {
      res.set("Cache-Control", "no-store");
      const fn = Object.hasOwn(FUNCTIONS, req.params.name) ? FUNCTIONS[req.params.name] : null;
      if (!fn) return res.status(404).json({ error: "No such function." });
      if (!req.user) return res.status(401).json({ error: fn.signedOut });
      next();
    },
    parseJson,
    async (req, res) => {
      try {
        res.json(await call(req.params.name, req.body, req.user));
      } catch (err) {
        if (!(err instanceof HttpError)) throw err;
        res.status(err.status).json({ error: err.message });
      }
    }
  );

  return {
    router,
    call,
    // Marks episodes a restart interrupted as failed; run once at startup.
    recover: () => germanPodcast.recover(appData),
    // Resolves once no background work is left (tests).
    idle: async () => {
      while (pending.size) await Promise.all(pending);
    },
  };
}
