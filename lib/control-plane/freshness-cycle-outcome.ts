import { createHash } from "node:crypto";

import { DIGEST_LOG_KEY } from "./admin-data.ts";
import {
  OWNER_SURFACE_FORMAT_VERSION,
  assertAggregateOnly,
  type FreshnessCycleOutcome,
  intakeRuntimeObservationOutcomeIssue,
  type IntakeRuntimeObservationOutcome,
  type MapTilerUsageCollectionOutcome,
  type OwnerDigestRecord,
  routineReaderReadbackEvidenceIssue,
  type RoutineCivicDataSupervisorOutcome,
  type RoutineCivicDataReaderReadbackReference,
  type RoutineCivicDataTaskReceiptReference,
} from "./owner-surface.ts";
import { canonicalJson, type ControlPlaneRepositories } from "./repository/types.ts";
import type { MapTilerUsageSnapshot } from "./maptiler/types.ts";
import {
  intakeRuntimeObservationCycleId,
  parseIntakeRuntimeObservation,
  type IntakeRuntimeObservation,
} from "../ops/intake-runtime.ts";

export interface FreshnessCycleDigestInput {
  readonly outcome: FreshnessCycleOutcome;
  readonly lines: readonly string[];
}

export interface RoutineCivicDataSupervisorDigestInput {
  readonly outcome: RoutineCivicDataSupervisorOutcome;
  readonly lines: readonly string[];
}

export interface IntakeRuntimeObservationDigestInput {
  readonly outcome: IntakeRuntimeObservationOutcome;
  readonly lines: readonly string[];
}

export interface MapTilerUsageCollectionDigestInput {
  readonly outcome: MapTilerUsageCollectionOutcome;
  readonly lines: readonly string[];
}

export interface MapTilerUsageCollectionOutcomeInput {
  readonly candidate: MapTilerUsageSnapshot;
  readonly visible: MapTilerUsageSnapshot;
  readonly finishedAt: string;
  readonly testedSha: string | null;
  readonly host: string;
  readonly provider: string;
  readonly durable: boolean;
}

export interface IntakeRuntimeObservationOutcomeInput {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly testedSha: string | null;
  readonly host: string;
  readonly provider: string;
  readonly durable: boolean;
  readonly observation: IntakeRuntimeObservation;
}

export interface RoutineCivicDataReaderReadbackOutcomeInput {
  readonly denominator: number;
  readonly recordedPass: number;
  readonly recordedFail: number;
  readonly currentFail: number;
  readonly noops: number;
  readonly repairFailures: number;
  readonly references: readonly RoutineCivicDataReaderReadbackReference[];
}

interface RoutineCivicDataSupervisorOutcomeInput {
  readonly ballotPublications?: import("../civic-data/ballot-publication.ts").BallotPublicationSummaries;
  readonly lane?: "routine-civic-data" | "publish-now";
  readonly campaignPublicationApprovalsByState?: Readonly<Record<string, number>>;
  readonly cycleId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly testedSha: string | null;
  readonly host: string;
  readonly provider: string;
  readonly durable: boolean;
  readonly attemptedTasks: number;
  readonly verifiedSourceSuccesses: number;
  readonly verifiedSourceFailures: number;
  readonly failures: RoutineCivicDataSupervisorOutcome["failures"];
  readonly crashedTasks?: RoutineCivicDataSupervisorOutcome["crashedTasks"];

  readonly taskReceipts?: readonly RoutineCivicDataTaskReceiptReference[];

  readonly readerReadback?: RoutineCivicDataReaderReadbackOutcomeInput;
}

type RuntimeDigestInput =
  | FreshnessCycleDigestInput
  | RoutineCivicDataSupervisorDigestInput
  | IntakeRuntimeObservationDigestInput
  | MapTilerUsageCollectionDigestInput;

async function appendRuntimeDigest(
  repos: ControlPlaneRepositories,
  input: RuntimeDigestInput,
  logKey=DIGEST_LOG_KEY,
): Promise<OwnerDigestRecord> {
  const record: OwnerDigestRecord = {
    formatVersion: OWNER_SURFACE_FORMAT_VERSION,
    digestId: input.outcome.cycleId,
    writtenAt: input.outcome.finishedAt,
    headline: input.lines[0] ?? `${input.outcome.state} standing-runner cycle`,
    lines: input.lines,
    cycleOk:
      input.outcome.kind === "INTAKE_RUNTIME_OBSERVATION"
        ? input.outcome.state === "HEALTHY"
        : input.outcome.state === "SUCCEEDED",
    testedSha: input.outcome.testedSha,
    runtimeOutcome: input.outcome,
  };
  assertAggregateOnly(record, "runtime outcome digest");
  await repos.ownerDigests.append(logKey, record.digestId, record, record.writtenAt);
  return record;
}

