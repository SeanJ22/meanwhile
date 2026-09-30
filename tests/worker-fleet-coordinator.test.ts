import assert from "node:assert/strict";
import test from "node:test";
import { autonomousHarness, FIXTURE_NOW, FIXTURE_URL } from "./helpers/autonomous-fleet.ts";
import { nextAutonomousOperation, runAutonomousCoordinator, type AutonomousCoordinatorRuntime } from "../lib/control-plane/workers/coordinator.ts";
import { dispatchWorkerTask, evidenceProjection } from "../lib/control-plane/workers/runtime.ts";
import { readAutonomousActivity } from "../lib/control-plane/workers/activity.ts";
import { validateScoutFinishWithCandidates, type ScoutResult, type ScoutRung } from "../lib/control-plane/scheduler/scout-result.ts";
import { researchVaultResolver } from "../lib/control-plane/workers/vault-object.ts";
import { ZERO_COST } from "../lib/control-plane/attempt.ts";
import { scheduleAutonomousAcquisition } from "../lib/control-plane/workers/autonomous-plan.ts";
import { FIRST_BACKOFF_MINUTES } from "../lib/control-plane/scheduler/debt.ts";
import type { LegacyCivicExtractionContract } from "../lib/control-plane/workers/types.ts";

async function acceptRecordedScout(h:Awaited<ReturnType<typeof autonomousHarness>>) {
  const metadata=(await h.repos.artifacts.readAll())[0]; const held=await researchVaultResolver(h.repos,h.store,h.item.project)(metadata.artifactId);
  const attempt=(await h.repos.attempts.mustRead(metadata.attemptId)).value;
  const rungs:ScoutRung[]=[{index:0,rung:"primary-site-navigation",tool:"fetch_public",target:held.artifact.canonicalUrl,observed:"The held publisher observation links the exact previously unregistered fixture download.",artifactIds:[metadata.artifactId],note:null,at:held.artifact.retrievedAt,ok:true,permission:"ALLOWED",transport:"REACHABLE",returnedCount:null}];
  const finish={outcome:"ROUTE_CANDIDATE",rungsWalked:[{index:0,note:"Exact link present in vaulted publisher HTML"}],candidates:[{routeId:"scout-discovered-roster",title:"Official fixture roster",url:FIXTURE_URL,procedure:"GET the observed publisher link",relevance:"The canonical publisher observation names the owed roster.",permission:"ALLOWED" as const,permissionReading:"The actual fixture capture was permitted.",evidenceArtifactIds:[metadata.artifactId],observedOn:held.artifact.retrievedAt.slice(0,10),recordClass:"OFFICIAL_ROSTER",deterministic:true,unverified:["The linked roster has not yet been acquired."]}],findings:[],nextRungs:[],unverified:[],narrative:"Fixture route discovered from held exact source bytes."};
  const accepted=validateScoutFinishWithCandidates({finish,rungs,toolCalls:1,stoppedBy:"MODEL",vaulted:new Set([metadata.artifactId]),inherited:new Set(),machine:{recordClass:"OFFICIAL_ROSTER",provenance:new Map([[metadata.artifactId,{artifactId:metadata.artifactId,canonicalUrl:held.artifact.canonicalUrl,retrievedAt:held.artifact.retrievedAt,permission:held.artifact.permission,methodRouteId:held.artifact.methodRouteId,httpStatus:held.artifact.httpStatus}]])}});
  assert.deepEqual(accepted.issues,[]);
  const result:ScoutResult={formatVersion:1,attemptId:attempt.id,obligationId:attempt.routeTaskId,routeTaskId:attempt.routeTaskId,workItemId:h.item.id,subjectId:h.item.subject,routeId:"source-observation",recordClass:"OFFICIAL_ROSTER",providerId:null,reason:"Recorded fixture source discovery",outcome:"ROUTE_CANDIDATE",stoppedBy:"MODEL",rungs,distinctEvidenceRungs:1,candidates:accepted.candidates,findings:[],nextRungs:[],unverified:[],narrative:finish.narrative,worker:{provider:"recorded-fixture",model:"none",modelReported:null},usage:{inputTokens:0,outputTokens:0,cacheReadInputTokens:0,cacheCreationInputTokens:0,turns:0,toolCalls:1},usd:0,elapsedMs:0,artifactIds:[metadata.artifactId],methodCandidateIds:[],refusal:null,startedAt:attempt.startedAt,recordedAt:attempt.endedAt!};
  await h.repos.scoutResults.append(result.obligationId,result.attemptId,result,h.now());
}

