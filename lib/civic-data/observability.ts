/**
 * Server-side owner projection for the permanent routine civic-data plane.
 *
 * This module reads the three canonical data-plane tables. It does not write,
 * fetch a public source, infer an empty store from an error, or maintain an
 * Admin-specific outcome ledger. The pure projector is exported so the exact
 * evidence and count rules can be tested without a database connection.
 */
import {
  cadenceMsAt,
  sittingWindowRereadMs,
  type RoutineSourceContract,
} from "./contracts.ts";
import { MEETING_PARTITION_CONTRACTS, observableRoutineContracts, sittingWindowSourceIds } from "./meeting-partitions.ts";
import { meetingPayloadSittingStarts } from "./store.ts";
import {
  SITTING_WINDOW_ADMISSION_LEAD_MS,
  SITTING_WINDOW_BASE_ADMISSION_LEAD_MS,
  meetingPayloadStatedEnds,
  sittingWindowHotByConclusion,
  sittingWindowObligation,
  sittingWindowRetryMs,
} from "./sitting-window-admission.ts";
import {
  MANUAL_PRODUCTION_SOURCE_CONTRACTS,
  type ManualProductionSourceContract,
} from "./manual-contracts.ts";
import {
  CANDIDATE_STATES,
  type CandidateVersionRecord,
  type CandidateState,
  type CivicRecordDelta,
  type HeldCivicRecord,
  type PromotedProjection,
  type RoutineCandidate,
  type RoutineChangeSet,
  type ValidationReceipt,
} from "./types.ts";
import { parseValidationReceipt } from "./receipt.ts";
import { canonicalCivicDataJson } from "./changes.ts";
import { promotionProofIssue } from "./read-model.ts";
import {
  isReaderProjectionReadbackDetail,
  normalizeReaderCodeSha,
  parseReaderProjectionReadback,
} from "./reader-readback.ts";
import {
  UNCHANGED_CONFIRMATION_PREFIX,
  UNCHANGED_CONFIRMATION_SOURCES_PREFIX,
  isUnchangedConfirmationDetail,
  latestUnchangedConfirmation,
  parseUnchangedConfirmation,
  type UnchangedConfirmation,
} from "./unchanged-confirmation.ts";

/**
 * Evidence appended to a PROMOTED candidate that is not a disposition of it: a
 * Reader readback, or an unchanged confirmation and its sources event. Neither
 * is a source-state transition, and neither is a second promotion.
 */
function isNonDispositionEvidence(detail: string): boolean {
  return isReaderProjectionReadbackDetail(detail) || isUnchangedConfirmationDetail(detail);
}
import {
  isTrustedLkgImportCandidate,
  trustedLkgImportEvidenceIssue,
} from "./trusted-lkg-import.ts";

const HOUR = 60 * 60 * 1_000;
const HISTORY_WINDOWS = [
  { id: "24h", durationMs: 24 * HOUR },
  { id: "7d", durationMs: 7 * 24 * HOUR },
  { id: "30d", durationMs: 30 * 24 * HOUR },
] as const;

export type HistoryWindowId = (typeof HISTORY_WINDOWS)[number]["id"];
export type FreshnessState = "FRESH" | "DUE" | "STALE" | "UNKNOWN" | "MANUAL";
export type SourceOperationalState = "HEALTHY" | "DUE" | "STALE" | "UNKNOWN" | "RETRYING" | "HELD" | "IN_PROGRESS";
export type CandidateAuthorityOrigin = "LIVE_SOURCE_ACQUISITION" | "TRUSTED_LKG_IMPORT";
type ObservableCivicDataContract = RoutineSourceContract | ManualProductionSourceContract;

export interface CurrentReaderBuildIdentity {
  readonly codeSha: string | null;
  readonly branch: string | null;
  readonly context: string | null;
}

const UNKNOWN_READER_BUILD: CurrentReaderBuildIdentity = {
  codeSha: null,
  branch: null,
  context: null,
};

function isManualContract(contract: ObservableCivicDataContract): contract is ManualProductionSourceContract {
  return "execution" in contract && contract.execution === "EXPLICIT_OWNER_INVOCATION_ONLY";
}

/**
 * A value exists only when its evidence exists. In particular, a missing
 * persisted array is NOT_RECORDED; it is never rendered as numeric zero.
 */
export type Observation<T> =
  | { readonly kind: "MEASURED"; readonly value: T }
  | { readonly kind: "NOT_RECORDED"; readonly detail: string }
  | { readonly kind: "UNKNOWN"; readonly detail: string }
  | { readonly kind: "NOT_APPLICABLE"; readonly detail: string };

/** True only when this observation owes evidence that could actually exist. */
export function observationNeedsEvidence<T>(observation: Observation<T>): boolean {
  return observation.kind !== "MEASURED" && observation.kind !== "NOT_APPLICABLE";
}

/** Every numeric value carries the exact members/events from which it came. */
export type DrilldownCount<T> =
  | { readonly kind: "MEASURED"; readonly value: number; readonly members: readonly T[] }
  | { readonly kind: "NOT_RECORDED"; readonly detail: string; readonly members: readonly T[] }
  | { readonly kind: "UNKNOWN"; readonly detail: string; readonly members: readonly T[] };

export interface RoutineCandidateRow {
  readonly id: string;
  readonly sourceId: string;
  readonly recordClass: string;
  readonly scope: string;
  readonly state: string;
  readonly acquisitionSucceeded: boolean;
  readonly retrievedAt: string;
  readonly sourceThrough: string;
  readonly candidate: unknown;
  readonly validationReceipt: unknown | null;
  readonly promotedVersionId: string | null;
  readonly lastKnownGoodVersionId: string | null;
  readonly failureCode: string | null;
  readonly failureDetail: string | null;
}

export interface RoutineCandidateEventRow {
  readonly id: string;
  readonly candidateId: string;
  readonly sequence: number;
  readonly state: string;
  readonly at: string;
  readonly detail: string;
}

export interface RoutinePromotionRow {
  readonly key: string;
  readonly sourceId: string;
  readonly recordClass: string;
  readonly scope: string;
  readonly currentVersionId: string;
  readonly lastKnownGoodVersionId: string;
  readonly promotedAt: string;
  readonly payload: unknown;
  readonly validationReceipt: unknown;
}

export interface RoutinePreparedProjectionRow {
  readonly key: string;
  readonly recordClass: string;
  readonly scope: string;
  readonly sequence: number;
  readonly composedFrom: unknown;
  readonly generatedAt: string;
  readonly composedAt: string;
  readonly promotedThrough: string | null;
}

export interface RoutineObservabilityRows {
  readonly candidates: readonly RoutineCandidateRow[];
  readonly events: readonly RoutineCandidateEventRow[];
  readonly promotions: readonly RoutinePromotionRow[];
  /**
   * The prepared reader-serving snapshots (RULING 283 serving copies), read in
   * the SAME MVCC snapshot as the promotions above so publication lag is a
   * comparison of two facts from one instant, never two reads. Optional: a
   * caller that predates this read (or a store with no such table yet) leaves
   * it undefined, and the projector reports the serving copy as not-yet-read
   * rather than inventing an empty or a zero lag.
   */
  readonly preparedProjections?: readonly RoutinePreparedProjectionRow[];
}

export interface ExactChangedRecord {
  readonly candidateId: string;
  readonly attemptedAt: string;
  readonly kind: "ADDED" | "CHANGED" | "REMOVED";
  readonly key: string;
  readonly before: unknown | null;
  readonly after: unknown | null;
}

export interface ExactHeldRecord {
  readonly candidateId: string;
  readonly attemptedAt: string;
  readonly key: string | null;
  readonly code: string;
  readonly detail: string;
  readonly record?: unknown;
  readonly provenBy: "CANDIDATE_CHANGE_SET" | "VALIDATION_RECEIPT";
}

export interface ExactRefusedRecord {
  readonly candidateId: string;
  readonly attemptedAt: string;
  readonly check: string | null;
  readonly verdict: "FAIL" | "CANNOT_TELL" | null;
  readonly code: string;
  readonly detail: string;
  readonly provenBy: "VALIDATION_RECEIPT" | "CANDIDATE_TERMINAL_STATE";
}

export interface ExactOutcomeEvent {
  readonly id: string;
  readonly candidateId: string;
  readonly sequence: number;
  readonly domain: "SOURCE_STATE" | "READER_READBACK" | "UNCHANGED_CONFIRMATION";
  readonly state: Observation<CandidateState>;
  readonly at: string;
  readonly detail: string;
}

export interface AttemptHistoryMember {
  readonly candidateId: string;
  readonly attemptedAt: Observation<string>;
  readonly state: Observation<CandidateState>;
  readonly acquisitionSucceeded: Observation<boolean>;
  readonly authorityOrigin: CandidateAuthorityOrigin;
  readonly validation: Observation<ValidationReceipt>;
  readonly canonicalOutcome: Observation<"CHANGED" | "UNCHANGED">;
}

export interface CanonicalOutcomeHistoryMember {
  readonly candidateId: string;
  readonly eventId: string;
  readonly promotedAt: string;
  readonly outcome: "CHANGED" | "UNCHANGED";
}

export interface RoutineHistoryWindow {
  readonly id: HistoryWindowId;
  readonly since: string;
  readonly through: string;
  readonly attempts: readonly AttemptHistoryMember[];
  readonly events: readonly ExactOutcomeEvent[];
  readonly counts: {
    readonly attempts: DrilldownCount<AttemptHistoryMember>;
    readonly successfulAcquisitions: DrilldownCount<AttemptHistoryMember>;
    readonly promotions: DrilldownCount<ExactOutcomeEvent>;
    readonly changedOutcomes: DrilldownCount<CanonicalOutcomeHistoryMember>;
    readonly unchangedOutcomes: DrilldownCount<CanonicalOutcomeHistoryMember>;
    readonly added: DrilldownCount<ExactChangedRecord>;
    readonly changed: DrilldownCount<ExactChangedRecord>;
    readonly removed: DrilldownCount<ExactChangedRecord>;
    readonly held: DrilldownCount<ExactHeldRecord>;
    readonly refused: DrilldownCount<ExactRefusedRecord>;
  };
}

export interface CanonicalPromotionObservation {
  readonly versionId: string;
  readonly promotedAt: string;
  readonly receipt: ValidationReceipt;
  readonly authorityOrigin: CandidateAuthorityOrigin;
  readonly pointerProof: readonly string[];
}

export interface ReaderProjectionObservation {
  readonly projectionId: string;
  readonly versionId: string;
  readonly observedAt: string;
  readonly eventId: string;
  readonly evidenceKind: "TYPED_READER_READ_MODEL";
  readonly verifierId: string;
  readonly verifierCodeSha: string;
  readonly detail: string;
  readonly proof: readonly string[];
}

export interface LkgObservation {
  readonly versionId: string;
  readonly currentlyServing: boolean;
  readonly state: "CURRENT_PROMOTION" | "SERVING_AFTER_LATER_ATTEMPT" | "TRUSTED_LKG_IMPORT";
  readonly detail: string;
}

export interface RoutineContractObservation {
  readonly contractId: string;
  readonly sourceId: string;
  readonly recordClass: string;
  readonly scope: string;
  readonly classification: string;
  readonly currentState: Observation<CandidateState>;
  readonly lastAttemptedAcquisition: Observation<string>;
  readonly lastSuccessfulAcquisition: Observation<string>;
  readonly lastValidation: Observation<string>;
  readonly lastPromotion: Observation<string>;
  readonly canonicalPromotion: Observation<CanonicalPromotionObservation>;
  readonly readerVisible: Observation<ReaderProjectionObservation>;
  readonly sourceThrough: Observation<string>;
  readonly cadence: {
    readonly clock: "STANDING" | "MANUAL";
    readonly description: string;
    readonly activeEveryMs: number;
    readonly retryDescription: string;
    readonly nextDue: Observation<string>;
    /** Latest-attempt disposition, separate from the age of the serving LKG. */
    readonly operationalState: SourceOperationalState;
    readonly operationalDetail: string;
    readonly freshness: FreshnessState;
    readonly freshnessDetail: string;
  };
  readonly latestChanges: Observation<{
    readonly outcome: "CHANGED" | "UNCHANGED";
    readonly added: readonly ExactChangedRecord[];
    readonly changed: readonly ExactChangedRecord[];
    readonly removed: readonly ExactChangedRecord[];
  }>;
  readonly latestHeld: Observation<readonly ExactHeldRecord[]>;
  readonly latestRefused: Observation<readonly ExactRefusedRecord[]>;
  readonly latestCanonicalOutcome: Observation<"CHANGED" | "UNCHANGED">;
  readonly lkg: Observation<LkgObservation>;
  readonly histories: Readonly<Record<HistoryWindowId, RoutineHistoryWindow>>;
}

export interface RoutineContractMember {
  readonly contractId: string;
  readonly sourceId: string;
  readonly recordClass: string;
  readonly scope: string;
  readonly operationalState: SourceOperationalState;
  readonly freshness: FreshnessState;
}

/**
 * One promoted meeting partition whose current authoritative version has not
 * yet reached the prepared reader-serving snapshot — publication lag, made of
 * two facts read in one MVCC snapshot: the partition's current promotion and
 * what the serving copy was last composed from.
 */
export interface PreparedSnapshotLagMember {
  readonly contractId: string;
  readonly scope: string;
  readonly promotedVersionId: string;
  /** null when the partition is absent from the serving copy entirely. */
  readonly servedVersionId: string | null;
}

/**
 * The prepared meetings reader snapshot (the RULING 283 serving copy the reader
 * actually reads) observed against the authoritative promotions. It is not a
 * registered source contract, so it lives beside the contract rows rather than
 * as one of them: a serving projection, its freshness, and its lag behind the
 * promoted partitions — never presented as an acquisition or a promotion clock.
 */
export interface PreparedSnapshotObservation {
  readonly recordClass: string;
  readonly scope: string;
  readonly present: boolean;
  readonly sequence: Observation<number>;
  readonly generatedAt: Observation<string>;
  readonly composedAt: Observation<string>;
  readonly promotedThrough: Observation<string>;
  /** How many meeting partitions the serving copy was composed from. */
  readonly composedPartitions: Observation<number>;
  /** How many meeting partitions currently hold an authoritative promotion. */
  readonly promotedPartitions: Observation<number>;
  /** Promoted partitions not yet reflected in the serving copy. */
  readonly lag: DrilldownCount<PreparedSnapshotLagMember>;
  readonly detail: string;
}

export interface RoutineObservabilityView {
  readonly asOf: string;
  readonly source: "civic_data_candidates+civic_data_candidate_events+civic_data_promotions";
  readonly contracts: readonly RoutineContractObservation[];
  readonly summary: {
    readonly contracts: DrilldownCount<RoutineContractMember>;
    readonly healthy: DrilldownCount<RoutineContractMember>;
    readonly held: DrilldownCount<RoutineContractMember>;
    readonly retrying: DrilldownCount<RoutineContractMember>;
    readonly inProgress: DrilldownCount<RoutineContractMember>;
    readonly operationalDue: DrilldownCount<RoutineContractMember>;
    readonly operationalStale: DrilldownCount<RoutineContractMember>;
    readonly operationalUnknown: DrilldownCount<RoutineContractMember>;
    readonly fresh: DrilldownCount<RoutineContractMember>;
      readonly due: DrilldownCount<RoutineContractMember>;
      readonly stale: DrilldownCount<RoutineContractMember>;
      readonly unknown: DrilldownCount<RoutineContractMember>;
      readonly manual: DrilldownCount<RoutineContractMember>;
    readonly lkgServing: DrilldownCount<RoutineContractMember>;
    readonly readerVisible: DrilldownCount<RoutineContractMember>;
    readonly readerNotRecorded: DrilldownCount<RoutineContractMember>;
    readonly readerUnknown: DrilldownCount<RoutineContractMember>;
    readonly readerNotApplicable: DrilldownCount<RoutineContractMember>;
    readonly latestChanged: DrilldownCount<RoutineContractMember>;
    readonly latestUnchanged: DrilldownCount<RoutineContractMember>;
    readonly latestOutcomeNotRecorded: DrilldownCount<RoutineContractMember>;
    readonly latestOutcomeUnknown: DrilldownCount<RoutineContractMember>;
  };
  /** The prepared meetings reader-serving snapshot: its freshness and its lag. */
  readonly preparedMeetingSnapshot: PreparedSnapshotObservation;
}

