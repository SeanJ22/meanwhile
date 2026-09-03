import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { today } from "../scripts/doc-dates.mjs";
import { KELLY_FIELDS, STUCK_MOVES, type ArguedAbsence } from "../lib/hunt/kelly-depth.ts";
import {
  ASYMMETRY_THRESHOLD,
  CELL_STATES,
  MATRIX_COLUMNS,
  asymmetryFlags,
  cellFromKelly,
  kellyRows,
  loadKellyInputs,
  type KellyInputs,
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
  // The current corpus can correctly have no unexpired absences. Exercise the
  // shared protocol/row/cell path at fixed instants without renewing civic data.
  const candidacyId = "fixture:coverage-matrix:absence";
  const absences: ArguedAbsence[] = KELLY_FIELDS.map((field) => ({
    candidacyId, field, at: "2026-08-26", expiresOn: "2026-09-02",
    argument: "Synthetic regression control; never a production absence.",
    protocol: STUCK_MOVES.map((move) => ({
      move, query: `fixture query for ${field}: ${move}`, result: "fixture source reached; field not found", reached: true,
    })),
  }));
  const inputs: KellyInputs = {
    zip: ZIP, label: "Expiry control", contests: [{ id: "fixture:contest", title: "Fixture contest" }],
    candidacies: [{ id: candidacyId, contestId: "fixture:contest", givenName: "Fixture", familyName: "Candidate" }],
    cards: {}, links: {}, filedEmail: new Map(), photoOnDisk: () => false,
    absenceFor: new Map(absences.map((absence) => [`${candidacyId}|${absence.field}`, absence])),
    absenceCount: absences.length,
  };
  for (const onDay of ["2026-09-01", "2026-09-02"]) {
    const [reading] = kellyRows(inputs, onDay);
    for (const field of KELLY_FIELDS) {
      const state = reading.fields[field];
      assert.equal(state.state, "ARGUED_ABSENT", `${field} must satisfy the complete, reached protocol before expiry`);
      const cell = cellFromKelly(field, state, onDay);
      assert.equal(cell.state, "ABSENT");
      assert.ok(cell.expiresOn, `${reading.subject}/${field} is absent with no expiry`);
      assert.ok(cell.expiresOn > cell.date, "an absence that expires before it was made");
      assert.equal(cell.date, "2026-08-26", "the original observation date survives projection");
      assert.equal(cell.expiresOn, "2026-09-02", "projection must not renew the absence");
    }
  }
  const [expired] = kellyRows(inputs, "2026-09-03");
  assert.equal(expired.done, false);
  assert.deepEqual(expired.owed, [...KELLY_FIELDS]);
  for (const field of KELLY_FIELDS) {
    assert.equal(expired.fields[field].state, "OWED");
    const cell = cellFromKelly(field, expired.fields[field], "2026-09-03");
    assert.equal(cell.state, "OWED", "an expired absence cannot remain an ABSENT matrix cell");
    assert.match(cell.source, /STALE.*expired 2026-09-02/);
    assert.equal(cell.expiresOn, undefined);
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
