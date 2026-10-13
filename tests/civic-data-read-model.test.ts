import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  clearPromotedReadModelCache,
  readPromotedCivicData,
  readPromotedCivicDataBatch,
  promotedEdgeEntryOf,
  readPromotedCivicDataPredecessors,
  readPromotedOrBootstrap,
  type CivicDataReadStore,
} from "../lib/civic-data/read-model.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";

// The read model memoises proven versions and these tests reuse one fixture versionId.
beforeEach(() => clearPromotedReadModelCache());
import type { CandidateVersionRecord, PromotedProjection } from "../lib/civic-data/types.ts";
import { VALIDATION_CHECKS, sourceProjectionEvidence, type ValidationReceipt } from "../lib/civic-data/types.ts";
import { readFundingSnapshot } from "../lib/funding/snapshot.ts";
import { readPopulationProjection } from "../lib/reference/acs-population.ts";
import { nhLegislativeHolders, refreshNhSeatHolders } from "../lib/ballot/seat-holders.ts";
import { meetingPartitionFreshnessMs, routineFreshnessMs } from "../lib/civic-data/contracts.ts";
import { normalizedHash } from "../lib/civic-data/candidate-builders.ts";

const noPointer: CivicDataReadStore = {
  readPromotion: async () => null,
  readCandidate: async () => null,
};

const failedStore: CivicDataReadStore = {
  readPromotion: async () => { throw new Error("database offline"); },
  readCandidate: async () => { throw new Error("database offline"); },
};

test("canonical scalar and batch reads use the request's edge copies without a database", async () => {
  const store = promotedStore({ total: 17 });
  const read = await readPromotedCivicData("FEC_FUNDING", "federal-supported", { store });
  const edge = promotedEdgeEntryOf(read, "FEC_FUNDING", "federal-supported", store);
  assert.ok(edge);
  await withReaderAuthorityEdge({ promoted: new Map([["FEC_FUNDING:federal-supported", edge]]), edgeOnly: true }, async () => {
    const scalar = await readPromotedCivicData<{ total: number }>("FEC_FUNDING", "federal-supported");
    assert.equal(scalar.kind, "PROMOTED");
    assert.deepEqual(scalar.value, { total: 17 });
    const batch = await readPromotedCivicDataBatch("FEC_FUNDING", ["federal-supported", "federal-supported"]);
    assert.equal(batch.length, 2);
    assert.ok(batch.every(result => result.kind === "PROMOTED"));
    assert.equal((await readPromotedCivicData("FEC_FUNDING", "federal-supported", { store: noPointer })).kind, "NOT_RECORDED");
    await assert.rejects(readPromotedCivicData("FEC_FUNDING", "missing"), /not on the reader edge/);
  });
});

function promotedStore<T>(payload: T): CivicDataReadStore {
  const payloadHash = normalizedHash(payload);
  const receipt: ValidationReceipt = {
    contractVersion: 2,
    decision: "GOOD",
    candidateId: "candidate-1",
    sourceId: "fec-open-api",
    recordClass: "FEC_FUNDING",
    scope: "federal-supported",
    validatedAt: "2026-09-01T00:01:00.000Z",
    checks: VALIDATION_CHECKS.map((check) => ({
      check,
      verdict: "PASS",
      code: `${check}_PASS`,
      detail: `${check} was proven for candidate-1.`,
    })),
    excludedFacts: [],
  };
  const projection = {
    key: "FEC_FUNDING:federal-supported",
    sourceId: "fec-open-api",
    recordClass: "FEC_FUNDING",
    scope: "federal-supported",
    versionId: "candidate-1",
    lastKnownGoodVersionId: "candidate-1",
    promotedAt: "2026-09-02T00:00:00.000Z",
    payload,
    receipt,
  } satisfies PromotedProjection<T>;
  const candidate = {
    candidate: {
      id: "candidate-1",
      sourceId: "fec-open-api",
      recordClass: "FEC_FUNDING",
      scope: "federal-supported",
      sourceProjectionEvidence: sourceProjectionEvidence("fec-open-api", "FEC_FUNDING", "federal-supported"),
      retrieval: {
        succeeded: true,
        requestedUrl: "https://api.open.fec.gov/v1/candidates/search/",
        finalUrl: "https://api.open.fec.gov/v1/candidates/search/",
        httpStatus: 200,
        retrievedAt: "2026-09-01T00:00:00.000Z",
        rawHash: "a".repeat(64),
      },
      normalization: {
        succeeded: true,
        parserVersion: "fec-funding/4",
        schemaVersion: "2",
        normalizedHash: payloadHash,
        normalizedPayloadHash: payloadHash,
        inputRecords: 1,
        outputRecords: 1,
        droppedRecords: 0,
        missingRequiredFields: [],
      },
      identities: [],
      temporal: { version: "2026", expectedVersion: "2026", sourceThrough: "2026-08-31", staleAtRetrieval: false },
      semantics: { factKind: "test", violations: [] },
      horizon: { kind: "OPEN_FACT_SET", query: "test", returnedRecords: 1, declaredTotal: null, paginationComplete: true, claimsComplete: false },
      absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
      dependentChecks: [{ consumer: "test", passed: true, detail: "accepted" }],
      normalizedPayload: payload,
      readModel: payload,
    },
    state: "PROMOTED",
    acquisitionSucceeded: true,
    receipt,
    promotedVersion: "candidate-1",
    lastKnownGoodVersion: "candidate-1",
    failureCode: null,
    failureDetail: null,
  } satisfies CandidateVersionRecord;
  return {
    readPromotion: async <R>() => projection as unknown as PromotedProjection<R>,
    readCandidate: async () => candidate,
  };
}

