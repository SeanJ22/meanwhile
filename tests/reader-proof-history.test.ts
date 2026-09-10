import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { readerProofAuthority, readerProofHead } from "../scripts/lib/reader-proof-head.mjs";

const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);
const FROZEN = "fc67e8cd34c489590c403f7b4a0d6008fa755296";
const NOW = "2026-09-10T12:00:00.000Z";
const SHA256 = "9".repeat(64);
const PROJECT_ID = "tiny-hill-13996172";
const PRODUCTION_BRANCH_ID = "br-delicate-lab-ax02xuo5";
const REHEARSAL_BRANCH_ID = "br-reader-rehearsal-123";
const REHEARSAL_ENDPOINT_ID = "ep-reader-rehearsal-123";
const PRODUCTION_ENDPOINT_ID = "ep-reader-production-123";
const IMPORT_COUNT = 95;

const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return value;
  if (Array.isArray(value)) return value.map(canonicalValue);
  const object = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(object).sort().map((key) => [key, canonicalValue(object[key])]));
}
const canonicalJson = (value: unknown) => JSON.stringify(canonicalValue(value));
const identity = (kind: string, value: string) => sha256(`reader-postgres-${kind}-v1\0${value}`);

function evidence(entries: Record<string, unknown>) {
  return (path: string): Buffer => {
    assert.ok(path in entries, `unexpected evidence read: ${path}`);
    return Buffer.isBuffer(entries[path]) ? entries[path] as Buffer : Buffer.from(JSON.stringify(entries[path]));
  };
}

function importDispositionSet() {
  return Array.from({ length: IMPORT_COUNT }, (_, index) => {
    const suffix = String(index + 1).padStart(3, "0");
    return {
      contractId: `contract-${suffix}`,
      candidateId: `candidate-${suffix}`,
      disposition: "PROMOTED_ABSENT_POINTER",
      versionId: `candidate-${suffix}`,
      readerReadback: "PASS",
    };
  });
}

function providerMetadata(phase: "REHEARSAL" | "PRODUCTION", overrides: Record<string, unknown> = {}) {
  const rehearsal = phase === "REHEARSAL";
  const endpointId = rehearsal ? REHEARSAL_ENDPOINT_ID : PRODUCTION_ENDPOINT_ID;
  return {
    schemaVersion: 1,
    source: "NEON_API_BRANCH_READBACK",
    observedAt: NOW,
    projectId: PROJECT_ID,
    branchId: rehearsal ? REHEARSAL_BRANCH_ID : PRODUCTION_BRANCH_ID,
    branchName: rehearsal ? "pdc-v2-rehearsal-20260910" : "production",
    parentBranchId: rehearsal ? PRODUCTION_BRANCH_ID : null,
    defaultBranchId: PRODUCTION_BRANCH_ID,
    endpointId,
    endpointHost: `${endpointId}.neon.tech`,
    ...overrides,
  };
}

