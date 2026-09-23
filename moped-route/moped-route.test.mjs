import { test } from "node:test";
import assert from "node:assert/strict";
import { decodePolyline } from "./polyline.js";
import { parseSpeed, effectiveLimit, isAllowed, isRoutable, onewayDir, overLimitFactor } from "./speed.js";
import { buildNetwork } from "./graph.js";
import { route } from "./astar.js";
import { analyze, buildPathIndex, runs, chooseWaypoint } from "./pin.js";
import { buildMapsLink, buildMapsLinks, splitLegs } from "./link.js";

test("decodes Google polylines", () => {
  // Example from Google's polyline algorithm docs.
  assert.deepEqual(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@"), [
    [38.5, -120.2],
    [40.7, -120.95],
    [43.252, -126.453],
  ]);
});

test("parses speed values", () => {
  assert.equal(parseSpeed("50"), 50);
  assert.equal(parseSpeed("CH:urban"), 50);
  assert.equal(parseSpeed("CH:rural"), 80);
  assert.equal(parseSpeed("50;30"), 50);
  assert.equal(parseSpeed("walk"), 6);
  assert.equal(parseSpeed("signals"), null);
  assert.equal(parseSpeed(undefined), null);
});

test("infers limits with Swiss defaults", () => {
  assert.equal(effectiveLimit({ highway: "primary", maxspeed: "60" }), 60);
  assert.equal(effectiveLimit({ highway: "primary", "maxspeed:forward": "50", "maxspeed:backward": "60" }), 60);
  assert.equal(effectiveLimit({ highway: "primary", "maxspeed:type": "CH:urban" }), 50);
  assert.equal(effectiveLimit({ highway: "residential", "zone:maxspeed": "CH:zone30" }), 30);
  assert.equal(effectiveLimit({ highway: "primary" }), 80);
  assert.equal(effectiveLimit({ highway: "tertiary" }), 50);
  assert.equal(effectiveLimit({ highway: "trunk" }), 100);
  assert.equal(effectiveLimit({ highway: "residential", motorroad: "yes" }), 100);
});

test("allows only slow, accessible roads", () => {
  assert.equal(isAllowed({ highway: "residential" }, 50), true);
  assert.equal(isAllowed({ highway: "primary", maxspeed: "60" }, 50), false);
  assert.equal(isAllowed({ highway: "primary", maxspeed: "60" }, 60), true);
  assert.equal(isAllowed({ highway: "tertiary", motorroad: "yes", maxspeed: "50" }, 50), false);
  assert.equal(isAllowed({ highway: "residential", access: "private" }, 50), false);
  assert.equal(isAllowed({ highway: "residential", access: "no", moped: "yes" }, 50), true);
  assert.equal(isAllowed({ highway: "service", service: "parking_aisle" }, 50), false);
});

test("never routes on motorways or motorroads, only penalises fast roads", () => {
  assert.equal(isRoutable({ highway: "motorway" }), false);
  assert.equal(isRoutable({ highway: "trunk", motorroad: "yes" }), false);
  assert.equal(isRoutable({ highway: "primary", maxspeed: "80" }), true);
  assert.equal(overLimitFactor(50, 50), 1);
  assert.ok(overLimitFactor(60, 50) < overLimitFactor(80, 50));
});

test("reads oneway direction", () => {
  assert.equal(onewayDir({ oneway: "yes" }), 1);
  assert.equal(onewayDir({ oneway: "-1" }), -1);
  assert.equal(onewayDir({ junction: "roundabout" }), 1);
  assert.equal(onewayDir({ junction: "roundabout", oneway: "no" }), 0);
  assert.equal(onewayDir({}), 0);
});

// A small square grid: a fast road along the bottom (A-B-C), a slow detour over
// the top (A-D-E-C), and a oneway slow shortcut (B-E) pointing the wrong way.
const DLAT = 0.0045; // ~500 m
const DLON = 0.0066; // ~500 m at 47.37
const P = {
  1: [47.37, 8.5],
  2: [47.37, 8.5 + DLON],
  3: [47.37, 8.5 + 2 * DLON],
  4: [47.37 + DLAT, 8.5],
  5: [47.37 + DLAT, 8.5 + 2 * DLON],
};
const way = (id, nodes, tags) => ({ id, nodes, geometry: nodes.map((n) => P[n]), tags: { highway: "residential", ...tags } });
const WAYS = [
  way(1, [1, 2, 3], { highway: "primary", maxspeed: "70", name: "Fast Road" }),
  way(2, [1, 4], {}),
  way(3, [4, 5], {}),
  way(4, [5, 3], {}),
  way(5, [2, 5], { oneway: "-1" }),
];

