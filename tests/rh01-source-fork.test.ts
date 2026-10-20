import assert from "node:assert/strict";
import test from "node:test";
import { beginAttempt, claim, endAttempt, ZERO_COST } from "../lib/control-plane/attempt.ts";
import { createRouteTask, disposeRoute, type RouteTask } from "../lib/control-plane/route-task.ts";
import { contentHash, fingerprint, routeTaskId } from "../lib/control-plane/ids.ts";
import { canonicalJson, type ArtifactRecord } from "../lib/control-plane/repository/types.ts";
import { savedArtifactFirstObservation, savedSourceTaskFork, savedSourceWorkerTaskFork } from "../scripts/rh01-source-fork.mts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import { beginAttemptFor, claimRouteTask, registerWorkItem } from "../lib/control-plane/repository/coordinator.ts";
import { defaultGrant } from "../lib/control-plane/capability.ts";
import { completeWorkerTask, readCompletedWorkerResult } from "../lib/control-plane/repository/worker-completion.ts";
import { enqueueWorkerTask } from "../lib/control-plane/workers/runtime.ts";
import type { AcquirerResult } from "../lib/control-plane/workers/research-types.ts";
import type { GeneralizedCivicExtractionContract } from "../lib/control-plane/workers/types.ts";

function fixture() {
  const at = "2026-10-20T10:00:00.000Z";
  const existing = createRouteTask({ workItemId: "wi-pima", routeId: "hunter:packet", routeLabel: "actual hunt", target: "Pima", inherited: false, now: at });
  const local = { ...existing, createdAt: "2026-10-20T11:00:00.000Z" };
  const opened = beginAttempt({ workItemId: local.workItemId, routeTaskId: local.id,
    worker: { role: "SCOUT", provider: "anthropic", version: "haiku", instance: "local-native" },
    lease: claim(local.id, "local-native", local.createdAt, 60_000, null), now: local.createdAt, methodVersion: 877, policyVersion: "native" });
  const attempt = endAttempt(opened, "COMPLETED", "2026-10-20T11:00:01.000Z", { artifactIds: ["ar-held"] });
  const source = disposeRoute(local, attempt, { disposition: "INGESTED", attemptId: attempt.id, at: attempt.endedAt!, artifactIds: ["ar-held"],
    observation: null, permission: "ALLOWED", transport: "REACHABLE", note: "Actual saved source" });
  const artifact: ArtifactRecord = { artifactId: "ar-held", workItemId: local.workItemId, routeTaskId: local.id, attemptId: attempt.id,
    tier: "RAW", contentHash: "sha256-held", byteLength: 10, contentType: "text/plain", canonicalUrl: "https://www.pima.gov/held", partial: false, recordedAt: attempt.endedAt! };
  return { existing, source, attempt, artifacts: [artifact], canonicalJson, routeTaskId, disposeRoute };
}

test("a saved native completion forks only an untouched matching job, retaining both creation times", () => {
  const input = fixture(), before = canonicalJson(input.existing);
  const receipt = savedSourceTaskFork(input);
  assert.equal(receipt.taskId, input.source.id);
  assert.equal(receipt.sourceAttemptId, input.attempt.id);
  assert.equal(receipt.productionState, "PENDING");
  assert.equal(receipt.restoredState, "DISPOSED");
  assert.notEqual(receipt.sourceCreatedAt, receipt.productionCreatedAt);
  assert.equal(canonicalJson(input.existing), before);
});

test("saved execution cannot reset an attempted, claimed, failed, disposed or denied production job", () => {
  for (const state of ["CLAIMED", "RECLAIMABLE", "POLICY_DENIED", "DISPOSED", "RESULT_RECORDED"] as const) {
    const input = fixture();
    assert.throws(() => savedSourceTaskFork({ ...input, existing: { ...input.existing, state } }), /CANNOT_REPLACE_ATTEMPTED_TASK/);
  }
  const input = fixture();
  assert.throws(() => savedSourceTaskFork({ ...input, existing: { ...input.existing, attemptIds: ["an-existing-attempt"] } }), /CANNOT_REPLACE_ATTEMPTED_TASK/);
  assert.throws(() => savedSourceTaskFork({ ...input, existing: { ...input.existing, disposition: input.source.disposition } }), /CANNOT_REPLACE_ATTEMPTED_TASK/);
});

