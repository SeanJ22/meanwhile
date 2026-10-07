import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  adjacentSourceStateTransitionIssue,
  drilldownCountText,
  observationText,
  projectRoutineDataObservability,
  projectRoutineDataObservabilityRead,
  type RoutineCandidateEventRow,
  type RoutineCandidateRow,
  type RoutinePromotionRow,
} from "../lib/civic-data/observability.ts";
import { ROUTINE_SOURCE_CONTRACTS, type RoutineSourceContract } from "../lib/civic-data/contracts.ts";
import { MEETING_PARTITION_CONTRACTS, observableRoutineContracts } from "../lib/civic-data/meeting-partitions.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS, type ManualProductionSourceContract } from "../lib/civic-data/manual-contracts.ts";
import { VALIDATION_CHECKS, type RoutineChangeSet, type ValidationReceipt } from "../lib/civic-data/types.ts";
import { READER_PROJECTION_READBACK_PREFIX, serializeReaderProjectionReadback } from "../lib/civic-data/reader-readback.ts";
import { ROUTINE_OBSERVABILITY_SNAPSHOT_OPTIONS } from "../lib/civic-data/observability-store.ts";
import { normalizedHash } from "../lib/civic-data/candidate-builders.ts";
import { createPermanentMeetingFreshness } from "../lib/control-plane/promotion/meeting-freshness.ts";

const NOW = "2026-09-08T12:00:00.000Z";
const READER_CODE_SHA = "a".repeat(40);
const LATER_READER_CODE_SHA = "b".repeat(40);
const READER_BUILD = { codeSha: READER_CODE_SHA, branch: "main", context: "production" } as const;

test("bounded worker freshness reuses full canonical proof and shares one read across fact classes", async () => {
  const contract = MEETING_PARTITION_CONTRACTS.find(c => c.meetingSource === "legistar")!;
  const candidate = candidateRow(contract, { id: "bounded-authority", at: NOW });
  const rows = { candidates: [candidate], promotions: [promotion(contract, candidate)], events: [...sourceHistory(candidate), readerEvent(contract, candidate)] };
  let reads = 0;
  let builds = 0;
  const freshness = createPermanentMeetingFreshness({ connection: "isolated", now: () => NOW,
    readBuild: async () => { builds++; return READER_BUILD; },
    readRows: async (_connection, selected) => { reads++; assert.equal(selected.id, contract.id); return rows; },
  });
  const fact = { subjectId: contract.bodyId, meetingSource: contract.meetingSource, lastSuccessfulAcquisitionAt: NOW };
  const results = await Promise.all([freshness({ ...fact, recordClass: "meeting-times" }), freshness({ ...fact, recordClass: "agendas" })]);
  assert.ok(results.every(r => !r.hold), JSON.stringify(results));
  assert.equal(reads, 1);
  assert.equal(builds, 1);
  const older = await freshness({ ...fact, recordClass: "meeting-times", lastSuccessfulAcquisitionAt: "2026-09-07T00:00:00.000Z" });
  assert.equal(older.state, "STALE");
  assert.equal(older.hold, true, "new authority cannot refresh old fact evidence by association");
});

test("bounded worker freshness rejects missing readback, bad pointer, stale authority and another deployed build", async () => {
  const contract = MEETING_PARTITION_CONTRACTS.find(c => c.meetingSource === "legistar")!;
  const candidate = candidateRow(contract, { id: "bounded-negative", at: NOW });
  const rows = { candidates: [candidate], promotions: [promotion(contract, candidate)], events: [...sourceHistory(candidate), readerEvent(contract, candidate)] };
  for (const variant of [
    { rows: { ...rows, events: sourceHistory(candidate) }, build: READER_BUILD, now: NOW },
    { rows: { ...rows, promotions: [{ ...rows.promotions[0], currentVersionId: "missing" }] }, build: READER_BUILD, now: NOW },
    { rows, build: { ...READER_BUILD, codeSha: LATER_READER_CODE_SHA }, now: NOW },
    { rows, build: READER_BUILD, now: "2026-09-20T12:00:00.000Z" },
  ]) {
    const freshness = createPermanentMeetingFreshness({ connection: "isolated", now: () => variant.now,
      readBuild: async () => variant.build, readRows: async () => variant.rows });
    const reading = await freshness({ subjectId: contract.bodyId, meetingSource: contract.meetingSource, recordClass: "meeting-times", lastSuccessfulAcquisitionAt: NOW });
    assert.equal(reading.hold, true, JSON.stringify(reading));
  }
});

test("bounded worker proof failure stays named, cached and secret-free", async () => {
  const contract = MEETING_PARTITION_CONTRACTS.find(c => c.meetingSource === "legistar")!;
  let reads = 0;
  const conditions: string[] = [];
  const freshness = createPermanentMeetingFreshness({ connection: "private-credential", now: () => NOW,
    readBuild: async () => READER_BUILD, readRows: async () => { reads++; throw new Error("private-credential"); },
    onUnavailable: detail => conditions.push(detail) });
  const fact = { subjectId: contract.bodyId, meetingSource: contract.meetingSource, recordClass: "meeting-times" as const, lastSuccessfulAcquisitionAt: NOW };
  const reading = await freshness(fact);
  assert.equal(reading.hold, true);
  assert.equal(reading.state, "UNKNOWN");
  assert.match(reading.reason, /MEETING_FRESHNESS_READ_OR_PROOF_FAILED/);
  await freshness(fact);
  assert.equal(reads, 1);
  assert.equal(conditions.length, 1);
  assert.doesNotMatch(JSON.stringify([reading, conditions]), /private-credential/);
});

function validationReceipt(
  contract: RoutineSourceContract | ManualProductionSourceContract,
  candidateId: string,
  validatedAt: string,
  decision: ValidationReceipt["decision"] = "GOOD",
): ValidationReceipt {
  return {
    contractVersion: 2,
    decision,
    candidateId,
    sourceId: contract.sourceId,
    recordClass: contract.recordClass,
    scope: contract.scope,
    validatedAt,
    checks: VALIDATION_CHECKS.map((check, index) => ({
      check,
      verdict: decision === "GOOD" || index > 0 ? "PASS" : decision === "FAIL" ? "FAIL" : "CANNOT_TELL",
      code: decision === "GOOD" || index > 0 ? `${check}_PASS` : `${check}_${decision}`,
      detail: decision === "GOOD" || index > 0 ? `${check} passed.` : `${check} refused this candidate.`,
    })),
    excludedFacts: [],
  };
}

function changes(overrides: Partial<RoutineChangeSet> = {}): RoutineChangeSet {
  return {
    outcome: "UNCHANGED",
    added: [],
    changed: [],
    removed: [],
    held: [],
    ...overrides,
  };
}

function candidateRow(
  contract: RoutineSourceContract | ManualProductionSourceContract,
  input: {
    readonly id: string;
    readonly at: string;
    readonly state?: RoutineCandidateRow["state"];
    readonly acquisitionSucceeded?: boolean;
    readonly receipt?: ValidationReceipt | null;
    readonly changeSet?: RoutineChangeSet | null;
    readonly sourceThrough?: string;
    readonly promotedVersionId?: string | null;
    readonly lastKnownGoodVersionId?: string | null;
    readonly failureCode?: string | null;
    readonly failureDetail?: string | null;
    readonly staleAtRetrieval?: boolean;
  },
): RoutineCandidateRow {
  const state = input.state ?? "PROMOTED";
  const heldReceipt = input.receipt === undefined
    ? validationReceipt(contract, input.id, input.at)
    : input.receipt;
  const changeSet = input.changeSet === undefined ? changes() : input.changeSet;
  const readModel = { candidateId: input.id };
  return {
    id: input.id,
    sourceId: contract.sourceId,
    recordClass: contract.recordClass,
    scope: contract.scope,
    state,
    acquisitionSucceeded: input.acquisitionSucceeded ?? true,
    retrievedAt: input.at,
    sourceThrough: input.sourceThrough ?? input.at,
    candidate: {
      id: input.id,
      sourceId: contract.sourceId,
      recordClass: contract.recordClass,
      scope: contract.scope,
      retrieval: { succeeded: input.acquisitionSucceeded ?? true, retrievedAt: input.at },
      temporal: {
        sourceThrough: input.sourceThrough ?? input.at,
        staleAtRetrieval: input.staleAtRetrieval ?? false,
      },
      normalization: {
        normalizedHash: normalizedHash(readModel),
        normalizedPayloadHash: normalizedHash(readModel),
      },
      normalizedPayload: readModel,
      readModel,
      ...(changeSet === null ? {} : { changeSet }),
    },
    validationReceipt: heldReceipt,
    promotedVersionId: input.promotedVersionId === undefined ? (state === "PROMOTED" ? input.id : null) : input.promotedVersionId,
    lastKnownGoodVersionId: input.lastKnownGoodVersionId ?? (state === "PROMOTED" ? input.id : null),
    failureCode: input.failureCode ?? null,
    failureDetail: input.failureDetail ?? null,
  };
}

function promotion(contract: RoutineSourceContract | ManualProductionSourceContract, row: RoutineCandidateRow): RoutinePromotionRow {
  return {
    key: `${contract.recordClass}:${contract.scope}`,
    sourceId: contract.sourceId,
    recordClass: contract.recordClass,
    scope: contract.scope,
    currentVersionId: row.id,
    lastKnownGoodVersionId: row.id,
    promotedAt: row.retrievedAt,
    payload: (row.candidate as { readonly readModel: unknown }).readModel,
    validationReceipt: row.validationReceipt,
  };
}

function event(row: RoutineCandidateRow, sequence = 1): RoutineCandidateEventRow {
  return {
    id: `event-${row.id}-${sequence}`,
    candidateId: row.id,
    sequence,
    state: row.state,
    at: row.retrievedAt,
    detail: `${row.id} became ${row.state}.`,
  };
}

/** A normal durable source attempt, including every predecessor state. */
function sourceHistory(row: RoutineCandidateRow): RoutineCandidateEventRow[] {
  if (row.state === "SOURCE_BLOCKED" && !row.acquisitionSucceeded) return [event(row)];
  const states: RoutineCandidateEventRow["state"][] = row.state === "FETCHED"
    ? ["FETCHED"]
    : row.state === "PARSE_INVALID"
      ? ["FETCHED", "PARSE_INVALID"]
      : row.state === "NORMALIZED"
        ? ["FETCHED", "NORMALIZED"]
        : row.state === "VALIDATED"
          ? ["FETCHED", "NORMALIZED", "VALIDATED"]
          : row.state === "PROMOTED"
            ? ["FETCHED", "NORMALIZED", "VALIDATED", "PROMOTED"]
            : ["FETCHED", "NORMALIZED", row.state];
  return states.map((state, index) => ({
    id: `event-${row.id}-${index + 1}`,
    candidateId: row.id,
    sequence: index + 1,
    state,
    at: row.retrievedAt,
    detail: `${row.id} became ${state}.`,
  }));
}

function readerEvent(
  contract: RoutineSourceContract | ManualProductionSourceContract,
  row: RoutineCandidateRow,
  sequence = sourceHistory(row).length + 1,
): RoutineCandidateEventRow {
  if (contract.readerProjection === null) throw new Error(`Contract ${contract.id} has no Reader projection.`);
  return {
    id: `reader-event-${row.id}-${sequence}`,
    candidateId: row.id,
    sequence,
    state: "PROMOTED",
    at: row.retrievedAt,
    detail: serializeReaderProjectionReadback({
      contractVersion: 2,
      kind: "READER_PROJECTION_READBACK",
      contractId: contract.id,
      sourceId: contract.sourceId,
      recordClass: contract.recordClass,
      scope: contract.scope,
      projectionId: contract.readerProjection.id,
      versionId: row.id,
      pointerKey: `${contract.recordClass}:${contract.scope}`,
      observedAt: row.retrievedAt,
      evidenceKind: "TYPED_READER_READ_MODEL",
      verifierId: `test:typed-reader:${contract.id}`,
      verifierCodeSha: READER_CODE_SHA,
      status: "PASS",
      detail: `The contract-specific typed Reader returned ${row.id}.`,
    }),
  };
}

function countValue<T>(count: { readonly kind: string; readonly value?: number; readonly members: readonly T[] }): number {
  assert.equal(count.kind, "MEASURED");
  assert.equal(typeof count.value, "number");
  return count.value!;
}

