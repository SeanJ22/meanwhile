import assert from "node:assert/strict";
import test from "node:test";
import { autonomousHarness, FIXTURE_URL } from "./helpers/autonomous-fleet.ts";
import { nextAutonomousOperation, runAutonomousCoordinator } from "../lib/control-plane/workers/coordinator.ts";
import { dispatchWorkerTask, enqueueWorkerTask } from "../lib/control-plane/workers/runtime.ts";
import { projectAutonomousActivity, readAutonomousActivity } from "../lib/control-plane/workers/activity.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import { registerWorkItem } from "../lib/control-plane/repository/coordinator.ts";
import type { DetectiveTaskSpec, EvidenceWalkStep } from "../lib/control-plane/workers/research-types.ts";

test("uncommitted or mismatched worker output never enters the proved event chain", async () => {
  const h=await autonomousHarness(); await runAutonomousCoordinator(h.runtime,{maximum:1,concurrency:1});
  const activity=(await readAutonomousActivity(h.repos,undefined,{observedAt:h.now()}))[0]; assert.deepEqual(activity.evidenceGaps,[]);
  const record=activity.facts.workers[0];
  const uncommitted={...activity.facts,attempts:activity.facts.attempts.map(attempt=>attempt.id===record.attemptId?{...attempt,outcome:null,endedAt:null}:attempt)};
  const projection=projectAutonomousActivity(uncommitted,{observedAt:h.now()})[0]; assert.ok(projection.evidenceGaps.includes(`WORKER_RESULT_UNPROVEN:${record.id}`));
  assert.ok(!projection.timeline.some(event=>event.kind==="WORKER_RESULT"&&event.id===record.id));
  assert.ok(projection.accounting.attemptIds.includes(record.attemptId),"Failed attribution still preserves the historical Attempt.");
  const detached={...activity.facts,artifacts:activity.facts.artifacts.filter(artifact=>artifact.canonicalUrl!==FIXTURE_URL)};
  assert.ok(projectAutonomousActivity(detached,{observedAt:h.now()})[0].evidenceGaps.some(gap=>gap.startsWith("WORKER_WALK_ATTRIBUTION_UNPROVEN:")));
});

