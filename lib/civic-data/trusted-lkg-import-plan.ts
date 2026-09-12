import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { pathToFileURL } from "node:url";

import type { CandidateCorpus } from "../candidates/corpus.ts";
import type { StatementCorpus } from "../corpus/types.ts";
import {
  transferFrozenStatementIdentities,
  type LegacyOfficialCandidaciesFile,
  type TrustedLkgStatementIdentityRekey,
  type TrustedLkgStatementIdentityTransfer,
} from "../corpus/statement-identity-transfer.ts";
export { transferFrozenStatementIdentities };
export type {
  LegacyOfficialCandidaciesFile,
  TrustedLkgStatementIdentityRekey,
  TrustedLkgStatementIdentityTransfer,
};
import type { ExecutiveActionStore } from "../officials/executive-actions.ts";
import { officeholderIdentityMayEnterReader } from "../officials/roster-authority.ts";
import {
  type OfficialCandidacyBridge,
  type RegistryRuntimeReadModel,
  registryRuntimeCandidate,
} from "../registry/runtime-data-plane.ts";
import type { Body, Registry } from "../registry/types.ts";
import {
  federalKeyVotesCandidate,
  federalRollCallsCandidate,
  type FederalKeyVotePositions,
  type FederalKeyVotesSnapshot,
  type OfficialAcquisition,
} from "../votes/data-plane.ts";
import { hydrateFederalKeyVoteBootstrapV1 } from "../votes/key-vote-selection-v1.ts";
import type { BillSummariesFile } from "../votes/bill-summaries.ts";
import type { VotesSnapshot } from "../votes/types.ts";
import {
  azOfficialActionsCandidate,
  pimaLegistarOutcomesCandidate,
} from "../outcomes/data-plane.ts";
import type { OutcomeSnapshot, PersistedSittingOutcomes } from "../outcomes/types.ts";
import type { SourceAcquisitionEvidence } from "../sources/acquisition-trace.ts";
import {
  candidateChangeSet,
  canonicalCivicDataJson,
  civicRecordsFor,
} from "./changes.ts";
import { verifySourceScopedCandidateProjection } from "./candidate-integrity.ts";
import { meetingsCandidate } from "./candidate-builders.ts";
import {
  ROUTINE_SOURCE_CONTRACTS,
  type RoutineSourceContract,
} from "./contracts.ts";
import { directPositiveSourceUrls } from "./manual-source-isolation.ts";
import {
  manualProjectionCandidate,
  type CandidateProfilesProjection,
  type CuratedReaderProjection,
  type ManualProjectionContractId,
  type ManualProjectionPackage,
  type ManualProjectionPayload,
} from "./manual-projections.ts";
import {
  MANUAL_PRODUCTION_SOURCE_CONTRACTS,
  type ManualProductionContractId,
  type ManualProductionSourceContract,
  requiredManualProductionContract,
} from "./manual-contracts.ts";
import {
  MEETING_PARTITION_CONTRACTS,
  requiredMeetingPartitionContract,
  type MeetingPartitionContract,
} from "./meeting-partitions.ts";
import {
  processRegisteredRoutineCandidate,
  processRegisteredManualCandidate,
  processRegisteredMeetingPartitionCandidate,
  promotionReaderReadbackObservedAt,
  type PromotionOutcome,
} from "./promotion.ts";
import {
  promotionProofIssue,
  readPromotedCivicData,
} from "./read-model.ts";
import {
  recordRoutineReaderProjectionReadback,
  verifyRoutineReaderProjection,
} from "./reader-verification.ts";
import {
  normalizeReaderCodeSha,
  parseReaderProjectionReadback,
  READER_PROJECTION_READBACK_PREFIX,
  READER_READBACK_EVIDENCE_KIND,
  serializeReaderProjectionReadback,
  sourceScopedReaderReadbackProjectionId,
  type ReaderProjectionReadbackReceipt,
} from "./reader-readback.ts";
import {
  pdcV2CanonicalMeetingFactEvidence,
  projectionKey,
  type PdcV2LegacyMeetingsRetirementInput,
  type PdcV2LegacyMeetingsRetirementResult,
  type RoutineDataStore,
} from "./store.ts";
import {
  PDC_V2_FROZEN_BASE_SHA,
  TRUSTED_LKG_IMPORT_AUTHORIZATION,
  TRUSTED_LKG_IMPORT_PURPOSE,
  trustedLkgCandidateId,
  trustedLkgCandidateEnvelopeSha256,
  trustedLkgEvidenceSha256,
  trustedLkgFixtureSetSha256,
  trustedLkgImportEvidenceIssue,
  trustedLkgImportUrl,
  NH_MEMBERS_V2_TO_V3_REATTESTATION,
  trustedLkgPredecessorPointerSha256,
  trustedLkgPredecessorRecordSha256,
  trustedLkgNhMembersV2ToV3BridgeParts,
  TRUSTED_LKG_REATTESTATION_PURPOSE,
  trustedLkgValidatorIds,
} from "./trusted-lkg-import.ts";
import {
  sourceProjectionEvidence,
  type CandidateEvent,
  type CandidateVersionRecord,
  type ManualSourceClass,
  type ManualSourceReview,
  type ManualSourceSetReceipt,
  type PromotedProjection,
  type RoutineCandidate,
  type TrustedLkgFixtureEvidence,
  type TrustedLkgImportEvidence,
  type TrustedLkgLegacyMeetingsPartitionEvidence,
  type TrustedLkgPimaOutcomeUnionEvidence,
  type TrustedLkgReattestationEvidence,
} from "./types.ts";
import { validateRoutineCandidate } from "./validate.ts";
import {
  readMeetingsProjection,
  validateSnapshot,
  type MeetingsSnapshot,
  type SnapshotSourceReport,
} from "../meetings/snapshot.ts";
import { canonicalAgendaDocument } from "../meetings/agenda-documents.ts";
import { exactVenueMatchContentKey } from "../meetings/venue-record-identity.ts";
import {
  buildEverydayRoutingProjection,
  type EverydayContact,
  type EverydayMiss,
  type EverydayRoutingProjection,
} from "../routing/everyday.ts";

export const PDC_V2_TRUSTED_LKG_IMPORTER_PATH = "scripts/pdc-v2-trusted-lkg-import.mts";

export const PDC_V2_TRUSTED_LKG_MANUAL_CONTRACT_IDS = [
  "registry-runtime-bindings",
  "congress-rollcalls",
  "federal-key-votes",
  "candidate-profiles",
  "candidate-corpus",
  "officeholder-statements",
  "az-official-actions",
  "pima-legistar-outcomes",
  "comment-access",
  "ballot-navigation",
  "campaign-sites",
  "venue-resolutions",
  "everyday-routing",
] as const satisfies readonly ManualProductionContractId[];

export const PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS = {
  meetingPartitionsWithLkg: 83,
  meetingPartitionsWithoutLkg: 41,
  meetingRows: 619,
  meetingAgendaDocumentRows: 196,
  manualContracts: 13,
  totalCandidates: 96,
  plannedExistingUnionContracts: 1,
  pimaOutcomeSittings: 20,
  everydayRoutingTopics: 9,
  everydayRoutingZips: 4,
  everydayRoutingCells: 36,
  everydayRoutingContactAvailableCells: 30,
  everydayRoutingContactOwedCells: 6,
  everydayRoutingContactRecords: 36,
  everydayRoutingContactSources: 26,
  federalKeyVoteQuestions: 36,
  federalKeyVoteRollReferences: 54,
  federalKeyVotePositionMaps: 54,
  federalKeyVoteSelectionMisses: 1,
  federalKeyVoteLawMisses: 0,
  federalKeyVoteRetiredPositionMaps: 1,
  frozenLawTitleBills: 1_062,
  frozenLawTitleRows: 8_516,
  frozenLawTitleUniqueValues: 2_861,
  frozenOfficeholderStatementSnapshots: 32,
  promotedOfficeholderStatementSnapshots: 29,
  rekeyedOfficeholderStatementSnapshots: 10,
  heldOfficeholderStatementSnapshots: 3,
} as const;

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function repoPath(value: string): string {
  return value.replaceAll("\\", "/");
}

function validRepoPath(value: string): boolean {
  if (!value || value.startsWith("/") || value.includes("\\") || /^[A-Za-z]:/.test(value)) return false;
  return value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function samePath(left: string, right: string): boolean {
  return realpathSync(left).toLowerCase() === realpathSync(right).toLowerCase();
}

interface GitResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

function git(root: string, args: readonly string[], allowFailure = false): GitResult {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  const status = result.status ?? 1;
  const stdout = result.stdout?.trim() ?? "";
  const stderr = result.stderr?.trim() ?? "";
  if (!allowFailure && status !== 0) {
    throw new Error(`TRUSTED_LKG_GIT_COMMAND_FAILED:git -C ${root} ${args.join(" ")}:${stderr || stdout || `exit ${status}`}`);
  }
  return { status, stdout, stderr };
}

export interface TrustedLkgRepositoryFacts {
  readonly requestedRoot: string;
  readonly repositoryRoot: string;
  readonly headSha: string;
  readonly clean: boolean;
  readonly detached: boolean;
  readonly trackedPaths: readonly string[];
  readonly trackedBlobIds: Readonly<Record<string, string>>;
  readonly frozenBaseIsAncestor: boolean;
  readonly importerTrackedAtHead: boolean;
  readonly importerMatchesHead: boolean;
}

/** Read-only Git facts used by both the executable and deterministic guard tests. */
export function inspectTrustedLkgRepository(
  requestedRoot: string,
  importerPath: string = PDC_V2_TRUSTED_LKG_IMPORTER_PATH,
): TrustedLkgRepositoryFacts {
  if (!isAbsolute(requestedRoot)) throw new Error("TRUSTED_LKG_REPOSITORY_ROOT_MUST_BE_ABSOLUTE");
  const requested = realpathSync(resolve(requestedRoot));
  const repositoryRoot = realpathSync(git(requested, ["rev-parse", "--show-toplevel"]).stdout);
  const headSha = git(repositoryRoot, ["rev-parse", "HEAD"]).stdout.toLowerCase();
  const trackedBlobIds = Object.fromEntries(git(repositoryRoot, ["ls-tree", "-r", "HEAD"]).stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line): readonly [string, string] => {
      const match = /^\d+\s+blob\s+([a-f0-9]{40})\t(.+)$/.exec(line);
      if (!match) throw new Error(`TRUSTED_LKG_GIT_TREE_ROW_INVALID:${line}`);
      return [repoPath(match[2]!), match[1]!];
    }));
  const trackedPaths = Object.keys(trackedBlobIds).sort();
  const tracked = new Set(trackedPaths);
  const importerTrackedAtHead = tracked.has(importerPath) &&
    git(repositoryRoot, ["cat-file", "-e", `HEAD:${importerPath}`], true).status === 0;
  const importerAbsolute = resolve(repositoryRoot, ...importerPath.split("/"));
  const importerMatchesHead = importerTrackedAtHead && statSync(importerAbsolute).isFile() &&
    git(repositoryRoot, ["hash-object", importerAbsolute]).stdout ===
      git(repositoryRoot, ["rev-parse", `HEAD:${importerPath}`]).stdout;
  return {
    requestedRoot: requested,
    repositoryRoot,
    headSha,
    clean: git(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=all"]).stdout === "",
    detached: git(repositoryRoot, ["symbolic-ref", "-q", "HEAD"], true).status !== 0,
    trackedPaths,
    trackedBlobIds,
    frozenBaseIsAncestor: git(repositoryRoot, ["merge-base", "--is-ancestor", PDC_V2_FROZEN_BASE_SHA, headSha], true).status === 0,
    importerTrackedAtHead,
    importerMatchesHead,
  };
}

export function trustedLkgImporterRepositoryIssue(facts: TrustedLkgRepositoryFacts): string | null {
  if (!GIT_SHA.test(facts.headSha)) return "the importer repository HEAD is not an exact commit";
  if (!facts.clean) return "the importer repository is not clean, including untracked files";
  if (!facts.frozenBaseIsAncestor) return `${PDC_V2_FROZEN_BASE_SHA} is not an ancestor of importer HEAD ${facts.headSha}`;
  if (!facts.importerTrackedAtHead) return `${PDC_V2_TRUSTED_LKG_IMPORTER_PATH} is not tracked at importer HEAD`;
  if (!facts.importerMatchesHead) return `${PDC_V2_TRUSTED_LKG_IMPORTER_PATH} does not match its committed HEAD bytes`;
  return null;
}

export function trustedLkgFrozenRepositoryIssue(
  facts: TrustedLkgRepositoryFacts,
  importerFacts?: TrustedLkgRepositoryFacts,
): string | null {
  if (!samePath(facts.requestedRoot, facts.repositoryRoot)) return "--frozen-root must name the Git worktree root itself";
  if (facts.headSha !== PDC_V2_FROZEN_BASE_SHA) return `the frozen worktree HEAD is ${facts.headSha}, not ${PDC_V2_FROZEN_BASE_SHA}`;
  if (!facts.clean) return "the frozen worktree is not clean, including untracked files";
  if (!facts.detached) return "the frozen worktree must be detached at the frozen base";
  if (importerFacts && samePath(facts.repositoryRoot, importerFacts.repositoryRoot)) {
    return "the frozen worktree must be separate from the importer worktree";
  }
  return null;
}

class FrozenTree {
  readonly root: string;
  private readonly tracked: ReadonlySet<string>;
  private readonly trackedBlobIds: Readonly<Record<string, string>>;
  private capturePaths: Set<string> | null = null;

  constructor(facts: TrustedLkgRepositoryFacts) {
    this.root = facts.repositoryRoot;
    this.tracked = new Set(facts.trackedPaths);
    this.trackedBlobIds = facts.trackedBlobIds;
  }

  private absolute(path: string): string {
    if (!validRepoPath(path) || !this.tracked.has(path)) {
      throw new Error(`TRUSTED_LKG_FROZEN_PATH_NOT_TRACKED:${path}`);
    }
    const absolute = realpathSync(resolve(this.root, ...path.split("/")));
    const fromRoot = relative(this.root, absolute);
    if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
      throw new Error(`TRUSTED_LKG_FROZEN_PATH_ESCAPES_ROOT:${path}`);
    }
    if (!statSync(absolute).isFile()) throw new Error(`TRUSTED_LKG_FROZEN_PATH_NOT_FILE:${path}`);
    return absolute;
  }

  bytes(path: string): Buffer {
    const bytes = readFileSync(this.absolute(path));
    if (bytes.byteLength === 0) throw new Error(`TRUSTED_LKG_FROZEN_FILE_EMPTY:${path}`);
    const worktreeBlobId = createHash("sha1")
      .update(`blob ${bytes.byteLength}\0`, "utf8")
      .update(bytes)
      .digest("hex");
    if (worktreeBlobId !== this.trackedBlobIds[path]) {
      throw new Error(`TRUSTED_LKG_FROZEN_BYTES_DO_NOT_MATCH_HEAD:${path}`);
    }
    this.capturePaths?.add(path);
    return bytes;
  }

  json<T>(path: string): T {
    return JSON.parse(this.bytes(path).toString("utf8")) as T;
  }

  private importedPath(from: string, specifier: string): string | null {
    if (!specifier.startsWith(".")) return null;
    const unresolved = repoPath(resolve(dirname(resolve(this.root, ...from.split("/"))), specifier));
    const fromRoot = repoPath(relative(this.root, unresolved));
    const candidates = [fromRoot, `${fromRoot}.ts`, `${fromRoot}.mts`, `${fromRoot}.js`, `${fromRoot}.mjs`, `${fromRoot}.json`];
    return candidates.find((candidate) => validRepoPath(candidate) && this.tracked.has(candidate)) ?? null;
  }

  private captureModuleClosure(path: string, seen: Set<string> = new Set()): void {
    if (seen.has(path)) return;
    seen.add(path);
    const source = this.bytes(path).toString("utf8");
    const specifiers = new Set<string>();
    const staticImport = /\b(?:import|export)\s+(?:type\s+)?(?:[^;"']*?\s+from\s*)?["']([^"']+)["']/g;
    const dynamicImport = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
    for (const matcher of [staticImport, dynamicImport]) {
      for (const match of source.matchAll(matcher)) specifiers.add(match[1]!);
    }
    for (const specifier of [...specifiers].sort()) {
      const imported = this.importedPath(path, specifier);
      if (imported) this.captureModuleClosure(imported, seen);
    }
  }

  async module<T extends Record<string, unknown>>(path: string): Promise<T> {
    this.captureModuleClosure(path);
    const url = pathToFileURL(this.absolute(path));
    url.searchParams.set("pdc-v2-frozen-sha", sha256(this.bytes(path)));
    return await import(url.href) as T;
  }

  async capture<T>(build: () => Promise<T> | T): Promise<{ readonly value: T; readonly fixtures: readonly TrustedLkgFixtureEvidence[] }> {
    if (this.capturePaths !== null) throw new Error("TRUSTED_LKG_NESTED_FIXTURE_CAPTURE");
    this.capturePaths = new Set();
    try {
      const value = await build();
      const fixtures = [...this.capturePaths].sort().map((path) => {
        // Re-read through the exact-blob check after builders/dynamic imports,
        // closing a mutation window between initial load and receipt creation.
        const bytes = this.bytes(path);
        return { path, sha256: sha256(bytes), bytes: bytes.byteLength };
      });
      if (fixtures.length === 0) throw new Error("TRUSTED_LKG_FIXTURE_CAPTURE_EMPTY");
      return { value, fixtures };
    } finally {
      this.capturePaths = null;
    }
  }
}

function exactInstant(value: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`TRUSTED_LKG_TIME_INVALID:${value}`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;
}

function latestInstant(value: unknown): string {
  const values: string[] = [];
  const walk = (item: unknown): void => {
    if (typeof item === "string" && Number.isFinite(Date.parse(item)) && /^(?:19|20)\d{2}-\d{2}-\d{2}/.test(item)) {
      values.push(item);
    } else if (Array.isArray(item)) {
      item.forEach(walk);
    } else if (item && typeof item === "object") {
      Object.values(item as Record<string, unknown>).forEach(walk);
    }
  };
  walk(value);
  if (values.length === 0) throw new Error("TRUSTED_LKG_SOURCE_THROUGH_MISSING");
  return values.sort((left, right) => Date.parse(left) - Date.parse(right)).at(-1)!;
}

function assertBuilderCandidate(
  candidate: RoutineCandidate,
  contractId: string,
  durableLegacyMeetingsTransfer: boolean = false,
): void {
  if (!candidate.retrieval.succeeded && !durableLegacyMeetingsTransfer) {
    throw new Error(`TRUSTED_LKG_BUILDER_RETRIEVAL_FAILED:${contractId}`);
  }
  if (!candidate.normalization.succeeded || candidate.normalization.missingRequiredFields.length > 0) {
    throw new Error(`TRUSTED_LKG_BUILDER_PARSE_FAILED:${contractId}:${candidate.normalization.missingRequiredFields.join(",")}`);
  }
  const semanticViolations = durableLegacyMeetingsTransfer
    ? candidate.semantics.violations.filter((violation) =>
        violation !== "No configured meeting source succeeded."
      )
    : candidate.semantics.violations;
  if (semanticViolations.length > 0) {
    throw new Error(`TRUSTED_LKG_BUILDER_SEMANTICS_FAILED:${contractId}:${semanticViolations.join(";")}`);
  }
  const failed = candidate.dependentChecks.filter((check) => !check.passed);
  if (candidate.dependentChecks.length === 0 || failed.length > 0) {
    throw new Error(`TRUSTED_LKG_BUILDER_READER_FAILED:${contractId}:${failed.map((check) => check.consumer).join(",")}`);
  }
}