test("PDC-13: the pure source-state classifier refuses skipped, revived, and repeated dispositions", () => {
  const history = (...states: RoutineCandidateEventRow["state"][]) => states.map((state, index) => ({
    sequence: index + 1,
    state,
    detail: `${state} source state`,
  }));
  assert.equal(adjacentSourceStateTransitionIssue(history("FETCHED", "NORMALIZED", "VALIDATED", "PROMOTED")), null);
  assert.equal(adjacentSourceStateTransitionIssue(history("FETCHED", "SEMANTIC_INVALID")), null);
  assert.equal(adjacentSourceStateTransitionIssue(history("SOURCE_BLOCKED")), null);
  for (const planted of [history("NORMALIZED"), history("VALIDATED", "PROMOTED"), history("PROMOTED")]) {
    assert.match(adjacentSourceStateTransitionIssue(planted) ?? "", /illegal initial source state/);
  }
  for (const planted of [
    history("FETCHED", "VALIDATED", "PROMOTED"),
    history("FETCHED", "NORMALIZED", "PROMOTED"),
    history("FETCHED", "SEMANTIC_INVALID", "NORMALIZED"),
    history("FETCHED", "NORMALIZED", "VALIDATED", "PROMOTED", "PROMOTED"),
  ]) {
    assert.match(adjacentSourceStateTransitionIssue(planted) ?? "", /illegal adjacent source-state transition/);
  }
});

test("PDC-13: an illegal adjacent source transition cannot become canonical or counted success", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const row = candidateRow(contract, {
    id: "illegal-transition-v2",
    at: "2026-09-08T01:00:00.000Z",
  });
  const sourceEvents: RoutineCandidateEventRow[] = [
    { id: "illegal-1", candidateId: row.id, sequence: 1, state: "FETCHED", at: row.retrievedAt, detail: "Fetched." },
    { id: "illegal-2", candidateId: row.id, sequence: 2, state: "VALIDATED", at: row.retrievedAt, detail: "Skipped normalization." },
    { id: "illegal-3", candidateId: row.id, sequence: 3, state: "PROMOTED", at: row.retrievedAt, detail: "Promoted." },
  ];
  const observed = projectRoutineDataObservability(
    { candidates: [row], events: sourceEvents, promotions: [promotion(contract, row)] },
    NOW,
    [contract],
    READER_BUILD,
  ).contracts[0];

  assert.equal(observed.canonicalPromotion.kind, "UNKNOWN");
  if (observed.canonicalPromotion.kind === "UNKNOWN") {
    assert.match(observed.canonicalPromotion.detail, /illegal adjacent source-state transition FETCHED -> VALIDATED/);
  }
  assert.equal(observed.readerVisible.kind, "UNKNOWN");
  assert.equal(observed.histories["24h"].attempts[0]?.attemptedAt.kind, "UNKNOWN");
  assert.equal(observed.histories["24h"].counts.successfulAcquisitions.kind, "UNKNOWN");
  assert.equal(observed.histories["24h"].counts.promotions.kind, "UNKNOWN");
});

test("PDC-13: an answered empty store is NOT_RECORDED while a complete history count is measured zero", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const view = projectRoutineDataObservability({ candidates: [], events: [], promotions: [] }, NOW, [contract]);
  const row = view.contracts[0];

  assert.equal(row.currentState.kind, "NOT_RECORDED");
  assert.equal(row.canonicalPromotion.kind, "NOT_RECORDED");
  assert.equal(row.latestChanges.kind, "NOT_RECORDED");
  assert.equal(row.cadence.freshness, "UNKNOWN");
  assert.equal(row.histories["24h"].counts.attempts.kind, "MEASURED");
  assert.equal(row.histories["24h"].counts.attempts.value, 0);
  assert.deepEqual(row.histories["24h"].counts.attempts.members, []);
  assert.equal(drilldownCountText(row.histories["24h"].counts.attempts), "0");
  assert.equal(observationText(row.currentState), "Not measured — no record");
  assert.equal(countValue(view.summary.latestOutcomeNotRecorded), 1);
  assert.equal(countValue(view.summary.latestOutcomeUnknown), 0);
});

test("PDC-13: exact change members, GOOD pointer, and typed Reader receipt prove delivered CHANGED", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const row = candidateRow(contract, {
    id: "fec-v2",
    at: "2026-09-08T00:00:00.000Z",
    changeSet: changes({
      outcome: "CHANGED",
      added: [{ key: "candidate:A", before: null, after: { receipts: 10 } }],
      changed: [{ key: "candidate:B", before: { receipts: 3 }, after: { receipts: 4 } }],
      removed: [],
      held: [{ key: "candidate:C", code: "IDENTITY_HELD", detail: "Official id is unresolved.", record: { name: "C" } }],
    }),
  });
  const view = projectRoutineDataObservability(
    { candidates: [row], events: [...sourceHistory(row), readerEvent(contract, row)], promotions: [promotion(contract, row)] },
    NOW,
    [contract],
    READER_BUILD,
  );
  const source = view.contracts[0];

  assert.equal(source.canonicalPromotion.kind, "MEASURED");
  assert.equal(source.readerVisible.kind, "MEASURED");
  if (source.readerVisible.kind === "MEASURED") {
    assert.equal(source.readerVisible.value.versionId, "fec-v2");
    assert.equal(source.readerVisible.value.eventId, "reader-event-fec-v2-5");
  }
  assert.equal(source.latestCanonicalOutcome.kind, "MEASURED");
  if (source.latestCanonicalOutcome.kind === "MEASURED") assert.equal(source.latestCanonicalOutcome.value, "CHANGED");
  assert.equal(source.latestChanges.kind, "MEASURED");
  if (source.latestChanges.kind === "MEASURED") {
    assert.deepEqual(source.latestChanges.value.added.map((item) => item.key), ["candidate:A"]);
    assert.deepEqual(source.latestChanges.value.changed.map((item) => item.key), ["candidate:B"]);
    assert.equal(source.latestChanges.value.removed.length, 0, "empty persisted array is a measured zero");
  }
  assert.equal(source.latestHeld.kind, "MEASURED");
  if (source.latestHeld.kind === "MEASURED") assert.deepEqual(source.latestHeld.value.map((item) => item.code), ["IDENTITY_HELD"]);
  assert.equal(source.cadence.freshness, "FRESH");
  assert.equal(source.cadence.operationalState, "HEALTHY");
  assert.deepEqual(
    source.histories["24h"].events.map((item) => item.domain).sort(),
    ["READER_READBACK", "SOURCE_STATE", "SOURCE_STATE", "SOURCE_STATE", "SOURCE_STATE"],
    "Admin must label Reader evidence separately from source disposition",
  );
  assert.equal(countValue(view.summary.latestChanged), 1);
  assert.deepEqual(view.summary.latestChanged.members.map((item) => item.contractId), [contract.id]);
  for (const [name, count] of Object.entries(view.summary)) {
    assert.equal(count.kind, "MEASURED", `${name} summary should be measured from the finite contract registry`);
    if (count.kind === "MEASURED") assert.equal(count.value, count.members.length, `${name} must drill into every counted member`);
  }
  assert.equal(
    ["healthy", "held", "retrying", "inProgress", "operationalDue", "operationalStale", "operationalUnknown"]
      .reduce((sum, name) => sum + countValue(view.summary[name as keyof typeof view.summary]), 0),
    countValue(view.summary.contracts),
    "every contract must appear in exactly one operational-state drilldown",
  );
  assert.equal(
    ["fresh", "due", "stale", "unknown", "manual"]
      .reduce((sum, name) => sum + countValue(view.summary[name as keyof typeof view.summary]), 0),
    countValue(view.summary.contracts),
    "every contract must appear in exactly one freshness drilldown",
  );
  assert.equal(
    ["readerVisible", "readerNotRecorded", "readerUnknown", "readerNotApplicable"]
      .reduce((sum, name) => sum + countValue(view.summary[name as keyof typeof view.summary]), 0),
    countValue(view.summary.contracts),
    "every contract must appear in exactly one Reader-proof drilldown",
  );
  for (const [name, count] of Object.entries(source.histories["24h"].counts)) {
    if (count.kind === "MEASURED") assert.equal(count.value, count.members.length, `${name} must drill into every counted event/record`);
  }
});

test("PDC-13: declared consumers without a durable typed Reader readback do not prove delivery", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const row = candidateRow(contract, { id: "fec-no-reader-receipt", at: "2026-09-08T00:30:00.000Z" });
  const missing = projectRoutineDataObservability(
    { candidates: [row], events: sourceHistory(row), promotions: [promotion(contract, row)] },
    NOW,
    [contract],
    READER_BUILD,
  ).contracts[0];
  assert.equal(missing.canonicalPromotion.kind, "MEASURED");
  assert.equal(missing.readerVisible.kind, "NOT_RECORDED");

  const malformedEvent = { ...readerEvent(contract, row), detail: `${READER_PROJECTION_READBACK_PREFIX}{broken` };
  const malformed = projectRoutineDataObservability(
    { candidates: [row], events: [...sourceHistory(row), malformedEvent], promotions: [promotion(contract, row)] },
    NOW,
    [contract],
  ).contracts[0];
  assert.equal(malformed.readerVisible.kind, "UNKNOWN");
});

test("PDC-13: a pointer without its atomic PROMOTED event is UNKNOWN, never canonical", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const row = candidateRow(contract, { id: "fec-missing-promotion-event", at: "2026-09-08T00:35:00.000Z" });
  const observed = projectRoutineDataObservability(
    { candidates: [row], events: [readerEvent(contract, row)], promotions: [promotion(contract, row)] },
    NOW,
    [contract],
    READER_BUILD,
  ).contracts[0];

  assert.equal(observed.canonicalPromotion.kind, "UNKNOWN");
  assert.equal(observed.readerVisible.kind, "UNKNOWN");
  assert.equal(observed.cadence.operationalState, "UNKNOWN");
  if (observed.canonicalPromotion.kind === "UNKNOWN") {
    assert.match(observed.canonicalPromotion.detail, /0 matching atomic PROMOTED events/);
  }
});

test("PDC-13: a future-dated Reader PASS cannot certify present Reader visibility", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const row = candidateRow(contract, { id: "fec-future-reader-proof", at: "2026-09-08T00:40:00.000Z" });
  const base = readerEvent(contract, row);
  const future = "2026-09-08T13:00:00.000Z";
  const receipt = JSON.parse(base.detail.slice(READER_PROJECTION_READBACK_PREFIX.length)) as Record<string, unknown>;
  const futureReader = {
    ...base,
    at: future,
    detail: `${READER_PROJECTION_READBACK_PREFIX}${JSON.stringify({ ...receipt, observedAt: future })}`,
  };
  const observed = projectRoutineDataObservability(
    { candidates: [row], events: [...sourceHistory(row), futureReader], promotions: [promotion(contract, row)] },
    NOW,
    [contract],
    READER_BUILD,
  ).contracts[0];

  assert.equal(observed.canonicalPromotion.kind, "MEASURED");
  assert.equal(observed.readerVisible.kind, "UNKNOWN");
  assert.equal(observed.cadence.operationalState, "UNKNOWN");
});

test("PDC-13: Reader delivery UNKNOWN is surfaced separately from fresh source data", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const row = candidateRow(contract, { id: "fresh-source-reader-unknown", at: "2026-09-08T01:00:00.000Z" });
  const view = projectRoutineDataObservability(
    { candidates: [row], events: sourceHistory(row), promotions: [promotion(contract, row)] },
    NOW,
    [contract],
    READER_BUILD,
  );

  assert.equal(view.contracts[0].cadence.freshness, "FRESH");
  assert.equal(view.contracts[0].cadence.operationalState, "UNKNOWN");
  assert.equal(countValue(view.summary.unknown), 0, "canonical freshness itself is known");
  assert.equal(countValue(view.summary.operationalUnknown), 1, "the actionable delivery gap is visible at summary level");
  assert.equal(countValue(view.summary.readerNotRecorded), 1);
  assert.equal(countValue(view.summary.readerVisible), 0);
  assert.deepEqual(view.summary.operationalUnknown.members.map((item) => item.contractId), [contract.id]);
});

