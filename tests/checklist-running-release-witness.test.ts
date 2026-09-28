import assert from "node:assert/strict";
import test from "node:test";
import type { ExpansionScopeDecision } from "../lib/control-plane/expansion/scopes.ts";
import type { AssignmentSources } from "../lib/control-plane/assignment-view.ts";
import type { RunnerHeartbeat, RuntimeReleaseAdoption } from "../lib/control-plane/owner-surface.ts";
import { ORIGINAL_LIFETIME_HUNT } from "../lib/control-plane/scheduler/hunt-continuation.ts";
import { CHECKLIST_PROFILE, checklistObligationKey, checklistRequiredClauses, evaluateChecklistSnapshot, type ChecklistInstance } from "../lib/control-plane/readiness/checklist-score.ts";
import { buildChecklistCensus } from "../lib/control-plane/readiness/checklist-census.ts";
import { GATE02_REPAIR_PHASE, GATE02_REQUIRED_BASE_SHA, checklistRunningReleaseWitness, retainedRuntimeReleaseAdoption, runtimeReleaseAdoptionHash } from "../lib/control-plane/readiness/checklist-running-release-witness.ts";

const scope={key:ORIGINAL_LIFETIME_HUNT.key,receiptId:ORIGINAL_LIFETIME_HUNT.receiptId,
  budgetStartedAt:ORIGINAL_LIFETIME_HUNT.budgetStartedAt,budgetUsd:ORIGINAL_LIFETIME_HUNT.budgetUsd} as ExpansionScopeDecision;
const sha="e".repeat(40);
const observed="2026-09-28T10:00:00.000Z";
const instance={obligationKey:checklistObligationKey("GATE-02",scope.key,scope.key,`instruction:${scope.receiptId}`),
  predicateKey:"GATE-02",objectId:scope.key,jurisdictionId:scope.key,period:`instruction:${scope.receiptId}`,
  predicate:{kind:"CAPABILITY",contractVersion:"checklist-field-contract/1",requiredClauses:checklistRequiredClauses("GATE-02")}} as ChecklistInstance;
function adoption(change:Partial<Omit<RuntimeReleaseAdoption,"evidenceHash">>={}):RuntimeReleaseAdoption {
  const fields:Omit<RuntimeReleaseAdoption,"evidenceHash">={formatVersion:1,phase:GATE02_REPAIR_PHASE,
    requiredBaseSha:GATE02_REQUIRED_BASE_SHA,baseContained:true,observedAt:"2026-09-28T09:00:00.000Z",processIdentity:"runner:12:start",
    runningSha:sha,servedSha:sha,servedHow:"GET https://example.org/api/build",inspectionCode:"RUNTIME_RELEASE_CURRENT",
    integrityReceiptId:"integrity-receipt",integritySha:sha,integrityObservedAt:"2026-09-28T08:00:00.000Z",...change};
  return {...fields,evidenceHash:runtimeReleaseAdoptionHash(fields)};
}
function heartbeat(change:Partial<RunnerHeartbeat>={}):RunnerHeartbeat {
  return {formatVersion:1,beatAt:"2026-09-28T09:06:00.000Z",lastCycleStartedAt:"2026-09-28T09:05:00.000Z",
    lastCycleFinishedAt:"2026-09-28T09:06:00.000Z",lastCycleOk:true,nextCycleDueAt:null,
    testedSha:sha,host:"runner",runtimeRelease:adoption(),codeIdentity:{readAt:"2026-09-28T09:05:30.000Z",
      runnerTestedSha:sha,verdict:"CONSISTENT"} as RunnerHeartbeat["codeIdentity"],...change};
}
const witness=(beat:RunnerHeartbeat|null=heartbeat(),decision:ExpansionScopeDecision=scope,now=observed)=>
  checklistRunningReleaseWitness({scope:decision,instances:[instance],heartbeat:beat,observedAt:now});