function trustedCandidate(
  contractId: string,
  base: RoutineCandidate,
  fixtures: readonly TrustedLkgFixtureEvidence[],
  importedAt: string,
  importerCodeSha: string,
  legacyMeetingsPartition?: TrustedLkgLegacyMeetingsPartitionEvidence,
  pimaOutcomeUnion?: TrustedLkgPimaOutcomeUnionEvidence,
  predecessor?: CandidateVersionRecord,
): RoutineCandidate {
  if ((pimaOutcomeUnion === undefined) !== (predecessor === undefined)) {
    throw new Error(`TRUSTED_LKG_PIMA_OUTCOME_UNION_PREDECESSOR_MISSING:${contractId}`);
  }
  assertBuilderCandidate(base, contractId, legacyMeetingsPartition !== undefined);
  const readModel = structuredClone(base.readModel);
  const civicRecords = civicRecordsFor(base.recordClass, readModel);
  // Manual builders may report transient per-source holds while retaining the
  // same-value synthetic prior used only to exercise their ordinary parser.
  // Those are not frozen-record dispositions. The statement transfer is the
  // one plan that supplies deliberate, exact held originals.
  const excludedFacts = contractId === "officeholder-statements" || legacyMeetingsPartition
    ? structuredClone(base.excludedFacts ?? [])
    : [];
  if (civicRecords.length === 0) throw new Error(`TRUSTED_LKG_ZERO_RECORD_CANDIDATE_REFUSED:${contractId}`);
  const keys = civicRecords.map(({ key }) => key);
  if (new Set(keys).size !== keys.length || keys.some((key) => !key)) {
    throw new Error(`TRUSTED_LKG_CIVIC_RECORD_KEYS_INVALID:${contractId}`);
  }
  const fixtureSetSha256 = trustedLkgFixtureSetSha256(fixtures);
  const normalizedPayloadSha256 = sha256(canonicalCivicDataJson(readModel));
  const partial: RoutineCandidate = {
    ...base,
    id: "pending-trusted-lkg-content-address",
    retrieval: {
      succeeded: true,
      requestedUrl: trustedLkgImportUrl(contractId),
      finalUrl: null,
      httpStatus: null,
      retrievedAt: importedAt,
      rawHash: legacyMeetingsPartition?.legacyPointerSha256 ??
        pimaOutcomeUnion?.unionAuthoritySha256 ?? fixtureSetSha256,
    },
    normalization: {
      ...base.normalization,
      succeeded: true,
      normalizedHash: normalizedPayloadSha256,
      normalizedPayloadHash: normalizedPayloadSha256,
      inputRecords: civicRecords.length + excludedFacts.length,
      outputRecords: civicRecords.length,
      droppedRecords: excludedFacts.length,
      missingRequiredFields: [],
      failureDetail: undefined,
    },
    temporal: {
      ...base.temporal,
      expectedVersion: base.temporal.version,
      staleAtRetrieval: true,
    },
    semantics: legacyMeetingsPartition
      ? {
          ...base.semantics,
          violations: base.semantics.violations.filter((violation) =>
            violation !== "No configured meeting source succeeded."
          ),
        }
      : base.semantics,
    horizon: {
      kind: "OPEN_FACT_SET",
      query: legacyMeetingsPartition
        ? "Exact durable legacy aggregate partition; this split makes no new publisher-universe claim."
        : pimaOutcomeUnion
          ? "Exact frozen Pima outcome LKG unioned with one exact durable predecessor; this transfer makes no new publisher-universe claim."
        : "Exact frozen-base LKG members only; this non-source-authenticated transfer makes no current publisher-universe claim.",
      returnedRecords: civicRecords.length,
      declaredTotal: null,
      paginationComplete: false,
      claimsComplete: false,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    normalizedPayload: readModel,
    readModel,
    civicRecords,
    changeSet: undefined,
    removalEvidence: undefined,
    // A frozen record that cannot be bound to a permanent serving identity is
    // retained as exact held evidence. It is never silently discarded and it
    // cannot enter the Reader merely because this is an authority transfer.
    excludedFacts,
    bootstrapImport: undefined,
  };
  const evidence: TrustedLkgImportEvidence = {
    contractVersion: 1,
    kind: "TRUSTED_LKG_IMPORT",
    authorization: TRUSTED_LKG_IMPORT_AUTHORIZATION,
    purpose: TRUSTED_LKG_IMPORT_PURPOSE,
    sourceAuthenticated: false,
    contractId,
    sourceId: partial.sourceId,
    recordClass: partial.recordClass,
    scope: partial.scope,
    parserVersion: partial.normalization.parserVersion,
    sourceVersion: partial.temporal.version,
    sourceThrough: partial.temporal.sourceThrough,
    importedAt,
    frozenBaseSha: PDC_V2_FROZEN_BASE_SHA,
    importerCodeSha,
    fixtureSetSha256,
    fixtures,
    ...(legacyMeetingsPartition ? { legacyMeetingsPartition } : {}),
    ...(pimaOutcomeUnion ? { pimaOutcomeUnion } : {}),
    normalizedPayloadSha256,
    readModelSha256: sha256(canonicalCivicDataJson(readModel)),
    candidateEnvelopeSha256: trustedLkgCandidateEnvelopeSha256(partial),
    validatorIds: trustedLkgValidatorIds(partial),
  };
  const candidate: RoutineCandidate = {
    ...partial,
    id: trustedLkgCandidateId(evidence),
    bootstrapImport: evidence,
  };
  const preflight = {
    ...candidate,
    changeSet: candidateChangeSet(candidate, predecessor?.candidate.readModel ?? null),
  };
  const evidenceIssue = trustedLkgImportEvidenceIssue(preflight, predecessor ?? null);
  if (evidenceIssue !== null) throw new Error(`TRUSTED_LKG_EVIDENCE_INVALID:${contractId}:${evidenceIssue}`);
  const validation = validateRoutineCandidate(preflight, predecessor ?? null, importedAt);
  if (validation.state !== "VALIDATED" || validation.receipt.decision !== "GOOD") {
    const failed = validation.receipt.checks.find((check) => check.verdict !== "PASS");
    throw new Error(`TRUSTED_LKG_PREFLIGHT_FAILED:${contractId}:${failed?.code ?? validation.state}:${failed?.detail ?? "unknown"}`);
  }
  return candidate;
}

function sourceClassFor(contractId: string, url: string, record?: Record<string, unknown>): ManualSourceClass {
  if (contractId === "ballot-navigation") return "ELECTION_AUTHORITY";
  if (contractId === "candidate-profiles" || contractId === "candidate-corpus" || contractId === "campaign-sites") {
    return "CANDIDATE_CONTROLLED";
  }
  if (contractId === "officeholder-statements" && record?.kind === "CAMPAIGN_SITE") return "CANDIDATE_CONTROLLED";
  if (contractId === "venue-resolutions" && new URL(url).hostname.toLowerCase().endsWith("census.gov")) {
    return "REFERENCE_PUBLISHER";
  }
  return "OFFICIAL_PUBLISHER";
}

interface ExactSourceVersion {
  readonly url: string;
  readonly rawHash: string;
  readonly retrievedAt: string;
  readonly record?: Record<string, unknown>;
}

function exactSourceVersions(value: unknown): readonly ExactSourceVersion[] {
  const versions: ExactSourceVersion[] = [];
  const walk = (item: unknown): void => {
    if (Array.isArray(item)) {
      item.forEach(walk);
      return;
    }
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const url = typeof record.documentUrl === "string"
      ? record.documentUrl
      : typeof record.url === "string"
        ? record.url
        : null;
    const rawHash = typeof record.contentHash === "string"
      ? record.contentHash
      : typeof record.rawHash === "string"
        ? record.rawHash
        : null;
    const retrievedAt = typeof record.retrievedAt === "string" ? record.retrievedAt : null;
    if (url && /^https:\/\//.test(url) && rawHash && SHA256.test(rawHash) && retrievedAt && Number.isFinite(Date.parse(retrievedAt))) {
      versions.push({ url, rawHash, retrievedAt, record });
    }
    Object.values(record).forEach(walk);
  };
  walk(value);
  return versions;
}

/**
 * Builder-only source scaffolding. It is intentionally replaced by the
 * non-source-authenticated frozen-import envelope before persistence. Its
 * sole purpose is to run each contract's existing shape/semantic projection
 * builder against the exact frozen value instead of inventing an importer-
 * specific parser.
 */
function transientBuilderReceipt(
  contractId: string,
  payload: unknown,
  fixtures: readonly TrustedLkgFixtureEvidence[],
  importedAt: string,
): ManualSourceSetReceipt {
  const fixtureSetSha = trustedLkgFixtureSetSha256(fixtures);
  const sources = new Map<string, ManualSourceReview>();
  const add = (version: ExactSourceVersion): void => {
    const retrievedAt = exactInstant(version.retrievedAt);
    if (Date.parse(retrievedAt) > Date.parse(importedAt)) {
      throw new Error(`TRUSTED_LKG_FROZEN_SOURCE_TIME_AFTER_IMPORT:${contractId}:${version.url}:${retrievedAt}`);
    }
    const source: ManualSourceReview = {
      requestedUrl: version.url,
      finalUrl: version.url,
      publisher: "Frozen PDC-v2 builder-only projection evidence",
      sourceClass: sourceClassFor(contractId, version.url, version.record),
      retrievedAt,
      httpStatus: 200,
      rawHash: version.rawHash,
      reviewedEvidence: "Transient contract-builder shape input only; never persisted as source authentication.",
      reviewOutcome: "SUPPORTED",
    };
    const identity = `${source.finalUrl}\n${source.rawHash}`;
    const existing = sources.get(identity);
    if (existing && existing.retrievedAt !== source.retrievedAt) {
      throw new Error(`TRUSTED_LKG_TRANSIENT_SOURCE_VERSION_AMBIGUOUS:${contractId}:${identity}`);
    }
    sources.set(identity, source);
  };
  exactSourceVersions(payload).forEach(add);
  const coveredUrls = new Set([...sources.values()].flatMap((source) => [source.requestedUrl, source.finalUrl]));
  for (const url of [...directPositiveSourceUrls(payload)].sort()) {
    if (!coveredUrls.has(url)) add({ url, rawHash: fixtureSetSha, retrievedAt: importedAt });
  }
  if (sources.size === 0) {
    throw new Error(`TRUSTED_LKG_TRANSIENT_SOURCE_SET_EMPTY:${contractId}`);
  }
  return {
    contractVersion: 1,
    reviewedAt: importedAt,
    reviewedBy: "PDC_V2_TRUSTED_LKG_IMPORTER_BUILDER_ONLY",
    sources: [...sources.values()].sort((left, right) =>
      `${left.finalUrl}\n${left.rawHash}`.localeCompare(`${right.finalUrl}\n${right.rawHash}`)
    ),
  };
}

function manualCandidateFromPayload(
  contractId: ManualProjectionContractId,
  payload: ManualProjectionPayload,
  fixtures: readonly TrustedLkgFixtureEvidence[],
  importedAt: string,
  version: string,
  sourceThrough: string,
): RoutineCandidate {
  const sourceReceipt = transientBuilderReceipt(contractId, payload, fixtures, importedAt);
  const input: ManualProjectionPackage = {
    contractId,
    version,
    sourceThrough,
    sourceReceipt,
    payload,
  };
  // A same-value transient prior retains URL-less members through the normal
  // per-member isolation path. Neither the prior nor this synthetic receipt
  // survives trustedCandidate().
  return manualProjectionCandidate(input, {
    prior: { versionId: `builder-only:${contractId}`, payload, sourceReceipt },
  });
}

function partitionSnapshot(
  frozen: MeetingsSnapshot,
  partition: MeetingPartitionContract,
  durableLegacyMeetingsTransfer: boolean = false,
): MeetingsSnapshot {
  const meetings = frozen.meetings.filter((meeting) =>
    meeting.bodyId === partition.bodyId && meeting.id.startsWith(`${partition.meetingSource}:`)
  );
  const meetingIds = new Set(meetings.map(({ id }) => id));
  const agendaDocuments = frozen.agendaDocuments.filter((document) => meetingIds.has(document.meetingId));
  const carried = meetings.filter((meeting) => meeting.carried).length;
  const fresh = meetings.length - carried;
  const sourceReports = frozen.sources.filter(({ source }) => source === partition.meetingSource);
  const hasUnexplainedCarry = meetings.some(({ carried }) =>
    carried?.reason === "UNEXPLAINED_DISAPPEARANCE"
  );
  const frozenReport = sourceReports.find((report) =>
    hasUnexplainedCarry && report.ok && (report.unreachableOcdIds?.length ?? 0) === 0
  ) ?? sourceReports.find((report) =>
    fresh > 0 && report.ok && carried > 0 && partition.ocdId !== null &&
    report.unreachableOcdIds?.includes(partition.ocdId)
  ) ?? sourceReports.find((report) =>
    fresh > 0 && report.ok
  ) ?? sourceReports.find((report) =>
    carried > 0 && (
      !report.ok ||
      (partition.ocdId !== null && report.unreachableOcdIds?.includes(partition.ocdId))
    )
  ) ?? sourceReports[0];
  if (!frozenReport) throw new Error(`TRUSTED_LKG_MEETING_SOURCE_REPORT_MISSING:${partition.id}`);
  const relevantUnreachable = carried > 0 && !hasUnexplainedCarry && partition.ocdId &&
      frozenReport.unreachableOcdIds?.includes(partition.ocdId)
    ? [partition.ocdId]
    : undefined;
  const source: SnapshotSourceReport = {
    source: frozenReport.source,
    ok: frozenReport.ok,
    error: frozenReport.error,
    ...(frozenReport.failure ? { failure: frozenReport.failure } : {}),
    ...(frozenReport.walledAtRung !== undefined ? { walledAtRung: frozenReport.walledAtRung } : {}),
    ...(frozenReport.rungProvenance ? { rungProvenance: frozenReport.rungProvenance } : {}),
    fetched: fresh,
    normalized: fresh,
    drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
    ...(relevantUnreachable ? { unreachableOcdIds: relevantUnreachable } : {}),
    ...(carried > 0 ? { carriedForward: carried } : {}),
  };
  const value: MeetingsSnapshot = {
    formatVersion: 1,
    generatedAt: frozen.generatedAt,
    counts: { fresh, duplicatesCollapsed: 0, carried, total: meetings.length },
    sources: [source],
    meetings,
    agendaDocuments,
  };
  if (meetings.length > 0) {
    validateSnapshot(value, {
      allowAllSourcesFailedForDurableTransfer: durableLegacyMeetingsTransfer,
    });
  }
  return value;
}

function rollAcquisitionUrl(vote: VotesSnapshot["votes"][number]): string {
  if (vote.chamber === "house") {
    const year = 1787 + (vote.congress * 2) + vote.session - 1;
    return `https://clerk.house.gov/evs/${year}/roll${String(vote.rollNumber).padStart(3, "0")}.xml`;
  }
  return `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${vote.congress}${vote.session}/vote_${vote.congress}_${vote.session}_${String(vote.rollNumber).padStart(5, "0")}.xml`;
}

function exactOfficialCandidacyBridge(
  legacy: {
    readonly formatVersion: 1;
    readonly rule: "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE";
    readonly rows: readonly {
      readonly holder: {
        readonly id: string;
        readonly name: string;
        readonly officeTitle: string;
        readonly divisions: readonly string[];
        readonly sourcePath: string;
        readonly sourceUrl: string | null;
      };
      readonly status: "RESOLVED" | "NO_APPLICABLE_CANDIDACY" | "IDENTITY_UNRESOLVED";
      readonly candidacy: ({
        readonly candidacyId: string;
        readonly contestId: string;
        readonly contestTitle: string;
        readonly divisionId: string;
        readonly electionId: string;
        readonly candidateName: string;
        readonly sourceUrl: string;
        readonly sourcePath?: string;
      }) | null;
      readonly reason: string;
      readonly unresolvedCandidacyIds: readonly string[];
    }[];
  },
): OfficialCandidacyBridge {
  const authorityForPath = (path: string): OfficialCandidacyBridge["rows"][number]["holder"]["authority"] => {
    if (path === "lib/registry/officeholders-us.json") return "FEDERAL_DIRECTORY";
    if (path === "lib/officials/statewide-executives.ts") return "REGISTRY_STATEWIDE_EXECUTIVE";
    if (path === "lib/registry/body-rosters.ts") return "REGISTRY_BODY_ROSTER";
    throw new Error(`TRUSTED_LKG_OFFICIAL_CANDIDACY_AUTHORITY_UNSUPPORTED:${path}`);
  };
  return {
    formatVersion: legacy.formatVersion,
    rule: legacy.rule,
    // The legacy file also contained the three whole-state officeholder
    // snapshots. Those are superseded inputs, not the authoritative runtime
    // holders: they duplicate and disagree with the exact BODY_ROSTERS set.
    // Keep only the federal directory, curated body rosters, and statewide
    // executive authorities—the current contract's three registered inputs.
    rows: legacy.rows.filter((row) => [
      "lib/registry/officeholders-us.json",
      "lib/registry/body-rosters.ts",
      "lib/officials/statewide-executives.ts",
    ].includes(row.holder.sourcePath)).map((row) => ({
      holder: {
        id: row.holder.id,
        name: row.holder.name,
        officeTitle: row.holder.officeTitle,
        divisions: row.holder.divisions,
        authority: authorityForPath(row.holder.sourcePath),
        sourceUrl: row.holder.sourceUrl,
      },
      status: row.status,
      candidacy: row.candidacy ? {
        candidacyId: row.candidacy.candidacyId,
        contestId: row.candidacy.contestId,
        contestTitle: row.candidacy.contestTitle,
        divisionId: row.candidacy.divisionId,
        electionId: row.candidacy.electionId,
        candidateName: row.candidacy.candidateName,
        sourceUrl: row.candidacy.sourceUrl,
      } : null,
      reason: row.reason,
      unresolvedCandidacyIds: row.unresolvedCandidacyIds,
    })),
  };
}

function verifyDeclaredLegacyOfficialCandidacySources(
  tree: FrozenTree,
  legacy: LegacyOfficialCandidaciesFile,
): void {
  for (const source of legacy.sources) {
    const bytes = tree.bytes(source.path);
    const actual = sha256(bytes);
    if (actual !== source.sha256) {
      throw new Error(`TRUSTED_LKG_DECLARED_FIXTURE_HASH_MISMATCH:${source.path}:${source.sha256}:${actual}`);
    }
  }
}

async function registrySeed(
  tree: FrozenTree,
  importedAt: string,
): Promise<{ readonly candidate: RoutineCandidate; readonly fixtures: readonly TrustedLkgFixtureEvidence[] }> {
  const captured = await tree.capture(async () => {
    const registry = tree.json<Registry>("lib/registry/registry.json");
    const promoted = tree.json<{ readonly bodies?: readonly Body[] }>("lib/registry/promoted-bodies.json");
    const officialPhotos = tree.json<RegistryRuntimeReadModel["officialPhotos"]>("lib/registry/official-photos.json");
    const rosterPhotos = tree.json<RegistryRuntimeReadModel["rosterPhotos"]>("lib/registry/roster-photos.json");
    const legacy = tree.json<LegacyOfficialCandidaciesFile>("lib/funding/official-candidacies.json");
    verifyDeclaredLegacyOfficialCandidacySources(tree, legacy);
    const rostersModule = await tree.module<{
      readonly BODY_ROSTERS: RegistryRuntimeReadModel["bodyRosters"];
      readonly ROSTER_READER_DISPOSITIONS: RegistryRuntimeReadModel["rosterReaderDispositions"];
    }>("lib/registry/body-rosters.ts");
    const executivesModule = await tree.module<{
      readonly STATEWIDE_EXECUTIVES: RegistryRuntimeReadModel["statewideExecutives"];
    }>("lib/officials/statewide-executives.ts");
    const held = new Set(registry.bodies.map((body) => body.id));
    const payload: RegistryRuntimeReadModel = {
      formatVersion: 1,
      registry: {
        ...registry,
        bodies: [
          ...registry.bodies,
          ...(promoted.bodies ?? []).filter((body) => !held.has(body.id)),
        ],
      },
      bodyRosters: structuredClone(rostersModule.BODY_ROSTERS),
      rosterReaderDispositions: structuredClone(rostersModule.ROSTER_READER_DISPOSITIONS),
      statewideExecutives: structuredClone(executivesModule.STATEWIDE_EXECUTIVES),
      officialCandidacies: exactOfficialCandidacyBridge(legacy),
      officialPhotos,
      rosterPhotos,
    };
    return payload;
  });
  const payload = captured.value;
  const sourceReceipt = transientBuilderReceipt("registry-runtime-bindings", payload, captured.fixtures, importedAt);
  const version = registryVersion(payload.registry.generatedAt);
  const base = registryRuntimeCandidate({
    contractId: "registry-runtime-bindings",
    version,
    sourceThrough: exactInstant(latestInstant(payload)),
    sourceReceipt,
    payload,
  }, {
    prior: {
      versionId: "builder-only:registry-runtime-bindings",
      payload,
      sourceReceipt,
    },
  });
  return { candidate: base, fixtures: captured.fixtures };
}

function registryVersion(value: string): string {
  return value || (() => { throw new Error("TRUSTED_LKG_REGISTRY_VERSION_MISSING"); })();
}

async function rollCallsSeed(
  tree: FrozenTree,
  importedAt: string,
): Promise<{ readonly candidate: RoutineCandidate; readonly fixtures: readonly TrustedLkgFixtureEvidence[] }> {
  const captured = await tree.capture(() => {
    const snapshotBytes = tree.bytes("data/votes/votes-snapshot.json");
    const snapshot = JSON.parse(snapshotBytes.toString("utf8")) as VotesSnapshot;
    const billSummaries = tree.json<BillSummariesFile>("data/votes/bill-summaries.json");
    return { snapshotBytes, snapshot, billSummaries };
  });
  const acquisitions: OfficialAcquisition[] = captured.value.snapshot.votes.map((vote) => {
    const url = rollAcquisitionUrl(vote);
    return { requestedUrl: url, finalUrl: url, httpStatus: 200, body: captured.value.snapshotBytes.toString("utf8") };
  });
  return {
    fixtures: captured.fixtures,
    candidate: federalRollCallsCandidate({
      acquisitions,
      retrievedAt: importedAt,
      expectedCongress: captured.value.snapshot.congress,
      expectedSession: captured.value.snapshot.session,
      snapshot: captured.value.snapshot,
      billSummaries: captured.value.billSummaries,
    }),
  };
}

async function keyVotesSeed(
  tree: FrozenTree,
  importedAt: string,
): Promise<{ readonly candidate: RoutineCandidate; readonly fixtures: readonly TrustedLkgFixtureEvidence[] }> {
  const captured = await tree.capture(() => {
    const snapshot = tree.json<FederalKeyVotesSnapshot>("data/votes/key-votes-snapshot.json");
    const positionsBytes = tree.bytes("data/votes/key-vote-positions.json");
    const positions = JSON.parse(positionsBytes.toString("utf8")) as FederalKeyVotePositions;
    const rawLawTitles = tree.json<unknown>("data/votes/law-titles-cache.json");
    if (!rawLawTitles || typeof rawLawTitles !== "object" || Array.isArray(rawLawTitles)) {
      throw new Error("TRUSTED_LKG_LAW_TITLE_CACHE_SHAPE_INVALID");
    }
    const rawLawTitleEntries = Object.entries(rawLawTitles);
    if (rawLawTitleEntries.some(([bill, titles]) =>
      !bill || !Array.isArray(titles) || titles.length === 0 ||
      titles.some((title) => typeof title !== "string" || !title.trim())
    )) {
      throw new Error("TRUSTED_LKG_LAW_TITLE_CACHE_SHAPE_INVALID");
    }
    const lawTitles = rawLawTitles as Record<string, readonly string[]>;
    const lawTitleEntries = Object.entries(lawTitles);
    const lawTitleRows = lawTitleEntries.flatMap(([, titles]) => titles);
    const expected = PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS;
    if (
      lawTitleEntries.length !== expected.frozenLawTitleBills ||
      lawTitleRows.length !== expected.frozenLawTitleRows ||
      new Set(lawTitleRows).size !== expected.frozenLawTitleUniqueValues
    ) {
      throw new Error(
        `TRUSTED_LKG_LAW_TITLE_CACHE_DENOMINATOR_MISMATCH:` +
        `${lawTitleEntries.length}/${lawTitleRows.length}/${new Set(lawTitleRows).size}`,
      );
    }
    // This retired cache was resolver working state, not a Reader payload.
    // Its exact bytes remain derivation evidence on the trusted receipt; the
    // serving title/question/roll facts remain in the snapshot below.
    return { snapshot: hydrateFederalKeyVoteBootstrapV1(snapshot), positionsBytes, positions };
  });
  const rollReferences = captured.value.snapshot.entries.flatMap((entry) => [...entry.house, ...entry.senate]);
  const expected = PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS;
  if (
    captured.value.snapshot.entries.length !== expected.federalKeyVoteQuestions ||
    rollReferences.length !== expected.federalKeyVoteRollReferences ||
    Object.keys(captured.value.positions.positions).length !== expected.federalKeyVotePositionMaps ||
    captured.value.snapshot.misses.length !== expected.federalKeyVoteSelectionMisses ||
    (captured.value.snapshot.lawMisses?.length ?? 0) !== expected.federalKeyVoteLawMisses ||
    Object.keys(captured.value.positions.retiredMappings ?? {}).length !== expected.federalKeyVoteRetiredPositionMaps
  ) {
    throw new Error(
      `TRUSTED_LKG_KEY_VOTE_DENOMINATOR_MISMATCH:` +
      `${captured.value.snapshot.entries.length}/${rollReferences.length}/${Object.keys(captured.value.positions.positions).length}/` +
      `${captured.value.snapshot.misses.length}/${captured.value.snapshot.lawMisses?.length ?? 0}/` +
      `${Object.keys(captured.value.positions.retiredMappings ?? {}).length}`,
    );
  }
  const acquisitions: OfficialAcquisition[] = captured.value.snapshot.entries.flatMap((entry) => [
    ...entry.house,
    ...entry.senate,
  ]).map((ref) => {
    if (!ref.url) throw new Error("TRUSTED_LKG_KEY_VOTE_OFFICIAL_URL_MISSING");
    return {
      requestedUrl: ref.url,
      finalUrl: ref.url,
      httpStatus: 200,
      body: captured.value.positionsBytes.toString("utf8"),
    };
  });
  return {
    fixtures: captured.fixtures,
    candidate: federalKeyVotesCandidate({
      acquisitions,
      retrievedAt: importedAt,
      snapshot: captured.value.snapshot,
      positions: captured.value.positions,
    }),
  };
}

async function profilesSeed(
  tree: FrozenTree,
  importedAt: string,
): Promise<{ readonly candidate: RoutineCandidate; readonly fixtures: readonly TrustedLkgFixtureEvidence[] }> {
  const captured = await tree.capture(() => ({
    cards: tree.json<CandidateProfilesProjection["cards"]>("data/ballot/candidate-cards-2026.json"),
    links: tree.json<CandidateProfilesProjection["links"]>("data/ballot/candidate-links-2026.json"),
  }));
  const sourceThrough = exactInstant(latestInstant(captured.value));
  return {
    fixtures: captured.fixtures,
    candidate: manualCandidateFromPayload("candidate-profiles", captured.value, captured.fixtures, importedAt, sourceThrough, sourceThrough),
  };
}

async function corpusSeed(
  tree: FrozenTree,
  importedAt: string,
): Promise<{ readonly candidate: RoutineCandidate; readonly fixtures: readonly TrustedLkgFixtureEvidence[] }> {
  const captured = await tree.capture(() => tree.json<CandidateCorpus>("data/candidates/corpus-2026.json"));
  const sourceThrough = exactInstant(captured.value.fetchedAt);
  return {
    fixtures: captured.fixtures,
    candidate: manualCandidateFromPayload("candidate-corpus", captured.value, captured.fixtures, importedAt, sourceThrough, sourceThrough),
  };
}

async function statementsSeed(
  tree: FrozenTree,
  importedAt: string,
): Promise<{ readonly candidate: RoutineCandidate; readonly fixtures: readonly TrustedLkgFixtureEvidence[] }> {
  const captured = await tree.capture(() => {
    const frozen = tree.json<StatementCorpus>("data/corpus/statements.json");
    const legacy = tree.json<LegacyOfficialCandidaciesFile>("lib/funding/official-candidacies.json");
    // This receipt binds the exact reviewed bridge file and the exact corpus.
    // The registry-runtime candidate separately verifies and binds every
    // source hash declared by that same bridge; re-reading its large complete
    // source closure for each statement-plan rebuild adds no distinct proof.
    return transferFrozenStatementIdentities(frozen, legacy);
  });
  const sourceThrough = exactInstant(latestInstant(captured.value));
  const expected = PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS;
  const frozenCount = captured.value.corpus.snapshots.length + captured.value.excludedFacts.length;
  if (
    frozenCount !== expected.frozenOfficeholderStatementSnapshots ||
    captured.value.corpus.snapshots.length !== expected.promotedOfficeholderStatementSnapshots ||
    captured.value.rekeyed.length !== expected.rekeyedOfficeholderStatementSnapshots ||
    captured.value.excludedFacts.length !== expected.heldOfficeholderStatementSnapshots
  ) {
    throw new Error(
      `TRUSTED_LKG_STATEMENT_DENOMINATOR_MISMATCH:` +
      `${frozenCount}/${captured.value.corpus.snapshots.length}/${captured.value.rekeyed.length}/${captured.value.excludedFacts.length}`,
    );
  }
  const base = manualCandidateFromPayload(
    "officeholder-statements",
    captured.value.corpus,
    captured.fixtures,
    importedAt,
    sourceThrough,
    sourceThrough,
  );
  return {
    fixtures: captured.fixtures,
    candidate: {
      ...base,
      normalization: {
        ...base.normalization,
        inputRecords: frozenCount,
        outputRecords: captured.value.corpus.snapshots.length,
        droppedRecords: captured.value.excludedFacts.length,
      },
      excludedFacts: captured.value.excludedFacts,
    },
  };
}

async function actionsSeed(
  tree: FrozenTree,
  importedAt: string,
): Promise<{ readonly candidate: RoutineCandidate; readonly fixtures: readonly TrustedLkgFixtureEvidence[] }> {
  const captured = await tree.capture(() => tree.json<ExecutiveActionStore>("data/states/az/officials/az-governor-actions.json"));
  const sourceThrough = exactInstant(latestInstant(captured.value));
  const sourceReceipt = transientBuilderReceipt("az-official-actions", captured.value, captured.fixtures, importedAt);
  return {
    fixtures: captured.fixtures,
    candidate: azOfficialActionsCandidate({
      store: captured.value,
      sourceReceipt,
      retrievedAt: importedAt,
      sourceThrough,
      prior: {
        versionId: "builder-only:az-official-actions",
        store: captured.value,
        sourceReceipt,
      },
    }),
  };
}

const PDC_V2_PIMA_OUTCOME_FIXTURE_PATH = "data/states/az/outcomes/legistar-outcomes.json";

function assertPimaOutcomeSnapshot(snapshot: OutcomeSnapshot, label: string): void {
  if (
    !Number.isFinite(Date.parse(snapshot.generatedAt)) ||
    snapshot.tenants.length !== 1 || snapshot.tenants[0] !== "pima" ||
    snapshot.sittings.length === 0 ||
    snapshot.sittings.some((sitting) =>
      sitting.slug !== "pima" ||
      sitting.meetingId !== `legistar:pima:${sitting.eventId}` ||
      sitting.extraction !== "RETRIEVED" ||
      sitting.voteRequestFailures.length > 0
    ) ||
    new Set(snapshot.sittings.map(({ meetingId }) => meetingId)).size !== snapshot.sittings.length
  ) throw new Error(`TRUSTED_LKG_PIMA_OUTCOME_SNAPSHOT_INVALID:${label}`);
}

async function outcomesSeed(
  tree: FrozenTree,
  importedAt: string,
): Promise<{ readonly candidate: RoutineCandidate; readonly fixtures: readonly TrustedLkgFixtureEvidence[] }> {
  const captured = await tree.capture(() => {
    const bytes = tree.bytes(PDC_V2_PIMA_OUTCOME_FIXTURE_PATH);
    const snapshot = JSON.parse(bytes.toString("utf8")) as OutcomeSnapshot;
    assertPimaOutcomeSnapshot(snapshot, "FROZEN");
    if (snapshot.sittings.length !== PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.pimaOutcomeSittings) {
      throw new Error(`TRUSTED_LKG_PIMA_OUTCOME_DENOMINATOR_MISMATCH:${snapshot.sittings.length}`);
    }
    return { bytes, snapshot };
  });
  const sourceThrough = exactInstant(latestInstant(captured.value.snapshot));
  const url = "https://webapi.legistar.com/v1/pima/events";
  const acquisitions: readonly SourceAcquisitionEvidence[] = [{
    source: "pima",
    requestedUrl: url,
    finalUrl: url,
    httpStatus: 200,
    rawHash: sha256(captured.value.bytes),
    byteCount: captured.value.bytes.byteLength,
  }];
  return {
    fixtures: captured.fixtures,
    candidate: pimaLegistarOutcomesCandidate({
      snapshot: captured.value.snapshot,
      acquisitions,
      retrievedAt: importedAt,
      sourceThrough,
    }),
  };
}

function pimaOutcomeSittingSha256(sitting: PersistedSittingOutcomes): string {
  return sha256(canonicalCivicDataJson(sitting));
}

/**
 * Preserve both exact authorities. A duplicate id is accepted only when its
 * complete sitting payload is byte-semantically identical; an apparent newer
 * value may never overwrite a different frozen fact during this one-time move.
 */
export function pdcV2UnionPimaOutcomeSnapshots(
  frozen: OutcomeSnapshot,
  predecessor: OutcomeSnapshot,
): OutcomeSnapshot {
  assertPimaOutcomeSnapshot(frozen, "FROZEN_UNION_INPUT");
  assertPimaOutcomeSnapshot(predecessor, "DURABLE_UNION_INPUT");
  const byId = new Map<string, PersistedSittingOutcomes>();
  for (const sitting of frozen.sittings) byId.set(sitting.meetingId, structuredClone(sitting));
  for (const sitting of predecessor.sittings) {
    const held = byId.get(sitting.meetingId);
    if (held && canonicalCivicDataJson(held) !== canonicalCivicDataJson(sitting)) {
      throw new Error(`TRUSTED_LKG_PIMA_OUTCOME_SAME_ID_CONFLICT:${sitting.meetingId}`);
    }
    if (!held) byId.set(sitting.meetingId, structuredClone(sitting));
  }
  const newest = Date.parse(predecessor.generatedAt) >= Date.parse(frozen.generatedAt)
    ? predecessor
    : frozen;
  return {
    generatedOn: newest.generatedOn,
    generatedAt: newest.generatedAt,
    tenants: ["pima"],
    sittings: [...byId.values()].sort((left, right) => left.meetingId.localeCompare(right.meetingId)),
  };
}

function pimaOutcomeUnionEvidence(
  frozen: OutcomeSnapshot,
  union: OutcomeSnapshot,
  fixtures: readonly TrustedLkgFixtureEvidence[],
  pointer: PromotedProjection<OutcomeSnapshot>,
  predecessor: CandidateVersionRecord,
): TrustedLkgPimaOutcomeUnionEvidence {
  const frozenSittings = [...frozen.sittings]
    .sort((left, right) => left.meetingId.localeCompare(right.meetingId))
    .map((sitting) => ({ meetingId: sitting.meetingId, sha256: pimaOutcomeSittingSha256(sitting) }));
  const predecessorPointerSha256 = trustedLkgPredecessorPointerSha256(pointer);
  return {
    contractVersion: 1,
    kind: "DURABLE_PIMA_OUTCOME_UNION",
    predecessorVersionId: predecessor.candidate.id,
    predecessorPromotedAt: pointer.promotedAt,
    predecessorPointerSha256,
    predecessorCandidateRecordSha256: trustedLkgPredecessorRecordSha256(predecessor),
    predecessorCandidateSha256: trustedLkgEvidenceSha256(predecessor.candidate),
    predecessorReceiptSha256: trustedLkgEvidenceSha256(predecessor.receipt),
    predecessorReadModelSha256: trustedLkgEvidenceSha256(predecessor.candidate.readModel),
    frozenGeneratedOn: frozen.generatedOn,
    frozenGeneratedAt: frozen.generatedAt,
    frozenSittings,
    predecessorSittingCount: (predecessor.candidate.readModel as OutcomeSnapshot).sittings.length,
    unionSittingCount: union.sittings.length,
    unionAuthoritySha256: sha256(canonicalCivicDataJson({
      fixtureSetSha256: trustedLkgFixtureSetSha256(fixtures),
      predecessorPointerSha256,
      frozenGeneratedOn: frozen.generatedOn,
      frozenGeneratedAt: frozen.generatedAt,
      frozenSittings,
    })),
  };
}

function pdcV2PimaOutcomeUnionCandidate(
  planned: PdcV2TrustedLkgPlannedCandidate,
  pointer: PromotedProjection<OutcomeSnapshot>,
  predecessor: CandidateVersionRecord,
  importedAt: string,
  importerCodeSha: string,
): RoutineCandidate {
  if (
    planned.contractId !== "pima-legistar-outcomes" ||
    planned.door !== "MANUAL" ||
    predecessor.candidate.id !== pointer.versionId ||
    canonicalCivicDataJson(pointer.payload) !== canonicalCivicDataJson(predecessor.candidate.readModel)
  ) throw new Error("TRUSTED_LKG_PIMA_OUTCOME_UNION_ORIGIN_INVALID");
  const frozenEvidence = planned.candidate.bootstrapImport;
  if (
    !frozenEvidence || frozenEvidence.kind !== "TRUSTED_LKG_IMPORT" ||
    frozenEvidence.pimaOutcomeUnion !== undefined ||
    frozenEvidence.fixtures.length !== 1 ||
    frozenEvidence.fixtures[0]?.path !== PDC_V2_PIMA_OUTCOME_FIXTURE_PATH
  ) throw new Error("TRUSTED_LKG_PIMA_OUTCOME_FROZEN_EVIDENCE_INVALID");
  const frozen = structuredClone(planned.candidate.readModel) as OutcomeSnapshot;
  assertPimaOutcomeSnapshot(frozen, "PLANNED_FROZEN");
  if (frozen.sittings.length !== PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.pimaOutcomeSittings) {
    throw new Error(`TRUSTED_LKG_PIMA_OUTCOME_DENOMINATOR_MISMATCH:${frozen.sittings.length}`);
  }
  const durable = structuredClone(pointer.payload);
  const union = pdcV2UnionPimaOutcomeSnapshots(frozen, durable);
  const origin = pimaOutcomeUnionEvidence(
    frozen,
    union,
    frozenEvidence.fixtures,
    pointer,
    predecessor,
  );
  const url = "https://webapi.legistar.com/v1/pima/events";
  const base = pimaLegistarOutcomesCandidate({
    snapshot: union,
    acquisitions: [{
      source: "pima",
      requestedUrl: url,
      finalUrl: url,
      httpStatus: 200,
      rawHash: origin.unionAuthoritySha256,
      byteCount: frozenEvidence.fixtures.reduce((sum, fixture) => sum + fixture.bytes, 0),
    }],
    retrievedAt: importedAt,
    sourceThrough: exactInstant(latestInstant(union)),
  });
  return trustedCandidate(
    planned.contractId,
    base,
    frozenEvidence.fixtures,
    importedAt,
    importerCodeSha,
    undefined,
    origin,
    predecessor,
  );
}

async function curatedSeed(
  tree: FrozenTree,
  contractId: "comment-access" | "ballot-navigation" | "campaign-sites" | "venue-resolutions",
  importedAt: string,
): Promise<{ readonly candidate: RoutineCandidate; readonly fixtures: readonly TrustedLkgFixtureEvidence[] }> {
  const captured = await tree.capture(async (): Promise<CuratedReaderProjection> => {
    if (contractId === "comment-access") {
      const frozenModule = await tree.module<{ readonly COMMENT_ACCESS: readonly Record<string, unknown>[] }>("lib/registry/comment-access.ts");
      return {
        kind: contractId,
        records: frozenModule.COMMENT_ACCESS.map((value) => ({ id: `comment-access:${String(value.bodyId)}`, ...structuredClone(value) })),
      };
    }
    if (contractId === "ballot-navigation") {
      const polling = await tree.module<{ readonly POLLING_PLACE_LINKS: readonly Record<string, unknown>[] }>("lib/ballot/polling-place-links.ts");
      const registration = await tree.module<{ readonly REGISTRATION_LINKS: readonly Record<string, unknown>[] }>("lib/ballot/registration-links.ts");
      return {
        kind: contractId,
        records: [
          ...polling.POLLING_PLACE_LINKS.map((value) => ({
            id: `polling-place:${String(value.state)}`,
            kind: "POLLING_PLACE_LINK",
            value: structuredClone(value),
          })),
          ...registration.REGISTRATION_LINKS.map((value) => ({
            id: `registration:${String(value.state)}`,
            kind: "REGISTRATION_LINK",
            value: structuredClone(value),
          })),
        ].sort((left, right) => left.id.localeCompare(right.id)),
      };
    }
    if (contractId === "campaign-sites") {
      const frozenModule = await tree.module<{ readonly CAMPAIGN_SITES: Readonly<Record<string, Readonly<Record<string, unknown>>>> }>("lib/officials/campaign-sites.ts");
      return {
        kind: contractId,
        records: Object.entries(frozenModule.CAMPAIGN_SITES)
          .filter(([officeholderId]) => officeholderIdentityMayEnterReader(officeholderId, null))
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([officeholderId, site]) => ({
            id: `campaign-site:${officeholderId}`,
            officeholderId,
            site: structuredClone(site),
          })),
      };
    }
    const frozenModule = await tree.module<{
      readonly VENUE_CACHE: readonly Record<string, unknown>[];
      readonly venueScope: (bodyOcdId: string | null, tenant: string | null) => string;
      readonly venueKey: (value: string) => string;
    }>("lib/meetings/venue-cache.ts");
    return {
      kind: contractId,
      records: frozenModule.VENUE_CACHE.map((value) => {
        const match = String(value.match);
        return {
          // Lookup normalization is deliberately coarser than durable record
          // identity. Preserve every exact frozen spelling even when two raw
          // strings normalize to the same lookup key.
          id: `venue:${String(value.sourceId)}:${frozenModule.venueScope(
            typeof value.bodyOcdId === "string" ? value.bodyOcdId : null,
            typeof value.tenant === "string" ? value.tenant : null,
          )}:${frozenModule.venueKey(match)}:${exactVenueMatchContentKey(match)}`,
          ...structuredClone(value),
        };
      }),
    };
  });
  const sourceThrough = exactInstant(latestInstant(captured.value));
  return {
    fixtures: captured.fixtures,
    candidate: manualCandidateFromPayload(contractId, captured.value, captured.fixtures, importedAt, sourceThrough, sourceThrough),
  };
}

