import assert from "node:assert/strict";
import test from "node:test";

import {
  manualProjectionCandidate,
  type ManualProjectionPackage,
} from "../lib/civic-data/manual-projections.ts";
import {
  manualCandidateContractIssue,
  processRegisteredManualCandidate,
} from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";

const NOW = "2026-09-08T18:00:00.000Z";
const LATER = "2026-09-08T18:01:00.000Z";
const CURRENT = "https://authority.example.gov/current";
const SUPERSEDED = "https://authority.example.gov/superseded-404";

function packageWith(key: "supersededLandingUrl" | "currentLandingUrl"): ManualProjectionPackage {
  return {
    contractId: "candidate-profiles:AZ",
    version: NOW,
    sourceThrough: NOW,
    sourceReceipt: {
      contractVersion: 1,
      reviewedAt: NOW,
      reviewedBy: "receipt-url-test",
      sources: [{
        requestedUrl: CURRENT,
        finalUrl: CURRENT,
        publisher: "Named candidate primary publisher",
        sourceClass: "CANDIDATE_CONTROLLED",
        retrievedAt: NOW,
        httpStatus: 200,
        rawHash: "a".repeat(64),
        reviewedEvidence: "The current page bytes support this test projection.",
      }],
    },
    payload: {
      cards: {
        curatedAt: NOW,
        note: "reviewed",
        cards: {
          "ballot-az-test:jane-doe": {
            sourceUrl: CURRENT,
            [key]: { url: SUPERSEDED, observed: "HTTP 404 during the recorded review." },
          },
        },
        hunts: [],
      },
      links: {
        curatedAt: NOW,
        note: "reviewed",
        links: { "ballot-az-test:jane-doe": {} },
        hunts: [],
      },
    },
  } as unknown as ManualProjectionPackage;
}

test("an explicit failed/superseded URL remains recorded without demanding fabricated positive bytes", async () => {
  const candidate = manualProjectionCandidate(packageWith("supersededLandingUrl"));
  assert.equal(manualCandidateContractIssue("candidate-profiles:AZ", candidate), null);
  assert.ok(candidate.semantics.violations.every((problem) => !problem.includes(SUPERSEDED)));
  const outcome = await processRegisteredManualCandidate(
    new MemoryRoutineDataStore(),
    "candidate-profiles:AZ",
    candidate,
    NOW,
  );
  assert.equal(outcome.candidate.state, "PROMOTED");
});

test("an unreceipted current member is held without withholding an independently supported member", async () => {
  const candidate = manualProjectionCandidate(packageWith("currentLandingUrl"));
  assert.ok(candidate.excludedFacts?.some((fact) =>
    fact.key === "profile:ballot-az-test:jane-doe:card" &&
    fact.code === "MANUAL_MEMBER_SOURCE_NOT_RECEIPTED" &&
    fact.detail.includes(SUPERSEDED)
  ));
  const outcome = await processRegisteredManualCandidate(
    new MemoryRoutineDataStore(),
    "candidate-profiles:AZ",
    candidate,
    NOW,
  );
  assert.equal(outcome.candidate.state, "PROMOTED");
  assert.ok(outcome.promoted);
  const payload = outcome.promoted.payload as {
    cards: { cards: Record<string, unknown> };
    links: { links: Record<string, unknown> };
  };
  assert.equal(payload.cards.cards["ballot-az-test:jane-doe"], undefined);
  assert.deepEqual(payload.links.links["ballot-az-test:jane-doe"], {});
});

