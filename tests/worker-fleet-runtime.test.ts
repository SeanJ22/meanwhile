import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { mayWriteDisposition } from "../lib/control-plane/attempt.ts";
import { requireCapability } from "../lib/control-plane/capability.ts";
import { evaluateCompletion } from "../lib/control-plane/completion.ts";
import { recordAcquisition, type Artifact } from "../lib/control-plane/evidence/artifact.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { MemoryEvidenceStore, putArtifact, readForParser, type EvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { contentHash } from "../lib/control-plane/ids.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import {
  beginAttemptFor, claimRouteTask, disposeRouteTask, loadCompletionSnapshot,
  recordArtifactMetadata, registerRouteTask, registerWorkItem,
} from "../lib/control-plane/repository/coordinator.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { loadWorkerCompletionEvidence, readCompletedWorkerResult, readCompletedWorkerResults, reconcileWorkerCompletions } from "../lib/control-plane/repository/worker-completion.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { dischargesObligation, sweepExpiredLeases } from "../lib/control-plane/scheduler/dispatch.ts";
import { runIsolatedSource } from "../lib/control-plane/workers/isolation.ts";
import { workerTaskAdmission } from "../lib/control-plane/workers/scheduling.ts";
import {
  dispatchWorkerTask, drainWorkerQueue, enqueueWorkerTask, evidenceProjection,
  FLEET_IMPLEMENTATION_VERSION, FLEET_POLICY_VERSION, fleetGrant, type FleetRuntime,
} from "../lib/control-plane/workers/runtime.ts";
import type { CivicExtractionContract, FleetRole, WorkerResultRecord, WorkerTaskSpec } from "../lib/control-plane/workers/types.ts";

// Recorded publisher bytes exercise the deployed procedures. This deterministic
// suite is a regression control, not the session's live persisted-evidence proof.
const CAPTURE = readFileSync(new URL("./fixtures/legistar-pima-events.json", import.meta.url), "utf8");
const START = "2026-09-03T04:00:00.000Z";
const PROJECT = "worker-fleet-regression";
const METHOD_VERSION = 72;
const CONTRACT: CivicExtractionContract = {
  recordClass: "LEGISTAR_EVENTS", schemaVersion: 1,
  subjectId: "ocd-division/country:us/state:az/county:pima#governing",
  sourceBodyId: 138, sourceBodyName: "Board of Supervisors", publisherSlug: "pima",
  requiredFields: ["EventId", "EventBodyId", "EventBodyName", "EventDate", "EventTime"],
  completenessScope: "Every event in this captured representation; no all-future-meetings claim.",
  expectedSourceDate: null,
};

async function harness(repos: ControlPlaneRepositories = createMemoryRepositories(), store: EvidenceStore = new MemoryEvidenceStore()) {
  let clock = Date.parse(START);
  const now = () => new Date(clock += 1_000).toISOString();
  const item = createWorkItem({ project: PROJECT, subject: CONTRACT.subjectId,
    obligation: "Extract and independently verify the captured Pima event representation",
    why: "The evidence owed to readers must survive disposable worker execution.",
    contract: { requiresValidation: true, requiresAudit: true }, now: START });
  await registerWorkItem(repos, item, START);
  const artifacts = new Map<string, Artifact>();
  let captureNumber = 0;
  const hold = async (text: string, canonicalUrl = "https://webapi.legistar.com/v1/pima/events"): Promise<Artifact> => {
    const at = now();
    const routeId = `recorded-evidence-${++captureNumber}`;
    const acquisitionTask = createRouteTask({ workItemId: item.id, routeId, routeLabel: "Recorded fixture acquisition seam",
      target: canonicalUrl, inherited: false, now: at });
    await registerRouteTask(repos, acquisitionTask, at);
    const holder = `fixture-acquirer-${captureNumber}`;
    const claim = await claimRouteTask(repos, { routeTaskId: acquisitionTask.id, holder, now: at, ttlMs: 60_000 });
    const attempt = await beginAttemptFor(repos, { routeTaskId: acquisitionTask.id, workItemId: item.id,
      worker: { role: "ACQUIRER", provider: "recorded-fixture", version: "fixture-replay/1", instance: holder },
      lease: claim.lease.value, now: at, methodVersion: METHOD_VERSION, policyVersion: FLEET_POLICY_VERSION });
    const { artifact } = recordAcquisition({ canonicalUrl, retrievedAt: at, httpStatus: 200,
      contentType: "application/json", sourceId: "legistar-pima", methodRouteId: routeId,
      workItemId: item.id, attemptId: attempt.id, permission: "ALLOWED", transport: "REACHABLE" }, text);
    await putArtifact(store, PROJECT, artifact, Buffer.from(text));
    await recordArtifactMetadata(repos, { artifactId: artifact.id, workItemId: item.id, routeTaskId: acquisitionTask.id,
      attemptId: attempt.id, tier: artifact.tier, contentHash: artifact.contentHash, byteLength: artifact.byteLength,
      contentType: artifact.contentType, canonicalUrl: artifact.canonicalUrl, partial: false, recordedAt: at }, at);
    await disposeRouteTask(repos, { routeTaskId: acquisitionTask.id, attemptId: attempt.id,
      expectedTaskRevision: (await repos.routeTasks.mustRead(acquisitionTask.id)).revision,
      artifactIds: [artifact.id], now: at,
      disposition: { disposition: "INGESTED", attemptId: attempt.id, at, artifactIds: [artifact.id], observation: null,
        permission: "ALLOWED", transport: "REACHABLE", note: "Recorded publisher bytes loaded for a deterministic regression control; no live acquisition." } });
    artifacts.set(artifact.id, artifact);
    return artifact;
  };
  const readEvidence: FleetRuntime["readEvidence"] = async (artifactId) => {
    const artifact = artifacts.get(artifactId);
    if (!artifact) throw new Error("TEST_ARTIFACT_MISSING");
    return (await readForParser(store, PROJECT, artifact)).input;
  };
  const runtime: FleetRuntime = {
    repos, methodVersion: METHOD_VERSION, now, readEvidence,
    independentContext: async (scope) => {
      assert.deepEqual(Object.keys(scope).sort(), ["artifactId", "auditScope", "contract", "methodVersion", "workItemId"], "Canonical task identity may select attribution; no producer or validator result may enter starting-context construction.");
      assert.equal(scope.workItemId, item.id);
      return {
        subjectId: scope.contract.subjectId, contract: scope.contract, methodVersion: scope.methodVersion,
        publisherSurfaces: ["https://webapi.legistar.com/v1/pima/events"],
        routes: [...artifacts.values()].map((artifact) => ({ routeId: artifact.methodRouteId,
          canonicalUrl: artifact.canonicalUrl, applicable: true, status: "HELD" as const,
          artifactIds: [artifact.id], reason: "Independently inventoried fixture evidence route." })),
        evidence: await Promise.all([...artifacts.keys()].map(async (id) => evidenceProjection(await readEvidence(id)))),
        startedFrom: ["CANONICAL_SUBJECT_IDENTITY", "PUBLISHER_SOURCE_UNIVERSE", "METHOD_REGISTRY", "EVIDENCE_VAULT"],
        scope: scope.auditScope,
      };
    },
  };
  return { repos, store, item, hold, artifacts, runtime, now };
}