test("PDC-13: future source evidence cannot become a latest attempt, exact count, or retry clock", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const lkg = candidateRow(contract, { id: "present-lkg", at: "2026-09-08T01:00:00.000Z" });
  const future = candidateRow(contract, {
    id: "future-refusal",
    at: "2026-09-08T13:00:00.000Z",
    state: "SOURCE_BLOCKED",
    acquisitionSucceeded: false,
    receipt: validationReceipt(contract, "future-refusal", "2026-09-08T13:00:00.000Z", "FAIL"),
    promotedVersionId: null,
    lastKnownGoodVersionId: lkg.id,
    failureCode: "FUTURE_FAILURE",
    failureDetail: "This evidence has not happened yet.",
  });
  const view = projectRoutineDataObservability(
    {
      candidates: [lkg, future],
      events: [...sourceHistory(lkg), ...sourceHistory(future)],
      promotions: [promotion(contract, lkg)],
    },
    NOW,
    [contract],
  );
  const observed = view.contracts[0];

  assert.equal(observed.canonicalPromotion.kind, "MEASURED", "unrelated future attempt evidence does not erase the valid pointer");
  assert.equal(observed.currentState.kind, "UNKNOWN");
  assert.equal(observed.lastAttemptedAcquisition.kind, "UNKNOWN");
  assert.equal(observed.lastValidation.kind, "UNKNOWN");
  assert.equal(observed.latestChanges.kind, "UNKNOWN");
  assert.equal(observed.cadence.nextDue.kind, "UNKNOWN");
  assert.equal(observed.cadence.operationalState, "UNKNOWN");
  assert.equal(observed.histories["24h"].counts.attempts.kind, "UNKNOWN");
  assert.equal(observed.histories["24h"].counts.refused.kind, "UNKNOWN");
  assert.equal(countValue(view.summary.operationalUnknown), 1);
});

test("PDC-13: a future adapter timestamp is a contained refusal on the local attempt clock", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const lkg = candidateRow(contract, { id: "future-time-lkg", at: "2026-09-08T01:00:00.000Z" });
  const candidateId = "future-time-contained-refusal";
  const localAttemptAt = "2026-09-08T11:30:00.000Z";
  const untrustedFutureAt = "2026-09-08T13:00:00.000Z";
  const failureDetail = `The acquisition instant ${untrustedFutureAt} is later than validation ${localAttemptAt}.`;
  const receipt: ValidationReceipt = {
    ...validationReceipt(contract, candidateId, localAttemptAt),
    decision: "FAIL",
    checks: VALIDATION_CHECKS.map((check) => check === "TEMPORAL_VALIDITY" ? {
      check,
      verdict: "FAIL" as const,
      code: "ACQUISITION_TIME_AFTER_VALIDATION",
      detail: failureDetail,
    } : {
      check,
      verdict: "PASS" as const,
      code: `${check}_PASS`,
      detail: `${check} passed.`,
    }),
  };
  const refused = candidateRow(contract, {
    id: candidateId,
    at: untrustedFutureAt,
    state: "TEMPORAL_INVALID",
    receipt,
    promotedVersionId: null,
    lastKnownGoodVersionId: lkg.id,
    failureCode: "ACQUISITION_TIME_AFTER_VALIDATION",
    failureDetail,
  });
  const refusedEvents: RoutineCandidateEventRow[] = [
    { id: `${candidateId}:1`, candidateId, sequence: 1, state: "FETCHED", at: localAttemptAt, detail: "Acquired untrusted source envelope." },
    { id: `${candidateId}:2`, candidateId, sequence: 2, state: "NORMALIZED", at: localAttemptAt, detail: "Normalized source envelope." },
    { id: `${candidateId}:3`, candidateId, sequence: 3, state: "TEMPORAL_INVALID", at: localAttemptAt, detail: failureDetail },
  ];
  const view = projectRoutineDataObservability(
    {
      candidates: [lkg, refused],
      events: [...sourceHistory(lkg), ...refusedEvents],
      promotions: [promotion(contract, lkg)],
    },
    NOW,
    [contract],
  );
  const observed = view.contracts[0];

  assert.equal(observed.currentState.kind, "MEASURED");
  if (observed.currentState.kind === "MEASURED") assert.equal(observed.currentState.value, "TEMPORAL_INVALID");
  assert.deepEqual(observed.lastAttemptedAcquisition, { kind: "MEASURED", value: localAttemptAt });
  assert.deepEqual(observed.lastSuccessfulAcquisition, { kind: "MEASURED", value: lkg.retrievedAt });
  assert.deepEqual(observed.lastValidation, { kind: "MEASURED", value: localAttemptAt });
  assert.equal(observed.cadence.operationalState, "RETRYING");
  assert.equal(observed.cadence.nextDue.kind, "MEASURED");
  assert.equal(observed.lkg.kind, "MEASURED");
  if (observed.lkg.kind === "MEASURED") assert.equal(observed.lkg.value.state, "SERVING_AFTER_LATER_ATTEMPT");
  assert.equal(observed.latestRefused.kind, "MEASURED");
  if (observed.latestRefused.kind === "MEASURED") {
    assert.equal(observed.latestRefused.value[0]?.code, "ACQUISITION_TIME_AFTER_VALIDATION");
    assert.equal(observed.latestRefused.value[0]?.attemptedAt, localAttemptAt);
  }
  const history = observed.histories["24h"];
  assert.equal(history.counts.attempts.kind, "MEASURED");
  assert.equal(history.counts.refused.kind, "MEASURED");
  assert.equal(history.counts.refused.value, 1);
  assert.equal(history.counts.successfulAcquisitions.kind, "UNKNOWN", "the untrusted timestamp is never counted as authenticated acquisition success");
});

test("PDC-13: a future validation receipt cannot manufacture a contained refusal", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const refused = candidateRow(contract, {
    id: "future-validation",
    at: "2026-09-08T11:00:00.000Z",
    state: "SEMANTIC_INVALID",
    receipt: validationReceipt(contract, "future-validation", "2026-09-08T13:00:00.000Z", "FAIL"),
    promotedVersionId: null,
    lastKnownGoodVersionId: null,
  });
  const observed = projectRoutineDataObservability(
    { candidates: [refused], events: sourceHistory(refused), promotions: [] },
    NOW,
    [contract],
  ).contracts[0];

  assert.equal(observed.latestRefused.kind, "UNKNOWN");
  assert.equal(observed.lastValidation.kind, "UNKNOWN");
  assert.equal(observed.cadence.operationalState, "UNKNOWN");
  assert.equal(observed.histories["24h"].counts.refused.kind, "UNKNOWN");
});

test("PDC-13: contradictory acquisition scalars cannot report source success or a contained failure", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const base = candidateRow(contract, {
    id: "contradictory-acquisition",
    at: "2026-09-08T11:00:00.000Z",
    state: "SOURCE_BLOCKED",
    acquisitionSucceeded: false,
    receipt: validationReceipt(contract, "contradictory-acquisition", "2026-09-08T11:00:00.000Z", "FAIL"),
    promotedVersionId: null,
    lastKnownGoodVersionId: null,
    failureCode: "SOURCE_BLOCKED",
    failureDetail: "The durable row and candidate envelope disagree.",
  });
  const contradictory = {
    ...base,
    candidate: {
      ...(base.candidate as Record<string, unknown>),
      retrieval: { succeeded: true, retrievedAt: base.retrievedAt },
    },
  };
  const observed = projectRoutineDataObservability(
    { candidates: [contradictory], events: sourceHistory(contradictory), promotions: [] },
    NOW,
    [contract],
  ).contracts[0];

  assert.equal(observed.lastSuccessfulAcquisition.kind, "UNKNOWN");
  assert.equal(observed.cadence.operationalState, "UNKNOWN");
  assert.equal(observed.histories["24h"].attempts[0].acquisitionSucceeded.kind, "UNKNOWN");
  assert.equal(observed.histories["24h"].counts.successfulAcquisitions.kind, "UNKNOWN");
  assert.equal(observed.histories["24h"].counts.refused.kind, "UNKNOWN");
});

test("PDC-13: malformed authority-transfer evidence cannot masquerade as live-source success", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const base = candidateRow(contract, { id: "malformed-authority-origin", at: "2026-09-08T11:15:00.000Z" });
  const malformed = {
    ...base,
    candidate: {
      ...(base.candidate as Record<string, unknown>),
      bootstrapImport: null,
    },
  };
  const observed = projectRoutineDataObservability(
    {
      candidates: [malformed],
      events: sourceHistory(malformed),
      promotions: [promotion(contract, malformed)],
    },
    NOW,
    [contract],
    READER_BUILD,
  ).contracts[0];

  assert.equal(observed.lastSuccessfulAcquisition.kind, "UNKNOWN");
  assert.equal(observed.canonicalPromotion.kind, "UNKNOWN");
  assert.equal(observed.cadence.operationalState, "UNKNOWN");
  assert.equal(observed.cadence.nextDue.kind, "UNKNOWN");
  assert.equal(observed.histories["24h"].counts.successfulAcquisitions.kind, "UNKNOWN");
});

test("PDC-13: older uncertain authority evidence does not hide a later proven source attempt", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const lkg = candidateRow(contract, { id: "known-source-success", at: "2026-09-08T08:00:00.000Z" });
  const uncertainBase = candidateRow(contract, {
    id: "uncertain-middle-acquisition",
    at: "2026-09-08T09:00:00.000Z",
    state: "NORMALIZED",
    receipt: null,
    promotedVersionId: null,
    lastKnownGoodVersionId: lkg.id,
  });
  const uncertain = {
    ...uncertainBase,
    candidate: { ...(uncertainBase.candidate as Record<string, unknown>), bootstrapImport: null },
  };
  const latestFailure = candidateRow(contract, {
    id: "known-latest-source-failure",
    at: "2026-09-08T11:00:00.000Z",
    state: "SOURCE_BLOCKED",
    acquisitionSucceeded: false,
    receipt: validationReceipt(contract, "known-latest-source-failure", "2026-09-08T11:00:00.000Z", "FAIL"),
    promotedVersionId: null,
    lastKnownGoodVersionId: lkg.id,
    failureCode: "SOURCE_BLOCKED",
    failureDetail: "The later source attempt is proven.",
  });
  const observed = projectRoutineDataObservability(
    {
      candidates: [lkg, uncertain, latestFailure],
      events: [...sourceHistory(lkg), ...sourceHistory(uncertain), ...sourceHistory(latestFailure)],
      promotions: [promotion(contract, lkg)],
    },
    NOW,
    [contract],
  ).contracts[0];

  assert.equal(observed.lastAttemptedAcquisition.kind, "MEASURED");
  if (observed.lastAttemptedAcquisition.kind === "MEASURED") {
    assert.equal(observed.lastAttemptedAcquisition.value, latestFailure.retrievedAt);
  }
  assert.equal(observed.lastSuccessfulAcquisition.kind, "UNKNOWN", "the uncertain successful middle row can still affect last success");
});

test("PDC-13: a PROMOTED candidate row without atomic event never masquerades as an outcome", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const row = candidateRow(contract, { id: "row-only-promotion", at: "2026-09-08T02:00:00.000Z" });
  const history = projectRoutineDataObservability(
    { candidates: [row], events: [], promotions: [] },
    NOW,
    [contract],
  ).contracts[0].histories["24h"];

  assert.equal(history.attempts[0].canonicalOutcome.kind, "NOT_RECORDED");
  assert.equal(history.counts.promotions.kind, "UNKNOWN", "the terminal row/event contradiction prevents a false measured zero");
  assert.equal(history.counts.changedOutcomes.kind, "UNKNOWN");
});

test("PDC-13: a terminal candidate row without its append-only event is UNKNOWN, not retrying", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const refused = candidateRow(contract, {
    id: "terminal-row-without-event",
    at: "2026-09-08T11:00:00.000Z",
    state: "SOURCE_BLOCKED",
    acquisitionSucceeded: false,
    receipt: validationReceipt(contract, "terminal-row-without-event", "2026-09-08T11:00:00.000Z", "FAIL"),
    promotedVersionId: null,
    lastKnownGoodVersionId: null,
    failureCode: "SOURCE_BLOCKED",
    failureDetail: "A row without its atomic event is torn evidence.",
  });
  const observed = projectRoutineDataObservability(
    { candidates: [refused], events: [], promotions: [] },
    NOW,
    [contract],
  ).contracts[0];

  assert.equal(observed.cadence.operationalState, "UNKNOWN");
  assert.match(observed.cadence.operationalDetail, /no append-only source-state event/i);
  assert.equal(observed.histories["24h"].counts.refused.kind, "UNKNOWN");
});

