import type { DerivedInputKind, DerivedInputRef } from "./derived-authority.ts";
import type { UnchangedConfirmation } from "./unchanged-confirmation.ts";

export const SOURCE_TRUST_CLASSES = [
  "T1_AUTHORITATIVE_STRUCTURED",
  "T2_AUTHORITATIVE_DOCUMENT",
  "T3_ATTRIBUTED_PRIMARY",
  "T4_RESEARCH_SECONDARY",
] as const;
export type SourceTrustClass = (typeof SOURCE_TRUST_CLASSES)[number];

export const ROUTINE_RECORD_CLASSES = [
  "FEC_FUNDING",
  "STATE_CAMPAIGN_FINANCE",
  "LOCAL_CAMPAIGN_FINANCE",
  "STATE_LEGISLATOR",
  "STATE_ROLL_CALL",
  "STATE_LEGISLATOR_VOTES",
  "STATE_BILL",
  "FEDERAL_ROLL_CALL",
  "FEDERAL_KEY_VOTE",
  "FEDERAL_DIRECTORY",
  "FEDERAL_CIVIC_RECORD",
  "REGISTRY_RUNTIME_BINDING",
  "VOTING_SITE",
  "GOOGLE_CIVIC_VOTERINFO",
  "PRL_PROFILE",
  "PRL_ARCHIVE",
  "CENSUS_REFERENCE",
  "CENSUS_GEOGRAPHY",
  "MEETING",
  "BALLOT_FILING",
  "BALLOT_CANDIDACY",
  "CANDIDATE_PROFILE",
  "CANDIDATE_PUBLICATION",
  "OFFICEHOLDER_STATEMENT",
  "STATE_EXECUTIVE_ACTION",
  "MEETING_OUTCOME",
  "CURATED_READER_RECORD",
  "DOTGOV_REFERENCE",
  "OPERATIONAL_REFERENCE",
  "REGISTRATION",
  "FEDERAL_MONEY",
] as const;
export type RoutineRecordClass = (typeof ROUTINE_RECORD_CLASSES)[number];

export interface PublicRecord {
  readonly id: string;
  readonly kind: "PUBLIC_RECORD";
  readonly bodyId: string | null;
  readonly ocdId: string;
  readonly kindLabel: string;
  readonly title: string;
  readonly sourceUrl: string;
  readonly capturedAt: string;
  readonly sourceSentence: string;
}

export const ROUTINE_DATA_CLASSIFICATIONS = [
  "RUNTIME_CIVIC_DATA",
  "OPERATIONAL_REFERENCE_DATA",
] as const;
export type RoutineDataClassification = (typeof ROUTINE_DATA_CLASSIFICATIONS)[number];

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
  readonly excludedFacts: readonly {
    readonly key?: string | null;
    readonly code: string;
    readonly detail: string;
    readonly record?: unknown;
  }[];
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
  readonly sourceClass: "FEDERAL_AGENCY" | "FEDERAL_LEGISLATURE" | "STATE_LEGISLATURE" | "OFFICIAL_PLATFORM" | "MULTI_PUBLISHER_PRIMARY" | "INTERMEDIARY";
  readonly routePrefixes: readonly string[];
  readonly jurisdictions: readonly string[];
  readonly recordClasses: readonly RoutineRecordClass[];
  readonly competentFacts: readonly string[];
  readonly expectedIdentifierKeys: readonly string[];
  readonly expectedTemporalFields: readonly string[];
  readonly horizonSemantics: string;
  readonly parserVersion: string;
  readonly freshnessExpectation: string;
  readonly absencePolicy: AbsencePolicy;
  readonly routineAutoPromotion: boolean;
  readonly manualReceiptPromotion?: {
    readonly allowedSourceClasses: readonly ManualSourceClass[];
  };
  readonly derivedPromotion?: {
    readonly inputKinds: readonly DerivedInputKind[];
    readonly authorization: string;
  };
}

export const MANUAL_SOURCE_CLASSES = [
  "ELECTION_AUTHORITY",
  "CANDIDATE_CONTROLLED",
  "OFFICIAL_PUBLISHER",
  "REFERENCE_PUBLISHER",
  "FILING", "NEWS", "VOTER_GUIDE", "FORUM", "OTHER",
] as const;
export type ManualSourceClass = (typeof MANUAL_SOURCE_CLASSES)[number];

