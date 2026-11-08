import assert from "node:assert/strict";

import test from "node:test";

import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";

import { fecSourceFixture } from "./helpers/routine-candidate-fixture.ts";

import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";

import type { RoutineRecordClass } from "../lib/civic-data/types.ts";

import { refreshFundingFromPromoted } from "../lib/funding/snapshot.ts";

const PROVEN_AT = "2026-09-08T12:00:00.000Z";

function provenFundingCandidate() {
  return fecSourceFixture({
    name: "Proof priming test candidate",
    retrievedAt: PROVEN_AT,
  });
}

test("every verification operation checks the current stored rows", async () => {
  class CountingStore extends MemoryRoutineDataStore {
    readonly reads = { promotion: 0, candidate: 0 };
    tamper = false;

    override async readPromotion<T>(recordClass: RoutineRecordClass, scope: string) {
      this.reads.promotion += 1;
      const row = await super.readPromotion<T>(recordClass, scope);
      return row !== null && this.tamper ? { ...row, payload: { tampered: true } as T } : row;
    }

    override async readCandidate(candidateId: string) {
      this.reads.candidate += 1;
      return super.readCandidate(candidateId);
    }

    override async readCandidateProof(candidateId: string) {
      this.reads.candidate += 1;
      return super.readCandidateProof(candidateId);
    }
  }
  const promotedStore = async (): Promise<CountingStore> => {
    const store = new CountingStore();
    const outcome = await processRegisteredRoutineCandidate(store, "fec-funding", provenFundingCandidate(), PROVEN_AT);
    assert.ok(outcome.promoted);
    Object.assign(store.reads, { promotion: 0, candidate: 0 });
    return store;
  };

  // The first read of a fresh read model is the full proof: a payload its
  // candidate does not back is refused on every read.
  const tampered = await promotedStore();
  tampered.tamper = true;
  await assert.rejects(refreshFundingFromPromoted({ store: tampered }), /PROMOTION_PROOF_INVALID|proof|not the exact/i);
  await assert.rejects(refreshFundingFromPromoted({ store: tampered }), /PROMOTION_PROOF_INVALID|proof|not the exact/i);

  // Concurrent and later reads all check the store for its current rows.
  // The store owns reuse of bodies after checking their database versions.
  const store = await promotedStore();
  const [first, second] = await Promise.all([refreshFundingFromPromoted({ store }), refreshFundingFromPromoted({ store })]);
  assert.equal(first, second);
  assert.deepEqual(store.reads, { promotion: 2, candidate: 2 }, "each loader checks current rows");
  assert.equal(await refreshFundingFromPromoted({ store }), first);
  assert.deepEqual(store.reads, { promotion: 3, candidate: 3 }, "a later read rechecks current rows");

});
