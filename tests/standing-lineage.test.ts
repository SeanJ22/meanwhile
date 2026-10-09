import assert from "node:assert/strict";
import test from "node:test";
import { autonomousHarness } from "./helpers/autonomous-fleet.ts";
import { createWorkItem, type WorkItem } from "../lib/control-plane/work-item.ts";
import { registerWorkItem } from "../lib/control-plane/repository/coordinator.ts";
import { runAutonomousCoordinator } from "../lib/control-plane/workers/coordinator.ts";
import type { FreshnessOccurrence } from "../lib/control-plane/scheduler/durable.ts";
import { FRESHNESS_PROJECT, standing } from "../lib/control-plane/scheduler/durable.ts";
import { brokeredSiblingCaptures, persistVerifiedPublicationAnchors, selectStandingLineages, standingLineageCoversDue, standingLineageKeyFor } from "../lib/control-plane/workers/standing-lineage.ts";

test("accepted child publication advances the source clock once and keeps partial gaps open", async () => {
  const h=await autonomousHarness();
  const dueAt="2026-09-03T18:00:00.000Z", publishedAt="2026-09-03T21:00:00.000Z";
  const root={...h.item,project:FRESHNESS_PROJECT,autonomousPlan:{...h.item.autonomousPlan!,ownerInstructions:["original-send"]}};
  const child={...createWorkItem({project:FRESHNESS_PROJECT,subject:root.subject,obligation:"exact repair",why:"replay",now:h.now()}),
    autonomousPlan:root.autonomousPlan,planRepair:{parentWorkItemId:root.id,rootWorkItemId:root.id,depth:1,
      proposalHash:"proposal",scoutAttemptId:(await h.repos.attempts.list())[0]!.id,sourceArtifactId:"artifact",
      retainedEvidenceIds:[],admittedAt:h.now(),authority:"WORK_INSTRUCTIONS_ONLY" as const,unresolved:[]},
    publicationOutcome:{at:publishedAt,status:"PUBLISHED" as const,code:"PUBLISHED",detail:"",workerResultId:"wr-child",
      candidateId:"candidate",versionId:"version",sourceArtifactId:"artifact",sourceObservedAt:publishedAt,records:{added:1,changed:0,reused:0}}};
  const obligation=standing({id:"freshness:officeholders:fixture",recordClass:"OFFICIAL_ROSTER",subjectId:root.subject,
    routeId:null,active:true,readerImpactAt:null,observedChangeRateHours:null,declaredCycleHours:24,lastWorkedAt:null,
    autonomousPlan:root.autonomousPlan,assignments:[{assignmentKey:"scope:fixture",ref:"original-send",relation:"CREATED",at:dueAt}]},dueAt);
  await h.repos.obligations.put(obligation.id,obligation,dueAt);
  const occurrence:FreshnessOccurrence={id:"round-1",obligationId:obligation.id,sequence:1,dueAt,
    workItemId:root.id,routeTaskId:"route",openedAt:dueAt,closedAt:dueAt,disposition:null,unresolvedReason:"source owed"};
  const original=(await h.repos.attempts.list())[0]!.value;
  const audit={...original,id:"at-child-audit",workItemId:child.id,worker:{...original.worker,role:"ADVERSARIAL_AUDITOR" as const}};
  const selection=(workItem:WorkItem)=>selectStandingLineages({occurrences:[occurrence],workItems:[root,workItem],
    artifacts:[],attempts:[audit],workerResults:[{id:"wr-child",workItemId:child.id,attemptId:audit.id,
      result:{role:"ADVERSARIAL_AUDITOR",verdict:"SURVIVED"}}]});
  const now="2026-09-03T22:00:00.000Z";
  const partial={...child,publicationOutcome:{...child.publicationOutcome,status:"PARTIALLY_PUBLISHED" as const}};
  assert.equal(selection(partial)[0]?.publishedAt, publishedAt, "accepted partial facts carry the same source observation");
  const anchored=await persistVerifiedPublicationAnchors(h.repos,{obligations:[obligation],lineages:selection(child),now});
  assert.deepEqual(anchored.anchored,[obligation.id]);
  assert.equal((await h.repos.obligations.mustRead(obligation.id)).value.lastWorkedAt,publishedAt);
  assert.equal((await h.repos.obligations.mustRead(obligation.id)).value.nextDueAt,"2026-09-04T21:00:00.000Z");
  assert.deepEqual((await persistVerifiedPublicationAnchors(h.repos,{obligations:[obligation],lineages:selection(child),now})).anchored,[]);
});

