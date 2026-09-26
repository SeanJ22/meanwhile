/**
 * **RULING 71 — WHICH OF THESE GOVERNMENTS CERTAINLY GOVERN THE READER.**
 * (NJ Hunt 3 item 3, 2026-08-22.)
 *
 * `lib/ballot/zip-divisions.ts` answers "whose territory reaches inside this
 * zip". That was the fix for a Rockaway Borough resident being shown Rockaway
 * Township's government and none of their own. It left a second question
 * unanswered, and the page rendered every division identically, so the reader
 * had no way to tell one from the other:
 *
 *   **Morris County governs everyone at 07866.**
 *   **Rockaway Township governs some of them and Rockaway Borough governs the
 *   rest, and which one is a fact about the reader's street.**
 *
 * In New Jersey, borough and township are COEQUAL forms of municipality — not
 * levels of a hierarchy. Rockaway Borough and Rockaway Township are two
 * separate adjacent municipalities that happen to share a name, and neither
 * governs the other's residents. 07866 crosses the line between them, so "who
 * governs you" has two different correct answers depending on which side of a
 * street the reader lives on. **That is not a defect in 07866.** ZIP codes are
 * postal delivery routes and have never respected municipal boundaries; 184 of
 * the 279 zips this repo has committed geometry for cross at least one
 * governing boundary.
 *
 * ## How certainty is established
 *
 * Not by a hand-list, and not by layer type. `data/derived/zip-governments.json`
 * samples each ZCTA on a 0.01-degree lattice and records, per government, how
 * many of that zip's sample points fell inside it. So:
 *
 *   samples === the zip's total  →  covers the whole zip. It governs everyone
 *                                   here, and renders with NO marker.
 *   samples <  the zip's total   →  covers part. Whether it governs THIS reader
 *                                   is a fact about their street, and it
 *                                   renders with the pill.
 *
 * The zip's total is the sum of its COUNTY-layer samples: counties and county
 * equivalents tile the United States with no gaps and no overlaps, so every
 * sampled point of a ZCTA falls in exactly one. Verified across all 33,791 zips
 * in the national source before being relied on, rather than assumed.
 *
 * `scripts/build-zip-division-shards.mts` does that arithmetic at build time.
 * The shared index additionally joins current congressional and legislative
 * districts from the published Census overlap pointer used by Admin. Those
 * layers use its explicit whole/partial flag, not the older local sample.
 *
 * ## What this is NOT
 *
 * **It is not a completeness statement, and RULING 44 is not weakened by it.**
 * A per-card completeness marker says *we did not find this* — a fact about our
 * data, printed next to a named person, worn only by the least-covered card.
 * This says *this is a fact about your street that only you can settle*. Our
 * data is complete here; the reader's location is not. The two are different
 * claims about different things, and `tests/could-govern-pill.test.ts` holds
 * the distinction so no later session deletes the pill as a completeness
 * marker.
 *
 * ## The lattice is a measurement and is described as one
 *
 * At 0.01° a government covering every sampled point could still miss a sliver
 * finer than the lattice. The error runs one way — toward calling something
 * certain that is very nearly certain — and it is never the other way, because
 * a division with any partial sample is marked partial. Nothing here upgrades a
 * measurement into a proof.
 */

import { zipDivisionEntry } from "./zip-division-index.ts";

/**
 * Three states, and the third is not a quiet version of the first.
 *
 * - `CERTAIN` — this division covers every sampled point of the zip.
 * - `AMBIGUOUS` — it covers part of the zip. The pill renders.
 * - `UNKNOWN` — we could not measure it: the zip is not in the index, its
 *   shard is unreadable, or the division was never in the zip's list at all.
 *   **`UNKNOWN` renders the pill**, because the alternative is printing "this
 *   definitely governs you" on the strength of a measurement nobody took, and
 *   a render default may never manufacture a claim.
 */
export type GovernCertainty = "CERTAIN" | "AMBIGUOUS" | "UNKNOWN";

/**
 * **A STATEWIDE OR NATIONWIDE OFFICE IS CERTAIN, AND IT IS NOT MEASURED.**
 *
 * RULING 71 is explicit: *county, school district, state and federal do not
 * become uncertain because a zip crosses a municipal line.* A United States
 * Senate seat is elected statewide; so is a Governor. Every reader at 07866 is
 * in New Jersey and votes in New Jersey's Senate race, and putting "could
 * govern you" on it would be false — and worse than false, because a pill that
 * appears on things it obviously does not apply to is a pill readers learn to
 * skip, which costs the Rockaway Borough case the attention it exists to get.
 *
 * This is decided on the SHAPE of the OCD id rather than by measurement,
 * because there is nothing to measure: `ocd-division/country:us/state:nj` has
 * no sub-state extent to be partial about. The zip's state itself comes from
 * `resolveZipGeography`, which RULING 67 made check two independent publishers.
 *
 * A congressional or legislative district is not statewide. Its certainty
 * comes from the index's published Census whole/partial overlap. If that read
 * cannot establish membership, UNKNOWN still renders the pill. A centroid is
 * never used as proof that an entire ZCTA lies in one district.
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
      // First, because a statewide office is certain by construction and there
      // is nothing about it for the lattice to measure.
      if (STATEWIDE_OR_NATIONAL.test(ocdId)) return "CERTAIN";
      if (partialSet.has(ocdId)) return "AMBIGUOUS";
      if (allSet.has(ocdId)) return "CERTAIN";
      return "UNKNOWN";
    },
  };
}

/**
 * Does this division need the pill at this zip?
 *
 * Separated from `certaintyOf` because the RENDER decision is the thing the
 * page needs and it collapses two of the three states — and collapsing them at
 * the call site, repeatedly, is how one of them eventually gets collapsed the
 * other way.
 */
export function needsPill(certainty: GovernCertainty): boolean {
  return certainty !== "CERTAIN";
}