export type RoutineObservabilityRead =
  | { readonly kind: "HELD"; readonly value: RoutineObservabilityView }
  | { readonly kind: "NOT_CONNECTED"; readonly detail: string }
  | {
      readonly kind: "STORE_UNREACHABLE";
      readonly detail: string;
      /** READ_TIMED_OUT: the store answered, but this read cannot finish inside a request's statement limit. */
      readonly cause?: "READ_TIMED_OUT";
    }
  | { readonly kind: "PROJECTION_FAILED"; readonly detail: string };

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function iso(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(Date.parse(value)).toISOString();
}

function candidateState(value: unknown): CandidateState | null {
  return typeof value === "string" && (CANDIDATE_STATES as readonly string[]).includes(value)
    ? value as CandidateState
    : null;
}

function delta(value: unknown): CivicRecordDelta | null {
  const row = object(value);
  return row && typeof row.key === "string" && "before" in row && "after" in row
    ? row as unknown as CivicRecordDelta
    : null;
}

function heldRecord(value: unknown): HeldCivicRecord | null {
  const row = object(value);
  return row && (row.key === null || typeof row.key === "string") && typeof row.code === "string" && typeof row.detail === "string"
    ? row as unknown as HeldCivicRecord
    : null;
}

function changeSet(value: unknown): RoutineChangeSet | null {
  const row = object(value);
  if (!row || !["CHANGED", "UNCHANGED"].includes(String(row.outcome))) return null;
  if (!Array.isArray(row.added) || !Array.isArray(row.changed) || !Array.isArray(row.removed) || !Array.isArray(row.held)) return null;
  if (!row.added.every((item) => delta(item) !== null)) return null;
  if (!row.changed.every((item) => delta(item) !== null)) return null;
  if (!row.removed.every((item) => delta(item) !== null)) return null;
  if (!row.held.every((item) => heldRecord(item) !== null)) return null;
  const changedProduction = row.added.length + row.changed.length + row.removed.length > 0;
  if ((row.outcome === "CHANGED") !== changedProduction) return null;
  return row as unknown as RoutineChangeSet;
}

function measured<T>(value: T): Observation<T> {
  return { kind: "MEASURED", value };
}

function notRecorded<T>(detail: string): Observation<T> {
  return { kind: "NOT_RECORDED", detail };
}

function unknown<T>(detail: string): Observation<T> {
  return { kind: "UNKNOWN", detail };
}

function notApplicable<T>(detail: string): Observation<T> {
  return { kind: "NOT_APPLICABLE", detail };
}

function exactCount<T>(members: readonly T[]): DrilldownCount<T> {
  return { kind: "MEASURED", value: members.length, members };
}

function compareIsoDesc(a: string, b: string): number {
  const left = Date.parse(a);
  const right = Date.parse(b);
  return (Number.isFinite(right) ? right : Number.NEGATIVE_INFINITY) -
    (Number.isFinite(left) ? left : Number.NEGATIVE_INFINITY);
}

function candidatePayload(row: RoutineCandidateRow): Record<string, unknown> | null {
  return object(row.candidate);
}

function candidateVersionRecord(row: RoutineCandidateRow): CandidateVersionRecord | null {
  const candidate = candidatePayload(row);
  const state = candidateState(row.state);
  const receipt = row.validationReceipt === null ? null : parseValidationReceipt(row.validationReceipt);
  if (!candidate || !state || (row.validationReceipt !== null && receipt === null)) return null;
  return {
    candidate: candidate as unknown as RoutineCandidate,
    state,
    acquisitionSucceeded: row.acquisitionSucceeded,
    receipt,
    promotedVersion: row.promotedVersionId,
    lastKnownGoodVersion: row.lastKnownGoodVersionId,
    failureCode: row.failureCode,
    failureDetail: row.failureDetail,
  };
}

function authorityOrigin(row: RoutineCandidateRow): CandidateAuthorityOrigin {
  return isTrustedLkgImportCandidate(row.candidate)
    ? "TRUSTED_LKG_IMPORT"
    : "LIVE_SOURCE_ACQUISITION";
}

function acquisitionEvidence(row: RoutineCandidateRow, nowMs: number): Observation<boolean> {
  const envelope = candidatePayload(row);
  if (envelope === null) return unknown(`Candidate ${row.id} has an unreadable candidate envelope.`);
  if (
    envelope.id !== row.id ||
    envelope.sourceId !== row.sourceId ||
    envelope.recordClass !== row.recordClass ||
    envelope.scope !== row.scope
  ) return unknown(`Candidate ${row.id} has an envelope whose identity does not match its durable row.`);
  if (
    Object.hasOwn(envelope, "bootstrapImport") &&
    envelope.bootstrapImport !== undefined &&
    !isTrustedLkgImportCandidate(envelope)
  ) {
    return unknown(`Candidate ${row.id} has an unrecognised authority-transfer marker; it cannot be called a live-source acquisition.`);
  }
  const retrieval = object(envelope.retrieval);
  if (retrieval === null || typeof retrieval.succeeded !== "boolean") {
    return unknown(`Candidate ${row.id} has no readable acquisition result in its envelope.`);
  }
  const durableAt = iso(row.retrievedAt);
  const envelopeAt = iso(retrieval.retrievedAt);
  if (durableAt === null || envelopeAt === null || durableAt !== envelopeAt) {
    return unknown(`Candidate ${row.id} has inconsistent acquisition times in its row and envelope.`);
  }
  if (Date.parse(durableAt) > nowMs) {
    return unknown(`Candidate ${row.id} records an acquisition in the future relative to this observation.`);
  }
  if (retrieval.succeeded !== row.acquisitionSucceeded) {
    return unknown(`Candidate ${row.id} has contradictory acquisition outcomes in its row and envelope.`);
  }
  return measured(row.acquisitionSucceeded);
}

/**
 * The append-only sequence-1 source event is the data plane's locally observed
 * attempt clock. Adapter-supplied retrieval time is evidence about the source
 * response, not authority over scheduling/history time; a bad future source
 * timestamp must therefore be containable rather than poisoning this clock.
 */
function sourceAttemptTime(
  row: RoutineCandidateRow,
  events: readonly RoutineCandidateEventRow[],
  nowMs: number,
): Observation<string> {
  const sourceEvents = events.filter((event) =>
    event.candidateId === row.id && !isNonDispositionEvidence(event.detail));
  if (sourceEvents.length === 0) {
    return notRecorded(`Candidate ${row.id} has no append-only source-state event, so its attempt time is not recorded.`);
  }
  if (sourceEvents.some((event) => !Number.isInteger(event.sequence) || event.sequence < 1)) {
    return unknown(`Candidate ${row.id} has an invalid source-state event sequence, so its attempt time cannot be proven.`);
  }
  if (new Set(sourceEvents.map((event) => event.sequence)).size !== sourceEvents.length) {
    return unknown(`Candidate ${row.id} has duplicate source-state event sequences, so its attempt time cannot be proven.`);
  }
  const ordered = [...sourceEvents].sort((left, right) => left.sequence - right.sequence);
  if (ordered[0]?.sequence !== 1) {
    return unknown(`Candidate ${row.id} has no exact sequence-1 source-state event, so its attempt time cannot be proven.`);
  }
  if (ordered.some((event, index) => event.sequence !== index + 1)) {
    return unknown(`Candidate ${row.id} has a noncontiguous source-state event sequence, so its attempt time cannot be proven.`);
  }
  let priorAt = Number.NEGATIVE_INFINITY;
  for (const event of ordered) {
    const eventAt = Date.parse(event.at);
    if (!Number.isFinite(eventAt) || eventAt > nowMs) {
      return unknown(`Candidate ${row.id} has an unreadable or future source-state event time.`);
    }
    if (eventAt < priorAt) {
      return unknown(`Candidate ${row.id} has source-state event time moving backward relative to sequence.`);
    }
    priorAt = eventAt;
  }
  const transitionIssue = adjacentSourceStateTransitionIssue(ordered);
  if (transitionIssue !== null) {
    return unknown(`Candidate ${row.id} has ${transitionIssue}, so its attempt history cannot be proven.`);
  }
  return measured(new Date(Date.parse(ordered[0]!.at)).toISOString());
}

/**
 * The durable source history is a state machine, not merely an ordered list of
 * recognised labels. Keeping this check pure lets every Admin proof path use
 * the same failure boundary: a skipped validation/normalisation state, a
 * revival after refusal, or a second source disposition is unreadable evidence
 * rather than a successful acquisition or promotion.
 *
 * Reader-readback PROMOTED events are a separate evidence domain and are
 * deliberately excluded before adjacent source transitions are considered.
 */
export function adjacentSourceStateTransitionIssue(
  events: readonly Pick<RoutineCandidateEventRow, "sequence" | "state" | "detail">[],
): string | null {
  const ordered = events
    .filter((event) => !isNonDispositionEvidence(event.detail))
    .sort((left, right) => left.sequence - right.sequence);
  const first = ordered[0];
  if (first) {
    const initial = candidateState(first.state);
    // `SOURCE_BLOCKED` is created atomically when acquisition itself fails.
    // Every acquisition that produced bytes begins FETCHED; no later pipeline
    // state may appear as though its missing predecessor evidence existed.
    if (initial !== null && initial !== "FETCHED" && initial !== "SOURCE_BLOCKED") {
      return `an illegal initial source state ${initial} at sequence ${first.sequence}`;
    }
  }
  for (let index = 1; index < ordered.length; index += 1) {
    const prior = candidateState(ordered[index - 1]!.state);
    const next = candidateState(ordered[index]!.state);
    // The existing state-shape checks own unrecognised labels. This helper is
    // solely the adjacent-transition authority and never guesses their value.
    if (prior === null || next === null) continue;
    const legal =
      (prior === "FETCHED" && (next === "NORMALIZED" || terminalRefusalState(next))) ||
      (prior === "NORMALIZED" && (next === "VALIDATED" || terminalRefusalState(next))) ||
      (prior === "VALIDATED" && (next === "PROMOTED" || terminalRefusalState(next)));
    if (!legal) {
      return `an illegal adjacent source-state transition ${prior} -> ${next} ` +
        `at sequences ${ordered[index - 1]!.sequence} -> ${ordered[index]!.sequence}`;
    }
  }
  return null;
}

function acquisitionTimeAfterValidationRefusalIssue(
  row: RoutineCandidateRow,
  receipt: ValidationReceipt,
  events: readonly RoutineCandidateEventRow[],
  nowMs: number,
): string | null {
  const firstFailure = receipt.checks.find((check) => check.verdict !== "PASS");
  if (
    firstFailure?.check !== "TEMPORAL_VALIDITY" ||
    firstFailure.code !== "ACQUISITION_TIME_AFTER_VALIDATION"
  ) return "the receipt's exact first non-PASS proof is not ACQUISITION_TIME_AFTER_VALIDATION";
  if (
    row.state !== "TEMPORAL_INVALID" ||
    row.failureCode !== firstFailure.code ||
    row.failureDetail !== firstFailure.detail ||
    row.promotedVersionId !== null ||
    receipt.decision === "GOOD"
  ) return "the durable terminal row does not match its acquisition-time refusal receipt";
  const retrievedAt = Date.parse(row.retrievedAt);
  const validatedAt = Date.parse(receipt.validatedAt);
  if (!Number.isFinite(retrievedAt) || !Number.isFinite(validatedAt) || retrievedAt <= validatedAt || validatedAt > nowMs) {
    return "the receipt does not prove a present local validation before the untrusted acquisition time";
  }
  const attemptAt = sourceAttemptTime(row, events, nowMs);
  if (attemptAt.kind !== "MEASURED") return attemptAt.detail;
  const sourceEvents = events
    .filter((event) => event.candidateId === row.id && !isNonDispositionEvidence(event.detail))
    .sort((left, right) => left.sequence - right.sequence);
  const terminalEvents = sourceEvents.filter((event) => {
    const state = candidateState(event.state);
    return state !== null && (state === "PROMOTED" || terminalRefusalState(state));
  });
  const terminal = terminalEvents[0];
  if (
    terminalEvents.length !== 1 ||
    terminal !== sourceEvents[sourceEvents.length - 1] ||
    terminal?.state !== "TEMPORAL_INVALID" ||
    iso(terminal.at) !== iso(receipt.validatedAt) ||
    terminal.detail !== firstFailure.detail ||
    Date.parse(attemptAt.value) > validatedAt
  ) return "the append-only terminal event does not exactly bind the local attempt, receipt, and refusal";
  return null;
}

function changeEvidence(row: RoutineCandidateRow): Observation<RoutineChangeSet> {
  const payload = candidatePayload(row);
  if (payload === null) return unknown(`Candidate ${row.id} has an unreadable candidate envelope.`);
  if (!("changeSet" in payload) || payload.changeSet === undefined) {
    return notRecorded(`Candidate ${row.id} has no persisted change-set outcome.`);
  }
  const parsed = changeSet(payload.changeSet);
  return parsed === null
    ? unknown(`Candidate ${row.id} has a persisted change set whose shape cannot be read.`)
    : measured(parsed);
}

function validationEvidence(
  row: RoutineCandidateRow,
  nowMs = Number.POSITIVE_INFINITY,
  events: readonly RoutineCandidateEventRow[] = [],
): Observation<ValidationReceipt> {
  if (row.validationReceipt === null) {
    return notRecorded(`Candidate ${row.id} has no validation receipt yet.`);
  }
  const parsed = parseValidationReceipt(row.validationReceipt);
  if (parsed === null) return unknown(`Candidate ${row.id} has a validation receipt whose shape cannot be read.`);
  if (
    parsed.candidateId !== row.id ||
    parsed.sourceId !== row.sourceId ||
    parsed.recordClass !== row.recordClass ||
    parsed.scope !== row.scope
  ) return unknown(`Candidate ${row.id} has a validation receipt whose identity does not match its durable row.`);
  const retrievedAt = Date.parse(row.retrievedAt);
  const validatedAt = Date.parse(parsed.validatedAt);
  if (!Number.isFinite(retrievedAt)) {
    return unknown(`Candidate ${row.id} has an unreadable acquisition time, so its validation order cannot be proven.`);
  }
  if (validatedAt > nowMs) {
    return unknown(`Candidate ${row.id} records validation in the future relative to this observation.`);
  }
  if (validatedAt < retrievedAt) {
    const refusalIssue = acquisitionTimeAfterValidationRefusalIssue(row, parsed, events, nowMs);
    if (refusalIssue !== null) {
      return unknown(`Candidate ${row.id} records validation before acquisition without an exact contained temporal refusal: ${refusalIssue}.`);
    }
  }
  return measured(parsed);
}

function exactChanges(row: RoutineCandidateRow, attemptedAt = row.retrievedAt): Observation<{
  readonly outcome: "CHANGED" | "UNCHANGED";
  readonly added: readonly ExactChangedRecord[];
  readonly changed: readonly ExactChangedRecord[];
  readonly removed: readonly ExactChangedRecord[];
}> {
  const evidence = changeEvidence(row);
  if (evidence.kind !== "MEASURED") return evidence;
  const map = (kind: ExactChangedRecord["kind"], values: readonly CivicRecordDelta[]): ExactChangedRecord[] =>
    values.map((item) => ({ candidateId: row.id, attemptedAt, kind, ...item }));
  return measured({
    outcome: evidence.value.outcome,
    added: map("ADDED", evidence.value.added),
    changed: map("CHANGED", evidence.value.changed),
    removed: map("REMOVED", evidence.value.removed),
  });
}