type Harness = Awaited<ReturnType<typeof harness>>;
async function run(h: Harness, artifact: Artifact, role: FleetRole, options: {
  producerResultId?: string; validatorResultId?: string; auditScope?: WorkerTaskSpec["auditScope"];
  replayLabel?: string; purpose?: WorkerTaskSpec["purpose"]; contract?: CivicExtractionContract; runtime?: FleetRuntime;
} = {}): Promise<WorkerResultRecord> {
  const task = await enqueueWorkerTask(h.repos, { workItemId: h.item.id, role, artifactId: artifact.id,
    contract: options.contract ?? CONTRACT, now: h.now(), ...options });
  const dispatch = await dispatchWorkerTask(options.runtime ?? h.runtime, task);
  assert.equal(dispatch.outcome, "WORKED", dispatch.detail);
  assert.equal(dispatch.dispositionCommitted, false);
  assert.equal(dischargesObligation(dispatch), false, "A computation cannot discharge a civic acquisition obligation.");
  const records = (await h.repos.workerResults.readAll()).filter((record) => record.attemptId === dispatch.attemptId);
  assert.equal(records.length, 1);
  return records[0];
}

test("actual isolated Parser → Validator → Auditor dispatch persists the existing durable execution contract", async () => {
  const h = await harness();
  const artifact = await h.hold(CAPTURE);
  let wholeResultReads = 0;
  const scopedResultReads: string[] = [];
  const currentAttemptReads: string[] = [];
  const observedRepos: ControlPlaneRepositories = { ...h.repos,
    workerResults: { ...h.repos.workerResults,
      readAll: async () => { wholeResultReads++; return h.repos.workerResults.readAll(); },
      read: async id => { scopedResultReads.push(id); return h.repos.workerResults.read(id); },
    },
    attempts: { ...h.repos.attempts,
      mustRead: async id => { currentAttemptReads.push(id); return h.repos.attempts.mustRead(id); },
    },
  };
  const observedRuntime = { ...h.runtime, repos: observedRepos };
  const parser = await run(h, artifact, "PARSER", { runtime: observedRuntime });
  assert.equal(parser.result.verdict, "EXTRACTED");
  assert.equal((await h.repos.workItems.mustRead(h.item.id)).value.state, "AWAITING_VALIDATION");
  const parserAttemptReadsBeforeValidation = currentAttemptReads.filter(id => id === parser.attemptId).length;
  const validator = await run(h, artifact, "VALIDATOR", { producerResultId: parser.id, runtime: observedRuntime });
  assert.equal(validator.result.verdict, "PASS");
  assert.equal((await h.repos.workItems.mustRead(h.item.id)).value.state, "AWAITING_AUDIT");
  const validatorAttemptReadsBeforeAudit = currentAttemptReads.filter(id => id === validator.attemptId).length;
  const auditor = await run(h, artifact, "ADVERSARIAL_AUDITOR", { producerResultId: parser.id, validatorResultId: validator.id, runtime: observedRuntime });
  assert.equal(auditor.result.verdict, "SURVIVED", JSON.stringify(auditor.result));
  assert.equal((await h.repos.workItems.mustRead(h.item.id)).value.state, "OPEN");
  assert.equal(new Set([parser.worker.instance, validator.worker.instance, auditor.worker.instance]).size, 3);
  assert.deepEqual(scopedResultReads, [h.item.id, h.item.id], "Validator and Auditor each read their own result log once; Parser reads no producer history.");
  assert.equal(wholeResultReads, 0, "Present exact references need no whole-history result read.");
  assert.equal(currentAttemptReads.filter(id => id === parser.attemptId).length - parserAttemptReadsBeforeValidation, 2, "Both roles validate the producer against its current persisted Attempt.");
  assert.equal(currentAttemptReads.filter(id => id === validator.attemptId).length - validatorAttemptReadsBeforeAudit, 1, "The Auditor still reads the Validator's current Attempt.");
  for (const record of [parser, validator, auditor]) {
    const attempt = (await h.repos.attempts.mustRead(record.attemptId)).value;
    const task = (await h.repos.routeTasks.mustRead(record.routeTaskId)).value;
    assert.equal(attempt.outcome, "COMPLETED");
    assert.deepEqual(attempt.worker, record.worker);
    assert.deepEqual(attempt.capabilityGrant, record.grant, "The grant is persisted on the Attempt before execution, not merely attached to successful output.");
    assert.equal(attempt.methodVersion, METHOD_VERSION);
    assert.equal(attempt.policyVersion, FLEET_POLICY_VERSION);
    assert.equal(record.worker.version, FLEET_IMPLEMENTATION_VERSION);
    assert.ok(attempt.startedAt && attempt.endedAt);
    assert.equal(task.state, "RESULT_RECORDED");
    assert.equal(task.disposition, null);
    assert.deepEqual(attempt.artifactIds, [artifact.id]);
    assert.deepEqual(attempt.cost, record.cost);
    assert.ok(record.cost.durationMs !== null && record.cost.durationMs >= 0);
    assert.equal(record.cost.usd, null);
    assert.equal(record.usage.inputTokens, null);
    assert.equal(record.usage.cacheReadInputTokens, null);
    assert.equal(record.cost.requestCount, 0);
    assert.equal(record.executionMode, "DETERMINISTIC");
    assert.deepEqual(record.grant, fleetGrant(record.worker.role as FleetRole, PROJECT, attempt.startedAt));
    const costs = (await h.repos.costs.readAll()).filter((cost) => cost.attemptId === record.attemptId);
    assert.equal(costs.length, 1);
    assert.deepEqual(costs[0].cost, record.cost);
    assert.equal((await h.repos.leases.mustRead(record.routeTaskId)).value.released, true);
  }
  assert.deepEqual(validator.inputResultIds, [parser.id]);
  assert.deepEqual(auditor.inputResultIds, [parser.id, validator.id]);
  assert.equal((await h.repos.promotionPipeline.readAll()).length, 0, "Workers have no direct canonical promotion authority.");
  const snapshot = await loadCompletionSnapshot(h.repos, { workItemId: h.item.id, now: h.now() });
  assert.equal(evaluateCompletion(snapshot, "VERIFIED_COMPLETE").mayComplete, false);
  assert.deepEqual(await drainWorkerQueue(h.runtime), [], "Completed worker computations are not re-executed.");

  const completed = await h.repos.routeTasks.mustRead(parser.routeTaskId);
  const attemptsBefore = await h.repos.attempts.list();
  await assert.rejects(dispatchWorkerTask(h.runtime, completed.value), /WORKER_TASK_NOT_DISPATCHABLE/);
  assert.deepEqual(await h.repos.attempts.list(), attemptsBefore, "Direct redispatch must not mint another Attempt or invalidate replayable completion.");
  assert.deepEqual(await h.repos.routeTasks.mustRead(completed.id), completed);
  await reconcileWorkerCompletions(observedRepos);
  assert.equal(wholeResultReads, 1, "Recovery independently scans all committed history; the execution batch never replaces it.");
  assert.equal((await h.repos.workerResults.readAll()).length, 3);

  const at = h.now();
  await assert.rejects(disposeRouteTask(h.repos, {
    routeTaskId: completed.id, attemptId: parser.attemptId, expectedTaskRevision: completed.revision,
    now: at, artifactIds: [artifact.id],
    disposition: { disposition: "INGESTED", attemptId: parser.attemptId, at,
      artifactIds: [artifact.id], observation: null, permission: "ALLOWED", transport: "REACHABLE",
      note: "Seeded attempt to launder successful computation into a civic acquisition disposition." },
  }), /WORKER_TASK_CANNOT_WRITE_CIVIC_DISPOSITION/);
  assert.deepEqual(await h.repos.routeTasks.mustRead(completed.id), completed);
  assert.deepEqual(await h.repos.dispositions.read(completed.id), [], "Computational success confers no civic disposition authority even through the coordinator API.");
});

