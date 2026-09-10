import { createHash } from "node:crypto";

import type {
  ReaderClosureExecutionAuthorityEvidence,
  ReaderClosureExecutionPhase,
} from "./reader-census.ts";
import { parseReaderProjectionReadback } from "../civic-data/reader-readback.ts";
import { parseValidationReceipt } from "../civic-data/receipt.ts";
import { promotionProofIssue } from "../civic-data/read-model.ts";
import {
  PDC_V2_FROZEN_BASE_SHA,
  trustedLkgImportEvidenceIssue,
} from "../civic-data/trusted-lkg-import.ts";
import type {
  CandidateVersionRecord,
  PromotedProjection,
  RoutineCandidate,
} from "../civic-data/types.ts";

export const PDC_NEON_PROJECT_ID = "tiny-hill-13996172";
export const PDC_PRODUCTION_BRANCH_ID = "br-delicate-lab-ax02xuo5";
export const READER_AUTHORITY_RELATIONS = [
  "public.civic_data_candidate_events",
  "public.civic_data_candidates",
  "public.civic_data_promotions",
] as const;

const SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const PROJECT_ID = /^[a-z][a-z0-9-]{2,79}$/;
const BRANCH_ID = /^br-[a-z0-9-]{3,100}$/;
const ENDPOINT_ID = /^ep-[a-z0-9-]{3,100}$/;
const METADATA_MAX_AGE_MS = 6 * 60 * 60 * 1_000;
const FUTURE_SKEW_MS = 5 * 60 * 1_000;
const PDC_V2_IMPORT_DISPOSITION_COUNT = 95;
const PDC_V2_ZERO_LKG_MEETING_PARTITIONS = 41;

type Row = Record<string, unknown>;
const row = (value: unknown): Row | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
const exactKeys = (value: Row, expected: readonly string[]) =>
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Reader authority contains a non-finite number");
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalValue);
  const object = row(value);
  if (!object) throw new Error("Reader authority contains a non-canonical value");
  return Object.fromEntries(Object.keys(object).sort().flatMap((key) =>
    object[key] === undefined ? [] : [[key, canonicalValue(object[key])]],
  ));
}

export const canonicalReaderAuthorityJson = (value: unknown) => JSON.stringify(canonicalValue(value));
export const readerAuthorityIdentityHash = (kind: string, value: string) =>
  digest(`reader-postgres-${kind}-v1\0${value}`);

export function canonicalNeonEndpointHost(value: string | URL): string {
  const parsed = value instanceof URL ? value : new URL(value);
  const labels = parsed.hostname.toLowerCase().replace(/\.$/, "").split(".");
  labels[0] = labels[0]!.replace(/-pooler$/, "");
  return labels.join(".");
}

export interface ReaderAuthorityProviderMetadata {
  readonly schemaVersion: 1;
  readonly source: "NEON_API_BRANCH_READBACK";
  readonly observedAt: string;
  readonly projectId: string;
  readonly branchId: string;
  readonly branchName: string;
  readonly parentBranchId: string | null;
  readonly defaultBranchId: string;
  readonly endpointId: string;
  readonly endpointHost: string;
}

export interface ReaderAuthoritySql {
  query(statement: string): Promise<Row[]>;
  /** The adapter must execute this prepared batch as an explicit READ ONLY transaction. */
  readOnlyTransaction(statements: readonly string[]): Promise<readonly Row[][]>;
}

export interface BuildReaderAuthorityOptions {
  readonly phase: ReaderClosureExecutionPhase;
  readonly exactHead: string;
  readonly connection: string;
  readonly providerMetadataPath: string;
  readonly providerMetadataBytes: Buffer;
  readonly importReceiptPath: string;
  readonly importReceiptBytes: Buffer;
  readonly sql: ReaderAuthoritySql;
  readonly nowMs?: number;
}

const secretKey = /(?:password|passwd|secret|token|api[_-]?key|credential|private[_-]?key|database[_-]?url|connection[_-]?string|dsn|cookie|authorization[_-]?header)/i;
function secretProblems(value: unknown, path = "authority input"): string[] {
  if (typeof value === "string") {
    return /\bpostgres(?:ql)?:\/\//i.test(value) || /(?:https?:\/\/)[^\s/@]+:[^\s/@]+@/i.test(value)
      ? [`${path} contains a credential-bearing URL`]
      : [];
  }
  if (Array.isArray(value)) return value.flatMap((child, index) => secretProblems(child, `${path}[${index}]`));
  const object = row(value);
  if (!object) return [];
  return Object.entries(object).flatMap(([key, child]) => [
    ...(secretKey.test(key) && !(key === "legacyRuntimeSecrets" && child === 0)
      ? [`${path}.${key} is a forbidden secret-bearing field`]
      : []),
    ...secretProblems(child, `${path}.${key}`),
  ]);
}

function parseJson(bytes: Buffer, label: string): Row {
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error(`${label} is not JSON`); }
  const object = row(parsed);
  if (!object) throw new Error(`${label} is not an object`);
  const secrets = secretProblems(object, label);
  if (secrets.length) throw new Error(secrets.join("; "));
  return object;
}

function exactIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) &&
    new Date(Date.parse(value)).toISOString() === value;
}

type ImportDisposition = {
  readonly contractId: string;
  readonly candidateId: string;
  readonly disposition:
    | "PROMOTED_ABSENT_POINTER"
    | "REATTESTED_EXISTING_AUTHORITY"
    | "SKIPPED_EXISTING_PROVEN_AUTHORITY";
  readonly versionId: string;
  readonly readerReadback: "PASS";
};

function exactImportDispositionSet(
  value: unknown,
  declaredSha256: unknown,
): readonly ImportDisposition[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Reader import receipt has no exact disposition membership");
  }
  const dispositions = value.map((entry) => {
    const disposition = row(entry);
    if (
      !disposition ||
      !exactKeys(disposition, ["contractId", "candidateId", "disposition", "versionId", "readerReadback"]) ||
      typeof disposition.contractId !== "string" || !disposition.contractId ||
      typeof disposition.candidateId !== "string" || !disposition.candidateId ||
      typeof disposition.versionId !== "string" || !disposition.versionId ||
      !["PROMOTED_ABSENT_POINTER", "REATTESTED_EXISTING_AUTHORITY", "SKIPPED_EXISTING_PROVEN_AUTHORITY"].includes(String(disposition.disposition)) ||
      disposition.readerReadback !== "PASS"
    ) throw new Error("Reader import receipt disposition membership shape is not exact");
    if (
      disposition.disposition !== "SKIPPED_EXISTING_PROVEN_AUTHORITY" &&
      disposition.candidateId !== disposition.versionId
    ) throw new Error("Reader promoted import disposition candidate/version identity differs");
    return disposition as ImportDisposition;
  });
  const contractIds = dispositions.map(({ contractId }) => contractId);
  if (
    new Set(contractIds).size !== contractIds.length ||
    canonicalReaderAuthorityJson(contractIds) !== canonicalReaderAuthorityJson([...contractIds].sort())
  ) throw new Error("Reader import receipt disposition membership is duplicated or not canonically ordered");
  if (
    !SHA256.test(String(declaredSha256)) ||
    digest(canonicalReaderAuthorityJson(dispositions)) !== declaredSha256
  ) throw new Error("Reader import receipt disposition membership digest differs");
  return dispositions;
}

