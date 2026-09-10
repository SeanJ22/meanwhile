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
import {
  civicDataReadNotInitialized,
  promotedVersionOrThrow,
  readPromotedOrBootstrap,
  type CivicDataBootstrap,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "../civic-data/read-model.ts";
import { requiredRoutineContract, routineFreshnessMs } from "../civic-data/contracts.ts";
import type { AcsPopulationRow } from "../sources/census-acs-population/index.ts";

export const ACS_ZCTA_DATASET = "acs5_2024_b01003_zcta" as const;
export const ACS_STATE_DATASET = "acs5_2024_b01003_state" as const;
export const ACS_VINTAGE = "ACS 5-Year 2024 (B01003_001E, total population)";

export interface PopulationRow {
  readonly name: string;
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
  const nameAt = header.indexOf("name");
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
      name: nameAt < 0 ? code : (row[nameAt] ?? code).trim(),
      population,
      marginOfError: margin !== null && Number.isInteger(margin) && margin >= 0 ? margin : null,
    });
  }
  return { byCode, rows: byCode.size };
}

let zctaCache: PopulationTable | null = null;
let stateCache: PopulationTable | null = null;
const ACS_CONTRACT = requiredRoutineContract("census-acs-population");
const ACS_SCOPE = ACS_CONTRACT.scope;

export interface PromotedAcsPopulation {
  readonly formatVersion: 1;
  readonly vintage: number;
  readonly zcta: readonly AcsPopulationRow[];
  readonly state: readonly AcsPopulationRow[];
}

let readState: CivicDataReadResult<PromotedAcsPopulation> = civicDataReadNotInitialized(
  "CENSUS_REFERENCE",
  ACS_SCOPE,
  "The ACS canonical pointer has not been read for this process.",
);

function populationTable(rows: readonly AcsPopulationRow[]): PopulationTable {
  return {
    rows: rows.length,
    byCode: new Map(rows.map((row) => [row.code, { name: row.name, population: row.population, marginOfError: row.marginOfError }])),
  };
}

function validatePopulation(payload: PromotedAcsPopulation, versionId: string): void {
  if (payload.formatVersion !== 1 || payload.vintage !== 2024 || !Array.isArray(payload.zcta) || !Array.isArray(payload.state)) {
    throw new Error(`ACS projection ${versionId} does not satisfy the supported Reader contract.`);
  }
}

function tableRows(table: PopulationTable): AcsPopulationRow[] {
  return [...table.byCode].map(([code, row]) => ({ code, ...row }));
}

function populationBootstrap(): CivicDataBootstrap<PromotedAcsPopulation> {
  const zcta = readTable(ACS_ZCTA_DATASET);
  const state = readTable(ACS_STATE_DATASET);
  return {
    value: { formatVersion: 1, vintage: 2024, zcta: tableRows(zcta), state: tableRows(state) },
    sourceId: ACS_CONTRACT.sourceId,
    version: "2024",
    versionId: "bootstrap:acs-population:2024",
    sourceThrough: "2024",
    retrievedAt: null,
    stale: "UNKNOWN",
    detail: "Bundled ACS 2024 bootstrap selected only because the canonical store answered with no promoted pointer.",
  };
}

/** Typed ACS read outcome; a store failure never opens either committed CSV. */
export async function readPopulationProjection(
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<PromotedAcsPopulation>> {
  const now = options.now ?? new Date().toISOString();
  const result = await readPromotedOrBootstrap({
    ...options,
    now,
    recordClass: "CENSUS_REFERENCE",
    scope: ACS_SCOPE,
    maxAgeMs: options.maxAgeMs ?? routineFreshnessMs(ACS_CONTRACT.id, now),
    bootstrap: populationBootstrap,
    allowUnconfiguredBootstrap: process.env.NODE_ENV !== "production",
  });
  readState = result;
  if (result.kind === "PROMOTED" || result.kind === "BOOTSTRAP") {
    validatePopulation(result.value, result.metadata.versionId ?? result.kind);
    zctaCache = populationTable(result.value.zcta);
    stateCache = populationTable(result.value.state);
  } else {
    zctaCache = null;
    stateCache = null;
  }
  return result;
}

/** Compatibility return for the readiness publisher and live acceptance. */
export async function refreshPopulationFromPromoted(
  options: PromotedCivicDataReadOptions = {},
): Promise<string | null> {
  return promotedVersionOrThrow(await readPopulationProjection(options));
}

export function populationReadState(): CivicDataReadResult<PromotedAcsPopulation> {
  return readState;
}

/** Population by five-digit ZCTA. Cached per process. */
export function populationByZcta(): PopulationTable {
  if (zctaCache === null) {
    throw new Error(`ACS population is ${readState.kind}; call refreshPopulationFromPromoted before using the synchronous projection.`);
  }
  return zctaCache;
}

/** Population by two-digit state FIPS. Cached per process. */
export function populationByStateFips(): PopulationTable {
  if (stateCache === null) {
    throw new Error(`ACS population is ${readState.kind}; call refreshPopulationFromPromoted before using the synchronous projection.`);
  }
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