test("completed worker history recovers with bulk reads and no per-result replay calls", async () => {
  const h = await harness();
  const artifact = await h.hold(CAPTURE);
  const parser = await run(h, artifact, "PARSER");
  const records = await h.repos.workerResults.readAll();
  const fail = async (): Promise<never> => { throw new Error("historical result caused a point read or write"); };
  const observed: ControlPlaneRepositories = { ...h.repos,
    workerResults: { ...h.repos.workerResults, readAll: async () => Array.from({ length: 1500 }, () => records[0]) },
    attempts: { ...h.repos.attempts, read: fail, mustRead: fail, compareAndSet: fail },
    routeTasks: { ...h.repos.routeTasks, read: fail, mustRead: fail, compareAndSet: fail },
    leases: { ...h.repos.leases, read: fail, compareAndSet: fail },
    costs: { ...h.repos.costs, append: fail },
    workItems: { ...h.repos.workItems, read: fail, mustRead: fail, compareAndSet: fail },
  };
  await reconcileWorkerCompletions(observed);
  const costs = await h.repos.costs.readAll();
  const historicalCosts = costs.map(({ model: _model, tier: _tier, ...cost }) => cost);
  await reconcileWorkerCompletions({ ...observed,
    costs: { ...observed.costs, readAll: async () => historicalCosts },
  });
  assert.deepEqual(await h.repos.costs.readAll(), costs, "Recovery preserves immutable historical charge content.");
  // Losing the cost append is a real partial commit, even with both aggregates
  // present. It must reach recovery, never the historical-success fast path.
  await assert.rejects(reconcileWorkerCompletions({ ...observed,
    costs: { ...observed.costs, readAll: async () => [] },
  }), /historical result caused/);
  assert.equal((await h.repos.attempts.mustRead(parser.attemptId)).value.outcome, "COMPLETED");
});

test("inherited worker history reads only its producers' Attempts for 1500 results and rejects missing or divergent producers", async () => {
  const h = await harness();
  const artifact = await h.hold(CAPTURE);
  const parser = await run(h, artifact, "PARSER");
  const attempts = await h.repos.attempts.list();
  let calls = 0;
  const observed: ControlPlaneRepositories = { ...h.repos,
    workerResults: { ...h.repos.workerResults, readAll: async () => {
      calls += 1;
      return [...Array.from({ length: 1500 }, () => parser),
        { ...parser, id: "missing-producer", attemptId: "absent" },
        { ...parser, id: "divergent-producer", completion: { ...parser.completion,
          closedAttempt: { ...parser.completion.closedAttempt, endedAt: "2026-09-15T00:00:00.000Z" } } }];
    } },
    attempts: { ...h.repos.attempts, list: async () => { throw new Error("whole cp_attempts listed"); },
      readMany: async (ids: readonly string[]) => { calls += 1; return attempts.filter(row => ids.includes(row.id)); },
      read: async () => { throw new Error("N+1 point read"); },
      mustRead: async () => { throw new Error("N+1 point read"); } },
  };
  const inherited = await readCompletedWorkerResults(observed);
  assert.equal(inherited.length, 1500);
  assert.ok(inherited.every(record => record.id === parser.id));
  assert.equal(calls, 2);
});

