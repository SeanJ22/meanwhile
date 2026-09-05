/**
 * **POPULATION ON FILE — the committed ACS B01003 tables, read by the
 * readiness publisher.** (ADM-23, the 9.4.26 evening admin feedback.)
 *
 * Reads the two reference tables `lib/sources/census-acs-population`
 * writes. Never called from a request path: the publisher folds the numbers
 * into the readiness snapshot, and the admin page reads the snapshot.
 *
 * A ZIP with no ZCTA row is reported as ABSENT, not zero — a post-office-box
 * ZIP has residents nowhere and a tabulation area nowhere, and those are
 * different facts from "nobody lives here".
 */
import { readFileSync } from "node:fs";

import { FIPS_TO_STATE } from "../ocd/fips.ts";
import { dataPath, parseCsv } from "./index.ts";

export const ACS_ZCTA_DATASET = "acs5_2023_b01003_zcta" as const;
export const ACS_STATE_DATASET = "acs5_2023_b01003_state" as const;
export const ACS_VINTAGE = "ACS 5-Year 2023 (B01003_001E, total population)";

export interface PopulationTable {
  readonly byCode: ReadonlyMap<string, number>;
  readonly rows: number;
}

function readTable(dataset: typeof ACS_ZCTA_DATASET | typeof ACS_STATE_DATASET): PopulationTable {
  const rows = parseCsv(readFileSync(dataPath(dataset), "utf8"));
  const header = rows[0] ?? [];
  const codeAt = 0;
  const popAt = header.indexOf("population");
  if (popAt < 0) throw new Error(`${dataset}.csv carries no population column; header ${JSON.stringify(header)}`);
  const byCode = new Map<string, number>();
  for (const row of rows.slice(1)) {
    const code = (row[codeAt] ?? "").trim();
    const population = Number(row[popAt]);
    if (code === "" || !Number.isInteger(population) || population < 0) {
      throw new Error(`${dataset}.csv row ${JSON.stringify(row)} is not a code and a count`);
    }
    byCode.set(code, population);
  }
  return { byCode, rows: byCode.size };
}

let zctaCache: PopulationTable | null = null;
let stateCache: PopulationTable | null = null;

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
  return populationByStateFips().byCode.get(fips) ?? null;
}

/** A ZIP's ZCTA population, or null when no tabulation area exists for it. */
export function zipPopulation(zip: string): number | null {
  return populationByZcta().byCode.get(zip.trim()) ?? null;
}
