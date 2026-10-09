import assert from "node:assert/strict";
import test from "node:test";
import { autonomousHarness, FIXTURE_NOW, FIXTURE_URL } from "./helpers/autonomous-fleet.ts";
import { fairAutonomousWorkIds, nextAutonomousOperation, runAutonomousCoordinator, type AutonomousCoordinatorRuntime } from "../lib/control-plane/workers/coordinator.ts";
import { dispatchWorkerTask, evidenceProjection } from "../lib/control-plane/workers/runtime.ts";
import { readAutonomousActivity } from "../lib/control-plane/workers/activity.ts";
import { SCOUT_HELD_EVIDENCE_PROTOCOL_VERSION, validateScoutFinishWithCandidates, type ScoutResult, type ScoutRung } from "../lib/control-plane/scheduler/scout-result.ts";
import { researchVaultResolver } from "../lib/control-plane/workers/vault-object.ts";
import { workerVaultResolver } from "../lib/control-plane/workers/vault.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { ZERO_COST } from "../lib/control-plane/attempt.ts";
import { scheduleAutonomousAcquisition } from "../lib/control-plane/workers/autonomous-plan.ts";
import { FIRST_BACKOFF_MINUTES } from "../lib/control-plane/scheduler/debt.ts";
import type { LegacyCivicExtractionContract } from "../lib/control-plane/workers/types.ts";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFieldManual, newFieldManualEntry } from "../lib/control-plane/field-manual.ts";
import { methodFixture, knowledgeEntries, methodVersionEntry } from "./method-store-fixture.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import { runLeaseWorkerProcesses, runNationalPlaceWorkerProcesses, workerDispatchFailure, workerProcessSlots } from "../lib/control-plane/workers/process-pool.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { unchangedScoutFailure } from "../lib/control-plane/workers/scout-scheduling.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { claimRouteTask, registerRouteTask } from "../lib/control-plane/repository/coordinator.ts";
import { transpileModule, ScriptTarget, ModuleKind } from "typescript";
import type { WorkItem } from "../lib/control-plane/work-item.ts";
import { huntRoundComparator } from "../lib/control-plane/scheduler/shadow-loop.ts";
import { withPromotedFixturesInChildren } from "./helpers/promoted-fixtures.ts";



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

test("coordinator resumes an installed adapter learned after the failed Scout narrative",async()=>{
  const h=await autonomousHarness({plan:plan=>({...plan,sources:[],acquisition:[]})});
  const attempt=(await h.repos.attempts.list())[0].value;
  const result={attemptId:attempt.id,obligationId:'adapter-wait',subjectId:h.item.subject,
    recordClass:h.item.autonomousPlan!.contract.recordClass,workItemId:h.item.id,recordedAt:h.now(),
    refusal:null,outcome:'NEEDS_ADAPTER',recoveryCapabilityVersion:SCOUT_HELD_EVIDENCE_PROTOCOL_VERSION,
    narrative:'Saved source template needs extraction code',nextRungs:[],candidates:[],findings:[],rungs:[],artifactIds:[]} as unknown as ScoutResult;
  await h.repos.scoutResults.append(result.obligationId,result.attemptId,result,h.now());
  const waiting=await nextAutonomousOperation(h.runtime,h.item.id);
  assert.equal(waiting.action,'BLOCKED');assert.match(waiting.reason,/AWAITING_ADAPTER/);
  await writeFieldManual(h.repos,[newFieldManualEntry('engineer-adapter','generated-platform',{
    role:'SHARED',kind:'ENGINEER_ADAPTER_PR',title:'generated-platform',summary:'Adapter extracted from the saved source',outcome:'REFERENCE',
    payload:{sourceAttemptId:result.attemptId,files:['lib/sources/platform-adapters/uncapped-source-links.ts']},
  })],h.now());
  const ready=await nextAutonomousOperation(h.runtime,h.item.id);
  assert.equal(ready.action,'SCOUT');assert.equal(ready.task?.id,waiting.task?.id);
  assert.deepEqual(h.calls,[],'resuming saved work makes no source or model request during selection');
});

test("cycle selection uses its already joined item and history instead of reopening every full store", async () => {
  const h=await autonomousHarness({plan:plan=>({...plan,sources:[],acquisition:[]})});
  // A normal prior selection has already registered the canonical Scout task.
  const first=await nextAutonomousOperation(h.runtime,h.item.id);
  assert.equal(first.action,"SCOUT");
  const routeTasks=(await h.repos.routeTasks.list()).map(row=>row.value);
  const fail=async()=>{throw new Error("REDUNDANT_CYCLE_HISTORY_READ");};
  const runtime:AutonomousCoordinatorRuntime={...h.runtime,repos:{...h.repos,
    workItems:{...h.repos.workItems,mustRead:fail},
    attempts:{...h.repos.attempts,list:fail},
    scoutResults:{...h.repos.scoutResults,readAll:fail},
    routeTasks:{...h.repos.routeTasks,list:fail},
  }};
  const selected=await nextAutonomousOperation(runtime,h.item.id,[h.item],{attempts:[],scouts:[],routeTasks});
  assert.equal(selected.action,"SCOUT");
  assert.equal(selected.task?.workItemId,h.item.id);
  assert.deepEqual(h.calls,[],"selecting an owed Scout does not fetch source bytes or call a provider");
});