function rehearsalImportReceipt(metadataBytes: Buffer, overrides: Record<string, unknown> = {}) {
  const metadata = JSON.parse(metadataBytes.toString("utf8"));
  const dispositions = importDispositionSet();
  const pointerSha = sha256("exact-rehearsal-pointer-set");
  const unsigned = {
    schemaVersion: 1,
    result: "PDC_V2_REHEARSAL_IMPORT_PASS",
    mode: "apply",
    observedAt: NOW,
    code: { exactHeadSha: HEAD_A, detached: true, clean: true, controllerSha256: SHA256 },
    frozen: { exactHeadSha: FROZEN, detached: true, clean: true },
    neonBranch: {
      source: metadata.source,
      metadataObservedAt: metadata.observedAt,
      metadataSha256: sha256(metadataBytes),
      projectId: metadata.projectId,
      branchId: metadata.branchId,
      branchName: metadata.branchName,
      parentBranchId: metadata.parentBranchId,
      defaultBranchId: metadata.defaultBranchId,
      endpointId: metadata.endpointId,
      endpointHostSha256: sha256(metadata.endpointHost),
      productionWriteEndpointHostSha256: SHA256,
      productionReadEndpointHostSha256: SHA256,
      independentExpectation: {
        projectId: metadata.projectId,
        branchId: metadata.branchId,
        branchName: metadata.branchName,
        parentBranchId: metadata.parentBranchId,
        productionBranchId: PRODUCTION_BRANCH_ID,
      },
    },
    databaseIdentity: {
      currentUser: "owner",
      sessionUser: "owner",
      database: "wtp",
      currentSchema: "public",
      searchPath: '"$user", public',
      transactionReadOnly: false,
      defaultTransactionReadOnly: false,
      inRecovery: false,
      canCreateDatabaseObject: true,
      canUsePublicSchema: true,
      canCreateInPublicSchema: true,
      ownsRequiredCivicTables: true,
      requiredCivicTablesPresent: true,
      requiredCivicTableWrites: true,
    },
    authority: {
      databaseRoleDeclaration: "local",
      sanctionedWrite: false,
      runtimeCapability: "TRUSTED_LKG_IMPORT",
      temporarySelfProcessAuthority: true,
      productionHandlePresentAtExecution: false,
    },
    plan: {
      contractVersion: 1,
      frozenBaseSha: FROZEN,
      importerCodeSha: HEAD_A,
      candidateCount: IMPORT_COUNT,
      meetingPartitionsWithLkg: 83,
      meetingPartitionsWithoutLkg: 41,
      meetingRows: 619,
      agendaDocumentRows: 196,
      manualContracts: 12,
      planSha256: SHA256,
    },
    import: {
      contractVersion: 1,
      frozenBaseSha: FROZEN,
      importerCodeSha: HEAD_A,
      importedAt: NOW,
      promoted: IMPORT_COUNT,
      reattestedExisting: 0,
      skippedExisting: 0,
      zeroMeetingPartitionsRefused: 41,
      dispositionCount: IMPORT_COUNT,
      dispositionCounts: { PROMOTED_ABSENT_POINTER: IMPORT_COUNT },
      dispositionSet: dispositions,
      dispositionSetSha256: sha256(canonicalJson(dispositions)),
      legacyMeetingsAggregateRetirement: {
        disposition: "RETIRED",
        legacyVersionId: "legacy-meetings",
        retiredAt: NOW,
        legacyMeetingFactSha256: SHA256,
        replacementPointerSha256: SHA256,
      },
      resultSha256: sha256("rehearsal-result"),
    },
    pointers: {
      before: { count: 1, sha256: SHA256, rowCounts: { candidates: "1", events: "4", promotions: "1" } },
      after: { count: IMPORT_COUNT, sha256: pointerSha, rowCounts: { candidates: String(IMPORT_COUNT), events: String(IMPORT_COUNT * 5), promotions: String(IMPORT_COUNT) } },
      changedKeyMembership: Array.from({ length: IMPORT_COUNT }, (_, index) => `CURATED_READER_RECORD:US:fixture:${String(index + 1).padStart(3, "0")}`),
      currentPointerSha256: pointerSha,
    },
    productionMutations: 0,
    gitMutations: 0,
    deploymentMutations: 0,
    ...overrides,
  };
  return Buffer.from(canonicalJson({ ...unsigned, receiptSha256: sha256(canonicalJson(unsigned)) }));
}

function preservedPullRequest(number: 302 | 303) {
  return {
    number,
    state: "OPEN",
    isDraft: number === 302,
    baseRefName: "main",
    baseRefOid: (number === 302 ? "1" : "3").repeat(40),
    headRefName: `preserved-pr-${number}`,
    headRefOid: (number === 302 ? "2" : "4").repeat(40),
    uniqueCommitOids: [(number === 302 ? "2" : "4").repeat(40)],
    headAncestorOfA: false,
    uniqueCommitsInAAncestry: 0,
    patchEquivalentCommitsInA: 0,
  };
}

