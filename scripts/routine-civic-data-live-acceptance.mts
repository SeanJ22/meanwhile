/**
 * The bounded data-plane half of PDC-12 acceptance.
 *
 * Run only after a post-deploy authenticated attempt for every registered
 * routine contract. A meeting partition that returned real rows supplies its
 * prior and distinct new GOOD versions. A genuinely empty meeting partition
 * instead supplies its exact durable zero-row attempt; the script proves that
 * it is source-authenticated CANNOT_TELL with no invented pointer/LKG. It then
 * injects one precisely invalid candidate from each materially different
 * validation family and proves every existing pointer and LKG remain intact.
 *
 * The coordinator itself opens only the production read-only handle. Every
 * deliberate refusal is delegated to the sibling one-contract child under a
 * normal ROUTINE_CONTRACT capability bound to this process's PID. It proves
 * the deployed app SHA before and after those writes, but does NOT by itself
 * observe Git/PR/Actions/Netlify/Next/browser event inventories. That external
 * release evidence remains separate. ZERO_RELEASE_EVENTS below is only the
 * structural contract, so this bounded harness cannot by itself close PDC-12.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { clearPromotedReadModelCache } from "../lib/civic-data/read-model.ts";
import {
  deploymentBoundaryIssue,
  postDeploymentAttemptEvidenceIssue,
  postDeploymentGoodEvidenceIssue,
  routineLiveAcceptanceDisposition,
  routineLiveAcceptanceStateIssue,
} from "../lib/civic-data/live-acceptance.ts";
import {
  isReaderProjectionReadbackDetail,
  parseReaderProjectionReadback,
} from "../lib/civic-data/reader-readback.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";
import { normalizedHash } from "../lib/civic-data/candidate-builders.ts";
import {
  MEETING_PARTITION_CONTRACTS,
  observableRoutineContracts,
} from "../lib/civic-data/meeting-partitions.ts";
import { promotedNhMembers } from "../lib/civic-data/state-members.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { ROUTINE_SOURCE_TASKS, routineTaskDue } from "../lib/civic-data/runner.ts";
import type { CandidateState, RoutineCandidate, RoutineRecordClass } from "../lib/civic-data/types.ts";
import { REFUSED_VARIABLE } from "../lib/db/write-handle.ts";
import {
  admittedRuntimeChildEnvironment,
  inspectRuntimeCheckout,
  RUNTIME_AUTHORITY_ENV,
} from "../lib/civic-data/runtime-authority.ts";
import { refreshFundingFromPromoted } from "../lib/funding/snapshot.ts";
import {
  readMeetingsProjection,
  type MeetingPartitionReadback,
} from "../lib/meetings/snapshot.ts";
import { refreshPopulationFromPromoted } from "../lib/reference/acs-population.ts";
import { readNjMorrisFiling } from "../lib/sources/ballot-nj-morris/index.ts";
import { readOfficialStateVotesProjection } from "../lib/sources/legiscan/snapshot.ts";
import { readOfficialStateLegislatorsProjection } from "../lib/state-rollcalls/legislators.ts";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";
import { assignment, requiredAssignment } from "../scripts/cli-args.mts";
import { fetchServedCommit } from "../scripts/post-deploy-observer.mts";
import {
  redactPdc12CanaryChildError,
  type Pdc12CanaryChildReceipt,
  type Pdc12CanaryKind,
} from "./routine-civic-data-live-canary-child.mts";
/*
 * This module import is safe in the read-only coordinator: the child's main
 * guard does not run on import. Reusing its redactor keeps any bounded child
 * stderr from becoming a credential-bearing coordinator exception.
 */

const runId = randomUUID();
const ROOT = resolve(process.cwd());
const CHILD_SCRIPT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "routine-civic-data-live-canary-child.mts",
);

interface PromotedMeetingVersionExpectation {
  readonly contractId: string;
  readonly kind: "PROMOTED_TWO_GOOD";
  readonly prior: string;
  readonly good: string;
}

interface EmptyMeetingAttemptExpectation {
  readonly contractId: string;
  readonly kind: "AUTHENTICATED_EMPTY_ATTEMPT";
  readonly attempt: string;
}

interface HeldMeetingLkgAttemptExpectation {
  readonly contractId: string;
  readonly kind: "HELD_LKG_ATTEMPT";
  /** Exact post-deploy live attempt which did not move the pointer. */
  readonly attempt: string;
  /** Exact version which remained both the pointer and LKG. */
  readonly lkg: string;
}

type MeetingVersionExpectation =
  | PromotedMeetingVersionExpectation
  | EmptyMeetingAttemptExpectation
  | HeldMeetingLkgAttemptExpectation;

interface MeetingAcceptanceManifest {
  readonly deploymentCompletedAt: string;
  readonly byId: ReadonlyMap<string, MeetingVersionExpectation>;
}

function requiredMeetingVersionExpectations(): MeetingAcceptanceManifest {
  const manifestPath = resolve(requiredAssignment(process.argv, "meetings-version-manifest", "PDC12_EXPECTED_VERSION_REQUIRED"));
  const repoRelative = relative(process.cwd(), manifestPath).replaceAll("\\", "/");
  if (repoRelative !== ".runtime" && !repoRelative.startsWith(".runtime/")) {
    throw new Error("PDC12_MEETINGS_VERSION_MANIFEST_MUST_BE_UNTRACKED_RUNTIME_EVIDENCE");
  }
  const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    readonly formatVersion?: unknown;
    readonly deploymentCompletedAt?: unknown;
    readonly partitions?: unknown;
  };
  if (
    parsed.formatVersion !== 2 ||
    typeof parsed.deploymentCompletedAt !== "string" ||
    !Number.isFinite(Date.parse(parsed.deploymentCompletedAt)) ||
    !Array.isArray(parsed.partitions)
  ) {
    throw new Error("PDC12_MEETINGS_VERSION_MANIFEST_INVALID");
  }
  const rows = parsed.partitions as MeetingVersionExpectation[];
  const expectedIds = new Set(MEETING_PARTITION_CONTRACTS.map(({ id }) => id));
  const byId = new Map<string, MeetingVersionExpectation>();
  for (const row of rows) {
    if (
      !row ||
      typeof row.contractId !== "string" ||
      !expectedIds.has(row.contractId) ||
      byId.has(row.contractId)
    ) throw new Error(`PDC12_MEETINGS_VERSION_EXPECTATION_INVALID:${row?.contractId ?? "UNKNOWN"}`);
    if (row.kind === "PROMOTED_TWO_GOOD") {
      if (
        typeof row.prior !== "string" || row.prior.trim() === "" ||
        typeof row.good !== "string" || row.good.trim() === "" ||
        row.prior === row.good
      ) throw new Error(`PDC12_MEETINGS_VERSION_EXPECTATION_INVALID:${row.contractId}`);
    } else if (row.kind === "AUTHENTICATED_EMPTY_ATTEMPT") {
      if (typeof row.attempt !== "string" || row.attempt.trim() === "") {
        throw new Error(`PDC12_MEETINGS_VERSION_EXPECTATION_INVALID:${row.contractId}`);
      }
    } else if (row.kind === "HELD_LKG_ATTEMPT") {
      if (
        typeof row.attempt !== "string" || row.attempt.trim() === "" ||
        typeof row.lkg !== "string" || row.lkg.trim() === "" ||
        row.attempt === row.lkg
      ) throw new Error(`PDC12_MEETINGS_VERSION_EXPECTATION_INVALID:${row.contractId}`);
    } else {
      throw new Error("PDC12_MEETINGS_VERSION_EXPECTATION_INVALID:UNKNOWN_KIND");
    }
    byId.set(row.contractId, row);
  }
  if (byId.size !== expectedIds.size) {
    const missing = [...expectedIds].filter((id) => !byId.has(id));
    throw new Error(`PDC12_MEETINGS_VERSION_DENOMINATOR_MISMATCH:${byId.size}/${expectedIds.size}:${missing.join(",")}`);
  }
  if (![...byId.values()].some((row) => row.kind === "PROMOTED_TWO_GOOD")) {
    throw new Error("PDC12_MEETING_CLASS_HAS_NO_AUTHENTICATED_PROMOTION");
  }
  return { deploymentCompletedAt: parsed.deploymentCompletedAt, byId };
}

