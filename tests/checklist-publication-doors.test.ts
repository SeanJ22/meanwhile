import assert from "node:assert/strict";
import test from "node:test";
import { CHECKLIST_PUBLICATION_DOORS, COMMENT_RULE_PUBLICATION, checklistPublicationDoors, workerDoorForRecord } from "../lib/civic-data/worker-reader-contracts.ts";
import { manualProductionContract } from "../lib/civic-data/manual-contracts.ts";

test("every mapped door is executable, and family fields use the same map as new work", () => {
  for (const mapping of CHECKLIST_PUBLICATION_DOORS) {
    assert.ok(mapping.contractId === COMMENT_RULE_PUBLICATION || manualProductionContract(mapping.contractId), `${mapping.contractId} publishes through a contract or as facts`);
    for (const record of mapping.recordClasses) assert.equal(workerDoorForRecord(record), mapping.contractId);
    for (const field of mapping.fields) assert.ok(checklistPublicationDoors(mapping.family, field).includes(mapping));
  }
  assert.equal(workerDoorForRecord("UNKNOWN"), null);
  assert.deepEqual(checklistPublicationDoors("GEO"), []);
});
