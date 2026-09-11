import { createHash } from "node:crypto";

const EXACT_HEAD = /^[0-9a-f]{40}$/;
const EXACT_SHA256 = /^[0-9a-f]{64}$/;
const AUTHORITY_RELATIONS = [
  "public.civic_data_candidate_events",
  "public.civic_data_candidates",
  "public.civic_data_promotions",
];
const PINNED_PROJECT_ID = "tiny-hill-13996172";
const PINNED_PRODUCTION_BRANCH_ID = "br-delicate-lab-ax02xuo5";
const PDC_V2_FROZEN_BASE_SHA = "fc67e8cd34c489590c403f7b4a0d6008fa755296";
const PDC_V2_PLANNED_CANDIDATE_COUNT = 95;
const PDC_V2_BASELINE_REGISTERED_PROMOTION_COUNT = 16;
const PDC_V2_FINAL_PROMOTION_COUNT =
  PDC_V2_BASELINE_REGISTERED_PROMOTION_COUNT + PDC_V2_PLANNED_CANDIDATE_COUNT;
// Exact production registry: 10 routine + 124 meeting + 23 manual contracts.
const PDC_V2_REGISTERED_CONTRACT_COUNT = 157;
const PDC_V2_ZERO_LKG_MEETING_PARTITIONS = 41;
const PROJECT_ID = /^[a-z][a-z0-9-]{2,79}$/;
const BRANCH_ID = /^br-[a-z0-9-]{3,100}$/;
const ENDPOINT_ID = /^ep-[a-z0-9-]{3,100}$/;
const AUTHORITY_PATHS = Object.freeze({
  REHEARSAL: Object.freeze({
    authority: "docs/evidence/reader-last-mile-rehearsal-authority.json",
    providerMetadata: "docs/evidence/reader-last-mile-rehearsal-provider-metadata.json",
    importReceipt: "docs/evidence/reader-last-mile-rehearsal-import-receipt.json",
  }),
  PRODUCTION: Object.freeze({
    authority: "docs/evidence/reader-last-mile-production-authority.json",
    providerMetadata: "docs/evidence/reader-last-mile-production-provider-metadata.json",
    importReceipt: "docs/evidence/reader-last-mile-production-import-receipt.json",
  }),
});
const LEGACY_RECEIPTS = Object.freeze({
  "docs/evidence/reader-last-mile-closure-receipt.json": "3aa9b15510ef18786b67e8b0781151caac6432fd2d963f4fba741195681f6f51",
  "docs/evidence/reader-last-mile-disclosure-contract-prior-receipt.json": "8d73e15dd2717aa2215203b011a9ce852209b9ba56ede9133387c7b8e6b242b6",
  "docs/evidence/reader-last-mile-final-closure-receipt.json": "303744f5f0e2dfb21947ddce9b1260a161791e3d9ce916077011605a02838dfb",
  "docs/evidence/reader-last-mile-prompt-caching-prior-receipt.json": "c38bf3b2c5e0152417c5d0367d48837f26334d7a24bd57c9a666d31926bbe796",
  "docs/evidence/reader-last-mile-refresh-baseline-prior-receipt.json": "476cea8d71aa198f5e80ec6037e15c848cc8b1869160b95a29ceb177c83ac0a7",
  "docs/evidence/reader-last-mile-refresh-prior-receipt.json": "8df8a8f1aab56c5c6ecda700d6289c7942a24fb2beaa288908e5f0ec53878744",
  "docs/evidence/reader-last-mile-routine-civic-data-prior-receipt.json": "e697669fe13ac75c176250e1f7edd2764157c7bf55185148841d700b62ecee40",
  "docs/evidence/reader-last-mile-tester-9-4-prior-receipt.json": "95770b41a973cd57cad55f72d5f1d61fb03bd919597686260f112721cefca5af",
  "docs/evidence/reader-last-mile-visual-prior-receipt.json": "1afa1d8448dc31f6c3a01c6f2a612a0b1bdde5e77b8501fa980557892f080a7a",
});

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const identityHash = (kind, value) => hash(`reader-postgres-${kind}-v1\0${value}`);
const plainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
const exactKeys = (value, expected) => {
  const row = plainObject(value);
  return row !== null && JSON.stringify(Object.keys(row).sort()) === JSON.stringify([...expected].sort());
};
const secretKey = /(?:password|passwd|secret|token|api[_-]?key|credential|private[_-]?key|database[_-]?url|connection[_-]?string|dsn|cookie|authorization[_-]?header)/i;
function authoritySecrets(value, path = "Reader execution authority") {
  if (typeof value === "string") return /\bpostgres(?:ql)?:\/\//i.test(value) || /(?:https?:\/\/)[^\s/@]+:[^\s/@]+@/i.test(value) ? [`${path} contains a credential-bearing URL`] : [];
  if (Array.isArray(value)) return value.flatMap((child, index) => authoritySecrets(child, `${path}[${index}]`));
  const row = plainObject(value);
  if (!row) return [];
  return Object.entries(row).flatMap(([key, child]) => [
    ...(secretKey.test(key) && !(key === "legacyRuntimeSecrets" && child === 0) ? [`${path}.${key} is a forbidden secret-bearing field`] : []),
    ...authoritySecrets(child, `${path}.${key}`),
  ]);
}

function canonicalValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Reader authority support contains a non-finite number.");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  const object = plainObject(value);
  if (!object) throw new Error("Reader authority support contains a non-canonical value.");
  return Object.fromEntries(Object.keys(object).sort().flatMap((key) =>
    object[key] === undefined ? [] : [[key, canonicalValue(object[key])]],
  ));
}

const canonicalJson = (value) => JSON.stringify(canonicalValue(value));
const exactIso = (value) => typeof value === "string" && Number.isFinite(Date.parse(value)) &&
  new Date(Date.parse(value)).toISOString() === value;
const safeInteger = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;

function parseSupport(bytes, label) {
  let parsed;
  try { parsed = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error(`${label} is not JSON.`); }
  const object = plainObject(parsed);
  if (!object) throw new Error(`${label} is not an object.`);
  const secrets = authoritySecrets(object, label);
  if (secrets.length) throw new Error(secrets.join("; "));
  return object;
}

function canonicalEndpointHost(value) {
  if (typeof value !== "string" || !/^[a-z0-9.-]+$/.test(value) || value.includes("..")) {
    throw new Error("Reader authority provider endpoint host is invalid.");
  }
  const labels = value.toLowerCase().replace(/\.$/, "").split(".");
  labels[0] = labels[0].replace(/-pooler$/, "");
  const host = labels.join(".");
  if (!host.endsWith(".neon.tech")) throw new Error("Reader authority provider endpoint is not Neon.");
  return host;
}

