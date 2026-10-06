/**
 * The reference universe, read from the repo and nowhere else (Prompt B item
 * 2d, 2026-08-20).
 *
 * `data/reference/` holds the OFFICIAL enumerations this product measures
 * itself against: the 2022 Census of Governments unit file, its dependent
 * school systems companion, the NCES CCD LEA directory, the Open States
 * legislator roster, and three vendor-tenant lists. Coverage is claimed
 * against these and never against our own registry's count — a registry that
 * defines its own denominator cannot be caught missing anything.
 *
 * WHY A LOADER RATHER THAN AD-HOC READS. These files arrived from an
 * acquisition pass that ran outside this repo. The failure mode that follows
 * is a downstream module reading them from wherever they happened to sit at
 * acquisition time — a container's `outputs/`, a desktop folder, an absolute
 * Windows path — which works on exactly one machine and silently narrows the
 * denominator everywhere else. Every read goes through here, `REFERENCE_DIR`
 * is the only path, and `tests/reference-data.test.ts` fails if any other
 * module names one of these files by any other route.
 *
 * The files are large — the Census unit file alone is 18 MB — so nothing is
 * read at import time and every accessor is explicit about what it costs.
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
  /*
   * RULING 86 and the RULING 97 accounting (2026-08-24, the state-campaign-money
   * session). Which office in a state holds CAMPAIGN-FINANCE reports, for all 56
   * jurisdictions the FEC directory covers, link-verified with a date.
   *
   * DERIVED from the FEC directory below rather than hand-kept.
   */
  "state-cf-agencies",
  "census_govt_units_2022",
  "census_govt_units_2022_dependent_school_systems",
  "civicplus_tenants",
  "granicus_legistar_tenants",
  "nces_ccd_lea_directory_2025_26",
  "openstates_legislators",
  /*
   * RULING 69 (NJ Hunt 2, 2026-08-22). The FEC's two directories, as DATA.
   *
   * They answer the question the NJ Hunt raised and could not settle: the
   * variable deciding whether a candidate's contact is reachable is not the
   * number of routes in the manifest, it is what each state's filing authority
   * publishes — and there is no national floor for that. These name every
   * state's election office and, per jurisdiction, the offices holding
   * disclosure records, the legislative committees on elections and on ethics,
   * and the associations. They are public domain, being works of the United
   * States federal government.
   */
  "fec_state_election_offices",
  "fec_combined_federal_state_disclosure_directory",
  /*
   * ADM-23 (the 9.4.26 evening admin feedback), re-acquired at the 2024 vintage
   * for ADM-41 / §9A.19 (9.6.26). Census ACS 5-Year total population
   * (B01003_001E) and its published 90% margin of error (B01003_001M) by ZIP
   * Code Tabulation Area and by state, acquired through the Census Data API by
   * lib/sources/census-acs-population. 2024 is the newest 5-Year release the
   * API serves — /data/2025/acs/acs5 answers 404, measured 2026-09-06. The
   * readiness publisher weights completeness by these; a ZIP with no ZCTA row
   * is a named gap downstream, never a zero, and an estimate whose margin
   * reaches zero is rendered as a sentence rather than as a count.
   */
  "acs5_2024_b01003_zcta",
  "acs5_2024_b01003_state",
  /*
   * 2026-09-25. The Census of Governments does not enumerate the five
   * territories, so their registration reads TIGER/Line 2023's functional
   * status (FUNCSTAT, docs/state.md §4.6 M17) for their county-equivalents,
   * county subdivisions and places: the attribute tables only, extracted by
   * scripts/extract-territory-functional-status.mts. It is the evidence behind
   * each territory government registered, and behind "none recorded" in Guam
   * and the Virgin Islands.
   */
  "census_tiger_2023_territory_functional_status",
] as const;

export type ReferenceDataset = (typeof REFERENCE_DATASETS)[number];

/**
 * Row counts verified against the FILES on 2026-08-20 (Prompt B item 2b), not
 * copied from the provenance notes. Where a note's claim and the file
 * disagreed, the file won and the disagreement is stated in the report — an
 * expected figure adjusted to match what was found is not a reconciliation.
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
  // Re-extracted 2026-10-02: 26 phone continuation cells are not office rows.
  fec_combined_federal_state_disclosure_directory: 323,
  /*
   * One row per jurisdiction the FEC directory covers — the 50 states, DC, and
   * the five territories. It is a DERIVED file, so this figure is a fact about
   * the directory rather than about a fetch: it moves only when the FEC
   * publishes a new edition covering a different set of jurisdictions.
   */
  "state-cf-agencies": 56,
  /*
   * Verified against the API on 2026-09-06: every ZCTA the 2024 5-year
   * release tabulates (33,772 — the same delineation the 2023 release used)
   * and the 50 states, DC and Puerto Rico (52). These move only with a new ACS
   * vintage, and a changed figure is a real change in the country's tabulation
   * areas, not drift.
   */
  acs5_2024_b01003_zcta: 33_772,
  acs5_2024_b01003_state: 52,
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

export function notePath(dataset: ReferenceDataset): string {
  return join(REFERENCE_DIR, `${dataset}.md`);
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

/* -------------------------------------------------------------------------- */
/* Recorded properties of this data (Prompt B item 2c).                       */
/*                                                                            */
/* These are ENFORCED in tests/reference-data.test.ts rather than written as  */
/* comments, because each one is a denominator somebody could quietly change. */
/* -------------------------------------------------------------------------- */

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
 * `web_address` is blank for 51,655 of 90,837 Census units (56.87%), and the
 * Census documents the populated 43% as having had minimal quality control.
 *
 * THIS IS A SEED LIST FOR CRAWLING, NEVER A DETECTION SURFACE. A
 * platform-signature scan over these URLs returned ONE hit in 39,182 Census
 * URLs and ZERO in 17,346 CCD URLs. A future session that treats a blank
 * `web_address` as "this body has no website", or a populated one as
 * evidence of which agenda platform a body runs, is reading a claim this
 * column cannot make.
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