interface FrozenEverydayMiss {
  readonly topicId: string;
  readonly zip: string;
  readonly reason: string;
}

/**
 * fc67 recorded every missing cell and its reviewed rung in prose, before the
 * permanent projection made UNKNOWN/CONTACT_OWED and its evidence URL typed.
 * This exact migration table is importer-code evidence: it may enrich those
 * six already-recorded gaps, but it cannot create a contact or an absence.
 */
const PDC_V2_FROZEN_EVERYDAY_MISS_EVIDENCE = {
  "snow-removal|85701": "https://www.tucsonaz.gov/Departments/Transportation-Mobility/Street-Maintenance",
  "snow-removal|85641": "https://www.pima.gov/1012/Service-Request",
  "trash-recycling|85641": "https://www.pima.gov/1012/Service-Request",
  "parks|85641": "https://www.pima.gov/1193/",
  "water-sewer|03255": "https://www.newbury.nh.gov/departments",
  "animals|03255": "https://www.newbury.nh.gov/departments",
} as const;

function everydayFrozenTransferIssue(projection: EverydayRoutingProjection): string | null {
  const expected = PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS;
  const denominator = projection.denominator;
  if (
    denominator.topics !== expected.everydayRoutingTopics ||
    denominator.zips !== expected.everydayRoutingZips ||
    denominator.cells !== expected.everydayRoutingCells ||
    denominator.contactAvailableCells !== expected.everydayRoutingContactAvailableCells ||
    denominator.unknownContactOwedCells !== expected.everydayRoutingContactOwedCells ||
    denominator.contactRecords !== expected.everydayRoutingContactRecords ||
    denominator.contactSources !== expected.everydayRoutingContactSources ||
    projection.records.length !==
      expected.everydayRoutingContactRecords + expected.everydayRoutingContactOwedCells
  ) {
    return `topics=${denominator.topics}:zips=${denominator.zips}:cells=${denominator.cells}:` +
      `available=${denominator.contactAvailableCells}:owed=${denominator.unknownContactOwedCells}:` +
      `contacts=${denominator.contactRecords}:sources=${denominator.contactSources}:records=${projection.records.length}`;
  }
  return null;
}

