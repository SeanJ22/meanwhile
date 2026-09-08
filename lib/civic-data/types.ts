/** The four source-trust classes in the routine civic-data contract. */
export const SOURCE_TRUST_CLASSES = [
  "T1_AUTHORITATIVE_STRUCTURED",
  "T2_AUTHORITATIVE_DOCUMENT",
  "T3_ATTRIBUTED_PRIMARY",
  "T4_RESEARCH_SECONDARY",
] as const;
export type SourceTrustClass = (typeof SOURCE_TRUST_CLASSES)[number];

export const ROUTINE_RECORD_CLASSES = [
  "FEC_FUNDING",
  "STATE_LEGISLATOR",
  "STATE_ROLL_CALL",
  "CENSUS_REFERENCE",
  "CENSUS_GEOGRAPHY",
] as const;
export type RoutineRecordClass = (typeof ROUTINE_RECORD_CLASSES)[number];

/** The canonical happy path, plus precise terminal refusal states. */
export const CANDIDATE_STATES = [
  "FETCHED",
  "NORMALIZED",
  "VALIDATED",
  "PROMOTED",
  "SOURCE_BLOCKED",
  "PARSE_INVALID",
  "IDENTITY_UNRESOLVED",
  "TEMPORAL_INVALID",
  "SEMANTIC_INVALID",
  "HORIZON_UNRESOLVED",
  "DEPENDENT_CONSUMER_INVALID",
  "CANNOT_TELL",
] as const;
export type CandidateState = (typeof CANDIDATE_STATES)[number];

export const VALIDATION_CHECKS = [
  "SOURCE_AUTHENTICITY",
  "SCHEMA_PARSE_VALIDITY",
  "IDENTITY_JURISDICTION_VALIDITY",
  "TEMPORAL_VALIDITY",
  "SEMANTIC_VALIDITY",
  "COMPLETENESS_HORIZON_VALIDITY",
  "ABSENCE_VALIDITY",
  "DEPENDENT_READ_MODEL_VALIDITY",
] as const;
export type ValidationCheckName = (typeof VALIDATION_CHECKS)[number];
export type CheckVerdict = "PASS" | "FAIL" | "CANNOT_TELL";
export type CandidateDecision = "GOOD" | "FAIL" | "CANNOT_TELL";

export interface ValidationCheck {
  readonly check: ValidationCheckName;
  readonly verdict: CheckVerdict;
  readonly code: string;
  readonly detail: string;
}

export interface ValidationReceipt {
  readonly contractVersion: 2;
  readonly decision: CandidateDecision;
  readonly candidateId: string;
  readonly sourceId: string;
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly validatedAt: string;
  readonly checks: readonly ValidationCheck[];
  /** Non-blocking, record-level facts deliberately omitted from the projection. */
  readonly excludedFacts: readonly { code: string; detail: string }[];
}

export type AbsencePolicy =
  | { readonly kind: "NEVER_FROM_ZERO" }
  | {
      readonly kind: "BOUNDED_QUERY_OR_EXPLICIT_STATEMENT";
      readonly requiredKeys: readonly string[];
    };

export interface SourceAuthorityContract {
  readonly id: string;
  readonly publisher: string;
  readonly trust: SourceTrustClass;
  readonly sourceClass: "FEDERAL_AGENCY" | "STATE_LEGISLATURE" | "OFFICIAL_PLATFORM" | "INTERMEDIARY";
  readonly routePrefixes: readonly string[];
  /** Redirect/final hosts. Authority inheritance is explicit, never `.gov`-wide. */
  readonly allowedFinalHosts: readonly string[];
  readonly jurisdictions: readonly string[];
  readonly recordClasses: readonly RoutineRecordClass[];
  readonly competentFacts: readonly string[];
  readonly expectedIdentifierKeys: readonly string[];
  readonly expectedTemporalFields: readonly string[];
  readonly horizonSemantics: string;
  readonly parserVersion: string;
  readonly freshnessExpectation: string;
  readonly absencePolicy: AbsencePolicy;
  /** T4 sources remain useful inputs, but may not auto-promote official truth. */
  readonly routineAutoPromotion: boolean;
}