function validateProviderMetadata(
  metadata: Row,
  phase: ReaderClosureExecutionPhase,
  connection: URL,
  nowMs: number,
): ReaderAuthorityProviderMetadata {
  const keys = [
    "schemaVersion", "source", "observedAt", "projectId", "branchId", "branchName",
    "parentBranchId", "defaultBranchId", "endpointId", "endpointHost",
  ];
  if (!exactKeys(metadata, keys)) throw new Error("Reader authority provider metadata shape is not exact");
  if (metadata.schemaVersion !== 1 || metadata.source !== "NEON_API_BRANCH_READBACK") {
    throw new Error("Reader authority metadata is not a provider API readback");
  }
  if (!exactIso(metadata.observedAt)) throw new Error("Reader authority metadata clock is invalid");
  const observed = Date.parse(metadata.observedAt);
  if (observed > nowMs + FUTURE_SKEW_MS || nowMs - observed > METADATA_MAX_AGE_MS) {
    throw new Error("Reader authority provider metadata is not fresh");
  }
  if (
    !PROJECT_ID.test(String(metadata.projectId)) || !BRANCH_ID.test(String(metadata.branchId)) ||
    !BRANCH_ID.test(String(metadata.defaultBranchId)) || !ENDPOINT_ID.test(String(metadata.endpointId)) ||
    typeof metadata.branchName !== "string" || !metadata.branchName ||
    (metadata.parentBranchId !== null && !BRANCH_ID.test(String(metadata.parentBranchId)))
  ) throw new Error("Reader authority provider metadata identifiers are invalid");
  if (metadata.projectId !== PDC_NEON_PROJECT_ID || metadata.defaultBranchId !== PDC_PRODUCTION_BRANCH_ID) {
    throw new Error("Reader authority metadata is outside the pinned PDC Neon project/default branch");
  }
  if (phase === "PRODUCTION") {
    if (metadata.branchId !== PDC_PRODUCTION_BRANCH_ID) {
      throw new Error("Reader PRODUCTION authority is not the pinned production branch");
    }
  } else if (
    metadata.branchId === PDC_PRODUCTION_BRANCH_ID || metadata.parentBranchId !== PDC_PRODUCTION_BRANCH_ID ||
    !metadata.branchName.startsWith("pdc-v2-rehearsal-")
  ) {
    throw new Error("Reader REHEARSAL authority is not a child of the pinned production branch");
  }
  const metadataHost = canonicalNeonEndpointHost(
    new URL(`postgresql://readonly:placeholder@${String(metadata.endpointHost)}/database`),
  );
  const connectionHost = canonicalNeonEndpointHost(connection);
  if (!metadataHost.endsWith(".neon.tech") || metadataHost !== connectionHost) {
    throw new Error("Reader authority connection endpoint differs from provider metadata");
  }
  if (metadataHost.split(".")[0] !== metadata.endpointId) {
    throw new Error("Reader authority endpoint ID differs from provider metadata host");
  }
  return metadata as unknown as ReaderAuthorityProviderMetadata;
}