test("every runtime grant denies promotion/restricted reads, and Parser/Validator deny network", () => {
  for (const role of ["PARSER", "VALIDATOR", "ADVERSARIAL_AUDITOR"] as const) {
    const grant = fleetGrant(role, PROJECT, START);
    for (const capability of ["CANONICAL_PROMOTE", "METHOD_ASSERTION_PROMOTE", "VAULT_READ_RESTRICTED", "BROWSER_DRIVE", "PRODUCTION_DB_WRITE"] as const) {
      assert.throws(() => requireCapability(grant, capability));
    }
    assert.doesNotThrow(() => requireCapability(grant, "VAULT_READ_SANITIZED"));
    if (role === "ADVERSARIAL_AUDITOR") assert.doesNotThrow(() => requireCapability(grant, "NETWORK_PUBLIC_READ"));
    else assert.throws(() => requireCapability(grant, "NETWORK_PUBLIC_READ"));
  }
});

test("same held artifact replay creates a fresh Attempt with equivalent semantic output", async () => {
  const h = await harness();
  const artifact = await h.hold(CAPTURE);
  const first = await run(h, artifact, "PARSER");
  const second = await run(h, artifact, "PARSER", { replayLabel: "replay-control" });
  assert.notEqual(first.attemptId, second.attemptId);
  assert.notEqual(first.worker.instance, second.worker.instance);
  assert.equal(first.semanticHash, second.semanticHash);
  assert.deepEqual(first.inputArtifactIds, second.inputArtifactIds);
});

test("stale producer contract and prior Validator Attempt cannot certify a different exact candidate", async () => {
  const h = await harness();
  const artifact = await h.hold(CAPTURE);
  const first = await run(h, artifact, "PARSER");
  const validation = await run(h, artifact, "VALIDATOR", { producerResultId: first.id });
  const second = await run(h, artifact, "PARSER", { replayLabel: "new-attempt" });
  const staleAudit = await enqueueWorkerTask(h.repos, { workItemId: h.item.id, artifactId: artifact.id, role: "ADVERSARIAL_AUDITOR",
    contract: CONTRACT, producerResultId: second.id, validatorResultId: validation.id, now: h.now() });
  const stale = await dispatchWorkerTask(h.runtime, staleAudit);
  assert.equal(stale.outcome, "FAILED");
  assert.match(stale.detail, /AUDIT_EXACT_VALIDATION_BINDING_REFUSED/);
  const changedContract = await enqueueWorkerTask(h.repos, { workItemId: h.item.id, artifactId: artifact.id, role: "VALIDATOR",
    contract: { ...CONTRACT, expectedSourceDate: "2026-05-12" }, producerResultId: first.id, now: h.now() });
  const changed = await dispatchWorkerTask(h.runtime, changedContract);
  assert.equal(changed.outcome, "FAILED");
  assert.match(changed.detail, /WORKER_EXACT_CANDIDATE_BINDING_REFUSED/);
  const foreignItem = createWorkItem({ project: PROJECT, subject: CONTRACT.subjectId,
    obligation: "A distinct obligation cannot supply this work item's producer result", why: "Retain exact work ownership.",
    contract: { requiresValidation: true, requiresAudit: true }, now: h.now() });
  await registerWorkItem(h.repos, foreignItem, h.now());
  const foreignParserTask = await enqueueWorkerTask(h.repos, { workItemId: foreignItem.id, artifactId: artifact.id,
    role: "PARSER", contract: CONTRACT, now: h.now() });
  const foreignParserDispatch = await dispatchWorkerTask(h.runtime, foreignParserTask);
  assert.equal(foreignParserDispatch.outcome, "WORKED", foreignParserDispatch.detail);
  const foreignParser = (await h.repos.workerResults.read(foreignItem.id))[0]!;
  let fallbackReads = 0;
  let batchReads = 0;
  const observedRuntime = { ...h.runtime, repos: { ...h.repos, workerResults: { ...h.repos.workerResults,
    read: async (id: string) => { batchReads++; return h.repos.workerResults.read(id); },
    readAll: async () => { fallbackReads++; return h.repos.workerResults.readAll(); },
  } } };
  const foreignTask = await enqueueWorkerTask(h.repos, { workItemId: h.item.id, artifactId: artifact.id,
    role: "VALIDATOR", contract: CONTRACT, producerResultId: foreignParser.id, now: h.now() });
  const foreign = await dispatchWorkerTask(observedRuntime, foreignTask);
  assert.equal(foreign.outcome, "FAILED");
  assert.match(foreign.detail, /WORKER_EXACT_CANDIDATE_BINDING_REFUSED/);
  assert.equal(fallbackReads, 1, "A foreign reference retains the exact cross-work refusal through the original point helper.");
  const missingTask = await enqueueWorkerTask(h.repos, { workItemId: h.item.id, artifactId: artifact.id,
    role: "VALIDATOR", contract: CONTRACT, producerResultId: "wr-absent-producer", now: h.now() });
  const missing = await dispatchWorkerTask(observedRuntime, missingTask);
  assert.equal(missing.outcome, "FAILED");
  assert.match(missing.detail, /WORKER_RESULT_MISSING/);
  assert.equal(fallbackReads, 2, "An absent reference keeps its original failure classification.");
  assert.equal(batchReads, 2);
  const unreadableTask = await enqueueWorkerTask(h.repos, { workItemId: h.item.id, artifactId: artifact.id,
    role: "VALIDATOR", contract: CONTRACT, producerResultId: first.id, replayLabel: "unreadable-batch", now: h.now() });
  let failedBatchReads = 0;
  const unreadable = await dispatchWorkerTask({ ...observedRuntime, repos: { ...observedRuntime.repos,
    workerResults: { ...observedRuntime.repos.workerResults,
      read: async () => { failedBatchReads++; throw new Error("RESULT_BATCH_UNREADABLE"); },
    },
  } }, unreadableTask);
  assert.equal(unreadable.outcome, "FAILED");
  assert.match(unreadable.detail, /RESULT_BATCH_UNREADABLE/);
  assert.equal(failedBatchReads, 1, "A failed read is neither retried nor treated as an absent result.");
  assert.equal(fallbackReads, 2, "An unreadable batch never falls back to a whole-history read.");
  for (const failed of [stale, changed, foreign, missing, unreadable]) {
    assert.equal(failed.dispositionCommitted, false);
    assert.equal((await h.repos.attempts.mustRead(failed.attemptId!)).value.outcome, "ABORTED");
    assert.ok(!(await h.repos.workerResults.readAll()).some((record) => record.attemptId === failed.attemptId));
  }
});

