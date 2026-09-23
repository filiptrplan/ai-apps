// Loads road ways from the Overpass API in fixed tiles, cached in IndexedDB so
// repeat trips through the same area don't hit the network.

// Ordered by measured speed and reliability from Zurich. The Swiss instance
// only has Swiss data, so an empty answer from it falls through to the global
// mirrors (trips near the border).
const ENDPOINTS = [
  { url: "https://overpass.osm.ch/api/interpreter", regional: true },
  { url: "https://maps.mail.ru/osm/tools/overpass/api/interpreter" },
  { url: "https://overpass.private.coffee/api/interpreter" },
  { url: "https://overpass-api.de/api/interpreter" },
];
const ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 90 * 1000;
const TILE_LAT = 0.06;
const TILE_LON = 0.09;
const CACHE_TTL_MS = 30 * 24 * 3600 * 1000;
const DB_NAME = "moped-route";
const STORE = "tiles";

const KEEP_TAGS = [
  "highway", "name", "ref", "maxspeed", "maxspeed:forward", "maxspeed:backward",
  "maxspeed:type", "zone:maxspeed", "source:maxspeed", "motorroad", "access",
  "vehicle", "motor_vehicle", "moped", "oneway", "junction", "service",
];

function tileQuery(s, w, n, e) {
  const bb = `${s},${w},${n},${e}`;
  return `[out:json][timeout:120];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street)(_link)?$"](${bb});
  way["highway"="service"][!"service"](${bb});
  way["highway"="service"]["service"="alley"](${bb});
);
out body geom;`;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function cacheGet(key) {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function cachePut(key, value) {
  try {
    const db = await openDb();
    db.transaction(STORE, "readwrite").objectStore(STORE).put(value, key);
  } catch {
    /* no IndexedDB - the tile just gets fetched again next time */
  }
}

function trimWay(el) {
  const tags = {};
  for (const k of KEEP_TAGS) if (el.tags[k] != null) tags[k] = el.tags[k];
  return { id: el.id, nodes: el.nodes, geometry: el.geometry.map((g) => [g.lat, g.lon]), tags };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Public Overpass servers are often busy (429/504), so cycle through mirrors
// with a growing pause between rounds.
async function fetchTile(s, w, n, e, onRetry) {
  const body = "data=" + encodeURIComponent(tileQuery(s, w, n, e));
  let lastError;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) {
      onRetry(attempt);
      await sleep(5000 * attempt);
    }
    for (const { url, regional } of ENDPOINTS) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`Overpass ${res.status}`);
        // Overpass reports some errors as an HTML page with status 200.
        const text = await res.text();
        if (!text.startsWith("{")) throw new Error("Overpass returned an error page");
        const ways = JSON.parse(text)
          .elements.filter((el) => el.type === "way" && el.geometry)
          .map(trimWay);
        if (regional && ways.length === 0) throw new Error("Tile outside regional coverage");
        return ways;
      } catch (err) {
        lastError = err;
      }
    }
  }
  throw new Error(`Couldn't load road data from OpenStreetMap (${lastError?.message ?? "unknown error"}). Try again in a minute.`);
}

export function tilesFor(bbox) {
  const tiles = [];
  for (let i = Math.floor(bbox.s / TILE_LAT); i * TILE_LAT < bbox.n; i++) {
    for (let j = Math.floor(bbox.w / TILE_LON); j * TILE_LON < bbox.e; j++) {
      tiles.push({ i, j });
    }
  }
  return tiles;
}

export async function loadRoads(bbox, onProgress = () => {}) {
  const tiles = tilesFor(bbox);
  const byId = new Map();
  let done = 0;
  onProgress(`Loading roads (0/${tiles.length} areas)…`);

  const loadOne = async ({ i, j }) => {
    const key = `v1:${i}:${j}`;
    const cached = await cacheGet(key);
    let ways;
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      ways = cached.ways;
    } else {
      const s = i * TILE_LAT;
      const w = j * TILE_LON;
      const bounds = [s, w, s + TILE_LAT, w + TILE_LON].map((v) => v.toFixed(4));
      ways = await fetchTile(...bounds, (attempt) =>
        onProgress(`OpenStreetMap server busy, retrying (${attempt}/${ATTEMPTS - 1})…`)
      );
      await cachePut(key, { at: Date.now(), ways });
    }
    for (const way of ways) byId.set(way.id, way);
    done++;
    onProgress(`Loading roads (${done}/${tiles.length} areas)…`);
  };

  // One at a time: public Overpass servers rate-limit parallel requests.
  for (const tile of tiles) await loadOne(tile);
  return [...byId.values()];
}
