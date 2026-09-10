import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { candidateChangeSet, canonicalCivicDataJson, civicRecordsFor } from "../lib/civic-data/changes.ts";
import { buildPdcV2TrustedLkgReattestationCandidate } from "../lib/civic-data/trusted-lkg-import-plan.ts";
import {
  PDC_V2_FROZEN_BASE_SHA,
  TRUSTED_LKG_IMPORT_AUTHORIZATION,
  TRUSTED_LKG_IMPORT_PURPOSE,
  trustedLkgCandidateEnvelopeSha256,
  trustedLkgCandidateId,
  trustedLkgFixtureSetSha256,
  trustedLkgImportUrl,
  trustedLkgValidatorIds,
} from "../lib/civic-data/trusted-lkg-import.ts";
import { sourceProjectionEvidence, VALIDATION_CHECKS, type CandidateVersionRecord, type PromotedProjection, type RoutineCandidate, type TrustedLkgImportEvidence } from "../lib/civic-data/types.ts";
import {
  buildReaderExecutionAuthorityEvidence,
  canonicalReaderAuthorityJson,
  PDC_NEON_PROJECT_ID,
  PDC_PRODUCTION_BRANCH_ID,
  readerExecutionAuthorityLiveProblems,
  type BuildReaderAuthorityOptions,
  type ReaderAuthoritySql,
} from "../lib/holdings/reader-execution-authority.ts";
import {
  createImmutableEvidenceFile,
  parseReaderAuthorityGeneratorArguments,
  proveReaderAuthorityRepositoryBeforePublish,
  readerAuthorityAmbientCapabilityIssue,
  readerAuthorityEvidencePaths,
  readerAuthorityImporterHistoryIssue,
  readerAuthorityNodeAdmissionIssue,
  readerAuthoritySqlFromNeon,
  redactReaderAuthorityError,
  READER_AUTHORITY_DATABASE_ENV,
} from "../scripts/reader-execution-authority-evidence.mts";

const HEAD = "a".repeat(40);
const PRODUCTION_PROOF_HEAD = "e".repeat(40);
const FROZEN = "fc67e8cd34c489590c403f7b4a0d6008fa755296";
const SHA256 = "b".repeat(64);
const NOW = "2026-09-10T12:00:00.000Z";
const ENDPOINT_ID = "ep-reader-rehearsal-123";
const ENDPOINT_HOST = `${ENDPOINT_ID}.neon.tech`;
const CONNECTION = `postgresql://readonly_pdc:test-only-password@${ENDPOINT_HOST}/wtp`;
const PRODUCTION_ENDPOINT_ID = "ep-reader-production-123";
const PRODUCTION_ENDPOINT_HOST = `${PRODUCTION_ENDPOINT_ID}.neon.tech`;
const PRODUCTION_CONNECTION =
  `postgresql://readonly_pdc:test-only-password@${PRODUCTION_ENDPOINT_HOST}/wtp`;

type Row = Record<string, unknown>;
type FixtureDisposition = {
  contractId: string;
  candidateId: string;
  disposition: "PROMOTED_ABSENT_POINTER" | "REATTESTED_EXISTING_AUTHORITY" | "SKIPPED_EXISTING_PROVEN_AUTHORITY";
  versionId: string;
  readerReadback: "PASS";
};

const sha256 = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

function providerMetadata(overrides: Record<string, unknown> = {}): Buffer {
  return Buffer.from(JSON.stringify({
    schemaVersion: 1,
    source: "NEON_API_BRANCH_READBACK",
    observedAt: NOW,
    projectId: PDC_NEON_PROJECT_ID,
    branchId: "br-reader-rehearsal-123",
    branchName: "pdc-v2-rehearsal-20260910",
    parentBranchId: PDC_PRODUCTION_BRANCH_ID,
    defaultBranchId: PDC_PRODUCTION_BRANCH_ID,
    endpointId: ENDPOINT_ID,
    endpointHost: ENDPOINT_HOST,
    ...overrides,
  }));
}

function productionProviderMetadata(overrides: Record<string, unknown> = {}): Buffer {
  return Buffer.from(JSON.stringify({
    schemaVersion: 1,
    source: "NEON_API_BRANCH_READBACK",
    observedAt: NOW,
    projectId: PDC_NEON_PROJECT_ID,
    branchId: PDC_PRODUCTION_BRANCH_ID,
    branchName: "production",
    parentBranchId: null,
    defaultBranchId: PDC_PRODUCTION_BRANCH_ID,
    endpointId: PRODUCTION_ENDPOINT_ID,
    endpointHost: PRODUCTION_ENDPOINT_HOST,
    ...overrides,
  }));
}

function validationReceiptFor(candidate: RoutineCandidate, sourceCode: string) {
  return {
    contractVersion: 2 as const,
    decision: "GOOD" as const,
    candidateId: candidate.id,
    sourceId: candidate.sourceId,
    recordClass: candidate.recordClass,
    scope: candidate.scope,
    validatedAt: NOW,
    checks: VALIDATION_CHECKS.map((check) => ({
      check,
      verdict: "PASS" as const,
      code: check === "SOURCE_AUTHENTICITY" ? sourceCode : `FIXTURE_${check}_PASS`,
      detail: `Fixture ${check} passed.`,
    })),
    excludedFacts: [],
  };
}

function pointerRows(count = 95): Row[] {
  return Array.from({ length: count }, (_, index) => {
    const suffix = String(index + 1).padStart(3, "0");
    const candidate = fixtureCandidate(suffix);
    const candidateId = candidate.id;
    const validationReceipt = validationReceiptFor(candidate, "TRUSTED_LKG_IMPORT_PROVENANCE_VALID");
    return {
      key: `${candidate.recordClass}:${candidate.scope}`,
      source_id: candidate.sourceId,
      record_class: candidate.recordClass,
      scope: candidate.scope,
      current_version_id: candidateId,
      last_known_good_version_id: candidateId,
      promoted_at: NOW,
      payload: candidate.readModel,
      validation_receipt: validationReceipt,
    };
  });
}

function dispositionSet(pointers: readonly Row[]): FixtureDisposition[] {
  return pointers.map((pointer) => ({
    contractId: `contract-${String(pointer.scope).split(":").at(-1)!}`,
    candidateId: String(pointer.current_version_id),
    disposition: "PROMOTED_ABSENT_POINTER" as const,
    versionId: String(pointer.current_version_id),
    readerReadback: "PASS" as const,
  })).sort((left, right) => left.contractId.localeCompare(right.contractId));
}