test("missing, hash-corrupted, or wrong immutable input abandons the Attempt without any civic output", async () => {
  const h = await harness();
  const artifact = await h.hold(CAPTURE);
  const task = await enqueueWorkerTask(h.repos, { workItemId: h.item.id, role: "PARSER", artifactId: artifact.id,
    contract: CONTRACT, now: h.now() });
  const missing = await dispatchWorkerTask({ ...h.runtime, readEvidence: async () => { throw new Error("TEST_ARTIFACT_MISSING"); } }, task);
  assert.equal(missing.outcome, "FAILED");
  assert.match(missing.detail, /TEST_ARTIFACT_MISSING/);
  const corrupted = await dispatchWorkerTask({ ...h.runtime, readEvidence: async (id) => ({ ...await h.runtime.readEvidence(id), text: "[]" }) }, task);
  assert.equal(corrupted.outcome, "FAILED");
  assert.match(corrupted.detail, /WORKER_VAULT_INPUT_REFUSED/);
  const different = await h.hold(JSON.stringify((JSON.parse(CAPTURE) as unknown[]).slice(0, 1)));
  const substituted = await dispatchWorkerTask({ ...h.runtime, readEvidence: () => h.runtime.readEvidence(different.id) }, task);
  assert.equal(substituted.outcome, "FAILED");
  assert.match(substituted.detail, /WORKER_EXACT_ARTIFACT_BINDING_REFUSED/);
  for (const failed of [missing, corrupted, substituted]) {
    assert.equal(failed.dispositionCommitted, false);
    assert.equal((await h.repos.attempts.mustRead(failed.attemptId!)).value.outcome, "ABORTED");
  }
  assert.equal((await h.repos.routeTasks.mustRead(task.id)).value.state, "RECLAIMABLE");
  assert.equal((await h.repos.workerResults.readAll()).length, 0);
  assert.equal((await h.repos.workItems.mustRead(h.item.id)).value.state, "OPEN");
});

test("malformed evidence produces a persisted typed failure and blocks the item, never an empty successful extraction", async () => {
  const h = await harness();
  const artifact = await h.hold("{malformed JSON");
  const parser = await run(h, artifact, "PARSER");
  assert.equal(parser.result.role, "PARSER");
  if (parser.result.role !== "PARSER") throw new Error("wrong result role");
  assert.equal(parser.result.verdict, "FAILED");
  assert.deepEqual(parser.result.records, []);
  assert.ok(parser.result.warnings.some((finding) => finding.severity === "BLOCKING"));
  assert.equal((await h.repos.workItems.mustRead(h.item.id)).value.state, "BLOCKED");
  const validationTask = await enqueueWorkerTask(h.repos, { workItemId: h.item.id, artifactId: artifact.id, role: "VALIDATOR",
    contract: CONTRACT, producerResultId: parser.id, now: h.now() });
  const validation = await dispatchWorkerTask(h.runtime, validationTask);
  assert.equal(validation.outcome, "FAILED");
  assert.match(validation.detail, /WORKER_EXACT_CANDIDATE_BINDING_REFUSED/);
});

test("a Validator-passing captured result is broken by a contradicting official capture and dependent work reopens", async () => {
  const h = await harness();
  const artifact = await h.hold(CAPTURE);
  const parser = await run(h, artifact, "PARSER");
  const validator = await run(h, artifact, "VALIDATOR", { producerResultId: parser.id });
  assert.equal(validator.result.verdict, "PASS");
  const dependent = createWorkItem({ project: PROJECT, subject: CONTRACT.subjectId, obligation: "Use the independently audited capture in a staged reader projection",
    why: "The staged projection depends on audited event evidence.", now: h.now(),
    dependencies: [{ upstreamId: h.item.id, kind: "PRODUCES_CONSUMES", reason: "Consumes the audited event records", evidence: [parser.id] }] });
  await registerWorkItem(h.repos, dependent, h.now());
  const rows = JSON.parse(CAPTURE) as Record<string, unknown>[];
  await h.hold(JSON.stringify(rows.map((row, index) => index ? row : { ...row, EventDate: "2026-12-15T00:00:00" })),
    "https://webapi.legistar.com/v1/pima/events?source=independent-control");
  const auditor = await run(h, artifact, "ADVERSARIAL_AUDITOR", { producerResultId: parser.id, validatorResultId: validator.id, auditScope: "SOURCE_UNIVERSE" });
  assert.equal(auditor.result.role, "ADVERSARIAL_AUDITOR");
  if (auditor.result.role !== "ADVERSARIAL_AUDITOR") throw new Error("wrong result role");
  assert.equal(auditor.result.verdict, "BROKE");
  assert.equal(auditor.result.reopenRequired, true);
  assert.ok(auditor.result.findings.some((finding) => finding.code === "AUDIT_OFFICIAL_CONTRADICTION"));
  for (const workItemId of [h.item.id, dependent.id]) {
    const item = (await h.repos.workItems.mustRead(workItemId)).value;
    assert.equal(item.state, "REOPENED");
    assert.ok(item.transitions.some((transition) => transition.by === `worker-result:${auditor.id}` && transition.why.includes("AUDIT_OFFICIAL_CONTRADICTION")));
  }
});

async function temporaryStore<T>(runTest: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), "wtp-worker-runtime-"));
  try { return await runTest(root); }
  finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith("wtp-worker-runtime-"));
    await rm(root, { recursive: true, force: true });
  }
}