function validateProviderSupport(metadata, phase) {
  if (!exactKeys(metadata, [
    "schemaVersion", "source", "observedAt", "projectId", "branchId", "branchName",
    "parentBranchId", "defaultBranchId", "endpointId", "endpointHost",
  ])) throw new Error("Reader authority provider metadata shape is not exact.");
  if (metadata.schemaVersion !== 1 || metadata.source !== "NEON_API_BRANCH_READBACK") {
    throw new Error("Reader authority metadata is not a provider API readback.");
  }
  if (!exactIso(metadata.observedAt)) throw new Error("Reader authority metadata clock is invalid.");
  if (
    !PROJECT_ID.test(String(metadata.projectId)) || !BRANCH_ID.test(String(metadata.branchId)) ||
    !BRANCH_ID.test(String(metadata.defaultBranchId)) || !ENDPOINT_ID.test(String(metadata.endpointId)) ||
    typeof metadata.branchName !== "string" || !metadata.branchName ||
    (metadata.parentBranchId !== null && !BRANCH_ID.test(String(metadata.parentBranchId)))
  ) throw new Error("Reader authority provider metadata identifiers are invalid.");
  if (metadata.projectId !== PINNED_PROJECT_ID || metadata.defaultBranchId !== PINNED_PRODUCTION_BRANCH_ID) {
    throw new Error("Reader authority metadata is outside the pinned PDC Neon project/default branch.");
  }
  if (phase === "PRODUCTION") {
    if (metadata.branchId !== PINNED_PRODUCTION_BRANCH_ID) {
      throw new Error("Reader PRODUCTION authority is not the pinned production branch.");
    }
  } else if (
    metadata.branchId === PINNED_PRODUCTION_BRANCH_ID ||
    metadata.parentBranchId !== PINNED_PRODUCTION_BRANCH_ID ||
    !metadata.branchName.startsWith("pdc-v2-rehearsal-")
  ) {
    throw new Error("Reader REHEARSAL authority is not a child of the pinned production branch.");
  }
  const endpointHost = canonicalEndpointHost(metadata.endpointHost);
  if (endpointHost.split(".")[0] !== metadata.endpointId) {
    throw new Error("Reader authority endpoint ID differs from provider metadata host.");
  }
  return { metadata, endpointHost };
}

function exactDispositionSet(value, declaredSha256) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Reader import receipt has no exact disposition membership.");
  }
  const dispositions = value.map((entry) => {
    const disposition = plainObject(entry);
    if (
      !disposition ||
      !exactKeys(disposition, ["contractId", "candidateId", "disposition", "versionId", "readerReadback"]) ||
      typeof disposition.contractId !== "string" || !disposition.contractId ||
      typeof disposition.candidateId !== "string" || !disposition.candidateId ||
      typeof disposition.versionId !== "string" || !disposition.versionId ||
      !["PROMOTED_ABSENT_POINTER", "REATTESTED_EXISTING_AUTHORITY", "SKIPPED_EXISTING_PROVEN_AUTHORITY"].includes(disposition.disposition) ||
      disposition.readerReadback !== "PASS"
    ) throw new Error("Reader import receipt disposition membership shape is not exact.");
    if (disposition.disposition !== "SKIPPED_EXISTING_PROVEN_AUTHORITY" && disposition.candidateId !== disposition.versionId) {
      throw new Error("Reader promoted import disposition candidate/version identity differs.");
    }
    return disposition;
  });
  const contractIds = dispositions.map(({ contractId }) => contractId);
  if (
    new Set(contractIds).size !== contractIds.length ||
    canonicalJson(contractIds) !== canonicalJson([...contractIds].sort())
  ) throw new Error("Reader import receipt disposition membership is duplicated or not canonically ordered.");
  if (!EXACT_SHA256.test(String(declaredSha256)) || hash(canonicalJson(dispositions)) !== declaredSha256) {
    throw new Error("Reader import receipt disposition membership digest differs.");
  }
  return dispositions;
}

function dispositionCounts(dispositions) {
  return {
    promoted: dispositions.filter(({ disposition }) => disposition !== "SKIPPED_EXISTING_PROVEN_AUTHORITY").length,
    reattested: dispositions.filter(({ disposition }) => disposition === "REATTESTED_EXISTING_AUTHORITY").length,
    skipped: dispositions.filter(({ disposition }) => disposition === "SKIPPED_EXISTING_PROVEN_AUTHORITY").length,
    total: dispositions.length,
  };
}

