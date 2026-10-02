import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/**
 * **RULING 72 — a walled host is never evidence a body is unreachable.**
 * (Adopted 2026-08-22, NJ Hunt 3 item 4.)
 *
 * Discovery is a tree. A host refusing is ONE BRANCH returning empty on ONE
 * DATE; the body is still reachable by a federal directory, a phone number, a
 * postal address, a parent agency, a published report, a person. **So a wall
 * may never be recorded without naming which other branches were tried.**
 *
 * ELEC is the instance it was adopted over. This repo had it written down as a
 * permanent wall, and the FEC's Combined Federal/State Disclosure Directory —
 * committed to `data/reference/` since NJ Hunt 2, 349 offices across 56
 * jurisdictions — carries its street address and its phone number. Nobody had
 * looked, because nothing required looking. That is what this file changes: the
 * requirement is now mechanical, so the next wall cannot be recorded on a rung
 * history alone.
 *
 * **Why this reads the source rather than importing the array.**
 * `scripts/rewalk-walls.mts` runs a live re-walk at module scope — importing it
 * would fire ten HTTP requests inside the suite, and `tests/fixtures/` exists
 * precisely so no test makes a live call. The shape is what is being guarded,
 * and the shape is readable.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SOURCE = readFileSync(join(ROOT, "scripts", "rewalk-walls.mts"), "utf8");

/** Just the WALLS array literal, so the type declaration above it is not read as a row. */
function wallsBlock(): string {
  const start = SOURCE.indexOf("}[] = [");
  const end = SOURCE.indexOf("\n];", start);
  assert.ok(start > 0 && end > start, "the WALLS array could not be located — has it been renamed?");
  return SOURCE.slice(start, end);
}

/** One record per wall, as raw text. */
function records(): { host: string; text: string }[] {
  const block = wallsBlock();
  const out: { host: string; text: string }[] = [];
  const parts = block.split(/\n  \{\n/).slice(1);
  for (const part of parts) {
    const host = /host: "([^"]+)"/.exec(part)?.[1];
    if (host) out.push({ host, text: part });
  }
  return out;
}

test("RULING 72: every recorded wall names the branches tried", () => {
  const missing = records()
    .filter((r) => !/branchesTried:/.test(r.text))
    .map((r) => r.host);
  assert.deepEqual(
    missing,
    [],
    "a wall recorded without naming what else was tried is a rung history presented as a verdict — " +
      "which is the shape RULING 52 was adopted over and RULING 72 closes",
  );
});

test("RULING 72: the branches field is a SENTENCE, never an empty gesture", () => {
  /*
   * The bar is deliberately low and deliberately non-zero. What matters is that
   * a person had to write down what else they tried; a field that could be
   * satisfied with "" or "n/a" would be satisfied with "" or "n/a".
   */
  const thin: string[] = [];
  for (const r of records()) {
    const value = /branchesTried:\s*\n?\s*"((?:[^"\\]|\\.)*)"/.exec(r.text)?.[1] ?? "";
    if (value.trim().length < 40) thin.push(`${r.host}: ${value.length} chars`);
  }
  assert.deepEqual(thin, [], "these say nothing about what else was tried");
});

test("RULING 72: every wall states the DATE it was recorded", () => {
  // RULING 53: a source recorded as walled is recorded with the date it was
  // last tested, never as a standing property.
  const undated = records()
    .filter((r) => !/recorded: "\d{4}-\d{2}-\d{2}"/.test(r.text))
    .map((r) => r.host);
  assert.deepEqual(undated, [], "a wall with no date cannot expire, and RULING 53 says every wall expires");
});

test("RULING 72: ELEC is recorded, with the FEC directory named as its branch", () => {
  /*
   * The specific instance, pinned. ELEC was written down as a permanent wall
   * while the answer sat in a committed CSV. If a later session removes this
   * row, the removal should have to be deliberate.
   */
  const elec = records().find((r) => r.host === "www.elec.nj.gov");
  assert.ok(elec, "ELEC is the wall RULING 72 was adopted over and belongs on the list");
  assert.match(
    elec.text,
    /fec_combined_federal_state_disclosure_directory/,
    "the branch that reaches ELEC without going through its host is the FEC directory, and it is named",
  );
});

test("RULING 72: the FEC directory this repo cross-checks against is really here", () => {
  /*
   * The branches above are only worth anything if the file they name exists and
   * holds what they say it holds. A guard that trusted the prose would be the
   * same defect one layer up.
   */
  const csv = readFileSync(
    join(ROOT, "data", "reference", "fec_combined_federal_state_disclosure_directory.csv"),
    "utf8",
  );
  const rows = csv.split(/\r?\n/).filter(Boolean);
  assert.ok(rows.length > 300, `the FEC directory holds ${rows.length - 1} offices, which is too few to be the real file`);
  assert.match(rows[0] ?? "", /jurisdiction,office/, "the header is the directory's own");
  const elecRow = rows.find((r) => /^NEW JERSEY,ELECTION LAW ENFORCEMENT COMMISSION/.test(r));
  assert.ok(elecRow, "ELEC's own row is in the directory");
  assert.match(elecRow, /609\/\d{3}-?\d{4}|\d{3}\/\d{3}-\d{4}/, "with a phone number on it");
});
