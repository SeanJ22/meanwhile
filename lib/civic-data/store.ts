import { createHash } from "node:crypto";

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "../db/index.ts";
import { migrationReceiptAbsentExpression } from "../db/applied-migrations.ts";
import { civicDataCandidateEvents, civicDataCandidates, civicDataPromotions } from "../db/schema.ts";
import {
  type CandidateEvent,
  type CandidateState,
  type CandidateVersionRecord,
  type PromotedProjection,
  type RoutineCandidate,
  type RoutineRecordClass,
  type ValidationReceipt,
} from "./types.ts";
import { canonicalCivicDataJson } from "./changes.ts";
import { parseValidationReceipt } from "./receipt.ts";
import {
  isTrustedLkgImportCandidate,
  PDC_V2_FROZEN_BASE_SHA,
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
import { parseReaderProjectionReadback } from "./reader-readback.ts";
import { canonicalAgendaDocument, type AgendaDocument } from "../meetings/agenda-documents.ts";

export function projectionKey(recordClass: RoutineRecordClass, scope: string): string {
  return `${recordClass}:${scope}`;
}

/** Preserve the SQL row identity even when its untrusted JSON body is corrupt. */
export interface CandidateVersionReadback {
  readonly candidateId: string;
  readonly record: CandidateVersionRecord;
}

/**
 * Temporary PDC-V2 transfer receipt. The cutover importer is the only caller;
 * the terminal tree deletes this door after the obsolete aggregate authority
 * has been removed. Historical candidates/events remain immutable evidence.
 */
export const PDC_V2_LEGACY_MEETINGS_RETIREMENT_PREFIX =
  "PDC_V2_LEGACY_MEETINGS_AGGREGATE_RETIREMENT ";

export interface PdcV2LegacyMeetingsRetirementExpectation {
  readonly contractVersion: 1;
  readonly frozenBaseSha: string;
  readonly importerCodeSha: string;
  readonly legacyMeetingFactSha256: string;
  readonly replacementPointerSha256: string;
  readonly replacementPartitionCount: number;
  readonly absentPartitionCount: number;
  readonly meetingRowCount: number;
  readonly agendaDocumentRowCount: number;
}

export interface PdcV2LegacyMeetingsRetirementInput {
  readonly retiredAt: string;
  readonly expected: PdcV2LegacyMeetingsRetirementExpectation;
  /**
   * Exact payload observed while the obsolete pointer still existed. It is
   * deliberately omitted on a post-retirement replay; the durable fact hash
   * in `expected` remains stable across both executions.
   */
  readonly observedLegacyPayload: unknown | null;
  /** Exact prewrite authority identity; null only on a proved post-retirement replay. */
  readonly observedLegacyVersionId: string | null;
  /** Exact mutable pointer witness captured before any replacement write. */
  readonly observedLegacyPointerSha256: string | null;
  /** Exact immutable candidate row admitted before any replacement write. */
  readonly observedLegacyCandidateRecord: CandidateVersionRecord | null;
  readonly observedLegacyCandidateRecordSha256: string | null;
  /** Exact pre-retirement history admitted before any replacement write. */
  readonly observedLegacyEvents: readonly CandidateEvent[] | null;
  readonly observedLegacyHistorySha256: string | null;
  readonly replacementPointers: readonly {
    readonly scope: string;
    readonly versionId: string;
    /** Bind the final atomic delete to the exact permanent payload proved by Reader. */
    readonly payload: unknown;
    /** Bind retirement to the exact source-scoped GOOD proof serving that payload. */
    readonly receipt: ValidationReceipt;
  }[];
  readonly allPermanentPartitionScopes: readonly string[];
}

export interface PdcV2LegacyMeetingsRetirementResult {
  readonly disposition: "RETIRED" | "ALREADY_RETIRED_PROVEN";
  readonly legacyVersionId: string;
  readonly retiredAt: string;
  readonly detail: string;
}

export interface RoutineDataStore {
  /** Temporary one-time gate: 0026 must be wholly absent before import writes. */
  readonly assertPdcV2PreContractMigrationState: () => Promise<void>;
  /** Run 0026's exact global preflight with only pre-proved prospective successors exempted. */
  readonly assertPdcV2PreImportDataIntegrity: (
    migrationSql: string,
    prospectiveReattestationPredecessorIds: readonly string[],
  ) => Promise<void>;
  /** Execute 0026's own reusable data-integrity preflight before retirement. */
  readonly assertPdcV2ContractMigrationPreflight: (migrationSql: string) => Promise<void>;
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
  readonly readPromotion: <T = unknown>(recordClass: RoutineRecordClass, scope: string) => Promise<PromotedProjection<T> | null>;
  /** Set-oriented Reader door; production composition must not fan out per authority. */
  readonly readCandidates: (candidateIds: readonly string[]) => Promise<readonly CandidateVersionReadback[]>;
  readonly readPromotions: <T = unknown>(recordClass: RoutineRecordClass, scopes: readonly string[]) => Promise<readonly PromotedProjection<T>[]>;
  readonly promote: (candidateId: string, receipt: ValidationReceipt, at: string) => Promise<PromotedProjection>;
  /** Append non-disposition evidence without changing the candidate's state. */
  readonly appendEvidence: (candidateId: string, state: CandidateState, at: string, detail: string) => Promise<CandidateEvent>;
  /** Temporary exact transfer door; deleted with the one-time importer. */
  readonly retirePdcV2LegacyMeetingsAggregate: (
    input: PdcV2LegacyMeetingsRetirementInput,
  ) => Promise<PdcV2LegacyMeetingsRetirementResult>;
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

function registeredMutationContract(candidate: RoutineCandidate): RegisteredMutationContract | null {
  const routine = [...ROUTINE_SOURCE_CONTRACTS, ...MEETING_PARTITION_CONTRACTS]
    .filter((contract) =>
      contract.sourceId === candidate.sourceId &&
      contract.recordClass === candidate.recordClass &&
      contract.scope === candidate.scope
    )
    .map((contract) => ({
      id: contract.id,
      kind: "routine" as const,
      readerProjectionId: contract.readerProjection?.id ?? null,
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
  candidate: RoutineCandidate,
  authority: RuntimeAuthorityEnvelope,
  operation: "candidate" | "reader-evidence",
): string | null {
  const contract = registeredMutationContract(candidate);
  if (contract === null) return "candidate does not identify exactly one registered production contract";
  const hasAuthorityTransferMarker = Object.prototype.hasOwnProperty.call(candidate, "bootstrapImport") &&
    candidate.bootstrapImport !== undefined;
  if (authority.capability === "TRUSTED_LKG_IMPORT") {
    return isTrustedLkgImportCandidate(candidate) && candidate.bootstrapImport.contractId === contract.id
      ? null
      : `trusted-LKG authority cannot write non-import candidate ${contract.id}`;
  }
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

function receiptNamesCandidate(receipt: ValidationReceipt, candidate: RoutineCandidate): boolean {
  return receipt.candidateId === candidate.id &&
    receipt.sourceId === candidate.sourceId &&
    receipt.recordClass === candidate.recordClass &&
    receipt.scope === candidate.scope;
}

function receiptsEqual(left: ValidationReceipt, right: ValidationReceipt): boolean {
  return canonicalCivicDataJson(left) === canonicalCivicDataJson(right);
}

function receiptIsGoodForCandidate(receipt: ValidationReceipt, candidate: RoutineCandidate): boolean {
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
const PDC_V2_LEGACY_MEETINGS_KEY = "MEETING:supported-bodies";
const PDC_V2_LEGACY_MEETINGS_SOURCE_ID = "meetings-public-bodies";
const PDC_V2_LEGACY_MEETINGS_SCOPE = "supported-bodies";
const PDC_V2_MEETING_REPLACEMENT_PARTITION_COUNT = 83;
const PDC_V2_MEETING_ABSENT_PARTITION_COUNT = 41;
const PDC_V2_CONTRACT_MIGRATION_CREATED_AT = 1788981808213;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const GIT_SHA_HEX = /^[a-f0-9]{40}$/;

export interface PdcV2CanonicalMeetingFactEvidence {
  readonly sha256: string;
  readonly meetingRowCount: number;
  readonly agendaDocumentRowCount: number;
}

/**
 * Content-only meeting authority fingerprint shared by the one-time plan and
 * the store's destructive retirement door. Observation stamps and source
 * summaries are deliberately excluded; exact meeting/document facts are not.
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

/**
 * Return the reusable, read-only first preflight from the exact PDC contract
 * migration. The subsequent authority-transfer block is intentionally not
 * executed by the importer: it must refuse migration application until the
 * obsolete aggregate pointer has actually been retired.
 */
function pdcV2ContractMigrationPreflightSql(migrationSql: string): string {
  const segments = migrationSql.split("--> statement-breakpoint").map((value) => value.trim());
  const preflight = segments[0] ?? "";
  const authorityTransfer = segments[1] ?? "";
  if (
    !preflight.startsWith("DO $pdc_preflight$") ||
    !preflight.endsWith("$pdc_preflight$;") ||
    !authorityTransfer.startsWith("DO $pdc_authority_transfer$") ||
    !authorityTransfer.endsWith("$pdc_authority_transfer$;") ||
    !authorityTransfer.includes(PDC_V2_LEGACY_MEETINGS_KEY) ||
    !authorityTransfer.includes(PDC_V2_LEGACY_MEETINGS_SCOPE) ||
    !authorityTransfer.includes("RAISE EXCEPTION") ||
    !migrationSql.includes('CREATE UNIQUE INDEX "civic_data_candidates_identity_idx"') ||
    !migrationSql.includes("civic_data_promotions_no_delete_or_rewrite")
  ) {
    throw new Error("PDC_V2_CONTRACT_MIGRATION_TEXT_INVALID");
  }
  return preflight;
}

interface PdcV2LegacyMeetingsRetirementEvidence
  extends PdcV2LegacyMeetingsRetirementExpectation {
  readonly kind: "LEGACY_MEETINGS_AGGREGATE_RETIRED";
  readonly legacyKey: typeof PDC_V2_LEGACY_MEETINGS_KEY;
  readonly legacySourceId: typeof PDC_V2_LEGACY_MEETINGS_SOURCE_ID;
  readonly legacyRecordClass: "MEETING";
  readonly legacyScope: typeof PDC_V2_LEGACY_MEETINGS_SCOPE;
  readonly legacyVersionId: string;
  /** Exact deleted mutable pointer, including its promotedAt clock. */
  readonly legacyPointerSha256: string;
  /** Exact retained immutable candidate row at the destructive boundary. */
  readonly legacyCandidateRecordSha256: string;
  /** Exact retained history before this terminal retirement event. */
  readonly legacyHistorySha256: string;
  readonly legacyHistoryEventCount: number;
  readonly legacyHistoryLastSequence: number;
  /**
   * Canonical digest of every full replacement pointer, candidate row, and
   * pre-retirement event list. The reduced replacementPointerSha256 remains
   * the public transfer-plan witness; this is the durable replay witness.
   */
  readonly replacementFullPointerSetSha256: string;
  readonly replacementCandidateRecordSetSha256: string;
  /** Exact per-authority history prefixes admitted at aggregate retirement. */
  readonly replacementHistoryWitnesses: readonly PdcV2ReplacementHistoryWitness[];
  readonly replacementHistorySetSha256: string;
  readonly replacementAuthoritySha256: string;
  readonly retiredAt: string;
}

function assertPdcV2LegacyMeetingsRetirementInput(
  input: PdcV2LegacyMeetingsRetirementInput,
): void {
  const replacementScopes = input.replacementPointers.map(({ scope }) => scope);
  const replacementVersions = input.replacementPointers.map(({ versionId }) => versionId);
  const allScopes = [...input.allPermanentPartitionScopes];
  const exactAllScopes = MEETING_PARTITION_CONTRACTS.map(({ scope }) => scope).sort();
  const replacementPointerSha256 = createHash("sha256")
    .update(canonicalCivicDataJson([...input.replacementPointers]))
    .digest("hex");
  if (
    input.expected.contractVersion !== 1 ||
    input.expected.frozenBaseSha !== PDC_V2_FROZEN_BASE_SHA ||
    !GIT_SHA_HEX.test(input.expected.frozenBaseSha) ||
    !GIT_SHA_HEX.test(input.expected.importerCodeSha) ||
    !SHA256_HEX.test(input.expected.legacyMeetingFactSha256) ||
    !SHA256_HEX.test(input.expected.replacementPointerSha256) ||
    input.expected.replacementPointerSha256 !== replacementPointerSha256 ||
    input.expected.replacementPartitionCount !== input.replacementPointers.length ||
    input.expected.absentPartitionCount !== allScopes.length - input.replacementPointers.length ||
    input.expected.replacementPartitionCount !== PDC_V2_MEETING_REPLACEMENT_PARTITION_COUNT ||
    input.expected.absentPartitionCount !== PDC_V2_MEETING_ABSENT_PARTITION_COUNT ||
    input.expected.meetingRowCount <= 0 ||
    input.expected.agendaDocumentRowCount < 0 ||
    (input.observedLegacyPayload === null
      ? input.observedLegacyVersionId !== null ||
        input.observedLegacyPointerSha256 !== null ||
        input.observedLegacyCandidateRecord !== null ||
        input.observedLegacyCandidateRecordSha256 !== null ||
        input.observedLegacyEvents !== null ||
        input.observedLegacyHistorySha256 !== null
      : !input.observedLegacyVersionId ||
        !SHA256_HEX.test(input.observedLegacyPointerSha256 ?? "") ||
        input.observedLegacyCandidateRecord === null ||
        !SHA256_HEX.test(input.observedLegacyCandidateRecordSha256 ?? "") ||
        input.observedLegacyEvents === null ||
        !SHA256_HEX.test(input.observedLegacyHistorySha256 ?? "") ||
        createHash("sha256")
          .update(canonicalCivicDataJson(input.observedLegacyCandidateRecord))
          .digest("hex") !== input.observedLegacyCandidateRecordSha256 ||
        createHash("sha256")
          .update(canonicalCivicDataJson(input.observedLegacyEvents))
          .digest("hex") !== input.observedLegacyHistorySha256) ||
    new Set(replacementScopes).size !== replacementScopes.length ||
    new Set(replacementVersions).size !== replacementVersions.length ||
    new Set(allScopes).size !== allScopes.length ||
    canonicalCivicDataJson(allScopes) !== canonicalCivicDataJson(exactAllScopes) ||
    canonicalCivicDataJson(replacementScopes) !==
      canonicalCivicDataJson([...replacementScopes].sort()) ||
    replacementScopes.some((scope) => !allScopes.includes(scope)) ||
    replacementScopes.some((scope) => !scope || scope === PDC_V2_LEGACY_MEETINGS_SCOPE) ||
    replacementVersions.some((versionId) => !versionId) ||
    input.replacementPointers.some(({ payload, receipt, scope, versionId }) =>
      payload === undefined || payload === null ||
      parseValidationReceipt(receipt)?.decision !== "GOOD" ||
      receipt.candidateId !== versionId ||
      receipt.sourceId !== PDC_V2_LEGACY_MEETINGS_SOURCE_ID ||
      receipt.recordClass !== "MEETING" ||
      receipt.scope !== scope
    ) ||
    !Number.isFinite(Date.parse(input.retiredAt)) ||
    new Date(Date.parse(input.retiredAt)).toISOString() !== input.retiredAt ||
    Date.parse(input.retiredAt) > Date.now() + MAX_PROMOTION_CLOCK_SKEW_MS
  ) {
    throw new Error("PDC_V2_LEGACY_MEETINGS_RETIREMENT_INPUT_INVALID");
  }
}

function pdcV2LegacyMeetingsRetirementDetail(
  input: PdcV2LegacyMeetingsRetirementInput,
  legacyVersionId: string,
  replacementAuthorityWitness: PdcV2ReplacementAuthorityWitness,
): string {
  const legacyEvents = input.observedLegacyEvents;
  if (
    !SHA256_HEX.test(input.observedLegacyPointerSha256 ?? "") ||
    !SHA256_HEX.test(input.observedLegacyCandidateRecordSha256 ?? "") ||
    !SHA256_HEX.test(input.observedLegacyHistorySha256 ?? "") ||
    !SHA256_HEX.test(replacementAuthorityWitness.replacementAuthoritySha256) ||
    legacyEvents === null || legacyEvents.length < 4
  ) throw new Error("PDC_V2_LEGACY_MEETINGS_RETIREMENT_INPUT_INVALID");
  const evidence: PdcV2LegacyMeetingsRetirementEvidence = {
    kind: "LEGACY_MEETINGS_AGGREGATE_RETIRED",
    legacyKey: PDC_V2_LEGACY_MEETINGS_KEY,
    legacySourceId: PDC_V2_LEGACY_MEETINGS_SOURCE_ID,
    legacyRecordClass: "MEETING",
    legacyScope: PDC_V2_LEGACY_MEETINGS_SCOPE,
    legacyVersionId,
    legacyPointerSha256: input.observedLegacyPointerSha256!,
    legacyCandidateRecordSha256: input.observedLegacyCandidateRecordSha256!,
    legacyHistorySha256: input.observedLegacyHistorySha256!,
    legacyHistoryEventCount: legacyEvents.length,
    legacyHistoryLastSequence: legacyEvents.at(-1)?.sequence ?? 0,
    ...replacementAuthorityWitness,
    retiredAt: input.retiredAt,
    ...input.expected,
  };
  return `${PDC_V2_LEGACY_MEETINGS_RETIREMENT_PREFIX}${canonicalCivicDataJson(evidence)}`;
}

function parsePdcV2LegacyMeetingsRetirementDetail(
  detail: string,
): PdcV2LegacyMeetingsRetirementEvidence | null {
  if (!detail.startsWith(PDC_V2_LEGACY_MEETINGS_RETIREMENT_PREFIX)) return null;
  try {
    const parsed: unknown = JSON.parse(
      detail.slice(PDC_V2_LEGACY_MEETINGS_RETIREMENT_PREFIX.length),
    );
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const value = parsed as Partial<PdcV2LegacyMeetingsRetirementEvidence>;
    const expectedKeys = [
      "kind", "legacyKey", "legacySourceId", "legacyRecordClass", "legacyScope",
      "legacyVersionId", "legacyPointerSha256", "legacyCandidateRecordSha256",
      "legacyHistorySha256", "legacyHistoryEventCount", "legacyHistoryLastSequence",
      "replacementFullPointerSetSha256", "replacementCandidateRecordSetSha256",
      "replacementHistoryWitnesses", "replacementHistorySetSha256",
      "replacementAuthoritySha256", "retiredAt",
      "contractVersion", "frozenBaseSha",
      "importerCodeSha", "legacyMeetingFactSha256", "replacementPointerSha256",
      "replacementPartitionCount", "absentPartitionCount", "meetingRowCount",
      "agendaDocumentRowCount",
    ].sort();
    if (
      Object.keys(value).sort().join("\n") !== expectedKeys.join("\n") ||
      value.kind !== "LEGACY_MEETINGS_AGGREGATE_RETIRED" ||
      value.legacyKey !== PDC_V2_LEGACY_MEETINGS_KEY ||
      value.legacySourceId !== PDC_V2_LEGACY_MEETINGS_SOURCE_ID ||
      value.legacyRecordClass !== "MEETING" ||
      value.legacyScope !== PDC_V2_LEGACY_MEETINGS_SCOPE ||
      typeof value.legacyVersionId !== "string" || !value.legacyVersionId ||
      typeof value.legacyPointerSha256 !== "string" || !SHA256_HEX.test(value.legacyPointerSha256) ||
      typeof value.legacyCandidateRecordSha256 !== "string" || !SHA256_HEX.test(value.legacyCandidateRecordSha256) ||
      typeof value.legacyHistorySha256 !== "string" || !SHA256_HEX.test(value.legacyHistorySha256) ||
      !Number.isInteger(value.legacyHistoryEventCount) || value.legacyHistoryEventCount! < 4 ||
      !Number.isInteger(value.legacyHistoryLastSequence) ||
      value.legacyHistoryLastSequence !== value.legacyHistoryEventCount ||
      typeof value.replacementFullPointerSetSha256 !== "string" || !SHA256_HEX.test(value.replacementFullPointerSetSha256) ||
      typeof value.replacementCandidateRecordSetSha256 !== "string" || !SHA256_HEX.test(value.replacementCandidateRecordSetSha256) ||
      !pdcV2ReplacementHistoryWitnessesValid(value.replacementHistoryWitnesses) ||
      typeof value.replacementHistorySetSha256 !== "string" || !SHA256_HEX.test(value.replacementHistorySetSha256) ||
      typeof value.replacementAuthoritySha256 !== "string" || !SHA256_HEX.test(value.replacementAuthoritySha256) ||
      typeof value.retiredAt !== "string" ||
      !Number.isFinite(Date.parse(value.retiredAt)) ||
      new Date(Date.parse(value.retiredAt)).toISOString() !== value.retiredAt ||
      value.contractVersion !== 1 ||
      typeof value.frozenBaseSha !== "string" || !GIT_SHA_HEX.test(value.frozenBaseSha) ||
      typeof value.importerCodeSha !== "string" || !GIT_SHA_HEX.test(value.importerCodeSha) ||
      typeof value.legacyMeetingFactSha256 !== "string" || !SHA256_HEX.test(value.legacyMeetingFactSha256) ||
      typeof value.replacementPointerSha256 !== "string" || !SHA256_HEX.test(value.replacementPointerSha256) ||
      !Number.isInteger(value.replacementPartitionCount) ||
      !Number.isInteger(value.absentPartitionCount) ||
      !Number.isInteger(value.meetingRowCount) ||
      !Number.isInteger(value.agendaDocumentRowCount)
    ) return null;
    return value as PdcV2LegacyMeetingsRetirementEvidence;
  } catch {
    return null;
  }
}

function pdcV2LegacyMeetingsRetirementMatches(
  event: CandidateEvent,
  expected: PdcV2LegacyMeetingsRetirementExpectation,
): PdcV2LegacyMeetingsRetirementEvidence | null {
  const evidence = parsePdcV2LegacyMeetingsRetirementDetail(event.detail);
  if (
    event.state !== "PROMOTED" ||
    evidence === null ||
    event.candidateId !== evidence.legacyVersionId ||
    Date.parse(event.at) !== Date.parse(evidence.retiredAt) ||
    canonicalCivicDataJson({
      contractVersion: evidence.contractVersion,
      frozenBaseSha: evidence.frozenBaseSha,
      importerCodeSha: evidence.importerCodeSha,
      legacyMeetingFactSha256: evidence.legacyMeetingFactSha256,
      replacementPointerSha256: evidence.replacementPointerSha256,
      replacementPartitionCount: evidence.replacementPartitionCount,
      absentPartitionCount: evidence.absentPartitionCount,
      meetingRowCount: evidence.meetingRowCount,
      agendaDocumentRowCount: evidence.agendaDocumentRowCount,
    }) !== canonicalCivicDataJson(expected)
  ) return null;
  return evidence;
}

function pdcV2LegacyMeetingsReplacementIssue(
  input: PdcV2LegacyMeetingsRetirementInput,
  pointers: readonly PromotedProjection[],
): string | null {
  const expectedByScope = new Map(input.replacementPointers.map((row) => [row.scope, row] as const));
  if (
    pointers.length !== input.replacementPointers.length ||
    new Set(pointers.map(({ scope }) => scope)).size !== pointers.length
  ) {
    return `expected ${input.replacementPointers.length} permanent pointers, observed ${pointers.length}`;
  }
  for (const pointer of pointers) {
    const expected = expectedByScope.get(pointer.scope);
    if (
      pointer.key !== projectionKey("MEETING", pointer.scope) ||
      pointer.sourceId !== PDC_V2_LEGACY_MEETINGS_SOURCE_ID ||
      pointer.recordClass !== "MEETING" ||
      expected === undefined ||
      pointer.versionId !== expected.versionId ||
      pointer.lastKnownGoodVersionId !== expected.versionId ||
      canonicalCivicDataJson(pointer.payload) !== canonicalCivicDataJson(expected.payload) ||
      !receiptsEqual(pointer.receipt, expected.receipt) ||
      isoTime(pointer.promotedAt) === null ||
      Date.parse(pointer.receipt.validatedAt) > Date.parse(pointer.promotedAt) ||
      Date.parse(pointer.promotedAt) > Date.parse(input.retiredAt)
    ) return `pointer ${pointer.scope} is not its exact expected permanent replacement`;
  }
  return null;
}

function pdcV2LegacyMeetingsReplacementEvidenceIssue(
  input: PdcV2LegacyMeetingsRetirementInput,
  pointers: readonly PromotedProjection[],
  candidates: readonly CandidateVersionReadback[],
  histories: ReadonlyMap<string, readonly CandidateEvent[]>,
): string | null {
  const pointerIssue = pdcV2LegacyMeetingsReplacementIssue(input, pointers);
  if (pointerIssue !== null) return pointerIssue;
  if (
    candidates.length !== input.replacementPointers.length ||
    new Set(candidates.map(({ candidateId }) => candidateId)).size !== candidates.length
  ) {
    return `expected ${input.replacementPointers.length} permanent candidates, observed ${candidates.length}`;
  }
  const pointerByScope = new Map(pointers.map((pointer) => [pointer.scope, pointer] as const));
  const candidateById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate] as const));
  try {
    const facts = pdcV2CanonicalMeetingFactEvidence(
      input.replacementPointers.map(({ payload }) => payload),
    );
    if (
      facts.sha256 !== input.expected.legacyMeetingFactSha256 ||
      facts.meetingRowCount !== input.expected.meetingRowCount ||
      facts.agendaDocumentRowCount !== input.expected.agendaDocumentRowCount
    ) return "permanent replacement facts do not match the exact legacy fact denominator";
  } catch (error) {
    return `permanent replacement facts are invalid: ${error instanceof Error ? error.message : "unknown"}`;
  }
  for (const expected of input.replacementPointers) {
    const pointer = pointerByScope.get(expected.scope);
    const readback = candidateById.get(expected.versionId);
    const record = readback?.record;
    const candidate = record?.candidate;
    const persistedReceipt = record?.receipt;
    if (!pointer || !readback || !record || !candidate || !persistedReceipt) {
      return `candidate ${expected.versionId} is not the exact promoted replacement for ${expected.scope}`;
    }
    const parsedReceipt = parseValidationReceipt(persistedReceipt);
    if (
      readback.candidateId !== expected.versionId ||
      candidate.id !== expected.versionId ||
      candidate.sourceId !== PDC_V2_LEGACY_MEETINGS_SOURCE_ID ||
      candidate.recordClass !== "MEETING" ||
      candidate.scope !== expected.scope ||
      record.state !== "PROMOTED" ||
      !record.acquisitionSucceeded ||
      !candidate.retrieval.succeeded ||
      record.promotedVersion !== expected.versionId ||
      record.lastKnownGoodVersion !== expected.versionId ||
      record.failureCode !== null ||
      record.failureDetail !== null ||
      parsedReceipt?.decision !== "GOOD" ||
      !receiptIsGoodForCandidate(parsedReceipt, candidate) ||
      !receiptsEqual(parsedReceipt, expected.receipt) ||
      !receiptsEqual(pointer.receipt, parsedReceipt) ||
      Date.parse(candidate.retrieval.retrievedAt) > Date.parse(parsedReceipt.validatedAt) ||
      Date.parse(parsedReceipt.validatedAt) > Date.parse(pointer.promotedAt) ||
      canonicalCivicDataJson(candidate.readModel) !== canonicalCivicDataJson(expected.payload)
    ) {
      return `candidate ${expected.versionId} is not the exact promoted replacement for ${expected.scope}`;
    }

    const events = histories.get(expected.versionId) ?? [];
    if (events.length < 4) {
      return `candidate ${expected.versionId} has no complete durable promotion history`;
    }
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index]!;
      const prior = events[index - 1];
      if (
        event.candidateId !== expected.versionId ||
        event.sequence !== index + 1 ||
        !validEventInput(event) ||
        (prior !== undefined && Date.parse(event.at) < Date.parse(prior.at))
      ) {
        return `candidate ${expected.versionId} has non-contiguous or invalid durable history`;
      }
    }
    if (
      events[0]?.state !== "FETCHED" ||
      events[1]?.state !== "NORMALIZED" ||
      events[2]?.state !== "VALIDATED" ||
      Date.parse(events[2].at) !== Date.parse(parsedReceipt.validatedAt) ||
      events[3]?.state !== "PROMOTED" ||
      Date.parse(events[3].at) !== Date.parse(pointer.promotedAt) ||
      events.slice(4).some(({ state }) => state !== "PROMOTED") ||
      Date.parse(pointer.promotedAt) > Date.parse(input.retiredAt)
    ) {
      return `candidate ${expected.versionId} has no exact VALIDATED-to-PROMOTED history`;
    }
    const contract = MEETING_PARTITION_CONTRACTS.find(({ scope }) => scope === expected.scope);
    const readerReceipts = events.slice(4).map(({ detail }) => parseReaderProjectionReadback(detail));
    if (
      contract === undefined ||
      readerReceipts.length === 0 ||
      readerReceipts.some((receipt, index) =>
        receipt === null ||
        receipt.contractId !== contract.id ||
        receipt.sourceId !== candidate.sourceId ||
        receipt.recordClass !== candidate.recordClass ||
        receipt.scope !== candidate.scope ||
        receipt.projectionId !== contract.readerProjection?.id ||
        receipt.versionId !== candidate.id ||
        receipt.pointerKey !== pointer.key ||
        Date.parse(receipt.observedAt) !== Date.parse(events[index + 4]!.at) ||
        !Number.isFinite(Date.parse(receipt.observedAt))
      ) ||
      readerReceipts.at(-1)?.status !== "PASS"
    ) {
      return `candidate ${expected.versionId} has no current typed Reader PASS evidence`;
    }
  }
  return null;
}

/**
 * Bind replay to the complete replacement authorities which the destructive
 * transaction proved, not merely their projected scope/version/payload list.
 */
interface PdcV2ReplacementHistoryWitness {
  readonly scope: string;
  readonly versionId: string;
  readonly historySha256: string;
  readonly historyEventCount: number;
  readonly historyLastSequence: number;
}

function pdcV2ReplacementHistoryWitnessesValid(
  value: unknown,
): value is readonly PdcV2ReplacementHistoryWitness[] {
  if (!Array.isArray(value) || value.length !== PDC_V2_MEETING_REPLACEMENT_PARTITION_COUNT) {
    return false;
  }
  const exactKeys = [
    "scope",
    "versionId",
    "historySha256",
    "historyEventCount",
    "historyLastSequence",
  ].sort().join("\n");
  const scopes: string[] = [];
  const versions: string[] = [];
  for (const item of value) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return false;
    const row = item as Partial<PdcV2ReplacementHistoryWitness>;
    if (
      Object.keys(row).sort().join("\n") !== exactKeys ||
      typeof row.scope !== "string" || !row.scope ||
      typeof row.versionId !== "string" || !row.versionId ||
      typeof row.historySha256 !== "string" || !SHA256_HEX.test(row.historySha256) ||
      !Number.isInteger(row.historyEventCount) || row.historyEventCount! < 5 ||
      !Number.isInteger(row.historyLastSequence) ||
      row.historyLastSequence !== row.historyEventCount
    ) return false;
    scopes.push(row.scope);
    versions.push(row.versionId);
  }
  return new Set(scopes).size === scopes.length &&
    new Set(versions).size === versions.length &&
    canonicalCivicDataJson(scopes) === canonicalCivicDataJson([...scopes].sort());
}

interface PdcV2ReplacementAuthorityWitness {
  readonly replacementFullPointerSetSha256: string;
  readonly replacementCandidateRecordSetSha256: string;
  readonly replacementHistoryWitnesses: readonly PdcV2ReplacementHistoryWitness[];
  readonly replacementHistorySetSha256: string;
  readonly replacementAuthoritySha256: string;
}

function pdcV2LegacyMeetingsReplacementHistoryWitnessRows(
  input: PdcV2LegacyMeetingsRetirementInput,
  histories: ReadonlyMap<string, readonly CandidateEvent[]>,
  admittedPrefixes?: readonly PdcV2ReplacementHistoryWitness[],
  admittedRetiredAt?: string,
): readonly PdcV2ReplacementHistoryWitness[] {
  if (admittedPrefixes !== undefined) {
    if (
      admittedRetiredAt === undefined ||
      isoTime(admittedRetiredAt) !== admittedRetiredAt ||
      !pdcV2ReplacementHistoryWitnessesValid(admittedPrefixes) ||
      canonicalCivicDataJson(admittedPrefixes.map(({ scope, versionId }) => ({ scope, versionId }))) !==
        canonicalCivicDataJson(input.replacementPointers.map(({ scope, versionId }) => ({ scope, versionId })))
    ) {
      throw new Error(
        "PDC_V2_LEGACY_MEETINGS_REPLACEMENT_DENOMINATOR_INVALID:" +
        "replacement retirement history manifest does not match the exact pointer denominator",
      );
    }
  }
  return input.replacementPointers.map(({ scope, versionId }, index) => {
    const events = histories.get(versionId);
    if (!events) {
      throw new Error(
        `PDC_V2_LEGACY_MEETINGS_REPLACEMENT_DENOMINATOR_INVALID:` +
        `replacement ${scope}/${versionId} has no durable history witness`,
      );
    }
    const admitted = admittedPrefixes?.[index];
    const contract = MEETING_PARTITION_CONTRACTS.find((candidate) => candidate.scope === scope);
    const exactEvents = admitted
      ? [...events].slice(0, admitted.historyEventCount)
      : [...events];
    if (contract === undefined) {
      throw new Error(
        `PDC_V2_LEGACY_MEETINGS_REPLACEMENT_DENOMINATOR_INVALID:` +
        `replacement history has no registered meeting contract:${scope}:${versionId}`,
      );
    }
    const witness: PdcV2ReplacementHistoryWitness = {
      scope,
      versionId,
      historySha256: createHash("sha256")
        .update(canonicalCivicDataJson(exactEvents))
        .digest("hex"),
      historyEventCount: exactEvents.length,
      historyLastSequence: exactEvents.at(-1)?.sequence ?? 0,
    };
    if (admitted) {
      if (canonicalCivicDataJson(witness) !== canonicalCivicDataJson(admitted)) {
        throw new Error(
          `PDC_V2_LEGACY_MEETINGS_REPLACEMENT_DENOMINATOR_INVALID:` +
          `replacement durable history prefix differs from retirement receipt:${scope}:${versionId}`,
        );
      }
      for (const [suffixIndex, event] of [...events]
        .slice(admitted.historyEventCount)
        .entries()) {
        const reader = parseReaderProjectionReadback(event.detail);
        if (
          event.candidateId !== versionId ||
          event.sequence !== admitted.historyLastSequence + suffixIndex + 1 ||
          event.state !== "PROMOTED" ||
          reader?.status !== "PASS" ||
          reader.contractVersion !== 2 ||
          reader.contractId !== contract.id ||
          reader.sourceId !== PDC_V2_LEGACY_MEETINGS_SOURCE_ID ||
          reader.recordClass !== "MEETING" ||
          reader.scope !== scope ||
          reader.projectionId !== contract.readerProjection?.id ||
          reader.versionId !== versionId ||
          reader.pointerKey !== projectionKey("MEETING", scope) ||
          reader.verifierCodeSha !== input.expected.importerCodeSha ||
          Date.parse(reader.observedAt) !== Date.parse(event.at) ||
          Date.parse(event.at) < Date.parse(admittedRetiredAt!) ||
          Date.parse(event.at) > Date.now() + MAX_PROMOTION_CLOCK_SKEW_MS
        ) {
          throw new Error(
            `PDC_V2_LEGACY_MEETINGS_REPLACEMENT_DENOMINATOR_INVALID:` +
            `replacement post-retirement history is not an exact importer Reader PASS:${scope}:${versionId}`,
          );
        }
      }
    }
    return witness;
  });
}

function pdcV2LegacyMeetingsInitialReplacementHistoryBoundaryIssue(
  input: PdcV2LegacyMeetingsRetirementInput,
  histories: ReadonlyMap<string, readonly CandidateEvent[]>,
): string | null {
  for (const { scope, versionId } of input.replacementPointers) {
    const events = histories.get(versionId);
    if (!events || events.some(({ at }) => Date.parse(at) > Date.parse(input.retiredAt))) {
      return `replacement history crosses the admitted retirement boundary:${scope}:${versionId}`;
    }
  }
  return null;
}

function pdcV2LegacyMeetingsReplacementAuthorityWitness(
  input: PdcV2LegacyMeetingsRetirementInput,
  pointers: readonly PromotedProjection[],
  candidates: readonly CandidateVersionReadback[],
  histories: ReadonlyMap<string, readonly CandidateEvent[]>,
  admittedHistoryPrefixes?: readonly PdcV2ReplacementHistoryWitness[],
  admittedRetiredAt?: string,
): PdcV2ReplacementAuthorityWitness {
  const pointerByScope = new Map(pointers.map((pointer) => [pointer.scope, pointer] as const));
  const candidateById = new Map(
    candidates.map(({ candidateId, record }) => [candidateId, record] as const),
  );
  const authorities = input.replacementPointers.map(({ scope, versionId }) => {
    const pointer = pointerByScope.get(scope);
    const candidateRecord = candidateById.get(versionId);
    const events = histories.get(versionId);
    if (!pointer || !candidateRecord || !events) {
      throw new Error(
        `PDC_V2_LEGACY_MEETINGS_REPLACEMENT_DENOMINATOR_INVALID:` +
        `replacement ${scope}/${versionId} has no complete durable witness`,
      );
    }
    const exactEvents = [...events];
    return {
      scope,
      versionId,
      pointerSha256: createHash("sha256")
        .update(canonicalCivicDataJson(pointer))
        .digest("hex"),
      candidateRecordSha256: createHash("sha256")
        .update(canonicalCivicDataJson(candidateRecord))
        .digest("hex"),
      historySha256: createHash("sha256")
        .update(canonicalCivicDataJson(exactEvents))
        .digest("hex"),
      historyEventCount: exactEvents.length,
      historyLastSequence: exactEvents.at(-1)?.sequence ?? 0,
    };
  });
  const replacementFullPointerSetSha256 = createHash("sha256")
    .update(canonicalCivicDataJson(authorities.map(({ scope, versionId, pointerSha256 }) => ({
      scope,
      versionId,
      pointerSha256,
    }))))
    .digest("hex");
  const replacementCandidateRecordSetSha256 = createHash("sha256")
    .update(canonicalCivicDataJson(authorities.map(({
      scope,
      versionId,
      candidateRecordSha256,
    }) => ({ scope, versionId, candidateRecordSha256 }))))
    .digest("hex");
  const replacementHistoryWitnesses = pdcV2LegacyMeetingsReplacementHistoryWitnessRows(
    input,
    histories,
    admittedHistoryPrefixes,
    admittedRetiredAt,
  );
  const replacementHistorySetSha256 = createHash("sha256")
    .update(canonicalCivicDataJson(replacementHistoryWitnesses))
    .digest("hex");
  return {
    replacementFullPointerSetSha256,
    replacementCandidateRecordSetSha256,
    replacementHistoryWitnesses,
    replacementHistorySetSha256,
    replacementAuthoritySha256: createHash("sha256")
      .update(canonicalCivicDataJson({
        replacementFullPointerSetSha256,
        replacementCandidateRecordSetSha256,
        replacementHistorySetSha256,
      }))
      .digest("hex"),
  };
}

function pdcV2LegacyMeetingsCandidateIssue(
  input: PdcV2LegacyMeetingsRetirementInput,
  legacyVersionId: string,
  record: CandidateVersionRecord | null | undefined,
  events: readonly CandidateEvent[],
  pointer: PromotedProjection | null,
  retirementEvent: CandidateEvent | null,
): string | null {
  const candidate = record?.candidate;
  const receipt = parseValidationReceipt(record?.receipt);
  if (
    !record || !candidate || receipt?.decision !== "GOOD" ||
    candidate.id !== legacyVersionId ||
    candidate.sourceId !== PDC_V2_LEGACY_MEETINGS_SOURCE_ID ||
    candidate.recordClass !== "MEETING" ||
    candidate.scope !== PDC_V2_LEGACY_MEETINGS_SCOPE ||
    candidate.bootstrapImport !== undefined ||
    record.state !== "PROMOTED" ||
    !record.acquisitionSucceeded ||
    !candidate.retrieval.succeeded ||
    record.promotedVersion !== legacyVersionId ||
    record.lastKnownGoodVersion !== legacyVersionId ||
    record.failureCode !== null ||
    record.failureDetail !== null ||
    !receiptIsGoodForCandidate(receipt, candidate)
  ) return "retained legacy candidate identity or GOOD proof is invalid";

  try {
    const facts = pdcV2CanonicalMeetingFactEvidence([candidate.readModel]);
    if (
      facts.sha256 !== input.expected.legacyMeetingFactSha256 ||
      facts.meetingRowCount !== input.expected.meetingRowCount ||
      facts.agendaDocumentRowCount !== input.expected.agendaDocumentRowCount
    ) return "retained legacy candidate facts do not match the transfer receipt";
  } catch (error) {
    return `retained legacy candidate facts are invalid: ${error instanceof Error ? error.message : "unknown"}`;
  }

  if (pointer !== null) {
    if (
      input.observedLegacyPayload === null ||
      input.observedLegacyVersionId !== legacyVersionId ||
      input.observedLegacyPointerSha256 !== createHash("sha256")
        .update(canonicalCivicDataJson(pointer))
        .digest("hex") ||
      input.observedLegacyCandidateRecord === null ||
      input.observedLegacyCandidateRecordSha256 !== createHash("sha256")
        .update(canonicalCivicDataJson(record))
        .digest("hex") ||
      canonicalCivicDataJson(input.observedLegacyCandidateRecord) !==
        canonicalCivicDataJson(record) ||
      input.observedLegacyEvents === null ||
      input.observedLegacyHistorySha256 !== createHash("sha256")
        .update(canonicalCivicDataJson(events))
        .digest("hex") ||
      canonicalCivicDataJson(input.observedLegacyEvents) !== canonicalCivicDataJson(events) ||
      pointer.key !== PDC_V2_LEGACY_MEETINGS_KEY ||
      pointer.sourceId !== candidate.sourceId ||
      pointer.recordClass !== candidate.recordClass ||
      pointer.scope !== candidate.scope ||
      pointer.versionId !== legacyVersionId ||
      pointer.lastKnownGoodVersionId !== legacyVersionId ||
      !receiptsEqual(pointer.receipt, receipt) ||
      canonicalCivicDataJson(pointer.payload) !== canonicalCivicDataJson(candidate.readModel) ||
      canonicalCivicDataJson(pointer.payload) !== canonicalCivicDataJson(input.observedLegacyPayload)
    ) return "live legacy pointer is not the exact retained candidate";
  } else if (
    input.observedLegacyPayload !== null ||
    input.observedLegacyCandidateRecord !== null ||
    input.observedLegacyEvents !== null
  ) {
    return "a post-retirement replay supplied live legacy authority evidence";
  }

  if (events.length < 4 + (retirementEvent === null ? 0 : 1)) {
    return "retained legacy candidate history is incomplete";
  }
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    const prior = events[index - 1];
    if (
      event.candidateId !== legacyVersionId ||
      event.sequence !== index + 1 ||
      !validEventInput(event) ||
      (prior !== undefined && Date.parse(event.at) < Date.parse(prior.at)) ||
      Date.parse(event.at) > Date.parse(input.retiredAt)
    ) return "retained legacy candidate history is non-contiguous or has an invalid clock";
  }
  const firstPromoted = events[3];
  if (
    events[0]?.state !== "FETCHED" ||
    events[1]?.state !== "NORMALIZED" ||
    events[2]?.state !== "VALIDATED" ||
    Date.parse(events[2].at) !== Date.parse(receipt.validatedAt) ||
    firstPromoted?.state !== "PROMOTED" ||
    Date.parse(candidate.retrieval.retrievedAt) > Date.parse(receipt.validatedAt) ||
    Date.parse(receipt.validatedAt) > Date.parse(firstPromoted.at) ||
    (pointer !== null && Date.parse(firstPromoted.at) !== Date.parse(pointer.promotedAt))
  ) return "retained legacy candidate has no exact VALIDATED-to-PROMOTED history";

  let retirementCount = 0;
  for (const event of events.slice(4)) {
    const retirement = pdcV2LegacyMeetingsRetirementMatches(event, input.expected);
    if (retirement !== null) {
      retirementCount += 1;
      if (
        retirementEvent === null ||
        event.sequence !== retirementEvent.sequence ||
        event.detail !== retirementEvent.detail ||
        Date.parse(event.at) !== Date.parse(retirementEvent.at)
      ) return "retained legacy candidate has an unexpected retirement event";
      continue;
    }
    const reader = parseReaderProjectionReadback(event.detail);
    if (
      event.state !== "PROMOTED" || reader === null ||
      reader.sourceId !== candidate.sourceId ||
      reader.recordClass !== candidate.recordClass ||
      reader.scope !== candidate.scope ||
      reader.versionId !== candidate.id ||
      reader.pointerKey !== PDC_V2_LEGACY_MEETINGS_KEY ||
      Date.parse(reader.observedAt) !== Date.parse(event.at)
    ) return "retained legacy candidate has untyped repeated-PROMOTED evidence";
  }
  if (
    (retirementEvent === null && retirementCount !== 0) ||
    (retirementEvent !== null && (
      retirementCount !== 1 ||
      events.at(-1)?.sequence !== retirementEvent.sequence ||
      events.at(-1)?.detail !== retirementEvent.detail
    ))
  ) return "retained legacy candidate retirement event is not unique and latest";
  if (retirementEvent !== null) {
    const evidence = pdcV2LegacyMeetingsRetirementMatches(retirementEvent, input.expected);
    const preRetirementEvents = events.slice(0, -1);
    const reconstructedPointer: PromotedProjection = {
      key: PDC_V2_LEGACY_MEETINGS_KEY,
      sourceId: PDC_V2_LEGACY_MEETINGS_SOURCE_ID,
      recordClass: "MEETING",
      scope: PDC_V2_LEGACY_MEETINGS_SCOPE,
      versionId: legacyVersionId,
      lastKnownGoodVersionId: legacyVersionId,
      promotedAt: firstPromoted!.at,
      payload: candidate.readModel,
      receipt,
    };
    if (
      evidence === null ||
      evidence.legacyPointerSha256 !== createHash("sha256")
        .update(canonicalCivicDataJson(reconstructedPointer))
        .digest("hex") ||
      evidence.legacyCandidateRecordSha256 !== createHash("sha256")
        .update(canonicalCivicDataJson(record))
        .digest("hex") ||
      evidence.legacyHistorySha256 !== createHash("sha256")
        .update(canonicalCivicDataJson(preRetirementEvents))
        .digest("hex") ||
      evidence.legacyHistoryEventCount !== preRetirementEvents.length ||
      evidence.legacyHistoryLastSequence !== (preRetirementEvents.at(-1)?.sequence ?? 0)
    ) return "retained legacy authority differs from the exact pre-retirement witness";
  }
  return null;
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
  record: CandidateVersionRecord,
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

/** A historical PROMOTED state is not a clock; only the current pointer and its exact proof are. */
function proofConsistentSuccess(
  record: CandidateVersionRecord | null | undefined,
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

/** Deterministic store used by destructive/failure tests. */
export class MemoryRoutineDataStore implements RoutineDataStore {
  private readonly candidates = new Map<string, CandidateVersionRecord>();
  private readonly history = new Map<string, CandidateEvent[]>();
  private readonly promotions = new Map<string, PromotedProjection>();

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

  async assertPdcV2PreContractMigrationState(): Promise<void> {
    // A fresh memory store models the one permitted pre-0026 state. Tests
    // override this door to prove refusal happens before the first mutation.
  }

  async assertPdcV2PreImportDataIntegrity(
    migrationSql: string,
    _prospectiveReattestationPredecessorIds: readonly string[],
  ): Promise<void> {
    pdcV2ContractMigrationPreflightSql(migrationSql);
  }

  async assertPdcV2ContractMigrationPreflight(migrationSql: string): Promise<void> {
    pdcV2ContractMigrationPreflightSql(migrationSql);
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

  async retirePdcV2LegacyMeetingsAggregate(
    input: PdcV2LegacyMeetingsRetirementInput,
  ): Promise<PdcV2LegacyMeetingsRetirementResult> {
    assertPdcV2LegacyMeetingsRetirementInput(input);
    const permanentPointers = [...this.promotions.values()].flatMap((pointer) =>
      pointer.recordClass === "MEETING" && pointer.scope !== PDC_V2_LEGACY_MEETINGS_SCOPE
        ? [structuredClone(pointer)]
        : []
    );
    const replacementCandidates = input.replacementPointers.flatMap(({ versionId }) => {
      const record = this.candidates.get(versionId);
      return record ? [{ candidateId: versionId, record: structuredClone(record) }] : [];
    });
    const replacementHistories = new Map(
      input.replacementPointers.map(({ versionId }) => [
        versionId,
        structuredClone(this.history.get(versionId) ?? []),
      ] as const),
    );
    // Capture the exact durable rows before any proof parser touches the
    // readback. The subsequent proof and atomic SQL predicates validate this
    // same pre-read witness; they are not allowed to redefine it.
    const replacementAuthorityWitness = pdcV2LegacyMeetingsReplacementAuthorityWitness(
      input,
      permanentPointers,
      replacementCandidates,
      replacementHistories,
    );
    const replacementIssue = pdcV2LegacyMeetingsReplacementEvidenceIssue(
      input,
      permanentPointers,
      replacementCandidates,
      replacementHistories,
    );
    if (replacementIssue !== null) {
      throw new Error(`PDC_V2_LEGACY_MEETINGS_REPLACEMENT_DENOMINATOR_INVALID:${replacementIssue}`);
    }
    const legacyPointers = [...this.promotions.values()].filter((pointer) =>
      pointer.key === PDC_V2_LEGACY_MEETINGS_KEY ||
      (pointer.recordClass === "MEETING" && pointer.scope === PDC_V2_LEGACY_MEETINGS_SCOPE)
    );
    if (legacyPointers.length > 1) {
      throw new Error(`PDC_V2_LEGACY_MEETINGS_POINTER_IDENTITY_INVALID:${legacyPointers.length}`);
    }
    const pointer = legacyPointers[0] ?? null;
    const prefixEvents = [...this.history.values()].flatMap((events) => events)
      .filter(({ detail }) => detail.startsWith(PDC_V2_LEGACY_MEETINGS_RETIREMENT_PREFIX));
    const matchingPrefixEvents = prefixEvents.flatMap((event) => {
      const evidence = pdcV2LegacyMeetingsRetirementMatches(event, input.expected);
      return evidence ? [{ event, evidence }] : [];
    });
    if (!pointer) {
      if (prefixEvents.length !== 1 || matchingPrefixEvents.length !== 1) {
        throw new Error(
          `PDC_V2_LEGACY_MEETINGS_RETIREMENT_RECEIPT_INVALID:` +
          `${prefixEvents.length}:${matchingPrefixEvents.length}`,
        );
      }
      const [{ event, evidence }] = matchingPrefixEvents;
      const replayReplacementAuthorityWitness = pdcV2LegacyMeetingsReplacementAuthorityWitness(
        input,
        permanentPointers,
        replacementCandidates,
        replacementHistories,
        evidence.replacementHistoryWitnesses,
        evidence.retiredAt,
      );
      const replacementWitnessMismatch = ([
        "replacementFullPointerSetSha256",
        "replacementCandidateRecordSetSha256",
        "replacementHistorySetSha256",
        "replacementAuthoritySha256",
      ] as const).find((field) => evidence[field] !== replayReplacementAuthorityWitness[field]);
      if (replacementWitnessMismatch) {
        throw new Error(
          `PDC_V2_LEGACY_MEETINGS_REPLACEMENT_DENOMINATOR_INVALID:` +
          `replacement durable authority witness differs from retirement receipt:` +
          `${replacementWitnessMismatch}:${evidence[replacementWitnessMismatch]}:` +
          replayReplacementAuthorityWitness[replacementWitnessMismatch],
        );
      }
      const legacyRecord = this.candidates.get(evidence.legacyVersionId);
      const legacyIssue = pdcV2LegacyMeetingsCandidateIssue(
        input,
        evidence.legacyVersionId,
        legacyRecord,
        this.history.get(evidence.legacyVersionId) ?? [],
        null,
        event,
      );
      if (legacyIssue !== null) {
        throw new Error(`PDC_V2_LEGACY_MEETINGS_RETAINED_EVIDENCE_INVALID:${legacyIssue}`);
      }
      return {
        disposition: "ALREADY_RETIRED_PROVEN",
        legacyVersionId: evidence.legacyVersionId,
        retiredAt: event.at,
        detail: event.detail,
      };
    }
    const candidate = this.candidates.get(pointer.versionId);
    const legacyIssue = pdcV2LegacyMeetingsCandidateIssue(
      input,
      pointer.versionId,
      candidate,
      this.history.get(pointer.versionId) ?? [],
      pointer,
      null,
    );
    if (legacyIssue !== null) {
      throw new Error(`PDC_V2_LEGACY_MEETINGS_PAYLOAD_CHANGED_BEFORE_RETIREMENT:${legacyIssue}`);
    }
    const replacementBoundaryIssue = pdcV2LegacyMeetingsInitialReplacementHistoryBoundaryIssue(
      input,
      replacementHistories,
    );
    if (replacementBoundaryIssue !== null) {
      throw new Error(
        `PDC_V2_LEGACY_MEETINGS_REPLACEMENT_DENOMINATOR_INVALID:${replacementBoundaryIssue}`,
      );
    }
    if (prefixEvents.length !== 0) {
      throw new Error(`PDC_V2_LEGACY_MEETINGS_RETIREMENT_PREFIX_COLLISION:${prefixEvents.length}`);
    }
    const detail = pdcV2LegacyMeetingsRetirementDetail(
      input,
      pointer.versionId,
      replacementAuthorityWitness,
    );
    const { history, event } = this.nextEvent(pointer.versionId, "PROMOTED", input.retiredAt, detail);
    history.push(structuredClone(event));
    this.history.set(pointer.versionId, history);
    this.promotions.delete(PDC_V2_LEGACY_MEETINGS_KEY);
    return {
      disposition: "RETIRED",
      legacyVersionId: pointer.versionId,
      retiredAt: input.retiredAt,
      detail,
    };
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
    const pointedRecord = pointer?.sourceId === sourceId ? this.candidates.get(pointer.versionId) : null;
    if (pointedRecord && isTrustedLkgImportCandidate(pointedRecord.candidate)) {
      // The cutover successor is neither an attempt nor a success. Do not let
      // a predecessor's old attempt timestamp postpone the first live read.
      return {};
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

function postgresPromotionRowToProjection<T = unknown>(
  row: typeof civicDataPromotions.$inferSelect,
): PromotedProjection<T> {
  return {
    key: row.key,
    sourceId: row.sourceId,
    recordClass: row.recordClass as RoutineRecordClass,
    scope: row.scope,
    versionId: row.currentVersionId,
    lastKnownGoodVersionId: row.lastKnownGoodVersionId,
    promotedAt: canonicalPostgresRoutineTimestamp(row.promotedAt, "promotion.promotedAt"),
    payload: row.payload as T,
    receipt: row.validationReceipt as ValidationReceipt,
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
    candidate: RoutineCandidate,
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

  async assertPdcV2PreContractMigrationState(): Promise<void> {
    const authority = this.assertMutationAuthority();
    if (authority.capability !== "TRUSTED_LKG_IMPORT") {
      throw new RuntimeAuthorityRefused(
        `PDC pre-contract gate requires TRUSTED_LKG_IMPORT, not ${authority.capability}`,
      );
    }
    try {
      // This is a read-only admission assertion. A database-dependent divide
      // by zero makes every false branch abort without relying on a result
      // shape supplied by a particular Drizzle/Neon driver version.
      await this.db.execute(sql`
        select 1 / (case when
          to_regclass('public.civic_data_candidates') is not null
          and to_regclass('public.civic_data_candidate_events') is not null
          and to_regclass('public.civic_data_promotions') is not null
          and to_regclass('drizzle.__drizzle_migrations') is not null
          and ${migrationReceiptAbsentExpression(PDC_V2_CONTRACT_MIGRATION_CREATED_AT)}
          and to_regclass('public.civic_data_candidates_identity_idx') is null
          and (
            select count(*) = 0
            from pg_catalog.pg_constraint
            where conname in (
              'civic_data_candidate_events_candidate_id_civic_data_candidates_id_fk',
              'civic_data_candidates_lkg_candidate_fk',
              'civic_data_promotions_current_candidate_fk',
              'civic_data_promotions_lkg_candidate_fk',
              'civic_data_candidate_events_positive_sequence',
              'civic_data_candidate_events_state_known',
              'civic_data_candidate_events_detail_nonempty',
              'civic_data_candidates_state_known',
              'civic_data_candidates_promotion_fields_coherent',
              'civic_data_candidates_envelope_identity_coherent',
              'civic_data_candidates_disposition_receipt_coherent',
              'civic_data_promotions_key_coherent',
              'civic_data_promotions_lkg_is_current',
              'civic_data_promotions_receipt_identity_coherent'
            )
          )
          and (
            select count(*) = 0
            from pg_catalog.pg_proc procedure
            join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
            where namespace.nspname = 'public'
              and procedure.proname in (
                'enforce_civic_data_candidate_event_insert',
                'refuse_civic_data_candidate_event_mutation',
                'enforce_civic_data_candidate_mutation',
                'assert_civic_data_candidate_history_integrity',
                'enforce_civic_data_promotion_mutation',
                'assert_civic_data_promotion_integrity'
              )
          )
          and (
            select count(*) = 0
            from pg_catalog.pg_trigger
            where not tgisinternal
              and tgname in (
                'civic_data_candidate_events_insert_integrity',
                'civic_data_candidate_events_append_only',
                'civic_data_candidates_immutable_evidence',
                'civic_data_candidates_history_matches_row',
                'civic_data_candidate_events_match_candidate',
                'civic_data_promotions_no_delete_or_rewrite',
                'civic_data_promotions_exact_candidate_proof'
              )
          )
          and has_table_privilege(current_user, 'public.civic_data_candidates', 'SELECT')
          and has_table_privilege(current_user, 'public.civic_data_candidates', 'INSERT')
          and has_table_privilege(current_user, 'public.civic_data_candidates', 'UPDATE')
          and has_table_privilege(current_user, 'public.civic_data_candidate_events', 'SELECT')
          and has_table_privilege(current_user, 'public.civic_data_candidate_events', 'INSERT')
          and has_table_privilege(current_user, 'public.civic_data_promotions', 'SELECT')
          and has_table_privilege(current_user, 'public.civic_data_promotions', 'INSERT')
          and has_table_privilege(current_user, 'public.civic_data_promotions', 'UPDATE')
          and has_table_privilege(current_user, 'public.civic_data_promotions', 'DELETE')
        then 1 else 0 end)::integer as ok
      `);
    } catch {
      throw new Error("PDC_V2_PRECONTRACT_MIGRATION_STATE_REFUSED");
    }
  }

  async assertPdcV2PreImportDataIntegrity(
    migrationSql: string,
    prospectiveReattestationPredecessorIds: readonly string[],
  ): Promise<void> {
    const authority = this.assertMutationAuthority();
    if (authority.capability !== "TRUSTED_LKG_IMPORT") {
      throw new RuntimeAuthorityRefused(
        `PDC pre-import integrity gate requires TRUSTED_LKG_IMPORT, not ${authority.capability}`,
      );
    }
    if (
      new Set(prospectiveReattestationPredecessorIds).size !==
        prospectiveReattestationPredecessorIds.length ||
      prospectiveReattestationPredecessorIds.some((candidateId) =>
        typeof candidateId !== "string" || !candidateId || candidateId.length > 512
      )
    ) {
      throw new Error("PDC_V2_PROSPECTIVE_REATTESTATION_SET_INVALID");
    }
    const preflight = pdcV2ContractMigrationPreflightSql(migrationSql);
    const prospectiveJson = JSON.stringify([...prospectiveReattestationPredecessorIds].sort());
    try {
      // Both statements share one transaction. The custom setting is LOCAL,
      // so it can affect only this exact preflight and cannot leak through a
      // pooled Neon connection into later migration application.
      await this.db.batch([
        this.db.execute(sql`
          select set_config(
            'wtp.pdc_v2_prospective_reattestation_ids',
            ${prospectiveJson},
            true
          )
        `),
        this.db.execute(sql.raw(preflight)),
      ]);
    } catch {
      throw new Error("PDC_V2_PREIMPORT_DATA_INTEGRITY_REFUSED");
    }
  }

  async assertPdcV2ContractMigrationPreflight(migrationSql: string): Promise<void> {
    const authority = this.assertMutationAuthority();
    if (authority.capability !== "TRUSTED_LKG_IMPORT") {
      throw new RuntimeAuthorityRefused(
        `PDC contract-migration preflight requires TRUSTED_LKG_IMPORT, not ${authority.capability}`,
      );
    }
    const preflight = pdcV2ContractMigrationPreflightSql(migrationSql);
    try {
      await this.db.execute(sql.raw(preflight));
    } catch {
      throw new Error("PDC_V2_CONTRACT_MIGRATION_PREFLIGHT_REFUSED");
    }
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
    const updatedCandidateRead = this.db.select()
      .from(civicDataCandidates)
      .where(eq(civicDataCandidates.id, candidateId))
      .limit(1);
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
    return rowToCandidate(updatedRows[0]);
  }

  async readCandidate(candidateId: string): Promise<CandidateVersionRecord | null> {
    const [row] = await this.db.select().from(civicDataCandidates).where(eq(civicDataCandidates.id, candidateId)).limit(1);
    return row ? rowToCandidate(row) : null;
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

  async readCandidates(candidateIds: readonly string[]): Promise<readonly CandidateVersionReadback[]> {
    if (candidateIds.length === 0) return [];
    const rows = await this.db.select().from(civicDataCandidates).where(inArray(civicDataCandidates.id, [...candidateIds]));
    return rows.map((row) => ({ candidateId: row.id, record: rowToCandidate(row) }));
  }

  async appendEvidence(candidateId: string, state: CandidateState, at: string, detail: string): Promise<CandidateEvent> {
    const authority = this.assertMutationAuthority();
    const [candidateRow] = await this.db.select().from(civicDataCandidates).where(eq(civicDataCandidates.id, candidateId)).limit(1);
    if (!candidateRow) throw new Error(`CANDIDATE_NOT_FOUND:${candidateId}`);
    const record = rowToCandidate(candidateRow);
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

  async retirePdcV2LegacyMeetingsAggregate(
    input: PdcV2LegacyMeetingsRetirementInput,
  ): Promise<PdcV2LegacyMeetingsRetirementResult> {
    assertPdcV2LegacyMeetingsRetirementInput(input);
    const authority = this.assertMutationAuthority();
    if (authority.capability !== "TRUSTED_LKG_IMPORT") {
      throw new RuntimeAuthorityRefused(
        `legacy meetings authority transfer requires TRUSTED_LKG_IMPORT, not ${authority.capability}`,
      );
    }
    if (authority.sha !== input.expected.importerCodeSha) {
      throw new RuntimeAuthorityRefused(
        `legacy meetings authority transfer expected importer ${input.expected.importerCodeSha}, not ${authority.sha}`,
      );
    }

    const replacementVersionIds = input.replacementPointers.map(({ versionId }) => versionId);
    const [permanentPointerRows, replacementCandidateRows, replacementEventRows] = await this.db.batch([
      this.db.select().from(civicDataPromotions).where(sql`
        ${civicDataPromotions.recordClass} = 'MEETING'
        and ${civicDataPromotions.scope} <> ${PDC_V2_LEGACY_MEETINGS_SCOPE}
      `),
      this.db.select().from(civicDataCandidates).where(
        inArray(civicDataCandidates.id, replacementVersionIds),
      ),
      this.db.select({
        candidateId: civicDataCandidateEvents.candidateId,
        sequence: civicDataCandidateEvents.sequence,
        state: civicDataCandidateEvents.state,
        at: civicDataCandidateEvents.at,
        detail: civicDataCandidateEvents.detail,
      }).from(civicDataCandidateEvents).where(
        inArray(civicDataCandidateEvents.candidateId, replacementVersionIds),
      ),
    ]);
    const permanentPointers: PromotedProjection[] = permanentPointerRows.map((row) =>
      postgresPromotionRowToProjection(row)
    );
    const replacementCandidates: CandidateVersionReadback[] = replacementCandidateRows.map((row) => ({
      candidateId: row.id,
      record: rowToCandidate(row),
    }));
    const replacementHistories = new Map<string, CandidateEvent[]>(
      replacementVersionIds.map((versionId) => [versionId, []]),
    );
    for (const row of replacementEventRows) {
      replacementHistories.get(row.candidateId)?.push(postgresCandidateEventRowToEvent(row));
    }
    for (const events of replacementHistories.values()) {
      events.sort((left, right) => left.sequence - right.sequence);
    }
    const replacementAuthorityWitness = pdcV2LegacyMeetingsReplacementAuthorityWitness(
      input,
      permanentPointers,
      replacementCandidates,
      replacementHistories,
    );
    const replacementIssue = pdcV2LegacyMeetingsReplacementEvidenceIssue(
      input,
      permanentPointers,
      replacementCandidates,
      replacementHistories,
    );
    if (replacementIssue !== null) {
      throw new Error(`PDC_V2_LEGACY_MEETINGS_REPLACEMENT_DENOMINATOR_INVALID:${replacementIssue}`);
    }

    const replacementRecordById = new Map(
      replacementCandidates.map(({ candidateId, record }) => [candidateId, record] as const),
    );
    const replacementPointerByScope = new Map(
      permanentPointers.map((pointer) => [pointer.scope, pointer] as const),
    );
    const replacementJson = JSON.stringify(input.replacementPointers.map((pointer) => {
      const record = replacementRecordById.get(pointer.versionId);
      const fullPointer = replacementPointerByScope.get(pointer.scope);
      if (!record || !fullPointer) {
        // The in-memory proof above has already established this invariant.
        // Keep the serialized transaction witness total and fail closed if a
        // future refactor ever separates the two checks.
        throw new Error(
          `PDC_V2_LEGACY_MEETINGS_REPLACEMENT_DENOMINATOR_INVALID:` +
          `candidate ${pointer.versionId} disappeared before transaction binding`,
        );
      }
      return {
        ...pointer,
        pointer: fullPointer,
        record,
        events: replacementHistories.get(pointer.versionId) ?? [],
      };
    }));
    const allScopesJson = JSON.stringify(input.allPermanentPartitionScopes);
    const replacementProof = sql`(
      select count(*) = ${input.replacementPointers.length}
      from jsonb_array_elements(${replacementJson}::jsonb) expected
      join ${civicDataPromotions} replacement
        on replacement."key" = 'MEETING:' || (expected->>'scope')
       and replacement."record_class" = 'MEETING'
       and replacement."scope" = expected->>'scope'
       and replacement."source_id" = ${PDC_V2_LEGACY_MEETINGS_SOURCE_ID}
       and replacement."current_version_id" = expected->>'versionId'
       and replacement."last_known_good_version_id" = expected->>'versionId'
       and replacement."promoted_at" = (expected#>>'{pointer,promotedAt}')::timestamptz
       and replacement."payload" = expected->'payload'
       and replacement."validation_receipt" = expected->'receipt'
       and replacement."promoted_at" <= ${input.retiredAt}::timestamptz
      join ${civicDataCandidates} replacement_candidate
        on replacement_candidate."id" = expected->>'versionId'
       and replacement_candidate."id" = replacement."current_version_id"
       and replacement_candidate."source_id" = ${PDC_V2_LEGACY_MEETINGS_SOURCE_ID}
       and replacement_candidate."source_id" = replacement."source_id"
       and replacement_candidate."record_class" = 'MEETING'
       and replacement_candidate."record_class" = replacement."record_class"
       and replacement_candidate."scope" = expected->>'scope'
       and replacement_candidate."scope" = replacement."scope"
       and replacement_candidate."state" = 'PROMOTED'
       and replacement_candidate."acquisition_succeeded" = true
       and replacement_candidate."promoted_version_id" = replacement_candidate."id"
       and replacement_candidate."last_known_good_version_id" = replacement_candidate."id"
       and replacement_candidate."failure_code" is null
       and replacement_candidate."failure_detail" is null
       and replacement_candidate."raw_hash" is not distinct from expected#>>'{record,candidate,retrieval,rawHash}'
       and replacement_candidate."normalized_hash" is not distinct from expected#>>'{record,candidate,normalization,normalizedHash}'
       and replacement_candidate."retrieved_at" = (expected#>>'{record,candidate,retrieval,retrievedAt}')::timestamptz
       and replacement_candidate."source_through" = expected#>>'{record,candidate,temporal,sourceThrough}'
       and replacement_candidate."parser_version" = expected#>>'{record,candidate,normalization,parserVersion}'
       and replacement_candidate."identity" = expected#>'{record,candidate,identities}'
       and replacement_candidate."candidate" = expected#>'{record,candidate}'
       and replacement_candidate."acquisition_succeeded" = (expected#>>'{record,acquisitionSucceeded}')::boolean
       and replacement_candidate."state" = expected#>>'{record,state}'
       and replacement_candidate."validation_receipt" = expected#>'{record,receipt}'
       and replacement_candidate."failure_code" is not distinct from expected#>>'{record,failureCode}'
       and replacement_candidate."failure_detail" is not distinct from expected#>>'{record,failureDetail}'
       and replacement_candidate."promoted_version_id" is not distinct from expected#>>'{record,promotedVersion}'
       and replacement_candidate."last_known_good_version_id" is not distinct from expected#>>'{record,lastKnownGoodVersion}'
       and replacement_candidate."candidate"->>'id' = expected->>'versionId'
       and replacement_candidate."candidate"->>'sourceId' = ${PDC_V2_LEGACY_MEETINGS_SOURCE_ID}
       and replacement_candidate."candidate"->>'recordClass' = 'MEETING'
       and replacement_candidate."candidate"->>'scope' = expected->>'scope'
       and replacement_candidate."candidate"#>'{retrieval,succeeded}' = 'true'::jsonb
       and replacement_candidate."candidate"->'readModel' = expected->'payload'
       and replacement_candidate."validation_receipt" = expected->'receipt'
       and replacement_candidate."validation_receipt" = replacement."validation_receipt"
      where expected->'receipt'->'contractVersion' = '2'::jsonb
        and expected->'receipt'->>'decision' = 'GOOD'
        and expected->'receipt'->>'candidateId' = expected->>'versionId'
        and expected->'receipt'->>'sourceId' = ${PDC_V2_LEGACY_MEETINGS_SOURCE_ID}
        and expected->'receipt'->>'recordClass' = 'MEETING'
        and expected->'receipt'->>'scope' = expected->>'scope'
        and replacement_candidate."retrieved_at" <=
          (expected->'receipt'->>'validatedAt')::timestamptz
        and (expected->'receipt'->>'validatedAt')::timestamptz <= replacement."promoted_at"
        and (
          select count(*) = jsonb_array_length(expected->'events')
          from ${civicDataCandidateEvents} actual_event
          where actual_event."candidate_id" = expected->>'versionId'
        )
        and (
          select count(*) = jsonb_array_length(expected->'events')
          from jsonb_array_elements(expected->'events') expected_event
          join ${civicDataCandidateEvents} actual_event
            on actual_event."candidate_id" = expected_event->>'candidateId'
           and actual_event."sequence" = (expected_event->>'sequence')::integer
           and actual_event."state" = expected_event->>'state'
           and actual_event."at" = (expected_event->>'at')::timestamptz
           and actual_event."detail" = expected_event->>'detail'
          where expected_event->>'candidateId' = expected->>'versionId'
        )
        and (
          select count(*) = max(events."sequence")
            and min(events."sequence") = 1
            and count(*) = count(distinct events."sequence")
            and bool_and(length(btrim(events."detail")) > 0)
          from ${civicDataCandidateEvents} events
          where events."candidate_id" = expected->>'versionId'
        )
        and (
          select count(*) = 1
          from ${civicDataCandidateEvents} fetched
          where fetched."candidate_id" = expected->>'versionId'
            and fetched."sequence" = 1
            and fetched."state" = 'FETCHED'
        )
        and (
          select count(*) = 1
          from ${civicDataCandidateEvents} normalized
          where normalized."candidate_id" = expected->>'versionId'
            and normalized."sequence" = 2
            and normalized."state" = 'NORMALIZED'
        )
        and (
          select count(*) = 1
          from ${civicDataCandidateEvents} validated
          where validated."candidate_id" = expected->>'versionId'
            and validated."sequence" = 3
            and validated."state" = 'VALIDATED'
            and validated."at" = (expected->'receipt'->>'validatedAt')::timestamptz
        )
        and (
          select count(*) = 1
          from ${civicDataCandidateEvents} promoted
          where promoted."candidate_id" = expected->>'versionId'
            and promoted."sequence" = 4
            and promoted."state" = 'PROMOTED'
            and promoted."at" = replacement."promoted_at"
        )
        and not exists (
          select 1
          from ${civicDataCandidateEvents} later
          where later."candidate_id" = expected->>'versionId'
            and later."sequence" > 4
            and later."state" <> 'PROMOTED'
        )
        and not exists (
          select 1
          from ${civicDataCandidateEvents} later
          join ${civicDataCandidateEvents} earlier
            on earlier."candidate_id" = later."candidate_id"
           and earlier."sequence" = later."sequence" - 1
          where later."candidate_id" = expected->>'versionId'
            and later."at" < earlier."at"
        )
    ) and (
      select count(*) = ${input.replacementPointers.length}
      from ${civicDataPromotions} permanent
      where permanent."record_class" = 'MEETING'
        and permanent."scope" <> ${PDC_V2_LEGACY_MEETINGS_SCOPE}
        and permanent."scope" in (
          select jsonb_array_elements_text(${allScopesJson}::jsonb)
        )
    ) and not exists (
      select 1
      from ${civicDataPromotions} unexpected
      where unexpected."record_class" = 'MEETING'
        and unexpected."scope" <> ${PDC_V2_LEGACY_MEETINGS_SCOPE}
        and unexpected."scope" not in (
          select jsonb_array_elements_text(${allScopesJson}::jsonb)
        )
    )`;

    const retirementTableLock = () => this.db.execute(sql`
      lock table ${civicDataCandidates}, ${civicDataCandidateEvents}, ${civicDataPromotions}
      in share row exclusive mode
    `);
    const retainedLegacyProof = (
      candidateId: string,
      record: CandidateVersionRecord,
      events: readonly CandidateEvent[],
    ) => {
      const candidateJson = JSON.stringify(record.candidate);
      const receiptJson = JSON.stringify(record.receipt);
      const identitiesJson = JSON.stringify(record.candidate.identities);
      const eventJson = JSON.stringify(events);
      return sql`(
        select count(*) = 1
        from ${civicDataCandidates} retained
        where retained."id" = ${candidateId}
          and retained."source_id" = ${PDC_V2_LEGACY_MEETINGS_SOURCE_ID}
          and retained."record_class" = 'MEETING'
          and retained."scope" = ${PDC_V2_LEGACY_MEETINGS_SCOPE}
          and retained."state" = 'PROMOTED'
          and retained."acquisition_succeeded" = true
          and retained."raw_hash" is not distinct from ${record.candidate.retrieval.rawHash ?? null}
          and retained."normalized_hash" is not distinct from ${record.candidate.normalization.normalizedHash ?? null}
          and retained."retrieved_at" = ${record.candidate.retrieval.retrievedAt}::timestamptz
          and retained."source_through" = ${record.candidate.temporal.sourceThrough}
          and retained."parser_version" = ${record.candidate.normalization.parserVersion}
          and retained."identity" = ${identitiesJson}::jsonb
          and retained."candidate" = ${candidateJson}::jsonb
          and retained."validation_receipt" = ${receiptJson}::jsonb
          and retained."promoted_version_id" = ${candidateId}
          and retained."last_known_good_version_id" = ${candidateId}
          and retained."failure_code" is null
          and retained."failure_detail" is null
          and (
            select count(*) = ${events.length}
            from ${civicDataCandidateEvents} actual_event
            where actual_event."candidate_id" = ${candidateId}
          )
          and (
            select count(*) = ${events.length}
            from jsonb_array_elements(${eventJson}::jsonb) expected_event
            join ${civicDataCandidateEvents} actual_event
              on actual_event."candidate_id" = expected_event->>'candidateId'
             and actual_event."sequence" = (expected_event->>'sequence')::integer
             and actual_event."state" = expected_event->>'state'
             and actual_event."at" = (expected_event->>'at')::timestamptz
             and actual_event."detail" = expected_event->>'detail'
            where expected_event->>'candidateId' = ${candidateId}
          )
      )`;
    };

    const retirementRows = async () => {
      const rows = await this.db.select({
        candidateId: civicDataCandidateEvents.candidateId,
        sequence: civicDataCandidateEvents.sequence,
        state: civicDataCandidateEvents.state,
        at: civicDataCandidateEvents.at,
        detail: civicDataCandidateEvents.detail,
      }).from(civicDataCandidateEvents).where(sql`
        left(${civicDataCandidateEvents.detail}, ${PDC_V2_LEGACY_MEETINGS_RETIREMENT_PREFIX.length}) =
          ${PDC_V2_LEGACY_MEETINGS_RETIREMENT_PREFIX}
      `);
      const matches = rows.flatMap((row) => {
        const event = postgresCandidateEventRowToEvent(row);
        const evidence = pdcV2LegacyMeetingsRetirementMatches(event, input.expected);
        return evidence ? [{ event, evidence }] : [];
      });
      return { totalPrefixRows: rows.length, matches };
    };

    const legacyCandidateEvidence = async (candidateId: string) => {
      const [candidateRows, eventRows] = await this.db.batch([
        this.db.select().from(civicDataCandidates)
          .where(eq(civicDataCandidates.id, candidateId)).limit(2),
        this.db.select({
          candidateId: civicDataCandidateEvents.candidateId,
          sequence: civicDataCandidateEvents.sequence,
          state: civicDataCandidateEvents.state,
          at: civicDataCandidateEvents.at,
          detail: civicDataCandidateEvents.detail,
        }).from(civicDataCandidateEvents)
          .where(eq(civicDataCandidateEvents.candidateId, candidateId)),
      ]);
      return {
        record: candidateRows.length === 1 ? rowToCandidate(candidateRows[0]!) : null,
        events: eventRows.map(postgresCandidateEventRowToEvent)
          .sort((left, right) => left.sequence - right.sequence),
      };
    };

    const pointerRows = await this.db.select().from(civicDataPromotions).where(sql`
      ${civicDataPromotions.key} = ${PDC_V2_LEGACY_MEETINGS_KEY}
      or (
        ${civicDataPromotions.recordClass} = 'MEETING'
        and ${civicDataPromotions.scope} = ${PDC_V2_LEGACY_MEETINGS_SCOPE}
      )
    `).limit(2);
    if (pointerRows.length > 1) {
      throw new Error(`PDC_V2_LEGACY_MEETINGS_POINTER_IDENTITY_INVALID:${pointerRows.length}`);
    }
    const pointerRow = pointerRows[0];
    if (!pointerRow) {
      const { totalPrefixRows, matches } = await retirementRows();
      if (totalPrefixRows !== 1 || matches.length !== 1) {
        throw new Error(
          `PDC_V2_LEGACY_MEETINGS_RETIREMENT_RECEIPT_INVALID:` +
          `${totalPrefixRows}:${matches.length}`,
        );
      }
      const [{ event, evidence }] = matches;
      const replayReplacementAuthorityWitness = pdcV2LegacyMeetingsReplacementAuthorityWitness(
        input,
        permanentPointers,
        replacementCandidates,
        replacementHistories,
        evidence.replacementHistoryWitnesses,
        evidence.retiredAt,
      );
      const replacementWitnessMismatch = ([
        "replacementFullPointerSetSha256",
        "replacementCandidateRecordSetSha256",
        "replacementHistorySetSha256",
        "replacementAuthoritySha256",
      ] as const).find((field) => evidence[field] !== replayReplacementAuthorityWitness[field]);
      if (replacementWitnessMismatch) {
        throw new Error(
          `PDC_V2_LEGACY_MEETINGS_REPLACEMENT_DENOMINATOR_INVALID:` +
          `replacement durable authority witness differs from retirement receipt:` +
          `${replacementWitnessMismatch}:${evidence[replacementWitnessMismatch]}:` +
          replayReplacementAuthorityWitness[replacementWitnessMismatch],
        );
      }
      const legacy = await legacyCandidateEvidence(evidence.legacyVersionId);
      const legacyIssue = pdcV2LegacyMeetingsCandidateIssue(
        input,
        evidence.legacyVersionId,
        legacy.record,
        legacy.events,
        null,
        event,
      );
      if (legacyIssue !== null) {
        throw new Error(`PDC_V2_LEGACY_MEETINGS_RETAINED_EVIDENCE_INVALID:${legacyIssue}`);
      }
      if (legacy.record === null) {
        throw new Error("PDC_V2_LEGACY_MEETINGS_RETAINED_EVIDENCE_INVALID:candidate missing");
      }
      const replayAssertion = this.db.execute(sql`
        select 1 / (case when
          not exists (
            select 1 from ${civicDataPromotions}
            where ${civicDataPromotions.key} = ${PDC_V2_LEGACY_MEETINGS_KEY}
               or (
                 ${civicDataPromotions.recordClass} = 'MEETING'
                 and ${civicDataPromotions.scope} = ${PDC_V2_LEGACY_MEETINGS_SCOPE}
               )
          )
          and (
            select count(*) = 1
            from ${civicDataCandidateEvents}
            where left(
              ${civicDataCandidateEvents.detail},
              ${PDC_V2_LEGACY_MEETINGS_RETIREMENT_PREFIX.length}
            ) = ${PDC_V2_LEGACY_MEETINGS_RETIREMENT_PREFIX}
              and ${civicDataCandidateEvents.candidateId} = ${event.candidateId}
              and ${civicDataCandidateEvents.sequence} = ${event.sequence}
              and ${civicDataCandidateEvents.state} = 'PROMOTED'
              and ${civicDataCandidateEvents.at} = ${event.at}::timestamptz
              and ${civicDataCandidateEvents.detail} = ${event.detail}
          )
          and ${retainedLegacyProof(evidence.legacyVersionId, legacy.record, legacy.events)}
          and ${replacementProof}
        then 1 else 0 end)::integer as ok
      `);
      await this.db.batch([retirementTableLock(), replayAssertion]);
      return {
        disposition: "ALREADY_RETIRED_PROVEN",
        legacyVersionId: evidence.legacyVersionId,
        retiredAt: event.at,
        detail: event.detail,
      };
    }
    const legacy = await legacyCandidateEvidence(pointerRow.currentVersionId);
    const legacyPointer = postgresPromotionRowToProjection(pointerRow);
    const legacyIssue = pdcV2LegacyMeetingsCandidateIssue(
      input,
      pointerRow.currentVersionId,
      legacy.record,
      legacy.events,
      legacyPointer,
      null,
    );
    if (legacyIssue !== null) {
      throw new Error(`PDC_V2_LEGACY_MEETINGS_CANDIDATE_MISSING:${legacyIssue}`);
    }
    if (legacy.record === null) {
      throw new Error("PDC_V2_LEGACY_MEETINGS_CANDIDATE_MISSING:retained row missing");
    }
    const replacementBoundaryIssue = pdcV2LegacyMeetingsInitialReplacementHistoryBoundaryIssue(
      input,
      replacementHistories,
    );
    if (replacementBoundaryIssue !== null) {
      throw new Error(
        `PDC_V2_LEGACY_MEETINGS_REPLACEMENT_DENOMINATOR_INVALID:${replacementBoundaryIssue}`,
      );
    }
    const existingRetirementRows = await retirementRows();
    if (existingRetirementRows.totalPrefixRows !== 0) {
      throw new Error(
        `PDC_V2_LEGACY_MEETINGS_RETIREMENT_PREFIX_COLLISION:` +
        `${existingRetirementRows.totalPrefixRows}`,
      );
    }

    const detail = pdcV2LegacyMeetingsRetirementDetail(
      input,
      pointerRow.currentVersionId,
      replacementAuthorityWitness,
    );
    const admittedLegacyRecord = input.observedLegacyCandidateRecord;
    const admittedLegacyEvents = input.observedLegacyEvents;
    if (admittedLegacyRecord === null || admittedLegacyEvents === null) {
      throw new Error("PDC_V2_LEGACY_MEETINGS_ADMITTED_AUTHORITY_MISSING");
    }
    const preRetirementLegacyProof = retainedLegacyProof(
      pointerRow.currentVersionId,
      admittedLegacyRecord,
      admittedLegacyEvents,
    );
    const expectedRetirementEvent: CandidateEvent = {
      candidateId: pointerRow.currentVersionId,
      sequence: admittedLegacyEvents.length + 1,
      state: "PROMOTED",
      at: input.retiredAt,
      detail,
    };
    const postRetirementLegacyProof = retainedLegacyProof(
      pointerRow.currentVersionId,
      admittedLegacyRecord,
      [...admittedLegacyEvents, expectedRetirementEvent],
    );
    const observedLegacyPayloadJson = JSON.stringify(input.observedLegacyPayload);
    const observedLegacyReceiptJson = JSON.stringify(pointerRow.validationReceipt);
    const legacyPointerProof = sql`
      ${civicDataPromotions.key} = ${PDC_V2_LEGACY_MEETINGS_KEY}
      and ${civicDataPromotions.sourceId} = ${PDC_V2_LEGACY_MEETINGS_SOURCE_ID}
      and ${civicDataPromotions.recordClass} = 'MEETING'
      and ${civicDataPromotions.scope} = ${PDC_V2_LEGACY_MEETINGS_SCOPE}
      and ${civicDataPromotions.currentVersionId} = ${pointerRow.currentVersionId}
      and ${civicDataPromotions.lastKnownGoodVersionId} = ${pointerRow.currentVersionId}
      and ${civicDataPromotions.promotedAt} = ${pointerRow.promotedAt}::timestamptz
      and ${civicDataPromotions.payload} = ${observedLegacyPayloadJson}::jsonb
      and ${civicDataPromotions.validationReceipt} = ${observedLegacyReceiptJson}::jsonb
    `;
    const nextSequence = this.nextCandidateEventSequence(pointerRow.currentVersionId);
    const insertRetirementEvent = this.db.insert(civicDataCandidateEvents).select(sql`
      select gen_random_uuid(), ${pointerRow.currentVersionId}, ${nextSequence}, 'PROMOTED',
             ${input.retiredAt}::timestamptz, ${detail}
      from ${civicDataCandidates}
      where ${civicDataCandidates.id} = ${pointerRow.currentVersionId}
        and ${civicDataCandidates.sourceId} = ${PDC_V2_LEGACY_MEETINGS_SOURCE_ID}
        and ${civicDataCandidates.recordClass} = 'MEETING'
        and ${civicDataCandidates.scope} = ${PDC_V2_LEGACY_MEETINGS_SCOPE}
        and ${civicDataCandidates.state} = 'PROMOTED'
        and ${civicDataCandidates.promotedVersionId} = ${pointerRow.currentVersionId}
        and ${civicDataCandidates.lastKnownGoodVersionId} = ${pointerRow.currentVersionId}
        and ${civicDataCandidates.candidate}->'readModel' = ${observedLegacyPayloadJson}::jsonb
        and ${civicDataCandidates.validationReceipt} = ${observedLegacyReceiptJson}::jsonb
        and ${input.retiredAt}::timestamptz <= clock_timestamp() + interval '5 minutes'
        and ${input.retiredAt}::timestamptz >= coalesce((
          select max(prior."at")
          from ${civicDataCandidateEvents} prior
          where prior."candidate_id" = ${pointerRow.currentVersionId}
        ), '-infinity'::timestamptz)
        and ${preRetirementLegacyProof}
        and exists (
          select 1 from ${civicDataPromotions}
          where ${legacyPointerProof}
        )
        and (
          select count(*) = 1 from ${civicDataPromotions} legacy_authority
          where legacy_authority."key" = ${PDC_V2_LEGACY_MEETINGS_KEY}
             or (
               legacy_authority."record_class" = 'MEETING'
               and legacy_authority."scope" = ${PDC_V2_LEGACY_MEETINGS_SCOPE}
             )
        )
        and ${replacementProof}
        and not exists (
          select 1 from ${civicDataCandidateEvents}
          where ${civicDataCandidateEvents.detail} = ${detail}
        )
    `);
    const deleteLegacyPointer = this.db.delete(civicDataPromotions).where(sql`
      ${legacyPointerProof}
      and exists (
        select 1 from ${civicDataCandidateEvents}
        where ${civicDataCandidateEvents.candidateId} = ${pointerRow.currentVersionId}
          and ${civicDataCandidateEvents.state} = 'PROMOTED'
          and ${civicDataCandidateEvents.at} = ${input.retiredAt}::timestamptz
          and ${civicDataCandidateEvents.detail} = ${detail}
      )
      and ${postRetirementLegacyProof}
      and ${replacementProof}
    `);
    const finalAssertion = this.db.execute(sql`
      select 1 / (case when
        not exists (
          select 1 from ${civicDataPromotions}
          where ${civicDataPromotions.key} = ${PDC_V2_LEGACY_MEETINGS_KEY}
             or (
               ${civicDataPromotions.recordClass} = 'MEETING'
               and ${civicDataPromotions.scope} = ${PDC_V2_LEGACY_MEETINGS_SCOPE}
             )
        )
        and (
          select count(*) = 1 from ${civicDataCandidateEvents}
          where ${civicDataCandidateEvents.candidateId} = ${pointerRow.currentVersionId}
            and ${civicDataCandidateEvents.state} = 'PROMOTED'
            and ${civicDataCandidateEvents.at} = ${input.retiredAt}::timestamptz
            and ${civicDataCandidateEvents.detail} = ${detail}
        )
        and (
          select count(*) = 1 from ${civicDataCandidateEvents}
          where left(
            ${civicDataCandidateEvents.detail},
            ${PDC_V2_LEGACY_MEETINGS_RETIREMENT_PREFIX.length}
          ) = ${PDC_V2_LEGACY_MEETINGS_RETIREMENT_PREFIX}
        )
        and ${postRetirementLegacyProof}
        and ${replacementProof}
      then 1 else 0 end)::integer as ok
    `);
    await this.db.batch([
      retirementTableLock(),
      this.candidateEventLock(pointerRow.currentVersionId),
      insertRetirementEvent,
      deleteLegacyPointer,
      finalAssertion,
    ]);

    const { totalPrefixRows, matches } = await retirementRows();
    if (totalPrefixRows !== 1 || matches.length !== 1) {
      throw new Error(
        `PDC_V2_LEGACY_MEETINGS_RETIREMENT_READBACK_INVALID:` +
        `${totalPrefixRows}:${matches.length}`,
      );
    }
    const [remainingPointer] = await this.db.select({ key: civicDataPromotions.key })
      .from(civicDataPromotions)
      .where(sql`
        ${civicDataPromotions.key} = ${PDC_V2_LEGACY_MEETINGS_KEY}
        or (
          ${civicDataPromotions.recordClass} = 'MEETING'
          and ${civicDataPromotions.scope} = ${PDC_V2_LEGACY_MEETINGS_SCOPE}
        )
      `).limit(1);
    if (remainingPointer) throw new Error("PDC_V2_LEGACY_MEETINGS_RETIREMENT_POINTER_STILL_PRESENT");
    return {
      disposition: "RETIRED",
      legacyVersionId: pointerRow.currentVersionId,
      retiredAt: input.retiredAt,
      detail,
    };
  }

  async promote(candidateId: string, receipt: ValidationReceipt, at: string): Promise<PromotedProjection> {
    this.assertMutationAuthority();
    const [row] = await this.db.select().from(civicDataCandidates).where(eq(civicDataCandidates.id, candidateId)).limit(1);
    const record = row ? rowToCandidate(row) : null;
    const persistedReceipt = persistedPromotionReceipt(record, receipt);
    if (!record || !persistedReceipt) throw new Error(`CANDIDATE_NOT_PROMOTABLE:${candidateId}`);
    assertPromotionTime(record, persistedReceipt, at);
    this.assertCandidateMutationAuthority(record.candidate);
    const candidate = record.candidate;
    const key = projectionKey(candidate.recordClass, candidate.scope);
    const [prior] = await this.db.select().from(civicDataPromotions).where(eq(civicDataPromotions.key, key)).limit(1);
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
      }).returning();
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
    }).where(sql`${eligibility} and ${pointerOwnsCandidate}`).returning();
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
    return postgresPromotionRowToProjection(promotedRows[0]);
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
    const pointerQuery = this.db
      .select()
      .from(civicDataPromotions)
      .where(and(eq(civicDataPromotions.recordClass, recordClass), eq(civicDataPromotions.scope, scope)))
      .limit(1);
    const [rows, pointerRows] = await this.db.batch([attemptQuery, pointerQuery]);
    // The first event is the store-observed attempt clock. A refused
    // candidate's claimed retrievedAt is evidence, never scheduler authority.
    const lastAttemptedAt = rows[0]?.attemptedAt === undefined
      ? undefined
      : canonicalPostgresRoutineTimestamp(rows[0].attemptedAt, "clock.lastAttemptedAt");
    const pointer = pointerRows[0];
    const [pointedRow] = pointer && pointer.sourceId === sourceId
      ? await this.db.select().from(civicDataCandidates).where(eq(civicDataCandidates.id, pointer.currentVersionId)).limit(1)
      : [];
    const pointedRecord = pointedRow ? rowToCandidate(pointedRow) : null;
    if (pointedRecord && isTrustedLkgImportCandidate(pointedRecord.candidate)) return {};
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