function productionImportReceipt(overrides: Record<string, unknown> = {}) {
  const dispositions = importDispositionSet();
  return Buffer.from(JSON.stringify({
    schemaVersion: 1,
    result: "PDC_AUTHORITY_TRANSFER_COMPLETE_B_ADMISSION_READY",
    apply: true,
    observedAt: NOW,
    importSha: HEAD_A,
    frozenBaseSha: FROZEN,
    migrationBlobSha1: "c".repeat(40),
    cutoverContractSha256: SHA256,
    narrowRoleProofSha256: SHA256,
    githubProofSha256: SHA256,
    lineage: {
      frozenImportDataBaseSha: FROZEN,
      exactQuiescedMainSha: "d".repeat(40),
      reviewedPostFrozenMainCommitOids: [],
      importCommitASha: HEAD_A,
      importCommitALinearAfterExactMain: true,
      preservedConcurrentPullRequests: [preservedPullRequest(302), preservedPullRequest(303)],
    },
    prewriteAdmission: { protocol: 1, nonceSha256: SHA256, parentPid: 42, readyRequests: 1, liveRecensusAtReady: true, receiptTtlMs: 30_000 },
    preImportAuthority: {
      initialCensus: "PASS",
      liveRecensusAtReady: "PASS",
      exact0026PreflightWithProspectiveSuccessors: "PASS",
      registeredContractKeys: IMPORT_COUNT,
      canonicalPromotionCount: IMPORT_COUNT,
      registeredCurrentPromotionCount: IMPORT_COUNT,
      obsoleteAggregatePointers: 0,
      durableRetirementReceipt: null,
      prospectiveReattestationCount: 0,
    },
    github: { legacyWorkflowDefinitionsDisabled: 8, nonterminalLegacyRuns: 0, bypassActors: 0, enabledWriteDeployKeys: 0, legacyRuntimeSecrets: 0 },
    host: { obsoleteScheduledTasks: 0, startupLaunchers: 0, oldProcessTreeMembers: 0 },
    import: {
      promoted: IMPORT_COUNT,
      reattestedExisting: 0,
      skippedExisting: 0,
      dispositions: IMPORT_COUNT,
      dispositionSet: dispositions,
      dispositionSetSha256: sha256(canonicalJson(dispositions)),
      resultSha256: sha256("production-result"),
      zeroMeetingPartitionsRefused: 41,
      retirementDisposition: "RETIRED",
      durableRetirementReceiptExact: true,
      legacyMeetingFactSha256: SHA256,
      replacementPointerSha256: SHA256,
    },
    postImport: {
      exact0026Preflight: "PASS",
      schema: "pre-0026",
      promotionCount: IMPORT_COUNT,
      expectedPromotionCount: IMPORT_COUNT,
      registeredContractCount: IMPORT_COUNT,
      obsoleteAggregatePointers: 0,
      unregisteredPromotions: 0,
    },
    commitBAdmissionReady: true,
    ...overrides,
  }));
}

