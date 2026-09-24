import { createHash } from "node:crypto";

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "../db/index.ts";
import { civicDataCandidateEvents, civicDataCandidates, civicDataPromotions, civicDataReaderProjections } from "../db/schema.ts";
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
import { parseValidationReceipt } from "./receipt.ts";
import {
  isTrustedLkgImportCandidate,
} from "./trusted-lkg-import.ts";
import { assertWriteAllowed } from "../db/write-guard.ts";
import { ROUTINE_SOURCE_CONTRACTS } from "./contracts.ts";
import { MEETING_PARTITION_CONTRACTS } from "./meeting-partitions.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "./manual-contracts.ts";
import {
  assertSanctionedRuntimeAuthority,
  runtimeAuthorityEnvelope,
  RuntimeAuthorityRefused,
  type RuntimeAuthorityEnvelope,
} from "./runtime-authority.ts";
import { CIVIC_DATA_PROMOTION_OPERATION } from "./production-write.ts";
import {
  parseReaderProjectionReadback,
  sourceScopedReaderReadbackProjectionId,
} from "./reader-readback.ts";
import { canonicalAgendaDocument, type AgendaDocument } from "../meetings/agenda-documents.ts";

export function projectionKey(recordClass: RoutineRecordClass, scope: string): string {
  return `${recordClass}:${scope}`;
}

/**
 * A candidate row's own columns: identity, disposition, receipt and version
 * pointers. Never the envelope (normalized payload, read model, change set) or
 * the identity set, which carry the dataset: 23.7 MB on the wire for NJ roll
 * calls on 2026-09-23. The identity columns equal the envelope's by CHECK
 * (`civic_data_candidates_envelope_identity_coherent`).
 */
export type CandidateVersionSummary = Omit<CandidateVersionRecord, "candidate"> & {
  readonly candidate: Pick<RoutineCandidate, "id" | "sourceId" | "recordClass" | "scope">;
};

/** Preserve the SQL row identity even when its untrusted JSON body is corrupt. */
export interface CandidateVersionReadback {
  readonly candidateId: string;
  readonly record: CandidateVersionRecord;
}

/** One coupled partition version the prepared reader snapshot was composed from. */
export interface PreparedProjectionCoupling {
  readonly contractId: string;
  readonly versionId: string;
}

/**
 * A derived reader-serving projection row — a pure function of the partitions it
 * names in `composedFrom`, written by the standing runner and read once by the
 * reader. A SERVING COPY, never authoritative civic truth.
 */
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

/** A prepared projection row without its payload (the composed snapshot, 7.5 MB on 2026-09-23). */
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