function exactHeld(
  row: RoutineCandidateRow,
  nowMs = Number.POSITIVE_INFINITY,
  events: readonly RoutineCandidateEventRow[] = [],
  attemptedAt = row.retrievedAt,
): Observation<readonly ExactHeldRecord[]> {
  const changes = changeEvidence(row);
  const validation = validationEvidence(row, nowMs, events);
  const values: ExactHeldRecord[] = [];
  if (changes.kind === "MEASURED") {
    for (const item of changes.value.held) {
      values.push({
        candidateId: row.id,
        attemptedAt,
        key: item.key,
        code: item.code,
        detail: item.detail,
        ...(item.record === undefined ? {} : { record: item.record }),
        provenBy: "CANDIDATE_CHANGE_SET",
      });
    }
  }
  if (validation.kind === "MEASURED") {
    for (const item of validation.value.excludedFacts) {
      const itemRecord = Object.hasOwn(item, "record") ? item.record : undefined;
      const duplicate = values.some((held) =>
        held.key === (item.key ?? null) &&
        held.code === item.code &&
        held.detail === item.detail &&
        canonicalCivicDataJson(held.record) === canonicalCivicDataJson(itemRecord));
      if (!duplicate) {
        values.push({
          candidateId: row.id,
          attemptedAt,
          key: item.key ?? null,
          code: item.code,
          detail: item.detail,
          ...(Object.hasOwn(item, "record") ? { record: itemRecord } : {}),
          provenBy: "VALIDATION_RECEIPT",
        });
      }
    }
  }
  if (changes.kind === "UNKNOWN" || validation.kind === "UNKNOWN") {
    return unknown(`Some held-record evidence for ${row.id} is unreadable.`);
  }
  if (changes.kind === "NOT_RECORDED" && validation.kind === "NOT_RECORDED") {
    return notRecorded(`Candidate ${row.id} records neither a change set nor a validation receipt.`);
  }
  return measured(values);
}

function exactRefused(
  row: RoutineCandidateRow,
  nowMs = Number.POSITIVE_INFINITY,
  events: readonly RoutineCandidateEventRow[] = [],
  attemptedAt = row.retrievedAt,
): Observation<readonly ExactRefusedRecord[]> {
  const validation = validationEvidence(row, nowMs, events);
  if (validation.kind === "UNKNOWN") return validation;
  if (validation.kind === "MEASURED") {
    const state = candidateState(row.state);
    if (state === null) return unknown(`Candidate ${row.id} has an unknown state, so its refusal receipt cannot be reconciled.`);
    const terminal = terminalRefusalState(state);
    if ((validation.value.decision === "GOOD") === terminal || ["FETCHED", "NORMALIZED"].includes(state)) {
      return unknown(`Candidate ${row.id} has contradictory state and validation-decision evidence.`);
    }
    return measured(validation.value.checks.flatMap((check) => check.verdict === "PASS" ? [] : [{
      candidateId: row.id,
      attemptedAt,
      check: check.check,
      verdict: check.verdict,
      code: check.code,
      detail: check.detail,
      provenBy: "VALIDATION_RECEIPT" as const,
    }]));
  }
  if (row.failureCode !== null || row.failureDetail !== null) {
    return measured([{
      candidateId: row.id,
      attemptedAt,
      check: null,
      verdict: null,
      code: row.failureCode ?? "TERMINAL_FAILURE",
      detail: row.failureDetail ?? "The candidate terminal state records a failure without detail.",
      provenBy: "CANDIDATE_TERMINAL_STATE",
    }]);
  }
  const state = candidateState(row.state);
  if (state === null) return unknown(`Candidate ${row.id} has an unknown state and no readable refusal receipt.`);
  if (["FETCHED", "NORMALIZED"].includes(state)) return measured([]);
  if (state === "VALIDATED") return unknown(`Validated candidate ${row.id} has no durable validation receipt.`);
  return state === "PROMOTED"
    ? unknown(`Promoted candidate ${row.id} has no readable validation receipt.`)
    : notRecorded(`Candidate ${row.id} has no durable refusal receipt or failure reason.`);
}

function exactEvent(row: RoutineCandidateEventRow): ExactOutcomeEvent {
  const state = candidateState(row.state);
  return {
    ...row,
    domain: isReaderProjectionReadbackDetail(row.detail)
      ? "READER_READBACK"
      : isUnchangedConfirmationDetail(row.detail) ? "UNCHANGED_CONFIRMATION" : "SOURCE_STATE",
    state: state === null
      ? unknown(`Event ${row.id} carries an unrecognised state ${row.state}.`)
      : measured(state),
  };
}

function pointerProof(
  contract: ObservableCivicDataContract,
  promotions: readonly RoutinePromotionRow[],
  candidates: readonly RoutineCandidateRow[],
  events: readonly RoutineCandidateEventRow[],
  nowMs: number,
): Observation<CanonicalPromotionObservation> {
  const matches = promotions.filter((row) => row.recordClass === contract.recordClass && row.scope === contract.scope);
  if (matches.length === 0) {
    return notRecorded(`The store answered and holds no canonical pointer for ${contract.recordClass}:${contract.scope}.`);
  }
  if (matches.length !== 1) return unknown(`The canonical pointer query returned ${matches.length} rows; uniqueness is not proven.`);
  const promotion = matches[0];
  const reasons: string[] = [];
  if (promotion.key !== `${contract.recordClass}:${contract.scope}`) reasons.push("pointer key does not match record class and scope");
  if (promotion.sourceId !== contract.sourceId) reasons.push("pointer source does not match the registered contract");
  const promotedAt = iso(promotion.promotedAt);
  if (promotedAt === null) reasons.push("promotion time is unreadable");
  else if (Date.parse(promotedAt) > nowMs) reasons.push("promotion time is in the future relative to this observation");
  const candidatesForPointer = candidates.filter((row) => row.id === promotion.currentVersionId);
  if (candidatesForPointer.length !== 1) reasons.push(`pointer names ${candidatesForPointer.length} candidate rows`);
  const candidate = candidatesForPointer[0];
  const promotedReceipt = parseValidationReceipt(promotion.validationReceipt);
  if (promotedReceipt === null) reasons.push("pointer receipt is unreadable");
  if (candidate) {
    let predecessorRecord: CandidateVersionRecord | null = null;
    if (candidate.sourceId !== contract.sourceId || candidate.recordClass !== contract.recordClass || candidate.scope !== contract.scope) {
      reasons.push("candidate identity does not match the registered contract");
    }
    if (candidate.state !== "PROMOTED" || candidate.promotedVersionId !== promotion.currentVersionId) {
      reasons.push("candidate row does not prove the PROMOTED transition");
    }
    const acquisition = acquisitionEvidence(candidate, nowMs);
    if (acquisition.kind !== "MEASURED") reasons.push(acquisition.detail);
    else if (!acquisition.value) reasons.push("promoted candidate does not record a successfully acquired input envelope");
    if (candidate.sourceThrough.trim() === "") reasons.push("promoted candidate has no source-through value");
    const envelope = candidatePayload(candidate);
    if (!envelope || envelope.id !== candidate.id || envelope.sourceId !== candidate.sourceId || envelope.recordClass !== candidate.recordClass || envelope.scope !== candidate.scope) {
      reasons.push("candidate envelope identity does not match its durable row");
    }
    const retrieval = object(envelope?.retrieval);
    const temporal = object(envelope?.temporal);
    if (retrieval?.succeeded !== candidate.acquisitionSucceeded) {
      reasons.push("candidate acquisition outcome differs between its durable row and envelope");
    }
    if (iso(retrieval?.retrievedAt) !== iso(candidate.retrievedAt)) {
      reasons.push("candidate retrieval time differs between its durable row and envelope");
    }
    if (temporal?.sourceThrough !== candidate.sourceThrough) {
      reasons.push("candidate source-through differs between its durable row and envelope");
    }
    if (envelope && isTrustedLkgImportCandidate(envelope)) {
      const transferEvidence = envelope.bootstrapImport;
      const predecessorVersionId = transferEvidence.kind === "TRUSTED_LKG_REATTESTATION"
        ? transferEvidence.predecessorVersionId
        : transferEvidence.pimaOutcomeUnion?.predecessorVersionId ?? null;
      if (predecessorVersionId !== null) {
        const predecessorRows = candidates.filter(({ id }) =>
          id === predecessorVersionId
        );
        if (predecessorRows.length !== 1) {
          reasons.push(
            `trusted transfer names ${predecessorRows.length} exact predecessor candidate rows`,
          );
        } else {
          predecessorRecord = candidateVersionRecord(predecessorRows[0]!);
          if (predecessorRecord === null) {
            reasons.push("the trusted-transfer predecessor row is malformed");
          }
        }
      }
      const importIssue = trustedLkgImportEvidenceIssue(
        envelope as unknown as RoutineCandidate,
        predecessorRecord,
      );
      if (importIssue !== null) reasons.push(`trusted-LKG import evidence failed: ${importIssue}`);
    }
    const candidateReceipt = parseValidationReceipt(candidate.validationReceipt);
    if (candidateReceipt === null || candidateReceipt.decision !== "GOOD") reasons.push("candidate row lacks a GOOD receipt");
    if (candidateReceipt && promotedAt) {
      const retrieved = Date.parse(candidate.retrievedAt);
      const validated = Date.parse(candidateReceipt.validatedAt);
      const promoted = Date.parse(promotedAt);
      if (!Number.isFinite(retrieved) || retrieved > validated || validated > promoted) {
        reasons.push("retrieval, validation, and promotion times are not ordered");
      }
      if (validated > nowMs) reasons.push("validation time is in the future relative to this observation");
    }
    if (candidateReceipt && promotedReceipt && canonicalCivicDataJson(candidateReceipt) !== canonicalCivicDataJson(promotedReceipt)) {
      reasons.push("candidate and pointer receipts differ");
    }
    const state = candidateState(candidate.state);
    if (envelope && state && candidateReceipt && promotedReceipt) {
      const proofIssue = promotionProofIssue(
        contract.recordClass,
        contract.scope,
        {
          key: promotion.key,
          sourceId: promotion.sourceId,
          recordClass: contract.recordClass,
          scope: promotion.scope,
          versionId: promotion.currentVersionId,
          lastKnownGoodVersionId: promotion.lastKnownGoodVersionId,
          promotedAt: promotion.promotedAt,
          payload: promotion.payload,
          receipt: promotedReceipt,
        } satisfies PromotedProjection,
        {
          candidate: envelope as unknown as RoutineCandidate,
          state,
          acquisitionSucceeded: candidate.acquisitionSucceeded,
          receipt: candidateReceipt,
          promotedVersion: candidate.promotedVersionId,
          lastKnownGoodVersion: candidate.lastKnownGoodVersionId,
          failureCode: candidate.failureCode,
          failureDetail: candidate.failureDetail,
        } satisfies CandidateVersionRecord,
        predecessorRecord,
      );
      if (proofIssue !== null) reasons.push(`canonical source promotion proof failed: ${proofIssue}`);
    }
  }
  const promotionEvents = events.filter((event) =>
    event.candidateId === promotion.currentVersionId &&
    event.state === "PROMOTED" &&
    !isNonDispositionEvidence(event.detail));
  const candidateEvents = events.filter((event) => event.candidateId === promotion.currentVersionId);
  // Reader delivery is a separate failure domain. A malformed/future Reader
  // receipt makes delivery UNKNOWN below; it must not invalidate a valid
  // source promotion or reclassify that source as failed.
  const sourceEvents = candidateEvents.filter((event) => !isNonDispositionEvidence(event.detail));
  const unreadableSourceStates = sourceEvents.filter((event) => candidateState(event.state) === null);
  if (unreadableSourceStates.length > 0) reasons.push(`${unreadableSourceStates.length} source event state(s) are unrecognised`);
  const invalidSequences = sourceEvents.filter((event) => !Number.isInteger(event.sequence) || event.sequence < 1);
  if (invalidSequences.length > 0) reasons.push(`${invalidSequences.length} source event sequence(s) are invalid`);
  const sequenceCounts = new Map<number, number>();
  for (const event of sourceEvents) sequenceCounts.set(event.sequence, (sequenceCounts.get(event.sequence) ?? 0) + 1);
  const duplicateSequences = [...sequenceCounts.values()].filter((count) => count > 1).length;
  if (duplicateSequences > 0) reasons.push(`${duplicateSequences} source event sequence(s) are duplicated`);
  const orderedEvents = [...sourceEvents].sort((left, right) => left.sequence - right.sequence);
  if (orderedEvents.some((event, index) => event.sequence !== index + 1)) {
    reasons.push("source event sequence is not contiguous from 1");
  }
  const transitionIssue = adjacentSourceStateTransitionIssue(orderedEvents);
  if (transitionIssue !== null) reasons.push(transitionIssue);
  let priorEventAt = Number.NEGATIVE_INFINITY;
  for (const event of orderedEvents) {
    const eventAt = Date.parse(event.at);
    if (!Number.isFinite(eventAt)) {
      reasons.push(`candidate event ${event.id} has an unreadable time`);
      continue;
    }
    if (eventAt > nowMs) reasons.push(`candidate event ${event.id} is in the future relative to this observation`);
    if (eventAt < priorEventAt) reasons.push(`candidate event ${event.id} moves backward in time relative to event sequence`);
    priorEventAt = Math.max(priorEventAt, eventAt);
  }
  if (promotionEvents.length !== 1) {
    reasons.push(`pointer has ${promotionEvents.length} matching atomic PROMOTED events`);
  } else {
    const [promotionEvent] = promotionEvents;
    if (!Number.isInteger(promotionEvent.sequence) || promotionEvent.sequence < 1) {
      reasons.push("atomic PROMOTED event sequence is invalid");
    }
    if (iso(promotionEvent.at) !== promotedAt) {
      reasons.push("atomic PROMOTED event time does not match the pointer");
    }
    const laterSourceEvents = sourceEvents.filter((event) => event.sequence > promotionEvent.sequence);
    if (laterSourceEvents.length > 0) {
      reasons.push(`atomic PROMOTED event is followed by ${laterSourceEvents.length} source-state event(s)`);
    }
    const earlierTerminalRefusals = sourceEvents.filter((event) => {
      const state = candidateState(event.state);
      return event.sequence < promotionEvent.sequence &&
        state !== null && terminalRefusalState(state);
    });
    if (earlierTerminalRefusals.length > 0) {
      reasons.push(`promoted candidate has ${earlierTerminalRefusals.length} earlier terminal refusal event(s)`);
    }
  }
  if (promotedReceipt) {
    if (promotedReceipt.decision !== "GOOD") reasons.push("pointer receipt is not GOOD");
    if (
      promotedReceipt.candidateId !== promotion.currentVersionId ||
      promotedReceipt.sourceId !== contract.sourceId ||
      promotedReceipt.recordClass !== contract.recordClass ||
      promotedReceipt.scope !== contract.scope
    ) reasons.push("pointer receipt identity does not match the pointer and contract");
  }
  if (reasons.length > 0 || promotedAt === null || promotedReceipt === null) {
    return unknown(`Canonical source promotion pointer proof failed: ${reasons.join("; ") || "unreadable canonical evidence"}.`);
  }
  return measured({
    versionId: promotion.currentVersionId,
    promotedAt,
    receipt: promotedReceipt,
    authorityOrigin: candidate && authorityOrigin(candidate) === "TRUSTED_LKG_IMPORT"
      ? "TRUSTED_LKG_IMPORT"
      : "LIVE_SOURCE_ACQUISITION",
    pointerProof: [
      `contract:${contract.id}`,
      `candidate:${promotion.currentVersionId}:PROMOTED`,
      `receipt:${promotedReceipt.candidateId}:GOOD`,
      `authority-origin:${candidate && authorityOrigin(candidate) === "TRUSTED_LKG_IMPORT" ? "TRUSTED_LKG_IMPORT" : "LIVE_SOURCE_ACQUISITION"}`,
      `pointer:${promotion.key}:${promotion.currentVersionId}`,
    ],
  });
}

