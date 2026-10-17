import type { Division } from "../registry/types.ts";
import { requireRegistryState, stateRegistryRuntimeScope } from "./state-scopes.ts";
import { bindStatePublicationPrior, takeStatePublicationPrior } from "./state-publication.ts";
import { createHash } from "node:crypto";
import { currentReaderSelection } from "../db/reader-route.ts";
import { sourceCheckedAt } from "./source-check.ts";
import { isScopedManualContractScope } from "./scoped-manual-contracts.ts";
import { decodeStateCandidate, durableStateHash, encodeStateCandidate, heldStatePublication, heldStatePublicationHashes, statePublicationScope } from "./state-publication.ts";

import { and, desc, eq, getTableColumns, inArray, like, sql } from "drizzle-orm";

import { getDb } from "../db/index.ts";
import { runtimeCivicReadCache } from "../db/civic-read-cache.ts";
import { civicDataCandidateEvents, civicDataCandidates, civicDataPromotions, civicDataReaderProjections, civicDataPayloadParts } from "../db/schema.ts";
import { CivicPayloadParts, type CivicPayloadPartIO } from "./payload-parts.ts";
import {
  type CandidateEvent,
  type CandidateState,
  type CandidateVersionRecord,
  type PromotedPointerIdentity,
  type PromotedProjection,
  type RoutineCandidate,
  type RoutineRecordClass,
  type ValidationReceipt,
} from "./types.ts";
import { canonicalCivicDataJson } from "./changes.ts";
import {
  UNCHANGED_CONFIRMATION_PREFIX,
  buildUnchangedConfirmation,
  latestUnchangedConfirmation,
  parseUnchangedConfirmation,
  serializeUnchangedConfirmation,
  serializeUnchangedConfirmationSources,
  type ConfirmUnchangedInput,
  type ConfirmUnchangedOutcome,
  type UnchangedConfirmation,
} from "./unchanged-confirmation.ts";
import { parseValidationReceipt } from "./receipt.ts";
import {
  isTrustedLkgImportCandidate,
} from "./trusted-lkg-import.ts";
import { assertWriteAllowed } from "../db/write-guard.ts";
import { ROUTINE_SOURCE_CONTRACTS } from "./contracts.ts";
import { RUNTIME_ROUTINE_CONTRACTS } from "./runtime-routine-contracts.ts";
import { MEETING_HISTORY_SOURCE_ID, MEETING_PARTITION_CONTRACTS, meetingHistoryContract, meetingPartitionForHistoryScope } from "./meeting-partitions.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "./manual-contracts.ts";
import {
  assertSanctionedRuntimeAuthority,
  runtimeAuthorityEnvelope,
  RuntimeAuthorityRefused,
  type RuntimeAuthorityEnvelope,
} from "./runtime-authority.ts";
import { CIVIC_DATA_PROMOTION_OPERATION } from "./production-write.ts";
import {
  READER_PROJECTION_READBACK_PREFIX,
  parseReaderProjectionReadback,
  sourceScopedReaderReadbackProjectionId,
} from "./reader-readback.ts";
import { canonicalAgendaDocument, type AgendaDocument } from "../meetings/agenda-documents.ts";

export function projectionKey(recordClass: RoutineRecordClass, scope: string): string {
  return `${recordClass}:${scope}`;
}

export type CandidateVersionSummary = Omit<CandidateVersionRecord, "candidate"> & {
  readonly candidate: Pick<RoutineCandidate, "id" | "sourceId" | "recordClass" | "scope">;
};

export type PublishedCandidateMetadata = Omit<CandidateVersionRecord, "candidate"> & {
  readonly candidate: Pick<RoutineCandidate, "id" | "sourceId" | "recordClass" | "scope" | "retrieval" | "temporal"> & {
    readonly normalization: Pick<RoutineCandidate["normalization"], "succeeded" | "normalizedHash" | "normalizedPayloadHash" | "stateRecordHashes">;
  };
};

export function publishedCandidateMetadata(row: CandidateVersionRecord): PublishedCandidateMetadata {
  const { id, sourceId, recordClass, scope, retrieval, temporal, normalization } = row.candidate;
  const publishedRetrieval = { ...retrieval };
  delete publishedRetrieval.derived;
  return { ...row, candidate: { id, sourceId, recordClass, scope, retrieval: publishedRetrieval, temporal,
    normalization: { succeeded: normalization.succeeded, normalizedHash: normalization.normalizedHash,
      normalizedPayloadHash: normalization.normalizedPayloadHash,
      ...(normalization.stateRecordHashes ? { stateRecordHashes: normalization.stateRecordHashes } : {}) } } };
}

/** Preserve the SQL row identity even when its untrusted JSON body is corrupt. */
export interface CandidateVersionReadback {
  readonly candidateId: string;
  readonly record: CandidateVersionRecord;
}

export interface PreparedProjectionCoupling {
  readonly contractId: string;
  readonly versionId: string;
}

/** A serving copy derived from the partitions in `composedFrom`, never authoritative civic truth. */
export interface PreparedReaderProjectionRow {
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly sequence: number;
  readonly payload: unknown;
  readonly composedFrom: readonly PreparedProjectionCoupling[];
  readonly factSha256: string;
  readonly generatedAt: string;
  readonly composedAt: string;
  readonly sourceThrough: string | null;
  readonly retrievedAt: string | null;
  readonly promotedThrough: string | null;
}

export type PreparedReaderProjectionCoupling = Pick<PreparedReaderProjectionRow, "recordClass" | "scope" | "sequence" | "composedFrom" | "generatedAt">;

export interface PreparedReaderProjectionInput {
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly payload: unknown;
  readonly composedFrom: readonly PreparedProjectionCoupling[];
  readonly factSha256: string;
  readonly generatedAt: string;
  readonly composedAt: string;
  readonly sourceThrough: string | null;
  readonly retrievedAt: string | null;
  readonly promotedThrough: string | null;
}

export interface CandidateTransitionOptions {
  readonly candidate?: RoutineCandidate;
}

export interface RoutineDataStore {
  readonly eventObservedAt?: (recordClass: RoutineRecordClass, scope: string, requestedAt: string) => Promise<string>;
  readonly create: (record: CandidateVersionRecord, firstEvent: CandidateEvent) => Promise<void>;
  readonly transition: (
    candidateId: string,
    state: CandidateState,
    at: string,
    detail: string,
    receipt?: ValidationReceipt,
    failure?: { code: string; detail: string },
    options?: CandidateTransitionOptions,
  ) => Promise<CandidateVersionRecord>;
  readonly readRegistryDivisions: (state: string, labels: readonly string[]) => Promise<readonly RegistryDivisionMatch[]>;
  readonly readCandidate: (candidateId: string) => Promise<CandidateVersionRecord | null>;
  readonly readCandidateSummary: (candidateId: string) => Promise<CandidateVersionSummary | null>;
  /** The newest candidate a source wrote for a scope, by acquisition time. */
  readonly latestCandidate: (sourceId: string, recordClass: RoutineRecordClass, scope: string) => Promise<LatestCandidate | null>;
  /** A re-read whose values and refusal match this candidate, recorded on it in its own state instead of a new candidate. */
  readonly recordRecheck: (candidateId: string, at: string, detail: string) => Promise<CandidateEvent>;
  readonly readStateRetirementBaseline?: (recordClass: RoutineRecordClass, scope: string) => Promise<RoutineCandidate["normalization"]["stateRecordHashes"] | null>;
  readonly readStateRetirementOrigin?: (recordClass: string, scope: string) => Promise<{
    readonly versionId: string; readonly lastKnownGoodVersionId: string; readonly sourceId: string;
    readonly recordClass: string; readonly scope: string; readonly normalizedHash: string | null;
    readonly promoted: boolean; readonly sourceAuthenticity: string | null;
  } | null>;
  readonly readStatePublicationBase?: (recordClass: RoutineRecordClass, scope: string) => Promise<{ readonly current: PromotedProjection | null; readonly lkg: CandidateVersionRecord | null }>;
  readonly readPromotion: <T = unknown>(recordClass: RoutineRecordClass, scope: string) => Promise<PromotedProjection<T> | null>;
  readonly readCandidates: (candidateIds: readonly string[]) => Promise<readonly CandidateVersionReadback[]>;
  readonly readPublishedCandidateMetadata: (candidateId: string) => Promise<PublishedCandidateMetadata | null>;
  readonly readCandidateProof?: (candidateId: string) => Promise<CandidateVersionRecord | null>;
  readonly readCandidateProofs?: (candidateIds: readonly string[]) => Promise<readonly CandidateVersionReadback[]>;
  readonly confirmUnchanged?: (input: ConfirmUnchangedInput, at: string) => Promise<ConfirmUnchangedOutcome>;
  readonly readPromotions: <T = unknown>(recordClass: RoutineRecordClass, scopes: readonly string[]) => Promise<readonly PromotedProjection<T>[]>;
  readonly readPromotionIdentity: (recordClass: RoutineRecordClass, scope: string) => Promise<PromotedPointerIdentity | null>;
  readonly readPromotionIdentities: (recordClass: RoutineRecordClass, scopes: readonly string[]) => Promise<readonly PromotedPointerIdentity[]>;
  readonly listPromotionScopes?: (recordClasses: readonly RoutineRecordClass[]) => Promise<readonly { recordClass: RoutineRecordClass; scope: string }[]>;
  readonly readPreparedReaderProjection: (recordClass: RoutineRecordClass, scope: string) => Promise<PreparedReaderProjectionRow | null>;
  readonly readPreparedReaderProjectionCoupling: (recordClass: RoutineRecordClass, scope: string) => Promise<PreparedReaderProjectionCoupling | null>;
    /** Lands only if the row is still at `expectedSequence` (null = expect absent); a stale pass gets `published:false`. */
  readonly writePreparedReaderProjection: (
    input: PreparedReaderProjectionInput,
    expectedSequence: number | null,
  ) => Promise<{ readonly published: boolean; readonly sequence: number }>;
  readonly promote: (candidateId: string, receipt: ValidationReceipt, at: string, options?: CandidateTransitionOptions) => Promise<PromotedProjection>;
  readonly appendEvidence: (candidateId: string, state: CandidateState, at: string, detail: string) => Promise<CandidateEvent>;
  readonly events: (candidateId: string) => Promise<readonly CandidateEvent[]>;
  readonly latestReaderReadbacks?: (candidateIds: readonly string[]) => Promise<readonly CandidateEvent[]>;
  readonly pointerMoveEvents?: (candidateId: string) => Promise<readonly CandidateEvent[]>;
  readonly clock: (
    sourceId: string,
    recordClass: RoutineRecordClass,
    scope: string,
    parserVersion?: string,
  ) => Promise<RoutineStoreClock>;
}

export interface RoutineStoreClock {
  readonly lastAttemptedAt?: string;
  readonly lastSucceededAt?: string;
  readonly lastSucceededObservedAt?: string;
  /** Returned for a parser-scoped clock; the prior GOOD keeps its original source timestamps. */
  readonly lastSucceededParserVersion?: string;
  readonly sittingStarts?: readonly string[];
  readonly continuationPending?: boolean;
}

/** Every pointer move's event detail begins with this (both stores' `promote`). */
export const POINTER_MOVE_DETAIL_PREFIX = "Atomic pointer ";

export function newestReaderReadback(events: readonly CandidateEvent[]): CandidateEvent | null {
  return events
    .filter((event) => event.detail.startsWith(READER_PROJECTION_READBACK_PREFIX))
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at) || right.sequence - left.sequence)[0] ?? null;
}

export async function readLatestReaderReadbacks(
  store: Pick<RoutineDataStore, "events" | "latestReaderReadbacks">,
  candidateIds: readonly string[],
): Promise<readonly CandidateEvent[]> {
  if (typeof store.latestReaderReadbacks === "function") return store.latestReaderReadbacks(candidateIds);
  const latest: CandidateEvent[] = [];
  for (const candidateId of candidateIds) {
    const newest = newestReaderReadback(await store.events(candidateId));
    if (newest !== null) latest.push(newest);
  }
  return latest;
}

export async function readPointerMoveEvents(
  store: Pick<RoutineDataStore, "events" | "pointerMoveEvents">,
  candidateId: string,
): Promise<readonly CandidateEvent[]> {
  if (typeof store.pointerMoveEvents === "function") return store.pointerMoveEvents(candidateId);
  return (await store.events(candidateId)).filter(isPointerMoveEvent);
}

function isPointerMoveEvent(event: CandidateEvent): boolean {
  return event.state === "PROMOTED" && event.detail.startsWith(POINTER_MOVE_DETAIL_PREFIX);
}

type RegisteredMutationContract = {
  readonly id: string;
  readonly kind: "routine" | "manual";
  readonly readerProjectionId: string | null;
};

interface LatestCandidate {
  readonly id: string;
  readonly state: CandidateState;
  readonly normalizedHash: string | null;
  readonly parserVersion: string;
  readonly failureCode: string | null;
}

export type CandidateAuthorityIdentity = Pick<RoutineCandidate, "id" | "sourceId" | "recordClass" | "scope" | "bootstrapImport">;

function registeredMutationContract(
  candidate: Pick<RoutineCandidate, "sourceId" | "recordClass" | "scope">,
): RegisteredMutationContract | null {
  if (candidate.sourceId === MEETING_HISTORY_SOURCE_ID && candidate.recordClass === "MEETING") {
    const partition = meetingPartitionForHistoryScope(candidate.scope);
    return partition === null
      ? null
      : { id: partition.id, kind: "routine", readerProjectionId: meetingHistoryContract(partition).readerProjection!.id };
  }
  const routine = [...ROUTINE_SOURCE_CONTRACTS, ...RUNTIME_ROUTINE_CONTRACTS, ...MEETING_PARTITION_CONTRACTS]
    .filter((contract) =>
      contract.sourceId === candidate.sourceId &&
      contract.recordClass === candidate.recordClass &&
      (contract.scope === candidate.scope ||
        ("fanOut" in contract && contract.fanOut === true && candidate.scope.startsWith(`${contract.sourceId}:`)))
    )
    .map((contract) => ({
      id: contract.id,
      kind: "routine" as const,
      readerProjectionId: contract.readerProjection?.id ??
        sourceScopedReaderReadbackProjectionId(contract.id),
    }));
  const manual = MANUAL_PRODUCTION_SOURCE_CONTRACTS
    .filter((contract) =>
      contract.sourceId === candidate.sourceId &&
      contract.recordClass === candidate.recordClass &&
      (contract.scope === candidate.scope || isScopedManualContractScope(contract.id, candidate.scope))
    )
    .map((contract) => ({
      id: contract.id,
      kind: "manual" as const,
      readerProjectionId: contract.readerProjection.id,
    }));
  const matches = [...routine, ...manual];
  return matches.length === 1 ? matches[0] : null;
}

export function routineDataStoreCandidateAuthorityIssue(
  candidate: CandidateAuthorityIdentity,
  authority: RuntimeAuthorityEnvelope,
  operation: "candidate" | "reader-evidence",
): string | null {
  const contract = registeredMutationContract(candidate);
  if (contract === null) return "candidate does not identify exactly one registered production contract";
  const hasAuthorityTransferMarker = Object.prototype.hasOwnProperty.call(candidate, "bootstrapImport") &&
    candidate.bootstrapImport !== undefined;
  if (authority.capability === "ROUTINE_SUPERVISOR") {
    return operation === "reader-evidence"
      ? null
      : `routine supervisor cannot mutate source candidate ${contract.id}`;
  }
  // The one-time capture conversion republishes held people, vote and directory versions, and nothing else.
  if (authority.capability === "CAPTURE_CONVERSION") {
    return !hasAuthorityTransferMarker && (/^(?:people-|openstates-people-|openstates-votes-)/.test(contract.id) || contract.id === "congress-bulk-roster")
      ? null : `capture conversion cannot mutate ${contract.id}`;
  }
  const expectedCapability = contract.kind === "manual" ? "MANUAL_CONTRACT" : "ROUTINE_CONTRACT";
  if (authority.capability !== expectedCapability) {
    return `contract ${contract.id} requires ${expectedCapability}, not ${authority.capability}`;
  }
  if (authority.contract !== contract.id) {
    return `authority for ${authority.contract ?? "no contract"} cannot mutate ${contract.id}`;
  }
  if (hasAuthorityTransferMarker) {
    return `ordinary ${expectedCapability} authority cannot write an authority-transfer marker`;
  }
  return null;
}

export function assertRoutineDataStoreMutationAuthority(
  env: Readonly<Record<string, string | undefined>> = process.env,
): RuntimeAuthorityEnvelope {
  assertWriteAllowed(CIVIC_DATA_PROMOTION_OPERATION, env);
  const admitted = assertSanctionedRuntimeAuthority(CIVIC_DATA_PROMOTION_OPERATION, env);
  const authority = runtimeAuthorityEnvelope(env) ?? (env.WTP_RUNTIME_MODE === "staging" ? admitted : null);
  if (authority === null) throw new RuntimeAuthorityRefused("routine data store mutation authority is unreadable");
  return authority;
}

/** Another writer moved the pointer after this candidate validated against it; the stale candidate may not overwrite it. */
export class PromotionBaseChangedError extends Error {
  readonly candidateId: string;
  readonly expectedVersionId: string | null;
  readonly actualVersionId: string | null;

