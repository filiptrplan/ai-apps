// Google Maps URLs (api=1). A link holds at most 9 waypoints, so longer
// waypoint lists are split into consecutive links: each link ends at the
// waypoint the next one starts from. Avoid options can't be passed, so the
// Maps app's own saved route options apply.
export const WAYPOINTS_PER_LINK = 9;

const fmt = ([lat, lon]) => `${lat.toFixed(6)},${lon.toFixed(6)}`;

// Splits a trip into legs of { from, via, to }, each with at most
// WAYPOINTS_PER_LINK via points. Every leg after the first uses up one
// waypoint as its start.
export function splitLegs(origin, destination, waypoints) {
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

export function buildMapsLink(origin, destination, waypoints = []) {
  const params = new URLSearchParams({
    api: "1",
    origin: fmt(origin),
    destination: fmt(destination),
    travelmode: "driving",
  });
  if (waypoints.length) params.set("waypoints", waypoints.map(fmt).join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function buildMapsLinks(origin, destination, waypoints = []) {
  return splitLegs(origin, destination, waypoints).map((leg) => buildMapsLink(leg.from, leg.to, leg.via));
}
