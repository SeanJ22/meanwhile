import { publicationVaultReaders } from "../lib/civic-data/publication-vault.ts";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { recordAcquisition, type Artifact } from "../lib/control-plane/evidence/artifact.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { putArtifact } from "../lib/control-plane/evidence/store.ts";
import { workerVaultResolver } from "../lib/control-plane/workers/vault.ts";
import { researchVaultResolver } from "../lib/control-plane/workers/vault-object.ts";
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

test('Detective captures remain readable with the original redirect and acquisition date', async t => {
  const store=await vault(t);
  const artifact={...capture(1),retrievalUrl:'https://www.example.gov/current-meetings'};
  await hold(store,artifact);
  const repository=repos([record(artifact)],{[artifact.attemptId]:'DETECTIVE'});
  const input=await workerVaultResolver(repository,store,PROJECT)(artifact.id);
  assert.equal(input.text,BODY);
  assert.equal(input.attemptId,artifact.attemptId);
  const saved=await researchVaultResolver(repository,store,PROJECT)(artifact.id);
  assert.equal(saved.artifact.retrievalUrl,artifact.retrievalUrl);
  assert.equal(saved.artifact.retrievedAt,artifact.retrievedAt);
});

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
    { message: `WORKER_ARTIFACT_MISSING_OR_PARTIAL:${first.id}` },
  );
  await assert.rejects(workerVaultResolver(repos([]), store, PROJECT)(first.id), { message: `WORKER_ARTIFACT_MISSING_OR_PARTIAL:${first.id}` });
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

test("a retained-evidence pass shares its immutable index, while the next pass sees later acquisitions", async t => {
  const store = await vault(t);
  const first = capture(1);
  await hold(store, first);
  const records = [record(first)];
  const repository = repos(records);
  let logReads = 0;
  let listings = 0;
  let attemptReads = 0;
  const mustRead = repository.attempts.mustRead.bind(repository.attempts);
  repository.attempts.mustRead = async id => { attemptReads++; return mustRead(id); };
  const readAll = repository.artifacts.readAll.bind(repository.artifacts);
  repository.artifacts.readAll = async () => { logReads++; return [...await readAll()]; };
  const list = store.list.bind(store);
  store.list = async prefix => { listings++; return list(prefix); };
  const read = workerVaultResolver(repository, store, PROJECT, { snapshot: true });
  const held = await Promise.all([read(first.id), read(first.id), read(first.id)]);
  assert.ok(held.every(input => input.text === BODY && input.attemptId === first.attemptId));
  assert.equal(logReads, 1, "one log read, not one complete-log query per artifact request");
  assert.equal(listings, 1, "one vault listing shared by concurrent reads");
  assert.equal(attemptReads, 1, "same content is resolved once, including its acquisition identity");
  const text = BODY + "<p>New notice</p>";
  const newer = recordAcquisition({ ...first, workItemId: "wi-new", attemptId: "at-new" }, text).artifact;
  await putArtifact(store, PROJECT, newer, new TextEncoder().encode(text));
  records.push(record(newer));
  await assert.rejects(read(newer.id), /WORKER_ARTIFACT_MISSING_OR_PARTIAL/, "the existing pass cannot silently change its evidence set");
  const next = await workerVaultResolver(repository, store, PROJECT, { snapshot: true })(newer.id);
  assert.equal(next.text, text);
  assert.equal(next.attemptId, "at-new");
});

test("missing content does not read every historical Attempt, even when other bytes are held", async t => {
  const store = await vault(t);
  const missing = capture(1);
  const unrelatedText = "Another saved source";
  const unrelated = recordAcquisition({ ...capture(2) }, unrelatedText).artifact;
  await putArtifact(store, PROJECT, unrelated, new TextEncoder().encode(unrelatedText));
  const repository = repos(Array.from({ length: 250 }, (_, index) => record(capture(index))));
  let attemptReads = 0;
  repository.attempts.mustRead = async () => { attemptReads++; throw new Error("unnecessary Attempt read"); };
  for (const resolve of [workerVaultResolver(repository, store, PROJECT, { snapshot: true }), researchVaultResolver(repository, store, PROJECT, { snapshot: true })]) {
    const outcomes = await Promise.allSettled(Array.from({ length: 20 }, () => resolve(missing.id)));
    assert.ok(outcomes.every(row => row.status === "rejected" && /(?:NOT_IN_VAULT|VAULT_IDENTITY_MISSING)/.test(row.reason.message)));
  }
  assert.equal(attemptReads, 0);
});