export async function appendFreshnessCycleDigest(
  repos: ControlPlaneRepositories,
  input: FreshnessCycleDigestInput,
): Promise<OwnerDigestRecord> {
  return appendRuntimeDigest(repos, input,repos.planningState?`${DIGEST_LOG_KEY}:${repos.planningState}`:DIGEST_LOG_KEY);
}

export async function appendRoutineCivicDataSupervisorDigest(
  repos: ControlPlaneRepositories,
  input: RoutineCivicDataSupervisorDigestInput,
): Promise<OwnerDigestRecord> {
  return appendRuntimeDigest(repos, input);
}

export async function appendIntakeRuntimeObservationDigest(
  repos: ControlPlaneRepositories,
  input: IntakeRuntimeObservationDigestInput,
): Promise<OwnerDigestRecord> {
  return appendRuntimeDigest(repos, input);
}

export async function appendMapTilerUsageCollectionDigest(
  repos: ControlPlaneRepositories,
  input: MapTilerUsageCollectionDigestInput,
): Promise<OwnerDigestRecord> {
  return appendRuntimeDigest(repos, input);
}

export function intakeRuntimeObservationOutcome(
  input: IntakeRuntimeObservationOutcomeInput,
): IntakeRuntimeObservationOutcome {
  const observation = parseIntakeRuntimeObservation(input.observation);
  if (observation === null) throw new Error("INTAKE_RUNTIME_OBSERVATION_INVALID");
  const outcome: IntakeRuntimeObservationOutcome = {
    kind: "INTAKE_RUNTIME_OBSERVATION",
    state: observation.outcome,
    cycleId: intakeRuntimeObservationCycleId(input.host, observation.observedAt),
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    testedSha: input.testedSha,
    host: input.host.trim(),
    provider: input.provider.trim(),
    durable: input.durable,
    observation,
    authorityBoundary: {
      canonicalOutcomeHistory: "OWNER_DIGESTS_APPEND_ONLY",
      heartbeatRole: "LATEST_PROJECTION_ONLY",
      gitWrites: 0,
      softwareReleaseEvents: 0,
    },
  };
  const detail = intakeRuntimeObservationOutcomeIssue(outcome);
  if (detail !== null) throw new Error(`INTAKE_RUNTIME_OBSERVATION_OUTCOME_INVALID: ${detail}`);
  return outcome;
}

export function mapTilerUsageCollectionOutcome(
  input: MapTilerUsageCollectionOutcomeInput,
): MapTilerUsageCollectionOutcome {
  const attempt = input.candidate.latestAttempt ?? {
    attemptedAt: input.candidate.collectedAt,
    connection: input.candidate.connection,
    detail: input.candidate.detail,
    provenance: input.candidate.provenance,
  };
  const promoted = attempt.connection === "CONNECTED" &&
    input.visible.connection === "CONNECTED" &&
    input.visible.collectedAt === input.candidate.collectedAt;
  const retained = !promoted && attempt.connection !== "CONNECTED" &&
    input.visible.connection === "CONNECTED";
  const disposition: MapTilerUsageCollectionOutcome["disposition"] = promoted
    ? "PROMOTED_CURRENT"
    : retained
      ? "RETAINED_LKG"
      : "UNKNOWN_NO_LKG";
  const startedAt = attempt.attemptedAt;
  if (!Number.isFinite(Date.parse(startedAt)) || !Number.isFinite(Date.parse(input.finishedAt))) {
    throw new Error("MAPTILER_USAGE_OUTCOME_TIME_INVALID");
  }
  if (Date.parse(input.finishedAt) < Date.parse(startedAt)) {
    throw new Error("MAPTILER_USAGE_OUTCOME_TIME_REVERSED");
  }
  return {
    kind: "MAPTILER_USAGE_COLLECTION",
    state: promoted ? "SUCCEEDED" : "FAILED",
    cycleId: `maptiler-usage:${startedAt}`,
    startedAt,
    finishedAt: input.finishedAt,
    testedSha: input.testedSha,
    host: input.host.trim() || "unknown-host",
    provider: input.provider.trim(),
    durable: input.durable,
    attempt,
    candidate: {
      canonicalSha256: createHash("sha256").update(canonicalJson(input.candidate)).digest("hex"),
      connection: input.candidate.connection,
      since: input.candidate.since,
      until: input.candidate.until,
      rows: input.candidate.days.length,
    },
    disposition,
    visibleMeasurement: input.visible.connection === "CONNECTED"
      ? { collectedAt: input.visible.collectedAt, publisher: input.visible.publisher }
      : null,
    authorityBoundary: {
      canonicalOutcomeHistory: "OWNER_DIGESTS_APPEND_ONLY",
      currentProjection: "OWNER_SNAPSHOT_MAPTILER",
      trackedRuntimeReads: 0,
      trackedRuntimeWrites: 0,
      gitWrites: 0,
      softwareReleaseEvents: 0,
    },
  };
}

