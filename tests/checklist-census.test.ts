import assert from "node:assert/strict";
import test from "node:test";
import type { AssignmentSources } from "../lib/control-plane/assignment-view.ts";
import type { ExpansionScopeDecision } from "../lib/control-plane/expansion/scopes.ts";
import { buildChecklistCensus, exactScopeMembers } from "../lib/control-plane/readiness/checklist-census.ts";
import { evaluateChecklistSnapshot } from "../lib/control-plane/readiness/checklist-score.ts";

const scope={key:"zcta:2020/85635",receiptId:"original-send",budgetStartedAt:"2026-09-27T22:17:50.236Z"} as ExpansionScopeDecision;
const source=()=>({obligations:[
  {subjectId:"az:correct",assignments:[{assignmentKey:scope.key,ref:scope.receiptId}]},
  {subjectId:"az:wrong-send",assignments:[{assignmentKey:scope.key,ref:"different-send"}]},
  {subjectId:"az:wrong-scope",assignments:[{assignmentKey:"zcta:2020/85634",ref:scope.receiptId}]},
],workItems:[{id:"work",subject:"az:correct"},{id:"wrong",subject:"az:wrong-send"}],pipeline:[],workerResults:[
  {id:"parser:1",workItemId:"work",result:{role:"PARSER",verdict:"EXTRACTED",recordClass:"OFFICIAL_ROSTER",subjectId:"az:correct",artifactId:"artifact",records:[{id:"person:1"}]}},
  {id:"parser:wrong",workItemId:"wrong",result:{role:"PARSER",verdict:"EXTRACTED",recordClass:"OFFICIAL_ROSTER",subjectId:"az:wrong-send",artifactId:"wrong-artifact",records:[{id:"wrong:person"}]}},
]} as unknown as AssignmentSources);
const now="2026-09-28T09:00:00Z";

test("census uses exact saved instruction and keeps unmeasured universe open",()=>{
  assert.deepEqual([...exactScopeMembers([scope],source()).get(scope.key)!],["az:correct"]);
  const census=buildChecklistCensus({scope,sources:source(),observedAt:now});
  assert.equal(census.population.knownRecords,1);
  assert.equal(census.population.expectedObjects,null);
  assert.equal(new Set(census.instances.flatMap(i=>i.definitionIds)).size,325);
  assert.ok(census.instances.some(i=>i.objectId==="person:1"));
  assert.ok(!census.instances.some(i=>i.objectId==="wrong:person"));
  assert.equal(evaluateChecklistSnapshot(census).complete,false);
  assert.equal(evaluateChecklistSnapshot(census).results.filter(row=>row.passed).length,0);
});
test("retries cannot add objects, change inventory revision or earn checklist points",()=>{
  const initial=source();
  const first=buildChecklistCensus({scope,sources:initial,observedAt:now});
  const second=buildChecklistCensus({scope,sources:{...initial,workerResults:[...initial.workerResults,{...initial.workerResults[0],id:"parser:retry"}]},observedAt:"2026-09-28T10:00:00Z"});
  assert.equal(first.scopeRevision,second.scopeRevision);
  assert.equal(first.instances.length,second.instances.length);
  assert.equal(second.population.knownRecords,1);
});
test("failed read retains prior census and marks the current observation incomplete",()=>{
  const previous=buildChecklistCensus({scope,sources:source(),observedAt:now});
  const failed=buildChecklistCensus({scope,sources:null,observedAt:"2026-09-28T10:00:00Z",previous});
  assert.equal(failed.readsComplete,false);
  assert.deepEqual(failed.instances,previous.instances);
  assert.equal(failed.scopeRevision,previous.scopeRevision);
});
