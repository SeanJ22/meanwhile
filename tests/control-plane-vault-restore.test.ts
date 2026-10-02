import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { recordAcquisition, type Artifact } from "../lib/control-plane/evidence/artifact.ts";
import { DurableEvidenceStore, SIDECAR_SUFFIX, keyToRelativePath } from "../lib/control-plane/evidence/durable-store.ts";
import { buildManifest, objectKey, putArtifact, putManifest } from "../lib/control-plane/evidence/store.ts";
import {
  executeVaultRestore,
  planVaultRestore,
  restoreDigest,
  type HeldRecord,
} from "../lib/control-plane/evidence/vault-restore.ts";
import { cycleVault } from "../lib/control-plane/scheduler/vault.ts";
import { workerVaultResolver } from "../lib/control-plane/workers/vault.ts";
import { researchVaultResolver } from "../lib/control-plane/workers/vault-object.ts";
import type { ArtifactRecord, ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";

/**
 * THE VAULT RESTORE, ON TEMP DURABLE STORES. (2026-09-22.)
 *
 * The runner moved checkouts and left every body vaulted before the move in the
 * main checkout's vault, where no runtime resolver looks. These tests prove the
 * restore copies exactly the record-named objects, verbatim, add-only, and that
 * the runtime's own resolvers (`CycleVault.readHeld`, `workerVaultResolver`,
 * `researchVaultResolver`) read a restored record they could not read before.
 * Every root is an `mkdtemp` directory removed by the test that made it.
 */

const PROJECT = "freshness";

async function makeRoot(t: TestContext, label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `wtp-vault-restore-${label}-`));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

/** Every file under a root, with its bytes, so "the source was not touched" is a comparison. */
async function snapshot(root: string): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const walk = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else found.set(full.slice(root.length), (await readFile(full)).toString("base64"));
    }
  };
  await walk(root);
  return found;
}

function capture(body: string, over: { workItemId?: string; attemptId?: string; canonicalUrl?: string } = {}): { artifact: Artifact; bytes: Uint8Array } {
  const { artifact } = recordAcquisition(
    {
      canonicalUrl: over.canonicalUrl ?? "https://www.example.gov/meetings",
      retrievedAt: "2026-09-02T04:07:20.651Z",
      httpStatus: 200,
      contentType: "text/html",
      sourceId: "www.example.gov",
      methodRouteId: "CLERK_SCHEDULE_PAGE",
      workItemId: over.workItemId ?? "wi-000000000000000000000001",
      attemptId: over.attemptId ?? "at-000000000000000000000001",
      permission: "ALLOWED",
      transport: "REACHABLE",
    },
    body,
  );
  return { artifact, bytes: new TextEncoder().encode(body) };
}

const heldRecord = (artifact: Artifact, over: Partial<HeldRecord> = {}): HeldRecord => ({
  artifactId: artifact.id,
  workItemId: artifact.workItemId,
  attemptId: artifact.attemptId,
  contentHash: artifact.contentHash,
  canonicalUrl: artifact.canonicalUrl,
  tier: artifact.tier,
  byteLength: artifact.byteLength,
  project: PROJECT,
  logKey: artifact.workItemId,
  recordId: `${artifact.id}:${artifact.attemptId}`,
  ...over,
});

const artifactRecord = (artifact: Artifact): ArtifactRecord => ({
  artifactId: artifact.id,
  workItemId: artifact.workItemId,
  routeTaskId: null,
  attemptId: artifact.attemptId,
  tier: artifact.tier,
  contentHash: artifact.contentHash,
  byteLength: artifact.byteLength,
  contentType: artifact.contentType,
  canonicalUrl: artifact.canonicalUrl,
  partial: false,
  recordedAt: artifact.retrievedAt,
});

/** The two reads the resolvers make of the control plane, from fixed rows. */
const readOnlyRepos = (records: readonly ArtifactRecord[]) =>
  ({
    artifacts: { readAll: async () => records },
    attempts: { mustRead: async (id: string) => ({ id, revision: 1, value: { id, worker: { role: "ACQUIRER" } } }) },
  }) as unknown as ControlPlaneRepositories;

const sidecar = (root: string, key: string) => readFile(`${join(root, keyToRelativePath(key))}${SIDECAR_SUFFIX}`);