export interface RetrievalEvidence {
  readonly succeeded: boolean;
  readonly requestedUrl: string;
  readonly finalUrl: string | null;
  readonly httpStatus: number | null;
  readonly retrievedAt: string;
  /** SHA-256, lowercase hex. Null when no response body was acquired. */
  readonly rawHash: string | null;
  readonly failureDetail?: string;
}

export interface NormalizationEvidence {
  readonly succeeded: boolean;
  readonly parserVersion: string;
  readonly schemaVersion: string;
  readonly normalizedHash: string | null;
  readonly inputRecords: number;
  readonly outputRecords: number;
  readonly droppedRecords: number;
  readonly missingRequiredFields: readonly string[];
  readonly failureDetail?: string;
}

export interface IdentityEvidence {
  readonly subjectId: string;
  readonly jurisdiction: string;
  readonly identifiers: Readonly<Record<string, string>>;
  readonly matchBasis: "OFFICIAL_ID" | "OFFICIAL_ID_CROSSWALK" | "EXACT_SCOPED_ID" | "NAME_ONLY";
  readonly ambiguous: boolean;
  readonly chamber?: string;
  readonly office?: string;
  readonly term?: string;
  readonly session?: string;
  readonly district?: string;
}

export interface TemporalEvidence {
  /** Product vintage, election/report period, legislative term/session, or source-through instant. */
  readonly version: string;
  readonly sourceThrough: string;
  readonly expectedVersion: string;
  readonly staleAtRetrieval: boolean;
}

export interface SemanticEvidence {
  readonly factKind: string;
  readonly actionStage?: string;
  readonly expectedActionStage?: string;
  readonly violations: readonly string[];
}

export interface HorizonEvidence {
  readonly kind: "BOUNDED" | "OPEN_FACT_SET";
  readonly query: string;
  readonly returnedRecords: number;
  readonly declaredTotal: number | null;
  readonly paginationComplete: boolean;
  readonly claimsComplete: boolean;
}

export interface AbsenceEvidence {
  readonly claimsAbsence: boolean;
  readonly basis: "NONE" | "ZERO_ONLY" | "EXPLICIT_OFFICIAL_STATEMENT" | "BOUNDED_AUTHORITATIVE_QUERY";
  readonly exactSubject: string | null;
  readonly exactHorizon: string | null;
}

export interface DependentCheck {
  readonly consumer: string;
  readonly passed: boolean;
  readonly detail: string;
}

/**
 * A fetched candidate presented to the deterministic promotion engine.
 * `normalizedPayload` is the canonical evidence shape; `readModel` is the
 * bounded projection Reader consumes. Reader never queries staging rows.
 */
export interface RoutineCandidate {
  readonly id: string;
  readonly sourceId: string;
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly retrieval: RetrievalEvidence;
  readonly normalization: NormalizationEvidence;
  readonly identities: readonly IdentityEvidence[];
  readonly temporal: TemporalEvidence;
  readonly semantics: SemanticEvidence;
  readonly horizon: HorizonEvidence;
  readonly absence: AbsenceEvidence;
  readonly dependentChecks: readonly DependentCheck[];
  readonly normalizedPayload: unknown;
  readonly readModel: unknown;
  /** Unresolved facts omitted without withholding individually valid facts. */
  readonly excludedFacts?: readonly { code: string; detail: string }[];
}

export interface CandidateEvent {
  readonly candidateId: string;
  readonly sequence: number;
  readonly state: CandidateState;
  readonly at: string;
  readonly detail: string;
}

export interface CandidateVersionRecord {
  readonly candidate: RoutineCandidate;
  readonly state: CandidateState;
  readonly acquisitionSucceeded: boolean;
  readonly receipt: ValidationReceipt | null;
  readonly promotedVersion: string | null;
  readonly lastKnownGoodVersion: string | null;
  readonly failureCode: string | null;
  readonly failureDetail: string | null;
}

export interface PromotedProjection<T = unknown> {
  readonly key: string;
  readonly sourceId: string;
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly versionId: string;
  readonly lastKnownGoodVersionId: string;
  readonly promotedAt: string;
  readonly payload: T;
  readonly receipt: ValidationReceipt;
}

