import { readMeetingDiscoveryInputs, meetingDiscoveryInputsDue, runMeetingDiscoveryChain, type MeetingDiscoveryInputs } from "../lib/civic-data/meeting-discovery-due.ts";
import { readerFactDb } from "../lib/facts/db.ts";
import { ensureFactEntities, registeredStates } from "../lib/facts/entities.ts";
import { cartonComments, cartonOffices, cartonRosters, importCartonComments, importCartonOffices, importCartonRosters } from "../lib/facts/carton-import.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { buildBoxFindings } from "../lib/control-plane/workers/scout-extraction.ts";
import { workerPublicationContext } from "../lib/civic-data/worker-publication-context.ts";
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
  routineBaselineOwed,
  routineCodeChangeRetryTaskIds,
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
import { OUTCOME_PARTITION_CONTRACTS } from "../lib/civic-data/outcome-partitions.ts";
import { recordDoorOutcome, taskDoorId, type DoorOutcome } from "../lib/doors/outcome.ts";
import { evidenceFromCandidate, reopenDoorIfShut } from "../lib/doors/ingest-evidence.ts";
import { recordDoorEvidence, type DoorEvidence } from "../lib/doors/shut.ts";
import { observedChangeMinutesByDoor } from "../lib/doors/observed-rate.ts";
import { isDoorRecord } from "../lib/doors/registry.ts";
import { refreshDoorsForPass } from "../lib/doors/install.ts";
import { MEETING_DOORS_CONTRACT_ID } from "../lib/doors/meeting-doors.ts";
import { doorSyncLine, syncHeldDoors } from "../lib/doors/seed-all.ts";
import { readNowDueRequests, settleReadNow } from "../lib/doors/mission-refresh.ts";
import { editDeriveDueRequests } from "../lib/doors/edit-derive.ts";
import { meetingReadQuietMs } from "../lib/civic-data/meeting-lanes.ts";
import { listDoors } from "../lib/doors/registry.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { attestPromotedVersion } from "../lib/civic-data/read-model.ts";
import { ATTESTED_PROMOTIONS_ENV, serializeAttestedPromotions } from "../lib/civic-data/attested-promotion.ts";
import { readRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";
import { readRegistryRuntimePrior, REGISTRY_RUNTIME_SCOPE } from "../lib/registry/runtime-data-plane.ts";
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
import { loadPublishedScopeLookupState } from "../lib/census-geography/scope-lookup.ts";
import { readIntents, RESEARCH_INTENT_LOG_KEY } from "../lib/control-plane/scheduler/research-policy.ts";
import { admittedHuntSourceScopes, huntSourceTasks } from "../lib/civic-data/hunt-source-tasks.ts";
import { PUBLISH_NOW_SINGLETON_PORT, publishNowDoorTasks, publishNowHasNothingOwed, readOwedFactItems, readPublicationBoxItems, readPublishNowWorkerTasks, readWorkerPublicationItems, startPublishNowEdgeChecks } from "../lib/civic-data/publish-now.ts";
import { publishOwedRosterFacts } from "../lib/civic-data/worker-roster-publication.ts";
import { publishOwedCommentFacts } from "../lib/civic-data/worker-comment-facts.ts";
import { runHourlyProbes } from "../lib/doors/hourly-check.ts";
import { stateOfPlace } from "../lib/method/fix-map.ts";
import { websiteSizeFromHoldings } from "../lib/control-plane/scheduler/host-supervision.ts";
import { hotMeetingPartitions } from "../lib/doors/hot-partitions.ts";
import { pacedProbeFetch } from "../lib/doors/probe-fetch.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { VAULT_DIR } from "../lib/control-plane/scheduler/vault.ts";
import { join } from "node:path";
import { WORKER_PUBLICATION_TASK_IDS } from "../lib/civic-data/worker-reader-contracts.ts";
import { readCompletedWorkerResultsOf } from "../lib/control-plane/repository/worker-completion.ts";
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
import { publishSupervisorReaderEdge, readerEdgeSupervisorFailure, type ReaderEdgePublicationOutcome } from "../lib/civic-data/reader-edge-publication.ts";
import { resolveReaderArtifactWriteStore } from "../lib/meetings/edge-store.ts";
import { floored } from "../lib/ops/denominator-floor.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { startWorkerToolsHost } from "../lib/control-plane/workers/process-pool.ts";
import { sharedScoutBrowser } from "./scout-browse.mts";
import { routineProcessSlots } from "../lib/control-plane/workers/worker-slots.ts";
import { sanitizedErrorDiagnostic } from "../lib/ops/error-diagnostic.ts";
import { childFatalLine, installFatalLine } from "../lib/ops/fatal-line.ts";
import {
  admittedRuntimeChildEnvironment,
  assertRuntimeAuthority,
} from "../lib/civic-data/runtime-authority.ts";
import { readFromHeldCopies } from "../lib/control-plane/repository/incremental-reads.ts";

readFromHeldCopies();

// An uncaught error ends this process through one sanitized protocol line naming the step (lib/ops/fatal-line.ts).
let step = "reading its task selection";
installFatalLine("routine-civic-data-runner", () => step);

const ROOT = process.cwd();
// Admit the supervisor before opening hosts or changing durable source state.
const FORCE = process.argv.includes("--force");
const PUBLISH_NOW = process.argv.includes("--publish-now");
if (PUBLISH_NOW && FORCE) throw new Error("Publish-now cannot force unrelated source work.");
const ADMITTED_CODE_SHA = assertRuntimeAuthority({ capabilities: ["ROUTINE_SUPERVISOR"] }).sha;
// The door registry is the only door list. Every routine pass first brings the doors the system holds into the
// registry, publishes its meeting doors for every child to read, then builds its meeting work from the registry.
// A registry that cannot be read leaves the pass without hand-wired meeting work, and the pass says so.
if (controlPlaneUrlFromEnv() === null) {
  console.warn("RCD_TASK routine-civic-data-runner: no door registry is configured, so this pass has no hand-wired meeting work");
} else {
  try {
    const doorRepos = await createPgRepositories(controlPlaneUrlFromEnv()!, new Date().toISOString(), { skipBootstrap: true });
    const doorPass = await refreshDoorsForPass(doorRepos.doors);
    console.log(`RCD_TASK routine-civic-data-runner: meeting doors read from the registry (${doorPass.partitions?.partitions ?? 0} partitions)` +
      `${doorPass.reason ?? doorPass.partitions?.reason ? ` — ${doorPass.reason ?? doorPass.partitions?.reason}` : ""}` +
      `${(doorPass.partitions?.skipped.length ?? 0) > 0 ? `; ${doorPass.partitions!.skipped.length} door(s) left out (${doorPass.partitions!.skipped.join("; ")})` : ""}`);
    if (doorPass.outcomes !== null) {
      console.log(`RCD_TASK routine-civic-data-runner: outcome doors — ${doorPass.outcomes.partitions} door(s) collect outcomes` +
        `${doorPass.outcomes.reason ? ` — ${doorPass.outcomes.reason}` : ""}` +
        `${doorPass.outcomes.skipped.length > 0 ? `; ${doorPass.outcomes.skipped.length} left out (${doorPass.outcomes.skipped.map((skip) => `${skip.doorId}: ${skip.why}`).join("; ")})` : ""}`);
    }
  } catch (error) {
    console.warn(`RCD_TASK routine-civic-data-runner: the door registry could not be read, so this pass has no hand-wired meeting work — ${error instanceof Error ? error.message : String(error)}`);
  }
}
const STANDING_SOURCE_TASKS: readonly RoutineSourceTask[] = PUBLISH_NOW ? [] : await withNationalPlaceTasks([
  // The installed doors' meeting partitions are already among the routine tasks: installing doors rebuilds that list.
  ...ROUTINE_SOURCE_TASKS.filter((task) => task.id !== MEETING_DOORS_CONTRACT_ID),
  ...OUTCOME_PARTITION_CONTRACTS.map(routineTaskFromContract),
  ...AUTOMATIC_REFRESH_TASKS,
], process.argv.slice(2));
const TASK_SELECTION = routineTaskSelection(process.argv.slice(2), [...STANDING_SOURCE_TASKS, ...WORKER_PUBLICATION_TASK_IDS.map(id => ({ id }))]);
const ONLY = TASK_SELECTION.ok ? TASK_SELECTION.only : null;
const inheritedStartedAt = process.env[ROUTINE_SUPERVISOR_STARTED_AT_ENV];
const RUN_STARTED_AT = inheritedStartedAt && Number.isFinite(Date.parse(inheritedStartedAt)) &&
    new Date(Date.parse(inheritedStartedAt)).toISOString() === inheritedStartedAt
  ? inheritedStartedAt
  : new Date().toISOString();
const SUPERVISOR_CYCLE_ID = routineSupervisorCycleId(hostname(), RUN_STARTED_AT, PUBLISH_NOW ? "publish-now" : "routine-civic-data");
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
  ? ADMITTED_CODE_SHA
  : null;

// Manual invocation and the standing pilot share this same atomic host-local
// door. A second runner fails before opening the store or reading due clocks;
// the kernel releases the lease if this process dies.
step = "taking the host-local singleton";
const ROUTINE_DATA_PROCESS_LEASE = TASK_SELECTION.ok ? await (async () => {
  try {
    return await acquireProcessSingleton(
      PUBLISH_NOW ? "publish-now-runner" : "routine-civic-data-runner",
      PUBLISH_NOW ? PUBLISH_NOW_SINGLETON_PORT : ROUTINE_DATA_RUNNER_SINGLETON_PORT,
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

const readCacheHost = ROUTINE_DATA_PROCESS_LEASE ? await startCivicReadCacheHost() : { close: async () => {} };
if (ROUTINE_DATA_PROCESS_LEASE && controlPlaneUrlFromEnv()) {
  try {
    const doorRepos = await createPgRepositories(controlPlaneUrlFromEnv()!, RUN_STARTED_AT, { skipBootstrap: true });
    if (!PUBLISH_NOW) {
      console.log(`RCD_TASK routine-civic-data-runner: door registry — ${doorSyncLine(await syncHeldDoors(doorRepos.doors, { scoutResults: doorRepos.scoutResults }))}`);
      const [published] = await runBoundedChildPass([{
        id: MEETING_DOORS_CONTRACT_ID,
        failureDomain: "derived:meeting-doors",
        executable: process.execPath,
        args: ["--experimental-strip-types", "scripts/publish-meeting-doors.mts", "--promote"],
        env: admittedRuntimeChildEnvironment({ parentEnv: process.env, capability: "ROUTINE_CONTRACT", contract: MEETING_DOORS_CONTRACT_ID, parentPid: process.pid }),
      }], { cwd: ROOT, env: process.env, timeoutMs: ROUTINE_CHILD_TIMEOUT_MS, maxBufferBytes: ROUTINE_CHILD_MAX_BUFFER_BYTES, concurrency: 1 });
      console.log(`RCD_TASK routine-civic-data-runner: meeting doors ${published?.status === 0 ? "published" : `not published (${safeFailure(published?.errorMessage ?? published?.stderr.trim().split("\n").at(-1) ?? "no answer")}); children read the last good doors`}`);
    }
    await refreshDoorsForPass(doorRepos.doors);
  } catch (error) {
    console.warn(`RCD_TASK routine-civic-data-runner: door refresh unavailable — ${safeFailure(sanitizedErrorDiagnostic(error))}; existing source work continues`);
  }
}

const sharedBrowser = sharedScoutBrowser();
const workerToolsHost = ROUTINE_DATA_PROCESS_LEASE && controlPlaneUrlFromEnv()
  ? await startWorkerToolsHost({ repos: await createPgRepositories(controlPlaneUrlFromEnv()!,
    RUN_STARTED_AT, { skipBootstrap: true }), browse: sharedBrowser.browse }) : null;
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
 * How often each open door has been seen to change, by door id, so a door that changes faster than its
 * policy is checked as often as it changes. An unreadable registry leaves every task on its policy.
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
 * The task's door's last success or failure (a hand-wired meeting door, or a
 * feed's door), from its promotion outcome. A registry that cannot be written
 * never changes the pass.
 */
let doorOutcomeRepos: Promise<Awaited<ReturnType<typeof createPgRepositories>>> | null = null;
async function recordTaskDoorOutcome(taskId: string, outcome: DoorOutcome, changed = false, evidence: DoorEvidence | null = null,
  sourceClock?: () => Promise<RoutineTaskClock>): Promise<void> {
  const connection = controlPlaneUrlFromEnv();
  if (connection === null) return;
  try {
    const checkedAt = outcome === "SUCCESS" ? (await sourceClock?.())?.lastSucceededObservedAt : undefined;
    if (outcome === "SUCCESS" && (!checkedAt || Date.parse(checkedAt) < Date.parse(RUN_STARTED_AT))) return;
    doorOutcomeRepos ??= createPgRepositories(connection, RUN_STARTED_AT, { skipBootstrap: true });
    const repos = await doorOutcomeRepos;
    const doorId = await taskDoorId(repos.doors, taskId);
    if (doorId === null) return;
    const at = checkedAt ?? new Date().toISOString();
    // A failed read that tells the door itself is gone judges it and opens its fix item; a promoted read reopens a door that was shut.
    if (outcome === "FAILURE" && evidence !== null) {
      if ((await recordDoorEvidence(repos.doors, doorId, evidence, at, repos)).written) return;
    }
    await recordDoorOutcome(repos.doors, doorId, outcome, at, changed);
    if (outcome === "SUCCESS" && await reopenDoorIfShut(repos.doors, doorId, at, repos)) {
      console.log(`RCD_TASK ${taskId}: its door was shut and reads again; reopened`);
    }
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
async function latestUnreceiptedSupervisorAttempts(selectedTasks: readonly RoutineSourceTask[], codeChangeRetryIds: ReadonlySet<string>): Promise<RoutineSupervisorAttemptHistory & { readonly protocolFailures: readonly unknown[] }> {
  const connection = controlPlaneUrlFromEnv();
  if (connection === null) {
    throw new Error(`${CONTROL_PLANE_URL_VAR} is not configured; provider-frontier fairness cannot be proved.`);
  }
  const repos = await createPgRepositories(connection, RUN_STARTED_AT, { skipBootstrap: true });
  assertDurableRepositories(repos, "routine civic-data provider-frontier history");
  const taskIds = new Set(selectedTasks.map(({ id }) => id));
  /* This is the supervisor's first connect, so a transient connect failure is retried (connect-retry.ts). */
  const supervisorOutcomes = await withControlPlaneConnectRetry(
    /* Recent outcomes only, narrowed to the fields the history validates, oldest first. */
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
  // This job's failure is saved as soon as it ends, while unrelated children can keep the round open.
  const protocolFailures = await withControlPlaneConnectRetry(() => repos.ownerDigests.readRecentWhere(
    HUNT_SOURCE_PROGRESS_LOG_KEY, ["huntSourceProgress", "stage"], "FAILED",
    ROUTINE_SUPERVISOR_HISTORY_WINDOW, { testedSha: true, huntSourceProgress: true },
  ));
  return { ...routineUnreceiptedSupervisorAttemptHistory(supervisorOutcomes, taskIds,
    { taskIds: codeChangeRetryIds, codeSha: RUNNING_CODE_SHA }), protocolFailures };
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

/** Resolve the actual Admin Send for hunt work. Publication of already-verified work needs no Send;
 * a paused runner or an unreadable control still admits nothing. */
async function readHuntSourceTasks(store: PostgresRoutineDataStore, failures: SupervisorFailure[]): Promise<readonly RoutineSourceTask[]> {
  // An explicit selection of a publication door (`--only=registry-runtime-bindings`) still reads its owed work.
  if (FORCE || (ONLY && !WORKER_PUBLICATION_TASK_IDS.some(id => ONLY.has(id)))) return [];
  const connection = controlPlaneUrlFromEnv();
  if (!connection) throw new Error("control-plane reporting connection is unavailable");
  const repos = await createPgRepositories(connection, RUN_STARTED_AT, { skipBootstrap: true });
  const intents = readIntents([...(await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY))]);
  if (intents.runnerPause.paused) return [];
  // The independent publish-now lane owns the worker outbox and held-page fallbacks.
  // Standing source acquisition never loads the entire worker history before its first source read.
  if (PUBLISH_NOW || (ONLY && WORKER_PUBLICATION_TASK_IDS.some(id => ONLY.has(id)))) {
    const sql = neon(connection);
    const selected = ONLY ? WORKER_PUBLICATION_TASK_IDS.filter(id => ONLY.has(id)) : WORKER_PUBLICATION_TASK_IDS;
    const items = await readWorkerPublicationItems((query, params) => sql.query(query, [...params]), selected);
    const pending = await readPublicationBoxItems(repos, items, new Date().toISOString());
    if (pending.length) {
      const context = await workerPublicationContext(RUN_STARTED_AT, repos);
      await buildBoxFindings({ repos, items: pending, now: () => new Date().toISOString(), leaseMs: 120_000, readCapture: context.readCapture });
    }
    const owed = await readOwedFactItems(items, ids => readCompletedWorkerResultsOf(repos, ids), RUN_STARTED_AT);
    if (owed.rosters.length || owed.comments.length) try {
      const context = await workerPublicationContext(RUN_STARTED_AT, repos);
      const facts = readerFactDb();
      for (const [label, publish, ids] of [["rosters", publishOwedRosterFacts, owed.rosters], ["comment rules", publishOwedCommentFacts, owed.comments]] as const) {
        if (!ids.length) continue;
        const report = await publish({ repos, store, facts, workItemIds: ids, now: RUN_STARTED_AT, readCapture: context.readCapture });
        console.log(`RCD_FACTS ${label}: ${report.filter(row => row.outcome.status !== "HELD").length} of ${report.length} published as facts`);
      }
    } catch (error) {
      failures.push({ taskId: "fact-publication", code: "FACT_PUBLICATION_FAILED", detail: safeFailure(sanitizedErrorDiagnostic(error)) });
    }
    const publication = await readPublishNowWorkerTasks(items, ids => readCompletedWorkerResultsOf(repos, ids), RUN_STARTED_AT);
    if (!PUBLISH_NOW) return publication;
    // The hourly first look: each hot door's page or feed is looked at once an hour; a change is stored on
    // the door and read below at once. A look that cannot be made never stops a known-changed door's read.
    try {
      const listed = (await listDoors(repos.doors)).doors;
      const clockStore = new PostgresRoutineDataStore();
      const sizeFor = websiteSizeFromHoldings([...new Set(listed.flatMap((door) => stateOfPlace(door.ocdId ?? "") ?? []))]);
      const report = await runHourlyProbes(repos.doors, listed, await hotMeetingPartitions({ readClock: (task) => clockStore.clock(task.sourceId, task.recordClass, task.scope), db: getDb() }, Date.now()),
        pacedProbeFetch({ pacing: repos.websitePacing, sizeFor }), new Date().toISOString());
      if (report.looked > 0 || report.deferred > 0 || report.waiting > 0) {
        console.log(`RCD_PROBE ${report.looked} door(s) looked at (${report.requests} request(s)): ${report.changed} changed, ${report.unchanged} the same, ${report.failed} failed; ` +
          `${report.waiting} waiting on their website's hour or its request to wait; ${report.deferred} not due`);
      }
    } catch (error) {
      console.log(`RCD_PROBE CANNOT_TELL — ${safeFailure(sanitizedErrorDiagnostic(error))}; doors keep their routine schedule`);
    }
    return [...publication, ...publishNowDoorTasks((await listDoors(repos.doors)).doors,
      MEETING_PARTITION_CONTRACTS.map(routineTaskFromContract), RUN_STARTED_AT)];
  }
  const row = await repos.adminConfig.read(ADMIN_CONFIG_ID);
  if (row === null) return [];
  if (!isAdminConfig(row.value)) throw new Error("the owner's policy row is unreadable");
  const held = expansionScopesOf(row.value);
  if (held.malformed) throw new Error("the owner's scope list contains unreadable decisions");
  const currentSends = held.scopes.filter(scope => scope.sourceWorkVersion === 1);
  if (currentSends.length === 0) return [];
  const lookup = await loadPublishedScopeLookupState(currentSends.map(send => send.geography));
  const resolved = await resolveScopes(currentSends, lookup, null);
  for (const scope of resolved.scopes) {
    if (scope.kind === "UNRESOLVED") throw new Error(`scope ${scope.decision.key}: ${scope.why}`);
  }
  const admitted = admittedHuntSourceScopes(resolved.scopes, RUN_STARTED_AT);
  if (admitted.length === 0) return [];
  return huntSourceTasks(admitted, RUN_STARTED_AT);
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
  readonly readerEdge: ReaderEdgePublicationOutcome;
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
    lane: PUBLISH_NOW ? "publish-now" : "routine-civic-data",
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
    readerEdge: input.readerEdge,
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
// When each lane's last read of this pass ended: a catch-up meeting read keeps the same-host gap after it.
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

// Source pointers may settle in the other routine process while publication has a large outbox.
// Copy them before admission, then once per existing publication minute without overlapping sweeps.
const publishNowEdgeStore = PUBLISH_NOW ? resolveReaderArtifactWriteStore() : null;
const publishNowEdgeChecks = PUBLISH_NOW ? startPublishNowEdgeChecks({
  store: publishNowEdgeStore?.kind === "local-file" ? "local folder" : publishNowEdgeStore?.kind === "netlify-blobs" ? "Netlify Blobs" : "not configured",
  readPaused: async () => {
    const connection = controlPlaneUrlFromEnv();
    if (!connection) throw new Error("control-plane reporting connection is unavailable");
    const repos = await createPgRepositories(connection, RUN_STARTED_AT, { skipBootstrap: true });
    return readIntents([...(await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY))]).runnerPause.paused;
  },
  check: async () => {
    const outcome = await publishSupervisorReaderEdge(store, new Date().toISOString());
    const failure = readerEdgeSupervisorFailure(outcome);
    if (failure) supervisorFailures.push(failure);
    return outcome;
  }, onError: error => {
    supervisorFailures.push({ taskId: "reader-edge-publication", code: "READER_EDGE_PUBLISH_FAILED",
      detail: safeFailure(sanitizedErrorDiagnostic(error)) });
  },
}) : null;
if (publishNowEdgeChecks) {
  step = "publishing changed source pointers before worker admission";
  await publishNowEdgeChecks.run();
}
if (!PUBLISH_NOW) {
  step = "loading fact store entities";
  try {
    const loaded = await ensureFactEntities(readerFactDb(), ROOT, registeredStates(ROOT));
    if (loaded.length) console.log(`fact store entities: loaded ${loaded.join(", ")}`);
  } catch (error) {
    supervisorFailures.push({ taskId: "fact-store-entities", code: "FACT_ENTITIES_LOAD_FAILED", detail: safeFailure(sanitizedErrorDiagnostic(error)) });
  }
  step = "carrying the rosters, office contacts and comment rules readers already see onto facts";
  try {
    const facts = readerFactDb();
    const rosters = await cartonRosters(facts.query, id => store.readCandidate(id), REGISTRY_RUNTIME_SCOPE);
    const comments = await cartonComments(facts.query, id => store.readCandidate(id));
    const offices = await cartonOffices(facts.query, await readRegistryRuntimePrior(store, RUN_STARTED_AT));
    const connection = controlPlaneUrlFromEnv();
    if ((rosters || comments || offices) && connection) {
      const repos = await createPgRepositories(connection, RUN_STARTED_AT, { skipBootstrap: true });
      const common = { facts, clocks: factClocks((await repos.adminConfig.read(ADMIN_CONFIG_ID))?.value ?? null), repos,
        vault: new DurableEvidenceStore(join(ROOT, ...VAULT_DIR)), fetch: pacedProbeFetch({ pacing: repos.websitePacing }), now: RUN_STARTED_AT };
      for (const [label, report] of [["rosters", rosters && await importCartonRosters({ ...rosters, ...common })],
        ["comment rules", comments && await importCartonComments({ ...comments, ...common })],
        ["office contacts", offices && await importCartonOffices({ ...offices, ...common })]] as const) {
        if (report) console.log(`fact store ${label}: ${report.live} facts live, ${report.confirmed} confirmed, ${report.blanks} blanks, ${report.unreadable.length} pages unreadable`);
      }
    }
  } catch (error) {
    supervisorFailures.push({ taskId: "fact-store-import", code: "FACT_IMPORT_FAILED", detail: safeFailure(sanitizedErrorDiagnostic(error)) });
  }
}

// Resolve every due scope at one frozen instant before launching. The provider frontier below
// admits one least-recently-considered partition per upstream, so a host with many partitions
// cannot stretch one pass and keep a newly due unrelated source out of the next.
const admissionNowMs = Date.now();
let huntTasks: readonly RoutineSourceTask[] = [];
try {
  huntTasks = await readHuntSourceTasks(store, supervisorFailures);
} catch (error) {
  const detail = safeFailure(sanitizedErrorDiagnostic(error));
  supervisorFailures.push({ taskId: "hunt-source-admission", code: "HUNT_SCOPE_UNREAD", detail });
  console.error(`RCD_TASK hunt-source-admission: SUPERVISOR_FAILURE (CANNOT_TELL) — ${detail}`);
}
// A standing refresh already covers a Send for its source; don't launch duplicate children for the same pointer.
const selectedTasks = [...STANDING_SOURCE_TASKS, ...huntTasks.filter(task => !STANDING_SOURCE_TASKS.some(standing => standing.id === task.id))]
  .filter((task) => !ONLY || ONLY.has(task.id) || (task.registeredContractId !== undefined && ONLY.has(task.registeredContractId)));
if (PUBLISH_NOW && selectedTasks.length === 0) {
  const readerEdge = (await publishNowEdgeChecks!.stop())!;
  if (publishNowHasNothingOwed(PUBLISH_NOW, selectedTasks.length, supervisorFailures.length, readerEdge)) {
    console.log("publish-now: nothing owed this minute");
  } else {
    step = "persisting the publication outcome";
    try {
      const cycleId = await persistSupervisorOutcome({ readerEdge, failures: supervisorFailures,
        attemptedTasks: 0, verifiedSourceSuccesses: 0, verifiedSourceFailures: 0,
        finishedAt: new Date().toISOString(), taskReceipts: [], dueRequestLines: [],
        readerReadback: { denominator: 0, recordedPass: 0, recordedFail: 0, currentFail: 0, noops: 0, repairFailures: 0, references: [] },
      });
      console.log("RCD_OPERATIONAL_OUTCOME=" + JSON.stringify({ kind: "ROUTINE_CIVIC_DATA_SUPERVISOR",
        state: supervisorFailures.length === 0 ? "SUCCEEDED" : "FAILED", cycleId, lane: "publish-now",
        readerEdge, exactTaskReceipts: 0, durable: true }));
    } catch (error) {
      const detail = safeFailure(sanitizedErrorDiagnostic(error));
      supervisorFailures.push({ taskId: "routine-civic-data-supervisor-outcome", code: "SUPERVISOR_OUTCOME_NOT_DURABLE", detail });
      console.error("RCD_OPERATIONAL_OUTCOME=" + JSON.stringify({ kind: "ROUTINE_CIVIC_DATA_SUPERVISOR",
        state: "STORE_UNREACHABLE", detail, durable: false }));
    }
  }
  if (!await flushDatabaseTransfer()) console.warn("RCD_TRANSFER daily byte counter could not be saved; data results are unchanged.");
  await ROUTINE_DATA_PROCESS_LEASE.release();
  await readCacheHost.close();
  await workerToolsHost?.close();
  await sharedBrowser.close();
  process.exit(supervisorFailures.length === 0 ? 0 : 2);
}
step = "reading the routine task clocks";
const clockReads = FORCE
  ? selectedTasks.map((task) => ({ task, ok: true as const, clock: undefined, error: null }))
  : await readRoutineTaskClocks(
      selectedTasks,
      (task) => store.clock(task.sourceId, task.recordClass, task.scope, task.parserVersion),
    );
// Meeting sources follow their bodies' sittings; the window is decided once, at the same frozen
// instant. A sitting's publisher-stated end decides when it concluded; an unreadable end set falls
// back to the day bound and is reported.
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
// A door marked to be read now is the same due request an owner's controlled refresh makes. Spent marks are cleared first.
if (!FORCE && controlPlaneUrlFromEnv() !== null) {
  try {
    const doorRepos = await createPgRepositories(controlPlaneUrlFromEnv()!, RUN_STARTED_AT, { skipBootstrap: true });
    const settledAt = new Date().toISOString();
    const cleared = await settleReadNow(doorRepos.doors, settledAt);
    const marked = readNowDueRequests((await listDoors(doorRepos.doors)).doors, new Set(MEETING_PARTITION_CONTRACTS.map((contract) => contract.id)), settledAt);
    // A door edited in Admin asks for the two derive steps now, not on their six-hour clock.
    const derive = editDeriveDueRequests((await listDoors(doorRepos.doors)).doors, new Set(DOOR_DERIVE_CONTRACT_IDS), settledAt);
    dueRequests = [...dueRequests, ...[...marked, ...derive].filter((request) => !dueRequests.some((held) => held.id === request.id))];
    if (marked.length > 0 || cleared > 0 || derive.length > 0) console.log(`RCD_DUE_REQUEST doors marked to be read now: ${marked.length} due, ${cleared} settled; ${derive.length} derive request(s) after door edits`);
  } catch (error) {
    console.log(`RCD_DUE_REQUEST doors marked to be read now CANNOT_TELL — ${safeFailure(sanitizedErrorDiagnostic(error))}; every task keeps its normal schedule`);
  }
}
const honouredDueRequests = new Map<string, RoutineDueRequest>();
let meetingDiscoveryInputs: MeetingDiscoveryInputs | null = null;
if (!FORCE && selectedTasks.some(task => task.id === "meeting-body-crosswalk-derived" || task.id === "meeting-source-wiring")) {
  try {
    const connection = controlPlaneUrlFromEnv();
    if (connection) {
      const sql = neon(connection);
      meetingDiscoveryInputs = await readMeetingDiscoveryInputs((statement, params) => sql.query(statement, params));
    }
  } catch (error) {
    console.error(`RCD_INPUT_CHANGED meetings: ${safeFailure(sanitizedErrorDiagnostic(error))}; normal cadence retained`);
  }
}
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
  const history = await latestUnreceiptedSupervisorAttempts(selectedTasks, routineCodeChangeRetryTaskIds(clockReads));
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
  const observedChange = observedChangeRates.get(task.id) ?? observedChangeRates.get(`feed:${task.id}`);
  const observedEveryMs = observedChange === undefined ? undefined : observedChange * 60_000;
  const dueRequest = FORCE ? null : routineDueRequestFor(task, durableClock, admissionNowMs, dueRequests);
  const publicationDue = campaignPublicationInputsDue(task.id, campaignPublicationInputs);
  const discoveryDue = meetingDiscoveryInputsDue(task.id, durableClock, meetingDiscoveryInputs, admissionNowMs);
  if (task.ownerInvocation) {
    const due = routineTaskDue(task, durableClock, admissionNowMs);
    const succeeded = Date.parse(durableClock?.lastSucceededObservedAt ?? durableClock?.lastSucceededAt ?? "");
    const reused = !task.ownerInvocation.publicationPending && Number.isFinite(succeeded) && succeeded >= Date.parse(task.ownerInvocation.requestedAt) && succeeded <= admissionNowMs;
    publicationInputLines.push(`Send ${task.ownerInvocation.instructions.join(", ")}: shared ${task.id} ${due ? "refresh offered to the normal source frontier" : reused ? "verified shared result reused" : "failed attempt held under retry backoff"}; canonical scope ${task.scope}.`);
  }
  if (!FORCE && !routineTaskDue(task, durableClock, admissionNowMs, sittingHot, observedEveryMs) && dueRequest === null && !publicationDue && !discoveryDue) {
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

// A meeting lane is read earliest deadline first, up to three a pass; a requested partition's
// deadline is the earlier of its own and the request's.
const admitted = routineFailureDomainFrontier(dueCandidates.map(({ pending, clock }) => ({
  task: pending.task,
  lastConsideredAt: newestConsideredAt(clock, supervisorAttempts.get(pending.task.id)),
  baselineOwed: routineBaselineOwed(pending.task, clock),
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
for (const { task } of placeSourceLaunchOrder(routinePassLaunchOrder(admitted, admissionNowMs))) pendingRuns.push(pendingByTaskId.get(task.id)!);
for (const pending of pendingRuns) await recordHuntSourceProgress(pending.task, "QUEUED", "Admitted to the existing source worker pool. Deterministic code; no model tokens. Verification and reader publication are still owed.");
const dueRequestLines = [...honouredDueRequests].map(([taskId, request]) => admittedIds.has(taskId)
  ? `Owner due request ${request.id}: ${taskId} admitted by this ordinary pass (due ${request.dueAt}).`
  : `Owner due request ${request.id}: ${taskId} was due but deferred by the provider frontier; the next pass offers it again.`).concat(publicationInputLines);
attempted = pendingRuns.length;

// Every meeting child proves the registry-runtime pointer before it acquires anything. With two or
// more in a pass, prove it once here and hand each child the attestation; a child whose pointer no
// longer matches runs its own full proof.
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
      // A changed door's publish-now read is its routine partition's own read, so it runs under that routine contract.
      ...((pending.task.ownerInvocation && pending.task.registeredContractId !== undefined) || automaticRefreshContract(pending.task.id) ? admittedRuntimeChildEnvironment({
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
    // Behind WTP_MEETING_LANES: a host that goes quiet pauses its own read early.
    ...(pending.kind === "MEETING_PARTITION" && meetingReadQuietMs() !== undefined ? { timeoutMs: meetingReadQuietMs()! } : {}),
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
// Awaited below, with the catch-up reads that run beside it.
const sourcePass = runMeetingDiscoveryChain(pendingRuns, runs => runBoundedChildPass(
  runs.map(sourceChildCommand),
  {
    cwd: ROOT,
    env: process.env,
    timeoutMs: ROUTINE_CHILD_TIMEOUT_MS,
    maxBufferBytes: ROUTINE_CHILD_MAX_BUFFER_BYTES,
    concurrency: sourceConcurrency,
    // Two reads of one host in this pass start at least a minute apart.
    sameDomainGapMs: ROUTINE_SAME_DOMAIN_CHILD_GAP_MS,
    onStarting: async (command, index) => {
      await acquireChildMemory(command);
      await recordHuntSourceProgress(runs[index]!.task, "COLLECTING_AND_VERIFYING", "The source command has a worker slot. Collecting current source records and running the existing identity, content, freshness and reader checks. No model call is used.");
    },
    onSettled: async (run, index) => settlePendingRun(runs[index]!, run),
    // Classification consumes the exact receipt before this worker advances.
    // Retaining only the small result summary bounds memory across the full portfolio.
    discardOutputAfterSettlement: true,
  },
));

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
      await recordTaskDoorOutcome(pending.task.id, "SUCCESS", receipt.promotedVersion !== null && receipt.confirmedAt === undefined, null,
        () => store.clock(pending.task.sourceId, pending.task.recordClass, pending.task.scope));
      captureTaskReceipt(pending, receipt, "VERIFIED_SOURCE_SUCCESS");
      console.log("RCD_RECEIPT=" + JSON.stringify(receipt));
      console.log(`RCD_TASK ${pending.task.id}: GOOD (${receipt.state})`);
    } else {
      verifiedSourceFailures += 1;
      const failedCandidate = !receipt.acquisitionSucceeded ? await store.readCandidateSummary(receipt.candidateId).catch(() => null) : null;
      await recordTaskDoorOutcome(pending.task.id, "FAILURE", false, failedCandidate === null ? null : evidenceFromCandidate(failedCandidate));
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
    await recordTaskDoorOutcome(pending.task.id, "SUCCESS", child.receipt.promotedVersion !== null && child.receipt.confirmedAt === undefined, null,
      () => store.clock(pending.task.sourceId, pending.task.recordClass, pending.task.scope));
    verifiedSourceSuccesses += 1;
    captureTaskReceipt(pending, child.receipt, "VERIFIED_SOURCE_SUCCESS");
    console.log("RCD_RECEIPT=" + JSON.stringify(child.receipt));
    const delivered = (child.receipt as { delivered?: { records: number; gaps: number; gapReasons: Record<string, number> } }).delivered;
    // A publication pass says what reached readers, so a new version is never read as delivery.
    console.log(`RCD_TASK ${pending.task.id}: GOOD (${child.state})${delivered ? ` — delivered ${delivered.records} record(s); ${delivered.gaps} owed: ${Object.entries(delivered.gapReasons).map(([code, n]) => `${code}×${n}`).join(", ") || "none"}` : ""}`);
  } else if (child.kind === "VERIFIED_SOURCE_FAILURE") {
    const failedCandidate = !child.receipt.acquisitionSucceeded ? await store.readCandidateSummary(child.receipt.candidateId).catch(() => null) : null;
    await recordTaskDoorOutcome(pending.task.id, "FAILURE", false, failedCandidate === null ? null : evidenceFromCandidate(failedCandidate));
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

// Reader delivery is its own OS-killable evidence domain: one child per non-meeting Reader, one shared
// child for all meeting partitions (the Reader composes them together once).
const readerContracts = selectedReaderRepairContracts([
  ...observableRoutineContracts(),
  ...MANUAL_PRODUCTION_SOURCE_CONTRACTS,
], !PUBLISH_NOW && ONLY === null ? null : selectedTasks);
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
    // A child that died on an uncaught error names its step and cause in one sanitized line.
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

// A meeting read that falls due while the pass is held open starts as soon as its lane is free
// (lib/civic-data/hot-read-catch-up.ts). The repair starts once every such read has settled.
const hotReadTasks = FORCE || PUBLISH_NOW
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

/** The catch-up reads to start now: the pass's own rules over its own clock reads. */
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
await publishNowEdgeChecks?.stop();
const finalReaderEdge = publishNowEdgeChecks ? await publishNowEdgeChecks.run()
  : await publishSupervisorReaderEdge(store, new Date().toISOString(), ONLY === null ? null : selectedTasks);
const readerEdge = publishNowEdgeChecks ? (await publishNowEdgeChecks.stop())! : finalReaderEdge;
const readerEdgeFailure = readerEdgeSupervisorFailure(finalReaderEdge);
if (readerEdgeFailure && !publishNowEdgeChecks) supervisorFailures.push(readerEdgeFailure);
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
    readerEdge,
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
    lane: PUBLISH_NOW ? "publish-now" : "routine-civic-data",
    readerEdge,
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
  lane: PUBLISH_NOW ? "publish-now" : "routine-civic-data",
  attempted: attemptedCount.matched,
  denominator: attemptedCount.denominator,
  failed:
    verifiedSourceFailures +
    supervisorFailures.length +
    readerReadbacksRecordedFail +
    readerReadbacksCurrentFail,
  verifiedSourceSuccesses,
  verifiedSourceFailures,
  readerEdge,
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
