// Builds the Express app from its parts, so tests can run it against their
// own database, storage folder and OpenID provider. index.js starts it.

import express from "express";
import { createAppDataStore } from "./appData.js";
import { createAuth } from "./auth.js";
import { createEventHub } from "./events.js";
import { createStorage } from "./storage.js";
import { staticRoutes } from "./static.js";
import { backupRoutes } from "./routes/backups.js";
import { dataRoutes } from "./routes/data.js";
import { fnRoutes } from "./routes/fn.js";
import { moRoutes } from "./routes/mo.js";
import { storageRoutes } from "./routes/storage.js";

export function createApp({ sql, storageDir, siteRoot, publicUrl, getOidcConfig, sha = "dev" }) {
  const appData = createAppDataStore(sql);
  const auth = createAuth({ sql, getOidcConfig, publicUrl });
  const storage = createStorage(storageDir);
  const events = createEventHub();
  const fn = fnRoutes({ appData, storage });
  const { requireUser } = auth;

  const app = express();
  app.disable("x-powered-by");

  app.get("/api/health", async (req, res) => {
    let ok = true;
    try {
      await sql`select 1`;
    } catch {
      ok = false;
    }
    res.status(ok ? 200 : 503).set("Cache-Control", "no-store").json({ ok, sha });
  });

  app.use(auth.loadUser);
  app.use(auth.router);
  // Storage takes raw bodies, so JSON parsing is limited to the JSON APIs.
  app.use(["/api/data", "/api/backups", "/api/mo"], express.json({ limit: "20mb" }));
  app.use(dataRoutes({ appData, requireUser }));
  app.use(backupRoutes({ appData, requireUser }));
  app.use(storageRoutes({ storage, requireUser }));
  app.use(moRoutes({ sql }));
  app.use(fn.router);
  app.use(events.router);
  app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));
  if (siteRoot) app.use(staticRoutes(siteRoot));

  app.use((req, res) => res.status(404).type("text").send("Not found"));
  app.use((err, req, res, next) => {
    if (err.type === "entity.too.large" || err.type === "entity.parse.failed") {
      return res.status(err.status).json({ error: err.type === "entity.too.large" ? "Too large." : "Invalid JSON." });
    }
    console.error(`${req.method} ${req.path}:`, err);
    if (res.headersSent) return;
    res.status(500).json({ error: "Something went wrong on the server." });
  });

  return { app, appData, auth, events, fn };
}