test("PDC-13: a terminal event cannot be revived into a nonterminal state on the same candidate", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const revived = candidateRow(contract, {
    id: "revived-terminal-candidate",
    at: "2026-09-08T11:00:00.000Z",
    state: "NORMALIZED",
    receipt: null,
    promotedVersionId: null,
    lastKnownGoodVersionId: null,
  });
  const refusedFirst: RoutineCandidateEventRow = {
    id: "event-revived-terminal-candidate-1",
    candidateId: revived.id,
    sequence: 1,
    state: "SOURCE_BLOCKED",
    at: revived.retrievedAt,
    detail: "This terminal refusal must remain terminal.",
  };
  const normalizedLater = event(revived, 2);
  const observed = projectRoutineDataObservability(
    { candidates: [revived], events: [refusedFirst, normalizedLater], promotions: [] },
    NOW,
    [contract],
  ).contracts[0];

  assert.equal(observed.cadence.operationalState, "UNKNOWN");
  assert.match(
    observed.cadence.operationalDetail,
    /illegal adjacent source-state transition SOURCE_BLOCKED -> NORMALIZED/,
  );
  assert.equal(observed.histories["24h"].counts.refused.kind, "UNKNOWN");
});

test("PDC-13: a historical promotion event must follow its own source-scoped evidence", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const row = candidateRow(contract, { id: "misordered-historical-promotion", at: "2026-09-08T02:00:00.000Z" });
  const complete = sourceHistory(row);
  const beforeAcquisition = { ...complete.at(-1)!, at: "2026-09-08T01:59:59.000Z" };
  const history = projectRoutineDataObservability(
    { candidates: [row], events: [...complete.slice(0, -1), beforeAcquisition], promotions: [] },
    NOW,
    [contract],
  ).contracts[0].histories["24h"];

  assert.equal(history.attempts[0].canonicalOutcome.kind, "UNKNOWN");
  assert.equal(history.counts.promotions.kind, "UNKNOWN");
  assert.equal(history.counts.unchangedOutcomes.kind, "UNKNOWN");
});

test("PDC-13: tied latest attempts cannot be ordered by UUID or database return order", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const at = "2026-09-08T03:00:00.000Z";
  const lkg = candidateRow(contract, { id: "a-current-lkg", at });
  const refused = candidateRow(contract, {
    id: "z-same-instant-refusal",
    at,
    state: "SOURCE_BLOCKED",
    acquisitionSucceeded: false,
    receipt: validationReceipt(contract, "z-same-instant-refusal", at, "FAIL"),
    promotedVersionId: null,
    lastKnownGoodVersionId: lkg.id,
    failureCode: "SOURCE_BLOCKED",
    failureDetail: "Same-instant outcome has no causal tie-breaker.",
  });
  const view = projectRoutineDataObservability(
    {
      candidates: [lkg, refused],
      events: [...sourceHistory(lkg), ...sourceHistory(refused)],
      promotions: [promotion(contract, lkg)],
    },
    NOW,
    [contract],
  );
  const observed = view.contracts[0];

  assert.equal(observed.canonicalPromotion.kind, "MEASURED");
  assert.equal(observed.currentState.kind, "UNKNOWN");
  assert.equal(observed.latestCanonicalOutcome.kind, "UNKNOWN");
  assert.equal(observed.latestRefused.kind, "UNKNOWN");
  assert.equal(observed.lkg.kind, "UNKNOWN");
  assert.equal(observed.cadence.nextDue.kind, "UNKNOWN");
  assert.equal(observed.cadence.operationalState, "UNKNOWN");
  assert.equal(countValue(view.summary.healthy), 0);
  assert.equal(countValue(view.summary.operationalUnknown), 1);
});

test("PDC-13: one source refusal cannot alter another source's Admin disposition", () => {
  const fec = ROUTINE_SOURCE_CONTRACTS.find((contract) => contract.id === "fec-funding")!;
  const nh = ROUTINE_SOURCE_CONTRACTS.find((contract) => contract.id === "nh-members")!;
  const fecLkg = candidateRow(fec, { id: "fec-isolated-lkg", at: "2026-09-07T00:00:00.000Z" });
  const fecFailure = candidateRow(fec, {
    id: "fec-isolated-failure",
    at: "2026-09-08T11:00:00.000Z",
    state: "SOURCE_BLOCKED",
    acquisitionSucceeded: false,
    receipt: validationReceipt(fec, "fec-isolated-failure", "2026-09-08T11:00:00.000Z", "FAIL"),
    promotedVersionId: null,
    lastKnownGoodVersionId: fecLkg.id,
    failureCode: "FEC_SOURCE_BLOCKED",
    failureDetail: "Only the FEC source was unavailable.",
  });
  const nhGood = candidateRow(nh, { id: "nh-unaffected-good", at: "2026-09-08T10:00:00.000Z" });
  const view = projectRoutineDataObservability(
    {
      candidates: [fecLkg, fecFailure, nhGood],
      events: [
        ...sourceHistory(fecLkg),
        readerEvent(fec, fecLkg),
        ...sourceHistory(fecFailure),
        ...sourceHistory(nhGood),
        readerEvent(nh, nhGood),
      ],
      promotions: [promotion(fec, fecLkg), promotion(nh, nhGood)],
    },
    NOW,
    [fec, nh],
    READER_BUILD,
  );
  const fecObserved = view.contracts.find((contract) => contract.contractId === fec.id)!;
  const nhObserved = view.contracts.find((contract) => contract.contractId === nh.id)!;

  assert.equal(fecObserved.cadence.operationalState, "RETRYING");
  assert.equal(fecObserved.lkg.kind, "MEASURED");
  assert.equal(nhObserved.canonicalPromotion.kind, "MEASURED");
  assert.equal(nhObserved.readerVisible.kind, "MEASURED");
  assert.equal(nhObserved.cadence.operationalState, "HEALTHY");
  assert.deepEqual(view.summary.retrying.members.map((member) => member.contractId), [fec.id]);
  assert.deepEqual(view.summary.healthy.members.map((member) => member.contractId), [nh.id]);
});

test("PDC-13: a later source-state event invalidates only that candidate's pointer proof", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const row = candidateRow(contract, { id: "post-promotion-source-event", at: "2026-09-08T04:00:00.000Z" });
  const laterSourceEvent: RoutineCandidateEventRow = {
    id: "event-after-promotion",
    candidateId: row.id,
    sequence: 5,
    state: "SOURCE_BLOCKED",
    at: "2026-09-08T04:01:00.000Z",
    detail: "A source-state event appeared after atomic promotion.",
  };
  const observed = projectRoutineDataObservability(
    { candidates: [row], events: [...sourceHistory(row), laterSourceEvent], promotions: [promotion(contract, row)] },
    NOW,
    [contract],
  ).contracts[0];

  assert.equal(observed.canonicalPromotion.kind, "UNKNOWN");
  assert.equal(observed.cadence.operationalState, "UNKNOWN");
});

test("PDC-13: Reader repair ordering uses append-only sequence without corrupting source promotion", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const row = candidateRow(contract, { id: "reader-sequence-order", at: "2026-09-08T04:00:00.000Z" });
  const pass = readerEvent(contract, row, 5);
  const failBase = readerEvent(contract, row, 6);
  const parsed = JSON.parse(failBase.detail.slice(READER_PROJECTION_READBACK_PREFIX.length)) as Record<string, unknown>;
  const failedLaterSequence: RoutineCandidateEventRow = {
    ...failBase,
    at: "2026-09-08T03:59:00.000Z",
    detail: `${READER_PROJECTION_READBACK_PREFIX}${JSON.stringify({
      ...parsed,
      observedAt: "2026-09-08T03:59:00.000Z",
      status: "FAIL",
      detail: "A later sequence cannot move backward in time.",
    })}`,
  };
  const view = projectRoutineDataObservability(
    {
      candidates: [row],
      events: [...sourceHistory(row), pass, failedLaterSequence],
      promotions: [promotion(contract, row)],
    },
    NOW,
    [contract],
    READER_BUILD,
  );

  assert.equal(view.contracts[0].canonicalPromotion.kind, "MEASURED", "Reader evidence is not a source-disposition authority");
  assert.equal(view.contracts[0].readerVisible.kind, "UNKNOWN");
  assert.equal(view.contracts[0].cadence.operationalState, "UNKNOWN");
  assert.equal(countValue(view.summary.readerUnknown), 1);
});

test("PDC-13: a gap before Reader readback fails delivery closed without changing source disposition", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const row = candidateRow(contract, { id: "reader-sequence-gap", at: "2026-09-08T04:10:00.000Z" });
  const observed = projectRoutineDataObservability(
    {
      candidates: [row],
      events: [...sourceHistory(row), readerEvent(contract, row, 6)],
      promotions: [promotion(contract, row)],
    },
    NOW,
    [contract],
    READER_BUILD,
  ).contracts[0];

  assert.equal(observed.canonicalPromotion.kind, "MEASURED", "Reader history cannot reclassify source promotion");
  assert.equal(observed.readerVisible.kind, "UNKNOWN");
  if (observed.readerVisible.kind === "UNKNOWN") assert.match(observed.readerVisible.detail, /gap/i);
  assert.equal(observed.cadence.operationalState, "UNKNOWN");
});

test("PDC-13: a later retired Reader receipt cannot be hidden behind an older V2 PASS", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const row = candidateRow(contract, { id: "reader-retired-receipt-order", at: "2026-09-08T04:15:00.000Z" });
  const retiredLater: RoutineCandidateEventRow = {
    id: "legacy-reader-event-after-v2",
    candidateId: row.id,
    sequence: 6,
    state: "PROMOTED",
    at: "2026-09-08T04:16:00.000Z",
    detail: "READER_PROJECTION_READBACK_V1 {\"status\":\"PASS\"}",
  };
  const observed = projectRoutineDataObservability(
    {
      candidates: [row],
      events: [...sourceHistory(row), readerEvent(contract, row, 5), retiredLater],
      promotions: [promotion(contract, row)],
    },
    NOW,
    [contract],
    READER_BUILD,
  ).contracts[0];

  assert.equal(observed.canonicalPromotion.kind, "MEASURED", "Reader history remains outside source authority");
  assert.equal(observed.readerVisible.kind, "UNKNOWN", "latest Reader evidence uses a retired/unreadable contract");
  assert.equal(observed.cadence.operationalState, "UNKNOWN");
});

test("PDC-13: Reader evidence cannot become a source refusal even if its event state is malformed", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const row = candidateRow(contract, { id: "reader-cannot-author-source-refusal", at: "2026-09-08T04:30:00.000Z" });
  const malformedReaderState: RoutineCandidateEventRow = {
    ...readerEvent(contract, row),
    state: "CANNOT_TELL",
  };
  const observed = projectRoutineDataObservability(
    {
      candidates: [row],
      events: [...sourceHistory(row), malformedReaderState],
      promotions: [promotion(contract, row)],
    },
    NOW,
    [contract],
    READER_BUILD,
  ).contracts[0];

  assert.equal(observed.canonicalPromotion.kind, "MEASURED", "Reader evidence has no source-disposition authority");
  assert.equal(observed.readerVisible.kind, "UNKNOWN");
  assert.equal(observed.histories["24h"].counts.promotions.kind, "MEASURED");
  assert.equal(observed.histories["24h"].counts.refused.kind, "MEASURED");
  assert.equal(observed.histories["24h"].counts.refused.members.length, 0);
});

test("PDC-13: an unrecognised source event cannot coexist with a healthy canonical pointer", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const row = candidateRow(contract, { id: "unrecognised-source-event", at: "2026-09-08T04:45:00.000Z" });
  const unknownSourceEvent: RoutineCandidateEventRow = {
    id: "event-unrecognised-source-state",
    candidateId: row.id,
    sequence: 5,
    state: "UNRECOGNISED_SOURCE_STATE",
    at: "2026-09-08T04:45:00.000Z",
    detail: "A corrupted source-state event must fail closed.",
  };
  const observed = projectRoutineDataObservability(
    {
      candidates: [row],
      events: [...sourceHistory(row), unknownSourceEvent],
      promotions: [promotion(contract, row)],
    },
    NOW,
    [contract],
    READER_BUILD,
  ).contracts[0];

  assert.equal(observed.canonicalPromotion.kind, "UNKNOWN");
  assert.equal(observed.cadence.operationalState, "UNKNOWN");
  assert.equal(observed.histories["24h"].counts.promotions.kind, "UNKNOWN");
});