test("file-provider restart reconciles a committed result before an expired-lease sweep can manufacture failure", async () => temporaryStore(async (root) => {
  const storePath = path.join(root, "control-plane");
  const h = await harness(await createFileRepositories(storePath), new DurableEvidenceStore(path.join(root, "vault")));
  const artifact = await h.hold(CAPTURE);
  const task = await enqueueWorkerTask(h.repos, { workItemId: h.item.id, role: "PARSER", artifactId: artifact.id, contract: CONTRACT, now: h.now() });
  const crashing: ControlPlaneRepositories = { ...h.repos, attempts: { ...h.repos.attempts,
    compareAndSet: async (...args) => {
      if (args[2].worker.role === "PARSER" && args[2].outcome === "COMPLETED") throw new Error("SEEDED_CRASH_AFTER_RESULT_COMMIT");
      return h.repos.attempts.compareAndSet(...args);
    },
  } };
  await assert.rejects(dispatchWorkerTask({ ...h.runtime, repos: crashing }, task), /SEEDED_CRASH_AFTER_RESULT_COMMIT/);
  const committed = (await h.repos.workerResults.readAll())[0];
  assert.ok(committed);
  assert.equal((await h.repos.attempts.mustRead(committed.attemptId)).value.outcome, null);
  await assert.rejects(readCompletedWorkerResult(h.repos, committed.id), /WORKER_RESULT_UNCOMMITTED_PRODUCER/);
  const reopened = await createFileRepositories(storePath);
  const lease = (await reopened.leases.mustRead(task.id)).value;
  const afterExpiry = new Date(Date.parse(lease.expiresAt) + 60_000).toISOString();
  const sweep = await sweepExpiredLeases(reopened, { now: afterExpiry, observedBy: "restarted-supervisor" });
  assert.deepEqual(sweep.reclaimed, [], "An appended result is already committed; lease expiry cannot rewrite it to LEASE_EXPIRED.");
  assert.deepEqual(sweep.refused, []);
  await reconcileWorkerCompletions(reopened);
  const readback = await readCompletedWorkerResult(reopened, committed.id);
  assert.equal(readback.attempt.outcome, "COMPLETED");
  assert.equal((await reopened.routeTasks.mustRead(task.id)).value.state, "RESULT_RECORDED");
  assert.equal((await reopened.workerResults.readAll()).length, 1);
  assert.equal((await reopened.costs.readAll()).filter((cost) => cost.attemptId === committed.attemptId).length, 1);
  const item = (await reopened.workItems.mustRead(h.item.id)).value;
  assert.equal(item.state, "AWAITING_VALIDATION");
  assert.equal(item.transitions.filter((transition) => transition.by === `worker-result:${committed.id}`).length, 1);
}));

test("partial computation lost before commit stays nonterminal, then lease recovery runs a fresh Parser", async () => temporaryStore(async (root) => {
  const storePath = path.join(root, "control-plane");
  const h = await harness(await createFileRepositories(storePath), new DurableEvidenceStore(path.join(root, "vault")));
  const artifact = await h.hold(CAPTURE);
  const task = await enqueueWorkerTask(h.repos, { workItemId: h.item.id, role: "PARSER", artifactId: artifact.id, contract: CONTRACT, now: h.now() });
  const at = h.now();
  const lease = await claimRouteTask(h.repos, { routeTaskId: task.id, holder: "lost-parser", now: at, ttlMs: 1_000 });
  const attempt = await beginAttemptFor(h.repos, { routeTaskId: task.id, workItemId: h.item.id, lease: lease.lease.value,
    worker: { role: "PARSER", provider: "we-the-people", version: FLEET_IMPLEMENTATION_VERSION, instance: "lost-parser" },
    now: at, methodVersion: METHOD_VERSION, policyVersion: FLEET_POLICY_VERSION });
  await assert.rejects(runIsolatedSource('const partial = JSON.parse(INPUT_JSON).slice(0, 4); if(partial.length) throw new Error("SEEDED_PARSER_CRASH_AFTER_PARTIAL");', JSON.parse(CAPTURE), 2_000), /SEEDED_PARSER_CRASH_AFTER_PARTIAL/);
  // The supervisor is deliberately abandoned here; the worker never writes its
  // own crash outcome. A fresh repository observes an expired execution lease.
  const reopened = await createFileRepositories(storePath);
  assert.equal((await reopened.attempts.mustRead(attempt.id)).value.outcome, null);
  assert.equal((await reopened.workerResults.readAll()).length, 0);
  const later = new Date(Date.parse(at) + 5_000).toISOString();
  const sweep = await sweepExpiredLeases(reopened, { now: later, observedBy: "fresh-supervisor" });
  assert.deepEqual(sweep.reclaimed, [task.id]);
  const dead = (await reopened.attempts.mustRead(attempt.id)).value;
  assert.equal(dead.outcome, "LEASE_EXPIRED");
  assert.equal(mayWriteDisposition(dead), false);
  assert.equal((await reopened.routeTasks.mustRead(task.id)).value.disposition, null);
  const recoveredRuntime = { ...h.runtime, repos: reopened, now: () => later };
  const result = await dispatchWorkerTask(recoveredRuntime, (await reopened.routeTasks.mustRead(task.id)).value);
  assert.equal(result.outcome, "WORKED", result.detail);
  assert.notEqual(result.attemptId, attempt.id);
  const results = await reopened.workerResults.readAll();
  assert.equal(results.length, 1);
  assert.equal(results[0].result.verdict, "EXTRACTED");
  assert.equal((await reopened.attempts.mustRead(attempt.id)).value.outcome, "LEASE_EXPIRED");
}));

