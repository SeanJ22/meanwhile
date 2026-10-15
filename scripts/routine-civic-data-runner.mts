import { runMeetingReaderRepairDomain } from "../lib/civic-data/reader-verification.ts";
import { readerVerifierClosureAttestor } from "./lib/verifier-attestation.ts";
import { MEETING_STATE_BUCKETS, meetingTaskBucket, runMeetingBatchPass } from "../lib/civic-data/meeting-batch.ts";
import { meetingPrefetchSeed } from "../lib/civic-data/meeting-prefetch.ts";
import { ROUTINE_STATES, routineScopeState } from "../lib/civic-data/state-scope.ts";
import { refreshStaleFacts } from "../lib/facts/refresh.ts";
import { prefetchSourceRequests, runWithSourceFetch } from "../lib/sources/fetch-source.ts";
import { applyRoutineClockSettings, readHeldFinanceCalendars, type SourceCalendar } from "../lib/civic-data/clock-settings.ts";
import { CAPTURE_CONVERSION_LOG_KEY, captureConversionRecord, captureConversionRecorded } from "../lib/civic-data/capture-conversion.ts";
import { readMeetingDiscoveryInputs, meetingDiscoveryInputsDue, runMeetingDiscoveryChain, type MeetingDiscoveryInputs } from "../lib/civic-data/meeting-discovery-due.ts";
import { readerFactDb } from "../lib/facts/db.ts";
import { ensureFactEntities, registeredStates } from "../lib/facts/entities.ts";
import { cartonComments, cartonOffices, cartonRosters, importCartonComments, importCartonOffices, importCartonRosters } from "../lib/facts/carton-import.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { publishBoxFindings } from "../lib/facts/box-publication.ts";
import { workerPublicationContext } from "../lib/civic-data/worker-publication-context.ts";
import { readHeldBallotInputs } from "../lib/civic-data/worker-held-elections.ts";
/* @freshness-reads-here */
import { hostname } from "node:os";
import { resolve } from "node:path";
import { AUTOMATIC_REFRESH_TASKS, automaticRefreshContract } from "../lib/civic-data/automatic-refresh.ts";
import { ballotInputHash, ballotPublicationDue, parseBallotPublicationResult, readLatestBallotPublication, type BallotPublicationResult } from "../lib/civic-data/ballot-publication.ts";
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
  routineTaskDueAtMs,
  routineBaselineOwed,
  routineCodeChangeRetryTaskIds,
  routineAdmissionClock,
  unchangedRoutineProtocolFailure,
  routineTaskSelection,
  routinePreSpawnDeferral,
  routineSerialLane,
  ROUTINE_SERIAL_LANE_LAUNCH_MS,
  sittingWindowSignals,
  routineUnreceiptedSupervisorAttemptHistory,
  type RoutineSupervisorAttemptHistory,
  type RoutineTaskClock,
  type RoutineSourceTask,
} from "../lib/civic-data/runner.ts";
import {
  MEETING_PARTITION_CONTRACTS,
  observableRoutineContracts,
  sittingWindowSourceIds,
} from "../lib/civic-data/meeting-partitions.ts";
import { OUTCOME_PARTITION_CONTRACTS } from "../lib/civic-data/outcome-partitions.ts";
import { recordDoorOutcome, taskDoorIds, type DoorOutcome } from "../lib/doors/outcome.ts";
import { evidenceFromCandidate, reopenDoorIfShut } from "../lib/doors/ingest-evidence.ts";
import { recordDoorEvidence, type DoorEvidence } from "../lib/doors/shut.ts";
import { observedChangeMinutesByDoor } from "../lib/doors/observed-rate.ts";
import { isDoorRecord } from "../lib/doors/registry.ts";
import { refreshDoorsForPass } from "../lib/doors/install.ts";
import { doorSyncLine, syncHeldDoors } from "../lib/doors/seed-all.ts";
import { readNowDueRequests, settleReadNow, sourceChangesByTask } from "../lib/doors/mission-refresh.ts";
import { editDeriveDueRequests } from "../lib/doors/edit-derive.ts";
import { listDoors } from "../lib/doors/registry.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { readRegistryRuntimePrior, REGISTRY_RUNTIME_SCOPE } from "../lib/registry/runtime-data-plane.ts";
import {
  ROUTINE_CHILD_CONCURRENCY,
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
import { PUBLISH_NOW_PASS_BUDGET_MS, PUBLISH_NOW_SINGLETON_PORT, publishNowHasNothingOwed, readOwedFactItems, readPublishNowWorkerTasks, readWorkerPublicationItems, startPublishNowEdgeChecks } from "../lib/civic-data/publish-now.ts";
import { publishOwedRosterFacts } from "../lib/civic-data/worker-roster-publication.ts";
import { publishOwedCommentFacts } from "../lib/civic-data/worker-comment-facts.ts";
import { websiteSizeFromHoldings } from "../lib/control-plane/scheduler/host-supervision.ts";
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
import { readerEdgeSupervisorFailure, type ReaderEdgePublicationOutcome } from "../lib/civic-data/reader-edge-publication.ts";
import { runReaderEdgePublicationChild } from "../lib/civic-data/reader-edge-child.ts";
import { checkReaderEdgePublicationInputs } from "../lib/civic-data/reader-edge-inputs.ts";
import { resolveReaderArtifactWriteStore } from "../lib/meetings/edge-store.ts";
import { floored } from "../lib/ops/denominator-floor.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { startWorkerToolsHost } from "../lib/control-plane/workers/process-pool.ts";
import { sharedScoutBrowser } from "./scout-browse.mts";
import { routineProcessSlots } from "../lib/control-plane/workers/worker-slots.ts";
import { sanitizedErrorDiagnostic } from "../lib/ops/error-diagnostic.ts";
import { childCrash, childFatalLine, installFatalLine } from "../lib/ops/fatal-line.ts";
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
const STATE_SCOPE = process.argv.find(arg => arg.startsWith("--state="))?.slice(8) ?? "US";
if (!ROUTINE_STATES.includes(STATE_SCOPE)) throw new Error("Invalid source state scope");
const PUBLISH_NOW = process.argv.includes("--publish-now");
const FAMILY = process.argv.find(arg => arg.startsWith("--family="))?.slice(9) ?? "all";
if (!["all", "meetings", "other"].includes(FAMILY)) throw new Error("Invalid source family");
const MEETING_BUCKET = Number(process.argv.find(arg => arg.startsWith("--meeting-bucket="))?.slice(17) ?? 0);
if (!Number.isSafeInteger(MEETING_BUCKET) || MEETING_BUCKET < 0 || MEETING_BUCKET >= MEETING_STATE_BUCKETS) throw new Error("Invalid meeting bucket");
/* A publish-now pass launches no child after its budget, so the runner can hand off a release between passes; what was not started stays owed. */
const PASS_LAUNCH_DEADLINE_MS = PUBLISH_NOW ? Date.now() + PUBLISH_NOW_PASS_BUDGET_MS : Number.POSITIVE_INFINITY;
if (PUBLISH_NOW && FORCE) throw new Error("Publish-now cannot force unrelated source work.");
const ADMITTED_CODE_SHA = assertRuntimeAuthority({ capabilities: ["ROUTINE_SUPERVISOR"] }).sha;

let sourceChanges: ReadonlyMap<string, string> = new Map();
if (controlPlaneUrlFromEnv() === null) {
  console.warn("RCD_TASK routine-civic-data-runner: no door registry is configured, so this pass has no hand-wired meeting work");
} else if (!PUBLISH_NOW) {
  try {
    const doorRepos = await createPgRepositories(controlPlaneUrlFromEnv()!, new Date().toISOString(), { skipBootstrap: true });
    const doorPass = await refreshDoorsForPass(doorRepos.doors, STATE_SCOPE);
    sourceChanges = sourceChangesByTask(doorPass.doors ?? []);
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
const standingTasks = [
  // The installed doors' meeting partitions are already among the routine tasks: installing doors rebuilds that list.
  ...ROUTINE_SOURCE_TASKS,
  ...OUTCOME_PARTITION_CONTRACTS.map(routineTaskFromContract),
  ...AUTOMATIC_REFRESH_TASKS,
].filter(task => routineScopeState(task.scope, task.command) === STATE_SCOPE);
const STANDING_SOURCE_TASKS: readonly RoutineSourceTask[] = PUBLISH_NOW ? []
  : FAMILY === "meetings" ? standingTasks : await withNationalPlaceTasks(standingTasks, process.argv.slice(2), STATE_SCOPE);
const TASK_SELECTION = routineTaskSelection(process.argv.slice(2), [...STANDING_SOURCE_TASKS, ...WORKER_PUBLICATION_TASK_IDS.map(id => ({ id }))]);
const ONLY = TASK_SELECTION.ok ? TASK_SELECTION.only : null;
const inheritedStartedAt = process.env[ROUTINE_SUPERVISOR_STARTED_AT_ENV];
const RUN_STARTED_AT = inheritedStartedAt && Number.isFinite(Date.parse(inheritedStartedAt)) &&
    new Date(Date.parse(inheritedStartedAt)).toISOString() === inheritedStartedAt
  ? inheritedStartedAt
  : new Date().toISOString();
const cycleScope = PUBLISH_NOW ? `${hostname()}/${STATE_SCOPE}` : `${hostname()}/${STATE_SCOPE}/${FAMILY}${FAMILY === "meetings" ? `/${MEETING_BUCKET}` : ""}`;
const SUPERVISOR_CYCLE_ID = routineSupervisorCycleId(cycleScope, RUN_STARTED_AT, PUBLISH_NOW ? "publish-now" : "routine-civic-data");
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

step = "taking the host-local singleton";
const ROUTINE_DATA_PROCESS_LEASE = TASK_SELECTION.ok ? await (async () => {
  try {
    return await acquireProcessSingleton(
      PUBLISH_NOW ? `publish-now-runner:${STATE_SCOPE}` : `routine-civic-data-runner:${STATE_SCOPE}:${FAMILY}:${MEETING_BUCKET}`,
      PUBLISH_NOW ? PUBLISH_NOW_SINGLETON_PORT + ROUTINE_STATES.indexOf(STATE_SCOPE) : ROUTINE_DATA_RUNNER_SINGLETON_PORT + (FAMILY === "meetings" ? 200 + ROUTINE_STATES.indexOf(STATE_SCOPE) * MEETING_STATE_BUCKETS + MEETING_BUCKET : 100 + ROUTINE_STATES.indexOf(STATE_SCOPE)),
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
if (ROUTINE_DATA_PROCESS_LEASE && controlPlaneUrlFromEnv() && !PUBLISH_NOW) {
  try {
    const doorRepos = await createPgRepositories(controlPlaneUrlFromEnv()!, RUN_STARTED_AT, { skipBootstrap: true });
    console.log(`RCD_TASK routine-civic-data-runner: door registry — ${doorSyncLine(await syncHeldDoors(doorRepos.doors, STATE_SCOPE))}`);
    const doorPass = await refreshDoorsForPass(doorRepos.doors, STATE_SCOPE);
    if (doorPass.doors !== undefined) sourceChanges = sourceChangesByTask(doorPass.doors);
    const existingIds = new Set(STANDING_SOURCE_TASKS.map(task => task.id));
    const added = [...ROUTINE_SOURCE_TASKS, ...OUTCOME_PARTITION_CONTRACTS.map(routineTaskFromContract)]
      .filter(task => routineScopeState(task.scope, task.command) === STATE_SCOPE && !existingIds.has(task.id));
    (STANDING_SOURCE_TASKS as RoutineSourceTask[]).push(...added);
    for (const contract of MEETING_PARTITION_CONTRACTS) MEETING_PARTITION_TASK_IDS.add(contract.id);
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
const sourceStartedAt = new Map<string, string>();
async function acquireChildMemory(command: BoundedChildCommand): Promise<void> {
  const script = command.args.find(arg => /[.](?:mts|ts)$/.test(arg))?.split(/[\\/]/).at(-1) ?? "";
  const release = await routineMemorySlots.acquire(`${command.id}/${script}`, Math.min(Date.now() + ROUTINE_CHILD_TIMEOUT_MS, PASS_LAUNCH_DEADLINE_MS));
  childMemoryReleases.set(command.id, release);
  (command as { onStarted?: (pid: number) => void }).onStarted = pid => {
    startedSourceChildren.add(command.id);
    sourceStartedAt.set(command.id, new Date().toISOString());
    release.observe?.(pid);
  };
}
function releaseChildMemory(id: string): void {
  childMemoryReleases.get(id)?.(); childMemoryReleases.delete(id);
  startedSourceChildren.delete(id);
  sourceStartedAt.delete(id);
}

async function readObservedChangeRates(): Promise<ReadonlyMap<string, number>> {
  const connection = controlPlaneUrlFromEnv();
  if (connection === null) return new Map();
  try {
    doorOutcomeRepos ??= createPgRepositories(connection, RUN_STARTED_AT, { skipBootstrap: true });
    const doors = (await doorOutcomeRepos).doors;
    const rows = await doors.listWhere(["scopeState"], STATE_SCOPE);
    return observedChangeMinutesByDoor(rows.map((row) => row.value).filter(isDoorRecord));
  } catch (error) {
    console.warn(`RCD_DOORS: observed change rates not read — ${error instanceof Error ? error.message : String(error)}; every task stays on its policy cadence`);
    return new Map();
  }
}

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
    const at = checkedAt ?? new Date().toISOString();
    for (const doorId of await taskDoorIds(repos.doors, taskId)) {
      if (outcome === "FAILURE" && evidence !== null &&
          (await recordDoorEvidence(repos.doors, doorId, evidence, at, repos)).written) continue;
      await recordDoorOutcome(repos.doors, doorId, outcome, at, changed);
      if (outcome === "SUCCESS" && await reopenDoorIfShut(repos.doors, doorId, at, repos)) {
        console.log(`RCD_TASK ${taskId}: its door was shut and reads again; reopened`);
      }
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

async function readRoutineDueRequests(): Promise<{ readonly requests: readonly RoutineDueRequest[]; readonly issues: readonly string[] }> {
  const connection = controlPlaneUrlFromEnv();
  if (connection === null) throw new Error(`${CONTROL_PLANE_URL_VAR} is not configured`);
  const repos = await createPgRepositories(connection, RUN_STARTED_AT, { skipBootstrap: true });
  const row = await withControlPlaneConnectRetry(() => repos.adminConfig.read(ADMIN_CONFIG_ID));
  return parseRoutineDueRequests(row?.value.routineDueRequests);
}

/** Box findings carried to facts each minute; a backlog drains over the next passes. */
const BOX_FINDINGS_PER_PASS = 300;

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
    try {
      const box = await publishBoxFindings({ repos, store, state: STATE_SCOPE.replace(/^US-/, ""), facts: readerFactDb(), vault: new DurableEvidenceStore(join(ROOT, ...VAULT_DIR)),
        fetch: pacedProbeFetch({ pacing: repos.websitePacing }), clocks: factClocks((await repos.adminConfig.read(ADMIN_CONFIG_ID))?.value ?? null),
        now: new Date().toISOString(), limit: BOX_FINDINGS_PER_PASS });
      if (box.looked) console.log(`RCD_BOX_FACTS=${JSON.stringify(box)}`);
    } catch (error) {
      failures.push({ taskId: "box-facts", code: "BOX_FACT_PUBLICATION_FAILED", detail: safeFailure(sanitizedErrorDiagnostic(error)) });
    }
    const publication: RoutineSourceTask[] = [];
    for await (const items of readWorkerPublicationItems((query, params) => sql.query(query, [...params]), STATE_SCOPE, RUN_STARTED_AT, selected)) {
      const owed = await readOwedFactItems(items, ids => readCompletedWorkerResultsOf(repos, ids), RUN_STARTED_AT);
      if (owed.rosters.length || owed.comments.length) try {
        const context = await workerPublicationContext(RUN_STARTED_AT, repos);
        const facts = readerFactDb();
        for (const [label, publish, ids] of [["rosters", publishOwedRosterFacts, owed.rosters], ["comment rules", publishOwedCommentFacts, owed.comments]] as const) {
          if (!ids.length) continue;
          const report = await publish({ repos, facts, workItemIds: ids, now: RUN_STARTED_AT, readCapture: context.readCapture });
          console.log(`RCD_FACTS ${label}: ${report.filter(row => row.outcome.status !== "HELD").length} of ${report.length} published as facts`);
        }
      } catch (error) {
        failures.push({ taskId: "fact-publication", code: "FACT_PUBLICATION_FAILED", detail: safeFailure(sanitizedErrorDiagnostic(error)) });
      }
      const pointers = new PostgresRoutineDataStore();
      const heldInputs = await readHeldBallotInputs((query, params) => sql.query(query, [...params]),
        async (recordClass, scope) => (await pointers.readPromotionIdentity(recordClass, scope))?.promotedAt ?? null, items).catch((error: unknown) => {
        console.log(`RCD_HELD_INPUTS CANNOT_TELL — ${safeFailure(sanitizedErrorDiagnostic(error))}; held ballot routes are read again hourly`);
        return null;
      });
      publication.push(...await readPublishNowWorkerTasks(items, ids => readCompletedWorkerResultsOf(repos, ids), RUN_STARTED_AT, heldInputs));
    }
    return publication;
  }
  const row = await repos.adminConfig.read(ADMIN_CONFIG_ID);
  if (row === null) return [];
  if (!isAdminConfig(row.value)) throw new Error("the owner's policy row is unreadable");
  const held = expansionScopesOf(row.value);
  if (held.malformed) throw new Error("the owner's scope list contains unreadable decisions");
  const currentSends = held.scopes.filter(scope => scope.sourceWorkVersion === 1 && `US-${scope.geography.stateAbbr.toUpperCase()}` === STATE_SCOPE);
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
  readonly ballotPublication?: BallotPublicationResult;
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
  readonly crashedTasks?: readonly { readonly taskId: string; readonly detail: string }[];
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
    ...(input.ballotPublication ? { ballotPublication: input.ballotPublication } : {}),
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
    crashedTasks: input.crashedTasks,
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
      ...(input.crashedTasks ?? []).map((crash) => `${crash.taskId} ${crash.detail}; the child crashed and its work waits its retry.`),
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
const crashedTasks: { readonly taskId: string; readonly detail: string }[] = [];
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
    const outcome = await publishReaderEdge(null);
    const failure = readerEdgeSupervisorFailure(outcome);
    if (failure) supervisorFailures.push(failure);
    return outcome;
  }, onError: error => {
    supervisorFailures.push({ taskId: "reader-edge-publication", code: "READER_EDGE_PUBLISH_FAILED",
      detail: safeFailure(sanitizedErrorDiagnostic(error)) });
  },
}) : null;
function publishReaderEdge(selected: readonly Pick<RoutineSourceTask, "recordClass" | "scope">[] | null): Promise<ReaderEdgePublicationOutcome> {
  return runReaderEdgePublicationChild({ state: STATE_SCOPE, observedAt: new Date().toISOString(), selected,
    cwd: ROOT, memory: routineMemorySlots,
    precheck: () => checkReaderEdgePublicationInputs({ state: STATE_SCOPE }),
    env: admittedRuntimeChildEnvironment({ parentEnv: process.env, capability: "ROUTINE_SUPERVISOR", parentPid: process.pid }),
  });
}
if (publishNowEdgeChecks) {
  step = "publishing changed source pointers before worker admission";
  await publishNowEdgeChecks.run();
}
if (!PUBLISH_NOW && FAMILY !== "meetings") {
  step = "loading fact store entities";
  try {
    const loaded = await ensureFactEntities(readerFactDb(), ROOT, registeredStates(ROOT).filter(state => state.toUpperCase() === STATE_SCOPE.slice(3)));
    if (loaded.length) console.log(`fact store entities: loaded ${loaded.join(", ")}`);
  } catch (error) {
    supervisorFailures.push({ taskId: "fact-store-entities", code: "FACT_ENTITIES_LOAD_FAILED", detail: safeFailure(sanitizedErrorDiagnostic(error)) });
  }
  if (STATE_SCOPE === "US" && controlPlaneUrlFromEnv()) {
    step = "converting held versions that embed source pages, once";
    try {
      const conversionRepos = await createPgRepositories(controlPlaneUrlFromEnv()!, RUN_STARTED_AT, { skipBootstrap: true });
      if (!await captureConversionRecorded(conversionRepos.ownerDigests)) {
        const [run] = await runBoundedChildPass([{ id: CAPTURE_CONVERSION_LOG_KEY, failureDomain: "derived:capture-conversion",
          executable: process.execPath, args: ["--experimental-strip-types", "scripts/convert-embedded-captures.mts"],
          env: admittedRuntimeChildEnvironment({ parentEnv: process.env, capability: "CAPTURE_CONVERSION", parentPid: process.pid }),
        }], { cwd: ROOT, env: process.env, timeoutMs: ROUTINE_CHILD_TIMEOUT_MS, maxBufferBytes: ROUTINE_CHILD_MAX_BUFFER_BYTES, concurrency: 1 });
        const at = new Date().toISOString(), record = run ? captureConversionRecord(run, at, RUNNING_CODE_SHA) : null;
        if (record) {
          await conversionRepos.ownerDigests.append(CAPTURE_CONVERSION_LOG_KEY, record.digestId, record, at);
          console.log(`RCD_TASK routine-civic-data-runner: ${record.headline}`);
        } else supervisorFailures.push({ taskId: CAPTURE_CONVERSION_LOG_KEY, code: "CAPTURE_CONVERSION_UNFINISHED",
          detail: safeFailure(run?.errorMessage ?? run?.stderr.trim().split("\n").at(-1) ?? "no answer") });
      }
    } catch (error) {
      supervisorFailures.push({ taskId: CAPTURE_CONVERSION_LOG_KEY, code: "CAPTURE_CONVERSION_UNFINISHED", detail: safeFailure(sanitizedErrorDiagnostic(error)) });
    }
  }
  if (STATE_SCOPE === "US") {
  step = "carrying the rosters, office contacts and comment rules readers already see onto facts";
  try {
    const facts = readerFactDb();
    const rosters = await cartonRosters(facts.query, id => store.readCandidate(id), REGISTRY_RUNTIME_SCOPE);
    const comments = await cartonComments(facts.query, id => store.readCandidate(id));
    const offices = await cartonOffices(facts.query, () => readRegistryRuntimePrior(store, RUN_STARTED_AT));
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
}

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
const clockConnection = controlPlaneUrlFromEnv();
const clockConfig = clockConnection
  ? (await (await createPgRepositories(clockConnection, RUN_STARTED_AT, { skipBootstrap: true })).adminConfig.read(ADMIN_CONFIG_ID))?.value ?? null
  : null;
let heldFinanceCalendars: readonly SourceCalendar[] = [];
try {
  const calendarTargets = STATE_SCOPE === "US" || FAMILY === "meetings" ? [] : [...standingTasks, ...MANUAL_PRODUCTION_SOURCE_CONTRACTS.filter(contract => contract.recordClass === "BALLOT_CANDIDACY")]
    .filter(task => routineScopeState(task.scope) === STATE_SCOPE && ["FEC_FUNDING", "STATE_CAMPAIGN_FINANCE", "LOCAL_CAMPAIGN_FINANCE", "BALLOT_CANDIDACY"].includes(task.recordClass));
  heldFinanceCalendars = await readHeldFinanceCalendars(readerFactDb().query, calendarTargets, RUN_STARTED_AT);
} catch (error) {
  supervisorFailures.push({ taskId: `filing-calendars:${STATE_SCOPE}`, code: "FILING_CALENDAR_UNREAD", detail: safeFailure(sanitizedErrorDiagnostic(error)) });
}
let factNextDueAt: string | null = null;
async function refreshFacts(): Promise<void> {
if (!PUBLISH_NOW && FAMILY !== "meetings" && clockConnection) {
  try {
    const repos = await createPgRepositories(clockConnection, RUN_STARTED_AT, { skipBootstrap: true });
    const sizeFor = websiteSizeFromHoldings(STATE_SCOPE === "US" ? [] : [STATE_SCOPE.slice(3)]);
    const refreshed = await runWithSourceFetch({ state: STATE_SCOPE, sourceId: `facts:${STATE_SCOPE}`, pacing: repos.websitePacing, websiteSize: sizeFor },
      () => refreshStaleFacts({ facts: readerFactDb(), repos, vault: new DurableEvidenceStore(join(ROOT, ...VAULT_DIR)),
        state: STATE_SCOPE === "US" ? "US" : STATE_SCOPE.slice(3), clocks: factClocks(clockConfig), now: new Date().toISOString() }));
    factNextDueAt = refreshed.nextDueAt;
    if (refreshed.checked) console.log(`RCD_FACTS ${refreshed.checked} checked; ${refreshed.confirmed} confirmed; ${refreshed.blanks} need another reading`);
  } catch (error) {
    supervisorFailures.push({ taskId: `facts:${STATE_SCOPE}`, code: "FACT_REFRESH_FAILED", detail: safeFailure(sanitizedErrorDiagnostic(error)) });
  }
}
}
const selectedTasks = [...STANDING_SOURCE_TASKS, ...huntTasks.filter(task => !STANDING_SOURCE_TASKS.some(standing => standing.id === task.id))]
  .filter((task) => !ONLY || ONLY.has(task.id) || (task.registeredContractId !== undefined && ONLY.has(task.registeredContractId)))
  .filter(task => routineScopeState(task.scope, task.command) === STATE_SCOPE || task.ownerInvocation?.publicationPending === true)
  .filter(task => ONLY !== null || FAMILY === "all" || (task.contract.schedule?.kind === "SITTING_WINDOW") === (FAMILY === "meetings"))
  .filter(task => ONLY !== null || FAMILY !== "meetings" || meetingTaskBucket(task) === MEETING_BUCKET)
  .map(task => applyRoutineClockSettings(sourceChanges.has(task.id)
    ? { ...task, sourceChangedAt: sourceChanges.get(task.id)! } : task, clockConfig, admissionNowMs, heldFinanceCalendars));
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
      tasks => store.clocks(tasks.map(task => ({ sourceId: task.sourceId, recordClass: task.recordClass, scope: task.scope, parserVersion: task.parserVersion }))),
    );
const selectedIds = new Set(selectedTasks.map(task => task.id));
const siblingIds = new Set(selectedTasks.flatMap(task => sittingWindowSourceIds(task.id)).filter(id => !selectedIds.has(id)));
const siblingClockReads = FORCE ? [] : await readRoutineTaskClocks(
  MEETING_PARTITION_CONTRACTS.filter(contract => siblingIds.has(contract.id)).map(routineTaskFromContract),
  tasks => store.clocks(tasks.map(task => ({ sourceId: task.sourceId, recordClass: task.recordClass, scope: task.scope, parserVersion: task.parserVersion }))),
);
const sittingClockReads = [...clockReads, ...siblingClockReads];
const sittingSourcesByTask = new Map(sittingClockReads.map(({ task }) => [task.id, sittingWindowSourceIds(task.id)]));
const admittedSittingSourceIds = (id: string): readonly string[] => sittingSourcesByTask.get(id) ?? [];

let statedEndsByTask: ReadonlyMap<string, ReadonlyMap<string, number>> = new Map();
if (!FORCE && selectedTasks.some(task => task.recordClass === "MEETING")) {
  try {
    const byScope = statedSittingEndsByScope(await statedSittingEndsRead(getDb(), sittingClockReads.filter(read => read.task.recordClass === "MEETING").map(read => read.task.scope)));
    statedEndsByTask = new Map(sittingClockReads.flatMap(({ task }) =>
      task.recordClass === "MEETING" && byScope.has(task.scope) ? [[task.id, byScope.get(task.scope)!] as const] : []));
  } catch (error) {
    const detail = safeFailure(sanitizedErrorDiagnostic(error));
    supervisorFailures.push({ taskId: "routine-civic-data-stated-sitting-ends", code: "STATED_ENDS_READ_FAILED", detail });
    console.error(`RCD_TASK routine-civic-data-stated-sitting-ends: SUPERVISOR_FAILURE (CANNOT_TELL) — ${detail}`);
  }
}
const sittingSignals = sittingWindowSignals(sittingClockReads, admissionNowMs, statedEndsByTask, admittedSittingSourceIds);
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
if (!PUBLISH_NOW && !FORCE && controlPlaneUrlFromEnv() !== null) {
  try {
    const doorRepos = await createPgRepositories(controlPlaneUrlFromEnv()!, RUN_STARTED_AT, { skipBootstrap: true });
    const settledAt = new Date().toISOString();
    const cleared = await settleReadNow(doorRepos.doors, settledAt, STATE_SCOPE);
    const scopedDoors = (await listDoors(doorRepos.doors, STATE_SCOPE)).doors;
    const marked = readNowDueRequests(scopedDoors, new Set(MEETING_PARTITION_CONTRACTS.map((contract) => contract.id)), settledAt);
    // A door edited in Admin asks for the two derive steps now, not on their six-hour clock.
    const derive = editDeriveDueRequests(scopedDoors, new Set(DOOR_DERIVE_CONTRACT_IDS), settledAt);
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
let ballotHash: string | null = null;
let priorBallotPublication: BallotPublicationResult | null = null;
let ballotPublication: BallotPublicationResult | null = null;
if (selectedTasks.some(task => task.id === "ballot-contests")) {
  try {
    ballotHash = await ballotInputHash(resolve(ROOT, "data/ballot/2026-general"));
    const connection = controlPlaneUrlFromEnv();
    if (connection) priorBallotPublication = await readLatestBallotPublication(await createPgRepositories(connection, RUN_STARTED_AT, { skipBootstrap: true }));
  } catch (error) {
    console.error(`RCD_INPUT_CHANGED ballot-contests: ${safeFailure(sanitizedErrorDiagnostic(error))}; normal cadence retained`);
  }
}
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

const sittingReadById = new Map(sittingClockReads.map(read => [read.task.id, read]));
const hotReadClocks = new Map(sittingClockReads.flatMap((read) => read.ok ? [[read.task.id, read.clock] as const] : []));
const observedChangeRates = PUBLISH_NOW ? new Map<string, number>() : await readObservedChangeRates();
for (const read of clockReads) {
  const { task } = read;
  if (!read.ok) {
    const detail = safeFailure(read.error);
    supervisorFailures.push({ taskId: task.id, code: "DURABLE_CLOCK_READ_FAILED", detail });
    console.error(`RCD_TASK ${task.id}: SUPERVISOR_FAILURE (CANNOT_TELL) — ${detail}`);
    continue;
  }
  const durableClock = routineAdmissionClock(read.clock, supervisorAttempts.get(task.id), admissionNowMs);
  const dueRequest = FORCE ? null : routineDueRequestFor(task, durableClock, admissionNowMs, dueRequests);
  const ballotsDue = ballotPublicationDue(task.id, ballotHash, priorBallotPublication);
  if (!FORCE && !ballotsDue && dueRequest === null && unchangedRoutineProtocolFailure(task, read.clock, protocolFailures, RUNNING_CODE_SHA, admissionNowMs)) {
    console.log(`RCD_SKIP ${task.id}: unchanged receipt failure; awaiting changed code, Send or source evidence`);
    continue;
  }
  const sittingHot = sittingSignals.get(task.id);
  const observedChange = observedChangeRates.get(task.id) ?? observedChangeRates.get(`feed:${task.id}`);
  const observedEveryMs = observedChange === undefined ? undefined : observedChange * 60_000;
  const publicationDue = campaignPublicationInputsDue(task.id, campaignPublicationInputs);
  const discoveryDue = meetingDiscoveryInputsDue(task.id, durableClock, meetingDiscoveryInputs, admissionNowMs);
  if (task.ownerInvocation) {
    const due = routineTaskDue(task, durableClock, admissionNowMs);
    const succeeded = Date.parse(durableClock?.lastSucceededObservedAt ?? durableClock?.lastSucceededAt ?? "");
    const reused = !task.ownerInvocation.publicationPending && Number.isFinite(succeeded) && succeeded >= Date.parse(task.ownerInvocation.requestedAt) && succeeded <= admissionNowMs;
    publicationInputLines.push(`Send ${task.ownerInvocation.instructions.join(", ")}: shared ${task.id} ${due ? "refresh offered to the normal source frontier" : reused ? "verified shared result reused" : "failed attempt held under retry backoff"}; canonical scope ${task.scope}.`);
  }
  if (!FORCE && !routineTaskDue(task, durableClock, admissionNowMs, sittingHot, observedEveryMs) && dueRequest === null && !publicationDue && !ballotsDue && !discoveryDue) {
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

// Due bodies run by deadline; an owner request may bring its body forward.
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
      `(domain=${candidate.pending.task.acquisitionFailureDomain}; per-pass=${ROUTINE_FAILURE_DOMAIN_FRONTIER_PER_PASS})`,
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

const sourceConcurrency = ROUTINE_CHILD_CONCURRENCY;
console.log(`RCD_PASS checking ${pendingRuns.length} sources; meeting state worker=1; other source workers=${sourceConcurrency}; quiet timeout=${ROUTINE_CHILD_TIMEOUT_MS}ms`);
function sourceChildCommand(pending: PendingRun): BoundedChildCommand {
  const now = new Date().toISOString();
  const observedMinutes = observedChangeRates.get(pending.task.id) ?? observedChangeRates.get(`feed:${pending.task.id}`);
  const eligibleAt = FORCE ? Date.parse(RUN_STARTED_AT) : Math.min(
    routineTaskDueAtMs(pending.task, routineAdmissionClock(hotReadClocks.get(pending.task.id), supervisorAttempts.get(pending.task.id), Date.parse(now)),
      Date.parse(now), sittingSignals.get(pending.task.id), observedMinutes === undefined ? undefined : observedMinutes * 60_000),
    Date.parse(honouredDueRequests.get(pending.task.id)?.dueAt ?? "") || Number.POSITIVE_INFINITY,
  );
  const due = routineTaskDueAtMs(pending.task, { lastAttemptedAt: now, lastSucceededObservedAt: now, sittingStarts: [] },
    Date.parse(now), sittingSignals.get(pending.task.id));
  return {
    id: pending.id,
    // One degraded provider may occupy one lane, never the whole standing
    // pool. Distinct sources keep running and settling independently.
    failureDomain: pending.task.acquisitionFailureDomain,
    serialLane: routineSerialLane(pending.command),
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
      WTP_SOURCE_STATE: routineScopeState(pending.task.scope, pending.command),
      WTP_SOURCE_ID: pending.task.id,
      WTP_SOURCE_DUE_AT: new Date(Number.isFinite(eligibleAt) ? Math.min(Date.parse(now), eligibleAt) : admissionNowMs).toISOString(),
      ...(Number.isFinite(due) ? { WTP_SOURCE_NEXT_DUE_AT: new Date(due).toISOString() } : {}),
    },
    ...(pending.task.childTimeoutMs === undefined ? {} : { timeoutMs: pending.task.childTimeoutMs }),
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
const admittedReaderContracts = [...observableRoutineContracts(), ...MANUAL_PRODUCTION_SOURCE_CONTRACTS];
const admittedMeetingContracts = new Map(MEETING_PARTITION_CONTRACTS.map(contract => [contract.id, contract]));
for (const { id } of pendingRuns) unsettledSourceRuns.add(id);
const sourcePass = runMeetingDiscoveryChain(pendingRuns, runSourceTasks);

async function runSourceTasks(runs: readonly PendingRun[]): Promise<readonly BoundedChildResult[]> {
  const meetings = runs.filter(run => run.kind === "MEETING_PARTITION");
  const singles = runs.filter(run => run.kind === "SINGLE");
  const meetingById = new Map(meetings.map(run => [run.id, run]));
  const [meetingResults, singleResults] = await Promise.all([
    runMeetingBatchPass(meetings.map(run => {
      const environment = sourceChildCommand(run).env!;
      return { id: run.id, dueAt: environment.WTP_SOURCE_DUE_AT!, nextDueAt: environment.WTP_SOURCE_NEXT_DUE_AT ?? environment.WTP_SOURCE_DUE_AT! };
    }), {
      prefetch: async (member, signal, acquire) => {
        const partition = admittedMeetingContracts.get(member.id);
        const seed = partition ? await meetingPrefetchSeed(store, partition) : undefined;
        await prefetchSourceRequests({ sourceId: member.id, state: STATE_SCOPE, dueAt: member.dueAt, signal, acquire, seed });
      },
      onMemberStarted: async id => {
        startedSourceChildren.add(id);
        sourceStartedAt.set(id, new Date().toISOString());
        await recordHuntSourceProgress(meetingById.get(id)!.task, "COLLECTING_AND_VERIFYING", "Checking this body's current sources and saving each verified finding.");
      },
      onSettled: async (member, result) => settlePendingRun(meetingById.get(member.id)!, result),
    }),
    runBoundedChildPass(singles.map(sourceChildCommand), {
      cwd: ROOT, env: process.env, timeoutMs: ROUTINE_CHILD_TIMEOUT_MS,
      maxBufferBytes: ROUTINE_CHILD_MAX_BUFFER_BYTES, concurrency: sourceConcurrency,
      sameDomainGapMs: ROUTINE_SAME_DOMAIN_CHILD_GAP_MS,
      onStarting: async (command, index) => {
        if (Date.now() >= PASS_LAUNCH_DEADLINE_MS) throw new Error("PASS_TIME_BUDGET: this pass's time is spent");
        if (command.serialLane !== undefined && Date.now() >= Date.parse(RUN_STARTED_AT) + ROUTINE_SERIAL_LANE_LAUNCH_MS) {
          throw new Error(`PASS_TIME_BUDGET: ${command.serialLane} has had this pass's turn`);
        }
        await acquireChildMemory(command);
        await recordHuntSourceProgress(singles[index]!.task, "COLLECTING_AND_VERIFYING", "The source has a worker slot and is checking current source records.");
      },
      onSettled: async (run, index) => settlePendingRun(singles[index]!, run),
      discardOutputAfterSettlement: true,
    }),
  ]);
  return [...meetingResults, ...singleResults];
}

async function settlePendingRun(pending: PendingRun, run: BoundedChildResult): Promise<void> {
  try { await settlePendingRunResult(pending, run); }
  finally {
    if (startedSourceChildren.has(run.id)) {
      const clock = await store.clock(pending.task.sourceId, pending.task.recordClass, pending.task.scope).catch(() => undefined);
      hotReadClocks.set(pending.task.id, routineAdmissionClock(clock ?? hotReadClocks.get(pending.task.id), sourceStartedAt.get(pending.task.id), Date.now()));
      const memberReads = admittedSittingSourceIds(pending.task.id).flatMap(id => {
        const read = sittingReadById.get(id); return read ? [{ ...read, clock: hotReadClocks.get(id) }] : [];
      });
      const hot = sittingWindowSignals(memberReads, Date.now(), statedEndsByTask, admittedSittingSourceIds).get(pending.task.id);
      const due = routineTaskDueAtMs(pending.task, hotReadClocks.get(pending.task.id), Date.now(), hot);
      if (clockConnection && Number.isFinite(due)) await neon(clockConnection).query(
        "UPDATE cp_source_checks SET next_due_at = $2::timestamptz WHERE source_id = $1", [pending.task.id, new Date(due).toISOString()]
      ).catch(error => console.error(`RCD_TASK ${pending.task.id}: next source check could not be saved (${error instanceof Error ? error.name : "error"})`));
    }
    releaseChildMemory(run.id);
  }
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
  const deferral = routinePreSpawnDeferral(run, startedSourceChildren.has(run.id));
  if (deferral !== null) {
    attempted -= 1;
    // Admission already wrote this pass's QUEUED progress row, and append-only history refuses a second one.
    const detail = safeFailure(deferral);
    console.log(`RCD_DEFER ${pending.task.id}: ${detail}; no child spawned; source work remains owed`);
    return;
  }
  const crash = childCrash(run);
  if (crash !== null) {
    // Recorded in the outcome as this task's attempt, so its work waits the task's own retry clock.
    const detail = `(${pending.command[0]?.split("/").at(-1)}): ${safeFailure(crash)}`;
    crashedTasks.push({ taskId: pending.task.id, detail });
    console.error(`RCD_CHILD_CRASHED ${pending.task.id} ${detail}`);
    await recordHuntSourceProgress(pending.task, "FAILED", `The source process crashed (${crash}); this source's work stays owed.`);
    await recordTaskDoorOutcome(pending.task.id, "FAILURE");
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
  if (pending.task.id === "ballot-contests") {
    const report = parseBallotPublicationResult(output);
    if (report) ballotPublication = child.kind === "VERIFIED_SOURCE_SUCCESS"
      ? { ...report, status: "PUBLISHED", versionId: child.receipt.promotedVersion, reason: null }
      : { ...report, status: "HELD", versionId: null, reason: child.detail };
  }
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

// Only attempted members need readback during a bounded meeting turn.
const meetingTurnRuns = FAMILY === "meetings" ? await sourcePass : null;
const meetingTurnIds = new Set(meetingTurnRuns?.filter(run => run.status !== null).map(run => run.id));
const readerContracts = selectedReaderRepairContracts(admittedReaderContracts,
  !PUBLISH_NOW && ONLY === null && STATE_SCOPE === "US" && FAMILY === "all" ? null :
  meetingTurnRuns === null ? selectedTasks : selectedTasks.filter(task => meetingTurnIds.has(task.id)));
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
const hotReadTasks = FORCE || PUBLISH_NOW || FAMILY === "meetings"
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
  const childDomains = readerLaunch.filter(domain => domain.mode !== "MEETING_AGGREGATE");
  const inProcessReaders = Promise.all(readerLaunch.filter(domain => domain.mode === "MEETING_AGGREGATE").map(async domain => {
    const result = await runMeetingReaderRepairDomain({ store, domain, observedAt: readerObservedAt, attestor: readerVerifierClosureAttestor() });
    settleReaderDomain(domain, result);
    if (repairDomainRacesHotReads(domain, hotReadTaskIds) && --racingRepairs === 0) openHotReadCatchUp();
    return { ...result, stdout: "", stderr: "" };
  }));
  const childReaders = runBoundedChildPass(
    childDomains.map((domain) => ({
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
        const domain = childDomains[index]!;
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
  return { repair: Promise.all([inProcessReaders, childReaders]).then(results => results.flat()), unblocked: hotReadCatchUpOpen };
}

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
    clockReads: sittingClockReads.map(read => ({ ...read, clock: hotReadClocks.get(read.task.id) })),
    statedEnds: statedEndsByTask,
    sourceIds: admittedSittingSourceIds,
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
  recordSourceSettlementFailures(await runSourceTasks([run]));
}

const pass = await runRoutinePassWithHotReadCatchUp({
  source: Promise.all([sourcePass, refreshFacts()]).then(([runs]) => runs),
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
const finalReaderEdge: ReaderEdgePublicationOutcome = publishNowEdgeChecks ? await publishNowEdgeChecks.run()
  : FAMILY === "meetings" ? { ok: true, readerEdge: "PENDING", sequence: null,
    store: resolveReaderArtifactWriteStore()?.kind === "netlify-blobs" ? "Netlify Blobs" : resolveReaderArtifactWriteStore()?.kind === "local-file" ? "local folder" : "not configured",
    detail: "Verified source changes are waiting for this state’s independent publication lane." }
  : await publishReaderEdge(ONLY === null && STATE_SCOPE === "US" && FAMILY === "all" ? null : selectedTasks);
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
    ...(ballotPublication ? { ballotPublication } : {}),
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
    crashedTasks,
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

const wakeNow = Date.now();
const wakeSignals = sittingWindowSignals(sittingClockReads.map(read => ({ ...read, clock: hotReadClocks.get(read.task.id) })), wakeNow, statedEndsByTask, admittedSittingSourceIds);
let nextDueMs = factNextDueAt === null ? Number.POSITIVE_INFINITY : Date.parse(factNextDueAt);
let nextDeadlineMs = Number.POSITIVE_INFINITY;
for (const task of selectedTasks) {
  nextDeadlineMs = Math.min(nextDeadlineMs, routineTaskDeadlineMs(task, hotReadClocks.get(task.id), wakeSignals.get(task.id), wakeNow) ?? Number.POSITIVE_INFINITY);
  const observed = observedChangeRates.get(task.id) ?? observedChangeRates.get(`feed:${task.id}`);
  nextDueMs = Math.min(nextDueMs, routineTaskDueAtMs(task,
    routineAdmissionClock(hotReadClocks.get(task.id), supervisorAttempts.get(task.id), wakeNow), wakeNow,
    wakeSignals.get(task.id), observed === undefined ? undefined : observed * 60_000));
  const window = task.contract.schedule?.windowMs;
  if (window !== undefined) for (const start of hotReadClocks.get(task.id)?.sittingStarts ?? []) {
    const becomesHotAt = Date.parse(start) - window;
    if (becomesHotAt > wakeNow) nextDueMs = Math.min(nextDueMs, becomesHotAt);
  }
}
if (Number.isFinite(nextDeadlineMs)) console.log(`RCD_NEXT_DEADLINE=${new Date(nextDeadlineMs).toISOString()}`);
if (Number.isFinite(nextDueMs)) console.log(`RCD_NEXT_DUE=${new Date(Math.max(wakeNow, nextDueMs)).toISOString()}`);

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
