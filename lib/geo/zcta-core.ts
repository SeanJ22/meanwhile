/**
 * The zip→coordinate logic, with the table passed in, so the server's
 * synchronous module (`./zcta.ts`) and the client's lazy one
 * (`./zcta-table.ts`) share one implementation. Nothing here imports the JSON.
 */

export interface ZctaCentroid {
  zip: string;
  lat: number;
  lng: number;
}

/** The committed file's shape: zip → [lat, lng]. */
export type CentroidTable = Record<string, [number, number]>;

export type ZipResolution =
  | { ok: true; centroid: ZctaCentroid }
  | { ok: false; reason: "malformed" | "unknown" | "uncovered" };

/**
 * Five digits. Rejects ZIP+4 and anything non-numeric. Synchronous, so the
 * entry field never waits on the table to validate.
 */
export function isWellFormedZip(input: string): boolean {
  return /^\d{5}$/.test(input.trim());
}

export function lookupIn(centroids: CentroidTable, input: string): ZctaCentroid | null {
  const zip = input.trim();
  if (!isWellFormedZip(zip)) return null;

  const point = centroids[zip];
  if (!point) return null;

  return { zip, lat: point[0], lng: point[1] };
}

/**
 * The ZCTA whose centroid is closest to a coordinate, for "Use my location".
 * Orientation only, like a typed zip: not a reverse geocoder and not district
 * truth. A linear scan; it runs once, on a click.
 */
export function nearestIn(
  centroids: CentroidTable,
  lat: number,
  lng: number,
): ZctaCentroid | null {
  let best: ZctaCentroid | null = null;
  let bestDistance = Infinity;

  for (const zip in centroids) {
    const [zLat, zLng] = centroids[zip];

    // Squared degrees with longitude scaled by cos(latitude): for ranking only.
    const dLat = zLat - lat;
    const dLng = (zLng - lng) * Math.cos((lat * Math.PI) / 180);
    const distance = dLat * dLat + dLng * dLng;

    if (distance < bestDistance) {
      bestDistance = distance;
      best = { zip, lat: zLat, lng: zLng };
    }
  }

  return best;
}

/**
 * Resolve a zip for the entry screen, distinguishing the three ways it fails so
 * each can get its own message.
 *
 * `malformed` — not five digits.
 * `unknown`   — five digits, no such ZCTA. Only claimable with a complete table.
 * `uncovered` — five digits, absent from the stub. We don't know either way.
 */
export function resolveIn(
  centroids: CentroidTable,
  coverageIsComplete: boolean,
  input: string,
): ZipResolution {
  const zip = input.trim();

  if (!isWellFormedZip(zip)) return { ok: false, reason: "malformed" };

  const centroid = lookupIn(centroids, zip);
  if (centroid) return { ok: true, centroid };

  return { ok: false, reason: coverageIsComplete ? "unknown" : "uncovered" };
}
