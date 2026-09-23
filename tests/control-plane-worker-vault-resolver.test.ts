import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { recordAcquisition, type Artifact } from "../lib/control-plane/evidence/artifact.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { putArtifact } from "../lib/control-plane/evidence/store.ts";
import { workerVaultResolver } from "../lib/control-plane/workers/vault.ts";
import type { ArtifactRecord, ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";

/**
 * WHICH RECORD OF AN ARTIFACT THE WORKER RESOLVER READS. (2026-09-23.)
 *
 * An artifact id is derived from tier and hash, so one id can have several
 * records: the same bytes retrieved by two Attempts, or for two work items. The
 * resolver used to bind the first record only and refuse
 * `WORKER_ARTIFACT_NOT_IN_VAULT` whenever that record's bytes had never been
 * vaulted, even with the same bytes held under a later record. Every root is an
 * `mkdtemp` directory removed by the test that made it.
 */

const PROJECT = "freshness";
const BODY = "<p>Regular Session, January 14, 2026 at 9:00 a.m.</p>";

async function vault(t: TestContext): Promise<DurableEvidenceStore> {
  const root = await mkdtemp(join(tmpdir(), "wtp-worker-resolver-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return new DurableEvidenceStore(root);
}

/** One retrieval of BODY. Different work items land on different keys; the artifact id is the same. */
function capture(n: number): Artifact {
  return recordAcquisition(
    {
      canonicalUrl: `https://www.example.gov/meetings/${n}`,
      retrievedAt: "2026-09-01T19:36:07.092Z",
      httpStatus: 200,
      contentType: "text/html",
      sourceId: "www.example.gov",
      methodRouteId: "CLERK_SCHEDULE_PAGE",
      workItemId: `wi-00000000000000000000000${n}`,
      attemptId: `at-00000000000000000000000${n}`,
      permission: "ALLOWED",
      transport: "REACHABLE",
    },
    BODY,
  ).artifact;
}

const record = (artifact: Artifact, partial = false): ArtifactRecord => ({
  artifactId: artifact.id,
  workItemId: artifact.workItemId,
  routeTaskId: null,
  attemptId: artifact.attemptId,
  tier: artifact.tier,
  contentHash: artifact.contentHash,
  byteLength: artifact.byteLength,
  contentType: artifact.contentType,
  canonicalUrl: artifact.canonicalUrl,
  partial,
  recordedAt: artifact.retrievedAt,
});

/** The two control-plane reads the resolver makes, from fixed rows in log order. */
function repos(records: readonly ArtifactRecord[], roles: Readonly<Record<string, string>> = {}): ControlPlaneRepositories {
  return {
    artifacts: { readAll: async () => records },
    attempts: { mustRead: async (id: string) => ({ id, revision: 1, value: { id, worker: { role: roles[id] ?? "ACQUIRER" } } }) },
  } as unknown as ControlPlaneRepositories;
}

const hold = (store: DurableEvidenceStore, artifact: Artifact) => putArtifact(store, PROJECT, artifact, new TextEncoder().encode(BODY));

test("a later record of the same artifact is read when the first record's bytes were never vaulted", async (t) => {
  const store = await vault(t);
  const [first, second] = [capture(1), capture(2)];
  assert.equal(first.id, second.id, "the same bytes are the same artifact");
  await hold(store, second);

  const input = await workerVaultResolver(repos([record(first), record(second)]), store, PROJECT)(first.id);
  assert.equal(input.text, BODY);
  assert.equal(input.contentHash, first.contentHash);
  /* The ParserInput names the Attempt whose bytes were actually read. */
  assert.equal(input.attemptId, second.attemptId);
  assert.equal(input.workItemId, second.workItemId);
});

test("the first held record still wins, in log order", async (t) => {
  const store = await vault(t);
  const [first, second] = [capture(1), capture(2)];
  await hold(store, first);
  await hold(store, second);
  const input = await workerVaultResolver(repos([record(first), record(second)]), store, PROJECT)(first.id);
  assert.equal(input.attemptId, first.attemptId);
});

test("a partial capture is never read; a complete record of the same bytes is", async (t) => {
  const store = await vault(t);
  const [first, second] = [capture(1), capture(2)];
  await hold(store, first);
  await hold(store, second);
  const input = await workerVaultResolver(repos([record(first, true), record(second)]), store, PROJECT)(first.id);
  assert.equal(input.attemptId, second.attemptId);
  await assert.rejects(
    workerVaultResolver(repos([record(first, true), record(second, true)]), store, PROJECT)(first.id),
    /WORKER_ARTIFACT_MISSING_OR_PARTIAL/,
  );
  await assert.rejects(workerVaultResolver(repos([]), store, PROJECT)(first.id), /WORKER_ARTIFACT_MISSING_OR_PARTIAL/);
});

test("only an acquiring role may hand bytes to a worker, and a refusal still names why", async (t) => {
  const store = await vault(t);
  const [first, second] = [capture(1), capture(2)];
  await hold(store, first);
  await hold(store, second);
  const parserFirst = { [first.attemptId]: "PARSER" };
  /* The first record's Attempt was a parser; the second record's acquirer bytes are read. */
  const input = await workerVaultResolver(repos([record(first), record(second)], parserFirst), store, PROJECT)(first.id);
  assert.equal(input.attemptId, second.attemptId);
  await assert.rejects(
    workerVaultResolver(repos([record(first), record(second)], { ...parserFirst, [second.attemptId]: "VALIDATOR" }), store, PROJECT)(first.id),
    /WORKER_ARTIFACT_PROVENANCE_REFUSED/,
  );
});

test("an admitted record the vault does not hold under its own identity is not in the vault", async (t) => {
  const store = await vault(t);
  const [first, second] = [capture(1), capture(2)];
  /* Held under the second record's identity only; the first record's Attempt is the only admitted one. */
  await hold(store, second);
  await assert.rejects(
    workerVaultResolver(repos([record(first), record(second)], { [second.attemptId]: "PARSER" }), store, PROJECT)(first.id),
    /WORKER_ARTIFACT_NOT_IN_VAULT/,
  );
  await assert.rejects(workerVaultResolver(repos([record(first)]), store, PROJECT)(first.id), /WORKER_ARTIFACT_NOT_IN_VAULT/);
});
