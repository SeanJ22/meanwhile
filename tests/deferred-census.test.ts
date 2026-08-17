import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { MIRRORED_DOCS } from "../scripts/mirror-set.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = readFileSync(join(ROOT, "scripts", "deferred.mjs"), "utf8");
const CENSUS_MD = readFileSync(join(ROOT, "docs", "deferred.md"), "utf8");
const CENSUS_CSV = readFileSync(join(ROOT, "docs", "deferred.csv"), "utf8");
const TRACKER = readFileSync(join(ROOT, "docs", "tracker.csv"), "utf8");
const HANDOFF_SRC = readFileSync(join(ROOT, "scripts", "handoff.mjs"), "utf8");
const ASKS = JSON.parse(readFileSync(join(ROOT, "docs", "deferred-asks.json"), "utf8"));

/**
 * The deferred census (R31), guarded — 2026-08-17.
 *
 * These assert the SHAPE of the committed artefacts and the WIRING of the
 * generator, not its coverage. Asserting "every open row has an explainer"
 * would fail the whole suite the moment anyone opened a tracker row, blocking
 * unrelated work over a documentation gap — the generator reports that count
 * against its denominator on every run instead, which is where it belongs.
 */

/* --------------------------------------------- the one composed column --- */

/**
 * A real CSV parse — quoted fields, unquoted fields, CRLF, embedded newlines.
 *
 * Two earlier versions of these guards assumed the shape the GENERATOR emits:
 * first that no header name held a comma, then that every field was quoted.
 * Both assumptions died the moment the author opened the file in a spreadsheet
 * and saved it back — Excel quotes only the fields that need it and writes
 * CRLF, so a quote-boundary scan found nothing and the test reported that the
 * `Notes` column had been deleted. It had not.
 *
 * This file is round-tripped through a spreadsheet by design. A guard on it
 * has to read CSV, not the dialect one writer happens to produce.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

const CENSUS_GRID = parseCsv(CENSUS_CSV);

test("the explainer column sits between Notes and Disposition", () => {
  const cols = CENSUS_GRID[0].map((c) => c.trim());

  const notes = cols.indexOf("Notes");
  const ask = cols.indexOf("What this is asking you");
  const disp = cols.indexOf("Disposition");

  assert.ok(notes !== -1, "Notes column is gone");
  assert.ok(ask !== -1, "the plain-English explainer column is gone");
  assert.ok(disp !== -1, "Disposition column is gone");
  assert.equal(ask, notes + 1, "the explainer must come straight after Notes");
  assert.equal(disp, ask + 1, "Disposition must come straight after the explainer");
  assert.equal(disp, cols.length - 1, "Disposition must be the last column");
});

test("the generator writes the column in that position, not by luck", () => {
  assert.match(
    SCRIPT,
    /\[\.\.\.csvCols, ASK_COLUMN, "Disposition"\]/,
    "the CSV header no longer places the explainer between Notes and Disposition",
  );
  assert.match(
    SCRIPT,
    /csvCell\(asks\[r\.ID\] \?\? ASK_MISSING\)/,
    "a row without an explainer no longer falls back to the named gap",
  );
});

test("no explainer cell is ever blank — a blank reads as nothing to decide", () => {
  const cols = CENSUS_GRID[0].map((c) => c.trim());
  const at = cols.indexOf("What this is asking you");
  const rows = CENSUS_GRID.slice(1);

  assert.ok(at !== -1, "the explainer column is gone");
  assert.ok(rows.length > 0, "the census CSV has no rows");

  const blank = rows.filter((r) => (r[at] ?? "").trim() === "");
  assert.equal(
    blank.length,
    0,
    `${blank.length} row(s) carry an EMPTY explainer instead of a named gap: ${blank
      .map((r) => r[0])
      .join(", ")}`,
  );
});

test("the composed column never reaches the readable census", () => {
  // The .md claims nothing in it is composed. That claim is only true while
  // the explainers stay out of it.
  assert.ok(
    !CENSUS_MD.includes("RULE ON:"),
    "explainer text leaked into docs/deferred.md — its 'nothing is composed' claim is now false",
  );
  assert.ok(
    !CENSUS_MD.includes("no explainer written yet"),
    "the explainer gap marker leaked into docs/deferred.md",
  );
  assert.match(
    CENSUS_MD,
    /nothing is composed,\s*summarised or reworded/,
    "the census dropped its own no-composition claim",
  );
  // And it says where the composed writing DOES live, rather than leaving the
  // reader to discover a hand-written column in a spreadsheet.
  assert.match(CENSUS_MD, /deferred-asks\.json/, "the census no longer discloses where the explainers come from");
});

test("every explainer points at a tracker row that exists", () => {
  const ids = new Set(
    [...TRACKER.matchAll(/^"?([A-Z]+\d+)"?,/gm)].map((m) => m[1]),
  );
  assert.ok(ids.size > 100, `only ${ids.size} tracker IDs parsed — the parse is wrong`);

  const orphans = Object.keys(ASKS.asks ?? {}).filter((id) => !ids.has(id));
  assert.deepEqual(
    orphans,
    [],
    `explainer(s) written for ID(s) not in the tracker — a typo, or a deleted row: ${orphans.join(", ")}`,
  );
});

test("the explainers disclaim their own authority", () => {
  // They are the only composed content in the census, so the file has to say
  // what happens when one disagrees with the row it describes.
  assert.match(ASKS.note, /tracker row is right/i, "the asks file dropped its precedence rule");
  assert.ok(Object.keys(ASKS.asks ?? {}).length > 0, "the asks file is empty");
});

/* ------------------------------------------------ the census's own gates --- */

