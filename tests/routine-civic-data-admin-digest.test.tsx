import assert from "node:assert/strict";
import test from "node:test";

import {
  ownerDigestAttention,
  type OwnerDigestAttention,
  type OwnerDigestRecord,
  type RoutineCivicDataReaderReadbackReference,
  type RoutineCivicDataTaskReceiptReference,
} from "../lib/control-plane/owner-surface.ts";
import { routineCivicDataSupervisorOutcome } from "../lib/control-plane/freshness-cycle-outcome.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";

/**
 * **THE LATEST RUNNER DIGEST IS CLASSIFIED BEFORE IT IS BELIEVED.**
 *
 * A routine civic-data cycle is classified from its exact receipts — a
 * supervisor failure, a contained source hold, a Reader delivery failure, an
 * unproven or contradictory aggregate — and never called healthy from an
 * absent or inconsistent outcome.
 */

const NOW = "2026-09-09T12:00:00.000Z";

/** The owner-facing words of a classification: what the block led with. */
function words(attention: OwnerDigestAttention): string {
  return [attention.headline, attention.happened, attention.action ?? ""].join(" — ");
}
const READER_SHA = "a".repeat(40);

function readerReference(
  disposition: RoutineCivicDataReaderReadbackReference["disposition"] = "CURRENT",
  status: "PASS" | "FAIL" = "PASS",
): RoutineCivicDataReaderReadbackReference {
  const receipt = disposition === "CURRENT" || disposition === "FAILED_BACKOFF" || disposition === "RECORDED"
    ? {
        contractVersion: 2 as const,
        kind: "READER_PROJECTION_READBACK" as const,
        contractId: "reader-contract",
        sourceId: "reader-source",
        recordClass: "FEC_FUNDING" as const,
        scope: "reader-scope",
        projectionId: "reader-projection",
        versionId: "reader-version",
        pointerKey: "FEC_FUNDING:reader-scope",
        observedAt: NOW,
        evidenceKind: "TYPED_READER_READ_MODEL" as const,
        verifierId: "test#reader",
        verifierCodeSha: status === "PASS" ? READER_SHA : READER_SHA,
        status,
        detail: status === "PASS" ? "typed Reader returned the exact version" : "typed Reader did not return the exact version",
      }
    : null;
  return {
    contractId: "reader-contract",
    sourceId: "reader-source",
    recordClass: "FEC_FUNDING",
    scope: "reader-scope",
    projectionId: disposition === "NOT_APPLICABLE" ? null : "reader-projection",
    disposition,
    receipt,
  };
}

function reference(
  taskId: string,
  classification: RoutineCivicDataTaskReceiptReference["classification"],
): RoutineCivicDataTaskReceiptReference {
  const success = classification === "VERIFIED_SOURCE_SUCCESS";
  return {
    taskId,
    sourceId: `source:${taskId}`,
    recordClass: "FEC_FUNDING",
    scope: `scope:${taskId}`,
    classification,
    receipt: {
      source: taskId,
      candidateId: `candidate:${taskId}`,
      acquisitionSucceeded: success,
      state: success ? "PROMOTED" : "SOURCE_BLOCKED",
      decision: success ? "GOOD" : "FAIL",
      promotedVersion: success ? `candidate:${taskId}` : null,
      lastKnownGoodVersion: `lkg:${taskId}`,
      structuralReleaseContract: ZERO_RELEASE_EVENTS,
    },
  };
}

function digest(input: {
  readonly failures?: readonly { readonly taskId: string; readonly code: string; readonly detail: string }[];
  readonly references?: readonly RoutineCivicDataTaskReceiptReference[];
  readonly readerReferences?: readonly RoutineCivicDataReaderReadbackReference[];
  readonly crashedTasks?: readonly { readonly taskId: string; readonly detail: string }[];
  readonly structured?: boolean;
}): OwnerDigestRecord {
  if (input.structured === false) {
    return {
      formatVersion: 1,
      digestId: "legacy",
      writtenAt: NOW,
      headline: "legacy report",
      lines: ["legacy report"],
      cycleOk: true,
      testedSha: null,
    };
  }
  const references = input.references ?? [];
  const readerReferences = input.readerReferences ?? [readerReference()];
  const failures = input.failures ?? [];
  const outcome = routineCivicDataSupervisorOutcome({
    cycleId: "cycle:test",
    startedAt: NOW,
    finishedAt: NOW,
    testedSha: null,
    host: "test-host",
    provider: "memory",
    durable: true,
    attemptedTasks: references.length + (input.crashedTasks?.length ?? 0),
    verifiedSourceSuccesses: references.filter(({ classification }) => classification === "VERIFIED_SOURCE_SUCCESS").length,
    verifiedSourceFailures: references.filter(({ classification }) => classification === "VERIFIED_SOURCE_FAILURE").length,
    failures,
    crashedTasks: input.crashedTasks,
    taskReceipts: references,
    readerReadback: {
      denominator: readerReferences.length,
      recordedPass: readerReferences.filter((row) => row.disposition === "RECORDED" && row.receipt?.status === "PASS").length,
      recordedFail: readerReferences.filter((row) => row.disposition === "RECORDED" && row.receipt?.status === "FAIL").length,
      currentFail: readerReferences.filter((row) => row.disposition === "FAILED_BACKOFF").length,
      noops: readerReferences.filter((row) => !["RECORDED", "FAILED_BACKOFF", "REPAIR_FAILED"].includes(row.disposition)).length,
      repairFailures: readerReferences.filter((row) => row.disposition === "REPAIR_FAILED").length,
      references: readerReferences,
    },
  });
  return {
    formatVersion: 1,
    digestId: outcome.cycleId,
    writtenAt: NOW,
    headline: "routine cycle",
    lines: ["routine cycle exact report"],
    cycleOk: outcome.state === "SUCCEEDED",
    testedSha: null,
    runtimeOutcome: outcome,
  };
}