  constructor(
    candidateId: string,
    expectedVersionId: string | null,
    actualVersionId: string | null,
  ) {
    super(
      `PROMOTION_BASE_CHANGED:${candidateId}:expected=${expectedVersionId ?? "NO_POINTER"}:actual=${actualVersionId ?? "NO_POINTER"}`,
    );
    this.name = "PromotionBaseChangedError";
    this.candidateId = candidateId;
    this.expectedVersionId = expectedVersionId;
    this.actualVersionId = actualVersionId;
  }
}

type RoutineCandidateName = Pick<RoutineCandidate, "id" | "sourceId" | "recordClass" | "scope">;

function receiptNamesCandidate(receipt: ValidationReceipt, candidate: RoutineCandidateName): boolean {
  return receipt.candidateId === candidate.id &&
    receipt.sourceId === candidate.sourceId &&
    receipt.recordClass === candidate.recordClass &&
    receipt.scope === candidate.scope;
}

function receiptsEqual(left: ValidationReceipt, right: ValidationReceipt): boolean {
  return canonicalCivicDataJson(left) === canonicalCivicDataJson(right);
}

function receiptIsGoodForCandidate(receipt: ValidationReceipt, candidate: RoutineCandidateName): boolean {
  const parsed = parseValidationReceipt(receipt);
  return parsed !== null && parsed.decision === "GOOD" && receiptNamesCandidate(parsed, candidate);
}

function persistedPromotionReceipt(
  record: CandidateVersionRecord | null | undefined,
  supplied: ValidationReceipt,
): ValidationReceipt | null {
  const persisted = record?.receipt;
  if (!record || record.state !== "VALIDATED" || !record.acquisitionSucceeded || !persisted) return null;
  if (!receiptIsGoodForCandidate(persisted, record.candidate) || !parseValidationReceipt(supplied)) return null;
  return receiptsEqual(persisted, supplied) ? persisted : null;
}

const TERMINAL_CANDIDATE_STATES = new Set<CandidateState>([
  "SOURCE_BLOCKED",
  "PARSE_INVALID",
  "IDENTITY_UNRESOLVED",
  "TEMPORAL_INVALID",
  "SEMANTIC_INVALID",
  "HORIZON_UNRESOLVED",
  "DEPENDENT_CONSUMER_INVALID",
  "CANNOT_TELL",
]);
const MAX_PROMOTION_CLOCK_SKEW_MS = 5 * 60 * 1_000;

export interface PdcV2CanonicalMeetingFactEvidence {
  readonly sha256: string;
  readonly meetingRowCount: number;
  readonly agendaDocumentRowCount: number;
}

export function pdcV2CanonicalMeetingFactEvidence(
  payloads: readonly unknown[],
): PdcV2CanonicalMeetingFactEvidence {
  const meetings: Array<Readonly<Record<string, unknown>>> = [];
  const agendaDocuments: AgendaDocument[] = [];
  for (const payload of payloads) {
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("PDC_V2_MEETING_FACT_PAYLOAD_INVALID");
    }
    const value = payload as { readonly meetings?: unknown; readonly agendaDocuments?: unknown };
    if (!Array.isArray(value.meetings) || !Array.isArray(value.agendaDocuments)) {
      throw new Error("PDC_V2_MEETING_FACT_PAYLOAD_INVALID");
    }
    for (const row of value.meetings) {
      if (
        row === null || typeof row !== "object" || Array.isArray(row) ||
        typeof (row as { readonly id?: unknown }).id !== "string" ||
        !(row as { readonly id: string }).id
      ) throw new Error("PDC_V2_MEETING_FACT_PAYLOAD_INVALID");
      meetings.push(row as Readonly<Record<string, unknown>>);
    }
    for (const row of value.agendaDocuments) {
      if (
        row === null || typeof row !== "object" || Array.isArray(row) ||
        typeof (row as { readonly id?: unknown }).id !== "string" ||
        !(row as { readonly id: string }).id
      ) throw new Error("PDC_V2_MEETING_FACT_PAYLOAD_INVALID");
      agendaDocuments.push(canonicalAgendaDocument(row as AgendaDocument));
    }
  }
  meetings.sort((left, right) =>
    (left.id as string).localeCompare(right.id as string) ||
    canonicalCivicDataJson(left).localeCompare(canonicalCivicDataJson(right))
  );
  agendaDocuments.sort((left, right) =>
    left.id.localeCompare(right.id) ||
    canonicalCivicDataJson(left).localeCompare(canonicalCivicDataJson(right))
  );
  if (
    new Set(meetings.map(({ id }) => id)).size !== meetings.length ||
    new Set(agendaDocuments.map(({ id }) => id)).size !== agendaDocuments.length
  ) throw new Error("PDC_V2_MEETING_FACT_IDENTITY_DUPLICATED");
  return {
    sha256: createHash("sha256")
      .update(canonicalCivicDataJson({ meetings, agendaDocuments }))
      .digest("hex"),
    meetingRowCount: meetings.length,
    agendaDocumentRowCount: agendaDocuments.length,
  };
}

function validEventInput(event: CandidateEvent): boolean {
  return Number.isFinite(Date.parse(event.at)) && event.detail.trim() !== "";
}

function assertInitialRecord(record: CandidateVersionRecord, firstEvent: CandidateEvent): void {
  const candidateId = record.candidate.id;
  const retrievedAt = Date.parse(record.candidate.retrieval.retrievedAt);
  const firstEventAt = Date.parse(firstEvent.at);
  if (
    firstEvent.candidateId !== candidateId ||
    firstEvent.sequence !== 1 ||
    firstEvent.state !== record.state ||
    !validEventInput(firstEvent) ||
    !Number.isFinite(retrievedAt) ||
    firstEventAt > Date.now() + MAX_PROMOTION_CLOCK_SKEW_MS
  ) {
    throw new Error(`CANDIDATE_INITIAL_EVENT_INVALID:${candidateId}`);
  }
  if (record.candidate.retrieval.succeeded !== record.acquisitionSucceeded) {
    throw new Error(`CANDIDATE_ACQUISITION_PROOF_MISMATCH:${candidateId}`);
  }
  if (record.state === "FETCHED") {
    if (
      !record.acquisitionSucceeded ||
      record.receipt !== null ||
      record.failureCode !== null ||
      record.failureDetail !== null ||
      record.promotedVersion !== null
    ) {
      throw new Error(`CANDIDATE_INITIAL_STATE_INVALID:${candidateId}:FETCHED`);
    }
    return;
  }
  if (record.state === "SOURCE_BLOCKED") {
    const parsed = parseValidationReceipt(record.receipt);
    const firstFailure = parsed?.checks.find((check) => check.verdict !== "PASS");
    if (
      record.acquisitionSucceeded ||
      parsed === null ||
      parsed.decision === "GOOD" ||
      !receiptNamesCandidate(parsed, record.candidate) ||
      Date.parse(parsed.validatedAt) !== firstEventAt ||
      !firstFailure ||
      record.failureCode !== firstFailure.code ||
      record.failureDetail !== firstFailure.detail ||
      record.promotedVersion !== null
    ) {
      throw new Error(`CANDIDATE_INITIAL_STATE_INVALID:${candidateId}:SOURCE_BLOCKED`);
    }
    return;
  }
  throw new Error(`CANDIDATE_INITIAL_STATE_INVALID:${candidateId}:${record.state}`);
}

function allowedPriorStates(next: CandidateState): readonly CandidateState[] {
  if (next === "NORMALIZED") return ["FETCHED"];
  if (next === "VALIDATED") return ["NORMALIZED"];
  if (TERMINAL_CANDIDATE_STATES.has(next)) return ["FETCHED", "NORMALIZED", "VALIDATED"];
  return [];
}

interface TransitionSubject {
  readonly state: CandidateState;
  readonly candidate: RoutineCandidateName & { readonly retrieval: Pick<RoutineCandidate["retrieval"], "retrievedAt"> };
}

function assertTransitionInput(
  record: TransitionSubject,
  state: CandidateState,
  at: string,
  detail: string,
  receipt?: ValidationReceipt,
  failure?: { code: string; detail: string },
): void {
  const candidateId = record.candidate.id;
  if (!Number.isFinite(Date.parse(at)) || detail.trim() === "") {
    throw new Error(`CANDIDATE_TRANSITION_EVIDENCE_INVALID:${candidateId}:${state}`);
  }
  if (Date.parse(at) > Date.now() + MAX_PROMOTION_CLOCK_SKEW_MS) {
    throw new Error(`CANDIDATE_TRANSITION_EVIDENCE_INVALID:${candidateId}:${state}`);
  }
  if (!allowedPriorStates(state).includes(record.state)) {
    throw new Error(`CANDIDATE_TRANSITION_INVALID:${candidateId}:${record.state}:${state}`);
  }
  if (state === "NORMALIZED") {
    if (receipt !== undefined || failure !== undefined) {
      throw new Error(`CANDIDATE_TRANSITION_EVIDENCE_INVALID:${candidateId}:${state}`);
    }
    return;
  }
  const parsed = parseValidationReceipt(receipt);
  if (
    parsed === null ||
    !receiptNamesCandidate(parsed, record.candidate) ||
    Date.parse(parsed.validatedAt) !== Date.parse(at)
  ) {
    throw new Error(`CANDIDATE_TRANSITION_RECEIPT_INVALID:${candidateId}:${state}`);
  }
  if (state === "VALIDATED") {
    if (
      parsed.decision !== "GOOD" ||
      failure !== undefined ||
      Date.parse(parsed.validatedAt) < Date.parse(record.candidate.retrieval.retrievedAt)
    ) {
      throw new Error(`CANDIDATE_TRANSITION_RECEIPT_INVALID:${candidateId}:${state}`);
    }
    return;
  }
  const firstFailure = parsed.checks.find((check) => check.verdict !== "PASS");
  if (
    parsed.decision === "GOOD" ||
    !firstFailure ||
    !failure ||
    failure.code !== firstFailure.code ||
    failure.detail !== firstFailure.detail ||
    failure.code.trim() === "" ||
    failure.detail.trim() === ""
  ) {
    throw new Error(`CANDIDATE_TRANSITION_RECEIPT_INVALID:${candidateId}:${state}`);
  }
}

function assertPromotionTime(
  record: CandidateVersionRecord,
  receipt: ValidationReceipt,
  at: string,
  nowMs: number = Date.now(),
): void {
  const retrievedAt = Date.parse(record.candidate.retrieval.retrievedAt);
  const validatedAt = Date.parse(receipt.validatedAt);
  const promotedAt = Date.parse(at);
  if (
    ![retrievedAt, validatedAt, promotedAt].every(Number.isFinite) ||
    retrievedAt > validatedAt ||
    validatedAt > promotedAt ||
    promotedAt > nowMs + MAX_PROMOTION_CLOCK_SKEW_MS
  ) {
    throw new Error(`CANDIDATE_PROMOTION_TIME_INVALID:${record.candidate.id}`);
  }
}

function assertReaderEvidenceInput(
  record: { readonly state: CandidateState; readonly candidate: CandidateAuthorityIdentity },
  state: CandidateState,
  at: string,
  detail: string,
  authority?: RuntimeAuthorityEnvelope,
): void {
  const candidate = record.candidate;
  const receipt = parseReaderProjectionReadback(detail);
  const contract = registeredMutationContract(candidate);
  if (
    record.state !== "PROMOTED" ||
    state !== "PROMOTED" ||
    receipt === null ||
    contract === null ||
    contract.readerProjectionId === null ||
    receipt.contractId !== contract.id ||
    receipt.sourceId !== candidate.sourceId ||
    receipt.recordClass !== candidate.recordClass ||
    receipt.scope !== candidate.scope ||
    receipt.projectionId !== contract.readerProjectionId ||
    receipt.versionId !== candidate.id ||
    receipt.pointerKey !== projectionKey(candidate.recordClass, candidate.scope) ||
    isoTime(receipt.observedAt) !== isoTime(at) ||
    Date.parse(at) > Date.now() + MAX_PROMOTION_CLOCK_SKEW_MS ||
    (authority !== undefined && receipt.verifierCodeSha !== authority.sha)
  ) {
    throw new Error(`CANDIDATE_READER_EVIDENCE_INVALID:${candidate.id}`);
  }
}

function isoTime(value: string): string | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/** Normalize Drizzle's timestamptz text to canonical UTC at the adapter boundary, failing closed, so hashes stay exact. */
export function canonicalPostgresRoutineTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`CIVIC_DATA_POSTGRES_TIMESTAMP_INVALID:${field}`);
  }
  const canonical = isoTime(value);
  if (canonical === null) {
    throw new Error(`CIVIC_DATA_POSTGRES_TIMESTAMP_INVALID:${field}`);
  }
  return canonical;
}

interface PromotionPointerProof {
  readonly sourceId: string;
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly versionId: string;
  readonly lastKnownGoodVersionId: string;
  readonly receipt: ValidationReceipt;
}

/** The only candidate fields the routine clock reads. It runs for every task on every pass, so widening it is a cost decision. */
export const ROUTINE_CLOCK_CANDIDATE_FIELDS = {
  top: ["id", "sourceId", "recordClass", "scope", "bootstrapImport"],
  retrieval: ["retrievedAt", "sourceCheck"],
  normalization: ["parserVersion"],
} as const;

type RoutineClockCandidate = Pick<RoutineCandidate, "id" | "sourceId" | "recordClass" | "scope" | "bootstrapImport"> & {
  readonly retrieval: Pick<RoutineCandidate["retrieval"], "retrievedAt" | "sourceCheck">;
  readonly normalization: Pick<RoutineCandidate["normalization"], "parserVersion">;
};

export type RoutineClockRecord = Omit<CandidateVersionRecord, "candidate"> & {
  readonly candidate: RoutineClockCandidate;
};

/** Postgres `jsonb_strip_nulls`: object fields holding null go, recursively; array elements stay. */
function stripJsonNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripJsonNulls);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, field]) => (field === null || field === undefined ? [] : [[key, stripJsonNulls(field)]])),
  );
}

/** The in-memory twin of the Postgres clock view: same fields, same null handling. */
export function routineClockCandidateView(candidate: RoutineCandidate): RoutineClockCandidate {
  const source = candidate as unknown as Readonly<Record<string, unknown>>;
  const retrieval = (candidate.retrieval ?? {}) as unknown as Readonly<Record<string, unknown>>;
  const normalization = (candidate.normalization ?? {}) as unknown as Readonly<Record<string, unknown>>;
  return stripJsonNulls({
    ...Object.fromEntries(ROUTINE_CLOCK_CANDIDATE_FIELDS.top.map((field) => [field, source[field] ?? null])),
    retrieval: Object.fromEntries(ROUTINE_CLOCK_CANDIDATE_FIELDS.retrieval.map((field) => [field, retrieval[field] ?? null])),
    normalization: Object.fromEntries(ROUTINE_CLOCK_CANDIDATE_FIELDS.normalization.map((field) => [field, normalization[field] ?? null])),
  }) as RoutineClockCandidate;
}

function proofConsistentPointedSuccess(
  record: RoutineClockRecord | null | undefined,
  pointer: PromotionPointerProof | null | undefined,
): record is RoutineClockRecord {
  const receipt = record?.receipt;
  if (!record || !pointer || record.state !== "PROMOTED" || !record.acquisitionSucceeded || !receipt) return false;
  if (pointer.versionId !== record.candidate.id || pointer.lastKnownGoodVersionId !== record.candidate.id) return false;
  if (record.promotedVersion !== record.candidate.id || record.lastKnownGoodVersion !== record.candidate.id) return false;
  if (pointer.sourceId !== record.candidate.sourceId || pointer.recordClass !== record.candidate.recordClass || pointer.scope !== record.candidate.scope) return false;
  if (!receiptIsGoodForCandidate(receipt, record.candidate)) return false;
  if (!receiptsEqual(pointer.receipt, receipt)) return false;
    // A frozen LKG import is not a publisher acquisition: no clock success, so the runner is due at once.
  return !isTrustedLkgImportCandidate(record.candidate);
}

export function proofConsistentSuccess(
  record: RoutineClockRecord | null | undefined,
  pointer: PromotionPointerProof | null | undefined,
): string | undefined {
  return proofConsistentPointedSuccess(record, pointer) ? record.candidate.retrieval.retrievedAt : undefined;
}

/** The claimed retrieval precedes the store-observed first event, so the attempt clock compares against this one. */
export function proofConsistentObservedSuccess(
  record: RoutineClockRecord | null | undefined,
  pointer: PromotionPointerProof | null | undefined,
  observedAt: string | null | undefined,
): string | undefined {
  if (!proofConsistentPointedSuccess(record, pointer)) return undefined;
  return sourceCheckedAt(record.candidate.retrieval, observedAt);
}

export function meetingPayloadSittingStarts(payload: unknown): readonly string[] {
  const meetings = payload && typeof payload === "object" ? (payload as { meetings?: unknown }).meetings : undefined;
  if (!Array.isArray(meetings)) return [];
  return meetings.flatMap((meeting) => {
    const start = meeting && typeof meeting === "object" ? (meeting as { startsAt?: unknown }).startsAt : undefined;
    return typeof start === "string" ? [start] : [];
  });
}