test("the run refuses rather than shipping a header that disagrees with its body", () => {
  assert.match(
    SCRIPT,
    /the header states \$\{open\.length\} open row\(s\) and the body rendered \$\{rendered\}/,
    "the count reconciliation is gone",
  );
  assert.match(
    SCRIPT,
    /REFUSED, nothing written/,
    "the refusal no longer says that nothing was written",
  );
  // The writes must happen AFTER the gate, or a refusal still leaves a file.
  const gate = SCRIPT.indexOf("if (problems.length > 0)");
  const firstWrite = SCRIPT.indexOf("writeFileSync(join(ROOT, MD_OUT)");
  assert.ok(gate > 0 && firstWrite > gate, "a file is written before the reconciliation gate runs");
});

test("the size cap names what would be cut instead of truncating", () => {
  assert.match(SCRIPT, /MD_CAP_BYTES = 40 \* 1024/, "the 40 KB census cap moved");
  assert.match(
    SCRIPT,
    /would have to be cut or/,
    "the size refusal no longer names what would have to go",
  );
  assert.ok(
    !/slice\(0, MD_CAP_BYTES\)/.test(SCRIPT),
    "the census now truncates itself to fit — silent truncation is what the cap exists to prevent",
  );
});

test("clipping never severs a future date from the annotation that legalises it", () => {
  // The real defect: a flat 200-char cut landed inside
  // `2026-11-03 [expected-future: NH general election …]` and produced a bare
  // future date beside a reason too short to be one. tests/doc-dates.test.ts
  // catches the symptom in the output; this pins the mechanism.
  assert.match(SCRIPT, /function clipNote/, "clipNote is gone — the clip is flat again");
  assert.match(SCRIPT, /lastUnclosedAnnotation/, "the unclosed-annotation walk-back is gone");
  assert.match(SCRIPT, /lastUnannotatedFutureDate/, "the bare-future-date walk-back is gone");
});

test("an empty history is not reported as an empty folder of commits", () => {
  assert.match(
    SCRIPT,
    /not recovered/,
    "the unrecovered-entry-date wording is gone — a missing date would be asserted as a duration",
  );
  assert.match(
    CENSUS_MD,
    /_not recovered_/,
    "no row reports an unrecovered entry date, though the history is only days deep",
  );
});

/* ------------------------------- the author's markings, and the split --- */

const XLSX_SCRIPT = readFileSync(join(ROOT, "scripts", "deferred-xlsx.mjs"), "utf8");
const NONCODE = JSON.parse(
  readFileSync(join(ROOT, "docs", "deferred-noncode.json"), "utf8"),
);