test("the digest classification leads with actionable supervisor failure and never calls it healthy", () => {
  const record = digest({
    failures: [{ taskId: "fec-funding", code: "CHILD_TIMEOUT", detail: "child timed out" }],
  });
  const attention = ownerDigestAttention(record);
  assert.equal(attention.level, "RED");
  assert.equal(attention.needsYou, true);
  assert.match(words(attention), /Routine civic-data supervision needs attention/);
  assert.match(words(attention), /inspect and restore the failed routine-data supervisor path/);
  assert.doesNotMatch(words(attention), /nothing in it needs you|cycle completed/i);
});

test("the digest classification distinguishes a contained source hold from a successful all-green cycle", () => {
  const contained = digest({ references: [
    reference("source-failed", "VERIFIED_SOURCE_FAILURE"),
    reference("source-unaffected", "VERIFIED_SOURCE_SUCCESS"),
  ] });
  assert.deepEqual(
    { level: ownerDigestAttention(contained).level, needsYou: ownerDigestAttention(contained).needsYou },
    { level: "AMBER", needsYou: false },
  );
  assert.match(words(ownerDigestAttention(contained)), /Routine source failure was contained/);
  assert.match(words(ownerDigestAttention(contained)), /1 exact source receipt\(s\) held their own LKG while 1 unaffected task\(s\) completed successfully/);

  const crashed = digest({ references: [reference("source-unaffected", "VERIFIED_SOURCE_SUCCESS")],
    crashedTasks: [{ taskId: "people-wikidata-people-ca", detail: "(national-people-refresh.mts): SIGABRT" }] });
  assert.equal(crashed.cycleOk, true, "a crashed source child does not fail the cycle");
  assert.deepEqual(
    { level: ownerDigestAttention(crashed).level, needsYou: ownerDigestAttention(crashed).needsYou },
    { level: "AMBER", needsYou: false },
  );
  assert.match(words(ownerDigestAttention(crashed)), /0 exact source receipt\(s\) held their own LKG and 1 source process\(es\) crashed while 1 unaffected/);

  const success = digest({ references: [reference("source-good", "VERIFIED_SOURCE_SUCCESS")] });
  assert.deepEqual(
    { level: ownerDigestAttention(success).level, needsYou: ownerDigestAttention(success).needsYou },
    { level: "GREEN", needsYou: false },
  );
  assert.match(words(ownerDigestAttention(success)), /Routine civic-data cycle completed/);
});

test("a Reader delivery failure is RED without reclassifying source disposition or LKG", () => {
  const source = reference("source-good", "VERIFIED_SOURCE_SUCCESS");
  const record = digest({
    references: [source],
    readerReferences: [readerReference("RECORDED", "FAIL")],
  });
  const outcome = record.runtimeOutcome;
  assert.equal(outcome?.kind, "ROUTINE_CIVIC_DATA_SUPERVISOR");
  if (outcome?.kind !== "ROUTINE_CIVIC_DATA_SUPERVISOR") return;
  assert.equal(outcome.state, "SUCCEEDED", "Reader delivery evidence must not become a source/supervisor disposition");
  assert.equal(outcome.taskReceipts[0]?.classification, "VERIFIED_SOURCE_SUCCESS");
  assert.equal(outcome.taskReceipts[0]?.receipt.promotedVersion, "candidate:source-good");
  assert.equal(outcome.taskReceipts[0]?.receipt.lastKnownGoodVersion, "lkg:source-good");

  const attention = ownerDigestAttention(record);
  assert.deepEqual({ level: attention.level, needsYou: attention.needsYou }, { level: "RED", needsYou: true });
  assert.match(words(attention), /Canonical Reader delivery needs attention/);
  assert.match(words(attention), /Source dispositions, promoted pointers, and LKG remain unchanged/);
  assert.doesNotMatch(words(attention), /Routine civic-data cycle completed|nothing in it needs you/i);
});