test("a record held only in the source vault is copied verbatim and then read by the runtime's own resolvers", async (t) => {
  const [mainRoot, runtimeRoot] = [await makeRoot(t, "main"), await makeRoot(t, "runtime")];
  const [main, runtime] = [new DurableEvidenceStore(mainRoot), new DurableEvidenceStore(runtimeRoot)];

  const split = capture("<p>Regular Session, January 14</p>");
  const alreadyHeld = capture("<p>Special Session, January 21</p>", { workItemId: "wi-000000000000000000000002", attemptId: "at-000000000000000000000002" });
  const neverVaulted = capture("<p>Work Session, January 28</p>", { workItemId: "wi-000000000000000000000003", attemptId: "at-000000000000000000000003" });
  const unnamed = capture("<p>a body no record names</p>", { workItemId: "wi-000000000000000000000004", attemptId: "at-000000000000000000000004" });
  await putArtifact(main, PROJECT, split.artifact, split.bytes);
  await putArtifact(main, PROJECT, unnamed.artifact, unnamed.bytes);
  await putManifest(main, PROJECT, split.artifact, buildManifest(PROJECT, split.artifact.workItemId, [split.artifact], "2026-09-02T04:07:21.000Z"));
  await putArtifact(runtime, PROJECT, alreadyHeld.artifact, alreadyHeld.bytes);

  const records = [heldRecord(split.artifact), heldRecord(alreadyHeld.artifact), heldRecord(neverVaulted.artifact)];
  const repos = readOnlyRepos([split, alreadyHeld, neverVaulted].map((c) => artifactRecord(c.artifact)));
  const beforeMain = await snapshot(mainRoot);

  /* The failure the copy is for, read through the real resolvers. */
  assert.equal(await cycleVault(runtimeRoot).readHeld(artifactRecord(split.artifact)), null);
  await assert.rejects(workerVaultResolver(repos, runtime, PROJECT)(split.artifact.id), /WORKER_ARTIFACT_NOT_IN_VAULT/);
  await assert.rejects(researchVaultResolver(repos, runtime, PROJECT)(split.artifact.id), /RESEARCH_ARTIFACT_VAULT_IDENTITY_MISSING/);

  const plan = await planVaultRestore(main, runtime, records);
  const splitKey = objectKey(PROJECT, split.artifact);
  assert.deepEqual(plan.copies.map((c) => c.key), [splitKey]);
  assert.deepEqual(plan.copies[0].records.map((r) => r.recordId), [heldRecord(split.artifact).recordId]);
  assert.deepEqual(plan.heldInTarget.map((r) => r.artifactId), [alreadyHeld.artifact.id]);
  assert.deepEqual(plan.heldInNeither.map((r) => r.artifactId), [neverVaulted.artifact.id]);
  assert.deepEqual(plan.conflicts, []);
  /* The unnamed body and the manifest are never in scope. */
  assert.equal(plan.unreferencedSourceKeys.length, 2);
  assert.ok(plan.unreferencedSourceKeys.includes(objectKey(PROJECT, unnamed.artifact)));
  assert.equal(plan.digest, restoreDigest(plan.copies));

  assert.deepEqual(await executeVaultRestore(plan, main, runtime), [{ key: splitKey, status: "COPIED", sidecarBytesIdentical: true }]);

  /* Verbatim: the same bytes, the same sidecar file byte for byte, and nothing else arrived. */
  assert.deepEqual(await sidecar(runtimeRoot, splitKey), await sidecar(mainRoot, splitKey));
  assert.deepEqual((await runtime.get(splitKey))!.bytes, split.bytes);
  assert.deepEqual((await runtime.list("project/")).sort(), [objectKey(PROJECT, alreadyHeld.artifact), splitKey].sort());
  /* The source is only read. */
  assert.deepEqual(await snapshot(mainRoot), beforeMain);

  /* The runtime's own resolvers now read it, with their hash, length and identity checks. */
  assert.equal(await cycleVault(runtimeRoot).readHeld(artifactRecord(split.artifact)), "<p>Regular Session, January 14</p>");
  const parsed = await workerVaultResolver(repos, runtime, PROJECT)(split.artifact.id);
  assert.equal(parsed.contentHash, split.artifact.contentHash);
  assert.equal(parsed.attemptId, split.artifact.attemptId);
  const researched = await researchVaultResolver(repos, runtime, PROJECT)(split.artifact.id);
  assert.deepEqual(researched.bytes, split.bytes);
  assert.equal(researched.key, splitKey);

  /* A second run finds nothing left to copy. */
  const again = await planVaultRestore(main, runtime, records);
  assert.deepEqual(again.copies, []);
  assert.deepEqual(again.heldInTarget.map((r) => r.artifactId).sort(), [alreadyHeld.artifact.id, split.artifact.id].sort());
});

