import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { candidateCounts, type CandidateStore } from "../lib/method/candidate.ts";
import {
  METHOD_CANDIDATE_CUTOVER_SEED,
  ensureMethodCandidateAuthorityAdopted,
  methodCandidateCoreSha256,
  readMethodCandidateAuthorityStatus,
  type MethodCandidateAdoptionCodeProof,
} from "../lib/control-plane/method-candidate-authority.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { canonicalJson } from "../lib/control-plane/repository/types.ts";
import { METHOD_CANDIDATE_STORE_ID } from "../lib/control-plane/scheduler/scout-candidates.ts";
import type { OwnerDigestRecord } from "../lib/control-plane/owner-surface.ts";

const ROOT = process.cwd();
const CODE_SHA = "a".repeat(40);
const T0 = "2026-09-09T12:00:00.000Z";

function seed(): CandidateStore {
  return JSON.parse(readFileSync(`${ROOT}/data/method/candidates.json`, "utf8")) as CandidateStore;
}

function goodProof(over: Partial<MethodCandidateAdoptionCodeProof> = {}): MethodCandidateAdoptionCodeProof {
  return {
    expectedCodeSha: CODE_SHA,
    headSha: CODE_SHA,
    headEqualsCodeSha: true,
    cleanTree: true,
    detachedHead: true,
    originMainContainsHead: true,
    ...over,
  };
}

test("the immutable manifest exactly binds the historical seven-candidate seed", () => {
  const raw = readFileSync(`${ROOT}/data/method/candidates.json`);
  const value = JSON.parse(raw.toString("utf8")) as CandidateStore;
  assert.equal(
    createHash("sha1").update(`blob ${raw.byteLength}\0`).update(raw).digest("hex"),
    METHOD_CANDIDATE_CUTOVER_SEED.sourceGitBlobSha1,
  );
  assert.equal(createHash("sha256").update(raw).digest("hex"), METHOD_CANDIDATE_CUTOVER_SEED.sourceRawSha256);
  assert.equal(
    createHash("sha256").update(canonicalJson(value)).digest("hex"),
    METHOD_CANDIDATE_CUTOVER_SEED.canonicalSha256,
  );
  assert.equal(value.candidates.length, METHOD_CANDIDATE_CUTOVER_SEED.candidateCount);
  assert.deepEqual(
    value.candidates.map((candidate) => candidate.id).sort(),
    Object.keys(METHOD_CANDIDATE_CUTOVER_SEED.candidateCoreSha256).sort(),
  );
  assert.deepEqual(candidateCounts(value), METHOD_CANDIDATE_CUTOVER_SEED.lifecycleCounts);
  for (const candidate of value.candidates) {
    assert.equal(
      methodCandidateCoreSha256(candidate),
      METHOD_CANDIDATE_CUTOVER_SEED.candidateCoreSha256[
        candidate.id as keyof typeof METHOD_CANDIDATE_CUTOVER_SEED.candidateCoreSha256
      ],
      candidate.id,
    );
  }
});

test("clean detached deployed code adopts exact revision 1 into the existing owner outcome log, idempotently", async () => {
  const repos = createMemoryRepositories();
  await repos.methodCandidates.put(METHOD_CANDIDATE_STORE_ID, seed(), T0);

  const first = await ensureMethodCandidateAuthorityAdopted({ repos, codeProof: goodProof(), now: T0 });
  assert.equal(first.ok, true);
  assert.equal(first.ok && first.adoptedNow, true);
  assert.equal(first.ok && first.outcome.authority.aggregateRevision, 1);
  assert.equal(first.ok && first.outcome.authority.canonicalSha256, METHOD_CANDIDATE_CUTOVER_SEED.canonicalSha256);
  assert.equal(first.ok && first.outcome.verifier.codeSha, CODE_SHA);
  assert.equal(first.ok && first.outcome.authorityBoundary.trackedRuntimeReads, 0);
  assert.equal(first.ok && first.outcome.authorityBoundary.trackedRuntimeWrites, 0);

  const rows = await repos.ownerDigests.read("owner-digest");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.runtimeOutcome?.kind, "METHOD_CANDIDATE_AUTHORITY_ADOPTION");

  const retried = await ensureMethodCandidateAuthorityAdopted({
    repos,
    codeProof: goodProof(),
    now: "2026-09-09T12:05:00.000Z",
  });
  assert.equal(retried.ok, true);
  assert.equal(retried.ok && retried.adoptedNow, false);
  assert.equal((await repos.ownerDigests.read("owner-digest")).length, 1);
  assert.equal((await readMethodCandidateAuthorityStatus(repos)).state, "ADOPTED");
});

