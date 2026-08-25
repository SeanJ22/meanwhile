/**
 * The zip→coordinate LOGIC, with the table passed in — P-002, 2026-08-24.
 *
 * ## Why this exists
 *
 * `lib/geo/zcta-centroids.json` is **960,770 raw bytes**, and it was 32.5% of
 * the landing page's initial JavaScript — larger than MapLibre, and by a
 * distance the single heaviest thing a reader downloads before the map draws.
 * It got there honestly: `lib/geo/zcta.ts` imports it statically, and three
 * client components import that module.
 *
 * A reader cannot use the table until they type a zip or press *use my
 * location*, and neither of those happens at first paint. So the client loads
 * it asynchronously (`./zcta-table.ts`) while the server keeps its synchronous
 * import (`./zcta.ts`), which costs a reader nothing.
 *
 * ## Why the logic is HERE and not in either of them
 *
 * Two modules answering the same three questions is a duplicate
 * implementation, and RULING 103 is explicit that the sweep for those compares
 * SHAPE with identifiers set aside — two copies of `nearestZcta` would collide
 * in that sweep and would deserve to. So the functions take the table as an
 * argument, both modules call these, and there is exactly one place where
 * "which zip is nearest" is decided.
 *
 * Nothing here imports the JSON. That is what makes it free to be in both
 * graphs.
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
 * Five digits. Rejects ZIP+4 and anything non-numeric.
 *
 * Deliberately NOT part of the async surface: it is a regex, it costs nothing,
 * and the entry field validates as the reader types. Making the reader wait on
 * a 960 KB download to be told they typed four digits would be the fix costing
 * more than the defect.
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
 * The ZCTA whose centroid is closest to a coordinate.
 *
 * Backs "Use my location" on the entry overlay. Note what this deliberately is
 * not: it does not decide which districts a coordinate falls in, and it is not
 * a reverse geocoder. It converts a browser position into the same kind of
 * orientation a typed zip gives — no more authoritative for having come from
 * GPS. Treating a precise coordinate as district truth is the exact mistake
 * CLAUDE.md rules out for zip, and a coordinate invites it more strongly.
 *
 * Linear scan over ~33k points. It runs once, on a click, and a spatial index
 * for a single query would cost more to build than the scan costs to run.
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

    // Squared degrees, with longitude scaled by cos(latitude) so the comparison
    // is not skewed at high latitudes. Only used for ranking, never reported,
    // so it does not need to be a real distance.
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
