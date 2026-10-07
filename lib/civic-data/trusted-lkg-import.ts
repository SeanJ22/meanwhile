import { createHash } from "node:crypto";

import {
  candidateChangeSet,
  canonicalCivicDataJson,
  ROW_KEYED_CIVIC_CHANGE_CONTRACT,
  rowKeyedCivicRecordsFor,
} from "./changes.ts";
import {
  NH_MEMBER_CHAMBER_FLOORS,
  trustedNhMembersImportIdentityEvidence,
  trustedNhMembersImportReadModel,
  type NhMemberReadModel,
} from "./candidate-builders.ts";
import { parseValidationReceipt } from "./receipt.ts";
import { canonicalAgendaDocument } from "../meetings/agenda-documents.ts";
import type { MembersExtraction } from "../../scripts/nh-gencourt-members.mts";
import type {
  CandidateVersionRecord,
  IdentityEvidence,
  NormalizationEvidence,
  PromotedProjection,
  RoutineCandidate,
  TrustedLkgFixtureEvidence,
  TrustedLkgImportEvidence,
  TrustedLkgTransferEvidence,
} from "./types.ts";

export const PDC_V2_FROZEN_BASE_SHA = "fc67e8cd34c489590c403f7b4a0d6008fa755296";
export const TRUSTED_LKG_IMPORT_AUTHORIZATION = "PDC_V2_FROZEN_LKG_CUTOVER" as const;
export const TRUSTED_LKG_IMPORT_PURPOSE = "PRESERVE_EXISTING_READER_LKG_DURING_AUTHORITY_TRANSFER" as const;
export const TRUSTED_LKG_REATTESTATION_PURPOSE = "RE_ATTEST_EXISTING_DURABLE_LKG_TO_PERMANENT_INTEGRITY_CONTRACT" as const;
export const NH_MEMBERS_V2_TO_V3_REATTESTATION = "NH_MEMBERS_V2_TO_V3" as const;
export const NH_MEMBERS_V2_TO_V3_SCHEMA = "NhMemberReadModel:1:trusted-v2-to-v3-import" as const;

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function durableSha256(value: unknown): string | null {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) return null;
    const durable = JSON.parse(encoded) as unknown;
    if (canonicalCivicDataJson(value) !== canonicalCivicDataJson(durable)) return null;
    return sha256(canonicalCivicDataJson(durable));
  } catch {
    return null;
  }
}