/** An import is neither an attempt nor a success; a live attempt made since the import's pointer move is an attempt. */
export function trustedLkgImportClock(
  lastAttemptedAt: string | undefined,
  importPromotedAt: string,
): { readonly lastAttemptedAt?: string } {
  const attempted = lastAttemptedAt === undefined ? Number.NaN : Date.parse(lastAttemptedAt);
  const imported = Date.parse(importPromotedAt);
  return Number.isFinite(attempted) && Number.isFinite(imported) && attempted > imported
    ? { lastAttemptedAt: lastAttemptedAt! }
    : {};
}

export function candidateVersionSummary(record: CandidateVersionRecord): CandidateVersionSummary {
  const { candidate, ...columns } = record;
  return {
    ...columns,
    candidate: { id: candidate.id, sourceId: candidate.sourceId, recordClass: candidate.recordClass, scope: candidate.scope },
  };
}

export function promotedPointerIdentity(pointer: PromotedPointerIdentity): PromotedPointerIdentity {
  return {
    key: pointer.key,
    sourceId: pointer.sourceId,
    recordClass: pointer.recordClass,
    scope: pointer.scope,
    versionId: pointer.versionId,
    lastKnownGoodVersionId: pointer.lastKnownGoodVersionId,
    promotedAt: pointer.promotedAt,
    ...(pointer.latestConfirmation ? { latestConfirmation: pointer.latestConfirmation } : {}),
  };
}

export async function routineEventObservedAt(
  store: RoutineDataStore,
  recordClass: RoutineRecordClass,
  scope: string,
  requestedAt: string,
): Promise<string> {
  return store.eventObservedAt ? store.eventObservedAt(recordClass, scope, requestedAt) : requestedAt;
}

export class MemoryRoutineDataStore implements RoutineDataStore {
  private readonly candidates = new Map<string, CandidateVersionRecord>();
  private readonly history = new Map<string, CandidateEvent[]>();
  private readonly promotions = new Map<string, PromotedProjection>();
  private readonly preparedProjections = new Map<string, PreparedReaderProjectionRow>();

  async readRegistryDivisions(state: string, labels: readonly string[]): Promise<readonly RegistryDivisionMatch[]> {
    const pointer = this.promotions.get(projectionKey("REGISTRY_RUNTIME_BINDING", stateRegistryRuntimeScope(state)));
    return pointer?.receipt.decision === "GOOD" ? registryDivisionMatches(pointer.payload, state, labels) : [];
  }

  async eventObservedAt(recordClass: RoutineRecordClass, scope: string, requestedAt: string): Promise<string> {
    let latest = Date.parse(requestedAt);
    for (const [id, record] of this.candidates) {
      if (record.candidate.recordClass !== recordClass || record.candidate.scope !== scope) continue;
      for (const event of this.history.get(id) ?? []) latest = Math.max(latest, Date.parse(event.at));
    }
    return new Date(latest).toISOString();
  }

  private nextEvent(
    candidateId: string,
    state: CandidateState,
    at: string,
    detail: string,
  ): { readonly history: CandidateEvent[]; readonly event: CandidateEvent } {
    const history = this.history.get(candidateId) ?? [];
    const prior = history[history.length - 1];
    if (prior && Date.parse(at) < Date.parse(prior.at)) {
      throw new Error(`CANDIDATE_EVENT_TIME_INVALID:${candidateId}:${state}`);
    }
    return {
      history,
      event: { candidateId, sequence: history.length + 1, state, at, detail },
    };
  }

  async create(record: CandidateVersionRecord, firstEvent: CandidateEvent): Promise<void> {
    assertInitialRecord(record, firstEvent);
    if (this.candidates.has(record.candidate.id)) throw new Error(`CANDIDATE_ALREADY_EXISTS:${record.candidate.id}`);
    this.candidates.set(record.candidate.id, structuredClone(record));
    this.history.set(record.candidate.id, [structuredClone(firstEvent)]);
  }

  async transition(candidateId: string, state: CandidateState, at: string, detail: string, receipt?: ValidationReceipt, failure?: { code: string; detail: string }, options: CandidateTransitionOptions = {}): Promise<CandidateVersionRecord> {
    const prior = this.candidates.get(candidateId);
    if (!prior) throw new Error(`CANDIDATE_NOT_FOUND:${candidateId}`);
    if (options.candidate && !heldEnvelopeMatches({
      ...prior.candidate,
      rawHash: prior.candidate.retrieval.rawHash ?? null,
      normalizedHash: prior.candidate.normalization.normalizedHash ?? null,
      retrievedAt: prior.candidate.retrieval.retrievedAt,
    }, options.candidate)) {
      throw new Error(`CANDIDATE_TRANSITION_ENVELOPE_MISMATCH:${candidateId}`);
    }
    assertTransitionInput(prior, state, at, detail, receipt, failure);
    const { history, event } = this.nextEvent(candidateId, state, at, detail);
    const next: CandidateVersionRecord = {
      ...prior,
      state,
      receipt: receipt ?? prior.receipt,
      failureCode: failure?.code ?? prior.failureCode,
      failureDetail: failure?.detail ?? prior.failureDetail,
    };
    this.candidates.set(candidateId, structuredClone(next));
    history.push(event);
    this.history.set(candidateId, history);
    return structuredClone(next);
  }

  async readCandidate(candidateId: string): Promise<CandidateVersionRecord | null> {
    const row = this.candidates.get(candidateId);
    return row ? structuredClone(row) : null;
  }

  async readCandidateSummary(candidateId: string): Promise<CandidateVersionSummary | null> {
    const row = this.candidates.get(candidateId);
    return row ? candidateVersionSummary(structuredClone(row)) : null;
  }

  async latestCandidate(sourceId: string, recordClass: RoutineRecordClass, scope: string): Promise<LatestCandidate | null> {
    const rows = [...this.candidates.values()].filter(row => row.candidate.sourceId === sourceId && row.candidate.recordClass === recordClass && row.candidate.scope === scope);
    const row = rows.sort((a, b) => b.candidate.retrieval.retrievedAt.localeCompare(a.candidate.retrieval.retrievedAt))[0];
    return row ? { id: row.candidate.id, state: row.state, normalizedHash: row.candidate.normalization.normalizedHash ?? null,
      parserVersion: row.candidate.normalization.parserVersion, failureCode: row.failureCode } : null;
  }

  async recordRecheck(candidateId: string, at: string, detail: string): Promise<CandidateEvent> {
    const prior = this.candidates.get(candidateId);
    if (!prior) throw new Error(`CANDIDATE_NOT_FOUND:${candidateId}`);
    const { history, event } = this.nextEvent(candidateId, prior.state, at, detail);
    history.push(structuredClone(event));
    this.history.set(candidateId, history);
    return structuredClone(event);
  }

  private pointerRead(recordClass: RoutineRecordClass, scope: string): PromotedProjection | null {
    const row = this.promotions.get(projectionKey(recordClass, scope));
    if (!row) return null;
    const confirmation = latestUnchangedConfirmation(this.history.get(row.versionId) ?? [], row.versionId);
    return confirmation === null ? row : { ...row, latestConfirmation: confirmation };
  }

  async readPromotion<T = unknown>(recordClass: RoutineRecordClass, scope: string): Promise<PromotedProjection<T> | null> {
    const row = this.pointerRead(recordClass, scope);
    return row ? structuredClone(row) as PromotedProjection<T> : null;
  }

  async readPromotions<T = unknown>(
    recordClass: RoutineRecordClass,
    scopes: readonly string[],
  ): Promise<readonly PromotedProjection<T>[]> {
    return scopes.flatMap((scope) => {
      const row = this.pointerRead(recordClass, scope);
      return row ? [structuredClone(row) as PromotedProjection<T>] : [];
    });
  }

  async listPromotionScopes(recordClasses: readonly RoutineRecordClass[]) {
    return [...this.promotions.values()].filter(row => recordClasses.includes(row.recordClass))
      .map(({ recordClass, scope }) => ({ recordClass, scope }));
  }

  async readStateRetirementBaseline(recordClass: RoutineRecordClass, scope: string) {
    const candidates = [...this.candidates.values()].filter(row => row.state === "PROMOTED" && row.receipt?.decision === "GOOD" &&
      row.candidate.recordClass === recordClass && row.candidate.scope === scope &&
      this.history.get(row.candidate.id)?.some(event => event.sequence === 1 && event.detail.startsWith("STATE_BUCKET_RESTORE_V1 ")));
    candidates.sort((left, right) => (this.history.get(right.candidate.id)?.[0]?.at ?? "").localeCompare(this.history.get(left.candidate.id)?.[0]?.at ?? ""));
    const selected = candidates[0]?.candidate;
    return selected?.normalization.stateRecordHashes?.readModelHash === selected?.normalization.normalizedHash
      ? selected?.normalization.stateRecordHashes ?? null : null;
  }

  async readStateRetirementOrigin(recordClass: string, scope: string) {
    const pointer = this.promotions.get(`${recordClass}:${scope}`);
    const row = pointer ? this.candidates.get(pointer.versionId) : null;
    if (!pointer || !row) return null;
    const candidate = row.candidate;
    return { versionId: pointer.versionId, lastKnownGoodVersionId: pointer.lastKnownGoodVersionId,
      sourceId: candidate.sourceId, recordClass: candidate.recordClass, scope: candidate.scope,
      normalizedHash: candidate.normalization.normalizedHash,
      promoted: row.state === "PROMOTED" && row.acquisitionSucceeded && row.promotedVersion === candidate.id &&
        row.lastKnownGoodVersion === candidate.id && pointer.sourceId === candidate.sourceId && row.receipt?.decision === "GOOD" &&
        canonicalCivicDataJson(pointer.receipt) === canonicalCivicDataJson(row.receipt),
      sourceAuthenticity: row.receipt?.checks.find(check => check.check === "SOURCE_AUTHENTICITY" && check.verdict === "PASS")?.code ?? null };
  }

  async readPromotionIdentity(recordClass: RoutineRecordClass, scope: string): Promise<PromotedPointerIdentity | null> {
    const row = this.pointerRead(recordClass, scope);
    return row ? promotedPointerIdentity(row) : null;
  }

  async readPromotionIdentities(
    recordClass: RoutineRecordClass,
    scopes: readonly string[],
  ): Promise<readonly PromotedPointerIdentity[]> {
    return scopes.flatMap((scope) => {
      const row = this.pointerRead(recordClass, scope);
      return row ? [promotedPointerIdentity(row)] : [];
    });
  }

  async readPreparedReaderProjection(recordClass: RoutineRecordClass, scope: string): Promise<PreparedReaderProjectionRow | null> {
    const row = this.preparedProjections.get(projectionKey(recordClass, scope));
    return row ? structuredClone(row) : null;
  }

  async readPreparedReaderProjectionCoupling(recordClass: RoutineRecordClass, scope: string): Promise<PreparedReaderProjectionCoupling | null> {
    const row = this.preparedProjections.get(projectionKey(recordClass, scope));
    return row
      ? structuredClone({ recordClass: row.recordClass, scope: row.scope, sequence: row.sequence, composedFrom: row.composedFrom, generatedAt: row.generatedAt })
      : null;
  }

  async writePreparedReaderProjection(
    input: PreparedReaderProjectionInput,
    expectedSequence: number | null,
  ): Promise<{ readonly published: boolean; readonly sequence: number }> {
    const key = projectionKey(input.recordClass, input.scope);
    const current = this.preparedProjections.get(key);
    // Monotonic CAS: only advance when the row is still at the sequence the
    // caller read; otherwise a newer pass already published — don't regress it.
    if ((current?.sequence ?? null) !== expectedSequence) {
      return { published: false, sequence: current?.sequence ?? 0 };
    }
    const sequence = (expectedSequence ?? 0) + 1;
    this.preparedProjections.set(key, structuredClone({
      recordClass: input.recordClass,
      scope: input.scope,
      sequence,
      payload: input.payload,
      composedFrom: input.composedFrom,
      factSha256: input.factSha256,
      generatedAt: input.generatedAt,
      composedAt: input.composedAt,
      sourceThrough: input.sourceThrough,
      retrievedAt: input.retrievedAt,
      promotedThrough: input.promotedThrough,
    }));
    return { published: true, sequence };
  }

  async readCandidates(candidateIds: readonly string[]): Promise<readonly CandidateVersionReadback[]> {
    return candidateIds.flatMap((candidateId) => {
      const row = this.candidates.get(candidateId);
      return row ? [{ candidateId, record: structuredClone(row) }] : [];
    });
  }

  async readPublishedCandidateMetadata(candidateId: string): Promise<PublishedCandidateMetadata | null> {
    const row = this.candidates.get(candidateId);
    if (!row) return null;
    return structuredClone(publishedCandidateMetadata(row));
  }

  async readCandidateProof(candidateId: string): Promise<CandidateVersionRecord | null> {
    const row = this.candidates.get(candidateId);
    return row ? { ...structuredClone(row), candidate: candidateProofView(structuredClone(row.candidate)) } : null;
  }

  async readCandidateProofs(candidateIds: readonly string[]): Promise<readonly CandidateVersionReadback[]> {
    return candidateIds.flatMap((candidateId) => {
      const row = this.candidates.get(candidateId);
      return row ? [{ candidateId, record: { ...structuredClone(row), candidate: candidateProofView(structuredClone(row.candidate)) } }] : [];
    });
  }

  async appendEvidence(candidateId: string, state: CandidateState, at: string, detail: string): Promise<CandidateEvent> {
    const prior = this.candidates.get(candidateId);
    if (!prior) throw new Error(`CANDIDATE_NOT_FOUND:${candidateId}`);
    assertReaderEvidenceInput(prior, state, at, detail);
    const pointer = this.promotions.get(projectionKey(prior.candidate.recordClass, prior.candidate.scope));
    if (
      pointer?.sourceId !== prior.candidate.sourceId ||
      pointer.versionId !== candidateId ||
      pointer.lastKnownGoodVersionId !== candidateId
    ) {
      throw new Error(`CANDIDATE_READER_EVIDENCE_INVALID:${candidateId}`);
    }
    const { history, event } = this.nextEvent(candidateId, state, at, detail);
    history.push(structuredClone(event));
    this.history.set(candidateId, history);
    return structuredClone(event);
  }

  async confirmUnchanged(input: ConfirmUnchangedInput, at: string): Promise<ConfirmUnchangedOutcome> {
    const key = projectionKey(input.recordClass, input.scope);
    const built = buildUnchangedConfirmation(input, key, at);
    if (!built.ok) return { kind: "EVIDENCE_INVALID", detail: built.detail };
    const pointer = this.promotions.get(key);
    const row = this.candidates.get(input.pointerVersionId);
    if (
      !pointer || !row ||
      pointer.sourceId !== input.sourceId ||
      pointer.versionId !== input.pointerVersionId ||
      pointer.lastKnownGoodVersionId !== input.pointerVersionId ||
      row.state !== "PROMOTED"
    ) {
      return { kind: "POINTER_MOVED", detail: `The pointer ${key} no longer names ${input.pointerVersionId}.` };
    }
    if (isTrustedLkgImportCandidate(row.candidate)) {
      return { kind: "POINTER_IS_IMPORT", detail: `${input.pointerVersionId} is a trusted-LKG import; a live read of it promotes.` };
    }
    if (row.candidate.normalization.normalizedHash !== input.readModelHash) {
      return { kind: "HASH_DIFFERS", detail: `${input.pointerVersionId}'s read model is not ${input.readModelHash}.` };
    }
    const priorConfirmation = latestUnchangedConfirmation(this.history.get(input.pointerVersionId) ?? [], input.pointerVersionId);
    if (priorConfirmation && Date.parse(sourceCheckedAt(priorConfirmation.retrieval, priorConfirmation.observedAt) ?? "") >
      Date.parse(sourceCheckedAt(built.confirmation.retrieval, built.confirmation.observedAt) ?? "")) {
      return { kind: "CONFIRMED", versionId: input.pointerVersionId, at: priorConfirmation.observedAt };
    }
    const { history, event } = this.nextEvent(input.pointerVersionId, "PROMOTED", at, serializeUnchangedConfirmation(built.confirmation));
    history.push(structuredClone(event));
    if (input.retainedSourceResponses?.length) {
      history.push({
        candidateId: input.pointerVersionId,
        sequence: event.sequence + 1,
        state: "PROMOTED",
        at,
        detail: serializeUnchangedConfirmationSources(built.confirmation, input.retainedSourceResponses),
      });
    }
    this.history.set(input.pointerVersionId, history);
    return { kind: "CONFIRMED", versionId: input.pointerVersionId, at };
  }