test("PDC: the production standing runtime refuses queued or newly due legacy meeting acquisitions without opening the source", async () => {
  const h = await autonomousHarness({
    plan: (plan) => {
      const contract: LegacyCivicExtractionContract = {
        schemaVersion: 1,
        recordClass: "LEGISTAR_EVENTS",
        subjectId: plan.contract.subjectId,
        sourceBodyId: null,
        sourceBodyName: null,
        publisherSlug: "fixture-legacy-meetings",
        requiredFields: ["EventId"],
        completenessScope: "Historical fixture only; the permanent data plane owns live acquisition.",
        expectedSourceDate: null,
      };
      return { ...plan, contract };
    },
  });
  const productionRuntime = {
    ...h.runtime,
    routineMeetingsAuthority: "PERMANENT_CIVIC_DATA_PLANE" as const,
  };
  const beforeTasks = (await h.repos.routeTasks.list()).length;
  const blocked = await nextAutonomousOperation(productionRuntime, h.item.id);
  assert.equal(blocked.action, "BLOCKED");
  assert.match(blocked.reason, /PDC_ROUTINE_MEETINGS_ACQUISITION_RETIRED/);
  assert.equal((await h.repos.routeTasks.list()).length, beforeTasks, "the standing path creates no replacement acquisition task");
  assert.deepEqual(h.calls, []);

  const historicalTestTask = await nextAutonomousOperation(h.runtime, h.item.id);
  assert.equal(historicalTestTask.task?.workerTask?.role, "ACQUIRER", "isolated test setup proves the positive control is actually an acquisition");
  await assert.rejects(
    dispatchWorkerTask(productionRuntime, historicalTestTask.task!),
    /PDC_ROUTINE_MEETINGS_ACQUISITION_RETIRED/,
  );
  assert.deepEqual(h.calls, [], "even an already queued legacy task cannot cross the production dispatch boundary");
});

test("unknown source routes to existing Scout and restart deduplicates the durable task without asserting absence", async () => {
  const h=await autonomousHarness({plan:plan=>({...plan,sources:[],acquisition:[]})});
  const before=(await h.repos.routeTasks.list()).length;
  const priorDispositions=await h.repos.dispositions.readAll();
  const first=await nextAutonomousOperation(h.runtime,h.item.id); const restart=await nextAutonomousOperation(h.runtime,h.item.id);
  assert.equal(first.action,"SCOUT"); assert.equal(restart.task?.id,first.task?.id); assert.equal((await h.repos.routeTasks.list()).length,before+1);
  assert.equal((await h.repos.workItems.mustRead(h.item.id)).value.state,"OPEN");
  assert.deepEqual(await h.repos.dispositions.readAll(),priorDispositions);
  assert.equal(h.calls.length,0);
});