async function everydaySeed(
  tree: FrozenTree,
  importedAt: string,
): Promise<{ readonly candidate: RoutineCandidate; readonly fixtures: readonly TrustedLkgFixtureEvidence[] }> {
  const captured = await tree.capture(async (): Promise<EverydayRoutingProjection> => {
    const frozen = await tree.module<{
      readonly EVERYDAY_CONTACTS: readonly EverydayContact[];
      readonly EVERYDAY_MISSES: readonly FrozenEverydayMiss[];
    }>("lib/routing/everyday.ts");
    const seenMisses = new Set<string>();
    const misses = frozen.EVERYDAY_MISSES.map((miss): EverydayMiss => {
      const key = `${miss.topicId}|${miss.zip}`;
      const evidenceSourceUrl = PDC_V2_FROZEN_EVERYDAY_MISS_EVIDENCE[
        key as keyof typeof PDC_V2_FROZEN_EVERYDAY_MISS_EVIDENCE
      ];
      if (!evidenceSourceUrl || seenMisses.has(key)) {
        throw new Error(`TRUSTED_LKG_EVERYDAY_CONTACT_OWED_UNMAPPED_OR_DUPLICATED:${key}`);
      }
      seenMisses.add(key);
      return {
        ...structuredClone(miss),
        disposition: "UNKNOWN",
        holdingStatus: "CONTACT_OWED",
        evidenceSourceUrl,
        reviewedAt: "2026-08-14",
      };
    });
    const expectedMisses = Object.keys(PDC_V2_FROZEN_EVERYDAY_MISS_EVIDENCE).sort();
    if (canonicalCivicDataJson([...seenMisses].sort()) !== canonicalCivicDataJson(expectedMisses)) {
      throw new Error(`TRUSTED_LKG_EVERYDAY_CONTACT_OWED_DENOMINATOR_MISMATCH:${[...seenMisses].sort().join(",")}`);
    }
    const projection = buildEverydayRoutingProjection(
      structuredClone(frozen.EVERYDAY_CONTACTS),
      misses,
    );
    const issue = everydayFrozenTransferIssue(projection);
    if (issue !== null) throw new Error(`TRUSTED_LKG_EVERYDAY_DENOMINATOR_MISMATCH:${issue}`);
    return projection;
  });
  const sourceThrough = exactInstant(latestInstant(captured.value));
  return {
    fixtures: captured.fixtures,
    candidate: manualCandidateFromPayload(
      "everyday-routing",
      captured.value,
      captured.fixtures,
      importedAt,
      sourceThrough,
      sourceThrough,
    ),
  };
}

export interface PdcV2TrustedLkgPlannedCandidate {
  readonly contractId: string;
  readonly door: "MEETING_PARTITION" | "MANUAL";
  readonly candidate: RoutineCandidate;
}

export interface PdcV2TrustedLkgImportPlan {
  readonly contractVersion: 1;
  readonly frozenBaseSha: typeof PDC_V2_FROZEN_BASE_SHA;
  readonly frozenRoot: string;
  readonly importerCodeSha: string;
  readonly importedAt: string;
  readonly candidates: readonly PdcV2TrustedLkgPlannedCandidate[];
  readonly meetingPartitionIdsWithLkg: readonly string[];
  readonly meetingPartitionIdsWithoutLkg: readonly string[];
  readonly meetingRows: number;
  readonly agendaDocumentRows: number;
  readonly manualContractIds: readonly (typeof PDC_V2_TRUSTED_LKG_MANUAL_CONTRACT_IDS)[number][];
}

export interface BuildPdcV2TrustedLkgImportPlanOptions {
  readonly frozenRoot: string;
  readonly importerCodeSha: string;
  readonly importedAt: string;
  /** Current importer facts let the plan reject a same-worktree frozen root. */
  readonly importerRepositoryFacts?: TrustedLkgRepositoryFacts;
}

async function manualSeed(
  tree: FrozenTree,
  contractId: (typeof PDC_V2_TRUSTED_LKG_MANUAL_CONTRACT_IDS)[number],
  importedAt: string,
): Promise<{ readonly candidate: RoutineCandidate; readonly fixtures: readonly TrustedLkgFixtureEvidence[] }> {
  switch (contractId) {
    case "registry-runtime-bindings": return registrySeed(tree, importedAt);
    case "congress-rollcalls": return rollCallsSeed(tree, importedAt);
    case "federal-key-votes": return keyVotesSeed(tree, importedAt);
    case "candidate-profiles": return profilesSeed(tree, importedAt);
    case "candidate-corpus": return corpusSeed(tree, importedAt);
    case "officeholder-statements": return statementsSeed(tree, importedAt);
    case "az-official-actions": return actionsSeed(tree, importedAt);
    case "pima-legistar-outcomes": return outcomesSeed(tree, importedAt);
    case "comment-access":
    case "ballot-navigation":
    case "campaign-sites":
    case "venue-resolutions": return curatedSeed(tree, contractId, importedAt);
    case "everyday-routing": return everydaySeed(tree, importedAt);
  }
}

/**
 * Build and validate all 96 candidates in memory. This function has no
 * database, network, Git-write, deployment, or tracked-file side effect.
 */
export async function buildPdcV2TrustedLkgImportPlan(
  options: BuildPdcV2TrustedLkgImportPlanOptions,
): Promise<PdcV2TrustedLkgImportPlan> {
  const importedAt = exactInstant(options.importedAt);
  if (!GIT_SHA.test(options.importerCodeSha)) throw new Error("TRUSTED_LKG_IMPORTER_CODE_SHA_INVALID");
  const frozenFacts = inspectTrustedLkgRepository(options.frozenRoot);
  const frozenIssue = trustedLkgFrozenRepositoryIssue(frozenFacts, options.importerRepositoryFacts);
  if (frozenIssue !== null) throw new Error(`TRUSTED_LKG_FROZEN_REPOSITORY_REFUSED:${frozenIssue}`);
  const tree = new FrozenTree(frozenFacts);

  const meetings = await tree.capture(() => {
    const frozen = tree.json<MeetingsSnapshot>("data/meetings-snapshot.json");
    // Apply the standing snapshot read boundary to exact frozen bytes. One
    // historical DOCX was stored as binary-looking Reader text; its immutable
    // URL/hash remains while the permanent model explicitly marks extraction
    // failed, exactly as readSnapshot() does for legacy tracked snapshots.
    const value: MeetingsSnapshot = {
      ...frozen,
      agendaDocuments: frozen.agendaDocuments.map(canonicalAgendaDocument),
    };
    validateSnapshot(value);
    return value;
  });
  const meetingCandidates: PdcV2TrustedLkgPlannedCandidate[] = [];
  const meetingPartitionIdsWithoutLkg: string[] = [];
  const ownedMeetingIds = new Set<string>();
  let agendaDocumentRows = 0;
  for (const partition of MEETING_PARTITION_CONTRACTS) {
    const snapshot = partitionSnapshot(meetings.value, partition);
    if (snapshot.meetings.length === 0) {
      meetingPartitionIdsWithoutLkg.push(partition.id);
      continue;
    }
    for (const row of snapshot.meetings) {
      if (ownedMeetingIds.has(row.id)) throw new Error(`TRUSTED_LKG_MEETING_DUAL_PARTITION:${row.id}`);
      ownedMeetingIds.add(row.id);
    }
    agendaDocumentRows += snapshot.agendaDocuments.length;
    const requestedUrl = snapshot.meetings[0]?.provenance?.sourceUrl;
    if (!requestedUrl) throw new Error(`TRUSTED_LKG_MEETING_SOURCE_URL_MISSING:${partition.id}`);
    const base = meetingsCandidate({
      snapshot: {
        ...snapshot,
        // The legacy snapshot schema records a successful source's absent
        // error as null; the permanent candidate builder uses omission.
        sources: snapshot.sources.map(({ error, ...source }) => ({
          ...source,
          ...(error ? { error } : {}),
        })),
      },
      partition: {
        sourceName: partition.meetingSource,
        bodyId: partition.bodyId,
        scope: partition.scope,
      },
      requestedUrl,
      finalUrl: requestedUrl,
      retrievedAt: importedAt,
      acquisitionRawHash: trustedLkgFixtureSetSha256(meetings.fixtures),
    });
    meetingCandidates.push({
      contractId: partition.id,
      door: "MEETING_PARTITION",
      candidate: trustedCandidate(partition.id, base, meetings.fixtures, importedAt, options.importerCodeSha),
    });
  }
  const unowned = meetings.value.meetings.filter(({ id }) => !ownedMeetingIds.has(id));
  if (unowned.length > 0) {
    throw new Error(`TRUSTED_LKG_MEETINGS_OUTSIDE_REGISTERED_PARTITION:${unowned.slice(0, 5).map(({ id }) => id).join(",")}`);
  }

  const manualCandidates: PdcV2TrustedLkgPlannedCandidate[] = [];
  for (const contractId of PDC_V2_TRUSTED_LKG_MANUAL_CONTRACT_IDS) {
    const seed = await manualSeed(tree, contractId, importedAt);
    const contract = requiredManualProductionContract(contractId);
    const candidate = trustedCandidate(contractId, seed.candidate, seed.fixtures, importedAt, options.importerCodeSha);
    if (
      candidate.sourceId !== contract.sourceId ||
      candidate.recordClass !== contract.recordClass ||
      candidate.scope !== contract.scope ||
      candidate.normalization.parserVersion !== contract.parserNormalizerVersion
    ) {
      throw new Error(`TRUSTED_LKG_MANUAL_CONTRACT_MISMATCH:${contractId}`);
    }
    manualCandidates.push({ contractId, door: "MANUAL", candidate });
  }

  const withLkg = meetingCandidates.map(({ contractId }) => contractId).sort();
  const withoutLkg = meetingPartitionIdsWithoutLkg.sort();
  const candidates = [...meetingCandidates, ...manualCandidates].sort((left, right) => left.contractId.localeCompare(right.contractId));
  const expected = PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS;
  if (
    withLkg.length !== expected.meetingPartitionsWithLkg ||
    withoutLkg.length !== expected.meetingPartitionsWithoutLkg ||
    ownedMeetingIds.size !== expected.meetingRows ||
    agendaDocumentRows !== expected.meetingAgendaDocumentRows ||
    manualCandidates.length !== expected.manualContracts ||
    candidates.length !== expected.totalCandidates
  ) {
    throw new Error(
      `TRUSTED_LKG_DENOMINATOR_MISMATCH:meetings=${withLkg.length}/${withoutLkg.length}/${ownedMeetingIds.size}/${agendaDocumentRows}:manual=${manualCandidates.length}:total=${candidates.length}`,
    );
  }
  if (new Set(candidates.map(({ contractId }) => contractId)).size !== candidates.length) {
    throw new Error("TRUSTED_LKG_CONTRACT_ID_DUPLICATED");
  }
  const finalFrozenFacts = inspectTrustedLkgRepository(options.frozenRoot);
  const finalFrozenIssue = trustedLkgFrozenRepositoryIssue(finalFrozenFacts, options.importerRepositoryFacts);
  if (finalFrozenIssue !== null) {
    throw new Error(`TRUSTED_LKG_FROZEN_REPOSITORY_CHANGED_DURING_PLAN:${finalFrozenIssue}`);
  }
  return {
    contractVersion: 1,
    frozenBaseSha: PDC_V2_FROZEN_BASE_SHA,
    frozenRoot: frozenFacts.repositoryRoot,
    importerCodeSha: options.importerCodeSha,
    importedAt,
    candidates,
    meetingPartitionIdsWithLkg: withLkg,
    meetingPartitionIdsWithoutLkg: withoutLkg,
    meetingRows: ownedMeetingIds.size,
    agendaDocumentRows,
    manualContractIds: [...PDC_V2_TRUSTED_LKG_MANUAL_CONTRACT_IDS],
  };
}

