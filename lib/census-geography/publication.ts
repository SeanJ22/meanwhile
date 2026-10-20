/** Census source evidence and independently refreshed state publications. */
import { FIPS_TO_STATE } from "../ocd/fips.ts";
export const CENSUS_GEO_CONTRACT_ID = "census-geography-overlaps" as const;
export const CENSUS_GEO_SOURCE_ID = "census-geography-relationships" as const;
/** Dedicated record class (record_class is a text column; no DB migration). */
export const CENSUS_GEO_RECORD_CLASS = "CENSUS_GEOGRAPHY" as const;
export const CENSUS_GEO_SCOPE = "US:zcta-geography-overlaps" as const;
export const CENSUS_GEO_STATES = Object.values(FIPS_TO_STATE).map(row => row.postal);
export function censusGeographyState(state: string): { state: string; fips: string } {
  const entry = Object.entries(FIPS_TO_STATE).find(([, row]) => row.postal === state.toUpperCase());
  if (!entry) throw new Error("CENSUS_GEOGRAPHY_EXACT_STATE_REQUIRED");
  return { state: entry[1].postal, fips: entry[0] };
}
export const censusGeographyContractId = (state: string) => `${CENSUS_GEO_CONTRACT_ID}-${censusGeographyState(state).state.toLowerCase()}`;
export const censusGeographyScope = (state: string) => `US-${censusGeographyState(state).state}:zcta-geography-overlaps`;
export const CENSUS_GEO_PARSER_VERSION = "census-geography-overlaps/1" as const;
export const CENSUS_GEO_SCHEMA_VERSION = "census-geography-overlaps:1" as const;
export const CENSUS_GEO_SOURCE_ROUTE = "https://www2.census.gov/geo/docs/maps-data/data/rel2020/" as const;
