// The signed-in user's daily app_data backups, listed and restored from
// index.html. The snapshots themselves are taken by startSnapshotJob.
//
//   GET  /api/backups                → [{ backup_date, created_at }], newest first
//   POST /api/backups/:date/restore  → 204, or 404 if there's no such backup

import express from "express";

const HOUR_MS = 60 * 60 * 1000;

export function backupRoutes({ appData, requireUser }) {
  const router = express.Router();

  router.get("/api/backups", requireUser, async (req, res) => {
    res.set("Cache-Control", "no-store").json(await appData.listBackups(req.user.id));
  });

  router.post("/api/backups/:date/restore", requireUser, async (req, res) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date) || isNaN(Date.parse(req.params.date))) {
      return res.status(400).json({ error: "Invalid date." });
    }
    const restored = await appData.restoreBackup(req.user.id, req.params.date);
    if (!restored) return res.status(404).json({ error: "That backup no longer exists." });
    res.status(204).end();
  });

  return router;
}

// Snapshots every user's app_data once per UTC day: now, and then every
// hour, which only does something on the first run after midnight.
export function startSnapshotJob(appData, { intervalMs = HOUR_MS } = {}) {
  async function run() {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const created = await appData.snapshotAll(today);
      if (created > 0) console.log(`backups: snapshotted ${created} user(s) for ${today}`);
    } catch (err) {
      console.error("backups: snapshot failed:", err.message);
    }
  }
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