export interface ManualSourceReview {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly publisher: string;
  readonly sourceClass: ManualSourceClass;
  readonly retrievedAt: string;
  readonly httpStatus: number;
  readonly rawHash: string;
  readonly reviewedEvidence: string;
  /** Source documents decoded from these exact acquired archive bytes. Paths remain relative to the pinned repository. */
  readonly extractedMembers?: readonly { readonly path: string; readonly sha256: string }[];
  /** Omitted by legacy GOOD packages; omission means SUPPORTED. */
  readonly reviewOutcome?: "SUPPORTED" | "BLOCKED";
  readonly failureDetail?: string;
}

export interface ManualSourceSetReceipt {
  readonly contractVersion: 1;
  readonly reviewedAt: string;
  readonly reviewedBy: string;
  readonly sources: readonly ManualSourceReview[];
}

export interface SourceCheckEvidence {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly httpStatus: 200 | 304;
  readonly rawHash: string;
  readonly checkedAt: string;
}

export interface RetrievalEvidence {
  readonly succeeded: boolean;
  readonly requestedUrl: string;
  readonly finalUrl: string | null;
  readonly httpStatus: number | null;
  readonly retrievedAt: string;
  /** SHA-256, lowercase hex. Null when no response body was acquired. */
  readonly rawHash: string | null;
  /** Last actual provider check, retained unchanged on held-byte or parser replay. */
  readonly sourceCheck?: SourceCheckEvidence;
  readonly failureDetail?: string;
  readonly manualSourceReceipt?: ManualSourceSetReceipt;
  readonly derived?: { readonly inputs: readonly DerivedInputRef[] };
}

