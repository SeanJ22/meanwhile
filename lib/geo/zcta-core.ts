import type { PostalArea } from "./postal-core.ts";

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
