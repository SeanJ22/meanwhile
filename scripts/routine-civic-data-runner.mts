/**
 * @freshness-reads-here
 *
 * One source-isolated pass of the permanent routine civic-data data plane.
 * The standing local pilot calls this after its own cycle; this process owns
 * only data cadence and can neither commit nor invoke a software release.
 * `lastAttemptedAt` and `lastSucceededAt` come only from durable source-aware
 * candidate/promotion history; a child-process failure is operational evidence
 * and never replaces a candidate's own source-through or retrieved-at facts.
 */
import { hostname } from "node:os";
import { AUTOMATIC_REFRESH_TASKS, automaticRefreshContract } from "../lib/civic-data/automatic-refresh.ts";
import { neon } from "@neondatabase/serverless";
import { campaignPublicationInputsDue, readCampaignPublicationInputs, CAMPAIGN_PUBLICATION_TASK, type CampaignPublicationInputs } from "../lib/civic-data/campaign-publication-due.ts";

import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";
import {
  classifyRoutineChildOutcome,
  durableRoutineRunnerReceiptIssue,
  parseMeetingPartitionRunnerReceipts,
  parseRoutineRunnerReceipt,
  successfulRoutineRunnerReceiptIssue,
} from "../lib/civic-data/runner-receipt.ts";
import {
  ROUTINE_SUPERVISOR_HISTORY_FIELDS,
  ROUTINE_SUPERVISOR_HISTORY_WINDOW,
} from "../lib/civic-data/supervisor-history.ts";
import {
  ROUTINE_FAILURE_DOMAIN_FRONTIER_PER_PASS,
  SITTING_WINDOW_LANE_SLOTS_PER_PASS,
  ROUTINE_SOURCE_TASKS,
  ROUTINE_SUPERVISOR_STARTED_AT_ENV,
  routineTaskFromContract,
  readRoutineTaskClocks,
  routineFailureDomainFrontier,
  routineFailureDomainRotationSeed,
  routineSupervisorCycleId,
  routinePassLaunchOrder,
  routineTaskDeadlineMs,
  routineTaskDue,
  routineAdmissionClock,
  unchangedRoutineProtocolFailure,
  routineTaskSelection,
  routinePreSpawnMemoryDeferral,
  sittingWindowSignals,
  routineUnreceiptedSupervisorAttemptHistory,
  type RoutineSupervisorAttemptHistory,
  type RoutineTaskClock,
  type RoutineSourceTask,
} from "../lib/civic-data/runner.ts";
import {
  MEETING_PARTITION_CONTRACTS,
  observableRoutineContracts,
} from "../lib/civic-data/meeting-partitions.ts";
import { recordDoorOutcome, type DoorOutcome } from "../lib/doors/outcome.ts";
import { observedChangeMinutesByDoor } from "../lib/doors/observed-rate.ts";
import { isDoorRecord } from "../lib/doors/registry.ts";
import { doorReadModeFromEnv, refreshDoorsForPass } from "../lib/doors/install.ts";
import { doorSeedOnFromEnv, seedDoorsOnStart } from "../lib/doors/seed-all.ts";
import { readNowDueRequests, settleReadNow } from "../lib/doors/mission-refresh.ts";
import { editDeriveDueRequests } from "../lib/doors/edit-derive.ts";
import { listDoors } from "../lib/doors/registry.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { attestPromotedVersion } from "../lib/civic-data/read-model.ts";
import { ATTESTED_PROMOTIONS_ENV, serializeAttestedPromotions } from "../lib/civic-data/attested-promotion.ts";
import { readRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";
import { REGISTRY_RUNTIME_SCOPE } from "../lib/registry/runtime-data-plane.ts";
import {
  ROUTINE_CHILD_MAX_BUFFER_BYTES,
  ROUTINE_CHILD_TIMEOUT_MS,
  ROUTINE_SAME_DOMAIN_CHILD_GAP_MS,
  runBoundedChildPass,
  type BoundedChildCommand,
  type BoundedChildResult,
} from "../lib/civic-data/bounded-child-pass.ts";
import {
  HOT_READ_CATCH_UP_CONCURRENCY,
  hotReadCatchUpAdmission,
  repairDomainRacesHotReads,
  routinePassSourceCatchUpDeadlineMs,
  routinePassWorkDeadlineMs,
  runRoutinePassWithHotReadCatchUp,
} from "../lib/civic-data/hot-read-catch-up.ts";
import { statedSittingEndsByScope, statedSittingEndsRead } from "../lib/civic-data/sitting-window-admission.ts";
import {
  DOOR_DERIVE_CONTRACT_IDS,
  parseRoutineDueRequests,
  routineDueRequestDeadlineMs,
  routineDueRequestFor,
  type RoutineDueRequest,
} from "../lib/civic-data/routine-due-request.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { expansionScopesOf } from "../lib/control-plane/expansion/scopes.ts";
import { resolveScopes } from "../lib/control-plane/expansion/runner-load.ts";
import { loadPublishedLookupState } from "../lib/census-geography/reader.ts";
import { readIntents, RESEARCH_INTENT_LOG_KEY } from "../lib/control-plane/scheduler/research-policy.ts";
import { admittedHuntSourceScopes, huntSourceTasks } from "../lib/civic-data/hunt-source-tasks.ts";
import { workerPublicationTasks } from "../lib/civic-data/worker-publication-tasks.ts";
import { WORKER_PUBLICATION_TASK_IDS } from "../lib/civic-data/worker-reader-contracts.ts";
import { readCompletedWorkerResults } from "../lib/control-plane/repository/worker-completion.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "../lib/civic-data/manual-contracts.ts";
import {
  ROUTINE_READER_CHILD_CONCURRENCY,
  ROUTINE_READER_SINGLE_TIMEOUT_MS,
  reconcileRoutineReaderRepairDomain,
  routineReaderRepairDomains,
  selectedReaderRepairContracts,
  type RoutineReaderRepairDomain,
} from "../lib/civic-data/reader-repair-protocol.ts";
import {
  acquireProcessSingleton,
  ProcessSingletonHeldError,
  ROUTINE_DATA_RUNNER_SINGLETON_PORT,
} from "../lib/civic-data/process-singleton.ts";
import {
  appendRoutineCivicDataSupervisorDigest,
  routineCivicDataSupervisorOutcome,
} from "../lib/control-plane/freshness-cycle-outcome.ts";
import { DIGEST_LOG_KEY } from "../lib/control-plane/admin-data.ts";
import { OWNER_SURFACE_FORMAT_VERSION, HUNT_SOURCE_PROGRESS_LOG_KEY, assertAggregateOnly, type HuntSourceProgress } from "../lib/control-plane/owner-surface.ts";
import type {
  RoutineCivicDataReaderReadbackReference,
  RoutineCivicDataTaskReceiptReference,
} from "../lib/control-plane/owner-surface.ts";
import {
  CONTROL_PLANE_URL_VAR,
  controlPlaneUrlFromEnv,
  createPgRepositories,
} from "../lib/control-plane/repository/pg-store.ts";
import { withControlPlaneConnectRetry } from "../lib/control-plane/repository/connect-retry.ts";
import { assertDurableRepositories } from "../lib/control-plane/repository/types.ts";
import { getDb } from "../lib/db/index.ts";
import { startCivicReadCacheHost } from "../lib/db/civic-read-cache-host.ts";
import { placeSourceLaunchOrder, withNationalPlaceTasks } from "../lib/hunt/place-source-admission.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { flushDatabaseTransfer } from "../lib/db/transfer.ts";
import { publishRoutineReaderEdge } from "../lib/civic-data/reader-edge-publication.ts";
import { floored } from "../lib/ops/denominator-floor.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { readFieldManual } from "../lib/control-plane/field-manual.ts";
import { startWorkerToolsHost } from "../lib/control-plane/workers/process-pool.ts";
import { sharedScoutBrowser } from "./scout-browse.mts";
import { routineProcessSlots } from "../lib/control-plane/workers/worker-slots.ts";
import { sanitizedErrorDiagnostic } from "../lib/ops/error-diagnostic.ts";
import { childFatalLine, installFatalLine } from "../lib/ops/fatal-line.ts";
import {
  admittedRuntimeChildEnvironment,
  assertRuntimeAuthority,
} from "../lib/civic-data/runtime-authority.ts";

// An error nothing below catches ends this process through one sanitized
// protocol line naming the step, which the parent quotes (lib/ops/fatal-line.ts).
let step = "reading its task selection";
installFatalLine("routine-civic-data-runner", () => step);

const ROOT = process.cwd();
// Place-task expansion also reads canonical geography. Give those startup
// reads the same held copies as the later source and Reader children.
const readCacheHost = await startCivicReadCacheHost();
const FORCE = process.argv.includes("--force");
// DB-13: with WTP_DOORS_READ=registry the meeting work is built from the door
// registry on every pass; otherwise (the default) the code's list is used as before.
const CODE_MEETING_PARTITION_IDS = new Set(MEETING_PARTITION_CONTRACTS.map((contract) => contract.id));
if ((doorReadModeFromEnv() === "registry" || doorSeedOnFromEnv()) && controlPlaneUrlFromEnv() !== null) {
  try {
    const doorRepos = await createPgRepositories(controlPlaneUrlFromEnv()!, new Date().toISOString(), { skipBootstrap: true });
    // DB-10/DB-11/DB-23: an empty registry is seeded once from today's doors (WTP_DOORS_SEED=on); otherwise nothing is written.
    const seeded = await seedDoorsOnStart(doorRepos.doors);
    console.log(`RCD_TASK routine-civic-data-runner: door registry seed — ${seeded.seeded ? `${seeded.result.total} doors now held` : seeded.reason}`);
    if (doorReadModeFromEnv() === "registry") {
      const doorPass = await refreshDoorsForPass(doorRepos.doors);
      console.log(`RCD_TASK routine-civic-data-runner: meeting doors read from ${doorPass.reading} (${doorPass.partitions?.partitions ?? doorPass.rows} partitions)` +
        `${doorPass.reason ?? doorPass.partitions?.reason ? ` — ${doorPass.reason ?? doorPass.partitions?.reason}` : ""}`);
    }
  } catch (error) {
    console.warn(`RCD_TASK routine-civic-data-runner: the door registry could not be read, the code's meeting list stays in use — ${error instanceof Error ? error.message : String(error)}`);
  }
}
const STANDING_SOURCE_TASKS = await withNationalPlaceTasks([
  ...ROUTINE_SOURCE_TASKS.filter((task) => !CODE_MEETING_PARTITION_IDS.has(task.id)),
  ...MEETING_PARTITION_CONTRACTS.map(routineTaskFromContract),
  ...AUTOMATIC_REFRESH_TASKS,
], process.argv.slice(2));
const TASK_SELECTION = routineTaskSelection(process.argv.slice(2), [...STANDING_SOURCE_TASKS, ...WORKER_PUBLICATION_TASK_IDS.map(id => ({ id }))]);
const ONLY = TASK_SELECTION.ok ? TASK_SELECTION.only : null;
const inheritedStartedAt = process.env[ROUTINE_SUPERVISOR_STARTED_AT_ENV];
const RUN_STARTED_AT = inheritedStartedAt && Number.isFinite(Date.parse(inheritedStartedAt)) &&
    new Date(Date.parse(inheritedStartedAt)).toISOString() === inheritedStartedAt
  ? inheritedStartedAt
  : new Date().toISOString();
const SUPERVISOR_CYCLE_ID = routineSupervisorCycleId(hostname(), RUN_STARTED_AT);
const MEETING_PARTITION_TASK_IDS = new Set(MEETING_PARTITION_CONTRACTS.map((contract) => contract.id));

// Every supervisor-side canonical read/write has real transport cancellation.
// Source acquisition remains under its stronger OS-process boundary.
installNeonRequestDeadline();

if (!TASK_SELECTION.ok) {
  console.error(
    `RCD_TASK routine-civic-data-runner: SUPERVISOR_FAILURE (CONFIG_REFUSED) — ` +
      `${TASK_SELECTION.code}: ${TASK_SELECTION.detail}; zero source candidates or clocks were written`,
  );
  process.exitCode = 2;
}

// Production scheduling authority must be proved before the singleton, store,
// clocks, or any child capability can be opened.
step = "proving its runtime authority";
const RUNNING_CODE_SHA = TASK_SELECTION.ok
  ? assertRuntimeAuthority({ capabilities: ["ROUTINE_SUPERVISOR"] }).sha
  : null;

// Manual invocation and the standing pilot share this same atomic host-local
// door. A second runner fails before opening the store or reading due clocks;
// the kernel releases the lease if this process dies.
step = "taking the host-local singleton";
const ROUTINE_DATA_PROCESS_LEASE = TASK_SELECTION.ok ? await (async () => {
  try {
    return await acquireProcessSingleton(
      "routine-civic-data-runner",
      ROUTINE_DATA_RUNNER_SINGLETON_PORT,
    );
  } catch (error) {
    if (!(error instanceof ProcessSingletonHeldError)) throw error;
    console.error(
      `RCD_TASK routine-civic-data-runner: SUPERVISOR_FAILURE (REFUSED_CONCURRENT) — ${error.message}; ` +
        "zero source candidates or clocks were written",
    );
    process.exitCode = 2;
    return null;
  }
})() : null;

const sharedBrowser = sharedScoutBrowser();
const workerToolsHost = ROUTINE_DATA_PROCESS_LEASE && controlPlaneUrlFromEnv()
  ? await startWorkerToolsHost({ knowledge: await readFieldManual(await createPgRepositories(controlPlaneUrlFromEnv()!,
    RUN_STARTED_AT, { skipBootstrap: true })), browse: sharedBrowser.browse }) : null;
const routineMemorySlots = routineProcessSlots();
const childMemoryReleases = new Map<string, () => void>();
const startedSourceChildren = new Set<string>();
async function acquireChildMemory(command: BoundedChildCommand): Promise<void> {
  const script = command.args.find(arg => /[.](?:mts|ts)$/.test(arg))?.split(/[\\/]/).at(-1) ?? "";
  const release = await routineMemorySlots.acquire(`${command.id}/${script}`, Date.now() + ROUTINE_CHILD_TIMEOUT_MS);
  childMemoryReleases.set(command.id, release);
  (command as { onStarted?: (pid: number) => void }).onStarted = pid => {
    startedSourceChildren.add(command.id);
    release.observe?.(pid);
  };
}
function releaseChildMemory(id: string): void {
  childMemoryReleases.get(id)?.(); childMemoryReleases.delete(id);
  startedSourceChildren.delete(id);
}

/**
 * DB-30: how often each open door has been seen to change, by door id (a task's id is its door's id), so a door that
 * changes faster than its policy is checked as often as it changes. A registry that cannot be read leaves every
 * task on its policy; it never stops a read.
 */
async function readObservedChangeRates(): Promise<ReadonlyMap<string, number>> {
  const connection = controlPlaneUrlFromEnv();
  if (connection === null) return new Map();
  try {
    doorOutcomeRepos ??= createPgRepositories(connection, RUN_STARTED_AT, { skipBootstrap: true });
    const rows = await (await doorOutcomeRepos).doors.list();
    return observedChangeMinutesByDoor(rows.map((row) => row.value).filter(isDoorRecord));
  } catch (error) {
    console.warn(`RCD_DOORS: observed change rates not read — ${error instanceof Error ? error.message : String(error)}; every task stays on its policy cadence`);
    return new Map();
  }
}

/**
 * DB-21: a hand-wired meeting door's last success or failure, from its partition's
 * promotion outcome. A derived family's members are recorded by the family's own
 * child, from each member's result. A door that is not in the registry is left alone,
 * and a registry that cannot be written never changes the outcome of the pass.
 */
let doorOutcomeRepos: Promise<Awaited<ReturnType<typeof createPgRepositories>>> | null = null;
async function recordMeetingDoorOutcome(taskId: string, outcome: DoorOutcome, changed = false): Promise<void> {
  const connection = controlPlaneUrlFromEnv();
  if (connection === null) return;
  try {
    doorOutcomeRepos ??= createPgRepositories(connection, RUN_STARTED_AT, { skipBootstrap: true });
    await recordDoorOutcome((await doorOutcomeRepos).doors, taskId, outcome, new Date().toISOString(), changed);
  } catch (error) {
    console.warn(`RCD_TASK ${taskId}: the door's last ${outcome === "SUCCESS" ? "success" : "failure"} could not be recorded — ${error instanceof Error ? error.message : String(error)}`);
  }
}

interface SupervisorFailure {
  readonly taskId: string;
  readonly code: string;
  readonly detail: string;
}

type PendingRun =
  | {
      readonly kind: "SINGLE";
      readonly id: string;
      readonly command: readonly string[];
      readonly task: RoutineSourceTask;
    }
  | {
      readonly kind: "MEETING_PARTITION";
      readonly id: string;
      readonly command: readonly string[];
      readonly task: RoutineSourceTask;
    };

function boundedExecutionFailure(run: BoundedChildResult): SupervisorFailure | null {
  if (run.termination === "EXITED") return null;
  const code = run.termination === "TIMED_OUT"
    ? "CHILD_TIMEOUT"
    : run.termination === "OUTPUT_LIMIT_EXCEEDED"
      ? "CHILD_OUTPUT_LIMIT_EXCEEDED"
      : "CHILD_SPAWN_FAILED";
  return {
    taskId: run.id,
    code,
    detail: `${run.termination}: ${safeFailure(`${run.errorMessage ?? ""}\n${run.stdout}\n${run.stderr}`)}`,
  };
}

function safeFailure(value: string): string {
  return value
    .replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/gi, "$1[credentials-redacted]@")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-8)
    .join(" | ")
    .slice(0, 4_000) || "The source process exited without a diagnostic.";
}