function readerProjectionProof(
  contract: ObservableCivicDataContract,
  canonical: Observation<CanonicalPromotionObservation>,
  events: readonly RoutineCandidateEventRow[],
  currentReaderBuild: CurrentReaderBuildIdentity,
  nowMs: number,
): Observation<ReaderProjectionObservation> {
  if (contract.readerProjection === null) return notApplicable(`Contract ${contract.id} has no Reader projection.`);
  if (canonical.kind === "UNKNOWN") return unknown(`The contract has a Reader projection, but ${canonical.detail}`);
  if (canonical.kind !== "MEASURED") return notRecorded(`The contract has a Reader projection, but ${canonical.detail}`);
  const marked = events.filter((event) =>
    event.candidateId === canonical.value.versionId && isReaderProjectionReadbackDetail(event.detail));
  if (marked.length === 0) {
    return notRecorded(`Canonical version ${canonical.value.versionId} has no durable Reader-projection readback receipt.`);
  }
  if (marked.some((event) => iso(event.at) === null || Date.parse(event.at) > nowMs)) {
    return unknown(`Canonical version ${canonical.value.versionId} has a Reader-projection event with an unreadable or future time.`);
  }
  if (marked.some((event) => !Number.isInteger(event.sequence) || event.sequence < 1)) {
    return unknown(`Canonical version ${canonical.value.versionId} has a Reader-projection event with an invalid append-only sequence.`);
  }
  if (new Set(marked.map((event) => event.sequence)).size !== marked.length) {
    return unknown(`Canonical version ${canonical.value.versionId} has duplicate Reader-projection event sequences.`);
  }
  const ordered = [...marked].sort((left, right) => left.sequence - right.sequence);
  if (ordered.some((event, index) => index > 0 && Date.parse(event.at) < Date.parse(ordered[index - 1].at))) {
    return unknown(`Canonical version ${canonical.value.versionId} has Reader-projection event time moving backward relative to append-only sequence.`);
  }
  const latest = ordered[ordered.length - 1];
  const receipt = parseReaderProjectionReadback(latest.detail);
  if (receipt === null) {
    return unknown(`Canonical version ${canonical.value.versionId} has a malformed Reader-projection readback receipt.`);
  }
  if (
    latest.state !== "PROMOTED" ||
    iso(latest.at) !== iso(receipt.observedAt) ||
    receipt.contractId !== contract.id ||
    receipt.sourceId !== contract.sourceId ||
    receipt.recordClass !== contract.recordClass ||
    receipt.scope !== contract.scope ||
    receipt.projectionId !== contract.readerProjection?.id ||
    receipt.versionId !== canonical.value.versionId ||
    receipt.pointerKey !== `${contract.recordClass}:${contract.scope}` ||
    Date.parse(receipt.observedAt) < Date.parse(canonical.value.promotedAt) ||
    Date.parse(receipt.observedAt) > nowMs
  ) {
    return unknown("The latest Reader-projection readback receipt does not match the canonical contract/version.");
  }
  const atomicPromotion = events.find((event) =>
    event.candidateId === canonical.value.versionId &&
    event.state === "PROMOTED" &&
    !isNonDispositionEvidence(event.detail));
  if (!atomicPromotion || latest.sequence <= atomicPromotion.sequence) {
    return unknown("The latest Reader-projection readback does not follow the canonical atomic promotion event.");
  }
  // Quiet source re-checks append confirmation + retained-source events to the
  // same candidate. Reader-only sequence numbers therefore need not be adjacent.
  // Prove continuity against ALL appended evidence, never skip a missing event.
  const appended = events.filter(event => event.candidateId === canonical.value.versionId && event.sequence > atomicPromotion.sequence)
    .sort((a, b) => a.sequence - b.sequence);
  if (appended.some((event, index) => event.sequence !== atomicPromotion.sequence + index + 1)) {
    return unknown(
      `Canonical version ${canonical.value.versionId} has a gap between its atomic promotion and append-only Reader-projection history.`,
    );
  }
  for (const event of appended) {
    if (event.state !== "PROMOTED" || iso(event.at) === null || Date.parse(event.at) > nowMs) {
      return unknown("The append-only Reader history contains invalid state or time evidence.");
    }
    if (event.detail.startsWith(UNCHANGED_CONFIRMATION_PREFIX)) {
      const confirmation = parseUnchangedConfirmation(event.detail);
      if (!confirmation || confirmation.versionId !== canonical.value.versionId || confirmation.sourceId !== contract.sourceId ||
          confirmation.recordClass !== contract.recordClass || confirmation.scope !== contract.scope ||
          confirmation.pointerKey !== `${contract.recordClass}:${contract.scope}` || iso(confirmation.observedAt) !== iso(event.at)) {
        return unknown("The append-only Reader history contains a malformed or mismatched unchanged confirmation.");
      }
    } else if (event.detail.startsWith(UNCHANGED_CONFIRMATION_SOURCES_PREFIX)) {
      let sources: Record<string, unknown> | null = null;
      try { sources = object(JSON.parse(event.detail.slice(UNCHANGED_CONFIRMATION_SOURCES_PREFIX.length))); } catch { /* fail closed below */ }
      const previous = appended.find(row => row.sequence === event.sequence - 1);
      const confirmation = previous ? parseUnchangedConfirmation(previous.detail) : null;
      if (!sources || !confirmation || sources.versionId !== confirmation.versionId || sources.observedAt !== confirmation.observedAt ||
          iso(String(sources.observedAt)) !== iso(event.at) || !Array.isArray(sources.retainedSourceResponses)) {
        return unknown("The append-only Reader history contains malformed or unpaired confirmation sources.");
      }
    }
  }
  if (receipt.status !== "PASS") {
    return unknown(`Typed Reader read-model verification failed for canonical version ${receipt.versionId}: ${receipt.detail}`);
  }
  if (currentReaderBuild.context?.trim() !== "production") {
    return unknown(
      `The current Reader build context is ${currentReaderBuild.context?.trim() || "not recorded"}, not Netlify production.`,
    );
  }
  if (currentReaderBuild.branch?.trim() !== "main") {
    return unknown(
      `The current Reader build branch is ${currentReaderBuild.branch?.trim() || "not recorded"}, not main.`,
    );
  }
  const deployedReaderCodeSha = normalizeReaderCodeSha(currentReaderBuild.codeSha);
  if (deployedReaderCodeSha === null) {
    return unknown("The deployed Reader code commit is not recorded, so this readback cannot establish a current deployed-code read-model proof.");
  }
  if (receipt.verifierCodeSha !== deployedReaderCodeSha) {
    return unknown(
      `Typed Reader read-model verification ran on ${receipt.verifierCodeSha ?? "an unknown code commit"}, not deployed Reader commit ${deployedReaderCodeSha}.`,
    );
  }
  return measured({
    projectionId: receipt.projectionId,
    versionId: receipt.versionId,
    observedAt: receipt.observedAt,
    eventId: latest.id,
    evidenceKind: receipt.evidenceKind,
    verifierId: receipt.verifierId,
    verifierCodeSha: deployedReaderCodeSha,
    detail: receipt.detail,
    proof: [
      ...canonical.value.pointerProof,
      `reader-readback-event:${latest.id}`,
      `typed-reader-verifier:${receipt.verifierId}`,
      `deployed-reader-code:${deployedReaderCodeSha}`,
      `reader-projection:${receipt.projectionId}:${receipt.versionId}`,
    ],
  });
}

function freshness(
  contract: ObservableCivicDataContract,
  canonicalCandidate: RoutineCandidateRow | undefined,
  nowMs: number,
  confirmation: UnchangedConfirmation | null = null,
  activeEveryMs?: number,
): { readonly state: FreshnessState; readonly detail: string } {
  if (!canonicalCandidate) return { state: "UNKNOWN", detail: "No proven canonical promotion is recorded, so production freshness cannot be measured." };
  // A confirmed re-check re-read the source and found the canonical version current.
  const succeededAt = Math.max(
    Date.parse(canonicalCandidate.retrievedAt),
    confirmation ? Date.parse(confirmation.retrieval.retrievedAt) : Number.NEGATIVE_INFINITY,
  );
  if (!Number.isFinite(succeededAt)) return { state: "UNKNOWN", detail: "The canonical acquisition time is unreadable." };
  if (succeededAt > nowMs) return { state: "UNKNOWN", detail: "The canonical acquisition time is in the future relative to this observation." };
  if (authorityOrigin(canonicalCandidate) === "TRUSTED_LKG_IMPORT") {
    return {
      state: "STALE",
      detail: "A frozen trusted LKG is serving, but it is explicitly not a source-authenticated freshness observation; the permanent source path remains due now.",
    };
  }
  if (isManualContract(contract)) {
    return { state: "MANUAL", detail: "This canonical projection advances only on explicit owner invocation; it has no due/stale clock." };
  }
  const cadenceMs = activeEveryMs ?? cadenceMsAt(contract, nowMs);
  const dueAt = succeededAt + cadenceMs;
  if (canonicalCandidate.sourceThrough.trim() === "") return { state: "UNKNOWN", detail: "The canonical candidate has no source-through value." };
  const temporal = object(candidatePayload(canonicalCandidate)?.temporal);
  if (temporal?.staleAtRetrieval === true) return { state: "STALE", detail: "The canonical receipt promoted source data already marked stale at acquisition." };
  if (temporal && "staleAtRetrieval" in temporal && typeof temporal.staleAtRetrieval !== "boolean") {
    return { state: "UNKNOWN", detail: "The canonical candidate's source-staleness evidence is unreadable." };
  }
  if (nowMs < dueAt) return { state: "FRESH", detail: `The canonical GOOD acquisition is inside the active ${cadenceMs / HOUR}-hour cadence.` };
  if (nowMs < dueAt + cadenceMs) return { state: "DUE", detail: "The ordinary cadence has elapsed and the source is due now." };
  return { state: "STALE", detail: "The source is more than one active cadence beyond its expected acquisition time." };
}

function nextDue(
  contract: ObservableCivicDataContract,
  latest: RoutineCandidateRow | undefined,
  lastPromoted: RoutineCandidateRow | undefined,
  events: readonly RoutineCandidateEventRow[],
  nowMs: number,
  latestOrderIssue: string | null = null,
  sittingHot?: boolean,
  confirmation: UnchangedConfirmation | null = null,
  published = true,
): Observation<string> {
  if (isManualContract(contract)) return notApplicable("Manual production contract: no next-due clock exists.");
  if (latest && authorityOrigin(latest) === "TRUSTED_LKG_IMPORT") {
    return measured(new Date(nowMs).toISOString());
  }
  if (latestOrderIssue !== null) return unknown(`The next due time cannot be proven because ${latestOrderIssue}`);
  if (!latest) return measured(new Date(nowMs).toISOString());
  const attemptedAt = sourceAttemptTime(latest, events, nowMs);
  if (attemptedAt.kind !== "MEASURED") {
    return unknown(`The next due time cannot be proven because ${attemptedAt.detail}`);
  }
  const acquisition = acquisitionEvidence(latest, nowMs);
  const receipt = parseValidationReceipt(latest.validationReceipt);
  const containedTemporalRefusal = receipt !== null &&
    acquisitionTimeAfterValidationRefusalIssue(latest, receipt, events, nowMs) === null;
  if (acquisition.kind !== "MEASURED" && !containedTemporalRefusal) {
    return unknown(`The next due time cannot be proven because ${acquisition.detail}`);
  }
  const confirmedMs = confirmation ? Date.parse(confirmation.observedAt) : Number.NEGATIVE_INFINITY;
  const attempted = Math.max(Date.parse(attemptedAt.value), confirmedMs);
  const succeededAt = lastPromoted ? sourceAttemptTime(lastPromoted, events, nowMs) : null;
  const newestSuccess = Math.max(succeededAt?.kind === "MEASURED" ? Date.parse(succeededAt.value) : Number.NEGATIVE_INFINITY, confirmedMs);
  const succeeded = Number.isFinite(newestSuccess) ? newestSuccess : Number.NaN;
  const schedule = "schedule" in contract ? contract.schedule : undefined;
  if (schedule?.kind === "SITTING_WINDOW") {
    const { eligibleAtMs } = sittingWindowObligation(
      schedule,
      contract.retry.afterMs,
      { attemptedMs: attempted, succeededMs: succeeded, published: runnerSeesPublished(contract, published) },
      sittingHot,
    );
    return measured(new Date(eligibleAtMs).toISOString());
  }
  if (!Number.isFinite(succeeded) || attempted > succeeded) {
    return measured(new Date(attempted + contract.retry.afterMs).toISOString());
  }
  return measured(new Date(succeeded + cadenceMsAt(contract, nowMs)).toISOString());
}

/**
 * The runner reads publication from a MEETING scope's sitting list, which the
 * store reports only for MEETING scopes; every other record class keeps its
 * contract's retry, and so does its Admin row.
 */
function runnerSeesPublished(contract: RoutineSourceContract, published: boolean): boolean {
  return published || contract.recordClass !== "MEETING";
}

/**
 * The instant the runner admits a retry of an attempt made at `attemptedMs`.
 * A sitting-window retry is owed on the contract clock, or twice daily for a
 * meeting partition never published (R20), and admitted 15 minutes early (C6).
 */
function observedRetryAtMs(contract: RoutineSourceContract, attemptedMs: number, published: boolean): number {
  const schedule = contract.schedule;
  if (schedule?.kind !== "SITTING_WINDOW") return attemptedMs + contract.retry.afterMs;
  return sittingWindowObligation(
    schedule,
    contract.retry.afterMs,
    { attemptedMs, succeededMs: Number.NaN, published: runnerSeesPublished(contract, published) },
    undefined,
  ).eligibleAtMs;
}

function observedRetryDescription(contract: RoutineSourceContract, published: boolean): string {
  const schedule = contract.schedule;
  if (schedule?.kind !== "SITTING_WINDOW") return contract.retry.description;
  const retryMs = sittingWindowRetryMs(schedule, contract.retry.afterMs, runnerSeesPublished(contract, published));
  const lead = `; an hourly read or retry is admitted up to ${SITTING_WINDOW_ADMISSION_LEAD_MS / 60_000} minutes before it is owed, a twice-daily read up to ${SITTING_WINDOW_BASE_ADMISSION_LEAD_MS / 3_600_000} hours`;
  return retryMs === contract.retry.afterMs
    ? `${contract.retry.description}${lead}`
    : `${contract.retry.description}; never published, so ${Math.round(retryMs / 3_600_000)} hours after its last attempt (the base cadence)${lead}`;
}

/**
 * Each sitting-window contract's hot signal at `nowMs`, from the promoted
 * MEETING payloads this projection already read: the same sitting starts, and
 * the same rule, the runner admits on.
 */
function sittingWindowSignalsFromPromotions(
  contracts: readonly ObservableCivicDataContract[],
  promotions: readonly RoutinePromotionRow[],
  nowMs: number,
): ReadonlyMap<string, boolean | undefined> {
  const startsByScope = new Map(promotions
    .filter((row) => row.recordClass === "MEETING")
    .map((row) => [row.scope, meetingPayloadSittingStarts(row.payload)] as const));
  const startsById = new Map(MEETING_PARTITION_CONTRACTS.map((partition) => [partition.id, startsByScope.get(partition.scope)]));
  // A publisher-stated end decides when its sitting concluded, as the runner reads it (C6).
  const endsByScope = new Map(promotions
    .filter((row) => row.recordClass === "MEETING")
    .map((row) => [row.scope, meetingPayloadStatedEnds(row.payload)] as const));
  const endsById = new Map(MEETING_PARTITION_CONTRACTS.map((partition) => [partition.id, endsByScope.get(partition.scope)]));
  const signals = new Map<string, boolean | undefined>();
  for (const contract of contracts) {
    const schedule = "schedule" in contract ? contract.schedule : undefined;
    if (schedule?.kind !== "SITTING_WINDOW") continue;
    const sources = sittingWindowSourceIds(contract.id);
    const ends = new Map(sources.flatMap((id) => [...(endsById.get(id) ?? new Map<string, number>())]));
    signals.set(contract.id, sittingWindowHotByConclusion(schedule, sources.map((id) => startsById.get(id)), nowMs, ends));
  }
  return signals;
}

const TERMINAL_REFUSAL_STATES = new Set<CandidateState>([
  "SOURCE_BLOCKED",
  "PARSE_INVALID",
  "IDENTITY_UNRESOLVED",
  "TEMPORAL_INVALID",
  "SEMANTIC_INVALID",
  "HORIZON_UNRESOLVED",
  "DEPENDENT_CONSUMER_INVALID",
  "CANNOT_TELL",
]);

/**
 * Current operational disposition and canonical-data age are independent.
 * A fresh LKG may be serving while a later attempt is held or backing off;
 * that source must not render HEALTHY merely because its old GOOD row is young.
 */