test("a work item's completion evidence and inherited results read only that item's rows", async () => {
  // 2026-09-24: each call listed every RouteTask and Attempt and read every
  // worker result (~11 MB), twice per work item in every research cycle.
  const h = await harness();
  const artifact = await h.hold(CAPTURE);
  const parser = await run(h, artifact, "PARSER");
  const validator = await run(h, artifact, "VALIDATOR", { producerResultId: parser.id });
  const expected = await loadWorkerCompletionEvidence(h.repos, h.item.id);
  const expectedResults = await readCompletedWorkerResults(h.repos, h.item.id);
  const whole = async (): Promise<never> => { throw new Error("a whole-table read for one work item"); };
  const narrow: ControlPlaneRepositories = { ...h.repos,
    routeTasks: { ...h.repos.routeTasks, list: whole },
    attempts: { ...h.repos.attempts, list: whole },
    workerResults: { ...h.repos.workerResults, readAll: whole },
  };
  assert.deepEqual(await loadWorkerCompletionEvidence(narrow, h.item.id), expected);
  assert.deepEqual(await readCompletedWorkerResults(narrow, h.item.id), expectedResults);
  assert.equal(expected.managed, true);
  assert.equal(expected.validations[0]?.passed, true, "and the narrow read is not vacuous");
  assert.deepEqual(expectedResults.map((record) => record.id).sort(), [parser.id, validator.id].sort());
  assert.deepEqual(await loadWorkerCompletionEvidence(narrow, "wi-no-such-item"),
    { managed: false, latestProducerAttemptId: null, validations: [], audits: [] });
});

test("diagnostic replay preserves workflow and captured-only audit cannot discharge whole-obligation completion", async () => {
  const h = await harness();
  const artifact = await h.hold(CAPTURE);
  const parser = await run(h, artifact, "PARSER");
  const validator = await run(h, artifact, "VALIDATOR", { producerResultId: parser.id });
  await run(h, artifact, "ADVERSARIAL_AUDITOR", { producerResultId: parser.id, validatorResultId: validator.id });
  const before = (await h.repos.workItems.mustRead(h.item.id)).value;
  const diagnostic = await run(h, artifact, "PARSER", { replayLabel: "diagnostic-replay", purpose: "DIAGNOSTIC_REPLAY" });
  assert.equal(diagnostic.result.verdict, "EXTRACTED");
  const after = (await h.repos.workItems.mustRead(h.item.id)).value;
  assert.equal(after.state, before.state);
  assert.deepEqual(after.transitions, before.transitions);
  const captured = await loadWorkerCompletionEvidence(h.repos, h.item.id);
  assert.equal(captured.managed, true);
  assert.equal(captured.latestProducerAttemptId, parser.attemptId);
  assert.equal(captured.validations.length, 1);
  assert.equal(captured.validations[0].passed, true);
  assert.deepEqual(captured.audits, []);
  await run(h, artifact, "ADVERSARIAL_AUDITOR", { producerResultId: parser.id, validatorResultId: validator.id, auditScope: "SOURCE_UNIVERSE" });
  const priorPass = await loadWorkerCompletionEvidence(h.repos, h.item.id);
  assert.equal(priorPass.audits[0].survived, true);
  await enqueueWorkerTask(h.repos, { workItemId: h.item.id, role: "PARSER", artifactId: artifact.id,
    contract: CONTRACT, replayLabel: "new-owed-generation", now: h.now() });
  const pending = await loadWorkerCompletionEvidence(h.repos, h.item.id);
  assert.equal(pending.validations[0].passed, false, "A new pending canonical Parser invalidates the older pass before it opens an Attempt.");
  assert.deepEqual(pending.audits, []);
  const snapshot = await loadCompletionSnapshot(h.repos, { workItemId: h.item.id, now: h.now(),
    validations: priorPass.validations, audits: priorPass.audits });
  assert.equal(snapshot.validations[0].passed, false, "A caller's historical PASS cannot override current canonical worker evidence.");
  assert.deepEqual(snapshot.audits, []);
});

test("completion aggregates every artifact chain and a newer failed Validator overrides its own old pass", async () => {
  const h = await harness();
  const artifact = await h.hold(CAPTURE);
  const parser = await run(h, artifact, "PARSER");
  await run(h, artifact, "VALIDATOR", { producerResultId: parser.id });
  assert.equal((await loadWorkerCompletionEvidence(h.repos, h.item.id)).validations[0].passed, true);
  const failedValidation = await enqueueWorkerTask(h.repos, { workItemId: h.item.id, role: "VALIDATOR", artifactId: artifact.id,
    contract: { ...CONTRACT, expectedSourceDate: "2026-05-12" }, producerResultId: parser.id, now: h.now() });
  assert.equal((await dispatchWorkerTask(h.runtime, failedValidation)).outcome, "FAILED");
  const failed = await loadWorkerCompletionEvidence(h.repos, h.item.id);
  assert.equal(failed.validations[0].passed, false);
  assert.match(failed.validations[0].detail, /latest Validator/);
  await run(h, artifact, "VALIDATOR", { producerResultId: parser.id, replayLabel: "corrected-validator" });
  assert.equal((await loadWorkerCompletionEvidence(h.repos, h.item.id)).validations[0].passed, true);
  const other = await h.hold("{second-artifact-malformed");
  await run(h, other, "PARSER");
  const multiArtifact = await loadWorkerCompletionEvidence(h.repos, h.item.id);
  assert.equal(multiArtifact.validations.length, 1, "One aggregate false verdict prevents the legacy any-PASS rule hiding another failed artifact.");
  assert.equal(multiArtifact.validations[0].passed, false);
  assert.match(multiArtifact.validations[0].detail, new RegExp(other.id));
  assert.ok(!multiArtifact.audits.some((finding) => finding.survived));
});