test("A* avoids fast roads and respects oneways", () => {
  const net = buildNetwork(WAYS, 50, 47.37);
  const r = route(net, P[1], P[3]);
  assert.ok(r);
  assert.ok(r.edges.every((e) => e.way.allowed));
  assert.deepEqual(r.edges.map((e) => e.way.id), [2, 3, 4]);

  const fast = route(buildNetwork(WAYS, 80, 47.37), P[1], P[3]);
  assert.deepEqual([...new Set(fast.edges.map((e) => e.way.id))], [1]);
});

test("A* returns null when no usable road connects", () => {
  const net = buildNetwork([WAYS[0], way(9, [4, 5], { oneway: "yes" })], 50, 47.37);
  assert.equal(route(net, P[5], P[4]), null);
});

test("A* falls back to fast roads when there is no slow way round", () => {
  const net = buildNetwork([WAYS[0]], 50, 47.37);
  const r = route(net, P[1], P[3]);
  assert.ok(r);
  assert.equal(r.overLimit.length, 1);
  assert.equal(r.overLimit[0].name, "Fast Road");
  assert.equal(r.overLimit[0].limit, 70);
  assert.ok(Math.abs(r.overLimit[0].length - 1000) < 20);
});

test("A* prefers a 60 road over an equally long 80 road", () => {
  const ways = [
    way(1, [1, 2, 3], { highway: "primary", maxspeed: "80" }),
    way(2, [1, 4], { highway: "primary", maxspeed: "60" }),
    way(3, [4, 5], { highway: "primary", maxspeed: "60" }),
    way(4, [5, 3], { highway: "primary", maxspeed: "60" }),
  ];
  // The 60 detour is 1.5 km vs 1 km at 80: 1.5 * 4 < 1 * 10.
  const r = route(buildNetwork(ways, 50, 47.37), P[1], P[3]);
  assert.deepEqual([...new Set(r.edges.map((e) => e.way.id))], [2, 3, 4]);
});

test("finds bad divergences and places a safe waypoint on the path", () => {
  const net = buildNetwork(WAYS, 50, 47.37);
  const path = route(net, P[1], P[3]);
  const pathIndex = buildPathIndex(net.proj, path.points);

  const onPath = analyze(net, pathIndex, path.points);
  assert.equal(onPath.badStretches.length, 0);
  assert.equal(onPath.divergences.length, 0);

  // Google's route straight along the fast road.
  const google = analyze(net, pathIndex, [P[1], P[2], P[3]]);
  assert.equal(google.badStretches.length, 1);
  assert.equal(google.badStretches[0].name, "Fast Road");
  assert.equal(google.badStretches[0].limit, 70);
  assert.equal(google.badStretches[0].planned, false);
  const bad = google.divergences.filter((d) => d.bad);
  assert.equal(bad.length, 1);

  const wp = chooseWaypoint(net, pathIndex, google.pts, bad[0], []);
  assert.ok(wp && !wp.unsafe);
  const [lat] = net.proj.inv(wp.xy);
  assert.ok(lat > 47.37 + DLAT * 0.9, "waypoint should sit on the northern detour");
});

test("fast stretches on the planned route are not treated as Google straying", () => {
  const net = buildNetwork([WAYS[0]], 50, 47.37);
  const path = route(net, P[1], P[3]);
  const pathIndex = buildPathIndex(net.proj, path.points);
  const google = analyze(net, pathIndex, [P[1], P[2], P[3]]);
  assert.equal(google.badStretches.length, 1);
  assert.equal(google.badStretches[0].planned, true);
  assert.equal(google.divergences.filter((d) => d.bad).length, 0);
});

test("runs() groups consecutive hits", () => {
  const xs = [0, 1, 1, 0, 1, 1, 1, 0];
  assert.deepEqual(runs(xs, Boolean, 1), [{ start: 1, end: 2 }, { start: 4, end: 6 }]);
  assert.deepEqual(runs(xs, Boolean, 3), [{ start: 4, end: 6 }]);
});

test("builds a Google Maps link", () => {
  const url = new URL(buildMapsLink([47.1, 8.1], [47.2, 8.2], [[47.15, 8.15], [47.16, 8.16]]));
  assert.equal(url.origin + url.pathname, "https://www.google.com/maps/dir/");
  assert.equal(url.searchParams.get("api"), "1");
  assert.equal(url.searchParams.get("origin"), "47.100000,8.100000");
  assert.equal(url.searchParams.get("waypoints"), "47.150000,8.150000|47.160000,8.160000");
  assert.equal(url.searchParams.get("travelmode"), "driving");
});