test("a newly observed Scout route flows to Hunter without rewriting its extraction contract",async()=>{
  const h=await autonomousHarness({plan:plan=>({...plan,sources:[],acquisition:[],contract:plan.contract.schemaVersion===2?{...plan.contract,sourceScope:{...plan.contract.sourceScope,canonicalUrls:["https://fixture-clerk.example.gov/unknown-extraction-shape"]}}:plan.contract})});
  assert.equal((await nextAutonomousOperation(h.runtime,h.item.id)).action,"SCOUT");
  const planBefore=JSON.stringify(h.item.autonomousPlan); await acceptRecordedScout(h);
  const hunter=await nextAutonomousOperation(h.runtime,h.item.id); assert.equal(hunter.task?.workerTask?.role,"ACQUIRER"); assert.equal(hunter.task?.workerTask?.acquisition?.route.url,FIXTURE_URL);
  const dispatched=await dispatchWorkerTask(h.runtime,hunter.task!); assert.equal(dispatched.outcome,"WORKED",dispatched.detail);
  const next=await nextAutonomousOperation(h.runtime,h.item.id); assert.equal(next.action,"SCOUT"); assert.match(next.reason,/EXTRACTION_SCOPE_UNESTABLISHED/);
  assert.equal(JSON.stringify((await h.repos.workItems.mustRead(h.item.id)).value.autonomousPlan),planBefore);
  assert.ok(!(await h.repos.routeTasks.list()).some(task=>task.value.workerTask?.role==="PARSER"));
});

test("an exact URL quotation from a publisher outside canonical seed scope cannot ground acquisition",async()=>{
  const h=await autonomousHarness({plan:plan=>({...plan,sources:[],acquisition:[],seedUrls:["https://another-publisher.example.gov/"],contract:plan.contract.schemaVersion===2?{...plan.contract,sourceScope:{...plan.contract.sourceScope,canonicalUrls:["https://another-publisher.example.gov/records"]}}:plan.contract})});
  await acceptRecordedScout(h); assert.equal((await nextAutonomousOperation(h.runtime,h.item.id)).action,"SCOUT");
  assert.ok(!(await h.repos.routeTasks.list()).some(task=>task.value.workerTask?.role==="ACQUIRER")); assert.equal(h.calls.length,0);
});

test("missing Scout transport creates one attributable policy denial; retry requires both elapsed backoff and actual availability",async()=>{
  const h=await autonomousHarness({plan:plan=>({...plan,sources:[],acquisition:[]})});
  const first=await runAutonomousCoordinator(h.runtime,{maximum:1,maxScoutDispatches:1}); assert.equal(first.dispatches[0].outcome,"FAILED");
  const denied=(await h.repos.attempts.mustRead(first.dispatches[0].attemptId!)).value; assert.equal(denied.outcome,"DENIED_BY_POLICY"); assert.match(denied.abortReason!,/SCOUT_MODEL_TRANSPORT_UNAVAILABLE/); assert.equal(denied.cost.requestCount,0);
  const attempts=(await h.repos.attempts.list()).length; await runAutonomousCoordinator(h.runtime,{maximum:1}); assert.equal((await h.repos.attempts.list()).length,attempts);
  h.advanceTo(new Date(Date.parse(denied.endedAt!)+16*60_000).toISOString()); assert.equal((await nextAutonomousOperation(h.runtime,h.item.id)).action,"BLOCKED");
  let calls=0; const available={...h.runtime,scoutFor:()=>({lane:"BOUNDED_MODEL_WORKER" as const,workerFor:({holder}:{holder:string})=>({role:"SCOUT" as const,provider:"offline-fixture",version:"1",instance:holder}),run:async()=>{calls++;return {kind:"ABORTED" as const,ranAs:"BOUNDED_MODEL_WORKER" as const,cost:ZERO_COST,endedAt:h.now(),detail:"Controlled offline Scout availability proof; no civic disposition."};}})};
  const retry=await runAutonomousCoordinator(available,{maximum:1,maxScoutDispatches:1}); assert.equal(calls,1); assert.equal(retry.scoutsAdmitted,1);
  assert.equal((await h.repos.routeTasks.mustRead(first.dispatches[0].routeTaskId!)).value.policyReauthorizations?.[0].denial.attemptId,denied.id);
});