export function routineCivicDataSupervisorOutcome(
  input: RoutineCivicDataSupervisorOutcomeInput,
): RoutineCivicDataSupervisorOutcome {
  const exactTaskReceipts = input.taskReceipts !== undefined;
  const taskReceipts = input.taskReceipts ?? [];
  const crashedTasks = input.crashedTasks ?? [];
  const exactReaderReadbacks = input.readerReadback !== undefined;
  const readerReadback = input.readerReadback ?? {
    denominator: 0,
    recordedPass: 0,
    recordedFail: 0,
    currentFail: 0,
    noops: 0,
    repairFailures: 0,
    references: [],
  };
  const taskIds = taskReceipts.map(({ taskId }) => taskId);
  for (const [state, count] of Object.entries(input.campaignPublicationApprovalsByState ?? {})) {
    if (!/^[A-Z]{2}$/.test(state) || !Number.isSafeInteger(count) || count < 0 ||
      !taskReceipts.some(row => row.taskId === `candidate-campaign-sites-derived:${state}`)) {
      throw new Error("CAMPAIGN_PUBLICATION_INPUT_ACK_WITHOUT_RECEIPT");
    }
  }
  if (new Set([...taskIds, ...crashedTasks.map(({ taskId }) => taskId)]).size !== taskIds.length + crashedTasks.length) {
    throw new Error("ROUTINE_SUPERVISOR_TASK_RECEIPT_DUPLICATE");
  }
  if (taskReceipts.some((row) => row.taskId !== row.receipt.source)) {
    throw new Error("ROUTINE_SUPERVISOR_TASK_RECEIPT_ID_MISMATCH");
  }
  if (exactTaskReceipts) {
    const successes = taskReceipts.filter(({ classification }) => classification === "VERIFIED_SOURCE_SUCCESS").length;
    const failures = taskReceipts.filter(({ classification }) => classification === "VERIFIED_SOURCE_FAILURE").length;
    if (successes !== input.verifiedSourceSuccesses || failures !== input.verifiedSourceFailures) {
      throw new Error("ROUTINE_SUPERVISOR_TASK_RECEIPT_COUNT_MISMATCH");
    }
    if (taskReceipts.length + crashedTasks.length > input.attemptedTasks) {
      throw new Error("ROUTINE_SUPERVISOR_TASK_RECEIPT_DENOMINATOR_MISMATCH");
    }
    if (input.failures.length === 0 && taskReceipts.length + crashedTasks.length !== input.attemptedTasks) {
      throw new Error("ROUTINE_SUPERVISOR_SUCCESS_RECEIPT_INCOMPLETE");
    }
  }
  const {
    taskReceipts: _providedTaskReceipts,
    readerReadback: _providedReaderReadback,
    ...rest
  } = input;
  const outcome: RoutineCivicDataSupervisorOutcome = {
    kind: "ROUTINE_CIVIC_DATA_SUPERVISOR",
    state: input.failures.length === 0 ? "SUCCEEDED" : "FAILED",
    ...rest,
    taskReceiptEvidence: exactTaskReceipts ? "EXACT" : "UNAVAILABLE_OUTER_SUPERVISOR",
    taskReceipts,
    crashedTasks,
    readerReadbackEvidence: exactReaderReadbacks ? "EXACT" : "UNAVAILABLE_OUTER_SUPERVISOR",
    readerReadbackDenominator: readerReadback.denominator,
    readerReadbacksRecordedPass: readerReadback.recordedPass,
    readerReadbacksRecordedFail: readerReadback.recordedFail,
    readerReadbacksCurrentFail: readerReadback.currentFail,
    readerReadbackNoops: readerReadback.noops,
    readerReadbackRepairFailures: readerReadback.repairFailures,
    readerReadbacks: readerReadback.references,
    attributionBoundary: {
      sourceReceiptAuthority: "SOURCE_ACQUISITION_CHILD_ONLY",
      supervisorCandidateWrites: 0,
      supervisorPointerWrites: 0,
      supervisorLkgChanges: 0,
    },
  };
  if (exactReaderReadbacks) {
    const issue = routineReaderReadbackEvidenceIssue(outcome);
    if (issue !== null) throw new Error(`ROUTINE_SUPERVISOR_READER_READBACK_INVALID: ${issue}`);
  }
  return outcome;
}

