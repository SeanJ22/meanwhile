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
],attempts:[],artifacts:[],workItems:[{id:"work",subject:"az:correct"},{id:"wrong",subject:"az:wrong-send"}],pipeline:[],workerResults:[
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

test("a legacy read without occurrence lineage leaves delivery timing unmeasured",()=>{
  const base=source();
  const census=buildChecklistCensus({scope,sources:{...base,occurrences:undefined} as unknown as AssignmentSources,observedAt:now});
  assert.equal(census.deliveryTimings,undefined);
});

test("a later same-key hunt keeps old parsed people in history until its own result is recorded",()=>{
  const later={...scope,receiptId:"later-send",budgetStartedAt:"2026-09-28T08:00:00Z"} as ExpansionScopeDecision;
  const base=source();
  const obligations=[{...base.obligations[0],assignments:[
    {assignmentKey:scope.key,ref:scope.receiptId,at:"2026-09-27T22:17:50.236Z"},
    {assignmentKey:scope.key,ref:later.receiptId,at:"2026-09-28T08:00:00Z"},
  ]},...base.obligations.slice(1)];
  const sources={...base,obligations,attempts:[{id:"attempt-old",startedAt:"2026-09-28T07:00:00Z"}],
    workerResults:[{...base.workerResults[0],attemptId:"attempt-old"}]};
  const old=buildChecklistCensus({scope:later,sources:sources as unknown as AssignmentSources,observedAt:now});
  assert.equal(old.population.knownRecords,0);
  assert.match(old.gaps.join(" "),/earlier parsed record/);
  const newer={...sources,workItems:[{id:"work",subject:"az:correct",autonomousPlan:{ownerInstructions:[later.receiptId],contract:{recordClass:"OFFICIAL_ROSTER"}}}],
    attempts:[...sources.attempts,{id:"attempt-new",startedAt:"2026-09-28T08:30:00Z"}],
    workerResults:[{...base.workerResults[0],attemptId:"attempt-new"}]};
  const after=buildChecklistCensus({scope:later,sources:newer as unknown as AssignmentSources,observedAt:now});
  assert.equal(after.population.knownRecords,1);
});