test("Scout cycle cap and remaining wall time defer dispatch without inventing failed Attempts",async()=>{
  const h=await autonomousHarness({plan:plan=>({...plan,sources:[],acquisition:[]})}); const before=(await h.repos.attempts.list()).length;
  assert.equal((await runAutonomousCoordinator(h.runtime,{maxScoutDispatches:0})).dispatches.length,0);
  assert.equal((await runAutonomousCoordinator(h.runtime,{deadlineMs:Date.now()+1000})).dispatches.length,0);
  assert.equal((await h.repos.attempts.list()).length,before);
});

test("completed Scout without a candidate continues after canonical backoff with durable rungs and immutable prior history",async()=>{
  const h=await autonomousHarness({plan:plan=>({...plan,sources:[],acquisition:[]})});
  const metadata=(await h.repos.artifacts.readAll())[0];
  const inheritedHistories:(readonly ScoutResult[])[]=[];
  const runtime:AutonomousCoordinatorRuntime={...h.runtime,scoutFor:(item,task,history)=>{
    inheritedHistories.push(history??[]);
    return {lane:"BOUNDED_MODEL_WORKER",workerFor:({holder})=>({role:"SCOUT",provider:"recorded-fixture",version:"no-model",instance:holder}),run:async({attemptId})=>{
      const evidence=await h.runtime.readEvidence(metadata.artifactId); const at=h.now();
      const rungs:ScoutRung[]=[{index:0,rung:"primary-site-navigation",tool:"read_vault",target:metadata.artifactId,
        observed:`Read ${evidenceProjection(evidence).text.length} held UTF16 code units; this bounded control has not selected a route.`,artifactIds:[metadata.artifactId],note:null,at,ok:true,permission:"ALLOWED",transport:"NOT_ATTEMPTED"}];
      const finish={outcome:"BLOCKED",rungsWalked:[{index:0,note:"Bounded fixture ends before remaining source ladder"}],candidates:[],findings:[],nextRungs:["site-search-or-sitemap"],unverified:["Source route remains unknown"],narrative:"Recorded bounded control; no publisher absence asserted."};
      const accepted=validateScoutFinishWithCandidates({finish,rungs,toolCalls:1,stoppedBy:"BOUND",vaulted:new Set(),inherited:new Set([metadata.artifactId])});
      assert.deepEqual(accepted.issues,[]);
      const attempt=(await h.repos.attempts.mustRead(attemptId)).value;
      const result:ScoutResult={formatVersion:1,attemptId,obligationId:task.id,routeTaskId:task.id,workItemId:item.id,subjectId:item.subject,routeId:task.routeId,
        recordClass:"OFFICIAL_ROSTER",providerId:null,reason:"Bounded continuation control",outcome:"BLOCKED",stoppedBy:"BOUND",rungs,distinctEvidenceRungs:1,
        candidates:accepted.candidates,findings:[],nextRungs:finish.nextRungs,unverified:finish.unverified,narrative:finish.narrative,
        worker:{provider:"recorded-fixture",model:"none",modelReported:null},usage:{inputTokens:0,outputTokens:0,cacheReadInputTokens:0,cacheCreationInputTokens:0,turns:0,toolCalls:1},
        usd:0,elapsedMs:0,artifactIds:[],methodCandidateIds:[],refusal:null,startedAt:attempt.startedAt,recordedAt:at};
      await h.repos.scoutResults.append(result.obligationId,result.attemptId,result,at);
      return {kind:"DISPOSED",ranAs:"BOUNDED_MODEL_WORKER",endedAt:at,cost:{...ZERO_COST,usd:0,requestCount:0,inputTokens:0,outputTokens:0},artifacts:[],
        disposition:{disposition:"BLOCKED_CURRENTLY",observation:null,permission:"ALLOWED",transport:"OTHER_NAMED_FAILURE",note:"Controlled bound ended this fixture search; source ladder remains owed."},detail:finish.narrative};
    }};
  }};
  const first=await runAutonomousCoordinator(runtime,{maximum:1,concurrency:1}); assert.equal(first.dispatches[0].outcome,"WORKED",first.dispatches[0].detail);
  const priorTask=await h.repos.routeTasks.mustRead(first.dispatches[0].routeTaskId!); const priorAttempt=await h.repos.attempts.mustRead(first.dispatches[0].attemptId!);
  const priorResult=(await h.repos.scoutResults.readAll())[0]; const priorDispositions=await h.repos.dispositions.readAll();
  assert.equal(priorTask.value.state,"DISPOSED"); assert.equal(priorAttempt.value.outcome,"COMPLETED");
  assert.equal((await nextAutonomousOperation(runtime,h.item.id)).action,"BLOCKED");
  assert.equal((await runAutonomousCoordinator(runtime,{maximum:1})).dispatches.length,0);
  const due=Date.parse(priorAttempt.value.endedAt!)+FIRST_BACKOFF_MINUTES*60_000;
  h.advanceTo(new Date(due).toISOString()); const continuation=await nextAutonomousOperation(runtime,h.item.id);
  assert.equal(continuation.action,"SCOUT"); assert.notEqual(continuation.task?.id,priorTask.id);
  assert.ok(continuation.task?.routeId.endsWith(`:continue:${priorAttempt.id}`)); assert.match(continuation.task!.routeLabel,/site-search-or-sitemap/);
  assert.equal((await nextAutonomousOperation(runtime,h.item.id)).task?.id,continuation.task?.id);
  const continued=await runAutonomousCoordinator(runtime,{maximum:1,concurrency:1}); assert.equal(continued.dispatches[0].routeTaskId,continuation.task?.id);
  assert.equal(continued.dispatches[0].outcome,"WORKED",continued.dispatches[0].detail);
  assert.deepEqual(inheritedHistories[1],[priorResult]);
  assert.deepEqual(await h.repos.routeTasks.mustRead(priorTask.id),priorTask); assert.deepEqual(await h.repos.attempts.mustRead(priorAttempt.id),priorAttempt);
  assert.deepEqual((await h.repos.scoutResults.readAll()).find(result=>result.attemptId===priorAttempt.id),priorResult);
  const dispositions=await h.repos.dispositions.readAll();
  for(const prior of priorDispositions) assert.deepEqual(dispositions.find(row=>row.attemptId===prior.attemptId),prior);
  const secondAttempt=(await h.repos.attempts.mustRead(continued.dispatches[0].attemptId!)).value;
  h.advanceTo(new Date(Date.parse(secondAttempt.endedAt!)+FIRST_BACKOFF_MINUTES*60_000).toISOString());
  assert.equal((await nextAutonomousOperation(runtime,h.item.id)).action,"BLOCKED","Repeated completed searches retain the existing doubled backoff.");
  h.advanceTo(new Date(Date.parse(secondAttempt.endedAt!)+2*FIRST_BACKOFF_MINUTES*60_000).toISOString());
  assert.equal((await nextAutonomousOperation(runtime,h.item.id)).action,"SCOUT");
});

