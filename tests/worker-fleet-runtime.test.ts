import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { mayWriteDisposition } from "../lib/control-plane/attempt.ts";
import { requireCapability } from "../lib/control-plane/capability.ts";
import { recordAcquisition, type Artifact } from "../lib/control-plane/evidence/artifact.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { MemoryEvidenceStore, putArtifact, readForParser, type EvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import {
  beginAttemptFor, claimRouteTask, disposeRouteTask,
  recordArtifactMetadata, registerRouteTask, registerWorkItem,
} from "../lib/control-plane/repository/coordinator.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { loadWorkerCompletionEvidence, readCompletedWorkerResult, readCompletedWorkerResults, RECONCILE_APPEND_SLACK_MS, reconcileWorkerCompletions, visitCompletedWorkerResults } from "../lib/control-plane/repository/worker-completion.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { dischargesObligation, sweepExpiredLeases } from "../lib/control-plane/scheduler/dispatch.ts";
import { runIsolatedSource } from "../lib/control-plane/workers/isolation.ts";
import {
  dispatchWorkerTask, enqueueWorkerTask, evidenceProjection,
  FLEET_IMPLEMENTATION_VERSION, FLEET_POLICY_VERSION, fleetGrant, type FleetRuntime,
} from "../lib/control-plane/workers/runtime.ts";
import type { CivicExtractionContract, FleetRole, WorkerResultRecord, WorkerTaskSpec } from "../lib/control-plane/workers/types.ts";

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

test("scoped completion recovery replays only named keys and cannot advance another item's or the parent's cursor", async () => {
  const repos = createMemoryRepositories();
  const reads: { since: string | null; keys: readonly string[] | undefined }[] = [];
  let clock = Date.parse(START);
  const observed: ControlPlaneRepositories = { ...repos, workerResults: { ...repos.workerResults,
    readChangedSince: async (since, _held, options) => {
      reads.push({ since, keys: options?.keys });
      assert.ok(options?.page);
      return { records: [], through: new Date(clock += 60_000).toISOString() };
    },
  } };
  await reconcileWorkerCompletions(observed, { workItemIds: ["place-a", "place-a"] });
  await reconcileWorkerCompletions(observed, { workItemIds: ["place-b"] });
  await reconcileWorkerCompletions(observed);
  const parentThrough = new Date(clock).toISOString();
  await reconcileWorkerCompletions(observed, { workItemIds: ["place-a"] });
  await reconcileWorkerCompletions(observed, { workItemIds: [] });
  await reconcileWorkerCompletions(observed);
  assert.deepEqual(reads, [
    { since: null, keys: ["place-a"] },
    { since: null, keys: ["place-b"] },
    { since: null, keys: undefined },
    { since: null, keys: ["place-a"] },
    { since: new Date(Date.parse(parentThrough) - RECONCILE_APPEND_SLACK_MS).toISOString(), keys: undefined },
  ]);
});

test("a scoped recovery cannot inherit or discard the parent's pending completions", async () => {
  const h = await harness();
  const artifact = await h.hold(CAPTURE);
  const result = await run(h, artifact, "PARSER");
  let hideCost = true;
  const pendingReads: string[] = [];
  const observed: ControlPlaneRepositories = { ...h.repos,
    costs: { ...h.repos.costs, read: async key => {
      if (hideCost) { hideCost = false; return []; }
      return h.repos.costs.read(key);
    } },
    workerResults: { ...h.repos.workerResults, readWhere: async (...args) => {
      pendingReads.push(args[0]);
      return h.repos.workerResults.readWhere(...args);
    } },
  };
  await reconcileWorkerCompletions(observed);
  await reconcileWorkerCompletions(observed, { workItemIds: ["unrelated-place"] });
  assert.deepEqual(pendingReads, [], "a child cannot carry the parent's pending work into its place");
  await reconcileWorkerCompletions(observed);
  assert.deepEqual(pendingReads, [h.item.id], "the parent's pending commit survives the scoped pass");
  assert.equal((await h.repos.costs.read(h.item.id)).filter(cost => cost.attemptId === result.attemptId).length, 1);
});

