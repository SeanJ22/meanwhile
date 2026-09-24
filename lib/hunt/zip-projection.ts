/**
 * **PROJECTING A HELD CORPUS ONTO A READER'S ZIP — with nothing outbound.**
 * (Session C3, lane C, 2026-09-01. RULING 229.)
 *
 * This is the half of RULING 229 a test can fail. The acquisition side is a
 * denominator and a corpus; this side is the claim that **activating another
 * ZIP is applicability work and never a fresh source hunt**.
 *
 * ```
 *   INPUT    a held CandidateUniverse, and the divisions a ZIP sits in
 *   OUTPUT   the candidacies applicable to that ZIP, and the names of any that
 *            could NOT be answered from the corpus
 *   FORBIDDEN  a network call. There is no fetch, no URL and no client in this
 *              module, and `tests/new-zip-readiness.test.ts` traps
 *              `globalThis.fetch` while it runs to say so out loud.
 * ```
 *
 * ## THE STATE DIVISION IS ALWAYS APPLICABLE, AND THAT IS NOT AN INFERENCE
 *
 * The national ZIP index (`lib/geo/zip-division-index.ts`) lists divisions
 * whose TERRITORY overlaps a ZIP's area, sampled on a lattice: counties,
 * places, county subdivisions and school districts. It does not list
 * `ocd-division/country:us/state:az` for an Arizona ZIP, because the state
 * division covers every Arizona ZIP, and the caller names the ZIP's state.
 * Adding the state division here is reading that, not guessing a geography.
 *
 * What this module will NOT do is invent a division a ZIP might be in. A ZIP
 * absent from the committed geometry gets the state division and nothing else,
 * and the caller is told which it was — because the file's own note is explicit
 * that absence there "is never a claim about a place".
 */

import { populationLabel } from "../candidates/population-label.ts";
import type { CandidateUniverse, CanonicalCandidacy } from "./candidate-universe.ts";
import type { AcquisitionUniverse, ReaderProjection } from "./source-universe.ts";

export function stateDivision(stateCode: string): string {
  return `ocd-division/country:us/state:${stateCode.toLowerCase()}`;
}

/**
 * The divisions a ZIP's reader may see contests from.
 *
 * `overlapping` is whatever the committed geometry holds. `hadGeometry` is
 * returned rather than inferred from an empty list, because "we hold no
 * geometry for this ZIP" and "this ZIP overlaps no local division" are two
 * different facts and only one of them is about the place.
 */
export function applicableDivisions(input: {
  readonly stateCode: string;
  readonly overlapping: readonly string[] | undefined;
}): { readonly divisions: readonly string[]; readonly hadGeometry: boolean } {
  const state = stateDivision(input.stateCode);
  const overlapping = input.overlapping ?? [];
  return {
    divisions: [state, ...overlapping.filter((d) => d !== state)],
    hadGeometry: input.overlapping !== undefined,
  };
}

/**
 * Every held candidacy applicable to a set of divisions.
 *
 * A contest's division is applicable when the ZIP is inside it. The state
 * division matches every statewide contest; a school-district division matches
 * that district's contest and no other.
 */
export function applicableCandidacies(
  universe: CandidateUniverse,
  divisions: readonly string[],
): readonly CanonicalCandidacy[] {
  const wanted = new Set(divisions);
  return universe.candidacies.filter((c) => wanted.has(c.ocdId));
}

/**
 * **THE PROJECTION, AND ITS OWN VERDICT.**
 *
 * `requiredFreshAcquisition` is populated by exactly one thing: an applicable
 * candidacy whose canonical record this project does NOT hold. Because the
 * applicable set is computed FROM the held universe, that list is empty by
 * construction here — and the emptiness is the finding, not a formality. It is
 * what makes "activating another ZIP costs zero outbound acquisitions" a
 * property of the data structure rather than a promise in a report.
 *
 * A candidacy whose ENRICHMENT is incomplete is still ANSWERED: the reader is
 * shown the record with its named gaps (RULING 26, RULING 27 — collection state
 * never governs display). An incomplete card is not a missing card, and
 * treating it as one here would reintroduce the per-ZIP hunt through the back
 * door.
 */
export function projectOntoZip(input: {
  readonly zip: string;
  readonly universe: CandidateUniverse;
  readonly divisions: readonly string[];
  readonly citation: string;
}): { readonly projection: ReaderProjection; readonly candidacies: readonly CanonicalCandidacy[] } {
  /*
   * **R-C9: THIS LINE USED TO READ `"${stateCode} statewide candidate universe"`
   * FOR EVERY STATE, INCLUDING THE TWO WHOSE POPULATION IS ONE COUNTY'S BALLOT.**
   *
   * New Hampshire's universe is 47 candidacies from Merrimack County's
   * certified ballot and New Jersey's is 276 from Morris County's. The keys had
   * genuinely been de-ZIPped; the populations had not been acquired. This
   * string is the one a report quotes as the acquisition denominator's
   * AUTHORITY, so the word travelled into every count cut out of it.
   *
   * `populationLabel` derives the label from the documents the universe was
   * actually built from, against a register of acquisitions that each had to be
   * declared beside the run that earned it — and anything undeclared is
   * PILOT_DERIVED. The label can no longer be right by coincidence or wrong by
   * inheritance.
   */
  const label = populationLabel({
    stateCode: input.universe.stateCode,
    cycle: input.universe.cycle,
    derivedFrom: input.universe.derivedFrom,
  });
  const acquisition: AcquisitionUniverse = {
    authority: label.authorityLine,
    unit: "candidacies",
    /* The publisher states no count we hold. Arizona's Secretary of State
       publishes a filing list and this project now holds it as a corpus, but he
       does not publish a TOTAL, and neither does any other authority here — so
       this denominator is ours and says so rather than borrowing authority. */
    statedBy: null,
    held: input.universe.candidacies.length,
    countedBy: `derived from ${input.universe.derivedFrom.map((d) => d.path).join(", ")}`,
    citation: input.citation,
  };
  const candidacies = applicableCandidacies(input.universe, input.divisions);
  return {
    candidacies,
    projection: {
      scope: `ZIP ${input.zip}`,
      applicable: candidacies.length,
      projectionNarrowedFrom: acquisition,
      answeredFromCorpus: candidacies.length,
      requiredFreshAcquisition: [],
    },
  };
}
