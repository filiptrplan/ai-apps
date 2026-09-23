(() => {
  // moped-route/osm.js
  var ENDPOINTS = [
    { url: "https://overpass.osm.ch/api/interpreter", regional: true },
    { url: "https://maps.mail.ru/osm/tools/overpass/api/interpreter" },
    { url: "https://overpass.private.coffee/api/interpreter" },
    { url: "https://overpass-api.de/api/interpreter" }
  ];
  var ATTEMPTS = 3;
  var REQUEST_TIMEOUT_MS = 90 * 1e3;
  var TILE_LAT = 0.06;
  var TILE_LON = 0.09;
  var CACHE_TTL_MS = 30 * 24 * 3600 * 1e3;
  var DB_NAME = "moped-route";
  var STORE = "tiles";
  var KEEP_TAGS = [
    "highway",
    "name",
    "ref",
    "maxspeed",
    "maxspeed:forward",
    "maxspeed:backward",
    "maxspeed:type",
    "zone:maxspeed",
    "source:maxspeed",
    "motorroad",
    "access",
    "vehicle",
    "motor_vehicle",
    "moped",
    "oneway",
    "junction",
    "service"
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
        req.onsuccess = () => {
          var _a;
          return resolve((_a = req.result) != null ? _a : null);
        };
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
    }
  }
  function trimWay(el) {
    const tags = {};
    for (const k of KEEP_TAGS) if (el.tags[k] != null) tags[k] = el.tags[k];
    return { id: el.id, nodes: el.nodes, geometry: el.geometry.map((g) => [g.lat, g.lon]), tags };
  }
  var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function fetchTile(s, w, n, e, onRetry) {
    var _a;
    const body = "data=" + encodeURIComponent(tileQuery(s, w, n, e));
    let lastError;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      if (attempt > 0) {
        onRetry(attempt);
        await sleep(5e3 * attempt);
      }
      for (const { url, regional } of ENDPOINTS) {
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
          });
          if (!res.ok) throw new Error(`Overpass ${res.status}`);
          const text = await res.text();
          if (!text.startsWith("{")) throw new Error("Overpass returned an error page");
          const ways = JSON.parse(text).elements.filter((el) => el.type === "way" && el.geometry).map(trimWay);
          if (regional && ways.length === 0) throw new Error("Tile outside regional coverage");
          return ways;
        } catch (err) {
          lastError = err;
        }
      }
    }
    throw new Error(`Couldn't load road data from OpenStreetMap (${(_a = lastError == null ? void 0 : lastError.message) != null ? _a : "unknown error"}). Try again in a minute.`);
  }
  function tilesFor(bbox) {
    const tiles = [];
    for (let i = Math.floor(bbox.s / TILE_LAT); i * TILE_LAT < bbox.n; i++) {
      for (let j = Math.floor(bbox.w / TILE_LON); j * TILE_LON < bbox.e; j++) {
        tiles.push({ i, j });
      }
    }
    return tiles;
  }
  async function loadRoads(bbox, onProgress = () => {
  }) {
    const tiles = tilesFor(bbox);
    const byId = /* @__PURE__ */ new Map();
    let done = 0;
    onProgress(`Loading roads (0/${tiles.length} areas)\u2026`);
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
        ways = await fetchTile(
          ...bounds,
          (attempt) => onProgress(`OpenStreetMap server busy, retrying (${attempt}/${ATTEMPTS - 1})\u2026`)
        );
        await cachePut(key, { at: Date.now(), ways });
      }
      for (const way of ways) byId.set(way.id, way);
      done++;
      onProgress(`Loading roads (${done}/${tiles.length} areas)\u2026`);
    };
    for (const tile of tiles) await loadOne(tile);
    return [...byId.values()];
  }

  // moped-route/geo.js
  var EARTH_RADIUS = 63710088e-1;
  var RAD = Math.PI / 180;
  function haversine(a, b) {
    const dLat = (b[0] - a[0]) * RAD;
    const dLon = (b[1] - a[1]) * RAD;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(h));
  }
  function makeProjection(lat0) {
    const ky = 110574;
    const kx = 111320 * Math.cos(lat0 * RAD);
    return {
      fwd: (p) => [p[1] * kx, p[0] * ky],
      inv: (xy) => [xy[1] / ky, xy[0] / kx]
    };
  }
  function dist(a, b) {
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  function projectOnSegment(p, a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const x = a[0] + t * dx;
    const y = a[1] + t * dy;
    return { t, x, y, d: Math.hypot(p[0] - x, p[1] - y) };
  }
  function bearing(a, b) {
    const deg = Math.atan2(b[0] - a[0], b[1] - a[1]) / RAD;
    return (deg + 360) % 360;
  }
  function angleDiff(a, b, undirected = false) {
    let d = Math.abs(a - b) % 360;
    if (d > 180) d = 360 - d;
    if (undirected && d > 90) d = 180 - d;
    return d;
  }
  function densify(xy, step) {
    const out = [];
    for (let i = 0; i < xy.length - 1; i++) {
      const a = xy[i];
      const b = xy[i + 1];
      const len = dist(a, b);
      const brg = bearing(a, b);
      const n = Math.max(1, Math.ceil(len / step));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        out.push({ x: a[0] + t * (b[0] - a[0]), y: a[1] + t * (b[1] - a[1]), bearing: brg });
      }
    }
    if (xy.length) {
      const last = xy[xy.length - 1];
      const brg = out.length ? out[out.length - 1].bearing : 0;
      out.push({ x: last[0], y: last[1], bearing: brg });
    }
    return out;
  }
  var SegmentGrid = class {
    constructor(cell = 50) {
      this.cell = cell;
      this.cells = /* @__PURE__ */ new Map();
    }
    key(ix, iy) {
      return ix * 1e7 + iy;
    }
    add(seg) {
      const c = this.cell;
      const x0 = Math.floor(Math.min(seg.ax, seg.bx) / c);
      const x1 = Math.floor(Math.max(seg.ax, seg.bx) / c);
      const y0 = Math.floor(Math.min(seg.ay, seg.by) / c);
      const y1 = Math.floor(Math.max(seg.ay, seg.by) / c);
      for (let ix = x0; ix <= x1; ix++) {
        for (let iy = y0; iy <= y1; iy++) {
          const k = this.key(ix, iy);
          let bucket = this.cells.get(k);
          if (!bucket) this.cells.set(k, bucket = []);
          bucket.push(seg);
        }
      }
    }
    // Nearest segment within maxDist of (x, y) that passes filter, or null.
    nearest(x, y, maxDist, filter) {
      var _a;
      return (_a = this.within(x, y, maxDist, filter)[0]) != null ? _a : null;
    }
    // Every segment within maxDist of (x, y) that passes filter, nearest first.
    within(x, y, maxDist, filter) {
      const c = this.cell;
      const r = Math.ceil(maxDist / c);
      const cx = Math.floor(x / c);
      const cy = Math.floor(y / c);
      const hits = [];
      const seen = /* @__PURE__ */ new Set();
      for (let ix = cx - r; ix <= cx + r; ix++) {
        for (let iy = cy - r; iy <= cy + r; iy++) {
          const bucket = this.cells.get(this.key(ix, iy));
          if (!bucket) continue;
          for (const seg of bucket) {
            if (seen.has(seg)) continue;
            seen.add(seg);
            if (filter && !filter(seg)) continue;
            const p = projectOnSegment([x, y], [seg.ax, seg.ay], [seg.bx, seg.by]);
            if (p.d <= maxDist) hits.push({ seg, ...p });
          }
        }
      }
      return hits.sort((a, b) => a.d - b.d);
    }
  };

  // moped-route/speed.js
  var CH_ZONES = {
    "CH:urban": 50,
    "CH:rural": 80,
    "CH:trunk": 100,
    "CH:motorway": 120,
    "CH:zone30": 30,
    "CH:zone20": 20
  };
  var HIGHWAY_DEFAULTS = {
    motorway: 120,
    motorway_link: 120,
    trunk: 100,
    trunk_link: 100,
    primary: 80,
    primary_link: 80,
    secondary: 80,
    secondary_link: 80,
    living_street: 20
  };
  var BLOCKED_ACCESS = /* @__PURE__ */ new Set(["no", "private", "agricultural", "forestry", "delivery", "customers", "emergency"]);
  var BLOCKED_SERVICE = /* @__PURE__ */ new Set(["parking_aisle", "driveway", "drive-through", "emergency_access"]);
  function parseSpeed(value) {
    if (!value) return null;
    let best = null;
    for (const part of String(value).split(";")) {
      const v = part.trim();
      let n = null;
      if (v in CH_ZONES) n = CH_ZONES[v];
      else if (v === "walk") n = 6;
      else if (v === "none") n = 999;
      else {
        const m = v.match(/^(\d+(?:\.\d+)?)\s*(mph)?$/);
        if (m) n = parseFloat(m[1]) * (m[2] ? 1.609 : 1);
      }
      if (n != null && (best == null || n > best)) best = n;
    }
    return best;
  }
  var LIMIT_KEYS = ["maxspeed", "maxspeed:forward", "maxspeed:backward", "maxspeed:type", "zone:maxspeed", "source:maxspeed"];
  function hasTaggedLimit(tags) {
    return LIMIT_KEYS.some((k) => parseSpeed(tags[k]) != null);
  }
  function effectiveLimit(tags) {
    var _a;
    const direct = [tags.maxspeed, tags["maxspeed:forward"], tags["maxspeed:backward"]].map(parseSpeed).filter((n) => n != null);
    if (direct.length) return Math.max(...direct);
    for (const key of ["maxspeed:type", "zone:maxspeed", "source:maxspeed"]) {
      const n = parseSpeed(tags[key]);
      if (n != null) return n;
    }
    if (tags.motorroad === "yes") return 100;
    return (_a = HIGHWAY_DEFAULTS[tags.highway]) != null ? _a : 50;
  }
  function isRoutable(tags) {
    var _a, _b, _c;
    if (tags.highway === "motorway" || tags.highway === "motorway_link") return false;
    if (tags.motorroad === "yes") return false;
    const access = (_c = (_b = (_a = tags.moped) != null ? _a : tags.motor_vehicle) != null ? _b : tags.vehicle) != null ? _c : tags.access;
    if (access && BLOCKED_ACCESS.has(access)) return false;
    if (tags.highway === "service" && BLOCKED_SERVICE.has(tags.service)) return false;
    return true;
  }
  function isAllowed(tags, maxSpeed, limit = effectiveLimit(tags)) {
    return limit <= maxSpeed && isRoutable(tags);
  }
  function overLimitFactor(limit, maxSpeed) {
    return limit > maxSpeed ? 1 + 0.3 * (limit - maxSpeed) : 1;
  }
  function onewayDir(tags) {
    const ow = tags.oneway;
    if (ow === "yes" || ow === "true" || ow === "1") return 1;
    if (ow === "-1" || ow === "reverse") return -1;
    if (ow === "no") return 0;
    if (tags.junction === "roundabout" || tags.junction === "circular") return 1;
    if (tags.highway === "motorway") return 1;
    return 0;
  }

  // moped-route/graph.js
  var COST_PENALTY = { service: 1.5, living_street: 1.3 };
  function buildNetwork(ways, maxSpeed, lat0) {
    var _a;
    const proj = makeProjection(lat0);
    const coords = /* @__PURE__ */ new Map();
    const adj = /* @__PURE__ */ new Map();
    const radj = /* @__PURE__ */ new Map();
    const grid = new SegmentGrid(50);
    const addEdge = (from, to, edge) => {
      let list = adj.get(from);
      if (!list) adj.set(from, list = []);
      list.push({ to, ...edge });
      let rlist = radj.get(to);
      if (!rlist) radj.set(to, rlist = []);
      rlist.push(from);
    };
    for (const way of ways) {
      const limit = effectiveLimit(way.tags);
      const routable = isRoutable(way.tags);
      const allowed = isAllowed(way.tags, maxSpeed, limit);
      const dir = onewayDir(way.tags);
      const assumed = !hasTaggedLimit(way.tags) && way.tags.motorroad !== "yes";
      const info = { id: way.id, tags: way.tags, limit, assumed, allowed, routable, dir };
      const speed = Math.min(limit, maxSpeed) / 3.6;
      const penalty = ((_a = COST_PENALTY[way.tags.highway]) != null ? _a : 1) * overLimitFactor(limit, maxSpeed);
      const xy = way.geometry.map(proj.fwd);
      for (let i = 0; i < way.nodes.length; i++) coords.set(way.nodes[i], way.geometry[i]);
      for (let i = 0; i < way.nodes.length - 1; i++) {
        const a = way.nodes[i];
        const b = way.nodes[i + 1];
        const len = haversine(way.geometry[i], way.geometry[i + 1]);
        grid.add({
          ax: xy[i][0],
          ay: xy[i][1],
          bx: xy[i + 1][0],
          by: xy[i + 1][1],
          bearing: bearing(xy[i], xy[i + 1]),
          way: info,
          a,
          b,
          len
        });
        if (!routable) continue;
        const time = len / speed;
        const edge = { len, time, cost: time * penalty, way: info };
        if (dir >= 0) addEdge(a, b, edge);
        if (dir <= 0) addEdge(b, a, edge);
      }
    }
    return { proj, coords, adj, radj, grid, maxSpeed };
  }

  // moped-route/astar.js
  var SNAP_RADIUS = 300;
  var PREFER_ALLOWED_RADIUS = 60;
  var MIN_COMPONENT = 200;
  var START = "start";
  var TARGET = "target";
  var MinHeap = class {
    constructor() {
      this.items = [];
    }
    get size() {
      return this.items.length;
    }
    push(priority, value) {
      const items = this.items;
      items.push([priority, value]);
      let i = items.length - 1;
      while (i > 0) {
        const parent = i - 1 >> 1;
        if (items[parent][0] <= items[i][0]) break;
        [items[parent], items[i]] = [items[i], items[parent]];
        i = parent;
      }
    }
    pop() {
      const items = this.items;
      const top = items[0];
      const last = items.pop();
      if (items.length) {
        items[0] = last;
        let i = 0;
        for (; ; ) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < items.length && items[l][0] < items[m][0]) m = l;
          if (r < items.length && items[r][0] < items[m][0]) m = r;
          if (m === i) break;
          [items[m], items[i]] = [items[i], items[m]];
          i = m;
        }
      }
      return top[1];
    }
  };
  function reach(network, node, backwards) {
    var _a, _b;
    const seen = /* @__PURE__ */ new Set([node]);
    const queue = [node];
    while (queue.length && seen.size < MIN_COMPONENT) {
      const n = queue.shift();
      const next = backwards ? (_a = network.radj.get(n)) != null ? _a : [] : ((_b = network.adj.get(n)) != null ? _b : []).map((e) => e.to);
      for (const m of next) {
        if (!seen.has(m)) {
          seen.add(m);
          queue.push(m);
        }
      }
    }
    return seen.size;
  }
  function snap(network, point, asTarget = false) {
    const [x, y] = network.proj.fwd(point);
    const candidates = [
      ...network.grid.within(x, y, PREFER_ALLOWED_RADIUS, (seg) => seg.way.allowed),
      ...network.grid.within(x, y, SNAP_RADIUS, (seg) => seg.way.routable)
    ];
    const checked = /* @__PURE__ */ new Set();
    let best = null;
    for (const hit2 of candidates) {
      const { seg } = hit2;
      if (checked.has(seg)) continue;
      checked.add(seg);
      const ends = [];
      if (seg.way.dir >= 0) ends.push(asTarget ? seg.a : seg.b);
      if (seg.way.dir <= 0) ends.push(asTarget ? seg.b : seg.a);
      const size = Math.max(0, ...ends.map((n) => reach(network, n, asTarget)));
      if (!best || size > best.size) best = { hit: hit2, size };
      if (size >= MIN_COMPONENT) break;
    }
    if (!best) return null;
    const { hit } = best;
    return { seg: hit.seg, t: hit.t, point: network.proj.inv([hit.x, hit.y]) };
  }
  function partialEdge(seg, fraction, maxSpeed) {
    const speed = Math.min(seg.way.limit, maxSpeed) / 3.6;
    const len = seg.len * fraction;
    const time = len / speed;
    return { len, time, cost: time * overLimitFactor(seg.way.limit, maxSpeed), way: seg.way };
  }
  var MERGE_GAP = 100;
  function overLimitStretches(edges, maxSpeed) {
    const out = [];
    let gap = Infinity;
    for (const edge of edges) {
      if (edge.way.limit <= maxSpeed) {
        gap += edge.len;
        continue;
      }
      const name = edge.way.tags.name || edge.way.tags.ref || edge.way.tags.highway;
      const last = out[out.length - 1];
      if (last && gap < MERGE_GAP && last.name === name && last.limit === edge.way.limit) {
        last.length += edge.len;
      } else {
        out.push({ name, limit: edge.way.limit, length: edge.len });
      }
      gap = 0;
    }
    return out;
  }
  function route(network, from, to) {
    var _a;
    const { adj, coords, maxSpeed } = network;
    const s = snap(network, from);
    const e = snap(network, to, true);
    if (!s) throw new Error("No road a moped may use near the start.");
    if (!e) throw new Error("No road a moped may use near the destination.");
    const startEdges = [];
    if (s.seg.way.dir >= 0) startEdges.push({ to: s.seg.b, ...partialEdge(s.seg, 1 - s.t, maxSpeed) });
    if (s.seg.way.dir <= 0) startEdges.push({ to: s.seg.a, ...partialEdge(s.seg, s.t, maxSpeed) });
    const targetEdges = /* @__PURE__ */ new Map();
    if (e.seg.way.dir >= 0) targetEdges.set(e.seg.a, { to: TARGET, ...partialEdge(e.seg, e.t, maxSpeed) });
    if (e.seg.way.dir <= 0) targetEdges.set(e.seg.b, { to: TARGET, ...partialEdge(e.seg, 1 - e.t, maxSpeed) });
    const vMax = maxSpeed / 3.6;
    const h = (node) => node === TARGET ? 0 : haversine(coords.get(node), e.point) / vMax;
    const neighbours = (node) => {
      var _a2;
      const list = node === START ? startEdges : (_a2 = adj.get(node)) != null ? _a2 : [];
      const extra = targetEdges.get(node);
      return extra ? [...list, extra] : list;
    };
    const g = /* @__PURE__ */ new Map([[START, 0]]);
    const came = /* @__PURE__ */ new Map();
    const heap = new MinHeap();
    heap.push(0, START);
    const closed = /* @__PURE__ */ new Set();
    while (heap.size) {
      const node = heap.pop();
      if (node === TARGET) break;
      if (closed.has(node)) continue;
      closed.add(node);
      const gNode = g.get(node);
      for (const edge of neighbours(node)) {
        const cand = gNode + edge.cost;
        if (cand < ((_a = g.get(edge.to)) != null ? _a : Infinity)) {
          g.set(edge.to, cand);
          came.set(edge.to, { from: node, edge });
          heap.push(cand + h(edge.to), edge.to);
        }
      }
    }
    if (!came.has(TARGET)) return null;
    const nodes = [];
    const edges = [];
    for (let n = TARGET; n !== START; n = came.get(n).from) {
      edges.push(came.get(n).edge);
      nodes.push(n);
    }
    nodes.reverse();
    const realEdges = edges.reverse().filter((ed) => ed.len > 0.01);
    const points = [s.point];
    for (const n of nodes) if (n !== TARGET) points.push(coords.get(n));
    points.push(e.point);
    return {
      points,
      edges: realEdges,
      overLimit: overLimitStretches(realEdges, maxSpeed),
      distance: realEdges.reduce((sum, ed) => sum + ed.len, 0),
      duration: realEdges.reduce((sum, ed) => sum + ed.time, 0)
    };
  }

  // moped-route/polyline.js
  function decodePolyline(str) {
    const points = [];
    let index = 0;
    let lat = 0;
    let lng = 0;
    while (index < str.length) {
      for (const axis of [0, 1]) {
        let result = 0;
        let shift = 0;
        let b;
        do {
          b = str.charCodeAt(index++) - 63;
          result |= (b & 31) << shift;
          shift += 5;
        } while (b >= 32);
        const delta = result & 1 ? ~(result >> 1) : result >> 1;
        if (axis === 0) lat += delta;
        else lng += delta;
      }
      points.push([lat / 1e5, lng / 1e5]);
    }
    return points;
  }

  // moped-route/google.js
  var ZURICH = { latitude: 47.3769, longitude: 8.5417 };
  function latLng([lat, lon]) {
    return { location: { latLng: { latitude: lat, longitude: lon } } };
  }
  async function googleFetch(url, apiKey, fieldMask, body) {
    var _a;
    const res = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": fieldMask
      },
      body: body ? JSON.stringify(body) : void 0
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(((_a = json.error) == null ? void 0 : _a.message) || `Google API error ${res.status}`);
    return json;
  }
  async function computeRoute(apiKey, origin, destination, waypoints = []) {
    var _a;
    const json = await googleFetch(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
      apiKey,
      "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
      {
        origin: latLng(origin),
        destination: latLng(destination),
        intermediates: waypoints.map((w) => ({ ...latLng(w), via: true })),
        travelMode: "DRIVE",
        // Matches the Maps app, which routes with live traffic. Bills at the Pro
        // tier (TRAFFIC_UNAWARE would stay Essentials).
        routingPreference: "TRAFFIC_AWARE",
        routeModifiers: { avoidHighways: true, avoidTolls: true },
        polylineQuality: "HIGH_QUALITY"
      }
    );
    const r = (_a = json.routes) == null ? void 0 : _a[0];
    if (!r) throw new Error("Google found no route.");
    return {
      points: decodePolyline(r.polyline.encodedPolyline),
      distance: r.distanceMeters,
      duration: parseInt(r.duration, 10)
    };
  }
  async function autocomplete(apiKey, input, sessionToken) {
    var _a;
    const json = await googleFetch(
      "https://places.googleapis.com/v1/places:autocomplete",
      apiKey,
      "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat",
      {
        input,
        sessionToken,
        locationBias: { circle: { center: ZURICH, radius: 3e4 } }
      }
    );
    return ((_a = json.suggestions) != null ? _a : []).map((s) => s.placePrediction).filter(Boolean).map((p) => {
      var _a2, _b, _c, _d, _e, _f;
      return {
        placeId: p.placeId,
        main: (_c = (_b = (_a2 = p.structuredFormat) == null ? void 0 : _a2.mainText) == null ? void 0 : _b.text) != null ? _c : p.text.text,
        secondary: (_f = (_e = (_d = p.structuredFormat) == null ? void 0 : _d.secondaryText) == null ? void 0 : _e.text) != null ? _f : "",
        label: p.text.text
      };
    });
  }
  async function placeLocation(apiKey, placeId, sessionToken) {
    const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(sessionToken)}`;
    const json = await googleFetch(url, apiKey, "location");
    return [json.location.latitude, json.location.longitude];
  }
  async function searchPlace(apiKey, text) {
    var _a;
    const json = await googleFetch(
      "https://places.googleapis.com/v1/places:searchText",
      apiKey,
      "places.location,places.displayName",
      { textQuery: text, locationBias: { circle: { center: ZURICH, radius: 5e4 } } }
    );
    const place = (_a = json.places) == null ? void 0 : _a[0];
    if (!place) throw new Error(`Couldn't find "${text}".`);
    return [place.location.latitude, place.location.longitude];
  }

  // moped-route/link.js
  var WAYPOINTS_PER_LINK = 9;
  var fmt = ([lat, lon]) => `${lat.toFixed(6)},${lon.toFixed(6)}`;
  function splitLegs(origin, destination, waypoints) {
    const legs = [];
    let from = origin;
    let rest = waypoints;
    while (rest.length > WAYPOINTS_PER_LINK) {
      const to = rest[WAYPOINTS_PER_LINK];
      legs.push({ from, via: rest.slice(0, WAYPOINTS_PER_LINK), to });
      from = to;
      rest = rest.slice(WAYPOINTS_PER_LINK + 1);
    }
    legs.push({ from, via: rest, to: destination });
    return legs;
  }
  function buildMapsLink(origin, destination, waypoints = []) {
    const params = new URLSearchParams({
      api: "1",
      origin: fmt(origin),
      destination: fmt(destination),
      travelmode: "driving"
    });
    if (waypoints.length) params.set("waypoints", waypoints.map(fmt).join("|"));
    return `https://www.google.com/maps/dir/?${params.toString()}`;
  }
  function buildMapsLinks(origin, destination, waypoints = []) {
    return splitLegs(origin, destination, waypoints).map((leg) => buildMapsLink(leg.from, leg.to, leg.via));
  }

  // moped-route/pin.js
  var STEP = 20;
  var OFF_DIST = 30;
  var MATCH_DIST = 15;
  var MATCH_ANGLE = 30;
  var MIN_BAD_POINTS = 3;
  var SAFE_DIST = 25;
  var WAYPOINT_SPACING = 80;
  function buildPathIndex(proj, points) {
    const xy = points.map(proj.fwd);
    const grid = new SegmentGrid(50);
    const cum = [0];
    for (let i = 0; i < xy.length - 1; i++) {
      const len = dist(xy[i], xy[i + 1]);
      grid.add({ ax: xy[i][0], ay: xy[i][1], bx: xy[i + 1][0], by: xy[i + 1][1], s0: cum[i], len });
      cum.push(cum[i] + len);
    }
    return { xy, grid, cum, length: cum[cum.length - 1] };
  }
  function pointAt(pathIndex, s) {
    const { xy, cum } = pathIndex;
    let lo = 0;
    let hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = lo + hi >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    const segLen = cum[hi] - cum[lo];
    const t = segLen > 0 ? Math.min(1, Math.max(0, (s - cum[lo]) / segLen)) : 0;
    return [xy[lo][0] + t * (xy[hi][0] - xy[lo][0]), xy[lo][1] + t * (xy[hi][1] - xy[lo][1])];
  }
  function runs(items, pred, minCount) {
    const out = [];
    let start = -1;
    for (let i = 0; i <= items.length; i++) {
      const hit = i < items.length && pred(items[i]);
      if (hit && start < 0) start = i;
      if (!hit && start >= 0) {
        if (i - start >= minCount) out.push({ start, end: i - 1 });
        start = -1;
      }
    }
    return out;
  }
  function describeStretch(proj, pts, run, planned) {
    var _a, _b, _c;
    const counts = /* @__PURE__ */ new Map();
    let length = 0;
    for (let i = run.start; i <= run.end; i++) {
      const way2 = pts[i].way;
      if (way2) counts.set(way2, ((_a = counts.get(way2)) != null ? _a : 0) + 1);
      if (i > run.start) length += dist([pts[i - 1].x, pts[i - 1].y], [pts[i].x, pts[i].y]);
    }
    const way = (_b = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]) == null ? void 0 : _b[0];
    return {
      ...run,
      points: pts.slice(run.start, run.end + 1).map((p) => proj.inv([p.x, p.y])),
      name: way ? way.tags.name || way.tags.ref || way.tags.highway : "Unknown road",
      limit: way == null ? void 0 : way.limit,
      assumed: (_c = way == null ? void 0 : way.assumed) != null ? _c : false,
      length,
      planned
    };
  }
  function matchPoints(network, googlePoints) {
    const pts = densify(googlePoints.map(network.proj.fwd), STEP);
    for (const p of pts) {
      const match = network.grid.nearest(p.x, p.y, MATCH_DIST, (seg) => angleDiff(seg.bearing, p.bearing, true) <= MATCH_ANGLE);
      p.way = match ? match.seg.way : null;
      p.bad = !!match && !match.seg.way.allowed;
    }
    return pts;
  }
  function inspectRoute(network, googlePoints) {
    const pts = matchPoints(network, googlePoints);
    const stretches = runs(pts, (p) => p.bad, MIN_BAD_POINTS).map((r) => describeStretch(network.proj, pts, r, false));
    let length = 0;
    for (let i = 1; i < pts.length; i++) length += dist([pts[i - 1].x, pts[i - 1].y], [pts[i].x, pts[i].y]);
    return { stretches, length };
  }
  function analyze(network, pathIndex, googlePoints) {
    const { proj } = network;
    const pts = matchPoints(network, googlePoints);
    for (const p of pts) {
      const onPath = pathIndex.grid.nearest(p.x, p.y, OFF_DIST);
      p.off = !onPath;
      p.s = onPath ? onPath.seg.s0 + onPath.t * onPath.seg.len : null;
    }
    const strayed = runs(pts, (p) => p.bad && p.off, MIN_BAD_POINTS).map((r) => describeStretch(proj, pts, r, false));
    const planned = runs(pts, (p) => p.bad && !p.off, MIN_BAD_POINTS).map((r) => describeStretch(proj, pts, r, true));
    const badStretches = [...strayed, ...planned].sort((a, b) => a.start - b.start);
    const divergences = runs(pts, (p) => p.off, 2).map((d) => ({
      ...d,
      bad: strayed.some((b) => b.start <= d.end && b.end >= d.start)
    }));
    return { pts, badStretches, divergences };
  }
  function chooseWaypoint(network, pathIndex, pts, div, existing) {
    const s0 = div.start > 0 ? pts[div.start - 1].s : 0;
    const s1 = div.end < pts.length - 1 ? pts[div.end + 1].s : pathIndex.length;
    if (s0 == null || s1 == null || !(s1 > s0)) return null;
    const margin = Math.min(30, (s1 - s0) / 4);
    const detour = pts.slice(div.start, div.end + 1);
    let best = null;
    let bestUnsafe = null;
    for (let s = s0 + margin; s <= s1 - margin; s += 10) {
      const xy = pointAt(pathIndex, s);
      if (existing.some((w) => dist(w.xy, xy) < WAYPOINT_SPACING)) continue;
      let score = Infinity;
      for (const p of detour) score = Math.min(score, Math.hypot(p.x - xy[0], p.y - xy[1]));
      const safe = !network.grid.nearest(xy[0], xy[1], SAFE_DIST, (seg) => !seg.way.allowed);
      const cand = { s, xy, score, unsafe: !safe };
      if (safe && (!best || score > best.score)) best = cand;
      if (!bestUnsafe || score > bestUnsafe.score) bestUnsafe = cand;
    }
    return best != null ? best : bestUnsafe;
  }
  async function googleTrip(apiKey, origin, destination, waypoints) {
    const legs = splitLegs(origin, destination, waypoints);
    const routes = await Promise.all(legs.map((leg) => computeRoute(apiKey, leg.from, leg.to, leg.via)));
    return {
      points: routes.flatMap((r, i) => i === 0 ? r.points : r.points.slice(1)),
      distance: routes.reduce((sum, r) => sum + r.distance, 0),
      duration: routes.reduce((sum, r) => sum + r.duration, 0),
      legs: routes.length
    };
  }
  async function pinRoute({ network, path, apiKey, onProgress = () => {
  }, maxWaypoints = 9, maxRounds = 8 }) {
    var _a;
    const { proj } = network;
    const pathIndex = buildPathIndex(proj, path.points);
    const origin = path.points[0];
    const destination = path.points[path.points.length - 1];
    const waypoints = ((_a = path.stopIndices) != null ? _a : []).map((i) => ({
      s: pathIndex.cum[i],
      xy: pathIndex.xy[i],
      point: path.points[i],
      fixed: true
    }));
    const budget = waypoints.length + maxWaypoints;
    let original = null;
    let final = null;
    let rounds = 0;
    for (; ; ) {
      rounds++;
      onProgress(
        rounds === 1 ? "Asking Google for its route\u2026" : `Checking Google's route with ${waypoints.length} waypoint${waypoints.length === 1 ? "" : "s"} (round ${rounds})\u2026`
      );
      const googleRoute = await googleTrip(apiKey, origin, destination, waypoints.map((w) => w.point));
      const analysis = analyze(network, pathIndex, googleRoute.points);
      final = { route: googleRoute, analysis };
      if (!original) original = final;
      const bad = analysis.divergences.filter((d) => d.bad);
      if (!bad.length || rounds >= maxRounds || waypoints.length >= budget) break;
      bad.sort((a, b) => b.end - b.start - (a.end - a.start));
      let added = 0;
      for (const div of bad) {
        if (waypoints.length >= budget) break;
        const wp = chooseWaypoint(network, pathIndex, analysis.pts, div, waypoints);
        if (!wp) continue;
        waypoints.push({ ...wp, point: proj.inv(wp.xy) });
        added++;
      }
      if (!added) break;
      waypoints.sort((a, b) => a.s - b.s);
    }
    return { origin, destination, waypoints, original, final, rounds };
  }

  // moped-route/plan.js
  function bboxAround(points, buffer) {
    const lats = points.map((p) => p[0]);
    const lons = points.map((p) => p[1]);
    const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
    const dLat = buffer / 110574;
    const dLon = buffer / (111320 * Math.cos(lat0 * Math.PI / 180));
    return {
      s: Math.min(...lats) - dLat,
      n: Math.max(...lats) + dLat,
      w: Math.min(...lons) - dLon,
      e: Math.max(...lons) + dLon
    };
  }
  function spanOf(points) {
    const b = bboxAround(points, 0);
    return Math.max((b.n - b.s) * 110574, (b.e - b.w) * 75e3);
  }
  function currentPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Location isn't available on this device."));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve([pos.coords.latitude, pos.coords.longitude]),
        () => reject(new Error("Couldn't get your location. Allow location access, or share a route with a fixed start.")),
        { enableHighAccuracy: true, timeout: 15e3 }
      );
    });
  }
  async function locateStops(apiKey, stops, onProgress = () => {
  }) {
    const out = [];
    for (const stop of stops) {
      if (stop.point) out.push(stop);
      else if (stop.current) {
        onProgress("Getting your location\u2026");
        out.push({ ...stop, point: await currentPosition() });
      } else {
        onProgress(`Looking up "${stop.label}"\u2026`);
        out.push({ ...stop, point: await searchPlace(apiKey, stop.query) });
      }
    }
    return out;
  }
  async function checkRoute({ apiKey, stops, maxSpeed, onProgress = () => {
  } }) {
    var _a;
    onProgress("Getting Google's route\u2026");
    const google = await googleTrip(apiKey, stops[0], stops[stops.length - 1], stops.slice(1, -1));
    const ways = await loadRoads(bboxAround(google.points, 500), onProgress);
    onProgress("Checking speed limits along the route\u2026");
    const network = buildNetwork(ways, maxSpeed, stops[0][0]);
    const { stretches, length } = inspectRoute(network, google.points);
    const byLimit = {};
    for (const s of stretches) {
      const limit = Math.round(s.limit);
      byLimit[limit] = ((_a = byLimit[limit]) != null ? _a : 0) + s.length;
    }
    onProgress("Done.");
    return {
      route: google,
      stretches,
      byLimit,
      overLength: stretches.reduce((sum, s) => sum + s.length, 0),
      length
    };
  }
  async function planRoute({ apiKey, stops, maxSpeed, maxWaypoints, onProgress = () => {
  } }) {
    const ways = await loadRoads(bboxAround(stops, Math.max(2e3, 0.3 * spanOf(stops))), onProgress);
    onProgress(`Finding a route that avoids roads over ${maxSpeed} km/h\u2026`);
    const network = buildNetwork(ways, maxSpeed, stops[0][0]);
    const path = { points: [], edges: [], distance: 0, duration: 0, stopIndices: [] };
    for (let i = 0; i < stops.length - 1; i++) {
      const leg = route(network, stops[i], stops[i + 1]);
      if (!leg) {
        throw new Error(
          "No route found. A stop is only connected by roads a moped can't use (motorway, private road or forest track). Try a point on a nearby street."
        );
      }
      if (i > 0) path.stopIndices.push(path.points.length - 1);
      path.points.push(...i > 0 ? leg.points.slice(1) : leg.points);
      path.edges.push(...leg.edges);
      path.distance += leg.distance;
      path.duration += leg.duration;
    }
    path.overLimit = overLimitStretches(path.edges, maxSpeed);
    const over = path.overLimit.reduce((sum, s) => sum + s.length, 0);
    onProgress(
      `Route found (${(path.distance / 1e3).toFixed(1)} km` + (over > 0 ? `, ${Math.round(over)} m unavoidably over ${maxSpeed} km/h).` : ").")
    );
    const pinned = await pinRoute({ network, path, apiKey, onProgress, maxWaypoints });
    onProgress("Done.");
    const links = buildMapsLinks(pinned.origin, pinned.destination, pinned.waypoints.map((w) => w.point));
    return { path, ...pinned, links };
  }

  // moped-route/share.js
  var COORD_RE = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*\+?\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
  var SHORT_HOSTS = /* @__PURE__ */ new Set(["maps.app.goo.gl", "goo.gl"]);
  var CURRENT_LOCATION = /* @__PURE__ */ new Set([
    "",
    "my location",
    "your location",
    "current location",
    "mein standort",
    "ihr standort",
    "aktueller standort",
    "ma position",
    "votre position",
    "la mia posizione",
    "la tua posizione",
    "moja lokacija",
    "va\u0161a lokacija",
    "trenutna lokacija"
  ]);
  var TRAVEL_MODES = { 0: "driving", 1: "bicycling", 2: "walking", 3: "transit", 9: "two-wheeler" };
  function extractUrl(text) {
    var _a, _b, _c;
    const urls = (_a = String(text != null ? text : "").match(/https?:\/\/[^\s<>"']+/g)) != null ? _a : [];
    return (_c = (_b = urls.find((u) => /google\.[a-z.]+\/maps|maps\.google\.|goo\.gl/.test(u))) != null ? _b : urls[0]) != null ? _c : null;
  }
  function isShortLink(url) {
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
  function toStop(text) {
    const t = (text != null ? text : "").trim();
    const m = t.match(COORD_RE);
    if (m) return { label: `${m[1]}, ${m[2]}`, point: [parseFloat(m[1]), parseFloat(m[2])] };
    if (CURRENT_LOCATION.has(t.toLowerCase())) return { label: "My location", current: true };
    return { label: t, query: t };
  }
  function travelMode(data) {
    var _a;
    const m = data.match(/!3e(\d+)/);
    return m ? (_a = TRAVEL_MODES[m[1]]) != null ? _a : "other" : null;
  }
  function parseDirPath(url) {
    const parts = url.pathname.split("/").slice(3);
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
    while (segs.length > 2 && segs[segs.length - 1] === "") segs.pop();
    const stops = segs.map(toStop);
    const coords = [...data.matchAll(/!1d(-?\d+\.\d+)!2d(-?\d+\.\d+)/g)].map((m) => [parseFloat(m[2]), parseFloat(m[1])]);
    let next = 0;
    for (const stop of stops) {
      if (stop.query && next < coords.length) stop.point = coords[next++];
    }
    return { stops, travelMode: travelMode(data) };
  }
  function parseMapsUrl(input) {
    var _a, _b, _c, _d, _e;
    let url;
    try {
      url = new URL(input);
    } catch {
      return null;
    }
    const q = url.searchParams;
    const path = url.pathname;
    if (q.get("api") === "1" || path.startsWith("/maps/dir") && q.has("destination")) {
      if (!q.has("destination")) return null;
      const stops = [
        q.has("origin") ? toStop(q.get("origin")) : toStop(""),
        ...((_a = q.get("waypoints")) != null ? _a : "").split("|").filter(Boolean).map(toStop),
        toStop(q.get("destination"))
      ];
      return { stops, travelMode: q.get("travelmode") };
    }
    if (path.startsWith("/maps/dir/")) {
      const parsed = parseDirPath(url);
      return parsed.stops.length >= 2 ? parsed : null;
    }
    if (q.has("daddr")) {
      const dests = q.get("daddr").split(/\s+to:/).map(toStop);
      return { stops: [toStop((_b = q.get("saddr")) != null ? _b : ""), ...dests], travelMode: null };
    }
    let dest = null;
    if (path.startsWith("/maps/place/")) {
      const name = decodeSegment((_c = path.split("/")[3]) != null ? _c : "");
      const m = (_d = path.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/)) != null ? _d : path.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
      dest = { label: name || "Shared place", query: name || void 0 };
      if (m) dest.point = [parseFloat(m[1]), parseFloat(m[2])];
    } else if (path.startsWith("/maps/search/")) {
      dest = toStop(decodeSegment((_e = path.split("/")[3]) != null ? _e : ""));
    } else if (q.has("q")) {
      dest = toStop(q.get("q"));
    }
    if (!dest || !dest.point && !dest.query) return null;
    return { stops: [toStop(""), dest], travelMode: null };
  }
  async function resolveShortLink(url) {
    const res = await fetch(`/api/resolve-maps-link?url=${encodeURIComponent(url)}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.url) {
      throw new Error(json.error || "Couldn't open that Google Maps link. Short links only work on the deployed site.");
    }
    return json.url;
  }
  async function readSharedRoute(text) {
    let url = extractUrl(text);
    if (!url) throw new Error("No Google Maps link found in what was shared.");
    if (isShortLink(url)) url = await resolveShortLink(url);
    const parsed = parseMapsUrl(url);
    if (!parsed) throw new Error("That link doesn't contain a route or a place.");
    return parsed;
  }

  // moped-route-app.jsx
  var { useState, useEffect, useRef, useMemo } = React;
  var KEYS = {
    apiKey: "moped-route:apiKey",
    maxSpeed: "moped-route:maxSpeed",
    maxWaypoints: "moped-route:maxWaypoints",
    mode: "moped-route:mode"
  };
  var MAX_WAYPOINTS_LIMIT = 30;
  var COORD_RE2 = /^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/;
  function useLocalStorage(key, fallback) {
    const [value, setValue] = useState(() => {
      try {
        const raw = localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    });
    useEffect(() => {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
      }
    }, [key, value]);
    return [value, setValue];
  }
  function newSessionToken() {
    var _a;
    if ((_a = window.crypto) == null ? void 0 : _a.randomUUID) return crypto.randomUUID();
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  var km = (m) => `${(m / 1e3).toFixed(1)} km`;
  var minutes = (s) => `${Math.round(s / 60)} min`;
  function PlaceInput({ label, value, onChange, apiKey, withMyLocation }) {
    var _a;
    const [text, setText] = useState((_a = value == null ? void 0 : value.label) != null ? _a : "");
    const [suggestions, setSuggestions] = useState([]);
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const session = useRef(newSessionToken());
    const lastQuery = useRef("");
    const typing = useRef(false);
    useEffect(() => {
      if (value) setText(value.label);
      else if (!typing.current) setText("");
      typing.current = false;
    }, [value]);
    useEffect(() => {
      const q = text.trim();
      if (!apiKey || q.length < 3 || q === (value == null ? void 0 : value.label) || COORD_RE2.test(q)) {
        setSuggestions([]);
        return;
      }
      const timer = setTimeout(async () => {
        lastQuery.current = q;
        try {
          const results = await autocomplete(apiKey, q, session.current);
          if (lastQuery.current === q) setSuggestions(results);
        } catch {
          setSuggestions([]);
        }
      }, 250);
      return () => clearTimeout(timer);
    }, [text, apiKey]);
    const pick = async (s) => {
      setOpen(false);
      setText(s.label);
      setBusy(true);
      try {
        const point = await placeLocation(apiKey, s.placeId, session.current);
        onChange({ label: s.main, point });
      } catch (err) {
        console.error(err);
        onChange(null);
      } finally {
        session.current = newSessionToken();
        setBusy(false);
      }
    };
    const onInput = (e) => {
      const t = e.target.value;
      typing.current = true;
      setText(t);
      setOpen(true);
      const m = t.match(COORD_RE2);
      onChange(m ? { label: t, point: [parseFloat(m[1]), parseFloat(m[2])] } : null);
    };
    const myLocation = () => {
      setBusy(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setBusy(false);
          onChange({ label: "My location", point: [pos.coords.latitude, pos.coords.longitude] });
        },
        () => setBusy(false),
        { enableHighAccuracy: true, timeout: 15e3 }
      );
    };
    return /* @__PURE__ */ React.createElement("div", { className: "place" }, /* @__PURE__ */ React.createElement("label", { className: "field-label" }, label), /* @__PURE__ */ React.createElement("div", { className: "place-row" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        className: "input",
        value: text,
        onChange: onInput,
        onFocus: () => setOpen(true),
        onBlur: () => setTimeout(() => setOpen(false), 150),
        placeholder: "Search a place or paste lat,lng",
        autoComplete: "off"
      }
    ), withMyLocation && navigator.geolocation && /* @__PURE__ */ React.createElement("button", { type: "button", className: "icon-btn", onClick: myLocation, title: "Use my location", "aria-label": "Use my location" }, "\u25CE")), busy && /* @__PURE__ */ React.createElement("div", { className: "hint" }, "Locating\u2026"), open && suggestions.length > 0 && /* @__PURE__ */ React.createElement("ul", { className: "suggestions" }, suggestions.map((s) => /* @__PURE__ */ React.createElement("li", { key: s.placeId }, /* @__PURE__ */ React.createElement("button", { type: "button", onMouseDown: (e) => e.preventDefault(), onClick: () => pick(s) }, /* @__PURE__ */ React.createElement("span", { className: "s-main" }, s.main), /* @__PURE__ */ React.createElement("span", { className: "s-sec" }, s.secondary))))));
  }
  function RouteMap({ lines, markers }) {
    const el = useRef(null);
    useEffect(() => {
      const L = window.L;
      if (!L || !el.current) return;
      const map = L.map(el.current, { zoomControl: true, attributionControl: true });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "\xA9 OpenStreetMap contributors"
      }).addTo(map);
      const css = getComputedStyle(document.documentElement);
      const color = (name) => css.getPropertyValue(name).trim();
      const LINE_STYLES = {
        osm: { color: color("--route-osm"), weight: 8, opacity: 0.45 },
        google: { color: color("--route-google"), weight: 3.5, opacity: 0.95 },
        bad: { color: color("--bad"), weight: 7, opacity: 0.9 }
      };
      const MARKER_FILLS = { start: "#16a34a", end: "#111", stop: "#6b21a8", waypoint: color("--accent") };
      const bounds = L.latLngBounds([]);
      for (const line of lines) {
        if (line.points.length < 2) continue;
        const pl = L.polyline(line.points, LINE_STYLES[line.kind]).addTo(map);
        if (line.tooltip) pl.bindTooltip(line.tooltip);
        if (line.kind !== "bad") bounds.extend(pl.getBounds());
      }
      for (const m of markers) {
        const big = m.kind !== "waypoint";
        const marker = L.circleMarker(m.point, {
          radius: big ? 8 : 7,
          color: "#fff",
          weight: big ? 3 : 2,
          fillColor: MARKER_FILLS[m.kind],
          fillOpacity: 1
        }).addTo(map);
        if (m.tooltip) marker.bindTooltip(m.tooltip);
      }
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24] });
      return () => map.remove();
    }, [lines, markers]);
    return /* @__PURE__ */ React.createElement("div", { ref: el, className: "map" });
  }
  function Legend({ items }) {
    const swatches = {
      osm: /* @__PURE__ */ React.createElement("i", { style: { background: "var(--route-osm)", opacity: 0.5 } }),
      google: /* @__PURE__ */ React.createElement("i", { style: { background: "var(--route-google)" } }),
      bad: /* @__PURE__ */ React.createElement("i", { style: { background: "var(--bad)" } }),
      waypoint: /* @__PURE__ */ React.createElement("i", { className: "dot", style: { background: "var(--accent)" } }),
      stop: /* @__PURE__ */ React.createElement("i", { className: "dot", style: { background: "#6b21a8" } })
    };
    return /* @__PURE__ */ React.createElement("div", { className: "legend" }, items.map(([kind, label]) => /* @__PURE__ */ React.createElement("span", { key: kind }, swatches[kind], " ", label)));
  }
  function stopMarkers(stops) {
    return stops.map((s, i) => ({
      point: s.point,
      kind: i === 0 ? "start" : i === stops.length - 1 ? "end" : "stop",
      tooltip: s.label
    }));
  }
  function Stretches({ stretches }) {
    return /* @__PURE__ */ React.createElement("ul", { className: "stretches" }, stretches.map((s, i) => /* @__PURE__ */ React.createElement("li", { key: i }, /* @__PURE__ */ React.createElement("span", { className: "limit" }, Math.round(s.limit)), /* @__PURE__ */ React.createElement("span", null, s.name, s.assumed && /* @__PURE__ */ React.createElement("span", { className: "assumed", title: "No limit tagged in OpenStreetMap; assumed from the road type" }, " ", "(assumed)")), /* @__PURE__ */ React.createElement("span", { className: "muted" }, Math.round(s.length), " m"))));
  }
  function LinkButtons({ link, label }) {
    const [copied, setCopied] = useState(false);
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        window.prompt("Copy this link", link);
      }
    };
    return /* @__PURE__ */ React.createElement("div", { className: "actions" }, /* @__PURE__ */ React.createElement("a", { className: "btn primary", href: link, target: "_blank", rel: "noopener" }, label), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn", onClick: copy }, copied ? "Copied" : "Copy link"));
  }
  function tripLabel(stops) {
    const middle = stops.length - 2;
    return `${stops[0].label} \u2192 ${stops[stops.length - 1].label}` + (middle > 0 ? ` (${middle} stop${middle === 1 ? "" : "s"})` : "");
  }
  function CheckResult({ checked, maxSpeed, onOptimize, busy }) {
    const { stops, check, travelMode: travelMode2 } = checked;
    const { route: route2, stretches, byLimit, overLength } = check;
    const share = route2.distance > 0 ? Math.round(overLength / route2.distance * 100) : 0;
    const lines = useMemo(
      () => [
        { points: route2.points, kind: "google" },
        ...stretches.map((s) => ({ points: s.points, kind: "bad", tooltip: `${s.name}: ${Math.round(s.limit)} km/h` }))
      ],
      [check]
    );
    const markers = useMemo(() => stopMarkers(stops), [stops]);
    return /* @__PURE__ */ React.createElement("section", { className: "card result" }, /* @__PURE__ */ React.createElement("p", { className: "trip-label" }, tripLabel(stops)), travelMode2 && travelMode2 !== "driving" && /* @__PURE__ */ React.createElement("p", { className: "muted small" }, "The shared route was for ", travelMode2, "; it was checked as a driving route."), stretches.length === 0 ? /* @__PURE__ */ React.createElement("p", { className: "status ok" }, "Google's route stays on roads up to ", maxSpeed, " km/h.") : /* @__PURE__ */ React.createElement("div", { className: "status warn" }, /* @__PURE__ */ React.createElement("p", null, km(overLength), " of this ", km(route2.distance), " route (", share, "%) is on roads over ", maxSpeed, " km/h."), /* @__PURE__ */ React.createElement("div", { className: "chips" }, Object.entries(byLimit).sort((a, b) => a[0] - b[0]).map(([limit, length]) => /* @__PURE__ */ React.createElement("span", { key: limit, className: "chip" }, /* @__PURE__ */ React.createElement("b", null, limit), " ", km(length))))), stretches.length > 0 && /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn primary", disabled: busy, onClick: onOptimize }, busy ? "Working\u2026" : "Avoid fast roads"), /* @__PURE__ */ React.createElement("dl", { className: "stats two" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("dt", null, "Google route"), /* @__PURE__ */ React.createElement("dd", null, km(route2.distance), " \xB7 ", minutes(route2.duration))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("dt", null, "Fast sections"), /* @__PURE__ */ React.createElement("dd", null, stretches.length))), stretches.length > 0 && /* @__PURE__ */ React.createElement(Stretches, { stretches }), /* @__PURE__ */ React.createElement(RouteMap, { lines, markers }), /* @__PURE__ */ React.createElement(
      Legend,
      {
        items: [["google", "Google route"], ["bad", `Over ${maxSpeed} km/h`], ...stops.length > 2 ? [["stop", "Stop"]] : []]
      }
    ), /* @__PURE__ */ React.createElement("p", { className: "muted small" }, "This is Google's default driving route between the shared points, avoiding highways and tolls. If you picked an alternative route in Maps, it may differ."));
  }
  function Result({ result, stops, maxSpeed }) {
    const el = useRef(null);
    useEffect(() => {
      var _a;
      (_a = el.current) == null ? void 0 : _a.scrollIntoView({ behavior: "smooth", block: "start" });
    }, [result]);
    const { final, original, waypoints, path, links } = result;
    const strayed = final.analysis.badStretches.filter((s) => !s.planned);
    const planned = path.overLimit;
    const avoided = original.analysis.badStretches.filter((s) => !s.planned);
    const plannedLength = planned.reduce((sum, s) => sum + s.length, 0);
    const added = waypoints.filter((w) => !w.fixed);
    const unsafe = added.some((w) => w.unsafe);
    const waypointText = added.length ? ` using ${added.length} extra waypoint${added.length === 1 ? "" : "s"}.` : "; no extra waypoints needed.";
    const lines = useMemo(
      () => [
        { points: path.points, kind: "osm" },
        { points: final.route.points, kind: "google" },
        ...final.analysis.badStretches.map((s) => ({ points: s.points, kind: "bad", tooltip: `${s.name}: ${Math.round(s.limit)} km/h` }))
      ],
      [result]
    );
    const markers = useMemo(
      () => [
        ...added.map((w, i) => ({ point: w.point, kind: "waypoint", tooltip: `Waypoint ${i + 1}` })),
        ...stopMarkers(stops)
      ],
      [result, stops]
    );
    return /* @__PURE__ */ React.createElement("section", { className: "card result", ref: el }, strayed.length > 0 ? /* @__PURE__ */ React.createElement("div", { className: "status warn" }, /* @__PURE__ */ React.createElement("p", null, "Google still strays onto ", strayed.length, " fast stretch", strayed.length === 1 ? "" : "es", " that the planned route avoids:"), /* @__PURE__ */ React.createElement(Stretches, { stretches: strayed })) : planned.length > 0 ? /* @__PURE__ */ React.createElement("div", { className: "status note" }, /* @__PURE__ */ React.createElement("p", null, "Google follows the planned route", waypointText, " It has ", Math.round(plannedLength), " m over ", maxSpeed, " km/h where there's no reasonable way around:"), /* @__PURE__ */ React.createElement(Stretches, { stretches: planned })) : /* @__PURE__ */ React.createElement("p", { className: "status ok" }, "Google follows a route with no roads over ", maxSpeed, " km/h", waypointText), links.length === 1 ? /* @__PURE__ */ React.createElement(LinkButtons, { link: links[0], label: "Open in Google Maps" }) : /* @__PURE__ */ React.createElement("div", { className: "parts" }, /* @__PURE__ */ React.createElement("p", { className: "muted small" }, "More than 9 waypoints don't fit in one Google Maps link, so the trip is split into ", links.length, " parts. Each part ends where the next one starts: when Maps says you've arrived, open the next part."), links.map((link, i) => /* @__PURE__ */ React.createElement(LinkButtons, { key: i, link, label: `Part ${i + 1} of ${links.length}` }))), /* @__PURE__ */ React.createElement("dl", { className: "stats" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("dt", null, "New route"), /* @__PURE__ */ React.createElement("dd", null, km(final.route.distance), " \xB7 ", minutes(final.route.duration))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("dt", null, "Google's own"), /* @__PURE__ */ React.createElement("dd", null, km(original.route.distance), " \xB7 ", minutes(original.route.duration))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("dt", null, "Planned (OSM)"), /* @__PURE__ */ React.createElement("dd", null, km(path.distance), " \xB7 ", minutes(path.duration)))), avoided.length > 0 && /* @__PURE__ */ React.createElement("details", { className: "avoided" }, /* @__PURE__ */ React.createElement("summary", null, "Avoided ", avoided.length, " fast stretch", avoided.length === 1 ? "" : "es", " on Google's own route"), /* @__PURE__ */ React.createElement(Stretches, { stretches: avoided })), /* @__PURE__ */ React.createElement(RouteMap, { lines, markers }), /* @__PURE__ */ React.createElement(Legend, { items: [["osm", "Planned"], ["google", "Google route"], ["bad", "Over limit"], ["waypoint", "Waypoint"]] }), unsafe && /* @__PURE__ */ React.createElement("p", { className: "muted small" }, "Some waypoints sit close to a fast road, so Google might snap onto it. Check the route in Maps before you ride."), /* @__PURE__ */ React.createElement("p", { className: "muted small" }, "Google Maps shows waypoints as stops. Keep \u201CAvoid highways\u201D and \u201CAvoid tolls\u201D switched on in the Maps app's route options, because links can't carry those settings."));
  }
  function useInstallPrompt() {
    var _a, _b;
    const [prompt, setPrompt] = useState(null);
    const standalone = (_b = (_a = window.matchMedia) == null ? void 0 : _a.call(window, "(display-mode: standalone)").matches) != null ? _b : false;
    useEffect(() => {
      const onPrompt = (e) => {
        e.preventDefault();
        setPrompt(e);
      };
      const onInstalled = () => setPrompt(null);
      window.addEventListener("beforeinstallprompt", onPrompt);
      window.addEventListener("appinstalled", onInstalled);
      return () => {
        window.removeEventListener("beforeinstallprompt", onPrompt);
        window.removeEventListener("appinstalled", onInstalled);
      };
    }, []);
    const install = async () => {
      if (!prompt) return;
      prompt.prompt();
      await prompt.userChoice.catch(() => {
      });
      setPrompt(null);
    };
    return { canInstall: !!prompt, install, standalone };
  }
  function readShareParams() {
    const q = new URLSearchParams(location.search);
    const text = ["title", "text", "url"].map((k) => q.get(k)).filter(Boolean).join("\n");
    return text || null;
  }
  function App() {
    var _a, _b;
    const [apiKey, setApiKey] = useLocalStorage(KEYS.apiKey, "");
    const [maxSpeed, setMaxSpeed] = useLocalStorage(KEYS.maxSpeed, 50);
    const [maxWaypoints, setMaxWaypoints] = useLocalStorage(KEYS.maxWaypoints, 9);
    const [mode, setMode] = useLocalStorage(KEYS.mode, "check");
    const [shared] = useState(readShareParams);
    const [linkText, setLinkText] = useState(shared ? (_a = extractUrl(shared)) != null ? _a : shared : "");
    const [origin, setOrigin] = useState(null);
    const [destination, setDestination] = useState(null);
    const [running, setRunning] = useState(false);
    const [log, setLog] = useState([]);
    const [error, setError] = useState("");
    const [checked, setChecked] = useState(null);
    const [plan, setPlan] = useState(null);
    const [showSettings, setShowSettings] = useState(!apiKey);
    const autoRan = useRef(false);
    const { canInstall, install, standalone } = useInstallPrompt();
    const progress = (msg) => setLog(
      (l) => l.length && l[l.length - 1].startsWith("Loading roads") && msg.startsWith("Loading roads") ? [...l.slice(0, -1), msg] : [...l, msg]
    );
    const task = async (fn, { keepLog = false } = {}) => {
      setRunning(true);
      setError("");
      if (!keepLog) setLog([]);
      try {
        await fn();
      } catch (err) {
        console.error(err);
        setError(err.message || String(err));
      } finally {
        setRunning(false);
      }
    };
    const check = (text = linkText) => task(async () => {
      setChecked(null);
      setPlan(null);
      progress("Reading the link\u2026");
      const { stops, travelMode: travelMode2 } = await readSharedRoute(text);
      const located = await locateStops(apiKey, stops, progress);
      const result = await checkRoute({
        apiKey,
        stops: located.map((s) => s.point),
        maxSpeed: Number(maxSpeed),
        onProgress: progress
      });
      setChecked({ stops: located, travelMode: travelMode2, check: result });
    });
    const optimize = (stops, source) => task(
      async () => {
        setPlan(null);
        const result = await planRoute({
          apiKey,
          stops: stops.map((s) => s.point),
          maxSpeed: Number(maxSpeed),
          maxWaypoints: Math.max(0, Math.min(MAX_WAYPOINTS_LIMIT, Number(maxWaypoints) || 0)),
          onProgress: progress
        });
        setPlan({ stops, result, source });
      },
      { keepLog: true }
    );
    useEffect(() => {
      if (!shared || autoRan.current || !apiKey) return;
      autoRan.current = true;
      setMode("check");
      history.replaceState(null, "", location.pathname);
      check(shared);
    }, [shared, apiKey]);
    const paste = async () => {
      try {
        setLinkText(await navigator.clipboard.readText());
      } catch {
      }
    };
    const switchMode = (m) => {
      setMode(m);
      setError("");
      setLog([]);
    };
    const plannedTrip = origin && destination ? [origin, destination] : null;
    return /* @__PURE__ */ React.createElement("main", null, /* @__PURE__ */ React.createElement("header", { className: "header" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h1", null, "Moped Route"), /* @__PURE__ */ React.createElement("p", { className: "muted" }, "Check Google Maps routes for roads over ", maxSpeed, " km/h, and avoid them.")), /* @__PURE__ */ React.createElement("button", { type: "button", className: "icon-btn", onClick: () => setShowSettings((s) => !s), "aria-label": "Settings", title: "Settings" }, "\u2699")), canInstall && /* @__PURE__ */ React.createElement("section", { className: "card install" }, /* @__PURE__ */ React.createElement("p", null, "Install Moped Route to share routes to it straight from Google Maps."), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn primary", onClick: install }, "Install app")), showSettings && /* @__PURE__ */ React.createElement("section", { className: "card settings" }, /* @__PURE__ */ React.createElement("label", { className: "field-label", htmlFor: "apikey" }, "Google Maps API key"), /* @__PURE__ */ React.createElement(
      "input",
      {
        id: "apikey",
        className: "input",
        type: "password",
        value: apiKey,
        onChange: (e) => setApiKey(e.target.value.trim()),
        placeholder: "AIza\u2026",
        autoComplete: "off"
      }
    ), /* @__PURE__ */ React.createElement("p", { className: "hint" }, "Needs the Routes API and Places API (New) enabled. Restrict it to this site's address. It's saved only in this browser."), /* @__PURE__ */ React.createElement("label", { className: "field-label", htmlFor: "maxspeed" }, "Max speed (km/h)"), /* @__PURE__ */ React.createElement(
      "input",
      {
        id: "maxspeed",
        className: "input narrow",
        type: "number",
        min: "10",
        max: "120",
        step: "10",
        value: maxSpeed,
        onChange: (e) => setMaxSpeed(e.target.value === "" ? "" : Number(e.target.value))
      }
    ), /* @__PURE__ */ React.createElement("label", { className: "field-label", htmlFor: "maxwaypoints" }, "Max waypoints"), /* @__PURE__ */ React.createElement(
      "input",
      {
        id: "maxwaypoints",
        className: "input narrow",
        type: "number",
        min: "0",
        max: MAX_WAYPOINTS_LIMIT,
        step: "1",
        value: maxWaypoints,
        onChange: (e) => setMaxWaypoints(e.target.value === "" ? "" : Number(e.target.value))
      }
    ), /* @__PURE__ */ React.createElement("p", { className: "hint" }, "Up to ", MAX_WAYPOINTS_LIMIT, ". A Google Maps link holds 9 waypoints, so more than that splits the trip into several links you open one after another. The app only uses as many as it needs."), !standalone && !canInstall && /* @__PURE__ */ React.createElement("p", { className: "hint" }, "To share routes from Google Maps, install this app from Chrome: menu \u22EE \u2192 Install app (or Add to home screen \u2192 Install).")), /* @__PURE__ */ React.createElement("div", { className: "tabs", role: "tablist" }, /* @__PURE__ */ React.createElement("button", { type: "button", role: "tab", "aria-selected": mode === "check", onClick: () => switchMode("check") }, "Check a route"), /* @__PURE__ */ React.createElement("button", { type: "button", role: "tab", "aria-selected": mode === "plan", onClick: () => switchMode("plan") }, "Plan A \u2192 B")), mode === "check" ? /* @__PURE__ */ React.createElement("section", { className: "card trip" }, /* @__PURE__ */ React.createElement("label", { className: "field-label", htmlFor: "link" }, "Google Maps link"), /* @__PURE__ */ React.createElement("div", { className: "place-row" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        id: "link",
        className: "input",
        value: linkText,
        onChange: (e) => setLinkText(e.target.value),
        placeholder: "https://maps.app.goo.gl/\u2026",
        autoComplete: "off"
      }
    ), ((_b = navigator.clipboard) == null ? void 0 : _b.readText) && /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn", onClick: paste }, "Paste")), /* @__PURE__ */ React.createElement("p", { className: "hint" }, "In Google Maps, open directions and tap Share, then pick Moped Route. Or paste the link here."), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn primary wide", disabled: !apiKey || !linkText.trim() || running, onClick: () => check() }, running && !checked ? "Checking\u2026" : "Check route"), !apiKey && /* @__PURE__ */ React.createElement("p", { className: "hint" }, "Add your Google API key in settings first.")) : /* @__PURE__ */ React.createElement("section", { className: "card trip" }, /* @__PURE__ */ React.createElement(PlaceInput, { label: "From", value: origin, onChange: setOrigin, apiKey, withMyLocation: true }), /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        className: "swap",
        onClick: () => {
          setOrigin(destination);
          setDestination(origin);
        },
        "aria-label": "Swap start and destination",
        title: "Swap"
      },
      "\u21C5"
    ), /* @__PURE__ */ React.createElement(PlaceInput, { label: "To", value: destination, onChange: setDestination, apiKey }), /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        className: "btn primary wide",
        disabled: !apiKey || !plannedTrip || !(maxSpeed > 0) || running,
        onClick: () => {
          setLog([]);
          optimize(plannedTrip, "plan");
        }
      },
      running ? "Planning\u2026" : "Plan route"
    ), !apiKey && /* @__PURE__ */ React.createElement("p", { className: "hint" }, "Add your Google API key in settings first.")), (log.length > 0 || error) && /* @__PURE__ */ React.createElement("section", { className: "card log" }, log.map((l, i) => /* @__PURE__ */ React.createElement("p", { key: i, className: i === log.length - 1 && running ? "current" : "muted" }, l)), error && /* @__PURE__ */ React.createElement("p", { className: "error" }, error)), mode === "check" && checked && /* @__PURE__ */ React.createElement(CheckResult, { checked, maxSpeed, busy: running, onOptimize: () => optimize(checked.stops, "check") }), plan && plan.source === mode && /* @__PURE__ */ React.createElement(Result, { result: plan.result, stops: plan.stops, maxSpeed }), /* @__PURE__ */ React.createElement("footer", { className: "muted small" }, "Speed limits from OpenStreetMap. Untagged roads use Swiss defaults (50 in town, 80 on untagged main roads). Faster roads are used only when the detour would be much longer, and 60 is preferred over 80."));
  }
  ReactDOM.createRoot(document.getElementById("app")).render(/* @__PURE__ */ React.createElement(App, null));
})();
