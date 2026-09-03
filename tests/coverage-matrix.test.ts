import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { today } from "../scripts/doc-dates.mjs";
import { KELLY_FIELDS, type FieldState } from "../lib/hunt/kelly-depth.ts";
import {
  ASYMMETRY_THRESHOLD,
  CELL_STATES,
  MATRIX_COLUMNS,
  asymmetryFlags,
  cellFromKelly,
  kellyRows,
  loadKellyInputs,
  type MatrixRow,
} from "../lib/hunt/coverage-matrix.ts";

/**
 * **THE COVERAGE MATRIX.** (2026-08-25, Item 12; RULING 149.)
 *
 * The load-bearing claim is that the matrix's Kelly verdict IS `pnpm kelly`
 * rather than an agreement with it. That is asserted structurally — both call
 * the same loop — and then measured, because "they share a function" is the
 * kind of claim that survives a refactor which quietly stops being true.
 */

const ROOT = process.cwd();
const ZIP = "07866";
const TODAY = today();

test("the matrix and the scoreboard read the SAME loop, not two copies of it", () => {
  /*
   * RULING 103, asserted in the source. Two programs computing one judgement
   * is the thing that can disagree, and `kellyFieldHeld`'s own note records
   * that two implementations of it already did.
   */
  const scoreboard = readFileSync(join(ROOT, "scripts", "kelly-scoreboard.mts"), "utf8");
  const matrix = readFileSync(join(ROOT, "scripts", "coverage-matrix.mts"), "utf8");
  for (const [name, src] of [["scoreboard", scoreboard], ["matrix", matrix]] as const) {
    assert.match(src, /kellyRows\(/, `${name} does not call the shared loop`);
    assert.match(src, /loadKellyInputs\(/, `${name} does not call the shared loader`);
  }
  // And neither one keeps its own copy of the decision.
  assert.doesNotMatch(matrix, /kellyFieldHeld\(/, "the matrix recomputes the Kelly judgement");
});

test("every column carries a cell for every candidate — no silent blanks", () => {
  const inputs = loadKellyInputs(ROOT, ZIP);
  assert.ok(inputs.candidacies.length > 0, "the ballot is empty — this guard would pass vacuously");
  const readings = kellyRows(inputs, TODAY);

  for (const reading of readings.slice(0, 40)) {
    for (const field of KELLY_FIELDS) {
      const cell = cellFromKelly(field, reading.fields[field], TODAY);
      assert.ok(
        CELL_STATES.includes(cell.state),
        `${reading.subject}/${field} has a state outside the vocabulary: ${cell.state}`,
      );
      // Every cell states WHERE it came from. A blank source is a cell nobody
      // can check, which is the whole point of the artifact.
      assert.ok(cell.source.trim().length > 0, `${reading.subject}/${field} has no source`);
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(cell.date), `${reading.subject}/${field} has no date`);
    }
  }
});

test("an ARGUED absence carries its expiry, because it is a measurement with a shelf life", () => {
  /*
   * THE INVARIANT IS PROVEN FROM A FIXTURE, NOT FROM WHATEVER THE LIVE CORPUS
   * HOLDS TODAY. (2026-09-03, R5 — Daily Refresh truth & reliability.)
   *
   * The fact under test is the MAPPING: an `ARGUED_ABSENT` reading becomes an
   * `ABSENT` cell that carries an expiry, and that expiry is after the date the
   * absence was made. That mapping is `cellFromKelly`'s, and it must be
   * exercised on every run.
   *
   * The earlier form of this test asserted `checked > 0` over the live 07866
   * corpus — "at least one argued absence must currently stand". But an argued
   * absence is a measurement with a seven-day shelf life
   * (`CANDIDATE_FIELD_EXPIRY_DAYS`), and the whole 07866 corpus was walked on
   * one day (2026-08-26) and so expires on one day (2026-09-02). On 2026-09-03
   * `absenceStands` correctly reports NONE standing, every field is OWED again
   * (RULING 53), and the old assertion went red on the calendar with no defect
   * in code or data — and, in exactly that state, stopped testing the mapping
   * at all. Coupling a deterministic guard to time-expiring live data, and
   * losing all coverage the moment the data legitimately empties, is the
   * demonstrable defect; a fixture that never expires is the stronger guard.
   */
  const fixture: FieldState = { state: "ARGUED_ABSENT", at: "2026-01-01", expiresOn: "2026-01-08" };
  const fixtureCell = cellFromKelly("verifiedPage", fixture, "2026-01-05");
  assert.equal(fixtureCell.state, "ABSENT");
  assert.ok(fixtureCell.expiresOn, "the mapped ABSENT cell carries no expiry");
  assert.ok(fixtureCell.expiresOn! > fixtureCell.date, "an absence that expires before it was made");

  // And every argued absence that CURRENTLY stands in the live corpus obeys the
  // same rule. Zero standing is a legitimate state — the corpus expired and the
  // fields are owed again — so this loop is deliberately NOT guarded by a
  // nonzero count. It is a bonus check on real data, never the proof itself.
  const inputs = loadKellyInputs(ROOT, ZIP);
  const readings = kellyRows(inputs, TODAY);
  for (const reading of readings) {
    for (const field of KELLY_FIELDS) {
      const state = reading.fields[field];
      if (state.state !== "ARGUED_ABSENT") continue;
      const cell = cellFromKelly(field, state, TODAY);
      assert.equal(cell.state, "ABSENT");
      assert.ok(cell.expiresOn, `${reading.subject}/${field} is absent with no expiry`);
      assert.ok(cell.expiresOn! > cell.date, "an absence that expires before it was made");
    }
  }
});

test("the asymmetry flag is a fact about a CONTEST, never a score on a candidate", () => {
  /*
   * The equal-effort rule is a hunt discipline and this is its instrument. It
   * must never become a per-candidate completeness number — that is the
   * composite score this product does not compute, and RULING 149 is why this
   * artifact never reaches a reader.
   */
  const rows: MatrixRow[] = [
    {
      candidacyId: "a",
      name: "Well Covered",
      contestId: "c1",
      contestTitle: "A contest",
      district: "c1",
      party: "",
      incumbent: true,
      zip: ZIP,
      cycle: "2026",
      cells: Object.fromEntries(
        MATRIX_COLUMNS.map((c, i) => [c, { state: i < 6 ? "HELD" : "OWED", source: "x", date: TODAY }]),
      ),
      kellyVerdict: "DONE",
      kellyOwed: [],
    },
    {
      candidacyId: "b",
      name: "Thin",
      contestId: "c1",
      contestTitle: "A contest",
      district: "c1",
      party: "",
      incumbent: false,
      zip: ZIP,
      cycle: "2026",
      cells: Object.fromEntries(
        MATRIX_COLUMNS.map((c) => [c, { state: "OWED", source: "x", date: TODAY }]),
      ),
      kellyVerdict: "OWED",
      kellyOwed: ["photo"],
    },
  ] as MatrixRow[];

  const flags = asymmetryFlags(rows);
  assert.equal(flags.length, 1);
  assert.equal(flags[0].contestId, "c1");
  assert.equal(flags[0].spread, 6);
  assert.ok(flags[0].spread >= ASYMMETRY_THRESHOLD);

  // A contest with ONE candidate cannot be asymmetric between candidates.
  assert.deepEqual(asymmetryFlags([rows[0]]), []);
});

test("RULING 149: the matrix is never rendered to a reader", () => {
  /*
   * Asserted by ABSENCE across the reader surfaces, the same way the
   * questionnaire's no-summarisation rule is. In front of a reader this is a
   * completeness score per candidate, sorted.
   */
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(ROOT, dir))) {
      const full = join(ROOT, dir, entry);
      if (statSync(full).isDirectory()) {
        walk(join(dir, entry));
        continue;
      }
      if (!/\.tsx?$/.test(entry)) continue;
      const text = readFileSync(full, "utf8");
      if (/coverage-matrix/.test(text)) offenders.push(join(dir, entry));
    }
  };
  walk("app");
  walk("components");
  assert.deepEqual(
    offenders,
    [],
    `the coverage matrix is referenced from a reader surface: ${offenders.join(", ")}`,
  );
});

test("the CSV that ships has a cell state and a source for every fact column", () => {
  const path = join(ROOT, "docs", "coverage-matrix.csv");
  if (!existsSync(path)) return; // generated artifact; absent on a fresh clone
  const [header, ...rows] = readFileSync(path, "utf8").trim().split("\n");
  const columns = header.split('","').length;
  assert.ok(rows.length > 0, "the matrix CSV has a header and no rows");
  for (const column of MATRIX_COLUMNS) {
    assert.ok(header.includes(`"${column}"`), `the CSV has no ${column} column`);
    assert.ok(header.includes(`"${column}.source"`), `the CSV has no ${column}.source column`);
    assert.ok(header.includes(`"${column}.date"`), `the CSV has no ${column}.date column`);
  }
  assert.ok(columns > MATRIX_COLUMNS.length * 3, "the CSV lost columns");
});
