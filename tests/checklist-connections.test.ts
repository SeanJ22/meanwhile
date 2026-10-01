import test from "node:test";
import assert from "node:assert/strict";
import { checklistConnections, checklistConnectionIssues } from "../lib/control-plane/readiness/checklist-connections.ts";

test("complete definition and dataset inventory never turns missing store reads into zeros or passes",()=>{
  assert.deepEqual(checklistConnectionIssues(),[]);
  const view=checklistConnections({publication:{kind:"STORE_UNREACHABLE",detail:"read failed"}});
  assert.equal(view.definitions.length,325);assert.equal(view.families.length,42);
  assert.equal(view.manualContracts.filter(c=>c.id!=="jurisdiction-operational-reference-az").length,25);
  assert.ok(view.manualContracts.some(c=>c.id==="jurisdiction-operational-reference-az"));
  assert.equal(view.assessment,null);assert.equal(view.readFailure,"read failed");assert.ok(view.families.every(f=>f.observation==="UNREAD"));
});
test("a published source with a reader receipt is supporting evidence, not a full checklist pass",()=>{
  const view=checklistConnections({publication:{kind:"HELD",asOf:"2026-09-28T08:00:00Z",view:{counts:{READER_VISIBLE:1,READBACK_FAILED:0,PUBLISHED_NOT_READ_BACK:0,PUBLISHED_NO_READER_SURFACE:0,NOT_PUBLISHED:0},latestAttemptFailing:0,
    contracts:[{contractId:"registry-runtime-bindings",sourceId:"registry-reviewed-bindings",recordClass:"REGISTRY_RUNTIME_BINDING",scope:"US:reader-registry-runtime-bindings",
      published:{versionId:"v1",promotedAt:"2026-09-28T07:00:00Z"},readback:{status:"PASS",at:"2026-09-28T07:10:00Z",versionId:"v1"},latestAttempt:null,verdict:"READER_VISIBLE",says:"Exact typed reader readback"}]}}});
  assert.equal(view.families.find(f=>f.id==="body-rosters")?.contracts.length,1);
  assert.equal(view.assessment,null);assert.ok(view.assessmentGap?.includes("does not establish checklist completion"));
  assert.equal(view.manualContracts.find(c=>c.id==="registry-runtime-bindings")?.publication?.published?.versionId,"v1");
});