test("a witnessed fixture absence walk and an unwalked obligation remain distinct; closed proof expires and retains its source argument", async () => {
  // One explicitly bounded fixture publisher universe affirms that this record was not created.
  // The inherited probes are recorded evidence reads, not assertions about any live government.
  const h=await autonomousHarness({response:{text:'{"recordStatus":"NOT_CREATED","fixtureScope":"one-record"}'}});
  await runAutonomousCoordinator(h.runtime,{maximum:1,concurrency:1});
  const acquisition=(await h.repos.workerResults.readAll())[0]; if(acquisition.result.role!=="ACQUIRER") throw new Error("wrong role");
  const artifact=acquisition.result.artifacts[0]; const routeId=acquisition.result.source.id;
  const steps:EvidenceWalkStep[]=Array.from({length:6},(_,sequence)=>({sequence,at:acquisition.endedAt,worker:acquisition.worker,attemptId:acquisition.attemptId,routeId,
    rung:sequence<5?`RECORDED_FIXTURE_PROBE_${sequence}`:"RECORDED_FIXTURE_TERMINAL_REPASS",target:`${FIXTURE_URL}#/recordStatus`,applicableBecause:"Read the explicit publisher record-status assertion in the bounded fixture universe.",permission:"ALLOWED",transport:"REACHABLE",observed:"The recorded publisher fixture explicitly declares NOT_CREATED for the one owed fixture record.",returnedCount:0,artifactIds:[artifact.artifactId],nextRouteIds:[],outcome:"DOES_NOT_EXIST",pass:sequence<5?"INITIAL":"TERMINAL_REPASS"}));
  const expiresAt=new Date(Date.parse(acquisition.endedAt)+86_400_000).toISOString();
  const detective:DetectiveTaskSpec={artifactIds:[artifact.artifactId],walk:steps,walkState:{state:"CLOSED",applicableRouteIds:[routeId],terminalRepassAt:acquisition.endedAt,terminalRepassOutcome:"NO_FURTHER_APPLICABLE_ROUTE",noFurtherRouteReason:"This controlled fixture explicitly bounds its source universe to the one publication.",absenceArgument:"The publisher fixture recordStatus field affirmatively states NOT_CREATED; this is not inferred from transport or an empty parser.",falsificationConditions:["The fixture publisher changes recordStatus or names another applicable route."],supportingArtifactIds:[artifact.artifactId],stuckProtocolStepSequences:[0,1,2,3,4],twoClickStepSequence:0,expiresAt},
    question:{id:"fixture-publisher-status",text:"Does the acquired fixture publisher affirm that its one record was not created?",subjectId:h.item.subject,jurisdiction:"NH",recordClass:"OFFICIAL_ROSTER",kind:"RECORD_AUTHORITY",alternatives:[
      {id:"not-created",statement:"The publisher fixture expressly states NOT_CREATED.",canonicalIdentity:null,tests:[{artifactId:artifact.artifactId,predicate:{kind:"JSON_VALUE_EQUALS",pointer:"/recordStatus",expected:"NOT_CREATED"}}]},
      {id:"published",statement:"The publisher fixture states PUBLISHED.",canonicalIdentity:null,tests:[{artifactId:artifact.artifactId,predicate:{kind:"JSON_VALUE_EQUALS",pointer:"/recordStatus",expected:"PUBLISHED"}}]}],authorities:[{artifactId:artifact.artifactId,organization:"Fixture publisher",type:"OFFICIAL_RECORD",observedAt:artifact.retrievedAt}],falsificationCondition:"A different publisher status or new route falsifies the fixture conclusion.",nextAction:"Recheck after expiry or a changed fixture publication.",populationDefinition:null,denominator:null}};
  const task=await enqueueWorkerTask(h.repos,{workItemId:h.item.id,role:"DETECTIVE",artifactId:artifact.artifactId,contract:h.item.autonomousPlan!.contract,detective,now:h.now()});
  const executed=await dispatchWorkerTask(h.runtime,task); assert.equal(executed.outcome,"WORKED",executed.detail);
  const result=(await h.repos.workerResults.readAll()).find(record=>record.result.role==="DETECTIVE")!; assert.equal(result.result.verdict,"SUPPORTED");
  const unwalked=createWorkItem({project:h.item.project,subject:"fixture:not-walked",obligation:"A different owed fixture record",why:"Control for no attempted investigation",now:h.now()}); await registerWorkItem(h.repos,unwalked,h.now());
  const projected=await readAutonomousActivity(h.repos,undefined,{observedAt:h.now()});
  const closed=projected.find(row=>row.workItem.id===h.item.id)!; const untouched=projected.find(row=>row.workItem.id===unwalked.id)!;
  assert.equal(untouched.walk.state,"NOT_WALKED"); assert.equal(closed.walk.state,"CLOSED",JSON.stringify(closed.evidenceGaps));
  assert.equal(closed.walk.proof?.state,"CLOSED"); assert.equal(closed.timeline.filter(event=>event.walk?.pass==="TERMINAL_REPASS").length,1);
  assert.deepEqual(closed.evidenceGaps,[]);
  const conflicting={...closed.facts,workers:closed.facts.workers.map(worker=>worker.id===result.id&&worker.result.role==="DETECTIVE"?{...worker,result:{...worker.result,verdict:"UNRESOLVED" as const,burden:"UNRESOLVED" as const,contradictions:["Two fixture authority alternatives conflict."]}}:worker)};
  const disputed=projectAutonomousActivity(conflicting,{observedAt:h.now()})[0]; assert.equal(disputed.walk.state,"OPEN"); assert.ok(disputed.evidenceGaps.includes(`CLOSED_WALK_RESULT_NOT_EVIDENCE_SUPPORTED:${result.id}`));
  const expired=projectAutonomousActivity(closed.facts,{observedAt:expiresAt})[0]; assert.equal(expired.walk.state,"OPEN"); assert.ok(expired.evidenceGaps.includes(`CLOSED_WALK_EXPIRED:${result.id}`));
  assert.ok(expired.facts.workers.some(worker=>worker.result.role==="DETECTIVE"&&worker.result.walkState.state==="CLOSED"),"Expiry preserves the prior argued absence and its source evidence.");
  assert.equal(projectAutonomousActivity(closed.facts)[0].walk.state,"OPEN","No clock means closure freshness remains unproved.");
  await nextAutonomousOperation(h.runtime,h.item.id); // New unwalked computation remains visible beside historical proof.
  const reopened=(await readAutonomousActivity(h.repos,[h.item.id],{observedAt:h.now()}))[0]; assert.equal(reopened.walk.state,"OPEN"); assert.ok(reopened.walk.nextUnwalkedRouteIds.length>0);
});

