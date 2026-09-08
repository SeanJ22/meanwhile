/**
 * **POPULATION ON FILE — the committed ACS B01003 tables, read by the
 * readiness publisher.** (ADM-23, 9.4.26; re-pointed at the 2024 vintage and
 * given a reading contract for ADM-41 / §9A.10 / §9A.19, 9.6.26.)
 *
 * Reads the two reference tables `lib/sources/census-acs-population` writes.
 * Never called from a request path: the publisher folds the numbers into the
 * readiness snapshot, and the admin page reads the snapshot.
 *
 * ## Why this module returns a READING and not a number
 *
 * The owner looked at a ZIP row and read *"0 people"* and *"32 people"* as
 * facts about places where people plainly live. They were faithful ACS values,
 * and printing them bare was still a false claim, because an ACS 5-year figure
 * for a very small area is an ESTIMATE with a published interval around it, not
 * a count. So `zipPopulationReading` returns one of four dispositions and the
 * caller renders the sentence each deserves:
 *
 * ```
 *   COUNTED                 an estimate whose 90% interval excludes zero.
 *                           Rendered as the number, always with its ± margin.
 *   WITHIN_MARGIN_OF_ERROR  the margin reaches zero, so the estimate is not
 *                           distinguishable from zero. Rendered as a sentence.
 *   RECORDED_AS_NONE        the estimate itself is 0 — the tabulation area
 *                           records no residents. NOT "nobody lives here"
 *                           and NOT "we failed to collect it".
 *   NO_TABULATION_AREA      the ZIP has no ZCTA row at all — a post-office-box
 *                           or single-site ZIP. A named gap, never a zero.
 * ```
 *
 * The dividing line is the Bureau's OWN published margin of error
 * (`B01003_001M`, 90% confidence), not a threshold invented here. An estimate
 * with no published margin (the Bureau jams the state rows) is COUNTED with a
 * null margin: a controlled state total is exactly the kind of number that
 * does not need an interval.
 */
import { readFileSync } from "node:fs";

import { FIPS_TO_STATE } from "../ocd/fips.ts";
import { dataPath, parseCsv } from "./index.ts";
import { promotedReadModel } from "../civic-data/read-model.ts";
import type { AcsPopulationRow } from "../sources/census-acs-population/index.ts";

export const ACS_ZCTA_DATASET = "acs5_2024_b01003_zcta" as const;
export const ACS_STATE_DATASET = "acs5_2024_b01003_state" as const;
export const ACS_VINTAGE = "ACS 5-Year 2024 (B01003_001E, total population)";

export interface PopulationRow {
  readonly population: number;
  /** The Bureau's 90% margin of error, or null where it published none. */
  readonly marginOfError: number | null;
}

export interface PopulationTable {
  readonly byCode: ReadonlyMap<string, PopulationRow>;
  readonly rows: number;
}

function readTable(dataset: typeof ACS_ZCTA_DATASET | typeof ACS_STATE_DATASET): PopulationTable {
  const rows = parseCsv(readFileSync(dataPath(dataset), "utf8"));
  const header = rows[0] ?? [];
  const codeAt = 0;
  const popAt = header.indexOf("population");
  const moeAt = header.indexOf("margin_of_error");
  if (popAt < 0) throw new Error(`${dataset}.csv carries no population column; header ${JSON.stringify(header)}`);
  const byCode = new Map<string, PopulationRow>();
  for (const row of rows.slice(1)) {
    const code = (row[codeAt] ?? "").trim();
    const population = Number(row[popAt]);
    if (code === "" || !Number.isInteger(population) || population < 0) {
      throw new Error(`${dataset}.csv row ${JSON.stringify(row)} is not a code and a count`);
    }
    // An empty margin cell is "the Bureau did not state one" — never a zero,
    // which would claim the estimate is exact.
    const rawMargin = moeAt < 0 ? "" : (row[moeAt] ?? "").trim();
    const margin = rawMargin === "" ? null : Number(rawMargin);
    byCode.set(code, {
      population,
      marginOfError: margin !== null && Number.isInteger(margin) && margin >= 0 ? margin : null,
    });
  }
  return { byCode, rows: byCode.size };
}

let zctaCache: PopulationTable | null = null;
let stateCache: PopulationTable | null = null;

