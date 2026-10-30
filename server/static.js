// Serves the site from the repo root, as Cloudflare's asset binding did:
// /german → german.html, /german.html → 307 to /german, / → index.html.
//
// Only what the pages use is served (an allowlist), never server code,
// migrations, the deploy files, sources or dotfiles:
//   - root: *.html, *-app.js, *-app.css, *-sw.js
//   - shared/ and each app's directory (one with a <name>.html next to it):
//     scripts, JSON, images, fonts, audio and binary data

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import express from "express";

const ROOT_FILE = /^[\w-]+(\.html|-app\.js|-app\.css|-sw\.js)$/;
const ASSET_EXT = new Set([
  ".js", ".json", ".css", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".ico",
  ".woff2", ".mp3", ".wav", ".bin",
]);

export function staticRoutes(root) {
  const pages = new Set(
    readdirSync(root).filter((f) => f.endsWith(".html")).map((f) => f.slice(0, -".html".length))
  );
  const assetDirs = new Set([...pages, "shared"].filter((d) => existsSync(path.join(root, d))));

  function servable(segments) {
    if (segments.some((s) => s === "" || s.startsWith(".") || /[\\\0]/.test(s))) return false;
    if (segments.length === 1) return ROOT_FILE.test(segments[0]);
    return assetDirs.has(segments[0]) && ASSET_EXT.has(path.extname(segments.at(-1)).toLowerCase());
  }

  function send(res, next, rel) {
    // No caching without a check: bundles keep their names between versions.
    const noCache = rel.endsWith(".html") || rel.endsWith("-sw.js");
    res.sendFile(
      rel,
      {
        root,
        dotfiles: "deny",
        cacheControl: false,
        headers: { "Cache-Control": noCache ? "no-cache" : "public, max-age=0, must-revalidate" },
      },
      (err) => {
        if (err && !res.headersSent) next(err.status === 404 || err.code === "ENOENT" ? undefined : err);
      }
    );
  }

  const router = express.Router();

  router.get("/{*path}", (req, res, next) => {
    let pathname;
    try {
      pathname = decodeURIComponent(req.path);
    } catch {
      return next();
    }
    const query = req.originalUrl.slice(req.path.length);

    if (pathname === "/") return send(res, next, "index.html");
    if (pathname === "/index.html") return res.redirect(307, "/" + query);

    const segments = pathname.slice(1).split("/");
    const page = segments[0].replace(/\.html$/, "");
    if (pages.has(page)) {
      // /german.html and /german/ → /german
      const trailingSlash = segments.length === 2 && segments[1] === "";
      if ((segments.length === 1 && segments[0] !== page) || trailingSlash) {
        return res.redirect(307, `/${page}${query}`);
      }
      if (segments.length === 1) return send(res, next, `${page}.html`);
    }

    if (!servable(segments)) return next();
    send(res, next, segments.join("/"));
  });

  return router;
}