test("BROKE remains blocking through captured audit/replay until a newer exact independent source-universe chain survives", async () => {
  const h = await harness();
  const artifact = await h.hold(CAPTURE);
  const parser = await run(h, artifact, "PARSER");
  const validator = await run(h, artifact, "VALIDATOR", { producerResultId: parser.id });
  const challenged: FleetRuntime = { ...h.runtime, independentContext: async (scope) => {
    const context = await h.runtime.independentContext(scope);
    const rows = JSON.parse(CAPTURE) as Record<string, unknown>[];
    const text = JSON.stringify(rows.map((row, index) => index ? row : { ...row, EventDate: "2026-12-15T00:00:00" }));
    const contradicting = { artifactId: "seeded-contradicting-capture", contentHash: contentHash(text), text, acquiredByAttemptId: "seeded-acquirer",
      canonicalUrl: "https://webapi.legistar.com/v1/pima/events?source=seeded-contradiction", retrievedAt: START, sourceId: "legistar-pima", methodRouteId: "seeded-contradicting-route" };
    return { ...context, evidence: [...context.evidence, contradicting], routes: [...context.routes, { routeId: contradicting.methodRouteId, canonicalUrl: contradicting.canonicalUrl,
      applicable: true, status: "HELD" as const, artifactIds: [contradicting.artifactId], reason: "Seeded first-party capture that contradicts the extraction." }] };
  } };
  const broken = await run(h, artifact, "ADVERSARIAL_AUDITOR", { producerResultId: parser.id, validatorResultId: validator.id,
    auditScope: "SOURCE_UNIVERSE", runtime: challenged });
  assert.equal(broken.result.verdict, "BROKE");
  assert.ok((await loadWorkerCompletionEvidence(h.repos, h.item.id)).audits.some((finding) => !finding.survived && finding.resolvedAt === null));
  await run(h, artifact, "ADVERSARIAL_AUDITOR", { producerResultId: parser.id, validatorResultId: validator.id, replayLabel: "captured-followup" });
  await run(h, artifact, "PARSER", { replayLabel: "diagnostic-after-break", purpose: "DIAGNOSTIC_REPLAY" });
  assert.ok((await loadWorkerCompletionEvidence(h.repos, h.item.id)).audits.some((finding) => finding.id === `worker-audit:${broken.id}` && !finding.survived));
  // The fresh independent context has no seeded route; all three new role
  // executions are required before this supersedes the planted broken chain.
  const replacementParser = await run(h, artifact, "PARSER", { replayLabel: "replacement-chain" });
  const replacementValidator = await run(h, artifact, "VALIDATOR", { producerResultId: replacementParser.id });
  await run(h, artifact, "ADVERSARIAL_AUDITOR", { producerResultId: replacementParser.id,
    validatorResultId: replacementValidator.id, auditScope: "SOURCE_UNIVERSE" });
  const current = await loadWorkerCompletionEvidence(h.repos, h.item.id);
  assert.equal(current.validations[0].passed, true);
  assert.equal(current.audits.length, 1);
  assert.equal(current.audits[0].survived, true);
});

test("transient model-transport denial retries only after backoff and current availability; permanent denial stays blocked", async () => {
  const h = await harness();
  const artifact = await h.hold(CAPTURE);
  const parser = await run(h, artifact, "PARSER");
  const validator = await run(h, artifact, "VALIDATOR", { producerResultId: parser.id });
  const task = await enqueueWorkerTask(h.repos, { workItemId: h.item.id, role: "ADVERSARIAL_AUDITOR", artifactId: artifact.id,
    contract: CONTRACT, producerResultId: parser.id, validatorResultId: validator.id, now: h.now() });
  const unavailable = await dispatchWorkerTask({ ...h.runtime, requireModelAudit: true }, task);
  assert.equal(unavailable.outcome, "FAILED");
  const deniedAttempt = (await h.repos.attempts.mustRead(unavailable.attemptId!)).value;
  assert.equal(deniedAttempt.outcome, "DENIED_BY_POLICY");
  assert.deepEqual(deniedAttempt.capabilityGrant, fleetGrant("ADVERSARIAL_AUDITOR", PROJECT, deniedAttempt.startedAt));
  const deniedTask = (await h.repos.routeTasks.mustRead(task.id)).value;
  assert.equal(deniedTask.state, "POLICY_DENIED");
  const admission = workerTaskAdmission(deniedTask, (await h.repos.attempts.list()).map((row) => row.value), h.now());
  assert.equal(admission.state, "BACKOFF");
  assert.ok(admission.retryAt);
  let reviews = 0;
  // An explicitly named test double witnesses availability/admission mechanics;
  // this test does not call a provider or claim measured model usage.
  const available: FleetRuntime = { ...h.runtime, requireModelAudit: true, auditReasoner: {
    workerProvider: "contract-test-double", workerVersion: "fixture-review/1",
    review: async () => {
      reviews += 1;
      return { review: { step: "adversarial-audit", model: "fixture-review/1", effort: "none", contextHash: "fixture-context",
        verdict: "SURVIVED", challenges: [], elapsedMs: 0 }, usd: null,
      usage: { inputTokens: null, outputTokens: null, cacheReadInputTokens: null, cacheCreationInputTokens: null, uncachedInputTokens: null } };
    },
  } };
  assert.deepEqual(await drainWorkerQueue(available), []);
  assert.equal(reviews, 0);
  const later = new Date(Date.parse(admission.retryAt!) + 1_000).toISOString();
  assert.deepEqual(await drainWorkerQueue({ ...h.runtime, requireModelAudit: true, now: () => later }), [], "Elapsed time alone cannot make an unavailable transport available.");
  const recovered = await drainWorkerQueue({ ...available, now: () => later });
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].outcome, "WORKED", recovered[0].detail);
  assert.equal(reviews, 1);
  assert.notEqual(recovered[0].attemptId, deniedAttempt.id);
  const completedTask = (await h.repos.routeTasks.mustRead(task.id)).value;
  assert.equal(completedTask.policyReauthorizations?.[0].denial.attemptId, deniedAttempt.id);

  const permanentTask = await enqueueWorkerTask(h.repos, { workItemId: h.item.id, role: "PARSER", artifactId: artifact.id,
    contract: CONTRACT, replayLabel: "permanent-policy-control", now: later });
  const permanent = await dispatchWorkerTask({ ...h.runtime, now: () => later,
    readEvidence: async () => { throw new Error("DENIED_BY_POLICY:CANONICAL_PROMOTE"); } }, permanentTask);
  const permanentAttempt = (await h.repos.attempts.mustRead(permanent.attemptId!)).value;
  assert.equal(permanentAttempt.outcome, "DENIED_BY_POLICY");
  assert.deepEqual(permanentAttempt.capabilityGrant, fleetGrant("PARSER", PROJECT, permanentAttempt.startedAt));
  const farLater = new Date(Date.parse(later) + 86_400_000).toISOString();
  assert.deepEqual(await drainWorkerQueue({ ...available, now: () => farLater }), []);
  assert.equal((await h.repos.routeTasks.mustRead(permanentTask.id)).value.state, "POLICY_DENIED");
});