async function historicalFixture() {
  const base = promotedStore({ answer: 42 });
  const currentRow = await base.readCandidate("candidate-1");
  assert.ok(currentRow);
  const older = (id: string): CandidateVersionRecord => ({
    ...currentRow,
    candidate: { ...currentRow.candidate, id },
    receipt: { ...currentRow.receipt!, candidateId: id },
    promotedVersion: id,
    lastKnownGoodVersion: id,
  });
  const rows = new Map([["candidate-1", currentRow], ["candidate-2", older("candidate-2")],
    ["candidate-3", older("candidate-3")]]);
  const key = "FEC_FUNDING:federal-supported";
  const previous = new Map([["candidate-1", "candidate-2"], ["candidate-2", "candidate-3"],
    ["candidate-3", "bootstrap/no-version"]]);
  const moves = (id: string) => previous.has(id) ? [{ candidateId: id, sequence: 2, state: "PROMOTED" as const,
    at: "2026-09-02T00:00:00.000Z", detail: `Atomic pointer ${key} moved from ${previous.get(id)} to ${id}.` }] : [];
  const store = {
    ...base,
    readCandidate: async (id: string) => rows.get(id) ?? null,
    readCandidateProofs: async (ids: readonly string[]) => ids.flatMap(id => rows.has(id) ? [{ candidateId: id, record: rows.get(id)! }] : []),
    events: async (id: string) => moves(id),
    pointerMoveEvents: async (id: string) => moves(id),
  };
  const current = await readPromotedCivicData<{ answer: number }>("FEC_FUNDING", "federal-supported",
    { store, bypassCache: true });
  assert.equal(current.kind, "PROMOTED");
  if (current.kind !== "PROMOTED") throw new Error("fixture promotion failed");
  return { current, store, rows, previous };
}

test("historical promotions page through an exact anchored chain and prove every former version", async () => {
  const { current, store } = await historicalFixture();
  const first = await readPromotedCivicDataPredecessors("FEC_FUNDING", "federal-supported", current,
    { store, pageSize: 1 });
  assert.deepEqual(first.versions.map(row => row.projection.versionId), ["candidate-2"]);
  assert.equal(first.complete, false);
  assert.equal(first.nextVersionId, "candidate-3");
  const second = await readPromotedCivicDataPredecessors("FEC_FUNDING", "federal-supported", current,
    { store, pageSize: 1, cursor: first.nextVersionId });
  assert.deepEqual(second.versions.map(row => row.projection.versionId), ["candidate-3"]);
  assert.equal(second.complete, true);
  assert.equal(second.nextVersionId, null);
  const unrelated = await readPromotedCivicDataPredecessors("FEC_FUNDING", "federal-supported", current,
    { store, cursor: "unrelated-version" });
  assert.match(unrelated.issue ?? "", /not in the current pointer/);
});