test("shared model admission contention defers Scout without an Attempt and releases for a later cycle",async()=>{
  const h=await autonomousHarness({plan:plan=>({...plan,sources:[],acquisition:[]})});
  const before=(await h.repos.attempts.list()).length;
  const deferred=await h.repos.locks.withLock("autonomous-model-admission",()=>runAutonomousCoordinator(h.runtime,{maximum:1,concurrency:2}));
  assert.equal(deferred.dispatches.length,0); assert.equal(deferred.scoutsAdmitted,0);
  assert.deepEqual(deferred.deferred.map(item=>({workItemId:item.workItemId,reason:item.reason})),[{workItemId:h.item.id,reason:"REPOSITORY_LOCK_HELD"}]);
  assert.equal((await h.repos.attempts.list()).length,before);
  assert.equal((await runAutonomousCoordinator(h.runtime,{maximum:1,concurrency:2})).dispatches.length,1);
});

test("Hunter transport failure is durable OPEN evidence and retry reuses the canonical scheduling debt", async () => {
  const h=await autonomousHarness({response:{transportError:"socket timeout"}});
  const first=await nextAutonomousOperation(h.runtime,h.item.id); assert.equal(first.task?.workerTask?.role,"ACQUIRER");
  const result=await dispatchWorkerTask(h.runtime,first.task!); assert.equal(result.outcome,"WORKED",result.detail);
  const record=(await h.repos.workerResults.readAll())[0]; assert.equal(record.result.role,"ACQUIRER"); if(record.result.role!=="ACQUIRER") throw new Error("wrong role");
  assert.equal(record.result.verdict,"BLOCKED"); assert.equal(record.result.walkState.state,"OPEN"); assert.equal(record.result.artifacts.length,0); assert.equal(record.result.walk.at(-1)?.transport,"TIMEOUT");
  const novelty=await nextAutonomousOperation(h.runtime,h.item.id);
  assert.equal(novelty.action,"SCOUT"); assert.match(novelty.task!.routeId,/autonomous:novelty:/);
  assert.equal((await nextAutonomousOperation(h.runtime,h.item.id)).task?.id,novelty.task?.id,"restart reuses the same novelty task");
  // Even after retry becomes due, the old route cannot starve the branch.
  h.advanceTo(new Date(Date.parse(record.endedAt)+16*60_000).toISOString());
  assert.equal((await nextAutonomousOperation(h.runtime,h.item.id)).action,"SCOUT");
  const scout=await runAutonomousCoordinator(h.runtime,{maximum:1,maxScoutDispatches:1});
  assert.equal((await h.repos.attempts.mustRead(scout.dispatches[0].attemptId!)).value.outcome,"DENIED_BY_POLICY","offline fixture has no model transport; denial stays attributable");
  const retry=await nextAutonomousOperation(h.runtime,h.item.id); assert.equal(retry.task?.workerTask?.role,"ACQUIRER"); assert.notEqual(retry.task?.id,first.task?.id);
  const restart=await nextAutonomousOperation(h.runtime,h.item.id); assert.equal(restart.task?.id,retry.task?.id);
  assert.ok(!(await h.repos.routeTasks.list()).some(t=>t.value.workerTask?.role==="PARSER"));
  const activity=(await readAutonomousActivity(h.repos,undefined,{observedAt:h.now()}))[0]; assert.equal(activity.walk.state,"OPEN"); assert.ok(activity.timeline.some(event=>event.walk?.transport==="TIMEOUT"));
});

