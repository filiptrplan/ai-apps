// Cloudflare Worker for the static site. Static files are served by the assets
// binding before this script runs; it only handles paths that aren't files.
//
// /api/resolve-maps-link?url=... follows a Google Maps short link
// (maps.app.goo.gl) to the full URL, which browsers can't do themselves
// because the redirect is cross-origin. Only Google Maps links are followed.

const SHORT_HOSTS = new Set(["maps.app.goo.gl", "goo.gl"]);
const MAX_REDIRECTS = 5;

function isGoogleMaps(url) {
  return (
    (/^(www\.)?google\.[a-z.]+$/.test(url.hostname) && url.pathname.startsWith("/maps")) ||
    /^maps\.google\.[a-z.]+$/.test(url.hostname)
  );
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      // A short link always resolves the same way; errors may be transient.
      "Cache-Control": status === 200 ? "public, max-age=86400" : "no-store",
    },
  });
}

export async function resolveMapsLink(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    return json({ error: "Not a URL" }, 400);
  }
  if (!SHORT_HOSTS.has(url.hostname)) return json({ error: "Not a Google Maps short link" }, 400);
  if (url.hostname === "goo.gl" && !url.pathname.startsWith("/maps")) {
    return json({ error: "Not a Google Maps short link" }, 400);
  }

  for (let i = 0; i < MAX_REDIRECTS; i++) {
    let res;
    try {
      res = await fetch(url.toString(), { method: "GET", redirect: "manual" });
    } catch {
      return json({ error: "Couldn't reach Google Maps" }, 502);
    }
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) break;
    url = new URL(location, url);
    if (isGoogleMaps(url)) return json({ url: url.toString() });
    if (!SHORT_HOSTS.has(url.hostname)) break;
  }
  return json({ error: "Link didn't lead to Google Maps" }, 422);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/resolve-maps-link") {
      return resolveMapsLink(url.searchParams.get("url") ?? "");
    }
    return env.ASSETS.fetch(request);
  },
};
