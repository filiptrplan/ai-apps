// Reads a route out of whatever Google Maps shares: a directions link, a place
// link, or a short link (resolved through the site's Worker) inside some text.

const COORD_RE = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*\+?\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
const SHORT_HOSTS = new Set(["maps.app.goo.gl", "goo.gl"]);

// "Your location" as Google Maps writes it in a few languages; an empty
// directions segment means the same.
const CURRENT_LOCATION = new Set([
  "", "my location", "your location", "current location",
  "mein standort", "ihr standort", "aktueller standort",
  "ma position", "votre position", "la mia posizione", "la tua posizione",
  "moja lokacija", "vaša lokacija", "trenutna lokacija",
]);

const TRAVEL_MODES = { 0: "driving", 1: "bicycling", 2: "walking", 3: "transit", 9: "two-wheeler" };

export function extractUrl(text) {
  const urls = String(text ?? "").match(/https?:\/\/[^\s<>"']+/g) ?? [];
  return urls.find((u) => /google\.[a-z.]+\/maps|maps\.google\.|goo\.gl/.test(u)) ?? urls[0] ?? null;
}

export function isShortLink(url) {
  try {
    return SHORT_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

function decodeSegment(seg) {
  try {
    return decodeURIComponent(seg.replace(/\+/g, " ")).trim();
  } catch {
    return seg.replace(/\+/g, " ").trim();
  }
}

// One place as text: coordinates, "your location" or something to look up.
function toStop(text) {
  const t = (text ?? "").trim();
  const m = t.match(COORD_RE);
  if (m) return { label: `${m[1]}, ${m[2]}`, point: [parseFloat(m[1]), parseFloat(m[2])] };
  if (CURRENT_LOCATION.has(t.toLowerCase())) return { label: "My location", current: true };
  return { label: t, query: t };
}

function travelMode(data) {
  const m = data.match(/!3e(\d+)/);
  return m ? TRAVEL_MODES[m[1]] ?? "other" : null;
}

// /maps/dir/A/B/C/@view/data=... - places are path segments; for named ones,
// the data blob carries their coordinates as !1d<lng>!2d<lat> in order.
function parseDirPath(url) {
  const parts = url.pathname.split("/").slice(3); // after "", "maps", "dir"
  const segs = [];
  let data = "";
  for (const part of parts) {
    if (part.startsWith("@")) continue;
    if (part.startsWith("data=")) {
      data = part.slice(5);
      continue;
    }
    segs.push(decodeSegment(part));
  }
  // A trailing slash leaves an empty last segment that isn't a place.
  while (segs.length > 2 && segs[segs.length - 1] === "") segs.pop();

  const stops = segs.map(toStop);
  const coords = [...data.matchAll(/!1d(-?\d+\.\d+)!2d(-?\d+\.\d+)/g)].map((m) => [parseFloat(m[2]), parseFloat(m[1])]);
  let next = 0;
  for (const stop of stops) {
    if (stop.query && next < coords.length) stop.point = coords[next++];
  }
  return { stops, travelMode: travelMode(data) };
}

// Parses a full Google Maps URL into stops (start first, destination last).
// Returns null for URLs that don't describe a place or route.
export function parseMapsUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  const q = url.searchParams;
  const path = url.pathname;

  if (q.get("api") === "1" || (path.startsWith("/maps/dir") && q.has("destination"))) {
    if (!q.has("destination")) return null;
    const stops = [
      q.has("origin") ? toStop(q.get("origin")) : toStop(""),
      ...(q.get("waypoints") ?? "").split("|").filter(Boolean).map(toStop),
      toStop(q.get("destination")),
    ];
    return { stops, travelMode: q.get("travelmode") };
  }

  if (path.startsWith("/maps/dir/")) {
    const parsed = parseDirPath(url);
    return parsed.stops.length >= 2 ? parsed : null;
  }

  if (q.has("daddr")) {
    const dests = q.get("daddr").split(/\s+to:/).map(toStop);
    return { stops: [toStop(q.get("saddr") ?? ""), ...dests], travelMode: null };
  }

  // A single place: route there from the current location.
  let dest = null;
  if (path.startsWith("/maps/place/")) {
    const name = decodeSegment(path.split("/")[3] ?? "");
    const m = path.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) ?? path.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    dest = { label: name || "Shared place", query: name || undefined };
    if (m) dest.point = [parseFloat(m[1]), parseFloat(m[2])];
  } else if (path.startsWith("/maps/search/")) {
    dest = toStop(decodeSegment(path.split("/")[3] ?? ""));
  } else if (q.has("q")) {
    dest = toStop(q.get("q"));
  }
  if (!dest || (!dest.point && !dest.query)) return null;
  return { stops: [toStop(""), dest], travelMode: null };
}

export async function resolveShortLink(url) {
  const res = await fetch(`/api/resolve-maps-link?url=${encodeURIComponent(url)}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.url) {
    throw new Error(json.error || "Couldn't open that Google Maps link. Short links only work on the deployed site.");
  }
  return json.url;
}

// Shared text or URL -> { stops, travelMode }, following short links.
export async function readSharedRoute(text) {
  let url = extractUrl(text);
  if (!url) throw new Error("No Google Maps link found in what was shared.");
  if (isShortLink(url)) url = await resolveShortLink(url);
  const parsed = parseMapsUrl(url);
  if (!parsed) throw new Error("That link doesn't contain a route or a place.");
  return parsed;
}