test("an elapsed acquisition cadence finishes retained worker handoffs before a real refresh",async()=>{
  const h=await autonomousHarness(); const acquired=await runAutonomousCoordinator(h.runtime,{maximum:1,concurrency:1});
  const first=(await h.repos.workerResults.readAll())[0]; if(first.result.role!=="ACQUIRER")throw new Error("wrong role");
  const calls=h.calls.length; assert.equal((await nextAutonomousOperation(h.runtime,h.item.id)).task?.workerTask?.role,"PARSER"); assert.equal(h.calls.length,calls);
  const schedule=scheduleAutonomousAcquisition(h.item.autonomousPlan!,first.result,h.now()); assert.ok("nextDueAt" in schedule); if(!("nextDueAt" in schedule))throw new Error("unscheduled"); assert.equal(schedule.cadenceSource,"DEFAULT_NO_SIGNAL");
  h.advanceTo(new Date(Date.parse(schedule.nextDueAt)+86_400_000).toISOString());
  for (const role of ["PARSER", "VALIDATOR"]) {
    const next = await nextAutonomousOperation(h.runtime, h.item.id);
    assert.equal(next.task?.workerTask?.role, role, "Due refreshes cannot starve a retained extraction chain.");
    const advanced = await dispatchWorkerTask(h.runtime, next.task!);
    assert.equal(advanced.outcome, "WORKED", advanced.detail);
    h.advanceTo(new Date(Date.parse(h.now()) + 86_400_000).toISOString());
  }
  assert.equal(h.calls.length, calls, "Independent checks use the captured evidence, with no fabricated fresh acquisition.");
  const stale=await nextAutonomousOperation(h.runtime,h.item.id); assert.equal(stale.task?.workerTask?.role,"ACQUIRER"); assert.notEqual(stale.task?.id,acquired.dispatches[0].routeTaskId); assert.deepEqual(stale.task?.workerTask?.acquisition?.held,[]);
  assert.equal((await nextAutonomousOperation(h.runtime,h.item.id)).task?.id,stale.task?.id);
  const refreshed=await dispatchWorkerTask(h.runtime,stale.task!); assert.equal(refreshed.outcome,"WORKED",refreshed.detail); assert.ok(h.calls.length>calls);
  const latest=(await h.repos.workerResults.readAll()).find(record=>record.attemptId===refreshed.attemptId)!; if(latest.result.role!=="ACQUIRER")throw new Error("wrong role");
  assert.equal(latest.result.artifacts[0].artifactId,first.result.artifacts[0].artifactId,"Identical bytes keep their immutable original identity.");
  const current=scheduleAutonomousAcquisition(h.item.autonomousPlan!,latest.result,h.now()); assert.ok("nextDueAt" in current && Date.parse(current.nextDueAt)>Date.parse(h.now()));
  assert.notEqual((await nextAutonomousOperation(h.runtime,h.item.id)).task?.workerTask?.role,"ACQUIRER","A real unchanged-content fetch must not create a hot refresh loop.");
});

