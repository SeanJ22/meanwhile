/**
 * The reference universe: the official enumerations under `data/reference/` that coverage is measured
 * against, never our own registry's count. Every read goes through `REFERENCE_DIR`. The files are large,
 * so nothing is read at import time.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** The one path. Everything below resolves from it; nothing else may. */
export const REFERENCE_DIR = join(process.cwd(), "data", "reference");

/**
 * The inventory, as a committed expectation rather than as whatever happens
 * to be on disk. A file going missing has to fail a gate, because the way it
 * would otherwise surface is a denominator quietly getting smaller.
 */
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
type ReferenceJsonDataset = (typeof REFERENCE_JSON_DATASETS)[number];

/**
 * The Census of Governments does not enumerate the territories, so their registration reads
 * TIGER/Line 2023 functional status (FUNCSTAT) for county-equivalents, county subdivisions and places.
 */
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
  /*
   * Every territory row of the 2023 TIGER/Line county file (91) and of the
   * five territories' county-subdivision (1,010, of which 46 are the "not
   * defined" water placeholders the cartographic files omit) and place (571)
   * files. Moves only with a new TIGER/Line vintage.
   */
  census_tiger_2023_territory_functional_status: 1_672,
};

export function dataPath(dataset: ReferenceDataset): string {
  return join(REFERENCE_DIR, `${dataset}.csv`);
}

export function notePath(dataset: ReferenceDataset | ReferenceJsonDataset): string {
  return join(REFERENCE_DIR, `${dataset}.md`);
}

function jsonDataPath(dataset: ReferenceJsonDataset): string {
  return join(REFERENCE_DIR, `${dataset}.json`);
}

/** Everything actually in the directory, for the inventory gate. */
export function referenceFiles(): string[] {
  return readdirSync(REFERENCE_DIR).sort();
}

import { parseCsv } from "./csv.ts";
export { parseCsv } from "./csv.ts";

export type ReferenceTable = {
  header: string[];
  rows: string[][];
  /** DATA rows, header excluded. Stated so no caller has to remember. */
  count: number;
};

export function readTable(dataset: ReferenceDataset): ReferenceTable {
  const parsed = parseCsv(readFileSync(dataPath(dataset), "utf8"));
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

/**
 * 339 Census units carry `is_active = N` and are RETAINED on purpose.
 * The Census counts dormant units as governments; filtering them breaks the
 * 90,837 reconciliation. Nobody removes them without restating the
 * denominator, and the test asserts the retained count so a filter added
 * upstream fails here rather than showing up as a smaller universe.
 */
export const CENSUS_INACTIVE_UNITS = 339;

/**
 * 13 Texas special districts have blank state, city and zip. They carry
 * `fips_state = 48`, so the state IS recoverable — and they are deliberately
 * left as a stated gap rather than filled in, because a silently repaired row
 * is indistinguishable from a row that was always complete.
 */
export const CENSUS_BLANK_PLACE_TX_UNITS = 13;

/**
 * `web_address` is blank for 51,655 of 90,837 Census units, and the populated ones had minimal quality
 * control. A seed list for crawling, never a detection surface: a blank value does not mean a body has
 * no website, and a populated one says nothing about its agenda platform.
 */
export const CENSUS_BLANK_WEB_ADDRESS = 51_655;

/**
 * NCES CCD SY 2025-26 is preliminary v.0a and WILL be revised. It is a
 * DISCOVERY surface, not a source of record: nothing in this product keys to
 * a CCD status value, and no reader-facing claim rests on one.
 */
export const CCD_IS_PRELIMINARY = true;

/**
 * The Legistar file is 39 rows of TEST FIXTURE harvested from open-source
 * scraper repositories. It is not an enumeration of Granicus/Legistar
 * tenants, its jurisdiction and state columns are deliberately blank, and no
 * coverage claim may cite it as a tenant count.
 */
export const LEGISTAR_IS_FIXTURE_NOT_ENUMERATION = true;

/**
 * The BoardDocs file is deliberately EMPTY — header only. Zero rows is the
 * correct current state. It is not a failed acquisition, and it is not
 * evidence that BoardDocs has no tenants: roughly 4,000 organizations are
 * missing from it, and finding them is a tracker row, not an absence.
 */
export const BOARDDOCS_IS_DELIBERATELY_EMPTY = true;
