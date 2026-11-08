import { fecFundingCandidate, normalizedHash } from "../../lib/civic-data/candidate-builders.ts";
import { VALIDATION_CHECKS, sourceProjectionEvidence, type CandidateVersionRecord, type PromotedProjection,
  type RoutineCandidate, type RoutineRecordClass, type ValidationCheckName, type ValidationReceipt } from "../../lib/civic-data/types.ts";

type CandidateInput = Pick<RoutineCandidate, "id"> & Partial<Pick<RoutineCandidate,
  "sourceId" | "recordClass" | "scope" | "normalizedPayload" | "readModel" | "identities" | "sourceProjectionEvidence" |
  "semantics" | "absence" | "dependentChecks">> & {
  retrievedAt?: string; requestedUrl?: string; finalUrl?: string; rawHash?: string;
  parserVersion?: string; schemaVersion?: string; records?: number;
  temporal?: Partial<RoutineCandidate["temporal"]>; horizon?: Partial<RoutineCandidate["horizon"]>;
};

/** A complete source fixture, with deliberate invalid fields applied last by its caller. */
export function routineCandidateFixture(input: CandidateInput, overrides: Partial<RoutineCandidate> = {}): RoutineCandidate {
  const { id, sourceId = "fec-open-api", recordClass = "FEC_FUNDING", scope = "federal-supported", records = 1,
    retrievedAt = "2026-09-08T12:00:00.000Z", requestedUrl = "https://api.open.fec.gov/v1/" } = input;
  const rows = Array.from({ length: records }, (_, index) => ({ id: records === 1 ? id : `${id}-${index}` }));
  const normalizedPayload = Object.hasOwn(input, "normalizedPayload") ? input.normalizedPayload : { rows };
  const readModel = Object.hasOwn(input, "readModel") ? input.readModel : { candidates: rows.map(row => ({ ...row, amount: 1 })) };
  return {
    id, sourceId, recordClass, scope,
    sourceProjectionEvidence: input.sourceProjectionEvidence ?? sourceProjectionEvidence(sourceId, recordClass, scope),
    retrieval: {
      succeeded: true,
      requestedUrl,
      finalUrl: input.finalUrl ?? requestedUrl,
      httpStatus: 200,
      retrievedAt,
      rawHash: input.rawHash ?? "a".repeat(64),
    },
    normalization: {
      succeeded: true,
      parserVersion: input.parserVersion ?? "fec-funding/4",
      schemaVersion: input.schemaVersion ?? "2",
      normalizedHash: normalizedHash(readModel),
      normalizedPayloadHash: normalizedHash(normalizedPayload),
      inputRecords: records,
      outputRecords: records,
      droppedRecords: 0,
      missingRequiredFields: [],
    },
    identities: input.identities ?? [{
      subjectId: "H6AZ01001",
      jurisdiction: "US",
      identifiers: { candidate_id: "H6AZ01001" },
      matchBasis: "OFFICIAL_ID",
      ambiguous: false,
    }],
    temporal: { version: "2026", expectedVersion: "2026", sourceThrough: retrievedAt, staleAtRetrieval: false, ...input.temporal },
    semantics: input.semantics ?? { factKind: "filed total", violations: [] },
    horizon: { kind: "OPEN_FACT_SET", query: "supported candidates", returnedRecords: records, declaredTotal: null,
      paginationComplete: true, claimsComplete: false, ...input.horizon },
    absence: input.absence ?? { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: input.dependentChecks ?? [{ consumer: "funding reader", passed: true, detail: "accepted" }],
    normalizedPayload, readModel, ...overrides,
  };
}

type CheckText = string | ((check: ValidationCheckName) => string);
type ReceiptCandidate = Pick<RoutineCandidate, "id" | "sourceId" | "recordClass" | "scope"> & {
  readonly retrieval: Pick<RoutineCandidate["retrieval"], "retrievedAt">;
};
/** Preserve a scenario's exact proof text while sharing the receipt envelope. */
export function routineReceiptFixture(value: ReceiptCandidate, options: Partial<Omit<ValidationReceipt, "checks">> & {
  code?: CheckText; detail?: CheckText; checks?: ValidationReceipt["checks"];
} = {}): ValidationReceipt {
  const { code = (check: ValidationCheckName) => `${check}_PASS`, detail = "persisted proof", checks, ...overrides } = options;
  const text = (value: CheckText, check: ValidationCheckName) => typeof value === "function" ? value(check) : value;
  return {
    contractVersion: 2,
    decision: "GOOD",
    candidateId: value.id,
    sourceId: value.sourceId,
    recordClass: value.recordClass,
    scope: value.scope,
    validatedAt: value.retrieval.retrievedAt,
    checks: checks ?? VALIDATION_CHECKS.map(check => ({ check, verdict: "PASS", code: text(code, check), detail: text(detail, check) })),
    excludedFacts: [], ...overrides };
}

export function routineRecordFixture(value: RoutineCandidate, overrides: Partial<CandidateVersionRecord> = {}): CandidateVersionRecord {
  return {
    candidate: value,
    state: "PROMOTED",
    acquisitionSucceeded: true,
    receipt: routineReceiptFixture(value),
    promotedVersion: value.id,
    lastKnownGoodVersion: value.id,
    failureCode: null,
    failureDetail: null,
    ...overrides,
  };
}

/** A newly acquired candidate has no validation, promotion or failure evidence yet. */
export function routineAcquiredFixture(candidate: RoutineCandidate, lastKnownGoodVersion: string | null = null): CandidateVersionRecord {
  return {
    candidate,
    state: "FETCHED",
    acquisitionSucceeded: true,
    receipt: null,
    promotedVersion: null,
    lastKnownGoodVersion,
    failureCode: null,
    failureDetail: null,
  };
}

/** The same complete FEC source fixture used by runner and verification tests. */
export function fecSourceFixture(input: { name: string; retrievedAt: string; receipts?: number; rawBody?: string }): RoutineCandidate {
  const { name, retrievedAt, receipts = 10, rawBody = "official FEC response bytes" } = input;
  return fecFundingCandidate({
    snapshot: {
      formatVersion: 1,
      fetchedAt: retrievedAt,
      cycle: 2026,
      matchReport: { rosterMatched: 1, rosterTotal: 1, ballotMatched: 0, ballotTotal: 0 },
      candidates: [{
        dataClass: "FEC_COMMITTEE",
        fecCandidateId: "H6AZ01001",
        name,
        state: "AZ",
        office: "H",
        district: "01",
        targetKeys: ["congress:test"],
        matchRoutes: ["bioguide-bridge"],
        principalCommitteeId: "C00999999",
        cycle: 2026,
        totals: {
          receipts,
          disbursements: 1,
          cashOnHand: receipts - 1,
          individualItemized: receipts,
          individualUnitemized: 0,
          smallDonorShare: 0,
          coverageEndDate: "2026-06-30",
        },
        topContributions: [],
        provenance: {
          sourceUrl: "https://api.open.fec.gov/v1/",
          sourceOrg: "Federal Election Commission",
          collectedAt: retrievedAt,
          verifiedAt: retrievedAt,
        },
      }],
      absences: [],
    },
    rawBodies: [rawBody],
    finalUrl: "https://api.open.fec.gov/v1/candidates/search/",
    retrievedAt,
    excludedFacts: [],
  });
}

/** The same candidate and pointer fixture used by scalar, batch and memoized reader tests. */
export function routineVersionFixture<T>(scope: string, versionId: string, payload: T, recordClass: RoutineRecordClass = "FEC_FUNDING") {
  const value = routineCandidateFixture({ id: versionId, scope, recordClass, normalizedPayload: payload, readModel: payload,
    retrievedAt: "2026-09-01T00:00:00.000Z", requestedUrl: "https://api.open.fec.gov/v1/candidates/search/", identities: [],
    temporal: { sourceThrough: "2026-08-31" }, semantics: { factKind: "test", violations: [] }, horizon: { query: "test" },
    dependentChecks: [{ consumer: "test", passed: true, detail: "accepted" }] });
  const receipt = routineReceiptFixture(value, { validatedAt: "2026-09-01T00:01:00.000Z", detail: check => `${check} was proven for ${versionId}.` });
  const projection: PromotedProjection<T> = { key: `${recordClass}:${scope}`, sourceId: value.sourceId, recordClass, scope,
    versionId, lastKnownGoodVersionId: versionId, promotedAt: "2026-09-02T00:00:00.000Z", payload, receipt };
  return { projection, candidate: routineRecordFixture(value, { receipt }) };
}
