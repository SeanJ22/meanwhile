import assert from "node:assert/strict";
import test from "node:test";
import { huntSourceProgressDigest } from "../lib/civic-data/hunt-source-progress.ts";
import { HUNT_SOURCE_PROGRESS_LOG_KEY, type HuntSourceProgress } from "../lib/control-plane/owner-surface.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";

test("a queued task deferred before spawn keeps both events without a settlement failure", async () => {
  const repos = createMemoryRepositories();
  const admitted: HuntSourceProgress = { instructionIds: ["send"], taskId: "worker-publication:registry-runtime-bindings:item",
    sourceId: "registry-reviewed-bindings", scope: "US:reader-registry-runtime-bindings", stage: "QUEUED",
    at: "2026-10-05T19:24:08.894Z", detail: "Admitted to the existing source worker pool", candidateId: null, readerPaths: [] };
  // Even a clock with millisecond resolution may repeat. Content, not the
  // stage or timestamp alone, distinguishes the later memory deferral.
  const deferred = { ...admitted, detail: "No memory reservation before spawn; source work remains owed" };
  const first = huntSourceProgressDigest("cycle", "release", admitted);
  const second = huntSourceProgressDigest("cycle", "release", deferred);
  const oldId = "cycle:task:QUEUED";
  const old = createMemoryRepositories();
  await old.ownerDigests.append(HUNT_SOURCE_PROGRESS_LOG_KEY, oldId, first, admitted.at);
  await assert.rejects(old.ownerDigests.append(HUNT_SOURCE_PROGRESS_LOG_KEY, oldId, second, deferred.at), /different content/);
  for (const event of [first, second, second]) await repos.ownerDigests.append(HUNT_SOURCE_PROGRESS_LOG_KEY, event.digestId, event, event.writtenAt);
  assert.deepEqual(await repos.ownerDigests.read(HUNT_SOURCE_PROGRESS_LOG_KEY), [first, second]);
  assert.notEqual(first.digestId, second.digestId);
  assert.equal(huntSourceProgressDigest("cycle", "release", deferred).digestId, second.digestId);
  assert.equal(second.huntSourceProgress?.stage, "QUEUED", "a memory deferral is not claimed as a completed child");
});
