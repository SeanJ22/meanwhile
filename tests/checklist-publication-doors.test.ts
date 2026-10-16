import checklist from "../lib/coverage/checklist-map.json" with { type: "json" };
import assert from "node:assert/strict";
import test from "node:test";
import { COMMENT_RULE_PUBLICATION, checklistPublicationDoors, workerDoorForRecord } from "../lib/civic-data/worker-reader-contracts.ts";
import { manualProductionContract } from "../lib/civic-data/manual-contracts.ts";

test("every mapped door is executable, and family fields use the same map as new work", () => {
  for (const mapping of checklist.publicationDoors) {
    const contractId = ["ballot-contests", "voting-sites"].includes(mapping.contractId) ? `${mapping.contractId}:AZ` : mapping.contractId;
    assert.ok(contractId === COMMENT_RULE_PUBLICATION || manualProductionContract(contractId), `${contractId} publishes through a contract or as facts`);
    for (const record of mapping.recordClasses) assert.equal(workerDoorForRecord(record, "AZ"), ["ballot-contests", "voting-sites"].includes(mapping.contractId) ? `${mapping.contractId}:AZ` : mapping.contractId);
    for (const field of mapping.fields) assert.ok(checklistPublicationDoors(mapping.family, field).some(row => row.contractId === mapping.contractId));
  }
  assert.equal(workerDoorForRecord("UNKNOWN"), null);
  assert.equal(workerDoorForRecord("BALLOT_CONTEST"), null);
  assert.equal(workerDoorForRecord("VOTING_SITE"), null);
  assert.equal(workerDoorForRecord("BALLOT_MEASURE", "NH"), "ballot-contests:NH");
  assert.deepEqual(checklistPublicationDoors("GEO"), []);
});
