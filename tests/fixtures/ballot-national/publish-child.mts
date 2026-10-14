import assert from "node:assert/strict";
import { runBallotPublication } from "../../../scripts/assemble-ballot-package.mts";
import { MemoryRoutineDataStore, assertRoutineDataStoreMutationAuthority } from "../../../lib/civic-data/store.ts";
import { readGenericBallotProjection } from "../../../lib/ballot/generic-projection.ts";
import { genericSourcesForDivisions } from "../../../lib/ballot/reader-sources.ts";
import { AUTOMATIC_REFRESH_TASKS } from "../../../lib/civic-data/automatic-refresh.ts";
import { durableRoutineRunnerReceiptIssue } from "../../../lib/civic-data/runner-receipt.ts";

const authority = assertRoutineDataStoreMutationAuthority();
assert.equal(authority.capability, "MANUAL_CONTRACT");
assert.equal(authority.contract, "ballot-contests");
const store = new MemoryRoutineDataStore();
const now = "2026-10-14T00:00:00.000Z";
const result = await runBallotPublication({ store, directory: process.argv[2], now });
console.log("BALLOT_PUBLICATION_RESULT=" + JSON.stringify(result.report));
if (result.receipt) {
  assert.equal(await durableRoutineRunnerReceiptIssue(result.receipt,
    AUTOMATIC_REFRESH_TASKS.find(task => task.id === "ballot-contests")!, store, "SUCCESS"), null);
  console.log("RCD_RECEIPT=" + JSON.stringify(result.receipt));
  const read = await readGenericBallotProjection({ store, now, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind === "PROMOTED") assert.equal(genericSourcesForDivisions(read.value, ["ocd-division/country:us/state:tx"]).length, 1);
}
process.exitCode = result.exitCode;
