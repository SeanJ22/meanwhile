import assert from "node:assert/strict";
import test from "node:test";
import { beginAttempt, claim, endAttempt } from "../lib/control-plane/attempt.ts";
import { createRouteTask, disposeRoute, type RouteTask } from "../lib/control-plane/route-task.ts";
import { routeTaskId } from "../lib/control-plane/ids.ts";
import { canonicalJson, type ArtifactRecord } from "../lib/control-plane/repository/types.ts";
import { savedArtifactFirstObservation, savedSourceTaskFork } from "../scripts/rh01-source-fork.mts";

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
