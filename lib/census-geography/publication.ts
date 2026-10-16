import { readPromotedCivicData, type CivicDataReadResult, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import type { CensusDistrictEdge } from "./district-edge.ts";

export const CENSUS_GEO_CONTRACT_ID = "census-geography-overlaps" as const;
export const CENSUS_GEO_SOURCE_ID = "census-geography-relationships" as const;
export const CENSUS_GEO_RECORD_CLASS = "CENSUS_GEOGRAPHY" as const;
export const CENSUS_GEO_SCOPE = "census-geography-relationships:refresh" as const;
export const CENSUS_GEO_PARSER_VERSION = "census-geography-overlaps/3" as const;
export const CENSUS_GEO_SCHEMA_VERSION = "census-geography-overlaps:3" as const;
export const CENSUS_GEO_SOURCE_ROUTE = "https://www2.census.gov/geo/docs/maps-data/data/rel2020/" as const;

export function censusGeographyScope(state: string): string {
  if (!/^[A-Z]{2}$/.test(state)) throw new Error("A Census state publication requires its postal code");
  return `${CENSUS_GEO_SOURCE_ID}:state:${state}`;
}

export function censusGeographyState(scope: string): string | null {
  return /^census-geography-relationships:state:([A-Z]{2})$/.exec(scope)?.[1] ?? null;
}

const CENSUS_GEO_MAX_AGE_MS = 100 * 365 * 24 * 60 * 60 * 1000;

export async function readCensusGeographyProjection(
  state: string, options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<CensusDistrictEdge>> {
  const postal = state.toUpperCase();
  const result = await readPromotedCivicData<CensusDistrictEdge>(CENSUS_GEO_RECORD_CLASS, censusGeographyScope(postal),
    { ...options, maxAgeMs: options.maxAgeMs ?? CENSUS_GEO_MAX_AGE_MS });
  if (result.kind !== "PROMOTED") return result;
  const index = result.value;
  if (index?.formatVersion === 2 && Array.isArray(index.scopes) && index.zipPrefixes && index.states
    && Object.keys(index.states).length === 1 && Object.hasOwn(index.states, postal)) return result;
  return { kind: "STORE_UNREACHABLE", value: null, metadata: result.metadata, code: "PROMOTION_PROOF_INVALID",
    detail: "The promoted Census geography does not contain exactly its named state." };
}