test("a routine run cannot destroy a Disposition the author wrote", () => {
  // 116 of 117 rows were marked and left in the working tree. Any ordinary
  // `pnpm deferred` between that moment and the commit would have erased them,
  // and the tracker does not carry the column, so nothing could have restored
  // it.
  assert.match(
    SCRIPT,
    /carries \$\{marked\.length\} row\(s\) with a Disposition/,
    "the Disposition refusal is gone",
  );

  // It must ride the SAME gate as every other refusal, which is what makes it
  // write nothing at all rather than skipping one file.
  const check = SCRIPT.indexOf("with a Disposition the author wrote");
  const gate = SCRIPT.indexOf("if (problems.length > 0)");
  const firstWrite = SCRIPT.indexOf("writeFileSync(join(ROOT, MD_OUT)");
  assert.ok(check > 0 && gate > check, "the Disposition check runs after the refusal gate");
  assert.ok(firstWrite > gate, "a file is written before the gate that protects the markings");

  // No escape hatch. This one guards work that re-running cannot recover.
  assert.ok(
    !/--force|--overwrite|ALLOW_OVERWRITE|--no-disposition/.test(SCRIPT),
    "a flag was added that lets a run overwrite the author's markings",
  );
});

test("the split moves rows and cannot alter one", () => {
  // The xlsx is a VIEW of the CSV. It reads the CSV and writes a workbook; it
  // never consults the tracker and never composes a cell.
  assert.ok(
    !/tracker\.csv/.test(XLSX_SCRIPT),
    "the workbook generator now reads the tracker — it must read only the census CSV",
  );
  assert.match(XLSX_SCRIPT, /const CSV_IN = "docs\/deferred\.csv"/);
  assert.match(
    XLSX_SCRIPT,
    /buildRows\.length \+ nonCodeRows\.length !== rows\.length/,
    "the split no longer checks that it closes — rows could vanish between tabs",
  );
  assert.match(
    XLSX_SCRIPT,
    /REFUSED, nothing written/,
    "the workbook generator no longer refuses loudly",
  );
});

test("every non-code id names a row the census holds", () => {
  const cols = CENSUS_GRID[0].map((c) => c.trim());
  const ids = new Set(CENSUS_GRID.slice(1).map((r) => r[cols.indexOf("ID")].trim()));
  const listed = [
    ...(NONCODE.legal ?? []),
    ...(NONCODE.business ?? []),
    ...(NONCODE.rulingOnly?.ids ?? []),
  ];

  assert.ok(listed.length > 0, "the non-code list is empty");
  assert.equal(new Set(listed).size, listed.length, "an id is listed twice");

  const orphans = listed.filter((id) => !ids.has(id));
  assert.deepEqual(orphans, [], `non-code id(s) the census does not hold: ${orphans.join(", ")}`);

  // The author's enumerated legal and business rows, pinned. If one silently
  // leaves the list, the row quietly rejoins the build tab.
  for (const id of ["B05", "B08", "B09", "D23"]) {
    assert.ok(NONCODE.legal.includes(id), `${id} left the legal list`);
  }
  for (const id of ["B01", "B02", "B03", "B04", "B06", "B07", "T04", "X02", "X03"]) {
    assert.ok(NONCODE.business.includes(id), `${id} left the business list`);
  }
});

test("a binary mirror entry is compared as bytes, never as trimmed text", () => {
  const xlsx = MIRRORED_DOCS.find((d) => d.mirrorName === "deferred.xlsx");
  assert.ok(xlsx, "deferred.xlsx left the mirror set");
  assert.equal(xlsx.binary, true, "deferred.xlsx is no longer marked binary");

  // Reading a zip through a utf8 decode and trimming whitespace compares two
  // corrupted strings, so the mirror's history check would answer "matches no
  // version" and refuse every ordinary update of the workbook.
  assert.match(HANDOFF_SRC, /function gitShowBuffer/, "the raw-bytes git read is gone");
  assert.match(
    HANDOFF_SRC,
    /Buffer\.compare\(past, target\) === 0/,
    "binary mirror entries are no longer compared byte for byte",
  );
  // And it must NOT go through tryRun, whose trailing .trim() throws on a Buffer
  // and returns null — indistinguishable from "no match".
  assert.ok(
    !/tryRun\("git", \["show", `\$\{rev\}:\$\{repoPath\}`\], \{\s*encoding: "buffer"/.test(
      HANDOFF_SRC,
    ),
    "the binary read went back through tryRun, whose .trim() swallows it into null",
  );
});
