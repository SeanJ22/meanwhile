import { normalizedHash } from "../../lib/civic-data/candidate-builders.ts";
import type { CandidateVersionRecord, PromotedProjection, RoutineRecordClass } from "../../lib/civic-data/types.ts";
import { VALIDATION_CHECKS, sourceProjectionEvidence, type ValidationReceipt } from "../../lib/civic-data/types.ts";

export const CLASS: RoutineRecordClass = "FEC_FUNDING";

export interface Version {
  projection: PromotedProjection;
  candidate: CandidateVersionRecord;
}

export function version(scope: string, versionId: string, payload: unknown, recordClass: RoutineRecordClass = CLASS): Version {
  const payloadHash = normalizedHash(payload);
  const receipt: ValidationReceipt = {
    contractVersion: 2,
    decision: "GOOD",
    candidateId: versionId,
    sourceId: "fec-open-api",
    recordClass,
    scope,
    validatedAt: "2026-09-01T00:01:00.000Z",
    checks: VALIDATION_CHECKS.map((check) => ({
      check,
      verdict: "PASS",
      code: `${check}_PASS`,
      detail: `${check} was proven for ${versionId}.`,
    })),
    excludedFacts: [],
  };
  const projection = {
    key: `${recordClass}:${scope}`,
    sourceId: "fec-open-api",
    recordClass,
    scope,
    versionId,
    lastKnownGoodVersionId: versionId,
    promotedAt: "2026-09-02T00:00:00.000Z",
    payload,
    receipt,
  } satisfies PromotedProjection;
  const candidate = {
    candidate: {
      id: versionId,
      sourceId: "fec-open-api",
      recordClass,
      scope,
      sourceProjectionEvidence: sourceProjectionEvidence("fec-open-api", recordClass, scope),
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
    promotedVersion: versionId,
    lastKnownGoodVersion: versionId,
    failureCode: null,
    failureDetail: null,
  } satisfies CandidateVersionRecord;
  return { projection, candidate };
}