test("PDC-13: a durable failed typed Reader readback is UNKNOWN, never false health", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const row = candidateRow(contract, { id: "fec-reader-failed", at: "2026-09-08T00:45:00.000Z" });
  const failedReader = readerEvent(contract, row);
  const parsed = JSON.parse(failedReader.detail.slice(READER_PROJECTION_READBACK_PREFIX.length)) as Record<string, unknown>;
  const failedEvent = {
    ...failedReader,
    detail: `${READER_PROJECTION_READBACK_PREFIX}${JSON.stringify({
      ...parsed,
      status: "FAIL",
      detail: "The typed funding Reader rejected the promoted payload.",
    })}`,
  };
  const observed = projectRoutineDataObservability(
    { candidates: [row], events: [...sourceHistory(row), failedEvent], promotions: [promotion(contract, row)] },
    NOW,
    [contract],
  ).contracts[0];

  assert.equal(observed.canonicalPromotion.kind, "MEASURED", "the source promotion remains canonical");
  assert.equal(observed.currentState.kind, "MEASURED");
  assert.equal(observed.readerVisible.kind, "UNKNOWN", "failed delivery is not Reader-visible");
  assert.equal(observed.cadence.operationalState, "UNKNOWN", "Admin must not call the source healthy while delivery proof is failed");
  assert.match(observed.cadence.operationalDetail, /source promotion remains canonical.*typed Reader read-model proof is UNKNOWN/i);
});

test("PDC-13: an old typed Reader PASS cannot certify a later deployed Reader version", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const row = candidateRow(contract, { id: "fec-reader-code-drift", at: "2026-09-08T00:47:00.000Z" });
  const view = projectRoutineDataObservability(
    { candidates: [row], events: [...sourceHistory(row), readerEvent(contract, row)], promotions: [promotion(contract, row)] },
    NOW,
    [contract],
    { ...READER_BUILD, codeSha: LATER_READER_CODE_SHA },
  );
  const observed = view.contracts[0];

  assert.equal(observed.canonicalPromotion.kind, "MEASURED", "the data-plane pointer remains canonical");
  assert.equal(observed.readerVisible.kind, "UNKNOWN", "an earlier code version cannot prove current delivery");
  assert.equal(observed.cadence.operationalState, "UNKNOWN");
  assert.equal(countValue(view.summary.healthy), 0);
  if (observed.readerVisible.kind === "UNKNOWN") {
    assert.match(observed.readerVisible.detail, new RegExp(`${READER_CODE_SHA}.*${LATER_READER_CODE_SHA}`));
  }
});

test("PDC-13: a manual promotion also requires durable typed Reader proof before Admin can call it healthy", () => {
  const contract = MANUAL_PRODUCTION_SOURCE_CONTRACTS.find((item) => item.id === "congress-bulk-roster")!;
  const row = candidateRow(contract, { id: "manual-directory-v1", at: "2026-09-08T00:50:00.000Z" });
  const withoutReadback = projectRoutineDataObservability(
    { candidates: [row], events: sourceHistory(row), promotions: [promotion(contract, row)] },
    NOW,
    [contract],
    READER_BUILD,
  ).contracts[0];
  assert.equal(withoutReadback.canonicalPromotion.kind, "MEASURED");
  assert.equal(withoutReadback.readerVisible.kind, "NOT_RECORDED");
  assert.equal(withoutReadback.cadence.operationalState, "UNKNOWN");

  const withReadback = projectRoutineDataObservability(
    { candidates: [row], events: [...sourceHistory(row), readerEvent(contract, row)], promotions: [promotion(contract, row)] },
    NOW,
    [contract],
    READER_BUILD,
  ).contracts[0];
  assert.equal(withReadback.readerVisible.kind, "MEASURED");
  assert.equal(withReadback.cadence.operationalState, "HEALTHY");
  assert.match(withReadback.cadence.operationalDetail, /deployed-code typed Reader read model is proven/i);
});

test("PDC-13: a Reader PASS cannot be current when the deployed code identity is unavailable", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const row = candidateRow(contract, { id: "fec-reader-build-unknown", at: "2026-09-08T00:55:00.000Z" });
  const observed = projectRoutineDataObservability(
    { candidates: [row], events: [...sourceHistory(row), readerEvent(contract, row)], promotions: [promotion(contract, row)] },
    NOW,
    [contract],
  ).contracts[0];

  assert.equal(observed.readerVisible.kind, "UNKNOWN");
  assert.equal(observed.cadence.operationalState, "UNKNOWN");
  if (observed.readerVisible.kind === "UNKNOWN") assert.match(observed.readerVisible.detail, /Reader build .*not recorded/i);
});

test("PDC-13: a feature/preview build cannot certify production Reader visibility", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const row = candidateRow(contract, { id: "fec-reader-feature-build", at: "2026-09-08T00:57:00.000Z" });
  for (const currentReaderBuild of [
    { codeSha: READER_CODE_SHA, branch: "feature/pdc", context: "production" },
    { codeSha: READER_CODE_SHA, branch: "main", context: "deploy-preview" },
  ]) {
    const observed = projectRoutineDataObservability(
      { candidates: [row], events: [...sourceHistory(row), readerEvent(contract, row)], promotions: [promotion(contract, row)] },
      NOW,
      [contract],
      currentReaderBuild,
    ).contracts[0];
    assert.equal(observed.readerVisible.kind, "UNKNOWN");
    assert.equal(observed.cadence.operationalState, "UNKNOWN");
  }
});

test("PDC-13: receipt-held records retain their exact key and record payload", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS.find((item) => item.id === "nj-morris-filing")!;
  const base = validationReceipt(contract, "nj-held", "2026-09-08T02:00:00.000Z");
  const heldReceipt: ValidationReceipt = {
    ...base,
    excludedFacts: [
      {
        key: "candidacy:nj-candidate-7",
        code: "CONTACT_IDENTITY_HELD",
        detail: "The filing contact could not be matched to one exact candidacy.",
        record: { filedName: "Held Candidate", email: "held@example.test" },
      },
      {
        key: "candidacy:nj-candidate-8",
        code: "CONTACT_IDENTITY_HELD",
        detail: "The filing contact could not be matched to one exact candidacy.",
        record: { filedName: "Second Held Candidate", email: "second@example.test" },
      },
    ],
  };
  const row = candidateRow(contract, {
    id: "nj-held",
    at: "2026-09-08T02:00:00.000Z",
    receipt: heldReceipt,
    changeSet: changes(),
  });
  const view = projectRoutineDataObservability(
    { candidates: [row], events: sourceHistory(row), promotions: [promotion(contract, row)] },
    NOW,
    [contract],
  );
  const held = view.contracts[0].latestHeld;
  assert.equal(held.kind, "MEASURED");
  if (held.kind === "MEASURED") {
    assert.equal(held.value.length, 2, "equal reasons on two exact records must not be deduplicated");
    assert.deepEqual(held.value.map((item) => item.key), ["candidacy:nj-candidate-7", "candidacy:nj-candidate-8"]);
    assert.deepEqual(held.value[0].record, { filedName: "Held Candidate", email: "held@example.test" });
  }
});

test("PDC-13: a contract without a Reader projection is never labeled Reader-visible", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS.find((item) => item.id === "dotgov")!;
  const row = candidateRow(contract, { id: "dotgov-v1", at: "2026-09-08T01:00:00.000Z" });
  const view = projectRoutineDataObservability(
    { candidates: [row], events: sourceHistory(row), promotions: [promotion(contract, row)] },
    NOW,
    [contract],
  );
  assert.equal(view.contracts[0].canonicalPromotion.kind, "MEASURED");
  assert.equal(view.contracts[0].readerVisible.kind, "NOT_APPLICABLE");
});

test("PDC-13: a broken pointer proof makes canonical and Reader visibility UNKNOWN", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const row = candidateRow(contract, {
    id: "fec-bad-pointer",
    at: "2026-09-08T01:00:00.000Z",
    promotedVersionId: "a-different-version",
  });
  const view = projectRoutineDataObservability(
    { candidates: [row], events: sourceHistory(row), promotions: [promotion(contract, row)] },
    NOW,
    [contract],
  );
  assert.equal(view.contracts[0].canonicalPromotion.kind, "UNKNOWN");
  if (view.contracts[0].canonicalPromotion.kind === "UNKNOWN") {
    assert.match(view.contracts[0].canonicalPromotion.detail, /canonical source promotion pointer proof failed/i);
    assert.doesNotMatch(view.contracts[0].canonicalPromotion.detail, /Reader pointer proof failed/i);
  }
  assert.equal(view.contracts[0].readerVisible.kind, "UNKNOWN");
  assert.equal(view.contracts[0].sourceThrough.kind, "UNKNOWN");
  assert.equal(view.contracts[0].latestCanonicalOutcome.kind, "UNKNOWN");
  assert.equal(countValue(view.summary.latestOutcomeNotRecorded), 0);
  assert.equal(countValue(view.summary.latestOutcomeUnknown), 1);
});

test("PDC-13: pointer payload drift is UNKNOWN even when an older typed Reader PASS receipt exists", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const row = candidateRow(contract, {
    id: "fec-payload-drift",
    at: "2026-09-08T01:00:00.000Z",
  });
  const pointer = { ...promotion(contract, row), payload: { candidateId: "different-payload" } };
  const view = projectRoutineDataObservability(
    { candidates: [row], events: [...sourceHistory(row), readerEvent(contract, row)], promotions: [pointer] },
    NOW,
    [contract],
  );
  const observed = view.contracts[0];
  assert.equal(observed.canonicalPromotion.kind, "UNKNOWN");
  assert.equal(observed.readerVisible.kind, "UNKNOWN");
  assert.equal(observed.cadence.operationalState, "UNKNOWN");
  assert.equal(countValue(view.summary.healthy), 0);
});

test("PDC-13: pointer or candidate LKG drift cannot remain canonical, Reader-visible, or healthy", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const base = candidateRow(contract, {
    id: "fec-lkg-drift",
    at: "2026-09-08T01:00:00.000Z",
  });
  const cases = [
    {
      name: "pointer",
      row: base,
      pointer: { ...promotion(contract, base), lastKnownGoodVersionId: "different-lkg" },
    },
    {
      name: "candidate",
      row: { ...base, lastKnownGoodVersionId: "different-lkg" },
      pointer: promotion(contract, base),
    },
  ] as const;
  for (const item of cases) {
    const view = projectRoutineDataObservability(
      { candidates: [item.row], events: [...sourceHistory(item.row), readerEvent(contract, item.row)], promotions: [item.pointer] },
      NOW,
      [contract],
    );
    const observed = view.contracts[0];
    assert.equal(observed.canonicalPromotion.kind, "UNKNOWN", `${item.name} LKG drift`);
    assert.equal(observed.readerVisible.kind, "UNKNOWN", `${item.name} LKG drift`);
    assert.equal(observed.cadence.operationalState, "UNKNOWN", `${item.name} LKG drift`);
    assert.equal(countValue(view.summary.healthy), 0, `${item.name} LKG drift`);
  }
});

test("PDC-13: contradictory durable evidence becomes UNKNOWN instead of a false zero", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const contradictoryReceipt = candidateRow(contract, {
    id: "fec-contradictory-receipt",
    at: "2026-09-08T03:00:00.000Z",
    state: "SOURCE_BLOCKED",
    receipt: validationReceipt(contract, "fec-contradictory-receipt", "2026-09-08T03:00:00.000Z", "GOOD"),
  });
  const contradiction = projectRoutineDataObservability(
    { candidates: [contradictoryReceipt], events: [event(contradictoryReceipt)], promotions: [] },
    NOW,
    [contract],
  ).contracts[0];
  assert.equal(contradiction.latestRefused.kind, "UNKNOWN");

  const contradictoryChanges = candidateRow(contract, {
    id: "fec-contradictory-changes",
    at: "2026-09-08T04:00:00.000Z",
    changeSet: changes({ outcome: "CHANGED" }),
  });
  const changedView = projectRoutineDataObservability(
    {
      candidates: [contradictoryChanges],
      events: sourceHistory(contradictoryChanges),
      promotions: [promotion(contract, contradictoryChanges)],
    },
    NOW,
    [contract],
  ).contracts[0];
  assert.equal(changedView.latestChanges.kind, "UNKNOWN");
  assert.equal(changedView.latestCanonicalOutcome.kind, "UNKNOWN");

  const refused = candidateRow(contract, {
    id: "fec-misdated-event",
    at: "2026-09-08T05:00:00.000Z",
    state: "SOURCE_BLOCKED",
    receipt: validationReceipt(contract, "fec-misdated-event", "2026-09-08T05:00:00.000Z", "FAIL"),
  });
  const outsideWindowEvent = { ...event(refused), at: "2026-09-01T05:00:00.000Z" };
  const history = projectRoutineDataObservability(
    { candidates: [refused], events: [outsideWindowEvent], promotions: [] },
    NOW,
    [contract],
  ).contracts[0].histories["24h"];
  assert.equal(history.counts.refused.kind, "UNKNOWN");
});