export interface PromotedAcsPopulation {
  readonly formatVersion: 1;
  readonly vintage: number;
  readonly zcta: readonly AcsPopulationRow[];
  readonly state: readonly AcsPopulationRow[];
}

function populationTable(rows: readonly AcsPopulationRow[]): PopulationTable {
  return {
    rows: rows.length,
    byCode: new Map(rows.map((row) => [row.code, { population: row.population, marginOfError: row.marginOfError }])),
  };
}

/**
 * Runtime preload of the single promoted ACS projection. The committed CSV is
 * the bootstrap LKG until the one-time migration is seeded.
 */
export async function refreshPopulationFromPromoted(): Promise<string | null> {
  const promoted = await promotedReadModel<PromotedAcsPopulation>("CENSUS_REFERENCE", "acs-population");
  if (!promoted) return null;
  const payload = promoted.payload;
  if (payload.formatVersion !== 1 || payload.vintage !== 2024 || !Array.isArray(payload.zcta) || !Array.isArray(payload.state)) {
    throw new Error(`Promoted ACS projection ${promoted.versionId} does not satisfy the supported Reader contract.`);
  }
  zctaCache = populationTable(payload.zcta);
  stateCache = populationTable(payload.state);
  return promoted.versionId;
}

/** Population by five-digit ZCTA. Cached per process. */
export function populationByZcta(): PopulationTable {
  zctaCache ??= readTable(ACS_ZCTA_DATASET);
  return zctaCache;
}

/** Population by two-digit state FIPS. Cached per process. */
export function populationByStateFips(): PopulationTable {
  stateCache ??= readTable(ACS_STATE_DATASET);
  return stateCache;
}

/**
 * The FIPS code for a postal state code — DERIVED from the one authoritative
 * FIPS table (`lib/ocd/fips.ts`), never a second hand-kept list of every
 * state (tests/coverage-manifest.test.ts refuses one by design).
 */
export const STATE_FIPS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(FIPS_TO_STATE).map(([fips, entry]) => [entry.postal.toLowerCase(), fips]),
);

/** A state's total population, or null when the table has no row for it. */
export function statePopulation(postal: string): number | null {
  const fips = STATE_FIPS[postal.toLowerCase()];
  if (!fips) return null;
  return populationByStateFips().byCode.get(fips)?.population ?? null;
}

/** A ZIP's ZCTA population estimate, or null when no tabulation area exists. */
export function zipPopulation(zip: string): number | null {
  return populationByZcta().byCode.get(zip.trim())?.population ?? null;
}

/** How a ZCTA population estimate may honestly be read. */
export const POPULATION_BASES = [
  "COUNTED",
  "WITHIN_MARGIN_OF_ERROR",
  "RECORDED_AS_NONE",
  "NO_TABULATION_AREA",
] as const;
export type PopulationBasis = (typeof POPULATION_BASES)[number];

export interface PopulationReading {
  readonly basis: PopulationBasis;
  /** The Bureau's estimate, or null when there is no tabulation area at all. */
  readonly population: number | null;
  readonly marginOfError: number | null;
}

/**
 * Classify an estimate against its OWN published margin. Pure, so the rule can
 * be pinned by a test without a filesystem.
 *
 * Order matters: a zero estimate is reported as recorded-as-none even though
 * its interval also reaches zero, because "the tabulation area records no
 * residents" is the more specific and more useful sentence, and it is the exact
 * thing the owner saw rendered as `0 people`.
 */
export function classifyPopulation(population: number, marginOfError: number | null): PopulationReading {
  if (population === 0) return { basis: "RECORDED_AS_NONE", population, marginOfError };
  if (marginOfError !== null && marginOfError >= population) {
    return { basis: "WITHIN_MARGIN_OF_ERROR", population, marginOfError };
  }
  return { basis: "COUNTED", population, marginOfError };
}

/** A ZIP's population as a reading, with the disposition its number earns. */
export function zipPopulationReading(zip: string): PopulationReading {
  const row = populationByZcta().byCode.get(zip.trim());
  if (row === undefined) return { basis: "NO_TABULATION_AREA", population: null, marginOfError: null };
  return classifyPopulation(row.population, row.marginOfError);
}