function validateRehearsalReceipt(receipt, receiptBytes, metadataBytes, metadata, exactHead) {
  if (!exactKeys(receipt, [
    "schemaVersion", "result", "mode", "observedAt", "code", "frozen", "neonBranch",
    "databaseIdentity", "authority", "plan", "import", "pointers", "productionMutations",
    "gitMutations", "deploymentMutations", "receiptSha256",
  ])) throw new Error("Reader rehearsal import receipt shape differs from the controller contract.");
  const declaredReceiptSha = String(receipt.receiptSha256 ?? "");
  const unsigned = { ...receipt };
  delete unsigned.receiptSha256;
  if (!EXACT_SHA256.test(declaredReceiptSha) || hash(canonicalJson(unsigned)) !== declaredReceiptSha) {
    throw new Error("Reader rehearsal import receipt self-hash differs.");
  }
  if (receipt.schemaVersion !== 1 || receipt.result !== "PDC_V2_REHEARSAL_IMPORT_PASS" || receipt.mode !== "apply" || !exactIso(receipt.observedAt)) {
    throw new Error("Reader rehearsal receipt is not a completed import.");
  }

  const code = plainObject(receipt.code);
  const frozen = plainObject(receipt.frozen);
  const branch = plainObject(receipt.neonBranch);
  const database = plainObject(receipt.databaseIdentity);
  const authority = plainObject(receipt.authority);
  const plan = plainObject(receipt.plan);
  const imported = plainObject(receipt.import);
  const pointers = plainObject(receipt.pointers);
  if (
    !code || !exactKeys(code, ["exactHeadSha", "detached", "clean", "controllerSha256"]) ||
    code.exactHeadSha !== exactHead || code.detached !== true || code.clean !== true || !EXACT_SHA256.test(String(code.controllerSha256)) ||
    !frozen || !exactKeys(frozen, ["exactHeadSha", "detached", "clean"]) ||
    frozen.exactHeadSha !== PDC_V2_FROZEN_BASE_SHA || frozen.detached !== true || frozen.clean !== true ||
    !authority || !exactKeys(authority, ["databaseRoleDeclaration", "sanctionedWrite", "runtimeCapability", "temporarySelfProcessAuthority", "productionHandlePresentAtExecution"]) ||
    authority.databaseRoleDeclaration !== "local" || authority.sanctionedWrite !== false || authority.runtimeCapability !== "TRUSTED_LKG_IMPORT" ||
    authority.temporarySelfProcessAuthority !== true || authority.productionHandlePresentAtExecution !== false
  ) throw new Error("Reader rehearsal receipt code/frozen/import authority contract differs.");
  if (
    !database || !exactKeys(database, [
      "currentUser", "sessionUser", "database", "currentSchema", "searchPath",
      "transactionReadOnly", "defaultTransactionReadOnly", "inRecovery",
      "canCreateDatabaseObject", "canUsePublicSchema", "canCreateInPublicSchema",
      "ownsRequiredCivicTables", "requiredCivicTablesPresent", "requiredCivicTableWrites",
    ]) || typeof database.currentUser !== "string" || !database.currentUser ||
    database.sessionUser !== database.currentUser || typeof database.database !== "string" || !database.database ||
    database.currentSchema !== "public" || typeof database.searchPath !== "string" ||
    database.transactionReadOnly !== false || database.defaultTransactionReadOnly !== false || database.inRecovery !== false ||
    database.canCreateDatabaseObject !== true || database.canUsePublicSchema !== true || database.canCreateInPublicSchema !== true ||
    database.ownsRequiredCivicTables !== true || database.requiredCivicTablesPresent !== true || database.requiredCivicTableWrites !== true
  ) throw new Error("Reader rehearsal receipt database authority shape differs.");
  if (!branch || !exactKeys(branch, [
    "source", "metadataObservedAt", "metadataSha256", "projectId", "branchId", "branchName",
    "parentBranchId", "defaultBranchId", "endpointId", "endpointHostSha256",
    "productionWriteEndpointHostSha256", "productionReadEndpointHostSha256", "independentExpectation",
  ])) throw new Error("Reader rehearsal receipt branch proof shape differs.");
  const expectation = plainObject(branch.independentExpectation);
  if (
    branch.source !== metadata.source || branch.metadataObservedAt !== metadata.observedAt ||
    branch.metadataSha256 !== hash(metadataBytes) || branch.projectId !== metadata.projectId ||
    branch.branchId !== metadata.branchId || branch.branchName !== metadata.branchName ||
    branch.parentBranchId !== metadata.parentBranchId || branch.defaultBranchId !== metadata.defaultBranchId ||
    branch.endpointId !== metadata.endpointId || branch.endpointHostSha256 !== hash(canonicalEndpointHost(metadata.endpointHost)) ||
    !EXACT_SHA256.test(String(branch.productionWriteEndpointHostSha256)) || !EXACT_SHA256.test(String(branch.productionReadEndpointHostSha256)) ||
    !expectation || !exactKeys(expectation, ["projectId", "branchId", "branchName", "parentBranchId", "productionBranchId"]) ||
    expectation.projectId !== metadata.projectId || expectation.branchId !== metadata.branchId ||
    expectation.branchName !== metadata.branchName || expectation.parentBranchId !== metadata.parentBranchId ||
    expectation.productionBranchId !== PINNED_PRODUCTION_BRANCH_ID
  ) throw new Error("Reader rehearsal import receipt differs from exact code/provider authority.");
  if (
    !plan || !exactKeys(plan, ["contractVersion", "frozenBaseSha", "importerCodeSha", "candidateCount", "meetingPartitionsWithLkg", "meetingPartitionsWithoutLkg", "meetingRows", "agendaDocumentRows", "manualContracts", "planSha256"]) ||
    plan.contractVersion !== 1 || plan.frozenBaseSha !== PDC_V2_FROZEN_BASE_SHA || plan.importerCodeSha !== exactHead ||
    !EXACT_SHA256.test(String(plan.planSha256)) ||
    !["candidateCount", "meetingPartitionsWithLkg", "meetingPartitionsWithoutLkg", "meetingRows", "agendaDocumentRows", "manualContracts"].every((field) => safeInteger(plan[field]))
  ) throw new Error("Reader rehearsal plan schema differs from the frozen authority.");

  const before = plainObject(pointers?.before);
  const after = plainObject(pointers?.after);
  const beforeCounts = plainObject(before?.rowCounts);
  const afterCounts = plainObject(after?.rowCounts);
  if (
    !pointers || !exactKeys(pointers, ["before", "after", "changedKeyMembership", "currentPointerSha256"]) ||
    !before || !after || !exactKeys(before, ["count", "sha256", "rowCounts"]) || !exactKeys(after, ["count", "sha256", "rowCounts"]) ||
    !beforeCounts || !afterCounts || !exactKeys(beforeCounts, ["candidates", "events", "promotions"]) || !exactKeys(afterCounts, ["candidates", "events", "promotions"]) ||
    ![beforeCounts, afterCounts].every((counts) => Object.values(counts).every((value) => typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value))) ||
    !Array.isArray(pointers.changedKeyMembership) || pointers.changedKeyMembership.some((key) => typeof key !== "string" || !key) ||
    new Set(pointers.changedKeyMembership).size !== pointers.changedKeyMembership.length ||
    canonicalJson(pointers.changedKeyMembership) !== canonicalJson([...pointers.changedKeyMembership].sort()) ||
    !safeInteger(before.count) || !EXACT_SHA256.test(String(before.sha256)) || !safeInteger(after.count, 1) ||
    !EXACT_SHA256.test(String(after.sha256)) ||
    beforeCounts.promotions !== String(before.count) || afterCounts.promotions !== String(after.count) ||
    pointers.currentPointerSha256 !== after.sha256
  ) throw new Error("Reader rehearsal pointer readback schema is not exact.");

  if (
    !imported || !exactKeys(imported, ["contractVersion", "frozenBaseSha", "importerCodeSha", "importedAt", "promoted", "reattestedExisting", "skippedExisting", "zeroMeetingPartitionsRefused", "dispositionCount", "dispositionCounts", "dispositionSet", "dispositionSetSha256", "legacyMeetingsAggregateRetirement", "resultSha256"]) ||
    imported.contractVersion !== 1 || imported.frozenBaseSha !== PDC_V2_FROZEN_BASE_SHA || imported.importerCodeSha !== exactHead ||
    !exactIso(imported.importedAt) || !EXACT_SHA256.test(String(imported.resultSha256)) ||
    imported.zeroMeetingPartitionsRefused !== PDC_V2_ZERO_LKG_MEETING_PARTITIONS
  ) throw new Error("Reader rehearsal nested importer receipt differs from exact code/frozen authority.");
  const retirement = plainObject(imported.legacyMeetingsAggregateRetirement);
  if (
    !retirement || !exactKeys(retirement, ["disposition", "legacyVersionId", "retiredAt", "legacyMeetingFactSha256", "replacementPointerSha256"]) ||
    !["RETIRED", "ALREADY_RETIRED_PROVEN"].includes(retirement.disposition) || typeof retirement.legacyVersionId !== "string" || !retirement.legacyVersionId ||
    !exactIso(retirement.retiredAt) || !EXACT_SHA256.test(String(retirement.legacyMeetingFactSha256)) || !EXACT_SHA256.test(String(retirement.replacementPointerSha256)) ||
    receipt.productionMutations !== 0 || receipt.gitMutations !== 0 || receipt.deploymentMutations !== 0
  ) throw new Error("Reader rehearsal retirement/mutation evidence is not exact.");
  const dispositions = exactDispositionSet(imported.dispositionSet, imported.dispositionSetSha256);
  const counts = dispositionCounts(dispositions);
  const declaredCounts = {
    promoted: imported.promoted,
    reattested: imported.reattestedExisting,
    skipped: imported.skippedExisting,
    total: imported.dispositionCount,
  };
  if (canonicalJson(counts) !== canonicalJson(declaredCounts)) {
    throw new Error("Reader rehearsal disposition counts differ from their exact membership.");
  }
  const classCounts = plainObject(imported.dispositionCounts);
  const expectedClassCounts = Object.fromEntries([
    ["PROMOTED_ABSENT_POINTER", dispositions.filter(({ disposition }) => disposition === "PROMOTED_ABSENT_POINTER").length],
    ["REATTESTED_EXISTING_AUTHORITY", counts.reattested],
    ["SKIPPED_EXISTING_PROVEN_AUTHORITY", counts.skipped],
  ].filter(([, count]) => count > 0));
  if (!classCounts || !exactKeys(classCounts, Object.keys(expectedClassCounts)) || canonicalJson(classCounts) !== canonicalJson(expectedClassCounts)) {
    throw new Error("Reader rehearsal import disposition classes differ from the exact denominator.");
  }
  const absentPromotions = dispositions.filter(({ disposition }) => disposition === "PROMOTED_ABSENT_POINTER").length;
  const existingDispositions = counts.reattested + counts.skipped;
  const retiredLegacyPointers = retirement.disposition === "RETIRED" ? 1 : 0;
  if (
    plan.candidateCount !== PDC_V2_PLANNED_CANDIDATE_COUNT ||
    plan.meetingPartitionsWithoutLkg !== imported.zeroMeetingPartitionsRefused ||
    Number(plan.meetingPartitionsWithLkg) + Number(plan.manualContracts) !== Number(plan.candidateCount) ||
    Number(before.count) < retiredLegacyPointers ||
    existingDispositions !== Number(before.count) - retiredLegacyPointers ||
    existingDispositions < PDC_V2_BASELINE_REGISTERED_PROMOTION_COUNT ||
    absentPromotions > PDC_V2_PLANNED_CANDIDATE_COUNT ||
    Number(after.count) !== Number(before.count) - retiredLegacyPointers + absentPromotions ||
    Number(after.count) !== PDC_V2_FINAL_PROMOTION_COUNT ||
    counts.total !== Number(after.count) ||
    pointers.changedKeyMembership.length !== counts.promoted + retiredLegacyPointers ||
    pointers.changedKeyMembership.includes("MEETING:supported-bodies") !== (retiredLegacyPointers === 1)
  ) {
    throw new Error("Reader rehearsal plan/pointer transition differs from its exact durable import dispositions.");
  }
  return {
    importerCodeSha: exactHead,
    expectedPointerSha256: String(pointers.currentPointerSha256),
    expectedPointerCount: Number(after.count),
    counts,
    dispositionSetSha256: String(imported.dispositionSetSha256),
    resultSha256: String(imported.resultSha256),
  };
}

