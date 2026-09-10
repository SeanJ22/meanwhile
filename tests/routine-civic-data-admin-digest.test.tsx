import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { LatestDigestStatus } from "../app/(admin)/digest-status.tsx";
import {
  ownerDigestAttention,
  type OwnerDigestRecord,
  type RoutineCivicDataReaderReadbackReference,
  type RoutineCivicDataTaskReceiptReference,
} from "../lib/control-plane/owner-surface.ts";
import { routineCivicDataSupervisorOutcome } from "../lib/control-plane/freshness-cycle-outcome.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";

const NOW = "2026-09-09T12:00:00.000Z";
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
    attemptedTasks: references.length,
    verifiedSourceSuccesses: references.filter(({ classification }) => classification === "VERIFIED_SOURCE_SUCCESS").length,
    verifiedSourceFailures: references.filter(({ classification }) => classification === "VERIFIED_SOURCE_FAILURE").length,
    failures,
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

test("Admin leads with actionable supervisor failure and never calls it healthy", () => {
  const record = digest({
    failures: [{ taskId: "fec-funding", code: "CHILD_TIMEOUT", detail: "child timed out" }],
  });
  const attention = ownerDigestAttention(record);
  assert.equal(attention.level, "RED");
  assert.equal(attention.needsYou, true);
  const html = renderToStaticMarkup(<LatestDigestStatus digest={record} />);
  assert.match(html, /Routine civic-data supervision needs attention/);
  assert.match(html, /inspect and restore the failed routine-data supervisor path/);
  assert.doesNotMatch(html, /nothing in it needs you/i);
});

test("Admin distinguishes a contained source hold from a successful all-green cycle", () => {
  const contained = digest({ references: [
    reference("source-failed", "VERIFIED_SOURCE_FAILURE"),
    reference("source-unaffected", "VERIFIED_SOURCE_SUCCESS"),
  ] });
  assert.deepEqual(
    { level: ownerDigestAttention(contained).level, needsYou: ownerDigestAttention(contained).needsYou },
    { level: "AMBER", needsYou: false },
  );
  const containedHtml = renderToStaticMarkup(<LatestDigestStatus digest={contained} />);
  assert.match(containedHtml, /Routine source failure was contained/);
  assert.match(containedHtml, /source-failed/);
  assert.match(containedHtml, /source-unaffected/);

  const success = digest({ references: [reference("source-good", "VERIFIED_SOURCE_SUCCESS")] });
  assert.deepEqual(
    { level: ownerDigestAttention(success).level, needsYou: ownerDigestAttention(success).needsYou },
    { level: "GREEN", needsYou: false },
  );
  assert.match(renderToStaticMarkup(<LatestDigestStatus digest={success} />), /Routine civic-data cycle completed/);
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
  const html = renderToStaticMarkup(<LatestDigestStatus digest={record} />);
  assert.match(html, /Canonical Reader delivery needs attention/);
  assert.match(html, /reader-contract/);
  assert.match(html, /reader-version/);
  assert.match(html, /Source dispositions, promoted pointers, and LKG remain unchanged/);
  assert.doesNotMatch(html, /Routine civic-data cycle completed|nothing in it needs you/i);
});

test("Admin refuses a missing promotion or contradictory Reader aggregate as healthy", () => {
  const noPromotion = digest({
    references: [reference("source-good", "VERIFIED_SOURCE_SUCCESS")],
    readerReferences: [readerReference("NO_PROMOTION")],
  });
  assert.deepEqual(
    { level: ownerDigestAttention(noPromotion).level, needsYou: ownerDigestAttention(noPromotion).needsYou },
    { level: "UNKNOWN", needsYou: true },
  );
  assert.match(renderToStaticMarkup(<LatestDigestStatus digest={noPromotion} />), /Reader delivery is not yet proven/);

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
    renderToStaticMarkup(<LatestDigestStatus digest={contradictory} />),
    /Routine civic-data cycle completed|nothing in it needs you/i,
  );
});

test("Admin does not infer health from a legacy digest with no structured outcome", () => {
  const record = digest({ structured: false });
  assert.deepEqual(
    { level: ownerDigestAttention(record).level, needsYou: ownerDigestAttention(record).needsYou },
    { level: "UNKNOWN", needsYou: true },
  );
  const html = renderToStaticMarkup(<LatestDigestStatus digest={record} />);
  assert.match(html, /cannot be classified/);
  assert.doesNotMatch(html, /cycle completed|nothing in it needs you/i);
});

test("Admin refuses aggregate-only and internally inconsistent routine evidence", () => {
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
  const aggregateHtml = renderToStaticMarkup(<LatestDigestStatus digest={aggregateOnly} />);
  assert.match(aggregateHtml, /lacks consistent exact task evidence/);
  assert.doesNotMatch(aggregateHtml, /Routine source failure was contained|nothing in it needs you/i);

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
    renderToStaticMarkup(<LatestDigestStatus digest={mismatched} />),
    /Routine source failure was contained|nothing in it needs you/i,
  );
});