test("completed worker history recovers with bulk reads and no per-result replay calls", async () => {
  const h = await harness();
  const artifact = await h.hold(CAPTURE);
  const parser = await run(h, artifact, "PARSER");
  const records = await h.repos.workerResults.readAll();
  const fail = async (): Promise<never> => { throw new Error("historical result caused a point read or write"); };
  const observed: ControlPlaneRepositories = { ...h.repos,
    workerResults: { ...h.repos.workerResults, readAll: fail, readSince: fail,
      readChangedSince: async (_since, _held, options) => {
        assert.ok(options?.page, "Recovery must consume bounded store pages.");
        for (let page = 0; page < 30; page++) await options.page(Array.from({ length: 50 }, (_, position) => ({
          key: records[0].workItemId, recordId: records[0].id, position, record: records[0],
        })));
        return { records: [], through: START };
      } },
    attempts: { ...h.repos.attempts, read: fail, mustRead: fail, compareAndSet: fail },
    routeTasks: { ...h.repos.routeTasks, read: fail, mustRead: fail, compareAndSet: fail },
    leases: { ...h.repos.leases, read: fail, compareAndSet: fail },
    costs: { ...h.repos.costs, append: fail },
    workItems: { ...h.repos.workItems, read: fail, mustRead: fail, compareAndSet: fail },
  };
  await reconcileWorkerCompletions(observed);
  const costs = await h.repos.costs.readAll();
  const historicalCosts = costs.map(({ model: _model, tier: _tier, ...cost }) => cost);
  /* Recovery reads each result's cost rows under its work item, never the whole cost log. */
  await reconcileWorkerCompletions({ ...observed,
    costs: { ...observed.costs, readAll: fail, read: async (key: string) => historicalCosts.filter(cost => cost.workItemId === key) },
  });
  assert.deepEqual(await h.repos.costs.readAll(), costs, "Recovery preserves immutable historical charge content.");
  // Losing the cost append is a real partial commit, even with both aggregates
  // present. It must reach recovery, never the historical-success fast path.
  await assert.rejects(reconcileWorkerCompletions({ ...observed,
    costs: { ...observed.costs, readAll: fail, read: async () => [] },
  }), /historical result caused/);
  assert.equal((await h.repos.attempts.mustRead(parser.attemptId)).value.outcome, "COMPLETED");
});

test("lifetime worker history validates 1500 producers in bounded pages and rejects missing or divergent producers", async () => {
  const h = await harness();
  const artifact = await h.hold(CAPTURE);
  const parser = await run(h, artifact, "PARSER");
  const attempts = await h.repos.attempts.list();
  let calls = 0;
  const observed: ControlPlaneRepositories = { ...h.repos,
    workerResults: { ...h.repos.workerResults, readAll: async () => { throw new Error("whole cp_worker_results read"); },
      readChangedSince: async (_since, _held, options) => {
        assert.ok(options?.page);
        const records = [...Array.from({ length: 1500 }, () => parser),
        { ...parser, id: "missing-producer", attemptId: "absent" },
        { ...parser, id: "divergent-producer", completion: { ...parser.completion,
          closedAttempt: { ...parser.completion.closedAttempt, endedAt: "2026-09-15T00:00:00.000Z" } } }];
        for (let at = 0; at < records.length; at += 64) await options.page(records.slice(at, at + 64).map((record, position) => ({
          key: record.workItemId, recordId: record.id, position, record,
        })));
        return { records: [], through: START };
      } },
    attempts: { ...h.repos.attempts, list: async () => { throw new Error("whole cp_attempts listed"); },
      readMany: async (ids: readonly string[]) => { calls += 1; assert.ok(ids.length <= 32); return attempts.filter(row => ids.includes(row.id)); },
      read: async () => { throw new Error("N+1 point read"); },
      mustRead: async () => { throw new Error("N+1 point read"); } },
  };
  let inherited = 0;
  await visitCompletedWorkerResults(observed, record => { inherited += 1; assert.equal(record.id, parser.id); });
  assert.equal(inherited, 1500);
  assert.equal(calls, 47);
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
    readAll: async () => { throw new Error("country worker results read"); },
    keysWhere: async (path: readonly string[], value: string) => { fallbackReads++; return h.repos.workerResults.keysWhere(path, value); },
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

async function temporaryStore<T>(runTest: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), "wtp-worker-runtime-"));
  try { return await runTest(root); }
  finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith("wtp-worker-runtime-"));
    await rm(root, { recursive: true, force: true });
  }
}

for (const scoped of [false, true]) test(`file-provider restart ${scoped ? "scoped recovery" : "global recovery"} reconciles a committed result before an expired-lease sweep can manufacture failure`, async () => temporaryStore(async (root) => {
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
  const fail = async (): Promise<never> => { throw new Error("UNRELATED_RECOVERY_HISTORY_READ"); };
  const selected: ControlPlaneRepositories = { ...reopened,
    workerResults: { ...reopened.workerResults, readAll: fail, readChangedSince: async (...args) => {
      assert.deepEqual(args[2]?.keys, [h.item.id]);
      return reopened.workerResults.readChangedSince(...args);
    } },
    routeTasks: { ...reopened.routeTasks, list: fail, listChangedSince: fail },
    attempts: { ...reopened.attempts, list: fail, listChangedSince: fail },
    leases: { ...reopened.leases, list: fail, listChangedSince: fail },
    costs: { ...reopened.costs, readAll: fail },
  };
  const recoveryRepos = scoped ? selected : reopened;
  const sweep = await sweepExpiredLeases(recoveryRepos, { now: afterExpiry, observedBy: "restarted-supervisor",
    ...(scoped ? { workItemIds: [h.item.id] } : {}) });
  assert.deepEqual(sweep.reclaimed, [], "An appended result is already committed; lease expiry cannot rewrite it to LEASE_EXPIRED.");
  assert.deepEqual(sweep.refused, []);
  await reconcileWorkerCompletions(recoveryRepos, scoped ? { workItemIds: [h.item.id] } : undefined);
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