test("historical promotions refuse tampered rows, source switches, missing moves and cycles", async () => {
  const { current, store, rows, previous } = await historicalFixture();
  const original = rows.get("candidate-2")!;
  rows.set("candidate-2", { ...original, candidate: { ...original.candidate, readModel: { answer: 99 } } });
  const tampered = await readPromotedCivicDataPredecessors("FEC_FUNDING", "federal-supported", current,
    { store, pageSize: 2 });
  assert.equal(tampered.versions.length, 0);
  assert.match(tampered.issue ?? "", /failed promotion proof/);
  rows.set("candidate-2", { ...original, candidate: { ...original.candidate, sourceId: "other-publisher" } });
  const sourceSwitch = await readPromotedCivicDataPredecessors("FEC_FUNDING", "federal-supported", current,
    { store, pageSize: 2 });
  assert.match(sourceSwitch.issue ?? "", /changed the source authority/);
  rows.set("candidate-2", original);
  previous.delete("candidate-2");
  const missing = await readPromotedCivicDataPredecessors("FEC_FUNDING", "federal-supported", current,
    { store, pageSize: 2 });
  assert.match(missing.issue ?? "", /missing or ambiguous/);
  previous.set("candidate-2", "candidate-1");
  const cycle = await readPromotedCivicDataPredecessors("FEC_FUNDING", "federal-supported", current,
    { store, pageSize: 2 });
  assert.match(cycle.issue ?? "", /cycle/);
});

test("canonical read refuses a planted pointer/candidate proof mismatch", async () => {
  const valid = promotedStore({ answer: 42 });
  const mismatchedPayload: CivicDataReadStore = {
    ...valid,
    readPromotion: async <T>() => ({
      ...(await valid.readPromotion<T>("FEC_FUNDING", "federal-supported"))!,
      payload: { answer: 99 } as T,
    }),
  };
  const payloadResult = await readPromotedCivicData("FEC_FUNDING", "federal-supported", { store: mismatchedPayload });
  assert.equal(payloadResult.kind, "STORE_UNREACHABLE");
  if (payloadResult.kind === "STORE_UNREACHABLE") assert.equal(payloadResult.code, "PROMOTION_PROOF_INVALID");

  const jointlyTampered: CivicDataReadStore = {
    readPromotion: async <T>() => ({
      ...(await valid.readPromotion<T>("FEC_FUNDING", "federal-supported"))!,
      payload: { answer: 99 } as T,
    }),
    readCandidate: async (candidateId) => {
      const row = await valid.readCandidate(candidateId);
      assert.ok(row);
      return {
        ...row,
        candidate: {
          ...row.candidate,
          normalizedPayload: { answer: 99 },
          readModel: { answer: 99 },
        },
      };
    },
  };
  const digestResult = await readPromotedCivicData("FEC_FUNDING", "federal-supported", { store: jointlyTampered });
  assert.equal(digestResult.kind, "STORE_UNREACHABLE");
  if (digestResult.kind === "STORE_UNREACHABLE") {
    assert.equal(digestResult.code, "PROMOTION_PROOF_INVALID");
    assert.match(digestResult.detail, /durable normalized hash/);
  }

  const malformedReceipt: CivicDataReadStore = {
    ...valid,
    readPromotion: async <T>() => ({
      ...(await valid.readPromotion<T>("FEC_FUNDING", "federal-supported"))!,
      receipt: {} as ValidationReceipt,
    }),
  };
  const receiptResult = await readPromotedCivicData("FEC_FUNDING", "federal-supported", { store: malformedReceipt });
  assert.equal(receiptResult.kind, "STORE_UNREACHABLE");
  if (receiptResult.kind === "STORE_UNREACHABLE") assert.equal(receiptResult.code, "PROMOTION_PROOF_INVALID");
});

test("canonical read distinguishes absent pointer, promoted LKG metadata, and store failure", async () => {
  const absent = await readPromotedCivicData("FEC_FUNDING", "federal-supported", { store: noPointer });
  assert.equal(absent.kind, "NOT_RECORDED");

  const promoted = await readPromotedCivicData<{ answer: number }>("FEC_FUNDING", "federal-supported", {
    store: promotedStore({ answer: 42 }),
    now: "2026-09-09T00:00:00.000Z",
    maxAgeMs: 7 * 24 * 60 * 60 * 1_000,
  });
  assert.equal(promoted.kind, "PROMOTED");
  if (promoted.kind !== "PROMOTED") return;
  assert.equal(promoted.value.answer, 42);
  assert.equal(promoted.metadata.version, "2026");
  assert.equal(promoted.metadata.sourceThrough, "2026-08-31");
  assert.equal(promoted.metadata.lastKnownGoodVersionId, "candidate-1");
  assert.equal(promoted.metadata.stale, "STALE");

  const failed = await readPromotedCivicData("FEC_FUNDING", "federal-supported", { store: failedStore });
  assert.equal(failed.kind, "STORE_UNREACHABLE");
  if (failed.kind === "STORE_UNREACHABLE") assert.equal(failed.code, "STORE_READ_FAILED");

  // A first read whose candidate fetch fails: clear the memo the scenario above populated.
  clearPromotedReadModelCache();
  const pointerThenFailure: CivicDataReadStore = {
    ...promotedStore({ answer: 42 }),
    readCandidate: async () => { throw new Error("candidate table offline"); },
  };
  const partial = await readPromotedCivicData("FEC_FUNDING", "federal-supported", { store: pointerThenFailure });
  assert.equal(partial.kind, "STORE_UNREACHABLE");
  assert.equal(partial.metadata.lastKnownGoodVersionId, "candidate-1", "an already-observed LKG pointer survives a later read failure");
});