test("fork refuses changed identity, unsupported worker, incomplete Attempt and foreign/partial evidence", () => {
  const input = fixture();
  assert.throws(() => savedSourceTaskFork({ ...input, existing: { ...input.existing, target: "another place" } }), /IDENTITY_DIFFERS/);
  assert.throws(() => savedSourceTaskFork({ ...input, source: { ...input.source, id: "arbitrary" } }), /IDENTITY_DIFFERS/);
  assert.throws(() => savedSourceTaskFork({ ...input, attempt: { ...input.attempt, outcome: "ABORTED", abortReason: "stopped" } }), /COMPLETION_MISSING/);
  assert.throws(() => savedSourceTaskFork({ ...input, attempt: { ...input.attempt, worker: { ...input.attempt.worker, role: "PARSER" } } }), /COMPLETION_MISSING/);
  for (const change of [{ attemptId: "foreign" }, { routeTaskId: "foreign" }, { workItemId: "foreign" }, { partial: true }])
    assert.throws(() => savedSourceTaskFork({ ...input, artifacts: [{ ...input.artifacts[0], ...change }] }), /ARTIFACT_LINEAGE_DIFFERS/);
  assert.throws(() => savedSourceTaskFork({ ...input, artifacts: [] }), /ARTIFACT_LINEAGE_DIFFERS/);
  assert.throws(() => savedSourceTaskFork({ ...input, source: { ...input.source, disposition: { ...input.source.disposition!, artifactIds: ["foreign"] } } }), /ARTIFACT_LINEAGE_DIFFERS/);
});

test("a pending schema2 instruction is never represented as an executed source", () => {
  const input = fixture();
  assert.throws(() => savedSourceTaskFork({ ...input, source: input.existing as RouteTask }), /COMPLETION_MISSING/);
});

test("content-address dedup preserves the original acquisition metadata and leaves the local replay separate", () => {
  const original = fixture().artifacts[0];
  const saved = { ...original, attemptId: "at-a-genuine-separate-local-replay" };
  const before = canonicalJson(saved);
  assert.equal(savedArtifactFirstObservation(saved, original, canonicalJson), original);
  assert.equal(canonicalJson(saved), before);
  assert.notEqual(saved.attemptId, original.attemptId);
});

test("first-observation adoption refuses every difference beyond acquiring Attempt and any partial source", () => {
  const original = fixture().artifacts[0], saved = { ...original, attemptId: "at-local-replay" };
  const changes: Partial<ArtifactRecord>[] = [{ workItemId: "foreign" }, { routeTaskId: "foreign" }, { contentHash: "foreign" },
    { byteLength: original.byteLength + 1 }, { canonicalUrl: "https://other.gov/" }, { recordedAt: "different" },
    { tier: "SANITIZED_DERIVED" }, { contentType: "text/html" }, { partial: true }];
  for (const change of changes)
    assert.throws(() => savedArtifactFirstObservation(saved, { ...original, ...change }, canonicalJson), /FIRST_OBSERVATION_DIFFERS/);
  assert.throws(() => savedArtifactFirstObservation({ ...saved, partial: true }, original, canonicalJson), /FIRST_OBSERVATION_DIFFERS/);
});