test("the same coordinator advances real procedures Hunter → Parser → Validator (§3, no audit stage) and preserves canonical accounting", async () => {
  const h=await autonomousHarness(); const roles:string[]=[];
  for(let index=0;index<3;index++) {
    const run=await runAutonomousCoordinator(h.runtime,{maximum:1,concurrency:1});
    roles.push(run.decisions[0].task!.workerTask!.role); assert.equal(run.dispatches[0].outcome,"WORKED",run.dispatches[0].detail);
  }
  assert.deepEqual(roles,["ACQUIRER","PARSER","VALIDATOR"]);
  const terminal=await nextAutonomousOperation(h.runtime,h.item.id); assert.equal(terminal.action,"STAGED");
  const count=(await h.repos.attempts.list()).length; await runAutonomousCoordinator(h.runtime,{maximum:2,concurrency:2}); assert.equal((await h.repos.attempts.list()).length,count);
  const activity=(await readAutonomousActivity(h.repos,undefined,{observedAt:h.now()}))[0];
  assert.equal(activity.timeline.filter(event=>event.kind==="WORKER_RESULT").length,3);
  assert.deepEqual(activity.accounting.attemptIds,(await h.repos.attempts.list()).map(row=>row.id).sort());
  assert.deepEqual(activity.accounting.transitionIds,(await h.repos.transitions.readAll()).map(t=>t.transitionId).sort());
  assert.deepEqual(activity.evidenceGaps,[]); assert.equal((await h.repos.promotionPipeline.readAll()).length,0);
});