function authorityArtifact(phase: "REHEARSAL" | "PRODUCTION") {
  const slug = phase.toLowerCase();
  const metadataPath = `docs/evidence/reader-last-mile-${slug}-provider-metadata.json`;
  const receiptPath = `docs/evidence/reader-last-mile-${slug}-import-receipt.json`;
  const metadata = Buffer.from(JSON.stringify(providerMetadata(phase)));
  const importReceipt = phase === "REHEARSAL" ? rehearsalImportReceipt(metadata) : productionImportReceipt();
  const parsedReceipt = JSON.parse(importReceipt.toString("utf8"));
  const dispositionSet = parsedReceipt.import.dispositionSet;
  const branchId = phase === "REHEARSAL" ? REHEARSAL_BRANCH_ID : PRODUCTION_BRANCH_ID;
  const endpointId = phase === "REHEARSAL" ? REHEARSAL_ENDPOINT_ID : PRODUCTION_ENDPOINT_ID;
  const exactHead = phase === "REHEARSAL" ? HEAD_A : HEAD_B;
  return {
    support: { [metadataPath]: metadata, [receiptPath]: importReceipt },
    artifact: {
      formatVersion: 1,
      phase,
      exactHead,
      store: {
        kind: "NEON_POSTGRES",
        authority: phase === "REHEARSAL" ? "ISOLATED_PRODUCTION_CLONE" : "STANDING_PRODUCTION",
        projectIdentitySha256: identity("project", PROJECT_ID),
        branchIdentitySha256: identity("branch", branchId),
        endpointIdentitySha256: identity("endpoint", `${endpointId}.neon.tech`),
        databaseIdentitySha256: identity("database", "wtp"),
        schemaIdentitySha256: identity("schema", "public"),
        providerMetadataPath: metadataPath,
        providerMetadataSha256: sha256(metadata),
      },
      readOnly: {
        roleIdentitySha256: identity("role", "readonly_pdc"), roleWritePrivilegesRefused: true, attemptedWriteRefused: true,
        roleSuperuser: false, roleCreateRole: false, roleCreateDatabase: false, roleReplication: false, roleBypassRls: false,
        databaseCreate: false, schemaCreate: false, relationOwnershipCount: 0, columnWritePrivilegeCount: 0,
        sequenceWritePrivilegeCount: 0, writeCapableMemberRoleCount: 0, executableSecurityDefinerFunctionCount: 0,
        relations: [
          { relation: "public.civic_data_candidate_events", select: true, insert: false, update: false, delete: false, truncate: false, references: false, trigger: false },
          { relation: "public.civic_data_candidates", select: true, insert: false, update: false, delete: false, truncate: false, references: false, trigger: false },
          { relation: "public.civic_data_promotions", select: true, insert: false, update: false, delete: false, truncate: false, references: false, trigger: false },
        ],
      },
      import: {
        importerCodeSha: HEAD_A,
        receiptPath,
        receiptSha256: sha256(importReceipt),
        resultSha256: parsedReceipt.import.resultSha256,
        dispositionSetSha256: sha256(canonicalJson(dispositionSet)),
        canonicalPointerSetSha256: phase === "REHEARSAL" ? parsedReceipt.pointers.currentPointerSha256 : sha256("exact-production-pointer-set"),
        canonicalPointerCount: IMPORT_COUNT,
        durableImport: {
          authorization: "PDC_V2_FROZEN_LKG_CUTOVER",
          candidateCount: IMPORT_COUNT,
          currentPointerLinkCount: IMPORT_COUNT,
          promotedDispositionCount: IMPORT_COUNT,
          reattestedDispositionCount: 0,
          skippedDispositionCount: 0,
          candidateSetSha256: sha256("candidate-set"),
          eventCandidateCount: IMPORT_COUNT,
          eventCount: IMPORT_COUNT * 5,
          terminalPromotedEventCount: IMPORT_COUNT,
          eventSetSha256: sha256("event-set"),
          predecessorCandidateCount: 0,
          predecessorEventCount: 0,
          predecessorEventSetSha256: sha256("predecessor-event-set"),
          importerCodeShas: [HEAD_A],
        },
      },
      clone: phase === "REHEARSAL" ? {
        parentProductionBranchIdentitySha256: identity("branch", PRODUCTION_BRANCH_ID),
        sourceSnapshotSha256: sha256(importReceipt),
        controlPlaneReceiptSha256: sha256(metadata),
      } : null,
    },
  };
}

