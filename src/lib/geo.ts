// src/lib/geo.ts — Haversine distance, bearing, and speed helpers

const R = 6371e3; // Earth radius in metres

/** Convert degrees to radians */
function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Convert radians to degrees */
function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/**
 * Haversine distance between two lat/lng points in metres.
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Initial bearing from point 1 to point 2, in degrees [0, 360).
 */
export function bearing(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dLambda = toRad(lng2 - lng1);

  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);

  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Format a distance in metres into a human-readable string.
 */
export function formatDistance(metres: number): string {
  if (metres < 1000) {
    return `${Math.round(metres)} m`;
  }
  return `${(metres / 1000).toFixed(1)} km`;
}

/**
 * Compass label for a bearing in degrees.
 */
export function compassDirection(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(deg / 45) % 8;
  return dirs[index];
}

export interface GeoPosition {
  lat: number;
  lng: number;
  speedKmh: number;
  heading: number;
  updatedAt: number;
}