/**
 * A child that died before producing a source receipt has no source clock to
 * apply retry backoff or rotate behind same-provider siblings. Its existing supervisor
 * fault is the operational attempt clock. Reading that clock from the same
 * owner log Admin consumes prevents one broken partition from monopolizing a
 * shared publisher frontier without fabricating a source attempt.
 */
async function latestUnreceiptedSupervisorAttempts(selectedTasks: readonly RoutineSourceTask[]): Promise<RoutineSupervisorAttemptHistory & { readonly protocolFailures: readonly unknown[] }> {
  const connection = controlPlaneUrlFromEnv();
  if (connection === null) {
    throw new Error(`${CONTROL_PLANE_URL_VAR} is not configured; provider-frontier fairness cannot be proved.`);
  }
  const repos = await createPgRepositories(connection, RUN_STARTED_AT, { skipBootstrap: true });
  assertDurableRepositories(repos, "routine civic-data provider-frontier history");
  const taskIds = new Set(selectedTasks.map(({ id }) => id));
  /* skipBootstrap does no I/O, so this read is the supervisor's first connect;
     a transient Neon connect blip here would otherwise abort the whole routine
     civic-data pass at its start. The read is idempotent, so retry it — same
     resilience the schema bootstrap gets. See connect-retry.ts. */
  const supervisorOutcomes = await withControlPlaneConnectRetry(
    /* Read recent outcomes for retry admission and ordering, only the fields the
       history validates: the newest window, narrowed by the store, oldest first
       again so the rows keep their append order. Never every outcome whole. */
    async () => [...await repos.ownerDigests.readRecentWhere(
      DIGEST_LOG_KEY,
      ["runtimeOutcome", "kind"],
      "ROUTINE_CIVIC_DATA_SUPERVISOR",
      ROUTINE_SUPERVISOR_HISTORY_WINDOW,
      ROUTINE_SUPERVISOR_HISTORY_FIELDS,
    )].reverse(),
    {
      onRetry: ({ attempt, delayMs, error }) =>
        console.warn(
          `routine civic-data supervisor-history connect: transient failure on attempt ${attempt}; ` +
            `retrying in ${delayMs}ms — ${error instanceof Error ? error.message : String(error)}`,
        ),
    },
  );
  // This job's failure is saved as soon as it ends, while unrelated children
  // can keep the round open. Waiting for the round digest repeated the defect.
  const protocolFailures = await withControlPlaneConnectRetry(() => repos.ownerDigests.readRecentWhere(
    HUNT_SOURCE_PROGRESS_LOG_KEY, ["huntSourceProgress", "stage"], "FAILED",
    ROUTINE_SUPERVISOR_HISTORY_WINDOW, { testedSha: true, huntSourceProgress: true },
  ));
  return { ...routineUnreceiptedSupervisorAttemptHistory(supervisorOutcomes, taskIds), protocolFailures };
}