function fixtureCandidate(suffix: string): RoutineCandidate {
  const contractId = `contract-${suffix}`;
  const sourceId = "curated-reader-primary-sources";
  const recordClass = "CURATED_READER_RECORD" as const;
  const scope = `US:reader-authority-fixture:${suffix}`;
  const parserVersion = "reader-authority-fixture/1";
  const payload = {
    kind: "comment-access",
    records: [{
      id: `comment-access:ocd-division/country:us/test:${suffix}`,
      bodyId: `ocd-division/country:us/test:${suffix}`,
      publicComment: `Exact fixture ${suffix}`,
    }],
  };
  const civicRecords = civicRecordsFor(recordClass, payload);
  const fixtureBytes = `exact-reader-authority-fixture-${suffix}`;
  const fixtures = [{
    path: `data/reader-authority/${suffix}.json`,
    sha256: sha256(fixtureBytes),
    bytes: Buffer.byteLength(fixtureBytes),
  }];
  const fixtureSetSha256 = trustedLkgFixtureSetSha256(fixtures);
  const projectionSha256 = sha256(canonicalCivicDataJson(payload));
  const partial: RoutineCandidate = {
    id: "pending",
    sourceId,
    recordClass,
    scope,
    retrieval: {
      succeeded: true,
      requestedUrl: trustedLkgImportUrl(contractId),
      finalUrl: null,
      httpStatus: null,
      retrievedAt: NOW,
      rawHash: fixtureSetSha256,
    },
    normalization: {
      succeeded: true,
      parserVersion,
      schemaVersion: "reader-authority-fixture:1",
      normalizedHash: projectionSha256,
      normalizedPayloadHash: projectionSha256,
      inputRecords: civicRecords.length,
      outputRecords: civicRecords.length,
      droppedRecords: 0,
      missingRequiredFields: [],
    },
    identities: [{
      subjectId: `fixture-${suffix}`,
      jurisdiction: "US",
      identifiers: { fixture_id: suffix },
      matchBasis: "OFFICIAL_ID",
      ambiguous: false,
    }],
    temporal: {
      version: `fixture-${suffix}`,
      expectedVersion: `fixture-${suffix}`,
      sourceThrough: "2026-09-08T00:00:00.000Z",
      staleAtRetrieval: true,
    },
    semantics: { factKind: "frozen Reader authority fixture", violations: [] },
    horizon: {
      kind: "OPEN_FACT_SET",
      query: "exact frozen Reader authority fixture",
      returnedRecords: civicRecords.length,
      declaredTotal: null,
      paginationComplete: false,
      claimsComplete: false,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    sourceProjectionEvidence: sourceProjectionEvidence(sourceId, recordClass, scope),
    dependentChecks: [{ consumer: `reader-authority-${suffix}`, passed: true, detail: "Exact fixture Reader projection passed." }],
    normalizedPayload: payload,
    readModel: payload,
    civicRecords,
  };
  const evidence: TrustedLkgImportEvidence = {
    contractVersion: 1,
    kind: "TRUSTED_LKG_IMPORT",
    authorization: TRUSTED_LKG_IMPORT_AUTHORIZATION,
    purpose: TRUSTED_LKG_IMPORT_PURPOSE,
    sourceAuthenticated: false,
    contractId,
    sourceId,
    recordClass,
    scope,
    parserVersion,
    sourceVersion: partial.temporal.version,
    sourceThrough: partial.temporal.sourceThrough,
    importedAt: NOW,
    frozenBaseSha: PDC_V2_FROZEN_BASE_SHA,
    importerCodeSha: HEAD,
    fixtureSetSha256,
    fixtures,
    normalizedPayloadSha256: projectionSha256,
    readModelSha256: projectionSha256,
    candidateEnvelopeSha256: trustedLkgCandidateEnvelopeSha256(partial),
    validatorIds: trustedLkgValidatorIds(partial),
  };
  const withEvidence: RoutineCandidate = {
    ...partial,
    id: trustedLkgCandidateId(evidence),
    bootstrapImport: evidence,
  };
  return { ...withEvidence, changeSet: candidateChangeSet(withEvidence, null) };
}

function normalizedPointers(pointers: readonly Row[]) {
  return pointers.map((pointer) => ({
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
}

function candidateRows(pointers: readonly Row[], overrides: Record<string, unknown> = {}): Row[] {
  return pointers.map((pointer) => {
    const suffix = String(pointer.scope).split(":").at(-1)!;
    const candidate = fixtureCandidate(suffix);
    const candidateId = candidate.id;
    return {
      pointer_key: pointer.key,
      current_version_id: candidateId,
      last_known_good_version_id: candidateId,
      candidate_id: candidateId,
      source_id: pointer.source_id,
      record_class: pointer.record_class,
      scope: pointer.scope,
      state: "PROMOTED",
      acquisition_succeeded: true,
      promoted_version_id: candidateId,
      candidate_lkg_version_id: candidateId,
      pointer_promoted_at: NOW,
      pointer_payload: pointer.payload,
      pointer_validation_receipt: pointer.validation_receipt,
      candidate,
      validation_receipt: pointer.validation_receipt,
      failure_code: null,
      failure_detail: null,
      predecessor_state: null,
      predecessor_acquisition_succeeded: null,
      predecessor_promoted_version_id: null,
      predecessor_lkg_version_id: null,
      predecessor_failure_code: null,
      predecessor_failure_detail: null,
      predecessor_candidate: null,
      predecessor_validation_receipt: null,
      ...overrides,
    };
  });
}

function eventRows(pointers: readonly Row[]): Row[] {
  return pointers.flatMap((pointer) => ["FETCHED", "NORMALIZED", "VALIDATED", "PROMOTED"]
    .map((state, index) => ({
      candidate_id: pointer.current_version_id,
      sequence: index + 1,
      state,
      at: NOW,
      detail: `${state} fixture receipt`,
    })).concat({
      candidate_id: pointer.current_version_id,
      sequence: 5,
      state: "PROMOTED",
      at: NOW,
      detail: "READER_PROJECTION_READBACK_V2 " + JSON.stringify({
        contractVersion: 2,
        kind: "READER_PROJECTION_READBACK",
        contractId: `contract-${String(pointer.scope).split(":").at(-1)!}`,
        sourceId: pointer.source_id,
        recordClass: pointer.record_class,
        scope: pointer.scope,
        projectionId: `reader-${String(pointer.scope)}`,
        versionId: pointer.current_version_id,
        pointerKey: pointer.key,
        observedAt: NOW,
        evidenceKind: "TYPED_READER_READ_MODEL",
        verifierId: `fixture#${String(pointer.scope)}`,
        verifierCodeSha: HEAD,
        status: "PASS",
        detail: "The typed Reader returned the exact promoted fixture version.",
      }),
    }));
}

function rehearsalReceipt(
  pointers: readonly Row[],
  overrides: Record<string, unknown> = {},
  metadataBytes: Buffer = providerMetadata(),
  exactDispositions = dispositionSet(pointers),
): Buffer {
  const pointerSha = sha256(canonicalReaderAuthorityJson(normalizedPointers(pointers)));
  const dispositionCounts = Object.fromEntries([
    "PROMOTED_ABSENT_POINTER",
    "REATTESTED_EXISTING_AUTHORITY",
    "SKIPPED_EXISTING_PROVEN_AUTHORITY",
  ].flatMap((disposition) => {
    const count = exactDispositions.filter((entry) => entry.disposition === disposition).length;
    return count > 0 ? [[disposition, count]] : [];
  }));
  const reattested = Number(dispositionCounts.REATTESTED_EXISTING_AUTHORITY ?? 0);
  const skipped = Number(dispositionCounts.SKIPPED_EXISTING_PROVEN_AUTHORITY ?? 0);
  const promoted = exactDispositions.length - skipped;
  const unsigned = {
    schemaVersion: 1,
    result: "PDC_V2_REHEARSAL_IMPORT_PASS",
    mode: "apply",
    observedAt: NOW,
    code: { exactHeadSha: HEAD, detached: true, clean: true, controllerSha256: SHA256 },
    frozen: { exactHeadSha: FROZEN, detached: true, clean: true },
    neonBranch: {
      source: "NEON_API_BRANCH_READBACK",
      metadataObservedAt: NOW,
      metadataSha256: sha256(metadataBytes),
      projectId: PDC_NEON_PROJECT_ID,
      branchId: "br-reader-rehearsal-123",
      branchName: "pdc-v2-rehearsal-20260910",
      parentBranchId: PDC_PRODUCTION_BRANCH_ID,
      defaultBranchId: PDC_PRODUCTION_BRANCH_ID,
      endpointId: ENDPOINT_ID,
      endpointHostSha256: sha256(ENDPOINT_HOST),
      productionWriteEndpointHostSha256: SHA256,
      productionReadEndpointHostSha256: SHA256,
      independentExpectation: {
        projectId: PDC_NEON_PROJECT_ID,
        branchId: "br-reader-rehearsal-123",
        branchName: "pdc-v2-rehearsal-20260910",
        parentBranchId: PDC_PRODUCTION_BRANCH_ID,
        productionBranchId: PDC_PRODUCTION_BRANCH_ID,
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
      importerCodeSha: HEAD,
      candidateCount: pointers.length,
      meetingPartitionsWithLkg: pointers.length - 12,
      meetingPartitionsWithoutLkg: 41,
      meetingRows: 619,
      agendaDocumentRows: 196,
      manualContracts: 12,
      planSha256: SHA256,
    },
    import: {
      contractVersion: 1,
      frozenBaseSha: FROZEN,
      importerCodeSha: HEAD,
      importedAt: NOW,
      promoted,
      reattestedExisting: reattested,
      skippedExisting: skipped,
      zeroMeetingPartitionsRefused: 41,
      dispositionCount: exactDispositions.length,
      dispositionCounts,
      dispositionSet: exactDispositions,
      dispositionSetSha256: sha256(canonicalReaderAuthorityJson(exactDispositions)),
      legacyMeetingsAggregateRetirement: {
        disposition: "RETIRED",
        legacyVersionId: "legacy-meetings",
        retiredAt: NOW,
        legacyMeetingFactSha256: SHA256,
        replacementPointerSha256: SHA256,
      },
      resultSha256: SHA256,
    },
    pointers: {
      before: { count: 1, sha256: SHA256, rowCounts: { candidates: "1", events: "4", promotions: "1" } },
      after: {
        count: pointers.length,
        sha256: pointerSha,
        rowCounts: {
          candidates: String(pointers.length),
          events: String(pointers.length * 5),
          promotions: String(pointers.length),
        },
      },
      changedKeyMembership: pointers.map((pointer) => pointer.key),
      currentPointerSha256: pointerSha,
    },
    productionMutations: 0,
    gitMutations: 0,
    deploymentMutations: 0,
    ...overrides,
  };
  return Buffer.from(canonicalReaderAuthorityJson({
    ...unsigned,
    receiptSha256: sha256(canonicalReaderAuthorityJson(unsigned)),
  }));
}

function productionReceipt(pointers: readonly Row[]): Buffer {
  const dispositions = dispositionSet(pointers);
  return Buffer.from(JSON.stringify({
    schemaVersion: 1,
    result: "PDC_AUTHORITY_TRANSFER_COMPLETE_B_ADMISSION_READY",
    apply: true,
    observedAt: NOW,
    importSha: HEAD,
    frozenBaseSha: FROZEN,
    migrationBlobSha1: "c".repeat(40),
    cutoverContractSha256: SHA256,
    narrowRoleProofSha256: SHA256,
    githubProofSha256: SHA256,
    lineage: {
      frozenImportDataBaseSha: FROZEN,
      exactQuiescedMainSha: "d".repeat(40),
      reviewedPostFrozenMainCommitOids: [],
      importCommitASha: HEAD,
      importCommitALinearAfterExactMain: true,
      preservedConcurrentPullRequests: [
        {
          number: 302,
          state: "OPEN",
          isDraft: true,
          baseRefName: "main",
          baseRefOid: "1".repeat(40),
          headRefName: "preserved-pr-302",
          headRefOid: "2".repeat(40),
          uniqueCommitOids: ["2".repeat(40)],
          headAncestorOfA: false,
          uniqueCommitsInAAncestry: 0,
          patchEquivalentCommitsInA: 0,
        },
        {
          number: 303,
          state: "OPEN",
          isDraft: false,
          baseRefName: "main",
          baseRefOid: "3".repeat(40),
          headRefName: "preserved-pr-303",
          headRefOid: "4".repeat(40),
          uniqueCommitOids: ["4".repeat(40)],
          headAncestorOfA: false,
          uniqueCommitsInAAncestry: 0,
          patchEquivalentCommitsInA: 0,
        },
      ],
    },
    prewriteAdmission: {
      protocol: 1,
      nonceSha256: SHA256,
      parentPid: 42,
      readyRequests: 1,
      liveRecensusAtReady: true,
      receiptTtlMs: 30_000,
    },
    preImportAuthority: {
      initialCensus: "PASS",
      liveRecensusAtReady: "PASS",
      exact0026PreflightWithProspectiveSuccessors: "PASS",
      registeredContractKeys: 100,
      canonicalPromotionCount: 1,
      registeredCurrentPromotionCount: 1,
      obsoleteAggregatePointers: 1,
      durableRetirementReceipt: null,
      prospectiveReattestationCount: 0,
    },
    github: {
      legacyWorkflowDefinitionsDisabled: 8,
      nonterminalLegacyRuns: 0,
      bypassActors: 0,
      enabledWriteDeployKeys: 0,
      legacyRuntimeSecrets: 0,
    },
    host: { obsoleteScheduledTasks: 0, startupLaunchers: 0, oldProcessTreeMembers: 0 },
    import: {
      promoted: pointers.length,
      reattestedExisting: 0,
      skippedExisting: 0,
      dispositions: pointers.length,
      dispositionSet: dispositions,
      dispositionSetSha256: sha256(canonicalReaderAuthorityJson(dispositions)),
      resultSha256: SHA256,
      zeroMeetingPartitionsRefused: 41,
      retirementDisposition: "RETIRED",
      durableRetirementReceiptExact: true,
      legacyMeetingFactSha256: SHA256,
      replacementPointerSha256: SHA256,
    },
    postImport: {
      exact0026Preflight: "PASS",
      schema: "pre-0026",
      promotionCount: pointers.length,
      expectedPromotionCount: pointers.length,
      registeredContractCount: pointers.length,
      obsoleteAggregatePointers: 0,
      unregisteredPromotions: 0,
    },
    commitBAdmissionReady: true,
  }));
}

interface FakeOptions {
  readonly pointers?: Row[];
  readonly candidates?: Row[];
  readonly events?: Row[];
  readonly identity?: Record<string, unknown>;
  readonly admitPrivilegeProbe?: boolean;
  readonly privilegeProbeErrorCode?: string;
  readonly admitWrite?: boolean;
  readonly writeErrorCode?: string;
}

function fakeTransport(options: FakeOptions = {}): ReaderAuthoritySql & {
  readonly queries: string[];
  readonly transactionBatches: string[][];
} {
  const pointers = options.pointers ?? pointerRows();
  const candidates = options.candidates ?? candidateRows(pointers);
  const events = options.events ?? eventRows(pointers);
  const queries: string[] = [];
  const transactionBatches: string[][] = [];
  return {
    queries,
    transactionBatches,
    query: async (statement) => {
      queries.push(statement);
      if (statement.startsWith("explain delete")) {
        if (options.admitPrivilegeProbe) return [];
        throw Object.assign(new Error("permission denied"), {
          code: options.privilegeProbeErrorCode ?? "42501",
        });
      }
      if (statement.includes("current_user::text")) {
        return [{
          current_user: "readonly_pdc",
          session_user: "readonly_pdc",
          database: "wtp",
          current_schema: "public",
          candidates_present: true,
          events_present: true,
          promotions_present: true,
          role_superuser: false,
          role_create_role: false,
          role_create_database: false,
          role_replication: false,
          role_bypass_rls: false,
          database_create: false,
          schema_create: false,
          relation_ownership_count: "0",
          column_write_privilege_count: "0",
          sequence_write_privilege_count: "0",
          write_capable_member_role_count: "0",
          executable_security_definer_function_count: "0",
          candidates_select: true,
          candidates_insert: false,
          candidates_update: false,
          candidates_delete: false,
          candidates_truncate: false,
          candidates_references: false,
          candidates_trigger: false,
          events_select: true,
          events_insert: false,
          events_update: false,
          events_delete: false,
          events_truncate: false,
          events_references: false,
          events_trigger: false,
          promotions_select: true,
          promotions_insert: false,
          promotions_update: false,
          promotions_delete: false,
          promotions_truncate: false,
          promotions_references: false,
          promotions_trigger: false,
          ...options.identity,
        }];
      }
      if (statement.includes("from public.civic_data_candidate_events")) return events;
      if (statement.includes("join public.civic_data_candidates")) return candidates;
      if (statement.includes("from public.civic_data_promotions")) return pointers;
      throw new Error(`Unexpected fake SQL: ${statement}`);
    },
    readOnlyTransaction: async (statements) => {
      transactionBatches.push([...statements]);
      if (!options.admitWrite) {
        throw Object.assign(new Error("permission denied"), {
          code: options.writeErrorCode ?? "42501",
        });
      }
      return statements.map(() => []);
    },
  };
}

function options(overrides: Partial<BuildReaderAuthorityOptions> = {}): BuildReaderAuthorityOptions {
  const pointers = pointerRows();
  const metadataBytes = providerMetadata();
  return {
    phase: "REHEARSAL",
    exactHead: HEAD,
    connection: CONNECTION,
    providerMetadataPath: "docs/evidence/reader-last-mile-rehearsal-provider-metadata.json",
    providerMetadataBytes: metadataBytes,
    importReceiptPath: "docs/evidence/reader-last-mile-rehearsal-import-receipt.json",
    importReceiptBytes: rehearsalReceipt(pointers, {}, metadataBytes),
    sql: fakeTransport({ pointers }),
    nowMs: Date.parse(NOW),
    ...overrides,
  };
}

test("the fake transport produces only sanitized, hash-bound rehearsal authority", async () => {
  const sql = fakeTransport();
  const evidence = await buildReaderExecutionAuthorityEvidence(options({ sql }));

  assert.equal(evidence.phase, "REHEARSAL");
  assert.equal(evidence.exactHead, HEAD);
  assert.equal(evidence.import.importerCodeSha, HEAD);
  assert.equal(evidence.import.canonicalPointerCount, 95);
  assert.equal(evidence.readOnly.attemptedWriteRefused, true);
  assert.equal(sql.queries.length, 5, "identity, privilege probe, pointers, durable candidates, and events are read");
  assert.match(sql.queries[0]!, /rolsuper[\s\S]*rolcreaterole[\s\S]*rolcreatedb[\s\S]*rolreplication[\s\S]*rolbypassrls/);
  assert.match(sql.queries[0]!, /pg_has_role\(current_user, member_role\.oid, 'MEMBER'\)/);
  assert.doesNotMatch(sql.queries[0]!, /pg_has_role\(current_user, member_role\.oid, 'USAGE'\)/);
  assert.match(sql.queries[0]!, /pg_attribute[\s\S]*has_column_privilege[\s\S]*'REFERENCES'/);
  assert.match(sql.queries[0]!, /has_sequence_privilege[\s\S]*executable_security_definer_function_count/);
  assert.match(sql.queries[0]!, /candidates_truncate[\s\S]*candidates_references[\s\S]*candidates_trigger/);
  assert.deepEqual(sql.transactionBatches, [["delete from public.civic_data_promotions where false"]]);
  const serialized = canonicalReaderAuthorityJson(evidence);
  assert.doesNotMatch(serialized, /postgres(?:ql)?:\/\//i);
  assert.equal(serialized.includes("test-only-password"), false);
  assert.equal(serialized.includes(ENDPOINT_HOST), false);
  assert.match(evidence.store.providerMetadataSha256, /^[0-9a-f]{64}$/);
  assert.match(evidence.import.receiptSha256, /^[0-9a-f]{64}$/);
  assert.equal(evidence.import.durableImport.candidateCount, 95);
  assert.equal(evidence.import.durableImport.currentPointerLinkCount, 95);
  assert.equal(evidence.import.durableImport.terminalPromotedEventCount, 95);
});

test("production authority binds the pinned standing branch and no clone claim", async () => {
  const pointers = pointerRows();
  const evidence = await buildReaderExecutionAuthorityEvidence(options({
    phase: "PRODUCTION",
    exactHead: PRODUCTION_PROOF_HEAD,
    connection: PRODUCTION_CONNECTION,
    providerMetadataPath: "docs/evidence/reader-last-mile-production-provider-metadata.json",
    providerMetadataBytes: productionProviderMetadata(),
    importReceiptPath: "docs/evidence/reader-last-mile-production-import-receipt.json",
    importReceiptBytes: productionReceipt(pointers),
    sql: fakeTransport({ pointers }),
  }));

  assert.equal(evidence.phase, "PRODUCTION");
  assert.equal(evidence.exactHead, PRODUCTION_PROOF_HEAD);
  assert.equal(evidence.import.importerCodeSha, HEAD, "commit A remains immutable import lineage beneath proof commit B");
  assert.notEqual(evidence.exactHead, evidence.import.importerCodeSha, "production proof cannot be generated while temporary importer A is still HEAD");
  assert.equal(evidence.store.authority, "STANDING_PRODUCTION");
  assert.equal(evidence.clone, null);
  assert.equal(evidence.import.durableImport.promotedDispositionCount, pointers.length);
  assert.doesNotMatch(canonicalReaderAuthorityJson(evidence), /reader-production-123/);
});

test("missing, forged, stale, extra, and secret-bearing provider metadata fail closed", async (t) => {
  const cases: readonly [string, Buffer, RegExp][] = [
    ["missing field", providerMetadata({ endpointHost: undefined }), /shape is not exact/],
    ["wrong project", providerMetadata({ projectId: "tiny-hill-forged" }), /outside the pinned/],
    ["wrong parent", providerMetadata({ parentBranchId: "br-forged-parent" }), /not a child/],
    ["wrong endpoint", providerMetadata({ endpointHost: "ep-other-123.neon.tech" }), /differs from provider metadata/],
    ["stale", providerMetadata({ observedAt: "2026-09-09T00:00:00.000Z" }), /not fresh/],
    ["extra field", providerMetadata({ comment: "forged" }), /shape is not exact/],
    ["secret field", providerMetadata({ databaseUrl: CONNECTION }), /forbidden secret-bearing field|credential-bearing URL/],
    ["non-string secret field", providerMetadata({ apiToken: { planted: true } }), /forbidden secret-bearing field/],
  ];
  for (const [name, bytes, expected] of cases) {
    await t.test(name, async () => {
      await assert.rejects(
        buildReaderExecutionAuthorityEvidence(options({ providerMetadataBytes: bytes })),
        expected,
      );
    });
  }
});

test("forged receipts and pointer sets cannot become authority evidence", async (t) => {
  const pointers = pointerRows();
  const receipt = JSON.parse(rehearsalReceipt(pointers).toString("utf8")) as Record<string, unknown>;
  await t.test("receipt bytes changed after self-hash", async () => {
    await assert.rejects(
      buildReaderExecutionAuthorityEvidence(options({
        importReceiptBytes: Buffer.from(JSON.stringify({ ...receipt, result: "PDC_V2_REHEARSAL_PREFLIGHT_PASS" })),
      })),
      /self-hash differs/,
    );
  });
  await t.test("extra receipt field", async () => {
    const unsigned: Record<string, unknown> = { ...receipt, unexpected: "field" };
    delete unsigned.receiptSha256;
    await assert.rejects(
      buildReaderExecutionAuthorityEvidence(options({
        importReceiptBytes: Buffer.from(canonicalReaderAuthorityJson({
          ...unsigned,
          receiptSha256: sha256(canonicalReaderAuthorityJson(unsigned)),
        })),
      })),
      /shape differs/,
    );
  });
  await t.test("nested secret field is rejected regardless of value type", async () => {
    const unsigned: Record<string, unknown> = {
      ...receipt,
      code: { ...(receipt.code as Record<string, unknown>), accessToken: { planted: true } },
    };
    delete unsigned.receiptSha256;
    await assert.rejects(
      buildReaderExecutionAuthorityEvidence(options({
        importReceiptBytes: Buffer.from(canonicalReaderAuthorityJson({
          ...unsigned,
          receiptSha256: sha256(canonicalReaderAuthorityJson(unsigned)),
        })),
      })),
      /forbidden secret-bearing field/,
    );
  });
  await t.test("receipt pointer digest differs from live rows", async () => {
    const pointerBlock = receipt.pointers as Record<string, unknown>;
    const after = pointerBlock.after as Record<string, unknown>;
    const unsigned: Record<string, unknown> = {
      ...receipt,
      pointers: {
        ...pointerBlock,
        after: { ...after, sha256: "c".repeat(64) },
        currentPointerSha256: "c".repeat(64),
      },
    };
    delete unsigned.receiptSha256;
    await assert.rejects(
      buildReaderExecutionAuthorityEvidence(options({
        importReceiptBytes: Buffer.from(canonicalReaderAuthorityJson({
          ...unsigned,
          receiptSha256: sha256(canonicalReaderAuthorityJson(unsigned)),
        })),
      })),
      /live pointer set differs/,
    );
  });
  await t.test("live pointer content differs from receipt", async () => {
    const forgedPointers = pointerRows();
    forgedPointers[0] = { ...forgedPointers[0], payload: { meetings: [] } };
    await assert.rejects(
      buildReaderExecutionAuthorityEvidence(options({
        sql: fakeTransport({ pointers: forgedPointers }),
      })),
      /live pointer set differs|durable PDC import evidence|pointer payload differs/,
    );
  });
});

test("writable, non-refusing, and database-mismatched handles fail closed", async (t) => {
  await t.test("URL names a writer", async () => {
    await assert.rejects(
      buildReaderExecutionAuthorityEvidence(options({
        connection: CONNECTION.replace("readonly_pdc", "neondb_owner"),
      })),
      /does not name a read-only role/,
    );
  });
  await t.test("catalog grants INSERT", async () => {
    await assert.rejects(
      buildReaderExecutionAuthorityEvidence(options({
        sql: fakeTransport({ identity: { candidates_insert: true } }),
      })),
      /not SELECT-only/,
    );
  });
  await t.test("NOINHERIT SET ROLE writer is reachable", async () => {
    await assert.rejects(
      buildReaderExecutionAuthorityEvidence(options({
        sql: fakeTransport({ identity: { write_capable_member_role_count: "1" } }),
      })),
      /database identity\/tables differ/,
    );
  });
  await t.test("column REFERENCES grant is writable authority", async () => {
    await assert.rejects(
      buildReaderExecutionAuthorityEvidence(options({
        sql: fakeTransport({ identity: { column_write_privilege_count: "1" } }),
      })),
      /database identity\/tables differ/,
    );
  });
  await t.test("executable write-capable SECURITY DEFINER is rejected", async () => {
    await assert.rejects(
      buildReaderExecutionAuthorityEvidence(options({
        sql: fakeTransport({ identity: { executable_security_definer_function_count: "1" } }),
      })),
      /database identity\/tables differ/,
    );
  });
  await t.test("role privilege probe is admitted", async () => {
    await assert.rejects(
      buildReaderExecutionAuthorityEvidence(options({
        sql: fakeTransport({ admitPrivilegeProbe: true }),
      })),
      /admitted a DELETE execution plan/,
    );
  });
  await t.test("role privilege probe fails for an unrelated reason", async () => {
    await assert.rejects(
      buildReaderExecutionAuthorityEvidence(options({
        sql: fakeTransport({ privilegeProbeErrorCode: "08006" }),
      })),
      /role-privilege probe failed for a non-privilege reason/,
    );
  });
  await t.test("write probe is admitted", async () => {
    await assert.rejects(
      buildReaderExecutionAuthorityEvidence(options({ sql: fakeTransport({ admitWrite: true }) })),
      /admitted a write statement/,
    );
  });
  await t.test("write probe fails for an unrelated reason", async () => {
    await assert.rejects(
      buildReaderExecutionAuthorityEvidence(options({
        sql: fakeTransport({ writeErrorCode: "08006" }),
      })),
      /non-privilege reason/,
    );
  });
  await t.test("database identity differs", async () => {
    await assert.rejects(
      buildReaderExecutionAuthorityEvidence(options({
        sql: fakeTransport({ identity: { database: "another_database" } }),
      })),
      /database identity\/tables differ/,
    );
  });
});

test("phase relabeling cannot turn a rehearsal child into production evidence", async () => {
  await assert.rejects(
    buildReaderExecutionAuthorityEvidence(options({
      phase: "PRODUCTION",
      providerMetadataPath: "docs/evidence/reader-last-mile-production-provider-metadata.json",
      importReceiptPath: "docs/evidence/reader-last-mile-production-import-receipt.json",
    })),
    /not the pinned production branch/,
  );
});

test("forged durable candidate and event receipts fail independently of pointer counts", async (t) => {
  const pointers = pointerRows();
  await t.test("bootstrap importer SHA differs", async () => {
    const candidates = candidateRows(pointers);
    const candidate = candidates[0]!.candidate as Record<string, unknown>;
    candidates[0] = {
      ...candidates[0],
      candidate: {
        ...candidate,
        bootstrapImport: {
          ...(candidate.bootstrapImport as Record<string, unknown>),
          importerCodeSha: "d".repeat(40),
        },
      },
    };
    await assert.rejects(
      buildReaderExecutionAuthorityEvidence(options({
        sql: fakeTransport({ pointers, candidates }),
      })),
      /importer|durable PDC import evidence|durable import/i,
    );
  });
  await t.test("event sequence has a gap", async () => {
    const events = eventRows(pointers);
    events[1] = { ...events[1], sequence: 7 };
    await assert.rejects(
      buildReaderExecutionAuthorityEvidence(options({
        sql: fakeTransport({ pointers, events }),
      })),
      /coherent durable PDC import evidence|event history is incomplete/,
    );
  });
  await t.test("GOOD receipt with an extra planted field is not exact evidence", async () => {
    const candidates = candidateRows(pointers);
    const receipt = candidates[0]!.validation_receipt as Record<string, unknown>;
    candidates[0] = {
      ...candidates[0],
      validation_receipt: { ...receipt, planted: true },
      pointer_validation_receipt: { ...receipt, planted: true },
    };
    await assert.rejects(
      buildReaderExecutionAuthorityEvidence(options({
        sql: fakeTransport({ pointers, candidates }),
      })),
      /coherent durable PDC import evidence/,
    );
  });
});

test("re-attested authority binds the exact predecessor row, receipt, pointer, and contiguous events", async () => {
  const importedFixture = fixtureCandidate("001");
  const { bootstrapImport: _bootstrapImport, ...sourceNative } = importedFixture;
  const predecessorReceipt = validationReceiptFor(
    sourceNative as RoutineCandidate,
    "SOURCE_PRIMARY_AUTHENTICATED",
  );
  const predecessor: CandidateVersionRecord = {
    candidate: sourceNative as RoutineCandidate,
    state: "PROMOTED",
    acquisitionSucceeded: true,
    receipt: predecessorReceipt,
    promotedVersion: sourceNative.id,
    lastKnownGoodVersion: sourceNative.id,
    failureCode: null,
    failureDetail: null,
  };
  const predecessorPointer: PromotedProjection = {
    key: `${sourceNative.recordClass}:${sourceNative.scope}`,
    sourceId: sourceNative.sourceId,
    recordClass: sourceNative.recordClass,
    scope: sourceNative.scope,
    versionId: sourceNative.id,
    lastKnownGoodVersionId: sourceNative.id,
    promotedAt: NOW,
    payload: sourceNative.readModel,
    receipt: predecessorReceipt,
  };
  const successor = buildPdcV2TrustedLkgReattestationCandidate({
    contract: {
      id: "contract-001",
      sourceId: sourceNative.sourceId,
      recordClass: sourceNative.recordClass,
      scope: sourceNative.scope,
      parserNormalizerVersion: sourceNative.normalization.parserVersion,
    } as Parameters<typeof buildPdcV2TrustedLkgReattestationCandidate>[0]["contract"],
    pointer: predecessorPointer,
    predecessor,
    reattestedAt: NOW,
    importerCodeSha: HEAD,
  });
  const successorReceipt = validationReceiptFor(
    successor,
    "TRUSTED_LKG_REATTESTATION_PROVENANCE_VALID",
  );
  const pointers = pointerRows();
  pointers[0] = {
    key: `${successor.recordClass}:${successor.scope}`,
    source_id: successor.sourceId,
    record_class: successor.recordClass,
    scope: successor.scope,
    current_version_id: successor.id,
    last_known_good_version_id: successor.id,
    promoted_at: NOW,
    payload: successor.readModel,
    validation_receipt: successorReceipt,
  };
  const candidates = candidateRows(pointers);
  candidates[0] = {
    ...candidates[0],
    current_version_id: successor.id,
    last_known_good_version_id: successor.id,
    candidate_id: successor.id,
    promoted_version_id: successor.id,
    candidate_lkg_version_id: successor.id,
    candidate: successor,
    validation_receipt: successorReceipt,
    pointer_validation_receipt: successorReceipt,
    predecessor_state: predecessor.state,
    predecessor_acquisition_succeeded: predecessor.acquisitionSucceeded,
    predecessor_promoted_version_id: predecessor.promotedVersion,
    predecessor_lkg_version_id: predecessor.lastKnownGoodVersion,
    predecessor_failure_code: null,
    predecessor_failure_detail: null,
    predecessor_candidate: predecessor.candidate,
    predecessor_validation_receipt: predecessor.receipt,
  };
  const predecessorEvents = ["FETCHED", "NORMALIZED", "VALIDATED", "PROMOTED"].map((state, index) => ({
    candidate_id: predecessor.candidate.id,
    sequence: index + 1,
    state,
    at: NOW,
    detail: `${state} predecessor receipt`,
  }));
  const events = [...eventRows(pointers), ...predecessorEvents]
    .sort((left, right) => String(left.candidate_id).localeCompare(String(right.candidate_id)) || Number(left.sequence) - Number(right.sequence));
  const dispositions = dispositionSet(pointers);
  dispositions[0] = { ...dispositions[0]!, disposition: "REATTESTED_EXISTING_AUTHORITY" };
  dispositions.sort((left, right) => left.contractId.localeCompare(right.contractId));

  const evidence = await buildReaderExecutionAuthorityEvidence(options({
    importReceiptBytes: rehearsalReceipt(pointers, {}, providerMetadata(), dispositions),
    sql: fakeTransport({ pointers, candidates, events }),
  }));
  assert.equal(evidence.import.durableImport.reattestedDispositionCount, 1);
  assert.equal(evidence.import.durableImport.predecessorCandidateCount, 1);
  assert.equal(evidence.import.durableImport.predecessorEventCount, 4);

  const brokenEvents = events.map((event) => event.candidate_id === predecessor.candidate.id && event.sequence === 2
    ? { ...event, sequence: 7 }
    : event);
  await assert.rejects(
    buildReaderExecutionAuthorityEvidence(options({
      importReceiptBytes: rehearsalReceipt(pointers, {}, providerMetadata(), dispositions),
      sql: fakeTransport({ pointers, candidates, events: brokenEvents }),
    })),
    /coherent durable PDC import evidence/,
  );
});

test("a source-native skipped pointer needs promotion/readback proof but no bootstrap envelope", async () => {
  const pointers = pointerRows();
  const candidates = candidateRows(pointers);
  const original = candidates[0]!.candidate as RoutineCandidate;
  const { bootstrapImport: _bootstrapImport, ...sourceNativeCandidate } = original;
  const nativeReceipt = {
    ...(pointers[0]!.validation_receipt as Record<string, unknown>),
    checks: ((pointers[0]!.validation_receipt as Record<string, unknown>).checks as Record<string, unknown>[])
      .map((check) => check.check === "SOURCE_AUTHENTICITY"
        ? { ...check, code: "SOURCE_PRIMARY_AUTHENTICATED" }
        : check),
  };
  pointers[0] = { ...pointers[0], validation_receipt: nativeReceipt };
  candidates[0] = {
    ...candidates[0],
    candidate: sourceNativeCandidate,
    validation_receipt: nativeReceipt,
    pointer_validation_receipt: nativeReceipt,
  };
  const dispositions = dispositionSet(pointers);
  dispositions[0] = {
    ...dispositions[0]!,
    candidateId: "planned-source-candidate-not-serving",
    disposition: "SKIPPED_EXISTING_PROVEN_AUTHORITY",
  };
  dispositions.sort((left, right) => left.contractId.localeCompare(right.contractId));

  const evidence = await buildReaderExecutionAuthorityEvidence(options({
    importReceiptBytes: rehearsalReceipt(pointers, {}, providerMetadata(), dispositions),
    sql: fakeTransport({ pointers, candidates, events: eventRows(pointers) }),
  }));

  assert.equal(evidence.import.durableImport.skippedDispositionCount, 1);
  assert.equal(evidence.import.durableImport.promotedDispositionCount, pointers.length - 1);
});

test("the terminal comparator re-reads live authority and emits no driver secret", async () => {
  const expected = await buildReaderExecutionAuthorityEvidence(options());
  assert.deepEqual(await readerExecutionAuthorityLiveProblems(expected, {
    connection: CONNECTION,
    providerMetadataPath: expected.store.providerMetadataPath,
    providerMetadataBytes: providerMetadata(),
    importReceiptPath: expected.import.receiptPath,
    importReceiptBytes: rehearsalReceipt(pointerRows()),
    sql: fakeTransport(),
    nowMs: Date.parse(NOW),
  }), []);

  const failure = await readerExecutionAuthorityLiveProblems(expected, {
    connection: CONNECTION,
    providerMetadataPath: expected.store.providerMetadataPath,
    providerMetadataBytes: providerMetadata(),
    importReceiptPath: expected.import.receiptPath,
    importReceiptBytes: rehearsalReceipt(pointerRows()),
    sql: {
      query: async () => { throw new Error(`driver exposed ${CONNECTION}`); },
      readOnlyTransaction: async () => [],
    },
    nowMs: Date.parse(NOW),
  });
  assert.deepEqual(failure, ["Reader execution authority live readback failed"]);
  assert.equal(failure.join(" ").includes("test-only-password"), false);
});

test("the CLI surface never accepts a database URL and derives phase-specific paths", () => {
  assert.deepEqual(parseReaderAuthorityGeneratorArguments([
    "--phase=REHEARSAL",
    "--provider-metadata=.runtime/provider.json",
    "--import-receipt=.runtime/receipt.json",
  ]), {
    phase: "REHEARSAL",
    providerMetadataInput: ".runtime/provider.json",
    importReceiptInput: ".runtime/receipt.json",
  });
  assert.throws(() => parseReaderAuthorityGeneratorArguments([
    "--phase=REHEARSAL",
    "--provider-metadata=.runtime/provider.json",
    "--import-receipt=.runtime/receipt.json",
    `--database-url=${CONNECTION}`,
  ]), /usage/);
  assert.deepEqual(readerAuthorityEvidencePaths("PRODUCTION"), {
    authority: "docs/evidence/reader-last-mile-production-authority.json",
    providerMetadata: "docs/evidence/reader-last-mile-production-provider-metadata.json",
    importReceipt: "docs/evidence/reader-last-mile-production-import-receipt.json",
  });
  assert.equal(READER_AUTHORITY_DATABASE_ENV.includes("READONLY"), true);
  assert.equal(readerAuthorityNodeAdmissionIssue([
    "--experimental-strip-types",
    "--env-file=.runtime/reader-authority.env",
  ]), null);
  assert.match(readerAuthorityNodeAdmissionIssue([
    "--experimental-strip-types",
    "--import=tests/fixtures/forged-loader.mjs",
  ]) ?? "", /unexpected Node preload/);
  assert.equal(readerAuthorityAmbientCapabilityIssue({
    [READER_AUTHORITY_DATABASE_ENV]: CONNECTION,
  }), null);
  assert.match(readerAuthorityAmbientCapabilityIssue({
    [READER_AUTHORITY_DATABASE_ENV]: CONNECTION,
    WTP_PRODUCTION_DATABASE_URL_WRITE: CONNECTION.replace("readonly_pdc", "owner"),
  }) ?? "", /refuses ambient capability/);
});

test("the Neon adapter submits the write probe only as an explicit read-only transaction", async () => {
  const observations: unknown[] = [];
  const adapter = readerAuthoritySqlFromNeon({
    query: async (statement) => {
      observations.push({ kind: "query", statement });
      return [{ ok: true }];
    },
    transaction: async (build, transactionOptions) => {
      const queued = build({
        query: (statement) => ({ statement }),
      });
      observations.push({ kind: "transaction", queued, transactionOptions });
      return queued.map(() => []);
    },
  });

  assert.deepEqual(await adapter.query("select 1 as ok"), [{ ok: true }]);
  assert.deepEqual(
    await adapter.readOnlyTransaction(["delete from public.civic_data_promotions where false"]),
    [[]],
  );
  assert.deepEqual(observations, [
    { kind: "query", statement: "select 1 as ok" },
    {
      kind: "transaction",
      queued: [{ statement: "delete from public.civic_data_promotions where false" }],
      transactionOptions: { readOnly: true },
    },
  ]);
});

test("authority output is atomic, exclusive, and identical support recovery is bounded", async () => {
  const directory = await mkdtemp(join(tmpdir(), "reader-authority-"));
  try {
    const target = join(directory, "authority.json");
    const bytes = Buffer.from("{\"formatVersion\":1}\n");
    assert.equal(createImmutableEvidenceFile(target, bytes, { allowIdenticalExisting: false }), true);
    assert.deepEqual(readFileSync(target), bytes);
    assert.throws(
      () => createImmutableEvidenceFile(target, bytes, { allowIdenticalExisting: false }),
      /already exists/,
    );
    assert.equal(createImmutableEvidenceFile(target, bytes, { allowIdenticalExisting: true }), false);
    assert.throws(
      () => createImmutableEvidenceFile(target, Buffer.from("forged"), { allowIdenticalExisting: true }),
      /non-reusable bytes/,
    );
    const symlinkTarget = join(directory, "support-link.json");
    symlinkSync(target, symlinkTarget);
    assert.throws(
      () => createImmutableEvidenceFile(symlinkTarget, bytes, { allowIdenticalExisting: true }),
      /non-reusable bytes/,
    );
    const hardlinkTarget = join(directory, "support-hardlink.json");
    linkSync(target, hardlinkTarget);
    assert.throws(
      () => createImmutableEvidenceFile(hardlinkTarget, bytes, { allowIdenticalExisting: true }),
      /non-reusable bytes/,
    );
    assert.equal(existsSync(`${target}.tmp`), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function git(root: string, args: readonly string[]): string {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(result.status, 0, String(result.stderr));
  return String(result.stdout).trim();
}

test("the publication-boundary repository proof rejects clean-head races", async () => {
  const directory = await mkdtemp(join(tmpdir(), "reader-authority-git-"));
  try {
    mkdirSync(join(directory, "scripts"), { recursive: true });
    mkdirSync(join(directory, "lib", "holdings"), { recursive: true });
    writeFileSync(join(directory, "scripts", "reader-execution-authority-evidence.mts"), "export {};\n");
    writeFileSync(join(directory, "lib", "holdings", "reader-execution-authority.ts"), "export {};\n");
    writeFileSync(join(directory, "tracked.txt"), "before\n");
    git(directory, ["init", "--quiet"]);
    git(directory, ["add", "."]);
    git(directory, [
      "-c", "user.name=Reader Authority Test",
      "-c", "user.email=reader-authority@example.invalid",
      "commit", "--quiet", "-m", "fixture",
    ]);
    const expected = {
      root: realpathSync(directory),
      exactHead: git(directory, ["rev-parse", "HEAD"]),
    };
    assert.deepEqual(
      proveReaderAuthorityRepositoryBeforePublish(directory, [], expected),
      expected,
    );

    writeFileSync(join(directory, "tracked.txt"), "changed while database readback ran\n");
    assert.throws(
      () => proveReaderAuthorityRepositoryBeforePublish(directory, [], expected),
      /changes outside its exact support outputs/,
    );

    writeFileSync(join(directory, "tracked.txt"), "before\n");
    writeFileSync(join(directory, "second.txt"), "new head\n");
    git(directory, ["add", "second.txt"]);
    git(directory, [
      "-c", "user.name=Reader Authority Test",
      "-c", "user.email=reader-authority@example.invalid",
      "commit", "--quiet", "-m", "head race",
    ]);
    const childHead = git(directory, ["rev-parse", "HEAD"]);
    assert.equal(
      readerAuthorityImporterHistoryIssue(directory, "PRODUCTION", expected.exactHead, childHead),
      null,
      "terminal proof commit B accepts its strict importer-A ancestor",
    );
    assert.match(
      readerAuthorityImporterHistoryIssue(directory, "PRODUCTION", childHead, childHead) ?? "",
      /strict ancestor/,
    );
    assert.match(
      readerAuthorityImporterHistoryIssue(directory, "PRODUCTION", "f".repeat(40), childHead) ?? "",
      /not an ancestor/,
    );
    assert.throws(
      () => proveReaderAuthorityRepositoryBeforePublish(directory, [], expected),
      /repository or head changed during live readback/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("diagnostics redact URL and credential material", () => {
  const diagnostic = redactReaderAuthorityError(
    new Error(`request to ${CONNECTION} failed; password=test-only-password`),
    [CONNECTION, "test-only-password"],
  );
  assert.equal(diagnostic.includes(CONNECTION), false);
  assert.equal(diagnostic.includes("test-only-password"), false);
  assert.match(diagnostic, /REDACTED/);
});