function operationalState(
  contract: ObservableCivicDataContract,
  latest: RoutineCandidateRow | undefined,
  candidates: readonly RoutineCandidateRow[],
  canonicalCandidate: RoutineCandidateRow | undefined,
  canonical: Observation<CanonicalPromotionObservation>,
  readerProjection: Observation<ReaderProjectionObservation>,
  canonicalFreshness: FreshnessState,
  events: readonly RoutineCandidateEventRow[],
  nowMs: number,
): { readonly state: SourceOperationalState; readonly detail: string } {
  if (!latest) return { state: "UNKNOWN", detail: "No source attempt is recorded." };
  const state = candidateState(latest.state);
  if (state === null) return { state: "UNKNOWN", detail: `The latest candidate carries unrecognised state ${latest.state}.` };
  const latestAttempt = sourceAttemptTime(latest, events, nowMs);
  if (latestAttempt.kind !== "MEASURED") return { state: "UNKNOWN", detail: latestAttempt.detail };
  const latestAt = Date.parse(latestAttempt.value);
  const acquisition = acquisitionEvidence(latest, nowMs);
  const receipt = parseValidationReceipt(latest.validationReceipt);
  const containedTemporalRefusal = receipt !== null &&
    acquisitionTimeAfterValidationRefusalIssue(latest, receipt, events, nowMs) === null;
  if (acquisition.kind !== "MEASURED" && !containedTemporalRefusal) {
    return { state: "UNKNOWN", detail: acquisition.detail };
  }
  const stateEventIssue = currentCandidateEventIssue(latest, candidates, events, nowMs);
  if (stateEventIssue !== null) return { state: "UNKNOWN", detail: stateEventIssue };
  const canonicalAttempt = canonicalCandidate ? sourceAttemptTime(canonicalCandidate, events, nowMs) : null;
  const canonicalAt = canonicalAttempt?.kind === "MEASURED" ? Date.parse(canonicalAttempt.value) : Number.NaN;
  const isLaterAttempt = canonicalCandidate === undefined || (
    latest.id !== canonicalCandidate.id && (!Number.isFinite(canonicalAt) || latestAt > canonicalAt)
  );
  if (TERMINAL_REFUSAL_STATES.has(state) && isLaterAttempt) {
    const refusal = exactRefused(latest, nowMs, events, latestAttempt.value);
    if (refusal.kind !== "MEASURED" || refusal.value.length === 0) {
      return {
        state: "UNKNOWN",
        detail: refusal.kind === "MEASURED"
          ? `The latest candidate claims ${state}, but its source-scoped refusal evidence is empty.`
          : `The latest candidate claims ${state}, but its source-scoped refusal evidence is ${refusal.kind}: ${refusal.detail}`,
      };
    }
    if (isManualContract(contract)) {
      return {
        state: "HELD",
        detail: canonical.kind === "MEASURED"
          ? `The latest owner-invoked attempt ended ${state}; proof-valid canonical version ${canonical.value.versionId} remains LKG until the owner reruns it.`
          : `The latest owner-invoked attempt ended ${state}; canonical/LKG service is ${canonical.kind}: ${canonical.detail}`,
      };
    }
    const retryAt = observedRetryAtMs(contract, latestAt, canonical.kind !== "NOT_RECORDED");
    if (nowMs < retryAt) {
      return {
        state: "RETRYING",
        detail: canonical.kind === "MEASURED"
          ? `The latest attempt ended ${state}; proof-valid canonical version ${canonical.value.versionId} remains LKG and automatic retry is due ${new Date(retryAt).toISOString()}.`
          : `The latest attempt ended ${state}; automatic retry is due ${new Date(retryAt).toISOString()}, while canonical/LKG service is ${canonical.kind}: ${canonical.detail}`,
      };
    }
    return { state: "HELD", detail: `The latest attempt ended ${state}; its retry instant ${new Date(retryAt).toISOString()} has elapsed without a newer recorded attempt.` };
  }
  if (["FETCHED", "NORMALIZED", "VALIDATED"].includes(state) && isLaterAttempt) {
    if (isManualContract(contract)) {
      return { state: "IN_PROGRESS", detail: `Owner-invoked candidate ${latest.id} most recently reached ${state}; no terminal source disposition is recorded yet.` };
    }
    const overdueAt = latestAt + contract.retry.afterMs;
    return nowMs < overdueAt
      ? { state: "IN_PROGRESS", detail: `Candidate ${latest.id} most recently reached ${state}; no terminal source disposition is recorded yet.` }
      : {
          state: "HELD",
          detail: canonical.kind === "MEASURED"
            ? `Candidate ${latest.id} remained ${state} past ${new Date(overdueAt).toISOString()} without a terminal source disposition; proof-valid canonical version ${canonical.value.versionId} remains LKG.`
            : `Candidate ${latest.id} remained ${state} past ${new Date(overdueAt).toISOString()} without a terminal source disposition; canonical/LKG service is ${canonical.kind}: ${canonical.detail}`,
        };
  }
  if (canonical.kind === "UNKNOWN") return { state: "UNKNOWN", detail: canonical.detail };
  if (canonical.kind !== "MEASURED") return { state: "UNKNOWN", detail: "No proof-valid canonical promotion is recorded." };
  if (state === "PROMOTED" && isLaterAttempt && canonical.value.versionId !== latest.id) {
    return { state: "UNKNOWN", detail: `Candidate ${latest.id} claims PROMOTED but canonical pointer proof names ${canonical.value.versionId}.` };
  }
  if (contract.readerProjection !== null && readerProjection.kind !== "MEASURED") {
    return {
      state: "UNKNOWN",
      detail: `The source promotion remains canonical, but its typed Reader read-model proof is ${readerProjection.kind}: ${readerProjection.detail}`,
    };
  }
  if (canonicalFreshness === "UNKNOWN") return { state: "UNKNOWN", detail: "The canonical version's freshness cannot be established." };
  if (canonicalFreshness === "STALE") return { state: "STALE", detail: "The current proof-valid canonical version is stale." };
  if (canonicalFreshness === "DUE") return { state: "DUE", detail: "The current proof-valid canonical version is due for its next acquisition." };
  return {
    state: "HEALTHY",
    detail: canonicalFreshness === "MANUAL"
      ? "The latest owner-invoked attempt is the current proof-valid promotion and its deployed-code typed Reader read model is proven."
      : "The latest attempt is the current proof-valid promotion and remains inside cadence.",
  };
}

function observedState(row: RoutineCandidateRow | undefined): Observation<CandidateState> {
  if (!row) return notRecorded("The store answered and no acquisition attempt is recorded for this contract.");
  const state = candidateState(row.state);
  return state === null
    ? unknown(`Candidate ${row.id} carries the unrecognised state ${row.state}.`)
    : measured(state);
}

type SourceAcquisitionEvidence = {
  readonly row: RoutineCandidateRow;
  readonly evidence: Observation<boolean>;
  readonly attemptedAt: Observation<string>;
  readonly containedTemporalRefusal: boolean;
};

function latestAttemptTime(
  items: readonly SourceAcquisitionEvidence[],
  absent: string,
): Observation<string> {
  if (items.length === 0) return notRecorded(absent);
  const uncertain = items.find((item) => item.attemptedAt.kind !== "MEASURED");
  if (uncertain && uncertain.attemptedAt.kind !== "MEASURED") {
    return unknown(`The latest attempt cannot be proven because ${uncertain.attemptedAt.detail}`);
  }
  const measuredItems = items as readonly (SourceAcquisitionEvidence & {
    readonly attemptedAt: { readonly kind: "MEASURED"; readonly value: string };
  })[];
  const latestMs = Math.max(...measuredItems.map((item) => Date.parse(item.attemptedAt.value)));
  const tied = measuredItems.filter((item) => Date.parse(item.attemptedAt.value) === latestMs);
  if (new Set(tied.map((item) => item.row.id)).size > 1) {
    return unknown(
      `${tied.length} distinct source attempts share local attempt instant ${new Date(latestMs).toISOString()}; their causal order is not recorded.`,
    );
  }
  return measured(new Date(latestMs).toISOString());
}

/**
 * A confirmation is a successful source acquisition that wrote no candidate.
 * It moves a recorded or absent time forward. An unprovable one stays
 * unprovable: newer evidence never hides a gap.
 */
function withConfirmation(observation: Observation<string>, confirmation: UnchangedConfirmation | null): Observation<string> {
  if (confirmation === null || observation.kind === "UNKNOWN") return observation;
  if (observation.kind === "MEASURED" && Date.parse(observation.value) >= Date.parse(confirmation.observedAt)) return observation;
  return measured(new Date(Date.parse(confirmation.observedAt)).toISOString());
}

function latestSourceAttempt(
  items: readonly SourceAcquisitionEvidence[],
): Observation<string> {
  return latestAttemptTime(
    items,
    "No source-authenticated acquisition attempt is recorded for this contract.",
  );
}

function latestSuccessfulSourceAcquisition(
  items: readonly SourceAcquisitionEvidence[],
): Observation<string> {
  const successes = items.flatMap((item) =>
    item.evidence.kind === "MEASURED" && item.evidence.value ? [item] : []);
  const latestSuccess = latestAttemptTime(
    successes,
    "No source-authenticated acquisition is recorded for this contract.",
  );
  if (latestSuccess.kind === "UNKNOWN") return latestSuccess;
  const uncertain = items.filter((item) => item.evidence.kind !== "MEASURED" && !item.containedTemporalRefusal);
  const latestUncertain = latestAttemptTime(
    uncertain,
    "No uncertain source acquisition is recorded.",
  );
  if (latestUncertain.kind === "UNKNOWN") return latestUncertain;
  if (latestUncertain.kind === "MEASURED") {
    const successMs = latestSuccess.kind === "MEASURED"
      ? Date.parse(latestSuccess.value)
      : Number.NEGATIVE_INFINITY;
    if (Date.parse(latestUncertain.value) >= successMs) {
      const issue = uncertain.find((item) =>
        item.attemptedAt.kind === "MEASURED" && item.attemptedAt.value === latestUncertain.value);
      return unknown(`The latest successful source acquisition cannot be proven because ${issue?.evidence.kind === "UNKNOWN" ? issue.evidence.detail : "newer acquisition evidence is incomplete."}`);
    }
  }
  return latestSuccess;
}

/**
 * There is no causal tie-breaker for two distinct attempts at the same latest
 * instant. A UUID/order-by choice may make the page deterministic, but it
 * cannot make either candidate the proven latest source disposition.
 */
function latestCandidateOrderIssue(
  candidates: readonly RoutineCandidateRow[],
  events: readonly RoutineCandidateEventRow[],
  nowMs: number,
): string | null {
  if (candidates.length === 0) return null;
  const attempts = candidates.map((row) => ({ row, attemptedAt: sourceAttemptTime(row, events, nowMs) }));
  const uncertain = attempts.find((item) => item.attemptedAt.kind !== "MEASURED");
  if (uncertain && uncertain.attemptedAt.kind !== "MEASURED") return uncertain.attemptedAt.detail;
  const measuredAttempts = attempts as readonly {
    readonly row: RoutineCandidateRow;
    readonly attemptedAt: { readonly kind: "MEASURED"; readonly value: string };
  }[];
  const latestAt = Math.max(...measuredAttempts.map((item) => Date.parse(item.attemptedAt.value)));
  const tied = measuredAttempts.filter((item) => Date.parse(item.attemptedAt.value) === latestAt);
  return new Set(tied.map((item) => item.row.id)).size > 1
    ? `${tied.length} distinct candidates share the latest local attempt instant ${new Date(latestAt).toISOString()}; their causal order is not recorded.`
    : null;
}

function latestCandidateByAttempt(
  candidates: readonly RoutineCandidateRow[],
  events: readonly RoutineCandidateEventRow[],
  nowMs: number,
): RoutineCandidateRow | undefined {
  return [...candidates].sort((left, right) => {
    const leftAt = sourceAttemptTime(left, events, nowMs);
    const rightAt = sourceAttemptTime(right, events, nowMs);
    if (leftAt.kind !== "MEASURED") return 1;
    if (rightAt.kind !== "MEASURED") return -1;
    return compareIsoDesc(leftAt.value, rightAt.value);
  })[0];
}

function attemptMember(
  row: RoutineCandidateRow,
  events: readonly RoutineCandidateEventRow[],
  nowMs: number,
  canonicalOutcome: Observation<"CHANGED" | "UNCHANGED">,
): AttemptHistoryMember {
  const changes = changeEvidence(row);
  const validation = validationEvidence(row, nowMs, events);
  const attemptedAt = sourceAttemptTime(row, events, nowMs);
  const outcome = changes.kind === "UNKNOWN"
    ? unknown<"CHANGED" | "UNCHANGED">(`The change outcome for ${row.id} is unreadable.`)
    : canonicalOutcome;
  return {
    candidateId: row.id,
    attemptedAt,
    state: observedState(row),
    acquisitionSucceeded: acquisitionEvidence(row, nowMs),
    authorityOrigin: authorityOrigin(row),
    validation,
    canonicalOutcome: outcome,
  };
}

function aggregateKnown<T>(
  observations: readonly Observation<readonly T[]>[],
  notRecordedDetail: string,
): DrilldownCount<T> {
  const known = observations.flatMap((item) => item.kind === "MEASURED" ? item.value : []);
  if (observations.some((item) => item.kind === "UNKNOWN")) {
    return { kind: "UNKNOWN", detail: "Some persisted evidence in this window is unreadable, so the complete count is unknown.", members: known };
  }
  if (observations.some((item) => item.kind === "NOT_RECORDED")) {
    return { kind: "NOT_RECORDED", detail: notRecordedDetail, members: known };
  }
  return exactCount(known);
}

function carryGap<T>(observation: Observation<unknown>): Observation<T> {
  switch (observation.kind) {
    case "NOT_RECORDED": return notRecorded(observation.detail);
    case "UNKNOWN": return unknown(observation.detail);
    case "NOT_APPLICABLE": return notApplicable(observation.detail);
    case "MEASURED": throw new Error("A measured observation cannot be carried as a gap.");
  }
}

function terminalRefusalState(state: CandidateState): boolean {
  return !["FETCHED", "NORMALIZED", "VALIDATED", "PROMOTED"].includes(state);
}

function withEventGap<T>(count: DrilldownCount<T>, detail: string | null): DrilldownCount<T> {
  return detail === null ? count : { kind: "UNKNOWN", detail, members: count.members };
}

interface HistoricalPromotionProof {
  readonly outcome: CanonicalOutcomeHistoryMember;
  readonly changes: {
    readonly added: readonly ExactChangedRecord[];
    readonly changed: readonly ExactChangedRecord[];
    readonly removed: readonly ExactChangedRecord[];
  };
}

