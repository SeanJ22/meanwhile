import { normalizedHash } from "../../lib/civic-data/candidate-builders.ts";
import { VALIDATION_CHECKS, sourceProjectionEvidence, type RoutineCandidate, type ValidationReceipt } from "../../lib/civic-data/types.ts";

/** An FEC funding candidate for `federal-supported`, one row per id in `rowIds`; `overrides` replace any field. */
export function fecCandidate(id: string, rowIds: readonly string[], retrievedAt: string, overrides: Partial<RoutineCandidate> = {}): RoutineCandidate {
  const normalizedPayload = { rows: rowIds.map((rowId) => ({ id: rowId })) };
  const readModel = { candidates: rowIds.map((rowId) => ({ id: rowId, amount: 1 })) };
  return {
    id,
    sourceId: "fec-open-api",
    recordClass: "FEC_FUNDING",
    scope: "federal-supported",
    sourceProjectionEvidence: sourceProjectionEvidence("fec-open-api", "FEC_FUNDING", "federal-supported"),
    retrieval: {
      succeeded: true,
      requestedUrl: "https://api.open.fec.gov/v1/",
      finalUrl: "https://api.open.fec.gov/v1/",
      httpStatus: 200,
      retrievedAt,
      rawHash: "a".repeat(64),
    },
    normalization: {
      succeeded: true,
      parserVersion: "fec-funding/4",
      schemaVersion: "2",
      normalizedHash: normalizedHash(readModel),
      normalizedPayloadHash: normalizedHash(normalizedPayload),
      inputRecords: rowIds.length,
      outputRecords: rowIds.length,
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
    temporal: { version: "2026", expectedVersion: "2026", sourceThrough: retrievedAt, staleAtRetrieval: false },
    semantics: { factKind: "filed total", violations: [] },
    horizon: {
      kind: "OPEN_FACT_SET",
      query: "supported candidates",
      returnedRecords: rowIds.length,
      declaredTotal: null,
      paginationComplete: true,
      claimsComplete: false,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [{ consumer: "funding reader", passed: true, detail: "accepted" }],
    normalizedPayload,
    readModel,
    ...overrides,
  };
}

/** The persisted receipt for a candidate: every check passed, stamped at its retrieval. */
export function receiptFor(value: RoutineCandidate, decision: ValidationReceipt["decision"] = "GOOD"): ValidationReceipt {
  return {
    contractVersion: 2,
    decision,
    candidateId: value.id,
    sourceId: value.sourceId,
    recordClass: value.recordClass,
    scope: value.scope,
    validatedAt: value.retrieval.retrievedAt,
    checks: VALIDATION_CHECKS.map((check) => ({ check, verdict: "PASS", code: `${check}_PASS`, detail: "persisted proof" })),
    excludedFacts: [],
  };
}
