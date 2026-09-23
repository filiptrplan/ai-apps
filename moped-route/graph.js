// Builds the routing graph (every road a moped may use, with over-limit roads
// heavily penalised) and a spatial index over every way segment, which is also
// used to check Google's route against speed limits.
import { haversine, makeProjection, bearing, SegmentGrid } from "./geo.js";
import { effectiveLimit, hasTaggedLimit, isAllowed, isRoutable, onewayDir, overLimitFactor } from "./speed.js";

// Mild preference for proper streets over alleys and shared zones.
const COST_PENALTY = { service: 1.5, living_street: 1.3 };

export function buildNetwork(ways, maxSpeed, lat0) {
  const proj = makeProjection(lat0);
  const coords = new Map();
  const adj = new Map();
  const radj = new Map(); // reversed edges, to check what can reach a node
  const grid = new SegmentGrid(50);

  const addEdge = (from, to, edge) => {
    let list = adj.get(from);
    if (!list) adj.set(from, (list = []));
    list.push({ to, ...edge });
    let rlist = radj.get(to);
    if (!rlist) radj.set(to, (rlist = []));
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
    const penalty = (COST_PENALTY[way.tags.highway] ?? 1) * overLimitFactor(limit, maxSpeed);

    const xy = way.geometry.map(proj.fwd);
    for (let i = 0; i < way.nodes.length; i++) coords.set(way.nodes[i], way.geometry[i]);

    for (let i = 0; i < way.nodes.length - 1; i++) {
      const a = way.nodes[i];
      const b = way.nodes[i + 1];
      const len = haversine(way.geometry[i], way.geometry[i + 1]);
      grid.add({
        ax: xy[i][0], ay: xy[i][1], bx: xy[i + 1][0], by: xy[i + 1][1],
        bearing: bearing(xy[i], xy[i + 1]),
        way: info, a, b, len,
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
