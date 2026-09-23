// Speed limits from OSM tags, falling back to Swiss defaults when untagged.

const CH_ZONES = {
  "CH:urban": 50,
  "CH:rural": 80,
  "CH:trunk": 100,
  "CH:motorway": 120,
  "CH:zone30": 30,
  "CH:zone20": 20,
};

// Swiss defaults by road type for ways with no usable limit tag. Major roads
// are assumed to be rural (80) because untagged ones usually are.
const HIGHWAY_DEFAULTS = {
  motorway: 120,
  motorway_link: 120,
  trunk: 100,
  trunk_link: 100,
  primary: 80,
  primary_link: 80,
  secondary: 80,
  secondary_link: 80,
  living_street: 20,
};

const BLOCKED_ACCESS = new Set(["no", "private", "agricultural", "forestry", "delivery", "customers", "emergency"]);
const BLOCKED_SERVICE = new Set(["parking_aisle", "driveway", "drive-through", "emergency_access"]);

// Parses one maxspeed-style value to km/h, or null when it can't be read.
// Multi-values like "50;30" take the highest, which is the conservative choice.
export function parseSpeed(value) {
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

const LIMIT_KEYS = ["maxspeed", "maxspeed:forward", "maxspeed:backward", "maxspeed:type", "zone:maxspeed", "source:maxspeed"];

// Whether OSM states the limit, as opposed to it being assumed from road type.
export function hasTaggedLimit(tags) {
  return LIMIT_KEYS.some((k) => parseSpeed(tags[k]) != null);
}

export function effectiveLimit(tags) {
  const direct = [tags.maxspeed, tags["maxspeed:forward"], tags["maxspeed:backward"]]
    .map(parseSpeed)
    .filter((n) => n != null);
  if (direct.length) return Math.max(...direct);

  for (const key of ["maxspeed:type", "zone:maxspeed", "source:maxspeed"]) {
    const n = parseSpeed(tags[key]);
    if (n != null) return n;
  }

  if (tags.motorroad === "yes") return 100;
  return HIGHWAY_DEFAULTS[tags.highway] ?? 50;
}

// Roads a moped may use at all. Swiss law bars vehicles that can't do 60 km/h
// from motorways and motorroads (Autostrassen).
export function isRoutable(tags) {
  if (tags.highway === "motorway" || tags.highway === "motorway_link") return false;
  if (tags.motorroad === "yes") return false;
  const access = tags.moped ?? tags.motor_vehicle ?? tags.vehicle ?? tags.access;
  if (access && BLOCKED_ACCESS.has(access)) return false;
  if (tags.highway === "service" && BLOCKED_SERVICE.has(tags.service)) return false;
  return true;
}

export function isAllowed(tags, maxSpeed, limit = effectiveLimit(tags)) {
  return limit <= maxSpeed && isRoutable(tags);
}

// Cost multiplier for riding a road whose limit is above the max speed: a
// 60 road counts 4x its length, 70 counts 7x, 80 counts 10x, so the route
// takes real detours to avoid them and prefers the least-fast ones it can't.
export function overLimitFactor(limit, maxSpeed) {
  return limit > maxSpeed ? 1 + 0.3 * (limit - maxSpeed) : 1;
}

// 1 = forward only, -1 = backward only, 0 = both directions.
export function onewayDir(tags) {
  const ow = tags.oneway;
  if (ow === "yes" || ow === "true" || ow === "1") return 1;
  if (ow === "-1" || ow === "reverse") return -1;
  if (ow === "no") return 0;
  if (tags.junction === "roundabout" || tags.junction === "circular") return 1;
  if (tags.highway === "motorway") return 1;
  return 0;
}