function authorityReceiptFromBuilt(phase: "REHEARSAL" | "PRODUCTION", built: ReturnType<typeof authorityArtifact>) {
  const artifact = Buffer.from(JSON.stringify(built.artifact));
  const evidenceSha256 = createHash("sha256").update(artifact).digest("hex");
  const evidencePath = `docs/evidence/reader-last-mile-${phase.toLowerCase()}-authority.json`;
  const supportHashes = Object.entries(built.support).map(([path, bytes]) => ({ path, sha256: createHash("sha256").update(bytes).digest("hex") }));
  return {
    artifact,
    support: built.support,
    receipt: {
      formatVersion: 1,
      censusPath: "fresh-census.json",
      censusSha256: "1".repeat(64),
      holdingsDigest: "2".repeat(64),
      registrySha256: "3".repeat(64),
      sourceHashes: [],
      executionAuthority: { phase, evidencePath, evidenceSha256 },
      evidenceHashes: [{ path: evidencePath, sha256: evidenceSha256 }, ...supportHashes],
    },
  };
}

function authorityReceipt(phase: "REHEARSAL" | "PRODUCTION") {
  return authorityReceiptFromBuilt(phase, authorityArtifact(phase));
}

function replaceSupport(
  built: ReturnType<typeof authorityArtifact>,
  phase: "REHEARSAL" | "PRODUCTION",
  kind: "provider" | "import",
  bytes: Buffer,
) {
  const path = `docs/evidence/reader-last-mile-${phase.toLowerCase()}-${kind === "provider" ? "provider-metadata" : "import-receipt"}.json`;
  built.support[path] = Buffer.from(bytes);
  if (kind === "provider") {
    built.artifact.store.providerMetadataSha256 = sha256(bytes);
    if (phase === "REHEARSAL" && built.artifact.clone) built.artifact.clone.controlPlaneReceiptSha256 = sha256(bytes);
  } else {
    built.artifact.import.receiptSha256 = sha256(bytes);
    if (phase === "REHEARSAL" && built.artifact.clone) built.artifact.clone.sourceSnapshotSha256 = sha256(bytes);
  }
  return built;
}

test("an inherited Reader receipt keeps the invalidation report as its proof-head authority but legacy authority is exact-byte bounded", () => {
  const receipt = {
    censusPath: "fresh-census.json",
    inheritance: { reportPath: "invalidation.json" },
  };
  const read = evidence({
    "invalidation.json": { currentReaderHead: HEAD_A },
    "fresh-census.json": { rows: [{ id: "must-not-be-read", eligibleRecordIds: ["record"], provedHead: HEAD_B }] },
  });

  assert.equal(readerProofHead(receipt, read), HEAD_A);
  assert.throws(() => readerProofAuthority(receipt, read, HEAD_A), /fields differ from the exact schema/);
  const legacyPath = "docs/evidence/reader-last-mile-final-closure-receipt.json";
  const legacyBytes = readFileSync(legacyPath);
  const legacyReceipt = JSON.parse(legacyBytes.toString("utf8"));
  assert.deepEqual(readerProofAuthority(legacyReceipt, read, HEAD_A, { receiptPath: legacyPath, receiptBytes: legacyBytes }), { phase: "LEGACY_INHERITED", importerCodeSha: null });
});

test("a fresh Reader receipt derives one exact head from every applicable census row", () => {
  const receipt = { censusPath: "fresh-census.json" };
  const read = evidence({
    "fresh-census.json": {
      rows: [
        { id: "projected", applicableEligibleRecordIds: ["record:a"], eligibleRecordIds: ["record:a"], provedHead: HEAD_A },
        { id: "eligible-fallback", eligibleRecordIds: ["record:b"], provedHead: HEAD_A },
        { id: "not-applicable", applicableEligibleRecordIds: [], eligibleRecordIds: ["record:c"], provedHead: null },
      ],
    },
  });

  assert.equal(readerProofHead(receipt, read), HEAD_A);
});