test("splits long waypoint lists into consecutive links of 9", () => {
  const wps = Array.from({ length: 30 }, (_, i) => [47 + i / 1000, 8]);
  const legs = splitLegs([46, 8], [48, 8], wps);
  assert.deepEqual(legs.map((l) => l.via.length), [9, 9, 9, 0]);
  // Each leg starts where the previous one ended, and every waypoint is visited.
  for (let i = 1; i < legs.length; i++) assert.deepEqual(legs[i].from, legs[i - 1].to);
  const visited = legs.flatMap((l, i) => (i === legs.length - 1 ? l.via : [...l.via, l.to]));
  assert.deepEqual(visited, wps);

  assert.equal(splitLegs([46, 8], [48, 8], wps.slice(0, 9)).length, 1);
  assert.equal(splitLegs([46, 8], [48, 8], wps.slice(0, 10)).length, 2);
  assert.equal(buildMapsLinks([46, 8], [48, 8], wps).length, 4);
});

import { parseMapsUrl, extractUrl, isShortLink } from "./share.js";

test("parses a directions link with a named place and coordinates", () => {
  const r = parseMapsUrl(
    "https://www.google.com/maps/dir/Kunsthaus+Z%C3%BCrich,+Heimplatz+1,+8001+Z%C3%BCrich/47.4111,8.5442/@47.39,8.54,13z/data=!3m1!4b1!4m9!4m8!1m5!1m1!1s0x47900a0cb:0x1!2m2!1d8.5482!2d47.3704!1m0!3e0?entry=ttu"
  );
  assert.equal(r.travelMode, "driving");
  assert.equal(r.stops.length, 2);
  assert.equal(r.stops[0].label, "Kunsthaus Zürich, Heimplatz 1, 8001 Zürich");
  assert.deepEqual(r.stops[0].point, [47.3704, 8.5482]);
  assert.deepEqual(r.stops[1].point, [47.4111, 8.5442]);
});

test("treats an empty or 'My location' start as the current location", () => {
  const a = parseMapsUrl("https://www.google.com/maps/dir//Hauptbahnhof+Z%C3%BCrich/@47.37,8.54,14z");
  assert.equal(a.stops[0].current, true);
  assert.equal(a.stops[1].query, "Hauptbahnhof Zürich");
  assert.equal(a.stops[1].point, undefined);
  const b = parseMapsUrl("https://www.google.com/maps/dir/Mein+Standort/47.4,8.5/");
  assert.equal(b.stops.length, 2);
  assert.equal(b.stops[0].current, true);
});

test("keeps intermediate stops in order", () => {
  const r = parseMapsUrl("https://www.google.com/maps/dir/47.1,8.1/47.2,8.2/47.3,8.3/47.4,8.4/");
  assert.deepEqual(r.stops.map((s) => s.point), [[47.1, 8.1], [47.2, 8.2], [47.3, 8.3], [47.4, 8.4]]);
});

test("parses api=1 and saddr/daddr links", () => {
  const a = parseMapsUrl("https://www.google.com/maps/dir/?api=1&origin=47.1,8.1&destination=Zoo+Z%C3%BCrich&waypoints=47.2,8.2|47.3,8.3");
  assert.deepEqual(a.stops.map((s) => s.point ?? s.query), [[47.1, 8.1], [47.2, 8.2], [47.3, 8.3], "Zoo Zürich"]);
  const b = parseMapsUrl("https://maps.google.com/?saddr=47.1,8.1&daddr=47.2,8.2+to:47.3,8.3");
  assert.deepEqual(b.stops.map((s) => s.point), [[47.1, 8.1], [47.2, 8.2], [47.3, 8.3]]);
});

test("routes to a shared place from the current location", () => {
  const r = parseMapsUrl(
    "https://www.google.com/maps/place/Zoo+Z%C3%BCrich/@47.3849,8.5741,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d47.3850!4d8.5745"
  );
  assert.equal(r.stops[0].current, true);
  assert.equal(r.stops[1].label, "Zoo Zürich");
  assert.deepEqual(r.stops[1].point, [47.385, 8.5745]);
  assert.deepEqual(parseMapsUrl("https://www.google.com/maps/search/47.39,+8.51?entry=tts").stops[1].point, [47.39, 8.51]);
  assert.equal(parseMapsUrl("https://www.google.com/maps/@47.39,8.51,14z"), null);
});

test("finds the Maps link in shared text", () => {
  const text = "Kunsthaus Zürich\nHeimplatz 1\nhttps://maps.app.goo.gl/AbCdEf123 ";
  assert.equal(extractUrl(text), "https://maps.app.goo.gl/AbCdEf123");
  assert.equal(isShortLink(extractUrl(text)), true);
  assert.equal(extractUrl("nothing here"), null);
});