/** A historical PROMOTED label is an outcome only with its exact source-scoped proof. */
function historicalPromotionProofUncached(
  event: ExactOutcomeEvent,
  candidate: RoutineCandidateRow,
  candidates: readonly RoutineCandidateRow[],
  events: readonly RoutineCandidateEventRow[],
  nowMs: number,
): Observation<HistoricalPromotionProof> {
  if (event.state.kind !== "MEASURED" || event.state.value !== "PROMOTED") {
    return unknown(`Event ${event.id} is not a readable PROMOTED source event.`);
  }
  const state = candidateState(candidate.state);
  const acquisition = acquisitionEvidence(candidate, nowMs);
  if (acquisition.kind !== "MEASURED") return carryGap(acquisition);
  if (
    state !== "PROMOTED" ||
    candidate.promotedVersionId !== candidate.id ||
    candidate.lastKnownGoodVersionId !== candidate.id ||
    !acquisition.value
  ) {
    return unknown(`Promotion event ${event.id} does not match a proof-valid PROMOTED candidate row.`);
  }
  const receipt = validationEvidence(candidate, nowMs, events);
  if (receipt.kind !== "MEASURED") return carryGap(receipt);
  if (receipt.value.decision !== "GOOD") {
    return unknown(`Promotion event ${event.id} does not carry a matching GOOD receipt.`);
  }
  const eventAt = Date.parse(event.at);
  const attemptAt = sourceAttemptTime(candidate, events, nowMs);
  if (attemptAt.kind !== "MEASURED") return carryGap(attemptAt);
  const retrievedAt = Date.parse(candidate.retrievedAt);
  const validatedAt = Date.parse(receipt.value.validatedAt);
  if (
    !Number.isFinite(eventAt) ||
    !Number.isInteger(event.sequence) ||
    event.sequence < 1 ||
    eventAt > nowMs ||
    retrievedAt > validatedAt ||
    validatedAt > eventAt
  ) {
    return unknown(`Promotion event ${event.id} does not preserve acquisition, validation, and promotion order.`);
  }
  const envelope = candidatePayload(candidate);
  if (envelope === null) return unknown(`Promotion event ${event.id} names an unreadable candidate envelope.`);
  let predecessorRecord: CandidateVersionRecord | null = null;
  const transferEvidence = isTrustedLkgImportCandidate(envelope) ? envelope.bootstrapImport : null;
  if (transferEvidence?.kind === "TRUSTED_LKG_REATTESTATION") {
    const predecessorRows = candidates.filter((row) =>
      row.id === transferEvidence.predecessorVersionId
    );
    if (predecessorRows.length !== 1) {
      return unknown(
        `Promotion event ${event.id} names ${predecessorRows.length} exact re-attestation predecessor candidate rows.`,
      );
    }
    predecessorRecord = candidateVersionRecord(predecessorRows[0]!);
    if (predecessorRecord === null) {
      return unknown(`Promotion event ${event.id} names a malformed re-attestation predecessor row.`);
    }
  }
  const proofIssue = promotionProofIssue(
    candidate.recordClass as PromotedProjection["recordClass"],
    candidate.scope,
    {
      key: `${candidate.recordClass}:${candidate.scope}`,
      sourceId: candidate.sourceId,
      recordClass: candidate.recordClass as PromotedProjection["recordClass"],
      scope: candidate.scope,
      versionId: candidate.id,
      lastKnownGoodVersionId: candidate.id,
      promotedAt: event.at,
      payload: envelope.readModel,
      receipt: receipt.value,
    },
    {
      candidate: envelope as unknown as RoutineCandidate,
      state,
      acquisitionSucceeded: candidate.acquisitionSucceeded,
      receipt: receipt.value,
      promotedVersion: candidate.promotedVersionId,
      lastKnownGoodVersion: candidate.lastKnownGoodVersionId,
      failureCode: candidate.failureCode,
      failureDetail: candidate.failureDetail,
    },
    predecessorRecord,
  );
  if (proofIssue !== null) {
    return unknown(`Promotion event ${event.id} failed its source-scoped candidate proof: ${proofIssue}`);
  }
  const changes = exactChanges(candidate, attemptAt.value);
  if (changes.kind !== "MEASURED") return carryGap(changes);
  return measured({
    outcome: {
      candidateId: candidate.id,
      eventId: event.id,
      promotedAt: event.at,
      outcome: changes.value.outcome,
    },
    changes: changes.value,
  });
}

function terminalEventIssue(
  event: ExactOutcomeEvent,
  candidate: RoutineCandidateRow,
  candidates: readonly RoutineCandidateRow[],
  events: readonly RoutineCandidateEventRow[],
  nowMs: number,
): string | null {
  if (event.state.kind !== "MEASURED") return event.state.detail;
  const attemptAt = sourceAttemptTime(candidate, events, nowMs);
  if (attemptAt.kind !== "MEASURED") return attemptAt.detail;
  const acquisition = acquisitionEvidence(candidate, nowMs);
  const receipt = parseValidationReceipt(candidate.validationReceipt);
  const containedTemporalRefusal = receipt !== null &&
    acquisitionTimeAfterValidationRefusalIssue(candidate, receipt, events, nowMs) === null;
  if (acquisition.kind !== "MEASURED" && !containedTemporalRefusal) return acquisition.detail;
  if (candidate.state !== event.state.value) {
    return `Event ${event.id} says ${event.state.value}, but candidate ${candidate.id} says ${candidate.state}.`;
  }
  const eventAt = Date.parse(event.at);
  if (!Number.isFinite(eventAt) || eventAt > nowMs || eventAt < Date.parse(attemptAt.value)) {
    return `Event ${event.id} does not follow its locally observed candidate attempt in present time.`;
  }
  if (!Number.isInteger(event.sequence) || event.sequence < 1) {
    return `Event ${event.id} has an invalid append-only sequence.`;
  }
  if (event.state.value === "PROMOTED") {
    const proof = historicalPromotionProof(event, candidate, candidates, events, nowMs);
    return proof.kind === "MEASURED" ? null : proof.detail;
  }
  const refusal = exactRefused(candidate, nowMs, events, attemptAt.value);
  if (refusal.kind !== "MEASURED" || refusal.value.length === 0) {
    return refusal.kind === "MEASURED"
      ? `Terminal event ${event.id} has no source-scoped refusal reason.`
      : refusal.detail;
  }
  const validation = validationEvidence(candidate, nowMs, events);
  if (validation.kind === "MEASURED" && Date.parse(validation.value.validatedAt) > eventAt) {
    return `Terminal event ${event.id} is recorded before its validation receipt.`;
  }
  if (candidate.promotedVersionId !== null) {
    return `Refused candidate ${candidate.id} also claims a promoted version.`;
  }
  return null;
}

/** Candidate row and append-only event history are one durable disposition. */
function currentCandidateEventIssue(
  candidate: RoutineCandidateRow,
  candidates: readonly RoutineCandidateRow[],
  events: readonly RoutineCandidateEventRow[],
  nowMs: number,
): string | null {
  const sourceEvents = events.filter((event) =>
    event.candidateId === candidate.id && !isNonDispositionEvidence(event.detail));
  const attemptAt = sourceAttemptTime(candidate, events, nowMs);
  if (attemptAt.kind !== "MEASURED") return attemptAt.detail;
  const ordered = [...sourceEvents].sort((left, right) => left.sequence - right.sequence);
  let priorAt = Number.NEGATIVE_INFINITY;
  for (const event of ordered) {
    if (candidateState(event.state) === null) {
      return `Candidate ${candidate.id} has an unrecognised source-state event.`;
    }
    const at = Date.parse(event.at);
    if (!Number.isFinite(at) || at > nowMs || at < Date.parse(attemptAt.value)) {
      return `Candidate ${candidate.id} has a source-state event outside its present-time local attempt order.`;
    }
    if (at < priorAt) return `Candidate ${candidate.id} has source-state event time moving backward relative to sequence.`;
    priorAt = at;
  }
  const latest = exactEvent(ordered[ordered.length - 1]);
  if (latest.state.kind !== "MEASURED" || latest.state.value !== candidate.state) {
    return `Candidate ${candidate.id} row state ${candidate.state} does not match its latest append-only source event.`;
  }
  const state = candidateState(candidate.state);
  const terminalEvents = ordered.filter((event) => {
    const eventState = candidateState(event.state);
    return eventState !== null && (eventState === "PROMOTED" || terminalRefusalState(eventState));
  });
  if (state !== null && (state === "PROMOTED" || terminalRefusalState(state))) {
    if (terminalEvents.length !== 1) {
      return `Candidate ${candidate.id} has ${terminalEvents.length} terminal source-state events; exactly one is required.`;
    }
    return terminalEventIssue(latest, candidate, candidates, events, nowMs);
  }
  if (terminalEvents.length > 0) {
    return `Candidate ${candidate.id} has a terminal source-state event before its current nonterminal state.`;
  }
  return null;
}

function historyWindow(
  id: HistoryWindowId,
  durationMs: number,
  nowMs: number,
  candidates: readonly RoutineCandidateRow[],
  events: readonly RoutineCandidateEventRow[],
): RoutineHistoryWindow {
  const sinceMs = nowMs - durationMs;
  const candidateAttemptTimes = candidates.map((row) => ({
    row,
    attemptedAt: sourceAttemptTime(row, events, nowMs),
  }));
  const attemptInsideWindow = (attemptedAt: Observation<string>): boolean =>
    attemptedAt.kind === "MEASURED" && Date.parse(attemptedAt.value) >= sinceMs;
  const rawAcquisitionInsideWindow = (row: RoutineCandidateRow): boolean => {
    const at = Date.parse(row.retrievedAt);
    return Number.isFinite(at) && at >= sinceMs && at <= nowMs;
  };
  const inWindow = candidateAttemptTimes.flatMap(({ row, attemptedAt }) =>
    attemptInsideWindow(attemptedAt) ||
    (attemptedAt.kind !== "MEASURED" && rawAcquisitionInsideWindow(row))
      ? [row]
      : []);
  // If the local clock and source-supplied clock disagree about window
  // membership, the row still participates in the consistency audit. It may
  // not silently fall between those two authorities.
  const candidateEvidenceInWindow = candidateAttemptTimes.flatMap(({ row, attemptedAt }) =>
    attemptInsideWindow(attemptedAt) || rawAcquisitionInsideWindow(row) ||
    (attemptedAt.kind !== "MEASURED" && !Number.isFinite(Date.parse(row.retrievedAt)))
      ? [row]
      : []);
  const exactEvents = events.filter((row) => {
    const at = Date.parse(row.at);
    return Number.isFinite(at) && at >= sinceMs && at <= nowMs;
  }).map(exactEvent);
  const invalidCandidateTimes = candidateAttemptTimes.filter(({ row, attemptedAt }) =>
    candidateEvidenceInWindow.includes(row) && attemptedAt.kind !== "MEASURED");
  const invalidEventTimes = events.filter((row) => {
    if (isNonDispositionEvidence(row.detail)) return false;
    const at = Date.parse(row.at);
    return !Number.isFinite(at) || at > nowMs;
  });
  const unreadableEventStates = exactEvents.filter((event) =>
    !isNonDispositionEvidence(event.detail) && event.state.kind !== "MEASURED");
  const promotions = exactEvents.filter((event) =>
    event.state.kind === "MEASURED" &&
    event.state.value === "PROMOTED" &&
    !isNonDispositionEvidence(event.detail));
  const refusals = exactEvents.filter((event) =>
    !isNonDispositionEvidence(event.detail) &&
    event.state.kind === "MEASURED" &&
    terminalRefusalState(event.state.value));
  const terminalEvents = [...promotions, ...refusals];
  const terminalEventCounts = new Map<string, number>();
  for (const event of terminalEvents) terminalEventCounts.set(event.candidateId, (terminalEventCounts.get(event.candidateId) ?? 0) + 1);
  const duplicateTerminalEvents = [...terminalEventCounts].filter(([, count]) => count > 1);
  const allTerminalCandidateIds = new Set(exactEvents.flatMap((event) =>
    !isNonDispositionEvidence(event.detail) &&
    event.state.kind === "MEASURED" && (
      event.state.value === "PROMOTED" || terminalRefusalState(event.state.value)
    )
      ? [event.candidateId]
      : []));
  const missingTerminalEvents = candidateEvidenceInWindow.filter((row) => {
    const state = candidateState(row.state);
    return (state === "PROMOTED" || (state !== null && terminalRefusalState(state))) && !allTerminalCandidateIds.has(row.id);
  });
  const terminalEvidenceIssues = terminalEvents.flatMap((event) => {
    const matches = candidates.filter((row) => row.id === event.candidateId);
    if (matches.length !== 1) return [`Event ${event.id} names ${matches.length} candidate rows.`];
    const issue = terminalEventIssue(event, matches[0], candidates, events, nowMs);
    return issue === null ? [] : [issue];
  });
  const candidateDispositionIssues = candidateEvidenceInWindow.flatMap((candidate) => {
    const issue = currentCandidateEventIssue(candidate, candidates, events, nowMs);
    return issue === null ? [] : [issue];
  });
  const eventGap = invalidCandidateTimes.length > 0
    ? `${invalidCandidateTimes.length} candidate attempt clock(s) cannot be placed from exact local sequence-1 evidence.`
    : invalidEventTimes.length > 0
    ? `${invalidEventTimes.length} event time(s) are unreadable or future and cannot be placed in this window.`
    : unreadableEventStates.length > 0
      ? `${unreadableEventStates.length} event state(s) cannot be classified in this window.`
      : duplicateTerminalEvents.length > 0
        ? `${duplicateTerminalEvents.length} candidate(s) have more than one terminal event in this window.`
      : missingTerminalEvents.length > 0
        ? `${missingTerminalEvents.length} terminal candidate(s) have no matching append-only terminal event.`
        : terminalEvidenceIssues.length > 0
          ? `${terminalEvidenceIssues.length} terminal event(s) lack consistent source-scoped proof: ${terminalEvidenceIssues[0]}`
        : candidateDispositionIssues.length > 0
          ? `${candidateDispositionIssues.length} candidate disposition(s) lack consistent append-only proof: ${candidateDispositionIssues[0]}`
        : null;
  const candidateForEvent = (event: ExactOutcomeEvent): Observation<RoutineCandidateRow> => {
    const matches = candidates.filter((row) => row.id === event.candidateId);
    if (matches.length === 0) return notRecorded(`Event ${event.id} names candidate ${event.candidateId}, whose durable row is not recorded.`);
    if (matches.length > 1) return unknown(`Event ${event.id} names ${matches.length} candidate rows; identity is not unique.`);
    return measured(matches[0]);
  };
  const canonicalProofs: Observation<HistoricalPromotionProof>[] = promotions.map((event) => {
    const candidate = candidateForEvent(event);
    if (candidate.kind !== "MEASURED") return carryGap(candidate);
    return historicalPromotionProof(event, candidate.value, candidates, events, nowMs);
  });
  const canonicalOutcomes: Observation<CanonicalOutcomeHistoryMember>[] = canonicalProofs.map((proof) =>
    proof.kind === "MEASURED" ? measured(proof.value.outcome) : carryGap(proof));
  const canonicalOutcomeForAttempt = (row: RoutineCandidateRow): Observation<"CHANGED" | "UNCHANGED"> => {
    if (row.state !== "PROMOTED") {
      return notRecorded(`Candidate ${row.id} did not establish a canonical CHANGED or UNCHANGED outcome.`);
    }
    const matches = promotions.flatMap((event, index) => event.candidateId === row.id ? [canonicalProofs[index]] : []);
    if (matches.length === 0) return notRecorded(`Candidate ${row.id} has no matching atomic PROMOTED event.`);
    if (matches.length !== 1) return unknown(`Candidate ${row.id} has ${matches.length} matching PROMOTED events.`);
    const proof = matches[0];
    return proof.kind === "MEASURED" ? measured(proof.value.outcome.outcome) : carryGap(proof);
  };
  // A confirmed re-check is a successful source acquisition that wrote no
  // candidate: one attempt per confirmation receipt in the window, on the
  // version it confirmed, with an UNCHANGED outcome (never a promotion).
  const confirmationAttempts = events.flatMap((event): AttemptHistoryMember[] => {
    if (event.state !== "PROMOTED" || !event.detail.startsWith(UNCHANGED_CONFIRMATION_PREFIX)) return [];
    const at = Date.parse(event.at);
    if (!Number.isFinite(at) || at < sinceMs || at > nowMs) return [];
    const confirmation = parseUnchangedConfirmation(event.detail);
    const row = candidates.find((candidate) => candidate.id === event.candidateId);
    if (confirmation === null || !row || confirmation.versionId !== row.id) return [];
    const receipt = parseValidationReceipt(row.validationReceipt);
    return [{
      candidateId: row.id,
      attemptedAt: measured(iso(event.at)!), // the recorded event instant (checked finite above)
      state: measured("PROMOTED" as const),
      acquisitionSucceeded: measured(true),
      authorityOrigin: "LIVE_SOURCE_ACQUISITION",
      validation: receipt ? measured(receipt) : unknown(`Confirmed version ${row.id} has no readable validation receipt.`),
      canonicalOutcome: measured("UNCHANGED" as const),
    }];
  });
  const attempts = [
    ...inWindow.map((row) => attemptMember(row, events, nowMs, canonicalOutcomeForAttempt(row))),
    ...confirmationAttempts,
  ];
  const attemptCount: DrilldownCount<AttemptHistoryMember> = invalidCandidateTimes.length > 0 || invalidEventTimes.length > 0
    ? {
        kind: "UNKNOWN",
        detail: `${invalidCandidateTimes.length + invalidEventTimes.length} candidate/event clock(s) are unreadable or future and cannot be placed in this window.`,
        members: attempts,
      }
    : exactCount(attempts);
  const outcomesOf = (outcome: "CHANGED" | "UNCHANGED"): DrilldownCount<CanonicalOutcomeHistoryMember> =>
    aggregateKnown(
      canonicalOutcomes.map((item) => item.kind === "MEASURED"
        ? measured(item.value.outcome === outcome ? [item.value] : [])
        : item),
      `At least one promotion event has no persisted ${outcome} change-set outcome.`,
    );
  const promotedChanges = canonicalProofs.map((proof): Observation<{
    readonly added: readonly ExactChangedRecord[];
    readonly changed: readonly ExactChangedRecord[];
    readonly removed: readonly ExactChangedRecord[];
  }> => {
    return proof.kind === "MEASURED" ? measured(proof.value.changes) : carryGap(proof);
  });
  const promotedByKind = (kind: "added" | "changed" | "removed"): Observation<readonly ExactChangedRecord[]>[] =>
    promotedChanges.map((item) => item.kind === "MEASURED" ? measured(item.value[kind]) : item);
  const heldObservations = terminalEvents.map((event): Observation<readonly ExactHeldRecord[]> => {
    const candidate = candidateForEvent(event);
    if (candidate.kind !== "MEASURED") return carryGap(candidate);
    const attemptedAt = sourceAttemptTime(candidate.value, events, nowMs);
    return attemptedAt.kind === "MEASURED"
      ? exactHeld(candidate.value, nowMs, events, attemptedAt.value)
      : carryGap(attemptedAt);
  });
  const refusalObservations = refusals.map((event): Observation<readonly ExactRefusedRecord[]> => {
    const candidate = candidateForEvent(event);
    if (candidate.kind !== "MEASURED") return carryGap(candidate);
    const attemptedAt = sourceAttemptTime(candidate.value, events, nowMs);
    return attemptedAt.kind === "MEASURED"
      ? exactRefused(candidate.value, nowMs, events, attemptedAt.value)
      : carryGap(attemptedAt);
  });
  const sourceAcquisitionObservations = attempts
    .filter((attempt) => attempt.authorityOrigin === "LIVE_SOURCE_ACQUISITION")
    .map((attempt): Observation<readonly AttemptHistoryMember[]> =>
      attempt.acquisitionSucceeded.kind === "MEASURED"
        ? measured(attempt.acquisitionSucceeded.value ? [attempt] : [])
        : carryGap(attempt.acquisitionSucceeded));
  const sourceAcquisitionCount = aggregateKnown(
    sourceAcquisitionObservations,
    "At least one source attempt has no durable acquisition outcome.",
  );
  const promotionCount = withEventGap(exactCount(promotions), eventGap);
  const changedCount = withEventGap(outcomesOf("CHANGED"), eventGap);
  const unchangedCount = withEventGap(outcomesOf("UNCHANGED"), eventGap);
  const addedCount = withEventGap(aggregateKnown(promotedByKind("added"), "At least one promoted candidate has no persisted change set, so canonical added records are not fully measured."), eventGap);
  const changedRecordsCount = withEventGap(aggregateKnown(promotedByKind("changed"), "At least one promoted candidate has no persisted change set, so canonical changed records are not fully measured."), eventGap);
  const removedCount = withEventGap(aggregateKnown(promotedByKind("removed"), "At least one promoted candidate has no persisted change set, so canonical removed records are not fully measured."), eventGap);
  const heldCount = withEventGap(aggregateKnown(heldObservations, "At least one terminal outcome records neither a change set nor a receipt, so held records are not fully measured."), eventGap);
  const refusedCount = withEventGap(aggregateKnown(refusalObservations, "At least one refusal event has no durable refusal receipt or reason."), eventGap);
  return {
    id,
    since: new Date(sinceMs).toISOString(),
    through: new Date(nowMs).toISOString(),
    attempts,
    events: exactEvents,
    counts: {
      attempts: attemptCount,
      successfulAcquisitions: invalidCandidateTimes.length > 0 || invalidEventTimes.length > 0
        ? {
            kind: "UNKNOWN",
            detail: `${invalidCandidateTimes.length + invalidEventTimes.length} candidate/event clock(s) cannot be placed in this window.`,
            members: sourceAcquisitionCount.members,
          }
        : sourceAcquisitionCount,
      promotions: promotionCount,
      changedOutcomes: changedCount,
      unchangedOutcomes: unchangedCount,
      added: addedCount,
      changed: changedRecordsCount,
      removed: removedCount,
      held: heldCount,
      refused: refusedCount,
    },
  };
}

