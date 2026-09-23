// Google encoded polyline format (precision 5) -> [[lat, lon], ...].
export function decodePolyline(str) {
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
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta;
      else lng += delta;
    }
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}
