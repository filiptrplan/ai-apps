// GET /api/resolve-maps-link?url=...: follows a Google Maps short link
// (maps.app.goo.gl) to the full URL, which browsers can't do themselves
// because the redirect is cross-origin (moped-route/share.js uses it). Only
// Google Maps links are followed, and no sign-in is needed.

import express from "express";

const SHORT_HOSTS = new Set(["maps.app.goo.gl", "goo.gl"]);
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 8000;

function isGoogleMaps(url) {
  return (
    (/^(www\.)?google\.[a-z.]+$/.test(url.hostname) && url.pathname.startsWith("/maps")) ||
    /^maps\.google\.[a-z.]+$/.test(url.hostname)
  );
}

// Returns [status, body].
export async function resolveMapsLink(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    return [400, { error: "Not a URL" }];
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return [400, { error: "Not a Google Maps short link" }];
  if (!SHORT_HOSTS.has(url.hostname)) return [400, { error: "Not a Google Maps short link" }];
  if (url.hostname === "goo.gl" && !url.pathname.startsWith("/maps")) {
    return [400, { error: "Not a Google Maps short link" }];
  }

  for (let i = 0; i < MAX_REDIRECTS; i++) {
    let res;
    try {
      res = await fetch(url.toString(), { method: "GET", redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      return [502, { error: "Couldn't reach Google Maps" }];
    }
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) break;
    url = new URL(location, url);
    if (isGoogleMaps(url)) return [200, { url: url.toString() }];
    if (!SHORT_HOSTS.has(url.hostname)) break;
  }
  return [422, { error: "Link didn't lead to Google Maps" }];
}

export function mapsRoutes() {
  const router = express.Router();
  router.get("/api/resolve-maps-link", async (req, res) => {
    const [status, body] = await resolveMapsLink(typeof req.query.url === "string" ? req.query.url : "");
    // A short link always resolves the same way; errors may be transient.
    res.status(status).set("Cache-Control", status === 200 ? "public, max-age=86400" : "no-store").json(body);
  });
  return router;
}
