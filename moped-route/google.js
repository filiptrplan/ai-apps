// Google Routes API and Places Autocomplete (New), called straight from the
// browser with a referrer-restricted key.
import { decodePolyline } from "./polyline.js";

const ZURICH = { latitude: 47.3769, longitude: 8.5417 };

function latLng([lat, lon]) {
  return { location: { latLng: { latitude: lat, longitude: lon } } };
}

async function googleFetch(url, apiKey, fieldMask, body) {
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || `Google API error ${res.status}`);
  return json;
}

// Waypoints are sent as `via` points so Google treats them as pass-through
// rather than stops, the same way the Maps app follows them.
export async function computeRoute(apiKey, origin, destination, waypoints = []) {
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
      polylineQuality: "HIGH_QUALITY",
    }
  );
  const r = json.routes?.[0];
  if (!r) throw new Error("Google found no route.");
  return {
    points: decodePolyline(r.polyline.encodedPolyline),
    distance: r.distanceMeters,
    duration: parseInt(r.duration, 10),
  };
}

export async function autocomplete(apiKey, input, sessionToken) {
  const json = await googleFetch(
    "https://places.googleapis.com/v1/places:autocomplete",
    apiKey,
    "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat",
    {
      input,
      sessionToken,
      locationBias: { circle: { center: ZURICH, radius: 30000 } },
    }
  );
  return (json.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter(Boolean)
    .map((p) => ({
      placeId: p.placeId,
      main: p.structuredFormat?.mainText?.text ?? p.text.text,
      secondary: p.structuredFormat?.secondaryText?.text ?? "",
      label: p.text.text,
    }));
}

export async function placeLocation(apiKey, placeId, sessionToken) {
  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(sessionToken)}`;
  const json = await googleFetch(url, apiKey, "location");
  return [json.location.latitude, json.location.longitude];
}

// Coordinates for free text such as "Kunsthaus Zürich, Heimplatz 1".
export async function searchPlace(apiKey, text) {
  const json = await googleFetch(
    "https://places.googleapis.com/v1/places:searchText",
    apiKey,
    "places.location,places.displayName",
    { textQuery: text, locationBias: { circle: { center: ZURICH, radius: 50000 } } }
  );
  const place = json.places?.[0];
  if (!place) throw new Error(`Couldn't find "${text}".`);
  return [place.location.latitude, place.location.longitude];
}
