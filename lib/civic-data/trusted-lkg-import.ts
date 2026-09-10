import { createHash } from "node:crypto";

import {
  candidateChangeSet,
  canonicalCivicDataJson,
  civicRecordsFor,
} from "./changes.ts";
import { parseValidationReceipt } from "./receipt.ts";
import type {
  CandidateVersionRecord,
  PromotedProjection,
  RoutineCandidate,
  TrustedLkgFixtureEvidence,
  TrustedLkgTransferEvidence,
} from "./types.ts";

export const PDC_V2_FROZEN_BASE_SHA = "fc67e8cd34c489590c403f7b4a0d6008fa755296";
export const TRUSTED_LKG_IMPORT_AUTHORIZATION = "PDC_V2_FROZEN_LKG_CUTOVER" as const;
export const TRUSTED_LKG_IMPORT_PURPOSE = "PRESERVE_EXISTING_READER_LKG_DURING_AUTHORITY_TRANSFER" as const;
export const TRUSTED_LKG_REATTESTATION_PURPOSE = "RE_ATTEST_EXISTING_DURABLE_LKG_TO_PERMANENT_INTEGRITY_CONTRACT" as const;

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

/**
 * Content-address the complete JSON candidate proof while avoiding the three
 * fields which are circular (`bootstrapImport`, `id`) or deterministically
 * derived at the promotion door (`changeSet`). JSON round-tripping exactly
 * matches the representation stored in Postgres JSONB, including omission of
 * optional `undefined` members.
 */
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

/**
 * Validate the self-contained import receipt without consulting Git or a
 * mutable store. The one-time executable additionally proves its clean HEAD,
 * ancestry, file bytes, and empty destination pointer before calling the
 * ordinary atomic promotion door.
 */
function trustedLkgFirstSeedEvidenceIssue(candidate: RoutineCandidate): string | null {
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
    return "a frozen LKG import must be marked stale until a live source-authenticated attempt supersedes it";
  }
  if (evidence.frozenBaseSha !== PDC_V2_FROZEN_BASE_SHA) return "the import evidence does not name the frozen PDC-v2 base";
  if (!GIT_SHA.test(evidence.importerCodeSha)) return "the importer code identity is not an exact Git SHA";
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
  if (
    candidate.retrieval.succeeded !== true ||
    candidate.retrieval.requestedUrl !== trustedLkgImportUrl(evidence.contractId) ||
    candidate.retrieval.finalUrl !== null ||
    candidate.retrieval.httpStatus !== null ||
    candidate.retrieval.rawHash !== evidence.fixtureSetSha256 ||
    candidate.retrieval.manualSourceReceipt !== undefined ||
    candidate.retrieval.failureDetail !== undefined
  ) return "the retrieval envelope does not identify only the immutable import manifest";
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
    return "the trusted import normalized payload and Reader projection are not the same exact frozen LKG";
  }
  const records = candidate.civicRecords;
  const excludedFacts = candidate.excludedFacts ?? [];
  if (
    !candidate.normalization.succeeded ||
    !records || records.length === 0 ||
    candidate.normalization.inputRecords !== records.length + excludedFacts.length ||
    candidate.normalization.outputRecords !== records.length ||
    candidate.normalization.droppedRecords !== excludedFacts.length
  ) return "the import does not exactly disposition every frozen input as a promoted civic-record member or an explicit held fact";
  const heldKeys = excludedFacts.map((fact) => fact.key);
  if (
    excludedFacts.some((fact) => !nonempty(fact.code) || !nonempty(fact.detail) || !Object.hasOwn(fact, "record")) ||
    heldKeys.some((key) => !nonempty(key)) ||
    new Set(heldKeys).size !== heldKeys.length ||
    heldKeys.some((key) => records.some((record) => record.key === key))
  ) return "the import has a missing, duplicate, serving, or non-exact held fact";
  const projectedRecords = civicRecordsFor(candidate.recordClass, candidate.readModel);
  if (canonicalCivicDataJson(records) !== canonicalCivicDataJson(projectedRecords)) {
    return "the import civic-record members do not exactly equal the members derived from its bound Reader projection";
  }
  const changeSet = candidate.changeSet;
  if (
    !changeSet ||
    changeSet.outcome !== "CHANGED" ||
    changeSet.added.length !== records.length ||
    changeSet.changed.length !== 0 ||
    changeSet.removed.length !== 0 ||
    changeSet.held.length !== excludedFacts.length ||
    (candidate.removalEvidence?.length ?? 0) !== 0
  ) return "the import change set is not an additive first pointer with exact held members and zero removals";
  const expectedFirstPointerChangeSet = candidateChangeSet({
    ...candidate,
    civicRecords: projectedRecords,
  }, null);
  if (canonicalCivicDataJson(changeSet) !== canonicalCivicDataJson(expectedFirstPointerChangeSet)) {
    return "the import change set does not exactly equal the first-pointer delta derived from its bound Reader projection";
  }
  if (
    candidate.horizon.kind !== "OPEN_FACT_SET" ||
    candidate.horizon.returnedRecords !== records.length ||
    candidate.horizon.declaredTotal !== null ||
    candidate.horizon.paginationComplete !== false ||
    candidate.horizon.claimsComplete !== false
  ) return "a frozen trusted import must make no publisher-universe completeness claim";
  if (
    candidate.absence.claimsAbsence !== false ||
    candidate.absence.basis !== "NONE" ||
    candidate.absence.exactSubject !== null ||
    candidate.absence.exactHorizon !== null
  ) return "a frozen trusted import must make no civic-fact absence claim";
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