test("a truthfully blocked exact source set records SOURCE_RETRIEVAL_FAILED and preserves LKG", async () => {
  const store = new MemoryRoutineDataStore();
  const good = manualProjectionCandidate(packageWith("supersededLandingUrl"));
  const promoted = await processRegisteredManualCandidate(store, "candidate-profiles:AZ", good, NOW);
  assert.equal(promoted.candidate.state, "PROMOTED");
  assert.ok(promoted.promoted);

  const blockedPackage = structuredClone(packageWith("supersededLandingUrl"));
  (blockedPackage as { version: string; sourceThrough: string }).version = LATER;
  (blockedPackage as { version: string; sourceThrough: string }).sourceThrough = LATER;
  (blockedPackage.sourceReceipt as { reviewedAt: string }).reviewedAt = LATER;
  const blockedSource = blockedPackage.sourceReceipt.sources[0]! as {
    retrievedAt: string;
    httpStatus: number;
    rawHash: string;
    reviewedEvidence: string;
    reviewOutcome?: "SUPPORTED" | "BLOCKED";
    failureDetail?: string;
  };
  blockedSource.retrievedAt = LATER;
  blockedSource.httpStatus = 403;
  blockedSource.rawHash = "b".repeat(64);
  blockedSource.reviewedEvidence = "The exact HTTP 403 response was inspected; it does not support promotion.";
  blockedSource.reviewOutcome = "BLOCKED";
  blockedSource.failureDetail = "HTTP 403 challenge response; no positive candidate page was acquired.";

  const blocked = manualProjectionCandidate(blockedPackage);
  assert.equal(blocked.retrieval.succeeded, false);
  assert.equal(manualCandidateContractIssue("candidate-profiles:AZ", blocked), null);
  const refused = await processRegisteredManualCandidate(store, "candidate-profiles:AZ", blocked, LATER);
  assert.equal(refused.candidate.state, "SOURCE_BLOCKED");
  assert.equal(refused.candidate.receipt?.decision, "FAIL");
  assert.ok(refused.candidate.receipt?.checks.some((check) =>
    check.check === "SOURCE_AUTHENTICITY" && check.code === "SOURCE_RETRIEVAL_FAILED"
  ));
  assert.equal(refused.promoted, null);
  assert.equal(
    (await store.readPromotion(good.recordClass, good.scope))?.versionId,
    promoted.promoted!.versionId,
  );
  assert.deepEqual((await store.events(blocked.id)).map((event) => event.state), ["SOURCE_BLOCKED"]);
});

test("malformed failed-status input is rejected before it can reach a store", () => {
  const malformed = structuredClone(packageWith("supersededLandingUrl"));
  const source = malformed.sourceReceipt.sources[0]! as { httpStatus: number };
  source.httpStatus = 403;
  assert.throws(
    () => manualProjectionCandidate(malformed),
    /MANUAL_SOURCE_RECEIPT_MALFORMED:MANUAL_SOURCE_SUPPORTED_PROOF_INVALID/,
  );
});

test("an HTTP 200 challenge shell explicitly reviewed as BLOCKED cannot authorize promotion", async () => {
  const challengePackage = structuredClone(packageWith("supersededLandingUrl"));
  const source = challengePackage.sourceReceipt.sources[0]! as {
    httpStatus: number;
    rawHash: string;
    reviewedEvidence: string;
    reviewOutcome?: "SUPPORTED" | "BLOCKED";
    failureDetail?: string;
  };
  source.httpStatus = 200;
  source.rawHash = "c".repeat(64);
  source.reviewedEvidence = "The exact HTTP 200 body was inspected and contained only a generic challenge shell.";
  source.reviewOutcome = "BLOCKED";
  source.failureDetail = "HTTP 200 challenge shell did not contain the cited primary-source record.";
  const candidate = manualProjectionCandidate(challengePackage);
  assert.equal(candidate.retrieval.succeeded, false);
  assert.equal(manualCandidateContractIssue("candidate-profiles:AZ", candidate), null);
  const outcome = await processRegisteredManualCandidate(
    new MemoryRoutineDataStore(),
    "candidate-profiles:AZ",
    candidate,
    NOW,
  );
  assert.equal(outcome.candidate.state, "SOURCE_BLOCKED");
  assert.equal(outcome.promoted, null);
  assert.ok(outcome.candidate.receipt?.checks.some((check) => check.code === "SOURCE_RETRIEVAL_FAILED"));
});