test("one source period continues its richest actual held root without losing sibling history", async () => {
  const h = await autonomousHarness();
  const first = { ...h.item, autonomousPlan: { ...h.item.autonomousPlan!, ownerInstructions: ["original-send"] } };
  const second = { ...createWorkItem({ project:first.project, subject:first.subject, obligation:"same source period second round", why:"retry", now:h.now() }),
    autonomousPlan: { ...first.autonomousPlan!, contract: { ...first.autonomousPlan!.contract, methodVersion: 93 } } };
  const dueAt = "2026-09-03T18:00:00.000Z";
  const occurrence = (id:string, workItemId:string, openedAt:string):FreshnessOccurrence => ({
    id,obligationId:"freshness:officeholders:fixture",sequence:Number(id.slice(-1)),dueAt,workItemId,
    routeTaskId:`route-${id}`,openedAt,closedAt:openedAt,disposition:null,unresolvedReason:"Discovery remains owed" });
  const rounds=[occurrence("round-1",first.id,"2026-09-03T18:01:00.000Z"),occurrence("round-2",second.id,"2026-09-03T19:01:00.000Z")];
  const captured=(await h.repos.artifacts.readAll())[0]!;
  const attempts=(await h.repos.attempts.list()).map(row=>row.value);
  const lineages=selectStandingLineages({occurrences:rounds,workItems:[first,second],
    artifacts:[captured,{...captured,artifactId:"held-second",workItemId:first.id}],attempts,workerResults:[]});
  assert.equal(lineages.length,1,"method version does not create a new source obligation");
  assert.equal(lineages[0]?.rootWorkItemId,first.id,"the root with more held evidence continues");
  assert.deepEqual(new Set(lineages[0]?.siblingRootIds),new Set([first.id,second.id]));
  const key=standingLineageKeyFor({obligationId:rounds[0]!.obligationId,dueAt,project:first.project,subject:first.subject,
    plan:first.autonomousPlan,instructionReceipts:["original-send"]})!;
  assert.equal(standingLineageCoversDue({lineages,key,now:"2026-09-04T20:00:00.000Z",cadenceHours:24})?.rootWorkItemId,first.id,
    "an unresolved source cannot be re-rooted merely because one cadence elapsed");
  assert.equal(standingLineageCoversDue({lineages,key:key.replace("original-send","new-send"),now:dueAt,cadenceHours:24}),null,
    "a distinct instruction is not silently covered by the old one");

  const published={...first,publicationOutcome:{at:"2026-09-03T21:00:00.000Z",status:"PUBLISHED" as const,
    code:"PUBLISHED",detail:"",workerResultId:"wr",candidateId:"candidate",versionId:"version",
    sourceArtifactId:"held-second",sourceObservedAt:"2026-09-03T21:00:00.000Z",
    records:{added:1,changed:0,reused:0}}};
  const rootAudit={...attempts[0]!,id:"at-root-audit",workItemId:first.id,worker:{...attempts[0]!.worker,role:"ADVERSARIAL_AUDITOR" as const}};
  const finished=selectStandingLineages({occurrences:[rounds[0]!],workItems:[published],artifacts:[captured],
    attempts:[...attempts,rootAudit],workerResults:[{id:"wr",workItemId:first.id,attemptId:rootAudit.id,
      result:{role:"ADVERSARIAL_AUDITOR",verdict:"SURVIVED"}}]});
  assert.equal(selectStandingLineages({occurrences:[rounds[0]!],workItems:[published],artifacts:[captured],
    attempts,workerResults:[]})[0]?.publishedAt,published.publicationOutcome.sourceObservedAt,"ordinary accepted publication does not require an adversarial auditor");
  assert.ok(standingLineageCoversDue({lineages:finished,key,now:"2026-09-04T20:59:59.000Z",cadenceHours:24}));
  assert.equal(standingLineageCoversDue({lineages:finished,key,now:"2026-09-04T21:00:00.000Z",cadenceHours:24}),null,
    "only a verified publication permits a new cadence period");

  const repaired={...createWorkItem({project:first.project,subject:first.subject,obligation:"linked repair child",why:"real successor",now:h.now()}),
    autonomousPlan:first.autonomousPlan,planRepair:{parentWorkItemId:first.id,rootWorkItemId:first.id,depth:1,
      proposalHash:"proposal",scoutAttemptId:attempts[0]!.id,sourceArtifactId:captured.artifactId,
      retainedEvidenceIds:[captured.artifactId],admittedAt:h.now(),authority:"WORK_INSTRUCTIONS_ONLY" as const,unresolved:[]},
    publicationOutcome:published.publicationOutcome};
  const childAudit={...rootAudit,id:"at-child-audit",workItemId:repaired.id};
  const childResults=[{id:"wr",workItemId:repaired.id,attemptId:childAudit.id,result:{role:"ADVERSARIAL_AUDITOR",verdict:"SURVIVED"}}];
  const childPublished=selectStandingLineages({occurrences:rounds,workItems:[first,second,repaired],artifacts:[captured],
    attempts:[...attempts,childAudit],workerResults:childResults});
  assert.equal(childPublished[0]?.rootWorkItemId,first.id,"verified child publication belongs only to its exact root");
  assert.equal(childPublished[0]?.publishedAt,published.publicationOutcome.at);
  assert.equal(standingLineageCoversDue({lineages:childPublished,key,now:"2026-09-04T21:00:00.000Z",cadenceHours:24}),null);
  const partial={...repaired,publicationOutcome:{...published.publicationOutcome,status:"PARTIALLY_PUBLISHED" as const}};
  const childPartial=selectStandingLineages({occurrences:rounds,workItems:[first,second,partial],artifacts:[captured],
    attempts:[...attempts,childAudit],workerResults:childResults});
  assert.equal(childPartial[0]?.publishedAt,published.publicationOutcome.sourceObservedAt,"partial accepted output records its source observation");
  assert.equal(standingLineageCoversDue({lineages:childPartial,key,now:"2026-10-04T21:00:00.000Z",cadenceHours:24}),null);
});

