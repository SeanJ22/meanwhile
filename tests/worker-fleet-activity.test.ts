import assert from "node:assert/strict";
import test from "node:test";
import { autonomousHarness, FIXTURE_URL } from "./helpers/autonomous-fleet.ts";
import { nextAutonomousOperation, runAutonomousCoordinator } from "../lib/control-plane/workers/coordinator.ts";
import { dispatchWorkerTask, enqueueWorkerTask } from "../lib/control-plane/workers/runtime.ts";
import { projectAutonomousActivity, readAutonomousActivity } from "../lib/control-plane/workers/activity.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import { registerWorkItem } from "../lib/control-plane/repository/coordinator.ts";
import type { EvidenceWalkStep } from "../lib/control-plane/workers/research-types.ts";

test("uncommitted or mismatched worker output never enters the proved event chain", async () => {
  const h=await autonomousHarness(); await runAutonomousCoordinator(h.runtime,{maximum:1,concurrency:1});
  const noBroadRead = async (): Promise<never> => { throw new Error("ACTIVITY_HISTORY_SCAN"); };
  const scoped = { ...h.repos,
    workItems: { ...h.repos.workItems, list: noBroadRead }, routeTasks: { ...h.repos.routeTasks, list: noBroadRead },
    attempts: { ...h.repos.attempts, list: noBroadRead }, leases: { ...h.repos.leases, list: noBroadRead },
    transitions: { ...h.repos.transitions, readAll: noBroadRead }, dispositions: { ...h.repos.dispositions, readAll: noBroadRead },
    artifacts: { ...h.repos.artifacts, readAll: noBroadRead }, costs: { ...h.repos.costs, readAll: noBroadRead },
    scoutResults: { ...h.repos.scoutResults, readAll: noBroadRead }, workerResults: { ...h.repos.workerResults, readAll: noBroadRead },
    promotionPipeline: { ...h.repos.promotionPipeline, readAll: noBroadRead },
  };
  const activity = (await readAutonomousActivity(scoped, [h.item.id], { observedAt: h.now() }))[0];
  assert.deepEqual(activity.evidenceGaps, []);
  const record=activity.facts.workers[0];
  const uncommitted={...activity.facts,attempts:activity.facts.attempts.map(attempt=>attempt.id===record.attemptId?{...attempt,outcome:null,endedAt:null}:attempt)};
  const projection=projectAutonomousActivity(uncommitted,{observedAt:h.now()})[0]; assert.ok(projection.evidenceGaps.includes(`WORKER_RESULT_UNPROVEN:${record.id}`));
  assert.ok(!projection.timeline.some(event=>event.kind==="WORKER_RESULT"&&event.id===record.id));
  assert.ok(projection.accounting.attemptIds.includes(record.attemptId),"Failed attribution still preserves the historical Attempt.");
  const detached={...activity.facts,artifacts:activity.facts.artifacts.filter(artifact=>artifact.canonicalUrl!==FIXTURE_URL)};
  assert.ok(projectAutonomousActivity(detached,{observedAt:h.now()})[0].evidenceGaps.some(gap=>gap.startsWith("WORKER_WALK_ATTRIBUTION_UNPROVEN:")));
});

test("cross-obligation source evidence retains original artifact/Attempt ownership without polluting local accounting",async()=>{
  const h=await autonomousHarness(); await runAutonomousCoordinator(h.runtime,{maximum:1,concurrency:1});
  const original=(await readAutonomousActivity(h.repos,[h.item.id],{observedAt:h.now()}))[0];
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
