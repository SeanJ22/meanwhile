import assert from "node:assert/strict";

import test from "node:test";

import { MemoryRoutineDataStore, pdcV2CanonicalMeetingFactEvidence } from "../lib/civic-data/store.ts";

import { fecFundingCandidate } from "../lib/civic-data/candidate-builders.ts";

import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";

import type { RoutineRecordClass } from "../lib/civic-data/types.ts";

import { refreshFundingFromPromoted } from "../lib/funding/snapshot.ts";

const PROVEN_AT = "2026-09-08T12:00:00.000Z";

function provenFundingCandidate() {
  return fecFundingCandidate({
    snapshot: {
      formatVersion: 1,
      fetchedAt: PROVEN_AT,
      cycle: 2026,
      matchReport: { rosterMatched: 1, rosterTotal: 1, ballotMatched: 0, ballotTotal: 0 },
      candidates: [{
        dataClass: "FEC_COMMITTEE",
        fecCandidateId: "H6AZ01001",
        name: "Proof priming test candidate",
        state: "AZ",
        office: "H",
        district: "01",
        targetKeys: ["congress:test"],
        matchRoutes: ["bioguide-bridge"],
        principalCommitteeId: "C00999999",
        cycle: 2026,
        totals: {
          receipts: 10,
          disbursements: 1,
          cashOnHand: 9,
          individualItemized: 10,
          individualUnitemized: 0,
          smallDonorShare: 0,
          coverageEndDate: "2026-06-30",
        },
        topContributions: [],
        provenance: {
          sourceUrl: "https://api.open.fec.gov/v1/",
          sourceOrg: "Federal Election Commission",
          collectedAt: PROVEN_AT,
          verifiedAt: PROVEN_AT,
        },
      }],
      absences: [],
    },
    rawBodies: ["official FEC response bytes"],
    finalUrl: "https://api.open.fec.gov/v1/candidates/search/",
    retrievedAt: PROVEN_AT,
    excludedFacts: [],
  });
}

test("a proven read in a fresh process still runs the full proof; later reads share it instead of re-downloading", async () => {
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
  // candidate does not back is refused exactly as a bypassing read refuses it.
  const tampered = await promotedStore();
  tampered.tamper = true;
  await assert.rejects(refreshFundingFromPromoted({ store: tampered }), /PROMOTION_PROOF_INVALID|proof|not the exact/i);
  await assert.rejects(refreshFundingFromPromoted({ store: tampered, bypassCache: true }), /PROMOTION_PROOF_INVALID|proof|not the exact/i);

  // Concurrent loaders share one read and one proof; a later read of the
  // unmoved pointer asks its identity only.
  const store = await promotedStore();
  const [first, second] = await Promise.all([refreshFundingFromPromoted({ store }), refreshFundingFromPromoted({ store })]);
  assert.equal(first, second);
  assert.deepEqual(store.reads, { promotion: 1, candidate: 1 }, "one read and one proof for concurrent loaders");
  assert.equal(await refreshFundingFromPromoted({ store }), first);
  assert.deepEqual(store.reads, { promotion: 1, candidate: 1 }, "an unmoved pointer is served from this process's proof");

  // Bypassing skipped both: every loader downloaded and proved the family again.
  const bypassing = await promotedStore();
  await Promise.all([refreshFundingFromPromoted({ store: bypassing, bypassCache: true }), refreshFundingFromPromoted({ store: bypassing, bypassCache: true })]);
  await refreshFundingFromPromoted({ store: bypassing, bypassCache: true });
  assert.deepEqual(bypassing.reads, { promotion: 3, candidate: 3 });
});