function projectContract(
  contract: ObservableCivicDataContract,
  rows: RoutineObservabilityRows,
  nowMs: number,
  currentReaderBuild: CurrentReaderBuildIdentity,
  sittingHot?: boolean,
): RoutineContractObservation {
  const contractCandidates = rows.candidates
    .filter((row) => row.sourceId === contract.sourceId && row.recordClass === contract.recordClass && row.scope === contract.scope);
  const candidateIds = new Set(contractCandidates.map((row) => row.id));
  const events = rows.events
    .filter((row) => candidateIds.has(row.candidateId))
    .sort((a, b) => compareIsoDesc(a.at, b.at) || b.sequence - a.sequence);
  const candidates = [...contractCandidates].sort((left, right) => {
    const leftAt = sourceAttemptTime(left, events, nowMs);
    const rightAt = sourceAttemptTime(right, events, nowMs);
    if (leftAt.kind !== "MEASURED") return 1;
    if (rightAt.kind !== "MEASURED") return -1;
    return compareIsoDesc(leftAt.value, rightAt.value);
  });
  const latest = latestCandidateByAttempt(candidates, events, nowMs);
  const latestOrderIssue = latestCandidateOrderIssue(candidates, events, nowMs);
  const sourceAcquisitions = candidates
    .filter((row) => authorityOrigin(row) === "LIVE_SOURCE_ACQUISITION")
    .map((row) => {
      const receipt = parseValidationReceipt(row.validationReceipt);
      return {
        row,
        evidence: acquisitionEvidence(row, nowMs),
        attemptedAt: sourceAttemptTime(row, events, nowMs),
        containedTemporalRefusal: receipt !== null &&
          acquisitionTimeAfterValidationRefusalIssue(row, receipt, events, nowMs) === null,
      };
    });
  const canonical = pointerProof(contract, rows.promotions, rows.candidates, rows.events, nowMs);
  const canonicalCandidate = canonical.kind === "MEASURED"
    ? candidates.find((row) => row.id === canonical.value.versionId)
    : undefined;
  // The canonical version's newest unchanged confirmation: a later successful
  // re-check that wrote no candidate (RULING 283's receipted no-change).
  const confirmation = canonical.kind === "MEASURED"
    ? latestUnchangedConfirmation(
        events.filter((event) => event.candidateId === canonical.value.versionId && event.state === "PROMOTED"),
        canonical.value.versionId,
      )
    : null;
  const schedule = "schedule" in contract ? contract.schedule : undefined;
  const activeEveryMs = isManualContract(contract) ? 0 : schedule?.kind === "SITTING_WINDOW"
    ? sittingWindowRereadMs(schedule, sittingHot) : cadenceMsAt(contract, nowMs);
  const fresh = freshness(contract, canonicalCandidate, nowMs, confirmation, activeEveryMs);
  const readerVisible = readerProjectionProof(contract, canonical, events, currentReaderBuild, nowMs);
  const operation = latestOrderIssue === null
    ? operationalState(contract, latest, candidates, canonicalCandidate, canonical, readerVisible, fresh.state, events, nowMs)
    : { state: "UNKNOWN" as const, detail: latestOrderIssue };
  const latestAttempt = latest ? sourceAttemptTime(latest, events, nowMs) : null;
  const confirmedLatest = confirmation !== null && latestOrderIssue === null && (
    latestAttempt?.kind !== "MEASURED" || Date.parse(confirmation.observedAt) >= Date.parse(latestAttempt.value)
  );
  const changes: RoutineContractObservation["latestChanges"] = latestOrderIssue !== null
    ? unknown(latestOrderIssue)
    : confirmedLatest
      ? measured({ outcome: "UNCHANGED" as const, added: [], changed: [], removed: [] })
    : latest
      ? exactChanges(latest, latestAttempt?.kind === "MEASURED" ? latestAttempt.value : latest.retrievedAt)
      : notRecorded("No attempt is recorded, so no change set is recorded.");
  const held: RoutineContractObservation["latestHeld"] = latestOrderIssue !== null
    ? unknown(latestOrderIssue)
    : latest
      ? exactHeld(latest, nowMs, events, latestAttempt?.kind === "MEASURED" ? latestAttempt.value : latest.retrievedAt)
      : notRecorded("No attempt is recorded, so no held-record outcome is recorded.");
  const refused: RoutineContractObservation["latestRefused"] = latestOrderIssue !== null
    ? unknown(latestOrderIssue)
    : latest
      ? exactRefused(latest, nowMs, events, latestAttempt?.kind === "MEASURED" ? latestAttempt.value : latest.retrievedAt)
      : notRecorded("No attempt is recorded, so no refusal outcome is recorded.");
  let latestCanonicalOutcome: Observation<"CHANGED" | "UNCHANGED">;
  if (confirmedLatest) {
    latestCanonicalOutcome = measured("UNCHANGED");
  } else if (latestOrderIssue !== null) {
    latestCanonicalOutcome = unknown(`The latest production outcome cannot be identified because ${latestOrderIssue}`);
  } else if (!latest || changes.kind === "NOT_RECORDED") {
    latestCanonicalOutcome = notRecorded("The latest attempt did not establish a persisted CHANGED or UNCHANGED production outcome.");
  } else if (changes.kind === "UNKNOWN") {
    latestCanonicalOutcome = unknown("The latest candidate change set is unreadable.");
  } else if (changes.kind === "NOT_APPLICABLE") {
    latestCanonicalOutcome = unknown("The latest candidate change set was marked not applicable, so a canonical outcome cannot be proven.");
  } else if (canonical.kind === "UNKNOWN") {
    latestCanonicalOutcome = unknown(`The latest production outcome cannot be proven because ${canonical.detail}`);
  } else if (canonical.kind !== "MEASURED" || canonical.value.versionId !== latest.id) {
    latestCanonicalOutcome = notRecorded("The latest attempt did not establish a promoted CHANGED or validated UNCHANGED production outcome.");
  } else {
    latestCanonicalOutcome = measured(changes.value.outcome);
  }
  const sourceThrough: Observation<string> = canonical.kind === "MEASURED"
    ? (() => {
      const promoted = candidates.find((row) => row.id === canonical.value.versionId);
      if (!promoted) return unknown("The promoted candidate needed for source-through proof is absent.");
      return promoted.sourceThrough.trim() === ""
        ? unknown("The promoted candidate has no source-through value.")
        : measured(promoted.sourceThrough);
    })()
    : canonical.kind === "UNKNOWN"
      ? unknown(canonical.detail)
      : notRecorded("No canonical promotion exists, so no canonical source-through value is recorded.");
  let lkg: Observation<LkgObservation>;
  const promotion = rows.promotions.find((row) => row.recordClass === contract.recordClass && row.scope === contract.scope);
  if (latestOrderIssue !== null && canonical.kind === "MEASURED") {
    lkg = unknown(`The canonical LKG pointer is valid, but whether it is serving after the latest attempt cannot be proven because ${latestOrderIssue}`);
  } else if (canonical.kind === "MEASURED" && promotion) {
    const lkgCandidate = rows.candidates.find((row) => row.id === promotion.lastKnownGoodVersionId);
    const lkgReceipt = lkgCandidate ? parseValidationReceipt(lkgCandidate.validationReceipt) : null;
    if (
      !lkgCandidate ||
      lkgCandidate.sourceId !== contract.sourceId ||
      lkgCandidate.recordClass !== contract.recordClass ||
      lkgCandidate.scope !== contract.scope ||
      lkgReceipt?.decision !== "GOOD"
    ) {
      lkg = unknown(`Pointer ${promotion.key} names LKG ${promotion.lastKnownGoodVersionId}, but its matching GOOD candidate proof is absent.`);
    } else {
      const latestAttemptAt = latest ? sourceAttemptTime(latest, events, nowMs) : null;
      const lkgAttemptAt = sourceAttemptTime(lkgCandidate, events, nowMs);
      const latestAt = latestAttemptAt?.kind === "MEASURED" ? Date.parse(latestAttemptAt.value) : Number.NaN;
      const lkgAt = lkgAttemptAt.kind === "MEASURED" ? Date.parse(lkgAttemptAt.value) : Number.NaN;
      const trustedImport = authorityOrigin(lkgCandidate) === "TRUSTED_LKG_IMPORT";
      const servingAfterLaterAttempt = Boolean(
        latest &&
        latest.id !== promotion.lastKnownGoodVersionId &&
        Number.isFinite(latestAt) &&
        Number.isFinite(lkgAt) &&
        latestAt > lkgAt
      );
      const currentlyServing = trustedImport || servingAfterLaterAttempt;
      lkg = measured({
        versionId: promotion.lastKnownGoodVersionId,
        currentlyServing,
        state: trustedImport
          ? "TRUSTED_LKG_IMPORT"
          : servingAfterLaterAttempt
            ? "SERVING_AFTER_LATER_ATTEMPT"
            : "CURRENT_PROMOTION",
        detail: trustedImport
          ? `The canonical version is a visibly non-source-authenticated frozen LKG import${servingAfterLaterAttempt ? `; later attempt ${latest?.id ?? "unknown"} did not replace it` : ""}.`
          : servingAfterLaterAttempt
            ? `A later attempt (${latest?.id ?? "unknown"}) did not replace the last GOOD version.`
            : "The last GOOD version is also the latest promoted attempt.",
      });
    }
  } else if (canonical.kind === "UNKNOWN") {
    lkg = unknown(`LKG service cannot be proven because ${canonical.detail}`);
  } else {
    lkg = notRecorded("No canonical pointer is recorded, so no LKG version can be proven serving.");
  }
  const validationRows = candidates
    .filter((row) => row.validationReceipt !== null)
    .map((row) => ({
      row,
      evidence: validationEvidence(row, nowMs, events),
    }))
  const invalidValidation = validationRows.map((item) => item.evidence).find(
    (evidence): evidence is Exclude<Observation<ValidationReceipt>, { readonly kind: "MEASURED" }> => evidence.kind !== "MEASURED",
  );
  const measuredValidation = validationRows.flatMap((item) => item.evidence.kind === "MEASURED" ? [item.evidence.value] : [])
    .sort((left, right) => compareIsoDesc(left.validatedAt, right.validatedAt));
  const lastValidation: Observation<string> = validationRows.length === 0
    ? notRecorded("No validation receipt is recorded for this contract.")
    : invalidValidation
      ? unknown(`The latest validation cannot be proven because ${invalidValidation.detail}`)
      : measured(new Date(Date.parse(measuredValidation[0].validatedAt)).toISOString());
  const histories = Object.fromEntries(HISTORY_WINDOWS.map((window) => [
    window.id,
    historyWindow(window.id, window.durationMs, nowMs, candidates, events),
  ])) as unknown as Readonly<Record<HistoryWindowId, RoutineHistoryWindow>>;
  const lastAttemptedAcquisition = withConfirmation(latestSourceAttempt(sourceAcquisitions), confirmation);
  const lastSuccessfulAcquisition = withConfirmation(latestSuccessfulSourceAcquisition(sourceAcquisitions), confirmation);
  return {
    contractId: contract.id,
    sourceId: contract.sourceId,
    recordClass: contract.recordClass,
    scope: contract.scope,
    classification: contract.classification,
    currentState: latestOrderIssue === null ? observedState(latest) : unknown(latestOrderIssue),
    lastAttemptedAcquisition,
    lastSuccessfulAcquisition,
    lastValidation,
    lastPromotion: canonical.kind === "MEASURED"
      ? measured(canonical.value.promotedAt)
      : canonical.kind === "UNKNOWN"
        ? unknown(canonical.detail)
        : notRecorded("No canonical promotion is recorded for this contract."),
    canonicalPromotion: canonical,
    readerVisible,
    sourceThrough,
    cadence: {
      clock: isManualContract(contract) ? "MANUAL" : "STANDING",
      description: isManualContract(contract) ? "explicit owner invocation only" : schedule?.kind === "SITTING_WINDOW"
        ? `every ${activeEveryMs / HOUR} hours under the rolling meeting window` : contract.cadence.description,
      activeEveryMs,
      retryDescription: isManualContract(contract)
        ? "explicit owner rerun after inspecting the durable refusal"
        : observedRetryDescription(contract, canonical.kind !== "NOT_RECORDED"),
      nextDue: nextDue(contract, latest, canonicalCandidate, events, nowMs, latestOrderIssue, sittingHot, confirmation, canonical.kind !== "NOT_RECORDED"),
      operationalState: operation.state,
      operationalDetail: operation.detail,
      freshness: fresh.state,
      freshnessDetail: fresh.detail,
    },
    latestChanges: changes,
    latestHeld: held,
    latestRefused: refused,
    latestCanonicalOutcome,
    lkg,
    histories,
  };
}