  async promote(candidateId: string, receipt: ValidationReceipt, at: string): Promise<PromotedProjection> {
    const record = this.candidates.get(candidateId);
    const persistedReceipt = persistedPromotionReceipt(record, receipt);
    if (!record || !persistedReceipt) {
      throw new Error(`CANDIDATE_NOT_PROMOTABLE:${candidateId}`);
    }
    assertPromotionTime(record, persistedReceipt, at);
    const key = projectionKey(record.candidate.recordClass, record.candidate.scope);
    const previous = this.promotions.get(key);
    const expectedVersionId = record.lastKnownGoodVersion;
    const actualVersionId = previous?.versionId ?? null;
    if (actualVersionId !== expectedVersionId) {
      throw new PromotionBaseChangedError(candidateId, expectedVersionId, actualVersionId);
    }
    const projection: PromotedProjection = {
      key,
      sourceId: record.candidate.sourceId,
      recordClass: record.candidate.recordClass,
      scope: record.candidate.scope,
      versionId: candidateId,
      lastKnownGoodVersionId: candidateId,
      promotedAt: at,
      payload: structuredClone(record.candidate.readModel),
      receipt: structuredClone(persistedReceipt),
    };
    const { history, event } = this.nextEvent(
      candidateId,
      "PROMOTED",
      at,
      `${POINTER_MOVE_DETAIL_PREFIX}${key} moved from ${previous?.versionId ?? "bootstrap/no-version"} to ${candidateId}.`,
    );
    this.promotions.set(key, projection);
    history.push(event);
    this.history.set(candidateId, history);
    this.candidates.set(candidateId, {
      ...record,
      state: "PROMOTED",
      receipt: persistedReceipt,
      promotedVersion: candidateId,
      lastKnownGoodVersion: candidateId,
    });
    return structuredClone(projection);
  }

  async events(candidateId: string): Promise<readonly CandidateEvent[]> {
    return structuredClone(this.history.get(candidateId) ?? []);
  }

  async latestReaderReadbacks(candidateIds: readonly string[]): Promise<readonly CandidateEvent[]> {
    return candidateIds
      .map((candidateId) => newestReaderReadback(this.history.get(candidateId) ?? []))
      .filter((event): event is CandidateEvent => event !== null)
      .map((event) => structuredClone(event));
  }

  async pointerMoveEvents(candidateId: string): Promise<readonly CandidateEvent[]> {
    return structuredClone((this.history.get(candidateId) ?? []).filter(isPointerMoveEvent));
  }

  async clock(sourceId: string, recordClass: RoutineRecordClass, scope: string, parserVersion?: string): Promise<RoutineStoreClock> {
    const attempts = [...this.candidates.values()]
      .filter((row) =>
        row.candidate.sourceId === sourceId &&
        row.candidate.recordClass === recordClass &&
        row.candidate.scope === scope &&
        (parserVersion === undefined || row.candidate.normalization.parserVersion === parserVersion) &&
        !isTrustedLkgImportCandidate(row.candidate)
      )
      .flatMap((row) => {
        const firstEvent = this.history.get(row.candidate.id)?.find((event) => event.sequence === 1);
        const at = row.state === "PROMOTED" && row.acquisitionSucceeded
          ? sourceCheckedAt(row.candidate.retrieval, firstEvent?.at) : firstEvent?.at;
        return at && Number.isFinite(Date.parse(at)) ? [{ at }] : [];
      })
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
        // The retry scheduler runs on the locally observed first event, so a far-future publisher timestamp cannot postpone it.
    const lastAttemptedAt = attempts[0]?.at;
    const pointer = this.promotions.get(projectionKey(recordClass, scope));
    const pointedRow = pointer?.sourceId === sourceId ? this.candidates.get(pointer.versionId) : null;
    const pointedRecord: RoutineClockRecord | null = pointedRow
      ? { ...pointedRow, candidate: routineClockCandidateView(pointedRow.candidate) }
      : null;
    const sittings = recordClass === "MEETING" && pointer ? { sittingStarts: meetingPayloadSittingStarts(pointer.payload) } : {};
    if (pointer && pointedRecord && isTrustedLkgImportCandidate(pointedRecord.candidate)) {
      return { ...trustedLkgImportClock(lastAttemptedAt, pointer.promotedAt), ...sittings };
    }
    const pointedHistory = pointedRow ? this.history.get(pointedRow.candidate.id) ?? [] : [];
    const pointedObservedAt = pointedHistory.find((event) => event.sequence === 1)?.at;
    const confirmation = pointedRow ? latestUnchangedConfirmation(pointedHistory, pointedRow.candidate.id) : null;
    return confirmedClock({
      lastAttemptedAt,
      lastSucceededAt: proofConsistentSuccess(pointedRecord, pointer),
      lastSucceededObservedAt: proofConsistentObservedSuccess(pointedRecord, pointer, pointedObservedAt),
      ...(recordClass === "FEDERAL_MONEY" && scope === `${sourceId}:US` && pointer?.sourceId === sourceId
        ? { continuationPending: federalMoneyContinuationPending(pointer.payload, sourceId) } : {}),
      ...(parserVersion !== undefined && proofConsistentPointedSuccess(pointedRecord, pointer)
        ? { lastSucceededParserVersion: pointedRecord.candidate.normalization.parserVersion } : {}),
    }, confirmation, sittings, parserVersion);
  }
}

function rowToCandidate(row: typeof civicDataCandidates.$inferSelect): CandidateVersionRecord {
  return {
    candidate: row.candidate as RoutineCandidate,
    state: row.state as CandidateState,
    acquisitionSucceeded: row.acquisitionSucceeded,
    receipt: row.validationReceipt as ValidationReceipt | null,
    promotedVersion: row.promotedVersionId,
    lastKnownGoodVersion: row.lastKnownGoodVersionId,
    failureCode: row.failureCode,
    failureDetail: row.failureDetail,
  };
}

const CLOCK_FIELD_NAME = /^[A-Za-z]+$/;
for (const field of [...ROUTINE_CLOCK_CANDIDATE_FIELDS.top, ...ROUTINE_CLOCK_CANDIDATE_FIELDS.retrieval, ...ROUTINE_CLOCK_CANDIDATE_FIELDS.normalization]) {
  // The names are spliced into SQL as literals, so they stay plain identifiers.
  if (!CLOCK_FIELD_NAME.test(field)) throw new Error(`ROUTINE_CLOCK_FIELD_INVALID:${field}`);
}

function routineClockCandidateStub() {
  const column = civicDataCandidates.candidate;
  const top = ROUTINE_CLOCK_CANDIDATE_FIELDS.top.map((field) =>
    sql`${sql.raw(`'${field}'`)}, ${column}->${sql.raw(`'${field}'`)}`);
  const retrieval = ROUTINE_CLOCK_CANDIDATE_FIELDS.retrieval.map((field) =>
    sql`${sql.raw(`'${field}'`)}, ${column}#>${sql.raw(`'{retrieval,${field}}'`)}`);
  const normalization = ROUTINE_CLOCK_CANDIDATE_FIELDS.normalization.map((field) =>
    sql`${sql.raw(`'${field}'`)}, ${column}#>${sql.raw(`'{normalization,${field}}'`)}`);
  return sql`jsonb_strip_nulls(jsonb_build_object(${sql.join(
    [...top, sql`'retrieval', jsonb_build_object(${sql.join(retrieval, sql`, `)})`,
      sql`'normalization', jsonb_build_object(${sql.join(normalization, sql`, `)})`],
    sql`, `,
  )}))`.mapWith(civicDataCandidates.candidate);
}

type RoutineClockDb = Pick<ReturnType<typeof getDb>, "select">;

export function routineClockPointerRead(db: RoutineClockDb, recordClass: RoutineRecordClass, scope: string) {
  return db
    .select({
      sourceId: civicDataPromotions.sourceId,
      recordClass: civicDataPromotions.recordClass,
      scope: civicDataPromotions.scope,
      currentVersionId: civicDataPromotions.currentVersionId,
      lastKnownGoodVersionId: civicDataPromotions.lastKnownGoodVersionId,
      promotedAt: civicDataPromotions.promotedAt,
      validationReceipt: civicDataPromotions.validationReceipt,
      ...(recordClass === "FEDERAL_MONEY" && scope.endsWith(":US") ? { continuationPending: sql<boolean>`
        coalesce(${civicDataPromotions.payload}->>'state', '') = 'US'
        and ${civicDataPromotions.payload}->>'source' = ${civicDataPromotions.sourceId}
        and exists (
          select 1 from jsonb_array_elements(case when jsonb_typeof(${civicDataPromotions.payload}->'states') = 'array'
            then ${civicDataPromotions.payload}->'states' else '[]'::jsonb end) as state_progress
          where state_progress->>'status' = 'BACKFILL'
            or state_progress->'cursor' is not null and state_progress->'cursor' <> 'null'::jsonb
        )` } : {}),
    })
    .from(civicDataPromotions)
    .where(and(eq(civicDataPromotions.recordClass, recordClass), eq(civicDataPromotions.scope, scope)))
    .limit(1);
}

function unchangedConfirmationRefusedByEventRule(error: unknown): boolean {
  const chain: unknown[] = [];
  for (let value: unknown = error; value !== null && value !== undefined && chain.length < 4; value = (value as { cause?: unknown }).cause) {
    chain.push(value);
  }
  return chain.some((value) => {
    const row = value as { code?: unknown; message?: unknown };
    return typeof value === "object" && row.code === "23514" &&
      typeof row.message === "string" && row.message.includes("repeated PROMOTED event is not typed Reader evidence");
  });
}

function laterInstant(left: string | undefined, right: string | undefined): string | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Date.parse(right) > Date.parse(left) ? right : left;
}

function confirmedClock(
  clock: RoutineStoreClock,
  confirmation: UnchangedConfirmation | null,
  sittings: { readonly sittingStarts?: readonly string[] },
  parserVersion?: string,
): RoutineStoreClock {
  const confirmedAt = confirmation ? sourceCheckedAt(confirmation.retrieval, confirmation.observedAt) : undefined;
  const lastAttemptedAt = laterInstant(clock.lastAttemptedAt,
    parserVersion === undefined || clock.lastSucceededParserVersion === parserVersion ? confirmedAt : undefined);
  const lastSucceededAt = clock.lastSucceededAt === undefined
    ? undefined
    : laterInstant(clock.lastSucceededAt, confirmation?.retrieval.retrievedAt);
  const lastSucceededObservedAt = clock.lastSucceededObservedAt === undefined
    ? undefined
    : laterInstant(clock.lastSucceededObservedAt, confirmedAt);
  return {
    ...(lastAttemptedAt ? { lastAttemptedAt } : {}),
    ...(lastSucceededAt ? { lastSucceededAt } : {}),
    ...(lastSucceededObservedAt ? { lastSucceededObservedAt } : {}),
    ...(clock.lastSucceededParserVersion ? { lastSucceededParserVersion: clock.lastSucceededParserVersion } : {}),
    ...(clock.continuationPending !== undefined ? { continuationPending: clock.continuationPending } : {}),
    ...sittings,
  };
}

/** Only the source's promoted national marker owns the unfinished acquisition pages. */
export function federalMoneyContinuationPending(payload: unknown, sourceId: string): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const marker = payload as { readonly state?: unknown; readonly source?: unknown; readonly states?: unknown };
  if (marker.state !== "US" || marker.source !== sourceId || !Array.isArray(marker.states)) return false;
  return marker.states.some(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const progress = value as { readonly status?: unknown; readonly cursor?: unknown };
    return progress.status === "BACKFILL" || progress.cursor !== undefined && progress.cursor !== null;
  });
}

export function routineClockConfirmationRead(db: RoutineClockDb, recordClass: RoutineRecordClass, scope: string) {
  return db
    .select({ detail: civicDataCandidateEvents.detail })
    .from(civicDataPromotions)
    .innerJoin(civicDataCandidateEvents, eq(civicDataCandidateEvents.candidateId, civicDataPromotions.currentVersionId))
    .where(and(
      eq(civicDataPromotions.recordClass, recordClass),
      eq(civicDataPromotions.scope, scope),
      // `_` is a LIKE wildcard; the prefix is matched literally.
      like(civicDataCandidateEvents.detail, `${UNCHANGED_CONFIRMATION_PREFIX.replaceAll("_", "\\_")}%`),
    ))
    .orderBy(desc(civicDataCandidateEvents.sequence))
    .limit(1);
}

export function routineClockPointedObservedRead(db: RoutineClockDb, recordClass: RoutineRecordClass, scope: string) {
  return db
    .select({ observedAt: civicDataCandidateEvents.at })
    .from(civicDataPromotions)
    .innerJoin(civicDataCandidateEvents, and(
      eq(civicDataCandidateEvents.candidateId, civicDataPromotions.currentVersionId),
      eq(civicDataCandidateEvents.sequence, 1),
    ))
    .where(and(eq(civicDataPromotions.recordClass, recordClass), eq(civicDataPromotions.scope, scope)))
    .limit(1);
}

export function sittingStartsRead(db: RoutineClockDb, scope: string) {
  const payload = civicDataPromotions.payload;
  return db
    .select({
      starts: sql<unknown>`coalesce((
        select jsonb_agg(m->'startsAt')
        from jsonb_array_elements(case when jsonb_typeof(${payload}->'meetings') = 'array' then ${payload}->'meetings' else '[]'::jsonb end) as m
        where jsonb_typeof(m->'startsAt') = 'string'
      ), '[]'::jsonb)`,
    })
    .from(civicDataPromotions)
    .where(and(eq(civicDataPromotions.recordClass, "MEETING"), eq(civicDataPromotions.scope, scope)))
    .limit(1);
}

function sittingStartsFromRow(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) ? value.filter((start): start is string => typeof start === "string") : undefined;
}

export const CANDIDATE_PROOF_OMITTED = {
  unlessImported: ["changeSet", "civicRecords", "identities"],
} as const;

for (const field of CANDIDATE_PROOF_OMITTED.unlessImported) {
  // The names are spliced into SQL as literals, so they stay plain identifiers.
  if (!/^[A-Za-z]+$/.test(field)) throw new Error(`CANDIDATE_PROOF_FIELD_INVALID:${field}`);
}

export function candidateProofView(candidate: RoutineCandidate): RoutineCandidate {
  if (Object.hasOwn(candidate, "bootstrapImport")) return candidate;
  const omitted = new Set<string>(CANDIDATE_PROOF_OMITTED.unlessImported);
  return Object.fromEntries(
    Object.entries(candidate).filter(([key]) => !omitted.has(key)),
  ) as unknown as RoutineCandidate;
}

export function candidateProofRead(db: RoutineClockDb, candidateIds: readonly string[]) {
  const column = civicDataCandidates.candidate;
  const unlessImported = CANDIDATE_PROOF_OMITTED.unlessImported.map((field) => sql.raw(` - '${field}'`));
  return db
    .select({
      id: civicDataCandidates.id,
      candidate: sql`case when ${column} ? 'bootstrapImport'
        then ${column}
        else ${column}${sql.join(unlessImported, sql``)} end`.mapWith(civicDataCandidates.candidate),
      state: civicDataCandidates.state,
      acquisitionSucceeded: civicDataCandidates.acquisitionSucceeded,
      validationReceipt: civicDataCandidates.validationReceipt,
      promotedVersionId: civicDataCandidates.promotedVersionId,
      lastKnownGoodVersionId: civicDataCandidates.lastKnownGoodVersionId,
      failureCode: civicDataCandidates.failureCode,
      failureDetail: civicDataCandidates.failureDetail,
    })
    .from(civicDataCandidates)
    .where(inArray(civicDataCandidates.id, [...candidateIds]));
}

function candidateProofRowToRecord(row: Awaited<ReturnType<typeof candidateProofRead>>[number]): CandidateVersionRecord {
  return {
    candidate: row.candidate as RoutineCandidate,
    state: row.state as CandidateState,
    acquisitionSucceeded: row.acquisitionSucceeded,
    receipt: row.validationReceipt as ValidationReceipt | null,
    promotedVersion: row.promotedVersionId,
    lastKnownGoodVersion: row.lastKnownGoodVersionId,
    failureCode: row.failureCode,
    failureDetail: row.failureDetail,
  };
}

export function routineClockCandidateRead(db: RoutineClockDb, versionId: string) {
  return db
    .select({
      candidate: routineClockCandidateStub(),
      state: civicDataCandidates.state,
      acquisitionSucceeded: civicDataCandidates.acquisitionSucceeded,
      validationReceipt: civicDataCandidates.validationReceipt,
      promotedVersionId: civicDataCandidates.promotedVersionId,
      lastKnownGoodVersionId: civicDataCandidates.lastKnownGoodVersionId,
      failureCode: civicDataCandidates.failureCode,
      failureDetail: civicDataCandidates.failureDetail,
    })
    .from(civicDataCandidates)
    .where(eq(civicDataCandidates.id, versionId))
    .limit(1);
}

function routineClockRowToRecord(row: Awaited<ReturnType<typeof routineClockCandidateRead>>[number]): RoutineClockRecord {
  return {
    candidate: row.candidate as RoutineClockCandidate,
    state: row.state as CandidateState,
    acquisitionSucceeded: row.acquisitionSucceeded,
    receipt: row.validationReceipt as ValidationReceipt | null,
    promotedVersion: row.promotedVersionId,
    lastKnownGoodVersion: row.lastKnownGoodVersionId,
    failureCode: row.failureCode,
    failureDetail: row.failureDetail,
  };
}

const PROMOTED_POINTER_IDENTITY_COLUMNS = {
  key: civicDataPromotions.key,
  sourceId: civicDataPromotions.sourceId,
  recordClass: civicDataPromotions.recordClass,
  scope: civicDataPromotions.scope,
  currentVersionId: civicDataPromotions.currentVersionId,
  lastKnownGoodVersionId: civicDataPromotions.lastKnownGoodVersionId,
  promotedAt: civicDataPromotions.promotedAt,
} as const;

function promotedPointerIdentityRead(
  db: RoutineClockDb,
  recordClass: RoutineRecordClass,
  scopes: readonly string[],
) {
  return db
    .select(promotedPointerReadColumns())
    .from(civicDataPromotions)
    .where(and(eq(civicDataPromotions.recordClass, recordClass), inArray(civicDataPromotions.scope, [...scopes])));
}