export function routineSupervisorCycleIsolationIssue(
  outcome: RoutineCivicDataSupervisorOutcome,
): string | null {
  if (outcome.state !== "SUCCEEDED" || outcome.failures.length !== 0) return "SUPERVISOR_CYCLE_NOT_SUCCESSFUL";
  if (outcome.taskReceiptEvidence !== "EXACT") return "EXACT_TASK_RECEIPTS_UNAVAILABLE";
  const taskIds = outcome.taskReceipts.map(({ taskId }) => taskId);
  const candidateIds = outcome.taskReceipts.map(({ receipt }) => receipt.candidateId);
  if (new Set(taskIds).size !== taskIds.length) return "DUPLICATE_TASK_RECEIPT";
  if (new Set(candidateIds).size !== candidateIds.length) return "DUPLICATE_CANDIDATE_RECEIPT";
  if (outcome.taskReceipts.some((row) => row.taskId !== row.receipt.source)) return "TASK_RECEIPT_ID_MISMATCH";
  const successes = outcome.taskReceipts.filter(({ classification }) => classification === "VERIFIED_SOURCE_SUCCESS");
  const failures = outcome.taskReceipts.filter(({ classification }) => classification === "VERIFIED_SOURCE_FAILURE");
  if (successes.length !== outcome.verifiedSourceSuccesses || failures.length !== outcome.verifiedSourceFailures) {
    return "TASK_RECEIPT_COUNT_MISMATCH";
  }
  if (outcome.taskReceipts.length !== outcome.attemptedTasks) return "ATTEMPTED_TASK_RECEIPTS_INCOMPLETE";
  const acquisitionFailure = failures.find(({ receipt }) => !receipt.acquisitionSucceeded);
  if (!acquisitionFailure) return "NO_SOURCE_ACQUISITION_FAILURE_RECEIPT";
  const unaffectedSuccess = successes.find(({ sourceId }) => sourceId !== acquisitionFailure.sourceId);
  if (!unaffectedSuccess) return "NO_UNAFFECTED_SOURCE_SUCCESS_RECEIPT";
  return null;
}

export type LatestFreshnessCycle = Pick<FreshnessCycleOutcome, "kind" | "cycleId" | "registry" | "risk" | "incidents">;

export async function readLatestFreshnessCycleOutcome(
  repos: ControlPlaneRepositories,
): Promise<{ readonly digestId: string; readonly outcome: LatestFreshnessCycle } | null> {
  const [digest] = await repos.ownerDigests.readRecentWhere(DIGEST_LOG_KEY, ["runtimeOutcome", "kind"], "FRESHNESS_CYCLE", 1,
    { digestId: true, runtimeOutcome: ["kind", "cycleId", "registry", "risk", "incidents"] }) as
    readonly { readonly digestId?: string; readonly runtimeOutcome?: LatestFreshnessCycle }[];
  const outcome = digest?.runtimeOutcome;
  if (typeof digest?.digestId === "string" && outcome?.kind === "FRESHNESS_CYCLE") return { digestId: digest.digestId, outcome };
  return null;
}

export function freshnessCycleOutcomes(
  rows: readonly OwnerDigestRecord[],
): readonly FreshnessCycleOutcome[] {
  return rows.flatMap((row) => row.runtimeOutcome?.kind === "FRESHNESS_CYCLE" ? [row.runtimeOutcome] : []);
}

export function mapTilerUsageCollectionOutcomes(
  rows: readonly OwnerDigestRecord[],
): readonly MapTilerUsageCollectionOutcome[] {
  return rows.flatMap((row) =>
    row.runtimeOutcome?.kind === "MAPTILER_USAGE_COLLECTION" ? [row.runtimeOutcome] : []
  );
}