test("the digest classification refuses a missing promotion or contradictory Reader aggregate as healthy", () => {
  const noPromotion = digest({
    references: [reference("source-good", "VERIFIED_SOURCE_SUCCESS")],
    readerReferences: [readerReference("NO_PROMOTION")],
  });
  assert.deepEqual(
    { level: ownerDigestAttention(noPromotion).level, needsYou: ownerDigestAttention(noPromotion).needsYou },
    { level: "UNKNOWN", needsYou: true },
  );
  assert.match(words(ownerDigestAttention(noPromotion)), /Reader delivery is not yet proven/);

  const valid = digest({
    references: [reference("source-good", "VERIFIED_SOURCE_SUCCESS")],
    readerReferences: [readerReference("CURRENT")],
  });
  const outcome = valid.runtimeOutcome as Extract<NonNullable<OwnerDigestRecord["runtimeOutcome"]>, { kind: "ROUTINE_CIVIC_DATA_SUPERVISOR" }>;
  const contradictory: OwnerDigestRecord = {
    ...valid,
    runtimeOutcome: { ...outcome, readerReadbacksRecordedFail: 1 },
  };
  assert.deepEqual(
    { level: ownerDigestAttention(contradictory).level, needsYou: ownerDigestAttention(contradictory).needsYou },
    { level: "UNKNOWN", needsYou: true },
  );
  assert.doesNotMatch(
    words(ownerDigestAttention(contradictory)),
    /Routine civic-data cycle completed|nothing in it needs you/i,
  );
});

test("the digest classification does not infer health from a legacy digest with no structured outcome", () => {
  const record = digest({ structured: false });
  assert.deepEqual(
    { level: ownerDigestAttention(record).level, needsYou: ownerDigestAttention(record).needsYou },
    { level: "UNKNOWN", needsYou: true },
  );
  assert.match(words(ownerDigestAttention(record)), /cannot be classified/);
  assert.doesNotMatch(words(ownerDigestAttention(record)), /cycle completed|nothing in it needs you/i);
});

test("the digest classification refuses aggregate-only and internally inconsistent routine evidence", () => {
  const aggregateOnly: OwnerDigestRecord = {
    formatVersion: 1,
    digestId: "aggregate-only",
    writtenAt: NOW,
    headline: "aggregate-only routine report",
    lines: ["one source failure was counted without an exact task receipt"],
    cycleOk: true,
    testedSha: null,
    runtimeOutcome: {
      kind: "ROUTINE_CIVIC_DATA_SUPERVISOR",
      state: "SUCCEEDED",
      cycleId: "aggregate-only",
      startedAt: NOW,
      finishedAt: NOW,
      testedSha: null,
      host: "test-host",
      provider: "memory",
      durable: true,
      attemptedTasks: 2,
      verifiedSourceSuccesses: 1,
      verifiedSourceFailures: 1,
      taskReceiptEvidence: "UNAVAILABLE_OUTER_SUPERVISOR",
      taskReceipts: [],
      readerReadbackEvidence: "UNAVAILABLE_OUTER_SUPERVISOR",
      readerReadbackDenominator: 0,
      readerReadbacksRecordedPass: 0,
      readerReadbacksRecordedFail: 0,
      readerReadbacksCurrentFail: 0,
      readerReadbackNoops: 0,
      readerReadbackRepairFailures: 0,
      readerReadbacks: [],
      failures: [],
      attributionBoundary: {
        sourceReceiptAuthority: "SOURCE_ACQUISITION_CHILD_ONLY",
        supervisorCandidateWrites: 0,
        supervisorPointerWrites: 0,
        supervisorLkgChanges: 0,
      },
    },
  };
  const aggregateAttention = ownerDigestAttention(aggregateOnly);
  assert.deepEqual(
    { level: aggregateAttention.level, needsYou: aggregateAttention.needsYou },
    { level: "UNKNOWN", needsYou: true },
  );
  assert.match(words(aggregateAttention), /lacks consistent exact task evidence/);
  assert.doesNotMatch(words(aggregateAttention), /Routine source failure was contained|nothing in it needs you/i);

  const failed = reference("source-failed", "VERIFIED_SOURCE_FAILURE");
  const mismatched: OwnerDigestRecord = {
    ...digest({ references: [failed] }),
    runtimeOutcome: {
      ...(digest({ references: [failed] }).runtimeOutcome as Extract<NonNullable<OwnerDigestRecord["runtimeOutcome"]>, { kind: "ROUTINE_CIVIC_DATA_SUPERVISOR" }>),
      verifiedSourceFailures: 2,
    },
  };
  const mismatchedAttention = ownerDigestAttention(mismatched);
  assert.deepEqual(
    { level: mismatchedAttention.level, needsYou: mismatchedAttention.needsYou },
    { level: "UNKNOWN", needsYou: true },
  );
  assert.doesNotMatch(
    words(mismatchedAttention),
    /Routine source failure was contained|nothing in it needs you/i,
  );
});