async function typedFixture() {
  const at = "2026-10-20T10:00:00.000Z", end = "2026-10-20T10:00:01.000Z", repos = createMemoryRepositories();
  const item = createWorkItem({ project: "rh01-restoration-fixture", subject: "fixture:government", obligation: "Recorded source completion fixture", why: "No source request", now: at });
  await registerWorkItem(repos, item, at);
  const hash = contentHash("Official title"), artifactId = "ar-fixture-held", url = "https://fixture.example.gov/board";
  const contract: GeneralizedCivicExtractionContract = { schemaVersion: 2, recordClass: "OFFICIAL_BOARD_DIRECTORY", subjectId: item.subject,
    jurisdiction: { country: "US", state: "AZ", canonicalId: item.subject }, methodVersion: 877, requiredFields: ["bodyName"],
    identity: { namespace: "fixture", keyFields: ["bodyName"] }, completenessScope: "Fixture title only", expectedSourceDate: null,
    sourceScope: { sourceId: "fixture.example.gov", publisher: "Fixture government", routeIds: ["fixture-source"], canonicalUrls: [url], observationArtifactIds: [artifactId] },
    extraction: { format: "TEXT_BLOCKS", recordStart: "", fields: { bodyName: { source: "", type: "STRING" } } }, verification: { required: false, authorities: [] } };
  const route = { id: "fixture-source", subjectId: item.subject, jurisdiction: "AZ", recordClass: contract.recordClass, sourceId: "fixture.example.gov", publisher: "Fixture government",
    url, observedLocator: url, observedAt: at, firstObservedAt: at, methodVersion: 877, permission: "ALLOWED" as const,
    observation: { artifactId, contentHash: hash, start: 0, end: 14, quote: "Official title", offsetUnit: "UTF16_CODE_UNITS" as const },
    publisherSubjectEvidence: [], applicableBecause: "Recorded native commit fixture", nextRouteIds: [], retrieval: "fetch_public" as const };
  const existing = await enqueueWorkerTask(repos, { workItemId: item.id, role: "ACQUIRER", artifactId, contract, acquisition: { route, held: [] }, now: at, purpose: "DIAGNOSTIC_REPLAY" });
  const holder = "recorded-native-acquirer", worker = { role: "ACQUIRER" as const, provider: "fixture", version: "fixture/1", instance: holder };
  const claimed = await claimRouteTask(repos, { routeTaskId: existing.id, holder, now: at, ttlMs: 60_000 });
  const opened = await beginAttemptFor(repos, { routeTaskId: existing.id, workItemId: item.id, worker, lease: claimed.lease.value, now: at, methodVersion: 877, policyVersion: "fixture/1" });
  const result: AcquirerResult = { role: "ACQUIRER", attemptId: opened.id, verdict: "ACQUIRED", source: route,
    sourceGrounding: { verdict: "OBSERVED", checkedArtifactIds: [artifactId] }, artifacts: [{ artifactId, sourceRouteId: route.id, sourceObservationArtifactId: artifactId,
      canonicalUrl: url, sourceId: route.sourceId, acquisitionAttemptId: opened.id, retrievedAt: at, contentHash: hash, byteCount: 14, contentType: "text/plain",
      tier: "RAW", completeness: "COMPLETE", vaultKey: "fixture/held", transport: "REACHABLE", httpStatus: 200, reused: false }],
    artifactIds: [artifactId], findings: [], blockers: [], walk: [], walkState: { state: "OPEN", nextRouteIds: [] }, requestCount: 0, bytesFetched: 0 };
  await completeWorkerTask(repos, { id: `wr-${fingerprint([opened.id])}`, schemaVersion: 1, workItemId: item.id, routeTaskId: existing.id, attemptId: opened.id, worker,
    grant: defaultGrant({ role: worker.role, project: item.project, policyVersion: "fixture/1", grantedAt: at }), methodVersion: 877, policyVersion: "fixture/1",
    startedAt: at, endedAt: end, executionMode: "DETERMINISTIC", cost: ZERO_COST,
    usage: { inputTokens: null, outputTokens: null, cacheReadInputTokens: null, cacheCreationInputTokens: null, uncachedInputTokens: null },
    inputArtifactIds: [artifactId], inputResultIds: [], semanticHash: contentHash(canonicalJson(result)), result });
  const completed = await readCompletedWorkerResult(repos, `wr-${fingerprint([opened.id])}`);
  const artifact: ArtifactRecord = { artifactId, workItemId: item.id, routeTaskId: existing.id, attemptId: opened.id, tier: "RAW", contentHash: hash,
    byteLength: 14, contentType: "text/plain", canonicalUrl: url, partial: false, recordedAt: at };
  return { existing, source: (await repos.routeTasks.mustRead(existing.id)).value, attempt: completed.attempt, artifacts: [artifact], result: completed.record,
    canonicalJson, contentHash, routeTaskId };
}

test("a genuine native typed Acquirer completion is restored as RESULT_RECORDED without inventing a route disposition", async () => {
  const input = await typedFixture(), before = canonicalJson(input);
  const receipt = savedSourceWorkerTaskFork(input);
  assert.equal(receipt.restoredState, "RESULT_RECORDED");
  assert.equal(receipt.sourceResultId, input.result.id);
  assert.equal(input.source.disposition, null);
  assert.equal(canonicalJson(input), before);
});

test("typed source restoration refuses missing, foreign or changed native completion and dirty pending rows", async () => {
  const input = await typedFixture();
  assert.throws(() => savedSourceWorkerTaskFork({ ...input, result: undefined }), /WORKER_COMPLETION_MISSING/);
  assert.throws(() => savedSourceWorkerTaskFork({ ...input, attempt: { ...input.attempt, id: "foreign" } }), /WORKER_COMPLETION_MISSING/);
  assert.throws(() => savedSourceWorkerTaskFork({ ...input, result: { ...input.result, routeTaskId: "foreign" } }), /WORKER_COMPLETION_MISSING/);
  assert.throws(() => savedSourceWorkerTaskFork({ ...input, result: { ...input.result, semanticHash: "changed" } }), /WORKER_COMPLETION_MISSING/);
  for (const change of [{ attemptId: "foreign" }, { workItemId: "foreign" }, { contentHash: "changed" }, { byteLength: 15 }, { partial: true }])
    assert.throws(() => savedSourceWorkerTaskFork({ ...input, artifacts: [{ ...input.artifacts[0], ...change }] }), /ARTIFACT_LINEAGE_DIFFERS/);
  assert.throws(() => savedSourceWorkerTaskFork({ ...input, existing: { ...input.existing, state: "CLAIMED" } }), /CANNOT_REPLACE_ATTEMPTED_TASK/);
  assert.throws(() => savedSourceWorkerTaskFork({ ...input, existing: { ...input.existing, attemptIds: ["already-attempted"] } }), /CANNOT_REPLACE_ATTEMPTED_TASK/);
});
