/**
 * Verify `data/reference/` against its committed expectations (Prompt B item
 * 2, 2026-08-20).
 *
 * Reconciliation is against the INGESTED ROWS, never against the provenance
 * note's claim — a note is a claim about the file, and checking a claim
 * against itself proves nothing. Where the file and the note disagree, this
 * prints the disagreement and exits non-zero. It never adjusts an expectation
 * to match what it found.
 *
 * Run:  corepack pnpm reference:verify
 */

import {
  CENSUS_BLANK_PLACE_TX_UNITS,
  CENSUS_BLANK_WEB_ADDRESS,
  CENSUS_INACTIVE_UNITS,
  REFERENCE_DATASETS,
  REFERENCE_ROW_COUNTS,
  readTable,
  referenceFiles,
} from "../lib/reference/index.ts";

let failures = 0;
const bad = (msg: string) => {
  failures += 1;
  console.log(`  *** ${msg}`);
};

/* ---- 2a: inventory and pairing ------------------------------------------- */

const files = referenceFiles();
const data = files.filter((f) => f.endsWith(".csv"));
const notes = files.filter((f) => f.endsWith(".md"));
console.log(
  `INVENTORY: ${files.length} of 14 files — ${data.length} data files, ${notes.length} provenance notes`,
);
if (files.length !== 14) bad(`expected 14 files, found ${files.length}: ${files.join(", ")}`);

console.log("\nPAIRINGS:");
const noteSet = new Set(notes);
const dataSet = new Set(data);
for (const d of data) {
  const note = d.replace(/\.csv$/, ".md");
  console.log(`  ${d}  <->  ${noteSet.has(note) ? note : "*** NO NOTE ***"}`);
  if (!noteSet.has(note)) bad(`${d} has no provenance note`);
}
for (const n of notes) {
  if (!dataSet.has(n.replace(/\.md$/, ".csv"))) bad(`${n} describes no data file`);
}

/* ---- 2b: row counts, found / expected ------------------------------------ */

console.log("\nROW COUNTS (found / expected):");
const counts = new Map<string, number>();
for (const dataset of REFERENCE_DATASETS) {
  const table = readTable(dataset);
  counts.set(dataset, table.count);
  const expected = REFERENCE_ROW_COUNTS[dataset];
  const verdict = table.count === expected ? "OK" : "*** MISMATCH ***";
  console.log(
    `  ${dataset.padEnd(48)} ${String(table.count).padStart(6)} / ${String(expected).padStart(6)}  ${verdict}  (${table.header.length} columns)`,
  );
  if (table.count !== expected) {
    bad(`${dataset}: found ${table.count}, expected ${expected}`);
  }
}

/* The workbook reconciliation the Census file's note asserts. */
const units = counts.get("census_govt_units_2022") ?? 0;
const dependent = counts.get("census_govt_units_2022_dependent_school_systems") ?? 0;
console.log(
  `\nWORKBOOK RECONCILIATION: ${units} + ${dependent} = ${units + dependent} (expected 92,150 — every data row in the source workbook)`,
);
if (units + dependent !== 92_150) bad(`workbook total is ${units + dependent}, not 92,150`);

/* The Census unit file's own type breakdown. */
const censusUnits = readTable("census_govt_units_2022");
const typeIdx = censusUnits.header.indexOf("gov_type");
const byType = new Map<string, number>();
for (const row of censusUnits.rows) {
  const t = row[typeIdx] ?? "";
  byType.set(t, (byType.get(t) ?? 0) + 1);
}
const EXPECTED_TYPES: Record<string, number> = {
  COUNTY: 3_031,
  MUNICIPAL: 19_491,
  TOWNSHIP: 16_214,
  "SPECIAL DISTRICT": 39_555,
  "SCHOOL DISTRICT": 12_546,
};
console.log("\nCENSUS TYPE BREAKDOWN (found / expected):");
for (const [type, expected] of Object.entries(EXPECTED_TYPES)) {
  const found = byType.get(type) ?? 0;
  console.log(
    `  ${type.padEnd(20)} ${String(found).padStart(6)} / ${String(expected).padStart(6)}  ${found === expected ? "OK" : "*** MISMATCH ***"}`,
  );
  if (found !== expected) bad(`gov_type ${type}: found ${found}, expected ${expected}`);
}
const unlisted = [...byType.entries()].filter(([t]) => !(t in EXPECTED_TYPES));
if (unlisted.length) {
  console.log(`  OTHER TYPES PRESENT: ${unlisted.map(([t, n]) => `${t}=${n}`).join(", ")}`);
}

