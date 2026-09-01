/**
 * **A CORRECTION TO A GATE RUN RECORD MAY NOT STATE A COUNT THE RECORD DOES
 * NOT CONTAIN.** (Part C, 2026-08-31.)
 *
 * `data/ops/gate-runs/<day>-<NN>.json` is written by `pnpm gates` and is
 * GENERATED, so it is never hand-edited (RULING 92). When a close-out says
 * something the record contradicts — 2026-08-31's said *14 of 14 gates green*
 * over a record whose `test` gate reads FAIL — the correction goes FORWARD,
 * into `data/ops/gate-runs/corrections/`, beside the record it corrects.
 *
 * A prose correction nothing checks is the same shape as the hand-typed status
 * strings `writeGateRunRecord` was built to replace. So each correction states
 * the record's true counts, and this test derives those counts from the record
 * itself and refuses a correction that disagrees with it. A correction may
 * explain the record; it may not restate it wrongly.
 *
 * The `corrections/` subdirectory is invisible to both readers of
 * `gate-runs/` — `scripts/gates.mjs` and `lib/ops/status-result.ts` both filter
 * on `<day>-<digits>.json`, which a directory name cannot match — so this adds
 * a discoverable file beside the records without changing what either reads.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const GATE_RUNS = join(ROOT, "data", "ops", "gate-runs");
const CORRECTIONS = join(GATE_RUNS, "corrections");

interface Correction {
  correctsRecord?: string;
  recordedAt?: string;
  testedSha?: string;
  actualFromTheRecord?: {
    gatesRecorded?: number;
    pass?: number;
    fail?: number;
    failing?: string[];
  };
  citedRecords?: { path?: string; says?: string }[];
}

interface GateRunRecord {
  testedSha: string | null;
  gates: { id: string; status: string }[];
}

function corrections(): { name: string; body: Correction }[] {
  if (!existsSync(CORRECTIONS)) return [];
  return readdirSync(CORRECTIONS)
    .filter((n) => n.endsWith(".json"))
    .map((n) => ({
      name: n,
      body: JSON.parse(readFileSync(join(CORRECTIONS, n), "utf8")) as Correction,
    }));
}

test("every gate-run correction names a record that exists", () => {
  for (const { name, body } of corrections()) {
    assert.ok(body.correctsRecord, `${name} names no record`);
    assert.ok(
      existsSync(join(ROOT, body.correctsRecord)),
      `${name} corrects ${body.correctsRecord}, which is not on disk`,
    );
  }
});

test("a correction's stated counts are the record's ACTUAL counts", () => {
  for (const { name, body } of corrections()) {
    const record = JSON.parse(
      readFileSync(join(ROOT, body.correctsRecord as string), "utf8"),
    ) as GateRunRecord;
    const pass = record.gates.filter((g) => g.status === "PASS");
    const notPass = record.gates.filter((g) => g.status !== "PASS");
    const stated = body.actualFromTheRecord ?? {};
    assert.equal(stated.gatesRecorded, record.gates.length, `${name}: gatesRecorded`);
    assert.equal(stated.pass, pass.length, `${name}: pass`);
    assert.equal(stated.fail, notPass.length, `${name}: fail`);
    assert.deepEqual(
      [...(stated.failing ?? [])].sort(),
      notPass.map((g) => g.id).sort(),
      `${name}: the failing gates named must be the gates the record says did not pass`,
    );
    assert.equal(stated.pass + stated.fail, record.gates.length, `${name}: the counts must total`);
  }
});

test("a correction names the tested SHA the record names", () => {
  for (const { name, body } of corrections()) {
    const record = JSON.parse(
      readFileSync(join(ROOT, body.correctsRecord as string), "utf8"),
    ) as GateRunRecord;
    assert.equal(body.testedSha, record.testedSha, `${name}: testedSha`);
  }
});

test("every record a correction cites as evidence exists on disk", () => {
  for (const { name, body } of corrections()) {
    const cited = body.citedRecords ?? [];
    assert.ok(cited.length > 0, `${name} cites no records — a reconciliation rests on something`);
    for (const entry of cited) {
      assert.ok(entry.path, `${name} has a cited record with no path`);
      assert.ok(
        existsSync(join(ROOT, entry.path as string)),
        `${name} cites ${entry.path}, which is not on disk. A correction that cites evidence ` +
          "which does not exist is the defect it was written to fix.",
      );
      assert.ok(entry.says, `${name} cites ${entry.path} without saying what it says`);
    }
  }
});

test("a correction carries the date it was recorded, from `pnpm stamp`", () => {
  for (const { name, body } of corrections()) {
    assert.match(String(body.recordedAt), /^\d{4}-\d{2}-\d{2}$/, `${name}: recordedAt`);
  }
});

test("the corrections directory is invisible to the gate-run readers", () => {
  /*
   * Both readers filter on `<yyyy-mm-dd>-<digits>.json`. If that ever loosens,
   * a correction would be parsed as a gate run and the status ledger would
   * read a document that has no `gates` array. Asserted here rather than
   * assumed, because the failure would be silent and would read as a broken
   * status surface.
   */
  const pattern = /^\d{4}-\d{2}-\d{2}-\d+\.json$/;
  assert.equal(pattern.test("corrections"), false);
  for (const { name } of corrections()) {
    assert.equal(pattern.test(name), true, `${name} must still sort as a dated record NAME`);
  }
});