function validateImportReceipt(
  receipt: Row,
  receiptBytes: Buffer,
  providerMetadataBytes: Buffer,
  phase: ReaderClosureExecutionPhase,
  exactHead: string,
  metadata: ReaderAuthorityProviderMetadata,
): {
  importerCodeSha: string;
  expectedPointerSha256: string | null;
  expectedPointerCount: number;
  dispositions: { promoted: number; reattested: number; skipped: number; total: number };
  dispositionSet: readonly ImportDisposition[];
  dispositionSetSha256: string;
  resultSha256: string;
} {
  if (phase === "REHEARSAL") {
    const keys = [
      "schemaVersion", "result", "mode", "observedAt", "code", "frozen", "neonBranch",
      "databaseIdentity", "authority", "plan", "import", "pointers", "productionMutations",
      "gitMutations", "deploymentMutations", "receiptSha256",
    ];
    if (!exactKeys(receipt, keys)) throw new Error("Reader rehearsal import receipt shape differs from the controller contract");
    const declared = String(receipt.receiptSha256 ?? "");
    const unsigned = { ...receipt };
    delete unsigned.receiptSha256;
    if (!SHA256.test(declared) || digest(canonicalReaderAuthorityJson(unsigned)) !== declared) {
      throw new Error("Reader rehearsal import receipt self-hash differs");
    }
    if (receipt.schemaVersion !== 1 || receipt.result !== "PDC_V2_REHEARSAL_IMPORT_PASS" || receipt.mode !== "apply" || !exactIso(receipt.observedAt)) {
      throw new Error("Reader rehearsal receipt is not a completed import");
    }
    const code = row(receipt.code), branch = row(receipt.neonBranch), pointers = row(receipt.pointers);
    const imported = row(receipt.import);
    const frozen = row(receipt.frozen), plan = row(receipt.plan), authority = row(receipt.authority);
    const databaseIdentity = row(receipt.databaseIdentity);
    if (
      !code || !exactKeys(code, ["exactHeadSha", "detached", "clean", "controllerSha256"]) ||
      code.exactHeadSha !== exactHead || code.detached !== true || code.clean !== true || !SHA256.test(String(code.controllerSha256)) ||
      !frozen || !exactKeys(frozen, ["exactHeadSha", "detached", "clean"]) ||
      frozen.exactHeadSha !== PDC_V2_FROZEN_BASE_SHA || frozen.detached !== true || frozen.clean !== true ||
      !plan || !exactKeys(plan, ["contractVersion", "frozenBaseSha", "importerCodeSha", "candidateCount", "meetingPartitionsWithLkg", "meetingPartitionsWithoutLkg", "meetingRows", "agendaDocumentRows", "manualContracts", "planSha256"]) ||
      plan.contractVersion !== 1 || plan.frozenBaseSha !== PDC_V2_FROZEN_BASE_SHA || plan.importerCodeSha !== exactHead || !SHA256.test(String(plan.planSha256)) ||
      !authority || !exactKeys(authority, ["databaseRoleDeclaration", "sanctionedWrite", "runtimeCapability", "temporarySelfProcessAuthority", "productionHandlePresentAtExecution"]) ||
      authority.databaseRoleDeclaration !== "local" || authority.sanctionedWrite !== false || authority.runtimeCapability !== "TRUSTED_LKG_IMPORT" ||
      authority.temporarySelfProcessAuthority !== true || authority.productionHandlePresentAtExecution !== false ||
      !databaseIdentity || !exactKeys(databaseIdentity, [
        "currentUser", "sessionUser", "database", "currentSchema", "searchPath",
        "transactionReadOnly", "defaultTransactionReadOnly", "inRecovery",
        "canCreateDatabaseObject", "canUsePublicSchema", "canCreateInPublicSchema",
        "ownsRequiredCivicTables", "requiredCivicTablesPresent", "requiredCivicTableWrites",
      ]) ||
      typeof databaseIdentity.currentUser !== "string" || !databaseIdentity.currentUser ||
      databaseIdentity.sessionUser !== databaseIdentity.currentUser ||
      typeof databaseIdentity.database !== "string" || !databaseIdentity.database ||
      databaseIdentity.currentSchema !== "public" || typeof databaseIdentity.searchPath !== "string" ||
      databaseIdentity.transactionReadOnly !== false || databaseIdentity.defaultTransactionReadOnly !== false ||
      databaseIdentity.inRecovery !== false || databaseIdentity.canCreateDatabaseObject !== true ||
      databaseIdentity.canUsePublicSchema !== true || databaseIdentity.canCreateInPublicSchema !== true ||
      databaseIdentity.ownsRequiredCivicTables !== true || databaseIdentity.requiredCivicTablesPresent !== true ||
      databaseIdentity.requiredCivicTableWrites !== true
    ) throw new Error("Reader rehearsal receipt code/frozen/import authority contract differs");
    if (!branch || !exactKeys(branch, [
      "source", "metadataObservedAt", "metadataSha256", "projectId", "branchId", "branchName",
      "parentBranchId", "defaultBranchId", "endpointId", "endpointHostSha256",
      "productionWriteEndpointHostSha256", "productionReadEndpointHostSha256", "independentExpectation",
    ])) throw new Error("Reader rehearsal receipt branch proof shape differs");
    const before = row(pointers?.before), after = row(pointers?.after), expectation = row(branch?.independentExpectation);
    const beforeCounts = row(before?.rowCounts), afterCounts = row(after?.rowCounts);
    if (
      !pointers || !exactKeys(pointers, ["before", "after", "changedKeyMembership", "currentPointerSha256"]) ||
      !before || !after || !exactKeys(before, ["count", "sha256", "rowCounts"]) || !exactKeys(after, ["count", "sha256", "rowCounts"]) ||
      !beforeCounts || !afterCounts || !exactKeys(beforeCounts, ["candidates", "events", "promotions"]) || !exactKeys(afterCounts, ["candidates", "events", "promotions"]) ||
      ![beforeCounts, afterCounts].every((counts) => Object.values(counts).every((value) => typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value))) ||
      !Array.isArray(pointers.changedKeyMembership) || pointers.changedKeyMembership.some((key) => typeof key !== "string" || !key) ||
      new Set(pointers.changedKeyMembership).size !== pointers.changedKeyMembership.length ||
      canonicalReaderAuthorityJson(pointers.changedKeyMembership) !== canonicalReaderAuthorityJson([...pointers.changedKeyMembership].sort()) ||
      !Number.isSafeInteger(before.count) || Number(before.count) < 0 || !SHA256.test(String(before.sha256)) ||
      !Number.isSafeInteger(after.count) || Number(after.count) <= 0 || !SHA256.test(String(after.sha256)) ||
      afterCounts.promotions !== String(after.count) || pointers.currentPointerSha256 !== after.sha256
    ) throw new Error("Reader rehearsal pointer readback schema is not exact");
    if (
      branch.source !== metadata.source || branch.metadataObservedAt !== metadata.observedAt ||
      branch.metadataSha256 !== digest(providerMetadataBytes) || branch.projectId !== metadata.projectId ||
      branch?.branchId !== metadata.branchId || branch?.defaultBranchId !== metadata.defaultBranchId ||
      branch.branchName !== metadata.branchName || branch.parentBranchId !== metadata.parentBranchId ||
      branch.endpointId !== metadata.endpointId || branch.endpointHostSha256 !== digest(canonicalNeonEndpointHost(
        new URL(`postgresql://readonly:placeholder@${metadata.endpointHost}/database`),
      )) ||
      !SHA256.test(String(branch.productionWriteEndpointHostSha256)) || !SHA256.test(String(branch.productionReadEndpointHostSha256)) ||
      !expectation || !exactKeys(expectation, ["projectId", "branchId", "branchName", "parentBranchId", "productionBranchId"]) ||
      expectation.projectId !== metadata.projectId || expectation.branchId !== metadata.branchId ||
      expectation.branchName !== metadata.branchName || expectation.parentBranchId !== metadata.parentBranchId ||
      expectation.productionBranchId !== PDC_PRODUCTION_BRANCH_ID
    ) throw new Error("Reader rehearsal import receipt differs from exact code/provider authority");
    if (
      !imported || !exactKeys(imported, ["contractVersion", "frozenBaseSha", "importerCodeSha", "importedAt", "promoted", "reattestedExisting", "skippedExisting", "zeroMeetingPartitionsRefused", "dispositionCount", "dispositionCounts", "dispositionSet", "dispositionSetSha256", "legacyMeetingsAggregateRetirement", "resultSha256"]) ||
      imported.contractVersion !== 1 || imported.frozenBaseSha !== PDC_V2_FROZEN_BASE_SHA || imported.importerCodeSha !== exactHead ||
      !exactIso(imported.importedAt) || !SHA256.test(String(imported.resultSha256)) ||
      imported.zeroMeetingPartitionsRefused !== PDC_V2_ZERO_LKG_MEETING_PARTITIONS
    ) throw new Error("Reader rehearsal nested importer receipt differs from exact code/frozen authority");
    const retirement = row(imported.legacyMeetingsAggregateRetirement);
    if (
      !retirement || !exactKeys(retirement, ["disposition", "legacyVersionId", "retiredAt", "legacyMeetingFactSha256", "replacementPointerSha256"]) ||
      !["RETIRED", "ALREADY_RETIRED_PROVEN"].includes(String(retirement.disposition)) ||
      typeof retirement.legacyVersionId !== "string" || !retirement.legacyVersionId || !exactIso(retirement.retiredAt) ||
      !SHA256.test(String(retirement.legacyMeetingFactSha256)) || !SHA256.test(String(retirement.replacementPointerSha256)) ||
      receipt.productionMutations !== 0 || receipt.gitMutations !== 0 || receipt.deploymentMutations !== 0
    ) throw new Error("Reader rehearsal retirement/mutation evidence is not exact");
    const dispositionSet = exactImportDispositionSet(imported.dispositionSet, imported.dispositionSetSha256);
    const count = Number(after?.count);
    const pointerSha = String(pointers?.currentPointerSha256 ?? "");
    if (!Number.isSafeInteger(count) || count <= 0 || !SHA256.test(pointerSha) || after?.sha256 !== pointerSha) {
      throw new Error("Reader rehearsal import receipt has no exact resulting pointer set");
    }
    const dispositions = {
      promoted: Number(imported?.promoted),
      reattested: Number(imported?.reattestedExisting),
      skipped: Number(imported?.skippedExisting),
      total: Number(imported?.dispositionCount),
    };
    if (
      !Object.values(dispositions).every(Number.isSafeInteger) ||
      dispositions.promoted < 0 || dispositions.reattested < 0 || dispositions.skipped < 0 ||
      dispositions.promoted + dispositions.skipped !== dispositions.total ||
      dispositions.reattested > dispositions.promoted ||
      dispositionSet.length !== dispositions.total || dispositions.total !== PDC_V2_IMPORT_DISPOSITION_COUNT
    ) throw new Error("Reader rehearsal import receipt disposition denominator is invalid");
    const dispositionCounts = row(imported.dispositionCounts);
    const allowedDispositionKeys = ["PROMOTED_ABSENT_POINTER", "REATTESTED_EXISTING_AUTHORITY", "SKIPPED_EXISTING_PROVEN_AUTHORITY"];
    if (
      !dispositionCounts || Object.keys(dispositionCounts).some((key) => !allowedDispositionKeys.includes(key)) ||
      Object.values(dispositionCounts).some((value) => !Number.isSafeInteger(value) || Number(value) <= 0) ||
      Number(dispositionCounts.PROMOTED_ABSENT_POINTER ?? 0) + Number(dispositionCounts.REATTESTED_EXISTING_AUTHORITY ?? 0) !== dispositions.promoted ||
      Number(dispositionCounts.REATTESTED_EXISTING_AUTHORITY ?? 0) !== dispositions.reattested ||
      Number(dispositionCounts.SKIPPED_EXISTING_PROVEN_AUTHORITY ?? 0) !== dispositions.skipped
    ) throw new Error("Reader rehearsal import disposition classes differ from the exact denominator");
    const membershipCounts = {
      promoted: dispositionSet.filter(({ disposition }) => disposition !== "SKIPPED_EXISTING_PROVEN_AUTHORITY").length,
      reattested: dispositionSet.filter(({ disposition }) => disposition === "REATTESTED_EXISTING_AUTHORITY").length,
      skipped: dispositionSet.filter(({ disposition }) => disposition === "SKIPPED_EXISTING_PROVEN_AUTHORITY").length,
      total: dispositionSet.length,
    };
    if (canonicalReaderAuthorityJson(membershipCounts) !== canonicalReaderAuthorityJson(dispositions)) {
      throw new Error("Reader rehearsal disposition counts differ from their exact membership");
    }
    if (
      !["candidateCount", "meetingPartitionsWithLkg", "meetingPartitionsWithoutLkg", "meetingRows", "agendaDocumentRows", "manualContracts"].every((field) => Number.isSafeInteger(plan[field]) && Number(plan[field]) >= 0) ||
      plan.candidateCount !== dispositions.total ||
      plan.meetingPartitionsWithoutLkg !== imported.zeroMeetingPartitionsRefused ||
      Number(plan.meetingPartitionsWithLkg) + Number(plan.manualContracts) !== Number(plan.candidateCount)
    ) throw new Error("Reader rehearsal plan denominator differs from its durable import dispositions");
    return {
      importerCodeSha: exactHead,
      expectedPointerSha256: pointerSha,
      expectedPointerCount: count,
      dispositions,
      dispositionSet,
      dispositionSetSha256: String(imported.dispositionSetSha256),
      resultSha256: String(imported.resultSha256),
    };
  }

  const keys = [
    "schemaVersion", "result", "apply", "observedAt", "importSha", "frozenBaseSha",
    "migrationBlobSha1", "cutoverContractSha256", "narrowRoleProofSha256", "githubProofSha256",
    "lineage", "prewriteAdmission", "preImportAuthority", "github", "host", "import",
    "postImport", "commitBAdmissionReady",
  ];
  if (!exactKeys(receipt, keys)) throw new Error("Reader production authority-transfer receipt shape differs");
  const imported = row(receipt.import), postImport = row(receipt.postImport);
  const lineage = row(receipt.lineage), admission = row(receipt.prewriteAdmission);
  const preImport = row(receipt.preImportAuthority), github = row(receipt.github), host = row(receipt.host);
  if (
    receipt.schemaVersion !== 1 || receipt.result !== "PDC_AUTHORITY_TRANSFER_COMPLETE_B_ADMISSION_READY" ||
    receipt.apply !== true || receipt.commitBAdmissionReady !== true || !exactIso(receipt.observedAt) || !SHA.test(String(receipt.importSha)) ||
    receipt.frozenBaseSha !== PDC_V2_FROZEN_BASE_SHA || !SHA.test(String(receipt.migrationBlobSha1)) ||
    !SHA256.test(String(receipt.cutoverContractSha256)) || !SHA256.test(String(receipt.narrowRoleProofSha256)) || !SHA256.test(String(receipt.githubProofSha256)) ||
    postImport?.obsoleteAggregatePointers !== 0 || postImport?.unregisteredPromotions !== 0 ||
    postImport?.exact0026Preflight !== "PASS" || imported?.durableRetirementReceiptExact !== true
  ) throw new Error("Reader production authority-transfer receipt is not terminally green");
  if (
    !lineage || !exactKeys(lineage, ["frozenImportDataBaseSha", "exactQuiescedMainSha", "reviewedPostFrozenMainCommitOids", "importCommitASha", "importCommitALinearAfterExactMain", "preservedConcurrentPullRequests"]) ||
    lineage.frozenImportDataBaseSha !== PDC_V2_FROZEN_BASE_SHA || !SHA.test(String(lineage.exactQuiescedMainSha)) ||
    lineage.importCommitASha !== receipt.importSha || lineage.importCommitALinearAfterExactMain !== true ||
    !Array.isArray(lineage.reviewedPostFrozenMainCommitOids) || lineage.reviewedPostFrozenMainCommitOids.some((sha) => !SHA.test(String(sha))) ||
    !Array.isArray(lineage.preservedConcurrentPullRequests) ||
    JSON.stringify(lineage.preservedConcurrentPullRequests.map((pr) => Number(row(pr)?.number)).sort((a, b) => a - b)) !== JSON.stringify([302, 303]) ||
    lineage.preservedConcurrentPullRequests.some((prValue) => {
      const pr = row(prValue);
      return !pr || !exactKeys(pr, ["number", "state", "isDraft", "baseRefName", "baseRefOid", "headRefName", "headRefOid", "uniqueCommitOids", "headAncestorOfA", "uniqueCommitsInAAncestry", "patchEquivalentCommitsInA"]) ||
        pr.state !== "OPEN" || typeof pr.isDraft !== "boolean" || pr.baseRefName !== "main" ||
        !SHA.test(String(pr.baseRefOid)) || typeof pr.headRefName !== "string" || !pr.headRefName || !SHA.test(String(pr.headRefOid)) ||
        !Array.isArray(pr.uniqueCommitOids) || pr.uniqueCommitOids.some((sha) => !SHA.test(String(sha))) ||
        pr.headAncestorOfA !== false || pr.uniqueCommitsInAAncestry !== 0 || pr.patchEquivalentCommitsInA !== 0;
    })
  ) throw new Error("Reader production authority-transfer lineage is not exact and linear");
  if (
    !admission || !exactKeys(admission, ["protocol", "nonceSha256", "parentPid", "readyRequests", "liveRecensusAtReady", "receiptTtlMs"]) ||
    admission.protocol !== 1 || !SHA256.test(String(admission.nonceSha256)) || !Number.isSafeInteger(admission.parentPid) || Number(admission.parentPid) <= 0 ||
    admission.readyRequests !== 1 || admission.liveRecensusAtReady !== true || !Number.isSafeInteger(admission.receiptTtlMs) || Number(admission.receiptTtlMs) <= 0 ||
    !preImport || !exactKeys(preImport, ["initialCensus", "liveRecensusAtReady", "exact0026PreflightWithProspectiveSuccessors", "registeredContractKeys", "canonicalPromotionCount", "registeredCurrentPromotionCount", "obsoleteAggregatePointers", "durableRetirementReceipt", "prospectiveReattestationCount"]) ||
    preImport.initialCensus !== "PASS" || preImport.liveRecensusAtReady !== "PASS" || preImport.exact0026PreflightWithProspectiveSuccessors !== "PASS" ||
    !["registeredContractKeys", "canonicalPromotionCount", "registeredCurrentPromotionCount", "obsoleteAggregatePointers", "prospectiveReattestationCount"].every((field) => Number.isSafeInteger(preImport[field]) && Number(preImport[field]) >= 0) ||
    ![null, "PASS"].includes(preImport.durableRetirementReceipt as null | string)
  ) throw new Error("Reader production prewrite/live-recensus authority is not terminally green");
  if (
    !github || !exactKeys(github, ["legacyWorkflowDefinitionsDisabled", "nonterminalLegacyRuns", "bypassActors", "enabledWriteDeployKeys", "legacyRuntimeSecrets"]) ||
    github.legacyWorkflowDefinitionsDisabled !== 8 || github.nonterminalLegacyRuns !== 0 || github.bypassActors !== 0 || github.enabledWriteDeployKeys !== 0 || github.legacyRuntimeSecrets !== 0 ||
    !host || !exactKeys(host, ["obsoleteScheduledTasks", "startupLaunchers", "oldProcessTreeMembers"]) ||
    host.obsoleteScheduledTasks !== 0 || host.startupLaunchers !== 0 || host.oldProcessTreeMembers !== 0
  ) throw new Error("Reader production authority transfer did not retain zero legacy GitHub/host writers");
  if (
    !imported || !exactKeys(imported, ["promoted", "reattestedExisting", "skippedExisting", "dispositions", "dispositionSet", "dispositionSetSha256", "resultSha256", "zeroMeetingPartitionsRefused", "retirementDisposition", "durableRetirementReceiptExact", "legacyMeetingFactSha256", "replacementPointerSha256"]) ||
    !SHA256.test(String(imported.legacyMeetingFactSha256)) || !SHA256.test(String(imported.replacementPointerSha256)) ||
    !SHA256.test(String(imported.resultSha256)) ||
    imported.zeroMeetingPartitionsRefused !== PDC_V2_ZERO_LKG_MEETING_PARTITIONS ||
    !["RETIRED", "ALREADY_RETIRED_PROVEN"].includes(String(imported.retirementDisposition)) ||
    !postImport || !exactKeys(postImport, ["exact0026Preflight", "schema", "promotionCount", "expectedPromotionCount", "registeredContractCount", "obsoleteAggregatePointers", "unregisteredPromotions"]) ||
    postImport.schema !== "pre-0026" ||
    !["promotionCount", "expectedPromotionCount", "registeredContractCount", "obsoleteAggregatePointers", "unregisteredPromotions"].every((field) => Number.isSafeInteger(postImport[field]) && Number(postImport[field]) >= 0) ||
    postImport.promotionCount !== postImport.registeredContractCount
  ) throw new Error("Reader production import/retirement/post-import receipt shape differs");
  const dispositionSet = exactImportDispositionSet(imported.dispositionSet, imported.dispositionSetSha256);
  const count = Number(postImport.promotionCount);
  if (!Number.isSafeInteger(count) || count <= 0 || count !== Number(postImport.expectedPromotionCount)) {
    throw new Error("Reader production authority-transfer receipt has no exact promotion denominator");
  }
  // Binding the exact bytes prevents a summary object from being substituted
  // after the authority transfer. The live pointer query below supplies the
  // complete pointer-set digest that this sequence receipt intentionally omits.
  if (receiptBytes.byteLength === 0) throw new Error("Reader production import receipt is empty");
  const dispositions = {
    promoted: Number(imported?.promoted),
    reattested: Number(imported?.reattestedExisting),
    skipped: Number(imported?.skippedExisting),
    total: Number(imported?.dispositions),
  };
  if (
    !Object.values(dispositions).every(Number.isSafeInteger) ||
    dispositions.promoted < 0 || dispositions.reattested < 0 || dispositions.skipped < 0 ||
    dispositions.promoted + dispositions.skipped !== dispositions.total ||
    dispositions.reattested > dispositions.promoted ||
    dispositionSet.length !== dispositions.total || dispositions.total !== PDC_V2_IMPORT_DISPOSITION_COUNT
  ) throw new Error("Reader production import receipt disposition denominator is invalid");
  const membershipCounts = {
    promoted: dispositionSet.filter(({ disposition }) => disposition !== "SKIPPED_EXISTING_PROVEN_AUTHORITY").length,
    reattested: dispositionSet.filter(({ disposition }) => disposition === "REATTESTED_EXISTING_AUTHORITY").length,
    skipped: dispositionSet.filter(({ disposition }) => disposition === "SKIPPED_EXISTING_PROVEN_AUTHORITY").length,
    total: dispositionSet.length,
  };
  if (canonicalReaderAuthorityJson(membershipCounts) !== canonicalReaderAuthorityJson(dispositions)) {
    throw new Error("Reader production disposition counts differ from their exact membership");
  }
  return {
    importerCodeSha: String(receipt.importSha),
    expectedPointerSha256: null,
    expectedPointerCount: count,
    dispositions,
    dispositionSet,
    dispositionSetSha256: String(imported.dispositionSetSha256),
    resultSha256: String(imported.resultSha256),
  };
}