test("coordinator joins Scout and route history once before bounded selection", async () => {
  const h=await autonomousHarness({plan:plan=>({...plan,sources:[],acquisition:[]})});
  await nextAutonomousOperation(h.runtime,h.item.id);
  let scoutReads=0,routeLists=0,pointReads=0,workerResultReads=0,workerResultLists=0,attemptScopeLists=0;
  const runtime:AutonomousCoordinatorRuntime={...h.runtime,repos:{...h.repos,
    workItems:{...h.repos.workItems,mustRead:async (...args)=>{pointReads++;return h.repos.workItems.mustRead(...args);}},
    scoutResults:{...h.repos.scoutResults,readAll:async()=>{scoutReads++;return h.repos.scoutResults.readAll();}},
    routeTasks:{...h.repos.routeTasks,list:async()=>{routeLists++;return h.repos.routeTasks.list();}},
    workerResults:{...h.repos.workerResults,
      read:async (...args)=>{workerResultReads++;return h.repos.workerResults.read(...args);},
      readAll:async()=>{workerResultLists++;return h.repos.workerResults.readAll();}},
    attempts:{...h.repos.attempts,listWhere:async (...args)=>{attemptScopeLists++;return h.repos.attempts.listWhere(...args);}},
  }};
  const cycle=await runAutonomousCoordinator(runtime,{maximum:1,maxScoutDispatches:0,concurrency:1});
  assert.equal(cycle.decisions[0]?.action,"SCOUT");
  assert.equal(cycle.dispatches.length,0);
  assert.equal(scoutReads,1,"all Scout results are joined once, not scanned per WorkItem");
  assert.equal(routeLists,1,"route tasks are joined once, not scanned per WorkItem");
  assert.equal(pointReads,0,"selection uses the already loaded WorkItem snapshot");
  assert.equal(workerResultLists,2,"recovery reads history first; lineage and completion validation share the fresh selection snapshot");
  assert.equal(workerResultReads,0,"selection does not reread results per item");
  assert.equal(attemptScopeLists,0,"completion validation uses the already loaded exact Attempt rows");

  await acceptRecordedScout(h);
  const scout = (await h.repos.scoutResults.readAll())[0]!;
  const missingId = "ar-fixture-missing-record";
  const missingOnly = { ...scout, candidates: scout.candidates.map(candidate => ({ ...candidate, evidenceArtifactIds: [missingId] })) };
  const goodIds: string[] = [];
  const plan = h.item.autonomousPlan!;
  assert(plan.contract.schemaVersion === 2);
  for (let index = 0; index < 3; index++) {
    const id = `wi-fixture-valid-${index}`;
    const subject = `fixture:nh:county-${index}`;
    await h.repos.workItems.put(id, { ...h.item, id, subject, autonomousPlan: { ...plan,
      contract: { ...plan.contract, subjectId: subject, jurisdiction: { ...plan.contract.jurisdiction, canonicalId: subject } },
      sources: [], acquisition: [] } }, h.now());
    goodIds.push(id);
  }
  const isolated: AutonomousCoordinatorRuntime = { ...runtime,
    readEvidence: workerVaultResolver(h.repos, h.store, h.item.project),
    repos: { ...runtime.repos, scoutResults: { ...h.repos.scoutResults, readAll: async () => [missingOnly] } } };
  const named = new RegExp(`WORKER_ARTIFACT_MISSING_OR_PARTIAL:${missingId}`);
  const remaining = await runAutonomousCoordinator(isolated, { planOnly: true, concurrency: 4 });
  assert.equal(remaining.decisions.filter(decision => goodIds.includes(decision.workItemId) && decision.task).length, 3,
    "one unavailable historical source cannot discard the other three planned tasks");
  const unresolved = remaining.decisions.find(decision => decision.workItemId === h.item.id)!;
  assert.equal(unresolved.action, "SCOUT", "missing evidence remains acquisition work, never a grounded source");
  assert.match(unresolved.reason, named);
  assert.deepEqual(remaining.deferred.map(row => [row.workItemId, row.reason]), [[h.item.id, "WORKER_ARTIFACT_MISSING_OR_PARTIAL"]]);
  assert.match(remaining.deferred[0]!.detail, new RegExp(missingId));
  assert.equal(remaining.dispatches.length, 0);
  assert.equal(workerResultLists,4,"the next invocation performs recovery and takes a fresh selection snapshot for all four items");
  assert.equal(workerResultReads,0);
  assert.equal(attemptScopeLists,0);

  const mixed = { ...scout, candidates: scout.candidates.map(candidate => ({ ...candidate,
    evidenceArtifactIds: [missingId, ...candidate.evidenceArtifactIds] })) };
  const usable: AutonomousCoordinatorRuntime = { ...isolated,
    repos: { ...isolated.repos, scoutResults: { ...h.repos.scoutResults, readAll: async () => [mixed] } } };
  const continued = await runAutonomousCoordinator(usable, { planOnly: true, concurrency: 4 });
  const sameWork = continued.decisions.find(decision => decision.workItemId === h.item.id)!;
  assert.equal(sameWork.action, "WORKER", "other retained evidence for the same work item still grounds acquisition");
  assert.equal(sameWork.task?.workerTask?.acquisition?.route.observation.artifactId, scout.candidates[0]!.evidenceArtifactIds[0]);
  assert.match(sameWork.reason, named);
  assert.equal(continued.deferred.length, 1);
  assert.match(continued.deferred[0]!.detail, new RegExp(missingId));
  assert.equal(continued.decisions.filter(decision => goodIds.includes(decision.workItemId) && decision.task).length, 3);
  assert.equal((await h.repos.workerResults.readAll()).length, 0, "selection cannot assert parsed or verified facts");
  assert.deepEqual(h.calls, [], "held planning makes no source or model request");
  const absent = await runAutonomousCoordinator({ ...isolated,
    readEvidence: workerVaultResolver(h.repos, new MemoryEvidenceStore(), h.item.project),
    repos: { ...isolated.repos, scoutResults: { ...h.repos.scoutResults, readAll: async () => [scout] } } },
  { planOnly: true, concurrency: 4 });
  assert.equal(absent.decisions.filter(decision => goodIds.includes(decision.workItemId) && decision.task).length, 3);
  assert.equal(absent.decisions.find(decision => decision.workItemId === h.item.id)?.action, "SCOUT");
  assert.deepEqual(absent.deferred.map(row => [row.workItemId,row.reason]), [[h.item.id,"WORKER_ARTIFACT_NOT_IN_VAULT"]]);
  assert.match(absent.deferred[0]!.detail, new RegExp(scout.candidates[0]!.evidenceArtifactIds[0]!));
  assert.equal(absent.dispatches.length, 0);
  const mixedVault = await runAutonomousCoordinator({ ...usable, readEvidence: async id => {
    if (id === missingId) throw new Error("WORKER_ARTIFACT_NOT_IN_VAULT");
    return isolated.readEvidence(id);
  } }, { planOnly: true, concurrency: 4 });
  const vaultSameWork = mixedVault.decisions.find(decision => decision.workItemId === h.item.id)!;
  assert.equal(vaultSameWork.action, "WORKER");
  assert.equal(vaultSameWork.task?.workerTask?.acquisition?.route.observation.artifactId, scout.candidates[0]!.evidenceArtifactIds[0]);
  assert.match(vaultSameWork.reason, new RegExp(`WORKER_ARTIFACT_NOT_IN_VAULT:${missingId}`));
  assert.equal(mixedVault.deferred.length, 1);
  assert.equal(mixedVault.deferred[0]!.reason, "WORKER_ARTIFACT_NOT_IN_VAULT");
  assert.equal(mixedVault.decisions.filter(decision => goodIds.includes(decision.workItemId) && decision.task).length, 3);
  assert.equal((await h.repos.workerResults.readAll()).length, 0);
  assert.deepEqual(h.calls, []);
  for (const message of ["CONTROL_PLANE_REQUEST_TIMEOUT: repository read", "MODEL_PROVIDER_FAILURE:503",
    "WORKER_ARTIFACT_PROVENANCE_REFUSED", "WORKER_ARTIFACT_NOT_IN_VAULTISH", "EvidenceCorrupted"]) {
    const failure = new Error(message);
    await assert.rejects(runAutonomousCoordinator({ ...usable, readEvidence: async () => { throw failure; } },
      { planOnly: true, concurrency: 4 }), error => error === failure,
    "only named absent held evidence is isolated; repository, provider and invalid evidence failures still propagate");
  }
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
  let calls=0; const available={...h.runtime,rollingCeilingUsd:5,scoutFor:()=>({lane:"BOUNDED_MODEL_WORKER" as const,workerFor:({holder}:{holder:string})=>({role:"SCOUT" as const,provider:"offline-fixture",version:"1",instance:holder}),run:async()=>{calls++;return {kind:"ABORTED" as const,ranAs:"BOUNDED_MODEL_WORKER" as const,cost:ZERO_COST,endedAt:h.now(),detail:"Controlled offline Scout availability proof; no civic disposition."};}})};
  const retry=await runAutonomousCoordinator(available,{maximum:1,maxScoutDispatches:1}); assert.equal(calls,1); assert.equal(retry.scoutsAdmitted,1);
  assert.equal((await h.repos.routeTasks.mustRead(first.dispatches[0].routeTaskId!)).value.policyReauthorizations?.[0].denial.attemptId,denied.id);
});