export interface PdcV2TrustedLkgImportDisposition {
  readonly contractId: string;
  readonly candidateId: string;
  readonly disposition:
    | "PROMOTED_ABSENT_POINTER"
    | "PROMOTED_FROZEN_LKG_UNION"
    | "REATTESTED_EXISTING_AUTHORITY"
    | "SKIPPED_EXISTING_PROVEN_AUTHORITY";
  readonly versionId: string;
  readonly readerReadback: "PASS";
}

export interface PdcV2TrustedLkgImportResult {
  readonly contractVersion: 1;
  readonly frozenBaseSha: typeof PDC_V2_FROZEN_BASE_SHA;
  readonly importerCodeSha: string;
  readonly importedAt: string;
  readonly promoted: number;
  readonly reattestedExisting: number;
  readonly skippedExisting: number;
  readonly zeroMeetingPartitionsRefused: number;
  readonly dispositions: readonly PdcV2TrustedLkgImportDisposition[];
  readonly zeroMeetingPartitionIds: readonly string[];
}

export interface PdcV2PermanentCutoverImportResult extends PdcV2TrustedLkgImportResult {
  readonly legacyMeetingsAggregateRetirement:
    PdcV2LegacyMeetingsRetirementResult & PdcV2LegacyMeetingsRetirementInput["expected"];
}

function sameSortedStrings(left: readonly string[], right: readonly string[]): boolean {
  return canonicalCivicDataJson([...left].sort()) === canonicalCivicDataJson([...right].sort());
}

function trustedLkgLegacyMeetingsCommonOrigin(
  origin: TrustedLkgLegacyMeetingsPartitionEvidence,
): Readonly<Record<string, unknown>> {
  return {
    legacyKey: origin.legacyKey,
    legacySourceId: origin.legacySourceId,
    legacyRecordClass: origin.legacyRecordClass,
    legacyScope: origin.legacyScope,
    legacyVersionId: origin.legacyVersionId,
    legacyPromotedAt: origin.legacyPromotedAt,
    legacyPointerSha256: origin.legacyPointerSha256,
    legacyCandidateRecordSha256: origin.legacyCandidateRecordSha256,
    legacyCandidateSha256: origin.legacyCandidateSha256,
    legacyReceiptSha256: origin.legacyReceiptSha256,
    legacyPayloadSha256: origin.legacyPayloadSha256,
    legacyReadModelSha256: origin.legacyReadModelSha256,
    legacyNormalizedPayloadSha256: origin.legacyNormalizedPayloadSha256,
    legacyHistorySha256: origin.legacyHistorySha256,
    legacyHistoryEventCount: origin.legacyHistoryEventCount,
    legacyHistoryLastSequence: origin.legacyHistoryLastSequence,
    legacyMeetingFactSha256: origin.legacyMeetingFactSha256,
    legacyMeetingRowCount: origin.legacyMeetingRowCount,
    legacyAgendaDocumentRowCount: origin.legacyAgendaDocumentRowCount,
  };
}

/**
 * Re-prove the complete frozen transfer denominator at the executable edge.
 * The generic executor intentionally supports focused tests; production may
 * never use that flexibility to run a truncated or hand-edited import plan.
 */
export function pdcV2PermanentCutoverPlanIssue(
  plan: PdcV2TrustedLkgImportPlan,
): string | null {
  const expected = PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS;
  const importedAt = Date.parse(plan.importedAt);
  if (plan.contractVersion !== 1) return "plan contract version is not one";
  if (plan.frozenBaseSha !== PDC_V2_FROZEN_BASE_SHA) return "plan names another frozen base";
  if (!GIT_SHA.test(plan.importerCodeSha)) return "plan importer code SHA is invalid";
  if (
    !Number.isFinite(importedAt) ||
    new Date(importedAt).toISOString() !== plan.importedAt ||
    importedAt > Date.now() + MAX_DURABLE_OPERATION_CLOCK_SKEW_MS
  ) return "plan import clock is invalid or materially future";
  if (!isAbsolute(plan.frozenRoot)) return "plan frozen root is not absolute";
  if (
    plan.candidates.length !== expected.totalCandidates ||
    plan.meetingPartitionIdsWithLkg.length !== expected.meetingPartitionsWithLkg ||
    plan.meetingPartitionIdsWithoutLkg.length !== expected.meetingPartitionsWithoutLkg ||
    plan.manualContractIds.length !== expected.manualContracts
  ) return "plan denominator counts differ from the frozen transfer contract";
  if (!sameSortedStrings(plan.manualContractIds, PDC_V2_TRUSTED_LKG_MANUAL_CONTRACT_IDS)) {
    return "plan manual contract denominator differs";
  }

  const meetingPlans = plan.candidates.filter(({ door }) => door === "MEETING_PARTITION");
  const manualPlans = plan.candidates.filter(({ door }) => door === "MANUAL");
  if (
    meetingPlans.length !== expected.meetingPartitionsWithLkg ||
    manualPlans.length !== expected.manualContracts ||
    plan.candidates.some(({ door }) => door !== "MEETING_PARTITION" && door !== "MANUAL")
  ) return "plan door partition differs from the exact transfer denominator";
  const candidateContractIds = plan.candidates.map(({ contractId }) => contractId);
  const candidateIds = plan.candidates.map(({ candidate }) => candidate.id);
  if (
    new Set(candidateContractIds).size !== candidateContractIds.length ||
    new Set(candidateIds).size !== candidateIds.length
  ) return "plan contains a duplicate contract or candidate identity";
  if (!sameSortedStrings(
    meetingPlans.map(({ contractId }) => contractId),
    plan.meetingPartitionIdsWithLkg,
  )) return "meeting candidates and with-LKG denominator disagree";
  const allMeetingIds = MEETING_PARTITION_CONTRACTS.map(({ id }) => id);
  const expectedAbsentIds = allMeetingIds.filter((id) =>
    !plan.meetingPartitionIdsWithLkg.includes(id)
  );
  if (
    !sameSortedStrings(plan.meetingPartitionIdsWithoutLkg, expectedAbsentIds) ||
    new Set([
      ...plan.meetingPartitionIdsWithLkg,
      ...plan.meetingPartitionIdsWithoutLkg,
    ]).size !== MEETING_PARTITION_CONTRACTS.length
  ) return "meeting present/absent partitions do not exactly partition the registry";
  if (!sameSortedStrings(
    manualPlans.map(({ contractId }) => contractId),
    PDC_V2_TRUSTED_LKG_MANUAL_CONTRACT_IDS,
  )) return "manual planned candidates differ from the exact import set";

  let meetingRows = 0;
  let agendaDocumentRows = 0;
  const legacyMeetingOrigins: TrustedLkgLegacyMeetingsPartitionEvidence[] = [];
  const meetingPayloads: MeetingsSnapshot[] = [];
  for (const planned of plan.candidates) {
    const contract = registeredContractFor(planned);
    const candidate = planned.candidate;
    if (
      candidate.sourceId !== contract.sourceId ||
      candidate.recordClass !== contract.recordClass ||
      candidate.scope !== contract.scope ||
      candidate.normalization.parserVersion !== contract.parserNormalizerVersion
    ) return `planned candidate ${planned.contractId} differs from its registered contract`;
    const evidence = candidate.bootstrapImport;
    const preflightCandidate = {
      ...candidate,
      changeSet: candidateChangeSet(candidate, null),
    };
    const transferIssue = trustedLkgImportEvidenceIssue(preflightCandidate, null);
    if (
      !evidence || evidence.kind !== "TRUSTED_LKG_IMPORT" ||
      evidence.contractId !== planned.contractId ||
      evidence.importerCodeSha !== plan.importerCodeSha ||
      transferIssue !== null
    ) return `planned candidate ${planned.contractId} has invalid transfer evidence: ${transferIssue ?? "identity mismatch"}`;
    const validated = validateRoutineCandidate(preflightCandidate, null, plan.importedAt);
    if (validated.state !== "VALIDATED" || validated.receipt.decision !== "GOOD") {
      return `planned candidate ${planned.contractId} is no longer GOOD`;
    }
    if (planned.door === "MEETING_PARTITION") {
      const snapshot = candidate.readModel as MeetingsSnapshot;
      try {
        validateSnapshot(snapshot, {
          allowAllSourcesFailedForDurableTransfer: evidence.legacyMeetingsPartition !== undefined,
        });
      } catch {
        return `meeting candidate ${planned.contractId} snapshot is invalid`;
      }
      if (snapshot.meetings.length === 0) {
        return `meeting candidate ${planned.contractId} has no LKG rows`;
      }
      meetingPayloads.push(snapshot);
      meetingRows += snapshot.meetings.length;
      agendaDocumentRows += snapshot.agendaDocuments.length;
      const origin = evidence.legacyMeetingsPartition;
      if (origin) {
        if (
          origin.partitionSourceName !== (contract as MeetingPartitionContract).meetingSource ||
          origin.partitionBodyId !== (contract as MeetingPartitionContract).bodyId
        ) return `meeting candidate ${planned.contractId} names another durable partition origin`;
        const facts = pdcV2CanonicalMeetingFactEvidence([snapshot]);
        if (
          origin.partitionFactSha256 !== facts.sha256 ||
          origin.partitionMeetingRowCount !== facts.meetingRowCount ||
          origin.partitionAgendaDocumentRowCount !== facts.agendaDocumentRowCount
        ) return `meeting candidate ${planned.contractId} durable partition fact witness differs`;
        legacyMeetingOrigins.push(origin);
      }
    } else if (planned.contractId === "everyday-routing") {
      const issue = everydayFrozenTransferIssue(candidate.readModel as EverydayRoutingProjection);
      if (issue !== null) return `planned everyday routing payload differs from the frozen denominator: ${issue}`;
    } else if (planned.contractId === "pima-legistar-outcomes") {
      const snapshot = candidate.readModel as OutcomeSnapshot;
      try {
        assertPimaOutcomeSnapshot(snapshot, "PERMANENT_PLAN");
      } catch {
        return "planned Pima outcome payload is invalid";
      }
      if (
        snapshot.sittings.length !== expected.pimaOutcomeSittings ||
        candidate.bootstrapImport?.kind !== "TRUSTED_LKG_IMPORT" ||
        candidate.bootstrapImport.pimaOutcomeUnion !== undefined
      ) return "planned Pima outcome payload differs from the frozen denominator";
    }
  }
  if (meetingRows !== plan.meetingRows || agendaDocumentRows !== plan.agendaDocumentRows) {
    return "planned meeting payload rows differ from the transfer denominator";
  }
  if (legacyMeetingOrigins.length === 0) {
    if (
      plan.meetingRows !== expected.meetingRows ||
      plan.agendaDocumentRows !== expected.meetingAgendaDocumentRows
    ) return "frozen planned meeting payload rows differ from the frozen denominator";
  } else {
    if (legacyMeetingOrigins.length !== meetingPlans.length) {
      return "meeting plan mixes frozen and durable-aggregate transfer origins";
    }
    const first = legacyMeetingOrigins[0]!;
    if (legacyMeetingOrigins.some((origin) =>
      canonicalCivicDataJson(trustedLkgLegacyMeetingsCommonOrigin(origin)) !==
        canonicalCivicDataJson(trustedLkgLegacyMeetingsCommonOrigin(first))
    )) return "durable meeting partitions do not share one exact legacy aggregate origin";
    const facts = pdcV2CanonicalMeetingFactEvidence(meetingPayloads);
    if (
      first.legacyMeetingFactSha256 !== facts.sha256 ||
      first.legacyMeetingRowCount !== facts.meetingRowCount ||
      first.legacyAgendaDocumentRowCount !== facts.agendaDocumentRowCount ||
      plan.meetingRows !== facts.meetingRowCount ||
      plan.agendaDocumentRows !== facts.agendaDocumentRowCount
    ) return "durable meeting partition union differs from its exact legacy aggregate witness";
  }
  return null;
}

async function proveCanonicalVersion(
  store: RoutineDataStore,
  planned: PdcV2TrustedLkgPlannedCandidate,
  expectedVersionId: string,
  now: string,
): Promise<CandidateVersionRecord> {
  return proveRegisteredContractVersion(
    store,
    registeredContractFor(planned),
    expectedVersionId,
    now,
  );
}

type TrustedLkgRegisteredContract =
  | RoutineSourceContract
  | MeetingPartitionContract
  | ManualProductionSourceContract;

const MAX_DURABLE_OPERATION_CLOCK_SKEW_MS = 5 * 60 * 1_000;

function canonicalDurableInstant(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

/**
 * A row/pointer proof predating PDC can look internally consistent while its
 * append-only history still violates the permanent database contract. Such a
 * pointer must receive an immutable re-attestation successor before 0026; it
 * must never be called PROVEN and left as a migration blocker.
 */
function durablePointerHistoryIssue(
  row: CandidateVersionRecord,
  pointer: import("./types.ts").PromotedProjection,
  events: readonly CandidateEvent[],
  now: string,
): string | null {
  if (!canonicalDurableInstant(row.receipt?.validatedAt ?? "")) {
    return "the current candidate validation clock is not canonical UTC";
  }
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) return "the proof observation clock is invalid";
  const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
  if (ordered.length === 0) return "the current candidate has no append-only event history";
  const terminalStates = new Set([
    "SOURCE_BLOCKED",
    "PARSE_INVALID",
    "IDENTITY_UNRESOLVED",
    "TEMPORAL_INVALID",
    "SEMANTIC_INVALID",
    "HORIZON_UNRESOLVED",
    "DEPENDENT_CONSUMER_INVALID",
    "CANNOT_TELL",
  ]);
  for (let index = 0; index < ordered.length; index += 1) {
    const event = ordered[index]!;
    const at = Date.parse(event.at);
    const prior = ordered[index - 1];
    if (event.sequence !== index + 1) return "the current candidate event sequence is not contiguous from one";
    if (!Number.isFinite(at) || at > nowMs + MAX_DURABLE_OPERATION_CLOCK_SKEW_MS) {
      return "the current candidate has an invalid or materially future event clock";
    }
    if (prior && at < Date.parse(prior.at)) return "the current candidate event clock moves backward";
    if (!prior) continue;
    const legal =
      (prior.state === "FETCHED" && (event.state === "NORMALIZED" || terminalStates.has(event.state))) ||
      (prior.state === "NORMALIZED" && (event.state === "VALIDATED" || terminalStates.has(event.state))) ||
      (prior.state === "VALIDATED" && (event.state === "PROMOTED" || terminalStates.has(event.state))) ||
      (prior.state === "PROMOTED" && event.state === "PROMOTED");
    if (!legal) return `the current candidate event transition ${prior.state} -> ${event.state} is invalid`;
  }
  const first = ordered[0]!;
  const expectedFirst = row.acquisitionSucceeded ? "FETCHED" : "SOURCE_BLOCKED";
  if (first.state !== expectedFirst) return "the current candidate first event disagrees with acquisition disposition";
  if (ordered.at(-1)!.state !== row.state) return "the current candidate row disagrees with its latest event";
  const validatedAt = Date.parse(row.receipt!.validatedAt);
  if (!ordered.some((event) => event.state === "VALIDATED" && Date.parse(event.at) === validatedAt)) {
    return "the current candidate has no VALIDATED event at its exact receipt clock";
  }
  const firstPromoted = ordered.find((event) => event.state === "PROMOTED");
  if (!firstPromoted || Date.parse(firstPromoted.at) !== Date.parse(pointer.promotedAt)) {
    return "the current candidate has no first PROMOTED event at its exact pointer clock";
  }
  return null;
}

async function proveRegisteredContractVersion(
  store: RoutineDataStore,
  contract: TrustedLkgRegisteredContract,
  expectedVersionId: string,
  now: string,
): Promise<CandidateVersionRecord> {
  const pointer = await store.readPromotion(contract.recordClass, contract.scope);
  if (!pointer || pointer.versionId !== expectedVersionId) {
    throw new Error(`TRUSTED_LKG_POINTER_READBACK_FAILED:${contract.id}:${pointer?.versionId ?? "ABSENT"}:${expectedVersionId}`);
  }
  if (pointer.sourceId !== contract.sourceId) {
    throw new Error(
      `TRUSTED_LKG_EXISTING_POINTER_SOURCE_MISMATCH:${contract.id}:` +
      `${pointer.sourceId}:${contract.sourceId}`,
    );
  }
  const observedAt = promotionReaderReadbackObservedAt(
    store,
    now,
    pointer.promotedAt,
  );
  const row = await store.readCandidate(pointer.versionId);
  if (!row) throw new Error(`TRUSTED_LKG_CANDIDATE_READBACK_MISSING:${contract.id}:${pointer.versionId}`);
  if (row.candidate.sourceId !== contract.sourceId) {
    throw new Error(
      `TRUSTED_LKG_EXISTING_CANDIDATE_SOURCE_MISMATCH:${contract.id}:` +
      `${row.candidate.sourceId}:${contract.sourceId}`,
    );
  }
  const transferEvidence = row.candidate.bootstrapImport;
  const predecessorVersionId = transferEvidence?.kind === "TRUSTED_LKG_REATTESTATION"
    ? transferEvidence.predecessorVersionId
    : transferEvidence?.kind === "TRUSTED_LKG_IMPORT"
      ? transferEvidence.pimaOutcomeUnion?.predecessorVersionId ?? null
      : null;
  const predecessor = predecessorVersionId === null
    ? null
    : await store.readCandidate(predecessorVersionId);
  const issue = promotionProofIssue(contract.recordClass, contract.scope, pointer, row, predecessor);
  if (issue !== null) throw new Error(`TRUSTED_LKG_PROMOTION_PROOF_INVALID:${contract.id}:${issue}`);
  const historyIssue = durablePointerHistoryIssue(
    row,
    pointer,
    await store.events(row.candidate.id),
    observedAt,
  );
  if (historyIssue !== null) {
    throw new Error(`TRUSTED_LKG_DURABLE_HISTORY_INVALID:${contract.id}:${historyIssue}`);
  }
  const read = await readPromotedCivicData(contract.recordClass, contract.scope, {
    store,
    now: observedAt,
    bypassCache: true,
  });
  if (read.kind !== "PROMOTED" || read.metadata.versionId !== expectedVersionId) {
    throw new Error(`TRUSTED_LKG_CANONICAL_READ_FAILED:${contract.id}:${read.kind}:${read.metadata.versionId ?? "ABSENT"}`);
  }
  const typed = contract.readerProjection === null
    ? await verifySourceScopedCandidateProjection(contract, row.candidate, observedAt, predecessor)
    : await verifyRoutineReaderProjection(contract, {
        store,
        now: observedAt,
        expectedVersionId,
      });
  if (typed.status !== "PASS") throw new Error(`TRUSTED_LKG_TYPED_READER_READBACK_FAILED:${contract.id}:${typed.detail}`);
  return row;
}

function registeredContractFor(
  planned: PdcV2TrustedLkgPlannedCandidate,
): MeetingPartitionContract | ManualProductionSourceContract {
  return planned.door === "MEETING_PARTITION"
    ? requiredMeetingPartitionContract(planned.contractId)
    : requiredManualProductionContract(planned.contractId as ManualProductionContractId);
}