test("completed normal cycle on adopted required repair base earns only narrow GATE-02 witness",()=>{
  const result=witness();
  assert.equal(result.length,1);
  assert.deepEqual(result[0].satisfiedClauses,[`${CHECKLIST_PROFILE.version}:GATE-02`]);
  assert.equal(result[0].publication.state,"NONE");
  assert.equal(result[0].sourceIds[0],"https://example.org/api/build");
});
test("normal census connects only the running-release gate while the full inventory remains unresolved",()=>{
  const sources={obligations:[],occurrences:[],workItems:[],attempts:[],artifacts:[],workerResults:[],pipeline:[]} as unknown as AssignmentSources;
  const census=buildChecklistCensus({scope,sources,heartbeat:heartbeat(),observedAt:observed});
  assert.deepEqual(census.witnesses.map(row=>row.predicateKey),["GATE-02"]);
  assert.equal(census.inventory.complete,false);
  assert.equal(census.instances.find(row=>row.predicateKey==="GATE-02")?.requiresFreshness,true);
  const scored=evaluateChecklistSnapshot(census);
  assert.equal(scored.results.find(row=>row.definitionIds.includes("GATE-02"))?.passed,true);
  assert.equal(scored.complete,false);
});
test("an old CURRENT runner or tampered adoption cannot certify the required repair base",()=>{
  assert.equal(witness(heartbeat({runtimeRelease:adoption({baseContained:false})})).length,0);
  assert.equal(witness(heartbeat({runtimeRelease:adoption({requiredBaseSha:"f".repeat(40)})})).length,0);
  assert.equal(witness(heartbeat({runtimeRelease:{...adoption(),servedSha:"f".repeat(40)}})).length,0);
});
test("process, deployed, integrity and exact instruction identities must agree",()=>{
  assert.equal(witness(heartbeat({testedSha:"f".repeat(40)})).length,0);
  assert.equal(witness(heartbeat({runtimeRelease:adoption({integritySha:"f".repeat(40)})})).length,0);
  assert.equal(witness(heartbeat({codeIdentity:{...heartbeat().codeIdentity!,verdict:"RUNNER_BEHIND_EXECUTABLE"}})).length,0);
  assert.equal(witness(heartbeat(),{...scope,receiptId:"later-send"} as ExpansionScopeDecision).length,0);
});
test("a running but unfinished cycle, stale beat or expired adoption cannot pass",()=>{
  assert.equal(witness(heartbeat({lastCycleOk:null,lastCycleFinishedAt:null})).length,0);
  assert.equal(witness(heartbeat({lastCycleStartedAt:"2026-09-28T08:55:00.000Z"})).length,0);
  assert.equal(witness(heartbeat(),scope,"2026-09-28T13:01:00.000Z").length,0);
  assert.equal(witness(heartbeat({beatAt:"2026-09-28T08:59:00.000Z"})).length,0);
});
test("post-cycle boundary retains matching adoption until it expires or process changes",()=>{
  const first=adoption();
  const fresh=adoption({observedAt:"2026-09-28T09:07:00.000Z"});
  assert.equal(retainedRuntimeReleaseAdoption(first,fresh,"2026-09-28T09:07:00.000Z"),first);
  assert.equal(witness(heartbeat({runtimeRelease:retainedRuntimeReleaseAdoption(first,fresh,"2026-09-28T09:07:00.000Z")})).length,1);
  assert.equal(retainedRuntimeReleaseAdoption(first,fresh,"2026-09-28T12:00:00.000Z"),fresh);
  assert.equal(retainedRuntimeReleaseAdoption(first,adoption({processIdentity:"runner:13:new"}),"2026-09-28T09:07:00.000Z").processIdentity,"runner:13:new");
  assert.equal(retainedRuntimeReleaseAdoption(first,adoption({integrityReceiptId:"replacement"}),"2026-09-28T09:07:00.000Z").integrityReceiptId,"replacement");
});
