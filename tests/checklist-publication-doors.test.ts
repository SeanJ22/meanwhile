import assert from "node:assert/strict";
import test from "node:test";
import { CHECKLIST_PUBLICATION_DOORS, checklistPublicationDoors, workerDoorForRecord } from "../lib/civic-data/worker-reader-contracts.ts";
import { manualProductionContract } from "../lib/civic-data/manual-contracts.ts";

test("BX-07: every mapped door is executable, and family fields use the same map as new work", () => {
  for (const mapping of CHECKLIST_PUBLICATION_DOORS) {
    assert.ok(manualProductionContract(mapping.contractId));
    for (const record of mapping.recordClasses) assert.equal(workerDoorForRecord(record), mapping.contractId);
    for (const field of mapping.fields) assert.ok(checklistPublicationDoors(mapping.family, field).includes(mapping));
  }
  assert.equal(workerDoorForRecord("UNKNOWN"), null);
  assert.deepEqual(checklistPublicationDoors("GEO"), []);
});
