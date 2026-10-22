import assert from "node:assert/strict";
import test from "node:test";

import { recordArtifactMetadata } from "../lib/control-plane/repository/coordinator.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { Attempt } from "../lib/control-plane/attempt.ts";
import { AppendOnlyViolation, type ArtifactRecord } from "../lib/control-plane/repository/types.ts";

/**
 * A re-observation of one artifact (same content, new Attempt) is idempotent, not a history
 * rewrite; a genuine content divergence under one content-derived id is still refused.
 */

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

test("SEEDED: a content-identical artifact re-observed by a SECOND Attempt is idempotent, not a rewrite", async () => {
  const repos = createMemoryRepositories();
  await repos.attempts.put("at-A", attemptRow("at-A"), NOW_A);
  await repos.attempts.put("at-B", attemptRow("at-B"), NOW_B);

  const first = await recordArtifactMetadata(repos, artifact({ attemptId: "at-A", recordedAt: NOW_A }), NOW_A);
  assert.equal(first.appended, true, "the first observation is appended");

  // Same content, new Attempt, new recordedAt.
  const second = await recordArtifactMetadata(repos, artifact({ attemptId: "at-B", recordedAt: NOW_B }), NOW_B);
  assert.equal(second.appended, false, "the re-observation is an idempotent no-op, not a throw");
  assert.equal(second.record.attemptId, "at-A", "the FIRST observer's attribution stands, unrewritten");

  const held = await repos.artifacts.read("wi-1");
  assert.equal(held.length, 1, "exactly one artifact record — no duplicate and no rewrite");
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

test("a byte-identical retry under the SAME Attempt is idempotent (the pre-fix behaviour, unchanged)", async () => {
  const repos = createMemoryRepositories();
  await repos.attempts.put("at-A", attemptRow("at-A"), NOW_A);
  const once = await recordArtifactMetadata(repos, artifact({ attemptId: "at-A" }), NOW_A);
  const twice = await recordArtifactMetadata(repos, artifact({ attemptId: "at-A" }), NOW_A);
  assert.equal(once.appended, true);
  assert.equal(twice.appended, false, "an exact retry was already idempotent and still is");
});

test("the same bytes seen at another address (a page served under two spellings, or one robots.txt on two hosts) are one artifact, not a refusal", async () => {
  const repos = createMemoryRepositories();
  await repos.attempts.put("at-A", attemptRow("at-A"), NOW_A);
  const first = await recordArtifactMetadata(repos, artifact({ attemptId: "at-A", canonicalUrl: "https://example.gov/government/city-council/" }), NOW_A);
  const second = await recordArtifactMetadata(repos, artifact({ attemptId: "at-A", canonicalUrl: "https://example.gov/Government/City-Council" }), NOW_A);
  assert.deepEqual([first.appended, second.appended], [true, false]);
  assert.equal((await repos.artifacts.read("wi-1")).length, 1, "one record, the first address stands");
});
