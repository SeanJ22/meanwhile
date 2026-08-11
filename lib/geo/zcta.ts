import centroidFile from "./zcta-centroids.json";

/**
 * Zip → map coordinate.
 *
 * Orientation only. A ZCTA is a statistical shape derived from mail delivery
 * routes; it crosses city, county, school district, and legislative lines. It
 * tells the map where to look and nothing else. Anything that needs actual
 * districts asks for a street address, and says why at the point of asking.
 */

export interface ZctaCentroid {
  zip: string;
  lat: number;
  lng: number;
}

const CENTROIDS = centroidFile.centroids as Record<string, [number, number]>;

/**
 * Whether the centroid table covers the whole country.
 *
 * False while the committed stub is in place. It changes what an unrecognized
 * zip means: with a partial table we can't claim a zip doesn't exist, only that
 * we don't have it yet — and the UI has to say the honest one.
 */
export const COVERAGE_IS_COMPLETE: boolean = centroidFile.complete === true;

export const CENTROID_SOURCE = {
  url: centroidFile.source,
  org: centroidFile.sourceOrg,
  vintage: centroidFile.vintage,
};

/** Five digits. Rejects ZIP+4 and anything non-numeric. */
export function isWellFormedZip(input: string): boolean {
  return /^\d{5}$/.test(input.trim());
}

export function lookupZcta(input: string): ZctaCentroid | null {
  const zip = input.trim();
  if (!isWellFormedZip(zip)) return null;

  const point = CENTROIDS[zip];
  if (!point) return null;

  return { zip, lat: point[0], lng: point[1] };
}

export type ZipResolution =
  | { ok: true; centroid: ZctaCentroid }
  | { ok: false; reason: "malformed" | "unknown" | "uncovered" };

/**
 * Resolve a zip for the entry screen, distinguishing the three ways it fails so
 * each can get its own message.
 *
 * `malformed` — not five digits.
 * `unknown`   — five digits, no such ZCTA. Only claimable with a complete table.
 * `uncovered` — five digits, absent from the stub. We don't know either way.
 */
export function resolveZip(input: string): ZipResolution {
  const zip = input.trim();

  if (!isWellFormedZip(zip)) return { ok: false, reason: "malformed" };

  const centroid = lookupZcta(zip);
  if (centroid) return { ok: true, centroid };

  return { ok: false, reason: COVERAGE_IS_COMPLETE ? "unknown" : "uncovered" };
}