/**
 * The owner's open due requests (lib/civic-data/routine-due-request.ts): one
 * small aggregate read. A request only brings a partition's read forward, so a
 * failed read leaves every task on its normal schedule, and says so.
 */
async function readRoutineDueRequests(): Promise<{ readonly requests: readonly RoutineDueRequest[]; readonly issues: readonly string[] }> {
  const connection = controlPlaneUrlFromEnv();
  if (connection === null) throw new Error(`${CONTROL_PLANE_URL_VAR} is not configured`);
  const repos = await createPgRepositories(connection, RUN_STARTED_AT, { skipBootstrap: true });
  const row = await withControlPlaneConnectRetry(() => repos.adminConfig.read(ADMIN_CONFIG_ID));
  return parseRoutineDueRequests(row?.value.routineDueRequests);
}

/** Resolve the actual Admin Send for hunt work. Publication of work that
 * already meets §3 needs no Send (it is not paid work); a paused runner or an
 * unreadable control still admits nothing. */
async function readHuntSourceTasks(): Promise<readonly RoutineSourceTask[]> {
  // An explicit selection of a publication door (`--only=registry-runtime-bindings`) still reads its owed work.
  if (FORCE || (ONLY && !WORKER_PUBLICATION_TASK_IDS.some(id => ONLY.has(id)))) return [];
  const connection = controlPlaneUrlFromEnv();
  if (!connection) throw new Error("control-plane reporting connection is unavailable");
  const repos = await createPgRepositories(connection, RUN_STARTED_AT, { skipBootstrap: true });
  const intents = readIntents([...(await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY))]);
  if (intents.runnerPause.paused) return [];
  const items = (await repos.workItems.list()).map(row => row.value);
  const workers = items.some(item => item.autonomousPlan?.publication) ? await readCompletedWorkerResults(repos) : [];
  const publication = workerPublicationTasks(items, workers, RUN_STARTED_AT);
  const row = await repos.adminConfig.read(ADMIN_CONFIG_ID);
  if (row === null) return publication;
  if (!isAdminConfig(row.value)) throw new Error("the owner's policy row is unreadable");
  const held = expansionScopesOf(row.value);
  if (held.malformed) throw new Error("the owner's scope list contains unreadable decisions");
  const currentSends = held.scopes.filter(scope => scope.sourceWorkVersion === 1);
  if (currentSends.length === 0) return publication;
  const lookup = await loadPublishedLookupState({ bypassCache: true });
  const resolved = await resolveScopes(currentSends, lookup, null);
  for (const scope of resolved.scopes) {
    if (scope.kind === "UNRESOLVED") throw new Error(`scope ${scope.decision.key}: ${scope.why}`);
  }
  const admitted = admittedHuntSourceScopes(resolved.scopes, RUN_STARTED_AT);
  if (admitted.length === 0) return publication;
  return [...huntSourceTasks(admitted, RUN_STARTED_AT, items), ...publication];
}

function newestConsideredAt(
  clock: RoutineTaskClock | undefined,
  supervisorAttemptAt: string | undefined,
): string | null {
  const values = [clock?.lastAttemptedAt, supervisorAttemptAt]
    .filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)));
  return values.sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
}

async function persistSupervisorOutcome(input: {
  readonly campaignPublicationApprovalsAttempted?: number;
  readonly failures: readonly SupervisorFailure[];
  readonly attemptedTasks: number;
  readonly verifiedSourceSuccesses: number;
  readonly verifiedSourceFailures: number;
  readonly finishedAt: string;
  readonly taskReceipts: readonly RoutineCivicDataTaskReceiptReference[];
  /** Owner due requests this pass honoured or deferred, one line each. */
  readonly dueRequestLines: readonly string[];
  readonly readerReadback: {
    readonly denominator: number;
    readonly recordedPass: number;
    readonly recordedFail: number;
    readonly currentFail: number;
    readonly noops: number;
    readonly repairFailures: number;
    readonly references: readonly RoutineCivicDataReaderReadbackReference[];
  };
}): Promise<string> {
  if (RUNNING_CODE_SHA === null) {
    throw new Error("ROUTINE_SUPERVISOR_TESTED_SHA_UNAVAILABLE");
  }
  const connection = controlPlaneUrlFromEnv();
  if (connection === null) {
    throw new Error(`${CONTROL_PLANE_URL_VAR} is not configured; the supervisor outcome cannot be made durable.`);
  }
  const repos = await createPgRepositories(connection, input.finishedAt);
  assertDurableRepositories(repos, "routine civic-data supervisor outcomes");
  const cycleId = SUPERVISOR_CYCLE_ID;
  const outcome = routineCivicDataSupervisorOutcome({
    ...(input.campaignPublicationApprovalsAttempted !== undefined ? { campaignPublicationApprovalsAttempted: input.campaignPublicationApprovalsAttempted } : {}),
    cycleId,
    startedAt: RUN_STARTED_AT,
    finishedAt: input.finishedAt,
    testedSha: RUNNING_CODE_SHA,
    host: hostname(),
    provider: repos.describe(),
    durable: repos.durable,
    attemptedTasks: input.attemptedTasks,
    verifiedSourceSuccesses: input.verifiedSourceSuccesses,
    verifiedSourceFailures: input.verifiedSourceFailures,
    failures: input.failures,
    taskReceipts: input.taskReceipts,
    readerReadback: input.readerReadback,
  });
  await appendRoutineCivicDataSupervisorDigest(repos, {
    outcome,
    lines: [
      input.failures.length === 0
        ? `ROUTINE CIVIC DATA CYCLE COMPLETED — ${input.taskReceipts.length} exact task receipt(s)`
        : `ROUTINE CIVIC DATA SUPERVISOR FAILED — ${input.failures.length} task process/protocol failure(s)`,
      `${input.verifiedSourceSuccesses} source task(s) promoted; ${input.verifiedSourceFailures} source task(s) held their own LKG.`,
      `${input.readerReadback.recordedPass} Reader PASS receipt(s) recorded; ` +
        `${input.readerReadback.recordedFail + input.readerReadback.currentFail} Reader failure receipt(s) ` +
        `recorded/current; ${input.readerReadback.repairFailures} Reader repair mechanism failure(s).`,
      ...input.dueRequestLines,
      ...input.failures.map((failure) => `${failure.taskId}: ${failure.code} — ${failure.detail}`),
      "Source outcomes were attributed only from exact durable receipts; the supervisor neither fabricated nor altered candidates, pointers, or LKG.",
    ],
  });
  return cycleId;
}