export const PROMOTED_POINTER_COLUMNS = {
  ...PROMOTED_POINTER_IDENTITY_COLUMNS,
  validationReceipt: civicDataPromotions.validationReceipt,
} as const;

type PostgresPromotedPointerIdentityRow = Pick<
  typeof civicDataPromotions.$inferSelect,
  keyof typeof PROMOTED_POINTER_IDENTITY_COLUMNS
> & { readonly latestConfirmation?: string | null };

function latestConfirmationDetail() {
  return sql<string | null>`(
  select confirmation.detail from civic_data_candidate_events as confirmation
  where confirmation.candidate_id = "civic_data_promotions"."current_version_id"
    and left(confirmation.detail, ${UNCHANGED_CONFIRMATION_PREFIX.length}) = ${UNCHANGED_CONFIRMATION_PREFIX}
  order by confirmation.sequence desc
  limit 1
)`;
}

/* Names the latest confirmation without carrying its text, so a held identity is re-read only when it moved. */
function latestConfirmationSequence() {
  return sql<number | null>`(
  select confirmation.sequence from civic_data_candidate_events as confirmation
  where confirmation.candidate_id = "civic_data_promotions"."current_version_id"
    and left(confirmation.detail, ${UNCHANGED_CONFIRMATION_PREFIX.length}) = ${UNCHANGED_CONFIRMATION_PREFIX}
  order by confirmation.sequence desc
  limit 1
)`;
}

function promotedPointerReadColumns() {
  return {
    ...PROMOTED_POINTER_IDENTITY_COLUMNS,
    latestConfirmation: latestConfirmationDetail(),
  } as const;
}

function postgresPromotedPointerIdentity(row: PostgresPromotedPointerIdentityRow): PromotedPointerIdentity {
  const confirmation = typeof row.latestConfirmation === "string" ? parseUnchangedConfirmation(row.latestConfirmation) : null;
  return {
    key: row.key,
    sourceId: row.sourceId,
    recordClass: row.recordClass as RoutineRecordClass,
    scope: row.scope,
    versionId: row.currentVersionId,
    lastKnownGoodVersionId: row.lastKnownGoodVersionId,
    promotedAt: canonicalPostgresRoutineTimestamp(row.promotedAt, "promotion.promotedAt"),
    ...(confirmation !== null && confirmation.versionId === row.currentVersionId ? { latestConfirmation: confirmation } : {}),
  };
}

function postgresPromotionRowToProjection<T = unknown>(
  row: typeof civicDataPromotions.$inferSelect & { readonly latestConfirmation?: string | null },
): PromotedProjection<T> {
  return {
    ...postgresPromotedPointerIdentity(row),
    payload: row.payload as T,
    receipt: row.validationReceipt as ValidationReceipt,
  };
}

const CANDIDATE_SUMMARY_COLUMNS = {
  id: civicDataCandidates.id,
  sourceId: civicDataCandidates.sourceId,
  recordClass: civicDataCandidates.recordClass,
  scope: civicDataCandidates.scope,
  state: civicDataCandidates.state,
  acquisitionSucceeded: civicDataCandidates.acquisitionSucceeded,
  validationReceipt: civicDataCandidates.validationReceipt,
  promotedVersionId: civicDataCandidates.promotedVersionId,
  lastKnownGoodVersionId: civicDataCandidates.lastKnownGoodVersionId,
  failureCode: civicDataCandidates.failureCode,
  failureDetail: civicDataCandidates.failureDetail,
} as const;

export function candidateSummaryRead(db: RoutineClockDb, candidateId: string) {
  return db.select(CANDIDATE_SUMMARY_COLUMNS).from(civicDataCandidates).where(eq(civicDataCandidates.id, candidateId)).limit(1);
}

type PostgresCandidateSummaryRow = Pick<typeof civicDataCandidates.$inferSelect, keyof typeof CANDIDATE_SUMMARY_COLUMNS>;

function postgresCandidateSummary(row: PostgresCandidateSummaryRow): CandidateVersionSummary {
  return {
    candidate: { id: row.id, sourceId: row.sourceId, recordClass: row.recordClass as RoutineRecordClass, scope: row.scope },
    state: row.state as CandidateState,
    acquisitionSucceeded: row.acquisitionSucceeded,
    receipt: row.validationReceipt as ValidationReceipt | null,
    promotedVersion: row.promotedVersionId,
    lastKnownGoodVersion: row.lastKnownGoodVersionId,
    failureCode: row.failureCode,
    failureDetail: row.failureDetail,
  };
}

const READER_EVIDENCE_CANDIDATE_COLUMNS = {
  id: civicDataCandidates.id,
  sourceId: civicDataCandidates.sourceId,
  recordClass: civicDataCandidates.recordClass,
  scope: civicDataCandidates.scope,
  state: civicDataCandidates.state,
    // A present-but-null marker is still a marker, as the envelope's own-property check decides.
  hasBootstrapImport: sql<boolean>`${civicDataCandidates.candidate} ? 'bootstrapImport'`,
  bootstrapImport: sql<unknown>`${civicDataCandidates.candidate}->'bootstrapImport'`,
};

export function readerEvidenceCandidateRead(db: RoutineClockDb, candidateId: string) {
  return db
    .select(READER_EVIDENCE_CANDIDATE_COLUMNS)
    .from(civicDataCandidates)
    .where(eq(civicDataCandidates.id, candidateId))
    .limit(1);
}

export function candidateTransitionRead(db: RoutineClockDb, candidateId: string) {
  return db
    .select({
      ...READER_EVIDENCE_CANDIDATE_COLUMNS,
      retrievedAt: civicDataCandidates.retrievedAt,
      rawHash: civicDataCandidates.rawHash,
      normalizedHash: civicDataCandidates.normalizedHash,
    })
    .from(civicDataCandidates)
    .where(eq(civicDataCandidates.id, candidateId))
    .limit(1);
}

function heldEnvelopeMatches(
  row: {
    readonly id: string;
    readonly sourceId: string;
    readonly recordClass: string;
    readonly scope: string;
    readonly retrievedAt: string;
    readonly rawHash: string | null;
    readonly normalizedHash: string | null;
  },
  held: RoutineCandidate,
): boolean {
  return held.id === row.id &&
    held.sourceId === row.sourceId &&
    held.recordClass === row.recordClass &&
    held.scope === row.scope &&
    Date.parse(held.retrieval.retrievedAt) === Date.parse(row.retrievedAt) &&
    (held.retrieval.rawHash ?? null) === row.rawHash &&
    (held.normalization.normalizedHash ?? null) === row.normalizedHash;
}

export function readerEvidenceRowToRecord(
  row: Awaited<ReturnType<typeof readerEvidenceCandidateRead>>[number],
): { readonly state: CandidateState; readonly candidate: CandidateAuthorityIdentity } {
  return {
    state: row.state as CandidateState,
    candidate: {
      id: row.id,
      sourceId: row.sourceId,
      recordClass: row.recordClass as RoutineRecordClass,
      scope: row.scope,
      ...(row.hasBootstrapImport ? { bootstrapImport: row.bootstrapImport as RoutineCandidate["bootstrapImport"] } : {}),
    },
  };
}

export function preparedProjectionCouplingRead(db: RoutineClockDb, recordClass: RoutineRecordClass, scope: string) {
  return db
    .select({
      recordClass: civicDataReaderProjections.recordClass,
      scope: civicDataReaderProjections.scope,
      sequence: civicDataReaderProjections.sequence,
      composedFrom: civicDataReaderProjections.composedFrom,
      generatedAt: civicDataReaderProjections.generatedAt,
    })
    .from(civicDataReaderProjections)
    .where(and(eq(civicDataReaderProjections.recordClass, recordClass), eq(civicDataReaderProjections.scope, scope)))
    .limit(1);
}

function preparedRowToProjection(row: typeof civicDataReaderProjections.$inferSelect): PreparedReaderProjectionRow {
  return {
    recordClass: row.recordClass as RoutineRecordClass,
    scope: row.scope,
    sequence: row.sequence,
    payload: row.payload,
    composedFrom: row.composedFrom as readonly PreparedProjectionCoupling[],
    factSha256: row.factSha256,
    generatedAt: row.generatedAt,
    composedAt: canonicalPostgresRoutineTimestamp(row.composedAt, "readerProjection.composedAt"),
    sourceThrough: row.sourceThrough,
    retrievedAt: row.retrievedAt,
    promotedThrough: row.promotedThrough,
  };
}

type PostgresCandidateEventRow = Pick<
  typeof civicDataCandidateEvents.$inferSelect,
  "candidateId" | "sequence" | "state" | "at" | "detail"
>;

const CANDIDATE_EVENT_COLUMNS = {
  candidateId: civicDataCandidateEvents.candidateId,
  sequence: civicDataCandidateEvents.sequence,
  state: civicDataCandidateEvents.state,
  at: civicDataCandidateEvents.at,
  detail: civicDataCandidateEvents.detail,
} as const;

export function latestReaderReadbacksRead(db: Pick<ReturnType<typeof getDb>, "selectDistinctOn">, candidateIds: readonly string[]) {
  return db
    .selectDistinctOn([civicDataCandidateEvents.candidateId], CANDIDATE_EVENT_COLUMNS)
    .from(civicDataCandidateEvents)
    .where(and(
      inArray(civicDataCandidateEvents.candidateId, [...candidateIds]),
      sql`left(${civicDataCandidateEvents.detail}, ${READER_PROJECTION_READBACK_PREFIX.length}) = ${READER_PROJECTION_READBACK_PREFIX}`,
    ))
    .orderBy(civicDataCandidateEvents.candidateId, desc(civicDataCandidateEvents.at), desc(civicDataCandidateEvents.sequence));
}

export function pointerMoveEventsRead(db: RoutineClockDb, candidateId: string) {
  return db
    .select(CANDIDATE_EVENT_COLUMNS)
    .from(civicDataCandidateEvents)
    .where(and(
      eq(civicDataCandidateEvents.candidateId, candidateId),
      eq(civicDataCandidateEvents.state, "PROMOTED"),
      sql`left(${civicDataCandidateEvents.detail}, ${POINTER_MOVE_DETAIL_PREFIX.length}) = ${POINTER_MOVE_DETAIL_PREFIX}`,
    ))
    .orderBy(civicDataCandidateEvents.sequence);
}

function postgresCandidateEventRowToEvent(row: PostgresCandidateEventRow): CandidateEvent {
  return {
    candidateId: row.candidateId,
    sequence: row.sequence,
    state: row.state as CandidateState,
    at: canonicalPostgresRoutineTimestamp(row.at, "candidateEvent.at"),
    detail: row.detail,
  };
}

export class PostgresRoutineDataStore implements RoutineDataStore {
  private readonly db = getDb();
  private readonly readCache = runtimeCivicReadCache();
  private stateReadMetadata: PublishedCandidateMetadata | null = null;
  private async readPayloadParts(hashes: readonly string[]) {
    return this.db.select().from(civicDataPayloadParts).where(inArray(civicDataPayloadParts.hash, [...hashes]));
  }
  private readonly payloadPartIO: CivicPayloadPartIO = {
    existing: async hashes => (await this.db.select({ hash: civicDataPayloadParts.hash }).from(civicDataPayloadParts)
      .where(inArray(civicDataPayloadParts.hash, [...hashes]))).map(row => row.hash),
    write: async parts => { await this.db.insert(civicDataPayloadParts).values([...parts]).onConflictDoNothing(); },
    read: async hashes => {
      const values = (keys: readonly string[]) => this.readPayloadParts(keys);
      return this.readCache ? this.readCache.rows({ namespace: "payload-part", keys: hashes,
        versions: async keys => keys.map(key => ({ key, etag: key })), values, keyOf: row => row.hash,
      }) : values(hashes);
    },
  };
  private readonly payloadParts = new CivicPayloadParts(this.payloadPartIO);
  private readonly ownedPayloadParts = new CivicPayloadParts({ ...this.payloadPartIO, read: hashes => this.readPayloadParts(hashes) });
  private async loadPayload(value: unknown, scope: string): Promise<unknown> {
    if (statePublicationScope(scope)) return decodeStateCandidate(await this.ownedPayloadParts.loadOwned(value));
    return this.payloadParts.load(value);
  }

  private async readStatePromotion<T>(recordClass: RoutineRecordClass, scope: string): Promise<PromotedProjection<T> | null> {
    this.stateReadMetadata = null;
    const held = heldStatePublication(recordClass, scope), hashes = held && heldStatePublicationHashes(held);
    const reuse = held && hashes ? sql`p.current_version_id = ${held.versionId} AND p.last_known_good_version_id = ${held.versionId}
      AND p.source_id = ${held.sourceId} AND c.normalized_hash = ${hashes.readModelHash}
      AND c.state = 'PROMOTED' AND c.acquisition_succeeded AND c.promoted_version_id = c.id AND c.last_known_good_version_id = c.id
      AND c.source_id = p.source_id AND c.record_class = p.record_class AND c.scope = p.scope
      AND c.candidate#>>'{normalization,normalizedHash}' = c.normalized_hash
      AND c.candidate#>'{normalization,succeeded}' = 'true'::jsonb
      AND p.validation_receipt->>'decision' = 'GOOD' AND p.validation_receipt->>'candidateId' = c.id
      AND p.validation_receipt->>'sourceId' = c.source_id AND p.validation_receipt->>'recordClass' = c.record_class
      AND p.validation_receipt->>'scope' = c.scope` : sql`false`;
    const result = await this.db.execute(sql`WITH RECURSIVE state_promotion AS MATERIALIZED (
      SELECT p.*, c.candidate, c.state, c.acquisition_succeeded, c.promoted_version_id, c.last_known_good_version_id AS candidate_lkg,
        c.failure_code, c.failure_detail,
        (p.payload = c.candidate->'readModel' AND p.validation_receipt = c.validation_receipt) AS coupled,
        (${reuse}) AS reuse,
        (SELECT e.detail FROM civic_data_candidate_events e WHERE e.candidate_id = p.current_version_id
          AND left(e.detail, ${UNCHANGED_CONFIRMATION_PREFIX.length}) = ${UNCHANGED_CONFIRMATION_PREFIX}
          ORDER BY e.sequence DESC LIMIT 1) AS confirmation
      FROM civic_data_promotions p LEFT JOIN civic_data_candidates c ON c.id = p.current_version_id
      WHERE p.key = ${projectionKey(recordClass, scope)}
    ), roots AS MATERIALIZED (
      SELECT jsonb_build_object('projection', jsonb_build_object('key', key, 'recordClass', record_class, 'scope', scope,
        'sourceId', source_id, 'versionId', current_version_id, 'lastKnownGoodVersionId', last_known_good_version_id,
        'promotedAt', promoted_at, 'receipt', validation_receipt, 'payload', CASE WHEN reuse THEN NULL ELSE payload END),
        'candidate', jsonb_build_object('candidate', jsonb_build_object('id', candidate->'id', 'sourceId', candidate->'sourceId',
          'recordClass', candidate->'recordClass', 'scope', candidate->'scope', 'retrieval', (candidate->'retrieval') - 'derived',
          'temporal', candidate->'temporal', 'normalization', CASE WHEN reuse THEN (candidate->'normalization') - 'stateRecordHashes'
            WHEN candidate->'normalization' ? '$civicPayloadPart' THEN candidate->'normalization'
            ELSE jsonb_build_object('succeeded', candidate#>'{normalization,succeeded}',
              'normalizedHash', candidate#>'{normalization,normalizedHash}', 'normalizedPayloadHash', candidate#>'{normalization,normalizedPayloadHash}',
              'stateRecordHashes', candidate#>'{normalization,stateRecordHashes}') END),
          'state', state, 'acquisitionSucceeded', acquisition_succeeded, 'promotedVersion', promoted_version_id,
          'lastKnownGoodVersion', candidate_lkg, 'failureCode', failure_code, 'failureDetail', failure_detail)) AS value,
        coupled, reuse, confirmation FROM state_promotion
    ), hashes(hash) AS (
      SELECT ref#>>'{}' FROM roots, LATERAL jsonb_path_query(value, 'strict $.**."$civicPayloadPart"', '{}', true) ref WHERE coupled
      UNION
      SELECT ref#>>'{}' FROM hashes JOIN civic_data_payload_parts part USING(hash),
        LATERAL jsonb_path_query(part.payload, 'strict $.**."$civicPayloadPart"', '{}', true) ref
    ) SELECT value, coupled, reuse, confirmation,
      COALESCE((SELECT jsonb_object_agg(part.hash, part.payload) FROM hashes JOIN civic_data_payload_parts part USING(hash)), '{}'::jsonb) AS parts
      FROM roots`);
    const row = result.rows[0] as { value: unknown; coupled: boolean; reuse: boolean; confirmation: string | null; parts: Record<string, unknown> } | undefined;
    if (!row) return null;
    if (!row.coupled) throw new Error(`STATE_PUBLICATION_POINTER_PROOF_INVALID:${recordClass}:${scope}`);
    const decoded = await this.ownedPayloadParts.loadOwned(row.value, row.parts) as {
      projection: PromotedProjection<T>; candidate: PublishedCandidateMetadata;
    };
    const projection = { ...decoded.projection,
      promotedAt: canonicalPostgresRoutineTimestamp(decoded.projection.promotedAt, "promotion.promotedAt"),
      ...(row.reuse && held ? { payload: held.payload as T } : {}),
    };
    const confirmation = row.confirmation ? parseUnchangedConfirmation(row.confirmation) : null;
    if (confirmation?.versionId === projection.versionId) Object.assign(projection, { latestConfirmation: confirmation });
    const candidate = decoded.candidate.candidate as PublishedCandidateMetadata["candidate"] & { readModel?: T };
    candidate.readModel = projection.payload;
    decodeStateCandidate(candidate);
    delete candidate.readModel;
    const metadata = row.reuse && hashes ? { ...decoded.candidate, candidate: { ...decoded.candidate.candidate,
      normalization: { ...decoded.candidate.candidate.normalization, stateRecordHashes: hashes } } } : decoded.candidate;
    this.stateReadMetadata = { ...metadata, receipt: projection.receipt };
    return projection;
  }