/**
 * Re-parse the archived provider/controller bytes at every closure check. A
 * matching file hash is necessary but cannot turn an invented support object
 * into provider/import evidence.
 */
export function readerExecutionAuthorityArchivedSupportProblems(
  evidence: ReaderClosureExecutionAuthorityEvidence,
  providerMetadataBytes: Buffer,
  importReceiptBytes: Buffer,
): string[] {
  try {
    const metadataObject = parseJson(providerMetadataBytes, "Reader provider metadata");
    const endpointHost = String(metadataObject.endpointHost ?? "");
    const connection = new URL(`postgresql://readonly_archived:placeholder@${endpointHost}/archived`);
    const observedAt = Date.parse(String(metadataObject.observedAt ?? ""));
    const metadata = validateProviderMetadata(metadataObject, evidence.phase, connection, observedAt);
    const imported = validateImportReceipt(
      parseJson(importReceiptBytes, "Reader import receipt"),
      importReceiptBytes,
      providerMetadataBytes,
      evidence.phase,
      evidence.exactHead,
      metadata,
    );
    const failures: string[] = [];
    if (evidence.store.providerMetadataSha256 !== digest(providerMetadataBytes)) failures.push("Reader execution authority provider metadata bytes changed");
    if (evidence.import.receiptSha256 !== digest(importReceiptBytes)) failures.push("Reader execution authority import receipt bytes changed");
    if (evidence.store.projectIdentitySha256 !== readerAuthorityIdentityHash("project", metadata.projectId)) failures.push("Reader execution authority provider project identity differs");
    if (evidence.store.branchIdentitySha256 !== readerAuthorityIdentityHash("branch", metadata.branchId)) failures.push("Reader execution authority provider branch identity differs");
    if (evidence.store.endpointIdentitySha256 !== readerAuthorityIdentityHash("endpoint", canonicalNeonEndpointHost(connection))) failures.push("Reader execution authority provider endpoint identity differs");
    if (evidence.import.importerCodeSha !== imported.importerCodeSha) failures.push("Reader execution authority importer differs from its archived controller receipt");
    if (evidence.import.resultSha256 !== imported.resultSha256) failures.push("Reader execution authority result digest differs from its archived controller receipt");
    if (evidence.import.dispositionSetSha256 !== imported.dispositionSetSha256) failures.push("Reader execution authority disposition membership digest differs from its archived controller receipt");
    if (evidence.import.canonicalPointerCount !== imported.expectedPointerCount) failures.push("Reader execution authority pointer count differs from its archived controller receipt");
    if (imported.expectedPointerSha256 !== null && evidence.import.canonicalPointerSetSha256 !== imported.expectedPointerSha256) failures.push("Reader execution authority pointer digest differs from its archived rehearsal receipt");
    const durable = evidence.import.durableImport;
    if (
      durable.promotedDispositionCount !== imported.dispositions.promoted ||
      durable.reattestedDispositionCount !== imported.dispositions.reattested ||
      durable.skippedDispositionCount !== imported.dispositions.skipped ||
      durable.candidateCount !== imported.dispositions.total
    ) failures.push("Reader execution authority live disposition denominator differs from its archived controller receipt");
    return failures;
  } catch (error) {
    return [error instanceof Error ? error.message : "Reader authority archived support evidence is invalid"];
  }
}

