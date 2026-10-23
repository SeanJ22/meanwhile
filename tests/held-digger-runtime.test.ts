import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { registerWorkItem } from "../lib/control-plane/repository/coordinator.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import type { AutonomousCoordinatorRuntime } from "../lib/control-plane/workers/coordinator.ts";
import { withHeldDiggerRuntime } from "../lib/control-plane/workers/held-digger-runtime.ts";
import { enqueueWorkerTask } from "../lib/control-plane/workers/runtime.ts";
import type { GeneralizedCivicExtractionContract } from "../lib/control-plane/workers/types.ts";
import { isScheduled, scheduleObligation } from "../lib/control-plane/scheduler/obligation.ts";

test("held workers select the native publishers and bypass unrelated research history even with no model", async () => {
  const repos = createMemoryRepositories(), now = () => "2026-10-20T08:00:00.000Z";
  const item = createWorkItem({ project: "freshness", subject: "held:one", obligation: "held fixture",
    why: "One held subject", contract: { requiresValidation: true, requiresAudit: true }, now: now() });
  await registerWorkItem(repos, item, now());
  let researchHistoryReads = 0, researchExecutors = 0;
  const base: AutonomousCoordinatorRuntime = { repos, now, methodVersion: 1,
    readEvidence: async () => { throw new Error("unrelated research evidence must not be read"); },
    independentContext: async () => { throw new Error("unrelated model audit must not run"); },
    beginTask: async () => { researchHistoryReads++; },
    roleExecutor: () => { researchExecutors++; return { lane: "DETERMINISTIC", workerFor: () => ({ role: "ACQUIRER",
      provider: "fixture", version: "research", instance: "fixture" }), run: async () => ({ kind: "ABORTED", ranAs: "DETERMINISTIC", detail: "ordinary research" }) }; },
  };
  const runtime = withHeldDiggerRuntime(base, { root: process.cwd(), environment: { NODE_ENV: "test" } });
  const obligation = scheduleObligation({ id: "held-runtime-fixture", subjectId: item.subject,
    recordClass: "held-subject-enrichment", routeId: "source", active: true,
    readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null }, Date.parse(now()));
  assert.ok(isScheduled(obligation));
  const workerInput = { executor: "DETERMINISTIC" as const, obligation, holder: "one-subject-worker" };
  const contract = (recordClass: string): GeneralizedCivicExtractionContract => ({ schemaVersion: 2, recordClass,
    subjectId: item.subject, jurisdiction: { country: "US", state: "AZ", canonicalId: item.subject }, identity: { namespace: "fixture", keyFields: ["subjectId"] },
    sourceScope: { sourceId: "fixture", publisher: "example.gov", routeIds: ["source"], canonicalUrls: ["https://example.gov/"], observationArtifactIds: ["art:one"] },
    methodVersion: 1, requiredFields: [], completenessScope: "one held subject", expectedSourceDate: now(),
    extraction: { format: "HTML_PROFILE", fields: {} }, verification: { required: false, authorities: [] } });
  for (const [recordClass, version] of [["HELD_SUBJECT_DETAILS", "held-subject-details/1"], ["HELD_MEETING_DETAILS", "held-meeting-details/1"]]) {
    const task = await enqueueWorkerTask(repos, { workItemId: item.id, role: "ACQUIRER", artifactId: "art:one", contract: contract(recordClass!), now: now() });
    await runtime.beginTask!(task, item);
    const executor = runtime.roleExecutor!(task, "one-subject-worker");
    assert.equal(executor.lane, "DETERMINISTIC");
    assert.ok(executor.workerFor);
    assert.equal(executor.workerFor(workerInput).version, version);
  }
  assert.equal(researchHistoryReads, 0);
  assert.equal(researchExecutors, 0);
  const ordinary = await enqueueWorkerTask(repos, { workItemId: item.id, role: "ACQUIRER", artifactId: "art:one", contract: contract("OTHER"), now: now() });
  await runtime.beginTask!(ordinary, item);
  const ordinaryExecutor = runtime.roleExecutor!(ordinary, "research");
  assert.ok(ordinaryExecutor.workerFor);
  assert.equal(ordinaryExecutor.workerFor(workerInput).version, "research");
  assert.equal(researchHistoryReads, 1);
  assert.equal(researchExecutors, 1);
});