export interface RoutineDataStore {
  readonly create: (record: CandidateVersionRecord, firstEvent: CandidateEvent) => Promise<void>;
  readonly transition: (
    candidateId: string,
    state: CandidateState,
    at: string,
    detail: string,
    receipt?: ValidationReceipt,
    failure?: { code: string; detail: string },
  ) => Promise<CandidateVersionRecord>;
  readonly readCandidate: (candidateId: string) => Promise<CandidateVersionRecord | null>;
  /** A candidate's disposition without its dataset: every column but the envelope and identity set. */
  readonly readCandidateSummary: (candidateId: string) => Promise<CandidateVersionSummary | null>;
  readonly readPromotion: <T = unknown>(recordClass: RoutineRecordClass, scope: string) => Promise<PromotedProjection<T> | null>;
  /** Set-oriented Reader door; production composition must not fan out per authority. */
  readonly readCandidates: (candidateIds: readonly string[]) => Promise<readonly CandidateVersionReadback[]>;
  readonly readPromotions: <T = unknown>(recordClass: RoutineRecordClass, scopes: readonly string[]) => Promise<readonly PromotedProjection<T>[]>;
  /**
   * The pointer named, never carried: identity columns only. Reader-delivery
   * evidence names and compares the current version through this door; only
   * the typed Reader itself reads (and proves) the payload.
   */
  readonly readPromotionIdentity: (recordClass: RoutineRecordClass, scope: string) => Promise<PromotedPointerIdentity | null>;
  readonly readPromotionIdentities: (recordClass: RoutineRecordClass, scopes: readonly string[]) => Promise<readonly PromotedPointerIdentity[]>;
  /** Read the single derived reader-serving projection for a record class + scope (one query). Null before the first is published. */
  readonly readPreparedReaderProjection: (recordClass: RoutineRecordClass, scope: string) => Promise<PreparedReaderProjectionRow | null>;
  /**
   * The prepared projection's publication coupling without its payload: what
   * a runner pass needs to decide the serving copy is already current.
   */
  readonly readPreparedReaderProjectionCoupling: (recordClass: RoutineRecordClass, scope: string) => Promise<PreparedReaderProjectionCoupling | null>;
  /**
   * Publish a derived reader-serving projection (a SERVING COPY of the promoted
   * partitions, never a promotion). Monotonic + last-valid-safe: the write lands
   * only if the row is still at `expectedSequence` (null = expect absent), so two
   * overlapping runner passes can never put an older composition over a newer
   * one, and a stale pass sees `published:false` and re-reads instead of
   * overwriting a newer publication.
   */
  readonly writePreparedReaderProjection: (
    input: PreparedReaderProjectionInput,
    expectedSequence: number | null,
  ) => Promise<{ readonly published: boolean; readonly sequence: number }>;
  /**
   * Move the pointer to a VALIDATED candidate. The returned projection's
   * payload is that candidate's own read model, already in hand: a store
   * never ships the promoted dataset back over the wire to report the move.
   */
  readonly promote: (candidateId: string, receipt: ValidationReceipt, at: string) => Promise<PromotedProjection>;
  /** Append non-disposition evidence without changing the candidate's state. */
  readonly appendEvidence: (candidateId: string, state: CandidateState, at: string, detail: string) => Promise<CandidateEvent>;
  readonly events: (candidateId: string) => Promise<readonly CandidateEvent[]>;
  readonly clock: (
    sourceId: string,
    recordClass: RoutineRecordClass,
    scope: string,
  ) => Promise<{ readonly lastAttemptedAt?: string; readonly lastSucceededAt?: string }>;
}

type RegisteredMutationContract = {
  readonly id: string;
  readonly kind: "routine" | "manual";
  readonly readerProjectionId: string | null;
};

/**
 * The candidate fields every mutation-authority and Reader-evidence decision
 * reads: its contract identity and any authority-transfer marker. Never its
 * normalized payload or read model.
 */
export type CandidateAuthorityIdentity = Pick<RoutineCandidate, "id" | "sourceId" | "recordClass" | "scope" | "bootstrapImport">;

function registeredMutationContract(
  candidate: Pick<RoutineCandidate, "sourceId" | "recordClass" | "scope">,
): RegisteredMutationContract | null {
  const routine = [...ROUTINE_SOURCE_CONTRACTS, ...MEETING_PARTITION_CONTRACTS]
    .filter((contract) =>
      contract.sourceId === candidate.sourceId &&
      contract.recordClass === candidate.recordClass &&
      // A fan-out contract owns a scope family — its per-state marker at the
      // contract scope plus one bounded member at `<sourceId>:<officeholderId>`.
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
      contract.scope === candidate.scope
    )
    .map((contract) => ({
      id: contract.id,
      kind: "manual" as const,
      readerProjectionId: contract.readerProjection.id,
    }));
  const matches = [...routine, ...manual];
  return matches.length === 1 ? matches[0] : null;
}

/** Pure exact-contract check layered behind the installed-runtime attestation. */
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

/** Production Next status alone never grants this operational data writer. */
export function assertRoutineDataStoreMutationAuthority(
  env: Readonly<Record<string, string | undefined>> = process.env,
): RuntimeAuthorityEnvelope {
  assertWriteAllowed(CIVIC_DATA_PROMOTION_OPERATION, env);
  assertSanctionedRuntimeAuthority(CIVIC_DATA_PROMOTION_OPERATION, env);
  const authority = runtimeAuthorityEnvelope(env);
  if (authority === null) throw new RuntimeAuthorityRefused("routine data store mutation authority is unreadable");
  return authority;
}

/**
 * The candidate was validated against one exact LKG pointer, but another
 * writer moved that pointer before this candidate reached the atomic promotion
 * door. The stale candidate remains durable evidence; it may not overwrite the
 * newer authority it did not validate against.
 */
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

/** The four fields that name a candidate; a receipt must name exactly these. */
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

/** The promotion door trusts the persisted proof, never a caller's replacement proof. */
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

/**
 * Content-only meeting authority fingerprint used by permanent Reader
 * preparation and closure proofs. Observation stamps and source summaries
 * are deliberately excluded; exact meeting/document facts are not.
 */
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