test("completed Scout without a candidate continues after canonical backoff with durable rungs and immutable prior history",async()=>{
  const h=await autonomousHarness({plan:plan=>({...plan,sources:[],acquisition:[]})});
  const metadata=(await h.repos.artifacts.readAll())[0];
  const inheritedHistories:(readonly ScoutResult[])[]=[];
  const runtime:AutonomousCoordinatorRuntime={...h.runtime,rollingCeilingUsd:5,scoutFor:(item,task,history)=>{
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

test("a brokered sibling capture admits one old-protocol Scout continuation before backoff, without repeating it", async () => {
  const h = await autonomousHarness({plan:plan=>({...plan,sources:[],acquisition:[]})});
  const heldId = (await h.repos.artifacts.readAll())[0]!.artifactId;
  let walks = 0;
  const runtime: AutonomousCoordinatorRuntime = {...h.runtime, rollingCeilingUsd:100, scoutFor:(item,task)=>({
    lane:"BOUNDED_MODEL_WORKER", workerFor:({holder})=>({role:"SCOUT",provider:"offline-fixture",version:"1",instance:holder}),
    run:async({attemptId})=>{
      walks++;
      const at = h.now();
      const attempt = (await h.repos.attempts.mustRead(attemptId)).value;
      const result: ScoutResult = {formatVersion:1,attemptId,obligationId:task.id,routeTaskId:task.id,
        workItemId:item.id,subjectId:item.subject,routeId:task.routeId,recordClass:"OFFICIAL_ROSTER",providerId:null,
        reason:"Offline legacy held-protocol fixture",outcome:"BLOCKED",stoppedBy:"BOUND",rungs:[],distinctEvidenceRungs:0,
        candidates:[],findings:[],nextRungs:["read handed saved representation"],unverified:["Source remains unresolved"],
        narrative:"No civic facts established.",worker:{provider:"offline-fixture",model:"none",modelReported:null},
        usage:{inputTokens:0,outputTokens:0,cacheReadInputTokens:0,cacheCreationInputTokens:0,turns:0,toolCalls:0},
        usd:0,elapsedMs:0,artifactIds:[],methodCandidateIds:[],refusal:null,startedAt:attempt.startedAt,recordedAt:at,
        ...(walks > 1 ? {recoveryCapabilityVersion:SCOUT_HELD_EVIDENCE_PROTOCOL_VERSION} : {})};
      await h.repos.scoutResults.append(result.obligationId,result.attemptId,result,at);
      return {kind:"DISPOSED",ranAs:"BOUNDED_MODEL_WORKER",endedAt:at,cost:{...ZERO_COST,usd:0,requestCount:0,inputTokens:0,outputTokens:0},artifacts:[],
        disposition:{disposition:"BLOCKED_CURRENTLY",observation:null,permission:"ALLOWED",transport:"OTHER_NAMED_FAILURE",
          note:"Offline fixture keeps the obligation open."},detail:result.narrative};
    },
  })};
  const first = await runAutonomousCoordinator(runtime,{maximum:1,concurrency:1});
  assert.equal(first.dispatches[0]?.outcome,"WORKED",first.dispatches[0]?.detail);
  assert.equal((await nextAutonomousOperation(runtime,h.item.id)).action,"BLOCKED",
    "a sibling's capture must not bypass backoff unless the standing broker handed it to this root");
  const brokered: AutonomousCoordinatorRuntime = {...runtime,lifetimeHuntSubject:subject=>subject===h.item.subject,
    authorizedSiblingHeldArtifactIdsFor:item=>
    item.id===h.item.id ? [heldId] : []};
  const next = await nextAutonomousOperation(brokered,h.item.id);
  assert.equal(next.action,"SCOUT");
  assert.match(next.task!.routeId,/:continue:/);
  assert.equal((await nextAutonomousOperation(brokered,h.item.id)).task?.id,next.task?.id,
    "the same continuation is reused durably");
  const second = await runAutonomousCoordinator(brokered,{maximum:1,concurrency:1});
  assert.equal(second.dispatches[0]?.routeTaskId,next.task?.id);
  assert.equal(walks,2);
  assert.equal((await nextAutonomousOperation(brokered,h.item.id)).action,"BLOCKED",
    "after a new-protocol Scout has run, ordinary debt applies to further investigation");
});

test("Scout admission does not wait for another hunt's legacy model lock",async()=>{
  const h=await autonomousHarness({plan:plan=>({...plan,sources:[],acquisition:[]})});
  const before=(await h.repos.attempts.list()).length;
  const deferred=await h.repos.locks.withLock("autonomous-model-admission",()=>runAutonomousCoordinator(h.runtime,{maximum:1,concurrency:2}));
  assert.equal(deferred.dispatches.length,1);
  assert.equal(deferred.deferred.length,0);
  assert.equal((await h.repos.attempts.list()).length,before+1);
});

test("50 hunts share admission before a larger priority hunt takes its second item", async () => {
  const h = await autonomousHarness();
  const items = Array.from({ length: 50 }, (_, i) => ({ ...h.item, id: `hunt-${i}:first`,
    autonomousPlan: { ...h.item.autonomousPlan!, ownerInstructions: [`hunt-${i}`] } }));
  const extra = Array.from({ length: 80 }, (_, i) => ({ ...items[0], id: `hunt-0:extra-${i}` }));
  const priorities = items.map((_, i) => ({ receiptId: `hunt-${i}`, priority: i }));
  const byId = new Map([...extra, ...items].map(item => [item.id, item]));
  const ordered = fairAutonomousWorkIds([...extra, ...items], new Map(), priorities);
  assert.equal(new Set(ordered.slice(0, 50).map(id => byId.get(id)!.autonomousPlan.ownerInstructions[0])).size, 50);
  const served = new Map([[ordered[0], FIXTURE_NOW]]);
  const resumed = fairAutonomousWorkIds([...extra, ...items], served, priorities);
  assert.equal(byId.get(resumed[0])!.autonomousPlan.ownerInstructions[0], "hunt-0", "owner place rank precedes earlier service");
  const equalRanks = priorities.map(row => ({ ...row, priority: 0 }));
  assert.equal(byId.get(fairAutonomousWorkIds([...extra, ...items], served, equalRanks)[0])!.autonomousPlan.ownerInstructions[0], "hunt-1");
  assert.equal(new Set(resumed).size, items.length + extra.length);
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

test("CH-23 part 3 (DP-02): a passing outage on a known door is a free plain retry, and a shut door goes to the investigation", async t => {
  const h=await autonomousHarness({response:{transportError:"socket timeout"}});
  const failOnce=async()=>{
    const op=await nextAutonomousOperation(h.runtime,h.item.id); assert.equal(op.task?.workerTask?.role,"ACQUIRER",op.reason);
    assert.equal((await dispatchWorkerTask(h.runtime,op.task!)).outcome,"WORKED");
    return (await h.repos.workerResults.readAll()).map(row=>row).sort((a,b)=>b.endedAt.localeCompare(a.endedAt))[0];
  };
  const first=await failOnce();
  const waiting=await nextAutonomousOperation(h.runtime,h.item.id);
  assert.equal(waiting.action,"BLOCKED","a single timeout owes no paid walk");
  assert.match(waiting.reason,/passing outage.*read again with plain code at/);
  assert.ok(!(await h.repos.routeTasks.list()).some(row=>/autonomous:novelty:/.test(row.value.routeId)),"no Scout task was opened");
  h.advanceTo(new Date(Date.parse(first.endedAt)+(FIRST_BACKOFF_MINUTES+1)*60_000).toISOString());
  const second=await failOnce();
  assert.equal((await nextAutonomousOperation(h.runtime,h.item.id)).action,"BLOCKED");
  h.advanceTo(new Date(Date.parse(second.endedAt)+(2*FIRST_BACKOFF_MINUTES+1)*60_000).toISOString());
  await failOnce();
  // Three consecutive failures: the door is shut, so the investigation gets the turn before the next plain re-read is due.
  const shut=await nextAutonomousOperation(h.runtime,h.item.id);
  assert.equal(shut.action,"SCOUT",shut.reason); assert.match(shut.task!.routeId,/autonomous:novelty:/);
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

test("coordinator selection hands out canonical tasks without running tools or opening an Attempt", async () => {
  const h = await autonomousHarness({ plan: plan => ({ ...plan, sources: [], acquisition: [] }) });
  const legacy = { ...h.item, id: "work:legacy-held", autonomousPlan: undefined };
  await h.repos.workItems.put(legacy.id, legacy, h.now());
  const before = (await h.repos.attempts.list()).length;
  let snapshotCalls = 0;
  let snapshot: readonly WorkItem[] = [];
  const planned = await runAutonomousCoordinator(h.runtime, { planOnly: true,
    onSelectionSnapshot: items => { snapshotCalls++; snapshot = items; },
    acceptsWorkItem: item => {
      assert.equal(item, snapshot.find(row => row.id === item.id), "ordering receives the exact selection rows, without another read or clone");
      return true;
    },
  });
  assert.equal(snapshotCalls, 1);
  assert.deepEqual(snapshot.map(item => item.id).sort(), [h.item.id, legacy.id].sort());
  assert.equal(snapshot.find(item => item.id === legacy.id)?.autonomousPlan, undefined, "held work without an autonomous plan is also available for ordering");
  assert.equal(planned.decisions[0]?.action, "SCOUT");
  assert.equal(planned.decisions[0]?.task?.workItemId, h.item.id);
  assert.equal(planned.dispatches.length, 0);
  assert.equal((await h.repos.attempts.list()).length, before);
  assert.equal(h.calls.length, 0);
});

 test("separate processes pull shared tasks and each existing lease admits one Attempt", async () => {
  const root = await mkdtemp(join(tmpdir(), "s7-lease-worker-"));
  try {
    const repos = await createFileRepositories(root);
    const h = await autonomousHarness({ repos, plan: plan => ({ ...plan, sources: [], acquisition: [] }) });
    const method = methodFixture();
    await writeFieldManual(repos, [...knowledgeEntries(method), methodVersionEntry(method)], h.now());
    const selected = await nextAutonomousOperation(h.runtime, h.item.id);
    const second = createRouteTask({ workItemId: h.item.id, routeId: selected.task!.routeId + ":second",
      routeLabel: selected.task!.routeLabel, target: selected.task!.target, inherited: false, now: h.now() });
    await registerRouteTask(repos, second, h.now());
    const pids: number[] = [];
    let pulls = 0;
    const results = await withPromotedFixturesInChildren(() => runLeaseWorkerProcesses({ entry: "lib/control-plane/workers/lease-worker.ts",
      config: { root: process.cwd(), fileStoreRoot: root, postgres: false, taskIds: [selected.task!.id, second.id],
        modelEnabled: false, searchEnabled: false, ceilingUsd: 0, fundedSubjects: [] },
      capacity: () => 2, onStarted: pid => pids.push(pid),
      orderPending: async ids => { pulls++; return [...ids].reverse(); },
      transportFor: () => async () => { throw new Error("unexpected paid call"); } }));
    assert.equal(pids.length, 2);
    assert.ok(pulls >= 2, "each worker asks the parent for current priority before claiming a lease");
    assert.ok(pids.every(pid => pid !== process.pid));
    const attempts = (await repos.attempts.list()).map(row => row.value).filter(row => row.routeTaskId === selected.task!.id);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]!.outcome, "DENIED_BY_POLICY");
    assert.equal(results.filter(row => row.attemptId !== null).length, 2);
    assert.equal((await repos.attempts.list()).filter(row => row.value.routeTaskId === second.id).length, 1);
    // Model the late sibling arriving after a denial released its lease.
    await assert.rejects(claimRouteTask(repos, { routeTaskId: second.id,
      holder: "late-sibling", now: h.now(), ttlMs: 300_000 }), /ROUTE_TASK_POLICY_DENIED/);
    assert.equal((await repos.routeTasks.mustRead(second.id)).value.state, "POLICY_DENIED");
    assert.equal((await repos.leases.mustRead(second.id)).value.released, true);
    assert.equal((await repos.attempts.list()).filter(row => row.value.routeTaskId === second.id).length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("memory wait rechecks the emptied wave before forking queued lease workers", async () => {
  const root = await mkdtemp(join(tmpdir(), "s18-process-queue-"));
  try {
    await mkdir(join(root, "scripts"));
    await writeFile(join(root, "scripts/register-test-loader.mjs"), "");
    await writeFile(join(root, "worker.mjs"), `process.on('message', config => {
      process.send({ kind: 'finished', body: config.taskIds }); process.disconnect();
    });`);
    let forks = 0;
    await runLeaseWorkerProcesses({ entry: "worker.mjs", config: { root, postgres: false,
      taskIds: Array.from({ length: 40 }, (_, i) => `task:${i}`), modelEnabled: false, searchEnabled: false,
      ceilingUsd: 0, fundedSubjects: [] }, capacity: () => 40,
      slots: workerProcessSlots(() => 1, { availableBytes: () => 1000, headroomBytes: 0, peakBytes: () => 1 }),
      onStarted: () => { forks++; }, transportFor: () => async () => { throw new Error("no model in this fixture"); } });
    assert.equal(forks, 1, "queued admissions release without spawning after the first child drains all tasks");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a worker kill timer defers unfinished work and ends only its owned process tree", async () => {
  const root = await mkdtemp(join(tmpdir(), "s18-worker-timeout-"));
  try {
    await mkdir(join(root, "scripts"));
    await writeFile(join(root, "scripts/register-test-loader.mjs"), "");
    await writeFile(join(root, "worker.mjs"), `import { spawn } from 'node:child_process';
      import { writeFileSync } from 'node:fs';
      process.once('message', config => {
        const grandchild = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
        writeFileSync('descendant.pid', String(grandchild.pid));
        setTimeout(()=>{grandchild.kill();process.send({kind:'finished',body:config.taskIds});process.disconnect();},2500);
      });`);
    const input = { entry: "worker.mjs", childTimeoutMs: 1000, config: { root, postgres: false,
      taskIds: ["owed"], modelEnabled: false, searchEnabled: false, ceilingUsd: 0, fundedSubjects: [] },
      capacity: () => 1, transportFor: () => async () => { throw new Error("no model in this fixture"); } };
    const results = await runLeaseWorkerProcesses(input);
    assert.equal(results.length, 1);
    assert.equal(results[0]!.outcome, "FAILED");
    assert.match(results[0]!.detail, /WORKER_CHILD_TIMEOUT/);
    assert.equal(results[0]!.dispositionCommitted, false);
    const descendant = Number(await readFile(join(root, "descendant.pid"), "utf8"));
    if (process.platform === "win32") assert.throws(() => process.kill(descendant, 0));
    assert.doesNotThrow(() => process.kill(process.pid, 0), "the parent and unrelated trees remain alive");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the autonomous wave loop stops at its dispatch slice even while waves keep working", async () => {
  const source = await readFile(new URL("../scripts/freshness-shadow.mts", import.meta.url), "utf8");
  const start = source.indexOf("async function runAutonomousProcesses()");
  const end = source.indexOf("let meetingsDiscovery", start);
  const snippet = transpileModule(source.slice(start, end), { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.None } }).outputText;
  let calls = 0, now = 0;
  const wave = async () => { calls++; now += 20; return { dispatches: [{ outcome: calls <= 3 ? "WORKED" : "FAILED" }],
    scoutsAdmitted: 0, scoutsLimitedAdmitted: 0 }; };
  const run = new Function("runAutonomousWave", "releaseDrainRequested", "dispatchDeadlineMs", "Date", `${snippet} return runAutonomousProcesses;`)(wave, false, 30, { now: () => now });
  const report = await run();
  assert.equal(calls, 2);
  assert.equal(report.dispatches.length, 2, "completed work is retained when the slice defers later waves");

  const h = await autonomousHarness();
  const legacy = { ...h.item, id: "work:legacy-held", subject: "subject:legacy", autonomousPlan: undefined };
  const current = { ...h.item, id: "work:planned", subject: "subject:planned",
    autonomousPlan: { ...h.item.autonomousPlan!, ownerInstructions: ["hunt:planned"] } };
  const task = (workItemId: string, routeId: string) => createRouteTask({ workItemId, routeId,
    routeLabel: routeId, target: FIXTURE_URL, inherited: false, now: h.now() });
  const held = [task(legacy.id, "legacy:first"), task(legacy.id, "legacy:second"), task("work:missing", "dangling")];
  const plannedTask = task(current.id, "planned:first");
  const placeOrder = ["hunt:legacy", "hunt:planned"];
  const snapshotStart = source.indexOf("const workItemsById =", source.indexOf("async function runAutonomousWave()"));
  const snapshotEnd = source.indexOf("const plainTaskIds =", snapshotStart);
  const queueStart = source.indexOf("const readTaskQueue =", snapshotEnd);
  const queueEnd = source.indexOf("let taskQueue:", queueStart);
  assert.ok(snapshotStart >= 0 && snapshotEnd > snapshotStart && queueStart > snapshotEnd && queueEnd > queueStart);
  const ordering = transpileModule(`return (async () => {
    ${source.slice(snapshotStart, snapshotEnd)}
    ${source.slice(queueStart, queueEnd)}
    return { taskIds, metadata, remainingSnapshotItems: workItemsById.size, readTaskQueue };
  })();`, { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.None } }).outputText;
  let orderingReads = 0;
  const unreadable = () => { orderingReads++; throw new Error("ordering must reuse the selected metadata"); };
  const selected = await new Function("held", "fleet", "runAutonomousCoordinator", "placeOrder", "paidWorkerCapacity",
    "placeRankFor", "huntRoundComparator", "repos", "squadReading", ordering)(held, {},
    async (_fleet: unknown, options: { onSelectionSnapshot: (items: readonly WorkItem[]) => void }) => {
      options.onSelectionSnapshot([legacy, current]);
      return { decisions: [{ action: "WORKER", task: plannedTask }] };
    }, placeOrder, () => 1,
    (subject: string) => subject === legacy.subject ? placeOrder.indexOf("hunt:legacy") : null,
    huntRoundComparator, { routeTasks: { read: unreadable }, workItems: { read: unreadable } });
  assert.equal(selected.remainingSnapshotItems, 0, "the whole selection index is released after retaining only queued metadata");
  assert.equal(selected.metadata.get(held[0]!.id), legacy);
  assert.equal(selected.metadata.get(plannedTask.id), current);
  assert.equal(selected.metadata.get(held[2]!.id), undefined, "a dangling task has no fabricated metadata and remains for the child's fresh read");
  placeOrder.reverse(); // The first child asks after the owner priority refresh.
  const queue = selected.readTaskQueue();
  assert.equal(queue.rank(plannedTask.id), 0);
  assert.equal(queue.rank(held[2]!.id), Infinity);
  const ordered = [...selected.taskIds].sort((a, b) => queue.compareRound(a, b) || queue.rank(a) - queue.rank(b));
  assert.equal(ordered[0], plannedTask.id);
  assert.ok(ordered.indexOf(held[0]!.id) < ordered.indexOf(held[1]!.id));
  assert.ok(ordered.includes(held[2]!.id), "ordering does not drop unresolved tasks or claim that they are absent");
  assert.ok(queue.compareRound(held[1]!.id, plannedTask.id) > 0, "removing a completed first task does not reset the hunt's second round");
  assert.equal(orderingReads, 0);
});

test("pool returns a completed dispatch and records unfinished work when a child exits unsuccessfully", async () => {
  const root = await mkdtemp(join(tmpdir(), "s18-process-failure-"));
  try {
    await mkdir(join(root, "scripts"));
    await writeFile(join(root, "scripts/register-test-loader.mjs"), "");
    const completed = { ...workerDispatchFailure("one", "fixture"), outcome: "WORKED",
      claimed: true, dispositionCommitted: true, disposition: "INGESTED", attemptId: "attempt:one" };
    await writeFile(join(root, "worker.mjs"), `process.on('message', () => {
      process.send({ kind: 'result', body: ${JSON.stringify(completed)} });
      process.exitCode = 1; process.disconnect();
    });`);
    const results = await runLeaseWorkerProcesses({ entry: "worker.mjs", config: { root, postgres: false,
      taskIds: ["one", "two"], modelEnabled: false, searchEnabled: false, ceilingUsd: 0, fundedSubjects: [] },
      capacity: () => 1, transportFor: () => async () => { throw new Error("no model in this fixture"); } });
    assert.deepEqual(results.map(row => [row.routeTaskId, row.outcome]), [["one", "WORKED"], ["two", "FAILED"]]);
    assert.match(results[1]!.detail, /LEASE_WORKER_EXIT/);
    assert.equal(results[1]!.claimed, false);
    assert.equal(results[1]!.dispositionCommitted, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("one work-item read failure costs one task and the same lease child reaches the next task", async () => {
  const root = await mkdtemp(join(tmpdir(), "s18-lease-read-"));
  try {
    const repos = await createFileRepositories(root);
    const h = await autonomousHarness({ repos, plan: plan => ({ ...plan, sources: [], acquisition: [] }) });
    const method = methodFixture();
    await writeFieldManual(repos, [...knowledgeEntries(method), methodVersionEntry(method)], h.now());
    const selected = await nextAutonomousOperation(h.runtime, h.item.id);
    const unreadable = createRouteTask({ workItemId: "missing:forced-read", routeId: "forced-read",
      routeLabel: "Unreadable work item", target: "https://example.gov/", inherited: false, now: h.now() });
    await repos.routeTasks.put(unreadable.id, unreadable, h.now());
    let forks = 0;
    const results = await withPromotedFixturesInChildren(() => runLeaseWorkerProcesses({ entry: "lib/control-plane/workers/lease-worker.ts",
      config: { root: process.cwd(), fileStoreRoot: root, postgres: false, taskIds: [unreadable.id, selected.task!.id],
        modelEnabled: false, searchEnabled: false, ceilingUsd: 0, fundedSubjects: [] },
      capacity: () => 1, onStarted: () => { forks++; }, orderPending: async ids => ids,
      transportFor: () => async () => { throw new Error("unexpected paid call"); } }));
    const failedRead = results.find(row => row.routeTaskId === unreadable.id)!;
    assert.equal(failedRead.outcome, "FAILED");
    assert.equal(failedRead.attemptId, null);
    assert.equal(failedRead.claimed, false);
    assert.match(failedRead.detail, /missing:forced-read/);
    const next = results.find(row => row.routeTaskId === selected.task!.id)!;
    assert.ok(next.attemptId, "the next task still reaches its normal admission and durable Attempt");
    assert.equal((await repos.attempts.list()).filter(row => row.value.routeTaskId === selected.task!.id).length, 1);
    assert.equal((await repos.routeTasks.mustRead(unreadable.id)).value.state, "PENDING");
    assert.equal(forks, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

 test("unchanged Scout request failures stay blocked while provider outages retain backoff", async () => {
  const h = await autonomousHarness();
  const base = (await h.repos.attempts.list())[0]!.value;
  assert.equal(unchangedScoutFailure({ ...base, outcome: "ABORTED", abortReason: "HTTP 400: malformed schema" }), true);
  assert.equal(unchangedScoutFailure({ ...base, outcome: "ABORTED", abortReason: "HTTP 400: invalid network tool schema" }), true);
  assert.equal(unchangedScoutFailure({ ...base, outcome: "ABORTED", abortReason: "HTTP 429: rate limited" }), false);
  assert.equal(unchangedScoutFailure({ ...base, outcome: "ABORTED", abortReason: "HTTP 503: provider unavailable" }), false);
});

test("ZIP process reports return after parent registry and election publication, with one shared pointer writer", async () => {
  const root = await mkdtemp(join(tmpdir(), "s7-national-ipc-"));
  const progress: string[] = [];
  const log = console.log;
  console.log = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith("RCD_PROGRESS=")) progress.push(JSON.parse(args[0].slice("RCD_PROGRESS=".length)).key);
    else log(...args);
  };
  try {
    await mkdir(join(root, "scripts"), { recursive: true });
    await mkdir(join(root, "lib/control-plane/workers"), { recursive: true });
    await writeFile(join(root, "scripts/register-test-loader.mjs"), "export {};\n");
    await writeFile(join(root, "lib/control-plane/workers/national-worker.ts"), `
      const replies = new Map(); let sequence = 0;
      const call = (kind, body) => new Promise((resolve, reject) => {
        const id = String(++sequence); replies.set(id, { resolve, reject }); process.send({ kind, id, body });
      });
      process.on('message', async message => {
        if (message.id) {
          const reply = replies.get(message.id); replies.delete(message.id);
          message.error ? reply.reject(Error(message.error.message)) : reply.resolve(message.body); return;
        }
        try {
          const zip = message.taskIds[0];
          const request = { now: '2026-09-30T21:00:00Z', divisions: [], geographyCaptures: [], sources: { zip, officials: [] } };
          const publication = await call('national-publication', request).catch(error => ({ error: error.message }));
          const election = await call('election-publication', { fields: [{ divisionId: 'ocd-division/country:us/state:ny',
            kind: 'registration_deadline', sourceUrl: 'https://elections.ny.gov/calendar', value: '2026-10-05', dates: ['2026-10-05'] }], now: request.now });
          await call('national-result', { zip, publications: [publication], electionPublications: [election] });
          process.send({ kind: 'finished', body: message.taskIds }); process.disconnect();
        } catch (error) { console.error(error.message); process.exitCode = 1; process.disconnect(); }
      });
    `);
    const store = new MemoryRoutineDataStore();
    let active = 0, peak = 0, registryCalls = 0;
    const published: string[] = [], delivered: string[] = [], pids: number[] = [];
    const write = async (kind: string) => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 15));
      active--; published.push(kind);
      return { kind };
    };
    const reports = await runNationalPlaceWorkerProcesses({ root, zips: ["10001", "10002", "10003"], capacity: () => 2, store,
      orderPending: async ids => [...ids].reverse(),
      slots: workerProcessSlots(() => 2, { availableBytes: () => 1000, headroomBytes: 100, peakBytes: () => 600 }),
      onStarted: pid => {
        if (pids.length === 1) assert.equal(delivered.length, 1, "The second ready ZIP stays queued until the first process finishes.");
        pids.push(pid);
      },
      publish: async input => {
        assert.equal(input.store, store, "the real store is supplied in the parent");
        registryCalls++;
        await write("registry");
        if (registryCalls === 1) throw new Error("one registry publication failed");
        return { promotedVersionId: `version:${registryCalls}`, divisions: [], bodies: [],
          members: [{ bodyId: "same-body", discoveryIds: ["same-official"], versionId: `version:${registryCalls}` }] };
      },
      publishElection: async () => { await write("election"); return { candidateId: "candidate:election",
        promotedVersionId: `election:${registryCalls}`, fields: ["same-deadline"], gaps: [] }; },
      onResult: report => { if ("deferred" in report) assert.fail(report.deferred);
        delivered.push(report.zip); assert.equal(report.electionPublications.length, 1); } });
    assert.equal(pids.length, 3);
    assert.equal(peak, 1, "registry and election callbacks share the parent critical section");
    assert.equal(published.length, 6, "one failure does not poison later pointer writes");
    assert.deepEqual(reports.map(report => report.zip).sort(), ["10001", "10002", "10003"]);
    assert.equal(delivered[0], "10003", "national workers pull the current owner place priority before launch");
    assert.deepEqual(delivered.sort(), ["10001", "10002", "10003"]);
    assert.equal(progress.length, 5);
    assert.equal(new Set(progress).size, 2, "new versions of the same registry and election facts cannot renew an idle child's progress clock");
    assert.equal(reports.filter(report => !("deferred" in report) && "error" in (report.publications[0] as object)).length, 1);
  } finally { console.log = log; await rm(root, { recursive: true, force: true }); }
});