function validateProductionReceipt(receipt, receiptBytes, exactHead) {
  if (!exactKeys(receipt, [
    "schemaVersion", "result", "apply", "observedAt", "importSha", "frozenBaseSha",
    "migrationBlobSha1", "cutoverContractSha256", "narrowRoleProofSha256", "githubProofSha256",
    "lineage", "prewriteAdmission", "preImportAuthority", "github", "host", "import",
    "postImport", "commitBAdmissionReady",
  ])) throw new Error("Reader production authority-transfer receipt shape differs.");
  const imported = plainObject(receipt.import);
  const postImport = plainObject(receipt.postImport);
  const lineage = plainObject(receipt.lineage);
  const admission = plainObject(receipt.prewriteAdmission);
  const preImport = plainObject(receipt.preImportAuthority);
  const github = plainObject(receipt.github);
  const host = plainObject(receipt.host);
  if (
    receipt.schemaVersion !== 1 || receipt.result !== "PDC_AUTHORITY_TRANSFER_COMPLETE_B_ADMISSION_READY" ||
    receipt.apply !== true || receipt.commitBAdmissionReady !== true || !exactIso(receipt.observedAt) ||
    !EXACT_HEAD.test(String(receipt.importSha)) || receipt.importSha === exactHead ||
    receipt.frozenBaseSha !== PDC_V2_FROZEN_BASE_SHA || !EXACT_HEAD.test(String(receipt.migrationBlobSha1)) ||
    !EXACT_SHA256.test(String(receipt.cutoverContractSha256)) || !EXACT_SHA256.test(String(receipt.narrowRoleProofSha256)) ||
    !EXACT_SHA256.test(String(receipt.githubProofSha256)) || receiptBytes.byteLength === 0
  ) throw new Error("Reader production authority-transfer receipt is not terminally green or does not prove distinct importer A / authority B commits.");
  if (
    !lineage || !exactKeys(lineage, ["frozenImportDataBaseSha", "exactQuiescedMainSha", "reviewedPostFrozenMainCommitOids", "importCommitASha", "importCommitALinearAfterExactMain", "preservedConcurrentPullRequests"]) ||
    lineage.frozenImportDataBaseSha !== PDC_V2_FROZEN_BASE_SHA || !EXACT_HEAD.test(String(lineage.exactQuiescedMainSha)) ||
    lineage.importCommitASha !== receipt.importSha || lineage.importCommitALinearAfterExactMain !== true ||
    !Array.isArray(lineage.reviewedPostFrozenMainCommitOids) || lineage.reviewedPostFrozenMainCommitOids.some((sha) => !EXACT_HEAD.test(String(sha))) ||
    new Set(lineage.reviewedPostFrozenMainCommitOids).size !== lineage.reviewedPostFrozenMainCommitOids.length ||
    !Array.isArray(lineage.preservedConcurrentPullRequests) ||
    canonicalJson(lineage.preservedConcurrentPullRequests.map((pr) => Number(plainObject(pr)?.number)).sort((a, b) => a - b)) !== canonicalJson([302, 303]) ||
    lineage.preservedConcurrentPullRequests.some((entry) => {
      const pr = plainObject(entry);
      return !pr || !exactKeys(pr, ["number", "state", "isDraft", "baseRefName", "baseRefOid", "headRefName", "headRefOid", "uniqueCommitOids", "headAncestorOfA", "uniqueCommitsInAAncestry", "patchEquivalentCommitsInA"]) ||
        ![302, 303].includes(pr.number) || pr.state !== "OPEN" || typeof pr.isDraft !== "boolean" || pr.baseRefName !== "main" ||
        !EXACT_HEAD.test(String(pr.baseRefOid)) || typeof pr.headRefName !== "string" || !pr.headRefName || !EXACT_HEAD.test(String(pr.headRefOid)) ||
        !Array.isArray(pr.uniqueCommitOids) || pr.uniqueCommitOids.some((sha) => !EXACT_HEAD.test(String(sha))) ||
        new Set(pr.uniqueCommitOids).size !== pr.uniqueCommitOids.length || pr.headAncestorOfA !== false ||
        pr.uniqueCommitsInAAncestry !== 0 || pr.patchEquivalentCommitsInA !== 0;
    })
  ) throw new Error("Reader production authority-transfer lineage is not exact and linear.");
  if (
    !admission || !exactKeys(admission, ["protocol", "nonceSha256", "parentPid", "readyRequests", "liveRecensusAtReady", "receiptTtlMs"]) ||
    admission.protocol !== 1 || !EXACT_SHA256.test(String(admission.nonceSha256)) || !safeInteger(admission.parentPid, 1) ||
    admission.readyRequests !== 1 || admission.liveRecensusAtReady !== true || !safeInteger(admission.receiptTtlMs, 1) ||
    !preImport || !exactKeys(preImport, [
      "initialCensus", "liveRecensusAtReady", "exact0026PreflightWithProspectiveSuccessors",
      "registeredContractKeys", "canonicalPromotionCount", "registeredCurrentPromotionCount",
      "obsoleteAggregatePointers", "durableRetirementReceipt", "liveLegacyVersionId",
      "liveLegacyPointerSha256", "liveLegacyCandidateRecordSha256", "liveLegacyHistorySha256",
      "liveLegacyHistoryEventCount", "liveLegacyMeetingFactSha256", "liveLegacyMeetingRowCount",
      "liveLegacyAgendaDocumentRowCount", "prospectiveReattestationCount",
    ]) ||
    preImport.initialCensus !== "PASS" || preImport.liveRecensusAtReady !== "PASS" || preImport.exact0026PreflightWithProspectiveSuccessors !== "PASS" ||
    !["registeredContractKeys", "canonicalPromotionCount", "registeredCurrentPromotionCount", "obsoleteAggregatePointers", "liveLegacyHistoryEventCount", "liveLegacyMeetingRowCount", "liveLegacyAgendaDocumentRowCount", "prospectiveReattestationCount"].every((field) => safeInteger(preImport[field])) ||
    typeof preImport.liveLegacyVersionId !== "string" || !preImport.liveLegacyVersionId ||
    !["liveLegacyPointerSha256", "liveLegacyCandidateRecordSha256", "liveLegacyHistorySha256", "liveLegacyMeetingFactSha256"].every((field) => EXACT_SHA256.test(String(preImport[field])))
  ) throw new Error("Reader production prewrite/live-recensus authority is not terminally green.");
  if (
    !github || !exactKeys(github, ["legacyWorkflowDefinitionsDisabled", "nonterminalLegacyRuns", "bypassActors", "enabledWriteDeployKeys", "legacyRuntimeSecrets"]) ||
    github.legacyWorkflowDefinitionsDisabled !== 8 || github.nonterminalLegacyRuns !== 0 || github.bypassActors !== 0 || github.enabledWriteDeployKeys !== 0 || github.legacyRuntimeSecrets !== 0 ||
    !host || !exactKeys(host, ["obsoleteScheduledTasks", "startupLaunchers", "oldProcessTreeMembers"]) ||
    host.obsoleteScheduledTasks !== 0 || host.startupLaunchers !== 0 || host.oldProcessTreeMembers !== 0
  ) throw new Error("Reader production authority transfer did not retain zero legacy GitHub/host writers.");
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
    !EXACT_SHA256.test(String(imported.dispositionSetSha256)) || !EXACT_SHA256.test(String(imported.resultSha256)) ||
    imported.zeroMeetingPartitionsRefused !== PDC_V2_ZERO_LKG_MEETING_PARTITIONS ||
    !["legacyMeetingFactSha256", "replacementPointerSha256", "legacyPointerSha256", "legacyCandidateRecordSha256", "legacyHistorySha256", "replacementFullPointerSetSha256", "replacementCandidateRecordSetSha256", "replacementHistorySetSha256", "replacementAuthoritySha256"].every((field) => EXACT_SHA256.test(String(imported[field]))) ||
    !safeInteger(imported.legacyHistoryEventCount, 1) ||
    !["RETIRED", "ALREADY_RETIRED_PROVEN"].includes(imported.retirementDisposition) || imported.durableRetirementReceiptExact !== true ||
    !postImport || !exactKeys(postImport, ["exact0026Preflight", "schema", "promotionCount", "expectedPromotionCount", "registeredContractCount", "obsoleteAggregatePointers", "unregisteredPromotions"]) ||
    postImport.exact0026Preflight !== "PASS" || postImport.schema !== "pre-0026" ||
    !["promotionCount", "expectedPromotionCount", "registeredContractCount", "obsoleteAggregatePointers", "unregisteredPromotions"].every((field) => safeInteger(postImport[field])) ||
    postImport.promotionCount !== postImport.expectedPromotionCount ||
    postImport.registeredContractCount !== preImport.registeredContractKeys ||
    postImport.registeredContractCount !== PDC_V2_REGISTERED_CONTRACT_COUNT ||
    postImport.promotionCount > postImport.registeredContractCount ||
    postImport.obsoleteAggregatePointers !== 0 || postImport.unregisteredPromotions !== 0
  ) throw new Error("Reader production import/retirement/post-import receipt shape differs.");
  const dispositions = exactDispositionSet(imported.dispositionSet, imported.dispositionSetSha256);
  const counts = dispositionCounts(dispositions);
  if (canonicalJson(counts) !== canonicalJson({
    promoted: imported.promoted,
    reattested: imported.reattestedExisting,
    skipped: imported.skippedExisting,
    total: imported.dispositions,
  })) throw new Error("Reader production disposition counts differ from their exact membership.");
  if (postImport.promotionCount <= 0 || postImport.promotionCount !== counts.total) {
    throw new Error("Reader production authority-transfer receipt has no exact promotion denominator.");
  }
  const absentPromotions = dispositions.filter(({ disposition }) => disposition === "PROMOTED_ABSENT_POINTER").length;
  const existingDispositions = counts.reattested + counts.skipped;
  const retiredLegacyPointers = imported.retirementDisposition === "RETIRED" ? 1 : 0;
  const expectedRetirementProof = retiredLegacyPointers === 1 ? "NOT_APPLICABLE_POINTER_PRESENT" : "PASS";
  const replacementAuthoritySha256 = hash(canonicalJson({
    replacementFullPointerSetSha256: imported.replacementFullPointerSetSha256,
    replacementCandidateRecordSetSha256: imported.replacementCandidateRecordSetSha256,
    replacementHistorySetSha256: imported.replacementHistorySetSha256,
  }));
  if (
    preImport.obsoleteAggregatePointers !== retiredLegacyPointers ||
    preImport.durableRetirementReceipt !== expectedRetirementProof ||
    preImport.canonicalPromotionCount !== preImport.registeredCurrentPromotionCount + retiredLegacyPointers ||
    existingDispositions !== preImport.registeredCurrentPromotionCount ||
    absentPromotions > PDC_V2_PLANNED_CANDIDATE_COUNT ||
    postImport.promotionCount !== preImport.registeredCurrentPromotionCount + absentPromotions ||
    postImport.promotionCount !== PDC_V2_FINAL_PROMOTION_COUNT ||
    imported.legacyPointerSha256 !== preImport.liveLegacyPointerSha256 ||
    imported.legacyCandidateRecordSha256 !== preImport.liveLegacyCandidateRecordSha256 ||
    imported.legacyHistorySha256 !== preImport.liveLegacyHistorySha256 ||
    imported.legacyHistoryEventCount !== preImport.liveLegacyHistoryEventCount ||
    imported.legacyMeetingFactSha256 !== preImport.liveLegacyMeetingFactSha256 ||
    imported.replacementAuthoritySha256 !== replacementAuthoritySha256
  ) throw new Error("Reader production authority transition differs from its exact pre/import/post evidence.");
  return {
    importerCodeSha: String(receipt.importSha),
    expectedPointerSha256: null,
    expectedPointerCount: Number(postImport.promotionCount),
    counts,
    dispositionSetSha256: String(imported.dispositionSetSha256),
    resultSha256: String(imported.resultSha256),
  };
}

