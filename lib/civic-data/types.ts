import type { DerivedInputKind, DerivedInputRef } from "./derived-authority.ts";
import type { UnchangedConfirmation } from "./unchanged-confirmation.ts";

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
  "STATE_CAMPAIGN_FINANCE",
  "LOCAL_CAMPAIGN_FINANCE",
  "STATE_LEGISLATOR",
  "STATE_ROLL_CALL",
  "STATE_LEGISLATOR_VOTES",
  "FEDERAL_ROLL_CALL",
  "FEDERAL_KEY_VOTE",
  "FEDERAL_DIRECTORY",
  "REGISTRY_RUNTIME_BINDING",
  "VOTING_SITE",
  "PRL_PROFILE",
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
] as const;
export type RoutineRecordClass = (typeof ROUTINE_RECORD_CLASSES)[number];

/** Unknown civic shapes retain the source's own words; no new kind union is required. */
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
  /** T4 sources remain useful inputs, but may not auto-promote official truth. */
  readonly routineAutoPromotion: boolean;
  /** Dynamic primary publishers may promote only through an explicit reviewed source-set receipt. */
  readonly manualReceiptPromotion?: {
    readonly allowedSourceClasses: readonly ManualSourceClass[];
  };
  /**
   * A DERIVED authority has no route of its own: a candidate is authentic only as the exact inputs it names, of
   * these kinds (`lib/civic-data/derived-door.ts`), and a promoted input is checked against the store at the door.
   */
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
] as const;
export type ManualSourceClass = (typeof MANUAL_SOURCE_CLASSES)[number];

/** Exact-byte evidence reviewed by an owner before a manual production promotion. */
export interface ManualSourceReview {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly publisher: string;
  readonly sourceClass: ManualSourceClass;
  readonly retrievedAt: string;
  readonly httpStatus: number;
  readonly rawHash: string;
  readonly reviewedEvidence: string;
  /** Omitted by legacy GOOD packages; omission means SUPPORTED. */
  readonly reviewOutcome?: "SUPPORTED" | "BLOCKED";
  /** Required when exact acquired bytes cannot support positive promotion. */
  readonly failureDetail?: string;
}

export interface ManualSourceSetReceipt {
  readonly contractVersion: 1;
  readonly reviewedAt: string;
  readonly reviewedBy: string;
  readonly sources: readonly ManualSourceReview[];
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
  /** Required only by authorities whose publisher set is bounded by an owner-reviewed receipt. */
  readonly manualSourceReceipt?: ManualSourceSetReceipt;
  /**
   * Required only by a DERIVED authority: the exact inputs the candidate was computed from. `rawHash` is their
   * canonical hash and `retrievedAt` the newest input's own time (`derivedRetrieval`); there is no final URL.
   */
  readonly derived?: { readonly inputs: readonly DerivedInputRef[] };
}

