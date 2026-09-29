import { createHash } from "node:crypto";

import type {
  ReaderClosureExecutionAuthorityEvidence,
  ReaderClosureExecutionPhase,
  ReaderCensus,
} from "./reader-census.ts";
import { READER_SURFACES, type ReaderSurfaceId } from "./datasets.ts";
import { DERIVED_MEETING_FAMILY_STATES } from "../civic-data/contracts.ts";
import { derivedMeetingFamilyId } from "../civic-data/meeting-partitions.ts";
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
const PDC_V2_PLANNED_CANDIDATE_COUNT = 96;
const PDC_V2_PLANNED_EXISTING_UNION_COUNT = 1;
const PDC_V2_BASELINE_REGISTERED_PROMOTION_COUNT = 16;
const PDC_V2_FINAL_PROMOTION_COUNT =
  PDC_V2_BASELINE_REGISTERED_PROMOTION_COUNT + PDC_V2_PLANNED_CANDIDATE_COUNT -
  PDC_V2_PLANNED_EXISTING_UNION_COUNT;
// Exact production registry: 10 routine + 124 meeting + 23 manual contracts.
const PDC_V2_REGISTERED_CONTRACT_COUNT = 157;
export const PDC_V2_ZERO_LKG_MEETING_PARTITIONS = 41;
/**
 * Meeting partitions registered AFTER the frozen PDC v2 import.
 *
 * The import's permanent 83/41 authority covers exactly the 124 partitions
 * that existed when it ran, and the bundled trusted-LKG snapshot predates
 * every partition registered since. A partition added later has, by
 * construction, no import disposition, no zero-LKG refusal and no row in the
 * frozen snapshot: its pointer is born by routine promotion through the one
 * production door, which the Reader proof already accepts as a GAIN (RULING
 * 290). Each is named here by id — one reviewed line per partition — so a
 * registry change can never move the frozen denominator by inference, and
 * the import may never claim to have promoted one.
 */
export const PDC_V2_POST_IMPORT_MEETING_PARTITIONS: readonly string[] = [
  // Tucson Unified's own reconfiguration page (official-page events, 2026-09-23).
  "meetings:official-page-events:ocd-division%2Fcountry%3Aus%2Fstate%3Aaz%2Fschool_district%3Atucson_unified_district%23board",
  // Newbury, NH bodies the town iCal never carries, read from their own pages (C9, 2026-09-24).
  "meetings:schedulepage:ocd-division%2Fcountry%3Aus%2Fstate%3Anh%2Fcounty%3Amerrimack%2Fplace%3Anewbury_town%23library-trustees",
  "meetings:schedulepage:ocd-division%2Fcountry%3Aus%2Fstate%3Anh%2Fcounty%3Amerrimack%2Fplace%3Anewbury_town%23energy-committee",
  // Chandler's City Council schedule table (C14, 2026-09-24).
  "meetings:schedulepage:ocd-division%2Fcountry%3Aus%2Fstate%3Aaz%2Fplace%3Achandler%23governing",
  // Holbrook's City Council from the city's own agendas-and-minutes pages (2026-09-25).
  "meetings:document-listing:ocd-division%2Fcountry%3Aus%2Fstate%3Aaz%2Fplace%3Aholbrook%23governing",
  // Winslow's City Council from the city's SuiteOne Media portal (2026-09-25).
  "meetings:suiteone:ocd-division%2Fcountry%3Aus%2Fstate%3Aaz%2Fplace%3Awinslow%23governing",
  // The derived meeting families, one partition per registered state (C16, 2026-09-24; every state since 2026-09-25).
  // Their members are data read from the promoted meeting-source wiring, so this list never changes per reviewed
  // calendar, and it is registration's own state list, never a chosen one.
  ...DERIVED_MEETING_FAMILY_STATES.map((state) => derivedMeetingFamilyId(state)),
];

type Row = Record<string, unknown>;
const row = (value: unknown): Row | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
function trustedTransferPredecessor(transfer: Row | null): { versionId: string; promotedAt: string } | null {
  if (transfer?.kind === "TRUSTED_LKG_REATTESTATION") {
    return typeof transfer.predecessorVersionId === "string" && transfer.predecessorVersionId &&
      typeof transfer.predecessorPromotedAt === "string" && transfer.predecessorPromotedAt
      ? { versionId: transfer.predecessorVersionId, promotedAt: transfer.predecessorPromotedAt }
      : null;
  }
  if (transfer?.kind !== "TRUSTED_LKG_IMPORT") return null;
  const union = row(transfer.pimaOutcomeUnion);
  return typeof union?.predecessorVersionId === "string" && union.predecessorVersionId &&
    typeof union.predecessorPromotedAt === "string" && union.predecessorPromotedAt
    ? { versionId: union.predecessorVersionId, promotedAt: union.predecessorPromotedAt }
    : null;
}
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
  query(statement: string, parameters?: readonly unknown[]): Promise<Row[]>;
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