const expectedVersions = {
  FEC: {
    prior: requiredAssignment(process.argv, "fec-prior", "PDC12_EXPECTED_VERSION_REQUIRED"),
    good: requiredAssignment(process.argv, "fec-good", "PDC12_EXPECTED_VERSION_REQUIRED"),
  },
  STATE_LEGISLATOR: {
    prior: requiredAssignment(process.argv, "state-prior", "PDC12_EXPECTED_VERSION_REQUIRED"),
    good: requiredAssignment(process.argv, "state-good", "PDC12_EXPECTED_VERSION_REQUIRED"),
  },
  AZ_STATE_LEGISLATOR: {
    prior: requiredAssignment(process.argv, "az-roster-prior", "PDC12_EXPECTED_VERSION_REQUIRED"),
    good: requiredAssignment(process.argv, "az-roster-good", "PDC12_EXPECTED_VERSION_REQUIRED"),
  },
  NJ_STATE_LEGISLATOR: {
    prior: requiredAssignment(process.argv, "nj-roster-prior", "PDC12_EXPECTED_VERSION_REQUIRED"),
    good: requiredAssignment(process.argv, "nj-roster-good", "PDC12_EXPECTED_VERSION_REQUIRED"),
  },
  NH_STATE_ROLL_CALL: {
    prior: requiredAssignment(process.argv, "nh-roll-prior", "PDC12_EXPECTED_VERSION_REQUIRED"),
    good: requiredAssignment(process.argv, "nh-roll-good", "PDC12_EXPECTED_VERSION_REQUIRED"),
  },
  NJ_STATE_ROLL_CALL: {
    prior: requiredAssignment(process.argv, "nj-roll-prior", "PDC12_EXPECTED_VERSION_REQUIRED"),
    good: requiredAssignment(process.argv, "nj-roll-good", "PDC12_EXPECTED_VERSION_REQUIRED"),
  },
  CENSUS_REFERENCE: {
    prior: requiredAssignment(process.argv, "census-prior", "PDC12_EXPECTED_VERSION_REQUIRED"),
    good: requiredAssignment(process.argv, "census-good", "PDC12_EXPECTED_VERSION_REQUIRED"),
  },
  BALLOT_FILING: {
    prior: requiredAssignment(process.argv, "nj-prior", "PDC12_EXPECTED_VERSION_REQUIRED"),
    good: requiredAssignment(process.argv, "nj-good", "PDC12_EXPECTED_VERSION_REQUIRED"),
  },
  DOTGOV_REFERENCE: {
    prior: requiredAssignment(process.argv, "dotgov-prior", "PDC12_EXPECTED_VERSION_REQUIRED"),
    good: requiredAssignment(process.argv, "dotgov-good", "PDC12_EXPECTED_VERSION_REQUIRED"),
  },
} as const;

interface FailClosedAttemptExpectation {
  readonly attempt: string;
  readonly lkg: string | null;
}

function requiredFailClosedAttemptExpectation(prefix: string): FailClosedAttemptExpectation {
  const attempt = requiredAssignment(process.argv, `${prefix}-attempt`, "PDC12_EXPECTED_ATTEMPT_REQUIRED");
  const lkg = assignment(process.argv, `${prefix}-lkg`)?.trim() ?? "";
  if (lkg === "") throw new Error(`PDC12_EXPECTED_LKG_DISPOSITION_REQUIRED:${prefix}-lkg`);
  return { attempt, lkg: lkg === "NOT_RECORDED" ? null : lkg };
}

const failClosedAttemptExpectations = {
  AZ_STATE_ROLL_CALL: requiredFailClosedAttemptExpectation("az-roll"),
} as const;
const meetingManifest = requiredMeetingVersionExpectations();
const expectedMeetingVersions = meetingManifest.byId;
const deploymentCompletedAt = requiredAssignment(process.argv, "deployment-completed-at", "PDC12_EXPECTED_VERSION_REQUIRED");
const deployedSha = requiredAssignment(process.argv, "deployed-sha", "PDC12_EXPECTED_VERSION_REQUIRED").toLowerCase();
const boundaryIssue = deploymentBoundaryIssue({
  requested: deploymentCompletedAt,
  meetingManifest: meetingManifest.deploymentCompletedAt,
  nowMs: Date.now(),
});
if (boundaryIssue !== null) throw new Error(`PDC12_DEPLOYMENT_BOUNDARY_INVALID:${boundaryIssue}`);
if (!/^[0-9a-f]{40}$/.test(deployedSha)) throw new Error("PDC12_DEPLOYED_SHA_INVALID");

const checkout = inspectRuntimeCheckout(ROOT);
assert.equal(checkout.readable, true, "PDC-12 coordinator cannot inspect its Git checkout");
assert.equal(checkout.clean, true, "PDC-12 coordinator must run from a clean checkout");
assert.equal(checkout.detached, true, "PDC-12 coordinator must run detached at the deployed SHA");
assert.equal(checkout.headOnOriginMain, true, "PDC-12 coordinator HEAD is not proven on origin/main");
assert.equal(checkout.repositoryRoot, ROOT, "PDC-12 coordinator cwd is not its exact Git root");
assert.equal(checkout.headSha, deployedSha, "PDC-12 coordinator HEAD does not equal the declared deployed SHA");
const served = await fetchServedCommit(PUBLIC_SITE_ORIGIN, {
  runId: `pdc12-live-acceptance:${runId}`,
  timeoutMs: 15_000,
});
assert.equal(served.sha?.toLowerCase(), deployedSha, "production is not serving the exact PDC-12 coordinator SHA");

for (const [name, versions] of Object.entries(expectedVersions)) {
  assert.notEqual(versions.prior, versions.good, `${name}: the post-deploy GOOD version must be new`);
}

const readonlyConnection = process.env[REFUSED_VARIABLE]?.trim() ?? "";
if (readonlyConnection === "") throw new Error(`PDC12_READ_HANDLE_REQUIRED:${REFUSED_VARIABLE}`);
process.env.DATABASE_URL = readonlyConnection;
delete process.env.WTP_SANCTIONED_WRITE;

const store = new PostgresRoutineDataStore();