test("coordinator keeps duplicate period roots recorded but defers their paid lane", async () => {
  const h=await autonomousHarness();
  const other={...createWorkItem({project:h.item.project,subject:h.item.subject,
    obligation:"second standing round same period",why:"Historical duplicate",now:h.now()}),autonomousPlan:h.item.autonomousPlan!};
  await registerWorkItem(h.repos,other,h.now());
  const period="2026-09-03T18:00:00.000Z";
  for (const [sequence,item] of [[1,h.item],[2,other]] as const) await h.repos.occurrences.put(`occ-lineage-${sequence}`,{
    id:`occ-lineage-${sequence}`,obligationId:"freshness:officeholders:fixture",sequence,dueAt:period,
    workItemId:item.id,routeTaskId:`route-lineage-${sequence}`,openedAt:h.now(),closedAt:h.now(),
    disposition:null,unresolvedReason:"Source work remains owed"},h.now());
  const before=(await h.repos.attempts.list()).length;
  const pass=await runAutonomousCoordinator(h.runtime,{maximum:0,concurrency:1});
  assert.equal(pass.considered,2);
  assert.ok(pass.deferred.some(row=>row.workItemId===other.id && row.reason==="DUPLICATE_PERIOD_LINEAGE"));
  assert.ok(pass.deferred.some(row=>row.workItemId===h.item.id && row.reason==="COORDINATOR_CYCLE_MAX"));
  assert.equal((await h.repos.attempts.list()).length,before,"classification alone makes no paid request");
});

test("sibling bytes require a completed same-period origin and actual official-host success rung", async () => {
  const h=await autonomousHarness();
  const artifact=(await h.repos.artifacts.readAll())[0]!;
  const attempt=(await h.repos.attempts.mustRead(artifact.attemptId)).value;
  const lineage={key:"period",obligationId:"source",dueAt:h.now(),rootWorkItemId:"selected-root",
    siblingRootIds:["selected-root",h.item.id],publishedAt:null};
  const scout={attemptId:attempt.id,workItemId:h.item.id,rungs:[{index:0,rung:"primary-site-navigation" as const,
    tool:"fetch_public",target:artifact.canonicalUrl,observed:"HTTP 200",artifactIds:[artifact.artifactId],
    note:null,at:h.now(),ok:true,permission:"ALLOWED" as const,transport:"REACHABLE" as const,httpStatus:200}]};
  const input={lineage,artifacts:[artifact],attempts:[attempt],scouts:[scout],registeredHost:new URL(artifact.canonicalUrl).hostname};
  assert.deepEqual(brokeredSiblingCaptures(input),[{artifactId:artifact.artifactId,originWorkItemId:h.item.id}]);
  assert.deepEqual(brokeredSiblingCaptures({...input,registeredHost:"other.example.gov"}),[]);
  assert.deepEqual(brokeredSiblingCaptures({...input,attempts:[{...attempt,outcome:"ABORTED" as const}]}),[]);
  assert.deepEqual(brokeredSiblingCaptures({...input,scouts:[{...scout,rungs:[{...scout.rungs[0]!,httpStatus:403}]}]}),[]);
  assert.deepEqual(brokeredSiblingCaptures({...input,artifacts:[{...artifact,partial:true}]}),[]);
});
