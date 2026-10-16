import { rememberStatePublicationHashes, rememberStatePublicationPrior, withStateRecordHashes } from "../lib/civic-data/state-publication-prior.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

import { neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { getTableColumns } from "drizzle-orm";

import * as schema from "../lib/db/schema.ts";
import { ROUTINE_SOURCE_CONTRACTS } from "../lib/civic-data/contracts.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "../lib/civic-data/manual-contracts.ts";
import { STATE_BALLOT_FAMILIES, stateBallotContractId } from "../lib/ballot/state-scopes.ts";
import { CivicPayloadParts } from "../lib/civic-data/payload-parts.ts";
import { decodeStateCandidate, encodeStateCandidate, immutableStateCandidate, withStatePublicationRead } from "../lib/civic-data/state-publication.ts";
import { promotionProofIssue, readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import { processRoutineCandidate } from "../lib/civic-data/candidate-lifecycle.ts";
import {
  assertRoutineDataStoreMutationAuthority,
  canonicalPostgresRoutineTimestamp,
  candidateSummaryRead,
  preparedProjectionCouplingRead,
  MemoryRoutineDataStore,
  PostgresRoutineDataStore,
  PROMOTED_POINTER_COLUMNS,
  promotedPointerIdentityRead,
  readerEvidenceCandidateRead,
  readerEvidenceRowToRecord,
  publishedCandidateMetadata,
  routineDataStoreCandidateAuthorityIssue,
} from "../lib/civic-data/store.ts";
import type { RuntimeAuthorityEnvelope } from "../lib/civic-data/runtime-authority.ts";
import { normalizedHash } from "../lib/civic-data/candidate-builders.ts";
import { serializeReaderProjectionReadback } from "../lib/civic-data/reader-readback.ts";
import {
  VALIDATION_CHECKS,
  sourceProjectionEvidence,
  type CandidateVersionRecord,
  type RoutineCandidate,
  type ValidationReceipt,
} from "../lib/civic-data/types.ts";

const HASH = "a".repeat(64);
const ROOT = resolve(import.meta.dirname, "..");

test("Postgres routine-data timestamps have one fail-closed canonical evidence boundary", () => {
  const postgres = "2026-09-08 21:41:13.689+00";
  const canonical = "2026-09-08T21:41:13.689Z";
  assert.equal(canonicalPostgresRoutineTimestamp(postgres, "promotion.promotedAt"), canonical);
  assert.equal(canonicalPostgresRoutineTimestamp(canonical, "candidateEvent.at"), canonical);
  assert.equal(
    canonicalPostgresRoutineTimestamp("2026-09-08 14:41:13.689-07", "candidateEvent.at"),
    canonical,
  );
  assert.throws(
    () => canonicalPostgresRoutineTimestamp("not-an-instant", "candidateEvent.at"),
    /CIVIC_DATA_POSTGRES_TIMESTAMP_INVALID:candidateEvent\.at/,
  );
  assert.throws(
    () => canonicalPostgresRoutineTimestamp(null, "promotion.promotedAt"),
    /CIVIC_DATA_POSTGRES_TIMESTAMP_INVALID:promotion\.promotedAt/,
  );

  const canonicalPointer = { promotedAt: canonical, payload: { exact: true } };
  const postgresPointer = {
    ...canonicalPointer,
    promotedAt: canonicalPostgresRoutineTimestamp(postgres, "promotion.promotedAt"),
  };
  const canonicalHistory = [{ sequence: 1, at: canonical, detail: "exact" }];
  const postgresHistory = [{
    ...canonicalHistory[0]!,
    at: canonicalPostgresRoutineTimestamp(postgres, "candidateEvent.at"),
  }];
  assert.deepEqual(postgresPointer, canonicalPointer);
  assert.deepEqual(postgresHistory, canonicalHistory);

  const source = readFileSync(join(ROOT, "lib", "civic-data", "store.ts"), "utf8");
  const adapter = source.slice(source.indexOf("export class PostgresRoutineDataStore"));
  assert.doesNotMatch(adapter, /promotedAt:\s*(?:row|pointerRow)\.promotedAt/);
  assert.doesNotMatch(adapter, /promotedAt:\s*at,/);
  assert.doesNotMatch(adapter, /\bat:\s*(?:row|event)\.at/);
  assert.doesNotMatch(adapter, /const lastAttemptedAt = rows\[0\]\?\.attemptedAt;/);
  assert.match(adapter, /postgresPromotionRowToProjection/);
  assert.match(adapter, /postgresCandidateEventRowToEvent/);
  assert.match(adapter, /canonicalPostgresRoutineTimestamp\(rows\[0\]\.attemptedAt/);
  assert.match(adapter, /canonicalPostgresRoutineTimestamp\(lastSucceededAt/);
});

function candidate(id: string, retrievedAt = "2026-09-08T12:00:00.000Z", sourceId = "fec-open-api"): RoutineCandidate {
  const normalizedPayload = { rows: [{ id }] };
  const readModel = { candidates: [{ id, amount: 1 }] };
  return {
    id,
    sourceId,
    recordClass: "FEC_FUNDING",
    scope: "federal-supported",
    sourceProjectionEvidence: sourceProjectionEvidence("fec-open-api", "FEC_FUNDING", "federal-supported"),
    retrieval: {
      succeeded: true,
      requestedUrl: "https://api.open.fec.gov/v1/",
      finalUrl: "https://api.open.fec.gov/v1/",
      httpStatus: 200,
      retrievedAt,
      rawHash: HASH,
    },
    normalization: {
      succeeded: true,
      parserVersion: "fec-funding/4",
      schemaVersion: "2",
      normalizedHash: normalizedHash(readModel),
      normalizedPayloadHash: normalizedHash(normalizedPayload),
      inputRecords: 1,
      outputRecords: 1,
      droppedRecords: 0,
      missingRequiredFields: [],
    },
    identities: [{
      subjectId: "H6AZ01001",
      jurisdiction: "US",
      identifiers: { candidate_id: "H6AZ01001" },
      matchBasis: "OFFICIAL_ID",
      ambiguous: false,
    }],
    temporal: {
      version: "2026",
      expectedVersion: "2026",
      sourceThrough: retrievedAt,
      staleAtRetrieval: false,
    },
    semantics: { factKind: "filed total", violations: [] },
    horizon: {
      kind: "OPEN_FACT_SET",
      query: "supported candidates",
      returnedRecords: 1,
      declaredTotal: null,
      paginationComplete: true,
      claimsComplete: false,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [{ consumer: "funding reader", passed: true, detail: "accepted" }],
    normalizedPayload,
    readModel,
  };
}

function receiptFor(value: RoutineCandidate): ValidationReceipt {
  return {
    contractVersion: 2,
    decision: "GOOD",
    candidateId: value.id,
    sourceId: value.sourceId,
    recordClass: value.recordClass,
    scope: value.scope,
    validatedAt: value.retrieval.retrievedAt,
    checks: VALIDATION_CHECKS.map((check) => ({
      check,
      verdict: "PASS",
      code: `${check}_PASS`,
      detail: "persisted proof",
    })),
    excludedFacts: [],
  };
}

async function seedValidated(
  store: MemoryRoutineDataStore,
  value: RoutineCandidate,
  receipt: ValidationReceipt = receiptFor(value),
  lastKnownGoodVersion: string | null = null,
): Promise<ValidationReceipt> {
  const record: CandidateVersionRecord = {
    candidate: value,
    state: "FETCHED",
    acquisitionSucceeded: true,
    receipt: null,
    promotedVersion: null,
    lastKnownGoodVersion,
    failureCode: null,
    failureDetail: null,
  };
  await store.create(record, {
    candidateId: value.id,
    sequence: 1,
    state: "FETCHED",
    at: value.retrieval.retrievedAt,
    detail: "persisted acquisition",
  });
  await store.transition(value.id, "NORMALIZED", value.retrieval.retrievedAt, "persisted normalization");
  await store.transition(value.id, "VALIDATED", value.retrieval.retrievedAt, "persisted validation", receipt);
  return receipt;
}

test("promotion accepts only the exact persisted GOOD receipt", async () => {
  const store = new MemoryRoutineDataStore();
  const value = candidate("exact-receipt");
  const persisted = await seedValidated(store, value);
  const substituted: ValidationReceipt = {
    ...structuredClone(persisted),
    checks: persisted.checks.map((check, index) => index === 0
      ? { ...check, detail: "caller supplied different proof" }
      : check),
  };

  await assert.rejects(
    store.promote(value.id, substituted, "2026-09-08T12:01:00.000Z"),
    /CANDIDATE_NOT_PROMOTABLE:exact-receipt/,
  );
  assert.equal(await store.readPromotion(value.recordClass, value.scope), null);
  assert.equal((await store.readCandidate(value.id))?.state, "VALIDATED");
  assert.deepEqual((await store.events(value.id)).map((event) => event.state), ["FETCHED", "NORMALIZED", "VALIDATED"]);

  const promoted = await store.promote(value.id, structuredClone(persisted), "2026-09-08T12:02:00.000Z");
  assert.deepEqual(promoted.receipt, persisted);
  assert.equal(promoted.versionId, value.id);
});

test("a malformed or misidentified GOOD receipt cannot enter the validated durable state", async () => {
  const mutations: Array<[string, (receipt: ValidationReceipt) => ValidationReceipt]> = [
    ["candidate", (receipt) => ({ ...receipt, candidateId: "some-other-candidate" })],
    ["source", (receipt) => ({ ...receipt, sourceId: "some-other-source" })],
    ["class", (receipt) => ({ ...receipt, recordClass: "MEETING" })],
    ["scope", (receipt) => ({ ...receipt, scope: "some-other-scope" })],
    ["decision", (receipt) => ({ ...receipt, decision: "FAIL" })],
    ["checks", (receipt) => ({ ...receipt, checks: receipt.checks.slice(1) })],
  ];

  for (const [label, mutate] of mutations) {
    const store = new MemoryRoutineDataStore();
    const value = candidate(`identity-${label}`);
    const inconsistent = mutate(receiptFor(value));
    await assert.rejects(
      seedValidated(store, value, inconsistent),
      new RegExp(`CANDIDATE_TRANSITION_RECEIPT_INVALID:${value.id}:VALIDATED`),
    );
    assert.equal(await store.readPromotion(value.recordClass, value.scope), null, `${label} mismatch moved the pointer`);
    assert.equal((await store.readCandidate(value.id))?.state, "NORMALIZED", `${label} mismatch entered VALIDATED`);
  }
});

test("durable validation and promotion clocks cannot run backward or into the far future", async () => {
  const backwardValidationStore = new MemoryRoutineDataStore();
  const backwardValidation = candidate("backward-validation", "2026-09-08T12:00:00.000Z");
  await assert.rejects(
    seedValidated(backwardValidationStore, backwardValidation, {
      ...receiptFor(backwardValidation),
      validatedAt: "2026-09-08T11:59:59.999Z",
    }),
    /CANDIDATE_TRANSITION_RECEIPT_INVALID:backward-validation:VALIDATED/,
  );
  assert.equal((await backwardValidationStore.readCandidate(backwardValidation.id))?.state, "NORMALIZED");
  assert.equal(await backwardValidationStore.readPromotion(backwardValidation.recordClass, backwardValidation.scope), null);

  const promotionStore = new MemoryRoutineDataStore();
  const promotionCandidate = candidate("invalid-promotion-clock", "2026-09-08T12:00:00.000Z");
  const persisted = await seedValidated(promotionStore, promotionCandidate);
  await assert.rejects(
    promotionStore.promote(promotionCandidate.id, persisted, "2026-09-08T11:59:59.999Z"),
    /CANDIDATE_PROMOTION_TIME_INVALID:invalid-promotion-clock/,
  );
  await assert.rejects(
    promotionStore.promote(promotionCandidate.id, persisted, "2999-01-01T00:00:00.000Z"),
    /CANDIDATE_PROMOTION_TIME_INVALID:invalid-promotion-clock/,
  );
  assert.equal(await promotionStore.readPromotion(promotionCandidate.recordClass, promotionCandidate.scope), null);
  assert.equal((await promotionStore.readCandidate(promotionCandidate.id))?.state, "VALIDATED");
  assert.deepEqual(
    (await promotionStore.events(promotionCandidate.id)).map((event) => event.state),
    ["FETCHED", "NORMALIZED", "VALIDATED"],
  );
});

test("the durable success clock follows the current proof-consistent pointer, not a later unpromoted attempt", async () => {
  const store = new MemoryRoutineDataStore();
  const current = candidate("current-promotion", "2026-09-08T12:00:00.000Z");
  const currentReceipt = await seedValidated(store, current);
  await store.promote(current.id, currentReceipt, "2026-09-08T12:01:00.000Z");
  const laterAttempt = candidate("later-unpromoted-attempt", "2026-09-08T14:00:00.000Z");
  await seedValidated(store, laterAttempt, receiptFor(laterAttempt), current.id);

  assert.deepEqual(await store.clock(current.sourceId, current.recordClass, current.scope), {
    lastAttemptedAt: laterAttempt.retrieval.retrievedAt,
    lastSucceededAt: current.retrieval.retrievedAt,
    lastSucceededObservedAt: current.retrieval.retrievedAt,
  });
});

test("a candidate cannot overwrite a pointer that moved after its LKG validation", async () => {
  const store = new MemoryRoutineDataStore();
  const base = candidate("base", "2026-09-08T12:00:00.000Z");
  const baseReceipt = await seedValidated(store, base);
  await store.promote(base.id, baseReceipt, "2026-09-08T12:01:00.000Z");

  // Both candidates were validated against `base`. The winner moves first;
  // the stale writer must not be able to replace a version it never saw.
  const winner = candidate("winner", "2026-09-08T13:00:00.000Z");
  const stale = candidate("stale", "2026-09-08T12:30:00.000Z");
  const winnerReceipt = await seedValidated(store, winner, receiptFor(winner), base.id);
  const staleReceipt = await seedValidated(store, stale, receiptFor(stale), base.id);
  await store.promote(winner.id, winnerReceipt, "2026-09-08T13:01:00.000Z");

  await assert.rejects(
    store.promote(stale.id, staleReceipt, "2026-09-08T13:02:00.000Z"),
    /PROMOTION_BASE_CHANGED:stale:expected=base:actual=winner/,
  );
  assert.equal((await store.readPromotion(stale.recordClass, stale.scope))?.versionId, winner.id);
  assert.equal((await store.readCandidate(stale.id))?.state, "VALIDATED");
  assert.deepEqual((await store.events(stale.id)).map((event) => event.state), ["FETCHED", "NORMALIZED", "VALIDATED"]);
});

test("an atomic pointer race becomes durable CANNOT_TELL evidence without changing LKG", async () => {
  const base = candidate("race-base", "2026-09-08T12:00:00.000Z");
  const winner = candidate("race-winner", "2026-09-08T13:00:00.000Z");
  class RacingStore extends MemoryRoutineDataStore {
    private raced = false;

    override async promote(candidateId: string, receipt: ValidationReceipt, at: string) {
      if (candidateId === "race-stale" && !this.raced) {
        this.raced = true;
        const winnerReceipt = await seedValidated(this, winner, receiptFor(winner), base.id);
        await super.promote(winner.id, winnerReceipt, "2026-09-08T13:01:00.000Z");
      }
      return super.promote(candidateId, receipt, at);
    }
  }

  const store = new RacingStore();
  const baseReceipt = await seedValidated(store, base);
  await store.promote(base.id, baseReceipt, "2026-09-08T12:01:00.000Z");
  const staleBase = candidate("race-stale", "2026-09-08T12:30:00.000Z");
  // Keep the member key unchanged so removal checks do not intercept the pointer race.
  const stale: RoutineCandidate = {
    ...staleBase,
    normalizedPayload: { rows: [{ id: base.id, amount: 2 }] },
    readModel: { candidates: [{ id: base.id, amount: 2 }] },
    normalization: {
      ...staleBase.normalization,
      normalizedHash: normalizedHash({ candidates: [{ id: base.id, amount: 2 }] }),
      normalizedPayloadHash: normalizedHash({ rows: [{ id: base.id, amount: 2 }] }),
    },
  };
  const outcome = await processRoutineCandidate(store, stale, "2026-09-08T13:02:00.000Z");

  assert.equal(outcome.promoted, null);
  assert.equal(outcome.candidate.state, "CANNOT_TELL");
  assert.equal(outcome.candidate.failureCode, "PROMOTION_BASE_CHANGED");
  assert.match(outcome.candidate.failureDetail ?? "", /current LKG remains live/i);
  assert.equal((await store.readPromotion(stale.recordClass, stale.scope))?.versionId, winner.id);
  assert.deepEqual(
    (await store.events(stale.id)).map((event) => event.state),
    ["FETCHED", "NORMALIZED", "VALIDATED", "CANNOT_TELL"],
  );
});

test("a terminal PROMOTED candidate cannot be rewritten or invalidate its live LKG proof", async () => {
  const store = new MemoryRoutineDataStore();
  const value = candidate("diverged-proof");
  const persisted = await seedValidated(store, value);
  await store.promote(value.id, persisted, "2026-09-08T12:01:00.000Z");
  const changed: ValidationReceipt = {
    ...structuredClone(persisted),
    validatedAt: "2026-09-08T12:00:01.000Z",
  };
  await assert.rejects(
    store.transition(value.id, "PROMOTED", "2026-09-08T12:02:00.000Z", "planted proof divergence", changed),
    /CANDIDATE_TRANSITION_INVALID:diverged-proof:PROMOTED:PROMOTED/,
  );

  assert.deepEqual(await store.clock(value.sourceId, value.recordClass, value.scope), {
    lastAttemptedAt: value.retrieval.retrievedAt,
    lastSucceededAt: value.retrieval.retrievedAt,
    lastSucceededObservedAt: value.retrieval.retrievedAt,
  });
  assert.equal((await store.readPromotion(value.recordClass, value.scope))?.versionId, value.id);
  assert.deepEqual((await store.events(value.id)).map((event) => event.state), ["FETCHED", "NORMALIZED", "VALIDATED", "PROMOTED"]);
});

test("candidate creation refuses a mismatched first event before persisting either half", async () => {
  const store = new MemoryRoutineDataStore();
  const value = candidate("mismatched-first-event");
  await assert.rejects(
    store.create({
      candidate: value,
      state: "FETCHED",
      acquisitionSucceeded: true,
      receipt: null,
      promotedVersion: null,
      lastKnownGoodVersion: null,
      failureCode: null,
      failureDetail: null,
    }, {
      candidateId: "another-candidate",
      sequence: 1,
      state: "FETCHED",
      at: value.retrieval.retrievedAt,
      detail: "mismatched event",
    }),
    /CANDIDATE_INITIAL_EVENT_INVALID:mismatched-first-event/,
  );
  assert.equal(await store.readCandidate(value.id), null);
  assert.deepEqual(await store.events(value.id), []);
});

test("candidate event time is a bounded local clock and never moves backward by sequence", async () => {
  const futureStore = new MemoryRoutineDataStore();
  const future = candidate("future-acquisition", "2999-01-01T00:00:00.000Z");
  const observedAt = "2026-09-08T12:00:00.000Z";
  await futureStore.create({
    candidate: future,
    state: "FETCHED",
    acquisitionSucceeded: true,
    receipt: null,
    promotedVersion: null,
    lastKnownGoodVersion: null,
    failureCode: null,
    failureDetail: null,
  }, {
    candidateId: future.id,
    sequence: 1,
    state: "FETCHED",
    at: observedAt,
    detail: "the local process observed a candidate claiming a future acquisition",
  });
  await futureStore.transition(future.id, "NORMALIZED", observedAt, "normalized before the claimed future instant");
  const futureFailure: ValidationReceipt = {
    ...receiptFor(future),
    decision: "FAIL",
    validatedAt: observedAt,
    checks: receiptFor(future).checks.map((check) => check.check === "TEMPORAL_VALIDITY" ? {
      ...check,
      verdict: "FAIL",
      code: "ACQUISITION_TIME_AFTER_VALIDATION",
      detail: "the acquisition instant is later than the local validation clock",
    } : check),
  };
  await futureStore.transition(
    future.id,
    "TEMPORAL_INVALID",
    observedAt,
    "the acquisition instant is later than the local validation clock",
    futureFailure,
    {
      code: "ACQUISITION_TIME_AFTER_VALIDATION",
      detail: "the acquisition instant is later than the local validation clock",
    },
  );
  assert.equal((await futureStore.readCandidate(future.id))?.state, "TEMPORAL_INVALID");
  assert.deepEqual((await futureStore.events(future.id)).map(({ at }) => at), [observedAt, observedAt, observedAt]);
  assert.deepEqual(await futureStore.clock(future.sourceId, future.recordClass, future.scope), {
    lastAttemptedAt: observedAt,
  }, "a refused future claim must not postpone the scheduler until the claimed year");

  const futureEventStore = new MemoryRoutineDataStore();
  const futureEvent = candidate("future-local-event", "2026-09-08T12:00:00.000Z");
  await assert.rejects(
    futureEventStore.create({
      candidate: futureEvent,
      state: "FETCHED",
      acquisitionSucceeded: true,
      receipt: null,
      promotedVersion: null,
      lastKnownGoodVersion: null,
      failureCode: null,
      failureDetail: null,
    }, {
      candidateId: futureEvent.id,
      sequence: 1,
      state: "FETCHED",
      at: "2999-01-01T00:00:00.000Z",
      detail: "materially future local event",
    }),
    /CANDIDATE_INITIAL_EVENT_INVALID:future-local-event/,
  );
  assert.equal(await futureEventStore.readCandidate(futureEvent.id), null);

  const backwardSequenceStore = new MemoryRoutineDataStore();
  const backwardSequence = candidate("event-clock-backward", "2026-09-08T12:00:00.000Z");
  await backwardSequenceStore.create({
    candidate: backwardSequence,
    state: "FETCHED",
    acquisitionSucceeded: true,
    receipt: null,
    promotedVersion: null,
    lastKnownGoodVersion: null,
    failureCode: null,
    failureDetail: null,
  }, {
    candidateId: backwardSequence.id,
    sequence: 1,
    state: "FETCHED",
    at: "2026-09-08T12:01:00.000Z",
    detail: "acquisition persisted after retrieval",
  });
  await assert.rejects(
    backwardSequenceStore.transition(
      backwardSequence.id,
      "NORMALIZED",
      "2026-09-08T12:00:30.000Z",
      "backdated normalization",
    ),
    /CANDIDATE_EVENT_TIME_INVALID:event-clock-backward:NORMALIZED/,
  );
  assert.equal((await backwardSequenceStore.readCandidate(backwardSequence.id))?.state, "FETCHED");
  assert.deepEqual((await backwardSequenceStore.events(backwardSequence.id)).map((event) => event.sequence), [1]);
});

test("a terminal transition requires exact non-GOOD receipt evidence and is immutable", async () => {
  const store = new MemoryRoutineDataStore();
  const value = candidate("terminal-proof");
  await store.create({
    candidate: value,
    state: "FETCHED",
    acquisitionSucceeded: true,
    receipt: null,
    promotedVersion: null,
    lastKnownGoodVersion: null,
    failureCode: null,
    failureDetail: null,
  }, {
    candidateId: value.id,
    sequence: 1,
    state: "FETCHED",
    at: value.retrieval.retrievedAt,
    detail: "persisted acquisition",
  });

  await assert.rejects(
    store.transition(value.id, "CANNOT_TELL", value.retrieval.retrievedAt, "unproved refusal"),
    /CANDIDATE_TRANSITION_RECEIPT_INVALID:terminal-proof:CANNOT_TELL/,
  );
  const refusal: ValidationReceipt = {
    ...receiptFor(value),
    decision: "CANNOT_TELL",
    checks: receiptFor(value).checks.map((check, index) => index === 0
      ? { ...check, verdict: "CANNOT_TELL", code: "SOURCE_UNCERTAIN", detail: "source proof is incomplete" }
      : check),
  };
  await store.transition(
    value.id,
    "CANNOT_TELL",
    value.retrieval.retrievedAt,
    "source proof is incomplete",
    refusal,
    { code: "SOURCE_UNCERTAIN", detail: "source proof is incomplete" },
  );
  await assert.rejects(
    store.transition(value.id, "NORMALIZED", value.retrieval.retrievedAt, "late rewrite"),
    /CANDIDATE_TRANSITION_INVALID:terminal-proof:CANNOT_TELL:NORMALIZED/,
  );
  assert.deepEqual((await store.events(value.id)).map((item) => item.state), ["FETCHED", "CANNOT_TELL"]);
});

test("append-only Reader evidence must be a receipt for the exact promoted contract and version", async () => {
  const store = new MemoryRoutineDataStore();
  const value = candidate("reader-evidence-boundary");
  const receipt = await seedValidated(store, value);
  await store.promote(value.id, receipt, "2026-09-08T12:01:00.000Z");
  await assert.rejects(
    store.appendEvidence(value.id, "PROMOTED", "2026-09-08T12:02:00.000Z", "untyped success assertion"),
    /CANDIDATE_READER_EVIDENCE_INVALID:reader-evidence-boundary/,
  );
  const readerReceipt = {
    contractVersion: 2 as const,
    kind: "READER_PROJECTION_READBACK" as const,
    contractId: "fec-funding",
    sourceId: value.sourceId,
    recordClass: value.recordClass,
    scope: value.scope,
    projectionId: "funding-snapshot",
    versionId: value.id,
    pointerKey: `${value.recordClass}:${value.scope}`,
    observedAt: "2026-09-08T12:02:00.000Z",
    evidenceKind: "TYPED_READER_READ_MODEL" as const,
    verifierId: "tests/civic-data-store-integrity.test.ts#reader",
    verifierCodeSha: "1".repeat(40),
    status: "PASS" as const,
    detail: "The exact typed funding Reader returned the promoted version.",
  };
  await assert.rejects(
    store.appendEvidence(
      value.id,
      "PROMOTED",
      readerReceipt.observedAt,
      serializeReaderProjectionReadback({ ...readerReceipt, projectionId: "invented-reader" }),
    ),
    /CANDIDATE_READER_EVIDENCE_INVALID:reader-evidence-boundary/,
  );
  assert.deepEqual((await store.events(value.id)).map((item) => item.state), ["FETCHED", "NORMALIZED", "VALIDATED", "PROMOTED"]);
  await store.appendEvidence(
    value.id,
    "PROMOTED",
    readerReceipt.observedAt,
    serializeReaderProjectionReadback(readerReceipt),
  );
  assert.equal((await store.events(value.id)).length, 5);
});

test("Reader proof cannot be appended after the canonical pointer leaves that version", async () => {
  const store = new MemoryRoutineDataStore();
  const old = candidate("reader-proof-old", "2026-09-08T12:00:00.000Z");
  const oldReceipt = await seedValidated(store, old);
  await store.promote(old.id, oldReceipt, "2026-09-08T12:01:00.000Z");
  const current = candidate("reader-proof-current", "2026-09-08T13:00:00.000Z");
  const currentReceipt = await seedValidated(store, current, receiptFor(current), old.id);
  await store.promote(current.id, currentReceipt, "2026-09-08T13:01:00.000Z");

  await assert.rejects(
    store.appendEvidence(
      old.id,
      "PROMOTED",
      "2026-09-08T13:02:00.000Z",
      serializeReaderProjectionReadback({
        contractVersion: 2,
        kind: "READER_PROJECTION_READBACK",
        contractId: "fec-funding",
        sourceId: old.sourceId,
        recordClass: old.recordClass,
        scope: old.scope,
        projectionId: "funding-snapshot",
        versionId: old.id,
        pointerKey: `${old.recordClass}:${old.scope}`,
        observedAt: "2026-09-08T13:02:00.000Z",
        evidenceKind: "TYPED_READER_READ_MODEL",
        verifierId: "tests/civic-data-store-integrity.test.ts#stale-reader",
        verifierCodeSha: "1".repeat(40),
        status: "PASS",
        detail: "A stale version cannot claim to be the current Reader projection.",
      }),
    ),
    /CANDIDATE_READER_EVIDENCE_INVALID:reader-proof-old/,
  );
  assert.equal((await store.readPromotion(old.recordClass, old.scope))?.versionId, current.id);
  assert.equal((await store.events(old.id)).length, 4);
});

test("production NODE_ENV alone cannot open the permanent routine-data writer", () => {
  assert.throws(
    () => assertRoutineDataStoreMutationAuthority({ NODE_ENV: "production", WTP_DB_ROLE: "production" }),
    /PERMANENT_RUNTIME_AUTHORITY_REFUSED:authority envelope is absent or malformed/,
  );
});

test("a contract-A runtime envelope cannot mutate contract B through the public store API", () => {
  const value = candidate("contract-authority-boundary");
  const authority = {
    repo: ROOT,
    sha: "1".repeat(40),
    capability: "ROUTINE_CONTRACT" as const,
    contract: "nh-members",
    parentPid: 123,
    nonce: "2".repeat(64),
  };
  assert.match(
    routineDataStoreCandidateAuthorityIssue(value, authority, "candidate") ?? "",
    /authority for nh-members cannot mutate fec-funding/,
  );
  assert.equal(
    routineDataStoreCandidateAuthorityIssue(value, { ...authority, contract: "fec-funding" }, "candidate"),
    null,
  );
  const malformedTransfer = {
    ...value,
    bootstrapImport: { kind: "UNRECOGNIZED_AUTHORITY_TRANSFER", contractId: "fec-funding" },
  } as unknown as RoutineCandidate;
  assert.match(
    routineDataStoreCandidateAuthorityIssue(
      malformedTransfer,
      { ...authority, contract: "fec-funding" },
      "candidate",
    ) ?? "",
    /ordinary ROUTINE_CONTRACT authority cannot write an authority-transfer marker/,
  );
  assert.match(
    routineDataStoreCandidateAuthorityIssue(
      malformedTransfer,
      { ...authority, capability: "TRUSTED_LKG_IMPORT", contract: null } as unknown as RuntimeAuthorityEnvelope,
      "candidate",
    ) ?? "",
    /contract fec-funding requires ROUTINE_CONTRACT, not TRUSTED_LKG_IMPORT/,
  );
  assert.match(
    routineDataStoreCandidateAuthorityIssue(
      value,
      { ...authority, capability: "ROUTINE_SUPERVISOR", contract: null },
      "candidate",
    ) ?? "",
    /routine supervisor cannot mutate source candidate fec-funding/,
  );
});

function selectList(query: { toSQL(): { sql: string } }): string {
  const text = query.toSQL().sql;
  return text.slice(0, text.indexOf(" from "));
}

test("Reader evidence names a pointer and a candidate by identity; neither dataset crosses the wire for it", () => {
  const pointer = selectList(promotedPointerIdentityRead(drizzle.mock({ schema }), "STATE_ROLL_CALL", ["US-NJ"]));
  assert.doesNotMatch(pointer, /"payload"|"validation_receipt"/);
  for (const column of ["key", "source_id", "record_class", "scope", "current_version_id", "last_known_good_version_id", "promoted_at"]) {
    assert.match(pointer, new RegExp(`"${column}"`), `the identity read must still carry ${column}`);
  }

  const evidence = selectList(readerEvidenceCandidateRead(drizzle.mock({ schema }), "cv-example"));
  assert.doesNotMatch(evidence, /"candidate"(?!\s*(?:->|\?))/, "the candidate envelope is never selected whole");
  assert.doesNotMatch(evidence, /"identity"|"validation_receipt"/);
  for (const column of ["id", "source_id", "record_class", "scope", "state"]) {
    assert.match(evidence, new RegExp(`"${column}"`), `the evidence read must still carry ${column}`);
  }

  const source = readFileSync(join(ROOT, "lib", "civic-data", "store.ts"), "utf8");
  const postgres = source.slice(source.indexOf("export class PostgresRoutineDataStore"));
  const append = postgres.slice(postgres.indexOf("  async appendEvidence("), postgres.indexOf("  async promote("));
  assert.match(append, /readerEvidenceCandidateRead\(this\.db, candidateId\)/);
  assert.doesNotMatch(append, /\.select\(\)/, "a whole-row read here moves the candidate envelope on every recorded readback");

  const verification = readFileSync(join(ROOT, "lib", "civic-data", "reader-verification.ts"), "utf8");
  assert.doesNotMatch(
    verification,
    /store\.readPromotions?\(|store\.readCandidates?\(/,
    "readback evidence reads identity; only the typed Reader reads and proves the dataset",
  );
  assert.match(verification, /store\.readPromotionIdentity\(contract\.recordClass, contract\.scope\)/);
  assert.match(verification, /store\.readPromotionIdentities\("MEETING", scopes\)/);
});

test("the Reader-evidence door's narrow read decides authority exactly as the whole envelope does", () => {
  const value = candidate("evidence-authority-parity");
  const contractAuthority = {
    repo: ROOT,
    sha: "1".repeat(40),
    capability: "ROUTINE_CONTRACT" as const,
    contract: "fec-funding",
    parentPid: 123,
    nonce: "2".repeat(64),
  };
  const supervisor = { ...contractAuthority, capability: "ROUTINE_SUPERVISOR" as const, contract: null };
  const envelopes: Array<[string, RoutineCandidate]> = [
    ["no marker", value],
    ["a present null marker", { ...value, bootstrapImport: null } as unknown as RoutineCandidate],
    ["a transfer marker", {
      ...value,
      bootstrapImport: { kind: "TRUSTED_LKG_IMPORT", contractId: "fec-funding" },
    } as unknown as RoutineCandidate],
  ];
  for (const [label, whole] of envelopes) {
    const hasBootstrapImport = Object.prototype.hasOwnProperty.call(whole, "bootstrapImport");
    // Postgres answers SQL NULL for an absent key and JSON null for a null
    // one; the driver parses both to null, and the key test tells them apart.
    const narrow = readerEvidenceRowToRecord({
      id: whole.id,
      sourceId: whole.sourceId,
      recordClass: whole.recordClass,
      scope: whole.scope,
      state: "PROMOTED",
      hasBootstrapImport,
      bootstrapImport: hasBootstrapImport ? whole.bootstrapImport ?? null : null,
    });
    assert.equal(narrow.state, "PROMOTED");
    for (const envelope of [contractAuthority, supervisor]) {
      for (const operation of ["candidate", "reader-evidence"] as const) {
        assert.equal(
          routineDataStoreCandidateAuthorityIssue(narrow.candidate, envelope, operation),
          routineDataStoreCandidateAuthorityIssue(whole, envelope, operation),
          `${label}: ${envelope.capability} ${operation}`,
        );
      }
    }
  }
});

test("the Postgres promotion transaction is selected from the exact persisted proof", () => {
  const source = readFileSync(join(ROOT, "lib", "civic-data", "store.ts"), "utf8");
  const promote = source.slice(source.indexOf("  async promote(candidateId", source.indexOf("export class Postgres")), source.indexOf("  async events(candidateId", source.indexOf("export class Postgres")));
  assert.match(promote, /validationReceipt\} = \$\{receiptJson\}::jsonb/);
  assert.match(promote, /state\} = 'VALIDATED'/);
  assert.match(promote, /insert\(civicDataPromotions\)\.select/);
  assert.match(promote, /insert\(civicDataCandidateEvents\)\.select/);
  assert.match(promote, /this\.db\.batch\(\[/);
  assert.match(promote, /setWhere:\s*expectedVersionId === null/);
  assert.match(promote, /civicDataPromotions\.currentVersionId, expectedVersionId/);
  assert.match(promote, /pointerOwnsCandidate/);
  assert.match(promote, /where \$\{eligibility\} and \$\{pointerOwnsCandidate\}/);
  assert.match(promote, /validationReceipt: persistedReceipt/);
  assert.doesNotMatch(promote, /validationReceipt: receipt[,\n]/);
  assert.doesNotMatch(promote, /\.returning\(\)/, "a bare RETURNING ships the whole payload or envelope back");
  assert.match(promote, /\.onConflictDoUpdate\(\{[\s\S]*\}\)\.returning\(PROMOTED_POINTER_COLUMNS\)/);
  assert.match(promote, /update\(civicDataCandidates\)[\s\S]*\.returning\(\{ candidateId: civicDataCandidates\.id \}\)/);
  assert.match(promote, /\$\{civicDataCandidates\.candidate\}->'readModel'/);
  assert.match(promote, /payload: candidate\.readModel,/);
  assert.doesNotMatch(promote, /select\(\)\.from\(civicDataPromotions\)/, "the prior pointer is read for its version id alone");
});

test("a promotion's RETURNING names the moved pointer and never carries its dataset", () => {
  const mock = drizzle.mock({ schema });
  const returning = (text: string) => text.slice(text.lastIndexOf(" returning ") + " returning ".length);
  const pointer = returning(mock.update(schema.civicDataPromotions)
    .set({ scope: "moved" })
    .returning(PROMOTED_POINTER_COLUMNS)
    .toSQL().sql);
  assert.doesNotMatch(pointer, /"payload"/);
  for (const column of [
    "key",
    "source_id",
    "record_class",
    "scope",
    "current_version_id",
    "last_known_good_version_id",
    "promoted_at",
    "validation_receipt",
  ]) {
    assert.match(pointer, new RegExp(`"${column}"`), `the promotion RETURNING must still name ${column}`);
  }
});

const NEON_TYPE = { text: 25, bool: 16, jsonb: 3802, timestamptz: 1184, void: 2278 } as const;
type NeonColumn = readonly [name: string, type: keyof typeof NEON_TYPE];
interface NeonAnswer {
  readonly columns: readonly NeonColumn[];
  readonly rows: readonly (readonly unknown[])[];
}
interface NeonStatement {
  readonly query: string;
  readonly params: readonly unknown[];
}

// Drives the real PostgresRoutineDataStore through the Neon driver's fetch seam, answered from canned rows; no network.
async function withCannedNeon<T>(
  answer: (statement: NeonStatement) => NeonAnswer,
  run: (store: PostgresRoutineDataStore, sent: NeonStatement[]) => Promise<T>,
): Promise<T> {
  const originalFetch = neonConfig.fetchFunction;
  const originalUrl = process.env.DATABASE_URL;
  const sent: NeonStatement[] = [];
  neonConfig.fetchFunction = (async (_endpoint: unknown, init: { readonly body: string }) => {
    const body = JSON.parse(init.body) as { query?: string; params?: unknown[]; queries?: NeonStatement[] };
    const statements = body.queries ?? [{ query: body.query ?? "", params: body.params ?? [] }];
    const results = statements.map((statement) => {
      if (statement.query.startsWith("INSERT INTO database_transfer_daily")) return { command: "INSERT", rowCount: 0, rowAsArray: true, fields: [], rows: [] };
      sent.push(statement);
      const { columns, rows } = answer(statement);
      return {
        command: "SELECT",
        rowCount: rows.length,
        rowAsArray: true,
        fields: columns.map(([name, type]) => ({ name, dataTypeID: NEON_TYPE[type] })),
        rows: rows.map((row) => row.map((value, index) =>
          value === null ? null
            : columns[index]?.[1] === "jsonb" ? JSON.stringify(value)
            : typeof value === "boolean" ? (value ? "t" : "f")
              : typeof value === "string" ? value
                : JSON.stringify(value))),
      };
    });
    return new Response(JSON.stringify(body.queries ? { results } : results[0]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof neonConfig.fetchFunction;
  process.env.DATABASE_URL = "postgresql://canned:canned@ep-canned-store-proof.us-east-2.aws.neon.tech/neondb";
  try {
    const store = new PostgresRoutineDataStore();
    Object.assign(store as unknown as Record<string, unknown>, {
      writeAuthority: {
        repo: ROOT,
        sha: "1".repeat(40),
        capability: "ROUTINE_CONTRACT",
        contract: "fec-funding",
        parentPid: 123,
        nonce: "2".repeat(64),
      } satisfies RuntimeAuthorityEnvelope,
    });
    return await run(store, sent);
  } finally {
    neonConfig.fetchFunction = originalFetch;
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
  }
}

function returningList(query: string): string | null {
  const at = query.lastIndexOf(" returning ");
  return at < 0 ? null : query.slice(at + " returning ".length);
}

test("Postgres promotion ships no dataset back and returns the pointer with the read model it copied", async () => {
  const value = candidate("postgres-promotion-returning", "2026-09-08T12:00:00.000Z", "fec-open-api");
  const persisted = receiptFor(value);
  const promotedAt = "2026-09-08T12:01:00.000Z";
  const candidateRow: readonly (readonly [NeonColumn, unknown])[] = [
    [["id", "text"], value.id],
    [["source_id", "text"], value.sourceId],
    [["record_class", "text"], value.recordClass],
    [["scope", "text"], value.scope],
    [["state", "text"], "VALIDATED"],
    [["acquisition_succeeded", "bool"], true],
    [["raw_hash", "text"], value.retrieval.rawHash],
    [["normalized_hash", "text"], value.normalization.normalizedHash],
    [["retrieved_at", "timestamptz"], "2026-09-08 12:00:00+00"],
    [["source_through", "text"], value.temporal.sourceThrough],
    [["parser_version", "text"], value.normalization.parserVersion],
    [["identity", "jsonb"], value.identities],
    [["candidate", "jsonb"], value],
    [["validation_receipt", "jsonb"], persisted],
    [["promoted_version_id", "text"], null],
    [["last_known_good_version_id", "text"], null],
    [["failure_code", "text"], null],
    [["failure_detail", "text"], null],
  ];
  const pointerRow: readonly (readonly [NeonColumn, unknown])[] = [
    [["key", "text"], `${value.recordClass}:${value.scope}`],
    [["source_id", "text"], value.sourceId],
    [["record_class", "text"], value.recordClass],
    [["scope", "text"], value.scope],
    [["current_version_id", "text"], value.id],
    [["last_known_good_version_id", "text"], value.id],
    [["promoted_at", "timestamptz"], "2026-09-08 12:01:00+00"],
    [["validation_receipt", "jsonb"], persisted],
  ];
  const answer = (cells: readonly (readonly [NeonColumn, unknown])[]): NeonAnswer => ({
    columns: cells.map(([column]) => column),
    rows: [cells.map(([, cell]) => cell)],
  });
  const none: NeonAnswer = { columns: [], rows: [] };

  const promoted = await withCannedNeon((statement) => {
    const text = statement.query;
    if (/^select pg_advisory_xact_lock/.test(text.trim())) return { columns: [["pg_advisory_xact_lock", "void"]], rows: [[""]] };
    if (text.startsWith("select") && text.includes(`from "civic_data_candidates"`)) return answer(candidateRow);
    if (text.startsWith("select") && text.includes(`from "civic_data_promotions"`)) return none;
    if (text.startsWith(`insert into "civic_data_promotions"`)) return answer(pointerRow);
    if (text.startsWith(`insert into "civic_data_candidate_events"`)) return none;
    if (text.startsWith(`update "civic_data_candidates"`)) return { columns: [["id", "text"]], rows: [[value.id]] };
    throw new Error(`unexpected statement: ${text.slice(0, 80)}`);
  }, async (store, sent) => {
    // Judge the statements sent before the answer is mapped, so a whole-row
    // RETURNING fails on what it asked for, not on the canned reply's shape.
    const settled = await store.promote(value.id, structuredClone(persisted), promotedAt)
      .then((result) => ({ result }), (error: unknown) => ({ error }));

    const priorRead = sent.find(({ query }) => query.startsWith("select") && query.includes(`from "civic_data_promotions"`));
    assert.match(priorRead?.query ?? "", /^select "current_version_id" from "civic_data_promotions"/, "the prior pointer is read for its version id alone");
    const pointerWrite = sent.find(({ query }) => query.startsWith(`insert into "civic_data_promotions"`));
    assert.match(pointerWrite?.query ?? "", /"candidate"->'readModel'/, "the pointer's payload is still copied server-side from the candidate");
    const pointerReturning = returningList(pointerWrite?.query ?? "");
    assert.ok(pointerReturning !== null, "the pointer write still reports the moved pointer");
    assert.doesNotMatch(pointerReturning ?? "", /"payload"/, "the promoted payload is not shipped back");
    const candidateWrite = sent.find(({ query }) => query.startsWith(`update "civic_data_candidates"`));
    assert.equal(returningList(candidateWrite?.query ?? ""), `"id"`, "the candidate write returns its id, never the envelope");
    if ("error" in settled) throw settled.error;
    return settled.result;
  });

  assert.deepEqual(promoted, {
    key: `${value.recordClass}:${value.scope}`,
    sourceId: value.sourceId,
    recordClass: value.recordClass,
    scope: value.scope,
    versionId: value.id,
    lastKnownGoodVersionId: value.id,
    promotedAt,
    payload: value.readModel,
    receipt: persisted,
  });
});

test("the prepared projection's coupling read carries no composed payload", () => {
  const select = selectList(preparedProjectionCouplingRead(drizzle.mock({ schema }), "MEETING", "composed-reader-snapshot"));
  assert.doesNotMatch(select, /"payload"/);
  for (const column of ["record_class", "scope", "sequence", "composed_from", "generated_at"]) {
    assert.match(select, new RegExp(`"${column}"`), `the coupling read must still carry ${column}`);
  }
});

test("a candidate summary is every row column but the envelope and identity set", () => {
  const select = selectList(candidateSummaryRead(drizzle.mock({ schema }), "cv-example"));
  assert.doesNotMatch(select, /"candidate"|"identity"/);
  for (const column of ["id", "source_id", "record_class", "scope", "state", "acquisition_succeeded", "validation_receipt", "promoted_version_id", "last_known_good_version_id", "failure_code", "failure_detail"]) {
    assert.match(select, new RegExp(`"${column}"`), `the summary must still carry ${column}`);
  }
});

test("a Postgres transition never reads the envelope the caller holds; it verifies it and returns it", async () => {
  const value = candidate("postgres-transition-narrow");
  const at = "2026-09-08T12:00:00.000Z";
  const wholeRow: readonly (readonly [NeonColumn, unknown])[] = [
    [["id", "text"], value.id],
    [["source_id", "text"], value.sourceId],
    [["record_class", "text"], value.recordClass],
    [["scope", "text"], value.scope],
    [["state", "text"], "FETCHED"],
    [["acquisition_succeeded", "bool"], true],
    [["raw_hash", "text"], value.retrieval.rawHash],
    [["normalized_hash", "text"], value.normalization.normalizedHash],
    [["retrieved_at", "timestamptz"], "2026-09-08 12:00:00+00"],
    [["source_through", "text"], value.temporal.sourceThrough],
    [["parser_version", "text"], value.normalization.parserVersion],
    [["identity", "jsonb"], value.identities],
    [["candidate", "jsonb"], value],
    [["validation_receipt", "jsonb"], null],
    [["promoted_version_id", "text"], null],
    [["last_known_good_version_id", "text"], null],
    [["failure_code", "text"], null],
    [["failure_detail", "text"], null],
  ];
  const summaryRow = wholeRow
    .filter(([[name]]) => !["raw_hash", "normalized_hash", "retrieved_at", "source_through", "parser_version", "identity", "candidate"].includes(name))
    .map(([column, cell]) => [column, column[0] === "state" ? "NORMALIZED" : cell] as const);
  const answer = (cells: readonly (readonly [NeonColumn, unknown])[]): NeonAnswer => ({
    columns: cells.map(([column]) => column),
    rows: [cells.map(([, cell]) => cell)],
  });
  const cell = (name: string) => wholeRow.find(([[column]]) => column === name)!;
  const transitionRow: readonly (readonly [NeonColumn, unknown])[] = [
    cell("id"), cell("source_id"), cell("record_class"), cell("scope"), cell("state"),
    [["has_bootstrap_import", "bool"], false], [["bootstrap_import", "jsonb"], null],
    cell("retrieved_at"), cell("raw_hash"), cell("normalized_hash"),
  ];
  const envelopeSelected = (select: string) => /"candidate"(?!\s*(?:->|\?))/.test(select);
  const canned = (statement: NeonStatement): NeonAnswer => {
    const text = statement.query;
    if (/^select pg_advisory_xact_lock/.test(text.trim())) return { columns: [["pg_advisory_xact_lock", "void"]], rows: [[""]] };
    if (text.startsWith("with ")) {
      return {
        columns: [["id", "text"], ["candidate_id", "text"], ["sequence", "text"], ["state", "text"], ["at", "timestamptz"], ["detail", "text"]],
        rows: [["00000000-0000-4000-8000-000000000001", value.id, "2", "NORMALIZED", "2026-09-08 12:00:00+00", "normalized"]],
      };
    }
    if (text.startsWith("select") && text.includes(`from "civic_data_candidates"`)) {
      const select = selectList({ toSQL: () => ({ sql: text }) });
      if (/"raw_hash"/.test(select)) return answer(transitionRow);
      if (envelopeSelected(select)) return answer([cell("candidate")]);
      return answer(summaryRow);
    }
    throw new Error(`unexpected statement: ${text.slice(0, 80)}`);
  };
  const candidateReads = (sent: readonly NeonStatement[]) =>
    sent.filter(({ query }) => query.startsWith("select") && query.includes(`from "civic_data_candidates"`))
      .map(({ query }) => selectList({ toSQL: () => ({ sql: query }) }));

  const result = await withCannedNeon(canned, async (store, sent) => {
    const record = await store.transition(value.id, "NORMALIZED", at, "normalized", undefined, undefined, { candidate: value });
    const reads = candidateReads(sent);
    assert.equal(reads.length, 2, "the pre-read and the post-write read");
    assert.equal(reads.some(envelopeSelected), false, "no read carries the envelope: the caller holds it");
    assert.match(reads[0]!, /"retrieved_at"/, "the pre-read carries the retrieval instant a VALIDATED receipt is checked against");
    assert.match(reads[0]!, /"raw_hash"/);
    assert.match(reads[0]!, /"normalized_hash"/);
    assert.doesNotMatch(reads[0]!, /"identity"|"validation_receipt"/);
    assert.doesNotMatch(reads[1]!, /"candidate"|"identity"/, "the post-write read carries the row's columns, never the envelope");
    assert.ok(sent.some(({ query }) => /^with "updated_candidate" as \(update "civic_data_candidates"/.test(query)), "the compare-and-set CTE is unchanged");
    return record;
  });
  assert.equal(result.state, "NORMALIZED");
  assert.deepEqual(result.candidate, value, "the returned record carries the durable envelope");
  assert.equal(result.receipt, null);

  // A held envelope that is not this row's is refused before anything is written.
  for (const mismatched of [
    { ...value, normalization: { ...value.normalization, normalizedHash: "f".repeat(64) } },
    { ...value, retrieval: { ...value.retrieval, rawHash: "e".repeat(64) } },
    { ...value, retrieval: { ...value.retrieval, retrievedAt: "2026-09-08T12:00:01.000Z" } },
    { ...value, scope: `${value.scope}-other` },
  ] as RoutineCandidate[]) {
    await withCannedNeon(canned, async (store, sent) => {
      await assert.rejects(
        store.transition(value.id, "NORMALIZED", at, "normalized", undefined, undefined, { candidate: mismatched }),
        /CANDIDATE_TRANSITION_ENVELOPE_MISMATCH/,
      );
      assert.equal(sent.some(({ query }) => query.startsWith("with ")), false, "no state change and no event for a mismatched envelope");
    });
  }

  const unheld = await withCannedNeon(canned, async (store, sent) => {
    const record = await store.transition(value.id, "NORMALIZED", at, "normalized");
    const reads = candidateReads(sent);
    assert.equal(reads.length, 3, "the pre-read, the post-write read, and the envelope");
    assert.equal(reads.filter(envelopeSelected).length, 1, "the envelope is read once");
    assert.equal(envelopeSelected(reads[0]!), false, "and never by the pre-read");
    return record;
  });
  assert.deepEqual(unheld.candidate, value);
});

test("promotion hands every transition the candidate it already holds", async () => {
  const store = new MemoryRoutineDataStore();
  const value = candidate("promotion-holds-envelope");
  const held: { state: string; candidate: RoutineCandidate | undefined }[] = [];
  const spying = new Proxy(store, {
    get(target, property, receiver) {
      if (property !== "transition") return Reflect.get(target, property, receiver);
      return (...args: Parameters<MemoryRoutineDataStore["transition"]>) => {
        held.push({ state: args[1], candidate: args[6]?.candidate });
        return target.transition(...args);
      };
    },
  });
  const outcome = await processRoutineCandidate(spying, value, "2026-09-08T12:01:00.000Z");
  assert.equal(outcome.candidate.state, "PROMOTED");
  assert.deepEqual(held.map(({ state }) => state), ["NORMALIZED", "VALIDATED"]);
  const durable = (await store.readCandidate(value.id))!.candidate;
  assert.ok(durable.changeSet, "precondition: promotion stores the envelope with its change set");
  for (const step of held) assert.deepEqual(step.candidate, durable, `${step.state} was handed the envelope promotion holds`);
  assert.deepEqual(outcome.candidate.candidate, durable);

  const other = candidate("promotion-holds-envelope-2");
  await store.create({
    candidate: other, state: "FETCHED", acquisitionSucceeded: true, receipt: null,
    promotedVersion: null, lastKnownGoodVersion: null, failureCode: null, failureDetail: null,
  }, { candidateId: other.id, sequence: 1, state: "FETCHED", at: other.retrieval.retrievedAt, detail: "acquired" });
  await assert.rejects(
    store.transition(other.id, "NORMALIZED", other.retrieval.retrievedAt, "normalized", undefined, undefined, {
      candidate: { ...other, normalization: { ...other.normalization, normalizedHash: "f".repeat(64) } },
    }),
    /CANDIDATE_TRANSITION_ENVELOPE_MISMATCH/,
  );
  assert.equal((await store.readCandidateSummary(other.id))?.state, "FETCHED", "nothing moved");
});

test("every Postgres candidate-event allocator is serialized inside its Neon batch", () => {
  const source = readFileSync(join(ROOT, "lib", "civic-data", "store.ts"), "utf8");
  const postgres = source.slice(source.indexOf("export class PostgresRoutineDataStore"));
  const transition = postgres.slice(postgres.indexOf("  async transition("), postgres.indexOf("  async readCandidate("));
  const append = postgres.slice(postgres.indexOf("  async appendEvidence("), postgres.indexOf("  async promote("));
  const promote = postgres.slice(postgres.indexOf("  async promote("), postgres.indexOf("  async events("));

  assert.match(postgres, /pg_advisory_xact_lock\(hashtextextended\(/);
  assert.match(postgres, /coalesce\(max\(\$\{civicDataCandidateEvents\.sequence\}\), 0\) \+ 1/);
  for (const operation of [transition, append, promote]) {
    assert.match(operation, /this\.db\.batch\(\[/);
    assert.match(operation, /this\.candidateEventLock\(candidateId\)/);
    assert.match(operation, /nextCandidateEventSequence\(candidateId\)/);
    assert.doesNotMatch(operation, /eventRows\.length \+ 1/);
  }
  assert.match(transition, /priorStateEligible/);
  assert.match(transition, /\$with\("updated_candidate"\)\.as\(/);
  assert.match(transition, /update\(civicDataCandidates\)[\s\S]*where\(priorStateEligible\)/);
  assert.match(transition, /with\(updatedCandidate\)\s*\.insert\(civicDataCandidateEvents\)/);
  assert.match(transition, /from \$\{updatedCandidate\}/);
  assert.doesNotMatch(
    transition,
    /const\s+eventWrite[\s\S]*const\s+candidateWrite/,
    "a transition event and its compare-and-set must not be separate writes",
  );
  assert.match(transition, /if \(!eventRows\[0\] \|\| !updatedRows\[0\]\)/);
  assert.match(append, /assertReaderEvidenceInput\(record, state, at, detail, authority\)/);
  assert.match(append, /civicDataPromotions\.currentVersionId\} = \$\{candidateId\}/);
  assert.match(append, /civicDataPromotions\.lastKnownGoodVersionId\} = \$\{candidateId\}/);
});

test("the Postgres retry clock keeps failed attempts local and uses an observed source check for successful held-byte replay", () => {
  const source = readFileSync(join(ROOT, "lib", "civic-data", "store.ts"), "utf8");
  const postgres = source.slice(source.indexOf("export class PostgresRoutineDataStore"));
  const clock = postgres.slice(postgres.indexOf("  async clock("));
  assert.match(clock, /CASE WHEN \$\{civicDataCandidates\.state\} = 'PROMOTED'[\s\S]*\$\{civicDataCandidates\.acquisitionSucceeded\} = true/);
  assert.match(clock, /THEN LEAST\([\s\S]*retrieval,sourceCheck,checkedAt[\s\S]*civicDataCandidateEvents\.at[\s\S]*ELSE \$\{civicDataCandidateEvents\.at\} END/);
  assert.match(clock, /select\(\{ attemptedAt: attemptAt \}\)/);
  assert.match(clock, /eq\(civicDataCandidateEvents\.sequence, 1\)/);
  assert.match(clock, /orderBy\(desc\(attemptAt\)\)/);
  assert.doesNotMatch(
    clock,
    /orderBy\(desc\(civicDataCandidates\.retrievedAt\)\)/,
    "an untrusted future retrievedAt would postpone a source retry",
  );
});

test("every Postgres civic-data mutation proves the sanctioned runtime authority before touching the database", () => {
  const source = readFileSync(join(ROOT, "lib", "civic-data", "store.ts"), "utf8");
  const postgres = source.slice(source.indexOf("export class PostgresRoutineDataStore"));
  const authorityDoor = source.slice(
    source.indexOf("export function assertRoutineDataStoreMutationAuthority"),
    source.indexOf("export class PromotionBaseChangedError"),
  );
  assert.match(postgres, /private assertMutationAuthority\(\): RuntimeAuthorityEnvelope/);
  assert.match(authorityDoor, /assertWriteAllowed\(CIVIC_DATA_PROMOTION_OPERATION, env\)/);
  assert.match(authorityDoor, /assertSanctionedRuntimeAuthority\(CIVIC_DATA_PROMOTION_OPERATION, env\)/);
  assert.match(postgres, /routineDataStoreCandidateAuthorityIssue/);

  const methods = [
    "create",
    "transition",
    "appendEvidence",
    "promote",
  ] as const;
  for (const [index, method] of methods.entries()) {
    const start = postgres.indexOf(`  async ${method}(`);
    const end = index + 1 < methods.length
      ? postgres.indexOf(`  async ${methods[index + 1]}(`, start)
      : postgres.indexOf("  async events(", start);
    assert.ok(start >= 0 && end > start, `${method}: Postgres mutation method is missing`);
    const body = postgres.slice(start, end);
    const authority = body.search(/this\.assert(?:Candidate)?MutationAuthority\(/);
    const databaseUse = body.search(/this\.db\.|this\.candidateEventLock\(|this\.nextCandidateEventSequence\(/);
    assert.ok(authority >= 0, `${method}: sanctioned runtime authority is not checked`);
    assert.ok(databaseUse < 0 || authority < databaseUse, `${method}: database work begins before authority is proved`);
  }
});

test("terminal store exposes no one-time import or aggregate retirement door", () => {
  const source = readFileSync(join(ROOT, "lib", "civic-data", "store.ts"), "utf8");
  const adapter = readFileSync(join(ROOT, "lib", "civic-data", "candidate-integrity.ts"), "utf8");
  const memory = new MemoryRoutineDataStore();
  const retiredMember = /^(?:assertPdcV2|retirePdcV2)/;
  for (const target of [memory, Object.getPrototypeOf(memory)]) {
    assert.deepEqual(Object.getOwnPropertyNames(target).filter((name) => retiredMember.test(name)), []);
  }
  const retiredDeclaration = /\b(?:assertPdcV2|retirePdcV2)\w*\s*\(/;
  assert.doesNotMatch(source, retiredDeclaration);
  assert.doesNotMatch(adapter, retiredDeclaration);
});


test("every jurisdiction roll-call candidate uses bounded immutable parts before insertion", async () => {
  const contract = ROUTINE_SOURCE_CONTRACTS.find(row => row.recordClass === "STATE_ROLL_CALL")!;
  const base = candidate("bounded-roll-call", "2026-09-08T12:00:00.000Z", contract.sourceId);
  const evidence = { positions: Array.from({ length: 160 }, (_, index) => ({ id: String(index), text: "published ".repeat(1000) })) };
  const value: RoutineCandidate = { ...base, recordClass: contract.recordClass, scope: contract.scope,
    normalizedPayload: evidence, readModel: { rollCalls: evidence.positions },
    normalization: { ...base.normalization, normalizedHash: normalizedHash({ rollCalls: evidence.positions }), normalizedPayloadHash: normalizedHash(evidence) },
  };
  await withCannedNeon(() => ({ columns: [], rows: [] }), async (store, sent) => {
    Object.assign(store as unknown as Record<string, unknown>, { writeAuthority: {
      repo: ROOT, sha: "1".repeat(40), capability: "ROUTINE_CONTRACT", contract: contract.id,
      parentPid: 123, nonce: "2".repeat(64),
    } satisfies RuntimeAuthorityEnvelope });
    await store.create({ candidate: value, state: "FETCHED", acquisitionSucceeded: true,
      receipt: null, promotedVersion: null, lastKnownGoodVersion: null, failureCode: null, failureDetail: null },
      { candidateId: value.id, sequence: 1, state: "FETCHED", at: value.retrieval.retrievedAt, detail: "Publisher read held" });
    const partWrites = sent.filter(row => row.query.startsWith('insert into "civic_data_payload_parts"'));
    assert.ok(partWrites.length > 0);
    assert.ok(partWrites.every(row => Buffer.byteLength(JSON.stringify(row.params)) < 3 * 1024 * 1024));
    const candidateWrite = sent.find(row => row.query.startsWith('insert into "civic_data_candidates"'))!;
    const envelope = candidateWrite.params.filter((row): row is string => typeof row === "string").flatMap(row => {
      try { const parsed = JSON.parse(row); return parsed?.id === value.id ? [parsed] : []; } catch { return []; }
    })[0];
    assert.equal(envelope.id, value.id);
    assert.ok(Buffer.byteLength(JSON.stringify(envelope)) < 32 * 1024);
    assert.deepEqual(envelope.retrieval, value.retrieval);
    assert.deepEqual(envelope.normalization, value.normalization);
  });
});

for (const family of STATE_BALLOT_FAMILIES) test(`${family} stores bounded state parts and reads one published payload with source metadata`, async () => {
  const id = stateBallotContractId(family, "AZ");
  const manual = MANUAL_PRODUCTION_SOURCE_CONTRACTS.find(row => row.id === id);
  const contract = manual ?? ROUTINE_SOURCE_CONTRACTS.find(row => row.id === id)!;
  const base = candidate(`bounded-${id}`, "2026-09-08T12:00:00.000Z", contract.sourceId);
  const payload = { rows: Array.from({ length: 80 }, (_, index) => ({ id: `US-AZ:${index}`, text: "published ".repeat(1000) })) };
  const value: RoutineCandidate = { ...base, recordClass: contract.recordClass, scope: contract.scope,
    normalizedPayload: payload, readModel: payload,
    retrieval: { ...base.retrieval,
      manualSourceReceipt: { contractVersion: 1, reviewedAt: base.retrieval.retrievedAt, reviewedBy: "source publisher",
        sources: [{ requestedUrl: "https://az.gov/ballot", finalUrl: "https://az.gov/ballot", publisher: "Arizona",
          sourceClass: "ELECTION_AUTHORITY", retrievedAt: base.retrieval.retrievedAt, httpStatus: 200,
          rawHash: HASH, reviewedEvidence: "Official source contents ".repeat(3000) }] },
      derived: { inputs: Array.from({ length: 400 }, (_, index) => ({ kind: "VAULTED_EVIDENCE" as const,
        artifactId: `evidence-${index}`, contentHash: `sha256-${HASH}`, tier: "RAW" as const, retrievedAt: base.retrieval.retrievedAt })) },
    },
    normalization: { ...base.normalization, normalizedHash: normalizedHash(payload), normalizedPayloadHash: normalizedHash(payload) },
  };
  const receipt = receiptFor(value);
  const parts = new Map<string, unknown>();
  let envelope: RoutineCandidate;
  const none: NeonAnswer = { columns: [], rows: [] };
  await withCannedNeon(({ query, params }) => {
    if (query.startsWith('insert into "civic_data_payload_parts"')) {
      for (let at = 0; at < params.length; at += 2) parts.set(String(params[at]), JSON.parse(String(params[at + 1])));
      return none;
    }
    if (query.includes('from "civic_data_payload_parts"')) {
      const hashes = params.filter((hash): hash is string => typeof hash === "string" && parts.has(hash));
      return query.startsWith('select "hash" from')
        ? { columns: [["hash", "text"]], rows: hashes.map(hash => [hash]) }
        : { columns: [["hash", "text"], ["payload", "jsonb"]], rows: hashes.map(hash => [hash, parts.get(hash)]) };
    }
    if (query.startsWith('insert into "civic_data_candidates"')) {
      envelope = params.filter((row): row is string => typeof row === "string").flatMap(row => {
        try { const parsed = JSON.parse(row); return parsed?.id === value.id ? [parsed] : []; } catch { return []; }
      })[0];
      return none;
    }
    if (query.includes('from "civic_data_promotions"')) return {
      columns: [["key", "text"], ["source_id", "text"], ["record_class", "text"], ["scope", "text"],
        ["current_version_id", "text"], ["last_known_good_version_id", "text"], ["promoted_at", "timestamptz"],
        ["payload", "jsonb"], ["validation_receipt", "jsonb"], ["latestConfirmation", "text"]],
      rows: [[`${value.recordClass}:${value.scope}`, value.sourceId, value.recordClass, value.scope, value.id, value.id,
        "2026-09-08T12:01:00.000Z", envelope.readModel, receipt, null]],
    };
    if (query.includes('from "civic_data_candidates"')) {
      const isMetadata = /'retrieval'\) - 'derived'/.test(query);
      assert.ok(isMetadata || query.includes("case when"), "only published metadata and candidate proof projections are read");
      const metadata = publishedCandidateMetadata({ candidate: envelope, state: "PROMOTED", acquisitionSucceeded: true,
        receipt, promotedVersion: value.id, lastKnownGoodVersion: value.id, failureCode: null, failureDetail: null });
      return { columns: [["id", "text"], ["candidate", "jsonb"], ["state", "text"], ["acquisition_succeeded", "bool"],
        ["receipt", "jsonb"], ["promoted_version_id", "text"], ["last_known_good_version_id", "text"], ["failure_code", "text"], ["failure_detail", "text"]],
      rows: [[value.id, isMetadata ? metadata.candidate : envelope, "PROMOTED", true, receipt, value.id, value.id, null, null]] };
    }
    return none;
  }, async (store, sent) => {
    Object.assign(store as unknown as Record<string, unknown>, { writeAuthority: {
      repo: ROOT, sha: "1".repeat(40), capability: manual ? "MANUAL_CONTRACT" : "ROUTINE_CONTRACT", contract: id,
      parentPid: 123, nonce: "2".repeat(64),
    } satisfies RuntimeAuthorityEnvelope });
    await store.create({ candidate: value, state: "FETCHED", acquisitionSucceeded: true,
      receipt: null, promotedVersion: null, lastKnownGoodVersion: null, failureCode: null, failureDetail: null },
      { candidateId: value.id, sequence: 1, state: "FETCHED", at: value.retrieval.retrievedAt, detail: "Publisher read held" });
    const writes = sent.filter(row => row.query.startsWith("insert into"));
    assert.ok(parts.size > 0);
    assert.ok(writes.every(row => Buffer.byteLength(JSON.stringify(row.params)) < 3 * 1024 * 1024));
    assert.ok(Buffer.byteLength(JSON.stringify(envelope!)) < 32 * 1024);
    assert.equal(envelope!.retrieval.retrievedAt, value.retrieval.retrievedAt);
    assert.deepEqual(envelope!.normalization, value.normalization);
    const decoded = await new CivicPayloadParts({ existing: async () => [], write: async () => {},
      read: async hashes => hashes.map(hash => ({ hash, payload: parts.get(hash) })),
    }).load(envelope!);
    assert.deepEqual(decodeStateCandidate(decoded), value, "source evidence, identities, and reader values survive the encoding exactly");
    const readAt = sent.length;
    const lineageRef = (envelope!.retrieval.derived as unknown as { $civicPayloadPart: string }).$civicPayloadPart;
    assert.equal(typeof lineageRef, "string");
    const metadata = await store.readPublishedCandidateMetadata(value.id);
    assert.deepEqual(metadata?.candidate.retrieval.manualSourceReceipt, value.retrieval.manualSourceReceipt);
    assert.equal(metadata?.candidate.retrieval.derived, undefined);
    const read = await readPromotedCivicData(value.recordClass, value.scope, { store, bypassCache: true });
    assert.equal(read.kind, "PROMOTED", JSON.stringify(read.kind === "PROMOTED" ? {} : read));
    if (read.kind === "PROMOTED") assert.deepEqual(read.value, payload);
    assert.ok(sent.slice(readAt).every(row => !row.params.includes(lineageRef)), "metadata and published reads leave lineage parts unopened");
    const partReads = () => sent.filter(row => row.query.includes('from "civic_data_payload_parts"') && !row.query.startsWith('select "hash" from')).length;
    let readCount = partReads();
    const repeatedMetadata = await store.readPublishedCandidateMetadata(value.id);
    assert.ok(partReads() > readCount, "state metadata does not retain decoded source parts between reads");
    assert.deepEqual(repeatedMetadata?.candidate.retrieval.manualSourceReceipt, value.retrieval.manualSourceReceipt);
    for (const batch of [false, true]) {
      readCount = partReads();
      const prior = batch ? (await store.readPromotions<typeof payload>(value.recordClass, [value.scope]))[0]
        : await store.readPromotion<typeof payload>(value.recordClass, value.scope);
      assert.ok(prior);
      assert.ok(partReads() > readCount, "every state pointer read releases the preceding raw-part cache");
      prior.payload.rows[0].text = "Updated in the working state";
      prior.payload.rows.splice(1, 1);
    }
    const unchanged = await store.readPromotion<typeof payload>(value.recordClass, value.scope);
    assert.deepEqual(unchanged?.payload, payload, "mutable state assembly cannot alter a later published read");
    for (const batch of [false, true]) {
      readCount = partReads();
      const proof = batch ? (await store.readCandidateProofs([value.id]))[0]?.record : await store.readCandidateProof(value.id);
      assert.ok(partReads() > readCount, "state proof reads cannot populate the store's persistent part cache");
      assert.deepEqual(proof?.candidate.readModel, payload);
    }
  });
});


test("state promotion reuses its validated payload and reads only persisted envelope metadata", async () => {
  const contract = MANUAL_PRODUCTION_SOURCE_CONTRACTS.find(row => row.id === "ballot-contests:AZ")!;
  const payload = { ballots: { "US-AZ:2026-general": { contests: [] } } };
  const value = immutableStateCandidate({ ...candidate("state-held-promotion", "2026-09-08T12:00:00.000Z", contract.sourceId),
    recordClass: contract.recordClass, scope: contract.scope, readModel: payload, normalizedPayload: payload,
    normalization: { ...candidate("metadata").normalization, normalizedHash: normalizedHash(payload), normalizedPayloadHash: normalizedHash(payload) },
  });
  const receipt = receiptFor(value), at = "2026-09-08T12:01:00.000Z";
  const cells: readonly (readonly [NeonColumn, unknown])[] = [
    [["id", "text"], value.id], [["source_id", "text"], value.sourceId], [["record_class", "text"], value.recordClass],
    [["scope", "text"], value.scope], [["state", "text"], "VALIDATED"], [["acquisition_succeeded", "bool"], true],
    [["validation_receipt", "jsonb"], receipt], [["promoted_version_id", "text"], null], [["last_known_good_version_id", "text"], null],
    [["failure_code", "text"], null], [["failure_detail", "text"], null], [["retrieved_at", "timestamptz"], value.retrieval.retrievedAt],
    [["raw_hash", "text"], value.retrieval.rawHash], [["normalized_hash", "text"], value.normalization.normalizedHash],
    [["normalizedPayloadHash", "text"], value.normalization.normalizedPayloadHash],
  ];
  const pointer: NeonAnswer = { columns: [["key", "text"], ["source_id", "text"], ["record_class", "text"], ["scope", "text"],
    ["current_version_id", "text"], ["last_known_good_version_id", "text"], ["promoted_at", "timestamptz"], ["validation_receipt", "jsonb"]],
  rows: [[`${value.recordClass}:${value.scope}`, value.sourceId, value.recordClass, value.scope, value.id, value.id, at, receipt]] };
  await withCannedNeon(({ query }) => {
    if (query.startsWith("select") && query.includes('from "civic_data_candidates"')) {
      assert.doesNotMatch(query, /"identity"|"candidate"(?:,| from)/);
      return { columns: cells.map(([column]) => column), rows: [cells.map(([, cell]) => cell)] };
    }
    if (query.startsWith('insert into "civic_data_promotions"')) return pointer;
    if (query.startsWith('update "civic_data_candidates"')) return { columns: [["id", "text"]], rows: [[value.id]] };
    return { columns: [], rows: [] };
  }, async (store, sent) => {
    Object.assign(store as unknown as Record<string, unknown>, { writeAuthority: { repo: ROOT, sha: "1".repeat(40),
      capability: "MANUAL_CONTRACT", contract: contract.id, parentPid: 123, nonce: "2".repeat(64) } });
    const published = await store.promote(value.id, receipt, at, { candidate: value });
    assert.equal(published.payload, value.readModel);
    assert.equal(sent.filter(row => row.query.includes('from "civic_data_candidates"') && row.query.startsWith("select")).length, 1);
    assert.ok(sent.every(row => !row.query.includes('from "civic_data_payload_parts"')));
    await assert.rejects(() => store.promote(value.id, receipt, at, { candidate: { ...value, readModel: { forged: true } } }), /ENVELOPE_MISMATCH/);
  });
});

test("state readback reuses only the exact durable pointer inside its publication job", async () => {
  const value = { ...candidate("state-readback-held"), recordClass: "BALLOT_CANDIDACY" as const, scope: "US-AZ:state-election-ballots" };
  const receipt = receiptFor(value), key = `${value.recordClass}:${value.scope}`, at = "2026-09-08T12:01:00.000Z";
  const projection = { key, sourceId: value.sourceId, recordClass: value.recordClass, scope: value.scope,
    versionId: value.id, lastKnownGoodVersionId: value.id, promotedAt: at, payload: value.readModel, receipt };
  let moved = false, payloadMatches = true;
  await withCannedNeon(({ query }) => {
    assert.ok(query.includes('from "civic_data_promotions"'));
    const hasPayload = /, "payload",/.test(query);
    const columns: NeonColumn[] = [["key", "text"], ["source_id", "text"], ["record_class", "text"], ["scope", "text"],
      ["current_version_id", "text"], ["last_known_good_version_id", "text"], ["promoted_at", "timestamptz"]];
    const row: unknown[] = [key, value.sourceId, value.recordClass, value.scope, moved ? "new-version" : value.id, moved ? "new-version" : value.id, at];
    if (hasPayload) { columns.push(["payload", "jsonb"]); row.push({ current: "new payload" }); }
    columns.push(["validation_receipt", "jsonb"]); row.push(receipt);
    if (hasPayload) { columns.push(["latestConfirmation", "text"]); row.push(null); }
    else { columns.push(["payloadMatchesCandidate", "bool"]); row.push(payloadMatches); }
    return { columns, rows: [row] };
  }, async (store, sent) => {
    await withStatePublicationRead(projection, async () => {
      const same = await store.readPromotion(value.recordClass, value.scope);
      assert.equal(same?.payload, projection.payload);
      assert.equal(sent.length, 1);
      assert.doesNotMatch(sent[0].query, /, "payload",/);
      assert.match(sent[0].query, /payload" = \(/);
      payloadMatches = false;
      const divergent = await store.readPromotion(value.recordClass, value.scope);
      assert.deepEqual(divergent?.payload, { current: "new payload" });
      assert.notEqual(divergent?.payload, projection.payload);
      payloadMatches = true;
      moved = true;
      const changed = await store.readPromotion(value.recordClass, value.scope);
      assert.deepEqual(changed?.payload, { current: "new payload" });
      assert.notEqual(changed?.payload, projection.payload);
    });
    const outside = await store.readPromotion(value.recordClass, value.scope);
    assert.deepEqual(outside?.payload, { current: "new payload" });
    assert.match(sent.at(-1)!.query, /"payload"/);
  });
});


test("state publication reads its pointer and candidate together and rejects a divergent durable payload", async () => {
  const payload = { rows: [{ id: "AZ-original", source: "https://az.gov/ballot" }] };
  const value = withStateRecordHashes({ ...candidate("state-publication-base"), recordClass: "BALLOT_CANDIDACY" as const, scope: "US-AZ:state-election-ballots",
    readModel: payload, normalizedPayload: payload, normalization: { ...candidate("metadata").normalization,
      normalizedHash: normalizedHash(payload), normalizedPayloadHash: normalizedHash(payload) } });
  const receipt = receiptFor(value), key = `${value.recordClass}:${value.scope}`;
  let divergent = false;
  await withCannedNeon(({ query, params }) => {
    assert.match(query, /left join "civic_data_candidates"/);
    assert.deepEqual(params, [key, "1"]);
    const promotion = { key, sourceId: value.sourceId, recordClass: value.recordClass, scope: value.scope,
      currentVersionId: value.id, lastKnownGoodVersionId: value.id, promotedAt: "2026-09-08T12:01:00.000Z",
      payload: divergent ? { rows: [] } : payload, validationReceipt: receipt };
    const record = { id: value.id, sourceId: value.sourceId, recordClass: value.recordClass, scope: value.scope,
      state: "PROMOTED", acquisitionSucceeded: true, rawHash: value.retrieval.rawHash,
      normalizedHash: value.normalization.normalizedHash, retrievedAt: value.retrieval.retrievedAt,
      sourceThrough: value.temporal.sourceThrough, parserVersion: value.normalization.parserVersion,
      identity: value.identities, candidate: encodeStateCandidate(value), validationReceipt: receipt,
      promotedVersionId: value.id, lastKnownGoodVersionId: value.id, failureCode: null, failureDetail: null };
    const columns: NeonColumn[] = [], row: unknown[] = [];
    for (const [table, data] of [[schema.civicDataPromotions, promotion], [schema.civicDataCandidates, record]] as const) {
      for (const [property, column] of Object.entries(getTableColumns(table))) {
        const type = column.getSQLType();
        columns.push([column.name, type === "boolean" ? "bool" : type.startsWith("timestamp") ? "timestamptz" : type as "text" | "jsonb"]);
        row.push((data as Record<string, unknown>)[property]);
      }
    }
    return { columns, rows: [row] };
  }, async (store, sent) => {
    const base = await store.readStatePublicationBase(value.recordClass, value.scope);
    assert.equal(sent.length, 1);
    assert.equal(base.current?.payload, base.lkg?.candidate.readModel);
    assert.equal(base.lkg?.candidate.normalizedPayload, base.lkg?.candidate.readModel);
    assert.deepEqual(base.current?.payload, payload);
    rememberStatePublicationHashes(base.current!, base.lkg!.candidate.normalization);
    rememberStatePublicationPrior(store, base.current!);
    const indexed = await store.readStatePublicationBase(value.recordClass, value.scope);
    assert.equal(indexed.current?.payload, null, "the old graph is absent from the validation base");
    assert.equal(indexed.lkg?.candidate.readModel, null);
    assert.equal(indexed.lkg?.candidate.normalizedPayload, null);
    assert.equal(promotionProofIssue(value.recordClass, value.scope, indexed.current!, indexed.lkg!), null);
    divergent = true;
    await assert.rejects(() => store.readStatePublicationBase(value.recordClass, value.scope), /POINTER_PAYLOAD_MISMATCH/);
  });
});


for (const family of ["candidate-profiles", "candidate-corpus", "candidate-campaign-sites-derived"] as const) {
  for (const rows of [[], [{ id: "one-official-record", text: "Small exact source fact" }]]) test(`${family} persists an empty or small state payload only once (${rows.length} rows)`, async () => {
    const id = stateBallotContractId(family, "AZ"), manual = MANUAL_PRODUCTION_SOURCE_CONTRACTS.find(row => row.id === id);
    const contract = manual ?? ROUTINE_SOURCE_CONTRACTS.find(row => row.id === id)!;
    const payload = { rows }, base = candidate(`small-${id}-${rows.length}`, "2026-09-08T12:00:00.000Z", contract.sourceId);
    const value = immutableStateCandidate({ ...base, recordClass: contract.recordClass, scope: contract.scope,
      readModel: payload, normalizedPayload: payload, normalization: { ...base.normalization,
        normalizedHash: normalizedHash(payload), normalizedPayloadHash: normalizedHash(payload) } });
    const parts = new Map<string, unknown>();
    let envelope: RoutineCandidate | undefined;
    await withCannedNeon(({ query, params }) => {
      if (query.startsWith('insert into "civic_data_payload_parts"'))
        for (let at = 0; at < params.length; at += 2) parts.set(String(params[at]), JSON.parse(String(params[at + 1])));
      if (query.startsWith('insert into "civic_data_candidates"')) envelope = params.flatMap(value => {
        if (typeof value !== "string") return [];
        try { const parsed = JSON.parse(value); return parsed?.id === base.id ? [parsed] : []; } catch { return []; }
      })[0];
      return { columns: [], rows: [] };
    }, async store => {
      Object.assign(store, { writeAuthority: { repo: ROOT, sha: "1".repeat(40), capability: manual ? "MANUAL_CONTRACT" : "ROUTINE_CONTRACT",
        contract: id, parentPid: 123, nonce: "2".repeat(64) } satisfies RuntimeAuthorityEnvelope });
      await store.create({ candidate: value, state: "FETCHED", acquisitionSucceeded: true, receipt: null, promotedVersion: null,
        lastKnownGoodVersion: null, failureCode: null, failureDetail: null },
      { candidateId: value.id, sequence: 1, state: "FETCHED", at: value.retrieval.retrievedAt, detail: "Source payload acquired" });
    });
    assert.ok(envelope);
    assert.deepEqual(Object.keys(envelope.readModel as object), ["$civicPayloadPart"]);
    assert.equal(parts.size, 1);
    const codec = new CivicPayloadParts({ existing: async () => [], write: async () => assert.fail("readback cannot write"),
      read: async hashes => hashes.map(hash => ({ hash, payload: parts.get(hash) })) });
    assert.deepEqual(decodeStateCandidate(await codec.load(envelope)), value);
    assert.deepEqual(await codec.load(envelope.readModel), payload, "the promotion's exact stored reference resolves to the same payload");
  });
}
