/**
 * Publication identity for the census-geography dataset in the civic-data
 * production plane. Dependency-free (no imports) so the contract wiring, the
 * candidate builder, the reader, and the promote script all reference the same
 * literals without coupling. A test asserts these equal the registered manual
 * contract (`lib/civic-data/manual-contracts.ts`).
 */
export const CENSUS_GEO_CONTRACT_ID = "census-geography-overlaps" as const;
export const CENSUS_GEO_SOURCE_ID = "census-geography-relationships" as const;
/** Dedicated record class (record_class is a text column; no DB migration). */
export const CENSUS_GEO_RECORD_CLASS = "CENSUS_GEOGRAPHY" as const;
export const CENSUS_GEO_SCOPE = "US:zcta-geography-overlaps" as const;
export const CENSUS_GEO_PARSER_VERSION = "census-geography-overlaps/1" as const;
export const CENSUS_GEO_SCHEMA_VERSION = "census-geography-overlaps:1" as const;
export const CENSUS_GEO_SOURCE_ROUTE = "https://www2.census.gov/geo/docs/maps-data/data/rel2020/" as const;