test("a fresh Reader receipt rejects an applicable row with no exact proof head", () => {
  const receipt = { censusPath: "fresh-census.json" };
  const read = evidence({
    "fresh-census.json": {
      rows: [{ id: "missing-head", applicableEligibleRecordIds: ["record:a"], provedHead: null }],
    },
  });

  assert.throws(() => readerProofHead(receipt, read), /missing-head.*exact executed head/);
});

test("a fresh Reader receipt rejects applicable rows proved at mixed heads", () => {
  const receipt = { censusPath: "fresh-census.json" };
  const read = evidence({
    "fresh-census.json": {
      rows: [
        { id: "first", applicableEligibleRecordIds: ["record:a"], provedHead: HEAD_A },
        { id: "second", applicableEligibleRecordIds: ["record:b"], provedHead: HEAD_B },
      ],
    },
  });

  assert.throws(() => readerProofHead(receipt, read), /multiple executed heads/);
});

test("fresh Reader history requires a hash-bound execution authority at the exact proved head", () => {
  const { artifact, receipt } = authorityReceipt("REHEARSAL");
  const prepared = authorityReceipt("REHEARSAL");
  const read = evidence({
    ...prepared.support,
    [receipt.executionAuthority.evidencePath]: artifact,
  });
  assert.deepEqual(readerProofAuthority(receipt, read, HEAD_A), { phase: "REHEARSAL", importerCodeSha: HEAD_A });
  const { executionAuthority: _omittedAuthority, ...withoutAuthority } = receipt;
  assert.throws(() => readerProofAuthority(withoutAuthority, read, HEAD_A), /Fresh Reader closure requires exact execution-authority/);
  assert.throws(() => readerProofAuthority(receipt, read, HEAD_B), /exact proved code head/);
  assert.throws(() => readerProofAuthority({ ...receipt, executionAuthority: { ...receipt.executionAuthority, evidenceSha256: "0".repeat(64) } }, read, HEAD_A), /evidence bytes changed/);
  assert.throws(() => readerProofAuthority({ ...receipt, plantedSecret: "postgresql://owner:password@db.example/civic" }, read, HEAD_A), /fields differ from the exact schema|credential-bearing/);
  assert.throws(() => readerProofAuthority({ ...receipt, executionAuthority: { ...receipt.executionAuthority, extra: true } }, read, HEAD_A), /reference fields differ/);
});

test("fresh Reader history re-parses exact archived provider and controller support instead of trusting matching hashes", () => {
  const fakeProvider = replaceSupport(
    authorityArtifact("REHEARSAL"),
    "REHEARSAL",
    "provider",
    Buffer.from('{"sanitized":"provider"}'),
  );
  const fakeProviderClosure = authorityReceiptFromBuilt("REHEARSAL", fakeProvider);
  assert.throws(
    () => readerProofAuthority(
      fakeProviderClosure.receipt,
      evidence({ ...fakeProviderClosure.support, [fakeProviderClosure.receipt.executionAuthority.evidencePath]: fakeProviderClosure.artifact }),
      HEAD_A,
    ),
    /provider metadata shape is not exact/,
  );

  const fakeImport = replaceSupport(
    authorityArtifact("REHEARSAL"),
    "REHEARSAL",
    "import",
    Buffer.from('{"sanitized":"import"}'),
  );
  const fakeImportClosure = authorityReceiptFromBuilt("REHEARSAL", fakeImport);
  assert.throws(
    () => readerProofAuthority(
      fakeImportClosure.receipt,
      evidence({ ...fakeImportClosure.support, [fakeImportClosure.receipt.executionAuthority.evidencePath]: fakeImportClosure.artifact }),
      HEAD_A,
    ),
    /rehearsal import receipt shape differs/,
  );
});

