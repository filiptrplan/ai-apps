// A* over the road graph from a point to a point. Both endpoints snap onto a
// nearby segment, entering or leaving it in the directions its oneway permits.
import { haversine } from "./geo.js";
import { overLimitFactor } from "./speed.js";

const SNAP_RADIUS = 300;
const PREFER_ALLOWED_RADIUS = 60;
// A snap point must connect to at least this many nodes; fewer means an
// isolated fragment (e.g. a service road reached only by driveways or tracks).
const MIN_COMPONENT = 200;
const START = "start";
const TARGET = "target";

class MinHeap {
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
      const parent = (i - 1) >> 1;
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
      for (;;) {
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
}

// How many nodes a breadth-first walk from node reaches (capped at
// MIN_COMPONENT), following edges forwards (out of a start) or backwards
// (into a target).
function reach(network, node, backwards) {
  const seen = new Set([node]);
  const queue = [node];
  while (queue.length && seen.size < MIN_COMPONENT) {
    const n = queue.shift();
    const next = backwards
      ? network.radj.get(n) ?? []
      : (network.adj.get(n) ?? []).map((e) => e.to);
    for (const m of next) {
      if (!seen.has(m)) {
        seen.add(m);
        queue.push(m);
      }
    }
  }
  return seen.size;
}

// Where a lat/lon lands on the network: the segment, the snapped point and the
// fraction t along a -> b. A nearby slow road wins over a closer fast one, and
// isolated fragments are skipped in favour of the best-connected candidate.
// `asTarget` checks connectivity into the segment instead of out of it.
export function snap(network, point, asTarget = false) {
  const [x, y] = network.proj.fwd(point);
  const candidates = [
    ...network.grid.within(x, y, PREFER_ALLOWED_RADIUS, (seg) => seg.way.allowed),
    ...network.grid.within(x, y, SNAP_RADIUS, (seg) => seg.way.routable),
  ];
  const checked = new Set();
  let best = null;
  for (const hit of candidates) {
    const { seg } = hit;
    if (checked.has(seg)) continue;
    checked.add(seg);
    // The segment's endpoints that a start can leave by / a target be entered from.
    const ends = [];
    if (seg.way.dir >= 0) ends.push(asTarget ? seg.a : seg.b);
    if (seg.way.dir <= 0) ends.push(asTarget ? seg.b : seg.a);
    const size = Math.max(0, ...ends.map((n) => reach(network, n, asTarget)));
    if (!best || size > best.size) best = { hit, size };
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

// Over-limit parts of the route, grouped by road. Pieces of the same road
// split by a short gap (a junction, a slower link) count as one stretch.
const MERGE_GAP = 100;

export function overLimitStretches(edges, maxSpeed) {
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

export function route(network, from, to) {
  const { adj, coords, maxSpeed } = network;
  const s = snap(network, from);
  const e = snap(network, to, true);
  if (!s) throw new Error("No road a moped may use near the start.");
  if (!e) throw new Error("No road a moped may use near the destination.");

  // Virtual edges out of the start point and into the target point.
  const startEdges = [];
  if (s.seg.way.dir >= 0) startEdges.push({ to: s.seg.b, ...partialEdge(s.seg, 1 - s.t, maxSpeed) });
  if (s.seg.way.dir <= 0) startEdges.push({ to: s.seg.a, ...partialEdge(s.seg, s.t, maxSpeed) });
  const targetEdges = new Map();
  if (e.seg.way.dir >= 0) targetEdges.set(e.seg.a, { to: TARGET, ...partialEdge(e.seg, e.t, maxSpeed) });
  if (e.seg.way.dir <= 0) targetEdges.set(e.seg.b, { to: TARGET, ...partialEdge(e.seg, 1 - e.t, maxSpeed) });

  const vMax = maxSpeed / 3.6;
  const h = (node) => (node === TARGET ? 0 : haversine(coords.get(node), e.point) / vMax);
  const neighbours = (node) => {
    const list = node === START ? startEdges : adj.get(node) ?? [];
    const extra = targetEdges.get(node);
    return extra ? [...list, extra] : list;
  };

  const g = new Map([[START, 0]]);
  const came = new Map();
  const heap = new MinHeap();
  heap.push(0, START);
  const closed = new Set();

  while (heap.size) {
    const node = heap.pop();
    if (node === TARGET) break;
    if (closed.has(node)) continue;
    closed.add(node);
    const gNode = g.get(node);
    for (const edge of neighbours(node)) {
      const cand = gNode + edge.cost;
      if (cand < (g.get(edge.to) ?? Infinity)) {
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
  // Snapping exactly onto a node leaves a zero-length virtual edge; drop it so
  // it can't show up as a phantom road on the route.
  const realEdges = edges.reverse().filter((ed) => ed.len > 0.01);

  const points = [s.point];
  for (const n of nodes) if (n !== TARGET) points.push(coords.get(n));
  points.push(e.point);

  return {
    points,
    edges: realEdges,
    overLimit: overLimitStretches(realEdges, maxSpeed),
    distance: realEdges.reduce((sum, ed) => sum + ed.len, 0),
    duration: realEdges.reduce((sum, ed) => sum + ed.time, 0),
  };
}
