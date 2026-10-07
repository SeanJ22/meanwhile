/**
 * Which governments certainly govern the reader at a zip. ZIP codes are
 * delivery routes and often cross municipal boundaries, so some governments
 * reaching inside a zip govern everyone there and others only some streets.
 *
 * Certainty comes from the zip-governments index, which samples each ZCTA on
 * a 0.01-degree lattice and records how many sample points fall inside each
 * government. The zip's total is the sum of its county-layer samples
 * (counties tile the country with no gaps or overlaps):
 *
 *   samples === total  →  covers the whole zip; renders with no marker.
 *   samples <  total   →  covers part; renders with the pill.
 *
 * Congressional and legislative districts use the published Census
 * whole/partial overlap flag instead. The pill is not a completeness marker:
 * it says the answer depends on the reader's street. The lattice can miss a
 * sliver finer than itself, but only toward calling a near-certain division
 * certain.
 */

import { zipDivisionEntry } from "./zip-division-index.ts";

/**
 * - `CERTAIN`: this division covers every sampled point of the zip.
 * - `AMBIGUOUS`: it covers part of the zip. The pill renders.
 * - `UNKNOWN`: we could not measure it (zip not indexed, shard unreadable,
 *   or the division not in the zip's list). The pill renders.
 */
export type GovernCertainty = "CERTAIN" | "AMBIGUOUS" | "UNKNOWN";

/**
 * A statewide or nationwide office is certain and not measured: an OCD id with
 * no sub-state extent cannot be partial. The zip's state comes from
 * `resolveZipGeography`. A congressional or legislative district is not
 * statewide; its certainty comes from the published Census overlap, and a
 * centroid is never proof that a whole ZCTA lies in one district.
 */
const STATEWIDE_OR_NATIONAL = /^ocd-division\/country:us(\/state:[a-z]{2})?$/;

export interface ZipCertainty {
  /** Every division whose territory reaches inside this zip. */
  all: string[];
  /** Those covering only part of it — the ones that carry the pill. */
  partial: string[];
  /** Lattice sample points inside this ZCTA. Zero means unmeasured. */
  samples: number;
  certaintyOf(ocdId: string): GovernCertainty;
}

export async function zipCertainty(zip: string | null): Promise<ZipCertainty | null> {
  if (!zip || !/^\d{5}$/.test(zip)) return null;
  // An unindexed zip or an unreadable shard is OUR gap, and it degrades to "we cannot say", never to a claim.
  const entry = await zipDivisionEntry(zip);
  if (entry === null) return null;

  const all = [...entry.ids];
  const partial = [...entry.partial];
  const partialSet = new Set(partial);
  const allSet = new Set(all);
  const samples = entry.samples;

  return {
    all,
    partial,
    samples,
    certaintyOf(ocdId: string): GovernCertainty {
      // First: a statewide office is certain by construction.
      if (STATEWIDE_OR_NATIONAL.test(ocdId)) return "CERTAIN";
      if (partialSet.has(ocdId)) return "AMBIGUOUS";
      if (allSet.has(ocdId)) return "CERTAIN";
      return "UNKNOWN";
    },
  };
}

/**
 * Does this division need the pill at this zip? Kept apart from
 * `certaintyOf` so the render decision collapses the states in one place.
 */
export function needsPill(certainty: GovernCertainty): boolean {
  return certainty !== "CERTAIN";
}
