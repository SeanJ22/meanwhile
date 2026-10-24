import { postalAreaIn, type PostalArea, type PostalTable } from "./postal-core.ts";

/**
 * The zip→coordinate logic, with the table passed in, so the server's
 * synchronous module and the projected browser startup values share one
 * implementation. Nothing here imports the JSON.
 */

export interface ZctaCentroid {
  zip: string;
  lat: number;
  lng: number;
  postal?: PostalArea;
}

/** The committed file's shape: zip → [lat, lng]. */
export type CentroidTable = Record<string, [number, number]>;

export type ZipResolution =
  | { ok: true; centroid: ZctaCentroid }
  | { ok: false; reason: "malformed" | "uncovered" };

/**
 * Five digits. Rejects ZIP+4 and anything non-numeric. Synchronous, so the
 * entry field never waits on the table to validate.
 */
export function isWellFormedZip(input: string): boolean {
  return /^\d{5}$/.test(input.trim());
}

export function lookupIn(centroids: CentroidTable, input: string, postal: PostalTable = {}): ZctaCentroid | null {
  const zip = input.trim();
  if (!isWellFormedZip(zip)) return null;

  const row = postal[zip];
  const point = centroids[zip] ?? (row && row[0] !== null && row[1] !== null ? [row[0], row[1]] : null);
  if (!point) return null;

  const area = postalAreaIn(postal, zip);
  return { zip, lat: point[0], lng: point[1], ...(area ? { postal: area } : {}) };
}

/**
 * A complete ZCTA table is not a complete USPS ZIP directory. An absent
 * five-digit ZIP is a coverage gap, even when every ZCTA is held.
 */
export function resolveIn(
  centroids: CentroidTable,
  input: string,
  postal: PostalTable = {},
): ZipResolution {
  const zip = input.trim();

  if (!isWellFormedZip(zip)) return { ok: false, reason: "malformed" };

  const centroid = lookupIn(centroids, zip, postal);
  if (centroid) return { ok: true, centroid };

  return { ok: false, reason: "uncovered" };
}
