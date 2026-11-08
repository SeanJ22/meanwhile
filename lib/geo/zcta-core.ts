import type { PostalArea } from "./postal-core.ts";

export interface ZctaCentroid {
  zip: string;
  lat: number;
  lng: number;
  /** The ZIP's own state, when a published ZIP file named it; `postal` is present only for the ZIPs that file describes. */
  state?: string;
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