  async readRegistryDivisions(state: string, labels: readonly string[]): Promise<readonly RegistryDivisionMatch[]> {
    if (!labels.length) return [];
    const pointer = await this.readPromotion("REGISTRY_RUNTIME_BINDING", stateRegistryRuntimeScope(state));
    return pointer?.receipt.decision === "GOOD" ? registryDivisionMatches(pointer.payload, state, labels) : [];
  }

  private async candidateRows<T extends { readonly id: string }>(
    ids: readonly string[], namespace: string, values: (keys: readonly string[]) => Promise<readonly T[]>,
  ): Promise<readonly T[]> {
    if (!this.readCache || ids.length === 0) return ids.length ? values(ids) : [];
    return this.readCache.rows({ namespace, keys: ids, values, keyOf: row => row.id,
      versions: async keys => this.db.select({ key: civicDataCandidates.id,
        etag: sql<string>`concat(${civicDataCandidates}.xmin::text, '/', ${civicDataCandidates}.ctid::text)`,
      }).from(civicDataCandidates).where(inArray(civicDataCandidates.id, [...keys])),
    });
  }

  private async promotionRows(recordClass: RoutineRecordClass, scopes: readonly string[]) {
    const values = async (keys: readonly string[]) => this.db
      .select({ ...getTableColumns(civicDataPromotions), latestConfirmation: latestConfirmationDetail() })
      .from(civicDataPromotions).where(and(eq(civicDataPromotions.recordClass, recordClass),
        inArray(civicDataPromotions.scope, keys.map(key => key.slice(recordClass.length + 1)))));
    const keys = scopes.map(scope => projectionKey(recordClass, scope));
    if (!this.readCache || keys.length === 0 || scopes.some(scope => statePublicationScope(scope))) return keys.length ? values(keys) : [];
    return this.readCache.rows({ namespace: "promotion", keys, values, keyOf: row => row.key,
      versions: async selected => this.db.select({ key: civicDataPromotions.key,
        etag: sql<string>`concat(${civicDataPromotions}.xmin::text, '/', ${civicDataPromotions}.ctid::text)`,
        latestConfirmation: latestConfirmationDetail(),
      }).from(civicDataPromotions).where(and(eq(civicDataPromotions.recordClass, recordClass),
        inArray(civicDataPromotions.key, [...selected]))),
      freshen: (row, version) => ({ ...row, latestConfirmation: version.latestConfirmation }),
    });
  }
  private writeAuthority: RuntimeAuthorityEnvelope | null = null;

  async eventObservedAt(recordClass: RoutineRecordClass, scope: string, _requestedAt: string): Promise<string> {
    const [row] = await this.db.select({ at: sql<string | null>`max(${civicDataCandidateEvents.at})` })
      .from(civicDataCandidateEvents)
      .innerJoin(civicDataCandidates, eq(civicDataCandidates.id, civicDataCandidateEvents.candidateId))
      .where(and(eq(civicDataCandidates.recordClass, recordClass), eq(civicDataCandidates.scope, scope)));
    return new Date(Math.max(Date.now(), row?.at == null ? 0 : Date.parse(row.at))).toISOString();
  }

  private assertMutationAuthority(): RuntimeAuthorityEnvelope {
    if (this.writeAuthority !== null) return this.writeAuthority;
    this.writeAuthority = assertRoutineDataStoreMutationAuthority();
    return this.writeAuthority;
  }

  private assertCandidateMutationAuthority(
    candidate: CandidateAuthorityIdentity,
    operation: "candidate" | "reader-evidence" = "candidate",
  ): void {
    const issue = routineDataStoreCandidateAuthorityIssue(
      candidate,
      this.assertMutationAuthority(),
      operation,
    );
    if (issue !== null) throw new RuntimeAuthorityRefused(issue);
  }


  private candidateEventLock(candidateId: string) {
    return this.db.execute(sql`
      select pg_advisory_xact_lock(hashtextextended(${candidateId}, 0))
    `);
  }

  private nextCandidateEventSequence(candidateId: string) {
    return sql`(
      select coalesce(max(${civicDataCandidateEvents.sequence}), 0) + 1
      from ${civicDataCandidateEvents}
      where ${civicDataCandidateEvents.candidateId} = ${candidateId}
    )`;
  }

  async create(record: CandidateVersionRecord, firstEvent: CandidateEvent): Promise<void> {
    this.assertCandidateMutationAuthority(record.candidate);
    assertInitialRecord(record, firstEvent);
    const stateAuthority = statePublicationScope(record.candidate.scope);
    const candidate = stateAuthority ? { ...encodeStateCandidate(record.candidate),
      retrieval: await this.payloadParts.store(record.candidate.retrieval,
        ["succeeded", "requestedUrl", "finalUrl", "httpStatus", "retrievedAt", "rawHash", "sourceCheck", "failureDetail"]),
    } : record.candidate;
    const stored = stateAuthority || ["REGISTRY_RUNTIME_BINDING", "STATE_ROLL_CALL", "CENSUS_REFERENCE"].includes(record.candidate.recordClass)
      ? await this.payloadParts.store(candidate,
        ["id", "sourceId", "recordClass", "scope", "retrieval", "normalization", "temporal", "bootstrapImport"], stateAuthority ? ["readModel"] : undefined) as RoutineCandidate
      : record.candidate;
    await this.db.batch([
      this.db.insert(civicDataCandidates).values({
        id: record.candidate.id,
        sourceId: record.candidate.sourceId,
        recordClass: record.candidate.recordClass,
        scope: record.candidate.scope,
        state: record.state,
        acquisitionSucceeded: record.acquisitionSucceeded,
        rawHash: record.candidate.retrieval.rawHash,
        normalizedHash: record.candidate.normalization.normalizedHash,
        retrievedAt: record.candidate.retrieval.retrievedAt,
        sourceThrough: record.candidate.temporal.sourceThrough,
        parserVersion: record.candidate.normalization.parserVersion,
        identity: stored.identities,
        candidate: stored,
        validationReceipt: record.receipt,
        promotedVersionId: record.promotedVersion,
        lastKnownGoodVersionId: record.lastKnownGoodVersion,
        failureCode: record.failureCode,
        failureDetail: record.failureDetail,
      }),
      this.db.insert(civicDataCandidateEvents).values(firstEvent),
    ]);
  }

  async transition(candidateId: string, state: CandidateState, at: string, detail: string, receipt?: ValidationReceipt, failure?: { code: string; detail: string }, options: CandidateTransitionOptions = {}): Promise<CandidateVersionRecord> {
    this.assertMutationAuthority();
    const [priorRow] = await candidateTransitionRead(this.db, candidateId);
    if (!priorRow) throw new Error(`CANDIDATE_NOT_FOUND:${candidateId}`);
    const authority = readerEvidenceRowToRecord(priorRow);
    this.assertCandidateMutationAuthority(authority.candidate);
    if (options.candidate && !heldEnvelopeMatches(priorRow, options.candidate)) {
      throw new Error(`CANDIDATE_TRANSITION_ENVELOPE_MISMATCH:${candidateId}`);
    }
    assertTransitionInput(
      { state: authority.state, candidate: { ...authority.candidate, retrieval: { retrievedAt: priorRow.retrievedAt } } },
      state, at, detail, receipt, failure,
    );
    const allowed = allowedPriorStates(state);
    const priorStateEligible = and(
      eq(civicDataCandidates.id, candidateId),
      inArray(civicDataCandidates.state, [...allowed]),
    )!;
    const nextSequence = this.nextCandidateEventSequence(candidateId);
        /* The compare-and-set and its event are one data-modifying CTE: neither can commit without the other. */
    const updatedCandidate = this.db.$with("updated_candidate").as(
      this.db.update(civicDataCandidates).set({
        state,
        ...(receipt ? { validationReceipt: receipt } : {}),
        ...(failure ? { failureCode: failure.code, failureDetail: failure.detail } : {}),
      }).where(priorStateEligible).returning({ candidateId: civicDataCandidates.id }),
    );
    const transitionWrite = this.db.with(updatedCandidate)
      .insert(civicDataCandidateEvents)
      .select(sql`
        select gen_random_uuid(), ${updatedCandidate.candidateId}, ${nextSequence}, ${state}, ${at}::timestamptz, ${detail}
        from ${updatedCandidate}
      `)
      .returning();
    const updatedCandidateRead = candidateSummaryRead(this.db, candidateId);
    const [, eventRows, updatedRows] = await this.db.batch([
      this.candidateEventLock(candidateId),
      transitionWrite,
      updatedCandidateRead,
    ]);
    if (!eventRows[0] || !updatedRows[0]) {
      const [current] = await this.db.select({ state: civicDataCandidates.state })
        .from(civicDataCandidates)
        .where(eq(civicDataCandidates.id, candidateId))
        .limit(1);
      if (!current) throw new Error(`CANDIDATE_NOT_FOUND:${candidateId}`);
      throw new Error(`CANDIDATE_TRANSITION_INVALID:${candidateId}:${current.state}:${state}`);
    }
    const { candidate: _sameRow, ...columns } = postgresCandidateSummary(updatedRows[0]);
    return { ...columns, candidate: options.candidate ?? await this.readCandidateEnvelope(candidateId) };
  }

  private async readCandidateEnvelope(candidateId: string): Promise<RoutineCandidate> {
    const [row] = await this.db.select({ candidate: civicDataCandidates.candidate })
      .from(civicDataCandidates)
      .where(eq(civicDataCandidates.id, candidateId))
      .limit(1);
    if (!row) throw new Error(`CANDIDATE_NOT_FOUND:${candidateId}`);
    return await this.loadPayload(row.candidate, (row.candidate as RoutineCandidate).scope) as RoutineCandidate;
  }

  async readCandidate(candidateId: string): Promise<CandidateVersionRecord | null> {
    const [row] = await this.candidateRows([candidateId], "candidate", async ids =>
      this.db.select().from(civicDataCandidates).where(inArray(civicDataCandidates.id, [...ids])));
    return row ? { ...rowToCandidate(row), candidate: await this.loadPayload(row.candidate, (row.candidate as RoutineCandidate).scope) as RoutineCandidate } : null;
  }

  async readCandidateSummary(candidateId: string): Promise<CandidateVersionSummary | null> {
    const [row] = await candidateSummaryRead(this.db, candidateId);
    return row ? postgresCandidateSummary(row) : null;
  }

  async latestCandidate(sourceId: string, recordClass: RoutineRecordClass, scope: string): Promise<LatestCandidate | null> {
    const [row] = await this.db.select({ id: civicDataCandidates.id, state: civicDataCandidates.state, normalizedHash: civicDataCandidates.normalizedHash,
      parserVersion: civicDataCandidates.parserVersion, failureCode: civicDataCandidates.failureCode }).from(civicDataCandidates)
      .where(and(eq(civicDataCandidates.recordClass, recordClass), eq(civicDataCandidates.scope, scope), eq(civicDataCandidates.sourceId, sourceId)))
      .orderBy(desc(civicDataCandidates.retrievedAt)).limit(1);
    return row ? { ...row, state: row.state as CandidateState } : null;
  }

  async recordRecheck(candidateId: string, at: string, detail: string): Promise<CandidateEvent> {
    const [row] = await this.db.select({ id: civicDataCandidates.id, sourceId: civicDataCandidates.sourceId, recordClass: civicDataCandidates.recordClass,
      scope: civicDataCandidates.scope, state: civicDataCandidates.state }).from(civicDataCandidates).where(eq(civicDataCandidates.id, candidateId)).limit(1);
    if (!row) throw new Error(`CANDIDATE_NOT_FOUND:${candidateId}`);
    this.assertCandidateMutationAuthority({ ...row, recordClass: row.recordClass as RoutineRecordClass });
    const [, eventRows] = await this.db.batch([
      this.candidateEventLock(candidateId),
      this.db.insert(civicDataCandidateEvents).select(sql`
        select gen_random_uuid(), ${candidateId}, ${this.nextCandidateEventSequence(candidateId)}, ${row.state}, ${at}::timestamptz, ${detail}
        from ${civicDataCandidates} where ${civicDataCandidates.id} = ${candidateId} and ${civicDataCandidates.state} = ${row.state}
      `).returning(),
    ]);
    if (!eventRows[0]) throw new Error(`CANDIDATE_EVIDENCE_STATE_MISMATCH:${candidateId}:${row.state}`);
    return postgresCandidateEventRowToEvent(eventRows[0]);
  }

  async readStateRetirementBaseline(recordClass: RoutineRecordClass, scope: string) {
    if (!statePublicationScope(scope)) throw new Error("STATE_RETIREMENT_BASELINE_SCOPE_INVALID");
    const c = civicDataCandidates, e = civicDataCandidateEvents;
    const [row] = await this.db.select({ normalizedHash: c.normalizedHash,
      hashes: sql<unknown>`${c.candidate}#>'{normalization,stateRecordHashes}'`,
    }).from(c).innerJoin(e, and(eq(e.candidateId, c.id), eq(e.sequence, 1)))
      .where(and(eq(c.recordClass, recordClass), eq(c.scope, scope), eq(c.state, "PROMOTED"),
        sql`${c.validationReceipt}->>'decision'='GOOD'`, like(e.detail, "STATE_BUCKET_RESTORE_V1 %")))
      .orderBy(desc(e.at)).limit(1);
    if (!row) return null;
    const hashes = await this.loadPayload(row.hashes, scope) as RoutineCandidate["normalization"]["stateRecordHashes"];
    if (hashes?.readModelHash !== row.normalizedHash) throw new Error("STATE_RETIREMENT_BASELINE_HASH_MISMATCH");
    return hashes ?? null;
  }

  async readStateRetirementOrigin(recordClass: string, scope: string) {
    const p = civicDataPromotions, c = civicDataCandidates;
    const [row] = await this.db.select({ versionId: p.currentVersionId, lastKnownGoodVersionId: p.lastKnownGoodVersionId,
      sourceId: c.sourceId, recordClass: c.recordClass, scope: c.scope, normalizedHash: c.normalizedHash,
      promoted: sql<boolean>`${c.state}='PROMOTED' AND ${c.acquisitionSucceeded}=true
        AND ${c.promotedVersionId}=${c.id} AND ${c.lastKnownGoodVersionId}=${c.id} AND ${p.sourceId}=${c.sourceId}
        AND ${c.validationReceipt}->>'decision'='GOOD' AND ${p.validationReceipt}=${c.validationReceipt}`,
      sourceAuthenticity: sql<string | null>`(SELECT entry->>'code' FROM jsonb_array_elements(${c.validationReceipt}->'checks') entry
        WHERE entry->>'check'='SOURCE_AUTHENTICITY' AND entry->>'verdict'='PASS' LIMIT 1)`,
    }).from(p).innerJoin(c, eq(c.id, p.currentVersionId)).where(eq(p.key, `${recordClass}:${scope}`)).limit(1);
    return row ?? null;
  }

