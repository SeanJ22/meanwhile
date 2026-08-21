/**
 * THE CENSUS, SPLIT INTO TWO TABS — `pnpm deferred:xlsx`
 *
 * The author's ruling of 2026-08-17: non-code decisions were confusing mixed in
 * with build work. `docs/deferred.csv` becomes `docs/deferred.xlsx` with two
 * sheets — **Build** and **Non-code decisions** — and which rows go where is
 * read from `docs/deferred-noncode.json`, so correcting a mis-sort is one line
 * in a list rather than an argument with a script.
 *
 * ## Rows are MOVED, never altered
 *
 * Same columns on both tabs, in the same order, `Disposition` included exactly
 * as the author marked it. This reads the CSV and writes the workbook; it does
 * not regenerate the census, does not consult the tracker, and cannot change a
 * cell. The CSV remains the file `pnpm deferred` owns and this the view onto
 * it — the same relationship `context.md` has to `state.md`.
 *
 * ## The ZIP writer moved out (2026-08-20, Prompt E item 6)
 *
 * An `.xlsx` is a ZIP of XML parts and this repo has no spreadsheet library, so
 * the writer was ~200 lines living in this file. `docs/tracker.xlsx` needs the
 * same writer and a READER besides, and two copies of a ZIP codec is two places
 * for a byte-level bug to live. Both now come from `scripts/xlsx.mjs`; the
 * extraction was verified by regenerating this workbook and diffing it against
 * the committed one — byte-identical.
 *
 * Timestamps in the archive come from `pnpm stamp`, not the wall clock, so two
 * runs on the same day produce byte-identical workbooks and a diff means a
 * real change.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { today } from "./doc-dates.mjs";
import { buildWorkbook, parseCsv } from "./xlsx.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CSV_IN = "docs/deferred.csv";
const NONCODE_IN = "docs/deferred-noncode.json";
const XLSX_OUT = "docs/deferred.xlsx";

const BUILD_SHEET = "Build";
const NONCODE_SHEET = "Non-code decisions";

/* ------------------------------------------------------------------ main --- */

const stampedToday = today();

if (!existsSync(join(ROOT, CSV_IN))) {
  console.error(`\n${CSV_IN} not found — nothing to split. Nothing written.\n`);
  process.exit(1);
}

const grid = parseCsv(readFileSync(join(ROOT, CSV_IN), "utf8"));
const header = grid[0].map((h) => h.trim());
const rows = grid.slice(1);
const idAt = header.indexOf("ID");
if (idAt === -1) {
  console.error(`\n${CSV_IN} has no ID column — refusing to guess. Nothing written.\n`);
  process.exit(1);
}

const spec = JSON.parse(readFileSync(join(ROOT, NONCODE_IN), "utf8"));
const nonCodeIds = new Set([
  ...(spec.legal ?? []),
  ...(spec.business ?? []),
  ...(spec.rulingOnly?.ids ?? []),
]);

const buildRows = rows.filter((r) => !nonCodeIds.has(r[idAt].trim()));
const nonCodeRows = rows.filter((r) => nonCodeIds.has(r[idAt].trim()));

/* An id listed but absent from the CSV is a typo, and would silently shrink
 * neither tab — it would just never appear. Named, not swallowed. */
const present = new Set(rows.map((r) => r[idAt].trim()));
const missing = [...nonCodeIds].filter((id) => !present.has(id));

const problems = [];
if (buildRows.length + nonCodeRows.length !== rows.length) {
  problems.push(
    `${buildRows.length} build + ${nonCodeRows.length} non-code = ` +
      `${buildRows.length + nonCodeRows.length}, but the CSV holds ${rows.length} row(s)`,
  );
}
if (missing.length > 0) {
  problems.push(
    `${NONCODE_IN} names ID(s) the census does not hold: ${missing.join(", ")}`,
  );
}
if (problems.length > 0) {
  console.error("\npnpm deferred:xlsx — REFUSED, nothing written\n");
  for (const p of problems) console.error(`  ${p}`);
  console.error("");
  process.exit(1);
}

// Roughly: narrow keys, wide prose. Excel widths are in character units.
const widths = header.map((h) => {
  if (h === "ID") return 8;
  if (h === "Area" || h === "Priority" || h === "Status") return 14;
  if (h === "Depends on" || h === "Target") return 12;
  if (h === "Item") return 46;
  if (h === "Detail" || h === "Notes") return 70;
  if (h === "What this is asking you") return 70;
  if (h === "Disposition") return 46;
  return 20;
});

const book = buildWorkbook(
  [
    { name: BUILD_SHEET, header, rows: buildRows, widths },
    { name: NONCODE_SHEET, header, rows: nonCodeRows, widths },
  ],
  stampedToday,
);

writeFileSync(join(ROOT, XLSX_OUT), book);

const marked = (n) =>
  n.filter((r) => (r[header.indexOf("Disposition")] ?? "").trim() !== "").length;

console.log("\npnpm deferred:xlsx\n");
console.log(`  source                ${CSV_IN}, ${rows.length} row(s)`);
console.log(`  ${BUILD_SHEET.padEnd(21)} ${buildRows.length} row(s), ${marked(buildRows)} carrying a Disposition`);
console.log(`  ${NONCODE_SHEET.padEnd(21)} ${nonCodeRows.length} row(s), ${marked(nonCodeRows)} carrying a Disposition`);
console.log(`  split closes          ${buildRows.length} + ${nonCodeRows.length} = ${rows.length}`);
console.log(`  columns               ${header.length} on both tabs — ${header.join(", ")}`);
console.log(`  non-code IDs          ${nonCodeRows.map((r) => r[idAt].trim()).join(", ")}`);
console.log(`  ${XLSX_OUT}    ${book.length} bytes, generated ${stampedToday}`);
console.log("");