export type PdcV2TrustedLkgReattestationContract = TrustedLkgRegisteredContract;

/**
 * Build one no-data-change integrity successor for an exact durable LKG. The
 * predecessor row is never rewritten; its mutable pointer observation and all
 * immutable proof components are content-bound into the new candidate.
 */
export function buildPdcV2TrustedLkgReattestationCandidate(input: {
  readonly contract: PdcV2TrustedLkgReattestationContract;
  readonly pointer: import("./types.ts").PromotedProjection;
  readonly predecessor: CandidateVersionRecord;
  readonly reattestedAt: string;
  readonly importerCodeSha: string;
}): RoutineCandidate {
  const { contract, pointer, predecessor } = input;
  if (!GIT_SHA.test(input.importerCodeSha)) throw new Error("TRUSTED_LKG_REATTESTATION_CODE_SHA_INVALID");
  const reattestedAt = exactInstant(input.reattestedAt);
  const prior = structuredClone(predecessor.candidate);
  if (
    prior.sourceId !== contract.sourceId ||
    prior.recordClass !== contract.recordClass ||
    prior.scope !== contract.scope
  ) throw new Error(`TRUSTED_LKG_REATTESTATION_CONTRACT_MISMATCH:${contract.id}`);
  const nhV2ToV3 = prior.normalization.parserVersion === contract.parserNormalizerVersion
    ? null
    : contract.id === "nh-members"
      ? trustedLkgNhMembersV2ToV3BridgeParts(predecessor)
      : null;
  if (
    prior.normalization.parserVersion !== contract.parserNormalizerVersion &&
    nhV2ToV3 === null
  ) throw new Error(`TRUSTED_LKG_REATTESTATION_CONTRACT_MISMATCH:${contract.id}`);
  const readModel = nhV2ToV3?.readModel ?? prior.readModel;
  const identities = nhV2ToV3?.identities ?? prior.identities;
  const predecessorReadModelSha256 = trustedLkgEvidenceSha256(prior.readModel);
  const readModelSha256 = trustedLkgEvidenceSha256(readModel);
  const normalizedPayloadSha256 = trustedLkgEvidenceSha256(prior.normalizedPayload);
  const base: RoutineCandidate = {
    ...prior,
    id: "",
    normalization: nhV2ToV3?.normalization ?? {
      ...prior.normalization,
      normalizedHash: readModelSha256,
      normalizedPayloadHash: normalizedPayloadSha256,
    },
    identities,
    temporal: {
      ...prior.temporal,
      // Re-attestation preserves service; it is not a new publisher read.
      staleAtRetrieval: true,
    },
    sourceProjectionEvidence: sourceProjectionEvidence(
      contract.sourceId,
      contract.recordClass,
      contract.scope,
    ),
    civicRecords: civicRecordsFor(contract.recordClass, readModel),
    changeSet: undefined,
    bootstrapImport: undefined,
    readModel,
  };
  const evidence: TrustedLkgReattestationEvidence = {
    contractVersion: 1,
    kind: "TRUSTED_LKG_REATTESTATION",
    authorization: TRUSTED_LKG_IMPORT_AUTHORIZATION,
    purpose: TRUSTED_LKG_REATTESTATION_PURPOSE,
    sourceAuthenticated: false,
    ...(nhV2ToV3 ? { contractUpgrade: NH_MEMBERS_V2_TO_V3_REATTESTATION } : {}),
    contractId: contract.id,
    sourceId: contract.sourceId,
    recordClass: contract.recordClass,
    scope: contract.scope,
    parserVersion: base.normalization.parserVersion,
    sourceVersion: prior.temporal.version,
    sourceThrough: prior.temporal.sourceThrough,
    sourceRetrievedAt: prior.retrieval.retrievedAt,
    reattestedAt,
    importerCodeSha: input.importerCodeSha,
    predecessorVersionId: prior.id,
    predecessorPromotedAt: pointer.promotedAt,
    predecessorPointerSha256: trustedLkgPredecessorPointerSha256(pointer),
    predecessorCandidateRecordSha256: trustedLkgPredecessorRecordSha256(predecessor),
    predecessorCandidateSha256: trustedLkgEvidenceSha256(prior),
    predecessorReceiptSha256: trustedLkgEvidenceSha256(predecessor.receipt),
    predecessorPayloadSha256: trustedLkgEvidenceSha256(pointer.payload),
    predecessorReadModelSha256,
    predecessorNormalizedPayloadSha256: normalizedPayloadSha256,
    predecessorLegacyNormalizedHash: prior.normalization.normalizedHash ?? "",
    normalizedPayloadSha256,
    readModelSha256,
    candidateEnvelopeSha256: trustedLkgCandidateEnvelopeSha256(base),
    validatorIds: trustedLkgValidatorIds(base),
  };
  const withEvidence: RoutineCandidate = {
    ...base,
    id: trustedLkgCandidateId(evidence),
    bootstrapImport: evidence,
  };
  const candidate: RoutineCandidate = {
    ...withEvidence,
    changeSet: candidateChangeSet(withEvidence, prior.readModel),
  };
  const issue = trustedLkgImportEvidenceIssue(candidate, predecessor);
  if (issue !== null) throw new Error(`TRUSTED_LKG_REATTESTATION_INVALID:${contract.id}:${issue}`);
  return candidate;
}

interface PdcV2TrustedLkgTarget {
  readonly contractId: string;
  readonly door: "ROUTINE" | "MEETING_PARTITION" | "MANUAL";
  readonly contract: TrustedLkgRegisteredContract;
  readonly planned: PdcV2TrustedLkgPlannedCandidate | null;
}

function trustedLkgTargets(plan: PdcV2TrustedLkgImportPlan): readonly PdcV2TrustedLkgTarget[] {
  const plannedByContractId = new Map(
    plan.candidates.map((planned) => [planned.contractId, planned] as const),
  );
  const targets: PdcV2TrustedLkgTarget[] = [
    ...ROUTINE_SOURCE_CONTRACTS.map((contract) => ({
      contractId: contract.id,
      door: "ROUTINE" as const,
      contract,
      planned: plannedByContractId.get(contract.id) ?? null,
    })),
    ...MEETING_PARTITION_CONTRACTS.map((contract) => ({
      contractId: contract.id,
      door: "MEETING_PARTITION" as const,
      contract,
      planned: plannedByContractId.get(contract.id) ?? null,
    })),
    ...MANUAL_PRODUCTION_SOURCE_CONTRACTS.map((contract) => ({
      contractId: contract.id,
      door: "MANUAL" as const,
      contract,
      planned: plannedByContractId.get(contract.id) ?? null,
    })),
  ];
  const ids = targets.map(({ contractId }) => contractId);
  const keys = targets.map(({ contract }) => `${contract.recordClass}:${contract.scope}`);
  if (
    new Set(ids).size !== ids.length ||
    new Set(keys).size !== keys.length ||
    plan.candidates.some(({ contractId }) => !ids.includes(contractId))
  ) {
    throw new Error("TRUSTED_LKG_CUTOVER_TARGET_IDENTITY_DUPLICATED");
  }
  return targets;
}

const PDC_V2_LEGACY_MEETINGS_SCOPE = "supported-bodies";
const PDC_V2_LEGACY_MEETINGS_SOURCE_ID = "meetings-public-bodies";

function pdcV2LegacyMeetingsPromotionProofIssue(
  pointer: import("./types.ts").PromotedProjection<MeetingsSnapshot>,
  row: CandidateVersionRecord,
): string | null {
  const issue = promotionProofIssue(
    "MEETING",
    PDC_V2_LEGACY_MEETINGS_SCOPE,
    pointer,
    row,
  );
  if (issue !== "the candidate normalized evidence does not match its durable payload hash") {
    return issue;
  }

  const candidate = row.candidate;
  const normalization = candidate.normalization;
  if (
    normalization.normalizedPayloadHash !== undefined ||
    !SHA256.test(normalization.normalizedHash ?? "") ||
    normalization.parserVersion !== "meetings-composite/2" ||
    normalization.schemaVersion !== "MeetingsSnapshot:1" ||
    candidate.sourceId !== PDC_V2_LEGACY_MEETINGS_SOURCE_ID ||
    candidate.recordClass !== "MEETING" ||
    candidate.scope !== PDC_V2_LEGACY_MEETINGS_SCOPE ||
    candidate.bootstrapImport !== undefined
  ) return issue;

  /*
   * The one legacy aggregate currently serving production predates the
   * normalizedPayloadHash field. It still carries one normalizedHash that was
   * computed over both its identical Reader projection and normalized payload.
   * Re-run the complete modern promotion proof with only that omitted field
   * reconstructed from the declared hash. Any payload/read-model drift, bad
   * receipt, pointer mismatch, or different omission still fails. This narrow
   * compatibility path is deleted with this one-time import plan at commit B.
   */
  return promotionProofIssue(
    "MEETING",
    PDC_V2_LEGACY_MEETINGS_SCOPE,
    pointer,
    {
      ...row,
      candidate: {
        ...candidate,
        normalization: {
          ...normalization,
          normalizedPayloadHash: normalization.normalizedHash,
        },
      },
    },
  );
}

function canonicalMeetingFactSha256(snapshot: MeetingsSnapshot): string {
  validateSnapshot(snapshot);
  return pdcV2CanonicalMeetingFactEvidence([snapshot]).sha256;
}

interface PdcV2ProvenLegacyMeetingsAuthority {
  readonly pointer: PromotedProjection<MeetingsSnapshot>;
  readonly candidate: CandidateVersionRecord;
  readonly events: readonly CandidateEvent[];
}

/**
 * Preserve the exact meeting authority serving at the bounded switch.  The
 * fc67 plan remains the required lineage and supplies every manual candidate;
 * only its now-stale meeting payloads are replaced by a deterministic split of
 * the fully proved durable aggregate.
 */
function pdcV2CurrentLegacyMeetingsOverlayPlan(
  plan: PdcV2TrustedLkgImportPlan,
  authority: PdcV2ProvenLegacyMeetingsAuthority,
): PdcV2TrustedLkgImportPlan {
  const legacyReceipt = authority.candidate.receipt;
  if (!legacyReceipt) throw new Error("TRUSTED_LKG_LEGACY_MEETINGS_RECEIPT_MISSING");
  const legacyHistory = [...authority.events].sort((left, right) => left.sequence - right.sequence);
  if (
    legacyHistory.length < 4 ||
    legacyHistory.some((event, index) => event.sequence !== index + 1)
  ) throw new Error("TRUSTED_LKG_LEGACY_MEETINGS_HISTORY_SEQUENCE_INVALID");
  const current: MeetingsSnapshot = {
    ...structuredClone(authority.pointer.payload),
    agendaDocuments: authority.pointer.payload.agendaDocuments.map(canonicalAgendaDocument),
  };
  validateSnapshot(current);
  const aggregateFacts = pdcV2CanonicalMeetingFactEvidence([current]);
  const legacyPayloadSha256 = trustedLkgEvidenceSha256(authority.pointer.payload);
  const legacyReadModelSha256 = trustedLkgEvidenceSha256(authority.candidate.candidate.readModel);
  const legacyNormalizedPayloadSha256 = trustedLkgEvidenceSha256(
    authority.candidate.candidate.normalizedPayload,
  );
  if (
    legacyPayloadSha256 !== legacyReadModelSha256 ||
    legacyPayloadSha256 !== legacyNormalizedPayloadSha256
  ) throw new Error("TRUSTED_LKG_LEGACY_MEETINGS_DURABLE_PAYLOAD_DIVERGED");

  const commonOrigin = {
    contractVersion: 1 as const,
    kind: "DURABLE_LEGACY_MEETINGS_PARTITION" as const,
    legacyKey: "MEETING:supported-bodies" as const,
    legacySourceId: "meetings-public-bodies" as const,
    legacyRecordClass: "MEETING" as const,
    legacyScope: "supported-bodies" as const,
    legacyVersionId: authority.pointer.versionId,
    legacyPromotedAt: authority.pointer.promotedAt,
    legacyPointerSha256: trustedLkgPredecessorPointerSha256(authority.pointer),
    legacyCandidateRecordSha256: trustedLkgPredecessorRecordSha256(authority.candidate),
    legacyCandidateSha256: trustedLkgEvidenceSha256(authority.candidate.candidate),
    legacyReceiptSha256: trustedLkgEvidenceSha256(legacyReceipt),
    legacyPayloadSha256,
    legacyReadModelSha256,
    legacyNormalizedPayloadSha256,
    legacyHistorySha256: trustedLkgEvidenceSha256(legacyHistory),
    legacyHistoryEventCount: legacyHistory.length,
    legacyHistoryLastSequence: legacyHistory.at(-1)!.sequence,
    legacyMeetingFactSha256: aggregateFacts.sha256,
    legacyMeetingRowCount: aggregateFacts.meetingRowCount,
    legacyAgendaDocumentRowCount: aggregateFacts.agendaDocumentRowCount,
  };
  const meetingCandidates: PdcV2TrustedLkgPlannedCandidate[] = [];
  const withoutLkg: string[] = [];
  const ownedMeetingIds = new Set<string>();
  let agendaDocumentRows = 0;
  for (const partition of MEETING_PARTITION_CONTRACTS) {
    const snapshot = partitionSnapshot(current, partition, true);
    if (snapshot.meetings.length === 0) {
      withoutLkg.push(partition.id);
      continue;
    }
    for (const row of snapshot.meetings) {
      if (ownedMeetingIds.has(row.id)) {
        throw new Error(`TRUSTED_LKG_CURRENT_MEETING_DUAL_PARTITION:${row.id}`);
      }
      ownedMeetingIds.add(row.id);
    }
    agendaDocumentRows += snapshot.agendaDocuments.length;
    const requestedUrl = snapshot.meetings[0]?.provenance?.sourceUrl;
    if (!requestedUrl) throw new Error(`TRUSTED_LKG_CURRENT_MEETING_SOURCE_URL_MISSING:${partition.id}`);
    const base = meetingsCandidate({
      snapshot: {
        ...snapshot,
        sources: snapshot.sources.map(({ error, ...source }) => ({
          ...source,
          ...(error ? { error } : {}),
        })),
      },
      partition: {
        sourceName: partition.meetingSource,
        bodyId: partition.bodyId,
        scope: partition.scope,
      },
      requestedUrl,
      finalUrl: requestedUrl,
      retrievedAt: plan.importedAt,
      acquisitionRawHash: trustedLkgPredecessorPointerSha256(authority.pointer),
    });
    const partitionFacts = pdcV2CanonicalMeetingFactEvidence([snapshot]);
    const origin: TrustedLkgLegacyMeetingsPartitionEvidence = {
      ...commonOrigin,
      partitionSourceName: partition.meetingSource,
      partitionBodyId: partition.bodyId,
      partitionFactSha256: partitionFacts.sha256,
      partitionMeetingRowCount: partitionFacts.meetingRowCount,
      partitionAgendaDocumentRowCount: partitionFacts.agendaDocumentRowCount,
    };
    meetingCandidates.push({
      contractId: partition.id,
      door: "MEETING_PARTITION",
      candidate: trustedCandidate(
        partition.id,
        base,
        [],
        plan.importedAt,
        plan.importerCodeSha,
        origin,
      ),
    });
  }
  const unowned = current.meetings.filter(({ id }) => !ownedMeetingIds.has(id));
  if (unowned.length > 0) {
    throw new Error(
      `TRUSTED_LKG_CURRENT_MEETINGS_OUTSIDE_REGISTERED_PARTITION:` +
      unowned.slice(0, 5).map(({ id }) => id).join(","),
    );
  }
  const withLkg = meetingCandidates.map(({ contractId }) => contractId).sort();
  withoutLkg.sort();
  if (
    withLkg.length !== PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.meetingPartitionsWithLkg ||
    withoutLkg.length !== PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.meetingPartitionsWithoutLkg
  ) {
    throw new Error(
      `TRUSTED_LKG_CURRENT_MEETING_PARTITION_DENOMINATOR_MISMATCH:` +
      `${withLkg.length}/${withoutLkg.length}`,
    );
  }
  const replacementFacts = pdcV2CanonicalMeetingFactEvidence(
    meetingCandidates.map(({ candidate }) => candidate.readModel),
  );
  if (
    replacementFacts.sha256 !== aggregateFacts.sha256 ||
    replacementFacts.meetingRowCount !== aggregateFacts.meetingRowCount ||
    replacementFacts.agendaDocumentRowCount !== aggregateFacts.agendaDocumentRowCount ||
    agendaDocumentRows !== aggregateFacts.agendaDocumentRowCount
  ) throw new Error("TRUSTED_LKG_CURRENT_MEETINGS_PARTITION_FACT_SET_MISMATCH");
  const manualCandidates = plan.candidates.filter(({ door }) => door === "MANUAL");
  const overlay: PdcV2TrustedLkgImportPlan = {
    ...plan,
    candidates: [...meetingCandidates, ...manualCandidates]
      .sort((left, right) => left.contractId.localeCompare(right.contractId)),
    meetingPartitionIdsWithLkg: withLkg,
    meetingPartitionIdsWithoutLkg: withoutLkg,
    meetingRows: replacementFacts.meetingRowCount,
    agendaDocumentRows: replacementFacts.agendaDocumentRowCount,
  };
  const issue = pdcV2PermanentCutoverPlanIssue(overlay);
  if (issue !== null) throw new Error(`TRUSTED_LKG_CURRENT_MEETINGS_OVERLAY_REFUSED:${issue}`);
  return overlay;
}