if (ROUTINE_DATA_PROCESS_LEASE !== null) {
step = "opening the production store";
prepareProductionCivicDataWrite();
const store = new PostgresRoutineDataStore();
let attempted = 0;
let verifiedSourceSuccesses = 0;
let verifiedSourceFailures = 0;
const supervisorFailures: SupervisorFailure[] = [];
const pendingRuns: PendingRun[] = [];
const verifiedTaskReceipts: RoutineCivicDataTaskReceiptReference[] = [];
const dueCandidates: { readonly pending: PendingRun; readonly clock: RoutineTaskClock | undefined }[] = [];
// When each lane's last read of this pass ended: a catch-up meeting read keeps
// the same-host gap after it (C6).
const laneLastEndedMs = new Map<string, number>();
// The pass's own source reads not yet settled: their lanes take no catch-up read.
const unsettledSourceRuns = new Set<string>();

function captureTaskReceipt(
  pending: PendingRun,
  receipt: RoutineCivicDataTaskReceiptReference["receipt"],
  classification: RoutineCivicDataTaskReceiptReference["classification"],
): void {
  verifiedTaskReceipts.push({
    taskId: pending.task.id,
    sourceId: pending.task.sourceId,
    recordClass: pending.task.recordClass,
    scope: pending.task.scope,
    classification,
    receipt,
    ...(pending.task.ownerInvocation ? { instructionIds: pending.task.ownerInvocation.instructions } : {}),
  });
}

let sourceProgressRepos: ReturnType<typeof createPgRepositories> | null = null;
async function recordHuntSourceProgress(task: RoutineSourceTask, stage: HuntSourceProgress["stage"], detail: string, candidateId: string | null = null): Promise<void> {
  if (!task.ownerInvocation) return;
  const connection = controlPlaneUrlFromEnv();
  if (!connection) throw new Error("HUNT_PROGRESS_STORE_UNAVAILABLE");
  sourceProgressRepos ??= createPgRepositories(connection, RUN_STARTED_AT, { skipBootstrap: true });
  const repos = await sourceProgressRepos;
  const at = new Date().toISOString();
  const progress: HuntSourceProgress = { instructionIds: task.ownerInvocation.instructions, taskId: task.id,
    sourceId: task.sourceId, scope: task.scope, stage, at, detail: safeFailure(detail), candidateId,
    readerPaths: stage === "PUBLISHED" || stage === "REUSED" ? task.contract.readerProjection?.consumers.filter(path => path.startsWith("/") && !path.startsWith("//")) ?? [] : [] };
  const digestId = `${SUPERVISOR_CYCLE_ID}:${task.id}:${stage}`;
  assertAggregateOnly(progress, "hunt source progress");
  await repos.ownerDigests.append(HUNT_SOURCE_PROGRESS_LOG_KEY, digestId, { formatVersion: OWNER_SURFACE_FORMAT_VERSION,
    digestId, writtenAt: at, headline: `${task.id}: ${stage}`, lines: [progress.detail], cycleOk: null,
    testedSha: RUNNING_CODE_SHA, huntSourceProgress: progress }, at);
}

// Resolve every due scope at one frozen instant before launching. Canonical
// clock reads drain through an ordered bounded pool, and the Neon transport
// deadline makes each failure real cancellation rather than an orphaned
// Promise. The provider frontier below then
// admits one least-recently-considered partition per upstream. This is the
// permanent cross-cycle boundary: a host with 32 partitions cannot stretch a
// single pass to 32 child ceilings and prevent a newly due unrelated source
// from entering the next pass.
const admissionNowMs = Date.now();
let huntTasks: readonly RoutineSourceTask[] = [];
try {
  huntTasks = await readHuntSourceTasks();
} catch (error) {
  const detail = safeFailure(sanitizedErrorDiagnostic(error));
  supervisorFailures.push({ taskId: "hunt-source-admission", code: "HUNT_SCOPE_UNREAD", detail });
  console.error(`RCD_TASK hunt-source-admission: SUPERVISOR_FAILURE (CANNOT_TELL) — ${detail}`);
}
// A standing refresh already covers a Send for its source; don't launch duplicate children for the same pointer.
const selectedTasks = [...STANDING_SOURCE_TASKS, ...huntTasks.filter(task => !STANDING_SOURCE_TASKS.some(standing => standing.id === task.id))]
  .filter((task) => !ONLY || ONLY.has(task.id) || (task.registeredContractId !== undefined && ONLY.has(task.registeredContractId)));
step = "reading the routine task clocks";
const clockReads = FORCE
  ? selectedTasks.map((task) => ({ task, ok: true as const, clock: undefined, error: null }))
  : await readRoutineTaskClocks(
      selectedTasks,
      (task) => store.clock(task.sourceId, task.recordClass, task.scope),
    );
// Meeting sources follow their bodies' sittings; the window is decided once,
// at the same frozen instant, from this pass's own clock reads. A sitting's
// publisher-stated end, where one exists, decides when it concluded (C6); an
// unreadable end set falls back to the day bound and is reported.
let statedEndsByTask: ReadonlyMap<string, ReadonlyMap<string, number>> = new Map();
if (!FORCE && selectedTasks.some(task => task.recordClass === "MEETING")) {
  try {
    const byScope = statedSittingEndsByScope(await statedSittingEndsRead(getDb()));
    statedEndsByTask = new Map(selectedTasks.flatMap((task) =>
      task.recordClass === "MEETING" && byScope.has(task.scope) ? [[task.id, byScope.get(task.scope)!] as const] : []));
  } catch (error) {
    const detail = safeFailure(sanitizedErrorDiagnostic(error));
    supervisorFailures.push({ taskId: "routine-civic-data-stated-sitting-ends", code: "STATED_ENDS_READ_FAILED", detail });
    console.error(`RCD_TASK routine-civic-data-stated-sitting-ends: SUPERVISOR_FAILURE (CANNOT_TELL) — ${detail}`);
  }
}
const sittingSignals = sittingWindowSignals(clockReads, admissionNowMs, statedEndsByTask);
// An owner due request brings one meeting partition's read forward; the pass
// then treats it exactly as any due task (lib/civic-data/routine-due-request.ts).
step = "reading the owner's due requests";
let dueRequests: readonly RoutineDueRequest[] = [];
if (!FORCE) {
  try {
    const read = await readRoutineDueRequests();
    dueRequests = read.requests;
    for (const issue of read.issues) console.log(`RCD_DUE_REQUEST ignored — ${safeFailure(issue)}`);
  } catch (error) {
    console.log(`RCD_DUE_REQUEST CANNOT_TELL — ${safeFailure(sanitizedErrorDiagnostic(error))}; every task keeps its normal schedule`);
  }
}
// DB-56: with the door registry in use, a door marked to be read now (a mission started in its place) is the same
// due request an owner's controlled refresh makes, so the ordinary pass reads it. Spent marks are cleared first.
if (!FORCE && doorReadModeFromEnv() === "registry" && controlPlaneUrlFromEnv() !== null) {
  try {
    const doorRepos = await createPgRepositories(controlPlaneUrlFromEnv()!, RUN_STARTED_AT, { skipBootstrap: true });
    const settledAt = new Date().toISOString();
    const cleared = await settleReadNow(doorRepos.doors, settledAt);
    const marked = readNowDueRequests((await listDoors(doorRepos.doors)).doors, new Set(MEETING_PARTITION_CONTRACTS.map((contract) => contract.id)), settledAt);
    // DB-36: a door edited in Admin asks for the two derive steps now, not on their six-hour clock.
    const derive = editDeriveDueRequests((await listDoors(doorRepos.doors)).doors, new Set(DOOR_DERIVE_CONTRACT_IDS), settledAt);
    dueRequests = [...dueRequests, ...[...marked, ...derive].filter((request) => !dueRequests.some((held) => held.id === request.id))];
    if (marked.length > 0 || cleared > 0 || derive.length > 0) console.log(`RCD_DUE_REQUEST doors marked to be read now: ${marked.length} due, ${cleared} settled; ${derive.length} derive request(s) after door edits`);
  } catch (error) {
    console.log(`RCD_DUE_REQUEST doors marked to be read now CANNOT_TELL — ${safeFailure(sanitizedErrorDiagnostic(error))}; every task keeps its normal schedule`);
  }
}
const honouredDueRequests = new Map<string, RoutineDueRequest>();
// Newly verified findings need not wait for the hourly fallback clock. This
// read changes no data; admission uses the same frontier and publication child.
let campaignPublicationInputs: CampaignPublicationInputs | null = null;
const publicationInputLines: string[] = [];
if (!FORCE && selectedTasks.some(task => task.id === CAMPAIGN_PUBLICATION_TASK)) {
  try {
    const connection = controlPlaneUrlFromEnv();
    if (!connection) throw new Error("control-plane reporting connection is unavailable");
    const sql = neon(connection);
    campaignPublicationInputs = await readCampaignPublicationInputs((query, params) => sql.query(query, params), RUNNING_CODE_SHA);
  } catch (error) {
    const detail = safeFailure(sanitizedErrorDiagnostic(error));
    supervisorFailures.push({ taskId: CAMPAIGN_PUBLICATION_TASK, code: "PUBLICATION_INPUT_CLOCK_UNREAD", detail });
    console.error(`RCD_INPUT_CHANGED ${CAMPAIGN_PUBLICATION_TASK}: ${detail}; normal cadence retained`);
  }
}
step = "reading unreceipted supervisor attempts";
let supervisorAttempts: ReadonlyMap<string, string> = new Map();
let protocolFailures: readonly unknown[] = [];
if (selectedTasks.length > 0) try {
  const history = await latestUnreceiptedSupervisorAttempts(selectedTasks);
  supervisorAttempts = history.attempts;
  protocolFailures = history.protocolFailures;
  for (const issue of history.issues) {
    const detail = safeFailure(`${issue.digestId}: ${issue.detail}`);
    supervisorFailures.push({
      taskId: `routine-civic-data-provider-frontier-history:${issue.rowIndex}`,
      code: issue.code,
      detail,
    });
    console.error(
      `RCD_TASK routine-civic-data-provider-frontier-history:${issue.rowIndex}: ` +
        `SUPERVISOR_FAILURE (CANNOT_TELL) — ${detail}`,
    );
  }
} catch (error) {
  const detail = safeFailure(sanitizedErrorDiagnostic(error));
  supervisorFailures.push({
    taskId: "routine-civic-data-provider-frontier",
    code: "SUPERVISOR_HISTORY_READ_FAILED",
    detail,
  });
  console.error(`RCD_TASK routine-civic-data-provider-frontier: SUPERVISOR_FAILURE (CANNOT_TELL) — ${detail}`);
}

const observedChangeRates = await readObservedChangeRates();
for (const read of clockReads) {
  const { task } = read;
  if (!read.ok) {
    const detail = safeFailure(read.error);
    supervisorFailures.push({ taskId: task.id, code: "DURABLE_CLOCK_READ_FAILED", detail });
    console.error(`RCD_TASK ${task.id}: SUPERVISOR_FAILURE (CANNOT_TELL) — ${detail}`);
    continue;
  }
  const durableClock = routineAdmissionClock(read.clock, supervisorAttempts.get(task.id), admissionNowMs);
  if (!FORCE && unchangedRoutineProtocolFailure(task, read.clock, protocolFailures, RUNNING_CODE_SHA, admissionNowMs)) {
    console.log(`RCD_SKIP ${task.id}: unchanged receipt failure; awaiting changed code, Send or source evidence`);
    continue;
  }
  const sittingHot = sittingSignals.get(task.id);
  const observedChange = observedChangeRates.get(task.id);
  const observedEveryMs = observedChange === undefined ? undefined : observedChange * 60_000;
  const dueRequest = FORCE ? null : routineDueRequestFor(task, durableClock, admissionNowMs, dueRequests);
  const publicationDue = campaignPublicationInputsDue(task.id, campaignPublicationInputs);
  if (task.ownerInvocation) {
    const due = routineTaskDue(task, durableClock, admissionNowMs);
    const succeeded = Date.parse(durableClock?.lastSucceededObservedAt ?? durableClock?.lastSucceededAt ?? "");
    const reused = !task.ownerInvocation.publicationPending && Number.isFinite(succeeded) && succeeded >= Date.parse(task.ownerInvocation.requestedAt) && succeeded <= admissionNowMs;
    publicationInputLines.push(`Send ${task.ownerInvocation.instructions.join(", ")}: shared ${task.id} ${due ? "refresh offered to the normal source frontier" : reused ? "verified shared result reused" : "failed attempt held under retry backoff"}; canonical scope ${task.scope}.`);
  }
  if (!FORCE && !routineTaskDue(task, durableClock, admissionNowMs, sittingHot, observedEveryMs) && dueRequest === null && !publicationDue) {
    console.log(`RCD_SKIP ${task.id}: cadence not due${
      sittingSignals.has(task.id) ? ` (sitting window ${sittingHot === false ? "base" : sittingHot ? "hot" : "unknown, read as hot"})` : ""
    }`);
    continue;
  }
  if (publicationDue) {
    const detail = `${task.id}: ${campaignPublicationInputs!.approvals - campaignPublicationInputs!.attemptedApprovals} committed approval(s) not attempted by this code; offered to the normal publication frontier without waiting for hourly cadence.`;
    publicationInputLines.push(detail);
    console.log(`RCD_INPUT_CHANGED ${detail}`);
  }
  if (dueRequest !== null) {
    honouredDueRequests.set(task.id, dueRequest);
    const normal = routineTaskDeadlineMs(task, durableClock, sittingHot);
    console.log(
      `RCD_DUE_REQUEST ${dueRequest.id} ${task.id}: due by owner request at ${dueRequest.dueAt} ` +
        `(requested ${dueRequest.requestedAt}; normal deadline ${normal !== undefined && Number.isFinite(normal) ? new Date(normal).toISOString() : "at once"}); ` +
        "offered to the normal frontier",
    );
  }
  dueCandidates.push({
    clock: durableClock,
    pending: {
    kind: MEETING_PARTITION_TASK_IDS.has(task.id) ? "MEETING_PARTITION" : "SINGLE",
    id: task.id,
    command: task.command,
    task,
    },
  });
}

// A meeting lane is read earliest deadline first, up to three a pass (C6); a
// requested partition's deadline is the earlier of its own and the request's.
const admitted = routineFailureDomainFrontier(dueCandidates.map(({ pending, clock }) => ({
  task: pending.task,
  lastConsideredAt: newestConsideredAt(clock, supervisorAttempts.get(pending.task.id)),
  deadlineMs: routineDueRequestDeadlineMs(
    routineTaskDeadlineMs(pending.task, clock, sittingSignals.get(pending.task.id)),
    honouredDueRequests.get(pending.task.id) ?? null,
  ),
})), ROUTINE_FAILURE_DOMAIN_FRONTIER_PER_PASS, routineFailureDomainRotationSeed(RUN_STARTED_AT));
const admittedIds = new Set(admitted.map(({ task }) => task.id));
for (const candidate of dueCandidates) {
  if (admittedIds.has(candidate.pending.id)) continue;
  console.log(
    `RCD_DEFER ${candidate.pending.id}: provider frontier ` +
      `(domain=${candidate.pending.task.acquisitionFailureDomain}; per-pass=${ROUTINE_FAILURE_DOMAIN_FRONTIER_PER_PASS}, meeting lanes ${SITTING_WINDOW_LANE_SLOTS_PER_PASS})`,
  );
}
// A saved Send starts beside the earliest standing read, before its backlog drains.
const pendingByTaskId = new Map(dueCandidates.map(({ pending }) => [pending.id, pending] as const));
for (const { task } of placeSourceLaunchOrder(routinePassLaunchOrder(admitted))) pendingRuns.push(pendingByTaskId.get(task.id)!);
for (const pending of pendingRuns) await recordHuntSourceProgress(pending.task, "QUEUED", "Admitted to the existing source worker pool. Deterministic code; no model tokens. Verification and reader publication are still owed.");
const dueRequestLines = [...honouredDueRequests].map(([taskId, request]) => admittedIds.has(taskId)
  ? `Owner due request ${request.id}: ${taskId} admitted by this ordinary pass (due ${request.dueAt}).`
  : `Owner due request ${request.id}: ${taskId} was due but deferred by the provider frontier; the next pass offers it again.`).concat(publicationInputLines);
attempted = pendingRuns.length;

// Every meeting partition child proves the registry-runtime pointer before it
// acquires anything: 24.47 MB each, 19.81 MB of it the pointed candidate read
// only for that proof. With two or more in a pass, prove it once here and hand
// each child the attestation; a child whose pointer or payload no longer
// matches runs its own full proof. One child keeps its own proof: attesting it
// would cost the same read twice.
const meetingPartitionRuns = pendingRuns.filter((pending) => pending.kind === "MEETING_PARTITION").length;
let meetingChildAttestations: Readonly<Record<string, string>> = {};
if (meetingPartitionRuns >= 2) {
  step = "proving the registry once for this pass";
  try {
    const registry = await readRegistryRuntimeProjection({ store });
    const attestation = registry.kind === "PROMOTED"
      ? attestPromotedVersion("REGISTRY_RUNTIME_BINDING", REGISTRY_RUNTIME_SCOPE, store)
      : null;
    if (attestation) meetingChildAttestations = { [ATTESTED_PROMOTIONS_ENV]: serializeAttestedPromotions([attestation]) };
    console.log(
      `RCD_PASS registry ${attestation ? `proved once as ${attestation.versionId}` : `not attested (${registry.kind})`} ` +
        `for ${meetingPartitionRuns} meeting partition child(ren)`,
    );
  } catch (error) {
    console.log(`RCD_PASS registry not attested; each meeting child proves it — ${safeFailure(sanitizedErrorDiagnostic(error))}`);
  }
}

const sourceConcurrency = Math.max(1, pendingRuns.length);
console.log(
  `RCD_PASS launching ${pendingRuns.length} isolated command(s) through a bounded pool; ` +
    `concurrency=${sourceConcurrency}; ` +
    `provider-frontier=${ROUTINE_FAILURE_DOMAIN_FRONTIER_PER_PASS} (meeting lanes ${SITTING_WINDOW_LANE_SLOTS_PER_PASS}); ` +
    `per-child timeout=${ROUTINE_CHILD_TIMEOUT_MS}ms; per-stream output=${ROUTINE_CHILD_MAX_BUFFER_BYTES} bytes`,
);
/** One source child: its own narrowed authority, and the pass's registry attestation for a meeting read. */
function sourceChildCommand(pending: PendingRun): BoundedChildCommand {
  return {
    id: pending.id,
    // One degraded provider may occupy one lane, never the whole standing
    // pool. Distinct sources keep running and settling independently.
    failureDomain: pending.task.acquisitionFailureDomain,
    executable: process.execPath,
    args: ["--experimental-strip-types", ...pending.command],
    env: {
      ...(pending.task.ownerInvocation || automaticRefreshContract(pending.task.id) ? admittedRuntimeChildEnvironment({
        parentEnv: process.env,
        capability: "MANUAL_CONTRACT",
        contract: pending.task.registeredContractId ?? automaticRefreshContract(pending.task.id) ?? pending.task.id,
        parentPid: process.pid,
      }) : admittedRuntimeChildEnvironment({
        parentEnv: process.env,
        capability: "ROUTINE_CONTRACT",
        contract: pending.task.id,
        parentPid: process.pid,
      })),
      ...(pending.kind === "MEETING_PARTITION" ? meetingChildAttestations : {}),
    },
  };
}

function recordSourceSettlementFailures(runs: readonly BoundedChildResult[]): void {
  for (const run of runs) {
    if (run.settlementErrorMessage === null) continue;
    const detail = safeFailure(run.settlementErrorMessage ?? "unknown settlement failure");
    supervisorFailures.push({ taskId: run.id, code: "CHILD_SETTLEMENT_FAILED", detail });
    console.error(`RCD_TASK ${run.id}: SUPERVISOR_FAILURE (CANNOT_TELL) — ${detail}`);
  }
}

step = "running the source pass";
for (const { id } of pendingRuns) unsettledSourceRuns.add(id);
// Awaited below, with the catch-up reads that run beside it (C6).
const sourcePass = runBoundedChildPass(
  pendingRuns.map(sourceChildCommand),
  {
    cwd: ROOT,
    env: process.env,
    timeoutMs: ROUTINE_CHILD_TIMEOUT_MS,
    maxBufferBytes: ROUTINE_CHILD_MAX_BUFFER_BYTES,
    concurrency: sourceConcurrency,
    // Two reads of one host in this pass start at least a minute apart (C6).
    sameDomainGapMs: ROUTINE_SAME_DOMAIN_CHILD_GAP_MS,
    onStarting: async (command, index) => {
      await acquireChildMemory(command);
      await recordHuntSourceProgress(pendingRuns[index]!.task, "COLLECTING_AND_VERIFYING", "The source command has a worker slot. Collecting current source records and running the existing identity, content, freshness and reader checks. No model call is used.");
    },
    onSettled: async (run, index) => settlePendingRun(pendingRuns[index]!, run),
    // Classification consumes the exact receipt before this worker advances.
    // Retaining only the small result summary bounds memory across the full portfolio.
    discardOutputAfterSettlement: true,
  },
);

async function settlePendingRun(pending: PendingRun, run: BoundedChildResult): Promise<void> {
  try { await settlePendingRunResult(pending, run); }
  finally { releaseChildMemory(run.id); }
}

async function settlePendingRunResult(pending: PendingRun, run: BoundedChildResult): Promise<void> {
  laneLastEndedMs.set(pending.task.acquisitionFailureDomain, Date.now());
  unsettledSourceRuns.delete(pending.id);
  if (run.id !== pending.id) {
    const detail = `expected result ${pending.id}; observed ${run.id}`;
    supervisorFailures.push({ taskId: pending.id, code: "BOUNDED_CHILD_RESULT_ORDER_MISMATCH", detail });
    console.error(`RCD_TASK ${pending.id}: SUPERVISOR_FAILURE (CANNOT_TELL) — ${detail}`);
    return;
  }
  const memoryDeferral = routinePreSpawnMemoryDeferral(run, startedSourceChildren.has(run.id));
  if (memoryDeferral !== null) {
    attempted -= 1;
    const detail = safeFailure(memoryDeferral);
    await recordHuntSourceProgress(pending.task, "QUEUED", detail);
    console.log(`RCD_DEFER ${pending.task.id}: ${detail}; no child spawned; source work remains owed`);
    return;
  }
  const output = `${run.stdout}\n${run.stderr}`;
  const executionFailure = boundedExecutionFailure(run);

  if (pending.kind === "MEETING_PARTITION") {
    const parsed = parseMeetingPartitionRunnerReceipts(output);
    if (!parsed.ok) {
      const failure = executionFailure ?? { taskId: pending.task.id, code: parsed.code, detail: parsed.detail };
      const detail = executionFailure === null ? parsed.detail : `${executionFailure.detail}; ${parsed.code}: ${parsed.detail}`;
      supervisorFailures.push({ ...failure, detail });
      console.error(`RCD_TASK ${pending.task.id}: SUPERVISOR_FAILURE (CANNOT_TELL) — ${detail}`);
      return;
    }
    if (parsed.receipts.length !== 1 || parsed.receipts[0]?.source !== pending.task.id) {
      const observed = parsed.receipts.map((receipt) => receipt.source).join(",") || "none";
      const detail = `expected exactly ${pending.task.id}; observed=${observed}`;
      const failure = executionFailure ?? { taskId: pending.task.id, code: "RECEIPT_SCHEMA_INVALID", detail };
      const combined = executionFailure === null ? detail : `${executionFailure.detail}; ${detail}`;
      supervisorFailures.push({ ...failure, detail: combined });
      console.error(`RCD_TASK ${pending.task.id}: SUPERVISOR_FAILURE (CANNOT_TELL) — ${combined}`);
      return;
    }
    const receipt = parsed.receipts[0];
    const promoted = successfulRoutineRunnerReceiptIssue(receipt) === null;
    const durableIssue = await durableRoutineRunnerReceiptIssue(
      receipt,
      pending.task,
      store,
      promoted ? "SUCCESS" : "HELD",
    );
    if (durableIssue !== null) {
      supervisorFailures.push({ taskId: pending.task.id, code: "DURABLE_RECEIPT_INVALID", detail: durableIssue });
      console.error(`RCD_TASK ${pending.task.id}: SUPERVISOR_FAILURE (CANNOT_TELL) — ${durableIssue}`);
    } else if (promoted) {
      verifiedSourceSuccesses += 1;
      await recordMeetingDoorOutcome(pending.task.id, "SUCCESS", receipt.promotedVersion !== null && receipt.confirmedAt === undefined);
      captureTaskReceipt(pending, receipt, "VERIFIED_SOURCE_SUCCESS");
      console.log("RCD_RECEIPT=" + JSON.stringify(receipt));
      console.log(`RCD_TASK ${pending.task.id}: GOOD (${receipt.state})`);
    } else {
      verifiedSourceFailures += 1;
      await recordMeetingDoorOutcome(pending.task.id, "FAILURE");
      captureTaskReceipt(pending, receipt, "VERIFIED_SOURCE_FAILURE");
      console.log("RCD_RECEIPT=" + JSON.stringify(receipt));
      console.log(`RCD_TASK ${pending.task.id}: SOURCE_HELD_LKG (${receipt.state})`);
    }
    if (executionFailure !== null) {
      supervisorFailures.push(executionFailure);
      console.error(`RCD_TASK ${pending.task.id}: SUPERVISOR_FAILURE (CANNOT_TELL) — ${executionFailure.detail}`);
    } else if (run.status !== 0) {
      const detail = safeFailure(`${run.errorMessage ?? ""}\n${output}`);
      supervisorFailures.push({ taskId: pending.task.id, code: "CHILD_EXIT_CONTRADICTED_PARTITION_RECEIPT", detail });
      console.error(`RCD_TASK ${pending.task.id}: SUPERVISOR_FAILURE (CANNOT_TELL) — ${detail}`);
    }
    return;
  }

  const parsedReceipt = parseRoutineRunnerReceipt(output);
  const receiptOutcome = parsedReceipt.ok && successfulRoutineRunnerReceiptIssue(parsedReceipt.receipt) === null
    ? "SUCCESS"
    : "HELD";
  const durableIssue = parsedReceipt.ok
    ? await durableRoutineRunnerReceiptIssue(parsedReceipt.receipt, pending.task, store, receiptOutcome)
    : null;
  const child = classifyRoutineChildOutcome({
    parsed: parsedReceipt.ok && durableIssue === null
      ? { ...parsedReceipt, receipt: { ...parsedReceipt.receipt, source: pending.task.id } }
      : parsedReceipt,
    durableIssue,
    exitStatus: run.status,
    childDiagnostic: run.status === 0 ? null : safeFailure(`${run.errorMessage ?? ""}\n${output}`),
  });
  await recordHuntSourceProgress(pending.task,
    child.kind === "VERIFIED_SOURCE_SUCCESS" ? child.receipt.confirmedAt ? "REUSED" : "PUBLISHED" : child.kind === "VERIFIED_SOURCE_FAILURE" ? "HELD" : "FAILED",
    child.kind === "VERIFIED_SOURCE_SUCCESS" ? child.receipt.confirmedAt
      ? "The verified shared version is unchanged and was confirmed again; no new finding is claimed."
      : "All required source checks passed and the canonical reader version was published automatically. Reader readback is recorded separately by this source pass. A new version alone is not counted as a new finding."
      : child.detail,
    child.kind === "SUPERVISOR_FAILURE" ? null : child.receipt.candidateId);
  if (child.kind === "VERIFIED_SOURCE_SUCCESS") {
    verifiedSourceSuccesses += 1;
    captureTaskReceipt(pending, child.receipt, "VERIFIED_SOURCE_SUCCESS");
    console.log("RCD_RECEIPT=" + JSON.stringify(child.receipt));
    const delivered = (child.receipt as { delivered?: { records: number; gaps: number; gapReasons: Record<string, number> } }).delivered;
    // A publication pass says what reached readers, so a new version is never read as delivery.
    console.log(`RCD_TASK ${pending.task.id}: GOOD (${child.state})${delivered ? ` — delivered ${delivered.records} record(s); ${delivered.gaps} owed: ${Object.entries(delivered.gapReasons).map(([code, n]) => `${code}×${n}`).join(", ") || "none"}` : ""}`);
  } else if (child.kind === "VERIFIED_SOURCE_FAILURE") {
    verifiedSourceFailures += 1;
    captureTaskReceipt(pending, child.receipt, "VERIFIED_SOURCE_FAILURE");
    console.log("RCD_RECEIPT=" + JSON.stringify(child.receipt));
    console.log(`RCD_TASK ${pending.task.id}: SOURCE_HELD_LKG (${child.state})`);
  } else {
    const failure = executionFailure ?? { taskId: pending.task.id, code: child.code, detail: child.detail };
    const detail = executionFailure === null ? child.detail : `${executionFailure.detail}; ${child.code}: ${child.detail}`;
    supervisorFailures.push({ ...failure, detail });
    console.error(`RCD_TASK ${pending.task.id}: SUPERVISOR_FAILURE (CANNOT_TELL) — ${detail}`);
    return;
  }
  if (executionFailure !== null) {
    supervisorFailures.push(executionFailure);
    console.error(`RCD_TASK ${pending.task.id}: SUPERVISOR_FAILURE (CANNOT_TELL) — ${executionFailure.detail}`);
  } else if (
    (child.kind === "VERIFIED_SOURCE_SUCCESS" && run.status !== 0) ||
    (child.kind === "VERIFIED_SOURCE_FAILURE" && run.status === 0)
  ) {
    const detail = `process exit ${run.status ?? "unavailable"} contradicted the exact durable ${child.kind}`;
    supervisorFailures.push({ taskId: pending.task.id, code: "CHILD_EXIT_CONTRADICTED_SOURCE_RECEIPT", detail });
    console.error(`RCD_TASK ${pending.task.id}: SUPERVISOR_FAILURE (CANNOT_TELL) — ${detail}`);
  }
}

// Reader delivery is its own OS-killable evidence domain. Each non-meeting
// Reader gets one child; all meeting partitions share one child because the
// actual Reader composes them together exactly once. Parent settlement only
// parses/correlates protocol lines, so a hung application read cannot leave an
// orphan Promise, delay source attribution, or mutate any source disposition.
const readerContracts = selectedReaderRepairContracts([
  ...observableRoutineContracts(),
  ...MANUAL_PRODUCTION_SOURCE_CONTRACTS,
], ONLY === null ? null : selectedTasks);
const readerDomains = routineReaderRepairDomains(readerContracts);
const readerReadbackReferences: RoutineCivicDataReaderReadbackReference[] = readerContracts
  .filter(({ readerProjection }) => readerProjection === null)
  .map((contract) => ({
    contractId: contract.id,
    sourceId: contract.sourceId,
    recordClass: contract.recordClass,
    scope: contract.scope,
    projectionId: null,
    disposition: "NOT_APPLICABLE",
    receipt: null,
  }));

function readerDomainExecutionFailure(
  domain: RoutineReaderRepairDomain,
  run: BoundedChildResult,
): SupervisorFailure | null {
  const bounded = boundedExecutionFailure(run);
  if (bounded !== null) return { ...bounded, taskId: domain.id };
  if (run.status === 0) return null;
  return {
    taskId: domain.id,
    code: "READER_REPAIR_CHILD_EXIT_NONZERO",
    // A child that died on an error nothing caught names its step and cause in
    // one sanitized line. The stderr tail alone was the stack, so the
    // 2026-09-25T23:01Z runtime-authority refusals recorded no reason.
    detail: childFatalLine(run.stdout) ?? safeFailure(`${run.errorMessage ?? ""}\n${run.stdout}\n${run.stderr}`),
  };
}

function settleReaderDomain(domain: RoutineReaderRepairDomain, run: BoundedChildResult): void {
  if (run.id !== domain.id) {
    const detail = `expected Reader domain ${domain.id}; observed ${run.id}`;
    const reconciled = reconcileRoutineReaderRepairDomain(domain, "", {
      taskId: domain.id,
      code: "READER_REPAIR_RESULT_ORDER_MISMATCH",
      detail,
    });
    readerReadbackReferences.push(...reconciled.references);
    supervisorFailures.push(...reconciled.failures);
    return;
  }
  const executionFailure = readerDomainExecutionFailure(domain, run);
  const reconciled = reconcileRoutineReaderRepairDomain(
    domain,
    `${run.stdout}\n${run.stderr}`,
    executionFailure,
  );
  readerReadbackReferences.push(...reconciled.references);
  supervisorFailures.push(...reconciled.failures);
}

// A meeting read that falls due while the pass is held open, by its source
// reads or by its Reader repair, starts as soon as its lane is free instead of
// waiting for the next pass (C6; lib/civic-data/hot-read-catch-up.ts). The
// repair starts once every such read beside the source reads has settled, and
// launches the repairs a read could race first; catch-up resumes when they settle.
const hotReadTasks = FORCE
  ? []
  : clockReads.flatMap((read) => read.ok && read.task.contract.schedule?.kind === "SITTING_WINDOW" ? [read.task] : []);
const hotReadTaskIds = new Set(hotReadTasks.map(({ id }) => id));
const readerLaunch = [
  ...readerDomains.filter((domain) => repairDomainRacesHotReads(domain, hotReadTaskIds)),
  ...readerDomains.filter((domain) => !repairDomainRacesHotReads(domain, hotReadTaskIds)),
];

/** Once the source reads have settled: launch the Reader readbacks, racing repairs first; the gate opens when those settle. */
function startReaderRepair(
  sourceRuns: readonly BoundedChildResult[],
): { readonly repair: Promise<readonly BoundedChildResult[]>; readonly unblocked: Promise<void> } {
  recordSourceSettlementFailures(sourceRuns);
  step = "running the Reader readbacks";
  const readerObservedAt = new Date().toISOString();
  let racingRepairs = readerLaunch.filter((domain) => repairDomainRacesHotReads(domain, hotReadTaskIds)).length;
  let openHotReadCatchUp: () => void = () => undefined;
  const hotReadCatchUpOpen = new Promise<void>((resolve) => { openHotReadCatchUp = resolve; });
  if (racingRepairs === 0) openHotReadCatchUp();
  const readerPass = runBoundedChildPass(
    readerLaunch.map((domain) => ({
      id: domain.id,
      executable: process.execPath,
      args: [
        "--experimental-strip-types",
        "scripts/routine-civic-data-reader-repair.mts",
        domain.mode === "MEETING_AGGREGATE" ? "--meeting-aggregate" : `--contract=${domain.contracts[0]!.id}`,
        ...(domain.mode === "MEETING_AGGREGATE" ? [`--contracts=${domain.contracts.map(contract => contract.id).join(",")}`] : []),
        `--observed-at=${readerObservedAt}`,
      ],
      timeoutMs: domain.timeoutMs,
      env: admittedRuntimeChildEnvironment({
        parentEnv: process.env,
        capability: "ROUTINE_SUPERVISOR",
        parentPid: process.pid,
      }),
    })),
    {
      cwd: ROOT,
      env: process.env,
      timeoutMs: ROUTINE_READER_SINGLE_TIMEOUT_MS,
      maxBufferBytes: ROUTINE_CHILD_MAX_BUFFER_BYTES,
      concurrency: ROUTINE_READER_CHILD_CONCURRENCY,
      onStarting: acquireChildMemory,
      onSettled: (run, index) => {
        const domain = readerLaunch[index]!;
        try {
          settleReaderDomain(domain, run);
        } finally {
          releaseChildMemory(run.id);
          if (repairDomainRacesHotReads(domain, hotReadTaskIds) && --racingRepairs === 0) openHotReadCatchUp();
        }
      },
      discardOutputAfterSettlement: true,
    },
  );
  return { repair: readerPass, unblocked: hotReadCatchUpOpen };
}

const hotReadClocks = new Map(clockReads.flatMap((read) => read.ok ? [[read.task.id, read.clock] as const] : []));
const launchedTaskIds = new Set(pendingRuns.map(({ id }) => id));
const hotReadLimitsMs = {
  SOURCE: routinePassSourceCatchUpDeadlineMs(Date.parse(RUN_STARTED_AT), readerDomains),
  REPAIR: routinePassWorkDeadlineMs(Date.parse(RUN_STARTED_AT), readerDomains),
} as const;
const hotReadsPastLimit = new Set<string>();

/** The catch-up reads to start now: the pass's own rules over its own clock reads (C6). */
function admitHotReads(phase: "SOURCE" | "REPAIR", nowMs: number, slots: number, runningLanes: ReadonlySet<string>) {
  const plan = hotReadCatchUpAdmission({
    nowMs,
    candidates: hotReadTasks
      .filter(({ id }) => !launchedTaskIds.has(id))
      .map((task) => ({
        task,
        clock: routineAdmissionClock(hotReadClocks.get(task.id), supervisorAttempts.get(task.id), nowMs),
        lastConsideredAt: newestConsideredAt(hotReadClocks.get(task.id), supervisorAttempts.get(task.id)),
      })),
    clockReads,
    statedEnds: statedEndsByTask,
    laneLastEndedMs,
    busyLanes: new Set([
      ...runningLanes,
      ...[...unsettledSourceRuns].map((id) => pendingByTaskId.get(id)!.task.acquisitionFailureDomain),
    ]),
    slots,
    limitMs: hotReadLimitsMs[phase],
  });
  for (const task of plan.pastLimit) {
    if (hotReadsPastLimit.has(task.id)) continue;
    hotReadsPastLimit.add(task.id);
    console.log(`RCD_DEFER catch-up: ${task.id} waits for the next pass; its read could outlast the pass limit`);
  }
  return plan;
}

/** One catch-up read: launched and settled exactly as the pass's own. */
async function runHotRead(task: RoutineSourceTask, atMs: number): Promise<void> {
  const run: PendingRun = {
    kind: MEETING_PARTITION_TASK_IDS.has(task.id) ? "MEETING_PARTITION" : "SINGLE",
    id: task.id,
    command: task.command,
    task,
  };
  launchedTaskIds.add(run.id);
  attempted += 1;
  console.log(
    `RCD_PASS catch-up at ${new Date(atMs).toISOString()}: launching 1 due meeting read(s) while the pass is held open; ` +
      `concurrency=${HOT_READ_CATCH_UP_CONCURRENCY}`,
  );
  recordSourceSettlementFailures(await runBoundedChildPass([sourceChildCommand(run)], {
    cwd: ROOT,
    env: process.env,
    timeoutMs: ROUTINE_CHILD_TIMEOUT_MS,
    maxBufferBytes: ROUTINE_CHILD_MAX_BUFFER_BYTES,
    concurrency: 1,
    onStarting: acquireChildMemory,
    onSettled: async (result) => settlePendingRun(run, result),
    discardOutputAfterSettlement: true,
  }));
}

const pass = await runRoutinePassWithHotReadCatchUp({
  source: sourcePass,
  startRepair: startReaderRepair,
  now: () => Date.now(),
  // Unreferenced: a finished phase ends without waiting out the timer.
  sleepUntil: (atMs) => new Promise<void>((resolve) => { setTimeout(resolve, Math.max(0, atMs - Date.now())).unref(); }),
  concurrency: HOT_READ_CATCH_UP_CONCURRENCY,
  admit: admitHotReads,
  read: runHotRead,
});
for (const error of pass.errors) {
  const detail = safeFailure(error);
  supervisorFailures.push({ taskId: "routine-civic-data-hot-read-catch-up", code: "HOT_READ_CATCH_UP_FAILED", detail });
  console.error(`RCD_TASK routine-civic-data-hot-read-catch-up: SUPERVISOR_FAILURE (CANNOT_TELL) — ${detail}`);
}
const readerRuns = pass.repair;
// Source settlement publishes serving copies even when a readback child fails.
step = "publishing changed reader edge copies";
if (!await publishRoutineReaderEdge(store, new Date().toISOString(), ONLY === null ? null : selectedTasks)) {
  supervisorFailures.push({ taskId: "reader-edge-publication", code: "READER_EDGE_PUBLISH_FAILED", detail: "Reader edge publication failed; the previous serving copies remain available." });
}
for (const run of readerRuns) {
  if (run.settlementErrorMessage === null) continue;
  const detail = safeFailure(run.settlementErrorMessage ?? "unknown Reader settlement failure");
  supervisorFailures.push({ taskId: run.id, code: "READER_REPAIR_SETTLEMENT_FAILED", detail });
}

const readerContractIds = new Set(readerContracts.map(({ id }) => id));
const readerReferenceIds = readerReadbackReferences.map(({ contractId }) => contractId);
if (
  readerReadbackReferences.length !== readerContracts.length ||
  new Set(readerReferenceIds).size !== readerReferenceIds.length ||
  readerReferenceIds.some((id) => !readerContractIds.has(id))
) {
  throw new Error(
    `READER_REPAIR_DENOMINATOR_MISMATCH: expected=${readerContracts.length}; ` +
      `observed=${readerReadbackReferences.length}; unique=${new Set(readerReferenceIds).size}`,
  );
}

const readerReadbacksRecordedPass = readerReadbackReferences.filter((reference) =>
  reference.disposition === "RECORDED" && reference.receipt?.status === "PASS").length;
const readerReadbacksRecordedFail = readerReadbackReferences.filter((reference) =>
  reference.disposition === "RECORDED" && reference.receipt?.status === "FAIL").length;
const readerReadbacksCurrentFail = readerReadbackReferences.filter((reference) =>
  reference.disposition === "FAILED_BACKOFF").length;
const readerReadbackRepairFailures = readerReadbackReferences.filter((reference) =>
  reference.disposition === "REPAIR_FAILED").length;
const readerReadbackNoops = readerReadbackReferences.length -
  readerReadbacksRecordedPass - readerReadbacksRecordedFail -
  readerReadbacksCurrentFail - readerReadbackRepairFailures;
for (const reference of readerReadbackReferences) {
  if (reference.disposition === "RECORDED") {
    const status = reference.receipt?.status ?? "UNKNOWN";
    const detail = safeFailure(reference.receipt?.detail ?? "Reader receipt missing");
    console.log(`RCD_READER_READBACK ${reference.contractId}: RECORDED ${status} — ${detail}`);
  } else if (reference.disposition === "FAILED_BACKOFF") {
    console.error(
      `RCD_READER_READBACK ${reference.contractId}: CURRENT FAIL (BACKOFF) — ` +
        safeFailure(reference.receipt?.detail ?? "Reader receipt missing"),
    );
  } else if (reference.disposition === "REPAIR_FAILED") {
    console.error(`RCD_READER_READBACK ${reference.contractId}: SUPERVISOR_FAILURE — repair child failed`);
  } else {
    console.log(`RCD_READER_READBACK ${reference.contractId}: ${reference.disposition}`);
  }
}

step = "persisting the supervisor outcome";
try {
  const cycleId = await persistSupervisorOutcome({
    ...(campaignPublicationInputs !== null && verifiedTaskReceipts.some(row => row.taskId === CAMPAIGN_PUBLICATION_TASK)
      ? { campaignPublicationApprovalsAttempted: campaignPublicationInputs.approvals } : {}),
    failures: supervisorFailures,
    attemptedTasks: attempted,
    verifiedSourceSuccesses,
    verifiedSourceFailures,
    finishedAt: new Date().toISOString(),
    taskReceipts: [...verifiedTaskReceipts].sort((left, right) => left.taskId.localeCompare(right.taskId)),
    dueRequestLines,
    readerReadback: {
      denominator: readerContracts.length,
      recordedPass: readerReadbacksRecordedPass,
      recordedFail: readerReadbacksRecordedFail,
      currentFail: readerReadbacksCurrentFail,
      noops: readerReadbackNoops,
      repairFailures: readerReadbackRepairFailures,
      references: [...readerReadbackReferences].sort((left, right) => left.contractId.localeCompare(right.contractId)),
    },
  });
  console.log("RCD_OPERATIONAL_OUTCOME=" + JSON.stringify({
    kind: "ROUTINE_CIVIC_DATA_SUPERVISOR",
    state: supervisorFailures.length === 0 ? "SUCCEEDED" : "FAILED",
    cycleId,
    exactTaskReceipts: verifiedTaskReceipts.length,
    durable: true,
  }));
} catch (error) {
  supervisorFailures.push({
    taskId: "routine-civic-data-supervisor-outcome",
    code: "SUPERVISOR_OUTCOME_NOT_DURABLE",
    detail: safeFailure(sanitizedErrorDiagnostic(error)),
  });
  console.error("RCD_OPERATIONAL_OUTCOME=" + JSON.stringify({
    kind: "ROUTINE_CIVIC_DATA_SUPERVISOR",
    state: "STORE_UNREACHABLE",
    detail: safeFailure(sanitizedErrorDiagnostic(error)),
    durable: false,
  }));
}

const attemptedCount = floored(
  "attempted routine source tasks",
  "the selected routine source/body partitions and owed hunt publications",
  selectedTasks.length,
  attempted,
);
console.log("RCD_RUN=" + JSON.stringify({
  attempted: attemptedCount.matched,
  denominator: attemptedCount.denominator,
  failed:
    verifiedSourceFailures +
    supervisorFailures.length +
    readerReadbacksRecordedFail +
    readerReadbacksCurrentFail,
  verifiedSourceSuccesses,
  verifiedSourceFailures,
  supervisorFailures: supervisorFailures.length,
  readerReadbacksRecordedPass,
  readerReadbacksRecordedFail,
  readerReadbacksCurrentFail,
  readerReadbackFailures: readerReadbacksRecordedFail + readerReadbacksCurrentFail,
  readerReadbackNoops,
  readerReadbackRepairFailures,
  skipped: attemptedCount.denominator - attemptedCount.matched,
  structuralReleaseContract: ZERO_RELEASE_EVENTS,
}));
// A source refusal is a durable data-plane event, not a failed supervisor
// process. Only a process/protocol failure makes the runner nonzero.
if (supervisorFailures.length > 0) process.exitCode = 2;
step = "saving the daily database byte counter";
if (!await flushDatabaseTransfer()) console.warn("RCD_TRANSFER daily byte counter could not be saved; data results are unchanged.");
step = "releasing the host-local singleton";
await ROUTINE_DATA_PROCESS_LEASE.release();
}
await readCacheHost.close();
await workerToolsHost?.close();
await sharedBrowser.close();