test("PDC-13: a later refusal leaves the proven LKG serving with exact held and refused reasons", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const lkg = candidateRow(contract, { id: "fec-lkg", at: "2026-09-01T12:00:00.000Z" });
  const refusedReceipt = validationReceipt(contract, "fec-refused", "2026-09-08T11:00:00.000Z", "FAIL");
  const refused = candidateRow(contract, {
    id: "fec-refused",
    at: "2026-09-08T11:00:00.000Z",
    state: "SOURCE_BLOCKED",
    acquisitionSucceeded: false,
    receipt: refusedReceipt,
    promotedVersionId: null,
    lastKnownGoodVersionId: lkg.id,
    failureCode: "SOURCE_AUTHENTICITY_FAIL",
    failureDetail: "The official route could not be acquired.",
    changeSet: changes({
      outcome: "CHANGED",
      added: [{ key: "unpromoted", before: null, after: { mustNotMasqueradeAsProduction: true } }],
      held: [{ key: null, code: "SOURCE_HELD", detail: "No source body was eligible for promotion." }],
    }),
  });
  const view = projectRoutineDataObservability(
    {
      candidates: [lkg, refused],
      events: [...sourceHistory(lkg), ...sourceHistory(refused)],
      promotions: [promotion(contract, lkg)],
    },
    NOW,
    [contract],
  );
  const source = view.contracts[0];

  assert.equal(source.currentState.kind, "MEASURED");
  if (source.currentState.kind === "MEASURED") assert.equal(source.currentState.value, "SOURCE_BLOCKED");
  assert.equal(source.lkg.kind, "MEASURED");
  if (source.lkg.kind === "MEASURED") {
    assert.equal(source.lkg.value.versionId, lkg.id);
    assert.equal(source.lkg.value.currentlyServing, true);
  }
  assert.equal(source.latestCanonicalOutcome.kind, "NOT_RECORDED");
  assert.equal(source.cadence.freshness, "DUE", "the serving LKG age remains independently visible");
  assert.equal(source.cadence.operationalState, "RETRYING", "a later failed attempt must prevent a false-green HEALTHY state");
  assert.equal(source.cadence.nextDue.kind, "MEASURED");
  if (source.cadence.nextDue.kind === "MEASURED") assert.equal(source.cadence.nextDue.value, "2026-09-08T17:00:00.000Z");
  assert.equal(source.latestHeld.kind, "MEASURED");
  if (source.latestHeld.kind === "MEASURED") assert.deepEqual(source.latestHeld.value.map((item) => item.code), ["SOURCE_HELD"]);
  assert.equal(source.latestRefused.kind, "MEASURED");
  if (source.latestRefused.kind === "MEASURED") {
    assert.deepEqual(source.latestRefused.value.map((item) => item.code), ["SOURCE_AUTHENTICITY_FAIL"]);
  }
  assert.equal(countValue(view.summary.lkgServing), 1);
  assert.equal(countValue(view.summary.retrying), 1);
  assert.equal(countValue(view.summary.healthy), 0);
  assert.deepEqual(view.summary.lkgServing.members.map((item) => item.contractId), [contract.id]);
  assert.equal(countValue(source.histories["24h"].counts.added), 0, "a refused candidate delta is not a canonical civic-record outcome");
  assert.equal(countValue(source.histories["24h"].counts.refused), 1);
});

test("PDC-13: a final dotgov outage supersedes an earlier synthetic refusal as RETRYING while LKG serves", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS.find((item) => item.id === "dotgov")!;
  const lkg = candidateRow(contract, { id: "dotgov-live-lkg", at: "2026-09-08T01:00:00.000Z" });
  const syntheticAt = "2026-09-08T10:00:00.000Z";
  const syntheticCode = "DEPENDENT_CONSUMER_REJECTED";
  const syntheticDetail = "The synthetic dependent-consumer canary was refused.";
  const syntheticReceipt: ValidationReceipt = {
    ...validationReceipt(contract, "dotgov-synthetic-refusal", syntheticAt),
    decision: "FAIL",
    checks: VALIDATION_CHECKS.map((check) => check === "DEPENDENT_READ_MODEL_VALIDITY" ? {
      check,
      verdict: "FAIL" as const,
      code: syntheticCode,
      detail: syntheticDetail,
    } : {
      check,
      verdict: "PASS" as const,
      code: `${check}_PASS`,
      detail: `${check} passed.`,
    }),
  };
  const synthetic = candidateRow(contract, {
    id: "dotgov-synthetic-refusal",
    at: syntheticAt,
    state: "DEPENDENT_CONSUMER_INVALID",
    receipt: syntheticReceipt,
    changeSet: null,
    promotedVersionId: null,
    lastKnownGoodVersionId: lkg.id,
    failureCode: syntheticCode,
    failureDetail: syntheticDetail,
  });
  const outageAt = "2026-09-08T11:30:00.000Z";
  const outageCode = "SOURCE_UNAVAILABLE";
  const outageDetail = "The official dotgov source was unavailable before bytes arrived.";
  const outageReceipt: ValidationReceipt = {
    ...validationReceipt(contract, "dotgov-source-outage", outageAt),
    decision: "FAIL",
    checks: VALIDATION_CHECKS.map((check) => check === "SOURCE_AUTHENTICITY" ? {
      check,
      verdict: "FAIL" as const,
      code: outageCode,
      detail: outageDetail,
    } : {
      check,
      verdict: "PASS" as const,
      code: `${check}_PASS`,
      detail: `${check} passed.`,
    }),
  };
  const outage = candidateRow(contract, {
    id: "dotgov-source-outage",
    at: outageAt,
    state: "SOURCE_BLOCKED",
    acquisitionSucceeded: false,
    receipt: outageReceipt,
    changeSet: null,
    promotedVersionId: null,
    lastKnownGoodVersionId: lkg.id,
    failureCode: outageCode,
    failureDetail: outageDetail,
  });
  const sourceEvent = (
    row: RoutineCandidateRow,
    sequence: number,
    state: RoutineCandidateRow["state"],
    detail: string,
  ): RoutineCandidateEventRow => ({
    id: `${row.id}:${sequence}`,
    candidateId: row.id,
    sequence,
    state,
    at: row.retrievedAt,
    detail,
  });
  const events: RoutineCandidateEventRow[] = [
    sourceEvent(lkg, 1, "FETCHED", "Acquired the dotgov LKG."),
    sourceEvent(lkg, 2, "NORMALIZED", "Normalized the dotgov LKG."),
    sourceEvent(lkg, 3, "VALIDATED", "Validated the dotgov LKG."),
    sourceEvent(lkg, 4, "PROMOTED", "Promoted the dotgov LKG."),
    sourceEvent(synthetic, 1, "FETCHED", "Acquired the synthetic canary."),
    sourceEvent(synthetic, 2, "NORMALIZED", "Normalized the synthetic canary."),
    sourceEvent(synthetic, 3, "DEPENDENT_CONSUMER_INVALID", syntheticDetail),
    sourceEvent(outage, 1, "SOURCE_BLOCKED", outageDetail),
  ];
  const view = projectRoutineDataObservability(
    {
      candidates: [lkg, synthetic, outage],
      events,
      promotions: [promotion(contract, lkg)],
    },
    NOW,
    [contract],
  );
  const observed = view.contracts[0];

  assert.deepEqual(observed.lastAttemptedAcquisition, { kind: "MEASURED", value: outageAt });
  assert.equal(observed.currentState.kind, "MEASURED");
  if (observed.currentState.kind === "MEASURED") assert.equal(observed.currentState.value, "SOURCE_BLOCKED");
  assert.equal(observed.cadence.operationalState, "RETRYING");
  assert.deepEqual(observed.cadence.nextDue, { kind: "MEASURED", value: "2026-09-08T17:30:00.000Z" });
  assert.equal(observed.lkg.kind, "MEASURED");
  if (observed.lkg.kind === "MEASURED") {
    assert.equal(observed.lkg.value.versionId, lkg.id);
    assert.equal(observed.lkg.value.currentlyServing, true);
    assert.equal(observed.lkg.value.state, "SERVING_AFTER_LATER_ATTEMPT");
  }
  assert.equal(observed.latestRefused.kind, "MEASURED");
  if (observed.latestRefused.kind === "MEASURED") {
    assert.deepEqual(observed.latestRefused.value.map((item) => item.code), [outageCode]);
  }
  assert.deepEqual(observed.histories["24h"].attempts.map((item) => item.candidateId), [outage.id, synthetic.id, lkg.id]);
  assert.equal(countValue(observed.histories["24h"].counts.refused), 2);
  assert.deepEqual(view.summary.retrying.members.map((item) => item.contractId), [contract.id]);
  assert.deepEqual(view.summary.lkgServing.members.map((item) => item.contractId), [contract.id]);
});

test("PDC-13: LKG serving is based on candidate chronology, not pointer-write timestamp", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const lkg = candidateRow(contract, { id: "lkg-acquired-before-promotion", at: "2026-09-08T01:00:00.000Z" });
  const refused = candidateRow(contract, {
    id: "attempt-at-promotion-instant",
    at: "2026-09-08T11:00:00.000Z",
    state: "SOURCE_BLOCKED",
    acquisitionSucceeded: false,
    receipt: validationReceipt(contract, "attempt-at-promotion-instant", "2026-09-08T11:00:00.000Z", "FAIL"),
    promotedVersionId: null,
    lastKnownGoodVersionId: lkg.id,
    failureCode: "SOURCE_BLOCKED",
    failureDetail: "The later candidate was refused.",
  });
  const pointer = { ...promotion(contract, lkg), promotedAt: refused.retrievedAt };
  const firstLkgEvent: RoutineCandidateEventRow = {
    id: "attempt-at-pointer-write-first-event",
    candidateId: lkg.id,
    sequence: 1,
    state: "FETCHED",
    at: lkg.retrievedAt,
    detail: "The LKG acquisition was locally observed before promotion.",
  };
  const promotedEvent = { ...event(lkg, 4), at: refused.retrievedAt };
  const normalizedEvent: RoutineCandidateEventRow = {
    id: "attempt-at-pointer-write-normalized-event",
    candidateId: lkg.id,
    sequence: 2,
    state: "NORMALIZED",
    at: lkg.retrievedAt,
    detail: "The LKG candidate was normalized.",
  };
  const validatedEvent: RoutineCandidateEventRow = {
    id: "attempt-at-pointer-write-validated-event",
    candidateId: lkg.id,
    sequence: 3,
    state: "VALIDATED",
    at: lkg.retrievedAt,
    detail: "The LKG candidate was validated.",
  };
  const observed = projectRoutineDataObservability(
    {
      candidates: [lkg, refused],
      events: [firstLkgEvent, normalizedEvent, validatedEvent, promotedEvent, event(refused, 1)],
      promotions: [pointer],
    },
    NOW,
    [contract],
  ).contracts[0];

  assert.equal(observed.canonicalPromotion.kind, "MEASURED");
  assert.equal(observed.lkg.kind, "MEASURED");
  if (observed.lkg.kind === "MEASURED") {
    assert.equal(observed.lkg.value.currentlyServing, true);
    assert.equal(observed.lkg.value.state, "SERVING_AFTER_LATER_ATTEMPT");
  }
});

test("PDC-13: 24h, 7d, and 30d histories use exact attempt/event members", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const rows = [
    candidateRow(contract, { id: "in-24h", at: "2026-09-08T00:00:00.000Z", changeSet: changes({ outcome: "CHANGED", added: [{ key: "a", before: null, after: 1 }] }) }),
    candidateRow(contract, { id: "in-7d", at: "2026-09-05T12:00:00.000Z", changeSet: changes({ outcome: "UNCHANGED" }) }),
    candidateRow(contract, { id: "in-30d", at: "2026-08-24T12:00:00.000Z", changeSet: changes({ outcome: "CHANGED", removed: [{ key: "old", before: 1, after: null }] }) }),
    candidateRow(contract, { id: "outside-30d", at: "2026-07-30T12:00:00.000Z", changeSet: changes({ outcome: "UNCHANGED" }) }),
  ];
  const view = projectRoutineDataObservability(
    { candidates: rows, events: rows.flatMap((row) => sourceHistory(row)), promotions: [promotion(contract, rows[0])] },
    NOW,
    [contract],
  );
  const histories = view.contracts[0].histories;

  assert.deepEqual(histories["24h"].counts.attempts.members.map((item) => item.candidateId), ["in-24h"]);
  assert.deepEqual(histories["7d"].counts.attempts.members.map((item) => item.candidateId), ["in-24h", "in-7d"]);
  assert.deepEqual(histories["30d"].counts.attempts.members.map((item) => item.candidateId), ["in-24h", "in-7d", "in-30d"]);
  assert.equal(countValue(histories["30d"].counts.promotions), 3);
  assert.equal(countValue(histories["30d"].counts.changedOutcomes), 2);
  assert.equal(countValue(histories["30d"].counts.unchangedOutcomes), 1);
  assert.deepEqual(histories["30d"].counts.added.members.map((item) => item.key), ["a"]);
  assert.deepEqual(histories["30d"].counts.removed.members.map((item) => item.key), ["old"]);
});