test("cross-obligation source evidence retains original artifact/Attempt ownership without polluting local accounting",async()=>{
  const h=await autonomousHarness(); await runAutonomousCoordinator(h.runtime,{maximum:1,concurrency:1});
  const original=(await readAutonomousActivity(h.repos,undefined,{observedAt:h.now()}))[0];
  const observation=original.facts.artifacts.find(artifact=>artifact.canonicalUrl!==FIXTURE_URL&&artifact.contentType==="text/html")!;
  const seedAttempt=original.facts.attempts.find(attempt=>attempt.id===observation.attemptId)!;
  const sourceItem=createWorkItem({project:h.item.project,subject:"fixture:source-discovery",obligation:"Previously observed publisher source",why:"Cross-obligation source provenance fixture",now:seedAttempt.startedAt});
  const snapshot={...original.facts,workItems:[...original.facts.workItems,sourceItem],artifacts:original.facts.artifacts.map(artifact=>artifact.artifactId===observation.artifactId?{...artifact,workItemId:sourceItem.id}:artifact),
    attempts:original.facts.attempts.map(attempt=>attempt.id===seedAttempt.id?{...attempt,workItemId:sourceItem.id}:attempt),routeTasks:original.facts.routeTasks.map(task=>task.id===seedAttempt.routeTaskId?{...task,workItemId:sourceItem.id}:task)};
  // Repeat a held record around another owner's evidence: indexes may neither
  // collapse it nor reorder references by the order in a worker's input list.
  snapshot.artifacts.push(snapshot.artifacts.find(artifact=>artifact.artifactId===observation.artifactId)!);
  snapshot.attempts.push(snapshot.attempts.find(attempt=>attempt.id===seedAttempt.id)!);
  const projected=projectAutonomousActivity(snapshot,{observedAt:h.now()}).find(item=>item.workItem.id===h.item.id)!;
  assert.equal(projected.referencedArtifacts[0].workItemId,sourceItem.id); assert.equal(projected.referencedAttempts[0].workItemId,sourceItem.id);
  assert.deepEqual(projected.referencedArtifacts,snapshot.artifacts.filter(artifact=>artifact.workItemId===sourceItem.id),
    "cross-owner repeated artifacts keep their original row order");
  assert.deepEqual(projected.referencedAttempts,snapshot.attempts.filter(attempt=>attempt.workItemId===sourceItem.id),
    "cross-owner repeated Attempts keep their original row order");
  assert.ok(!projected.accounting.attemptIds.includes(seedAttempt.id)); assert.ok(!projected.timeline.some(event=>event.kind==="ATTEMPT_STARTED"&&event.attemptId===seedAttempt.id));
  assert.ok(!projected.evidenceGaps.some(gap=>gap.startsWith("WORKER_WALK_ATTRIBUTION_UNPROVEN:")));
});