function validateArchivedSupport(evidence, providerBytes, importBytes) {
  const provider = parseSupport(providerBytes, "Reader provider metadata");
  const { metadata, endpointHost } = validateProviderSupport(provider, evidence.phase);
  const importReceipt = parseSupport(importBytes, "Reader import receipt");
  const imported = evidence.phase === "REHEARSAL"
    ? validateRehearsalReceipt(importReceipt, importBytes, providerBytes, metadata, evidence.exactHead)
    : validateProductionReceipt(importReceipt, importBytes, evidence.exactHead);
  if (evidence.store.providerMetadataSha256 !== hash(providerBytes)) throw new Error("Reader execution authority provider metadata bytes changed.");
  if (evidence.import.receiptSha256 !== hash(importBytes)) throw new Error("Reader execution authority import receipt bytes changed.");
  if (evidence.store.projectIdentitySha256 !== identityHash("project", metadata.projectId)) throw new Error("Reader execution authority provider project identity differs.");
  if (evidence.store.branchIdentitySha256 !== identityHash("branch", metadata.branchId)) throw new Error("Reader execution authority provider branch identity differs.");
  if (evidence.store.endpointIdentitySha256 !== identityHash("endpoint", endpointHost)) throw new Error("Reader execution authority provider endpoint identity differs.");
  if (evidence.import.importerCodeSha !== imported.importerCodeSha) throw new Error("Reader execution authority importer differs from its archived controller receipt.");
  if (evidence.import.resultSha256 !== imported.resultSha256) throw new Error("Reader execution authority result digest differs from its archived controller receipt.");
  if (evidence.import.dispositionSetSha256 !== imported.dispositionSetSha256) throw new Error("Reader execution authority disposition membership digest differs from its archived controller receipt.");
  if (evidence.import.canonicalPointerCount !== imported.expectedPointerCount) throw new Error("Reader execution authority pointer count differs from its archived controller receipt.");
  if (imported.expectedPointerSha256 !== null && evidence.import.canonicalPointerSetSha256 !== imported.expectedPointerSha256) {
    throw new Error("Reader execution authority pointer digest differs from its archived rehearsal receipt.");
  }
  const durable = evidence.import.durableImport;
  if (
    durable.promotedDispositionCount !== imported.counts.promoted ||
    durable.reattestedDispositionCount !== imported.counts.reattested ||
    durable.skippedDispositionCount !== imported.counts.skipped ||
    durable.candidateCount !== imported.counts.total
  ) throw new Error("Reader execution authority live disposition denominator differs from its archived controller receipt.");
  if (evidence.phase === "REHEARSAL" && (
    evidence.clone?.sourceSnapshotSha256 !== hash(importBytes) ||
    evidence.clone?.controlPlaneReceiptSha256 !== hash(providerBytes)
  )) throw new Error("Reader rehearsal clone hashes differ from its exact archived support bytes.");
}