test("archived support rejects recursive schema additions and secret-bearing keys regardless of value type", () => {
  const extraProviderBuilt = authorityArtifact("REHEARSAL");
  const providerPath = "docs/evidence/reader-last-mile-rehearsal-provider-metadata.json";
  const provider = JSON.parse(extraProviderBuilt.support[providerPath].toString("utf8"));
  const extraProvider = replaceSupport(extraProviderBuilt, "REHEARSAL", "provider", Buffer.from(JSON.stringify({ ...provider, unexplained: 0 })));
  const extraClosure = authorityReceiptFromBuilt("REHEARSAL", extraProvider);
  assert.throws(
    () => readerProofAuthority(extraClosure.receipt, evidence({ ...extraClosure.support, [extraClosure.receipt.executionAuthority.evidencePath]: extraClosure.artifact }), HEAD_A),
    /provider metadata shape is not exact/,
  );

  const numericSecretBuilt = authorityArtifact("REHEARSAL");
  const numericSecretProvider = replaceSupport(numericSecretBuilt, "REHEARSAL", "provider", Buffer.from(JSON.stringify({ ...provider, apiToken: 7 })));
  const numericSecretClosure = authorityReceiptFromBuilt("REHEARSAL", numericSecretProvider);
  assert.throws(
    () => readerProofAuthority(numericSecretClosure.receipt, evidence({ ...numericSecretClosure.support, [numericSecretClosure.receipt.executionAuthority.evidencePath]: numericSecretClosure.artifact }), HEAD_A),
    /apiToken is a forbidden secret-bearing field/,
  );

  const nestedSecretBuilt = authorityArtifact("REHEARSAL");
  const importPath = "docs/evidence/reader-last-mile-rehearsal-import-receipt.json";
  const imported = JSON.parse(nestedSecretBuilt.support[importPath].toString("utf8"));
  imported.neonBranch = { ...imported.neonBranch, credential: { planted: false } };
  delete imported.receiptSha256;
  imported.receiptSha256 = sha256(canonicalJson(imported));
  const nestedSecret = replaceSupport(nestedSecretBuilt, "REHEARSAL", "import", Buffer.from(canonicalJson(imported)));
  const nestedSecretClosure = authorityReceiptFromBuilt("REHEARSAL", nestedSecret);
  assert.throws(
    () => readerProofAuthority(nestedSecretClosure.receipt, evidence({ ...nestedSecretClosure.support, [nestedSecretClosure.receipt.executionAuthority.evidencePath]: nestedSecretClosure.artifact }), HEAD_A),
    /credential is a forbidden secret-bearing field/,
  );
});

test("archived controller support binds exact result and disposition membership digests", () => {
  const resultMismatchBuilt = authorityArtifact("REHEARSAL");
  resultMismatchBuilt.artifact.import.resultSha256 = sha256("forged-result");
  const resultMismatch = authorityReceiptFromBuilt("REHEARSAL", resultMismatchBuilt);
  assert.throws(
    () => readerProofAuthority(resultMismatch.receipt, evidence({ ...resultMismatch.support, [resultMismatch.receipt.executionAuthority.evidencePath]: resultMismatch.artifact }), HEAD_A),
    /result digest differs/,
  );

  const dispositionBuilt = authorityArtifact("REHEARSAL");
  const importPath = "docs/evidence/reader-last-mile-rehearsal-import-receipt.json";
  const imported = JSON.parse(dispositionBuilt.support[importPath].toString("utf8"));
  delete imported.import.dispositionSet[0].readerReadback;
  imported.import.dispositionSetSha256 = sha256(canonicalJson(imported.import.dispositionSet));
  delete imported.receiptSha256;
  imported.receiptSha256 = sha256(canonicalJson(imported));
  dispositionBuilt.artifact.import.dispositionSetSha256 = imported.import.dispositionSetSha256;
  const dispositionSupport = replaceSupport(dispositionBuilt, "REHEARSAL", "import", Buffer.from(canonicalJson(imported)));
  const dispositionClosure = authorityReceiptFromBuilt("REHEARSAL", dispositionSupport);
  assert.throws(
    () => readerProofAuthority(dispositionClosure.receipt, evidence({ ...dispositionClosure.support, [dispositionClosure.receipt.executionAuthority.evidencePath]: dispositionClosure.artifact }), HEAD_A),
    /disposition membership shape is not exact/,
  );
});

