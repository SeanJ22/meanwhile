import assert from "node:assert/strict";
import test from "node:test";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";
import { CHECKLIST_PROFILE, checklistFraction, checklistObligationKey, checklistRequiredClauses, evaluateChecklistSnapshot, type ChecklistInstance, type ChecklistSnapshot, type ChecklistWitness } from "../lib/control-plane/readiness/checklist-score.ts";

function fixture(definitionId = "MTG-01") {
  const predicateKey=CHECKLIST_PROFILE.definitions.find(d=>d.id===definitionId)!.canonicalPredicate;
  const obligationKey=checklistObligationKey(predicateKey,"body:one","jurisdiction:one","2026-09");
  const instance: ChecklistInstance={obligationKey,definitionIds:[definitionId],predicateKey,objectId:"body:one",jurisdictionId:"jurisdiction:one",period:"2026-09",scopeRevision:"inventory/1",
    applicability:{state:"REQUIRED",evidenceIds:["inventory:one"],reason:"Body belongs to this scope"},due:{state:"DUE_NOW",evidenceIds:["schedule:one"],at:"2026-09-01T00:00:00Z"},
    predicate:{kind:"POSSESSION",requiredClauses:[...checklistRequiredClauses(predicateKey),"identity","source"],contractVersion:"fields/1"},workIds:["work:one"],requiredSurfaces:["body-card","meeting-list"],requiresFreshness:true,owner:"worker",blocker:null,nextAction:"Refresh when due"};
  const witness: ChecklistWitness={id:`witness:${definitionId}`,obligationKey,objectId:instance.objectId,jurisdictionId:instance.jurisdictionId,period:instance.period,predicateKey,contractVersion:"fields/1",recordedAt:"2026-09-28T07:00:00Z",
    sourcePublication:"PUBLISHED",acquisition:"PRESENT",sourceIds:["source:one"],artifactIds:["artifact:one"],contentHashes:[`sha256-${"a".repeat(64)}`],attemptIds:["attempt:one"],verificationIds:["verification:one"],verification:"PASS",satisfiedClauses:instance.predicate.requiredClauses,conflict:false,
    freshness:{ruleId:"rule:daily",validUntil:"2026-09-29T00:00:00Z"},publication:{state:"ACCEPTED",candidateId:"candidate:one",version:"version:one",receiptId:"publication:one",at:"2026-09-28T06:00:00Z"},
    surfaces:instance.requiredSurfaces.map(surfaceId=>({surfaceId,version:"version:one",objectId:instance.objectId,jurisdictionId:instance.jurisdictionId,period:instance.period,checkedAt:"2026-09-28T06:30:00Z",receiptId:`public:${surfaceId}`,url:`${PUBLIC_SITE_ORIGIN}/`,visible:true})),change:"NEW"};
  const snapshot: ChecklistSnapshot={profile:CHECKLIST_PROFILE.version,scopeId:"85635",scopeRevision:"inventory/1",observedAt:"2026-09-28T08:00:00Z",inventory:{complete:true,evidenceIds:["inventory:one"],unresolvedObjects:0},readsComplete:true,instances:[instance],witnesses:[witness]};
  return {instance,witness,snapshot};
}