  async readStatePublicationBase(recordClass: RoutineRecordClass, scope: string): Promise<{ current: PromotedProjection | null; lkg: CandidateVersionRecord | null }> {
    if (!statePublicationScope(scope)) throw new Error(`STATE_PUBLICATION_SCOPE_INVALID:${scope}`);
    const prior = takeStatePublicationPrior(this, recordClass, scope);
    const column = civicDataCandidates.candidate;
    const candidateColumns = prior ? { ...getTableColumns(civicDataCandidates),
      identity: sql<unknown>`'[]'::jsonb`,
      validationReceipt: sql<unknown>`null::jsonb`,
      candidate: sql<unknown>`jsonb_build_object(
        'id', ${column}->'id', 'sourceId', ${column}->'sourceId', 'recordClass', ${column}->'recordClass',
        'scope', ${column}->'scope', 'normalization', (${column}->'normalization') - 'stateRecordHashes', 'temporal', ${column}->'temporal',
        'retrieval', (${column}->'retrieval') - 'derived', 'readModel', ${column}->'readModel')`,
    } : getTableColumns(civicDataCandidates);
    const [row] = await this.db.select({ promotion: civicDataPromotions, candidate: candidateColumns,
      ...(prior ? { receiptsCoupled: sql<boolean>`${civicDataPromotions.validationReceipt} = ${civicDataCandidates.validationReceipt}` } : {}) })
      .from(civicDataPromotions).leftJoin(civicDataCandidates, eq(civicDataCandidates.id, civicDataPromotions.lastKnownGoodVersionId))
      .where(eq(civicDataPromotions.key, projectionKey(recordClass, scope))).limit(1);
    if (!row) return { current: null, lkg: null };
    if (!row.candidate) return { current: { ...postgresPromotionRowToProjection(row.promotion), payload: null }, lkg: null };
    if (prior && row.receiptsCoupled !== true) throw new Error(`STATE_PUBLICATION_POINTER_RECEIPT_MISMATCH:${row.promotion.key}`);
    const candidateRow = prior ? { ...row.candidate, validationReceipt: row.promotion.validationReceipt } : row.candidate;
    const encoded = candidateRow.candidate as RoutineCandidate;
    const encodedHash = durableStateHash(row.promotion.payload);
    if (encodedHash !== durableStateHash(encoded.readModel))
      throw new Error(`STATE_PUBLICATION_POINTER_PAYLOAD_MISMATCH:${row.promotion.key}`);
    const indexed = prior?.versionId === row.promotion.currentVersionId && prior.payloadHash === candidateRow.normalizedHash;
    if (prior && !indexed) throw new Error(`STATE_PUBLICATION_BASE_CHANGED:${row.promotion.key}`);
    const metadata = { id: encoded.id, sourceId: encoded.sourceId, recordClass: encoded.recordClass, scope: encoded.scope,
      normalization: encoded.normalization, temporal: encoded.temporal, readModel: null, normalizedPayload: null, civicRecords: [], identities: [],
      excludedFacts: (candidateRow.validationReceipt as ValidationReceipt | null)?.excludedFacts ?? [],
      retrieval: { ...encoded.retrieval, derived: undefined } };
    const loaded = await this.loadPayload(prior ? metadata : encoded, scope) as RoutineCandidate;
    const candidate = indexed ? { ...loaded, normalization: { ...loaded.normalization, stateRecordHashes: prior.recordHashes } } : loaded;
    if (indexed) bindStatePublicationPrior(candidate, prior);
    const current = { ...postgresPromotionRowToProjection(row.promotion), payload: candidate.readModel };
    return { current, lkg: { ...rowToCandidate(candidateRow), candidate } };
  }

  async readPromotion<T = unknown>(recordClass: RoutineRecordClass, scope: string): Promise<PromotedProjection<T> | null> {
    if (statePublicationScope(scope)) return this.readStatePromotion<T>(recordClass, scope);
    const [row] = await this.promotionRows(recordClass, [scope]);
    if (!row) return null;
    const projection = { ...postgresPromotionRowToProjection<T>(row), payload: await this.loadPayload(row.payload, row.scope) as T };
    return projection;
  }

  async readPromotions<T = unknown>(
    recordClass: RoutineRecordClass,
    scopes: readonly string[],
  ): Promise<readonly PromotedProjection<T>[]> {
    if (scopes.length === 0) return [];
    const rows = await this.promotionRows(recordClass, scopes);
    return Promise.all(rows.map(async row => ({ ...postgresPromotionRowToProjection<T>(row), payload: await this.loadPayload(row.payload, row.scope) as T })));
  }

  async listPromotionScopes(recordClasses: readonly RoutineRecordClass[]) {
    const rows = await this.db.select({ recordClass: civicDataPromotions.recordClass, scope: civicDataPromotions.scope })
      .from(civicDataPromotions).where(inArray(civicDataPromotions.recordClass, [...recordClasses]));
    return rows as { recordClass: RoutineRecordClass; scope: string }[];
  }

  async readPromotionIdentity(recordClass: RoutineRecordClass, scope: string): Promise<PromotedPointerIdentity | null> {
    // (record_class, scope) is unique, so this names at most one pointer.
    const [identity] = await this.readPromotionIdentities(recordClass, [scope]);
    return identity ?? null;
  }

  async readPromotionIdentities(
    recordClass: RoutineRecordClass,
    scopes: readonly string[],
  ): Promise<readonly PromotedPointerIdentity[]> {
    if (scopes.length === 0) return [];
    const values = async (keys: readonly string[]) => promotedPointerIdentityRead(this.db, recordClass, keys.map(key => key.slice(recordClass.length + 1)));
    const keys = scopes.map(scope => projectionKey(recordClass, scope));
    const rows = this.readCache ? await this.readCache.rows({ namespace: "promotion-identity", keys, values, keyOf: row => row.key,
      versions: async selected => this.db.select({ key: civicDataPromotions.key,
        etag: sql<string>`concat(${civicDataPromotions}.xmin::text, '/', ${civicDataPromotions}.ctid::text, '/', coalesce(${latestConfirmationSequence()}, 0))`,
      }).from(civicDataPromotions).where(and(eq(civicDataPromotions.recordClass, recordClass), inArray(civicDataPromotions.key, [...selected]))),
    }) : await values(keys);
    return rows.map(postgresPromotedPointerIdentity);
  }

  async readPreparedReaderProjection(recordClass: RoutineRecordClass, scope: string): Promise<PreparedReaderProjectionRow | null> {
    const selected = currentReaderSelection();
    const columns = { ...getTableColumns(civicDataReaderProjections), ...(selected ? {
      payload: sql<unknown>`reader_place_payload(${civicDataReaderProjections.payload}, ${sql.param([...selected.keys])}::text[], ${sql.param(selected.point ? JSON.stringify(selected.point) : null)}::jsonb)`,
    } : {}) };
    const [row] = await this.db.select(columns).from(civicDataReaderProjections).where(and(
      eq(civicDataReaderProjections.recordClass, recordClass),
      eq(civicDataReaderProjections.scope, scope),
    )).limit(1);
    return row ? preparedRowToProjection(row) : null;
  }

  async readPreparedReaderProjectionCoupling(recordClass: RoutineRecordClass, scope: string): Promise<PreparedReaderProjectionCoupling | null> {
    const [row] = await preparedProjectionCouplingRead(this.db, recordClass, scope);
    return row
      ? {
          recordClass: row.recordClass as RoutineRecordClass,
          scope: row.scope,
          sequence: row.sequence,
          composedFrom: row.composedFrom as readonly PreparedProjectionCoupling[],
          generatedAt: row.generatedAt,
        }
      : null;
  }

  async writePreparedReaderProjection(
    input: PreparedReaderProjectionInput,
    expectedSequence: number | null,
  ): Promise<{ readonly published: boolean; readonly sequence: number }> {
    this.assertMutationAuthority();
    const key = projectionKey(input.recordClass, input.scope);
    const body = {
      key,
      recordClass: input.recordClass,
      scope: input.scope,
      payload: input.payload,
      composedFrom: input.composedFrom,
      factSha256: input.factSha256,
      generatedAt: input.generatedAt,
      composedAt: input.composedAt,
      sourceThrough: input.sourceThrough,
      retrievedAt: input.retrievedAt,
      promotedThrough: input.promotedThrough,
    };
    if (expectedSequence === null) {
      const inserted = await this.db.insert(civicDataReaderProjections)
        .values({ ...body, sequence: 1 })
        .onConflictDoNothing()
        .returning({ sequence: civicDataReaderProjections.sequence });
      if (inserted.length > 0) return { published: true, sequence: 1 };
    } else {
      // Monotonic CAS: advance only if the row is still at the read sequence.
      const nextSequence = expectedSequence + 1;
      const updated = await this.db.update(civicDataReaderProjections)
        .set({ ...body, sequence: nextSequence })
        .where(and(
          eq(civicDataReaderProjections.key, key),
          eq(civicDataReaderProjections.sequence, expectedSequence),
        ))
        .returning({ sequence: civicDataReaderProjections.sequence });
      if (updated.length > 0) return { published: true, sequence: nextSequence };
    }
    const [cur] = await this.db.select({ sequence: civicDataReaderProjections.sequence })
      .from(civicDataReaderProjections)
      .where(eq(civicDataReaderProjections.key, key))
      .limit(1);
    return { published: false, sequence: cur?.sequence ?? 0 };
  }

  async readCandidates(candidateIds: readonly string[]): Promise<readonly CandidateVersionReadback[]> {
    if (candidateIds.length === 0) return [];
    const rows = await this.candidateRows(candidateIds, "candidate", async ids =>
      this.db.select().from(civicDataCandidates).where(inArray(civicDataCandidates.id, [...ids])));
    return Promise.all(rows.map(async row => ({ candidateId: row.id, record: { ...rowToCandidate(row), candidate: await this.loadPayload(row.candidate, (row.candidate as RoutineCandidate).scope) as RoutineCandidate } })));
  }

  async readPublishedCandidateMetadata(candidateId: string): Promise<PublishedCandidateMetadata | null> {
    const held = this.stateReadMetadata;
    this.stateReadMetadata = null;
    if (held?.candidate.id === candidateId) return held;
    const column = civicDataCandidates.candidate;
    const [row] = await this.candidateRows([candidateId], "published-candidate-metadata", async ids => this.db.select({
      id: civicDataCandidates.id,
      candidate: sql<PublishedCandidateMetadata["candidate"]>`jsonb_build_object(
        'id', ${column}->'id', 'sourceId', ${column}->'sourceId', 'recordClass', ${column}->'recordClass',
        'scope', ${column}->'scope', 'retrieval', (${column}->'retrieval') - 'derived', 'temporal', ${column}->'temporal',
        'normalization', case when ${column}->'normalization' ? '$civicPayloadPart' then ${column}->'normalization'
          else jsonb_build_object('succeeded', ${column}->'normalization'->'succeeded',
            'normalizedHash', ${column}->'normalization'->'normalizedHash',
            'normalizedPayloadHash', ${column}->'normalization'->'normalizedPayloadHash',
            'stateRecordHashes', ${column}->'normalization'->'stateRecordHashes') end)`,
      state: civicDataCandidates.state,
      acquisitionSucceeded: civicDataCandidates.acquisitionSucceeded,
      receipt: civicDataCandidates.validationReceipt,
      promotedVersion: civicDataCandidates.promotedVersionId,
      lastKnownGoodVersion: civicDataCandidates.lastKnownGoodVersionId,
      failureCode: civicDataCandidates.failureCode,
      failureDetail: civicDataCandidates.failureDetail,
    }).from(civicDataCandidates).where(inArray(civicDataCandidates.id, [...ids])));
    return row ? { candidate: await this.loadPayload(row.candidate, (row.candidate as RoutineCandidate).scope) as PublishedCandidateMetadata["candidate"],
      state: row.state as CandidateState, acquisitionSucceeded: row.acquisitionSucceeded,
      receipt: row.receipt as ValidationReceipt | null, promotedVersion: row.promotedVersion,
      lastKnownGoodVersion: row.lastKnownGoodVersion, failureCode: row.failureCode, failureDetail: row.failureDetail } : null;
  }

  async readCandidateProof(candidateId: string): Promise<CandidateVersionRecord | null> {
    const [row] = await this.candidateRows([candidateId], "candidate-proof", async ids => candidateProofRead(this.db, ids));
    return row ? { ...candidateProofRowToRecord(row), candidate: await this.loadPayload(row.candidate, (row.candidate as RoutineCandidate).scope) as RoutineCandidate } : null;
  }

  async readCandidateProofs(candidateIds: readonly string[]): Promise<readonly CandidateVersionReadback[]> {
    if (candidateIds.length === 0) return [];
    const rows = await this.candidateRows(candidateIds, "candidate-proof", async ids => candidateProofRead(this.db, ids));
    return Promise.all(rows.map(async row => ({ candidateId: row.id, record: { ...candidateProofRowToRecord(row), candidate: await this.loadPayload(row.candidate, (row.candidate as RoutineCandidate).scope) as RoutineCandidate } })));
  }

  async appendEvidence(candidateId: string, state: CandidateState, at: string, detail: string): Promise<CandidateEvent> {
    const authority = this.assertMutationAuthority();
    const [candidateRow] = await readerEvidenceCandidateRead(this.db, candidateId);
    if (!candidateRow) throw new Error(`CANDIDATE_NOT_FOUND:${candidateId}`);
    const record = readerEvidenceRowToRecord(candidateRow);
    this.assertCandidateMutationAuthority(record.candidate, "reader-evidence");
    assertReaderEvidenceInput(record, state, at, detail, authority);
    const nextSequence = this.nextCandidateEventSequence(candidateId);
    const [, eventRows] = await this.db.batch([
      this.candidateEventLock(candidateId),
      this.db.insert(civicDataCandidateEvents).select(sql`
        select gen_random_uuid(), ${candidateId}, ${nextSequence}, ${state}, ${at}::timestamptz, ${detail}
        from ${civicDataCandidates}
        where ${civicDataCandidates.id} = ${candidateId}
          and ${civicDataCandidates.state} = ${state}
          and exists (
            select 1 from ${civicDataPromotions}
            where ${civicDataPromotions.recordClass} = ${civicDataCandidates.recordClass}
              and ${civicDataPromotions.scope} = ${civicDataCandidates.scope}
              and ${civicDataPromotions.sourceId} = ${civicDataCandidates.sourceId}
              and ${civicDataPromotions.currentVersionId} = ${candidateId}
              and ${civicDataPromotions.lastKnownGoodVersionId} = ${candidateId}
          )
      `).returning(),
    ]);
    const event = eventRows[0];
    if (!event) {
      const [prior] = await this.db.select({ state: civicDataCandidates.state })
        .from(civicDataCandidates)
        .where(eq(civicDataCandidates.id, candidateId))
        .limit(1);
      if (!prior) throw new Error(`CANDIDATE_NOT_FOUND:${candidateId}`);
      if (prior.state === state) {
        throw new Error(`CANDIDATE_READER_EVIDENCE_INVALID:${candidateId}`);
      }
      throw new Error(`CANDIDATE_EVIDENCE_STATE_MISMATCH:${candidateId}:${prior.state}:${state}`);
    }
    return postgresCandidateEventRowToEvent(event);
  }

  async confirmUnchanged(input: ConfirmUnchangedInput, at: string): Promise<ConfirmUnchangedOutcome> {
    const key = projectionKey(input.recordClass, input.scope);
    const built = buildUnchangedConfirmation(input, key, at);
    if (!built.ok) return { kind: "EVIDENCE_INVALID", detail: built.detail };
    const id = input.pointerVersionId;
    this.assertCandidateMutationAuthority({ id, sourceId: input.sourceId, recordClass: input.recordClass, scope: input.scope });
    const detail = serializeUnchangedConfirmation(built.confirmation);
    const nextSequence = this.nextCandidateEventSequence(id);
    const checkedAt = sourceCheckedAt(built.confirmation.retrieval, built.confirmation.observedAt)!;
    // This receipt shares the existing candidate lock. A delayed parser replay cannot replace a newer real check.
    const priorCheckedAt = sql`case when left(prior_confirmation.detail, ${UNCHANGED_CONFIRMATION_PREFIX.length}) = ${UNCHANGED_CONFIRMATION_PREFIX}
      then coalesce(
        (substring(prior_confirmation.detail from ${UNCHANGED_CONFIRMATION_PREFIX.length + 1})::jsonb #>> '{retrieval,sourceCheck,checkedAt}')::timestamptz,
        (substring(prior_confirmation.detail from ${UNCHANGED_CONFIRMATION_PREFIX.length + 1})::jsonb ->> 'observedAt')::timestamptz
      ) end`;
    let eventRows: readonly { readonly sequence: number }[];
    try {
    [, eventRows] = await this.db.batch([
      this.candidateEventLock(id),
      this.db.insert(civicDataCandidateEvents).select(sql`
        select gen_random_uuid(), ${id}, ${nextSequence}, ${"PROMOTED"}, ${at}::timestamptz, ${detail}
        from ${civicDataCandidates}
        where ${civicDataCandidates.id} = ${id}
          and ${civicDataCandidates.state} = ${"PROMOTED"}
          and ${civicDataCandidates.sourceId} = ${input.sourceId}
          and ${civicDataCandidates.recordClass} = ${input.recordClass}
          and ${civicDataCandidates.scope} = ${input.scope}
          and ${civicDataCandidates.normalizedHash} = ${input.readModelHash}
          and not (${civicDataCandidates.candidate} ? 'bootstrapImport')
          and exists (
            select 1 from ${civicDataPromotions}
            where ${civicDataPromotions.recordClass} = ${civicDataCandidates.recordClass}
              and ${civicDataPromotions.scope} = ${civicDataCandidates.scope}
              and ${civicDataPromotions.sourceId} = ${civicDataCandidates.sourceId}
              and ${civicDataPromotions.currentVersionId} = ${id}
              and ${civicDataPromotions.lastKnownGoodVersionId} = ${id}
          )
          and not exists (
            select 1 from ${civicDataCandidateEvents}
            where ${civicDataCandidateEvents.candidateId} = ${id}
              and ${civicDataCandidateEvents.at} > ${at}::timestamptz
          )
          and not exists (
            select 1 from civic_data_candidate_events as prior_confirmation
            where prior_confirmation.candidate_id = ${id}
              and ${priorCheckedAt} > ${checkedAt}::timestamptz
          )
      `).returning({ sequence: civicDataCandidateEvents.sequence }),
      ...(input.retainedSourceResponses?.length
        ? [this.db.insert(civicDataCandidateEvents).select(sql`
            select gen_random_uuid(), ${id}, ${this.nextCandidateEventSequence(id)}, ${"PROMOTED"}, ${at}::timestamptz,
              ${serializeUnchangedConfirmationSources(built.confirmation, input.retainedSourceResponses)}
            where exists (
              select 1 from ${civicDataCandidateEvents}
              where ${civicDataCandidateEvents.candidateId} = ${id}
                and ${civicDataCandidateEvents.detail} = ${detail}
            )
          `)]
        : []),
    ]);
    } catch (error) {
            // Until the event rule's migration is applied, a refusal here is a no-confirmation and the caller promotes.
      if (unchangedConfirmationRefusedByEventRule(error)) {
        return { kind: "STORE_REFUSED", detail: "The database's event rule does not admit unchanged confirmations yet." };
      }
      throw error;
    }
    if (eventRows[0]) return { kind: "CONFIRMED", versionId: id, at };
    const [pointerRows, candidateRows] = await this.db.batch([
      this.db.select({
        sourceId: civicDataPromotions.sourceId,
        currentVersionId: civicDataPromotions.currentVersionId,
        lastKnownGoodVersionId: civicDataPromotions.lastKnownGoodVersionId,
        latestConfirmation: latestConfirmationDetail(),
      }).from(civicDataPromotions)
        .where(and(eq(civicDataPromotions.recordClass, input.recordClass), eq(civicDataPromotions.scope, input.scope)))
        .limit(1),
      this.db.select({
        state: civicDataCandidates.state,
        normalizedHash: civicDataCandidates.normalizedHash,
        imported: sql<boolean>`${civicDataCandidates.candidate} ? 'bootstrapImport'`,
      }).from(civicDataCandidates).where(eq(civicDataCandidates.id, id)).limit(1),
    ]);
    const pointer = pointerRows[0];
    const candidate = candidateRows[0];
    if (
      !pointer || !candidate || candidate.state !== "PROMOTED" ||
      pointer.sourceId !== input.sourceId || pointer.currentVersionId !== id || pointer.lastKnownGoodVersionId !== id
    ) {
      return { kind: "POINTER_MOVED", detail: `The pointer ${key} no longer names ${id}.` };
    }
    if (candidate.imported) return { kind: "POINTER_IS_IMPORT", detail: `${id} is a trusted-LKG import; a live read of it promotes.` };
    if (candidate.normalizedHash !== input.readModelHash) return { kind: "HASH_DIFFERS", detail: `${id}'s read model is not ${input.readModelHash}.` };
    const priorConfirmation = pointer.latestConfirmation ? parseUnchangedConfirmation(pointer.latestConfirmation) : null;
    if (priorConfirmation?.versionId === id && Date.parse(sourceCheckedAt(priorConfirmation.retrieval, priorConfirmation.observedAt) ?? "") > Date.parse(checkedAt)) {
      return { kind: "CONFIRMED", versionId: id, at: priorConfirmation.observedAt };
    }
    throw new Error(`CANDIDATE_EVENT_TIME_INVALID:${id}:PROMOTED`);
  }

