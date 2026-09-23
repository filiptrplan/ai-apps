// Geometry helpers. Points are [lat, lon]; planar work happens in a local
// equirectangular projection in metres, which is accurate enough at city scale.

const EARTH_RADIUS = 6371008.8;
const RAD = Math.PI / 180;

export function haversine(a, b) {
  const dLat = (b[0] - a[0]) * RAD;
  const dLon = (b[1] - a[1]) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(h));
}

export function makeProjection(lat0) {
  const ky = 110574;
  const kx = 111320 * Math.cos(lat0 * RAD);
  return {
    fwd: (p) => [p[1] * kx, p[0] * ky],
    inv: (xy) => [xy[1] / ky, xy[0] / kx],
  };
}

export function dist(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

// Closest point on segment ab to p (all [x, y]); t is the 0..1 position along ab.
export function projectOnSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const x = a[0] + t * dx;
  const y = a[1] + t * dy;
  return { t, x, y, d: Math.hypot(p[0] - x, p[1] - y) };
}

// Compass bearing in degrees (0 = north) from a to b in projected space.
export function bearing(a, b) {
  const deg = Math.atan2(b[0] - a[0], b[1] - a[1]) / RAD;
  return (deg + 360) % 360;
}

// Smallest angle between two bearings; undirected ignores travel direction.
export function angleDiff(a, b, undirected = false) {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  if (undirected && d > 90) d = 180 - d;
  return d;
}

// Resample a projected polyline so consecutive points are at most `step` metres
// apart. Each output point carries the bearing of the segment it came from.
export function densify(xy, step) {
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

// Uniform grid of line segments for nearest-segment lookups. Each segment is an
// object with ax, ay, bx, by (projected metres) plus whatever the caller attaches.
export class SegmentGrid {
  constructor(cell = 50) {
    this.cell = cell;
    this.cells = new Map();
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
        if (!bucket) this.cells.set(k, (bucket = []));
        bucket.push(seg);
      }
    }
  }

  // Nearest segment within maxDist of (x, y) that passes filter, or null.
  nearest(x, y, maxDist, filter) {
    return this.within(x, y, maxDist, filter)[0] ?? null;
  }

  // Every segment within maxDist of (x, y) that passes filter, nearest first.
  within(x, y, maxDist, filter) {
    const c = this.cell;
    const r = Math.ceil(maxDist / c);
    const cx = Math.floor(x / c);
    const cy = Math.floor(y / c);
    const hits = [];
    const seen = new Set();
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
}