async function pdcV2LegacyMeetingsRetirementInput(
  store: RoutineDataStore,
  plan: PdcV2TrustedLkgImportPlan,
  admittedLegacyAuthority: PdcV2ProvenLegacyMeetingsAuthority | null = null,
): Promise<PdcV2LegacyMeetingsRetirementInput> {
  const allPermanentPartitionScopes = MEETING_PARTITION_CONTRACTS
    .map(({ scope }) => scope)
    .sort();
  const pointers = await store.readPromotions("MEETING", allPermanentPartitionScopes);
  const replacementPointers = pointers
    .map((pointer) => {
      if (
        pointer.sourceId !== PDC_V2_LEGACY_MEETINGS_SOURCE_ID ||
        pointer.recordClass !== "MEETING" ||
        pointer.key !== projectionKey("MEETING", pointer.scope) ||
        pointer.versionId !== pointer.lastKnownGoodVersionId
      ) throw new Error(`TRUSTED_LKG_MEETING_REPLACEMENT_POINTER_INVALID:${pointer.scope}`);
      return {
        scope: pointer.scope,
        versionId: pointer.versionId,
        payload: structuredClone(pointer.payload),
        receipt: structuredClone(pointer.receipt),
      };
    })
    .sort((left, right) => left.scope.localeCompare(right.scope));
  if (
    replacementPointers.length !== PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.meetingPartitionsWithLkg ||
    allPermanentPartitionScopes.length - replacementPointers.length !==
      PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.meetingPartitionsWithoutLkg
  ) {
    throw new Error(
      `TRUSTED_LKG_MEETING_REPLACEMENT_POINTER_DENOMINATOR_INVALID:` +
      `${replacementPointers.length}/${allPermanentPartitionScopes.length}`,
    );
  }
  const replacementFacts = pdcV2CanonicalMeetingFactEvidence(
    replacementPointers.map(({ payload }) => payload),
  );
  const legacyPointer = await store.readPromotion<MeetingsSnapshot>(
    "MEETING",
    PDC_V2_LEGACY_MEETINGS_SCOPE,
  );
  if (
    admittedLegacyAuthority !== null &&
    (
      legacyPointer === null ||
      trustedLkgPredecessorPointerSha256(legacyPointer) !==
        trustedLkgPredecessorPointerSha256(admittedLegacyAuthority.pointer)
    )
  ) throw new Error("TRUSTED_LKG_LEGACY_MEETINGS_CHANGED_BEFORE_RETIREMENT");
  if (admittedLegacyAuthority === null && legacyPointer !== null) {
    throw new Error("TRUSTED_LKG_LEGACY_MEETINGS_UNADMITTED_AT_RETIREMENT");
  }
  if (
    legacyPointer &&
    canonicalMeetingFactSha256(legacyPointer.payload) !== replacementFacts.sha256
  ) {
    throw new Error("TRUSTED_LKG_LEGACY_MEETINGS_CHANGED_BEFORE_RETIREMENT");
  }
  const retirementLowerBound = [
    ...pointers.map(({ promotedAt }) => promotedAt),
    ...(legacyPointer ? [legacyPointer.promotedAt] : []),
    plan.importedAt,
  ].sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? plan.importedAt;
  return {
    retiredAt: promotionReaderReadbackObservedAt(
      store,
      plan.importedAt,
      retirementLowerBound,
    ),
    expected: {
      contractVersion: 1,
      frozenBaseSha: plan.frozenBaseSha,
      importerCodeSha: plan.importerCodeSha,
      legacyMeetingFactSha256: replacementFacts.sha256,
      replacementPointerSha256: sha256(canonicalCivicDataJson(replacementPointers)),
      replacementPartitionCount: replacementPointers.length,
      absentPartitionCount: allPermanentPartitionScopes.length - replacementPointers.length,
      meetingRowCount: replacementFacts.meetingRowCount,
      agendaDocumentRowCount: replacementFacts.agendaDocumentRowCount,
    },
    observedLegacyPayload: admittedLegacyAuthority
      ? structuredClone(admittedLegacyAuthority.pointer.payload)
      : null,
    observedLegacyVersionId: admittedLegacyAuthority?.pointer.versionId ?? null,
    observedLegacyPointerSha256: admittedLegacyAuthority
      ? trustedLkgPredecessorPointerSha256(admittedLegacyAuthority.pointer)
      : null,
    observedLegacyCandidateRecord: admittedLegacyAuthority
      ? structuredClone(admittedLegacyAuthority.candidate)
      : null,
    observedLegacyCandidateRecordSha256: admittedLegacyAuthority
      ? trustedLkgPredecessorRecordSha256(admittedLegacyAuthority.candidate)
      : null,
    observedLegacyEvents: admittedLegacyAuthority
      ? structuredClone(admittedLegacyAuthority.events)
      : null,
    observedLegacyHistorySha256: admittedLegacyAuthority
      ? trustedLkgEvidenceSha256(admittedLegacyAuthority.events)
      : null,
    replacementPointers,
    allPermanentPartitionScopes,
  };
}

async function readAndProvePdcV2LegacyMeetingsAuthority(
  store: RoutineDataStore,
  plan: PdcV2TrustedLkgImportPlan,
): Promise<PdcV2ProvenLegacyMeetingsAuthority | null> {
  const pointer = await store.readPromotion<MeetingsSnapshot>("MEETING", PDC_V2_LEGACY_MEETINGS_SCOPE);
  if (pointer === null) return null;
  if (
    pointer.key !== `MEETING:${PDC_V2_LEGACY_MEETINGS_SCOPE}` ||
    pointer.sourceId !== PDC_V2_LEGACY_MEETINGS_SOURCE_ID ||
    pointer.recordClass !== "MEETING" ||
    pointer.scope !== PDC_V2_LEGACY_MEETINGS_SCOPE ||
    pointer.versionId !== pointer.lastKnownGoodVersionId
  ) throw new Error("TRUSTED_LKG_LEGACY_MEETINGS_POINTER_IDENTITY_INVALID");
  const candidate = await store.readCandidate(pointer.versionId);
  if (!candidate) {
    throw new Error(`TRUSTED_LKG_LEGACY_MEETINGS_CANDIDATE_MISSING:${pointer.versionId}`);
  }
  if (candidate.candidate.bootstrapImport !== undefined) {
    throw new Error("TRUSTED_LKG_LEGACY_MEETINGS_TRANSFER_MARKER_INVALID");
  }
  const proofIssue = pdcV2LegacyMeetingsPromotionProofIssue(pointer, candidate);
  if (proofIssue !== null) {
    throw new Error(`TRUSTED_LKG_LEGACY_MEETINGS_PROOF_INVALID:${proofIssue}`);
  }
  const events = [...await store.events(pointer.versionId)]
    .sort((left, right) => left.sequence - right.sequence);
  const historyIssue = durablePointerHistoryIssue(
    candidate,
    pointer,
    events,
    plan.importedAt,
  );
  if (historyIssue !== null) {
    throw new Error(`TRUSTED_LKG_LEGACY_MEETINGS_HISTORY_INVALID:${historyIssue}`);
  }
  return {
    pointer: structuredClone(pointer),
    candidate: structuredClone(candidate),
    events: structuredClone(events),
  };
}

function pdcV2LegacyMeetingsAuthorityWitnessSha256(
  authority: PdcV2ProvenLegacyMeetingsAuthority,
): string {
  const events = [...authority.events].sort((left, right) => left.sequence - right.sequence);
  return trustedLkgEvidenceSha256({
    pointerSha256: trustedLkgPredecessorPointerSha256(authority.pointer),
    candidateRecordSha256: trustedLkgPredecessorRecordSha256(authority.candidate),
    historySha256: trustedLkgEvidenceSha256(events),
    historyEventCount: events.length,
    historyLastSequence: events.at(-1)?.sequence ?? 0,
  });
}

async function assertPdcV2LegacyMeetingsAuthorityUnchanged(
  store: RoutineDataStore,
  plan: PdcV2TrustedLkgImportPlan,
  expected: PdcV2ProvenLegacyMeetingsAuthority,
): Promise<void> {
  let observed: PdcV2ProvenLegacyMeetingsAuthority | null;
  try {
    observed = await readAndProvePdcV2LegacyMeetingsAuthority(store, plan);
  } catch {
    throw new Error("TRUSTED_LKG_LEGACY_MEETINGS_CHANGED_BEFORE_FIRST_WRITE");
  }
  if (
    observed === null ||
    pdcV2LegacyMeetingsAuthorityWitnessSha256(observed) !==
      pdcV2LegacyMeetingsAuthorityWitnessSha256(expected)
  ) throw new Error("TRUSTED_LKG_LEGACY_MEETINGS_CHANGED_BEFORE_FIRST_WRITE");
}

async function pdcV2RetiredMeetingsOverlayPlan(
  store: RoutineDataStore,
  plan: PdcV2TrustedLkgImportPlan,
  retirement: PdcV2LegacyMeetingsRetirementResult,
): Promise<PdcV2TrustedLkgImportPlan> {
  const allScopes = MEETING_PARTITION_CONTRACTS.map(({ scope }) => scope).sort();
  const pointers = [...await store.readPromotions<MeetingsSnapshot>("MEETING", allScopes)]
    .sort((left, right) => left.scope.localeCompare(right.scope));
  if (
    pointers.length !== PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.meetingPartitionsWithLkg ||
    allScopes.length - pointers.length !== PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.meetingPartitionsWithoutLkg
  ) throw new Error("TRUSTED_LKG_RETIRED_MEETING_REPLAY_DENOMINATOR_INVALID");
  for (const pointer of pointers) {
    const contract = MEETING_PARTITION_CONTRACTS.find(({ scope }) => scope === pointer.scope);
    const row = await store.readCandidate(pointer.versionId);
    const candidate = row?.candidate;
    if (
      !contract || !row || !candidate ||
      pointer.key !== projectionKey("MEETING", pointer.scope) ||
      pointer.sourceId !== PDC_V2_LEGACY_MEETINGS_SOURCE_ID ||
      pointer.recordClass !== "MEETING" ||
      pointer.versionId !== pointer.lastKnownGoodVersionId ||
      candidate.scope !== pointer.scope ||
      canonicalCivicDataJson(candidate.readModel) !== canonicalCivicDataJson(pointer.payload)
    ) throw new Error(`TRUSTED_LKG_RETIRED_MEETING_REPLAY_ORIGIN_INVALID:${pointer.scope}`);
  }
  const legacyCandidate = await store.readCandidate(retirement.legacyVersionId);
  const legacyReceipt = legacyCandidate?.receipt;
  const allLegacyEvents = legacyCandidate
    ? [...await store.events(retirement.legacyVersionId)].sort((left, right) => left.sequence - right.sequence)
    : [];
  const retirementEvents = allLegacyEvents.filter((event) =>
    event.detail === retirement.detail &&
    event.at === retirement.retiredAt &&
    event.candidateId === retirement.legacyVersionId
  );
  const legacyEvents = allLegacyEvents.filter((event) => event.detail !== retirement.detail);
  const firstPromotion = legacyEvents.find(({ state }) => state === "PROMOTED");
  if (
    !legacyCandidate || !legacyReceipt || legacyCandidate.candidate.bootstrapImport !== undefined ||
    retirementEvents.length !== 1 || !firstPromotion
  ) {
    throw new Error("TRUSTED_LKG_RETIRED_MEETING_REPLAY_LEGACY_EVIDENCE_MISSING");
  }
  const reconstructedPointer: PromotedProjection<MeetingsSnapshot> = {
    key: `MEETING:${PDC_V2_LEGACY_MEETINGS_SCOPE}`,
    sourceId: PDC_V2_LEGACY_MEETINGS_SOURCE_ID,
    recordClass: "MEETING",
    scope: PDC_V2_LEGACY_MEETINGS_SCOPE,
    versionId: retirement.legacyVersionId,
    lastKnownGoodVersionId: retirement.legacyVersionId,
    promotedAt: firstPromotion.at,
    payload: structuredClone(legacyCandidate.candidate.readModel as MeetingsSnapshot),
    receipt: structuredClone(legacyReceipt),
  };
  const aggregateFacts = pdcV2CanonicalMeetingFactEvidence(
    pointers.map(({ payload }) => payload),
  );
  if (
    pdcV2LegacyMeetingsPromotionProofIssue(reconstructedPointer, legacyCandidate) !== null ||
    durablePointerHistoryIssue(
      legacyCandidate,
      reconstructedPointer,
      legacyEvents,
      retirement.retiredAt,
    ) !== null ||
    aggregateFacts.sha256 !== canonicalMeetingFactSha256(reconstructedPointer.payload)
  ) throw new Error("TRUSTED_LKG_RETIRED_MEETING_REPLAY_DURABLE_ORIGIN_INVALID");
  const overlay = pdcV2CurrentLegacyMeetingsOverlayPlan(plan, {
    pointer: reconstructedPointer,
    candidate: legacyCandidate,
    events: legacyEvents,
  });
  const overlayScopes = new Set(
    overlay.meetingPartitionIdsWithLkg.map((id) => requiredMeetingPartitionContract(id).scope),
  );
  if (
    pointers.some(({ scope }) => !overlayScopes.has(scope)) ||
    overlayScopes.size !== pointers.length
  ) throw new Error("TRUSTED_LKG_RETIRED_MEETING_REPLAY_PARTITION_MEMBERSHIP_INVALID");
  return overlay;
}

async function provePdcV2PermanentMeetingsReplacement(
  store: RoutineDataStore,
  plan: PdcV2TrustedLkgImportPlan,
  retirementInput: PdcV2LegacyMeetingsRetirementInput,
): Promise<void> {
  const observedAt = promotionReaderReadbackObservedAt(
    store,
    plan.importedAt,
    plan.importedAt,
  );
  const read = await readMeetingsProjection({
    store,
    now: observedAt,
    bypassCache: true,
    allowUnconfiguredBootstrap: false,
  });
  if (read.kind !== "PROMOTED") {
    throw new Error(`TRUSTED_LKG_MEETING_REPLACEMENT_READER_FAILED:${read.kind}:${read.detail}`);
  }
  const expectedByScope = new Map(
    retirementInput.replacementPointers.map(({ scope, versionId }) => [scope, versionId] as const),
  );
  const invalid = read.partitions.filter((partition) => {
    const expectedVersionId = expectedByScope.get(partition.scope);
    return expectedVersionId === undefined
      ? partition.kind !== "NOT_RECORDED" || partition.versionId !== null
      : partition.kind !== "PROMOTED" || partition.versionId !== expectedVersionId;
  });
  if (
    read.partitions.length !== MEETING_PARTITION_CONTRACTS.length ||
    invalid.length > 0 ||
    pdcV2CanonicalMeetingFactEvidence([read.value]).sha256 !==
      retirementInput.expected.legacyMeetingFactSha256
  ) {
    throw new Error(
      `TRUSTED_LKG_MEETING_REPLACEMENT_READER_MISMATCH:${read.partitions.length}:` +
      `${invalid.map(({ contractId }) => contractId).join(",") || "FACT_SET"}`,
    );
  }
}

async function reattestationPreflight(
  store: RoutineDataStore,
  target: PdcV2TrustedLkgTarget,
  pointer: import("./types.ts").PromotedProjection,
  predecessor: CandidateVersionRecord,
  plan: PdcV2TrustedLkgImportPlan,
): Promise<RoutineCandidate> {
  const candidate = buildPdcV2TrustedLkgReattestationCandidate({
    contract: target.contract,
    pointer,
    predecessor,
    reattestedAt: plan.importedAt,
    importerCodeSha: plan.importerCodeSha,
  });
  const sourceProjection = await verifySourceScopedCandidateProjection(
    target.contract,
    candidate,
    plan.importedAt,
    predecessor,
  );
  const validated = validateRoutineCandidate(candidate, predecessor, plan.importedAt, [{
    consumer: `${sourceProjection.verifierId} (source-scoped pre-promotion)`,
    passed: sourceProjection.status === "PASS",
    detail: sourceProjection.detail,
  }]);
  if (validated.state !== "VALIDATED" || validated.receipt.decision !== "GOOD") {
    const failed = validated.receipt.checks.find(({ verdict }) => verdict !== "PASS");
    throw new Error(
      `TRUSTED_LKG_REATTESTATION_PREFLIGHT_REFUSED:${target.contractId}:` +
      `${failed?.code ?? validated.state}:${failed?.detail ?? "candidate was not GOOD"}`,
    );
  }
  // Confirm the observed pointer did not move during the read-only typed
  // preflight. The later promotion still performs its own atomic CAS.
  const observed = await store.readPromotion(target.contract.recordClass, target.contract.scope);
  const evidence = candidate.bootstrapImport;
  if (!evidence || evidence.kind !== "TRUSTED_LKG_REATTESTATION") {
    throw new Error(`TRUSTED_LKG_REATTESTATION_EVIDENCE_MISSING:${target.contractId}`);
  }
  if (!observed || trustedLkgPredecessorPointerSha256(observed) !== evidence.predecessorPointerSha256) {
    throw new Error(
      `TRUSTED_LKG_REATTESTATION_PREFLIGHT_POINTER_CHANGED:${target.contractId}:` +
      `${pointer.versionId}:${observed?.versionId ?? "ABSENT"}`,
    );
  }
  return candidate;
}

/**
 * Close the only non-atomic seam in a registered promotion: the canonical
 * pointer and candidate move atomically, then its typed Reader observation is
 * appended. If the process dies between those operations, a replay proves the
 * same pointer and records the missing receipt without rewriting authority.
 */
async function ensureDurableTrustedReaderReadback(
  store: RoutineDataStore,
  contract: TrustedLkgRegisteredContract,
  expectedVersionId: string,
  now: string,
  importerCodeSha: string,
): Promise<void> {
  const projectionId = contract.readerProjection?.id ?? sourceScopedReaderReadbackProjectionId(contract.id);
  const marked = (await store.events(expectedVersionId))
    .filter((event) => event.detail.startsWith(READER_PROJECTION_READBACK_PREFIX))
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at) || right.sequence - left.sequence);
  const latest = marked[0] ? parseReaderProjectionReadback(marked[0].detail) : null;
  if (
    latest?.status === "PASS" &&
    latest.contractId === contract.id &&
    latest.sourceId === contract.sourceId &&
    latest.recordClass === contract.recordClass &&
    latest.scope === contract.scope &&
    latest.projectionId === projectionId &&
    latest.versionId === expectedVersionId &&
    latest.pointerKey === projectionKey(contract.recordClass, contract.scope) &&
    latest.verifierCodeSha === importerCodeSha
  ) {
    return;
  }
  const pointer = await store.readPromotion(contract.recordClass, contract.scope);
  if (!pointer || pointer.versionId !== expectedVersionId) {
    throw new Error(
      `TRUSTED_LKG_READBACK_REPAIR_BASE_CHANGED:${contract.id}:` +
      `${expectedVersionId}:${pointer?.versionId ?? "ABSENT"}`,
    );
  }
  const observedAt = promotionReaderReadbackObservedAt(
    store,
    now,
    pointer.promotedAt,
  );
  let receipt: ReaderProjectionReadbackReceipt | null;
  if (contract.readerProjection === null) {
    const candidate = await store.readCandidate(expectedVersionId);
    if (!candidate) {
      throw new Error(`TRUSTED_LKG_READBACK_REPAIR_CANDIDATE_MISSING:${contract.id}:${expectedVersionId}`);
    }
    const transferEvidence = candidate.candidate.bootstrapImport;
    const predecessorVersionId = transferEvidence?.kind === "TRUSTED_LKG_REATTESTATION"
      ? transferEvidence.predecessorVersionId
      : transferEvidence?.kind === "TRUSTED_LKG_IMPORT"
        ? transferEvidence.pimaOutcomeUnion?.predecessorVersionId ?? null
        : null;
    const predecessor = predecessorVersionId === null
      ? null
      : await store.readCandidate(predecessorVersionId);
    const verification = await verifySourceScopedCandidateProjection(
      contract,
      candidate.candidate,
      observedAt,
      predecessor,
    );
    const verifierCodeSha = normalizeReaderCodeSha(importerCodeSha);
    receipt = {
      contractVersion: 2,
      kind: "READER_PROJECTION_READBACK",
      contractId: contract.id,
      sourceId: contract.sourceId,
      recordClass: contract.recordClass,
      scope: contract.scope,
      projectionId,
      versionId: expectedVersionId,
      pointerKey: pointer.key,
      observedAt,
      evidenceKind: READER_READBACK_EVIDENCE_KIND,
      verifierId: verification.verifierId,
      verifierCodeSha,
      status: verifierCodeSha === null ? "FAIL" : verification.status,
      detail: verifierCodeSha === null
        ? `The source-scoped projection result cannot be certified because its executing code commit was not resolvable. ${verification.detail}`
        : verification.detail,
    };
    await store.appendEvidence(
      expectedVersionId,
      "PROMOTED",
      observedAt,
      serializeReaderProjectionReadback(receipt),
    );
  } else {
    receipt = await recordRoutineReaderProjectionReadback(
      store,
      contract,
      pointer,
      observedAt,
      importerCodeSha,
    );
  }
  if (receipt?.status !== "PASS" || receipt.versionId !== expectedVersionId) {
    throw new Error(
      `TRUSTED_LKG_READBACK_REPAIR_FAILED:${contract.id}:` +
      `${receipt?.status ?? "MISSING"}:${receipt?.detail ?? "no receipt"}`,
    );
  }
  await proveRegisteredContractVersion(store, contract, expectedVersionId, observedAt);
}

