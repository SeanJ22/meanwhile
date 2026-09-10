import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

import { processRoutineCandidate } from "../lib/civic-data/promotion.ts";
import {
  assertRoutineDataStoreMutationAuthority,
  MemoryRoutineDataStore,
  routineDataStoreCandidateAuthorityIssue,
} from "../lib/civic-data/store.ts";
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
      parserVersion: "fec-funding/2",
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
  // Exercise the pointer race itself. Keep the same civic member key as the
  // base so the independent incomplete-horizon removal firewall does not (and
  // should not) refuse this candidate before it reaches atomic promotion.
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
      { ...authority, capability: "TRUSTED_LKG_IMPORT", contract: null },
      "candidate",
    ) ?? "",
    /trusted-LKG authority cannot write non-import candidate fec-funding/,
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

test("the one-time aggregate retirement is an exact atomic payload transfer with one durable receipt", () => {
  const source = readFileSync(join(ROOT, "lib", "civic-data", "store.ts"), "utf8");
  const postgres = source.slice(source.indexOf("export class PostgresRoutineDataStore"));
  const retirement = postgres.slice(
    postgres.indexOf("  async retirePdcV2LegacyMeetingsAggregate("),
    postgres.indexOf("  async promote(", postgres.indexOf("  async retirePdcV2LegacyMeetingsAggregate(")),
  );
  assert.match(retirement, /replacement\."payload" = expected->'payload'/);
  assert.match(retirement, /replacement_candidate\."candidate"->'readModel' = expected->'payload'/);
  assert.match(retirement, /civicDataPromotions\.payload\} = \$\{observedLegacyPayloadJson\}::jsonb/);
  assert.match(retirement, /civicDataCandidates\.candidate\}->'readModel' = \$\{observedLegacyPayloadJson\}::jsonb/);
  assert.match(retirement, /insertRetirementEvent/);
  assert.match(retirement, /deleteLegacyPointer/);
  assert.match(retirement, /finalAssertion/);
  assert.match(retirement, /select count\(\*\) = 1 from \$\{civicDataCandidateEvents\}[\s\S]*PDC_V2_LEGACY_MEETINGS_RETIREMENT_PREFIX\.length/);
  assert.match(retirement, /this\.db\.batch\(\[[\s\S]*insertRetirementEvent,[\s\S]*deleteLegacyPointer,[\s\S]*finalAssertion/);
  assert.doesNotMatch(retirement, /\.update\(civicDataPromotions\)/);
});