test("PDC-13: the exact 30d window does not truncate the full meeting-partition volume", () => {
  const candidates: RoutineCandidateRow[] = [];
  const events: RoutineCandidateEventRow[] = [];
  const promotions: RoutinePromotionRow[] = [];
  for (const contract of MEETING_PARTITION_CONTRACTS) {
    for (let day = 0; day <= 30; day += 1) {
      const at = new Date(Date.parse(NOW) - day * 24 * 60 * 60 * 1_000).toISOString();
      const row = candidateRow(contract, { id: `${contract.id}:day-${day}`, at });
      candidates.push(row);
      events.push(...sourceHistory(row));
      if (day === 0) promotions.push(promotion(contract, row));
    }
  }

  const view = projectRoutineDataObservability(
    { candidates, events, promotions },
    NOW,
    MEETING_PARTITION_CONTRACTS,
  );
  assert.equal(view.contracts.length, MEETING_PARTITION_CONTRACTS.length);
  for (const row of view.contracts) {
    assert.equal(countValue(row.histories["30d"].counts.attempts), 31, `${row.contractId}: inclusive 30d attempts`);
    assert.equal(countValue(row.histories["30d"].counts.promotions), 31, `${row.contractId}: inclusive 30d events`);
  }
  assert.equal(candidates.length, MEETING_PARTITION_CONTRACTS.length * 31);
  assert.equal(events.length, MEETING_PARTITION_CONTRACTS.length * 31 * 4);
});

test("PDC-13: freshness separates FRESH, DUE, STALE, and UNKNOWN", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const projected = (at: string, id: string) => {
    const row = candidateRow(contract, { id, at });
    return projectRoutineDataObservability(
      { candidates: [row], events: sourceHistory(row), promotions: [promotion(contract, row)] },
      NOW,
      [contract],
    ).contracts[0].cadence.freshness;
  };
  assert.equal(projected("2026-09-07T12:00:00.000Z", "fresh"), "FRESH");
  assert.equal(projected("2026-08-31T12:00:00.000Z", "due"), "DUE");
  assert.equal(projected("2026-08-20T12:00:00.000Z", "stale"), "STALE");
  assert.equal(projectRoutineDataObservability({ candidates: [], events: [], promotions: [] }, NOW, [contract]).contracts[0].cadence.freshness, "UNKNOWN");
});

test("PDC-13: a trusted-LKG import leaves the standing source due immediately", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const imported = candidateRow(contract, {
    id: "fec-import-clock",
    at: "2026-09-08T11:59:00.000Z",
  });
  const observed = projectRoutineDataObservability({
    candidates: [{
      ...imported,
      candidate: {
        ...(imported.candidate as Record<string, unknown>),
        bootstrapImport: { kind: "TRUSTED_LKG_IMPORT" },
      },
    }],
    events: [],
    promotions: [],
  }, NOW, [contract]).contracts[0];

  assert.equal(observed.cadence.nextDue.kind, "MEASURED");
  if (observed.cadence.nextDue.kind === "MEASURED") assert.equal(observed.cadence.nextDue.value, NOW);
  assert.equal(observed.lastAttemptedAcquisition.kind, "NOT_RECORDED", "an authority transfer is not a source attempt");
  assert.equal(observed.lastSuccessfulAcquisition.kind, "NOT_RECORDED", "an authority transfer is not source-authenticated success");
});

test("PDC-13: an abandoned standing attempt becomes HELD instead of remaining silently in progress", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const abandoned = candidateRow(contract, {
    id: "fec-abandoned-attempt",
    at: "2026-09-08T00:00:00.000Z",
    state: "NORMALIZED",
    receipt: null,
    changeSet: null,
    promotedVersionId: null,
    lastKnownGoodVersionId: null,
  });
  const observed = projectRoutineDataObservability(
    { candidates: [abandoned], events: sourceHistory(abandoned), promotions: [] },
    NOW,
    [contract],
  ).contracts[0];

  assert.equal(observed.cadence.operationalState, "HELD");
  assert.match(observed.cadence.operationalDetail, /without a terminal source disposition/);
});

test("PDC-13: elapsed automatic retries and owner-invoked refusals are explicitly HELD", () => {
  const routine = ROUTINE_SOURCE_CONTRACTS[0];
  const lkg = candidateRow(routine, { id: "held-lkg", at: "2026-09-01T12:00:00.000Z" });
  const failed = candidateRow(routine, {
    id: "held-failure",
    at: "2026-09-08T01:00:00.000Z",
    state: "SOURCE_BLOCKED",
    acquisitionSucceeded: false,
    receipt: validationReceipt(routine, "held-failure", "2026-09-08T01:00:00.000Z", "FAIL"),
    promotedVersionId: null,
    lastKnownGoodVersionId: lkg.id,
    failureCode: "SOURCE_ROUTE_BLOCKED",
    failureDetail: "Publisher unavailable.",
  });
  const routineView = projectRoutineDataObservability(
    { candidates: [lkg, failed], events: [...sourceHistory(lkg), ...sourceHistory(failed)], promotions: [promotion(routine, lkg)] },
    NOW,
    [routine],
  );
  assert.equal(routineView.contracts[0].cadence.operationalState, "HELD");
  assert.equal(countValue(routineView.summary.held), 1);

  const manual = MANUAL_PRODUCTION_SOURCE_CONTRACTS[0];
  const manualFailure = candidateRow(manual, {
    id: "manual-failure",
    at: "2026-09-08T11:00:00.000Z",
    state: "SEMANTIC_INVALID",
    receipt: validationReceipt(manual, "manual-failure", "2026-09-08T11:00:00.000Z", "FAIL"),
    promotedVersionId: null,
    lastKnownGoodVersionId: null,
    failureCode: "SEMANTIC_CONTRACT_VIOLATION",
    failureDetail: "Reviewed package was refused.",
  });
  const manualView = projectRoutineDataObservability(
    { candidates: [manualFailure], events: sourceHistory(manualFailure), promotions: [] },
    NOW,
    [manual],
  );
  assert.equal(manualView.contracts[0].cadence.operationalState, "HELD");
});

test("PDC-13: connection, store, projection, and answered evidence are distinct outcomes", async () => {
  const notConnected = await projectRoutineDataObservabilityRead({ now: NOW, connected: false });
  assert.equal(notConnected.kind, "NOT_CONNECTED");

  const badClock = await projectRoutineDataObservabilityRead({ now: "not-an-instant", connected: true });
  assert.equal(badClock.kind, "PROJECTION_FAILED");
  if (badClock.kind === "PROJECTION_FAILED") {
    assert.match(badClock.detail, /observation clock is unreadable/i);
    assert.match(badClock.detail, /store was not queried/i);
  }

  const missingAdapter = await projectRoutineDataObservabilityRead({ now: NOW, connected: true });
  assert.equal(missingAdapter.kind, "PROJECTION_FAILED");
  if (missingAdapter.kind === "PROJECTION_FAILED") {
    assert.match(missingAdapter.detail, /read adapter is not installed/i);
    assert.match(missingAdapter.detail, /store was not queried/i);
  }

  const unreachable = await projectRoutineDataObservabilityRead({
    now: NOW,
    connected: true,
    readRows: async () => { throw new TypeError("secret connection detail"); },
  });
  assert.equal(unreachable.kind, "STORE_UNREACHABLE");
  if (unreachable.kind === "STORE_UNREACHABLE") {
    assert.match(unreachable.detail, /TypeError/);
    assert.doesNotMatch(unreachable.detail, /secret connection detail/);
  }

  const projectionFailed = await projectRoutineDataObservabilityRead({
    now: NOW,
    connected: true,
    readRows: async () => ({ candidates: null as never, events: [], promotions: [] }),
  });
  assert.equal(projectionFailed.kind, "PROJECTION_FAILED");
  if (projectionFailed.kind === "PROJECTION_FAILED") {
    assert.match(projectionFailed.detail, /canonical store answered/i);
    assert.match(projectionFailed.detail, /No source\/store failure/i);
  }

  const answered = await projectRoutineDataObservabilityRead({
    now: NOW,
    connected: true,
    readRows: async () => ({ candidates: [], events: [], promotions: [] }),
  });
  assert.equal(answered.kind, "HELD");
  if (answered.kind === "HELD") {
    const expectedContractIds = [...observableRoutineContracts(), ...MANUAL_PRODUCTION_SOURCE_CONTRACTS]
      .map((contract) => contract.id)
      .sort();
    assert.deepEqual(answered.value.contracts.map((contract) => contract.contractId).sort(), expectedContractIds);
  }
});

test("PDC meetings observability enumerates every source/body authority and excludes the retired aggregate", () => {
  const contracts = observableRoutineContracts();
  const meetingRows = contracts.filter((contract) => contract.recordClass === "MEETING");
  assert.equal(meetingRows.length, MEETING_PARTITION_CONTRACTS.length);
  assert.ok(meetingRows.length > 1, "the owner denominator must expose the finite source/body partition set");
  assert.deepEqual(
    meetingRows.map((contract) => contract.id).sort(),
    MEETING_PARTITION_CONTRACTS.map((contract) => contract.id).sort(),
  );
  assert.ok(!contracts.some((contract) => contract.id === "meetings" || contract.scope === "supported-bodies"));

  const view = projectRoutineDataObservability({ candidates: [], events: [], promotions: [] }, NOW);
  assert.equal(view.contracts.length, contracts.length + MANUAL_PRODUCTION_SOURCE_CONTRACTS.length);
  assert.ok(!view.contracts.some((contract) => contract.contractId === "meetings" || contract.scope === "supported-bodies"));
});

test("PDC-13: render words never collapse unknown, not recorded, not applicable, and measured zero", () => {
  assert.equal(observationText({ kind: "NOT_RECORDED", detail: "none" }), "Not measured — no record");
  assert.equal(observationText({ kind: "UNKNOWN", detail: "unreadable" }), "Cannot tell");
  assert.equal(observationText({ kind: "NOT_APPLICABLE", detail: "no projection" }), "Not applicable");
  assert.equal(drilldownCountText({ kind: "MEASURED", value: 0, members: [] }), "0");
  assert.equal(drilldownCountText({ kind: "NOT_RECORDED", detail: "none", members: [] }), "Not measured — no record");
  assert.equal(drilldownCountText({ kind: "UNKNOWN", detail: "unreadable", members: [] }), "Cannot tell");
});

test("PDC-13: historical proof reuse never survives a later snapshot read", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0]!;
  const candidate = candidateRow(contract, { id: "snapshot-cache-boundary", at: "2026-09-08T01:00:00.000Z" });
  const rows = { candidates: [candidate], events: sourceHistory(candidate), promotions: [promotion(contract, candidate)] };
  const read = () => projectRoutineDataObservability(rows, NOW, [contract], READER_BUILD).contracts[0]!;
  const original = read();
  for (const window of ["24h", "7d", "30d"] as const) {
    const count = original.histories[window].counts.promotions;
    assert.equal(count.kind, "MEASURED");
    if (count.kind === "MEASURED") assert.equal(count.value, 1);
  }
  const envelope = candidate.candidate as { readModel: { candidateId: string } };
  envelope.readModel.candidateId = "different-payload-with-same-row-reference";
  const changedPayload = read();
  for (const window of ["24h", "7d", "30d"] as const)
    assert.equal(changedPayload.histories[window].counts.promotions.kind, "UNKNOWN");
  envelope.readModel.candidateId = candidate.id;
  assert.deepEqual(read(), original);

  const lastEvent = rows.events.at(-1)!;
  rows.events[rows.events.length - 1] = { ...lastEvent, candidateId: "unrelated-candidate" };
  const changedEvents = read();
  for (const window of ["24h", "7d", "30d"] as const)
    assert.notDeepEqual(changedEvents.histories[window].counts.promotions, original.histories[window].counts.promotions);
  rows.events[rows.events.length - 1] = lastEvent;
  assert.deepEqual(read(), original);

  rows.candidates[0] = { ...candidate, validationReceipt: validationReceipt(contract, "wrong-receipt-candidate", candidate.retrievedAt) };
  for (const window of ["24h", "7d", "30d"] as const)
    assert.equal(read().histories[window].counts.promotions.kind, "UNKNOWN");
  rows.candidates[0] = candidate;
  assert.deepEqual(read(), original);
});