/**
 * Seed absent frozen pointers and upgrade only the exact legacy authorities
 * which predate permanent digest/projection binding. Every existing target is
 * read and proved (or fully prepared for re-attestation) before the first
 * write. Re-attestation is a no-data-change CAS successor, never compatibility
 * acceptance of the legacy row.
 */
export async function executePdcV2TrustedLkgImportPlan(
  store: RoutineDataStore,
  plan: PdcV2TrustedLkgImportPlan,
  options: {
    /** Production terminal wrapper's exact global gate, after all read-only preparation. */
    readonly beforeFirstWrite?: (
      prospectiveReattestationPredecessorIds: readonly string[],
    ) => Promise<void>;
  } = {},
): Promise<PdcV2TrustedLkgImportResult> {
  const targets = trustedLkgTargets(plan);
  const existing = new Map<string, {
    readonly versionId: string;
    readonly target: PdcV2TrustedLkgTarget;
    readonly disposition: "PROVEN" | "REATTEST" | "UNION";
    readonly candidate: RoutineCandidate | null;
  }>();
  for (const target of targets) {
    const pointer = await store.readPromotion(target.contract.recordClass, target.contract.scope);
    if (!pointer) continue;
    if (pointer.sourceId !== target.contract.sourceId) {
      throw new Error(
        `TRUSTED_LKG_EXISTING_POINTER_SOURCE_MISMATCH:${target.contractId}:` +
        `${pointer.sourceId}:${target.contract.sourceId}`,
      );
    }
    const predecessor = await store.readCandidate(pointer.versionId);
    if (!predecessor) {
      throw new Error(`TRUSTED_LKG_CANDIDATE_READBACK_MISSING:${target.contractId}:${pointer.versionId}`);
    }
    if (predecessor.candidate.sourceId !== target.contract.sourceId) {
      throw new Error(
        `TRUSTED_LKG_EXISTING_CANDIDATE_SOURCE_MISMATCH:${target.contractId}:` +
        `${predecessor.candidate.sourceId}:${target.contract.sourceId}`,
      );
    }
    if (target.contractId === "pima-legistar-outcomes" && target.planned) {
      try {
        await proveRegisteredContractVersion(
          store,
          target.contract,
          pointer.versionId,
          plan.importedAt,
        );
      } catch (strictError) {
        // A pre-PDC pointer may lack only the modern integrity envelope. Prove
        // that the exact immutable row is re-attestable, but let the union
        // successor perform both repairs in one CAS/promotion.
        try {
          await reattestationPreflight(store, target, pointer, predecessor, plan);
        } catch (error) {
          throw new Error(
            `TRUSTED_LKG_EXISTING_AUTHORITY_NOT_UNIONABLE:${target.contractId}:` +
            `${error instanceof Error ? error.message : String(error)}:` +
            `STRICT_PROOF=${strictError instanceof Error ? strictError.message : String(strictError)}`,
          );
        }
      }
      const frozen = target.planned.candidate.readModel as OutcomeSnapshot;
      const union = pdcV2UnionPimaOutcomeSnapshots(frozen, pointer.payload as OutcomeSnapshot);
      if (canonicalCivicDataJson(union) === canonicalCivicDataJson(pointer.payload)) {
        existing.set(target.contractId, {
          versionId: pointer.versionId,
          target,
          disposition: "PROVEN",
          candidate: null,
        });
      } else {
        existing.set(target.contractId, {
          versionId: pointer.versionId,
          target,
          disposition: "UNION",
          candidate: pdcV2PimaOutcomeUnionCandidate(
            target.planned,
            pointer as PromotedProjection<OutcomeSnapshot>,
            predecessor,
            plan.importedAt,
            plan.importerCodeSha,
          ),
        });
      }
      continue;
    }
    const plannedImport = target.planned?.candidate.bootstrapImport;
    const existingImport = predecessor.candidate.bootstrapImport;
    const plannedLegacyOrigin = plannedImport?.kind === "TRUSTED_LKG_IMPORT"
      ? plannedImport.legacyMeetingsPartition
      : undefined;
    let existingLegacyOrigin = existingImport?.kind === "TRUSTED_LKG_IMPORT"
      ? existingImport.legacyMeetingsPartition
      : undefined;
    if (
      plannedLegacyOrigin &&
      existingImport?.kind === "TRUSTED_LKG_REATTESTATION"
    ) {
      const namedPredecessor = await store.readCandidate(existingImport.predecessorVersionId);
      if (
        namedPredecessor === null ||
        namedPredecessor.candidate.id !== existingImport.predecessorVersionId ||
        trustedLkgPredecessorRecordSha256(namedPredecessor) !==
          existingImport.predecessorCandidateRecordSha256
      ) {
        throw new Error(
          `TRUSTED_LKG_EXISTING_MEETING_LEGACY_ORIGIN_PREDECESSOR_INVALID:` +
          target.contractId,
        );
      }
      const predecessorImport = namedPredecessor?.candidate.bootstrapImport;
      existingLegacyOrigin = predecessorImport?.kind === "TRUSTED_LKG_IMPORT"
        ? predecessorImport.legacyMeetingsPartition
        : undefined;
    }
    if (
      plannedLegacyOrigin && existingLegacyOrigin &&
      canonicalCivicDataJson(trustedLkgLegacyMeetingsCommonOrigin(existingLegacyOrigin)) !==
        canonicalCivicDataJson(trustedLkgLegacyMeetingsCommonOrigin(plannedLegacyOrigin))
    ) {
      throw new Error(`TRUSTED_LKG_EXISTING_MEETING_LEGACY_ORIGIN_MISMATCH:${target.contractId}`);
    }
    try {
      await proveRegisteredContractVersion(
        store,
        target.contract,
        pointer.versionId,
        plan.importedAt,
      );
      existing.set(target.contractId, {
        versionId: pointer.versionId,
        target,
        disposition: "PROVEN",
        candidate: null,
      });
    } catch (strictError) {
      let candidate: RoutineCandidate;
      try {
        candidate = await reattestationPreflight(store, target, pointer, predecessor, plan);
      } catch (error) {
        throw new Error(
          `TRUSTED_LKG_EXISTING_AUTHORITY_NOT_REATTESTABLE:${target.contractId}:` +
          `${error instanceof Error ? error.message : String(error)}:` +
          `STRICT_PROOF=${strictError instanceof Error ? strictError.message : String(strictError)}`,
        );
      }
      existing.set(target.contractId, {
        versionId: pointer.versionId,
        target,
        disposition: "REATTEST",
        candidate,
      });
    }
  }

  await options.beforeFirstWrite?.(
    [...existing.values()]
      .filter(({ disposition }) => disposition === "REATTEST" || disposition === "UNION")
      .map(({ versionId }) => versionId)
      .sort(),
  );

  const dispositions: PdcV2TrustedLkgImportDisposition[] = [];
  for (const target of targets) {
    const existingAuthority = existing.get(target.contractId);
    if (existingAuthority) {
      if (existingAuthority.disposition === "UNION") {
        const candidate = existingAuthority.candidate;
        const origin = candidate?.bootstrapImport?.kind === "TRUSTED_LKG_IMPORT"
          ? candidate.bootstrapImport.pimaOutcomeUnion
          : null;
        if (!candidate || !origin) {
          throw new Error(`TRUSTED_LKG_PIMA_OUTCOME_UNION_CANDIDATE_MISSING:${target.contractId}`);
        }
        const observed = await store.readPromotion(target.contract.recordClass, target.contract.scope);
        if (
          !observed || observed.versionId !== existingAuthority.versionId ||
          trustedLkgPredecessorPointerSha256(observed) !== origin.predecessorPointerSha256
        ) {
          throw new Error(
            `TRUSTED_LKG_PIMA_OUTCOME_UNION_BASE_CHANGED:${target.contractId}:` +
            `${existingAuthority.versionId}:${observed?.versionId ?? "ABSENT"}`,
          );
        }
        const outcome = await processRegisteredManualCandidate(
          store,
          "pima-legistar-outcomes",
          candidate,
          plan.importedAt,
          existingAuthority.versionId,
        );
        if (!outcome.promoted || outcome.candidate.state !== "PROMOTED") {
          throw new Error(
            `TRUSTED_LKG_PIMA_OUTCOME_UNION_PROMOTION_REFUSED:` +
            `${outcome.candidate.failureCode ?? outcome.candidate.state}:` +
            `${outcome.candidate.failureDetail ?? "no detail"}`,
          );
        }
        if (outcome.readerReadback?.status !== "PASS") {
          throw new Error(
            `TRUSTED_LKG_PIMA_OUTCOME_UNION_READER_READBACK_FAILED:` +
            `${outcome.readerReadback?.detail ?? "missing receipt"}`,
          );
        }
        await proveRegisteredContractVersion(
          store,
          target.contract,
          candidate.id,
          plan.importedAt,
        );
        await ensureDurableTrustedReaderReadback(
          store,
          target.contract,
          candidate.id,
          plan.importedAt,
          plan.importerCodeSha,
        );
        dispositions.push({
          contractId: target.contractId,
          candidateId: candidate.id,
          disposition: "PROMOTED_FROZEN_LKG_UNION",
          versionId: outcome.promoted.versionId,
          readerReadback: "PASS",
        });
        continue;
      }
      if (existingAuthority.disposition === "PROVEN") {
        // Reprove immediately before recording the skip so a concurrent
        // pointer move cannot make this receipt describe a stale observation.
        await proveRegisteredContractVersion(
          store,
          target.contract,
          existingAuthority.versionId,
          plan.importedAt,
        );
        await ensureDurableTrustedReaderReadback(
          store,
          target.contract,
          existingAuthority.versionId,
          plan.importedAt,
          plan.importerCodeSha,
        );
        dispositions.push({
          contractId: target.contractId,
          candidateId: target.planned?.candidate.id ?? existingAuthority.versionId,
          disposition: "SKIPPED_EXISTING_PROVEN_AUTHORITY",
          versionId: existingAuthority.versionId,
          readerReadback: "PASS",
        });
        continue;
      }
      const candidate = existingAuthority.candidate;
      if (!candidate) throw new Error(`TRUSTED_LKG_REATTESTATION_CANDIDATE_MISSING:${target.contractId}`);
      const observed = await store.readPromotion(target.contract.recordClass, target.contract.scope);
      const transferEvidence = candidate.bootstrapImport;
      if (!transferEvidence || transferEvidence.kind !== "TRUSTED_LKG_REATTESTATION") {
        throw new Error(`TRUSTED_LKG_REATTESTATION_EVIDENCE_MISSING:${target.contractId}`);
      }
      if (
        !observed ||
        observed.versionId !== existingAuthority.versionId ||
        trustedLkgPredecessorPointerSha256(observed) !== transferEvidence.predecessorPointerSha256
      ) {
        throw new Error(
          `TRUSTED_LKG_REATTESTATION_BASE_CHANGED:${target.contractId}:` +
          `${existingAuthority.versionId}:${observed?.versionId ?? "ABSENT"}`,
        );
      }
      let outcome: PromotionOutcome;
      if (target.door === "ROUTINE") {
        outcome = await processRegisteredRoutineCandidate(
          store,
          target.contractId,
          candidate,
          plan.importedAt,
          existingAuthority.versionId,
        );
      } else if (target.door === "MEETING_PARTITION") {
        outcome = await processRegisteredMeetingPartitionCandidate(
          store,
          target.contractId,
          candidate,
          plan.importedAt,
          existingAuthority.versionId,
        );
      } else {
        outcome = await processRegisteredManualCandidate(
          store,
          target.contractId as ManualProductionContractId,
          candidate,
          plan.importedAt,
          existingAuthority.versionId,
        );
      }
      if (!outcome.promoted || outcome.candidate.state !== "PROMOTED") {
        throw new Error(
          `TRUSTED_LKG_REATTESTATION_PROMOTION_REFUSED:${target.contractId}:` +
          `${outcome.candidate.failureCode ?? outcome.candidate.state}:` +
          `${outcome.candidate.failureDetail ?? "no detail"}`,
        );
      }
      if (target.contract.readerProjection !== null && outcome.readerReadback?.status !== "PASS") {
        throw new Error(
          `TRUSTED_LKG_REATTESTATION_READER_READBACK_FAILED:${target.contractId}:` +
          `${outcome.readerReadback?.detail ?? "missing receipt"}`,
        );
      }
      await proveRegisteredContractVersion(
        store,
        target.contract,
        candidate.id,
        plan.importedAt,
      );
      await ensureDurableTrustedReaderReadback(
        store,
        target.contract,
        candidate.id,
        plan.importedAt,
        plan.importerCodeSha,
      );
      dispositions.push({
        contractId: target.contractId,
        candidateId: candidate.id,
        disposition: "REATTESTED_EXISTING_AUTHORITY",
        versionId: outcome.promoted.versionId,
        readerReadback: "PASS",
      });
      continue;
    }
    const planned = target.planned;
    // Routine authorities are never seeded from repository fixtures. Their
    // absent pointer remains due for the standing source acquisition.
    if (!planned) continue;
    let outcome: PromotionOutcome;
    if (planned.door === "MEETING_PARTITION") {
      outcome = await processRegisteredMeetingPartitionCandidate(
        store,
        planned.contractId,
        planned.candidate,
        plan.importedAt,
        null,
      );
    } else {
      outcome = await processRegisteredManualCandidate(
        store,
        planned.contractId as ManualProductionContractId,
        planned.candidate,
        plan.importedAt,
        null,
      );
    }
    if (!outcome.promoted || outcome.candidate.state !== "PROMOTED") {
      throw new Error(
        `TRUSTED_LKG_PROMOTION_REFUSED:${planned.contractId}:${outcome.candidate.failureCode ?? outcome.candidate.state}:${outcome.candidate.failureDetail ?? "no detail"}`,
      );
    }
    if (outcome.readerReadback?.status !== "PASS") {
      throw new Error(`TRUSTED_LKG_DURABLE_READER_READBACK_FAILED:${planned.contractId}:${outcome.readerReadback?.detail ?? "missing receipt"}`);
    }
    await proveCanonicalVersion(store, planned, planned.candidate.id, plan.importedAt);
    dispositions.push({
      contractId: planned.contractId,
      candidateId: planned.candidate.id,
      disposition: "PROMOTED_ABSENT_POINTER",
      versionId: outcome.promoted.versionId,
      readerReadback: "PASS",
    });
  }
  const promoted = dispositions.filter(({ disposition }) =>
    disposition === "PROMOTED_ABSENT_POINTER" ||
    disposition === "PROMOTED_FROZEN_LKG_UNION" ||
    disposition === "REATTESTED_EXISTING_AUTHORITY"
  ).length;
  const reattestedExisting = dispositions.filter(({ disposition }) =>
    disposition === "REATTESTED_EXISTING_AUTHORITY"
  ).length;
  const skippedExisting = dispositions.filter(({ disposition }) =>
    disposition === "SKIPPED_EXISTING_PROVEN_AUTHORITY"
  ).length;
  return {
    contractVersion: 1,
    frozenBaseSha: plan.frozenBaseSha,
    importerCodeSha: plan.importerCodeSha,
    importedAt: plan.importedAt,
    promoted,
    reattestedExisting,
    skippedExisting,
    zeroMeetingPartitionsRefused: plan.meetingPartitionIdsWithoutLkg.length,
    dispositions,
    zeroMeetingPartitionIds: plan.meetingPartitionIdsWithoutLkg,
  };
}

/**
 * The only production cutover executor. The generic target executor above is
 * retained solely so focused re-attestation tests can exercise one contract;
 * only this wrapper is called by the exact attested CLI. It binds the frozen
 * full denominator to the obsolete aggregate's durable, terminal retirement.
 */
export async function executePdcV2PermanentCutoverImportPlan(
  store: RoutineDataStore,
  plan: PdcV2TrustedLkgImportPlan,
  contractMigrationSql: string,
): Promise<PdcV2PermanentCutoverImportResult> {
  const planIssue = pdcV2PermanentCutoverPlanIssue(plan);
  if (planIssue !== null) {
    throw new Error(`TRUSTED_LKG_PERMANENT_CUTOVER_PLAN_REFUSED:${planIssue}`);
  }
  await store.assertPdcV2PreContractMigrationState();
  const legacyAuthority = await readAndProvePdcV2LegacyMeetingsAuthority(store, plan);
  let effectivePlan: PdcV2TrustedLkgImportPlan;
  if (legacyAuthority) {
    effectivePlan = pdcV2CurrentLegacyMeetingsOverlayPlan(plan, legacyAuthority);
  } else {
    // A replay after the exact end-of-import retirement is valid only when its
    // durable receipt and every exact replacement pointer are still present.
    const retirement = await store.retirePdcV2LegacyMeetingsAggregate(
      await pdcV2LegacyMeetingsRetirementInput(store, plan),
    );
    effectivePlan = await pdcV2RetiredMeetingsOverlayPlan(store, plan, retirement);
  }
  const result = await executePdcV2TrustedLkgImportPlan(store, effectivePlan, {
    beforeFirstWrite: async (prospectiveReattestationPredecessorIds) => {
      await store.assertPdcV2PreImportDataIntegrity(
        contractMigrationSql,
        prospectiveReattestationPredecessorIds,
      );
      // This is deliberately the last read before the generic executor's
      // first create: the overlay may never describe an aggregate which moved
      // after it was partitioned and admitted.
      if (legacyAuthority) {
        await assertPdcV2LegacyMeetingsAuthorityUnchanged(store, plan, legacyAuthority);
      }
    },
  });
  // Re-run the same global predicates without prospective exemptions. Every
  // successor and readback event now exists, so this proves the import itself
  // is 0026-compatible before the obsolete LKG is deleted.
  await store.assertPdcV2ContractMigrationPreflight(contractMigrationSql);
  const retirementInput = await pdcV2LegacyMeetingsRetirementInput(
    store,
    effectivePlan,
    legacyAuthority,
  );
  await provePdcV2PermanentMeetingsReplacement(store, effectivePlan, retirementInput);
  const retirement = await store.retirePdcV2LegacyMeetingsAggregate(retirementInput);
  if (await store.readPromotion("MEETING", PDC_V2_LEGACY_MEETINGS_SCOPE)) {
    throw new Error("TRUSTED_LKG_LEGACY_MEETINGS_POINTER_SURVIVED_RETIREMENT");
  }
  // The old authority is gone; prove the same exact permanent composition a
  // second time so deleting the aggregate cannot itself erase Reader facts.
  await provePdcV2PermanentMeetingsReplacement(store, effectivePlan, retirementInput);
  return {
    ...result,
    legacyMeetingsAggregateRetirement: {
      ...retirement,
      ...retirementInput.expected,
    },
  };
}