function isKnownLegacyReceipt(receipt, options) {
  const expected = LEGACY_RECEIPTS[options.receiptPath];
  if (!expected || !Buffer.isBuffer(options.receiptBytes) || hash(options.receiptBytes) !== expected) return false;
  try { return JSON.stringify(JSON.parse(options.receiptBytes.toString("utf8"))) === JSON.stringify(receipt); }
  catch { return false; }
}

function parsedEvidence(readEvidence, path) {
  return JSON.parse(readEvidence(path).toString("utf8"));
}

/**
 * Resolve the exact code head proved by a Reader closure receipt.
 *
 * Documentary/inherited receipts retain their established invalidation-report
 * authority. A fresh receipt has no inheritance report, so every applicable
 * census row must independently name the same exact executed head.
 */
export function readerProofHead(receipt, readEvidence) {
  if (receipt?.inheritance) {
    const reportPath = receipt.inheritance.reportPath;
    if (typeof reportPath !== "string" || !reportPath) {
      throw new Error("The reader closure receipt does not name an inheritance report.");
    }
    const readerHead = parsedEvidence(readEvidence, reportPath).currentReaderHead;
    if (!EXACT_HEAD.test(readerHead ?? "")) {
      throw new Error("The reader closure receipt does not name an exact executed head.");
    }
    return readerHead;
  }

  if (typeof receipt?.censusPath !== "string" || !receipt.censusPath) {
    throw new Error("The fresh reader closure receipt does not name its census.");
  }
  const census = parsedEvidence(readEvidence, receipt.censusPath);
  if (!Array.isArray(census.rows)) {
    throw new Error("The fresh reader closure census does not contain rows.");
  }

  const applicableRows = census.rows.filter((row) => {
    const ids = row?.applicableEligibleRecordIds ?? row?.eligibleRecordIds;
    return Array.isArray(ids) && ids.length > 0;
  });
  if (!applicableRows.length) {
    throw new Error("The fresh reader closure census has no applicable rows.");
  }

  const heads = new Set();
  for (const row of applicableRows) {
    if (!EXACT_HEAD.test(row?.provedHead ?? "")) {
      throw new Error(`Applicable reader census row ${row?.id ?? "<unknown>"} does not name an exact executed head.`);
    }
    heads.add(row.provedHead);
  }
  if (heads.size !== 1) {
    throw new Error("The fresh reader closure census combines multiple executed heads.");
  }
  return [...heads][0];
}

/**
 * Resolve the hash-bound execution authority for history certification.
 * Historical inherited receipts may predate this field; a fresh receipt may
 * not. This check deliberately stays phase-agnostic. The explicit terminal
 * gate separately requires PRODUCTION.
 */