test("PDC-13: the deterministic Admin render contract leads with canonical operations and refuses false zeroes", () => {
  const server = readFileSync("lib/civic-data/observability-server.ts", "utf8");
  const store = readFileSync("lib/civic-data/observability-store.ts", "utf8");
  assert.match(server, /import "server-only"/);
  assert.match(server, /readRoutineDataObservabilityFromConnection/);
  assert.match(server, /codeSha:\s*process\.env\.WTP_BUILD_COMMIT/);
  assert.match(server, /branch:\s*process\.env\.WTP_BUILD_BRANCH/);
  assert.match(server, /context:\s*process\.env\.WTP_BUILD_CONTEXT/);
  assert.match(store, /from "\.\.\/db\/schema\.ts"/);
  assert.match(store, /projectRoutineDataObservabilityRead/);
  assert.deepEqual(ROUTINE_OBSERVABILITY_SNAPSHOT_OPTIONS, {
    isolationLevel: "repeatable read",
    accessMode: "read only",
  });
  for (const table of ["civicDataCandidates", "civicDataCandidateEvents", "civicDataPromotions"])
    assert.match(store, new RegExp(`\\b${table}\\b`));
  assert.equal(
    (store.match(/\.limit\(/g) ?? []).length,
    0,
    "the exact 30d candidates/events, latest-contract rows, and pointer backfills must remain complete",
  );
  assert.match(store, /const latestCandidate = notExists\(/, "latest disposition must include every tied maximum");
  assert.match(store, /const latestSourceAttempt = and\([\s\S]*?notExists\(/, "last source attempt must be selected independently");
  assert.match(store, /const latestSourceSuccess = and\([\s\S]*?notExists\(/, "last source success must be selected independently");
  assert.match(store, /sourceOrUnknownAuthority[\s\S]*?TRUSTED_LKG_IMPORT[\s\S]*?TRUSTED_LKG_REATTESTATION/, "trusted imports must not masquerade as live-source attempts");
  assert.match(store, /const latestValidation = and\([\s\S]*?notExists\(/, "last validation must be selected independently");
  assert.match(store, /const selectedCandidateIds = db\.select/);
  assert.match(store, /inArray\(civicDataCandidateEvents\.candidateId, selectedCandidateIds\)/, "selected latest/pointer rows need their complete event history");
  assert.match(store, /currentReattestationPredecessorIds/, "a re-attested pointer needs its immutable predecessor outside the rolling window");
  assert.doesNotMatch(store, /observableRoutineContracts|MANUAL_PRODUCTION_SOURCE_CONTRACTS/, "Admin must not issue one database request per contract");
  assert.match(store, /gte\(civicDataCandidateEvents\.at, since\)/);
  assert.match(store, /inArray\(civicDataCandidates\.id, recentEventCandidateIds\)/);
  assert.match(store, /eq\(candidateAttemptEvent\.sequence, 1\)/, "candidate selection must use the durable local attempt clock");
  assert.match(store, /lte\(civicDataCandidates\.retrievedAt, now\)/, "future source timestamps cannot displace the last authenticated success");
  assert.doesNotMatch(store, /gte\(civicDataCandidates\.retrievedAt, since\)/, "rolling history authority is local event time, not an adapter timestamp");
  assert.match(store, /drizzle\(pool, \{ schema \}\)\.transaction\(async \(db\) =>/);
  assert.match(store, /\}, ROUTINE_OBSERVABILITY_SNAPSHOT_OPTIONS\)/);
  assert.match(store, /finally \{ await pool\.end\(\); \}/);
  assert.doesNotMatch(store, /Promise\.all\(/, "canonical rows must come from one repeatable-read transaction");
  assert.doesNotMatch(`${server}\n${store}`, /\.(?:insert|update|delete)\(/, "the observability read path must remain read-only");
});

test("a confirmed re-check keeps Admin current: the newest confirmation is the latest attempt and success, never a second promotion", async () => {
  const { buildUnchangedConfirmation, serializeUnchangedConfirmation } = await import("../lib/civic-data/unchanged-confirmation.ts");
  const contract = ROUTINE_SOURCE_CONTRACTS[0];
  const promotedAt = "2026-09-01T00:00:00.000Z";
  const confirmedAt = "2026-09-08T11:00:00.000Z";
  const row = candidateRow(contract, { id: "fec-confirmed", at: promotedAt });
  const history = [...sourceHistory(row), readerEvent(contract, row)];
  const unconfirmed = projectRoutineDataObservability(
    { candidates: [row], events: history, promotions: [promotion(contract, row)] }, NOW, [contract], READER_BUILD,
  ).contracts[0];
  assert.notEqual(unconfirmed.cadence.freshness, "FRESH", "a week-old promotion alone is not fresh");

  const built = buildUnchangedConfirmation({
    sourceId: contract.sourceId,
    recordClass: contract.recordClass,
    scope: contract.scope,
    parserVersion: "fec-funding/2",
    pointerVersionId: row.id,
    readModelHash: (row.candidate as { normalization: { normalizedHash: string } }).normalization.normalizedHash,
    basis: "READ_MODEL_RECOMPUTED",
    retrieval: { requestedUrl: "https://api.open.fec.gov/v1/", finalUrl: "https://api.open.fec.gov/v1/", httpStatus: 200, rawHash: "c".repeat(64), retrievedAt: "2026-09-08T10:59:58.000Z" },
  }, `${contract.recordClass}:${contract.scope}`, confirmedAt);
  assert.ok(built.ok);
  if (!built.ok) return;
  const confirmation: RoutineCandidateEventRow = {
    id: `confirmation-${row.id}`,
    candidateId: row.id,
    sequence: history.length + 1,
    state: "PROMOTED",
    at: confirmedAt,
    detail: serializeUnchangedConfirmation(built.confirmation),
  };
  const view = projectRoutineDataObservability(
    { candidates: [row], events: [...history, confirmation], promotions: [promotion(contract, row)] }, NOW, [contract], READER_BUILD,
  );
  const source = view.contracts[0];
  assert.equal(source.canonicalPromotion.kind, "MEASURED", "the pointer proof is untouched by a confirmation");
  assert.equal(source.readerVisible.kind, "MEASURED");
  assert.deepEqual(source.lastAttemptedAcquisition, { kind: "MEASURED", value: confirmedAt });
  assert.deepEqual(source.lastSuccessfulAcquisition, { kind: "MEASURED", value: confirmedAt });
  assert.deepEqual(source.latestCanonicalOutcome, { kind: "MEASURED", value: "UNCHANGED" });
  assert.equal(source.cadence.freshness, "FRESH");
  assert.equal(source.cadence.operationalState, "HEALTHY");
  assert.equal(source.cadence.nextDue.kind, "MEASURED");
  if (source.cadence.nextDue.kind === "MEASURED") assert.ok(Date.parse(source.cadence.nextDue.value) > Date.parse(confirmedAt));
  const { serializeUnchangedConfirmationSources } = await import("../lib/civic-data/unchanged-confirmation.ts");
  const sources = { ...confirmation, id: "retained-sources", sequence: confirmation.sequence + 1,
    detail: serializeUnchangedConfirmationSources(built.confirmation, []) };
  const laterReader = readerEvent(contract, { ...row, retrievedAt: confirmedAt }, sources.sequence + 1);
  const historyAfterRecheck = [...history, confirmation, sources, laterReader];
  const readAfterRecheck = (events: RoutineCandidateEventRow[]) => projectRoutineDataObservability(
    { candidates: [row], events, promotions: [promotion(contract, row)] }, NOW, [contract], READER_BUILD).contracts[0].readerVisible;
  assert.equal(readAfterRecheck(historyAfterRecheck).kind, "MEASURED", "legitimate source receipts between reader checks are not missing events");
  assert.equal(readAfterRecheck(historyAfterRecheck.filter(e => e.id !== sources.id)).kind, "UNKNOWN", "a real missing companion sequence still holds");
  assert.equal(readAfterRecheck(historyAfterRecheck.map(e => e.id === sources.id ? { ...e, detail: "UNCHANGED_CONFIRMATION_SOURCES_V1 {}" } : e)).kind, "UNKNOWN", "malformed companion evidence cannot fill the sequence gap");
  const day = source.histories["24h"];
  assert.deepEqual(day.events.map((item) => item.domain), ["UNCHANGED_CONFIRMATION"], "labelled as a confirmation, not a source state");
  for (const [name, count] of Object.entries(day.counts)) {
    assert.equal(count.kind, "MEASURED", `${name}: a confirmation is not a gap`);
  }
  assert.equal(countValue(day.counts.promotions), 0, "a confirmation is never counted as a promotion");
  assert.equal(countValue(day.counts.attempts), 1, "it is counted as an attempt");
  assert.equal(countValue(day.counts.successfulAcquisitions), 1, "and as a successful acquisition");
  assert.deepEqual(day.attempts.map((item) => [item.candidateId, item.canonicalOutcome]), [[row.id, { kind: "MEASURED", value: "UNCHANGED" }]]);
});

test("R20: Admin shows the retry the runner admits on; a meeting partition never published is next due at the base cadence", () => {
  const contract = MEETING_PARTITION_CONTRACTS[0];
  const blockedAt = "2026-09-08T11:30:00.000Z";
  const code = "SOURCE_UNAVAILABLE";
  const detail = "The official meeting page was unavailable before bytes arrived.";
  const receipt: ValidationReceipt = {
    ...validationReceipt(contract, "meeting-outage", blockedAt),
    decision: "FAIL",
    checks: VALIDATION_CHECKS.map((check) => check === "SOURCE_AUTHENTICITY"
      ? { check, verdict: "FAIL" as const, code, detail }
      : { check, verdict: "PASS" as const, code: `${check}_PASS`, detail: `${check} passed.` }),
  };
  const outage = (lastKnownGoodVersionId: string | null) => candidateRow(contract, {
    id: "meeting-outage",
    at: blockedAt,
    state: "SOURCE_BLOCKED",
    acquisitionSucceeded: false,
    receipt,
    changeSet: null,
    promotedVersionId: null,
    lastKnownGoodVersionId,
    failureCode: code,
    failureDetail: detail,
  });
  const blockedEvent = (row: RoutineCandidateRow): RoutineCandidateEventRow => ({
    id: `${row.id}:1`,
    candidateId: row.id,
    sequence: 1,
    state: "SOURCE_BLOCKED",
    at: row.retrievedAt,
    detail,
  });

  const never = outage(null);
  const unpublished = projectRoutineDataObservability(
    { candidates: [never], events: [blockedEvent(never)], promotions: [] },
    NOW,
    [contract],
  ).contracts[0];
  assert.equal(unpublished.canonicalPromotion.kind, "NOT_RECORDED");
  // Owed twelve hours after the attempt, admitted 2 hours before.
  assert.deepEqual(unpublished.cadence.nextDue, { kind: "MEASURED", value: "2026-09-08T21:30:00.000Z" });
  assert.equal(unpublished.cadence.operationalState, "RETRYING");
  assert.match(unpublished.cadence.operationalDetail, /retry is due 2026-09-08T21:30:00\.000Z/);
  assert.match(unpublished.cadence.retryDescription, /never published, so 12 hours after its last attempt/);

  const lkg = candidateRow(contract, { id: "meeting-lkg", at: "2026-09-08T09:00:00.000Z" });
  const failed = outage(lkg.id);
  const published = projectRoutineDataObservability(
    { candidates: [lkg, failed], events: [...sourceHistory(lkg), blockedEvent(failed)], promotions: [promotion(contract, lkg)] },
    NOW,
    [contract],
  ).contracts[0];
  // Owed an hour after the failed attempt, admitted 25 minutes before.
  assert.deepEqual(published.cadence.nextDue, { kind: "MEASURED", value: "2026-09-08T12:05:00.000Z" });
  assert.equal(published.cadence.operationalState, "RETRYING");
  assert.ok(published.cadence.retryDescription.startsWith(contract.retry.description));
  assert.doesNotMatch(published.cadence.retryDescription, /never published/);
});