function parseCanaryChildReceipt(output: string): Pdc12CanaryChildReceipt {
  const lines = output.split(/\r?\n/).filter((line) => line.startsWith("PDC12_CANARY_CHILD="));
  if (lines.length !== 1) throw new Error(`PDC12_CANARY_CHILD_RECEIPT_COUNT:${lines.length}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(lines[0]!.slice("PDC12_CANARY_CHILD=".length));
  } catch {
    throw new Error("PDC12_CANARY_CHILD_RECEIPT_INVALID_JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("PDC12_CANARY_CHILD_RECEIPT_INVALID");
  }
  return parsed as Pdc12CanaryChildReceipt;
}

/** Spawn one normal registered-contract child; the coordinator itself remains read-only. */
function runCanaryChild(
  contractId: string,
  kind: Pdc12CanaryKind,
  expectedVersionId: string,
): Pdc12CanaryChildReceipt {
  const authorityParent = {
    ...process.env,
    [RUNTIME_AUTHORITY_ENV.repo]: ROOT,
    [RUNTIME_AUTHORITY_ENV.sha]: deployedSha,
  };
  const env = admittedRuntimeChildEnvironment({
    parentEnv: authorityParent,
    capability: "ROUTINE_CONTRACT",
    contract: contractId,
    parentPid: process.pid,
  });
  const run = spawnSync(process.execPath, [
    "--experimental-strip-types",
    CHILD_SCRIPT,
    `--contract=${contractId}`,
    `--kind=${kind}`,
    `--expected-version=${expectedVersionId}`,
  ], {
    cwd: ROOT,
    env,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: 90_000,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (run.status !== 0) {
    const detail = redactPdc12CanaryChildError(`${run.stderr ?? ""}\n${run.stdout ?? ""}`)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-4)
      .join(" | ")
      .slice(0, 2_000);
    throw new Error(`PDC12_CANARY_CHILD_FAILED:${contractId}:${kind}:exit=${run.status ?? "none"}:${detail}`);
  }
  const receipt = parseCanaryChildReceipt(run.stdout ?? "");
  assert.equal(receipt.contractId, contractId, "PDC-12 child receipt crossed contract identity");
  assert.equal(receipt.kind, kind, "PDC-12 child receipt crossed canary family");
  assert.equal(receipt.beforeVersion, expectedVersionId, "PDC-12 child mutated a different starting pointer");
  assert.equal(receipt.afterVersion, expectedVersionId, "PDC-12 child moved the serving pointer");
  assert.equal(receipt.authorityCapability, "ROUTINE_CONTRACT");
  assert.equal(receipt.authorityContract, contractId, "PDC-12 child authority was not the exact requested contract");
  return receipt;
}

const emptyMeetingAttempts: Record<string, unknown> = {};
const heldMeetingLkgAttempts: Record<string, unknown> = {};
for (const partition of MEETING_PARTITION_CONTRACTS) {
  const expectation = expectedMeetingVersions.get(partition.id)!;
  if (expectation.kind === "PROMOTED_TWO_GOOD") continue;
  const attempt = await store.readCandidate(expectation.attempt);
  assert.ok(attempt, `${partition.id}: stated post-deploy attempt is not durable`);
  assert.equal(attempt.candidate.sourceId, partition.sourceId);
  assert.equal(attempt.candidate.recordClass, "MEETING");
  assert.equal(attempt.candidate.scope, partition.scope);
  assert.notEqual(attempt.state, "PROMOTED", `${partition.id}: a held attempt cannot itself be promoted`);
  assert.notEqual(attempt.receipt?.decision, "GOOD", `${partition.id}: a held attempt cannot carry a GOOD receipt`);
  assert.equal(attempt.promotedVersion, null, `${partition.id}: a held attempt names a promoted version`);
  assert.equal(
    (attempt.candidate as RoutineCandidate & { readonly bootstrapImport?: unknown }).bootstrapImport,
    undefined,
    `${partition.id}: trusted bootstrap import does not count as a live post-deploy attempt`,
  );
  const events = await store.events(expectation.attempt);
  assert.ok(events.length > 0, `${partition.id}: attempt has no durable events`);
  const firstEvent = events[0]!;
  assert.equal(firstEvent.sequence, 1, `${partition.id}: attempt history does not begin at sequence 1`);
  assert.equal(events.at(-1)?.state, attempt.state, `${partition.id}: durable terminal event disagrees with candidate state`);
  assert.ok(attempt.receipt, `${partition.id}: terminal attempt has no durable validation receipt`);
  assert.ok(attempt.failureCode, `${partition.id}: terminal attempt has no exact refusal code`);
  assert.ok(
    events.every(({ at }) => Date.parse(at) >= Date.parse(deploymentCompletedAt)),
    `${partition.id}: attempt events are not post-deploy`,
  );
  const task = ROUTINE_SOURCE_TASKS.find(({ id }) => id === partition.id)!;
  const clock = await store.clock(partition.sourceId, "MEETING", partition.scope);
  assert.equal(clock.lastAttemptedAt, firstEvent.at);
  const attemptedMs = Date.parse(firstEvent.at);
  assert.equal(routineTaskDue(task, clock, attemptedMs + task.retryMs - 1), false);
  assert.equal(routineTaskDue(task, clock, attemptedMs + task.retryMs), true);

  if (expectation.kind === "AUTHENTICATED_EMPTY_ATTEMPT") {
    assert.equal(attempt.acquisitionSucceeded, true, `${partition.id}: empty attempt was not an answered source acquisition`);
    assert.equal(attempt.candidate.retrieval.succeeded, true);
    assert.match(attempt.candidate.retrieval.rawHash ?? "", /^[a-f0-9]{64}$/);
    assert.equal(attempt.candidate.normalization.outputRecords, 0);
    assert.equal(attempt.candidate.horizon.returnedRecords, 0);
    assert.equal(attempt.state, "CANNOT_TELL");
    assert.equal(attempt.receipt?.decision, "CANNOT_TELL");
    assert.equal(attempt.failureCode, "ZERO_IS_NOT_ABSENCE");
    assert.equal(attempt.lastKnownGoodVersion, null, `${partition.id}: a genuinely empty partition must not name fabricated LKG`);
    const authenticity = attempt.receipt?.checks.find(({ check }) => check === "SOURCE_AUTHENTICITY");
    assert.deepEqual(
      authenticity && { verdict: authenticity.verdict, code: authenticity.code },
      { verdict: "PASS", code: "AUTHORITY_AND_RAW_PROVENANCE_VALID" },
      `${partition.id}: empty attempt has no authenticated source bytes`,
    );
    const absence = attempt.receipt?.checks.find(({ check }) => check === "ABSENCE_VALIDITY");
    assert.deepEqual(
      absence && { verdict: absence.verdict, code: absence.code },
      { verdict: "CANNOT_TELL", code: "ZERO_IS_NOT_ABSENCE" },
      `${partition.id}: empty response was mislabeled as authoritative absence`,
    );
    assert.equal(await store.readPromotion("MEETING", partition.scope), null, `${partition.id}: empty response minted a canonical pointer`);
    assert.deepEqual(events.map(({ state }) => state), ["FETCHED", "NORMALIZED", "CANNOT_TELL"]);
    assert.equal(clock.lastSucceededAt, undefined);
    emptyMeetingAttempts[partition.id] = {
      candidateId: expectation.attempt,
      sourceRetrieval: "PASS",
      authenticatedAuthorityContract: "PASS",
      durableAttempt: "PASS",
      durableState: "CANNOT_TELL",
      absenceDisposition: "ZERO_IS_NOT_ABSENCE",
      pointerCreated: false,
      fabricatedGoodVersion: false,
      fabricatedLkg: false,
      retryHeldBeforeDue: true,
      retryDueAtBoundary: true,
      postDeploy: true,
      structuralReleaseContract: ZERO_RELEASE_EVENTS,
    };
    continue;
  }

  assert.equal(attempt.lastKnownGoodVersion, expectation.lkg, `${partition.id}: held attempt does not name the exact stated LKG`);
  const pointer = await store.readPromotion("MEETING", partition.scope);
  assert.ok(pointer, `${partition.id}: held attempt has no serving pointer`);
  assert.equal(pointer.versionId, expectation.lkg, `${partition.id}: held attempt moved the serving pointer`);
  assert.equal(pointer.lastKnownGoodVersionId, expectation.lkg, `${partition.id}: pointer and LKG diverged`);
  assert.equal(pointer.receipt.decision, "GOOD", `${partition.id}: serving LKG lacks a GOOD receipt`);
  const lkg = await store.readCandidate(expectation.lkg);
  assert.ok(lkg, `${partition.id}: stated LKG candidate is not durable`);
  assert.equal(lkg.state, "PROMOTED");
  assert.equal(lkg.promotedVersion, expectation.lkg);
  assert.equal(lkg.lastKnownGoodVersion, expectation.lkg);
  assert.equal(lkg.candidate.sourceId, partition.sourceId);
  assert.equal(lkg.candidate.recordClass, "MEETING");
  assert.equal(lkg.candidate.scope, partition.scope);
  assert.deepEqual(pointer.payload, lkg.candidate.readModel, `${partition.id}: serving pointer payload differs from its exact LKG`);
  assert.ok(
    Date.parse(pointer.promotedAt) <= Date.parse(firstEvent.at),
    `${partition.id}: claimed LKG was promoted after the attempt it supposedly held`,
  );
  const lkgIsBootstrap = Boolean((lkg.candidate as RoutineCandidate & { readonly bootstrapImport?: unknown }).bootstrapImport);
  assert.equal(
    clock.lastSucceededAt,
    lkgIsBootstrap ? undefined : lkg.candidate.retrieval.retrievedAt,
    `${partition.id}: durable success clock does not distinguish imported LKG from source-authenticated success`,
  );
  heldMeetingLkgAttempts[partition.id] = {
    candidateId: expectation.attempt,
    durableState: attempt.state,
    decision: attempt.receipt?.decision ?? null,
    acquisitionSucceeded: attempt.acquisitionSucceeded,
    servingVersion: pointer.versionId,
    lastKnownGoodVersion: pointer.lastKnownGoodVersionId,
    lkgIsTrustedImport: lkgIsBootstrap,
    retryHeldBeforeDue: true,
    retryDueAtBoundary: true,
    postDeploy: true,
    pointerAndPayloadUnchanged: true,
    structuralReleaseContract: ZERO_RELEASE_EVENTS,
  };
}

if (Object.keys(heldMeetingLkgAttempts).length > 0) {
  clearPromotedReadModelCache();
  const reader = await readMeetingsProjection({ store, bypassCache: true });
  assert.equal(reader.kind, "PROMOTED", "The typed meetings Reader cannot compose held LKG partitions");
  if (reader.kind === "PROMOTED") {
    for (const expectation of expectedMeetingVersions.values()) {
      if (expectation.kind !== "HELD_LKG_ATTEMPT") continue;
      const readback: MeetingPartitionReadback | undefined = reader.partitions.find(
        ({ contractId }: MeetingPartitionReadback) => contractId === expectation.contractId,
      );
      assert.ok(readback, `${expectation.contractId}: typed Reader omitted the held partition`);
      assert.equal(readback.kind, "PROMOTED", `${expectation.contractId}: typed Reader did not accept the held LKG proof`);
      assert.equal(readback.versionId, expectation.lkg, `${expectation.contractId}: typed Reader serves a version other than the exact held LKG`);
    }
  }
}

type ReaderVerification =
  | {
      readonly kind: "READER";
      readonly readVersion: () => Promise<string | null>;
    }
  | {
      readonly kind: "NON_READER";
      readonly detail: "DOTGOV_REFERENCE has no Reader projection; acceptance is durable pointer/receipt only.";
    };

interface AcceptanceTarget {
  readonly name: string;
  readonly contractId: string;
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly expectedInvalidState: CandidateState;
  readonly expectedFailureCode: string;
  readonly priorVersionId: string;
  readonly expectedGoodVersionId: string;
  readonly reader: ReaderVerification;
  /**
   * Every target is read back, but only one target per materially different
   * validation family is deliberately refused. Replaying the same semantic
   * canary into every healthy meeting partition would manufacture a portfolio
   * of owner-visible incidents and put every one of those sources on retry
   * backoff without proving anything the first exact partition did not prove.
   */
  readonly injectInvalidCanary: boolean;
  readonly canaryKind: Exclude<Pdc12CanaryKind, "SOURCE_UNAVAILABLE">;
}

interface FailClosedAcceptanceTarget {
  readonly name: keyof typeof failClosedAttemptExpectations;
  readonly contractId: string;
  readonly recordClass: "STATE_ROLL_CALL";
  readonly scope: "US-AZ";
  readonly expectation: FailClosedAttemptExpectation;
  readonly reader: Extract<ReaderVerification, { readonly kind: "READER" }>;
}

const meetingSemanticCanaryContractId = [...expectedMeetingVersions.values()].find(
  (expectation) => expectation.kind === "PROMOTED_TWO_GOOD",
)?.contractId;
assert.ok(
  meetingSemanticCanaryContractId,
  "PDC-12 requires one source-authenticated promoted meeting partition for the semantic refusal canary",
);

const targets: readonly AcceptanceTarget[] = [
  {
    name: "FEC",
    contractId: "fec-funding",
    recordClass: "FEC_FUNDING",
    scope: "federal-supported",
    expectedInvalidState: "PARSE_INVALID",
    expectedFailureCode: "PARSER_FAILED",
    priorVersionId: expectedVersions.FEC.prior,
    expectedGoodVersionId: expectedVersions.FEC.good,
    reader: { kind: "READER", readVersion: refreshFundingFromPromoted },
    injectInvalidCanary: true,
    canaryKind: "PARSER_INVALID",
  },
  {
    name: "STATE_LEGISLATOR",
    contractId: "nh-members",
    recordClass: "STATE_LEGISLATOR",
    scope: "US-NH",
    expectedInvalidState: "IDENTITY_UNRESOLVED",
    expectedFailureCode: "STATE_MEMBER_SEAT_IDENTITY_INCOMPLETE",
    priorVersionId: expectedVersions.STATE_LEGISLATOR.prior,
    expectedGoodVersionId: expectedVersions.STATE_LEGISLATOR.good,
    reader: { kind: "READER", readVersion: async () => (await promotedNhMembers())?.versionId ?? null },
    injectInvalidCanary: true,
    canaryKind: "IDENTITY_INVALID",
  },
  {
    name: "AZ_STATE_LEGISLATOR",
    contractId: "az-state-legislators",
    recordClass: "STATE_LEGISLATOR",
    scope: "US-AZ",
    expectedInvalidState: "IDENTITY_UNRESOLVED",
    expectedFailureCode: "STATE_MEMBER_SEAT_IDENTITY_INCOMPLETE",
    priorVersionId: expectedVersions.AZ_STATE_LEGISLATOR.prior,
    expectedGoodVersionId: expectedVersions.AZ_STATE_LEGISLATOR.good,
    reader: {
      kind: "READER",
      readVersion: async () => {
        const read = await readOfficialStateLegislatorsProjection("US-AZ", { store, bypassCache: true });
        return read.kind === "PROMOTED" ? read.metadata.versionId : null;
      },
    },
    injectInvalidCanary: false,
    canaryKind: "IDENTITY_INVALID",
  },
  {
    name: "NJ_STATE_LEGISLATOR",
    contractId: "nj-state-legislators",
    recordClass: "STATE_LEGISLATOR",
    scope: "US-NJ",
    expectedInvalidState: "IDENTITY_UNRESOLVED",
    expectedFailureCode: "STATE_MEMBER_SEAT_IDENTITY_INCOMPLETE",
    priorVersionId: expectedVersions.NJ_STATE_LEGISLATOR.prior,
    expectedGoodVersionId: expectedVersions.NJ_STATE_LEGISLATOR.good,
    reader: {
      kind: "READER",
      readVersion: async () => {
        const read = await readOfficialStateLegislatorsProjection("US-NJ", { store, bypassCache: true });
        return read.kind === "PROMOTED" ? read.metadata.versionId : null;
      },
    },
    injectInvalidCanary: false,
    canaryKind: "IDENTITY_INVALID",
  },
  {
    name: "NH_STATE_ROLL_CALL",
    contractId: "nh-state-rollcalls",
    recordClass: "STATE_ROLL_CALL",
    scope: "US-NH",
    expectedInvalidState: "HORIZON_UNRESOLVED",
    expectedFailureCode: "COMPLETE_UNIVERSE_UNBOUNDED",
    priorVersionId: expectedVersions.NH_STATE_ROLL_CALL.prior,
    expectedGoodVersionId: expectedVersions.NH_STATE_ROLL_CALL.good,
    reader: {
      kind: "READER",
      readVersion: async () => {
        const read = await readOfficialStateVotesProjection("US-NH", { store, bypassCache: true });
        return read.kind === "PROMOTED" ? read.metadata.versionId : null;
      },
    },
    injectInvalidCanary: false,
    canaryKind: "HORIZON_INVALID",
  },
  {
    name: "NJ_STATE_ROLL_CALL",
    contractId: "nj-state-rollcalls",
    recordClass: "STATE_ROLL_CALL",
    scope: "US-NJ",
    expectedInvalidState: "HORIZON_UNRESOLVED",
    expectedFailureCode: "COMPLETE_UNIVERSE_UNBOUNDED",
    priorVersionId: expectedVersions.NJ_STATE_ROLL_CALL.prior,
    expectedGoodVersionId: expectedVersions.NJ_STATE_ROLL_CALL.good,
    reader: {
      kind: "READER",
      readVersion: async () => {
        const read = await readOfficialStateVotesProjection("US-NJ", { store, bypassCache: true });
        return read.kind === "PROMOTED" ? read.metadata.versionId : null;
      },
    },
    injectInvalidCanary: false,
    canaryKind: "HORIZON_INVALID",
  },
  {
    name: "CENSUS_REFERENCE",
    contractId: "census-acs-population",
    recordClass: "CENSUS_REFERENCE",
    scope: "acs-population",
    expectedInvalidState: "TEMPORAL_INVALID",
    expectedFailureCode: "WRONG_PERIOD_OR_VINTAGE",
    priorVersionId: expectedVersions.CENSUS_REFERENCE.prior,
    expectedGoodVersionId: expectedVersions.CENSUS_REFERENCE.good,
    reader: { kind: "READER", readVersion: refreshPopulationFromPromoted },
    injectInvalidCanary: true,
    canaryKind: "TEMPORAL_INVALID",
  },
  ...MEETING_PARTITION_CONTRACTS.flatMap((partition): AcceptanceTarget[] => {
    const versions = expectedMeetingVersions.get(partition.id)!;
    if (versions.kind !== "PROMOTED_TWO_GOOD") return [];
    return [{
      name: `MEETING:${partition.id}`,
      contractId: partition.id,
      recordClass: "MEETING",
      scope: partition.scope,
      expectedInvalidState: "SEMANTIC_INVALID",
      expectedFailureCode: "SEMANTIC_CONTRACT_VIOLATION",
      priorVersionId: versions.prior,
      expectedGoodVersionId: versions.good,
      injectInvalidCanary: partition.id === meetingSemanticCanaryContractId,
      canaryKind: "MEETING_SEMANTIC_INVALID",
      reader: {
        kind: "READER",
        readVersion: async () => {
          const read = await readMeetingsProjection({ store, bypassCache: true });
          if (read.kind !== "PROMOTED") return null;
          return read.partitions.find(({ contractId }) => contractId === partition.id)?.versionId ?? null;
        },
      },
    }];
  }),
  {
    name: "BALLOT_FILING",
    contractId: "nj-morris-filing",
    recordClass: "BALLOT_FILING",
    scope: "US-NJ:county:morris:2026-general",
    expectedInvalidState: "HORIZON_UNRESOLVED",
    expectedFailureCode: "COMPLETE_UNIVERSE_UNBOUNDED",
    priorVersionId: expectedVersions.BALLOT_FILING.prior,
    expectedGoodVersionId: expectedVersions.BALLOT_FILING.good,
    injectInvalidCanary: true,
    reader: {
      kind: "READER",
      readVersion: async () => {
        const read = await readNjMorrisFiling({ store, bypassCache: true });
        return read.kind === "PROMOTED" ? read.metadata.versionId : null;
      },
    },
    canaryKind: "HORIZON_INVALID",
  },
  {
    name: "DOTGOV_REFERENCE",
    contractId: "dotgov",
    recordClass: "DOTGOV_REFERENCE",
    scope: "US:current-full:election-domains",
    expectedInvalidState: "DEPENDENT_CONSUMER_INVALID",
    expectedFailureCode: "DEPENDENT_CONSUMER_REJECTED",
    priorVersionId: expectedVersions.DOTGOV_REFERENCE.prior,
    expectedGoodVersionId: expectedVersions.DOTGOV_REFERENCE.good,
    injectInvalidCanary: true,
    reader: {
      kind: "NON_READER",
      detail: "DOTGOV_REFERENCE has no Reader projection; acceptance is durable pointer/receipt only.",
    },
    canaryKind: "DEPENDENT_CONSUMER_INVALID",
  },
] as const;

const failClosedTargets: readonly FailClosedAcceptanceTarget[] = [
  {
    name: "AZ_STATE_ROLL_CALL",
    contractId: "az-state-rollcalls",
    recordClass: "STATE_ROLL_CALL",
    scope: "US-AZ",
    expectation: failClosedAttemptExpectations.AZ_STATE_ROLL_CALL,
    reader: {
      kind: "READER",
      readVersion: async () => {
        const read = await readOfficialStateVotesProjection("US-AZ", { store, bypassCache: true });
        return read.kind === "PROMOTED" ? read.metadata.versionId : null;
      },
    },
  },
];

/*
 * PDC-12's live denominator is every contract in the permanent routine
 * registry: the controlling cutover amendment says "every legacy routine
 * source or operational process." Explicit-owner PDC-7 contracts have no
 * clock and are proved separately by their exact pointer/Reader transfer;
 * their deliberately non-source-authenticated trusted imports must never be
 * relabeled as live attempts here.
 */
const routineDenominatorIds = observableRoutineContracts().map(({ id }) => id).sort();
const liveEvidenceIds = [...new Set([
  ...targets.map(({ contractId }) => contractId),
  ...failClosedTargets.map(({ contractId }) => contractId),
  ...expectedMeetingVersions.keys(),
])].sort();
assert.deepEqual(
  liveEvidenceIds,
  routineDenominatorIds,
  "PDC-12 live evidence must account for every and only canonical routine contract",
);

const invalidCanaryTargets = targets.filter(({ injectInvalidCanary }) => injectInvalidCanary);
assert.equal(
  invalidCanaryTargets.length,
  6,
  "PDC-12 must inject exactly one canary for each of the six materially different validation families",
);
assert.equal(
  new Set(invalidCanaryTargets.map(({ expectedInvalidState }) => expectedInvalidState)).size,
  6,
  "PDC-12 invalid canaries must cover six distinct validation families",
);

const results: Record<string, unknown> = {};

for (const target of failClosedTargets) {
  const task = ROUTINE_SOURCE_TASKS.find((item) => item.id === target.contractId);
  assert.ok(task, `${target.name}: registered routine task is missing`);
  const disposition = routineLiveAcceptanceDisposition(task.contract);
  assert.equal(disposition.kind, "AUTHENTICATED_FAIL_CLOSED_ATTEMPT", `${target.name}: contract does not authorize held-attempt evidence`);

  const attempt = await store.readCandidate(target.expectation.attempt);
  assert.ok(attempt, `${target.name}: stated source attempt is not durable`);
  assert.equal(attempt.candidate.id, target.expectation.attempt);
  assert.equal(attempt.candidate.sourceId, task.sourceId);
  assert.equal(attempt.candidate.recordClass, target.recordClass);
  assert.equal(attempt.candidate.scope, target.scope);
  assert.equal(attempt.candidate.bootstrapImport, undefined, `${target.name}: trusted import cannot count as a live source attempt`);
  assert.equal(routineLiveAcceptanceStateIssue(task.contract, attempt.state), null);
  assert.equal(attempt.promotedVersion, null, `${target.name}: fail-closed attempt unexpectedly promoted`);
  assert.equal(attempt.receipt?.decision, "REFUSED", `${target.name}: held attempt has no durable REFUSED receipt`);

  const sourceCheck = attempt.receipt?.checks.find((check) => check.check === "SOURCE_AUTHENTICITY");
  if (attempt.state === "HORIZON_UNRESOLVED") {
    assert.equal(attempt.acquisitionSucceeded, true, `${target.name}: horizon refusal did not acquire official publisher bytes`);
    assert.match(attempt.candidate.retrieval.rawHash ?? "", /^[a-f0-9]{64}$/);
    assert.deepEqual(
      sourceCheck && { verdict: sourceCheck.verdict, code: sourceCheck.code },
      { verdict: "PASS", code: "AUTHORITY_AND_RAW_PROVENANCE_VALID" },
      `${target.name}: horizon refusal is not source authenticated`,
    );
  } else {
    assert.equal(attempt.state, "SOURCE_BLOCKED");
    assert.equal(attempt.acquisitionSucceeded, false, `${target.name}: unavailable source attempt falsely claims acquisition success`);
    assert.deepEqual(
      sourceCheck && { verdict: sourceCheck.verdict, code: sourceCheck.code },
      { verdict: "FAIL", code: "SOURCE_RETRIEVAL_FAILED" },
      `${target.name}: unavailable source attempt is not explicitly classified`,
    );
  }

  const events = await store.events(attempt.candidate.id);
  const firstEvent = events[0];
  assert.equal(firstEvent?.sequence, 1, `${target.name}: source attempt history does not begin at sequence 1`);
  assert.equal(
    postDeploymentAttemptEvidenceIssue({
      contractId: target.contractId,
      deploymentCompletedAt,
      attemptedAt: firstEvent!.at,
    }),
    null,
    `${target.name}: stated held/unavailable attempt predates deployment`,
  );
  const clock = await store.clock(task.sourceId, target.recordClass, target.scope);
  assert.equal(clock.lastAttemptedAt, firstEvent!.at, `${target.name}: stated attempt is not the current durable source attempt`);

  const pointer = await store.readPromotion(target.recordClass, target.scope);
  let readerVersion: string | null = null;
  if (target.expectation.lkg === null) {
    assert.equal(pointer, null, `${target.name}: expectation says NOT_RECORDED but a canonical pointer exists`);
    assert.equal(attempt.lastKnownGoodVersion, null, `${target.name}: not-recorded attempt names an LKG`);
    clearPromotedReadModelCache();
    readerVersion = await target.reader.readVersion();
    assert.equal(readerVersion, null, `${target.name}: Reader invented a version without a canonical pointer`);
  } else {
    assert.ok(pointer, `${target.name}: expected held LKG pointer is absent`);
    assert.equal(pointer.versionId, target.expectation.lkg, `${target.name}: fail-closed attempt moved the canonical pointer`);
    assert.equal(pointer.lastKnownGoodVersionId, target.expectation.lkg, `${target.name}: pointer and LKG disagree`);
    assert.equal(attempt.lastKnownGoodVersion, target.expectation.lkg, `${target.name}: refusal did not retain the exact LKG`);
    const lkg = await store.readCandidate(target.expectation.lkg);
    assert.ok(lkg, `${target.name}: exact LKG candidate is not durable`);
    assert.equal(lkg.state, "PROMOTED");
    assert.equal(lkg.receipt?.decision, "GOOD");
    assert.deepEqual(pointer.payload, lkg.candidate.readModel, `${target.name}: pointer payload differs from exact LKG read model`);
    clearPromotedReadModelCache();
    readerVersion = await target.reader.readVersion();
    assert.equal(readerVersion, target.expectation.lkg, `${target.name}: typed Reader did not retain exact LKG`);
  }

  results[target.contractId] = {
    sourceAttempt: attempt.candidate.id,
    sourceAttemptState: attempt.state,
    sourceAttemptPostDeployment: true,
    canonicalDisposition: target.expectation.lkg === null ? "NOT_RECORDED" : "LKG_HELD",
    lastKnownGoodVersion: target.expectation.lkg,
    readerVersion,
    trustedImportCountedAsLiveAttempt: false,
    canonicalStateMutatedByAcceptance: false,
    structuralReleaseContract: ZERO_RELEASE_EVENTS,
    observedReleaseEvents: "REQUIRED_SEPARATELY",
  };
}

for (const target of targets) {
  const before = await store.readPromotion(target.recordClass, target.scope);
  assert.ok(before, `${target.name}: no promoted production version exists`);
  assert.equal(before.versionId, target.expectedGoodVersionId, `${target.name}: current pointer is not the stated new post-deploy GOOD version`);
  assert.equal(before.lastKnownGoodVersionId, before.versionId, `${target.name}: current pointer and LKG disagree before the canary`);
  assert.equal(before.receipt.decision, "GOOD", `${target.name}: current production pointer has no GOOD receipt`);
  assert.ok(before.receipt.checks.every((check) => check.verdict === "PASS"), `${target.name}: current receipt is not all-pass GOOD`);

  const prior = await store.readCandidate(target.priorVersionId);
  assert.ok(prior, `${target.name}: stated prior GOOD version is not durable`);
  assert.equal(prior.state, "PROMOTED", `${target.name}: stated prior GOOD version was not promoted`);
  assert.equal(prior.candidate.recordClass, target.recordClass, `${target.name}: stated prior version belongs to another record class`);
  assert.equal(prior.candidate.scope, target.scope, `${target.name}: stated prior version belongs to another scope`);
  assert.equal(prior.receipt?.decision, "GOOD", `${target.name}: stated prior version has no durable GOOD receipt`);

  const valid = await store.readCandidate(before.versionId);
  assert.ok(valid, `${target.name}: promoted candidate ${before.versionId} is not durable`);
  assert.equal(valid.state, "PROMOTED");
  assert.equal(valid.candidate.id, target.expectedGoodVersionId);
  assert.equal(valid.candidate.recordClass, target.recordClass);
  assert.equal(valid.candidate.scope, target.scope);
  assert.equal(valid.candidate.retrieval.succeeded, true);
  assert.match(valid.candidate.retrieval.rawHash ?? "", /^[a-f0-9]{64}$/);
  assert.equal(valid.receipt?.decision, "GOOD", `${target.name}: new version has no durable GOOD receipt`);
  assert.deepEqual(valid.receipt, before.receipt, `${target.name}: pointer and candidate disagree on the new GOOD receipt`);
  const authenticity = valid.receipt?.checks.find((check) => check.check === "SOURCE_AUTHENTICITY");
  assert.deepEqual(
    authenticity && { verdict: authenticity.verdict, code: authenticity.code },
    { verdict: "PASS", code: "AUTHORITY_AND_RAW_PROVENANCE_VALID" },
    `${target.name}: new GOOD version is not durably authenticated`,
  );
  const candidateEvents = await store.events(valid.candidate.id);
  const attemptEvent = candidateEvents[0];
  assert.equal(attemptEvent?.sequence, 1, `${target.name}: new GOOD candidate history does not begin at sequence 1`);
  const promotionEvent = candidateEvents.find((event) =>
    event.state === "PROMOTED" && !isReaderProjectionReadbackDetail(event.detail));
  assert.ok(promotionEvent, `${target.name}: new GOOD candidate has no durable PROMOTED event`);
  assert.equal(promotionEvent.candidateId, target.expectedGoodVersionId);
  assert.ok(Number.isFinite(Date.parse(promotionEvent.at)), `${target.name}: promotion event has no durable timestamp`);
  assert.equal(
    postDeploymentGoodEvidenceIssue({
      contractId: target.contractId,
      deploymentCompletedAt,
      attemptedAt: attemptEvent!.at,
      promotedAt: promotionEvent.at,
    }),
    null,
    `${target.name}: stated new GOOD version is not post-deployment evidence`,
  );
  assert.ok(
    promotionEvent.detail.includes(`from ${target.priorVersionId} to ${target.expectedGoodVersionId}`),
    `${target.name}: promotion event does not prove the stated prior-to-new transition`,
  );

  let durableReaderReadback: string | null = null;
  if (target.reader.kind === "READER") {
    const task = ROUTINE_SOURCE_TASKS.find((item) => item.id === target.contractId);
    assert.ok(task?.contract.readerProjection, `${target.name}: registered Reader projection metadata is missing`);
    const readbackEvent = candidateEvents
      .filter((event) => isReaderProjectionReadbackDetail(event.detail))
      .sort((left, right) => right.sequence - left.sequence || Date.parse(right.at) - Date.parse(left.at))[0];
    assert.ok(readbackEvent, `${target.name}: the new GOOD version has no durable typed Reader read-model receipt`);
    const receipt = parseReaderProjectionReadback(readbackEvent.detail);
    assert.ok(receipt, `${target.name}: the new GOOD version has no durable typed Reader read-model receipt`);
    assert.equal(receipt.contractId, task.id, `${target.name}: latest Reader receipt belongs to another contract`);
    assert.equal(receipt.versionId, before.versionId, `${target.name}: latest Reader receipt belongs to another version`);
    assert.equal(receipt.projectionId, task.contract.readerProjection.id, `${target.name}: latest Reader receipt belongs to another projection`);
    assert.equal(receipt.evidenceKind, "TYPED_READER_READ_MODEL", `${target.name}: latest Reader receipt is not a typed read-model observation`);
    assert.equal(receipt.observedAt, readbackEvent.at, `${target.name}: latest Reader receipt time disagrees with its append-only event`);
    assert.equal(receipt.status, "PASS", `${target.name}: the durable typed Reader read-model receipt records failure: ${receipt.detail}`);
    assert.ok(!receipt.verifierId.startsWith("unavailable:"), `${target.name}: the typed Reader verifier is not identified`);
    durableReaderReadback = receipt.observedAt;
  }

  let validReaderVersion: string | null = null;
  if (target.reader.kind === "READER") {
    clearPromotedReadModelCache();
    validReaderVersion = await target.reader.readVersion();
    assert.equal(validReaderVersion, before.versionId, `${target.name}: Reader did not read the promoted version`);
  } else {
    assert.equal(target.recordClass, "DOTGOV_REFERENCE");
  }

  if (!target.injectInvalidCanary) {
    results[target.contractId] = {
      sourceRetrieval: "PASS",
      authenticatedAuthorityContract: "PASS",
      durableGoodReceipt: "PASS",
      durablePromotionEvent: "PASS",
      priorGoodVersion: target.priorVersionId,
      newGoodVersion: target.expectedGoodVersionId,
      readerContract: target.reader.kind,
      readerVersion: validReaderVersion,
      durableReaderReadback,
      invalidCanary: "NOT_INJECTED_VALIDATION_FAMILY_ALREADY_PROVEN",
      canonicalStateMutatedByAcceptance: false,
      deployedAppShaAndHttpConsumerEvidence: "REQUIRED_SEPARATELY",
      structuralReleaseContract: ZERO_RELEASE_EVENTS,
      observedReleaseEvents: "REQUIRED_SEPARATELY",
    };
    continue;
  }

  const canary = runCanaryChild(
    target.contractId,
    target.canaryKind,
    before.versionId,
  );
  assert.equal(canary.promotedVersion, null, `${target.name}: invalid canary promoted`);
  assert.equal(canary.state, target.expectedInvalidState);
  assert.equal(canary.failureCode, target.expectedFailureCode);
  const durableInvalid = await store.readCandidate(canary.candidateId);
  assert.ok(durableInvalid, `${target.name}: invalid canary outcome is not durable`);
  assert.equal(durableInvalid.state, target.expectedInvalidState);
  assert.equal(durableInvalid.failureCode, target.expectedFailureCode);

  const after = await store.readPromotion(target.recordClass, target.scope);
  assert.ok(after);
  assert.equal(after.versionId, before.versionId, `${target.name}: invalid canary moved the production pointer`);
  assert.equal(after.lastKnownGoodVersionId, before.lastKnownGoodVersionId, `${target.name}: invalid canary changed LKG`);
  assert.equal(normalizedHash(after.payload), normalizedHash(before.payload), `${target.name}: invalid canary mutated the served payload`);
  assert.equal(after.key, before.key, `${target.name}: invalid canary changed the durable pointer key`);
  assert.equal(after.sourceId, before.sourceId, `${target.name}: invalid canary changed the pointer source`);
  assert.equal(after.promotedAt, before.promotedAt, `${target.name}: invalid canary rewrote the promotion instant`);
  assert.deepEqual(after.receipt, before.receipt, `${target.name}: invalid canary rewrote the GOOD receipt`);

  let heldReaderVersion: string | null = null;
  if (target.reader.kind === "READER") {
    clearPromotedReadModelCache();
    heldReaderVersion = await target.reader.readVersion();
    assert.equal(heldReaderVersion, before.versionId, `${target.name}: Reader stopped serving LKG after invalid canary`);
  }

  results[target.contractId] = {
    sourceRetrieval: "PASS",
    authenticatedAuthorityContract: "PASS",
    durableGoodReceipt: "PASS",
    durablePromotionEvent: "PASS",
    priorGoodVersion: target.priorVersionId,
    newGoodVersion: target.expectedGoodVersionId,
    readerContract: target.reader.kind,
    readerVersionBeforeInvalid: target.reader.kind === "READER" ? validReaderVersion : "NOT_APPLICABLE_NON_READER_REFERENCE",
    readerVersionAfterInvalid: target.reader.kind === "READER" ? heldReaderVersion : "NOT_APPLICABLE_NON_READER_REFERENCE",
    readerDetail: target.reader.kind === "NON_READER" ? target.reader.detail : "Typed Reader returned the exact promoted version before and after refusal.",
    durableReaderReadback: target.reader.kind === "READER" ? durableReaderReadback : "NOT_APPLICABLE_NON_READER_REFERENCE",
    deployedAppShaAndHttpConsumerEvidence: "REQUIRED_SEPARATELY",
    invalidCandidate: canary.candidateId,
    invalidState: canary.state,
    invalidFailureCode: canary.failureCode,
    invalidCandidateDurable: true,
    invalidPromoted: false,
    pointerHeld: true,
    payloadHeld: true,
    lastKnownGoodHeld: true,
    structuralReleaseContract: ZERO_RELEASE_EVENTS,
    observedReleaseEvents: "REQUIRED_SEPARATELY",
  };
}

/*
 * Exercise the failure class that never reaches a source adapter receipt: the
 * publisher is unavailable before bytes arrive. This is deliberately the last
 * data-plane mutation in the harness. A later synthetic validation refusal for
 * the same contract would replace the latest-attempt/retry presentation and
 * leave Admin showing the wrong operational state even though history remained
 * durable. The final source event must therefore be the real retry-backed
 * outage proof, with the exact dotgov pointer/LKG still untouched after every
 * other source contract has already been verified independently above.
 */
const sourceFailureTask = ROUTINE_SOURCE_TASKS.find((task) => task.id === "dotgov");
assert.ok(sourceFailureTask, "dotgov routine source task is missing");
const sourceFailureBefore = await store.readPromotion(
  sourceFailureTask.recordClass,
  sourceFailureTask.scope,
);
assert.ok(sourceFailureBefore, "dotgov has no LKG pointer before the source-unavailable canary");
assert.equal(sourceFailureBefore.versionId, expectedVersions.DOTGOV_REFERENCE.good);
const sourceFailureReceipt = runCanaryChild(
  sourceFailureTask.id,
  "SOURCE_UNAVAILABLE",
  sourceFailureBefore.versionId,
);
const sourceFailureAt = sourceFailureReceipt.attemptedAt;
assert.equal(sourceFailureReceipt.promotedVersion, null);
assert.equal(sourceFailureReceipt.state, "SOURCE_BLOCKED");
assert.equal(sourceFailureReceipt.acquisitionSucceeded, false);
assert.equal(sourceFailureReceipt.lastKnownGoodVersion, sourceFailureBefore.versionId);
const durableSourceFailure = await store.readCandidate(sourceFailureReceipt.candidateId);
assert.ok(durableSourceFailure, "source-unavailable attempt was not persisted");
assert.equal(durableSourceFailure.state, "SOURCE_BLOCKED");
const sourceFailureAfter = await store.readPromotion(
  sourceFailureTask.recordClass,
  sourceFailureTask.scope,
);
assert.deepEqual(sourceFailureAfter, sourceFailureBefore, "source outage changed canonical dotgov LKG");
const sourceFailureLkgCandidate = await store.readCandidate(sourceFailureBefore.versionId);
assert.ok(sourceFailureLkgCandidate, "dotgov LKG candidate is missing after source outage");
const sourceFailureClock = await store.clock(
  sourceFailureTask.sourceId,
  sourceFailureTask.recordClass,
  sourceFailureTask.scope,
);
assert.equal(sourceFailureClock.lastAttemptedAt, sourceFailureAt);
assert.equal(
  sourceFailureClock.lastSucceededAt,
  sourceFailureLkgCandidate.candidate.retrieval.retrievedAt,
  "source outage changed the durable last-success clock",
);
const attemptedMs = Date.parse(sourceFailureAt);
assert.equal(
  routineTaskDue(sourceFailureTask, sourceFailureClock, attemptedMs + sourceFailureTask.retryMs - 1),
  false,
  "failed source ignored its retry/backoff hold",
);
assert.equal(
  routineTaskDue(sourceFailureTask, sourceFailureClock, attemptedMs + sourceFailureTask.retryMs),
  true,
  "failed source did not become due at its registered retry instant",
);

const servedAfterCanaries = await fetchServedCommit(PUBLIC_SITE_ORIGIN, {
  runId: `pdc12-live-acceptance-after:${runId}`,
  timeoutMs: 15_000,
});
assert.equal(
  servedAfterCanaries.sha?.toLowerCase(),
  deployedSha,
  "production app SHA changed while PDC-12 data-plane canaries ran",
);

console.log("PDC12_INVALID_LKG_CANARY=" + JSON.stringify({
  runId,
  classes: results,
  emptyMeetingAttempts,
  heldMeetingLkgAttempts,
  meetingDenominator: {
    registered: MEETING_PARTITION_CONTRACTS.length,
    promotedTwoGood: [...expectedMeetingVersions.values()].filter(({ kind }) => kind === "PROMOTED_TWO_GOOD").length,
    authenticatedEmpty: Object.keys(emptyMeetingAttempts).length,
    heldLkg: Object.keys(heldMeetingLkgAttempts).length,
    everyPartitionHasPostDeployAttempt: true,
    classHasSourceAuthenticatedPromotion: true,
    semanticCanaryPartition: meetingSemanticCanaryContractId,
    deliberatelyRefusedMeetingPartitions: 1,
  },
  invalidCandidateFamilies: {
    required: 6,
    injected: invalidCanaryTargets.length,
    distinctStates: [...new Set(invalidCanaryTargets.map(({ expectedInvalidState }) => expectedInvalidState))],
    oneRepresentativePerFamily: true,
  },
  deploymentCompletedAt,
  deployedAppShaEvidence: {
    expected: deployedSha,
    before: served.sha,
    after: servedAfterCanaries.sha,
    unchanged: true,
  },
  promotionEngineIsolationAfterInjectedSourceFailure: {
    failedSource: sourceFailureTask.id,
    candidateId: sourceFailureReceipt.candidateId,
    durableState: durableSourceFailure.state,
    lastKnownGoodVersion: sourceFailureBefore.versionId,
    pointerHeld: sourceFailureAfter?.versionId === sourceFailureBefore.versionId,
    retryHeldBeforeDue: true,
    retryDueAtBoundary: true,
    unaffectedContractsVerified: Object.keys(results).filter((contractId) => contractId !== sourceFailureTask.id),
    standingRunnerSameCycleEvidence: "REQUIRED_SEPARATELY_BY_routine-civic-data-live-supervisor-proof",
  },
  boundedDataPlaneAcceptance: "PASS",
  structuralReleaseContract: ZERO_RELEASE_EVENTS,
  observedReleaseEvents: "REQUIRED_SEPARATELY",
  externalReleaseEvidence: "REQUIRED_SEPARATELY",
}));