export interface NormalizationEvidence {
  readonly succeeded: boolean;
  readonly parserVersion: string;
  readonly schemaVersion: string;
  readonly normalizedHash: string | null;
    /** Required by every promotable production candidate; only fixtures that cannot reach a production door may omit it. */
  readonly normalizedPayloadHash?: string | null;
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

export interface SourceProjectionEvidence {
  readonly kind: "SOURCE_PROJECTION_CONTRACT";
  readonly sourceId: string;
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
}

export function sourceProjectionEvidence(
  sourceId: string,
  recordClass: RoutineRecordClass,
  scope: string,
): SourceProjectionEvidence {
  return { kind: "SOURCE_PROJECTION_CONTRACT", sourceId, recordClass, scope };
}

export interface CivicRecordMember {
  readonly key: string;
  readonly record: unknown;
}

export interface CivicRecordDelta {
  readonly key: string;
  readonly before: unknown | null;
  readonly after: unknown | null;
}

export interface HeldCivicRecord {
  readonly key: string | null;
  readonly code: string;
  readonly detail: string;
  readonly record?: unknown;
}

export interface RoutineChangeSet {
  readonly outcome: "CHANGED" | "UNCHANGED";
  readonly added: readonly CivicRecordDelta[];
  readonly changed: readonly CivicRecordDelta[];
  readonly removed: readonly CivicRecordDelta[];
  readonly held: readonly HeldCivicRecord[];
}

export type RoutineRemovalEvidence =
  | ServingWindowRemovalEvidence
  | OccurrenceSupersessionRemovalEvidence
  | PublisherExclusionRemovalEvidence
  | CensusPlaceholderBodyRemovalEvidence
  | RosterDepartureRemovalEvidence
  | AuditPullRemovalEvidence
  | MovedToHistoryRemovalEvidence
  | MovedToFactStoreRemovalEvidence
  | FederalRepartitionRemovalEvidence;

export interface FederalRepartitionRemovalEvidence {
  readonly key: string;
  readonly code: "FEDERAL_RECORD_REPARTITIONED";
  readonly targetScope: string;
  readonly targetVersionId: string;
}

/** A roster row removed from the registry partition: its members publish as facts. */
export interface MovedToFactStoreRemovalEvidence {
  readonly key: string;
  readonly code: "MOVED_TO_FACT_STORE";
}

/** A published member an auditor broke; the candidate must also hold it as an `AUDIT_PULLED_FROM_VERSION` excluded fact. */
export interface AuditPullRemovalEvidence {
  readonly key: string;
  readonly code: "REMOVED_BY_AUDIT_PULL";
  readonly memberId: string;
}

/** A concluded meeting leaves its partition only into the partition's history, which is promoted first. */
export interface MovedToHistoryRemovalEvidence {
  readonly key: string;
  readonly code: "MOVED_TO_HISTORY";
  readonly historyScope: string;
  readonly historyVersionId: string;
  /** The held window's lower bound at this candidate's clock; the sitting began before it. */
  readonly lowerBound: string;
  readonly priorStartsAt: string;
  readonly parentMeetingKey?: string;
}

export interface ServingWindowRemovalEvidence {
  readonly key: string;
  readonly code: "OUTSIDE_REGISTERED_SERVING_WINDOW";
  readonly windowContract: "MEETING_READER_SERVING_WINDOW_V1" | "MEETING_READER_SERVING_WINDOW_V2";
  readonly lowerBound: string;
  readonly upperBound: string;
  readonly priorStartsAt: string;
  readonly parentMeetingKey?: string;
}

export interface OccurrenceSupersessionRemovalEvidence {
  readonly key: string;
  readonly code: "SUPERSEDED_BY_OCCURRENCE_IDENTITY";
  readonly successorKey: string;
  readonly priorStartsAt: string;
  readonly parentMeetingKey?: string;
}

export interface PublisherExclusionRemovalEvidence {
  readonly key: string;
  readonly code: "EXCLUDED_BY_PUBLISHER";
  readonly seriesId: string;
  readonly slot: string;
  readonly priorStartsAt: string;
  readonly parentMeetingKey?: string;
}

/** A registry body on a Census "no district here" placeholder (LEA 99997) is geography, never a government. */
export interface CensusPlaceholderBodyRemovalEvidence {
  readonly key: string;
  readonly code: "CENSUS_PLACEHOLDER_NOT_A_GOVERNMENT";
  readonly divisionOcdId: string;
}

export interface RosterDepartureRemovalEvidence {
  readonly key: string;
  readonly code: "OFFICIAL_ROSTER_NO_LONGER_LISTS";
  readonly bodyId: string;
  readonly holderId: string;
  readonly sourceUrl: string;
  readonly replacementHolderId?: string;
  readonly officeTitle?: string;
}

export interface TrustedLkgFixtureEvidence {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface TrustedLkgLegacyMeetingsPartitionEvidence {
  readonly contractVersion: 1;
  readonly kind: "DURABLE_LEGACY_MEETINGS_PARTITION";
  readonly legacyKey: "MEETING:supported-bodies";
  readonly legacySourceId: "meetings-public-bodies";
  readonly legacyRecordClass: "MEETING";
  readonly legacyScope: "supported-bodies";
  readonly legacyVersionId: string;
  readonly legacyPromotedAt: string;
  readonly legacyPointerSha256: string;
  readonly legacyCandidateRecordSha256: string;
  readonly legacyCandidateSha256: string;
  readonly legacyReceiptSha256: string;
  readonly legacyPayloadSha256: string;
  readonly legacyReadModelSha256: string;
  readonly legacyNormalizedPayloadSha256: string;
  readonly legacyHistorySha256: string;
  readonly legacyHistoryEventCount: number;
  readonly legacyHistoryLastSequence: number;
  readonly legacyMeetingFactSha256: string;
  readonly legacyMeetingRowCount: number;
  readonly legacyAgendaDocumentRowCount: number;
  readonly partitionSourceName: string;
  readonly partitionBodyId: string;
  readonly partitionFactSha256: string;
  readonly partitionMeetingRowCount: number;
  readonly partitionAgendaDocumentRowCount: number;
}

export interface TrustedLkgPimaOutcomeUnionEvidence {
  readonly contractVersion: 1;
  readonly kind: "DURABLE_PIMA_OUTCOME_UNION";
  readonly predecessorVersionId: string;
  readonly predecessorPromotedAt: string;
  readonly predecessorPointerSha256: string;
  readonly predecessorCandidateRecordSha256: string;
  readonly predecessorCandidateSha256: string;
  readonly predecessorReceiptSha256: string;
  readonly predecessorReadModelSha256: string;
  readonly frozenGeneratedOn: string;
  readonly frozenGeneratedAt: string;
  readonly frozenSittings: readonly {
    readonly meetingId: string;
    readonly sha256: string;
  }[];
  readonly predecessorSittingCount: number;
  readonly unionSittingCount: number;
  readonly unionAuthoritySha256: string;
}

/** Provenance for a one-time transfer of a tracked LKG; never render or count it as a publisher acquisition. */
export interface TrustedLkgImportEvidence {
  readonly contractVersion: 1;
  readonly kind: "TRUSTED_LKG_IMPORT";
  readonly authorization: "PDC_V2_FROZEN_LKG_CUTOVER";
  readonly purpose: "PRESERVE_EXISTING_READER_LKG_DURING_AUTHORITY_TRANSFER";
  readonly sourceAuthenticated: false;
  readonly contractId: string;
  readonly sourceId: string;
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly parserVersion: string;
  readonly sourceVersion: string;
  readonly sourceThrough: string;
  readonly importedAt: string;
  readonly frozenBaseSha: string;
  readonly importerCodeSha: string;
  readonly fixtureSetSha256: string;
  readonly fixtures: readonly TrustedLkgFixtureEvidence[];
  readonly legacyMeetingsPartition?: TrustedLkgLegacyMeetingsPartitionEvidence;
  readonly pimaOutcomeUnion?: TrustedLkgPimaOutcomeUnionEvidence;
  readonly normalizedPayloadSha256: string;
  readonly readModelSha256: string;
  readonly candidateEnvelopeSha256: string;
  readonly validatorIds: readonly string[];
}

export interface TrustedLkgReattestationEvidence {
  readonly contractVersion: 1;
  readonly kind: "TRUSTED_LKG_REATTESTATION";
  readonly authorization: "PDC_V2_FROZEN_LKG_CUTOVER";
  readonly purpose: "RE_ATTEST_EXISTING_DURABLE_LKG_TO_PERMANENT_INTEGRITY_CONTRACT";
  readonly sourceAuthenticated: false;
    /** Absent, the ordinary byte-for-byte re-attestation contract applies. */
  readonly contractUpgrade?: "NH_MEMBERS_V2_TO_V3";
  readonly contractId: string;
  readonly sourceId: string;
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly parserVersion: string;
  readonly sourceVersion: string;
  readonly sourceThrough: string;
  readonly sourceRetrievedAt: string;
  readonly reattestedAt: string;
  readonly importerCodeSha: string;
  readonly predecessorVersionId: string;
  readonly predecessorPromotedAt: string;
  readonly predecessorPointerSha256: string;
  readonly predecessorCandidateRecordSha256: string;
  readonly predecessorCandidateSha256: string;
  readonly predecessorReceiptSha256: string;
  readonly predecessorPayloadSha256: string;
  readonly predecessorReadModelSha256: string;
  readonly predecessorNormalizedPayloadSha256: string;
  readonly predecessorLegacyNormalizedHash: string;
  readonly normalizedPayloadSha256: string;
  readonly readModelSha256: string;
  readonly candidateEnvelopeSha256: string;
  readonly validatorIds: readonly string[];
}

export type TrustedLkgTransferEvidence =
  | TrustedLkgImportEvidence
  | TrustedLkgReattestationEvidence;

/** `readModel` is the bounded projection Reader consumes; Reader never queries staging rows. */
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
  readonly sourceProjectionEvidence: SourceProjectionEvidence;
  readonly dependentChecks: readonly DependentCheck[];
  readonly normalizedPayload: unknown;
  readonly readModel: unknown;
  readonly civicRecords?: readonly CivicRecordMember[];
  readonly changeSet?: RoutineChangeSet;
  readonly removalEvidence?: readonly RoutineRemovalEvidence[];
  readonly bootstrapImport?: TrustedLkgTransferEvidence;
  readonly excludedFacts?: readonly {
    readonly key?: string | null;
    readonly code: string;
    readonly detail: string;
    readonly record?: unknown;
  }[];
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
    /** Reader freshness is measured from the later of this confirmation's retrieval and the version's. */
  readonly latestConfirmation?: UnchangedConfirmation;
}

export type PromotedPointerIdentity = Pick<
  PromotedProjection,
  "key" | "sourceId" | "recordClass" | "scope" | "versionId" | "lastKnownGoodVersionId" | "promotedAt" | "latestConfirmation"
>;
