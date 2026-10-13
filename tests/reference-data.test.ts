import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Plain .mjs, shared with the plain-node scripts that never see tsx.
import { posixRelative } from "../scripts/repo-path.mjs";
import {
  BOARDDOCS_IS_DELIBERATELY_EMPTY,
  CENSUS_BLANK_PLACE_TX_UNITS,
  CENSUS_BLANK_WEB_ADDRESS,
  CENSUS_INACTIVE_UNITS,
  LEGISTAR_IS_FIXTURE_NOT_ENUMERATION,
  REFERENCE_DATASETS,
  REFERENCE_JSON_DATASETS,
  REFERENCE_ROW_COUNTS,
  parseCsv,
  readTable,
  referenceFiles,
} from "../lib/reference/index.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Voting routes and election scope use the JSON reference loader; county clocks are a static JSON import.
// Both retain the same required provenance pairing as the CSV tables.
const JSON_REFERENCE_DATASETS = [...REFERENCE_JSON_DATASETS, "national_county_time_zones", "statewide-executive-sources", "us-jurisdiction-labels"] as const;
const REFERENCE_DATA_FILES = [
  ...REFERENCE_DATASETS.map(dataset => `${dataset}.csv`),
  ...JSON_REFERENCE_DATASETS.map(dataset => `${dataset}.json`),
];
const ALL_REFERENCE_DATASETS = [...REFERENCE_DATASETS, ...JSON_REFERENCE_DATASETS];

/**
 * `data/reference/` is where every coverage denominator comes from. A file going missing, a row count
 * drifting, or a dormant unit being filtered out all make the denominator smaller, so each turns a test red.
 */

/* ---- the inventory and its pairings ---------------------------------------- */

test("data/reference contains every declared CSV and JSON dataset with its provenance note", () => {
  const files = referenceFiles();
  const expected = [...REFERENCE_DATA_FILES, ...ALL_REFERENCE_DATASETS.map(dataset => `${dataset}.md`)];
  assert.deepEqual(files.toSorted(), expected.toSorted(), "a missing data file narrows a denominator, and an undeclared file needs its source identified");
});

test("every reference data file is paired with its provenance note, both ways", () => {
  const files = new Set(referenceFiles());
  const unpaired: string[] = [];

  for (const file of REFERENCE_DATA_FILES) {
    const dataset = file.replace(/\.(csv|json)$/, "");
    if (!files.has(file)) unpaired.push(`${file} is missing`);
    if (!files.has(`${dataset}.md`)) unpaired.push(`${dataset}.md is missing`);
  }
  // The other direction: a note describing a file nobody committed is a
  // claim about data this product does not have.
  for (const file of files) {
    const stem = file.replace(/\.(csv|json|md)$/, "");
    if (!(ALL_REFERENCE_DATASETS as readonly string[]).includes(stem)) {
      unpaired.push(`${file} is not a declared dataset`);
    }
  }

  assert.deepEqual(unpaired, [], "every reference dataset needs its data and source note");
});

test("every provenance note says something about its data file", () => {
  const thin: string[] = [];
  for (const dataset of ALL_REFERENCE_DATASETS) {
    const note = readFileSync(join(ROOT, "data", "reference", `${dataset}.md`), "utf8");
    // A note is provenance or it is decoration. 400 bytes is not a quality
    // bar, it is a floor under "this file was created and left empty".
    if (note.trim().length < 400) thin.push(`${dataset}.md is ${note.trim().length} bytes`);
  }
  assert.deepEqual(thin, [], "these provenance notes are too thin to be provenance");
});

/* ---- row counts, against the ingested rows ------------------------------- */

test("every reference file holds the row count it is expected to", () => {
  const mismatches: string[] = [];
  for (const dataset of REFERENCE_DATASETS) {
    const found = readTable(dataset).count;
    const expected = REFERENCE_ROW_COUNTS[dataset];
    if (found !== expected) mismatches.push(`${dataset}: found ${found}, expected ${expected}`);
  }
  assert.deepEqual(
    mismatches,
    [],
    "an expected figure is NEVER adjusted to match what was found — fix the file " +
      "or restate the denominator deliberately",
  );
});

test("the Census workbook reconciles: 90,837 units + 1,313 dependent = 92,150", () => {
  const units = readTable("census_govt_units_2022").count;
  const dependent = readTable("census_govt_units_2022_dependent_school_systems").count;
  assert.equal(units, 90_837);
  assert.equal(dependent, 1_313);
  assert.equal(
    units + dependent,
    92_150,
    "every data row in the source workbook is accounted for by exactly one of the two files",
  );
});