function canonicallyEqual(left: unknown, right: unknown): boolean {
  try {
    return canonicalCivicDataJson(left) === canonicalCivicDataJson(right);
  } catch {
    return false;
  }
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

/** Hash the exact mutable pointer observation before its one CAS successor. */
export function trustedLkgPredecessorPointerSha256(pointer: PromotedProjection): string {
  return trustedLkgEvidenceSha256(pointer);
}

/** Hash the exact immutable candidate/version row used as the predecessor. */
export function trustedLkgPredecessorRecordSha256(row: CandidateVersionRecord): string {
  return trustedLkgEvidenceSha256(row);
}

/**
 * Prove an exact successor against the immutable predecessor row. The old
 * pointer is reconstructed from its persisted promotion instant and the old
 * row, then compared with the pointer digest captured before CAS.
 */
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
  const derivedRecords = civicRecordsFor(candidate.recordClass, candidate.readModel);
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
    predecessor.candidate.scope !== candidate.scope ||
    predecessor.candidate.normalization.parserVersion !== candidate.normalization.parserVersion
  ) return "the predecessor and successor do not share one exact registered source contract";
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
  const predecessorDerivedRecords = civicRecordsFor(
    predecessor.candidate.recordClass,
    predecessor.candidate.readModel,
  );
  if (
    predecessor.candidate.civicRecords !== undefined &&
    !canonicallyEqual(predecessor.candidate.civicRecords, predecessorDerivedRecords)
  ) return "the predecessor carries civic members which conflict with its exact Reader projection";
  const copyIssue = reattestationCopyIssue(candidate, predecessor);
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
  const expected = candidateChangeSet(candidate, predecessor.candidate.readModel);
  if (
    !changeSet || changeSet.outcome !== "UNCHANGED" ||
    changeSet.added.length !== 0 || changeSet.changed.length !== 0 || changeSet.removed.length !== 0 ||
    !canonicallyEqual(changeSet, expected)
  ) return "the re-attested successor is not the exact no-data-change delta from its predecessor LKG";
  return null;
}

/** Validate either authorized one-time transfer without a compatibility path. */
export function trustedLkgImportEvidenceIssue(
  candidate: RoutineCandidate,
  predecessor: CandidateVersionRecord | null = null,
): string | null {
  return candidate.bootstrapImport?.kind === "TRUSTED_LKG_REATTESTATION"
    ? trustedLkgReattestationEvidenceIssue(candidate, predecessor)
    : trustedLkgFirstSeedEvidenceIssue(candidate);
}