test("research snapshots share successful and failed content resolution, and a new pass sees new bytes", async t => {
  const store = await vault(t);
  const first = capture(1);
  const repository = repos([record(first)]);
  let listings = 0;
  let attemptReads = 0;
  const list = store.list.bind(store);
  store.list = async prefix => { listings++; return list(prefix); };
  const mustRead = repository.attempts.mustRead.bind(repository.attempts);
  repository.attempts.mustRead = async id => { attemptReads++; return mustRead(id); };
  const absent = researchVaultResolver(repository, store, PROJECT, { snapshot: true });
  await Promise.all(Array.from({ length: 10 }, () => assert.rejects(absent(first.id), /VAULT_IDENTITY_MISSING/)));
  assert.equal(listings, 1);
  assert.equal(attemptReads, 0);
  await hold(store, first);
  await assert.rejects(absent(first.id), /VAULT_IDENTITY_MISSING/);
  const fresh = researchVaultResolver(repository, store, PROJECT, { snapshot: true });
  const held = await Promise.all(Array.from({ length: 10 }, () => fresh(first.id)));
  assert.ok(held.every(row => row.artifact.attemptId === first.attemptId));
  assert.equal(listings, 2);
  assert.equal(attemptReads, 1);
});


test("publication reads matching artifact metadata once for both provenance validators, preserving later held observations", async t => {
  const store = await vault(t);
  const [first, second] = [capture(1), capture(2)];
  await hold(store, second);
  const repository = repos([]);
  let keysRead = 0, rowsRead = 0, vaultLists = 0;
  const listed = store.list.bind(store);
  t.mock.method(store, "list", async (prefix: string) => { vaultLists++; return listed(prefix); });
  repository.artifacts.keysWhere = async (path, id) => {
    keysRead++; assert.deepEqual(path, ["artifactId"]); assert.equal(id, first.id);
    return [first.workItemId, second.workItemId];
  };
  repository.artifacts.readWhere = async (key, path, id) => {
    rowsRead++; assert.deepEqual(path, ["artifactId"]); assert.equal(id, first.id);
    return [record(key === first.workItemId ? first : second)];
  };
  repository.artifacts.readAll = async () => { throw new Error("whole artifact log must not transfer"); };
  const readers = publicationVaultReaders(repository, store, PROJECT);
  const [object, evidence] = await Promise.all([readers.readObject(first.id), readers.readEvidence(first.id)]);
  assert.equal(object.artifact.attemptId, second.attemptId);
  assert.equal(evidence.attemptId, second.attemptId);
  assert.equal(evidence.text, BODY);
  await readers.readEvidence(first.id);
  assert.deepEqual({ keysRead, rowsRead, vaultLists }, { keysRead: 1, rowsRead: 2, vaultLists: 1 });
});

test("a later publication job sees newly saved metadata and bytes; a failed database read stays a failure", async t => {
  const store = await vault(t);
  const artifact = capture(1);
  const repository = repos([]);
  let available = false;
  repository.artifacts.keysWhere = async () => available ? [artifact.workItemId] : [];
  repository.artifacts.readWhere = async () => [record(artifact)];
  repository.artifacts.readAll = async () => { throw new Error("whole log"); };
  await assert.rejects(publicationVaultReaders(repository, store).readEvidence(artifact.id), /MISSING_OR_PARTIAL/);
  await hold(store, artifact); available = true;
  assert.equal((await publicationVaultReaders(repository, store).readEvidence(artifact.id)).text, BODY);
  repository.artifacts.keysWhere = async () => { throw new Error("database unavailable"); };
  await assert.rejects(publicationVaultReaders(repository, store).readEvidence(artifact.id), /database unavailable/);
});