export function trustedLkgEvidenceSha256(value: unknown): string {
  const digest = durableSha256(value);
  if (digest === null) throw new Error("TRUSTED_LKG_EVIDENCE_NOT_DURABLE_JSON");
  return digest;
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validFixturePath(path: string): boolean {
  if (!path || path.startsWith("/") || path.includes("\\") || /^[A-Za-z]:/.test(path)) return false;
  const parts = path.split("/");
  return parts.every((part) => part !== "" && part !== "." && part !== "..");
}

export function trustedLkgImportUrl(contractId: string): string {
  return `pdc-v2-trusted-lkg:${encodeURIComponent(contractId)}`;
}

export function trustedLkgFixtureSetSha256(fixtures: readonly TrustedLkgFixtureEvidence[]): string {
  return sha256(canonicalCivicDataJson({ contractVersion: 1, fixtures }));
}

/** Content-addresses the candidate proof minus the circular (`bootstrapImport`, `id`) and door-derived (`changeSet`) fields. */
export function trustedLkgCandidateEnvelopeSha256(candidate: RoutineCandidate): string {
  const envelope = { ...candidate } as Record<string, unknown>;
  delete envelope.id;
  delete envelope.bootstrapImport;
  delete envelope.changeSet;
  const jsonEnvelope = JSON.parse(JSON.stringify(envelope)) as unknown;
  return sha256(canonicalCivicDataJson(jsonEnvelope));
}

export function trustedLkgValidatorIds(candidate: Pick<
  RoutineCandidate,
  "sourceId" | "recordClass" | "scope" | "normalization" | "dependentChecks"
>): readonly string[] {
  return [
    `parser:${candidate.normalization.parserVersion}`,
    `source-projection:${candidate.sourceId}:${candidate.recordClass}:${candidate.scope}`,
    ...candidate.dependentChecks.map((check) => `reader:${check.consumer}`),
  ].sort();
}

export function trustedLkgCandidateId(evidence: TrustedLkgTransferEvidence): string {
  const label = evidence.kind === "TRUSTED_LKG_REATTESTATION" ? "trusted-lkg-reattested" : "trusted-lkg";
  return `${evidence.sourceId}:${label}:${sha256(canonicalCivicDataJson(evidence)).slice(0, 32)}`;
}

export function isTrustedLkgImportCandidate(candidate: unknown): candidate is RoutineCandidate & {
  readonly bootstrapImport: TrustedLkgTransferEvidence;
} {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
  const evidence = (candidate as { readonly bootstrapImport?: unknown }).bootstrapImport;
  return Boolean(
    evidence &&
    typeof evidence === "object" &&
    !Array.isArray(evidence) &&
    ["TRUSTED_LKG_IMPORT", "TRUSTED_LKG_REATTESTATION"].includes(
      String((evidence as { readonly kind?: unknown }).kind),
    ),
  );
}

function trustedLkgFirstSeedEvidenceIssue(
  candidate: RoutineCandidate,
  predecessor: CandidateVersionRecord | null,
): string | null {
  const evidence = candidate.bootstrapImport;
  if (!evidence || evidence.kind !== "TRUSTED_LKG_IMPORT") return "the candidate has no trusted-LKG first-seed evidence";
  if (evidence.contractVersion !== 1 || evidence.kind !== "TRUSTED_LKG_IMPORT") return "the import evidence contract is unsupported";
  if (evidence.authorization !== TRUSTED_LKG_IMPORT_AUTHORIZATION || evidence.purpose !== TRUSTED_LKG_IMPORT_PURPOSE) {
    return "the import evidence is not authorized for the frozen PDC-v2 LKG transfer";
  }
  if (evidence.sourceAuthenticated !== false) return "a trusted LKG import must explicitly say it is not source-authenticated";
  if (!nonempty(evidence.contractId)) return "the import evidence has no exact contract id";
  if (
    evidence.sourceId !== candidate.sourceId ||
    evidence.recordClass !== candidate.recordClass ||
    evidence.scope !== candidate.scope ||
    evidence.parserVersion !== candidate.normalization.parserVersion
  ) return "the import evidence identity or parser does not match the candidate";
  if (
    evidence.sourceVersion !== candidate.temporal.version ||
    evidence.sourceThrough !== candidate.temporal.sourceThrough ||
    evidence.importedAt !== candidate.retrieval.retrievedAt
  ) return "the import evidence version, source-through, or import time does not match the candidate";
  if (!Number.isFinite(Date.parse(evidence.importedAt))) return "the trusted-LKG import time is not an exact readable instant";
  if (candidate.temporal.staleAtRetrieval !== true) {
    return "a trusted LKG transfer must be marked stale until a live source-authenticated attempt supersedes it";
  }
  if (evidence.frozenBaseSha !== PDC_V2_FROZEN_BASE_SHA) return "the import evidence does not name the frozen PDC-v2 base";
  if (!GIT_SHA.test(evidence.importerCodeSha)) return "the importer code identity is not an exact Git SHA";
  const legacyPartitionIssue = evidence.legacyMeetingsPartition
    ? trustedLkgLegacyMeetingsPartitionEvidenceIssue(candidate, evidence)
    : null;
  if (legacyPartitionIssue !== null) return legacyPartitionIssue;
  const outcomeUnionIssue = evidence.pimaOutcomeUnion
    ? trustedLkgPimaOutcomeUnionEvidenceIssue(candidate, evidence, predecessor)
    : null;
  if (outcomeUnionIssue !== null) return outcomeUnionIssue;
  if (!evidence.legacyMeetingsPartition) {
    if (!Array.isArray(evidence.fixtures) || evidence.fixtures.length === 0) return "the import evidence names no immutable fixture bytes";
    const fixturePaths = evidence.fixtures.map((fixture) => fixture.path);
    if (fixturePaths.some((path) => !validFixturePath(path))) return "an import fixture path is absolute, non-canonical, or escapes the repository";
    if (new Set(fixturePaths).size !== fixturePaths.length) return "an import fixture path is duplicated";
    if (canonicalCivicDataJson(fixturePaths) !== canonicalCivicDataJson([...fixturePaths].sort())) return "the import fixture manifest is not path-sorted";
    if (evidence.fixtures.some((fixture) => !SHA256.test(fixture.sha256) || !Number.isSafeInteger(fixture.bytes) || fixture.bytes <= 0)) {
      return "an import fixture lacks an exact SHA-256 or positive byte count";
    }
    if (!SHA256.test(evidence.fixtureSetSha256) || trustedLkgFixtureSetSha256(evidence.fixtures) !== evidence.fixtureSetSha256) {
      return "the fixture-set digest does not match the exact path/hash/byte manifest";
    }
  }
  const expectedRawHash = evidence.legacyMeetingsPartition?.legacyPointerSha256 ??
    evidence.pimaOutcomeUnion?.unionAuthoritySha256 ?? evidence.fixtureSetSha256;
  if (
    candidate.retrieval.succeeded !== true ||
    candidate.retrieval.requestedUrl !== trustedLkgImportUrl(evidence.contractId) ||
    candidate.retrieval.finalUrl !== null ||
    candidate.retrieval.httpStatus !== null ||
    candidate.retrieval.rawHash !== expectedRawHash ||
    candidate.retrieval.manualSourceReceipt !== undefined ||
    candidate.retrieval.failureDetail !== undefined
  ) return "the retrieval envelope does not identify only the immutable transfer authority";
  const normalizedPayloadSha256 = sha256(canonicalCivicDataJson(candidate.normalizedPayload));
  const readModelSha256 = sha256(canonicalCivicDataJson(candidate.readModel));
  if (
    !SHA256.test(evidence.normalizedPayloadSha256) ||
    evidence.normalizedPayloadSha256 !== normalizedPayloadSha256 ||
    evidence.normalizedPayloadSha256 !== candidate.normalization.normalizedPayloadHash
  ) return "the import evidence does not bind the exact normalized payload";
  if (
    !SHA256.test(evidence.readModelSha256) ||
    evidence.readModelSha256 !== readModelSha256 ||
    evidence.readModelSha256 !== candidate.normalization.normalizedHash
  ) {
    return "the import evidence does not bind the exact Reader projection";
  }
  if (canonicalCivicDataJson(candidate.normalizedPayload) !== canonicalCivicDataJson(candidate.readModel)) {
    return "the trusted import normalized payload and Reader projection are not the same exact transferred LKG";
  }
  const records = candidate.civicRecords;
  const excludedFacts = candidate.excludedFacts ?? [];
  if (
    !candidate.normalization.succeeded ||
    !records || records.length === 0 ||
    candidate.normalization.inputRecords !== records.length + excludedFacts.length ||
    candidate.normalization.outputRecords !== records.length ||
    candidate.normalization.droppedRecords !== excludedFacts.length
  ) return "the import does not exactly disposition every transferred input as a promoted civic-record member or an explicit held fact";
  const heldKeys = excludedFacts.map((fact) => fact.key);
  if (
    excludedFacts.some((fact) => !nonempty(fact.code) || !nonempty(fact.detail) || !Object.hasOwn(fact, "record")) ||
    heldKeys.some((key) => !nonempty(key)) ||
    new Set(heldKeys).size !== heldKeys.length ||
    heldKeys.some((key) => records.some((record) => record.key === key))
  ) return "the import has a missing, duplicate, serving, or non-exact held fact";
  // Transfers were written under the row-keyed member contract; they are
  // re-proved against exactly that contract (see `rowKeyedCivicRecordsFor`).
  const projectedRecords = rowKeyedCivicRecordsFor(candidate.recordClass, candidate.readModel);
  if (canonicalCivicDataJson(records) !== canonicalCivicDataJson(projectedRecords)) {
    return "the import civic-record members do not exactly equal the members derived from its bound Reader projection";
  }
  const changeSet = candidate.changeSet;
  const expectedBase = evidence.pimaOutcomeUnion ? predecessor?.candidate.readModel ?? null : null;
  const expectedFirstPointerChangeSet = candidateChangeSet({
    ...candidate,
    civicRecords: projectedRecords,
  }, expectedBase, ROW_KEYED_CIVIC_CHANGE_CONTRACT);
  if (
    !changeSet ||
    changeSet.outcome !== "CHANGED" ||
    changeSet.added.length === 0 ||
    changeSet.changed.length !== 0 ||
    changeSet.removed.length !== 0 ||
    changeSet.held.length !== excludedFacts.length ||
    (candidate.removalEvidence?.length ?? 0) !== 0
  ) return evidence.pimaOutcomeUnion
    ? "the outcome union change set is not a strict additive successor with zero rewrites or removals"
    : "the import change set is not an additive first pointer with exact held members and zero removals";
  if (!evidence.pimaOutcomeUnion && changeSet.added.length !== records.length) {
    return "the import change set is not an additive first pointer with exact held members and zero removals";
  }
  if (canonicalCivicDataJson(changeSet) !== canonicalCivicDataJson(expectedFirstPointerChangeSet)) {
    return evidence.pimaOutcomeUnion
      ? "the outcome union change set differs from the exact predecessor-to-union delta"
      : "the import change set does not exactly equal the first-pointer delta derived from its bound Reader projection";
  }
  if (
    candidate.horizon.kind !== "OPEN_FACT_SET" ||
    candidate.horizon.returnedRecords !== records.length ||
    candidate.horizon.declaredTotal !== null ||
    candidate.horizon.paginationComplete !== false ||
    candidate.horizon.claimsComplete !== false
  ) return "a trusted transfer must make no publisher-universe completeness claim";
  if (
    candidate.absence.claimsAbsence !== false ||
    candidate.absence.basis !== "NONE" ||
    candidate.absence.exactSubject !== null ||
    candidate.absence.exactHorizon !== null
  ) return "a trusted transfer must make no civic-fact absence claim";
  if (
    !SHA256.test(evidence.candidateEnvelopeSha256) ||
    evidence.candidateEnvelopeSha256 !== trustedLkgCandidateEnvelopeSha256(candidate)
  ) return "the import evidence does not bind the complete persisted candidate proof envelope";
  const validatorIds = trustedLkgValidatorIds(candidate);
  if (
    evidence.validatorIds.length === 0 ||
    new Set(evidence.validatorIds).size !== evidence.validatorIds.length ||
    canonicalCivicDataJson(evidence.validatorIds) !== canonicalCivicDataJson(validatorIds)
  ) return "the import validator ids do not exactly name the parser, source projection, and Reader checks";
  if (candidate.id !== trustedLkgCandidateId(evidence)) return "the candidate id is not content-addressed to the complete import evidence";
  return null;
}

function trustedLkgLegacyMeetingsPartitionEvidenceIssue(
  candidate: RoutineCandidate,
  evidence: TrustedLkgImportEvidence,
): string | null {
  const origin = evidence.legacyMeetingsPartition;
  if (!origin) return null;
  if (
    origin.contractVersion !== 1 ||
    origin.kind !== "DURABLE_LEGACY_MEETINGS_PARTITION" ||
    origin.legacyKey !== "MEETING:supported-bodies" ||
    origin.legacySourceId !== "meetings-public-bodies" ||
    origin.legacyRecordClass !== "MEETING" ||
    origin.legacyScope !== "supported-bodies" ||
    candidate.sourceId !== origin.legacySourceId ||
    candidate.recordClass !== "MEETING" ||
    candidate.scope === origin.legacyScope
  ) return "the durable legacy-meetings partition origin has an invalid authority identity";
  if (
    !nonempty(origin.legacyVersionId) ||
    origin.legacyVersionId === candidate.id ||
    !nonempty(origin.partitionSourceName) ||
    !nonempty(origin.partitionBodyId)
  ) return "the durable legacy-meetings partition origin lacks a distinct predecessor or partition identity";
  const legacyPromotedAt = Date.parse(origin.legacyPromotedAt);
  if (
    !Number.isFinite(legacyPromotedAt) ||
    new Date(legacyPromotedAt).toISOString() !== origin.legacyPromotedAt ||
    legacyPromotedAt > Date.parse(evidence.importedAt)
  ) return "the durable legacy-meetings predecessor promotion clock is invalid";
  const hashes = [
    origin.legacyPointerSha256,
    origin.legacyCandidateRecordSha256,
    origin.legacyCandidateSha256,
    origin.legacyReceiptSha256,
    origin.legacyPayloadSha256,
    origin.legacyReadModelSha256,
    origin.legacyNormalizedPayloadSha256,
    origin.legacyHistorySha256,
    origin.legacyMeetingFactSha256,
    origin.partitionFactSha256,
  ];
  if (hashes.some((value) => !SHA256.test(value))) {
    return "the durable legacy-meetings partition origin lacks an exact SHA-256 witness";
  }
  if (
    origin.legacyPayloadSha256 !== origin.legacyReadModelSha256 ||
    origin.legacyPayloadSha256 !== origin.legacyNormalizedPayloadSha256
  ) return "the durable legacy-meetings predecessor payload projections disagree";
  if (
    !Number.isSafeInteger(origin.legacyHistoryEventCount) || origin.legacyHistoryEventCount < 4 ||
    !Number.isSafeInteger(origin.legacyHistoryLastSequence) ||
    origin.legacyHistoryLastSequence !== origin.legacyHistoryEventCount ||
    !Number.isSafeInteger(origin.legacyMeetingRowCount) || origin.legacyMeetingRowCount <= 0 ||
    !Number.isSafeInteger(origin.legacyAgendaDocumentRowCount) || origin.legacyAgendaDocumentRowCount < 0 ||
    !Number.isSafeInteger(origin.partitionMeetingRowCount) || origin.partitionMeetingRowCount <= 0 ||
    !Number.isSafeInteger(origin.partitionAgendaDocumentRowCount) || origin.partitionAgendaDocumentRowCount < 0 ||
    origin.partitionMeetingRowCount > origin.legacyMeetingRowCount ||
    origin.partitionAgendaDocumentRowCount > origin.legacyAgendaDocumentRowCount
  ) return "the durable legacy-meetings transfer carries invalid aggregate or partition counts";
  const snapshot = candidate.readModel as {
    readonly meetings?: unknown;
    readonly agendaDocuments?: unknown;
  };
  if (
    !Array.isArray(snapshot?.meetings) ||
    !Array.isArray(snapshot?.agendaDocuments) ||
    snapshot.meetings.length !== origin.partitionMeetingRowCount ||
    snapshot.agendaDocuments.length !== origin.partitionAgendaDocumentRowCount
  ) return "the durable legacy-meetings partition counts do not match its Reader projection";
  const meetings = (snapshot.meetings as Array<Readonly<Record<string, unknown>>>).map((row) => {
    if (
      row === null || typeof row !== "object" || Array.isArray(row) ||
      typeof row.id !== "string" || !row.id ||
      row.bodyId !== origin.partitionBodyId ||
      !row.id.startsWith(`${origin.partitionSourceName}:`)
    ) return null;
    return row;
  });
  if (meetings.some((row) => row === null)) {
    return "the durable legacy-meetings partition contains a row from another source or body";
  }
  const meetingIds = new Set(meetings.map((row) => row!.id as string));
  const agendaDocuments = (snapshot.agendaDocuments as Array<Readonly<Record<string, unknown>>>).map((row) => {
    if (
      row === null || typeof row !== "object" || Array.isArray(row) ||
      typeof row.id !== "string" || !row.id ||
      typeof row.meetingId !== "string" || !meetingIds.has(row.meetingId)
    ) return null;
    try {
      return canonicalAgendaDocument(
        row as unknown as Parameters<typeof canonicalAgendaDocument>[0],
      );
    } catch {
      return null;
    }
  });
  if (agendaDocuments.some((row) => row === null)) {
    return "the durable legacy-meetings partition contains an invalid or foreign agenda document";
  }
  const canonicalMeetings = meetings
    .map((row) => row!)
    .sort((left, right) =>
      (left.id as string).localeCompare(right.id as string) ||
      canonicalCivicDataJson(left).localeCompare(canonicalCivicDataJson(right))
    );
  const canonicalDocuments = agendaDocuments
    .map((row) => row!)
    .sort((left, right) =>
      left.id.localeCompare(right.id) ||
      canonicalCivicDataJson(left).localeCompare(canonicalCivicDataJson(right))
    );
  if (
    new Set(canonicalMeetings.map(({ id }) => id)).size !== canonicalMeetings.length ||
    new Set(canonicalDocuments.map(({ id }) => id)).size !== canonicalDocuments.length ||
    sha256(canonicalCivicDataJson({
      meetings: canonicalMeetings,
      agendaDocuments: canonicalDocuments,
    })) !== origin.partitionFactSha256
  ) return "the durable legacy-meetings partition fact digest is invalid";
  if (
    !Array.isArray(evidence.fixtures) ||
    evidence.fixtures.length !== 0 ||
    evidence.fixtureSetSha256 !== trustedLkgFixtureSetSha256([])
  ) return "a durable legacy-meetings partition must not claim frozen fixture bytes";
  return null;
}

function trustedLkgPimaOutcomeUnionEvidenceIssue(
  candidate: RoutineCandidate,
  evidence: TrustedLkgImportEvidence,
  predecessor: CandidateVersionRecord | null,
): string | null {
  const origin = evidence.pimaOutcomeUnion;
  if (!origin) return null;
  if (
    evidence.legacyMeetingsPartition !== undefined ||
    origin.contractVersion !== 1 ||
    origin.kind !== "DURABLE_PIMA_OUTCOME_UNION" ||
    evidence.contractId !== "pima-legistar-outcomes" ||
    candidate.sourceId !== "pima-legistar-outcomes" ||
    candidate.recordClass !== "MEETING_OUTCOME" ||
    candidate.scope !== "US-AZ:county:pima:legistar-outcomes"
  ) return "the Pima outcome union has an invalid registered authority identity";
  if (!nonempty(origin.predecessorVersionId) || origin.predecessorVersionId === candidate.id) {
    return "the Pima outcome union lacks a distinct predecessor identity";
  }
  const predecessorPromotedAt = Date.parse(origin.predecessorPromotedAt);
  const frozenGeneratedAt = Date.parse(origin.frozenGeneratedAt);
  if (
    !Number.isFinite(predecessorPromotedAt) ||
    new Date(predecessorPromotedAt).toISOString() !== origin.predecessorPromotedAt ||
    predecessorPromotedAt > Date.parse(evidence.importedAt) ||
    !Number.isFinite(frozenGeneratedAt) ||
    !nonempty(origin.frozenGeneratedOn)
  ) return "the Pima outcome union carries an invalid predecessor or frozen snapshot clock";
  const hashes = [
    origin.predecessorPointerSha256,
    origin.predecessorCandidateRecordSha256,
    origin.predecessorCandidateSha256,
    origin.predecessorReceiptSha256,
    origin.predecessorReadModelSha256,
    origin.unionAuthoritySha256,
  ];
  if (hashes.some((value) => !SHA256.test(value))) {
    return "the Pima outcome union lacks an exact predecessor or authority SHA-256";
  }
  if (
    !Array.isArray(origin.frozenSittings) ||
    origin.frozenSittings.length !== 20 ||
    origin.frozenSittings.some(({ meetingId, sha256: digest }) =>
      !/^legistar:pima:[^:]+$/.test(meetingId) || !SHA256.test(digest)
    ) ||
    new Set(origin.frozenSittings.map(({ meetingId }) => meetingId)).size !== origin.frozenSittings.length ||
    !canonicallyEqual(
      origin.frozenSittings.map(({ meetingId }) => meetingId),
      [...origin.frozenSittings.map(({ meetingId }) => meetingId)].sort(),
    ) ||
    !Number.isSafeInteger(origin.predecessorSittingCount) || origin.predecessorSittingCount <= 0 ||
    !Number.isSafeInteger(origin.unionSittingCount) || origin.unionSittingCount < origin.frozenSittings.length
  ) return "the Pima outcome union sitting denominator or frozen witness set is invalid";
  if (predecessor === null || predecessor.candidate.id !== origin.predecessorVersionId) {
    return "the exact immutable Pima outcome predecessor candidate row is unavailable";
  }
  const prior = predecessor.candidate;
  const predecessorReceipt = parseValidationReceipt(predecessor.receipt);
  if (
    predecessor.state !== "PROMOTED" ||
    predecessor.acquisitionSucceeded !== true ||
    predecessor.promotedVersion !== prior.id ||
    predecessor.lastKnownGoodVersion !== prior.id ||
    !predecessorReceipt || predecessorReceipt.decision !== "GOOD" ||
    predecessorReceipt.candidateId !== prior.id ||
    prior.sourceId !== candidate.sourceId ||
    prior.recordClass !== candidate.recordClass ||
    prior.scope !== candidate.scope ||
    prior.normalization.parserVersion !== candidate.normalization.parserVersion
  ) return "the Pima outcome predecessor is not an exact GOOD authority for the same registered contract";
  const priorReadModelSha256 = durableSha256(prior.readModel);
  const priorNormalizedPayloadSha256 = durableSha256(prior.normalizedPayload);
  if (
    priorReadModelSha256 === null || priorNormalizedPayloadSha256 === null ||
    !SHA256.test(prior.normalization.normalizedHash ?? "") ||
    ![priorReadModelSha256, priorNormalizedPayloadSha256].includes(prior.normalization.normalizedHash ?? "") ||
    (prior.normalization.normalizedPayloadHash !== undefined &&
      prior.normalization.normalizedPayloadHash !== priorNormalizedPayloadSha256)
  ) return "the Pima outcome predecessor payload is not bound by its durable normalization evidence";
  const priorDerivedRecords = rowKeyedCivicRecordsFor(prior.recordClass, prior.readModel);
  if (prior.civicRecords !== undefined && !canonicallyEqual(prior.civicRecords, priorDerivedRecords)) {
    return "the Pima outcome predecessor civic members conflict with its exact Reader projection";
  }
  if (
    origin.predecessorCandidateRecordSha256 !== durableSha256(predecessor) ||
    origin.predecessorCandidateSha256 !== durableSha256(prior) ||
    origin.predecessorReceiptSha256 !== durableSha256(predecessor.receipt) ||
    origin.predecessorReadModelSha256 !== priorReadModelSha256
  ) return "the Pima outcome predecessor row, receipt, or Reader projection differs from its captured witness";
  const reconstructedPointer: PromotedProjection = {
    key: `${candidate.recordClass}:${candidate.scope}`,
    sourceId: prior.sourceId,
    recordClass: prior.recordClass,
    scope: prior.scope,
    versionId: prior.id,
    lastKnownGoodVersionId: prior.id,
    promotedAt: origin.predecessorPromotedAt,
    payload: prior.readModel,
    receipt: predecessorReceipt,
  };
  if (origin.predecessorPointerSha256 !== durableSha256(reconstructedPointer)) {
    return "the exact Pima outcome predecessor pointer cannot be reconstructed";
  }
  const root = jsonObject(candidate.readModel);
  const priorRoot = jsonObject(prior.readModel);
  if (
    !root || !priorRoot ||
    root.generatedOn === undefined || typeof root.generatedOn !== "string" ||
    typeof root.generatedAt !== "string" ||
    !Array.isArray(root.tenants) || !canonicallyEqual(root.tenants, ["pima"]) ||
    !Array.isArray(root.sittings) || !Array.isArray(priorRoot.sittings) ||
    typeof priorRoot.generatedOn !== "string" || typeof priorRoot.generatedAt !== "string"
  ) return "the Pima outcome union or predecessor snapshot shape is invalid";
  const unionById = new Map<string, Record<string, unknown>>();
  for (const value of root.sittings) {
    const sitting = jsonObject(value);
    const meetingId = sitting?.meetingId;
    if (
      !sitting || typeof meetingId !== "string" || !/^legistar:pima:[^:]+$/.test(meetingId) ||
      sitting.slug !== "pima" || unionById.has(meetingId)
    ) return "the Pima outcome union contains an invalid or duplicate sitting identity";
    unionById.set(meetingId, sitting);
  }
  const priorById = new Map<string, Record<string, unknown>>();
  for (const value of priorRoot.sittings) {
    const sitting = jsonObject(value);
    const meetingId = sitting?.meetingId;
    if (
      !sitting || typeof meetingId !== "string" || !/^legistar:pima:[^:]+$/.test(meetingId) ||
      sitting.slug !== "pima" || priorById.has(meetingId)
    ) return "the Pima outcome predecessor contains an invalid or duplicate sitting identity";
    priorById.set(meetingId, sitting);
  }
  if (priorById.size !== origin.predecessorSittingCount || unionById.size !== origin.unionSittingCount) {
    return "the Pima outcome union counts differ from the candidate and predecessor snapshots";
  }
  for (const [meetingId, sitting] of priorById) {
    const unionSitting = unionById.get(meetingId);
    if (!unionSitting || !canonicallyEqual(unionSitting, sitting)) {
      return `the Pima outcome union rewrites or removes durable predecessor ${meetingId}`;
    }
  }
  const frozenIds = new Set<string>();
  for (const witness of origin.frozenSittings) {
    const sitting = unionById.get(witness.meetingId);
    if (!sitting || durableSha256(sitting) !== witness.sha256) {
      return `the Pima outcome union omits or changes frozen sitting ${witness.meetingId}`;
    }
    frozenIds.add(witness.meetingId);
  }
  const exactUnionIds = new Set([...priorById.keys(), ...frozenIds]);
  if (exactUnionIds.size !== unionById.size || [...unionById.keys()].some((id) => !exactUnionIds.has(id))) {
    return "the Pima outcome union contains a sitting outside its two exact authorities";
  }
  const priorAt = Date.parse(priorRoot.generatedAt);
  if (!Number.isFinite(priorAt)) return "the Pima outcome predecessor generated-at clock is invalid";
  const newest = priorAt >= frozenGeneratedAt
    ? { generatedOn: priorRoot.generatedOn, generatedAt: priorRoot.generatedAt }
    : { generatedOn: origin.frozenGeneratedOn, generatedAt: origin.frozenGeneratedAt };
  if (root.generatedOn !== newest.generatedOn || root.generatedAt !== newest.generatedAt) {
    return "the Pima outcome union does not retain the newest exact snapshot header";
  }
  const expectedAuthoritySha256 = sha256(canonicalCivicDataJson({
    fixtureSetSha256: evidence.fixtureSetSha256,
    predecessorPointerSha256: origin.predecessorPointerSha256,
    frozenGeneratedOn: origin.frozenGeneratedOn,
    frozenGeneratedAt: origin.frozenGeneratedAt,
    frozenSittings: origin.frozenSittings,
  }));
  if (origin.unionAuthoritySha256 !== expectedAuthoritySha256) {
    return "the Pima outcome union authority digest differs from its frozen and durable inputs";
  }
  return null;
}

function canonicallyEqual(left: unknown, right: unknown): boolean {
  try {
    return canonicalCivicDataJson(left) === canonicalCivicDataJson(right);
  } catch {
    return false;
  }
}

interface NhMembersV2ToV3BridgeParts {
  readonly readModel: NhMemberReadModel;
  readonly identities: readonly IdentityEvidence[];
  readonly normalization: NormalizationEvidence;
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactObjectKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return canonicallyEqual(Object.keys(value).sort(), [...expected].sort());
}

function exactCivicRecordMemberMap(value: unknown): Map<string, string> | null {
  if (!Array.isArray(value)) return null;
  const members = new Map<string, string>();
  for (const member of value) {
    const row = jsonObject(member);
    if (
      row === null ||
      !exactObjectKeys(row, ["key", "record"]) ||
      !nonempty(row.key) ||
      members.has(row.key)
    ) return null;
    try {
      members.set(row.key, canonicalCivicDataJson(row));
    } catch {
      return null;
    }
  }
  return members;
}

function exactCivicRecordMembership(left: unknown, right: unknown): boolean {
  const leftMembers = exactCivicRecordMemberMap(left);
  const rightMembers = exactCivicRecordMemberMap(right);
  if (
    leftMembers === null ||
    rightMembers === null ||
    leftMembers.size !== rightMembers.size
  ) return false;
  return [...leftMembers].every(([key, member]) => rightMembers.get(key) === member);
}

/** Accepts the one `/2` predecessor whose member array order changed under JSONB; any other member difference is refused. */
function legacyCongressCivicRecordOrderOnly(
  contractId: string,
  predecessor: CandidateVersionRecord,
  derived: unknown,
): boolean {
  const prior = predecessor.candidate;
  return (
    contractId === "congress-bulk-roster" &&
    prior.sourceId === "congress-directory-project" &&
    prior.recordClass === "FEDERAL_DIRECTORY" &&
    prior.scope === "US:current-congress-directory" &&
    prior.normalization.parserVersion === "congress-directory/2" &&
    prior.normalization.normalizedPayloadHash === undefined &&
    prior.normalization.normalizedHash === durableSha256(prior.readModel) &&
    prior.civicRecords !== undefined &&
    !canonicallyEqual(prior.civicRecords, derived) &&
    exactCivicRecordMembership(prior.civicRecords, derived)
  );
}

const LEGACY_NH_MEMBER_KEYS = [
  "chamber",
  "familyName",
  "givenName",
  "middleName",
  "seatNo",
  "county",
  "district",
  "electedStatus",
  "party",
  "title",
  "phone",
  "email",
  "town",
  "committees",
] as const;

function legacyNhMemberShape(value: unknown): boolean {
  const row = jsonObject(value);
  if (!row || !exactObjectKeys(row, LEGACY_NH_MEMBER_KEYS)) return false;
  const nullableText = ["middleName", "party", "title", "phone", "email", "town"];
  return ["chamber", "familyName", "givenName", "seatNo", "county", "district"]
    .every((key) => typeof row[key] === "string") &&
    nullableText.every((key) => row[key] === null || typeof row[key] === "string") &&
    ["INCUMBENT", "NEW", "FORMER", "UNSTATED"].includes(String(row.electedStatus)) &&
    Array.isArray(row.committees) && row.committees.every((item) => typeof item === "string");
}

function legacyNhMembersV2Payload(value: unknown): MembersExtraction | null {
  const root = jsonObject(value);
  if (!root || !exactObjectKeys(root, ["members", "counts", "byStatus", "byChamber"])) return null;
  if (!Array.isArray(root.members) || !root.members.every(legacyNhMemberShape)) return null;
  const members = root.members as unknown as MembersExtraction["members"];
  const counts = jsonObject(root.counts);
  const byStatus = jsonObject(root.byStatus);
  const byChamber = jsonObject(root.byChamber);
  if (!counts || !byStatus || !byChamber) return null;
  const expectedByStatus = { INCUMBENT: 0, NEW: 0, FORMER: 0, UNSTATED: 0 };
  const expectedByChamber: Record<string, number> = {};
  for (const member of members) {
    expectedByStatus[member.electedStatus] += 1;
    expectedByChamber[member.chamber] = (expectedByChamber[member.chamber] ?? 0) + 1;
  }
  const produced = members.length;
  const dropped = counts.dropped;
  if (!Number.isInteger(dropped) || (dropped as number) < 0) return null;
  const expected: MembersExtraction = {
    members,
    counts: {
      logicalInput: produced + (dropped as number),
      produced,
      dropped: dropped as number,
      statedTotal: null,
      verdict: "COULD_NOT_ASSERT",
    },
    byStatus: expectedByStatus,
    byChamber: expectedByChamber,
  };
  return canonicallyEqual(root, expected) ? expected : null;
}

function legacyNhMembersV2Identities(
  members: MembersExtraction["members"],
  term: string,
): readonly IdentityEvidence[] {
  return members.map((member) => {
    const officialComposite =
      `${member.chamber}:${member.seatNo}:${member.district}:${member.email ?? "no-email"}`;
    return {
      subjectId: `nh-general-court:${sha256(officialComposite).slice(0, 20)}`,
      jurisdiction: "US-NH",
      identifiers: {
        seatNo: member.seatNo,
        chamber: member.chamber,
        district: member.district,
        ...(member.email ? { officialEmail: member.email } : {}),
      },
      matchBasis: "OFFICIAL_ID" as const,
      ambiguous: false,
      chamber: member.chamber,
      office: member.title ?? (member.chamber === "S" ? "Senator" : "Representative"),
      term,
      district: member.district,
    };
  });
}

/** A null result is a hard refusal, never a generic parser-version exemption. */
export function trustedLkgNhMembersV2ToV3BridgeParts(
  predecessor: CandidateVersionRecord,
): NhMembersV2ToV3BridgeParts | null {
  const prior = predecessor.candidate;
  const normalization = jsonObject(prior.normalization);
  if (
    !normalization ||
    !exactObjectKeys(normalization, [
      "succeeded",
      "parserVersion",
      "schemaVersion",
      "normalizedHash",
      "inputRecords",
      "outputRecords",
      "droppedRecords",
      "missingRequiredFields",
    ]) ||
    prior.sourceId !== "nh-general-court" ||
    prior.recordClass !== "STATE_LEGISLATOR" ||
    prior.scope !== "US-NH" ||
    prior.normalization.succeeded !== true ||
    prior.normalization.parserVersion !== "nh-general-court/2" ||
    prior.normalization.schemaVersion !== `Members.txt:${prior.temporal.version}` ||
    prior.normalization.normalizedPayloadHash !== undefined ||
    prior.normalization.missingRequiredFields.length !== 0 ||
    prior.normalization.failureDetail !== undefined ||
    prior.temporal.version !== "2025-2026" ||
    prior.bootstrapImport !== undefined
  ) return null;

  const payload = legacyNhMembersV2Payload(prior.normalizedPayload);
  if (!payload) return null;
  const currentByChamber = payload.members
    .filter((member) => member.electedStatus === "INCUMBENT" || member.electedStatus === "NEW")
    .reduce<Record<string, number>>((counts, member) => {
      counts[member.chamber] = (counts[member.chamber] ?? 0) + 1;
      return counts;
    }, {});
  if (
    (currentByChamber.H ?? 0) < NH_MEMBER_CHAMBER_FLOORS.H ||
    (currentByChamber.S ?? 0) < NH_MEMBER_CHAMBER_FLOORS.S
  ) return null;
  const payloadHash = durableSha256(payload);
  const legacyReadModel: NhMemberReadModel = {
    formatVersion: 1,
    jurisdiction: "US-NH",
    term: prior.temporal.version,
    members: payload.members.filter((member) =>
      member.electedStatus === "INCUMBENT" || member.electedStatus === "NEW"
    ),
    // Deliberately omitted below when comparing with the `/2` shape.
    identities: [],
  };
  const { identities: _notInV2, ...exactLegacyReadModel } = legacyReadModel;
  const legacyReadModelHash = durableSha256(exactLegacyReadModel);
  if (
    payloadHash === null ||
    legacyReadModelHash === null ||
    prior.normalization.normalizedHash !== payloadHash ||
    prior.normalization.normalizedHash === legacyReadModelHash ||
    !canonicallyEqual(prior.readModel, exactLegacyReadModel) ||
    !canonicallyEqual(
      prior.identities,
      legacyNhMembersV2Identities(payload.members, prior.temporal.version),
    ) ||
    prior.normalization.inputRecords !== payload.counts.logicalInput ||
    prior.normalization.outputRecords !== payload.counts.produced ||
    prior.normalization.droppedRecords !== payload.counts.dropped
  ) return null;

  let readModel: NhMemberReadModel;
  let identities: readonly IdentityEvidence[];
  try {
    readModel = trustedNhMembersImportReadModel(payload.members, prior.temporal.version);
    identities = trustedNhMembersImportIdentityEvidence(payload.members, prior.temporal.version);
  } catch {
    return null;
  }
  return {
    readModel,
    identities,
    normalization: {
      ...prior.normalization,
      parserVersion: "nh-general-court/3",
      schemaVersion: NH_MEMBERS_V2_TO_V3_SCHEMA,
      normalizedHash: trustedLkgEvidenceSha256(readModel),
      normalizedPayloadHash: payloadHash,
    },
  };
}

function nhMembersV2ToV3CopyIssue(
  candidate: RoutineCandidate,
  predecessor: CandidateVersionRecord,
): string | null {
  const expected = trustedLkgNhMembersV2ToV3BridgeParts(predecessor);
  if (!expected) return "the predecessor is not the exact frozen-software nh-members /2 contract";
  if (!canonicallyEqual(candidate.readModel, expected.readModel)) {
    return "the NH /2 to /3 successor is not the exact deterministic import Reader projection";
  }
  if (!canonicallyEqual(candidate.identities, expected.identities)) {
    return "the NH /2 to /3 successor is not the exact deterministic import identity projection";
  }
  if (!canonicallyEqual(candidate.normalization, expected.normalization)) {
    return "the NH /2 to /3 successor does not carry the exact permanent normalization contract";
  }
  const copied: readonly [string, unknown, unknown][] = [
    ["retrieval", candidate.retrieval, predecessor.candidate.retrieval],
    ["semantics", candidate.semantics, predecessor.candidate.semantics],
    ["horizon", candidate.horizon, predecessor.candidate.horizon],
    ["absence", candidate.absence, predecessor.candidate.absence],
    ["dependent checks", candidate.dependentChecks, predecessor.candidate.dependentChecks],
    ["normalized payload", candidate.normalizedPayload, predecessor.candidate.normalizedPayload],
    ["removal evidence", candidate.removalEvidence ?? [], predecessor.candidate.removalEvidence ?? []],
    ["excluded facts", candidate.excludedFacts ?? [], predecessor.candidate.excludedFacts ?? []],
  ];
  const changed = copied.find(([, successor, previous]) => !canonicallyEqual(successor, previous));
  if (changed) return `the NH /2 to /3 successor changes predecessor ${changed[0]}`;
  if (
    candidate.temporal.version !== predecessor.candidate.temporal.version ||
    candidate.temporal.sourceThrough !== predecessor.candidate.temporal.sourceThrough ||
    candidate.temporal.expectedVersion !== predecessor.candidate.temporal.expectedVersion ||
    candidate.temporal.staleAtRetrieval !== true
  ) {
    return "the NH /2 to /3 successor changes predecessor source time/version facts or claims fresh acquisition";
  }
  return null;
}

function reattestationCopyIssue(
  candidate: RoutineCandidate,
  predecessor: CandidateVersionRecord,
): string | null {
  const prior = predecessor.candidate;
  const copied: readonly [string, unknown, unknown][] = [
    ["retrieval", candidate.retrieval, prior.retrieval],
    ["identities", candidate.identities, prior.identities],
    ["semantics", candidate.semantics, prior.semantics],
    ["horizon", candidate.horizon, prior.horizon],
    ["absence", candidate.absence, prior.absence],
    ["dependent checks", candidate.dependentChecks, prior.dependentChecks],
    ["normalized payload", candidate.normalizedPayload, prior.normalizedPayload],
    ["Reader projection", candidate.readModel, prior.readModel],
    ["removal evidence", candidate.removalEvidence ?? [], prior.removalEvidence ?? []],
    ["excluded facts", candidate.excludedFacts ?? [], prior.excludedFacts ?? []],
  ];
  const changed = copied.find(([, successor, previous]) => !canonicallyEqual(successor, previous));
  if (changed) return `the re-attested successor changes predecessor ${changed[0]}`;

  const successorNormalization = { ...candidate.normalization } as Record<string, unknown>;
  const predecessorNormalization = { ...prior.normalization } as Record<string, unknown>;
  delete successorNormalization.normalizedHash;
  delete successorNormalization.normalizedPayloadHash;
  delete predecessorNormalization.normalizedHash;
  delete predecessorNormalization.normalizedPayloadHash;
  if (!canonicallyEqual(successorNormalization, predecessorNormalization)) {
    return "the re-attested successor changes predecessor normalization facts rather than adding permanent digests";
  }
  if (
    candidate.temporal.version !== prior.temporal.version ||
    candidate.temporal.sourceThrough !== prior.temporal.sourceThrough ||
    candidate.temporal.expectedVersion !== prior.temporal.expectedVersion ||
    candidate.temporal.staleAtRetrieval !== true
  ) {
    return "the re-attested successor changes predecessor source time/version facts or claims fresh acquisition";
  }
  return null;
}

export function trustedLkgPredecessorPointerSha256(pointer: PromotedProjection): string {
  return trustedLkgEvidenceSha256(pointer);
}

export function trustedLkgPredecessorRecordSha256(row: CandidateVersionRecord): string {
  return trustedLkgEvidenceSha256(row);
}

export function trustedLkgReattestationEvidenceIssue(
  candidate: RoutineCandidate,
  predecessor: CandidateVersionRecord | null,
): string | null {
  const evidence = candidate.bootstrapImport;
  if (!evidence || evidence.kind !== "TRUSTED_LKG_REATTESTATION") {
    return "the candidate has no trusted-LKG re-attestation evidence";
  }
  if (
    evidence.contractVersion !== 1 ||
    evidence.authorization !== TRUSTED_LKG_IMPORT_AUTHORIZATION ||
    evidence.purpose !== TRUSTED_LKG_REATTESTATION_PURPOSE ||
    evidence.sourceAuthenticated !== false
  ) return "the re-attestation evidence is not the authorized PDC-v2 integrity transfer";
  if (
    evidence.contractUpgrade !== undefined &&
    evidence.contractUpgrade !== NH_MEMBERS_V2_TO_V3_REATTESTATION
  ) return "the re-attestation names an unsupported contract upgrade";
  const nhV2ToV3 = evidence.contractUpgrade === NH_MEMBERS_V2_TO_V3_REATTESTATION;
  if (nhV2ToV3 && evidence.contractId !== "nh-members") {
    return "the NH /2 to /3 contract upgrade is attached to another contract";
  }
  if (!nonempty(evidence.contractId)) return "the re-attestation evidence has no exact contract id";
  if (
    evidence.sourceId !== candidate.sourceId ||
    evidence.recordClass !== candidate.recordClass ||
    evidence.scope !== candidate.scope ||
    evidence.parserVersion !== candidate.normalization.parserVersion ||
    evidence.sourceVersion !== candidate.temporal.version ||
    evidence.sourceThrough !== candidate.temporal.sourceThrough ||
    evidence.sourceRetrievedAt !== candidate.retrieval.retrievedAt
  ) return "the re-attestation identity, parser, source version, or original retrieval instant does not match the successor";
  const sourceRetrievedAt = Date.parse(evidence.sourceRetrievedAt);
  const reattestedAt = Date.parse(evidence.reattestedAt);
  const predecessorPromotedAt = Date.parse(evidence.predecessorPromotedAt);
  if (
    !Number.isFinite(sourceRetrievedAt) ||
    !Number.isFinite(reattestedAt) ||
    !Number.isFinite(predecessorPromotedAt) ||
    sourceRetrievedAt > predecessorPromotedAt ||
    predecessorPromotedAt > reattestedAt
  ) {
    return "the original retrieval and re-attestation instants are invalid or out of order";
  }
  if (!GIT_SHA.test(evidence.importerCodeSha)) return "the re-attestation importer code identity is not an exact Git SHA";
  if (!nonempty(evidence.predecessorVersionId) || evidence.predecessorVersionId === candidate.id) {
    return "the re-attestation does not name a distinct predecessor version";
  }
  const digestFields = [
    evidence.predecessorPointerSha256,
    evidence.predecessorCandidateRecordSha256,
    evidence.predecessorCandidateSha256,
    evidence.predecessorReceiptSha256,
    evidence.predecessorPayloadSha256,
    evidence.predecessorReadModelSha256,
    evidence.predecessorNormalizedPayloadSha256,
    evidence.predecessorLegacyNormalizedHash,
    evidence.normalizedPayloadSha256,
    evidence.readModelSha256,
    evidence.candidateEnvelopeSha256,
  ];
  if (digestFields.some((digest) => !SHA256.test(digest))) {
    return "the re-attestation is missing an exact lowercase predecessor or successor SHA-256";
  }
  const normalizedPayloadSha256 = durableSha256(candidate.normalizedPayload);
  const readModelSha256 = durableSha256(candidate.readModel);
  if (
    normalizedPayloadSha256 === null || readModelSha256 === null ||
    evidence.normalizedPayloadSha256 !== normalizedPayloadSha256 ||
    candidate.normalization.normalizedPayloadHash !== normalizedPayloadSha256 ||
    evidence.readModelSha256 !== readModelSha256 ||
    candidate.normalization.normalizedHash !== readModelSha256
  ) return "the re-attestation does not bind the exact durable normalized payload and Reader projection";
  if (candidate.temporal.staleAtRetrieval !== true) {
    return "a re-attestation must remain stale until a new source-authenticated acquisition succeeds";
  }
  if (trustedLkgCandidateEnvelopeSha256(candidate) !== evidence.candidateEnvelopeSha256) {
    return "the re-attestation evidence does not bind the complete successor proof envelope";
  }
  const validatorIds = trustedLkgValidatorIds(candidate);
  if (
    evidence.validatorIds.length === 0 ||
    new Set(evidence.validatorIds).size !== evidence.validatorIds.length ||
    !canonicallyEqual(evidence.validatorIds, validatorIds)
  ) return "the re-attestation validator ids do not exactly name its source-scoped contracts";
  if (
    candidate.sourceProjectionEvidence.kind !== "SOURCE_PROJECTION_CONTRACT" ||
    candidate.sourceProjectionEvidence.sourceId !== candidate.sourceId ||
    candidate.sourceProjectionEvidence.recordClass !== candidate.recordClass ||
    candidate.sourceProjectionEvidence.scope !== candidate.scope
  ) return "the re-attested successor lacks exact source-scoped projection evidence";
  const derivedRecords = rowKeyedCivicRecordsFor(candidate.recordClass, candidate.readModel);
  if (!candidate.civicRecords || !canonicallyEqual(candidate.civicRecords, derivedRecords)) {
    return "the re-attested successor civic members differ from its exact Reader projection";
  }
  if (candidate.id !== trustedLkgCandidateId(evidence)) {
    return "the re-attested successor id is not content-addressed to its complete evidence";
  }
  if (predecessor === null) return "the exact immutable predecessor candidate row is unavailable";
  if (predecessor.candidate.id !== evidence.predecessorVersionId) {
    return "the durable predecessor row does not equal the exact predecessor version named by the evidence";
  }
  if (
    predecessor.state !== "PROMOTED" ||
    predecessor.acquisitionSucceeded !== true ||
    predecessor.candidate.retrieval.succeeded !== true ||
    candidate.retrieval.succeeded !== true ||
    predecessor.promotedVersion !== evidence.predecessorVersionId ||
    predecessor.lastKnownGoodVersion !== evidence.predecessorVersionId
  ) return "the predecessor is not an immutable successfully acquired PROMOTED LKG row";
  const predecessorReceipt = parseValidationReceipt(predecessor.receipt);
  if (
    !predecessorReceipt || predecessorReceipt.decision !== "GOOD" ||
    predecessorReceipt.candidateId !== predecessor.candidate.id ||
    predecessorReceipt.sourceId !== predecessor.candidate.sourceId ||
    predecessorReceipt.recordClass !== predecessor.candidate.recordClass ||
    predecessorReceipt.scope !== predecessor.candidate.scope
  ) return "the predecessor has no exact GOOD receipt for its candidate identity";
  const predecessorValidatedAt = Date.parse(predecessorReceipt.validatedAt);
  const predecessorRetrievedAt = Date.parse(predecessor.candidate.retrieval.retrievedAt);
  if (
    !Number.isFinite(predecessorValidatedAt) ||
    !Number.isFinite(predecessorRetrievedAt) ||
    predecessorRetrievedAt > predecessorValidatedAt ||
    predecessorValidatedAt > predecessorPromotedAt
  ) return "the predecessor retrieval, GOOD validation, and promotion instants are invalid or out of order";
  if (
    predecessor.candidate.sourceId !== candidate.sourceId ||
    predecessor.candidate.recordClass !== candidate.recordClass ||
    predecessor.candidate.scope !== candidate.scope
  ) return "the predecessor and successor do not share one exact registered source contract";
  if (
    !nhV2ToV3 &&
    predecessor.candidate.normalization.parserVersion !== candidate.normalization.parserVersion
  ) return "the predecessor and successor do not share one exact registered source contract";
  if (
    nhV2ToV3 &&
    (
      predecessor.candidate.normalization.parserVersion !== "nh-general-court/2" ||
      candidate.normalization.parserVersion !== "nh-general-court/3"
    )
  ) return "the NH contract upgrade is not the exact /2 to /3 transition";
  if (predecessor.candidate.bootstrapImport !== undefined) {
    return "a trusted transfer may not be recursively re-attested";
  }
  const predecessorSourceProjection = predecessor.candidate.sourceProjectionEvidence as unknown;
  if (predecessorSourceProjection !== undefined && predecessorSourceProjection !== null) {
    const evidenceRow = predecessorSourceProjection as Partial<RoutineCandidate["sourceProjectionEvidence"]>;
    if (
      evidenceRow.kind !== "SOURCE_PROJECTION_CONTRACT" ||
      evidenceRow.sourceId !== predecessor.candidate.sourceId ||
      evidenceRow.recordClass !== predecessor.candidate.recordClass ||
      evidenceRow.scope !== predecessor.candidate.scope
    ) return "the predecessor carries a conflicting source-scoped projection claim";
  }
  const predecessorReadModelSha256 = durableSha256(predecessor.candidate.readModel);
  const predecessorNormalizedPayloadSha256 = durableSha256(predecessor.candidate.normalizedPayload);
  const legacyHash = predecessor.candidate.normalization.normalizedHash;
  if (
    predecessorReadModelSha256 === null || predecessorNormalizedPayloadSha256 === null ||
    !legacyHash || !SHA256.test(legacyHash) ||
    (legacyHash !== predecessorReadModelSha256 && legacyHash !== predecessorNormalizedPayloadSha256)
  ) return "the predecessor legacy normalized hash binds neither its Reader projection nor normalized payload";
  if (
    predecessor.candidate.normalization.normalizedPayloadHash !== undefined &&
    predecessor.candidate.normalization.normalizedPayloadHash !== predecessorNormalizedPayloadSha256
  ) return "the predecessor carries a present but incorrect normalized-payload hash";
  const predecessorDerivedRecords = rowKeyedCivicRecordsFor(
    predecessor.candidate.recordClass,
    predecessor.candidate.readModel,
  );
  if (
    predecessor.candidate.civicRecords !== undefined &&
    !canonicallyEqual(predecessor.candidate.civicRecords, predecessorDerivedRecords) &&
    !legacyCongressCivicRecordOrderOnly(
      evidence.contractId,
      predecessor,
      predecessorDerivedRecords,
    )
  ) return "the predecessor carries civic members which conflict with its exact Reader projection";
  const copyIssue = nhV2ToV3
    ? nhMembersV2ToV3CopyIssue(candidate, predecessor)
    : reattestationCopyIssue(candidate, predecessor);
  if (copyIssue !== null) return copyIssue;
  if (
    evidence.predecessorCandidateRecordSha256 !== durableSha256(predecessor) ||
    evidence.predecessorCandidateSha256 !== durableSha256(predecessor.candidate) ||
    evidence.predecessorReceiptSha256 !== durableSha256(predecessorReceipt) ||
    evidence.predecessorReadModelSha256 !== predecessorReadModelSha256 ||
    evidence.predecessorNormalizedPayloadSha256 !== predecessorNormalizedPayloadSha256 ||
    evidence.predecessorLegacyNormalizedHash !== legacyHash ||
    evidence.predecessorPayloadSha256 !== predecessorReadModelSha256
  ) return "the durable predecessor row, candidate, receipt, payload, or legacy digest does not match the captured evidence";
  const reconstructedPointer: PromotedProjection = {
    key: `${candidate.recordClass}:${candidate.scope}`,
    sourceId: predecessor.candidate.sourceId,
    recordClass: predecessor.candidate.recordClass,
    scope: predecessor.candidate.scope,
    versionId: predecessor.candidate.id,
    lastKnownGoodVersionId: predecessor.candidate.id,
    promotedAt: evidence.predecessorPromotedAt,
    payload: predecessor.candidate.readModel,
    receipt: predecessorReceipt,
  };
  if (evidence.predecessorPointerSha256 !== durableSha256(reconstructedPointer)) {
    return "the exact predecessor pointer cannot be reconstructed from its immutable row and captured promotion instant";
  }
  const changeSet = candidate.changeSet;
  const expected = candidateChangeSet(candidate, predecessor.candidate.readModel, ROW_KEYED_CIVIC_CHANGE_CONTRACT);
  if (
    !changeSet || changeSet.outcome !== "UNCHANGED" ||
    changeSet.added.length !== 0 || changeSet.changed.length !== 0 || changeSet.removed.length !== 0 ||
    !canonicallyEqual(changeSet, expected)
  ) return "the re-attested successor is not the exact no-data-change delta from its predecessor LKG";
  return null;
}

export function trustedLkgImportEvidenceIssue(
  candidate: RoutineCandidate,
  predecessor: CandidateVersionRecord | null = null,
): string | null {
  return candidate.bootstrapImport?.kind === "TRUSTED_LKG_REATTESTATION"
    ? trustedLkgReattestationEvidenceIssue(candidate, predecessor)
    : trustedLkgFirstSeedEvidenceIssue(candidate, predecessor);
}