test("the Census type breakdown sums to the unit total", () => {
  const table = readTable("census_govt_units_2022");
  const idx = table.header.indexOf("gov_type");
  const counts = new Map<string, number>();
  for (const row of table.rows) {
    const t = row[idx] ?? "";
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }

  const EXPECTED = {
    COUNTY: 3_031,
    MUNICIPAL: 19_491,
    TOWNSHIP: 16_214,
    "SPECIAL DISTRICT": 39_555,
    "SCHOOL DISTRICT": 12_546,
  } as const;

  for (const [type, expected] of Object.entries(EXPECTED)) {
    assert.equal(counts.get(type), expected, `gov_type ${type}`);
  }
  assert.equal(
    Object.values(EXPECTED).reduce((a, b) => a + b, 0),
    90_837,
    "the five types ARE the universe — a sixth type would mean the denominator moved",
  );
});

test("Open States reconciles: 7,439 state/territory/DC + 537 federal = 7,976", () => {
  const table = readTable("openstates_legislators");
  const idx = table.header.indexOf("jurisdiction_level");
  const counts = new Map<string, number>();
  for (const row of table.rows) counts.set(row[idx] ?? "", (counts.get(row[idx] ?? "") ?? 0) + 1);
  assert.equal(counts.get("state"), 7_439);
  assert.equal(counts.get("federal"), 537);
  assert.equal(table.count, 7_976);
});

/* ---- the recorded properties --------------------------------------------- */

test("the 339 dormant Census units are RETAINED", () => {
  const table = readTable("census_govt_units_2022");
  const idx = table.header.indexOf("is_active");
  const inactive = table.rows.filter((r) => r[idx] === "N").length;
  assert.equal(
    inactive,
    CENSUS_INACTIVE_UNITS,
    "the Census counts dormant units as governments. Filtering them breaks the " +
      "90,837 reconciliation, and nobody removes them without restating the denominator.",
  );
});

test("the 13 Texas special districts with blank place are left as a stated gap", () => {
  const table = readTable("census_govt_units_2022");
  const [st, city, zip, fips] = ["state", "city", "zip", "fips_state"].map((c) =>
    table.header.indexOf(c),
  );
  const blank = table.rows.filter(
    (r) =>
      (r[st] ?? "").trim() === "" &&
      (r[city] ?? "").trim() === "" &&
      (r[zip] ?? "").trim() === "" &&
      (r[fips] ?? "") === "48",
  );
  assert.equal(
    blank.length,
    CENSUS_BLANK_PLACE_TX_UNITS,
    "recoverable from fips_state = 48 and deliberately NOT filled in — a silently " +
      "repaired row is indistinguishable from a row that was always complete",
  );
});

test("web_address is a seed list for crawling, not a detection surface", () => {
  const table = readTable("census_govt_units_2022");
  const idx = table.header.indexOf("web_address");
  const blank = table.rows.filter((r) => (r[idx] ?? "").trim() === "").length;
  assert.equal(blank, CENSUS_BLANK_WEB_ADDRESS);
  const pct = (blank / table.count) * 100;
  assert.ok(
    pct > 56.8 && pct < 56.9,
    `blank for ${pct.toFixed(2)}% of units — the Census documents the populated 43% ` +
      "as having had minimal quality control, and a platform-signature scan returned " +
      "1 hit in 39,182 Census URLs and 0 in 17,346 CCD URLs. A blank here is NOT " +
      "'this body has no website'.",
  );
});

test("the Legistar file is 39 rows of fixture and claims no jurisdictions", () => {
  assert.equal(LEGISTAR_IS_FIXTURE_NOT_ENUMERATION, true);
  const table = readTable("granicus_legistar_tenants");
  assert.equal(table.count, 39, "a test-fixture convenience sample, NOT an enumeration");

  // Jurisdiction and state are blank ON PURPOSE. If they were populated the
  // file would start reading as a tenant roster, which is the claim it must
  // never make: no coverage figure may cite it as a tenant count.
  const [j, s] = ["jurisdiction_name", "state"].map((c) => table.header.indexOf(c));
  const named = table.rows.filter(
    (r) => (r[j] ?? "").trim() !== "" || (r[s] ?? "").trim() !== "",
  );
  assert.equal(
    named.length,
    0,
    "these rows grew a jurisdiction — the file now looks like an enumeration it is not",
  );
});

