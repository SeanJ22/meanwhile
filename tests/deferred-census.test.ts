import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = readFileSync(join(ROOT, "scripts", "deferred.mjs"), "utf8");
const CENSUS_MD = readFileSync(join(ROOT, "docs", "deferred.md"), "utf8");
const CENSUS_CSV = readFileSync(join(ROOT, "docs", "deferred.csv"), "utf8");
const TRACKER = readFileSync(join(ROOT, "docs", "tracker.csv"), "utf8");
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

test("the explainer column sits between Notes and Disposition", () => {
  // Split on the quote boundary, not on bare commas: a header name is allowed
  // to contain a comma, and the first version of this test broke on exactly
  // that. The column was renamed to drop the comma, but a test that only
  // passes because the data avoids the hazard is not testing anything.
  const header = CENSUS_CSV.split("\n")[0];
  const cols = [...header.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"'));

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
  // Parsed crudely on purpose: the last two fields of every record are the
  // explainer and the (empty) Disposition, and a quoted Notes field can hold
  // newlines, so this walks records rather than lines.
  const rows = CENSUS_CSV.split(/\n(?=")/).slice(1).filter((r) => r.trim() !== "");
  assert.ok(rows.length > 0, "the census CSV has no rows");

  let blank = 0;
  for (const row of rows) {
    // Trailing `,""` is Disposition; the field before it is the explainer.
    const m = /,("(?:[^"]|"")*"),""\s*$/.exec(row.trimEnd());
    assert.ok(m, `could not read the explainer cell of a row: ${row.slice(0, 40)}…`);
    if (m[1] === '""') blank++;
  }
  assert.equal(blank, 0, `${blank} row(s) carry an EMPTY explainer instead of a named gap`);
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