export interface NormalizationEvidence {
  readonly succeeded: boolean;
  readonly parserVersion: string;
  readonly schemaVersion: string;
  /** SHA-256 of the exact bounded Reader projection. */
  readonly normalizedHash: string | null;
  /**
   * SHA-256 of the exact normalized/provenance evidence envelope. Required by
   * every promotable registered production candidate; legacy/unit fixtures
   * may omit it only when they cannot enter a production contract door.
   */
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
 * Binds every read-model/dependent check to the one candidate whose promotion
 * it may affect. Software-suite, UI, browser, and unrelated source outcomes
 * cannot be presented as evidence for this contract.
 */
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

/** One exact member of a normalized civic record set. */
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

/**
 * The exact, durable outcome compared with the previously promoted projection.
 * Counts shown by Admin are always derived from these member arrays.
 */
export interface RoutineChangeSet {
  readonly outcome: "CHANGED" | "UNCHANGED";
  readonly added: readonly CivicRecordDelta[];
  readonly changed: readonly CivicRecordDelta[];
  readonly removed: readonly CivicRecordDelta[];
  readonly held: readonly HeldCivicRecord[];
}

/**
 * Exact authority for removing one previously promoted record from an
 * incomplete candidate horizon. This is deliberately narrow: today only a
 * meeting (or one of its attached agenda-document versions) may age out of
 * the registered Reader serving window without a complete-universe claim, be
 * replaced by the fresh record that now holds its exact sitting or by the
 * occurrence record that now holds its exact fact, or be struck out of its
 * series by its publisher; and a registry body minted on a Census placeholder
 * may leave.
 */
export type RoutineRemovalEvidence =
  | ServingWindowRemovalEvidence
  | OccurrenceSupersessionRemovalEvidence
  | PublisherExclusionRemovalEvidence
  | CensusPlaceholderBodyRemovalEvidence
  | RosterDepartureRemovalEvidence
  | AuditPullRemovalEvidence
  | MovedToHistoryRemovalEvidence;

/**
 * A published member an auditor broke (BROKE). It leaves the next version instead of being carried
 * from its base. The candidate must also hold the member as an `AUDIT_PULLED_FROM_VERSION` excluded fact.
 */
export interface AuditPullRemovalEvidence {
  /** Exact `RoutineChangeSet.removed[].key`. */
  readonly key: string;
  readonly code: "REMOVED_BY_AUDIT_PULL";
  /** The curated member id the audit named. */
  readonly memberId: string;
}

/**
 * A concluded meeting that carries a record leaves its live partition only
 * into the partition's durable history (DB-06). The history version is
 * promoted FIRST; the validator re-derives the rest from the candidate, and the
 * door confirms the named history version holds the exact record, so no record
 * is ever in neither place. An attached agenda document inherits this from its
 * meeting.
 */
export interface MovedToHistoryRemovalEvidence {
  /** Exact `RoutineChangeSet.removed[].key`; evidence is never positional. */
  readonly key: string;
  readonly code: "MOVED_TO_HISTORY";
  /** The partition's history scope that holds the record. */
  readonly historyScope: string;
  /** The promoted history version that holds it. */
  readonly historyVersionId: string;
  /** The held window's lower bound at this candidate's clock; the sitting began before it. */
  readonly lowerBound: string;
  /** The previously promoted meeting's exact `startsAt`. */
  readonly priorStartsAt: string;
  /** Required only for an agenda document; names its exact moved meeting. */
  readonly parentMeetingKey?: string;
}

export interface ServingWindowRemovalEvidence {
  /** Exact `RoutineChangeSet.removed[].key`; evidence is never positional. */
  readonly key: string;
  readonly code: "OUTSIDE_REGISTERED_SERVING_WINDOW";
  /** Exact versioned Reader/acquisition window policy, never a caller-defined window. */
  readonly windowContract: "MEETING_READER_SERVING_WINDOW_V1" | "MEETING_READER_SERVING_WINDOW_V2";
  /** Inclusive registered window used by the acquisition/Reader. */
  readonly lowerBound: string;
  readonly upperBound: string;
  /** The previously promoted meeting's exact `startsAt`. */
  readonly priorStartsAt: string;
  /** Required only for an agenda document; names its exact removed meeting. */
  readonly parentMeetingKey?: string;
}

/**
 * A prior meeting record replaced by the fresh record that now holds its
 * sitting (see lib/sources/event-identity.ts): a series record since
 * 2026-09-23, a re-issued sitting since 2026-09-24. Two tests grant it, and the
 * validator re-derives either from the candidate itself; the successor is
 * always a fresh member of this candidate, never a carried one:
 *
 * - `supersedesSeriesRecord`: a recurring series' single `UID`-keyed record,
 *   replaced by an occurrence of exactly that series id, for the same body, at
 *   the removed record's start or in its slot.
 * - `reissuesSitting`: the same sitting its publisher re-issued under a new
 *   id: the same body id, the same body key from both the body name and the
 *   title, and the same local date and minute in the same zone.
 *
 * An agenda document attached to the removed record inherits this authority
 * from it, never on its own.
 */
export interface OccurrenceSupersessionRemovalEvidence {
  /** Exact `RoutineChangeSet.removed[].key`; evidence is never positional. */
  readonly key: string;
  readonly code: "SUPERSEDED_BY_OCCURRENCE_IDENTITY";
  /**
   * `meeting:<id>` of the fresh member of the same candidate that holds the
   * sitting: `<series id>/<slot>` for a series record, or the re-issued id.
   */
  readonly successorKey: string;
  /** The previously promoted meeting's exact `startsAt`. */
  readonly priorStartsAt: string;
  /** Required only for an agenda document; names its exact removed meeting. */
  readonly parentMeetingKey?: string;
}

/**
 * A published sitting of a recurring series that its publisher has since
 * struck out of the series (`EXDATE`), 2026-09-23. The validator re-derives it
 * from the candidate's own held fact `MEETING_EXCLUDED_BY_PUBLISHER`, which the
 * same read recorded: same series, same slot, same body, and the removed
 * record is that sitting (its occurrence id, or the series' own UID-only id at
 * that slot's instant). A cancellation the publisher states as a STATUS is not
 * this: it stays a status on a published sitting.
 */
export interface PublisherExclusionRemovalEvidence {
  /** Exact `RoutineChangeSet.removed[].key`; evidence is never positional. */
  readonly key: string;
  readonly code: "EXCLUDED_BY_PUBLISHER";
  /** The series' own meeting id, `<source>:<slug>:<UID>`. */
  readonly seriesId: string;
  /** The struck sitting's recurrence slot. */
  readonly slot: string;
  /** The previously promoted meeting's exact `startsAt`. */
  readonly priorStartsAt: string;
  /** Required only for an agenda document; names its exact removed meeting. */
  readonly parentMeetingKey?: string;
}

/**
 * A registry body on a Census "no district here" placeholder (LEA 99997) is
 * geography, never a government (Sean, 2026-09-23). The validator re-derives
 * the claim from the candidate itself and trusts nothing in this row alone:
 * the removed record is exactly `body:<its id>`, it sat on exactly this
 * division, and the candidate still holds that division as a placeholder by
 * its own Census code.
 */
export interface CensusPlaceholderBodyRemovalEvidence {
  /** Exact `RoutineChangeSet.removed[].key`: `body:<body id>`. */
  readonly key: string;
  readonly code: "CENSUS_PLACEHOLDER_NOT_A_GOVERNMENT";
  /** The removed body's division, which the candidate keeps. */
  readonly divisionOcdId: string;
}

/**
 * A departed officeholder's rows (reader disposition, candidacy bridge, photo)
 * leave with them: the body's complete official roster, read from `sourceUrl`
 * and carried by this candidate, no longer lists `holderId`.
 */
export interface RosterDepartureRemovalEvidence {
  /** Exact `RoutineChangeSet.removed[].key`, e.g. `official-candidacy:<holder id>`. */
  readonly key: string;
  readonly code: "OFFICIAL_ROSTER_NO_LONGER_LISTS";
  readonly bodyId: string;
  readonly holderId: string;
  readonly sourceUrl: string;
}

/** One immutable tracked input whose exact bytes were used for a PDC-v2 LKG import. */
export interface TrustedLkgFixtureEvidence {
  /** Repository-relative, forward-slash path whose exact bytes come from `frozenBaseSha`. */
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

/**
 * Exact durable authority from which one meeting partition was split during
 * the bounded PDC-v2 cutover.  The obsolete aggregate candidate and its event
 * history remain immutable after its pointer is retired, so every successor
 * can be audited back to the precise authority that was serving immediately
 * before transfer without pretending that the split was a new publisher read.
 */
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

/**
 * Exact predecessor witness for the one PDC-v2 manual import whose frozen LKG
 * must be unioned with an already-serving permanent pointer.  The frozen
 * twenty-sitting payload and the durable predecessor are both append-only
 * authorities: neither may silently overwrite a same-id sitting from the
 * other, and every non-conflicting sitting from both must survive.
 */
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
  /** Digest of the immutable fixture manifest plus the exact predecessor pointer. */
  readonly unionAuthoritySha256: string;
}

/**
 * Explicit provenance for the one-time PDC-v2 transfer of an already-serving
 * tracked LKG into the permanent store. This is not a publisher acquisition
 * and must never be rendered or counted as one.
 */
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
  /** SHA-256 of the canonical, path-sorted `fixtures` manifest. */
  readonly fixtureSetSha256: string;
  readonly fixtures: readonly TrustedLkgFixtureEvidence[];
  /**
   * Present only when the meeting payload came from the exact durable legacy
   * aggregate rather than frozen fixture bytes.  In that case `fixtures` is
   * deliberately empty and this witness is the complete transfer provenance.
   */
  readonly legacyMeetingsPartition?: TrustedLkgLegacyMeetingsPartitionEvidence;
  /** Present only for the bounded frozen-Pima-outcomes + durable-LKG union. */
  readonly pimaOutcomeUnion?: TrustedLkgPimaOutcomeUnionEvidence;
  /** Bind the exact normalized and Reader projections to this import receipt. */
  readonly normalizedPayloadSha256: string;
  readonly readModelSha256: string;
  /** Bind every persisted candidate proof field except derived id/change-set and this evidence itself. */
  readonly candidateEnvelopeSha256: string;
  readonly validatorIds: readonly string[];
}

