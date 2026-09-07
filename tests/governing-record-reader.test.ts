import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("actual Arizona candidate cards preserve held records across chambers and an ordinary exact-seat incumbent", () => {
  // Child tsx follows the repository's existing SSR proof pattern; the native
  // test runner strips .ts while the actual ballot page contains JSX.
  const output = execFileSync(process.execPath, ["--import", "./scripts/register-test-loader.mjs", "--import", "tsx", "--input-type=module", "-e",
    'import {governingRecordReaderProof} from "./scripts/lib/governing-record-proof.ts"; console.log(JSON.stringify(await governingRecordReaderProof()));'],
  { cwd: process.cwd(), encoding: "utf8", timeout: 90_000, maxBuffer: 3_000_000 });
  const proof = JSON.parse(output) as Awaited<ReturnType<typeof import("../scripts/lib/governing-record-proof.ts").governingRecordReaderProof>>;
  assert.equal(proof.networkDisabled, true);
  assert.equal(proof.controls.length, 5);
  assert.equal(proof.controls.filter(row => row.switches).length, 4);
  for (const row of proof.controls) {
    assert.equal(row.heldRows, row.afterEligibleRows);
    assert.equal(row.heldRows, row.renderedExpandedRows);
    assert.ok(row.provenanceUnchanged && row.sourceRowsUnchanged);
    if (row.switches) {
      assert.equal(row.beforeEligibleRows, 0);
      assert.equal(row.exactSeatHolderId, null);
      assert.notEqual(row.standing, "INCUMBENT");
    } else assert.equal(row.standing, "INCUMBENT");
  }
  assert.ok(proof.census.checked > 300);
  assert.equal(proof.gaps.length, 3);
  assert.ok(proof.gaps.every(row => row.honestGapPreserved && row.recordSlot === null));
  assert.deepEqual(proof.census.lostRecordDeliveries, [], "previously delivered held records require an explicit identity disposition");
});
