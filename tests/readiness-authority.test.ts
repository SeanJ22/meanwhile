import assert from "node:assert/strict";
import test from "node:test";

import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import {
  projectRoutineDataObservabilityRead,
  type RoutineCandidateEventRow,
  type RoutineCandidateRow,
  type RoutinePromotionRow,
} from "../lib/civic-data/observability.ts";
import { VALIDATION_CHECKS, type ValidationReceipt } from "../lib/civic-data/types.ts";
import { serializeReaderProjectionReadback } from "../lib/civic-data/reader-readback.ts";
import { normalizedHash } from "../lib/civic-data/candidate-builders.ts";

const NOW = "2026-09-08T12:00:00.000Z";
const AT = "2026-09-08T11:00:00.000Z";
const READER_CODE_SHA = "c".repeat(40);
const READER_BUILD = { codeSha: READER_CODE_SHA, branch: "main", context: "production" } as const;
const CONTRACT = requiredManualProductionContract("az-sos-campaign-finance");

function promotedRows(): {
  readonly candidates: readonly RoutineCandidateRow[];
  readonly events: readonly RoutineCandidateEventRow[];
  readonly promotions: readonly RoutinePromotionRow[];
} {
  const id = "az-finance-readiness-v1";
  const receipt: ValidationReceipt = {
    contractVersion: 2,
    decision: "GOOD",
    candidateId: id,
    sourceId: CONTRACT.sourceId,
    recordClass: CONTRACT.recordClass,
    scope: CONTRACT.scope,
    validatedAt: AT,
    checks: VALIDATION_CHECKS.map((check) => ({ check, verdict: "PASS", code: `${check}_PASS`, detail: `${check} passed.` })),
    excludedFacts: [],
  };
  const candidate: RoutineCandidateRow = {
    id,
    sourceId: CONTRACT.sourceId,
    recordClass: CONTRACT.recordClass,
    scope: CONTRACT.scope,
    state: "PROMOTED",
    acquisitionSucceeded: true,
    retrievedAt: AT,
    sourceThrough: AT,
    candidate: {
      id,
      sourceId: CONTRACT.sourceId,
      recordClass: CONTRACT.recordClass,
      scope: CONTRACT.scope,
      retrieval: {
        succeeded: true,
        requestedUrl: "https://azsos.gov/elections/campaign-finance-reporting",
        finalUrl: "https://azsos.gov/elections/campaign-finance-reporting",
        httpStatus: 200,
        retrievedAt: AT,
        rawHash: "a".repeat(64),
      },
      normalization: {
        succeeded: true,
        parserVersion: "test/readiness-authority",
        schemaVersion: "test/1",
        normalizedHash: normalizedHash({ candidateId: id }),
        normalizedPayloadHash: normalizedHash({ candidateId: id }),
        inputRecords: 1,
        outputRecords: 1,
        droppedRecords: 0,
        missingRequiredFields: [],
      },
      normalizedPayload: { candidateId: id },
      temporal: { version: "2026", expectedVersion: "2026", sourceThrough: AT, staleAtRetrieval: false },
      readModel: { candidateId: id },
      changeSet: { outcome: "UNCHANGED", added: [], changed: [], removed: [], held: [] },
    },
    validationReceipt: receipt,
    promotedVersionId: id,
    lastKnownGoodVersionId: id,
    failureCode: null,
    failureDetail: null,
  };
  return {
    candidates: [candidate],
    events: [
      { id: `event-${id}:1`, candidateId: id, sequence: 1, state: "FETCHED", at: AT, detail: "Official source bytes acquired." },
      { id: `event-${id}:2`, candidateId: id, sequence: 2, state: "NORMALIZED", at: AT, detail: "Official source bytes normalized." },
      { id: `event-${id}:3`, candidateId: id, sequence: 3, state: "VALIDATED", at: AT, detail: "Candidate validation passed." },
      { id: `event-${id}:4`, candidateId: id, sequence: 4, state: "PROMOTED", at: AT, detail: "Canonical promotion recorded." },
      {
        id: `reader-event-${id}`,
        candidateId: id,
        sequence: 5,
        state: "PROMOTED",
        at: AT,
        detail: serializeReaderProjectionReadback({
          contractVersion: 2,
          kind: "READER_PROJECTION_READBACK",
          contractId: CONTRACT.id,
          sourceId: CONTRACT.sourceId,
          recordClass: CONTRACT.recordClass,
          scope: CONTRACT.scope,
          projectionId: CONTRACT.readerProjection.id,
          versionId: id,
          pointerKey: `${CONTRACT.recordClass}:${CONTRACT.scope}`,
          observedAt: AT,
          evidenceKind: "TYPED_READER_READ_MODEL",
          verifierId: "test:manual-reader-verifier",
          verifierCodeSha: READER_CODE_SHA,
          status: "PASS",
          detail: "The contract-specific typed Reader returned the exact promoted version.",
        }),
      },
    ],
    promotions: [{
      key: `${CONTRACT.recordClass}:${CONTRACT.scope}`,
      sourceId: CONTRACT.sourceId,
      recordClass: CONTRACT.recordClass,
      scope: CONTRACT.scope,
      currentVersionId: id,
      lastKnownGoodVersionId: id,
      promotedAt: AT,
      payload: { candidateId: id },
      validationReceipt: receipt,
    }],
  };
}

test("readiness authority keeps missing, promoted, and store-unreachable outcomes distinct", async () => {
  const missing = await projectRoutineDataObservabilityRead({
    now: NOW,
    connected: true,
    readRows: async () => ({ candidates: [], events: [], promotions: [] }),
  });
  assert.equal(missing.kind, "HELD");
  if (missing.kind === "HELD") {
    const row = missing.value.contracts.find(({ contractId }) => contractId === CONTRACT.id)!;
    assert.equal(row.currentState.kind, "NOT_RECORDED");
    assert.equal(row.canonicalPromotion.kind, "NOT_RECORDED");
    assert.equal(row.readerVisible.kind, "NOT_RECORDED");
  }

  const promoted = await projectRoutineDataObservabilityRead({
    now: NOW,
    connected: true,
    currentReaderBuild: READER_BUILD,
    readRows: async () => promotedRows(),
  });
  assert.equal(promoted.kind, "HELD");
  if (promoted.kind === "HELD") {
    const row = promoted.value.contracts.find(({ contractId }) => contractId === CONTRACT.id)!;
    assert.equal(row.currentState.kind, "MEASURED");
    assert.equal(row.canonicalPromotion.kind, "MEASURED");
    assert.equal(row.readerVisible.kind, "MEASURED");
  }

  const unreachable = await projectRoutineDataObservabilityRead({
    now: NOW,
    connected: true,
    readRows: async () => { throw new Error("database detail must not become a missing-state claim"); },
  });
  assert.equal(unreachable.kind, "STORE_UNREACHABLE");
});