function boolean(value: unknown): boolean { return value === true || value === "true" || value === "t"; }

function exactValidationReceipt(value: unknown): ReturnType<typeof parseValidationReceipt> {
  const parsed = parseValidationReceipt(value);
  const receipt = row(value);
  if (
    !parsed || !receipt ||
    !exactKeys(receipt, [
      "contractVersion", "decision", "candidateId", "sourceId", "recordClass",
      "scope", "validatedAt", "checks", "excludedFacts",
    ]) ||
    !Array.isArray(receipt.checks) || receipt.checks.some((check) => {
      const proof = row(check);
      return !proof || !exactKeys(proof, ["check", "verdict", "code", "detail"]);
    }) ||
    !Array.isArray(receipt.excludedFacts) || receipt.excludedFacts.some((fact) => {
      const excluded = row(fact);
      if (!excluded) return true;
      const keys = Object.keys(excluded);
      return !keys.includes("code") || !keys.includes("detail") ||
        keys.some((key) => !["key", "code", "detail", "record"].includes(key));
    }) ||
    secretProblems(receipt, "Reader validation receipt").length > 0
  ) return null;
  return parsed;
}

async function readAuthorityDatabase(
  sql: ReaderAuthoritySql,
  connection: URL,
  expectedImport: ReturnType<typeof validateImportReceipt>,
) {
  const identityRows = await sql.query(`
    select current_user::text as current_user,
           session_user::text as session_user,
           current_database()::text as database,
           current_schema()::text as current_schema,
           to_regclass('public.civic_data_candidates') is not null as candidates_present,
           to_regclass('public.civic_data_candidate_events') is not null as events_present,
           to_regclass('public.civic_data_promotions') is not null as promotions_present,
           (select rolsuper from pg_roles where rolname = current_user) as role_superuser,
           (select rolcreaterole from pg_roles where rolname = current_user) as role_create_role,
           (select rolcreatedb from pg_roles where rolname = current_user) as role_create_database,
           (select rolreplication from pg_roles where rolname = current_user) as role_replication,
           (select rolbypassrls from pg_roles where rolname = current_user) as role_bypass_rls,
           has_database_privilege(current_user, current_database(), 'CREATE') as database_create,
           has_schema_privilege(current_user, 'public', 'CREATE') as schema_create,
           (select count(*)::text
              from pg_class relation
              join pg_namespace namespace on namespace.oid = relation.relnamespace
             where namespace.nspname = 'public'
               and relation.relname in ('civic_data_candidates', 'civic_data_candidate_events', 'civic_data_promotions')
               and pg_has_role(current_user, relation.relowner, 'MEMBER')) as relation_ownership_count,
           (select count(*)::text
              from pg_attribute column_attribute
              join pg_class column_relation on column_relation.oid = column_attribute.attrelid
              join pg_namespace column_namespace on column_namespace.oid = column_relation.relnamespace
             where column_namespace.nspname = 'public'
               and column_relation.relname in ('civic_data_candidates', 'civic_data_candidate_events', 'civic_data_promotions')
               and column_attribute.attnum > 0 and not column_attribute.attisdropped
               and (has_column_privilege(current_user, column_relation.oid, column_attribute.attnum, 'INSERT')
                 or has_column_privilege(current_user, column_relation.oid, column_attribute.attnum, 'UPDATE')
                 or has_column_privilege(current_user, column_relation.oid, column_attribute.attnum, 'REFERENCES'))) as column_write_privilege_count,
           (select count(*)::text
              from pg_class sequence
              join pg_namespace namespace on namespace.oid = sequence.relnamespace
             where namespace.nspname = 'public' and sequence.relkind = 'S'
               and (has_sequence_privilege(current_user, sequence.oid, 'USAGE')
                 or has_sequence_privilege(current_user, sequence.oid, 'UPDATE'))) as sequence_write_privilege_count,
           (select count(*)::text
              from pg_roles member_role
             where member_role.rolname <> current_user
               and pg_has_role(current_user, member_role.oid, 'MEMBER')
               and (member_role.rolsuper or member_role.rolcreaterole or member_role.rolcreatedb or
                 member_role.rolreplication or member_role.rolbypassrls or
                 has_database_privilege(member_role.rolname, current_database(), 'CREATE') or
                 has_schema_privilege(member_role.rolname, 'public', 'CREATE') or
                 has_table_privilege(member_role.rolname, 'public.civic_data_candidates', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or
                 has_table_privilege(member_role.rolname, 'public.civic_data_candidate_events', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or
                 has_table_privilege(member_role.rolname, 'public.civic_data_promotions', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or
                 exists (
                   select 1
                     from pg_class owned_relation
                     join pg_namespace owned_namespace on owned_namespace.oid = owned_relation.relnamespace
                    where owned_namespace.nspname = 'public'
                      and owned_relation.relname in ('civic_data_candidates', 'civic_data_candidate_events', 'civic_data_promotions')
                      and owned_relation.relowner = member_role.oid
                 ) or exists (
                   select 1
                     from pg_attribute member_column
                     join pg_class member_column_relation on member_column_relation.oid = member_column.attrelid
                     join pg_namespace member_column_namespace on member_column_namespace.oid = member_column_relation.relnamespace
                    where member_column_namespace.nspname = 'public'
                      and member_column_relation.relname in ('civic_data_candidates', 'civic_data_candidate_events', 'civic_data_promotions')
                      and member_column.attnum > 0 and not member_column.attisdropped
                      and (has_column_privilege(member_role.rolname, member_column_relation.oid, member_column.attnum, 'INSERT')
                        or has_column_privilege(member_role.rolname, member_column_relation.oid, member_column.attnum, 'UPDATE')
                        or has_column_privilege(member_role.rolname, member_column_relation.oid, member_column.attnum, 'REFERENCES'))
                 ) or exists (
                   select 1
                     from pg_class member_sequence
                     join pg_namespace member_sequence_namespace on member_sequence_namespace.oid = member_sequence.relnamespace
                    where member_sequence_namespace.nspname = 'public' and member_sequence.relkind = 'S'
                      and (member_sequence.relowner = member_role.oid
                        or has_sequence_privilege(member_role.rolname, member_sequence.oid, 'USAGE')
                        or has_sequence_privilege(member_role.rolname, member_sequence.oid, 'UPDATE'))
                 ))) as write_capable_member_role_count,
           (select count(*)::text
              from pg_proc function
              join pg_namespace namespace on namespace.oid = function.pronamespace
             where namespace.nspname = 'public'
               and function.prosecdef
               and has_function_privilege(current_user, function.oid, 'EXECUTE')
               and (
                 pg_get_functiondef(function.oid) ~* 'civic_data_(candidates|candidate_events|promotions)' or
                 has_table_privilege(pg_get_userbyid(function.proowner), 'public.civic_data_candidates', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or
                 has_table_privilege(pg_get_userbyid(function.proowner), 'public.civic_data_candidate_events', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or
                 has_table_privilege(pg_get_userbyid(function.proowner), 'public.civic_data_promotions', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
               )) as executable_security_definer_function_count,
           has_table_privilege(current_user, 'public.civic_data_candidates', 'SELECT') as candidates_select,
           has_table_privilege(current_user, 'public.civic_data_candidates', 'INSERT') as candidates_insert,
           has_table_privilege(current_user, 'public.civic_data_candidates', 'UPDATE') as candidates_update,
           has_table_privilege(current_user, 'public.civic_data_candidates', 'DELETE') as candidates_delete,
           has_table_privilege(current_user, 'public.civic_data_candidates', 'TRUNCATE') as candidates_truncate,
           has_table_privilege(current_user, 'public.civic_data_candidates', 'REFERENCES') as candidates_references,
           has_table_privilege(current_user, 'public.civic_data_candidates', 'TRIGGER') as candidates_trigger,
           has_table_privilege(current_user, 'public.civic_data_candidate_events', 'SELECT') as events_select,
           has_table_privilege(current_user, 'public.civic_data_candidate_events', 'INSERT') as events_insert,
           has_table_privilege(current_user, 'public.civic_data_candidate_events', 'UPDATE') as events_update,
           has_table_privilege(current_user, 'public.civic_data_candidate_events', 'DELETE') as events_delete,
           has_table_privilege(current_user, 'public.civic_data_candidate_events', 'TRUNCATE') as events_truncate,
           has_table_privilege(current_user, 'public.civic_data_candidate_events', 'REFERENCES') as events_references,
           has_table_privilege(current_user, 'public.civic_data_candidate_events', 'TRIGGER') as events_trigger,
           has_table_privilege(current_user, 'public.civic_data_promotions', 'SELECT') as promotions_select,
           has_table_privilege(current_user, 'public.civic_data_promotions', 'INSERT') as promotions_insert,
           has_table_privilege(current_user, 'public.civic_data_promotions', 'UPDATE') as promotions_update,
           has_table_privilege(current_user, 'public.civic_data_promotions', 'DELETE') as promotions_delete,
           has_table_privilege(current_user, 'public.civic_data_promotions', 'TRUNCATE') as promotions_truncate,
           has_table_privilege(current_user, 'public.civic_data_promotions', 'REFERENCES') as promotions_references,
           has_table_privilege(current_user, 'public.civic_data_promotions', 'TRIGGER') as promotions_trigger
  `);
  if (identityRows.length !== 1) throw new Error("Reader authority identity query cardinality differs");
  const identity = identityRows[0]!;
  const role = decodeURIComponent(connection.username);
  const database = decodeURIComponent(connection.pathname.replace(/^\//, ""));
  if (
    identity.current_user !== role || identity.session_user !== role || identity.database !== database ||
    identity.current_schema !== "public" ||
    !boolean(identity.candidates_present) || !boolean(identity.events_present) ||
    !boolean(identity.promotions_present) || boolean(identity.role_superuser) ||
    boolean(identity.role_create_role) || boolean(identity.role_create_database) ||
    boolean(identity.role_replication) || boolean(identity.role_bypass_rls) ||
    boolean(identity.database_create) ||
    boolean(identity.schema_create) || String(identity.relation_ownership_count) !== "0" ||
    String(identity.column_write_privilege_count) !== "0" || String(identity.sequence_write_privilege_count) !== "0" ||
    String(identity.write_capable_member_role_count) !== "0" ||
    String(identity.executable_security_definer_function_count) !== "0"
  ) throw new Error("Reader authority database identity/tables differ from the named handle");

  const relations = [
    ["public.civic_data_candidate_events", "events"],
    ["public.civic_data_candidates", "candidates"],
    ["public.civic_data_promotions", "promotions"],
  ] as const;
  for (const [relation, prefix] of relations) {
    if (
      !boolean(identity[`${prefix}_select`]) || boolean(identity[`${prefix}_insert`]) ||
      boolean(identity[`${prefix}_update`]) || boolean(identity[`${prefix}_delete`]) ||
      boolean(identity[`${prefix}_truncate`]) || boolean(identity[`${prefix}_references`]) ||
      boolean(identity[`${prefix}_trigger`])
    ) throw new Error(`${relation} is not SELECT-only for the Reader authority principal`);
  }

  let rolePrivilegeRefused = false;
  try {
    // EXPLAIN performs the ordinary DELETE privilege check without executing
    // the statement. This distinguishes a genuinely SELECT-only role from a
    // writer that would merely be stopped by the transaction's READ ONLY bit.
    await sql.query("explain delete from public.civic_data_promotions where false");
  } catch (error) {
    if (row(error)?.code !== "42501") {
      throw new Error("Reader authority role-privilege probe failed for a non-privilege reason");
    }
    rolePrivilegeRefused = true;
  }
  if (!rolePrivilegeRefused) throw new Error("Reader authority principal admitted a DELETE execution plan");

  let refused = false;
  try {
    // The adapter opens an explicit READ ONLY transaction and always rolls it
    // back. WHERE false is a second guard: even a broken transaction mode plus
    // an over-privileged role cannot change a row while the probe fails closed.
    await sql.readOnlyTransaction(["delete from public.civic_data_promotions where false"]);
  } catch (error) {
    const code = row(error)?.code;
    if (code !== "42501" && code !== "25006") {
      throw new Error("Reader authority refused-write probe failed for a non-privilege reason");
    }
    refused = true;
  }
  if (!refused) throw new Error("Reader authority principal admitted a write statement");

  const pointers = await sql.query(`
    select key, source_id, record_class, scope, current_version_id,
           last_known_good_version_id, promoted_at, payload, validation_receipt
      from public.civic_data_promotions
     order by key
  `);
  const normalized = pointers.map((pointer) => ({
    key: String(pointer.key),
    sourceId: String(pointer.source_id),
    recordClass: String(pointer.record_class),
    scope: String(pointer.scope),
    currentVersionId: String(pointer.current_version_id),
    lastKnownGoodVersionId: String(pointer.last_known_good_version_id),
    promotedAt: new Date(String(pointer.promoted_at)).toISOString(),
    payload: pointer.payload,
    validationReceipt: pointer.validation_receipt,
  }));
  if (normalized.length === 0 || new Set(normalized.map(({ key }) => key)).size !== normalized.length) {
    throw new Error("Reader authority canonical pointer set is empty or duplicated");
  }

  // Count+pointer hashes alone cannot prove that the one-time import's
  // immutable candidate envelopes and append-only transition receipts actually
  // reached this store. Read every current pointer's exact candidate and event
  // history, then bind the resulting sets into the authority artifact.
  const candidates = await sql.query(`
    select p.key as pointer_key, p.current_version_id, p.last_known_good_version_id,
           c.id as candidate_id, c.source_id, c.record_class, c.scope, c.state,
           p.promoted_at as pointer_promoted_at, p.payload as pointer_payload,
           p.validation_receipt as pointer_validation_receipt,
           c.acquisition_succeeded, c.promoted_version_id,
           c.last_known_good_version_id as candidate_lkg_version_id,
           c.failure_code, c.failure_detail, c.candidate, c.validation_receipt,
           predecessor.state as predecessor_state,
           predecessor.acquisition_succeeded as predecessor_acquisition_succeeded,
           predecessor.promoted_version_id as predecessor_promoted_version_id,
           predecessor.last_known_good_version_id as predecessor_lkg_version_id,
           predecessor.failure_code as predecessor_failure_code,
           predecessor.failure_detail as predecessor_failure_detail,
           predecessor.candidate as predecessor_candidate,
           predecessor.validation_receipt as predecessor_validation_receipt
      from public.civic_data_promotions p
      join public.civic_data_candidates c on c.id = p.current_version_id
      left join public.civic_data_candidates predecessor
        on predecessor.id = c.candidate #>> '{bootstrapImport,predecessorVersionId}'
     order by p.key
  `);
  if (candidates.length !== normalized.length) {
    throw new Error("Reader authority current pointers do not have one durable candidate each");
  }
  const events = await sql.query(`
    select e.candidate_id, e.sequence, e.state, e.at, e.detail
      from public.civic_data_candidate_events e
     where e.candidate_id in (
       select p.current_version_id from public.civic_data_promotions p
       union
       select c.candidate #>> '{bootstrapImport,predecessorVersionId}'
         from public.civic_data_promotions p
         join public.civic_data_candidates c on c.id = p.current_version_id
        where c.candidate #>> '{bootstrapImport,kind}' = 'TRUSTED_LKG_REATTESTATION'
     )
     order by e.candidate_id, e.sequence
  `);
  const normalizedEvents = events.map((event) => ({
    candidateId: String(event.candidate_id),
    sequence: Number(event.sequence),
    state: String(event.state),
    at: new Date(String(event.at)).toISOString(),
    detail: String(event.detail),
  }));
  const durableCandidates = candidates.flatMap((candidateRow) => {
    const candidate = row(candidateRow.candidate);
    const transfer = row(candidate?.bootstrapImport);
    const validationReceipt = exactValidationReceipt(candidateRow.validation_receipt);
    const predecessorCandidate = row(candidateRow.predecessor_candidate);
    const predecessor = predecessorCandidate === null ? null : {
      candidate: predecessorCandidate as unknown as RoutineCandidate,
      state: candidateRow.predecessor_state,
      acquisitionSucceeded: boolean(candidateRow.predecessor_acquisition_succeeded),
      receipt: candidateRow.predecessor_validation_receipt,
      promotedVersion: candidateRow.predecessor_promoted_version_id,
      lastKnownGoodVersion: candidateRow.predecessor_lkg_version_id,
      failureCode: candidateRow.predecessor_failure_code,
      failureDetail: candidateRow.predecessor_failure_detail,
    } as CandidateVersionRecord;
    const currentRecord = candidate === null ? null : {
      candidate: candidate as unknown as RoutineCandidate,
      state: candidateRow.state,
      acquisitionSucceeded: boolean(candidateRow.acquisition_succeeded),
      receipt: candidateRow.validation_receipt,
      promotedVersion: candidateRow.promoted_version_id,
      lastKnownGoodVersion: candidateRow.candidate_lkg_version_id,
      failureCode: candidateRow.failure_code,
      failureDetail: candidateRow.failure_detail,
    } as CandidateVersionRecord;
    const pointer = {
      key: String(candidateRow.pointer_key),
      sourceId: String(candidateRow.source_id),
      recordClass: String(candidateRow.record_class),
      scope: String(candidateRow.scope),
      versionId: String(candidateRow.current_version_id),
      lastKnownGoodVersionId: String(candidateRow.last_known_good_version_id),
      promotedAt: new Date(String(candidateRow.pointer_promoted_at)).toISOString(),
      payload: candidateRow.pointer_payload,
      receipt: candidateRow.pointer_validation_receipt,
    } as PromotedProjection;
    const history = normalizedEvents.filter((event) => event.candidateId === candidateRow.candidate_id);
    const predecessorHistory = predecessorCandidate === null
      ? []
      : normalizedEvents.filter((event) => event.candidateId === predecessorCandidate.id);
    const latestReaderReceipt = [...history].reverse().map(({ detail }) =>
      parseReaderProjectionReadback(detail)
    ).find((receipt) => receipt !== null) ?? null;
    const importedHere = transfer?.authorization === "PDC_V2_FROZEN_LKG_CUTOVER" &&
      transfer.importerCodeSha === expectedImport.importerCodeSha;
    const disposition = importedHere
      ? transfer?.kind === "TRUSTED_LKG_REATTESTATION"
        ? "REATTESTED_EXISTING_AUTHORITY" as const
        : transfer?.kind === "TRUSTED_LKG_IMPORT"
          ? "PROMOTED_ABSENT_POINTER" as const
          : null
      : latestReaderReceipt?.status === "PASS" &&
          latestReaderReceipt.verifierCodeSha === expectedImport.importerCodeSha
        ? "SKIPPED_EXISTING_PROVEN_AUTHORITY" as const
        : null;
    // Other standing pointers are legitimate permanent runtime authorities but
    // are outside the bounded frozen-LKG transfer denominator.
    if (disposition === null) return [];
    const promotionIssue = !candidate || !currentRecord
      ? "the durable current candidate is missing"
      : promotionProofIssue(
          String(candidateRow.record_class) as RoutineCandidate["recordClass"],
          String(candidateRow.scope),
          pointer,
          currentRecord,
          predecessor,
        );
    const importIssue = importedHere && candidate
      ? trustedLkgImportEvidenceIssue(candidate as unknown as RoutineCandidate, predecessor)
      : null;
    if (
      !candidate ||
      !currentRecord || promotionIssue !== null ||
      importIssue !== null ||
      candidateRow.pointer_key !== `${String(candidateRow.record_class)}:${String(candidateRow.scope)}` ||
      candidateRow.current_version_id !== candidateRow.candidate_id ||
      candidateRow.last_known_good_version_id !== candidateRow.candidate_id ||
      candidateRow.promoted_version_id !== candidateRow.candidate_id ||
      candidateRow.candidate_lkg_version_id !== candidateRow.candidate_id ||
      candidateRow.state !== "PROMOTED" ||
      !boolean(candidateRow.acquisition_succeeded) || candidateRow.failure_code !== null ||
      candidateRow.failure_detail !== null || !validationReceipt || validationReceipt.decision !== "GOOD" ||
      validationReceipt.candidateId !== candidateRow.candidate_id ||
      validationReceipt.sourceId !== candidateRow.source_id ||
      validationReceipt.recordClass !== candidateRow.record_class || validationReceipt.scope !== candidateRow.scope ||
      candidate.id !== candidateRow.candidate_id || candidate.sourceId !== candidateRow.source_id ||
      candidate.recordClass !== candidateRow.record_class || candidate.scope !== candidateRow.scope ||
      history.length === 0 || history.some((event, index) => event.sequence !== index + 1) ||
      history.at(-1)?.state !== "PROMOTED" || latestReaderReceipt?.status !== "PASS" ||
      latestReaderReceipt.verifierCodeSha !== expectedImport.importerCodeSha ||
      latestReaderReceipt.versionId !== candidateRow.candidate_id ||
      latestReaderReceipt.pointerKey !== candidateRow.pointer_key ||
      latestReaderReceipt.sourceId !== candidateRow.source_id ||
      latestReaderReceipt.recordClass !== candidateRow.record_class ||
      latestReaderReceipt.scope !== candidateRow.scope ||
      !latestReaderReceipt.contractId ||
      (importedHere && (
        transfer?.contractId !== latestReaderReceipt.contractId ||
        transfer.sourceId !== candidateRow.source_id || transfer.recordClass !== candidateRow.record_class ||
        transfer.scope !== candidateRow.scope
      )) ||
      (transfer?.kind === "TRUSTED_LKG_REATTESTATION" && (
        exactValidationReceipt(candidateRow.predecessor_validation_receipt) === null ||
        predecessorHistory.length === 0 ||
        predecessorHistory.some((event, index) => event.sequence !== index + 1) ||
        predecessorHistory.at(-1)?.state !== "PROMOTED" ||
        !predecessorHistory.some((event) =>
          event.state === "VALIDATED" &&
          event.at === String(row(candidateRow.predecessor_validation_receipt)?.validatedAt ?? "")
        ) ||
        !predecessorHistory.some((event) =>
          event.state === "PROMOTED" && event.at === String(transfer.predecessorPromotedAt ?? "")
        )
      ))
    ) {
      throw new Error(
        `Reader authority current pointer lacks coherent durable PDC import evidence: ${promotionIssue ?? importIssue ?? "candidate/pointer/event linkage differs"}`,
      );
    }
    return [{
      contractId: String(importedHere ? transfer?.contractId : latestReaderReceipt.contractId),
      pointerKey: String(candidateRow.pointer_key),
      currentVersionId: String(candidateRow.current_version_id),
      candidateId: String(candidateRow.candidate_id),
      sourceId: String(candidateRow.source_id),
      recordClass: String(candidateRow.record_class),
      scope: String(candidateRow.scope),
      state: "PROMOTED" as const,
      disposition,
      transferKind: importedHere ? String(transfer?.kind) : null,
      authorization: importedHere ? "PDC_V2_FROZEN_LKG_CUTOVER" as const : null,
      importerCodeSha: importedHere ? String(transfer?.importerCodeSha) : null,
      readerVerifierCodeSha: latestReaderReceipt.verifierCodeSha,
      readerReadback: "PASS" as const,
      predecessorEventCount: predecessorHistory.length,
      predecessorEventSetSha256: predecessorHistory.length > 0
        ? digest(canonicalReaderAuthorityJson(predecessorHistory))
        : null,
      candidateEnvelopeSha256: digest(canonicalReaderAuthorityJson(candidate)),
      validationReceiptSha256: digest(canonicalReaderAuthorityJson(candidateRow.validation_receipt)),
    }];
  });
  if (new Set(durableCandidates.map(({ candidateId }) => candidateId)).size !== durableCandidates.length) {
    throw new Error("Reader authority durable import candidate set is duplicated");
  }
  const durableCandidateIds = new Set(durableCandidates.map(({ candidateId }) => candidateId));
  const durableEvents = normalizedEvents.filter(({ candidateId }) => durableCandidateIds.has(candidateId));
  const durablePredecessorIds = new Set(durableCandidates.flatMap(({ disposition, candidateId }) => {
    if (disposition !== "REATTESTED_EXISTING_AUTHORITY") return [];
    const candidateRow = candidates.find((row) => row.candidate_id === candidateId);
    const predecessorId = row(candidateRow?.candidate)?.bootstrapImport;
    const predecessorVersionId = row(predecessorId)?.predecessorVersionId;
    return typeof predecessorVersionId === "string" ? [predecessorVersionId] : [];
  }));
  const durablePredecessorEvents = normalizedEvents.filter(({ candidateId }) => durablePredecessorIds.has(candidateId));
  const observedDispositions = {
    promoted: durableCandidates.filter(({ disposition }) => disposition !== "SKIPPED_EXISTING_PROVEN_AUTHORITY").length,
    reattested: durableCandidates.filter(({ disposition }) => disposition === "REATTESTED_EXISTING_AUTHORITY").length,
    skipped: durableCandidates.filter(({ disposition }) => disposition === "SKIPPED_EXISTING_PROVEN_AUTHORITY").length,
    total: durableCandidates.length,
  };
  if (canonicalReaderAuthorityJson(observedDispositions) !== canonicalReaderAuthorityJson(expectedImport.dispositions)) {
    throw new Error("Reader authority durable import disposition set differs from its controller receipt");
  }
  const observedServingDispositions = durableCandidates.map(({ contractId, disposition, currentVersionId, readerReadback }) => ({
    contractId,
    disposition,
    versionId: currentVersionId,
    readerReadback,
  })).sort((left, right) => left.contractId.localeCompare(right.contractId));
  const expectedServingDispositions = expectedImport.dispositionSet.map(({ contractId, disposition, versionId, readerReadback }) => ({
    contractId,
    disposition,
    versionId,
    readerReadback,
  }));
  if (canonicalReaderAuthorityJson(observedServingDispositions) !== canonicalReaderAuthorityJson(expectedServingDispositions)) {
    throw new Error("Reader authority live durable membership differs from the exact controller disposition set");
  }
  return {
    relations: relations.map(([relation]) => ({ relation, select: true as const, insert: false as const, update: false as const, delete: false as const, truncate: false as const, references: false as const, trigger: false as const })),
    pointerCount: normalized.length,
    pointerSha256: digest(canonicalReaderAuthorityJson(normalized)),
    durableImport: {
      authorization: "PDC_V2_FROZEN_LKG_CUTOVER" as const,
      candidateCount: durableCandidates.length,
      currentPointerLinkCount: durableCandidates.length,
      promotedDispositionCount: observedDispositions.promoted,
      reattestedDispositionCount: observedDispositions.reattested,
      skippedDispositionCount: observedDispositions.skipped,
      candidateSetSha256: digest(canonicalReaderAuthorityJson(durableCandidates)),
      eventCandidateCount: new Set(durableEvents.map(({ candidateId }) => candidateId)).size,
      eventCount: durableEvents.length,
      terminalPromotedEventCount: [...durableCandidateIds].filter((candidateId) =>
        durableEvents.filter((event) => event.candidateId === candidateId).at(-1)?.state === "PROMOTED"
      ).length,
      eventSetSha256: digest(canonicalReaderAuthorityJson(durableEvents)),
      predecessorCandidateCount: durablePredecessorIds.size,
      predecessorEventCount: durablePredecessorEvents.length,
      predecessorEventSetSha256: digest(canonicalReaderAuthorityJson(durablePredecessorEvents)),
      importerCodeShas: [expectedImport.importerCodeSha],
    },
  };
}

export async function buildReaderExecutionAuthorityEvidence(
  options: BuildReaderAuthorityOptions,
): Promise<ReaderClosureExecutionAuthorityEvidence> {
  if (!SHA.test(options.exactHead)) throw new Error("Reader authority exact head is invalid");
  const phaseSlug = options.phase.toLowerCase();
  if (
    options.providerMetadataPath !== `docs/evidence/reader-last-mile-${phaseSlug}-provider-metadata.json` ||
    options.importReceiptPath !== `docs/evidence/reader-last-mile-${phaseSlug}-import-receipt.json`
  ) {
    throw new Error("Reader authority support evidence must use its exact phase-specific immutable paths");
  }
  let connection: URL;
  try { connection = new URL(options.connection); }
  catch { throw new Error("Reader authority database handle is invalid"); }
  if (!/^postgres(?:ql)?:$/.test(connection.protocol) || !connection.hostname.endsWith(".neon.tech")) {
    throw new Error("Reader authority database handle is not Neon Postgres");
  }
  const role = decodeURIComponent(connection.username);
  if (role !== "readonly" && !role.startsWith("readonly_")) {
    throw new Error("Reader authority database handle does not name a read-only role");
  }
  const metadataObject = parseJson(options.providerMetadataBytes, "Reader provider metadata");
  const metadata = validateProviderMetadata(metadataObject, options.phase, connection, options.nowMs ?? Date.now());
  const receiptObject = parseJson(options.importReceiptBytes, "Reader import receipt");
  const imported = validateImportReceipt(
    receiptObject, options.importReceiptBytes, options.providerMetadataBytes, options.phase, options.exactHead, metadata,
  );
  const live = await readAuthorityDatabase(options.sql, connection, imported);
  if (
    imported.expectedPointerCount !== live.pointerCount ||
    (imported.expectedPointerSha256 !== null && imported.expectedPointerSha256 !== live.pointerSha256)
  ) throw new Error("Reader authority live pointer set differs from the durable import receipt");

  const endpoint = canonicalNeonEndpointHost(connection);
  const database = decodeURIComponent(connection.pathname.replace(/^\//, ""));
  return {
    formatVersion: 1,
    phase: options.phase,
    exactHead: options.exactHead,
    store: {
      kind: "NEON_POSTGRES",
      authority: options.phase === "PRODUCTION" ? "STANDING_PRODUCTION" : "ISOLATED_PRODUCTION_CLONE",
      projectIdentitySha256: readerAuthorityIdentityHash("project", metadata.projectId),
      branchIdentitySha256: readerAuthorityIdentityHash("branch", metadata.branchId),
      endpointIdentitySha256: readerAuthorityIdentityHash("endpoint", endpoint),
      databaseIdentitySha256: readerAuthorityIdentityHash("database", database),
      schemaIdentitySha256: readerAuthorityIdentityHash("schema", "public"),
      providerMetadataPath: options.providerMetadataPath,
      providerMetadataSha256: digest(options.providerMetadataBytes),
    },
    readOnly: {
      roleIdentitySha256: readerAuthorityIdentityHash("role", role),
      roleWritePrivilegesRefused: true,
      attemptedWriteRefused: true,
      roleSuperuser: false,
      roleCreateRole: false,
      roleCreateDatabase: false,
      roleReplication: false,
      roleBypassRls: false,
      databaseCreate: false,
      schemaCreate: false,
      relationOwnershipCount: 0,
      columnWritePrivilegeCount: 0,
      sequenceWritePrivilegeCount: 0,
      writeCapableMemberRoleCount: 0,
      executableSecurityDefinerFunctionCount: 0,
      relations: live.relations,
    },
    import: {
      importerCodeSha: imported.importerCodeSha,
      receiptPath: options.importReceiptPath,
      receiptSha256: digest(options.importReceiptBytes),
      resultSha256: imported.resultSha256,
      dispositionSetSha256: imported.dispositionSetSha256,
      canonicalPointerSetSha256: live.pointerSha256,
      canonicalPointerCount: live.pointerCount,
      durableImport: live.durableImport,
    },
    clone: options.phase === "REHEARSAL" ? {
      parentProductionBranchIdentitySha256: readerAuthorityIdentityHash("branch", PDC_PRODUCTION_BRANCH_ID),
      sourceSnapshotSha256: digest(options.importReceiptBytes),
      controlPlaneReceiptSha256: digest(options.providerMetadataBytes),
    } : null,
  };
}

export async function readerExecutionAuthorityLiveProblems(
  expected: ReaderClosureExecutionAuthorityEvidence,
  options: Omit<BuildReaderAuthorityOptions, "phase" | "exactHead">,
): Promise<string[]> {
  try {
    const observed = await buildReaderExecutionAuthorityEvidence({
      ...options,
      phase: expected.phase,
      exactHead: expected.exactHead,
    });
    return canonicalReaderAuthorityJson(observed) === canonicalReaderAuthorityJson(expected)
      ? []
      : ["Reader execution authority artifact differs from a fresh live authority readback"];
  } catch (error) {
    // Driver diagnostics may echo a connection string or credential. The
    // executable retains the detailed error only in memory; terminal output is
    // deliberately a non-secret fail-closed diagnostic.
    void error;
    return ["Reader execution authority live readback failed"];
  }
}