  async promote(candidateId: string, receipt: ValidationReceipt, at: string, options: CandidateTransitionOptions = {}): Promise<PromotedProjection> {
    this.assertMutationAuthority();
    const held = options.candidate;
    let record: CandidateVersionRecord | null;
    if (held && statePublicationScope(held.scope)) {
      const [row] = await this.db.select({ ...CANDIDATE_SUMMARY_COLUMNS,
        retrievedAt: civicDataCandidates.retrievedAt, rawHash: civicDataCandidates.rawHash, normalizedHash: civicDataCandidates.normalizedHash,
        normalizedPayloadHash: sql<string | null>`${civicDataCandidates.candidate}#>>'{normalization,normalizedPayloadHash}'`,
      }).from(civicDataCandidates).where(eq(civicDataCandidates.id, candidateId)).limit(1);
      if (!row || !heldEnvelopeMatches(row, held) || durableStateHash(held.readModel) !== row.normalizedHash ||
          held.normalization.normalizedPayloadHash !== row.normalizedPayloadHash || durableStateHash(held.normalizedPayload) !== row.normalizedPayloadHash) throw new Error(`CANDIDATE_PROMOTION_ENVELOPE_MISMATCH:${candidateId}`);
      record = { ...postgresCandidateSummary(row), candidate: held };
    } else {
      const [row] = await this.db.select().from(civicDataCandidates).where(eq(civicDataCandidates.id, candidateId)).limit(1);
      record = row ? { ...rowToCandidate(row), candidate: await this.loadPayload(row.candidate, (row.candidate as RoutineCandidate).scope) as RoutineCandidate } : null;
    }
    const persistedReceipt = persistedPromotionReceipt(record, receipt);
    if (!record || !persistedReceipt) throw new Error(`CANDIDATE_NOT_PROMOTABLE:${candidateId}`);
    assertPromotionTime(record, persistedReceipt, at);
    this.assertCandidateMutationAuthority(record.candidate);
    const candidate = record.candidate;
    const key = projectionKey(candidate.recordClass, candidate.scope);
    const [prior] = await this.db.select({ currentVersionId: civicDataPromotions.currentVersionId })
      .from(civicDataPromotions)
      .where(eq(civicDataPromotions.key, key))
      .limit(1);
    const expectedVersionId = record.lastKnownGoodVersion;
    const receiptJson = JSON.stringify(persistedReceipt);
    const eligibility = sql`
      ${civicDataCandidates.id} = ${candidateId}
      and ${civicDataCandidates.state} = 'VALIDATED'
      and ${civicDataCandidates.sourceId} = ${candidate.sourceId}
      and ${civicDataCandidates.recordClass} = ${candidate.recordClass}
      and ${civicDataCandidates.scope} = ${candidate.scope}
      and ${civicDataCandidates.validationReceipt} = ${receiptJson}::jsonb
    `;
    const detail = `${POINTER_MOVE_DETAIL_PREFIX}${key} moved from ${prior?.currentVersionId ?? "bootstrap/no-version"} to ${candidateId}.`;
    const nextSequence = this.nextCandidateEventSequence(candidateId);

        /* One server-side transaction: a concurrent transition makes every statement a zero-row write. */
    const promotionWrite = this.db.insert(civicDataPromotions).select(sql`
      select
        ${key},
        ${civicDataCandidates.sourceId},
        ${civicDataCandidates.recordClass},
        ${civicDataCandidates.scope},
        ${civicDataCandidates.id},
        ${civicDataCandidates.id},
        ${at}::timestamptz,
        ${civicDataCandidates.candidate}->'readModel',
        ${civicDataCandidates.validationReceipt}
      from ${civicDataCandidates}
      where ${eligibility}
    `).onConflictDoUpdate({
        target: civicDataPromotions.key,
        set: {
          sourceId: sql`excluded.source_id`,
          recordClass: sql`excluded.record_class`,
          scope: sql`excluded.scope`,
          currentVersionId: sql`excluded.current_version_id`,
          lastKnownGoodVersionId: sql`excluded.last_known_good_version_id`,
          promotedAt: sql`excluded.promoted_at`,
          payload: sql`excluded.payload`,
          validationReceipt: sql`excluded.validation_receipt`,
        },
        // A candidate may replace only the exact pointer it used as LKG while
        // validating. A first seed expects there to be no pointer at all.
        setWhere: expectedVersionId === null
          ? sql`false`
          : eq(civicDataPromotions.currentVersionId, expectedVersionId),
      }).returning(PROMOTED_POINTER_COLUMNS);
    const pointerOwnsCandidate = sql`exists (
      select 1 from ${civicDataPromotions}
      where ${civicDataPromotions.key} = ${key}
        and ${civicDataPromotions.currentVersionId} = ${candidateId}
        and ${civicDataPromotions.lastKnownGoodVersionId} = ${candidateId}
    )`;
    const eventWrite = this.db.insert(civicDataCandidateEvents).select(sql`
      select gen_random_uuid(), ${candidateId}, ${nextSequence}, 'PROMOTED', ${at}::timestamptz, ${detail}
      from ${civicDataCandidates}
      where ${eligibility} and ${pointerOwnsCandidate}
    `);
    const candidateWrite = this.db.update(civicDataCandidates).set({
      state: "PROMOTED",
      validationReceipt: persistedReceipt,
      promotedVersionId: candidateId,
      lastKnownGoodVersionId: candidateId,
    }).where(sql`${eligibility} and ${pointerOwnsCandidate}`).returning({ candidateId: civicDataCandidates.id });
    const [, promotedRows, , updatedRows] = await this.db.batch([
      this.candidateEventLock(candidateId),
      promotionWrite,
      eventWrite,
      candidateWrite,
    ]);
    if (!promotedRows[0] || !updatedRows[0]) {
      const [actual] = await this.db.select({ versionId: civicDataPromotions.currentVersionId })
        .from(civicDataPromotions)
        .where(eq(civicDataPromotions.key, key))
        .limit(1);
      if ((actual?.versionId ?? null) !== expectedVersionId) {
        throw new PromotionBaseChangedError(candidateId, expectedVersionId, actual?.versionId ?? null);
      }
      throw new Error(`CANDIDATE_NOT_PROMOTABLE:${candidateId}`);
    }
    return {
      ...postgresPromotedPointerIdentity(promotedRows[0]),
      payload: candidate.readModel,
      receipt: promotedRows[0].validationReceipt as ValidationReceipt,
    };
  }

  async events(candidateId: string): Promise<readonly CandidateEvent[]> {
    const rows = await this.db.select().from(civicDataCandidateEvents).where(eq(civicDataCandidateEvents.candidateId, candidateId));
    return rows.sort((a, b) => a.sequence - b.sequence).map(postgresCandidateEventRowToEvent);
  }

  async latestReaderReadbacks(candidateIds: readonly string[]): Promise<readonly CandidateEvent[]> {
    if (candidateIds.length === 0) return [];
    const rows = await latestReaderReadbacksRead(this.db, candidateIds);
    return rows.map(postgresCandidateEventRowToEvent);
  }

  async pointerMoveEvents(candidateId: string): Promise<readonly CandidateEvent[]> {
    const rows = await pointerMoveEventsRead(this.db, candidateId);
    return rows.map(postgresCandidateEventRowToEvent);
  }

  /** Every input to a clock is a candidate row or event of its record class and scope, or that scope's pointer, so their versions decide a held clock's use. */
  async clock(sourceId: string, recordClass: RoutineRecordClass, scope: string, parserVersion?: string): Promise<RoutineStoreClock> {
    const key = [sourceId, recordClass, scope, parserVersion ?? ""].join("\u0000");
    if (!this.readCache) return this.readClock(sourceId, recordClass, scope, parserVersion);
    const [held] = await this.readCache.rows({ namespace: "routine-clock", keys: [key], keyOf: row => row.key,
      values: async () => [{ key, clock: await this.readClock(sourceId, recordClass, scope, parserVersion) }],
      versions: async () => (await this.db.execute(sql`select concat(
          (select concat(count(*), '/', max(e.at)::text, '/', max(c.xmin::text::bigint)) from ${civicDataCandidates} c
            join ${civicDataCandidateEvents} e on e.candidate_id = c.id where c.record_class = ${recordClass} and c.scope = ${scope}),
          '/', (select concat(p.xmin::text, '/', p.ctid::text) from ${civicDataPromotions} p where p.record_class = ${recordClass} and p.scope = ${scope})
        ) as etag`)).rows.map(row => ({ key, etag: String((row as { etag: unknown }).etag) })),
    });
    return held!.clock;
  }

  private async readClock(sourceId: string, recordClass: RoutineRecordClass, scope: string, parserVersion?: string): Promise<RoutineStoreClock> {
    // Successful retained-byte replay records processing, but no newer provider attempt.
    // These fields occur only on validated promotions; failures keep their local retry clock.
    const attemptAt = sql`CASE WHEN ${civicDataCandidates.state} = 'PROMOTED'
      AND ${civicDataCandidates.acquisitionSucceeded} = true
      AND ${civicDataCandidates.candidate}#>>'{retrieval,sourceCheck,checkedAt}' IS NOT NULL
      THEN LEAST((${civicDataCandidates.candidate}#>>'{retrieval,sourceCheck,checkedAt}')::timestamptz, ${civicDataCandidateEvents.at})
      ELSE ${civicDataCandidateEvents.at} END`;
    const attemptQuery = this.db
      .select({ attemptedAt: attemptAt })
      .from(civicDataCandidates)
      .innerJoin(civicDataCandidateEvents, and(
        eq(civicDataCandidateEvents.candidateId, civicDataCandidates.id),
        eq(civicDataCandidateEvents.sequence, 1),
      ))
      .where(and(
        eq(civicDataCandidates.sourceId, sourceId),
        eq(civicDataCandidates.recordClass, recordClass),
        eq(civicDataCandidates.scope, scope),
        parserVersion === undefined ? undefined : eq(civicDataCandidates.parserVersion, parserVersion),
                // A frozen cutover import is not a publisher attempt, so the contract is due at once for its first live read.
        sql`coalesce(${civicDataCandidates.candidate}#>>'{bootstrapImport,kind}', '') not in ('TRUSTED_LKG_IMPORT', 'TRUSTED_LKG_REATTESTATION')`,
      ))
      .orderBy(desc(attemptAt))
      .limit(1);
    const pointerQuery = routineClockPointerRead(this.db, recordClass, scope);
    const observedQuery = routineClockPointedObservedRead(this.db, recordClass, scope);
    const confirmationQuery = routineClockConfirmationRead(this.db, recordClass, scope);
    const [rows, pointerRows, observedRows, confirmationRows, sittingRows] = recordClass === "MEETING"
      ? await this.db.batch([attemptQuery, pointerQuery, observedQuery, confirmationQuery, sittingStartsRead(this.db, scope)])
      : [...await this.db.batch([attemptQuery, pointerQuery, observedQuery, confirmationQuery]), null] as const;
    // The first event is the store-observed attempt clock. A refused
    // candidate's claimed retrievedAt is evidence, never scheduler authority.
    const lastAttemptedAt = rows[0]?.attemptedAt === undefined
      ? undefined
      : canonicalPostgresRoutineTimestamp(rows[0].attemptedAt, "clock.lastAttemptedAt");
    const pointer = pointerRows[0];
    const [pointedRow] = pointer && pointer.sourceId === sourceId
      ? await routineClockCandidateRead(this.db, pointer.currentVersionId)
      : [];
    const pointedRecord = pointedRow ? routineClockRowToRecord(pointedRow) : null;
    const sittings = pointer && sittingRows !== null
      ? { sittingStarts: sittingStartsFromRow(sittingRows[0]?.starts) }
      : {};
    if (pointer && pointedRecord && isTrustedLkgImportCandidate(pointedRecord.candidate)) {
      return {
        ...trustedLkgImportClock(
          lastAttemptedAt,
          canonicalPostgresRoutineTimestamp(pointer.promotedAt, "clock.importPromotedAt"),
        ),
        ...sittings,
      };
    }
    const pointerProof: PromotionPointerProof | null = pointer ? {
      sourceId: pointer.sourceId,
      recordClass: pointer.recordClass as RoutineRecordClass,
      scope: pointer.scope,
      versionId: pointer.currentVersionId,
      lastKnownGoodVersionId: pointer.lastKnownGoodVersionId,
      receipt: pointer.validationReceipt as ValidationReceipt,
    } : null;
    const lastSucceededAt = proofConsistentSuccess(pointedRecord, pointerProof);
    const canonicalLastSucceededAt = lastSucceededAt === undefined
      ? undefined
      : canonicalPostgresRoutineTimestamp(lastSucceededAt, "clock.lastSucceededAt");
    const observed = observedRows[0]?.observedAt;
    const lastSucceededObservedAt = proofConsistentObservedSuccess(
      pointedRecord,
      pointerProof,
      observed === undefined ? undefined : canonicalPostgresRoutineTimestamp(observed, "clock.lastSucceededObservedAt"),
    );
    const confirmationRow = confirmationRows[0];
    const confirmation = pointer && confirmationRow ? parseUnchangedConfirmation(confirmationRow.detail) : null;
    return confirmedClock({
      lastAttemptedAt,
      lastSucceededAt: canonicalLastSucceededAt,
      lastSucceededObservedAt,
      ...(recordClass === "FEDERAL_MONEY" && scope === `${sourceId}:US` && pointer?.sourceId === sourceId
        ? { continuationPending: pointer.continuationPending === true } : {}),
      ...(parserVersion !== undefined && proofConsistentPointedSuccess(pointedRecord, pointerProof)
        ? { lastSucceededParserVersion: pointedRecord.candidate.normalization.parserVersion } : {}),
    }, confirmation !== null && pointer !== undefined && confirmation.versionId === pointer.currentVersionId ? confirmation : null, sittings, parserVersion);
  }
}


export type RegistryDivisionMatch = Pick<Division, "ocdId" | "label" | "state" | "sourceDataset">;
const registryDivisionLabel = (label: string) => label.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function registryDivisionMatches(payload: unknown, state: string, labels: readonly string[]): readonly RegistryDivisionMatch[] {
  const wanted = new Set(labels.map(registryDivisionLabel)), jurisdiction = requireRegistryState(state);
  return ((payload as { registry?: { divisions?: readonly RegistryDivisionMatch[] } } | null)?.registry?.divisions ?? [])
    .filter(row => row.state.toUpperCase() === jurisdiction && wanted.has(registryDivisionLabel(row.label)))
    .map(({ ocdId, label, state, sourceDataset }) => ({ ocdId, label, state, sourceDataset }));
}
