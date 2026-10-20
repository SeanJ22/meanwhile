import assert from "node:assert/strict";
import test from "node:test";

import { recordArtifactMetadata } from "../lib/control-plane/repository/coordinator.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { Attempt } from "../lib/control-plane/attempt.ts";
import { AppendOnlyViolation, type ArtifactRecord } from "../lib/control-plane/repository/types.ts";

const NOW_A = "2026-09-02T00:00:00.000Z";
const NOW_B = "2026-09-02T01:00:00.000Z";

/** A minimal Attempt row: `recordArtifactMetadata` only needs it to EXIST. */
function attemptRow(id: string): Attempt {
  return { id } as unknown as Attempt;
}

function artifact(over: Partial<ArtifactRecord>): ArtifactRecord {
  return {
    artifactId: "ar-content-x",
    workItemId: "wi-1",
    routeTaskId: "rt-1",
    attemptId: "at-A",
    tier: "RAW",
    contentHash: "sha256-x",
    byteLength: 100,
    contentType: "text/html; charset=utf-8",
    canonicalUrl: "https://example.gov/x",
    partial: false,
    recordedAt: NOW_A,
    ...over,
  };
}

test("a second observation retains its time and Attempt while preserving the original", async () => {
  const repos = createMemoryRepositories();
  await repos.attempts.put("at-A", attemptRow("at-A"), NOW_A);
  await repos.attempts.put("at-B", attemptRow("at-B"), NOW_B);

  const first = await recordArtifactMetadata(repos, artifact({ attemptId: "at-A", recordedAt: NOW_A }), NOW_A);
  assert.equal(first.appended, true, "the first observation is appended");

  // One immutable content id can have more than one actual observation.
  const second = await recordArtifactMetadata(repos, artifact({ attemptId: "at-B", recordedAt: NOW_B }), NOW_B);
  assert.equal(second.appended,true);
  assert.equal(second.record.attemptId,"at-B");

  const held = await repos.artifacts.read("wi-1");
  assert.equal(held.length,2);
  assert.deepEqual(held.map(row=>[row.attemptId,row.recordedAt]),[["at-A",NOW_A],["at-B",NOW_B]]);
});

test("a DIFFERENT-content collision under one content-derived id is STILL refused", async () => {
  const repos = createMemoryRepositories();
  await repos.attempts.put("at-A", attemptRow("at-A"), NOW_A);
  await repos.attempts.put("at-B", attemptRow("at-B"), NOW_B);

  await recordArtifactMetadata(repos, artifact({ attemptId: "at-A", contentHash: "sha256-x", byteLength: 100 }), NOW_A);

  await assert.rejects(
    () =>
      recordArtifactMetadata(
        repos,
        artifact({ attemptId: "at-B", contentHash: "sha256-DIFFERENT", byteLength: 999 }),
        NOW_B,
      ),
    (error: unknown) => error instanceof AppendOnlyViolation,
    "a genuine content divergence must surface as an AppendOnlyViolation, never be swallowed",
  );
});

test("retrying the same observation is idempotent", async () => {
  const repos = createMemoryRepositories();
  await repos.attempts.put("at-A", attemptRow("at-A"), NOW_A);
  const once = await recordArtifactMetadata(repos, artifact({ attemptId: "at-A" }), NOW_A);
  const twice = await recordArtifactMetadata(repos, artifact({ attemptId: "at-A" }), NOW_A);
  assert.equal(once.appended, true);
  assert.equal(twice.appended, false, "an exact retry was already idempotent and still is");
});