function contractMember(row: RoutineContractObservation): RoutineContractMember {
  return {
    contractId: row.contractId,
    sourceId: row.sourceId,
    recordClass: row.recordClass,
    scope: row.scope,
    operationalState: row.cadence.operationalState,
    freshness: row.cadence.freshness,
  };
}

// Mirrors MEETINGS_RECORD_CLASS / MEETINGS_PREPARED_SCOPE in
// lib/meetings/prepared-snapshot.ts (the reader path is authoritative). Inlined
// here so the admin projector never imports the composing reader; a reader test
// pins the two together.
const PREPARED_MEETING_RECORD_CLASS = "MEETING";
const PREPARED_MEETING_SCOPE = "composed-reader-snapshot";

function preparedCoupling(value: unknown): Map<string, string> | null {
  if (!Array.isArray(value)) return null;
  const out = new Map<string, string>();
  for (const entry of value) {
    const row = object(entry);
    if (!row || typeof row.contractId !== "string" || typeof row.versionId !== "string") return null;
    out.set(row.contractId, row.versionId);
  }
  return out;
}

/**
 * Observe the prepared meetings reader-serving snapshot against the promoted
 * partitions read in the same MVCC snapshot. Publication lag is exactly the set
 * of meeting partitions whose current authoritative promotion is not what the
 * serving copy was last composed from — so an owner sees, without guessing,
 * that promoted data has not yet reached the reader and by how much. A missing
 * serving copy is an explicit first-seed condition, never a zero lag.
 */
function projectPreparedMeetingSnapshot(
  rows: RoutineObservabilityRows,
  nowMs: number,
): PreparedSnapshotObservation {
  const base = { recordClass: PREPARED_MEETING_RECORD_CLASS, scope: PREPARED_MEETING_SCOPE } as const;
  const promotedByScope = new Map<string, string>();
  for (const promotion of rows.promotions) {
    if (
      promotion.recordClass === PREPARED_MEETING_RECORD_CLASS &&
      MEETING_PARTITION_CONTRACTS.some((contract) => contract.scope === promotion.scope)
    ) {
      promotedByScope.set(promotion.scope, promotion.currentVersionId);
    }
  }
  const promotedPartitions = measured(promotedByScope.size);

  if (rows.preparedProjections === undefined) {
    const detail = "The prepared reader-serving snapshot was not read in this MVCC snapshot.";
    return {
      ...base, present: false,
      sequence: notRecorded(detail), generatedAt: notRecorded(detail), composedAt: notRecorded(detail),
      promotedThrough: notRecorded(detail), composedPartitions: notRecorded(detail), promotedPartitions,
      lag: { kind: "NOT_RECORDED", detail, members: [] }, detail,
    };
  }
  const matches = rows.preparedProjections.filter(
    (row) => row.recordClass === PREPARED_MEETING_RECORD_CLASS && row.scope === PREPARED_MEETING_SCOPE,
  );
  if (matches.length === 0) {
    const detail = "No prepared reader snapshot exists yet (initial rollout). Until the standing runner publishes one, the reader composes the partitions on demand.";
    return {
      ...base, present: false,
      sequence: notRecorded(detail), generatedAt: notRecorded(detail), composedAt: notRecorded(detail),
      promotedThrough: notRecorded(detail), composedPartitions: notRecorded(detail), promotedPartitions,
      lag: { kind: "NOT_RECORDED", detail, members: [] }, detail,
    };
  }
  if (matches.length > 1) {
    const detail = `The prepared reader snapshot query returned ${matches.length} rows for one scope; uniqueness is not proven.`;
    return {
      ...base, present: true,
      sequence: unknown(detail), generatedAt: unknown(detail), composedAt: unknown(detail),
      promotedThrough: unknown(detail), composedPartitions: unknown(detail), promotedPartitions,
      lag: { kind: "UNKNOWN", detail, members: [] }, detail,
    };
  }
  const row = matches[0]!;
  const coupling = preparedCoupling(row.composedFrom);
  const generatedAt = iso(row.generatedAt);
  const composedAt = iso(row.composedAt);
  const promotedThrough = iso(row.promotedThrough);
  const sequenceOk = Number.isInteger(row.sequence) && row.sequence > 0;
  if (coupling === null || generatedAt === null || composedAt === null || !sequenceOk) {
    const detail = `The prepared reader snapshot row is unreadable (${coupling === null ? "coupling" : !sequenceOk ? "sequence" : "timestamp"}).`;
    return {
      ...base, present: true,
      sequence: sequenceOk ? measured(row.sequence) : unknown(detail),
      generatedAt: generatedAt ? measured(generatedAt) : unknown(detail),
      composedAt: composedAt ? measured(composedAt) : unknown(detail),
      promotedThrough: promotedThrough ? measured(promotedThrough) : notRecorded("The serving copy records no promoted-through instant."),
      composedPartitions: coupling ? measured(coupling.size) : unknown(detail),
      promotedPartitions,
      lag: { kind: "UNKNOWN", detail, members: [] }, detail,
    };
  }
  const lagMembers: PreparedSnapshotLagMember[] = [];
  for (const contract of MEETING_PARTITION_CONTRACTS) {
    const promotedVersionId = promotedByScope.get(contract.scope);
    if (promotedVersionId === undefined) continue; // not promoted → nothing to lag behind
    const servedVersionId = coupling.get(contract.id) ?? null;
    if (servedVersionId !== promotedVersionId) {
      lagMembers.push({ contractId: contract.id, scope: contract.scope, promotedVersionId, servedVersionId });
    }
  }
  const ageMs = nowMs - Date.parse(generatedAt);
  const ageText = Number.isFinite(ageMs) ? `${Math.max(0, Math.round(ageMs / 60_000))} min old` : "age unknown";
  const detail = lagMembers.length === 0
    ? `Current: all ${promotedByScope.size} promoted meeting partitions are reflected in serving sequence ${row.sequence} (${ageText}).`
    : `${lagMembers.length} promoted meeting partition(s) have advanced past serving sequence ${row.sequence} (${ageText}); the reader serves the last valid snapshot until the runner republishes.`;
  return {
    ...base, present: true,
    sequence: measured(row.sequence),
    generatedAt: measured(generatedAt),
    composedAt: measured(composedAt),
    promotedThrough: promotedThrough ? measured(promotedThrough) : notRecorded("The serving copy records no promoted-through instant."),
    composedPartitions: measured(coupling.size),
    promotedPartitions,
    lag: exactCount(lagMembers),
    detail,
  };
}

/** Build the whole owner view from one complete read of canonical evidence. */
function projectRoutineDataObservabilityUncached(
  rows: RoutineObservabilityRows,
  now: string,
  contracts: readonly ObservableCivicDataContract[] = [...observableRoutineContracts(), ...MANUAL_PRODUCTION_SOURCE_CONTRACTS],
  currentReaderBuild: CurrentReaderBuildIdentity = UNKNOWN_READER_BUILD,
): RoutineObservabilityView {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error(`Routine observability requires a valid now instant, received ${now}.`);
  const sittingSignals = sittingWindowSignalsFromPromotions(contracts, rows.promotions, nowMs);
  const projected = contracts.map((contract) => projectContract(contract, rows, nowMs, currentReaderBuild, sittingSignals.get(contract.id)));
  const members = projected.map(contractMember);
  const lkgServing = projected.flatMap((row, index) => row.lkg.kind === "MEASURED" && row.lkg.value.currentlyServing ? [members[index]] : []);
  const changed = projected.flatMap((row, index) => row.latestCanonicalOutcome.kind === "MEASURED" && row.latestCanonicalOutcome.value === "CHANGED" ? [members[index]] : []);
  const unchanged = projected.flatMap((row, index) => row.latestCanonicalOutcome.kind === "MEASURED" && row.latestCanonicalOutcome.value === "UNCHANGED" ? [members[index]] : []);
  return {
    asOf: new Date(nowMs).toISOString(),
    source: "civic_data_candidates+civic_data_candidate_events+civic_data_promotions",
    contracts: projected,
    summary: {
      contracts: exactCount(members),
      healthy: exactCount(members.filter((member) => member.operationalState === "HEALTHY")),
      held: exactCount(members.filter((member) => member.operationalState === "HELD")),
      retrying: exactCount(members.filter((member) => member.operationalState === "RETRYING")),
      inProgress: exactCount(members.filter((member) => member.operationalState === "IN_PROGRESS")),
      operationalDue: exactCount(members.filter((member) => member.operationalState === "DUE")),
      operationalStale: exactCount(members.filter((member) => member.operationalState === "STALE")),
      operationalUnknown: exactCount(members.filter((member) => member.operationalState === "UNKNOWN")),
      fresh: exactCount(members.filter((member) => member.freshness === "FRESH")),
      due: exactCount(members.filter((member) => member.freshness === "DUE")),
      stale: exactCount(members.filter((member) => member.freshness === "STALE")),
      unknown: exactCount(members.filter((member) => member.freshness === "UNKNOWN")),
      manual: exactCount(members.filter((member) => member.freshness === "MANUAL")),
      lkgServing: exactCount(lkgServing),
      readerVisible: exactCount(projected.flatMap((row, index) => row.readerVisible.kind === "MEASURED" ? [members[index]] : [])),
      readerNotRecorded: exactCount(projected.flatMap((row, index) => row.readerVisible.kind === "NOT_RECORDED" ? [members[index]] : [])),
      readerUnknown: exactCount(projected.flatMap((row, index) => row.readerVisible.kind === "UNKNOWN" ? [members[index]] : [])),
      readerNotApplicable: exactCount(projected.flatMap((row, index) => row.readerVisible.kind === "NOT_APPLICABLE" ? [members[index]] : [])),
      latestChanged: exactCount(changed),
      latestUnchanged: exactCount(unchanged),
      latestOutcomeNotRecorded: exactCount(projected.flatMap((row, index) => row.latestCanonicalOutcome.kind === "NOT_RECORDED" ? [members[index]] : [])),
      latestOutcomeUnknown: exactCount(projected.flatMap((row, index) => row.latestCanonicalOutcome.kind === "UNKNOWN" ? [members[index]] : [])),
    },
    preparedMeetingSnapshot: projectPreparedMeetingSnapshot(rows, nowMs),
  };
}

/** Plain rendering shared by the page and deterministic render tests. */
export function observationText<T>(observation: Observation<T>, show: (value: T) => string = String): string {
  switch (observation.kind) {
    case "MEASURED": return show(observation.value);
    case "NOT_RECORDED": return "Not measured — no record";
    case "UNKNOWN": return "Cannot tell";
    case "NOT_APPLICABLE": return "Not applicable";
  }
}

/** Numeric zero is rendered only for a MEASURED count. */
export function drilldownCountText<T>(count: DrilldownCount<T>): string {
  if (count.kind === "MEASURED") return String(count.value);
  if (count.kind === "NOT_RECORDED") return "Not measured — no record";
  return "Cannot tell";
}

export interface RoutineObservabilityProjectionReadOptions {
  readonly now: string;
  readonly connected: boolean;
  /** Identity inlined into the currently deployed Admin/Reader build. */
  readonly currentReaderBuild?: CurrentReaderBuildIdentity;
  readonly readRows?: (since: string) => Promise<RoutineObservabilityRows>;
  /** DB-14: bring the registry's doors into the meeting lists before the projection; a failure leaves the last good lists. */
  readonly adoptDoors?: () => Promise<unknown>;
}

/**
 * Deterministic read boundary used by the server-only adapter. Keeping this
 * part pure lets tests plant every connection/projection outcome without importing
 * database credentials or a framework server marker.
 */
export async function projectRoutineDataObservabilityRead(
  options: RoutineObservabilityProjectionReadOptions,
): Promise<RoutineObservabilityRead> {
  if (!options.connected) {
    return {
      kind: "NOT_CONNECTED",
      detail: "This Admin runtime has no routine civic-data store connection. Nothing was read; this is not evidence that no outcomes exist.",
    };
  }
  const nowMs = Date.parse(options.now);
  if (!Number.isFinite(nowMs)) {
    return {
      kind: "PROJECTION_FAILED",
      detail: "The Admin observation clock is unreadable. The canonical store was not queried, and no source/store failure is being inferred.",
    };
  }
  if (!options.readRows) {
    return {
      kind: "PROJECTION_FAILED",
      detail: "The Admin routine-data read adapter is not installed. The canonical store was not queried, and no source/store failure is being inferred.",
    };
  }
  const since = new Date(nowMs - HISTORY_WINDOWS[2].durationMs).toISOString();
  let rows: RoutineObservabilityRows;
  try {
    rows = await options.readRows(since);
  } catch (error) {
    if (error instanceof Error && error.name === "RoutineObservabilityReadTimedOut") {
      return {
        kind: "STORE_UNREACHABLE",
        cause: "READ_TIMED_OUT",
        detail:
          "The canonical routine civic-data read did not finish inside this request's statement limit " +
          "(RoutineObservabilityReadTimedOut): it selects every candidate version from 30 days with its full payload, " +
          "3.8 GB on 2026-09-23, so no page request can wait for it. The store itself answered. No empty or zero outcome is being claimed.",
      };
    }
    return {
      kind: "STORE_UNREACHABLE",
      detail: `The routine civic-data tables could not be read (${error instanceof Error ? error.name : "unknown error"}). We could not ask, so no empty or zero outcome is being claimed.`,
    };
  }
  try { await options.adoptDoors?.(); } catch { /* the lists stay as they were */ }
  try {
    return {
      kind: "HELD",
      value: projectRoutineDataObservability(rows, options.now, undefined, options.currentReaderBuild),
    };
  } catch (error) {
    return {
      kind: "PROJECTION_FAILED",
      detail: `The canonical store answered, but Admin could not project its evidence (${error instanceof Error ? error.name : "unknown error"}). No source/store failure and no empty or zero outcome is being inferred.`,
    };
  }
}

// The projector is synchronous and never mutates its canonical snapshot.
// Repeated 24h/7d/30d checks reuse only identical historical proof inputs in
// this call. A later read gets a fresh cache; nested calls restore their parent.
let historicalProofMemo: { ids: WeakMap<object, number>; nextId: number; results: Map<string, ReturnType<typeof historicalPromotionProofUncached>> } | null = null;
function historicalPromotionProof(...args: Parameters<typeof historicalPromotionProofUncached>): ReturnType<typeof historicalPromotionProofUncached> {
  const memo = historicalProofMemo;
  if (memo === null) return historicalPromotionProofUncached(...args);
  const [event, candidate, candidates, events, nowMs] = args;
  const identity = (value: object) => { let id = memo.ids.get(value); if (id === undefined) { id = ++memo.nextId; memo.ids.set(value, id); } return id; };
  const key = JSON.stringify([identity(candidate), identity(candidates), identity(events), nowMs, canonicalCivicDataJson(event)]);
  const cached = memo.results.get(key);
  if (cached !== undefined) return cached;
  const result = historicalPromotionProofUncached(...args);
  memo.results.set(key, result);
  return result;
}
export function projectRoutineDataObservability(...args: Parameters<typeof projectRoutineDataObservabilityUncached>): ReturnType<typeof projectRoutineDataObservabilityUncached> {
  const previous = historicalProofMemo;
  historicalProofMemo = { ids: new WeakMap(), nextId: 0, results: new Map() };
  try { return projectRoutineDataObservabilityUncached(...args); }
  finally { historicalProofMemo = previous; }
}