/**
 * One-time, content-addressed successor for a durable authority promoted
 * before the permanent candidate-integrity contract existed. The predecessor
 * row remains immutable. These hashes make the exact authority transfer
 * independently auditable after the temporary importer is deleted.
 */
export interface TrustedLkgReattestationEvidence {
  readonly contractVersion: 1;
  readonly kind: "TRUSTED_LKG_REATTESTATION";
  readonly authorization: "PDC_V2_FROZEN_LKG_CUTOVER";
  readonly purpose: "RE_ATTEST_EXISTING_DURABLE_LKG_TO_PERMANENT_INTEGRITY_CONTRACT";
  readonly sourceAuthenticated: false;
  /**
   * The sole allowed structural bridge.  Legacy nh-members `/2` bound its
   * normalized extraction rather than its smaller Reader projection and did
   * not carry the import-only stable identities required by `/3`.  Absence
   * means the ordinary byte-for-byte re-attestation contract still applies.
   */
  readonly contractUpgrade?: "NH_MEMBERS_V2_TO_V3";
  readonly contractId: string;
  readonly sourceId: string;
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly parserVersion: string;
  readonly sourceVersion: string;
  readonly sourceThrough: string;
  /** Original publisher retrieval instant, copied unchanged to the successor. */
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
  readonly sourceProjectionEvidence: SourceProjectionEvidence;
  readonly dependentChecks: readonly DependentCheck[];
  readonly normalizedPayload: unknown;
  readonly readModel: unknown;
  /** Exact normalized members used to compute added/changed/removed outcomes. */
  readonly civicRecords?: readonly CivicRecordMember[];
  /** Added by the one promotion driver before the candidate is persisted. */
  readonly changeSet?: RoutineChangeSet;
  /** Exact, validator-checked authority for incomplete-horizon removals. */
  readonly removalEvidence?: readonly RoutineRemovalEvidence[];
  /** Present only on a one-time, explicitly non-source-authenticated LKG transfer. */
  readonly bootstrapImport?: TrustedLkgTransferEvidence;
  /** Unresolved facts omitted without withholding individually valid facts. */
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
  /**
   * The pointed version's newest unchanged confirmation, when one exists: a
   * re-check that found nothing new and kept readers on this version. Reader
   * freshness is measured from the later of its retrieval and the version's.
   */
  readonly latestConfirmation?: UnchangedConfirmation;
}

/**
 * A canonical pointer named, never carried: its identity columns and none of
 * its dataset. The payload is the Reader's value, up to tens of MB on the wire
 * for the largest classes; code that only names, compares, or appends evidence
 * to the current version reads this, and the typed Reader reads the payload.
 */
export type PromotedPointerIdentity = Pick<
  PromotedProjection,
  "key" | "sourceId" | "recordClass" | "scope" | "versionId" | "lastKnownGoodVersionId" | "promotedAt" | "latestConfirmation"
>;