export type ImportDisposition = {
  readonly contractId: string;
  readonly candidateId: string;
  readonly disposition:
    | "PROMOTED_ABSENT_POINTER"
    | "PROMOTED_FROZEN_LKG_UNION"
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
      !["PROMOTED_ABSENT_POINTER", "PROMOTED_FROZEN_LKG_UNION", "REATTESTED_EXISTING_AUTHORITY", "SKIPPED_EXISTING_PROVEN_AUTHORITY"].includes(String(disposition.disposition)) ||
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

/** The one approved documentary-main join keeps importer A below software P. */
export function readerProductionTransferLineageShapeIssue(
  lineage: Row,
  importerCodeSha: string,
): string | null {
  const ordinaryKeys = [
    "frozenImportDataBaseSha", "exactQuiescedMainSha", "reviewedPostFrozenMainCommitOids",
    "importCommitASha", "importCommitALinearAfterExactMain", "preservedConcurrentPullRequests",
  ];
  const approvedA = "c85082c04cef43fb0203adcfe92b936d8520e9e3";
  if (importerCodeSha !== approvedA) {
    return exactKeys(lineage, ordinaryKeys) && lineage.importCommitALinearAfterExactMain === true
      ? null : "Reader production authority-transfer lineage shape is not ordinary and linear";
  }
  // Owner-approved one-time B repair; the immutable transfer receipt stays
  // truthful. The generator separately proves A is a strict ancestor of B;
  // the release controller still proves exact E/main parents at J and A at M.
  const approvedKeys = [...ordinaryKeys, "softwareLineageAnchorSha",
    "importCommitALinearAfterSoftwareLineageAnchor", "documentaryMainJoinRequired"];
  return exactKeys(lineage, approvedKeys) && lineage.importCommitASha === approvedA &&
    lineage.exactQuiescedMainSha === "9a9a76763f39980cca4aac448cb57ce9a8102101" &&
    lineage.softwareLineageAnchorSha === "d04026d91c5b8c513ea335e4f9575cac3b6badb9" &&
    lineage.importCommitALinearAfterExactMain === false &&
    lineage.importCommitALinearAfterSoftwareLineageAnchor === true &&
    lineage.documentaryMainJoinRequired === true
    ? null : "Reader production authority-transfer lineage differs from the exact approved documentary-main join";
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
  zeroMeetingPartitionsRefused: number;
  legacyMeetingsAggregate: {
    factSha256: string;
    meetingRowCount: number;
    agendaDocumentRowCount: number;
  };
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
      beforeCounts.promotions !== String(before.count) ||
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
      !retirement || !exactKeys(retirement, ["disposition", "legacyVersionId", "retiredAt", "legacyMeetingFactSha256", "replacementPointerSha256", "meetingRowCount", "agendaDocumentRowCount"]) ||
      !["RETIRED", "ALREADY_RETIRED_PROVEN"].includes(String(retirement.disposition)) ||
      typeof retirement.legacyVersionId !== "string" || !retirement.legacyVersionId || !exactIso(retirement.retiredAt) ||
      !SHA256.test(String(retirement.legacyMeetingFactSha256)) || !SHA256.test(String(retirement.replacementPointerSha256)) ||
      !Number.isSafeInteger(retirement.meetingRowCount) || Number(retirement.meetingRowCount) <= 0 ||
      !Number.isSafeInteger(retirement.agendaDocumentRowCount) || Number(retirement.agendaDocumentRowCount) <= 0 ||
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
      dispositionSet.length !== dispositions.total
    ) throw new Error("Reader rehearsal import receipt disposition denominator is invalid");
    const dispositionCounts = row(imported.dispositionCounts);
    const allowedDispositionKeys = ["PROMOTED_ABSENT_POINTER", "PROMOTED_FROZEN_LKG_UNION", "REATTESTED_EXISTING_AUTHORITY", "SKIPPED_EXISTING_PROVEN_AUTHORITY"];
    if (
      !dispositionCounts || Object.keys(dispositionCounts).some((key) => !allowedDispositionKeys.includes(key)) ||
      Object.values(dispositionCounts).some((value) => !Number.isSafeInteger(value) || Number(value) <= 0) ||
      Number(dispositionCounts.PROMOTED_ABSENT_POINTER ?? 0) + Number(dispositionCounts.PROMOTED_FROZEN_LKG_UNION ?? 0) + Number(dispositionCounts.REATTESTED_EXISTING_AUTHORITY ?? 0) !== dispositions.promoted ||
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
    const absentPromotions = Number(dispositionCounts.PROMOTED_ABSENT_POINTER ?? 0);
    const unionPromotions = Number(dispositionCounts.PROMOTED_FROZEN_LKG_UNION ?? 0);
    const existingDispositions = dispositions.reattested + unionPromotions + dispositions.skipped;
    const retiredLegacyPointers = retirement.disposition === "RETIRED" ? 1 : 0;
    const beforePointerCount = Number(before?.count);
    const changedKeyCount = (pointers?.changedKeyMembership as unknown[]).length;
    if (
      !["candidateCount", "meetingPartitionsWithLkg", "meetingPartitionsWithoutLkg", "meetingRows", "agendaDocumentRows", "manualContracts"].every((field) => Number.isSafeInteger(plan[field]) && Number(plan[field]) >= 0) ||
      Number(plan.meetingRows) <= 0 || Number(plan.agendaDocumentRows) <= 0 ||
      plan.candidateCount !== PDC_V2_PLANNED_CANDIDATE_COUNT ||
      plan.meetingPartitionsWithoutLkg !== imported.zeroMeetingPartitionsRefused ||
      Number(plan.meetingPartitionsWithLkg) + Number(plan.manualContracts) !== Number(plan.candidateCount) ||
      unionPromotions !== PDC_V2_PLANNED_EXISTING_UNION_COUNT ||
      beforePointerCount < retiredLegacyPointers ||
      existingDispositions !== beforePointerCount - retiredLegacyPointers ||
      existingDispositions < PDC_V2_BASELINE_REGISTERED_PROMOTION_COUNT ||
      absentPromotions > PDC_V2_PLANNED_CANDIDATE_COUNT - PDC_V2_PLANNED_EXISTING_UNION_COUNT ||
      count !== beforePointerCount - retiredLegacyPointers + absentPromotions ||
      count !== PDC_V2_FINAL_PROMOTION_COUNT ||
      dispositions.total !== count ||
      changedKeyCount !== dispositions.promoted + retiredLegacyPointers ||
      (pointers?.changedKeyMembership as unknown[]).includes("MEETING:supported-bodies") !== (retiredLegacyPointers === 1)
    ) throw new Error("Reader rehearsal plan/pointer transition differs from its exact durable import dispositions");
    return {
      importerCodeSha: exactHead,
      expectedPointerSha256: pointerSha,
      expectedPointerCount: count,
      dispositions,
      dispositionSet,
      dispositionSetSha256: String(imported.dispositionSetSha256),
      zeroMeetingPartitionsRefused: Number(imported.zeroMeetingPartitionsRefused),
      legacyMeetingsAggregate: {
        // The retired aggregate's identity is reader-visible (collapsed): its
        // factSha256 is retirement.legacyMeetingFactSha256, so its counts must
        // be the matching retirement counts, NOT plan.meetingRows/agendaDocumentRows
        // (the frozen fc67 lineage denominator, a pre-collapse representation).
        // This mirrors the PRODUCTION branch, which pairs
        // liveLegacyMeetingFactSha256 with liveLegacyMeetingRowCount.
        factSha256: String(retirement.legacyMeetingFactSha256),
        meetingRowCount: Number(retirement.meetingRowCount),
        agendaDocumentRowCount: Number(retirement.agendaDocumentRowCount),
      },
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
    !lineage || readerProductionTransferLineageShapeIssue(lineage, String(receipt.importSha)) !== null ||
    lineage.frozenImportDataBaseSha !== PDC_V2_FROZEN_BASE_SHA || !SHA.test(String(lineage.exactQuiescedMainSha)) ||
    lineage.importCommitASha !== receipt.importSha ||
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
    !preImport || !exactKeys(preImport, [
      "initialCensus", "liveRecensusAtReady", "exact0026PreflightWithProspectiveSuccessors",
      "registeredContractKeys", "canonicalPromotionCount", "registeredCurrentPromotionCount",
      "obsoleteAggregatePointers", "durableRetirementReceipt", "liveLegacyVersionId",
      "liveLegacyPointerSha256", "liveLegacyCandidateRecordSha256", "liveLegacyHistorySha256",
      "liveLegacyHistoryEventCount", "liveLegacyMeetingFactSha256", "liveLegacyMeetingRowCount",
      "liveLegacyAgendaDocumentRowCount", "prospectiveReattestationCount",
    ]) ||
    preImport.initialCensus !== "PASS" || preImport.liveRecensusAtReady !== "PASS" || preImport.exact0026PreflightWithProspectiveSuccessors !== "PASS" ||
    !["registeredContractKeys", "canonicalPromotionCount", "registeredCurrentPromotionCount", "obsoleteAggregatePointers", "liveLegacyHistoryEventCount", "liveLegacyMeetingRowCount", "liveLegacyAgendaDocumentRowCount", "prospectiveReattestationCount"].every((field) => Number.isSafeInteger(preImport[field]) && Number(preImport[field]) >= 0) ||
    Number(preImport.liveLegacyMeetingRowCount) <= 0 || Number(preImport.liveLegacyAgendaDocumentRowCount) <= 0 ||
    typeof preImport.liveLegacyVersionId !== "string" || !preImport.liveLegacyVersionId ||
    !["liveLegacyPointerSha256", "liveLegacyCandidateRecordSha256", "liveLegacyHistorySha256", "liveLegacyMeetingFactSha256"].every((field) => SHA256.test(String(preImport[field])))
  ) throw new Error("Reader production prewrite/live-recensus authority is not terminally green");
  if (
    !github || !exactKeys(github, ["legacyWorkflowDefinitionsDisabled", "nonterminalLegacyRuns", "bypassActors", "enabledWriteDeployKeys", "legacyRuntimeSecrets"]) ||
    github.legacyWorkflowDefinitionsDisabled !== 8 || github.nonterminalLegacyRuns !== 0 || github.bypassActors !== 0 || github.enabledWriteDeployKeys !== 0 || github.legacyRuntimeSecrets !== 0 ||
    !host || !exactKeys(host, ["obsoleteScheduledTasks", "startupLaunchers", "oldProcessTreeMembers"]) ||
    host.obsoleteScheduledTasks !== 0 || host.startupLaunchers !== 0 || host.oldProcessTreeMembers !== 0
  ) throw new Error("Reader production authority transfer did not retain zero legacy GitHub/host writers");
  if (
    !imported || !exactKeys(imported, [
      "promoted", "reattestedExisting", "skippedExisting", "dispositions", "dispositionSet",
      "dispositionSetSha256", "zeroMeetingPartitionsRefused", "retirementDisposition",
      "durableRetirementReceiptExact", "legacyMeetingFactSha256", "replacementPointerSha256",
      "legacyPointerSha256", "legacyCandidateRecordSha256", "legacyHistorySha256",
      "legacyHistoryEventCount", "replacementFullPointerSetSha256",
      "replacementCandidateRecordSetSha256", "replacementHistorySetSha256",
      "replacementAuthoritySha256", "resultSha256",
    ]) ||
    !["legacyMeetingFactSha256", "replacementPointerSha256", "legacyPointerSha256", "legacyCandidateRecordSha256", "legacyHistorySha256", "replacementFullPointerSetSha256", "replacementCandidateRecordSetSha256", "replacementHistorySetSha256", "replacementAuthoritySha256"].every((field) => SHA256.test(String(imported[field]))) ||
    !Number.isSafeInteger(imported.legacyHistoryEventCount) || Number(imported.legacyHistoryEventCount) <= 0 ||
    !SHA256.test(String(imported.resultSha256)) ||
    imported.zeroMeetingPartitionsRefused !== PDC_V2_ZERO_LKG_MEETING_PARTITIONS ||
    !["RETIRED", "ALREADY_RETIRED_PROVEN"].includes(String(imported.retirementDisposition)) ||
    !postImport || !exactKeys(postImport, ["exact0026Preflight", "schema", "promotionCount", "expectedPromotionCount", "registeredContractCount", "obsoleteAggregatePointers", "unregisteredPromotions"]) ||
    postImport.schema !== "pre-0026" ||
    !["promotionCount", "expectedPromotionCount", "registeredContractCount", "obsoleteAggregatePointers", "unregisteredPromotions"].every((field) => Number.isSafeInteger(postImport[field]) && Number(postImport[field]) >= 0) ||
    Number(postImport.registeredContractCount) !== Number(preImport.registeredContractKeys) ||
    Number(postImport.registeredContractCount) !== PDC_V2_REGISTERED_CONTRACT_COUNT ||
    Number(postImport.promotionCount) > Number(postImport.registeredContractCount)
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
    dispositionSet.length !== dispositions.total
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
  const absentPromotions = dispositionSet.filter(({ disposition }) => disposition === "PROMOTED_ABSENT_POINTER").length;
  const unionPromotions = dispositionSet.filter(({ disposition }) => disposition === "PROMOTED_FROZEN_LKG_UNION").length;
  const existingDispositions = dispositions.reattested + unionPromotions + dispositions.skipped;
  const retiredLegacyPointers = imported.retirementDisposition === "RETIRED" ? 1 : 0;
  const expectedRetirementProof = retiredLegacyPointers === 1 ? "NOT_APPLICABLE_POINTER_PRESENT" : "PASS";
  const replacementAuthoritySha256 = digest(canonicalReaderAuthorityJson({
    replacementFullPointerSetSha256: imported.replacementFullPointerSetSha256,
    replacementCandidateRecordSetSha256: imported.replacementCandidateRecordSetSha256,
    replacementHistorySetSha256: imported.replacementHistorySetSha256,
  }));
  if (
    preImport.obsoleteAggregatePointers !== retiredLegacyPointers ||
    preImport.durableRetirementReceipt !== expectedRetirementProof ||
    Number(preImport.canonicalPromotionCount) !== Number(preImport.registeredCurrentPromotionCount) + retiredLegacyPointers ||
    unionPromotions > PDC_V2_PLANNED_EXISTING_UNION_COUNT ||
    existingDispositions !== Number(preImport.registeredCurrentPromotionCount) ||
    absentPromotions > PDC_V2_PLANNED_CANDIDATE_COUNT - PDC_V2_PLANNED_EXISTING_UNION_COUNT ||
    count !== Number(preImport.registeredCurrentPromotionCount) + absentPromotions ||
    count !== PDC_V2_FINAL_PROMOTION_COUNT ||
    dispositions.total !== count ||
    imported.legacyPointerSha256 !== preImport.liveLegacyPointerSha256 ||
    imported.legacyCandidateRecordSha256 !== preImport.liveLegacyCandidateRecordSha256 ||
    imported.legacyHistorySha256 !== preImport.liveLegacyHistorySha256 ||
    imported.legacyHistoryEventCount !== preImport.liveLegacyHistoryEventCount ||
    imported.legacyMeetingFactSha256 !== preImport.liveLegacyMeetingFactSha256 ||
    imported.replacementAuthoritySha256 !== replacementAuthoritySha256
  ) throw new Error("Reader production authority transition differs from its exact pre/import/post evidence");
  return {
    importerCodeSha: String(receipt.importSha),
    expectedPointerSha256: null,
    expectedPointerCount: count,
    dispositions,
    dispositionSet,
    dispositionSetSha256: String(imported.dispositionSetSha256),
    zeroMeetingPartitionsRefused: Number(imported.zeroMeetingPartitionsRefused),
    legacyMeetingsAggregate: {
      factSha256: String(preImport.liveLegacyMeetingFactSha256),
      meetingRowCount: Number(preImport.liveLegacyMeetingRowCount),
      agendaDocumentRowCount: Number(preImport.liveLegacyAgendaDocumentRowCount),
    },
    resultSha256: String(imported.resultSha256),
  };
}

export interface ReaderExecutionAuthorityArchivedSupportAdmission {
  readonly importerCodeSha: string;
  readonly dispositionSet: readonly ImportDisposition[];
  readonly zeroMeetingPartitionsRefused: number;
  readonly dispositionSetSha256: string;
  readonly legacyMeetingsAggregate: {
    readonly factSha256: string;
    readonly meetingRowCount: number;
    readonly agendaDocumentRowCount: number;
  };
}

/**
 * Admit the immutable provider/import support bytes and return only the
 * already-authenticated import membership needed by documentary proof. The
 * caller never derives expected authority from the live projection it is
 * checking.
 */
export function admitReaderExecutionAuthorityArchivedSupport(
  evidence: ReaderClosureExecutionAuthorityEvidence,
  providerMetadataBytes: Buffer,
  importReceiptBytes: Buffer,
): ReaderExecutionAuthorityArchivedSupportAdmission {
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
  if (evidence.store.providerMetadataSha256 !== digest(providerMetadataBytes)) throw new Error("Reader execution authority provider metadata bytes changed");
  if (evidence.import.receiptSha256 !== digest(importReceiptBytes)) throw new Error("Reader execution authority import receipt bytes changed");
  if (evidence.store.projectIdentitySha256 !== readerAuthorityIdentityHash("project", metadata.projectId)) throw new Error("Reader execution authority provider project identity differs");
  if (evidence.store.branchIdentitySha256 !== readerAuthorityIdentityHash("branch", metadata.branchId)) throw new Error("Reader execution authority provider branch identity differs");
  if (evidence.store.endpointIdentitySha256 !== readerAuthorityIdentityHash("endpoint", canonicalNeonEndpointHost(connection))) throw new Error("Reader execution authority provider endpoint identity differs");
  if (evidence.import.importerCodeSha !== imported.importerCodeSha) throw new Error("Reader execution authority importer differs from its archived controller receipt");
  if (evidence.import.resultSha256 !== imported.resultSha256) throw new Error("Reader execution authority result digest differs from its archived controller receipt");
  if (evidence.import.dispositionSetSha256 !== imported.dispositionSetSha256) throw new Error("Reader execution authority disposition membership digest differs from its archived controller receipt");
  if (imported.expectedPointerSha256 !== null
    ? evidence.import.canonicalPointerCount !== imported.expectedPointerCount
    : evidence.import.canonicalPointerCount < imported.expectedPointerCount
  ) throw new Error("Reader execution authority pointer count differs from its archived controller receipt");
  if (imported.expectedPointerSha256 !== null && evidence.import.canonicalPointerSetSha256 !== imported.expectedPointerSha256) {
    throw new Error("Reader execution authority pointer digest differs from its archived rehearsal receipt");
  }
  const durable = evidence.import.durableImport;
  if (
    durable.promotedDispositionCount !== imported.dispositions.promoted ||
    durable.reattestedDispositionCount !== imported.dispositions.reattested ||
    durable.skippedDispositionCount !== imported.dispositions.skipped ||
    durable.candidateCount !== imported.dispositions.total
  ) throw new Error("Reader execution authority live disposition denominator differs from its archived controller receipt");
  return {
    importerCodeSha: imported.importerCodeSha,
    dispositionSet: imported.dispositionSet,
    zeroMeetingPartitionsRefused: imported.zeroMeetingPartitionsRefused,
    dispositionSetSha256: imported.dispositionSetSha256,
    legacyMeetingsAggregate: imported.legacyMeetingsAggregate,
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
    admitReaderExecutionAuthorityArchivedSupport(evidence, providerMetadataBytes, importReceiptBytes);
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : "Reader authority archived support evidence is invalid"];
  }
}

function boolean(value: unknown): boolean { return value === true || value === "true" || value === "t"; }

function databaseTimestamp(value: unknown): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error("Reader authority database timestamp is invalid");
  return parsed.toISOString();
}

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

  const pointers: Row[] = [];
  let pointerCursor: string | null = null;
  for (;;) {
    const page = await sql.query(`
      select key, source_id, record_class, scope, current_version_id,
             last_known_good_version_id, promoted_at, payload, validation_receipt
        from public.civic_data_promotions
       where ($1::text is null or key > $1::text)
       order by key
       limit 1
    `, [pointerCursor]);
    if (page.length === 0) break;
    if (page.length !== 1) throw new Error("Reader authority pointer page cardinality differs");
    const nextCursor = String(page[0]!.key);
    if (!nextCursor || (pointerCursor !== null && nextCursor <= pointerCursor)) {
      throw new Error("Reader authority pointer cursor did not advance");
    }
    pointers.push(page[0]!);
    pointerCursor = nextCursor;
    if (expectedImport.expectedPointerSha256 !== null && pointers.length > expectedImport.expectedPointerCount) {
      throw new Error("Reader authority pointer set exceeds its controller receipt");
    }
  }
  const normalized = pointers.map((pointer) => ({
    key: String(pointer.key),
    sourceId: String(pointer.source_id),
    recordClass: String(pointer.record_class),
    scope: String(pointer.scope),
    currentVersionId: String(pointer.current_version_id),
    lastKnownGoodVersionId: String(pointer.last_known_good_version_id),
    promotedAt: databaseTimestamp(pointer.promoted_at),
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
  const candidates: Row[] = [];
  // Candidate envelopes contain the immutable source payload needed for the
  // independent Reader proof. The complete frozen set is intentionally larger
  // than Neon's 64 MiB HTTP response ceiling, so fetch one envelope per
  // response while preserving the same complete-set validation and hashes.
  //
  // Each pointer's candidate is the one THAT POINTER named when the pass above
  // read it, fetched by id. The standing runner re-promotes routine meetings
  // about once a minute, so a second join on the live pointer paired a pointer
  // read minutes earlier with a candidate promoted since, and refused a
  // coherent store (2026-09-25: two mints in a row, New London's and Bradford's
  // boards re-promoted mid-mint). The authority binds the snapshot the pointer
  // pass read; a later runner edition is a gain the proof already accepts
  // (`requireReaderProofMeetingsProjection`). The pointer fields below are that
  // same pass's, so the linkage checks still bind candidate to pointer exactly.
  for (const [index, pointer] of pointers.entries()) {
    const versionId = normalized[index]!.currentVersionId;
    const page = await sql.query(`
      select c.id as candidate_id, c.source_id, c.record_class, c.scope, c.state,
             c.acquisition_succeeded, c.promoted_version_id,
             c.last_known_good_version_id as candidate_lkg_version_id,
             c.failure_code, c.failure_detail, c.candidate, c.validation_receipt
        from public.civic_data_candidates c
       where c.id = $1::text
    `, [versionId]);
    if (page.length !== 1 || String(page[0]!.candidate_id) !== versionId) {
      throw new Error("Reader authority current pointers do not have one durable candidate each");
    }
    candidates.push({
      ...page[0]!,
      pointer_key: pointer.key,
      current_version_id: pointer.current_version_id,
      last_known_good_version_id: pointer.last_known_good_version_id,
      pointer_promoted_at: pointer.promoted_at,
    });
  }

  const predecessorIds = [...new Set(candidates.flatMap((candidateRow) => {
    const transfer = row(row(candidateRow.candidate)?.bootstrapImport);
    const predecessor = trustedTransferPredecessor(transfer);
    return predecessor ? [predecessor.versionId] : [];
  }))].sort();
  const predecessors = new Map<string, Row>();
  for (const predecessorId of predecessorIds) {
    const predecessorRows = await sql.query(`
      select id, state, acquisition_succeeded, promoted_version_id,
             last_known_good_version_id, failure_code, failure_detail,
             candidate, validation_receipt
        from public.civic_data_candidates
       where id = $1::text
    `, [predecessorId]);
    if (predecessorRows.length !== 1 || String(predecessorRows[0]!.id) !== predecessorId) {
      throw new Error("Reader authority predecessor candidate cardinality differs");
    }
    predecessors.set(predecessorId, predecessorRows[0]!);
  }

  const dispositionOriginalCandidateIds = expectedImport.expectedPointerSha256 === null
    ? expectedImport.dispositionSet
        .map(({ versionId }) => String(versionId))
        .filter((id) => id.length > 0)
    : [];
  const eventCandidateIds = [...new Set([
    ...candidates.map(({ candidate_id }) => String(candidate_id)),
    ...predecessorIds,
    ...dispositionOriginalCandidateIds,
  ])].sort();
  const events: Row[] = [];
  let eventCursorId: string | null = null;
  let eventCursorSequence: number | null = null;
  for (;;) {
    const page = await sql.query(`
      select e.candidate_id, e.sequence, e.state, e.at, e.detail
        from public.civic_data_candidate_events e
       where e.candidate_id = any($1::text[])
         and ($2::text is null or (e.candidate_id, e.sequence) > ($2::text, $3::integer))
       order by e.candidate_id, e.sequence
       limit 32
    `, [eventCandidateIds, eventCursorId, eventCursorSequence]);
    if (page.length === 0) break;
    if (page.length > 32) throw new Error("Reader authority event page cardinality differs");
    for (const event of page) {
      const candidateId = String(event.candidate_id);
      const sequence = Number(event.sequence);
      if (
        !candidateId || !Number.isSafeInteger(sequence) || sequence <= 0 ||
        (eventCursorId !== null && (
          candidateId < eventCursorId ||
          (candidateId === eventCursorId && sequence <= Number(eventCursorSequence))
        ))
      ) throw new Error("Reader authority event cursor did not advance");
      events.push(event);
      eventCursorId = candidateId;
      eventCursorSequence = sequence;
    }
  }
  const normalizedEvents = events.map((event) => ({
    candidateId: String(event.candidate_id),
    sequence: Number(event.sequence),
    state: String(event.state),
    at: databaseTimestamp(event.at),
    detail: String(event.detail),
  }));
  const durableCandidates = candidates.flatMap((candidateRow) => {
    const candidate = row(candidateRow.candidate);
    const transfer = row(candidate?.bootstrapImport);
    const transferPredecessor = trustedTransferPredecessor(transfer);
    const validationReceipt = exactValidationReceipt(candidateRow.validation_receipt);
    const predecessorRow = transferPredecessor
      ? predecessors.get(transferPredecessor.versionId)
      : undefined;
    const predecessorCandidate = row(predecessorRow?.candidate);
    const predecessor = predecessorCandidate === null ? null : {
      candidate: predecessorCandidate as unknown as RoutineCandidate,
      state: predecessorRow?.state,
      acquisitionSucceeded: boolean(predecessorRow?.acquisition_succeeded),
      receipt: predecessorRow?.validation_receipt,
      promotedVersion: predecessorRow?.promoted_version_id,
      lastKnownGoodVersion: predecessorRow?.last_known_good_version_id,
      failureCode: predecessorRow?.failure_code,
      failureDetail: predecessorRow?.failure_detail,
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
    const normalizedPointer = normalized.find(({ key }) => key === candidateRow.pointer_key);
    if (!normalizedPointer) throw new Error("Reader authority durable candidate pointer is absent");
    const pointer = {
      key: normalizedPointer.key,
      sourceId: normalizedPointer.sourceId,
      recordClass: normalizedPointer.recordClass,
      scope: normalizedPointer.scope,
      versionId: normalizedPointer.currentVersionId,
      lastKnownGoodVersionId: normalizedPointer.lastKnownGoodVersionId,
      promotedAt: normalizedPointer.promotedAt,
      payload: normalizedPointer.payload,
      receipt: normalizedPointer.validationReceipt,
    } as PromotedProjection;
    const history = normalizedEvents.filter((event) => event.candidateId === candidateRow.candidate_id);
    const predecessorHistory = predecessorCandidate === null
      ? []
      : normalizedEvents.filter((event) => event.candidateId === predecessorCandidate.id);
    const latestReaderReceipt = [...history].reverse().map(({ detail }) =>
      parseReaderProjectionReadback(detail)
    ).find((receipt) => receipt !== null) ?? null;
    const fallbackReaderReceipt = latestReaderReceipt === null && expectedImport.expectedPointerSha256 === null
      && candidate?.bootstrapImport == null
      ? normalizedEvents
          .filter((event) => dispositionOriginalCandidateIds.includes(event.candidateId))
          .map(({ detail }) => parseReaderProjectionReadback(detail))
          .find((receipt) => receipt !== null && receipt.pointerKey === candidateRow.pointer_key)
          ?? null
      : null;
    const effectiveReaderReceipt = latestReaderReceipt ?? fallbackReaderReceipt;
    const importedHere = transfer?.authorization === "PDC_V2_FROZEN_LKG_CUTOVER" &&
      transfer.importerCodeSha === expectedImport.importerCodeSha;
    const hasBootstrapImport = candidate?.bootstrapImport != null;
    const expectedDisposition = effectiveReaderReceipt === null
      ? null
      : expectedImport.expectedPointerSha256 !== null
        ? expectedImport.dispositionSet.find(({ contractId, versionId }) =>
            contractId === effectiveReaderReceipt.contractId &&
            versionId === candidateRow.current_version_id
          ) ?? null
        : expectedImport.dispositionSet.find(({ contractId }) =>
            contractId === effectiveReaderReceipt.contractId
          ) ?? null;
    const disposition = expectedDisposition?.disposition ?? null;
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
    const dispositionIssue = expectedImport.expectedPointerSha256 === null && !importedHere && !hasBootstrapImport
      ? null
      : disposition === "PROMOTED_ABSENT_POINTER"
        ? !importedHere || transfer?.kind !== "TRUSTED_LKG_IMPORT"
          ? "an absent-pointer disposition lacks its exact durable import bootstrap"
          : null
        : disposition === "PROMOTED_FROZEN_LKG_UNION"
          ? !importedHere || transfer?.kind !== "TRUSTED_LKG_IMPORT" || !row(transfer.pimaOutcomeUnion)
            ? "a frozen-LKG union disposition lacks its exact durable predecessor-bound import bootstrap"
            : null
        : disposition === "REATTESTED_EXISTING_AUTHORITY"
          ? !importedHere || transfer?.kind !== "TRUSTED_LKG_REATTESTATION"
            ? "a re-attestation disposition lacks its exact durable re-attestation bootstrap"
            : null
          : disposition === "SKIPPED_EXISTING_PROVEN_AUTHORITY"
            ? hasBootstrapImport && (
                !importedHere ||
                !["TRUSTED_LKG_IMPORT", "TRUSTED_LKG_REATTESTATION"].includes(String(transfer?.kind))
              )
              ? "a skipped imported authority is not bound to the exact durable bootstrap"
              : null
            : "the live authority is absent from the controller disposition membership";
    const linkageIssue = !candidate || !currentRecord
      ? "the durable current candidate is missing"
      : candidateRow.pointer_key !== `${String(candidateRow.record_class)}:${String(candidateRow.scope)}`
        ? "the pointer key differs from its record class and scope"
        : candidateRow.current_version_id !== candidateRow.candidate_id ||
            candidateRow.current_version_id !== normalizedPointer.currentVersionId
          ? "the pointer does not name the durable current candidate"
          : candidateRow.last_known_good_version_id !== candidateRow.candidate_id ||
              candidateRow.last_known_good_version_id !== normalizedPointer.lastKnownGoodVersionId
            ? "the pointer last-known-good version differs from the durable current candidate"
            : databaseTimestamp(candidateRow.pointer_promoted_at) !== normalizedPointer.promotedAt
              ? "the paged candidate pointer timestamp differs from the canonical pointer"
              : candidateRow.promoted_version_id !== candidateRow.candidate_id ||
                  candidateRow.candidate_lkg_version_id !== candidateRow.candidate_id
                ? "the durable candidate promotion or last-known-good version differs"
                : candidateRow.state !== "PROMOTED" || !boolean(candidateRow.acquisition_succeeded) ||
                    candidateRow.failure_code !== null || candidateRow.failure_detail !== null
                  ? "the durable candidate is not a successful promoted row"
                  : !validationReceipt || validationReceipt.decision !== "GOOD"
                    ? "the durable candidate lacks an exact GOOD receipt"
                    : validationReceipt.candidateId !== candidateRow.candidate_id ||
                        validationReceipt.sourceId !== candidateRow.source_id ||
                        validationReceipt.recordClass !== candidateRow.record_class ||
                        validationReceipt.scope !== candidateRow.scope
                      ? "the GOOD receipt does not identify the durable candidate"
                      : candidate.id !== candidateRow.candidate_id || candidate.sourceId !== candidateRow.source_id ||
                          candidate.recordClass !== candidateRow.record_class || candidate.scope !== candidateRow.scope
                        ? "the candidate envelope identity differs from its durable row"
                        : history.length === 0 || history.some((event, index) => event.sequence !== index + 1)
                          ? "the current candidate event history is empty or non-contiguous"
                          : history.at(-1)?.state !== "PROMOTED"
                            ? "the current candidate event history is not terminally promoted"
                            : effectiveReaderReceipt?.status !== "PASS"
                              ? "the current candidate lacks a passing Reader readback event"
                              : expectedImport.expectedPointerSha256 !== null && effectiveReaderReceipt.verifierCodeSha !== expectedImport.importerCodeSha
                                ? "the Reader readback verifier differs from the importer code"
                                : (latestReaderReceipt !== null && effectiveReaderReceipt.versionId !== candidateRow.candidate_id) ||
                                    effectiveReaderReceipt.pointerKey !== candidateRow.pointer_key ||
                                    effectiveReaderReceipt.sourceId !== candidateRow.source_id ||
                                    effectiveReaderReceipt.recordClass !== candidateRow.record_class ||
                                    effectiveReaderReceipt.scope !== candidateRow.scope ||
                                    !effectiveReaderReceipt.contractId
                                  ? "the Reader readback identity differs from the durable pointer"
                                  : importedHere && (
                                      transfer?.contractId !== effectiveReaderReceipt.contractId ||
                                      transfer.sourceId !== candidateRow.source_id ||
                                      transfer.recordClass !== candidateRow.record_class ||
                                      transfer.scope !== candidateRow.scope
                                    )
                                    ? "the durable bootstrap identity differs from the Reader readback"
                                    : null;
    const predecessorIssue = transferPredecessor === null
      ? null
      : exactValidationReceipt(predecessorRow?.validation_receipt) === null
        ? "the trusted-transfer predecessor lacks an exact GOOD receipt"
        : predecessorHistory.length === 0 || predecessorHistory.some((event, index) => event.sequence !== index + 1)
          ? "the trusted-transfer predecessor history is empty or non-contiguous"
          : predecessorHistory.at(-1)?.state !== "PROMOTED"
            ? "the trusted-transfer predecessor history is not terminally promoted"
            : !predecessorHistory.some((event) =>
                event.state === "VALIDATED" &&
                event.at === databaseTimestamp(row(predecessorRow?.validation_receipt)?.validatedAt)
              )
              ? "the predecessor validation receipt has no matching durable event"
              : !predecessorHistory.some((event) =>
                  event.state === "PROMOTED" && event.at === transferPredecessor.promotedAt
                )
                ? "the predecessor promotion time has no matching durable event"
                : null;
    if (
      !candidate || effectiveReaderReceipt === null || dispositionIssue !== null ||
      !currentRecord || promotionIssue !== null ||
      importIssue !== null ||
      linkageIssue !== null || predecessorIssue !== null
    ) {
      throw new Error(
        `Reader authority current pointer ${String(candidateRow.pointer_key)} lacks coherent durable PDC import evidence: ` +
        `${promotionIssue ?? importIssue ?? dispositionIssue ?? linkageIssue ?? predecessorIssue ?? "candidate/pointer/event linkage differs"}`,
      );
    }
    return [{
      contractId: String(expectedDisposition?.contractId),
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
      readerVerifierCodeSha: effectiveReaderReceipt.verifierCodeSha,
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
    if (!["REATTESTED_EXISTING_AUTHORITY", "PROMOTED_FROZEN_LKG_UNION"].includes(disposition)) return [];
    const candidateRow = candidates.find((row) => row.candidate_id === candidateId);
    const transfer = row(row(candidateRow?.candidate)?.bootstrapImport);
    const predecessor = trustedTransferPredecessor(transfer);
    return predecessor ? [predecessor.versionId] : [];
  }));
  const durablePredecessorEvents = normalizedEvents.filter(({ candidateId }) => durablePredecessorIds.has(candidateId));
  const observedDispositions = {
    promoted: durableCandidates.filter(({ disposition }) => disposition !== "SKIPPED_EXISTING_PROVEN_AUTHORITY").length,
    reattested: durableCandidates.filter(({ disposition }) => disposition === "REATTESTED_EXISTING_AUTHORITY").length,
    skipped: durableCandidates.filter(({ disposition }) => disposition === "SKIPPED_EXISTING_PROVEN_AUTHORITY").length,
    total: durableCandidates.length,
  };
  if (canonicalReaderAuthorityJson(observedDispositions) !== canonicalReaderAuthorityJson(expectedImport.dispositions)) {
    throw new Error(
      "Reader authority durable import disposition set differs from its controller receipt: " +
      `${canonicalReaderAuthorityJson(observedDispositions)} != ${canonicalReaderAuthorityJson(expectedImport.dispositions)}`,
    );
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
  if (expectedImport.expectedPointerSha256 !== null) {
    if (canonicalReaderAuthorityJson(observedServingDispositions) !== canonicalReaderAuthorityJson(expectedServingDispositions)) {
      throw new Error("Reader authority live durable membership differs from the exact controller disposition set");
    }
  } else {
    const observedMembership = observedServingDispositions.map(({ contractId, disposition, readerReadback }) => ({ contractId, disposition, readerReadback }));
    const expectedMembership = expectedServingDispositions.map(({ contractId, disposition, readerReadback }) => ({ contractId, disposition, readerReadback }));
    if (canonicalReaderAuthorityJson(observedMembership) !== canonicalReaderAuthorityJson(expectedMembership)) {
      throw new Error("Reader authority live durable membership differs from the exact controller disposition set");
    }
  }
  const eventsByCandidate = new Map<string, typeof normalizedEvents>();
  for (const event of normalizedEvents) {
    const bucket = eventsByCandidate.get(event.candidateId) ?? [];
    bucket.push(event);
    eventsByCandidate.set(event.candidateId, bucket);
  }
  return {
    relations: relations.map(([relation]) => ({ relation, select: true as const, insert: false as const, update: false as const, delete: false as const, truncate: false as const, references: false as const, trigger: false as const })),
    pointerCount: normalized.length,
    pointerSha256: digest(canonicalReaderAuthorityJson(normalized)),
    pointerBindings: normalized.map((pointer) => ({
      key: pointer.key,
      sourceId: pointer.sourceId,
      recordClass: pointer.recordClass,
      scope: pointer.scope,
      currentVersionId: pointer.currentVersionId,
      rowSha256: digest(canonicalReaderAuthorityJson(pointer)),
    })),
    candidateBindings: candidates.map((candidateRow) => {
      const { pointer_key: _key, current_version_id: _version,
        last_known_good_version_id: _lastKnownGood, pointer_promoted_at: _promotedAt,
        ...persistent } = candidateRow;
      const history = eventsByCandidate.get(String(candidateRow.candidate_id)) ?? [];
      if (!history.length || history.some((event, index) => event.sequence !== index + 1)) {
        throw new Error("Reader authority candidate binding lacks contiguous historical events");
      }
      return {
        key: String(candidateRow.pointer_key),
        candidateId: String(candidateRow.candidate_id),
        rowSha256: digest(canonicalReaderAuthorityJson(persistent)),
        eventSha256: history.map((event) => digest(canonicalReaderAuthorityJson(event))),
      };
    }),
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
    imported.expectedPointerSha256 !== null
      ? (imported.expectedPointerCount !== live.pointerCount || imported.expectedPointerSha256 !== live.pointerSha256)
      : live.pointerCount < imported.expectedPointerCount
  ) throw new Error("Reader authority live pointer set differs from the durable import receipt");

  const endpoint = canonicalNeonEndpointHost(connection);
  const database = decodeURIComponent(connection.pathname.replace(/^\//, ""));
  return {
    formatVersion: 2,
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
      pointerBindings: live.pointerBindings,
      candidateBindings: live.candidateBindings,
      durableImport: live.durableImport,
    },
    clone: options.phase === "REHEARSAL" ? {
      parentProductionBranchIdentitySha256: readerAuthorityIdentityHash("branch", PDC_PRODUCTION_BRANCH_ID),
      sourceSnapshotSha256: digest(options.importReceiptBytes),
      controlPlaneReceiptSha256: digest(options.providerMetadataBytes),
    } : null,
  };
}

export function readerAuthoritySuccessorProblems(
  expected: ReaderClosureExecutionAuthorityEvidence,
  observed: ReaderClosureExecutionAuthorityEvidence,
): string[] {
  if (canonicalReaderAuthorityJson(observed) === canonicalReaderAuthorityJson(expected)) return [];
  if (expected.phase !== observed.phase || expected.exactHead !== observed.exactHead ||
      canonicalReaderAuthorityJson(expected.store) !== canonicalReaderAuthorityJson(observed.store) ||
      canonicalReaderAuthorityJson(expected.readOnly) !== canonicalReaderAuthorityJson(observed.readOnly) ||
      expected.import.receiptSha256 !== observed.import.receiptSha256 ||
      expected.import.dispositionSetSha256 !== observed.import.dispositionSetSha256 ||
      expected.import.canonicalPointerCount !== observed.import.canonicalPointerCount) {
    return ["Reader execution authority store, read-only principal, code head, or controller receipt changed"];
  }
  // Historical V1 evidence committed only whole-set hashes. A digest
  // difference cannot identify a changed key or establish that its Reader
  // projection and public route were re-proved.
  if (expected.formatVersion === 1 || observed.formatVersion !== 2) {
    return ["Reader execution authority V1 has no per-key baseline for live promotion drift; fresh exact-head Reader proof required"];
  }
  const before = new Map(expected.import.pointerBindings?.map((binding) => [binding.key, binding]));
  const after = new Map(observed.import.pointerBindings?.map((binding) => [binding.key, binding]));
  const priorCandidates = new Map(expected.import.candidateBindings?.map((binding) => [binding.key, binding]));
  const liveCandidates = new Map(observed.import.candidateBindings?.map((binding) => [binding.key, binding]));
  if (!before.size || before.size !== expected.import.canonicalPointerCount ||
      after.size !== before.size || priorCandidates.size !== before.size || liveCandidates.size !== before.size ||
      [...before.keys()].some((key) => !after.has(key) || !priorCandidates.has(key) || !liveCandidates.has(key))) {
    return ["Reader execution authority canonical key population changed; eligibility and public readbacks require fresh proof"];
  }
  const changed = [...before].filter(([key, binding]) =>
    binding.rowSha256 !== after.get(key)?.rowSha256 ||
    binding.currentVersionId !== after.get(key)?.currentVersionId
  );
  if (changed.length) {
    return changed.map(([key, binding]) =>
      `Reader execution authority changed ${binding.recordClass} key ${key}; exact successor projection and public readback are unproved`
    );
  }
  for (const [key, prior] of priorCandidates) {
    const live = liveCandidates.get(key)!;
    if (prior.candidateId !== live.candidateId || prior.rowSha256 !== live.rowSha256 ||
        live.eventSha256.length < prior.eventSha256.length ||
        prior.eventSha256.some((hash, index) => hash !== live.eventSha256[index])) {
      return [`Reader execution authority candidate or event history changed without an exact append-only prefix at ${key}`];
    }
  }
  const oldDurable = expected.import.durableImport;
  const liveDurable = observed.import.durableImport;
  const stable = ({ candidateSetSha256: _candidate, eventCount: _count, eventSetSha256: _events, ...rest }:
    typeof oldDurable) => rest;
  if (canonicalReaderAuthorityJson(stable(oldDurable)) !== canonicalReaderAuthorityJson(stable(liveDurable)) ||
      liveDurable.eventCount < oldDurable.eventCount) {
    return ["Reader execution authority imported membership or predecessor history changed"];
  }
  return [];
}

/** Conservative dependency set for a promoted canonical class. A class with
 * unclear Reader reachability has no inferred safe subset. */
export function readerAuthorityAffectedSurfaces(recordClasses: readonly string[]):
  { readonly surfaces: readonly ReaderSurfaceId[]; readonly unknownClasses: readonly string[] } {
  const all = READER_SURFACES.map((surface) => surface.id);
  const known: Readonly<Record<string, readonly ReaderSurfaceId[]>> = {
    BALLOT_FILING: ["ballot", "map", "ask", "civic-routing"],
    MEETING: ["meetings", "agenda", "map", "ask", "about-area", "civic-routing"],
    MEETING_OUTCOME: ["meetings", "agenda", "map", "ask", "civic-routing"],
    STATE_LEGISLATOR_VOTES: ["votes", "ballot", "map", "representation", "ask"],
    FEDERAL_ROLL_CALL: ["votes", "ballot", "map", "representation", "ask"],
    FEDERAL_KEY_VOTE: ["votes", "ballot", "map", "representation", "ask"],
    CENSUS_GEOGRAPHY: all,
    REGISTRATION: all,
    CURATED_READER_RECORD: all,
  };
  const unknownClasses = [...new Set(recordClasses.filter((value) => !known[value]))].sort();
  const surfaces = [...new Set(recordClasses.flatMap((value) => known[value] ?? []))].sort();
  return { surfaces, unknownClasses };
}

/** Compare the newly prepared canonical Reader population to the immutable
 * certified census before any old route proof is inherited. A changed row is
 * not made eligible by a successful HTTP response: it needs a fresh full
 * canonical proof with its new denominator. */
export function readerAuthoritySuccessorCensusProblems(
  certified: ReaderCensus,
  current: ReaderCensus,
  changedClasses: readonly string[],
  rowStructuralSha256: (row: ReaderCensus["rows"][number]) => string,
): { readonly problems: readonly string[]; readonly affectedRowIds: readonly string[] } {
  const affected = readerAuthorityAffectedSurfaces(changedClasses);
  const problems: string[] = [];
  if (affected.unknownClasses.length) {
    problems.push(`Reader successor record classes have no classified public reachability: ${affected.unknownClasses.join(", ")}`);
  }
  if (certified.holdingsDigest !== current.holdingsDigest || certified.registrySha256 !== current.registrySha256 ||
      certified.rows.length !== current.rows.length || certified.records.length !== current.records.length) {
    problems.push("Reader successor canonical holdings, registry, or record denominator changed");
  }
  const currentRecords = new Map(current.records.map((record) => [record.auditId, record]));
  if (currentRecords.size !== current.records.length) problems.push("Reader successor canonical records are duplicated");
  for (const record of certified.records) {
    const latest = currentRecords.get(record.auditId);
    if (!latest || canonicalReaderAuthorityJson(record) !== canonicalReaderAuthorityJson(latest)) {
      problems.push(`${record.auditId}: Reader successor canonical record or eligibility changed`);
    }
  }
  const currentRows = new Map(current.rows.map((row) => [row.id, row]));
  if (currentRows.size !== current.rows.length) problems.push("Reader successor canonical rows are duplicated");
  for (const row of certified.rows) {
    const latest = currentRows.get(row.id);
    if (!latest || rowStructuralSha256(row) !== rowStructuralSha256(latest)) {
      problems.push(`${row.id}: Reader successor canonical projection or eligibility changed`);
    }
  }
  const surfaces = new Set(affected.surfaces);
  const affectedRowIds = certified.rows.filter((row) => surfaces.has(row.readerSurface) &&
    (row.applicableEligibleRecordIds ?? row.eligibleRecordIds).length > 0).map((row) => row.id).sort();
  return { problems, affectedRowIds };
}

/** A scoped public readback belongs to the exact live authority it started
 * from. A further promotion during that readback is a new, unproved state. */
export function readerAuthorityPostReadbackProblems(
  beforeReadback: ReaderClosureExecutionAuthorityEvidence,
  afterReadback: ReaderClosureExecutionAuthorityEvidence,
): string[] {
  return canonicalReaderAuthorityJson(beforeReadback) === canonicalReaderAuthorityJson(afterReadback)
    ? []
    : ["Reader execution authority advanced during successor public readback"];
}

type CertifiedPointerBinding = NonNullable<ReaderClosureExecutionAuthorityEvidence["import"]["pointerBindings"]>[number];
type CertifiedCandidateBinding = NonNullable<ReaderClosureExecutionAuthorityEvidence["import"]["candidateBindings"]>[number];

/** Exact key-level delta for a successor readback plan. This names work; it
 * never grants delivery credit. The surrounding authority validators must
 * establish that both binding sets are complete before this is used. */
export function readerAuthorityChangedPointers(
  certified: ReaderClosureExecutionAuthorityEvidence,
  current: ReaderClosureExecutionAuthorityEvidence,
): readonly { readonly key: string; readonly recordClass: string; readonly scope: string;
  readonly certifiedVersionId: string; readonly currentVersionId: string }[] {
  if (certified.formatVersion !== 2 || current.formatVersion !== 2) return [];
  const prior = new Map(certified.import.pointerBindings?.map((binding) => [binding.key, binding]));
  return (current.import.pointerBindings ?? []).flatMap((binding) => {
    const previous = prior.get(binding.key);
    return previous && (previous.rowSha256 !== binding.rowSha256 ||
      previous.currentVersionId !== binding.currentVersionId)
      ? [{ key: binding.key, recordClass: binding.recordClass, scope: binding.scope,
          certifiedVersionId: previous.currentVersionId, currentVersionId: binding.currentVersionId }]
      : [];
  });
}

/** Only these public GET routes can be observed without a model/provider call.
 * A rejected path is not a license to infer delivery from a sibling route. */
export function readerSuccessorPublicProbeKind(path: string):
  "representation" | "meetings" | "agenda" | "votes" | null {
  let url: URL;
  try { url = new URL(path, "https://meanwhileusa.com"); }
  catch { return null; }
  if (url.origin !== "https://meanwhileusa.com" || url.hash ||
      `${url.pathname}${url.search}` !== path) return null;
  const keys = [...url.searchParams.keys()].sort();
  if (url.pathname.startsWith("/api/representation/") &&
      url.pathname.length > "/api/representation/".length && !keys.length) return "representation";
  if (url.pathname === "/api/meetings" &&
      JSON.stringify(keys) === JSON.stringify(["lat", "lng", "zip"]) &&
      /^\d{5}$/.test(url.searchParams.get("zip") ?? "") &&
      Number.isFinite(Number(url.searchParams.get("lat"))) &&
      Number.isFinite(Number(url.searchParams.get("lng")))) return "meetings";
  if (url.pathname === "/api/agenda" && keys.length === 1 && keys[0] === "meetingId" &&
      Boolean(url.searchParams.get("meetingId"))) return "agenda";
  if (url.pathname === "/api/votes" && keys.length === 1 && keys[0] === "member" &&
      Boolean(url.searchParams.get("member"))) return "votes";
  return null;
}

/** A public probe must bind to a named canonical pointer, not merely share a
 * record class or state. Broader meeting and jurisdiction scopes need an
 * explicit candidate-to-route membership map before they can use this seam. */
export function readerSuccessorPublicProbeBindsPointer(
  pointer: { readonly recordClass: string; readonly scope: string },
  path: string,
): boolean {
  const kind = readerSuccessorPublicProbeKind(path);
  if (kind !== "votes" || pointer.recordClass !== "STATE_LEGISLATOR_VOTES" ||
      !pointer.scope.includes(":") || pointer.scope.startsWith("US-")) return false;
  return new URL(path, "https://meanwhileusa.com").searchParams.get("member") === pointer.scope;
}

/** Reconstruct the certified pointer from an immutable historical candidate.
 * The caller must retrieve this exact candidate ID and all its events from the
 * same read-only authority store. Matching an ID alone is never sufficient. */
export function readerAuthorityHistoricalCandidateProblems(
  pointer: CertifiedPointerBinding,
  binding: CertifiedCandidateBinding,
  persistentCandidateRow: Record<string, unknown>,
  normalizedEvents: readonly { candidateId: string; sequence: number; state: string; at: string; detail: string }[],
): string[] {
  const problems: string[] = [];
  if (binding.key !== pointer.key || binding.candidateId !== pointer.currentVersionId ||
      persistentCandidateRow.candidate_id !== binding.candidateId ||
      digest(canonicalReaderAuthorityJson(persistentCandidateRow)) !== binding.rowSha256) {
    return ["Reader successor historical candidate differs from the certified exact row"];
  }
  if (normalizedEvents.length < binding.eventSha256.length ||
      normalizedEvents.some((event, index) => event.candidateId !== binding.candidateId || event.sequence !== index + 1) ||
      binding.eventSha256.some((hash, index) => digest(canonicalReaderAuthorityJson(normalizedEvents[index])) !== hash)) {
    return ["Reader successor historical event prefix differs from the certified exact history"];
  }
  const candidate = row(persistentCandidateRow.candidate);
  const movePrefix = `Atomic pointer ${pointer.key} moved from `;
  const moveSuffix = ` to ${binding.candidateId}.`;
  const moves = normalizedEvents.filter((event) => event.state === "PROMOTED" &&
    event.detail.startsWith(movePrefix) && event.detail.endsWith(moveSuffix));
  const promoted = moves.length === 1 ? moves[0] : null;
  if (!candidate || !promoted || persistentCandidateRow.state !== "PROMOTED" ||
      persistentCandidateRow.promoted_version_id !== binding.candidateId ||
      persistentCandidateRow.candidate_lkg_version_id !== binding.candidateId) {
    return ["Reader successor historical candidate has no terminal promoted proof"];
  }
  const reconstructed = {
    key: pointer.key,
    sourceId: pointer.sourceId,
    recordClass: pointer.recordClass,
    scope: pointer.scope,
    currentVersionId: binding.candidateId,
    lastKnownGoodVersionId: binding.candidateId,
    promotedAt: promoted.at,
    payload: candidate.readModel,
    validationReceipt: persistentCandidateRow.validation_receipt,
  };
  if (digest(canonicalReaderAuthorityJson(reconstructed)) !== pointer.rowSha256) {
    problems.push("Reader successor historical pointer differs from the certified exact row");
  }
  return problems;
}

async function readCandidateHistoryForSuccessor(sql: ReaderAuthoritySql, candidateId: string) {
  const rows = await sql.query(`
    select c.id as candidate_id, c.source_id, c.record_class, c.scope, c.state,
           c.acquisition_succeeded, c.promoted_version_id,
           c.last_known_good_version_id as candidate_lkg_version_id,
           c.failure_code, c.failure_detail, c.candidate, c.validation_receipt
      from public.civic_data_candidates c where c.id = $1::text
  `, [candidateId]);
  if (rows.length !== 1 || rows[0]?.candidate_id !== candidateId) {
    throw new Error("Reader successor historical candidate is missing or ambiguous");
  }
  const events: { candidateId: string; sequence: number; state: string; at: string; detail: string }[] = [];
  let sequence = 0;
  for (;;) {
    const page = await sql.query(`
      select e.candidate_id, e.sequence, e.state, e.at, e.detail
        from public.civic_data_candidate_events e
       where e.candidate_id = $1::text and e.sequence > $2::integer
       order by e.sequence limit 32
    `, [candidateId, sequence]);
    if (page.length === 0) break;
    for (const entry of page) {
      const next = Number(entry.sequence);
      if (entry.candidate_id !== candidateId || next !== sequence + 1) {
        throw new Error("Reader successor historical event sequence is not contiguous");
      }
      sequence = next;
      events.push({ candidateId, sequence, state: String(entry.state),
        at: databaseTimestamp(entry.at), detail: String(entry.detail) });
    }
  }
  if (!events.length) throw new Error("Reader successor historical candidate has no event history");
  return { row: rows[0]!, events };
}

/** Prove the exact certified predecessor still exists, then follow every
 * durable atomic pointer move to the newly observed version. No source fact or
 * public delivery is inferred from this chain; the affected Reader routes
 * still require new readbacks. */
export async function readerAuthorityChangedKeyHistoryProblems(
  expected: ReaderClosureExecutionAuthorityEvidence,
  observed: ReaderClosureExecutionAuthorityEvidence,
  sql: ReaderAuthoritySql,
): Promise<string[]> {
  if (expected.formatVersion !== 2 || observed.formatVersion !== 2) {
    return ["Reader successor history requires a V2 certified per-key baseline"];
  }
  const oldPointers = new Map(expected.import.pointerBindings?.map((binding) => [binding.key, binding]));
  const newPointers = new Map(observed.import.pointerBindings?.map((binding) => [binding.key, binding]));
  const oldCandidates = new Map(expected.import.candidateBindings?.map((binding) => [binding.key, binding]));
  if (!oldPointers.size || oldPointers.size !== newPointers.size || oldPointers.size !== oldCandidates.size ||
      [...oldPointers.keys()].some((key) => !newPointers.has(key))) {
    return ["Reader successor canonical key population changed or lacks historical candidate bindings"];
  }
  const problems: string[] = [];
  for (const [key, prior] of oldPointers) {
    const current = newPointers.get(key)!;
    if (prior.rowSha256 === current.rowSha256 && prior.currentVersionId === current.currentVersionId) continue;
    if (prior.sourceId !== current.sourceId || prior.recordClass !== current.recordClass || prior.scope !== current.scope ||
        prior.currentVersionId === current.currentVersionId) {
      problems.push(`${key}: successor identity or exact version transition is unproved`);
      continue;
    }
    const oldCandidate = oldCandidates.get(key)!;
    try {
      const historical = await readCandidateHistoryForSuccessor(sql, oldCandidate.candidateId);
      const continuity = readerAuthorityHistoricalCandidateProblems(prior, oldCandidate, historical.row, historical.events);
      if (continuity.length) { problems.push(...continuity.map((issue) => `${key}: ${issue}`)); continue; }
      let versionId = current.currentVersionId;
      const seen = new Set<string>();
      let newerAt = Number.POSITIVE_INFINITY;
      while (versionId !== prior.currentVersionId) {
        if (seen.has(versionId) || seen.size >= 256) throw new Error("pointer-move chain cycles or exceeds bounded replay");
        seen.add(versionId);
        const edition = await readCandidateHistoryForSuccessor(sql, versionId);
        const prefix = `Atomic pointer ${key} moved from `;
        const suffix = ` to ${versionId}.`;
        const moves = edition.events.filter((event) => event.state === "PROMOTED" &&
          event.detail.startsWith(prefix) && event.detail.endsWith(suffix));
        if (moves.length !== 1) throw new Error("pointer-move event is missing or ambiguous");
        const move = moves[0]!;
        const priorVersion = move.detail.slice(prefix.length, -suffix.length);
        const moveAt = Date.parse(move.at);
        if (!priorVersion || priorVersion === "bootstrap/no-version" || !Number.isFinite(moveAt) || moveAt >= newerAt) {
          throw new Error("pointer-move predecessor or chronology is invalid");
        }
        const candidate = row(edition.row.candidate);
        if (!candidate || edition.row.source_id !== current.sourceId ||
            edition.row.record_class !== current.recordClass || edition.row.scope !== current.scope) {
          throw new Error("successor candidate identity differs from the certified source");
        }
        const receipt = exactValidationReceipt(edition.row.validation_receipt);
        if (!receipt) throw new Error("successor candidate has no exact GOOD validation receipt");
        const pointer: PromotedProjection = {
          key, sourceId: current.sourceId, recordClass: current.recordClass as RoutineCandidate["recordClass"],
          scope: current.scope, versionId, lastKnownGoodVersionId: String(edition.row.candidate_lkg_version_id),
          promotedAt: move.at, payload: candidate.readModel, receipt,
        };
        const candidateRecord: CandidateVersionRecord = {
          candidate: candidate as unknown as RoutineCandidate,
          state: edition.row.state as CandidateVersionRecord["state"],
          acquisitionSucceeded: boolean(edition.row.acquisition_succeeded),
          receipt: edition.row.validation_receipt,
          promotedVersion: edition.row.promoted_version_id,
          lastKnownGoodVersion: edition.row.candidate_lkg_version_id,
          failureCode: edition.row.failure_code,
          failureDetail: edition.row.failure_detail,
        } as CandidateVersionRecord;
        const issue = promotionProofIssue(pointer.recordClass, pointer.scope, pointer, candidateRecord);
        if (issue) throw new Error(`successor GOOD proof invalid: ${issue}`);
        if (versionId === current.currentVersionId) {
          const normalized = { key, sourceId: pointer.sourceId, recordClass: pointer.recordClass,
            scope: pointer.scope, currentVersionId: versionId,
            lastKnownGoodVersionId: pointer.lastKnownGoodVersionId, promotedAt: move.at,
            payload: pointer.payload, validationReceipt: pointer.receipt };
          if (digest(canonicalReaderAuthorityJson(normalized)) !== current.rowSha256) {
            throw new Error("current pointer differs from its durable successor candidate");
          }
        }
        newerAt = moveAt;
        versionId = priorVersion;
      }
    } catch (error) {
      problems.push(`${key}: ${error instanceof Error ? error.message : "successor history could not be read"}`);
    }
  }
  return problems;
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
    const problems = readerAuthoritySuccessorProblems(expected, observed);
    if (expected.formatVersion === 2 && problems.some((issue) => issue.includes("exact successor projection and public readback"))) {
      const historyProblems = await readerAuthorityChangedKeyHistoryProblems(expected, observed, options.sql);
      if (historyProblems.length) return historyProblems;
    }
    return problems;
  } catch (error) {
    // Driver diagnostics may echo a connection string or credential. The
    // executable retains the detailed error only in memory; terminal output is
    // deliberately a non-secret fail-closed diagnostic.
    void error;
    return ["Reader execution authority live readback failed"];
  }
}