test("a target key already holding a different object is a conflict, and is never overwritten", async (t) => {
  const [mainRoot, runtimeRoot] = [await makeRoot(t, "main"), await makeRoot(t, "runtime")];
  const [main, runtime] = [new DurableEvidenceStore(mainRoot), new DurableEvidenceStore(runtimeRoot)];

  /* Same bytes, work item and day, so the same key; a different Attempt wrote the runtime copy first. */
  const ours = capture("<p>Regular Session, January 14</p>");
  const theirs = capture("<p>Regular Session, January 14</p>", { attemptId: "at-0000000000000000000000ff" });
  const key = objectKey(PROJECT, ours.artifact);
  assert.equal(objectKey(PROJECT, theirs.artifact), key);
  await putArtifact(main, PROJECT, ours.artifact, ours.bytes);

  /* Planned while the target key was free, then occupied before execution: refused at execution. */
  const plan = await planVaultRestore(main, runtime, [heldRecord(ours.artifact)]);
  assert.deepEqual(plan.copies.map((c) => c.key), [key]);
  await putArtifact(runtime, PROJECT, theirs.artifact, theirs.bytes);
  const before = await sidecar(runtimeRoot, key);
  const [outcome] = await executeVaultRestore(plan, main, runtime);
  assert.equal(outcome.status, "REFUSED");
  assert.match(outcome.status === "REFUSED" ? outcome.reason : "", /never overwritten/);
  assert.deepEqual(await sidecar(runtimeRoot, key), before);

  /* Planned after: the occupied key is reported as a conflict and is not in the copy set. */
  const replanned = await planVaultRestore(main, runtime, [heldRecord(ours.artifact)]);
  assert.deepEqual(replanned.copies, []);
  assert.deepEqual(replanned.conflicts.map((c) => c.key), [key]);
});

test("a corrupted source body, or a record the object does not satisfy, is refused and writes nothing", async (t) => {
  const [mainRoot, runtimeRoot] = [await makeRoot(t, "main"), await makeRoot(t, "runtime")];
  const [main, runtime] = [new DurableEvidenceStore(mainRoot), new DurableEvidenceStore(runtimeRoot)];
  const good = capture("<p>Regular Session, January 14</p>");
  const bad = capture("<p>Special Session, January 21</p>", { workItemId: "wi-000000000000000000000002", attemptId: "at-000000000000000000000002" });
  await putArtifact(main, PROJECT, good.artifact, good.bytes);
  await putArtifact(main, PROJECT, bad.artifact, bad.bytes);

  /* The record says one byte more than the object holds. */
  const plan = await planVaultRestore(main, runtime, [heldRecord(good.artifact, { byteLength: good.artifact.byteLength + 1 }), heldRecord(bad.artifact)]);
  assert.equal(plan.copies.length, 2);
  /* A bit flip at the same length: `get` re-hashes against the sidecar and throws. */
  const badPath = join(mainRoot, keyToRelativePath(objectKey(PROJECT, bad.artifact)));
  const flipped = await readFile(badPath);
  flipped[3] ^= 1;
  await writeFile(badPath, flipped);

  const outcomes = await executeVaultRestore(plan, main, runtime);
  assert.deepEqual(outcomes.map((o) => o.status), ["REFUSED", "REFUSED"]);
  assert.ok(outcomes.some((o) => o.status === "REFUSED" && /not held identity for record/.test(o.reason)));
  assert.ok(outcomes.some((o) => o.status === "REFUSED" && /bytes on disk are not the bytes that were written/.test(o.reason)));
  assert.deepEqual(await runtime.list("project/"), []);
  await assert.rejects(planVaultRestore(main, runtime, [heldRecord(bad.artifact)]), /bytes on disk are not the bytes that were written/);

  /* A record naming another URL is not held identity at all, so it is never planned. */
  const elsewhere = await planVaultRestore(main, runtime, [heldRecord(good.artifact, { canonicalUrl: "https://www.example.gov/other" })]);
  assert.deepEqual(elsewhere.copies, []);
  assert.equal(elsewhere.heldInNeither.length, 1);
});

test("an altered plan, or a vault restored from itself, is refused before anything is read or written", async (t) => {
  const [mainRoot, runtimeRoot] = [await makeRoot(t, "main"), await makeRoot(t, "runtime")];
  const [main, runtime] = [new DurableEvidenceStore(mainRoot), new DurableEvidenceStore(runtimeRoot)];
  const one = capture("<p>Regular Session, January 14</p>");
  const two = capture("<p>Special Session, January 21</p>", { workItemId: "wi-000000000000000000000002", attemptId: "at-000000000000000000000002" });
  await putArtifact(main, PROJECT, one.artifact, one.bytes);
  await putArtifact(main, PROJECT, two.artifact, two.bytes);
  const plan = await planVaultRestore(main, runtime, [heldRecord(one.artifact), heldRecord(two.artifact)]);
  assert.equal(plan.copies.length, 2);

  await assert.rejects(executeVaultRestore({ ...plan, copies: plan.copies.slice(0, 1) }, main, runtime), /VAULT_RESTORE_PLAN_ALTERED/);
  await assert.rejects(executeVaultRestore(plan, main, new DurableEvidenceStore(mainRoot)), /VAULT_RESTORE_SOURCE_IS_TARGET/);
  assert.deepEqual(await runtime.list("project/"), []);
  /* The digest names the records, not only the objects. */
  assert.notEqual(restoreDigest([{ ...plan.copies[0], records: [{ ...plan.copies[0].records[0], recordId: "another" }] }]), restoreDigest(plan.copies.slice(0, 1)));
});