test("the BoardDocs file is deliberately empty, and zero is the correct state", () => {
  assert.equal(BOARDDOCS_IS_DELIBERATELY_EMPTY, true);
  const table = readTable("boarddocs_tenants");
  assert.equal(
    table.count,
    0,
    "header only, on purpose. Zero rows is NOT a failed acquisition and is NOT " +
      "evidence that BoardDocs has no tenants — roughly 4,000 organizations are missing.",
  );
  assert.ok(table.header.length > 5, "the header is present, so the shape is declared");
});

/* ---- nothing reads this data from outside the repo ----------------------- */

/** A module reading reference data from outside the repo works on one machine and narrows the denominator elsewhere. */
test("no module reads reference data from any path outside data/reference", () => {
  const ALLOWED = new Set(["lib/reference/index.ts"]);
  const DATASET_NAMES = ALL_REFERENCE_DATASETS.join("|");
  // A dataset named alongside a path that is not the sanctioned one.
  const OUTSIDE = new RegExp(
    `(?:cowork|/mnt/(?:user-)?data|["'\`][a-z]:[\\\\/]|~/|/home/|Desktop|OneDrive|\\boutputs/)[^"'\`\\n]*(?:${DATASET_NAMES})`,
    "i",
  );

  const offenders: string[] = [];
  for (const abs of walk(join(ROOT, "app"))
    .concat(walk(join(ROOT, "lib")), walk(join(ROOT, "scripts")), walk(join(ROOT, "components")))
    .filter((f) => /\.(ts|tsx|mts|mjs)$/.test(f))) {
    const rel = posixRelative(ROOT, abs);
    if (ALLOWED.has(rel)) continue;
    const source = readFileSync(abs, "utf8");
    // Comments explain the rule; code is what can reach a file.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
      .join("\n");
    if (OUTSIDE.test(code)) offenders.push(rel);
  }

  assert.deepEqual(
    offenders,
    [],
    "these reach reference data by a path that exists on one machine — read it " +
      "through lib/reference instead",
  );
});

test("the loader resolves every dataset inside data/reference", () => {
  for (const file of REFERENCE_DATA_FILES) {
    const dataset = file.replace(/\.(csv|json)$/, "");
    for (const name of [file, `${dataset}.md`]) {
      const p = posixRelative(ROOT, join(ROOT, "data", "reference", name));
      assert.equal(p, `data/reference/${name}`);
      assert.ok(statSync(join(ROOT, p)).size >= 0, `${p} is readable`);
    }
  }
});

test("the national county-clock JSON identifies its held NOAA bytes and preserves county identities", () => {
  const reference = JSON.parse(readFileSync(join(ROOT, "data", "reference", "national_county_time_zones.json"), "utf8"));
  assert.equal(reference.formatVersion, 1);
  assert.deepEqual(reference.columns, ["countyFips", "stateCode", "countyName", "ianaTimeZones"]);
  assert.equal(reference.source.url, "https://www.weather.gov/source/gis/Shapefiles/County/bp03mr20.dbx");
  assert.equal(reference.source.sha256, createHash("sha256").update(readFileSync(join(ROOT, reference.source.heldPath))).digest("hex"));
  const ids = reference.counties.map((row: unknown[]) => row[0]);
  assert.equal(new Set(ids).size, ids.length, "one county identity cannot silently replace another county's clock");
  assert.ok(ids.every((id: unknown) => typeof id === "string" && /^\d{5}$/.test(id)), "county FIPS keeps its leading zero");
  assert.ok(reference.counties.some((row: unknown[]) => Array.isArray(row[3]) && row[3].length > 1), "split counties retain multiple clocks");
});

/* ---- the parser the counts depend on ------------------------------------- */

/** The Census unit file carries quoted fields with embedded commas; a naive split would produce short rows. */
test("the CSV reader survives quoted commas, escaped quotes and embedded newlines", () => {
  const rows = parseCsv('a,b,c\n"x,1","he said ""hi""","line\nbreak"\nplain,2,3');
  assert.deepEqual(rows[0], ["a", "b", "c"]);
  assert.deepEqual(rows[1], ["x,1", 'he said "hi"', "line\nbreak"]);
  assert.deepEqual(rows[2], ["plain", "2", "3"]);
  assert.equal(rows.length, 3, "a final line without a trailing newline is still a row");
});

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