test("dirty, attached, off-SHA, or off-main code cannot create an adoption receipt", async () => {
  for (const proof of [
    goodProof({ cleanTree: false }),
    goodProof({ detachedHead: false }),
    goodProof({ headEqualsCodeSha: false, headSha: "b".repeat(40) }),
    goodProof({ originMainContainsHead: false }),
  ]) {
    const repos = createMemoryRepositories();
    await repos.methodCandidates.put(METHOD_CANDIDATE_STORE_ID, seed(), T0);
    const result = await ensureMethodCandidateAuthorityAdopted({ repos, codeProof: proof, now: T0 });
    assert.equal(result.ok, false);
    assert.equal(result.code, "METHOD_CANDIDATE_ADOPTION_CODE_UNTRUSTED");
    assert.deepEqual(await repos.ownerDigests.read("owner-digest"), []);
  }
});

test("an invalid adoption instant cannot poison the append-only authority history", async () => {
  const repos = createMemoryRepositories();
  await repos.methodCandidates.put(METHOD_CANDIDATE_STORE_ID, seed(), T0);
  const result = await ensureMethodCandidateAuthorityAdopted({ repos, codeProof: goodProof(), now: "not-a-time" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "METHOD_CANDIDATE_ADOPTION_TIME_INVALID");
  assert.deepEqual(await repos.ownerDigests.read("owner-digest"), []);
});

test("an aggregate without an absolute durable write instant cannot be adopted", async () => {
  const repos = createMemoryRepositories();
  await repos.methodCandidates.put(METHOD_CANDIDATE_STORE_ID, seed(), "2026-09-09");
  const result = await ensureMethodCandidateAuthorityAdopted({ repos, codeProof: goodProof(), now: T0 });
  assert.equal(result.ok, false);
  assert.equal(result.code, "METHOD_CANDIDATE_ADOPTION_AGGREGATE_TIME_INVALID");
  assert.deepEqual(await repos.ownerDigests.read("owner-digest"), []);
});

test("an unreceipted aggregate that moved or changed is preserved and refused, never repaired", async () => {
  const repos = createMemoryRepositories();
  const created = await repos.methodCandidates.put(METHOD_CANDIDATE_STORE_ID, seed(), T0);
  const changed: CandidateStore = { ...created.persisted.value, updatedOn: "2026-09-10" };
  await repos.methodCandidates.compareAndSet(METHOD_CANDIDATE_STORE_ID, 1, changed, "2026-09-10T00:00:00.000Z");

  const result = await ensureMethodCandidateAuthorityAdopted({ repos, codeProof: goodProof(), now: T0 });
  assert.equal(result.ok, false);
  assert.equal(result.code, "METHOD_CANDIDATE_UNADOPTED_AGGREGATE_MOVED");
  assert.equal((await repos.methodCandidates.mustRead(METHOD_CANDIDATE_STORE_ID)).revision, 2);
  assert.deepEqual(await repos.ownerDigests.read("owner-digest"), []);
});

test("later CAS lifecycle progress retains adoption, while omission or core rewrite breaks lineage", async () => {
  const repos = createMemoryRepositories();
  await repos.methodCandidates.put(METHOD_CANDIDATE_STORE_ID, seed(), T0);
  const adopted = await ensureMethodCandidateAuthorityAdopted({ repos, codeProof: goodProof(), now: T0 });
  assert.equal(adopted.ok, true);

  const current = await repos.methodCandidates.mustRead(METHOD_CANDIDATE_STORE_ID);
  const first = current.value.candidates[0]!;
  const progressed: CandidateStore = {
    ...current.value,
    updatedOn: "2026-09-10",
    candidates: [
      {
        ...first,
        lifecycle: "ADMITTED",
        admission: {
          at: "2026-09-10",
          admittedAs: first.proposal.id,
          effect: "LEARNED",
          methodVersionAfter: first.observedMethodVersion + 1,
        },
      },
      ...current.value.candidates.slice(1),
    ],
  };
  const revision2 = await repos.methodCandidates.compareAndSet(
    METHOD_CANDIDATE_STORE_ID,
    current.revision,
    progressed,
    "2026-09-10T00:00:00.000Z",
  );
  assert.equal((await readMethodCandidateAuthorityStatus(repos)).state, "ADOPTED");

  const rewritten: CandidateStore = {
    ...revision2.value,
    candidates: revision2.value.candidates.map((candidate, index) =>
      index === 0 ? { ...candidate, proposal: { ...candidate.proposal, title: "silently rewritten" } } : candidate),
  };
  await repos.methodCandidates.compareAndSet(
    METHOD_CANDIDATE_STORE_ID,
    revision2.revision,
    rewritten,
    "2026-09-10T00:01:00.000Z",
  );
  const status = await readMethodCandidateAuthorityStatus(repos);
  assert.equal(status.state, "REFUSED");
  assert.equal(status.code, "METHOD_CANDIDATE_ADOPTED_LINEAGE_BROKEN");
});

test("contradictory or duplicate adoption receipts refuse instead of being ignored", async () => {
  const repos = createMemoryRepositories();
  await repos.methodCandidates.put(METHOD_CANDIDATE_STORE_ID, seed(), T0);
  assert.equal((await ensureMethodCandidateAuthorityAdopted({ repos, codeProof: goodProof(), now: T0 })).ok, true);

  const original = (await repos.ownerDigests.read("owner-digest"))[0]!;
  const outcome = original.runtimeOutcome;
  assert.equal(outcome?.kind, "METHOD_CANDIDATE_AUTHORITY_ADOPTION");
  if (outcome?.kind !== "METHOD_CANDIDATE_AUTHORITY_ADOPTION") throw new Error("fixture adoption receipt absent");
  const contradictory: OwnerDigestRecord = {
    ...original,
    digestId: "method-candidate-authority-adoption:contradictory",
    runtimeOutcome: {
      ...outcome,
      authorityBoundary: { ...outcome.authorityBoundary, trackedRuntimeWrites: 1 as never },
    },
  };
  await repos.ownerDigests.append("owner-digest", contradictory.digestId, contradictory, T0);
  const status = await readMethodCandidateAuthorityStatus(repos);
  assert.equal(status.state, "REFUSED");
  assert.equal(status.code, "METHOD_CANDIDATE_ADOPTION_RECEIPT_MISMATCH");

  const duplicateRepos = createMemoryRepositories();
  await duplicateRepos.methodCandidates.put(METHOD_CANDIDATE_STORE_ID, seed(), T0);
  assert.equal((await ensureMethodCandidateAuthorityAdopted({ repos: duplicateRepos, codeProof: goodProof(), now: T0 })).ok, true);
  const receipt = (await duplicateRepos.ownerDigests.read("owner-digest"))[0]!;
  await duplicateRepos.ownerDigests.append("owner-digest", `${receipt.digestId}:duplicate`, receipt, T0);
  assert.equal((await readMethodCandidateAuthorityStatus(duplicateRepos)).state, "REFUSED");
});

test("a malformed adopted aggregate is a broken lineage, not a store outage or an empty population", async () => {
  const repos = createMemoryRepositories();
  await repos.methodCandidates.put(METHOD_CANDIDATE_STORE_ID, seed(), T0);
  assert.equal((await ensureMethodCandidateAuthorityAdopted({ repos, codeProof: goodProof(), now: T0 })).ok, true);
  const current = await repos.methodCandidates.mustRead(METHOD_CANDIDATE_STORE_ID);
  await repos.methodCandidates.compareAndSet(
    METHOD_CANDIDATE_STORE_ID,
    current.revision,
    null as unknown as CandidateStore,
    "2026-09-10T00:02:00.000Z",
  );
  const status = await readMethodCandidateAuthorityStatus(repos);
  assert.equal(status.state, "REFUSED");
  assert.equal(status.code, "METHOD_CANDIDATE_ADOPTED_LINEAGE_BROKEN");
});