test("aggregate retirement re-proves every replacement receipt, candidate, fact, and history", () => {
  const source = readFileSync(join(ROOT, "lib", "civic-data", "store.ts"), "utf8");
  const replacementEvidence = source.slice(
    source.indexOf("function pdcV2LegacyMeetingsReplacementEvidenceIssue("),
    source.indexOf("function pdcV2LegacyMeetingsCandidateIssue("),
  );
  const postgres = source.slice(source.indexOf("export class PostgresRoutineDataStore"));
  const retirement = postgres.slice(
    postgres.indexOf("  async retirePdcV2LegacyMeetingsAggregate("),
    postgres.indexOf("  async promote(", postgres.indexOf("  async retirePdcV2LegacyMeetingsAggregate(")),
  );

  assert.match(replacementEvidence, /pdcV2CanonicalMeetingFactEvidence\(\s*input\.replacementPointers\.map\(\(\{ payload \}\) => payload\)/);
  assert.match(replacementEvidence, /facts\.sha256 !== input\.expected\.legacyMeetingFactSha256/);
  assert.match(replacementEvidence, /facts\.meetingRowCount !== input\.expected\.meetingRowCount/);
  assert.match(replacementEvidence, /facts\.agendaDocumentRowCount !== input\.expected\.agendaDocumentRowCount/);
  assert.match(replacementEvidence, /!record\.acquisitionSucceeded/);
  assert.match(replacementEvidence, /!candidate\.retrieval\.succeeded/);
  assert.match(replacementEvidence, /parsedReceipt\?\.decision !== "GOOD"/);
  assert.match(replacementEvidence, /!receiptsEqual\(parsedReceipt, expected\.receipt\)/);
  assert.match(replacementEvidence, /!receiptsEqual\(pointer\.receipt, parsedReceipt\)/);
  assert.match(replacementEvidence, /event\.sequence !== index \+ 1/);
  assert.match(replacementEvidence, /events\[0\]\?\.state !== "FETCHED"/);
  assert.match(replacementEvidence, /events\[1\]\?\.state !== "NORMALIZED"/);
  assert.match(replacementEvidence, /events\[2\]\?\.state !== "VALIDATED"/);
  assert.match(replacementEvidence, /events\[3\]\?\.state !== "PROMOTED"/);
  assert.match(replacementEvidence, /readerReceipts\.at\(-1\)\?\.status !== "PASS"/);

  assert.match(retirement, /replacement\."validation_receipt" = expected->'receipt'/);
  assert.match(retirement, /replacement_candidate\."acquisition_succeeded" = true/);
  assert.match(retirement, /replacement_candidate\."validation_receipt" = expected->'receipt'/);
  assert.match(retirement, /replacementJson = JSON\.stringify\(input\.replacementPointers\.map\([\s\S]*events: replacementHistories\.get\(pointer\.versionId\) \?\? \[\]/);
  assert.match(retirement, /select count\(\*\) = jsonb_array_length\(expected->'events'\)[\s\S]*actual_event\."candidate_id" = expected->>'versionId'/);
  assert.match(retirement, /actual_event\."sequence" = \(expected_event->>'sequence'\)::integer/);
  assert.match(retirement, /actual_event\."state" = expected_event->>'state'/);
  assert.match(retirement, /actual_event\."at" = \(expected_event->>'at'\)::timestamptz/);
  assert.match(retirement, /actual_event\."detail" = expected_event->>'detail'/);
  assert.match(retirement, /min\(events\."sequence"\) = 1/);
  assert.match(retirement, /count\(\*\) = count\(distinct events\."sequence"\)/);
});

test("aggregate retirement uses one shared canonical meeting fact digest and exact counts", () => {
  const storeSource = readFileSync(join(ROOT, "lib", "civic-data", "store.ts"), "utf8");
  const planSource = readFileSync(join(ROOT, "lib", "civic-data", "trusted-lkg-import-plan.ts"), "utf8");
  const factEvidence = storeSource.slice(
    storeSource.indexOf("export function pdcV2CanonicalMeetingFactEvidence("),
    storeSource.indexOf("function pdcV2ContractMigrationPreflightSql("),
  );
  const planDigest = planSource.slice(
    planSource.indexOf("function canonicalMeetingFactSha256("),
    planSource.indexOf("function pdcV2ExpectedMeetingsSnapshot("),
  );

  assert.match(factEvidence, /canonicalAgendaDocument\(/);
  assert.match(factEvidence, /meetings\.sort\(/);
  assert.match(factEvidence, /agendaDocuments\.sort\(/);
  assert.match(factEvidence, /PDC_V2_MEETING_FACT_IDENTITY_DUPLICATED/);
  assert.match(factEvidence, /createHash\("sha256"\)/);
  assert.match(factEvidence, /canonicalCivicDataJson\(\{ meetings, agendaDocuments \}\)/);
  assert.match(factEvidence, /meetingRowCount: meetings\.length/);
  assert.match(factEvidence, /agendaDocumentRowCount: agendaDocuments\.length/);
  assert.match(planSource, /pdcV2CanonicalMeetingFactEvidence,[\s\S]*from "\.\/store\.ts"/);
  assert.match(planDigest, /validateSnapshot\(snapshot\)/);
  assert.match(planDigest, /return pdcV2CanonicalMeetingFactEvidence\(\[snapshot\]\)\.sha256/);
  assert.doesNotMatch(planDigest, /createHash\("sha256"\)/, "the import plan must not fork the store's canonical fact digest");
});

test("aggregate retirement treats the legacy authority as key OR canonical class/scope and retains exact history", () => {
  const source = readFileSync(join(ROOT, "lib", "civic-data", "store.ts"), "utf8");
  const memory = source.slice(
    source.indexOf("  async retirePdcV2LegacyMeetingsAggregate("),
    source.indexOf("  async promote(", source.indexOf("  async retirePdcV2LegacyMeetingsAggregate(")),
  );
  const retainedCandidate = source.slice(
    source.indexOf("function pdcV2LegacyMeetingsCandidateIssue("),
    source.indexOf("function validEventInput("),
  );
  const postgres = source.slice(source.indexOf("export class PostgresRoutineDataStore"));
  const retirement = postgres.slice(
    postgres.indexOf("  async retirePdcV2LegacyMeetingsAggregate("),
    postgres.indexOf("  async promote(", postgres.indexOf("  async retirePdcV2LegacyMeetingsAggregate(")),
  );
  const pointerCensus = retirement.slice(
    retirement.indexOf("const pointerRows"),
    retirement.indexOf("if (pointerRows.length"),
  );
  const replay = retirement.slice(
    retirement.indexOf("const replayAssertion"),
    retirement.indexOf("return {", retirement.indexOf("const replayAssertion")),
  );
  const insert = retirement.slice(
    retirement.indexOf("const insertRetirementEvent"),
    retirement.indexOf("const deleteLegacyPointer"),
  );
  const finalAssertion = retirement.slice(
    retirement.indexOf("const finalAssertion"),
    retirement.indexOf("await this.db.batch([", retirement.indexOf("const finalAssertion")),
  );
  const assertKeyOrCanonicalScope = (fragment: string, label: string) => {
    assert.match(fragment, /PDC_V2_LEGACY_MEETINGS_KEY/, `${label}: exact legacy key is not censused`);
    assert.match(fragment, /(?:recordClass\}|record_class") = 'MEETING'/, `${label}: legacy record class is not censused`);
    assert.match(fragment, /(?:scope\}|scope") = \$\{PDC_V2_LEGACY_MEETINGS_SCOPE\}/, `${label}: legacy scope is not censused`);
    assert.match(fragment, /\bor\b/, `${label}: a rogue-key canonical legacy scope can escape the census`);
  };

  assert.match(memory, /const legacyPointers = \[\.\.\.this\.promotions\.values\(\)\]\.filter/);
  assert.match(memory, /pointer\.key === PDC_V2_LEGACY_MEETINGS_KEY \|\|[\s\S]*pointer\.recordClass === "MEETING" && pointer\.scope === PDC_V2_LEGACY_MEETINGS_SCOPE/);
  assert.match(memory, /legacyPointers\.length > 1/);
  assertKeyOrCanonicalScope(pointerCensus, "initial pointer census");
  assertKeyOrCanonicalScope(replay, "replay absence assertion");
  assertKeyOrCanonicalScope(insert, "first-retirement XOR assertion");
  assertKeyOrCanonicalScope(finalAssertion, "first-retirement final assertion");

  assert.match(retainedCandidate, /candidate\.sourceId !== PDC_V2_LEGACY_MEETINGS_SOURCE_ID/);
  assert.match(retainedCandidate, /candidate\.recordClass !== "MEETING"/);
  assert.match(retainedCandidate, /candidate\.scope !== PDC_V2_LEGACY_MEETINGS_SCOPE/);
  assert.match(retainedCandidate, /!receiptIsGoodForCandidate\(receipt, candidate\)/);
  assert.match(retainedCandidate, /pdcV2CanonicalMeetingFactEvidence\(\[candidate\.readModel\]\)/);
  assert.match(retainedCandidate, /event\.sequence !== index \+ 1/);
  assert.match(retainedCandidate, /retirementCount !== 1/);
  assert.match(retainedCandidate, /events\.at\(-1\)\?\.sequence !== retirementEvent\.sequence/);
  assert.match(retirement, /const retainedLegacyProof =/);
  assert.match(retirement, /retained\."candidate" = \$\{candidateJson\}::jsonb/);
  assert.match(retirement, /retained\."validation_receipt" = \$\{receiptJson\}::jsonb/);
  assert.match(retirement, /actual_event\."detail" = expected_event->>'detail'/);
  assert.match(replay, /retainedLegacyProof\(evidence\.legacyVersionId, legacy\.record, legacy\.events\)/);
});

test("aggregate retirement locks its full proof snapshot before first execution and replay", () => {
  const source = readFileSync(join(ROOT, "lib", "civic-data", "store.ts"), "utf8");
  const postgres = source.slice(source.indexOf("export class PostgresRoutineDataStore"));
  const retirement = postgres.slice(
    postgres.indexOf("  async retirePdcV2LegacyMeetingsAggregate("),
    postgres.indexOf("  async promote(", postgres.indexOf("  async retirePdcV2LegacyMeetingsAggregate(")),
  );
  const replayStart = retirement.indexOf("const replayAssertion");
  const replayEnd = retirement.indexOf("return {", replayStart);
  const replay = retirement.slice(replayStart, replayEnd);
  const firstTransactionStart = retirement.indexOf("await this.db.batch([", retirement.indexOf("const finalAssertion"));
  const firstTransaction = retirement.slice(
    firstTransactionStart,
    retirement.indexOf("]);", firstTransactionStart) + 3,
  );

  assert.match(retirement, /lock table \$\{civicDataCandidates\}, \$\{civicDataCandidateEvents\}, \$\{civicDataPromotions\}[\s\S]*in share row exclusive mode/);
  assert.match(replay, /retainedLegacyProof\(evidence\.legacyVersionId, legacy\.record, legacy\.events\)/);
  assert.match(replay, /replacementProof/);
  assert.match(replay, /await this\.db\.batch\(\[retirementTableLock\(\), replayAssertion\]\)/);
  assert.ok(firstTransactionStart >= 0, "the first retirement transaction is missing");
  const tableLockAt = firstTransaction.indexOf("retirementTableLock()");
  const advisoryLockAt = firstTransaction.indexOf("this.candidateEventLock(pointerRow.currentVersionId)");
  assert.ok(tableLockAt >= 0, "the first retirement transaction does not lock the proof tables");
  assert.ok(advisoryLockAt >= 0, "the first retirement transaction does not serialize legacy history");
  assert.ok(tableLockAt < advisoryLockAt, "the table lock must precede the candidate advisory lock to avoid a lock-order race");
  assert.match(firstTransaction, /insertRetirementEvent,[\s\S]*deleteLegacyPointer,[\s\S]*finalAssertion/);
});

test("the Postgres retry clock is the local sequence-one event, never a refused acquisition claim", () => {
  const source = readFileSync(join(ROOT, "lib", "civic-data", "store.ts"), "utf8");
  const postgres = source.slice(source.indexOf("export class PostgresRoutineDataStore"));
  const clock = postgres.slice(postgres.indexOf("  async clock("));
  assert.match(clock, /select\(\{ attemptedAt: civicDataCandidateEvents\.at \}\)/);
  assert.match(clock, /eq\(civicDataCandidateEvents\.sequence, 1\)/);
  assert.match(clock, /orderBy\(desc\(civicDataCandidateEvents\.at\)\)/);
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
    "retirePdcV2LegacyMeetingsAggregate",
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
