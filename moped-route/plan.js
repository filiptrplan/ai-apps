// End-to-end pipelines:
// - checkRoute: Google's route -> OSM roads -> which sections are too fast.
// - planRoute: OSM roads -> route avoiding fast roads -> pinned Google route -> links.
// Both take `stops`: [start, ...intermediate stops, destination] as [lat, lon].
import { loadRoads } from "./osm.js";
import { buildNetwork } from "./graph.js";
import { route, overLimitStretches } from "./astar.js";
import { pinRoute, googleTrip, inspectRoute } from "./pin.js";
import { buildMapsLinks } from "./link.js";
import { searchPlace } from "./google.js";

function bboxAround(points, buffer) {
  const lats = points.map((p) => p[0]);
  const lons = points.map((p) => p[1]);
  const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
  const dLat = buffer / 110574;
  const dLon = buffer / (111320 * Math.cos((lat0 * Math.PI) / 180));
  return {
    s: Math.min(...lats) - dLat,
    n: Math.max(...lats) + dLat,
    w: Math.min(...lons) - dLon,
    e: Math.max(...lons) + dLon,
  };
}

// Rough size of the area the points cover, in metres.
function spanOf(points) {
  const b = bboxAround(points, 0);
  return Math.max((b.n - b.s) * 110574, (b.e - b.w) * 75000);
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
      { enableHighAccuracy: true, timeout: 15000 }
    );
  });
}

// Fills in coordinates for stops that are "my location" or only a name.
export async function locateStops(apiKey, stops, onProgress = () => {}) {
  const out = [];
  for (const stop of stops) {
    if (stop.point) out.push(stop);
    else if (stop.current) {
      onProgress("Getting your location…");
      out.push({ ...stop, point: await currentPosition() });
    } else {
      onProgress(`Looking up "${stop.label}"…`);
      out.push({ ...stop, point: await searchPlace(apiKey, stop.query) });
    }
  }
  return out;
}

export async function checkRoute({ apiKey, stops, maxSpeed, onProgress = () => {} }) {
  onProgress("Getting Google's route…");
  const google = await googleTrip(apiKey, stops[0], stops[stops.length - 1], stops.slice(1, -1));
  const ways = await loadRoads(bboxAround(google.points, 500), onProgress);
  onProgress("Checking speed limits along the route…");
  const network = buildNetwork(ways, maxSpeed, stops[0][0]);
  const { stretches, length } = inspectRoute(network, google.points);
  const byLimit = {};
  for (const s of stretches) {
    const limit = Math.round(s.limit);
    byLimit[limit] = (byLimit[limit] ?? 0) + s.length;
  }
  onProgress("Done.");
  return {
    route: google,
    stretches,
    byLimit,
    overLength: stretches.reduce((sum, s) => sum + s.length, 0),
    length,
  };
}

export async function planRoute({ apiKey, stops, maxSpeed, maxWaypoints, onProgress = () => {} }) {
  const ways = await loadRoads(bboxAround(stops, Math.max(2000, 0.3 * spanOf(stops))), onProgress);

  onProgress(`Finding a route that avoids roads over ${maxSpeed} km/h…`);
  const network = buildNetwork(ways, maxSpeed, stops[0][0]);

  // Route stop to stop, remembering where each intermediate stop lands.
  const path = { points: [], edges: [], distance: 0, duration: 0, stopIndices: [] };
  for (let i = 0; i < stops.length - 1; i++) {
    const leg = route(network, stops[i], stops[i + 1]);
    if (!leg) {
      throw new Error(
        "No route found. A stop is only connected by roads a moped can't use (motorway, private road or forest track). Try a point on a nearby street."
      );
    }
    if (i > 0) path.stopIndices.push(path.points.length - 1);
    path.points.push(...(i > 0 ? leg.points.slice(1) : leg.points));
    path.edges.push(...leg.edges);
    path.distance += leg.distance;
    path.duration += leg.duration;
  }
  path.overLimit = overLimitStretches(path.edges, maxSpeed);

  const over = path.overLimit.reduce((sum, s) => sum + s.length, 0);
  onProgress(
    `Route found (${(path.distance / 1000).toFixed(1)} km` +
      (over > 0 ? `, ${Math.round(over)} m unavoidably over ${maxSpeed} km/h).` : ").")
  );

  const pinned = await pinRoute({ network, path, apiKey, onProgress, maxWaypoints });
  onProgress("Done.");
  const links = buildMapsLinks(pinned.origin, pinned.destination, pinned.waypoints.map((w) => w.point));
  return { path, ...pinned, links };
}