test("a judgment call (one person matched across sources) still gets an independent audit, and a break keeps it blocked", async () => {
  const h=await autonomousHarness({plan:plan=>({...plan,contract:{...plan.contract,recordClass:"CROSS_SOURCE_IDENTITY"} as typeof plan.contract})});
  for(let index=0;index<3;index++) await runAutonomousCoordinator(h.runtime,{maximum:1,concurrency:1});
  const runtime={...h.runtime,independentContext:async (scope:Parameters<typeof h.runtime.independentContext>[0])=>{
    const context=await h.runtime.independentContext(scope); return {...context,subjectId:context.subjectId,startedFrom:["CANONICAL_SUBJECT_IDENTITY" as const]};
  }};
  const run=await runAutonomousCoordinator(runtime,{maximum:1,concurrency:1}); assert.equal(run.dispatches[0].outcome,"WORKED",run.dispatches[0].detail);
  const audit=(await h.repos.workerResults.readAll()).find(r=>r.result.role==="ADVERSARIAL_AUDITOR"); assert.equal(audit?.result.verdict,"BROKE");
  assert.equal((await nextAutonomousOperation(h.runtime,h.item.id)).action,"SCOUT");
  assert.equal((await h.repos.workItems.mustRead(h.item.id)).value.state,"REOPENED");
});

test("a stored plan that still demands verification with no authorities validates on §3 instead of sitting inconclusive", async () => {
  const h=await autonomousHarness({plan:plan=>({...plan,contract:{...plan.contract,schemaVersion:2,verification:{required:true,authorities:[]}} as typeof plan.contract})});
  for(let index=0;index<3;index++) {
    const run=await runAutonomousCoordinator(h.runtime,{maximum:1,concurrency:1}); assert.equal(run.dispatches[0]?.outcome,"WORKED",run.dispatches[0]?.detail);
  }
  assert.equal((await nextAutonomousOperation(h.runtime,h.item.id)).action,"STAGED");
  const records=await h.repos.workerResults.readAll(); const validated=records.find(r=>r.result.role==="VALIDATOR")?.result;
  assert.equal(validated?.verdict,"PASS",JSON.stringify(validated));
  assert.ok(validated?.role==="VALIDATOR" && !validated.findings.some(f=>f.code==="EXTERNAL_VERIFICATION_MISSING"),"the empty-authority demand no longer makes every result inconclusive");
  assert.ok(Date.parse(FIXTURE_NOW)<Date.parse(h.now()));
});

test("unresolved identity permits independent diagnosis but never staging", async () => {
  const h=await autonomousHarness({plan:plan=>{
    const source=plan.sources[0]; const span=source.observation;
    return {...plan,detective:[{artifactIds:[span.artifactId],walk:[],walkState:{state:"OPEN",nextRouteIds:["independent-identity-register"]},question:{
      id:"fixture-identity-disagreement",text:"Which canonical identity does this publisher evidence establish?",subjectId:plan.contract.subjectId,
      jurisdiction:"NH",recordClass:plan.contract.recordClass,kind:"IDENTITY",populationDefinition:null,denominator:null,
      authorities:[{artifactId:span.artifactId,organization:source.publisher,type:"PUBLISHER_DIRECTORY",observedAt:source.observedAt}],
      alternatives:[plan.contract.subjectId,"fixture:nh:other-county"].map((id,index)=>({id:`alternative-${index}`,statement:`The evidence identifies ${id}.`,canonicalIdentity:id,tests:[{artifactId:span.artifactId,predicate:{kind:"EXACT_TEXT" as const,quote:span.quote}}]})),
      nextAction:"Acquire the independent identity register.",falsificationCondition:"An independent authority contradicts the proposed identity."
    }}]};
  }});
  const roles:string[]=[];
  for(let index=0;index<4;index++) {
    const run=await runAutonomousCoordinator(h.runtime,{maximum:1,concurrency:1});
    roles.push(run.decisions[0].task!.workerTask!.role);
    assert.equal(run.dispatches[0]?.outcome,"WORKED",run.dispatches[0]?.detail);
  }
  assert.deepEqual(roles,["ACQUIRER","PARSER","DETECTIVE","VALIDATOR"]);
  assert.equal((await h.repos.workerResults.readAll()).find(r=>r.result.role==="DETECTIVE")?.result.verdict,"UNRESOLVED");
  assert.equal((await nextAutonomousOperation(h.runtime,h.item.id)).action,"SCOUT");
  assert.equal((await h.repos.promotionPipeline.readAll()).length,0);
});