function assertTransitionInput(
  record: CandidateVersionRecord,
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

/**
 * Drizzle's timestamptz string mode exposes PostgreSQL's lexical spelling,
 * which is semantically exact but not the canonical UTC text used by civic
 * evidence hashes. Normalize at the Postgres adapter boundary and fail closed
 * rather than allowing driver formatting to change durable authority proofs.
 */
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

/**
 * The only candidate fields the routine clock reads. `proofConsistentSuccess`
 * names the candidate against its pointer and receipt and takes
 * `retrieval.retrievedAt`; `isTrustedLkgImportCandidate` reads
 * `bootstrapImport`. The clock never needs a promoted payload, a normalized
 * payload or a read model. It runs for every routine task on every pass, and
 * whole-row reads moved every promoted dataset (twice, through the candidate)
 * across the wire each time: 52.7 MB received per pass against production on
 * 2026-09-22 (0.75 MB through this view), about 15 GB/day of billed transfer.
 * Both stores read the clock through this one view, and the Postgres store
 * builds it server-side, so widening it is a cost decision a reviewer sees,
 * never a convenience.
 */
export const ROUTINE_CLOCK_CANDIDATE_FIELDS = {
  top: ["id", "sourceId", "recordClass", "scope", "bootstrapImport"],
  retrieval: ["retrievedAt"],
} as const;

type RoutineClockCandidate = Pick<RoutineCandidate, "id" | "sourceId" | "recordClass" | "scope" | "bootstrapImport"> & {
  readonly retrieval: Pick<RoutineCandidate["retrieval"], "retrievedAt">;
};

/** A candidate record as the clock sees it: every row field, the candidate narrowed. */
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

/**
 * The in-memory twin of the Postgres clock stub below: the same fields with
 * the same null handling, so the memory store (the reference every clock test
 * runs against) decides from exactly what the Postgres clock is sent.
 */
export function routineClockCandidateView(candidate: RoutineCandidate): RoutineClockCandidate {
  const source = candidate as unknown as Readonly<Record<string, unknown>>;
  const retrieval = (candidate.retrieval ?? {}) as unknown as Readonly<Record<string, unknown>>;
  return stripJsonNulls({
    ...Object.fromEntries(ROUTINE_CLOCK_CANDIDATE_FIELDS.top.map((field) => [field, source[field] ?? null])),
    retrieval: Object.fromEntries(ROUTINE_CLOCK_CANDIDATE_FIELDS.retrieval.map((field) => [field, retrieval[field] ?? null])),
  }) as RoutineClockCandidate;
}

/** A historical PROMOTED state is not a clock; only the current pointer and its exact proof are. */
export function proofConsistentSuccess(
  record: RoutineClockRecord | null | undefined,
  pointer: PromotionPointerProof | null | undefined,
): string | undefined {
  const receipt = record?.receipt;
  if (!record || !pointer || record.state !== "PROMOTED" || !record.acquisitionSucceeded || !receipt) return undefined;
  if (pointer.versionId !== record.candidate.id || pointer.lastKnownGoodVersionId !== record.candidate.id) return undefined;
  if (record.promotedVersion !== record.candidate.id || record.lastKnownGoodVersion !== record.candidate.id) return undefined;
  if (pointer.sourceId !== record.candidate.sourceId || pointer.recordClass !== record.candidate.recordClass || pointer.scope !== record.candidate.scope) return undefined;
  if (!receiptIsGoodForCandidate(receipt, record.candidate)) return undefined;
  if (!receiptsEqual(pointer.receipt, receipt)) return undefined;
  // A frozen LKG import is proof of service continuity, not a publisher
  // acquisition. Returning no clock success makes the standing runner due
  // immediately instead of silently waiting one cadence after cutover.
  if (isTrustedLkgImportCandidate(record.candidate)) return undefined;
  return record.candidate.retrieval.retrievedAt;
}

/**
 * The clock of a scope whose pointer is a trusted-LKG import (the cutover
 * successor). The import is neither an attempt nor a success, so a
 * predecessor's attempt from before the import never postpones the first live
 * read. A live attempt made since the import's pointer move IS an attempt: a
 * failed first live read then waits its retry clock like any other failure,
 * instead of reading as never-attempted and falling due on every pass: four
 * meeting partitions whose first live read keeps failing were re-fetched about
 * every six minutes, 964 SOURCE_BLOCKED candidates in the 24 hours to
 * 2026-09-24T05:23Z, each child paying its full canonical preload.
 */
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

/** A whole candidate record narrowed to exactly its summary; the memory twin of the Postgres column read. */
export function candidateVersionSummary(record: CandidateVersionRecord): CandidateVersionSummary {
  const { candidate, ...columns } = record;
  return {
    ...columns,
    candidate: { id: candidate.id, sourceId: candidate.sourceId, recordClass: candidate.recordClass, scope: candidate.scope },
  };
}

/** Name a pointer without its dataset or receipt; a whole projection narrows to exactly this. */
export function promotedPointerIdentity(pointer: PromotedPointerIdentity): PromotedPointerIdentity {
  return {
    key: pointer.key,
    sourceId: pointer.sourceId,
    recordClass: pointer.recordClass,
    scope: pointer.scope,
    versionId: pointer.versionId,
    lastKnownGoodVersionId: pointer.lastKnownGoodVersionId,
    promotedAt: pointer.promotedAt,
  };
}

/** Deterministic store used by destructive/failure tests. */
export class MemoryRoutineDataStore implements RoutineDataStore {
  private readonly candidates = new Map<string, CandidateVersionRecord>();
  private readonly history = new Map<string, CandidateEvent[]>();
  private readonly promotions = new Map<string, PromotedProjection>();
  private readonly preparedProjections = new Map<string, PreparedReaderProjectionRow>();

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

  async transition(candidateId: string, state: CandidateState, at: string, detail: string, receipt?: ValidationReceipt, failure?: { code: string; detail: string }): Promise<CandidateVersionRecord> {
    const prior = this.candidates.get(candidateId);
    if (!prior) throw new Error(`CANDIDATE_NOT_FOUND:${candidateId}`);
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

  async readPromotion<T = unknown>(recordClass: RoutineRecordClass, scope: string): Promise<PromotedProjection<T> | null> {
    const row = this.promotions.get(projectionKey(recordClass, scope));
    return row ? structuredClone(row) as PromotedProjection<T> : null;
  }

  async readPromotions<T = unknown>(
    recordClass: RoutineRecordClass,
    scopes: readonly string[],
  ): Promise<readonly PromotedProjection<T>[]> {
    return scopes.flatMap((scope) => {
      const row = this.promotions.get(projectionKey(recordClass, scope));
      return row ? [structuredClone(row) as PromotedProjection<T>] : [];
    });
  }

  async readPromotionIdentity(recordClass: RoutineRecordClass, scope: string): Promise<PromotedPointerIdentity | null> {
    const row = this.promotions.get(projectionKey(recordClass, scope));
    return row ? promotedPointerIdentity(row) : null;
  }

  async readPromotionIdentities(
    recordClass: RoutineRecordClass,
    scopes: readonly string[],
  ): Promise<readonly PromotedPointerIdentity[]> {
    return scopes.flatMap((scope) => {
      const row = this.promotions.get(projectionKey(recordClass, scope));
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
      `Atomic pointer ${key} moved from ${previous?.versionId ?? "bootstrap/no-version"} to ${candidateId}.`,
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

  async clock(sourceId: string, recordClass: RoutineRecordClass, scope: string): Promise<{ lastAttemptedAt?: string; lastSucceededAt?: string }> {
    const attempts = [...this.candidates.values()]
      .filter((row) =>
        row.candidate.sourceId === sourceId &&
        row.candidate.recordClass === recordClass &&
        row.candidate.scope === scope &&
        !isTrustedLkgImportCandidate(row.candidate)
      )
      .flatMap((row) => {
        const firstEvent = this.history.get(row.candidate.id)?.find((event) => event.sequence === 1);
        return firstEvent && Number.isFinite(Date.parse(firstEvent.at)) ? [{ at: firstEvent.at }] : [];
      })
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    // A candidate's retrievedAt is acquisition evidence and can itself be the
    // defect being refused. The retry scheduler runs on the locally observed
    // first append-only event, so a far-future publisher/adapter timestamp can
    // remain durable without postponing the next source attempt.
    const lastAttemptedAt = attempts[0]?.at;
    const pointer = this.promotions.get(projectionKey(recordClass, scope));
    const pointedRow = pointer?.sourceId === sourceId ? this.candidates.get(pointer.versionId) : null;
    // Decide from exactly the narrowed view the Postgres clock is sent.
    const pointedRecord: RoutineClockRecord | null = pointedRow
      ? { ...pointedRow, candidate: routineClockCandidateView(pointedRow.candidate) }
      : null;
    if (pointer && pointedRecord && isTrustedLkgImportCandidate(pointedRecord.candidate)) {
      return trustedLkgImportClock(lastAttemptedAt, pointer.promotedAt);
    }
    const lastSucceededAt = proofConsistentSuccess(pointedRecord, pointer);
    return {
      ...(lastAttemptedAt ? { lastAttemptedAt } : {}),
      ...(lastSucceededAt ? { lastSucceededAt } : {}),
    };
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
for (const field of [...ROUTINE_CLOCK_CANDIDATE_FIELDS.top, ...ROUTINE_CLOCK_CANDIDATE_FIELDS.retrieval]) {
  // The names are spliced into SQL as literals, so they stay plain identifiers.
  if (!CLOCK_FIELD_NAME.test(field)) throw new Error(`ROUTINE_CLOCK_FIELD_INVALID:${field}`);
}

/**
 * `routineClockCandidateView`, built by Postgres: the candidate column is read
 * only through these paths, so its payload and read model never leave the
 * database. `jsonb_strip_nulls` makes an absent field absent, not null.
 */
function routineClockCandidateStub() {
  const column = civicDataCandidates.candidate;
  const top = ROUTINE_CLOCK_CANDIDATE_FIELDS.top.map((field) =>
    sql`${sql.raw(`'${field}'`)}, ${column}->${sql.raw(`'${field}'`)}`);
  const retrieval = ROUTINE_CLOCK_CANDIDATE_FIELDS.retrieval.map((field) =>
    sql`${sql.raw(`'${field}'`)}, ${column}#>${sql.raw(`'{retrieval,${field}}'`)}`);
  return sql`jsonb_strip_nulls(jsonb_build_object(${sql.join(
    [...top, sql`'retrieval', jsonb_build_object(${sql.join(retrieval, sql`, `)})`],
    sql`, `,
  )}))`.mapWith(civicDataCandidates.candidate);
}

type RoutineClockDb = Pick<ReturnType<typeof getDb>, "select">;

/** The clock's pointer read: identity and proof, never the promoted payload. */
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
    })
    .from(civicDataPromotions)
    .where(and(eq(civicDataPromotions.recordClass, recordClass), eq(civicDataPromotions.scope, scope)))
    .limit(1);
}

/** The clock's pointed-candidate read: every row field, the candidate as its narrowed view. */
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

/** The promotion columns that name a pointer. The payload (the Reader's dataset) and receipt are not among them. */
const PROMOTED_POINTER_IDENTITY_COLUMNS = {
  key: civicDataPromotions.key,
  sourceId: civicDataPromotions.sourceId,
  recordClass: civicDataPromotions.recordClass,
  scope: civicDataPromotions.scope,
  currentVersionId: civicDataPromotions.currentVersionId,
  lastKnownGoodVersionId: civicDataPromotions.lastKnownGoodVersionId,
  promotedAt: civicDataPromotions.promotedAt,
} as const;

/**
 * Reader-delivery evidence's pointer read: identity only. The readback once
 * read each whole row, payload included, on every 5-minute supervisor pass
 * for every Reader contract merely to learn which version to verify: 55.1 MB
 * per pass against production on 2026-09-23, before any typed Reader ran.
 */
export function promotedPointerIdentityRead(
  db: RoutineClockDb,
  recordClass: RoutineRecordClass,
  scopes: readonly string[],
) {
  return db
    .select(PROMOTED_POINTER_IDENTITY_COLUMNS)
    .from(civicDataPromotions)
    .where(and(eq(civicDataPromotions.recordClass, recordClass), inArray(civicDataPromotions.scope, [...scopes])));
}

/**
 * What a promotion's RETURNING carries back: the moved pointer's identity and
 * receipt. Never its payload; see `PostgresRoutineDataStore.promote`.
 */
export const PROMOTED_POINTER_COLUMNS = {
  ...PROMOTED_POINTER_IDENTITY_COLUMNS,
  validationReceipt: civicDataPromotions.validationReceipt,
} as const;

type PostgresPromotedPointerIdentityRow = Pick<
  typeof civicDataPromotions.$inferSelect,
  keyof typeof PROMOTED_POINTER_IDENTITY_COLUMNS
>;

function postgresPromotedPointerIdentity(row: PostgresPromotedPointerIdentityRow): PromotedPointerIdentity {
  return {
    key: row.key,
    sourceId: row.sourceId,
    recordClass: row.recordClass as RoutineRecordClass,
    scope: row.scope,
    versionId: row.currentVersionId,
    lastKnownGoodVersionId: row.lastKnownGoodVersionId,
    promotedAt: canonicalPostgresRoutineTimestamp(row.promotedAt, "promotion.promotedAt"),
  };
}

function postgresPromotionRowToProjection<T = unknown>(
  row: typeof civicDataPromotions.$inferSelect,
): PromotedProjection<T> {
  return {
    ...postgresPromotedPointerIdentity(row),
    payload: row.payload as T,
    receipt: row.validationReceipt as ValidationReceipt,
  };
}

/** Every candidate column but the envelope and identity set; see `CandidateVersionSummary`. */
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

/** A candidate's disposition without its dataset (see `CandidateVersionSummary`). */
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

/**
 * The Reader-evidence door's candidate read: identity, transfer marker, and
 * state. Never the candidate envelope, which carries the whole normalized
 * dataset and read model (23.7 MB on the wire for NJ roll calls). The row's
 * identity columns equal the envelope's by CHECK
 * (`civic_data_candidates_envelope_identity_coherent`).
 */
export function readerEvidenceCandidateRead(db: RoutineClockDb, candidateId: string) {
  return db
    .select({
      id: civicDataCandidates.id,
      sourceId: civicDataCandidates.sourceId,
      recordClass: civicDataCandidates.recordClass,
      scope: civicDataCandidates.scope,
      state: civicDataCandidates.state,
      // An absent marker and a JSON-null marker both read back as null; the
      // key test keeps a present-but-null marker a marker, exactly as the
      // whole envelope's own-property check decides.
      hasBootstrapImport: sql<boolean>`${civicDataCandidates.candidate} ? 'bootstrapImport'`,
      bootstrapImport: sql<unknown>`${civicDataCandidates.candidate}->'bootstrapImport'`,
    })
    .from(civicDataCandidates)
    .where(eq(civicDataCandidates.id, candidateId))
    .limit(1);
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

/** The prepared projection's coupling columns; never its composed payload. */
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

function postgresCandidateEventRowToEvent(row: PostgresCandidateEventRow): CandidateEvent {
  return {
    candidateId: row.candidateId,
    sequence: row.sequence,
    state: row.state as CandidateState,
    at: canonicalPostgresRoutineTimestamp(row.at, "candidateEvent.at"),
    detail: row.detail,
  };
}

/** Production store: append-only events plus one atomic canonical projection. */
export class PostgresRoutineDataStore implements RoutineDataStore {
  private readonly db = getDb();
  private writeAuthority: RuntimeAuthorityEnvelope | null = null;

  /**
   * The registered promotion wrappers are the normal authority door, but the
   * database adapter must not trust every future caller to remember it. Prove
   * the named sanctioned write and exact installed-runtime authority at the
   * first actual mutation made by this store instance. Reads remain available
   * to the production application without a write capability.
   */
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

  /**
   * Candidate history has a per-candidate sequence invariant. Neon HTTP
   * batches are real database transactions but they are not interactive, so
   * serialize every sequence allocator with a transaction-scoped advisory
   * lock as the first statement in the batch. A lock acquired inside the
   * INSERT statement would be too late: that statement's snapshot may have
   * been taken before a competing transaction committed its event.
   */
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
        identity: record.candidate.identities,
        candidate: record.candidate,
        validationReceipt: record.receipt,
        promotedVersionId: record.promotedVersion,
        lastKnownGoodVersionId: record.lastKnownGoodVersion,
        failureCode: record.failureCode,
        failureDetail: record.failureDetail,
      }),
      this.db.insert(civicDataCandidateEvents).values(firstEvent),
    ]);
  }

  async transition(candidateId: string, state: CandidateState, at: string, detail: string, receipt?: ValidationReceipt, failure?: { code: string; detail: string }): Promise<CandidateVersionRecord> {
    this.assertMutationAuthority();
    const [priorRow] = await this.db.select().from(civicDataCandidates).where(eq(civicDataCandidates.id, candidateId)).limit(1);
    if (!priorRow) throw new Error(`CANDIDATE_NOT_FOUND:${candidateId}`);
    const prior = rowToCandidate(priorRow);
    this.assertCandidateMutationAuthority(prior.candidate);
    assertTransitionInput(prior, state, at, detail, receipt, failure);
    const allowed = allowedPriorStates(state);
    const priorStateEligible = and(
      eq(civicDataCandidates.id, candidateId),
      inArray(civicDataCandidates.state, [...allowed]),
    )!;
    const nextSequence = this.nextCandidateEventSequence(candidateId);
    /*
     * The actual compare-and-set and its event are one data-modifying CTE.
     * The earlier read is validation input only: after an advisory-lock wait,
     * a stale caller's UPDATE returns no row, so the INSERT also returns no row.
     * It cannot commit an event without the state mutation (or vice versa),
     * even if the row changed after the pre-read.
     */
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
    // The row's columns after the write, never its envelope again: the
    // envelope and identity set are written once at create and no statement
    // updates them, so the pre-read's copy is the durable one.
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
    return { ...columns, candidate: prior.candidate };
  }

  async readCandidate(candidateId: string): Promise<CandidateVersionRecord | null> {
    const [row] = await this.db.select().from(civicDataCandidates).where(eq(civicDataCandidates.id, candidateId)).limit(1);
    return row ? rowToCandidate(row) : null;
  }

  async readCandidateSummary(candidateId: string): Promise<CandidateVersionSummary | null> {
    const [row] = await candidateSummaryRead(this.db, candidateId);
    return row ? postgresCandidateSummary(row) : null;
  }

  async readPromotion<T = unknown>(recordClass: RoutineRecordClass, scope: string): Promise<PromotedProjection<T> | null> {
    const [row] = await this.db.select().from(civicDataPromotions).where(and(eq(civicDataPromotions.recordClass, recordClass), eq(civicDataPromotions.scope, scope))).limit(1);
    return row ? postgresPromotionRowToProjection<T>(row) : null;
  }

  async readPromotions<T = unknown>(
    recordClass: RoutineRecordClass,
    scopes: readonly string[],
  ): Promise<readonly PromotedProjection<T>[]> {
    if (scopes.length === 0) return [];
    const rows = await this.db.select().from(civicDataPromotions).where(and(
      eq(civicDataPromotions.recordClass, recordClass),
      inArray(civicDataPromotions.scope, [...scopes]),
    ));
    return rows.map((row) => postgresPromotionRowToProjection<T>(row));
  }

  async readPromotionIdentity(recordClass: RoutineRecordClass, scope: string): Promise<PromotedPointerIdentity | null> {
    // (record_class, scope) is unique, so this names at most one pointer.
    const [row] = await promotedPointerIdentityRead(this.db, recordClass, [scope]).limit(1);
    return row ? postgresPromotedPointerIdentity(row) : null;
  }

  async readPromotionIdentities(
    recordClass: RoutineRecordClass,
    scopes: readonly string[],
  ): Promise<readonly PromotedPointerIdentity[]> {
    if (scopes.length === 0) return [];
    const rows = await promotedPointerIdentityRead(this.db, recordClass, scopes);
    return rows.map(postgresPromotedPointerIdentity);
  }

  async readPreparedReaderProjection(recordClass: RoutineRecordClass, scope: string): Promise<PreparedReaderProjectionRow | null> {
    const [row] = await this.db.select().from(civicDataReaderProjections).where(and(
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
    // The DB write sanction is the gate: this is a reader-evidence-class derived
    // write (a serving copy), never a candidate mutation, and the standing
    // runner's reader-repair pass already holds the sanction. The reader path,
    // holding no sanction, can never reach this.
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
      // First publication: insert; a racing insert is rejected (published:false).
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
    const rows = await this.db.select().from(civicDataCandidates).where(inArray(civicDataCandidates.id, [...candidateIds]));
    return rows.map((row) => ({ candidateId: row.id, record: rowToCandidate(row) }));
  }

  async appendEvidence(candidateId: string, state: CandidateState, at: string, detail: string): Promise<CandidateEvent> {
    const authority = this.assertMutationAuthority();
    // Identity, marker, and state only: evidence never needs the candidate
    // envelope, and the typed Reader has already read and proved the dataset.
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

  async promote(candidateId: string, receipt: ValidationReceipt, at: string): Promise<PromotedProjection> {
    this.assertMutationAuthority();
    // Whole row: its read model is the payload the insert below copies and the
    // payload of the projection returned, so the batch never ships it back.
    const [row] = await this.db.select().from(civicDataCandidates).where(eq(civicDataCandidates.id, candidateId)).limit(1);
    const record = row ? rowToCandidate(row) : null;
    const persistedReceipt = persistedPromotionReceipt(record, receipt);
    if (!record || !persistedReceipt) throw new Error(`CANDIDATE_NOT_PROMOTABLE:${candidateId}`);
    assertPromotionTime(record, persistedReceipt, at);
    this.assertCandidateMutationAuthority(record.candidate);
    const candidate = record.candidate;
    const key = projectionKey(candidate.recordClass, candidate.scope);
    // The prior pointer is read for its version id alone, never its payload.
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
    const detail = `Atomic pointer ${key} moved from ${prior?.currentVersionId ?? "bootstrap/no-version"} to ${candidateId}.`;
    const nextSequence = this.nextCandidateEventSequence(candidateId);

    /*
     * Neon HTTP has no interactive transactions. `batch` is one server-side
     * transaction, and each write below is selected from the same still-
     * VALIDATED row with the exact persisted JSONB receipt. A concurrent
     * transition therefore makes every statement a zero-row write; it cannot
     * move the pointer while losing the candidate/event half of promotion.
     */
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
    /*
     * The batch returns the moved pointer's identity and receipt, never its
     * payload or the candidate envelope. Both carry the promoted dataset, so
     * one HTTP response held it twice: 75.84 MB for census geography before
     * PR #363 compacted it, 33.5 MB for NJ roll calls on 2026-09-23. The
     * pointer's payload is, by the insert above, `candidate->'readModel'` of
     * this exact eligible row; that read model is already in hand, so the
     * projection is built from it and the dataset never crosses back.
     */
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

  async clock(sourceId: string, recordClass: RoutineRecordClass, scope: string): Promise<{ lastAttemptedAt?: string; lastSucceededAt?: string }> {
    const attemptQuery = this.db
      .select({ attemptedAt: civicDataCandidateEvents.at })
      .from(civicDataCandidates)
      .innerJoin(civicDataCandidateEvents, and(
        eq(civicDataCandidateEvents.candidateId, civicDataCandidates.id),
        eq(civicDataCandidateEvents.sequence, 1),
      ))
      .where(and(
        eq(civicDataCandidates.sourceId, sourceId),
        eq(civicDataCandidates.recordClass, recordClass),
        eq(civicDataCandidates.scope, scope),
        // A frozen cutover import is durable service-continuity evidence, not
        // a publisher attempt.  Excluding it from the source clock makes a
        // newly imported contract due immediately for its first live read.
        sql`coalesce(${civicDataCandidates.candidate}#>>'{bootstrapImport,kind}', '') not in ('TRUSTED_LKG_IMPORT', 'TRUSTED_LKG_REATTESTATION')`,
      ))
      .orderBy(desc(civicDataCandidateEvents.at))
      .limit(1);
    // Identity and proof only: a whole-row read here moves every promoted
    // dataset on every pass (see ROUTINE_CLOCK_CANDIDATE_FIELDS).
    const pointerQuery = routineClockPointerRead(this.db, recordClass, scope);
    const [rows, pointerRows] = await this.db.batch([attemptQuery, pointerQuery]);
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
    if (pointer && pointedRecord && isTrustedLkgImportCandidate(pointedRecord.candidate)) {
      return trustedLkgImportClock(
        lastAttemptedAt,
        canonicalPostgresRoutineTimestamp(pointer.promotedAt, "clock.importPromotedAt"),
      );
    }
    const lastSucceededAt = proofConsistentSuccess(
      pointedRecord,
      pointer ? {
        sourceId: pointer.sourceId,
        recordClass: pointer.recordClass as RoutineRecordClass,
        scope: pointer.scope,
        versionId: pointer.currentVersionId,
        lastKnownGoodVersionId: pointer.lastKnownGoodVersionId,
        receipt: pointer.validationReceipt as ValidationReceipt,
      } : null,
    );
    const canonicalLastSucceededAt = lastSucceededAt === undefined
      ? undefined
      : canonicalPostgresRoutineTimestamp(lastSucceededAt, "clock.lastSucceededAt");
    return {
      ...(lastAttemptedAt ? { lastAttemptedAt } : {}),
      ...(canonicalLastSucceededAt ? { lastSucceededAt: canonicalLastSucceededAt } : {}),
    };
  }
}