/* ---- 2c: the recorded properties ----------------------------------------- */

console.log("\nRECORDED PROPERTIES (found / expected):");

const activeIdx = censusUnits.header.indexOf("is_active");
const inactive = censusUnits.rows.filter((r) => r[activeIdx] === "N").length;
console.log(
  `  is_active = N, RETAINED         ${String(inactive).padStart(6)} / ${String(CENSUS_INACTIVE_UNITS).padStart(6)}  ${inactive === CENSUS_INACTIVE_UNITS ? "OK" : "*** MISMATCH ***"}`,
);
if (inactive !== CENSUS_INACTIVE_UNITS) bad(`is_active=N: found ${inactive}`);

const webIdx = censusUnits.header.indexOf("web_address");
const blankWeb = censusUnits.rows.filter((r) => (r[webIdx] ?? "").trim() === "").length;
const pct = ((blankWeb / censusUnits.rows.length) * 100).toFixed(2);
console.log(
  `  web_address blank               ${String(blankWeb).padStart(6)} / ${String(CENSUS_BLANK_WEB_ADDRESS).padStart(6)}  ${blankWeb === CENSUS_BLANK_WEB_ADDRESS ? "OK" : "*** MISMATCH ***"}  (${pct}% — SEED LIST, not a detection surface)`,
);
if (blankWeb !== CENSUS_BLANK_WEB_ADDRESS) bad(`blank web_address: found ${blankWeb}`);

const stIdx = censusUnits.header.indexOf("state");
const cityIdx = censusUnits.header.indexOf("city");
const zipIdx = censusUnits.header.indexOf("zip");
const fipsIdx = censusUnits.header.indexOf("fips_state");
const blankTx = censusUnits.rows.filter(
  (r) =>
    (r[stIdx] ?? "").trim() === "" &&
    (r[cityIdx] ?? "").trim() === "" &&
    (r[zipIdx] ?? "").trim() === "" &&
    (r[fipsIdx] ?? "") === "48",
).length;
console.log(
  `  TX blank state/city/zip         ${String(blankTx).padStart(6)} / ${String(CENSUS_BLANK_PLACE_TX_UNITS).padStart(6)}  ${blankTx === CENSUS_BLANK_PLACE_TX_UNITS ? "OK" : "*** MISMATCH ***"}  (recoverable, left as a stated gap)`,
);
if (blankTx !== CENSUS_BLANK_PLACE_TX_UNITS) bad(`TX blank-place rows: found ${blankTx}`);

/* item 3: the join key. `census_id_gidid` is legacy and blank on 36 rows. */
const gididIdx = censusUnits.header.indexOf("census_id_gidid");
const pid6Idx = censusUnits.header.indexOf("census_id_pid6");
const blankGidid = censusUnits.rows.filter((r) => (r[gididIdx] ?? "").trim() === "").length;
const pid6 = new Set(censusUnits.rows.map((r) => r[pid6Idx]));
console.log(
  `  census_id_gidid blank           ${String(blankGidid).padStart(6)} /     36  ${blankGidid === 36 ? "OK" : "*** MISMATCH ***"}  (legacy — never a join key)`,
);
if (blankGidid !== 36) bad(`blank gidid: found ${blankGidid}`);
console.log(
  `  census_id_pid6 distinct         ${String(pid6.size).padStart(6)} / ${String(censusUnits.rows.length).padStart(6)}  ${pid6.size === censusUnits.rows.length ? "OK — unique, the join key" : "*** NOT UNIQUE ***"}`,
);
if (pid6.size !== censusUnits.rows.length) bad("census_id_pid6 is not unique — it is the join key");

console.log(
  failures === 0
    ? "\nRESULT: reference data verified, 0 mismatches."
    : `\nRESULT: ${failures} MISMATCH(ES) — stated, not smoothed. Expectations were not adjusted.`,
);
process.exit(failures === 0 ? 0 : 1);
