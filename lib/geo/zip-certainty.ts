/** ZIP certainty comes from a selected published Census relationship. Held
 * lattice intersections remain useful orientation data with uncertainty. */

import { readZipPlace, type PlaceEntry } from "../place-map/reader.ts";
import type { GeographySelection } from "../census-geography/selection.ts";

/**
 * - `CERTAIN`: an official selected relationship, or the 2020 Census count of where the ZIP's residents live,
 *   establishes whole-ZCTA membership.
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

export async function zipCertainty(zip: string | null, selection?: GeographySelection, supplied?: PlaceEntry | null): Promise<ZipCertainty | null> {
  if (!zip || !/^\d{5}$/.test(zip)) return null;
  // An unindexed zip or an unreadable shard is OUR gap, and it degrades to "we cannot say", never to a claim.
  const entry = supplied === undefined ? await readZipPlace(zip, selection) : supplied;
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