test("retains all original definitions and cannot certify a partially instantiated profile",()=>{
  assert.equal(CHECKLIST_PROFILE.definitions.length,325);
  assert.equal(new Set(CHECKLIST_PROFILE.definitions.map(d=>d.id)).size,325);
  const {snapshot}=fixture();const score=evaluateChecklistSnapshot(snapshot);
  assert.equal(score.results[0].passed,true);assert.equal(score.complete,false);assert.equal(score.provisional,true);
  assert.ok(score.uninstantiated.includes("ELE-01"));assert.equal(score.gates.state,"UNPROVED");
});
test("attempts, aliases and overlapping profiles cannot duplicate one obligation",()=>{
  const {instance,witness,snapshot}=fixture("REC-08");
  const result=evaluateChecklistSnapshot({...snapshot,instances:[instance,{...instance,definitionIds:["REC-17"],workIds:["second-job"]}],witnesses:[witness,witness]});
  assert.equal(result.results.length,1);assert.deepEqual(result.results[0].definitionIds,["REC-08","REC-17"]);
  assert.equal(result.results[0].passed,true);
});
test("accepted object version is counted once across field requirements and needs all promised surfaces",()=>{
  const a=fixture("MTG-01"),b=fixture("MTG-02");
  const snapshot={...a.snapshot,instances:[a.instance,b.instance],witnesses:[a.witness,b.witness]};
  const good=evaluateChecklistSnapshot(snapshot);assert.equal(good.publicDelivery.due,1);assert.equal(good.publicDelivery.passed,1);
  const partial=evaluateChecklistSnapshot({...snapshot,witnesses:[a.witness,{...b.witness,surfaces:b.witness.surfaces.slice(0,1)}]});
  assert.equal(partial.publicDelivery.due,1);assert.equal(partial.publicDelivery.passed,0);
});
test("work success, wrong geography, held publication and partial clauses do not earn delivery",()=>{
  const {snapshot,witness}=fixture();
  const bad: ChecklistWitness[]=[{...witness,verification:"UNPROVED"},{...witness,jurisdictionId:"elsewhere"},{...witness,publication:{...witness.publication,state:"HELD"}},
    {...witness,satisfiedClauses:["identity"]},{...witness,artifactIds:[]},{...witness,conflict:true},{...witness,sourcePublication:"NOT_PUBLISHED",acquisition:"ABSENT"}];
  for(const value of bad) assert.equal(evaluateChecklistSnapshot({...snapshot,witnesses:[value]}).results[0].passed,false);
});
test("stale and future observations cannot be substituted for current proof",()=>{
  const {snapshot,witness}=fixture();
  assert.equal(evaluateChecklistSnapshot({...snapshot,witnesses:[{...witness,freshness:{ruleId:"daily",validUntil:"2026-09-27T00:00:00Z"}}]}).results[0].disposition,"STALE");
  assert.equal(evaluateChecklistSnapshot({...snapshot,witnesses:[{...witness,recordedAt:"2026-09-29T00:00:00Z"}]}).results[0].passed,false);
});
test("unknown applicability and invalid absence decisions stay unresolved",()=>{
  const {instance,snapshot}=fixture();
  for(const state of ["UNRESOLVED","NOT_APPLICABLE"] as const){
    const score=evaluateChecklistSnapshot({...snapshot,instances:[{...instance,applicability:{state,evidenceIds:[],reason:""}}]});
    assert.equal(score.results[0].disposition,"UNCERTAIN_APPLICABILITY");assert.equal(score.complete,false);
  }
});
test("a duplicate with conflicting requirements is refused and partial reads stay provisional",()=>{
  const {instance,snapshot}=fixture();
  const conflict=evaluateChecklistSnapshot({...snapshot,instances:[instance,{...instance,predicate:{...instance.predicate,requiredClauses:["identity"]}}]});
  assert.equal(conflict.results[0].passed,false);
  assert.equal(evaluateChecklistSnapshot({...snapshot,readsComplete:false}).provisional,true);
});
test("zero denominator is unmeasured and display never rounds incomplete to 100",()=>{
  assert.equal(checklistFraction(0,0,1).percent,null);assert.equal(checklistFraction(9999,10000,0).percent,99.9);
});

test("an identity mismatch cannot earn public delivery or freshness",()=>{
  const {snapshot,witness}=fixture();
  const score=evaluateChecklistSnapshot({...snapshot,witnesses:[{...witness,jurisdictionId:"other-body"}]});
  assert.equal(score.results[0].visible,false);
  assert.equal(score.freshness.passed,0);
  assert.equal(score.publicDelivery.passed,0);
});
test("never acquired is not fresh and expired public readbacks cannot prove current delivery",()=>{
  const {snapshot,witness}=fixture();
  assert.equal(evaluateChecklistSnapshot({...snapshot,witnesses:[{...witness,acquisition:"UNKNOWN"}]}).freshness.passed,0);
  const old=evaluateChecklistSnapshot({...snapshot,observedAt:"2026-09-28T10:00:01Z"});
  assert.equal(old.publicDelivery.passed,0);
  assert.equal(old.results[0].passed,false);
});
