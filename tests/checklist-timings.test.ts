import assert from "node:assert/strict";
import test from "node:test";
import type { AssignmentSources } from "../lib/control-plane/assignment-view.ts";
import { checklistDeliveryTimings } from "../lib/control-plane/readiness/checklist-timings.ts";

const at=(minute:number)=>`2026-09-28T09:${String(minute).padStart(2,"0")}:00Z`;
const sources=()=>({
  workItems:[{id:"work",subject:"subject",createdAt:at(0),autonomousPlan:{contract:{recordClass:"OFFICIAL_ROSTER"}},
    publicationOutcome:{status:"PUBLISHED",workerResultId:"audit",candidateId:"candidate",versionId:"version",at:at(6)}}],
  attempts:[{workItemId:"work",startedAt:at(1)}],
  artifacts:[{workItemId:"work",recordedAt:at(2),partial:false,tier:"PUBLIC_RAW"}],
  workerResults:[
    {id:"parser",workItemId:"work",endedAt:at(3),inputResultIds:[],result:{role:"PARSER",verdict:"EXTRACTED"}},
    {id:"validator",workItemId:"work",endedAt:at(4),inputResultIds:["parser"],result:{role:"VALIDATOR",verdict:"PASS"}},
    {id:"audit",workItemId:"work",endedAt:at(5),inputResultIds:["validator"],result:{role:"ADVERSARIAL_AUDITOR",verdict:"SURVIVED"}},
    {id:"later-parser",workItemId:"work",endedAt:at(9),inputResultIds:[],result:{role:"PARSER",verdict:"EXTRACTED"}},
  ],
  servedReader:{checkedAt:at(8),witnesses:[{itemId:"work",approvalId:"audit",versionId:"version",checkedAt:at(8),state:"CONFIRMED"}],errors:[]},
} as unknown as AssignmentSources);
const run=(source:AssignmentSources,now=at(10))=>checklistDeliveryTimings(source,new Set(["subject"]),now)[0]!;

test("delivery clocks bind parser, approval and version without inventing source or readiness times",()=>{
  const timing=run(sources());
  assert.equal(timing.parsedAt,at(3));
  assert.equal(timing.verifiedAt,at(5));
  assert.equal(timing.visibleAt,at(8));
  assert.equal(timing.verifiedToReadbackMs,180000);
  assert.equal(timing.sourcePublishedAt,null);
  assert.equal(timing.readyAt,null);
  assert.equal(timing.registeredToStartMs,60000);
  assert.equal(timing.waitingFor,"NONE");
  assert.equal(timing.workAgeMs,null);
});
test("an unrelated passed audit cannot fill a missing publication audit",()=>{
  const source=sources();
  const timing=run({...source,workerResults:source.workerResults.map(row=>row.id==="audit"?{...row,id:"other-audit"}:row)});
  assert.equal(timing.verifiedAt,null);
  assert.equal(timing.parsedAt,null);
  assert.equal(timing.verifiedToReadbackMs,null);
});
test("a readback for another version leaves the work unfinished with original registration age",()=>{
  const source=sources();
  const timing=run({...source,servedReader:{...source.servedReader!,witnesses:source.servedReader!.witnesses.map(w=>({...w,versionId:"different"}))}});
  assert.equal(timing.visibleAt,null);
  assert.equal(timing.waitingFor,"PUBLIC_READBACK");
  assert.equal(timing.unfinishedAgeMs,240000);
  assert.equal(timing.workAgeMs,600000);
});
test("partial publication needs the exact audit to cover all accepted record IDs",()=>{
  const source=sources();
  const partial={...source,workItems:source.workItems.map(w=>({...w,publicationOutcome:{...w.publicationOutcome!,acceptedRecordIds:["person:1"]}})),
    workerResults:source.workerResults.map(row=>row.id==="audit"?{...row,result:{...row.result,verdict:"BROKE",survivingRecordIds:["person:1"]}}:row)} as AssignmentSources;
  assert.equal(run(partial).verifiedAt,at(5));
  const mismatched={...partial,workItems:partial.workItems.map(w=>({...w,publicationOutcome:{...w.publicationOutcome!,acceptedRecordIds:["person:2"]}}))};
  assert.equal(run(mismatched).verifiedAt,null);
});
test("backwards clocks stay unknown and are flagged; unrelated scope is excluded",()=>{
  const source=sources();
  const timing=run({...source,attempts:source.attempts.map(a=>({...a,startedAt:"2026-09-28T08:59:00Z"}))});
  assert.equal(timing.registeredToStartMs,null);
  assert.equal(timing.timingIssue,true);
  assert.equal(checklistDeliveryTimings(source,new Set(["elsewhere"]),at(10)).length,0);
});
test("a measured execution with identical endpoint stamps keeps its start unknown without hiding acquired work",()=>{
  const source=sources();
  const measured={...source,
    workItems:source.workItems.map(work=>({...work,publicationOutcome:undefined})),workerResults:[],servedReader:null,
    attempts:source.attempts.map(row=>({...row,startedAt:at(1),endedAt:at(1),outcome:"COMPLETED" as const,cost:{...row.cost,durationMs:43131}}))};
  const timing=run(measured);
  assert.equal(timing.firstStartedAt,null);
  assert.equal(timing.registeredToStartMs,null);
  assert.equal(timing.timingIssue,true);
  assert.equal(timing.waitingFor,"EXTRACTION");
  assert.equal(timing.firstSavedAt,at(2));
  assert.equal(timing.workAgeMs,600000);
  assert.equal(measured.attempts[0].startedAt,at(1));
});
