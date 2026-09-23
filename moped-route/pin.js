// Pins Google onto the OSM route: ask Google for a route, find where it strays
// from the OSM path onto roads that are too fast, drop a waypoint on the OSM
// path there, and repeat. Fast stretches the OSM path itself uses (because
// there was no reasonable way around) are reported as planned, not fixed.
import { SegmentGrid, densify, dist, angleDiff } from "./geo.js";
import { computeRoute } from "./google.js";
import { splitLegs } from "./link.js";

const STEP = 20; // metres between resampled Google route points
const OFF_DIST = 30; // a Google point this far from the OSM path has diverged
const MATCH_DIST = 15; // max distance when matching a Google point to an OSM way
const MATCH_ANGLE = 30; // max bearing difference for that match
const MIN_BAD_POINTS = 3; // shorter fast-road runs are treated as matching noise
const SAFE_DIST = 25; // waypoints keep this clear of disallowed roads
const WAYPOINT_SPACING = 80;

export function buildPathIndex(proj, points) {
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

// Point at distance s along the path.
export function pointAt(pathIndex, s) {
  const { xy, cum } = pathIndex;
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const segLen = cum[hi] - cum[lo];
  const t = segLen > 0 ? Math.min(1, Math.max(0, (s - cum[lo]) / segLen)) : 0;
  return [xy[lo][0] + t * (xy[hi][0] - xy[lo][0]), xy[lo][1] + t * (xy[hi][1] - xy[lo][1])];
}

// Runs of consecutive indices where pred holds, at least minCount long.
export function runs(items, pred, minCount) {
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
  const counts = new Map();
  let length = 0;
  for (let i = run.start; i <= run.end; i++) {
    const way = pts[i].way;
    if (way) counts.set(way, (counts.get(way) ?? 0) + 1);
    if (i > run.start) length += dist([pts[i - 1].x, pts[i - 1].y], [pts[i].x, pts[i].y]);
  }
  const way = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return {
    ...run,
    points: pts.slice(run.start, run.end + 1).map((p) => proj.inv([p.x, p.y])),
    name: way ? way.tags.name || way.tags.ref || way.tags.highway : "Unknown road",
    limit: way?.limit,
    assumed: way?.assumed ?? false,
    length,
    planned,
  };
}

// Resamples a Google route and matches each point to the OSM way it runs on.
// `bad` marks points on a road over the limit (or one a moped may not use).
export function matchPoints(network, googlePoints) {
  const pts = densify(googlePoints.map(network.proj.fwd), STEP);
  for (const p of pts) {
    const match = network.grid.nearest(p.x, p.y, MATCH_DIST, (seg) => angleDiff(seg.bearing, p.bearing, true) <= MATCH_ANGLE);
    p.way = match ? match.seg.way : null;
    p.bad = !!match && !match.seg.way.allowed;
  }
  return pts;
}

// Fast sections of a Google route on its own, without a planned route.
export function inspectRoute(network, googlePoints) {
  const pts = matchPoints(network, googlePoints);
  const stretches = runs(pts, (p) => p.bad, MIN_BAD_POINTS).map((r) => describeStretch(network.proj, pts, r, false));
  let length = 0;
  for (let i = 1; i < pts.length; i++) length += dist([pts[i - 1].x, pts[i - 1].y], [pts[i].x, pts[i].y]);
  return { stretches, length };
}

// Compares a Google route with the OSM path and the road network.
export function analyze(network, pathIndex, googlePoints) {
  const { proj } = network;
  const pts = matchPoints(network, googlePoints);
  for (const p of pts) {
    const onPath = pathIndex.grid.nearest(p.x, p.y, OFF_DIST);
    p.off = !onPath;
    p.s = onPath ? onPath.seg.s0 + onPath.t * onPath.seg.len : null;
  }

  // Planned: fast stretches on the OSM path itself, chosen as the least-bad
  // option. Strayed: Google left the path for a fast road; these get fixed.
  const strayed = runs(pts, (p) => p.bad && p.off, MIN_BAD_POINTS).map((r) => describeStretch(proj, pts, r, false));
  const planned = runs(pts, (p) => p.bad && !p.off, MIN_BAD_POINTS).map((r) => describeStretch(proj, pts, r, true));
  const badStretches = [...strayed, ...planned].sort((a, b) => a.start - b.start);
  const divergences = runs(pts, (p) => p.off, 2).map((d) => ({
    ...d,
    bad: strayed.some((b) => b.start <= d.end && b.end >= d.start),
  }));
  return { pts, badStretches, divergences };
}

// Picks the point on the OSM path that best forces Google off its detour: as
// far from the detour as possible, and not close enough to a fast road for
// Google to snap the waypoint onto it.
export function chooseWaypoint(network, pathIndex, pts, div, existing) {
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
  return best ?? bestUnsafe;
}

// Google's route for the whole trip, asked leg by leg exactly as the links
// will split it, joined into one polyline.
export async function googleTrip(apiKey, origin, destination, waypoints) {
  const legs = splitLegs(origin, destination, waypoints);
  const routes = await Promise.all(legs.map((leg) => computeRoute(apiKey, leg.from, leg.to, leg.via)));
  return {
    points: routes.flatMap((r, i) => (i === 0 ? r.points : r.points.slice(1))),
    distance: routes.reduce((sum, r) => sum + r.distance, 0),
    duration: routes.reduce((sum, r) => sum + r.duration, 0),
    legs: routes.length,
  };
}

// `path.stopIndices` are points on the path that must stay waypoints (stops
// from a shared route); they come on top of maxWaypoints.
export async function pinRoute({ network, path, apiKey, onProgress = () => {}, maxWaypoints = 9, maxRounds = 8 }) {
  const { proj } = network;
  const pathIndex = buildPathIndex(proj, path.points);
  const origin = path.points[0];
  const destination = path.points[path.points.length - 1];
  const waypoints = (path.stopIndices ?? []).map((i) => ({
    s: pathIndex.cum[i],
    xy: pathIndex.xy[i],
    point: path.points[i],
    fixed: true,
  }));
  const budget = waypoints.length + maxWaypoints;
  let original = null;
  let final = null;
  let rounds = 0;

  for (;;) {
    rounds++;
    onProgress(
      rounds === 1
        ? "Asking Google for its route…"
        : `Checking Google's route with ${waypoints.length} waypoint${waypoints.length === 1 ? "" : "s"} (round ${rounds})…`
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