test("bootstrap requires the explicit non-production fixture gate and never follows a read error", async () => {
  let opened = 0;
  const bootstrap = () => {
    opened += 1;
    return {
      value: { answer: 7 },
      sourceId: "fixture",
      version: "v1",
      versionId: "bootstrap:v1",
      sourceThrough: "2026-09-01",
      retrievedAt: "2026-09-01T00:00:00.000Z",
      detail: "explicit bootstrap",
    };
  };
  const absent = await readPromotedOrBootstrap({
    recordClass: "FEC_FUNDING",
    scope: "test",
    store: noPointer,
    bootstrap,
    allowUnconfiguredBootstrap: true,
  });
  assert.equal(absent.kind, "BOOTSTRAP");
  assert.equal(opened, 1);

  const failed = await readPromotedOrBootstrap({
    recordClass: "FEC_FUNDING",
    scope: "test",
    store: failedStore,
    bootstrap,
  });
  assert.equal(failed.kind, "STORE_UNREACHABLE");
  assert.equal(opened, 1, "a store error must not open tracked bootstrap data");
});

test("an answered absent canonical pointer does not reopen Git without the fixture gate", async () => {
  let opened = 0;
  const result = await readPromotedOrBootstrap({
    recordClass: "FEC_FUNDING",
    scope: "production-authority-gap",
    store: noPointer,
    bootstrap: () => {
      opened += 1;
      return {
        value: { answer: 7 },
        sourceId: "tracked-first-seed",
        version: "v1",
        versionId: "bootstrap:v1",
        sourceThrough: "2026-09-01",
        retrievedAt: "2026-09-01T00:00:00.000Z",
        detail: "test fixture only",
      };
    },
  });
  assert.equal(result.kind, "NOT_RECORDED");
  assert.equal(opened, 0);
});

test("production refuses tracked bootstrap even when a caller requests the fixture gate", async () => {
  const prior = process.env.NODE_ENV;
  try {
    Reflect.set(process.env, "NODE_ENV", "production");
    const result = await readPromotedOrBootstrap({
      recordClass: "FEC_FUNDING",
      scope: "production-authority-gap",
      store: noPointer,
      bootstrap: () => {
        throw new Error("production opened a tracked first seed");
      },
      allowUnconfiguredBootstrap: true,
    });
    assert.equal(result.kind, "NOT_RECORDED");
  } finally {
    if (prior === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Reflect.set(process.env, "NODE_ENV", prior);
  }
});

test("FEC, ACS, and NH adapters expose outage instead of silently retaining tracked data", async () => {
  assert.equal((await readFundingSnapshot({ store: failedStore })).kind, "STORE_UNREACHABLE");
  assert.equal((await readPopulationProjection({ store: failedStore })).kind, "STORE_UNREACHABLE");
  assert.equal((await refreshNhSeatHolders({ store: failedStore })).kind, "STORE_UNREACHABLE");
  assert.deepEqual(nhLegislativeHolders("State Senator, District 7"), []);
});

test("NH synchronous selector consumes an explicitly established bootstrap projection", async () => {
  const state = await refreshNhSeatHolders({ store: noPointer, now: "2026-09-08T00:00:00.000Z" });
  assert.equal(state.kind, "BOOTSTRAP");
  const holders = nhLegislativeHolders("State Representative, Merrimack County District 7");
  assert.ok(holders.some((holder) => holder.familyName === "Ebel"));
  assert.match(holders[0]?.source ?? "", /bootstrap/i);
});

test("Reader freshness derives from the canonical source contract", () => {
  const day = 24 * 60 * 60 * 1_000;
  assert.equal(routineFreshnessMs("nj-morris-filing", "2026-11-03T23:59:59.999Z"), day);
  assert.equal(routineFreshnessMs("nj-morris-filing", "2026-11-04T00:00:00.000Z"), 7 * day);
  assert.equal(meetingPartitionFreshnessMs("2026-11-04T00:00:00.001Z"), 7 * day);
});