export function readerProofAuthority(receipt, readEvidence, readerHead, options = {}) {
  const receiptKeys = [
    "formatVersion", "censusPath", "censusSha256", "holdingsDigest", "registrySha256",
    "sourceHashes", "evidenceHashes",
    ...(Object.hasOwn(receipt ?? {}, "sourceEolEquivalences") ? ["sourceEolEquivalences"] : []),
    ...(Object.hasOwn(receipt ?? {}, "executionAuthority") ? ["executionAuthority"] : []),
    ...(Object.hasOwn(receipt ?? {}, "inheritance") ? ["inheritance"] : []),
  ];
  if (!exactKeys(receipt, receiptKeys)) throw new Error("Reader closure receipt fields differ from the exact schema.");
  if (receipt?.formatVersion !== 1 || !Array.isArray(receipt?.sourceHashes) || !Array.isArray(receipt?.evidenceHashes)) {
    throw new Error("Reader closure receipt required fields are invalid.");
  }
  for (const manifest of [receipt.sourceHashes, receipt.evidenceHashes]) {
    if (manifest.some((entry) => !exactKeys(entry, ["path", "sha256"]) || typeof entry.path !== "string" || !EXACT_SHA256.test(entry.sha256 ?? "")) || new Set(manifest.map(({ path }) => path)).size !== manifest.length) {
      throw new Error("Reader closure receipt hash manifest fields are not exact and unique.");
    }
  }
  if (receipt.inheritance && !exactKeys(receipt.inheritance, ["reportPath", "reportSha256"])) {
    throw new Error("Reader closure inheritance fields differ from the exact schema.");
  }
  if (receipt.sourceEolEquivalences && (!Array.isArray(receipt.sourceEolEquivalences) || receipt.sourceEolEquivalences.some((entry) => !exactKeys(entry, ["path", "recordedSha256", "canonicalLfSha256", "archivePath", "archiveSha256", "gitEol", "typescriptVersion", "emittedJsSha256"])))) {
    throw new Error("Reader closure source EOL equivalence fields differ from the exact schema.");
  }
  const receiptSecrets = authoritySecrets(receipt, "Reader closure receipt");
  if (receiptSecrets.length) throw new Error(receiptSecrets.join("; "));
  const reference = receipt?.executionAuthority;
  if (!reference) {
    if (isKnownLegacyReceipt(receipt, options)) return { phase: "LEGACY_INHERITED", importerCodeSha: null };
    throw new Error("Fresh Reader closure requires exact execution-authority evidence.");
  }
  if (!exactKeys(reference, ["phase", "evidencePath", "evidenceSha256"])) {
    throw new Error("Reader execution authority reference fields differ from the exact schema.");
  }
  if (reference.phase !== "REHEARSAL" && reference.phase !== "PRODUCTION") {
    throw new Error("Reader execution authority reference phase is invalid.");
  }
  const expectedPaths = AUTHORITY_PATHS[reference.phase];
  if (options.requiredPhase && reference.phase !== options.requiredPhase) {
    throw new Error(`Reader closure requires ${options.requiredPhase} execution authority.`);
  }
  if (reference.evidencePath !== expectedPaths.authority || !EXACT_SHA256.test(reference.evidenceSha256 ?? "")) {
    throw new Error("Reader execution authority reference is not a hash-bound last-mile artifact.");
  }
  const bytes = readEvidence(reference.evidencePath);
  if (hash(bytes) !== reference.evidenceSha256) {
    throw new Error("Reader execution authority evidence bytes changed.");
  }
  const manifested = (receipt.evidenceHashes ?? []).filter((entry) => entry?.path === reference.evidencePath && entry?.sha256 === reference.evidenceSha256);
  if (manifested.length !== 1) {
    throw new Error("Reader execution authority is not included exactly once in the closure evidence manifest.");
  }
  const evidence = JSON.parse(bytes.toString("utf8"));
  if (!exactKeys(evidence, ["formatVersion", "phase", "exactHead", "store", "readOnly", "import", "clone"])) {
    throw new Error("Reader execution authority artifact fields differ from the exact schema.");
  }
  const secrets = authoritySecrets(evidence);
  if (secrets.length) throw new Error(secrets.join("; "));
  if (evidence?.formatVersion !== 1 || evidence?.phase !== reference.phase) {
    throw new Error("Reader execution authority artifact phase or format differs from its receipt.");
  }
  if (!EXACT_HEAD.test(evidence?.exactHead ?? "") || evidence.exactHead !== readerHead) {
    throw new Error("Reader execution authority does not bind the exact proved code head.");
  }
  const store = evidence?.store;
  if (!exactKeys(store, ["kind", "authority", "projectIdentitySha256", "branchIdentitySha256", "endpointIdentitySha256", "databaseIdentitySha256", "schemaIdentitySha256", "providerMetadataPath", "providerMetadataSha256"])) {
    throw new Error("Reader execution authority store fields differ from the exact schema.");
  }
  if (store?.kind !== "NEON_POSTGRES") throw new Error("Reader execution authority does not identify the canonical Neon Postgres plane.");
  for (const field of ["projectIdentitySha256", "branchIdentitySha256", "endpointIdentitySha256", "databaseIdentitySha256", "schemaIdentitySha256", "providerMetadataSha256"]) {
    if (!EXACT_SHA256.test(store?.[field] ?? "")) throw new Error(`Reader execution authority store ${field} is not a sanitized identity.`);
  }
  if (store.providerMetadataPath !== expectedPaths.providerMetadata || store.projectIdentitySha256 !== identityHash("project", PINNED_PROJECT_ID)) {
    throw new Error("Reader execution authority does not bind the archived provider readback and pinned project.");
  }
  const productionBranchIdentity = identityHash("branch", PINNED_PRODUCTION_BRANCH_ID);
  if (reference.phase === "PRODUCTION" && store.branchIdentitySha256 !== productionBranchIdentity) {
    throw new Error("Reader production execution authority does not bind the pinned production branch.");
  }
  const readOnly = evidence?.readOnly;
  if (!exactKeys(readOnly, ["roleIdentitySha256", "roleWritePrivilegesRefused", "attemptedWriteRefused", "roleSuperuser", "roleCreateRole", "roleCreateDatabase", "roleReplication", "roleBypassRls", "databaseCreate", "schemaCreate", "relationOwnershipCount", "columnWritePrivilegeCount", "sequenceWritePrivilegeCount", "writeCapableMemberRoleCount", "executableSecurityDefinerFunctionCount", "relations"])) {
    throw new Error("Reader execution authority read-only fields differ from the exact schema.");
  }
  if (!EXACT_SHA256.test(readOnly?.roleIdentitySha256 ?? "") || readOnly?.attemptedWriteRefused !== true || readOnly?.roleWritePrivilegesRefused !== true ||
      readOnly.roleSuperuser !== false || readOnly.roleCreateRole !== false || readOnly.roleCreateDatabase !== false || readOnly.roleReplication !== false || readOnly.roleBypassRls !== false ||
      readOnly.databaseCreate !== false || readOnly.schemaCreate !== false || readOnly.relationOwnershipCount !== 0 || readOnly.columnWritePrivilegeCount !== 0 || readOnly.sequenceWritePrivilegeCount !== 0 || readOnly.writeCapableMemberRoleCount !== 0 || readOnly.executableSecurityDefinerFunctionCount !== 0) {
    throw new Error("Reader execution authority does not prove its exact read-only principal.");
  }
  const relationNames = Array.isArray(readOnly?.relations) ? readOnly.relations.map((row) => row?.relation).sort() : [];
  if (JSON.stringify(relationNames) !== JSON.stringify(AUTHORITY_RELATIONS) || readOnly.relations.some((row) => !exactKeys(row, ["relation", "select", "insert", "update", "delete", "truncate", "references", "trigger"]) || row?.select !== true || row?.insert !== false || row?.update !== false || row?.delete !== false || row?.truncate !== false || row?.references !== false || row?.trigger !== false)) {
    throw new Error("Reader execution authority does not prove the exact read-only civic-data relation set.");
  }
  const imported = evidence?.import;
  if (!exactKeys(imported, ["importerCodeSha", "receiptPath", "receiptSha256", "resultSha256", "dispositionSetSha256", "canonicalPointerSetSha256", "canonicalPointerCount", "durableImport"])) {
    throw new Error("Reader execution authority import fields differ from the exact schema.");
  }
  if (!EXACT_HEAD.test(imported?.importerCodeSha ?? "") || !EXACT_SHA256.test(imported?.receiptSha256 ?? "") || !EXACT_SHA256.test(imported?.resultSha256 ?? "") || !EXACT_SHA256.test(imported?.dispositionSetSha256 ?? "") || !EXACT_SHA256.test(imported?.canonicalPointerSetSha256 ?? "") || !Number.isSafeInteger(imported?.canonicalPointerCount) || imported.canonicalPointerCount <= 0) {
    throw new Error("Reader execution authority does not bind an exact importer receipt and canonical pointer set.");
  }
  if (reference.phase === "PRODUCTION" && imported.importerCodeSha === evidence.exactHead) {
    throw new Error("Reader production execution authority was generated before the importer was deleted in child commit B.");
  }
  if (reference.phase === "REHEARSAL" && imported.importerCodeSha !== evidence.exactHead) {
    throw new Error("Reader rehearsal execution authority does not bind its exact isolated import head.");
  }
  if (imported.receiptPath !== expectedPaths.importReceipt) throw new Error("Reader execution authority import receipt does not match its exact phase-specific support path.");
  if (new Set([reference.evidencePath, store.providerMetadataPath, imported.receiptPath]).size !== 3) {
    throw new Error("Reader execution authority and support artifacts are not three distinct paths.");
  }
  let providerMetadataBytes;
  let importReceiptBytes;
  for (const [path, expectedHash, label, assign] of [
    [store.providerMetadataPath, store.providerMetadataSha256, "provider metadata", (bytes) => { providerMetadataBytes = bytes; }],
    [imported.receiptPath, imported.receiptSha256, "durable import receipt", (bytes) => { importReceiptBytes = bytes; }],
  ]) {
    const support = readEvidence(path);
    if (hash(support) !== expectedHash) throw new Error(`Reader execution authority ${label} bytes changed.`);
    const entries = (receipt.evidenceHashes ?? []).filter((entry) => entry?.path === path && entry?.sha256 === expectedHash);
    if (entries.length !== 1) throw new Error(`Reader execution authority ${label} is not included exactly once in the closure evidence manifest.`);
    assign(support);
  }
  const durable = imported.durableImport;
  if (!exactKeys(durable, ["authorization", "candidateCount", "currentPointerLinkCount", "promotedDispositionCount", "reattestedDispositionCount", "skippedDispositionCount", "candidateSetSha256", "eventCandidateCount", "eventCount", "terminalPromotedEventCount", "eventSetSha256", "predecessorCandidateCount", "predecessorEventCount", "predecessorEventSetSha256", "importerCodeShas"])) {
    throw new Error("Reader execution authority durable import fields differ from the exact schema.");
  }
  const counts = [durable?.candidateCount, durable?.currentPointerLinkCount, durable?.promotedDispositionCount, durable?.reattestedDispositionCount, durable?.skippedDispositionCount, durable?.eventCandidateCount, durable?.eventCount, durable?.terminalPromotedEventCount];
  if (
    durable?.authorization !== "PDC_V2_FROZEN_LKG_CUTOVER" ||
    !EXACT_SHA256.test(durable?.candidateSetSha256 ?? "") || !EXACT_SHA256.test(durable?.eventSetSha256 ?? "") || !EXACT_SHA256.test(durable?.predecessorEventSetSha256 ?? "") ||
    counts.some((value) => !Number.isSafeInteger(value) || value < 0) || durable.candidateCount <= 0 ||
    durable.currentPointerLinkCount !== durable.candidateCount || durable.eventCandidateCount !== durable.candidateCount ||
    durable.terminalPromotedEventCount !== durable.candidateCount || durable.eventCount < durable.candidateCount ||
    durable.promotedDispositionCount + durable.skippedDispositionCount !== durable.candidateCount ||
    durable.reattestedDispositionCount > durable.promotedDispositionCount ||
    !Number.isSafeInteger(durable.predecessorCandidateCount) || durable.predecessorCandidateCount !== durable.reattestedDispositionCount ||
    !Number.isSafeInteger(durable.predecessorEventCount) || durable.predecessorEventCount < durable.predecessorCandidateCount ||
    !Array.isArray(durable.importerCodeShas) || durable.importerCodeShas.length !== 1 || durable.importerCodeShas[0] !== imported.importerCodeSha
  ) throw new Error("Reader execution authority durable import has no exact pointer/event/disposition linkage.");
  if (reference.phase === "REHEARSAL") {
    if (!exactKeys(evidence.clone, ["parentProductionBranchIdentitySha256", "sourceSnapshotSha256", "controlPlaneReceiptSha256"])) {
      throw new Error("Reader rehearsal clone fields differ from the exact schema.");
    }
    if (store.authority !== "ISOLATED_PRODUCTION_CLONE" || !evidence.clone || evidence.clone.parentProductionBranchIdentitySha256 !== productionBranchIdentity || store.branchIdentitySha256 === evidence.clone.parentProductionBranchIdentitySha256) {
      throw new Error("REHEARSAL Reader authority is not an isolated production clone.");
    }
    for (const field of ["parentProductionBranchIdentitySha256", "sourceSnapshotSha256", "controlPlaneReceiptSha256"]) {
      if (!EXACT_SHA256.test(evidence.clone?.[field] ?? "")) throw new Error(`Reader rehearsal clone ${field} is not a sanitized identity.`);
    }
  } else if (store.authority !== "STANDING_PRODUCTION" || evidence.clone !== null) {
    throw new Error("PRODUCTION Reader authority is not the standing production store.");
  }
  validateArchivedSupport(evidence, providerMetadataBytes, importReceiptBytes);
  return { phase: reference.phase, importerCodeSha: imported.importerCodeSha };
}
