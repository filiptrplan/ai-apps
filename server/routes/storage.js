// GET/PUT/DELETE /api/storage/:bucket/<userId>/<path>: the signed-in user's
// own files (recipe photos, German audio). See ../storage.js for the rules.

import express from "express";
import { BUCKETS, StorageError } from "../storage.js";

export function storageRoutes({ storage, requireUser }) {
  const router = express.Router();
  const route = "/api/storage/:bucket/*path";

  router.get(route, requireUser, (req, res, next) => {
    const { file, type } = storage.resolve(req.params.bucket, req.params.path, req.user.id);
    res.set({ "Content-Type": type, "Cache-Control": "private, no-cache", "X-Content-Type-Options": "nosniff" });
    res.sendFile(file, { cacheControl: false }, (err) => {
      if (!err) return;
      if (err.code === "ENOENT" || err.status === 404) {
        if (!res.headersSent) res.status(404).json({ error: "Not found." });
      } else {
        next(err);
      }
    });
  });

  router.put(route, requireUser, async (req, res) => {
    const limit = BUCKETS[req.params.bucket]?.maxBytes;
    if (limit && Number(req.headers["content-length"]) > limit) {
      throw new StorageError(413, `Files here can be at most ${limit / (1024 * 1024)} MB.`);
    }
    const { size } = await storage.write(req.params.bucket, req.params.path, req.user.id, req.headers["content-type"], req);
    res.json({ path: req.params.path.join("/"), size });
  });

  router.delete(route, requireUser, async (req, res) => {
    const removed = await storage.remove(req.params.bucket, req.params.path, req.user.id);
    res.status(removed ? 204 : 404).end();
  });

  router.use("/api/storage", (err, req, res, next) => {
    if (err instanceof StorageError) {
      // Drain an upload we stopped reading, so the client sees the response.
      req.resume();
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  });

  return router;
}
