import { readFileSync } from "node:fs";
import { join } from "node:path";

export const REFERENCE_DATASETS = [
  "boarddocs_tenants",
  // Which office in each state holds campaign-finance reports. Derived from the FEC directory below.
  "state-cf-agencies",
  "census_govt_units_2022",
  "census_govt_units_2022_dependent_school_systems",
  "civicplus_tenants",
  "granicus_legistar_tenants",
  "nces_ccd_lea_directory_2025_26",
  "openstates_legislators",
  // The FEC's state election office and disclosure directories (public domain).
  "fec_state_election_offices",
  "fec_combined_federal_state_disclosure_directory",
  "census_tiger_2023_territory_functional_status",
] as const;

export type ReferenceDataset = (typeof REFERENCE_DATASETS)[number];

/** Voting routes and election scope are structured reference data, not CSV enumerations. */
export const REFERENCE_JSON_DATASETS = [
  "voting-election",
  "voting-legacy-doors",
  "voting-root-discovery",
  "voting-source-doors",
] as const;

export const REFERENCE_ROW_COUNTS: Record<ReferenceDataset, number> = {
  boarddocs_tenants: 0,
  census_govt_units_2022: 90_837,
  census_govt_units_2022_dependent_school_systems: 1_313,
  civicplus_tenants: 1_550,
  granicus_legistar_tenants: 39,
  nces_ccd_lea_directory_2025_26: 19_711,
  openstates_legislators: 7_976,
  fec_state_election_offices: 58,
  // Phone continuation cells are not office rows.
  fec_combined_federal_state_disclosure_directory: 323,
  // Expected data-row counts, verified against the files themselves.
  "state-cf-agencies": 56,

  // Full territory county, county-subdivision and place files, including water placeholders.
  census_tiger_2023_territory_functional_status: 1_672,
};

const DATA_READERS: Readonly<Record<ReferenceDataset, () => string>> = {
  "boarddocs_tenants": () => readFileSync(join(process.cwd(), "data", "reference", "boarddocs_tenants.csv"), "utf8"),
  "state-cf-agencies": () => readFileSync(join(process.cwd(), "data", "reference", "state-cf-agencies.csv"), "utf8"),
  "census_govt_units_2022": () => readFileSync(join(process.cwd(), "data", "reference", "census_govt_units_2022.csv"), "utf8"),
  "census_govt_units_2022_dependent_school_systems": () => readFileSync(join(process.cwd(), "data", "reference", "census_govt_units_2022_dependent_school_systems.csv"), "utf8"),
  "civicplus_tenants": () => readFileSync(join(process.cwd(), "data", "reference", "civicplus_tenants.csv"), "utf8"),
  "granicus_legistar_tenants": () => readFileSync(join(process.cwd(), "data", "reference", "granicus_legistar_tenants.csv"), "utf8"),
  "nces_ccd_lea_directory_2025_26": () => readFileSync(join(process.cwd(), "data", "reference", "nces_ccd_lea_directory_2025_26.csv"), "utf8"),
  "openstates_legislators": () => readFileSync(join(process.cwd(), "data", "reference", "openstates_legislators.csv"), "utf8"),
  "fec_state_election_offices": () => readFileSync(join(process.cwd(), "data", "reference", "fec_state_election_offices.csv"), "utf8"),
  "fec_combined_federal_state_disclosure_directory": () => readFileSync(join(process.cwd(), "data", "reference", "fec_combined_federal_state_disclosure_directory.csv"), "utf8"),
  "census_tiger_2023_territory_functional_status": () => readFileSync(join(process.cwd(), "data", "reference", "census_tiger_2023_territory_functional_status.csv"), "utf8"),
};

import { parseCsv } from "./csv.ts";
export { parseCsv } from "./csv.ts";

export type ReferenceTable = {
  header: string[];
  rows: string[][];
  /** DATA rows, header excluded. Stated so no caller has to remember. */
  count: number;
};

export function readTable(dataset: ReferenceDataset): ReferenceTable {
  const parsed = parseCsv(DATA_READERS[dataset]());
  const [header = [], ...rows] = parsed;
  return { header, rows, count: rows.length };
}

/** Rows as objects, for the callers that want names rather than indexes. */
export function readRecords(dataset: ReferenceDataset): Record<string, string>[] {
  const { header, rows } = readTable(dataset);
  return rows.map((r) => {
    const o: Record<string, string> = {};
    header.forEach((h, i) => {
      o[h] = r[i] ?? "";
    });
    return o;
  });
}

// Recorded properties of this data, enforced in tests/reference-data.test.ts.

// Dormant units remain governments in the Census denominator.
export const CENSUS_INACTIVE_UNITS = 339;

// These units retain a stated place gap even though state FIPS is available.
export const CENSUS_BLANK_PLACE_TX_UNITS = 13;

// Missing URLs do not establish that a government has no website.
export const CENSUS_BLANK_WEB_ADDRESS = 51_655;

// The directory is a discovery source; a later release may revise it.
export const CCD_IS_PRELIMINARY = true;

// These scraper fixtures establish no vendor coverage count.
export const LEGISTAR_IS_FIXTURE_NOT_ENUMERATION = true;

// A header-only fixture establishes no absence of actual tenants.
export const BOARDDOCS_IS_DELIBERATELY_EMPTY = true;