test("production Reader history accepts only controller import commit A bound beneath distinct authority commit B", () => {
  const production = authorityReceipt("PRODUCTION");
  const read = evidence({ ...production.support, [production.receipt.executionAuthority.evidencePath]: production.artifact });
  assert.deepEqual(
    readerProofAuthority(production.receipt, read, HEAD_B, { requiredPhase: "PRODUCTION" }),
    { phase: "PRODUCTION", importerCodeSha: HEAD_A },
  );

  const sameCommitBuilt = authorityArtifact("PRODUCTION");
  sameCommitBuilt.artifact.exactHead = HEAD_A;
  const sameCommit = authorityReceiptFromBuilt("PRODUCTION", sameCommitBuilt);
  assert.throws(
    () => readerProofAuthority(sameCommit.receipt, evidence({ ...sameCommit.support, [sameCommit.receipt.executionAuthority.evidencePath]: sameCommit.artifact }), HEAD_A, { requiredPhase: "PRODUCTION" }),
    /generated before the importer was deleted|distinct importer A \/ authority B/,
  );
});

test("terminal Reader history cannot accept a valid child rehearsal or a relabeled clone", () => {
  const rehearsal = authorityReceipt("REHEARSAL");
  const rehearsalRead = evidence({ ...rehearsal.support, [rehearsal.receipt.executionAuthority.evidencePath]: rehearsal.artifact });
  assert.throws(() => readerProofAuthority(rehearsal.receipt, rehearsalRead, HEAD_A, { requiredPhase: "PRODUCTION" }), /requires PRODUCTION/);

  const rehearsalBuilt = authorityArtifact("REHEARSAL");
  const productionBuilt = authorityArtifact("PRODUCTION");
  const relabeledPath = "docs/evidence/reader-last-mile-production-authority.json";
  const relabeledObject = {
    ...rehearsalBuilt.artifact,
    phase: "PRODUCTION",
    exactHead: HEAD_B,
    store: {
      ...rehearsalBuilt.artifact.store,
      providerMetadataPath: productionBuilt.artifact.store.providerMetadataPath,
      providerMetadataSha256: productionBuilt.artifact.store.providerMetadataSha256,
    },
    import: {
      ...rehearsalBuilt.artifact.import,
      receiptPath: productionBuilt.artifact.import.receiptPath,
      receiptSha256: productionBuilt.artifact.import.receiptSha256,
      resultSha256: productionBuilt.artifact.import.resultSha256,
      dispositionSetSha256: productionBuilt.artifact.import.dispositionSetSha256,
    },
  };
  const relabeledArtifact = Buffer.from(JSON.stringify(relabeledObject));
  const relabeledSha = createHash("sha256").update(relabeledArtifact).digest("hex");
  const relabeledReceipt = {
    executionAuthority: { phase: "PRODUCTION", evidencePath: relabeledPath, evidenceSha256: relabeledSha },
    evidenceHashes: [{ path: relabeledPath, sha256: relabeledSha }],
  };
  const exactRelabeledReceipt = {
    formatVersion: 1, censusPath: "fresh-census.json", censusSha256: "1".repeat(64), holdingsDigest: "2".repeat(64), registrySha256: "3".repeat(64), sourceHashes: [],
    ...relabeledReceipt,
    evidenceHashes: [...relabeledReceipt.evidenceHashes, ...Object.entries(productionBuilt.support).map(([path, bytes]) => ({ path, sha256: createHash("sha256").update(bytes).digest("hex") }))],
  };
  assert.throws(() => readerProofAuthority(exactRelabeledReceipt, evidence({ ...productionBuilt.support, [relabeledPath]: relabeledArtifact }), HEAD_B, { requiredPhase: "PRODUCTION" }), /pinned production branch|provider branch identity differs|standing production store/);
});
