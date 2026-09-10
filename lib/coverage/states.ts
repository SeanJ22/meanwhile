/**
 * THE COVERAGE MANIFEST — the one place that says which states this product
 * covers (AUD-06, g18, 2026-08-18).
 *
 * The auditor's finding, re-verified against `86283bb` before this file was
 * written: FOURTEEN independently maintained state-aware lists across thirteen
 * files, each of which had to be edited by hand to onboard a state. At three
 * states that is an annoyance. At fifty it is the omission a session makes
 * while believing the state is fully onboarded — the failure mode is not a
 * crash, it is a state that renders as partly covered and reads as complete.
 *
 * So: every one of those lists is now DERIVED from the array below. Adding a
 * state is one edit here (plus its content, which no manifest can generate).
 * `tests/coverage-manifest.test.ts` proves the derivation by adding a
 * throwaway state and asserting every derived list sees it.
 *
 * TWO PROJECTIONS, DELIBERATELY SEPARATE. This module is CLIENT-SAFE and holds
 * only the three fields client code reads, and only the two derived lists the
 * browser actually asks for. Everything a build script or the server needs —
 * the state's name, its clipped county, the generated artifact filenames, and
 * the four other lookup directions — lives in `./artifacts.ts`, which the
 * browser graph never imports. The map is 75% of the reader's initial
 * JavaScript already; a manifest is not permitted to make that worse.
 *
 * That split is MEASURED, not assumed. The first cut of this module exported
 * all seven lookups from here, and a before/after build read +159 raw bytes on
 * the client — small, and still a real cost paid by every reader for lookups
 * only `scripts/` ever calls. The four script-side directions moved out and
 * the measurement was re-taken. The figures are in the g18 report.
 *
 * WHY USPS IS WRITTEN OUT RATHER THAN DERIVED. `lib/ocd/fips.ts` holds the
 * authoritative FIPS -> postal table for all 50 states and the territories,
 * and importing it here would be the honest single source — at the cost of
 * dragging a 56-entry table into the client bundle to answer a three-entry
 * question. The pair is written out and held to `FIPS_TO_STATE` by a test
 * instead: single-sourced by check, at no cost on the wire.
 */

/** One covered state, in the fields client code is allowed to see. */
export interface CoveredState {
  /** Census state FIPS code, two digits. The join key; never the name. */
  fips: string;
  /** Two-letter postal abbreviation, upper case. */
  usps: string;
  /** Lower-case postal code — the `state:xx` segment of an OCD-ID. */
  slug: string;
}

/**
 * THE MANIFEST. One entry per covered state, in onboarding order.
 *
 * Onboarding a state is an edit HERE and nowhere else in the wiring. What it
 * is not is a promise that the state's CONTENT exists — election dates,
 * registration links, area facts and a ballot surface are written per state
 * and no manifest can generate them. The tests that hold those tables against
 * this array are the list of what onboarding still owes.
 */
export const COVERED_STATES = [
  { fips: "04", usps: "AZ", slug: "az" },
  { fips: "33", usps: "NH", slug: "nh" },
  { fips: "34", usps: "NJ", slug: "nj" },
] as const satisfies readonly CoveredState[];

export type CoveredUsps = (typeof COVERED_STATES)[number]["usps"];

/**
 * Every client-side list that used to be maintained by hand, as a function of
 * the manifest.
 *
 * Exported as a FUNCTION, not only as its applied result, because that is what
 * makes the one-edit claim testable: the suite calls it with a throwaway state
 * appended and asserts the extra state appears in every list it returns. A
 * derivation that can only be observed at module load can be asserted about
 * but not proven.
 */
export function deriveClientLists(states: readonly CoveredState[]) {
  return {
    /** USPS -> FIPS, the map layer's file-suffix lookup. */
    fipsByUsps: Object.fromEntries(states.map((s) => [s.usps, s.fips])),
    /** Lower-case postal codes — the ballot bubble's covered-state answer. */
    slugs: states.map((s) => s.slug),
  };
}

const derived = deriveClientLists(COVERED_STATES);

/** USPS -> FIPS. Was FIPS_BY_ABBR, inline in lib/map/districts.ts. */
export const FIPS_BY_USPS: Readonly<Record<string, string>> = derived.fipsByUsps;

/** Every covered state lower-case postal code. Was BALLOT_COVERED_STATES. */
export const COVERED_SLUGS: readonly string[] = derived.slugs;

/** `place-04.geojson` — one geometry file, one layer type, one state. */
export function geoFile(type: string, state: CoveredState): string {
  return `${type}-${state.fips}.geojson`;
}

/**
 * Every covered state's file for each given layer type, in MANIFEST order.
 *
 * Manifest order, not the hand-written order these arrays used to carry —
 * `sldu` read 04/34/33 and `cd119` read 04/33/34, for no reason either file
 * recorded. Order is not load-bearing here: the files merge into one source
 * and hold disjoint geometry, one state each, so nothing overlaps and nothing
 * draws over anything. Stating that rather than preserving an arbitrary order
 * out of caution, so the next reader does not have to re-derive it.
 */
export function geoFilesFor(...types: string[]): string[] {
  return types.flatMap((t) => COVERED_STATES.map((s) => geoFile(t, s)));
}
