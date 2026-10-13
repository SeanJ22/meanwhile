/**
 * Census ACS B01003 population by ZCTA and by state, read from the promoted projection. Never called
 * from a request path.
 *
 * An ACS 5-year figure for a small area is an estimate with a published interval, so
 * `zipPopulationReading` returns a disposition rather than a bare number:
 *   COUNTED                 the 90% interval excludes zero; rendered with its ± margin.
 *   WITHIN_MARGIN_OF_ERROR  the margin reaches zero; rendered as a sentence.
 *   RECORDED_AS_NONE        the estimate itself is 0 (not "nobody lives here", not a collection gap).
 *   NO_TABULATION_AREA      the ZIP has no ZCTA row (PO-box or single-site ZIP); a named gap.
 * The dividing line is the Bureau's own margin (`B01003_001M`). An estimate with no published margin
 * (state rows) is COUNTED with a null margin.
 */
import { FIPS_TO_STATE } from "../ocd/fips.ts";
import {
  civicDataReadNotInitialized,
  promotedVersionOrThrow,
  readPromotedCivicData,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "../civic-data/read-model.ts";
import { requiredRoutineContract, routineFreshnessMs } from "../civic-data/contracts.ts";
import type { AcsPopulationRow } from "../sources/census-acs-population/index.ts";

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
  if (payload.formatVersion !== 1 || !Number.isInteger(payload.vintage) || !Array.isArray(payload.zcta) || !Array.isArray(payload.state)) {
    throw new Error(`ACS projection ${versionId} does not satisfy the supported Reader contract.`);
  }
}

/** Typed ACS read outcome. */
export async function readPopulationProjection(
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<PromotedAcsPopulation>> {
  const now = options.now ?? new Date().toISOString();
  const result = await readPromotedCivicData<PromotedAcsPopulation>("CENSUS_REFERENCE", ACS_SCOPE, {
    ...options,
    now,
    maxAgeMs: options.maxAgeMs ?? routineFreshnessMs(ACS_CONTRACT.id, now),
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

/** The FIPS code for a postal state code, derived from `lib/ocd/fips.ts` rather than a second list. */
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
 * Classify an estimate against its own published margin. Pure. A zero estimate is RECORDED_AS_NONE
 * even though its interval also reaches zero, because that is the more specific sentence.
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
