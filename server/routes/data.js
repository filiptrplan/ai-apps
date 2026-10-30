// GET/PUT /api/data/:app/:key: the signed-in user's app_data rows, as
// shared/syncStorage.js and the MCP tools use them.
//
//   GET → { value, updated_at }, or 404 if the row doesn't exist.
//   PUT { value, ifUpdatedAt? } → { updated_at }. With ifUpdatedAt (a
//   timestamp, or null for "doesn't exist yet") the write only happens if
//   the row is still in that state, otherwise 409.

import express from "express";
import { ConflictError } from "../appData.js";

const NAME = /^[\w.-]{1,200}$/;

export function dataRoutes({ appData, requireUser }) {
  const router = express.Router();

  router.use("/api/data/:app/:key", requireUser, (req, res, next) => {
    if (!NAME.test(req.params.app) || !NAME.test(req.params.key)) {
      return res.status(400).json({ error: "Invalid app or key." });
    }
    res.set("Cache-Control", "no-store");
    next();
  });

  router.get("/api/data/:app/:key", async (req, res) => {
    const row = await appData.get(req.user.id, req.params.app, req.params.key);
    if (!row) return res.status(404).json({ error: "Not found." });
    res.json(row);
  });

  router.put("/api/data/:app/:key", async (req, res) => {
    const { value, ifUpdatedAt } = req.body ?? {};
    if (value === undefined) return res.status(400).json({ error: "Missing value." });
    if (ifUpdatedAt !== undefined && ifUpdatedAt !== null && (typeof ifUpdatedAt !== "string" || isNaN(Date.parse(ifUpdatedAt)))) {
      return res.status(400).json({ error: "Invalid ifUpdatedAt." });
    }
    try {
      const updated_at = await appData.put(req.user.id, req.params.app, req.params.key, value, ifUpdatedAt);
      res.json({ updated_at });
    } catch (err) {
      if (err instanceof ConflictError) return res.status(409).json({ error: err.message });
      throw err;
    }
  });

  return router;
}
