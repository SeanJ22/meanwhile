import { recordParentMemory } from "../lib/civic-data/parent-memory.ts";
import { failureRetryMs } from "../lib/civic-data/failure-backoff.ts";
import { groupCongressReads, congressMemberResults, type CongressRunGroup } from "../lib/civic-data/congress-runs.ts";
import { appendRoutineLaunchDecisions, routineLaunchDecision, type RoutineLaunchDecision } from "../lib/civic-data/launch-decisions.ts";
import { readRunnerPauseIntents, readSourceWorkStates } from "../lib/control-plane/repository/pg-store.ts";
import { FEDERAL_PEOPLE_SPLIT_LOG_KEY, federalPeopleSplitRecord, federalPeopleSplitRecorded } from "../lib/civic-data/federal-people-split.ts";
import { readMeetingDiscoveryInputs, meetingDiscoveryInputsDue, runMeetingDiscoveryChain, type MeetingDiscoveryInputs } from "../lib/civic-data/meeting-discovery-due.ts";
import { readerFactDb, readPassCursor, writePassCursor } from "../lib/facts/db.ts";
import { routineTasksWithoutClocks } from "../lib/civic-data/clock-presence.ts";
import { writeContractHandoff } from "../lib/civic-data/contract-handoff-parent.ts";
import { savePublishNowFailure } from "../lib/civic-data/publish-now-failure.ts";
import { ensureFactEntities, registeredStates } from "../lib/facts/entities.ts";
import { cartonComments, cartonOffices, cartonRosters, importCartonComments, importCartonOffices, importCartonRosters } from "../lib/facts/carton-import.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { publishBoxFindings, reviewPublishedBoxFacts } from "../lib/facts/box-publication.ts";
import { workerPublicationContext } from "../lib/civic-data/worker-publication-context.ts";
import { readHeldInputs, readHeldPointerTimes } from "../lib/civic-data/worker-held-elections.ts";

import { hostname } from "node:os";
import { resolve } from "node:path";
import { heldLegistarMemberTasks, legistarMemberClocks } from "../lib/sources/legistar/members-tasks.ts";
import { AUTOMATIC_REFRESH_TASKS, automaticRefreshContract } from "../lib/civic-data/automatic-refresh.ts";
import { STATE_BINDING_REFRESH_TASKS } from "../lib/civic-data/state-binding-refresh-contracts.ts";
import { ballotInputStamp } from "../lib/civic-data/ballot-input.ts";
import { ballotPublicationDue, ballotPublicationHasNoInput, ballotPublicationLaunchOrder, ballotPublicationSummary, parseBallotPublicationResult,
  readLatestBallotPublicationSummary, recordBallotPublication, type BallotPublicationResult,
  type BallotPublicationSummary, type BallotPublicationSummaries } from "../lib/civic-data/ballot-publication.ts";
import { parseStateBallotContractId, type BallotState } from "../lib/civic-data/state-scopes.ts";
import { neon } from "@neondatabase/serverless";
import { campaignPublicationInputsDue, readCampaignPublicationInputs, campaignPublicationTask, readCandidateProfilePublicationTasks, type CampaignPublicationInputs } from "../lib/civic-data/campaign-publication-due.ts";

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
  routineDeferral,
  routineSerialLane,
  routineSerialLanesFirst,
  ROUTINE_PASS_BUDGET_MS,
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
import { SOURCE_CHECK_AFTER_ENV } from "../lib/sources/known-release.ts";
import { editDeriveDueRequests } from "../lib/doors/edit-derive.ts";
import { meetingReadQuietMs } from "../lib/civic-data/meeting-lanes.ts";
import { listDoors } from "../lib/doors/registry.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { readRegistryRuntimePrior } from "../lib/registry/runtime-data-plane.ts";
import { REGISTRY_STATES, stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";
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
  HOT_READ_CATCH_UP_READ_BUDGET_MS,
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
import { installMeetingClockFrom } from "../lib/meetings/settings.ts";
import { installVotingRefreshFrom } from "../lib/ballot/voting-refresh.ts";
import { expansionScopesOf } from "../lib/control-plane/expansion/scopes.ts";
import { resolveScopes } from "../lib/control-plane/expansion/runner-load.ts";
import { loadPublishedScopeLookupState } from "../lib/census-geography/scope-lookup.ts";
import { readIntents } from "../lib/control-plane/scheduler/research-policy.ts";
import { admittedHuntSourceScopes, huntSourceTasks } from "../lib/civic-data/hunt-source-tasks.ts";
import { PUBLISH_NOW_CURSOR, PUBLISH_NOW_PASS_BUDGET_MS, PUBLISH_NOW_SCAN_BUDGET_MS, PUBLISH_NOW_SINGLETON_PORT, publishNowDoorTasks, publishNowHasNothingOwed, readPublicationAdmission, readPublishNowRetryIds, publishNowRetryItemIds, savePublishNowProgress, readWorkerPublicationItems } from "../lib/civic-data/publish-now.ts";
import { passDeadlineFromEnv, withPassDeadline } from "../lib/ops/independent-runtime-pass.ts";
import { groupCalendarReadsByState, stateCalendarEnvironment, stateCalendarMemberResults, type StateCalendarGroup } from "../lib/civic-data/state-calendars.ts";
import { publishOwedRosterFacts } from "../lib/civic-data/worker-roster-publication.ts";
import { publishOwedCommentFacts } from "../lib/civic-data/worker-comment-facts.ts";
import { runHourlyProbes } from "../lib/doors/hourly-check.ts";
import { refreshDuePageDoors } from "../lib/doors/page-refresh.ts";
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
  parseRoutineReaderRepairRecords,
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
import { floored } from "../lib/ops/denominator-floor.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { startWorkerToolsHost } from "../lib/control-plane/workers/process-pool.ts";
import { routineProcessSlots, type WorkerMemoryOrder } from "../lib/control-plane/workers/worker-slots.ts";
import { publishStateGeometry } from "../lib/geo/state-geometry.ts";
import { resolveReaderArtifactWriteStore } from "../lib/meetings/edge-store.ts";
import { sanitizedErrorDiagnostic } from "../lib/ops/error-diagnostic.ts";
import { childCrash, childFatalLine, installFatalLine } from "../lib/ops/fatal-line.ts";
import {
  admittedRuntimeChildEnvironment,
  assertRuntimeAuthority,
} from "../lib/civic-data/runtime-authority.ts";
import { readFromHeldCopies } from "../lib/control-plane/repository/incremental-reads.ts";
import { reconcileNationalStatePointers, retireNationalStatePointers } from "../lib/civic-data/state-pointer-retirement.ts";

readFromHeldCopies();

let step = "reading its task selection";
installFatalLine("routine-civic-data-runner", () => step);

const ROOT = process.cwd();
const TS_CHILD = ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs"] as const;

const FORCE = process.argv.includes("--force");
const PUBLISH_NOW = process.argv.includes("--publish-now");
/* The pass ends by its deadline: sources launch and run in the first two thirds of its budget, repairs until the last sixth,
   which settles and publishes what ran. Whatever did not finish stays owed to the next pass. */
const PASS_DEADLINE_MS = Math.min(passDeadlineFromEnv(), Date.now() + (PUBLISH_NOW ? PUBLISH_NOW_PASS_BUDGET_MS : ROUTINE_PASS_BUDGET_MS));
const PASS_LAUNCH_DEADLINE_MS = PASS_DEADLINE_MS - Math.floor((PASS_DEADLINE_MS - Date.now()) / 3);
const PASS_REPAIR_DEADLINE_MS = PASS_DEADLINE_MS - Math.floor((PASS_DEADLINE_MS - Date.now()) / 6);
if (PUBLISH_NOW && FORCE) throw new Error("Publish-now cannot force unrelated source work.");
const ADMITTED_CODE_SHA = assertRuntimeAuthority({ capabilities: ["ROUTINE_SUPERVISOR"] }).sha;
installNeonRequestDeadline();

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
if (controlPlaneUrlFromEnv() !== null) {
  try {
    const clockRepos = await createPgRepositories(controlPlaneUrlFromEnv()!, new Date().toISOString(), { skipBootstrap: true });
    const owner = await withControlPlaneConnectRetry(() => clockRepos.adminConfig.read(ADMIN_CONFIG_ID));
    const settingsConfig = owner !== null && isAdminConfig(owner.value) ? owner.value : null;
    installMeetingClockFrom(settingsConfig);
    installVotingRefreshFrom(settingsConfig);
  } catch (error) {
    console.warn(`RCD_TASK routine-civic-data-runner: the meeting and voting check clocks could not be read, so this pass uses the last installed values — ${safeFailure(sanitizedErrorDiagnostic(error))}`);
  }
}
const STANDING_SOURCE_TASKS: readonly RoutineSourceTask[] = PUBLISH_NOW ? [] : await withNationalPlaceTasks([

  ...ROUTINE_SOURCE_TASKS.filter((task) => task.id !== MEETING_DOORS_CONTRACT_ID),
  ...OUTCOME_PARTITION_CONTRACTS.map(routineTaskFromContract),
  ...AUTOMATIC_REFRESH_TASKS,
  ...STATE_BINDING_REFRESH_TASKS,
  ...await heldLegistarMemberTasks().catch(error => { console.warn(`RCD_TASK legistar-members: ${sanitizedErrorDiagnostic(error)}`); return []; }),
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

if (!TASK_SELECTION.ok) {
  console.error(
    `RCD_TASK routine-civic-data-runner: SUPERVISOR_FAILURE (CONFIG_REFUSED) — ` +
      `${TASK_SELECTION.code}: ${TASK_SELECTION.detail}; zero source candidates or clocks were written`,
  );
  if (PUBLISH_NOW) await savePublishNowFailure(RUN_STARTED_AT, TASK_SELECTION.code, TASK_SELECTION.detail);
  process.exitCode = 2;
}

step = "proving its runtime authority";
const RUNNING_CODE_SHA = TASK_SELECTION.ok
  ? ADMITTED_CODE_SHA
  : null;

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
    if (PUBLISH_NOW) await savePublishNowFailure(RUN_STARTED_AT, "REFUSED_CONCURRENT", error.message);
    process.exitCode = 2;
    return null;
  }
})() : null;

const routineMemorySlots = routineProcessSlots();
const childMemoryReleases = new Map<string, () => void>();
const startedSourceChildren = new Set<string>();
/** Every child this pass started: what it ran is what its edge publish carries. */
const ranThisPass = new Set<string>();
async function acquireChildMemory(command: BoundedChildCommand, ran: readonly string[] = [command.id], orderOrDeadline?: WorkerMemoryOrder | number): Promise<void> {
  const deadlineOverrideMs = typeof orderOrDeadline === "number" ? orderOrDeadline : undefined;
  const order = typeof orderOrDeadline === "number" ? undefined : orderOrDeadline;
  const script = command.args.find(arg => /[.](?:mts|ts)$/.test(arg))?.split(/[\\/]/).at(-1) ?? "";
  const deadline = deadlineOverrideMs ?? (script === "routine-civic-data-reader-repair.mts" ? PASS_REPAIR_DEADLINE_MS : PASS_LAUNCH_DEADLINE_MS);
  const release = await routineMemorySlots.acquire(`${command.id}/${script}`, Math.min(Date.now() + ROUTINE_CHILD_TIMEOUT_MS, deadline), order);
  childMemoryReleases.set(command.id, release);
  (command as { onStarted?: (pid: number) => void }).onStarted = pid => {
    startedSourceChildren.add(command.id);
    for (const id of ran) { ranThisPass.add(id); startedSourceChildren.add(id); }
    release.observe?.(pid);
  };
}
function releaseChildMemory(id: string): void {
  childMemoryReleases.get(id)?.(); childMemoryReleases.delete(id);
  startedSourceChildren.delete(id);
}

const readCacheHost = ROUTINE_DATA_PROCESS_LEASE ? await startCivicReadCacheHost() : { close: async () => {} };
if (ROUTINE_DATA_PROCESS_LEASE && controlPlaneUrlFromEnv()) {
  try {
    const doorRepos = await createPgRepositories(controlPlaneUrlFromEnv()!, RUN_STARTED_AT, { skipBootstrap: true });
    if (!PUBLISH_NOW) {
      console.log(`RCD_TASK routine-civic-data-runner: door registry — ${doorSyncLine(await syncHeldDoors(doorRepos.doors))}`);
      const [published] = await runBoundedChildPass([{
        id: MEETING_DOORS_CONTRACT_ID,
        failureDomain: "derived:meeting-doors",
        executable: process.execPath,
        args: [...TS_CHILD, "scripts/publish-meeting-doors.mts", "--promote"],
        env: admittedRuntimeChildEnvironment({ parentEnv: process.env, capability: "ROUTINE_CONTRACT", contract: MEETING_DOORS_CONTRACT_ID, parentPid: process.pid }),
      }], { cwd: ROOT, env: process.env, timeoutMs: ROUTINE_CHILD_TIMEOUT_MS, maxBufferBytes: ROUTINE_CHILD_MAX_BUFFER_BYTES, concurrency: 1,
        onStarting: command => acquireChildMemory(command), onSettled: run => releaseChildMemory(run.id) });
      console.log(`RCD_TASK routine-civic-data-runner: meeting doors ${published?.status === 0 ? "published" : `not published (${safeFailure(published?.errorMessage ?? published?.stderr.trim().split("\n").at(-1) ?? "no answer")}); children read the last good doors`}`);
    }
    await refreshDoorsForPass(doorRepos.doors);
    // Keep both this pass's initial tasks and doors discovered during its refresh attributable by partition receipt.
    for (const contract of MEETING_PARTITION_CONTRACTS) MEETING_PARTITION_TASK_IDS.add(contract.id);
  } catch (error) {
    console.warn(`RCD_TASK routine-civic-data-runner: door refresh unavailable — ${safeFailure(sanitizedErrorDiagnostic(error))}; existing source work continues`);
  }
}

// State geometry is served from the reader edge store; each pass puts there any committed file it does not hold yet.
if (ROUTINE_DATA_PROCESS_LEASE && !PUBLISH_NOW) {
  const edge = resolveReaderArtifactWriteStore();
  if (edge) {
    try {
      const geometry = await publishStateGeometry(edge, ROOT);
      console.log(`RCD_TASK routine-civic-data-runner: state geometry — ${geometry.published} file(s) published (${Math.round(geometry.bytes / 1024)} KiB), ${geometry.current} already held`);
    } catch (error) {
      console.warn(`RCD_TASK routine-civic-data-runner: state geometry not published — ${safeFailure(sanitizedErrorDiagnostic(error))}; readers copy each file from the deploy and the next pass tries again`);
    }
  }
}

const sharedBrowser = PUBLISH_NOW ? null : (await import("./scout-browse.mts")).sharedScoutBrowser();
const workerToolsHost = sharedBrowser && ROUTINE_DATA_PROCESS_LEASE && controlPlaneUrlFromEnv()
  ? await startWorkerToolsHost({ repos: await createPgRepositories(controlPlaneUrlFromEnv()!,
    RUN_STARTED_AT, { skipBootstrap: true }), browse: sharedBrowser.browse }) : null;
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
      /** Set by an owner's read-now request: its child must observe the publisher after it. */
      readonly env?: Readonly<Record<string, string>>;
    }
  | {
      readonly kind: "MEETING_PARTITION";
      readonly id: string;
      readonly command: readonly string[];
      readonly task: RoutineSourceTask;
      readonly env?: Readonly<Record<string, string>>;
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

  const supervisorOutcomes = await withControlPlaneConnectRetry(

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
  const row = await withControlPlaneConnectRetry(() => repos.adminConfig.read(ADMIN_CONFIG_ID, { routineDueRequests: { activeAt: RUN_STARTED_AT } }));
  return parseRoutineDueRequests(row?.value.routineDueRequests);
}

const BOX_FINDINGS_PER_PASS = 1000;

async function readHuntSourceTasks(store: PostgresRoutineDataStore, failures: SupervisorFailure[]): Promise<readonly RoutineSourceTask[]> {

  if (FORCE || (ONLY && !WORKER_PUBLICATION_TASK_IDS.some(id => ONLY.has(id)))) return [];
  const connection = controlPlaneUrlFromEnv();
  if (!connection) throw new Error("control-plane reporting connection is unavailable");
  const repos = await createPgRepositories(connection, RUN_STARTED_AT, { skipBootstrap: true });

  // Publishing what is already found (Box findings, saved worker results, changed doors) is free: a pause never holds it.
  if (PUBLISH_NOW || (ONLY && WORKER_PUBLICATION_TASK_IDS.some(id => ONLY.has(id)))) {
    const sql = neon(connection);
    const query = (text: string, params: readonly unknown[]) => sql.query(text, [...params]) as Promise<Record<string, unknown>[]>;
    const facts = readerFactDb();
    const selected = ONLY ? WORKER_PUBLICATION_TASK_IDS.filter(id => ONLY.has(id)) : WORKER_PUBLICATION_TASK_IDS;

    const startedAt = new Date(String((await query("SELECT now() AS at", []))[0]!.at)).toISOString();
    // Box delivery is independent of the worker outbox scan and paid planning history.
    try {
      const box = await publishBoxFindings({ repos, store, facts, vault: new DurableEvidenceStore(join(ROOT, ...VAULT_DIR)),
        fetch: pacedProbeFetch({ pacing: repos.websitePacing }), clocks: factClocks((await repos.adminConfig.read(ADMIN_CONFIG_ID))?.value ?? null),
        now: new Date().toISOString(), limit: BOX_FINDINGS_PER_PASS, audit: false,
        deadlineMs: Math.min(PASS_LAUNCH_DEADLINE_MS, Date.now() + Math.floor(PUBLISH_NOW_PASS_BUDGET_MS / 3)) });
      console.log(`RCD_BOX_FACTS=${JSON.stringify(box)}`);
      if (box.failuresByReason.BOX_PUBLICATION_EXCEPTION) failures.push({ taskId: "box-facts", code: "BOX_FACT_PUBLICATION_FAILED",
        detail: `${box.failuresByReason.BOX_PUBLICATION_EXCEPTION} finding(s) need retry: ${safeFailure(JSON.stringify(box.errorExamples))}` });
    } catch (error) {
      failures.push({ taskId: "box-facts", code: "BOX_FACT_PUBLICATION_FAILED", detail: safeFailure(sanitizedErrorDiagnostic(error)) });
    }
    recordParentMemory(PUBLISH_NOW ? "publish-now" : "routine", "before-publication-inputs");
    const cursor = PUBLISH_NOW ? await readPassCursor(facts.query, PUBLISH_NOW_CURSOR) : null;
    const since = cursor === null ? null : new Date(Date.parse(cursor) - 60_000).toISOString();
    const pointers = new PostgresRoutineDataStore();
    const shared = await readHeldPointerTimes(query, async (recordClass, scope) => (await pointers.readPromotionIdentity(recordClass, scope))?.promotedAt ?? null, REGISTRY_STATES,
      (recordClass, scopes) => pointers.readPromotionIdentities(recordClass, scopes))
      .catch((error: unknown) => { console.log(`RCD_HELD_INPUTS CANNOT_TELL — ${safeFailure(sanitizedErrorDiagnostic(error))}; held routes are read again hourly`); return null; });
    const retryIds = PUBLISH_NOW ? await readPublishNowRetryIds(facts.query, startedAt) : [];
    const { items, through } = await readWorkerPublicationItems(query, selected, since === null ? null
      : { at: since, until: startedAt, sharedInputsMoved: shared === null || [shared.nationalAt, shared.registryAt, shared.routesAt].some(at => at !== null && at > since) },
      retryIds, Date.now() + PUBLISH_NOW_SCAN_BUDGET_MS);
    if (through !== null && through < startedAt) console.log(`RCD_PUBLISH_NOW_SCAN read changes through ${through}; the next pass reads on from there`);
    const heldInputs = shared === null ? null : await readHeldInputs(query, shared, items).catch((error: unknown) => {
      console.log(`RCD_HELD_INPUTS CANNOT_TELL — ${safeFailure(sanitizedErrorDiagnostic(error))}; held routes are read again hourly`);
      return null;
    });
    const { owed, publication } = await readPublicationAdmission(items, ids => readCompletedWorkerResultsOf(repos, ids), RUN_STARTED_AT, heldInputs);
    recordParentMemory(PUBLISH_NOW ? "publish-now" : "routine", "after-publication-inputs");
    if (PUBLISH_NOW && ONLY === null) await savePublishNowProgress(facts, { startedAt, scannedThrough: through ?? startedAt, selectedItemIds: items.map(item => item.id),
      owedItemIds: publishNowRetryItemIds(items, [...owed.rosters, ...owed.comments, ...publication.flatMap(task => task.ownerInvocation?.workItemIds ?? [])], heldInputs) });
    if (owed.rosters.length || owed.comments.length) try {
      const context = await workerPublicationContext(RUN_STARTED_AT, repos);
      for (const [label, publish, ids] of [["rosters", publishOwedRosterFacts, owed.rosters], ["comment rules", publishOwedCommentFacts, owed.comments]] as const) {
        if (!ids.length) continue;
        const report = await publish({ repos, store, facts, workItemIds: ids, now: RUN_STARTED_AT, readCapture: context.readCapture });
        console.log(`RCD_FACTS ${label}: ${report.filter(row => row.outcome.status !== "HELD").length} of ${report.length} published as facts`);
      }
    } catch (error) {
      failures.push({ taskId: "fact-publication", code: "FACT_PUBLICATION_FAILED", detail: safeFailure(sanitizedErrorDiagnostic(error)) });
    }
    if (!PUBLISH_NOW) return publication;

    try {
      const listed = (await listDoors(repos.doors)).doors;
      const clockStore = new PostgresRoutineDataStore();
      const sizeFor = websiteSizeFromHoldings([...new Set(listed.flatMap((door) => stateOfPlace(door.ocdId ?? "") ?? []))]);
      const report = await runHourlyProbes(repos.doors, listed, await hotMeetingPartitions({ readClock: (task) => clockStore.clock(task.sourceId, task.recordClass, task.scope), db: getDb(), query: facts.query }, Date.now()),
        pacedProbeFetch({ pacing: repos.websitePacing, sizeFor }), new Date().toISOString(), Math.min(PASS_LAUNCH_DEADLINE_MS, Date.now() + 30_000));
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
  const intents = readIntents([...(await readRunnerPauseIntents(repos))]);
  if (intents.runnerPause.paused) return [];
  const tasks:RoutineSourceTask[]=[];
  for(const state of await readSourceWorkStates(repos)) {
  const row = await repos.adminConfig.read(ADMIN_CONFIG_ID,{expansionScopes:{where:{path:["geography","stateAbbr"],value:state.toUpperCase()}}});
  if (row === null) continue;
  if (!isAdminConfig(row.value)) throw new Error("the owner's policy row is unreadable");
  const held = expansionScopesOf(row.value);
  if (held.malformed) throw new Error("the owner's scope list contains unreadable decisions");
  const currentSends = held.scopes.filter(scope => scope.sourceWorkVersion === 1);
  if (currentSends.length === 0) continue;
  const lookup = await loadPublishedScopeLookupState(currentSends.map(send => send.geography));
  const resolved = await resolveScopes(currentSends, lookup, null);
  for (const scope of resolved.scopes) {
    if (scope.kind === "UNRESOLVED") throw new Error(`scope ${scope.decision.key}: ${scope.why}`);
  }
  const admitted = admittedHuntSourceScopes(resolved.scopes, RUN_STARTED_AT);
  tasks.push(...huntSourceTasks(admitted, RUN_STARTED_AT));
  }
  return [...new Map(tasks.map(task=>[task.id,task])).values()];
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
  readonly ballotPublications?: BallotPublicationSummaries;
  readonly campaignPublicationApprovalsByState?: Readonly<Record<string, number>>;
  readonly failures: readonly SupervisorFailure[];
  readonly attemptedTasks: number;
  readonly verifiedSourceSuccesses: number;
  readonly verifiedSourceFailures: number;
  readonly finishedAt: string;
  readonly taskReceipts: readonly RoutineCivicDataTaskReceiptReference[];

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
  const repos = await createPgRepositories(connection, input.finishedAt, { skipBootstrap: true });
  assertDurableRepositories(repos, "routine civic-data supervisor outcomes");
  const cycleId = SUPERVISOR_CYCLE_ID;
  const outcome = routineCivicDataSupervisorOutcome({
    ...(input.ballotPublications ? { ballotPublications: input.ballotPublications } : {}),
    lane: PUBLISH_NOW ? "publish-now" : "routine-civic-data",
    ...(input.campaignPublicationApprovalsByState !== undefined ? { campaignPublicationApprovalsByState: input.campaignPublicationApprovalsByState } : {}),
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

const launchDecisions: RoutineLaunchDecision[] = [];
let decisionBatch = 0;
let decisionWrites: Promise<void> = Promise.resolve();
function recordLaunchDecision(task: Pick<RoutineSourceTask, "id" | "sourceId" | "scope">, action: RoutineLaunchDecision["action"], reason: string, detail = reason): void {
  console.log(`RCD_${action} ${task.id}: ${detail}`);
  launchDecisions.push(routineLaunchDecision(task, action, reason, safeFailure(detail), new Date().toISOString()));
}
async function flushLaunchDecisions(): Promise<void> {
  const rows = launchDecisions.splice(0), batch = decisionBatch++;
  if (rows.length) decisionWrites = decisionWrites.then(async () => {
    const connection = controlPlaneUrlFromEnv();
    if (!connection) throw new Error("The source launch decisions could not reach the control plane.");
    sourceProgressRepos ??= createPgRepositories(connection, RUN_STARTED_AT, { skipBootstrap: true });
    await appendRoutineLaunchDecisions(await sourceProgressRepos, rows, SUPERVISOR_CYCLE_ID, RUNNING_CODE_SHA, batch);
  }).catch(error => {
    supervisorFailures.push({ taskId: "source-launch-decisions", code: "LAUNCH_DECISIONS_WRITE_FAILED", detail: safeFailure(sanitizedErrorDiagnostic(error)) });
  });
  await decisionWrites;
}

const laneLastEndedMs = new Map<string, number>();

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





async function runFactMaintenance(deadlineMs: number): Promise<void> {
  const facts = readerFactDb(), states = registeredStates(ROOT);
  const prior = await readPassCursor(facts.query, "routine-fact-maintenance-state");
  const state = states[(states.indexOf(prior ?? "") + 1) % states.length];
  if (!state || Date.now() >= deadlineMs) return;
  step = "loading fact store entities";
  try {
    const loaded = await ensureFactEntities(facts, ROOT, [state]);
    if (loaded.length) console.log(`fact store entities: loaded ${loaded.join(", ")}`);
  } catch (error) {
    supervisorFailures.push({ taskId: "fact-store-entities", code: "FACT_ENTITIES_LOAD_FAILED", detail: safeFailure(sanitizedErrorDiagnostic(error)) });
  }
  if (controlPlaneUrlFromEnv() && Date.now() < deadlineMs) {
    step = "splitting the held national people records into place and member records, once";
    try {
      const splitRepos = await createPgRepositories(controlPlaneUrlFromEnv()!, RUN_STARTED_AT, { skipBootstrap: true });
      if (!await federalPeopleSplitRecorded(splitRepos.ownerDigests)) {
        const [run] = await runBoundedChildPass([{ id: FEDERAL_PEOPLE_SPLIT_LOG_KEY, failureDomain: "derived:federal-people-split",
          executable: process.execPath, args: ["--experimental-strip-types", "scripts/split-federal-people.mts"],
          env: admittedRuntimeChildEnvironment({ parentEnv: process.env, capability: "FEDERAL_PEOPLE_SPLIT", parentPid: process.pid }),
        }], { cwd: ROOT, env: process.env, timeoutMs: ROUTINE_CHILD_TIMEOUT_MS, deadlineMs, maxBufferBytes: ROUTINE_CHILD_MAX_BUFFER_BYTES, concurrency: 1,
          onStarting: command => acquireChildMemory(command, [], deadlineMs), onSettled: run => releaseChildMemory(run.id) });
        const at = new Date().toISOString(), record = run ? federalPeopleSplitRecord(run, at, RUNNING_CODE_SHA) : null;
        if (record) {
          await splitRepos.ownerDigests.append(FEDERAL_PEOPLE_SPLIT_LOG_KEY, record.digestId, record, at);
          console.log(`RCD_TASK routine-civic-data-runner: ${record.headline}`);
        } else supervisorFailures.push({ taskId: FEDERAL_PEOPLE_SPLIT_LOG_KEY, code: "FEDERAL_PEOPLE_SPLIT_UNFINISHED",
          detail: safeFailure(run?.errorMessage ?? run?.stderr.trim().split("\n").at(-1) ?? "no answer") });
      }
    } catch (error) {
      supervisorFailures.push({ taskId: FEDERAL_PEOPLE_SPLIT_LOG_KEY, code: "FEDERAL_PEOPLE_SPLIT_UNFINISHED", detail: safeFailure(sanitizedErrorDiagnostic(error)) });
    }
  }
  step = "carrying the rosters, office contacts and comment rules readers already see onto facts";
  try {
    const facts = readerFactDb();
    const connection = controlPlaneUrlFromEnv();
    if (connection && Date.now() < deadlineMs) {
      const repos = await createPgRepositories(connection, RUN_STARTED_AT, { skipBootstrap: true });
      const common = { facts, clocks: factClocks((await repos.adminConfig.read(ADMIN_CONFIG_ID))?.value ?? null), repos,
        vault: new DurableEvidenceStore(join(ROOT, ...VAULT_DIR)), fetch: pacedProbeFetch({ pacing: repos.websitePacing }), now: RUN_STARTED_AT, deadlineMs };
      const report = (label: string, value: Awaited<ReturnType<typeof importCartonRosters>>) => {
        console.log(`fact store ${label}: ${value.live} facts live, ${value.confirmed} confirmed, ${value.blanks} blanks, ${value.unreadable.length} pages unreadable`);
      };
      recordParentMemory("routine", "before-registry-cartons");
      try {
        if (Date.now() < deadlineMs) {
          const rosters = await cartonRosters(facts.query, id => store.readCandidate(id), stateRegistryRuntimeScope(state));
          if (rosters) report(`${state} rosters`, await importCartonRosters({ ...rosters, ...common }));
        }
        if (Date.now() < deadlineMs) {
          const offices = await cartonOffices(facts.query, () => readRegistryRuntimePrior(store, RUN_STARTED_AT, state), state);
          if (offices) report(`${state} office contacts`, await importCartonOffices({ ...offices, ...common }));
        }
      } finally { recordParentMemory("routine", "after-registry-cartons"); }
      if (Date.now() < deadlineMs) {
        const comments = await cartonComments(facts.query, id => store.readCandidate(id));
        if (comments) report("comment rules", await importCartonComments({ ...comments, ...common }));
      }
    }
  } catch (error) {
    supervisorFailures.push({ taskId: "fact-store-import", code: "FACT_IMPORT_FAILED", detail: safeFailure(sanitizedErrorDiagnostic(error)) });
  }
  step = "re-reading pages whose facts are past their refresh date";
  try {
    const connection = controlPlaneUrlFromEnv();
    if (connection && Date.now() < deadlineMs) {
      const repos = await createPgRepositories(connection, RUN_STARTED_AT, { skipBootstrap: true });
      const doors = (await listDoors(repos.doors)).doors;
      const sizeFor = websiteSizeFromHoldings([...new Set(doors.flatMap((door) => stateOfPlace(door.ocdId ?? "") ?? []))]);
      const pages = await refreshDuePageDoors({ repos, facts: readerFactDb(), vault: new DurableEvidenceStore(join(ROOT, ...VAULT_DIR)),
        fetch: pacedProbeFetch({ pacing: repos.websitePacing, sizeFor }), doors, now: new Date().toISOString(), deadlineMs });
      if (pages.looked > 0 || pages.waiting > 0 || pages.failures.length > 0) {
        console.log(`RCD_PAGE_REFRESH looked at ${pages.looked} page(s): ${pages.confirmed} re-confirmed (${pages.restamped} fact(s) restamped), ` +
          `${pages.changed} changed, ${pages.unreadable} unreadable; ${pages.waiting} waiting on their website` +
          (pages.failures.length ? `; ${pages.failures.length} could not finish — ${safeFailure(pages.failures.join("; "))}` : ""));
      }
    }
  } catch (error) {
    console.log(`RCD_PAGE_REFRESH CANNOT_TELL — ${safeFailure(sanitizedErrorDiagnostic(error))}; pages past their refresh date are read again next pass`);
  }
  await writePassCursor(facts.query, "routine-fact-maintenance-state", state);
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
let candidateFindingTasks: readonly RoutineSourceTask[] = [];
const candidateFindingLines: string[] = [];
if (controlPlaneUrlFromEnv()) try {
  const sql = neon(controlPlaneUrlFromEnv()!);
  const waiting = await readCandidateProfilePublicationTasks((text, params) => sql.query(text, params), RUN_STARTED_AT);
  candidateFindingTasks = waiting.tasks;
  if (waiting.unscoped) {
    const detail = `${waiting.unscoped} candidate findings are waiting for their place to be identified. Their Box work remains open.`;
    candidateFindingLines.push(detail);
    console.log(`RCD_CANDIDATE_GAPS ${detail}`);
  }
} catch (error) {
  supervisorFailures.push({ taskId: "candidate-profile-findings", code: "CANDIDATE_FINDING_ADMISSION_UNREAD", detail: safeFailure(sanitizedErrorDiagnostic(error)) });
}

const selectedTasks = [...STANDING_SOURCE_TASKS, ...candidateFindingTasks, ...huntTasks.filter(task => !STANDING_SOURCE_TASKS.some(standing => standing.id === task.id))]
  .filter((task) => !ONLY || ONLY.has(task.id) || (task.registeredContractId !== undefined && ONLY.has(task.registeredContractId)));
if (PUBLISH_NOW && selectedTasks.length === 0) {
  if (publishNowHasNothingOwed(PUBLISH_NOW, selectedTasks.length, supervisorFailures.length)) {
    console.log("publish-now: nothing owed this minute");
  } else {
    step = "persisting the publication outcome";
    try {
      const cycleId = await persistSupervisorOutcome({ failures: supervisorFailures,
        attemptedTasks: 0, verifiedSourceSuccesses: 0, verifiedSourceFailures: 0,
        finishedAt: new Date().toISOString(), taskReceipts: [], dueRequestLines: [],
        readerReadback: { denominator: 0, recordedPass: 0, recordedFail: 0, currentFail: 0, noops: 0, repairFailures: 0, references: [] },
      });
      console.log("RCD_OPERATIONAL_OUTCOME=" + JSON.stringify({ kind: "ROUTINE_CIVIC_DATA_SUPERVISOR",
        state: supervisorFailures.length === 0 ? "SUCCEEDED" : "FAILED", cycleId, lane: "publish-now",
        exactTaskReceipts: 0, durable: true }));
    } catch (error) {
      const detail = safeFailure(sanitizedErrorDiagnostic(error));
      supervisorFailures.push({ taskId: "routine-civic-data-supervisor-outcome", code: "SUPERVISOR_OUTCOME_NOT_DURABLE", detail });
      await savePublishNowFailure(RUN_STARTED_AT, "SUPERVISOR_OUTCOME_NOT_DURABLE", detail);
      console.error("RCD_OPERATIONAL_OUTCOME=" + JSON.stringify({ kind: "ROUTINE_CIVIC_DATA_SUPERVISOR",
        state: "STORE_UNREACHABLE", detail, durable: false }));
    }
  }
  if (!await flushDatabaseTransfer()) console.warn("RCD_TRANSFER daily byte counter could not be saved; data results are unchanged.");
  await ROUTINE_DATA_PROCESS_LEASE.release();
  await readCacheHost.close();
  await workerToolsHost?.close();
  await sharedBrowser?.close();
  process.exit(supervisorFailures.length === 0 ? 0 : 2);
}
step = "reading the routine task clocks";
const memberClocks = !FORCE && selectedTasks.some(task => task.id.startsWith("legistar-members:"))
  ? await legistarMemberClocks(readerFactDb().query, selectedTasks.filter(task => task.id.startsWith("legistar-members:")).map(task => task.id)) : new Map();
const emptyClockIds = FORCE ? new Set<string>() : await routineTasksWithoutClocks(
  selectedTasks.filter(task => !task.id.startsWith("legistar-members:")), readerFactDb().query,
).catch(error => { console.log(`RCD_CLOCK_PRESENCE ${safeFailure(sanitizedErrorDiagnostic(error))}; full clock proofs retained`); return new Set<string>(); });
const clockReads = FORCE
  ? selectedTasks.map((task) => ({ task, ok: true as const, clock: undefined, error: null }))
  : await readRoutineTaskClocks(
      selectedTasks,
      (task) => task.id.startsWith("legistar-members:") ? Promise.resolve(memberClocks.get(task.id))
        : emptyClockIds.has(task.id) ? Promise.resolve(undefined) : store.clock(task.sourceId, task.recordClass, task.scope, task.parserVersion),
    );

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

if (!FORCE && controlPlaneUrlFromEnv() !== null) {
  try {
    const doorRepos = await createPgRepositories(controlPlaneUrlFromEnv()!, RUN_STARTED_AT, { skipBootstrap: true });
    const settledAt = new Date().toISOString();
    const cleared = await settleReadNow(doorRepos.doors, settledAt);
    const marked = readNowDueRequests((await listDoors(doorRepos.doors)).doors, new Set([...MEETING_PARTITION_CONTRACTS.map((contract) => contract.id), ...STANDING_SOURCE_TASKS.map((task) => task.id)]), settledAt);

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

const campaignPublicationInputs = new Map<string, CampaignPublicationInputs>();
const publicationInputLines: string[] = [...candidateFindingLines];
const ballotStamps = new Map<BallotState, string>();
const priorBallotPublications = new Map<BallotState, BallotPublicationSummary>();
const ballotPublications = new Map<BallotState, BallotPublicationSummary>();
let ballotPublicationRepos: Awaited<ReturnType<typeof createPgRepositories>> | null = null;
async function recordBallotReport(report: BallotPublicationResult): Promise<void> {
  ballotPublications.set(report.state, ballotPublicationSummary(report));
  try {
    if (!ballotPublicationRepos) {
      const connection = controlPlaneUrlFromEnv();
      if (!connection) throw new Error("Ballot publication history has no reporting connection.");
      ballotPublicationRepos = await createPgRepositories(connection, RUN_STARTED_AT, { skipBootstrap: true });
    }
    await withControlPlaneConnectRetry(() => recordBallotPublication(ballotPublicationRepos!, report,
      { cycleId: SUPERVISOR_CYCLE_ID, testedSha: RUNNING_CODE_SHA }));
  } catch (error) {
    const detail = safeFailure(sanitizedErrorDiagnostic(error));
    supervisorFailures.push({ taskId: `ballot-contests:${report.state}`, code: "BALLOT_PUBLICATION_HISTORY_UNWRITTEN", detail });
    console.error(`RCD_BALLOT_REPORT ${report.state}: ${detail}; state publication history remains owed`);
  }
}
const ballotStates = new Set(selectedTasks.flatMap(task => {
  const contract = parseStateBallotContractId(task.id);
  return contract?.family === "ballot-contests" ? [contract.state] : [];
}));
if (ballotStates.size) {
  const connection = controlPlaneUrlFromEnv();
  ballotPublicationRepos = connection ? await createPgRepositories(connection, RUN_STARTED_AT, { skipBootstrap: true }).catch(error => {
    console.error(`RCD_INPUT_CHANGED ballot-contests: ${safeFailure(sanitizedErrorDiagnostic(error))}; publication history unavailable`);
    return null;
  }) : null;
  for (const state of ballotStates) try {
    ballotStamps.set(state, await ballotInputStamp(resolve(ROOT, "data/ballot/2026-general"), state));
    const prior = ballotPublicationRepos ? await readLatestBallotPublicationSummary(ballotPublicationRepos, state) : null;
    if (prior) priorBallotPublications.set(state, prior);
  } catch (error) {
    console.error(`RCD_INPUT_CHANGED ballot-contests:${state}: ${safeFailure(sanitizedErrorDiagnostic(error))}; normal cadence retained`);
  }
}
for (const task of selectedTasks) {
  const target = parseStateBallotContractId(task.id);
  if (FORCE || target?.family !== "candidate-campaign-sites-derived") continue;
  try {
    const connection = controlPlaneUrlFromEnv();
    if (!connection) throw new Error("control-plane reporting connection is unavailable");
    const sql = neon(connection);
    campaignPublicationInputs.set(task.id, await readCampaignPublicationInputs(target.state, (query, params) => sql.query(query, params), RUNNING_CODE_SHA));
  } catch (error) {
    const detail = safeFailure(sanitizedErrorDiagnostic(error));
    supervisorFailures.push({ taskId: task.id, code: "PUBLICATION_INPUT_CLOCK_UNREAD", detail });
    console.error(`RCD_INPUT_CHANGED ${task.id}: ${detail}; normal cadence retained`);
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
  const dueRequest = FORCE ? null : routineDueRequestFor(task, durableClock, admissionNowMs, dueRequests);
  const ballotState = parseStateBallotContractId(task.id);
  const ballotsDue = ballotState?.family === "ballot-contests" && ballotPublicationDue(task.id,
    ballotStamps.get(ballotState.state) ?? null, priorBallotPublications.get(ballotState.state) ?? null, read.clock);
  if (!FORCE && !ballotsDue && dueRequest === null && unchangedRoutineProtocolFailure(task, read.clock, protocolFailures, RUNNING_CODE_SHA, admissionNowMs)) {
    recordLaunchDecision(task, "SKIP", "Waiting for a changed source or repair", "unchanged receipt failure; awaiting changed code, Send or source evidence");
    continue;
  }
  const sittingHot = sittingSignals.get(task.id);
  const observedChange = observedChangeRates.get(task.id) ?? observedChangeRates.get(`feed:${task.id}`);
  const observedEveryMs = observedChange === undefined ? undefined : observedChange * 60_000;
  const publicationDue = campaignPublicationInputsDue(task.id, campaignPublicationInputs.get(task.id) ?? null);
  const discoveryDue = meetingDiscoveryInputsDue(task.id, durableClock, meetingDiscoveryInputs, admissionNowMs);
  if (task.ownerInvocation) {
    const due = routineTaskDue(task, durableClock, admissionNowMs);
    const succeeded = Date.parse(durableClock?.lastSucceededObservedAt ?? durableClock?.lastSucceededAt ?? "");
    const reused = !task.ownerInvocation.publicationPending && Number.isFinite(succeeded) && succeeded >= Date.parse(task.ownerInvocation.requestedAt) && succeeded <= admissionNowMs;
    publicationInputLines.push(`Send ${task.ownerInvocation.instructions.join(", ")}: shared ${task.id} ${due ? "refresh offered to the normal source frontier" : reused ? "verified shared result reused" : "failed attempt held under retry backoff"}; canonical scope ${task.scope}.`);
  }
  const cadenceDue = routineTaskDue(task, durableClock, admissionNowMs, sittingHot, observedEveryMs);
  const taskDue = ballotState?.family === "ballot-contests"
    ? ballotsDue || (!ballotStamps.has(ballotState.state) || priorBallotPublications.get(ballotState.state)?.status === "HELD") && cadenceDue
    : cadenceDue;
  if (!FORCE && !taskDue && dueRequest === null && !publicationDue && !discoveryDue) {
    const retryMs = failureRetryMs(task.retryMs, durableClock);
    const backoff = retryMs > task.retryMs ? `Repeated source failure; ${retryMs >= 3_600_000 ? `${retryMs / 3_600_000} hours` : `${retryMs / 60_000} minutes`} between tries` : null;
    recordLaunchDecision(task, "SKIP", ballotState?.family === "ballot-contests" ? "State file unchanged" : backoff ?? "Next check is not due",
      `Next source check is not due${sittingSignals.has(task.id) ? `; meeting schedule ${sittingHot === false ? "twice daily" : "hourly"}` : ""}. Last attempted ${durableClock?.lastAttemptedAt ?? "never"}; retry ${retryMs}ms.`);
    continue;
  }
  if (publicationDue) {
    const detail = `${task.id}: ${campaignPublicationInputs.get(task.id)!.approvals - campaignPublicationInputs.get(task.id)!.attemptedApprovals} committed approval(s) not attempted by this code; offered to the normal publication frontier without waiting for hourly cadence.`;
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
    // An owner's read-now request must reach the publisher, not a copy cached before it.
    ...(dueRequest !== null ? { env: { [SOURCE_CHECK_AFTER_ENV]: dueRequest.requestedAt } } : {}),
    },
  });
}

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
  recordLaunchDecision(candidate.pending.task, "DEFER", "Another task from this source has this pass's turn",
    `provider frontier (domain=${candidate.pending.task.acquisitionFailureDomain}; per-pass=${ROUTINE_FAILURE_DOMAIN_FRONTIER_PER_PASS}, meeting lanes ${SITTING_WINDOW_LANE_SLOTS_PER_PASS})`);
}

await flushLaunchDecisions();
const pendingByTaskId = new Map(dueCandidates.map(({ pending }) => [pending.id, pending] as const));
for (const { task } of routinePassLaunchOrder(routineSerialLanesFirst(ballotPublicationLaunchOrder(placeSourceLaunchOrder(admitted))), admissionNowMs)) pendingRuns.push(pendingByTaskId.get(task.id)!);
for (const pending of pendingRuns) await recordHuntSourceProgress(pending.task, "QUEUED", "Admitted to the existing source worker pool. Deterministic code; no model tokens. Verification and reader publication are still owed.");
const dueRequestLines = [...honouredDueRequests].map(([taskId, request]) => admittedIds.has(taskId)
  ? `Owner due request ${request.id}: ${taskId} admitted by this ordinary pass (due ${request.dueAt}).`
  : `Owner due request ${request.id}: ${taskId} was due but deferred by the provider frontier; the next pass offers it again.`).concat(publicationInputLines);
attempted = pendingRuns.length;

function sourceChildCommand(pending: PendingRun): BoundedChildCommand {
  return {
    id: pending.id,

    failureDomain: pending.task.acquisitionFailureDomain,
    serialLane: routineSerialLane(pending.command),
    executable: process.execPath,
    args: [...TS_CHILD, ...pending.command],
    env: {

      ...(pending.task.registeredContractId !== undefined || automaticRefreshContract(pending.task.id) ? admittedRuntimeChildEnvironment({
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
      ...pending.env,
    },

    ...(pending.task.childTimeoutMs === undefined ? {} : { timeoutMs: pending.task.childTimeoutMs }),
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

/** Due reads the pass did not finish starting (memory or pass time): the digest names them, so a stalled lane is visible. */
const notStarted: string[] = [];
step = "running the source pass";
for (const { id } of pendingRuns) unsettledSourceRuns.add(id);

/** One child per state reads all of that state's due boards; every other task keeps its own child. */
type SourceUnit = PendingRun | StateCalendarGroup<PendingRun> | CongressRunGroup<PendingRun>;
const sourceHandoffs = new Map<string, ReturnType<typeof writeContractHandoff>>();
function sourceUnitCommand(unit: SourceUnit): BoundedChildCommand {
  if (unit.kind === "CONGRESS_DIRECTORY") {
    const handoff = writeContractHandoff(unit.members.map(member => member.id));
    sourceHandoffs.set(unit.id, handoff);
    return { id: unit.id, failureDomain: "routine-source:congress-directory-project", executable: process.execPath,
      args: [...TS_CHILD, "scripts/fetch-congress-legislators.mts", "--promote", ...handoff.args],
      env: withPassDeadline({ ...admittedRuntimeChildEnvironment({ parentEnv: process.env, capability: "MANUAL_CONTRACT", contract: unit.id, parentPid: process.pid }),
        ...stateCalendarEnvironment(unit.members) }, PASS_LAUNCH_DEADLINE_MS) };
  }
  if (unit.kind !== "STATE_CALENDARS") return sourceChildCommand(unit);
  const handoff = writeContractHandoff(unit.members.map(member => member.id));
  sourceHandoffs.set(unit.id, handoff);
  return {
    id: unit.id,
    failureDomain: unit.id,
    executable: process.execPath,
    args: [...TS_CHILD, ...unit.command.filter(arg => !arg.startsWith("--only-partition=")), ...handoff.args],
    env: withPassDeadline({ ...admittedRuntimeChildEnvironment({ parentEnv: process.env, capability: "STATE_CALENDARS", contract: unit.id, parentPid: process.pid }),
      ...stateCalendarEnvironment(unit.members) },
      PASS_LAUNCH_DEADLINE_MS),
    ...(meetingReadQuietMs() !== undefined ? { timeoutMs: meetingReadQuietMs()! } : {}),
  };
}
function unitMembers(unit: SourceUnit): readonly PendingRun[] {
  return unit.kind === "STATE_CALENDARS" || unit.kind === "CONGRESS_DIRECTORY" ? unit.members : [unit];
}

const sourcePass = runMeetingDiscoveryChain(pendingRuns, runs => {
  const units = groupCongressReads(groupCalendarReadsByState(runs, routineFailureDomainRotationSeed(RUN_STARTED_AT)));
  return runBoundedChildPass(
  units.map(sourceUnitCommand),
  {
    cwd: ROOT,
    env: process.env,
    timeoutMs: ROUTINE_CHILD_TIMEOUT_MS,
    deadlineMs: PASS_LAUNCH_DEADLINE_MS,
    maxBufferBytes: ROUTINE_CHILD_MAX_BUFFER_BYTES,
    concurrency: Math.max(1, units.length),

    sameDomainGapMs: ROUTINE_SAME_DOMAIN_CHILD_GAP_MS,
    onStarting: async (command, index) => {
      if (Date.now() >= PASS_LAUNCH_DEADLINE_MS) throw new Error("PASS_TIME_BUDGET: this pass's time is spent, so release handoff can run before the next one");
      // Memory goes in launch order; the next read of a serial lane is not overtaken by work queued behind it.
      await acquireChildMemory(command, unitMembers(units[index]!).map((member) => member.id), { priority: index, hold: command.serialLane !== undefined });
      for (const member of unitMembers(units[index]!)) {
        await recordHuntSourceProgress(member.task, "COLLECTING_AND_VERIFYING", "The source command has a worker slot. Collecting current source records and running the existing identity, content, freshness and reader checks. No model call is used.");
      }
    },
    onSettled: async (run, index) => {
      const unit = units[index]!;
      if (unit.kind === "CONGRESS_DIRECTORY") {
        try {
          for (const result of congressMemberResults(run, unit.members.map(member => member.id), startedSourceChildren.has(run.id))) {
            const member = unit.members.find(member => member.id === result.id)!;
            if (result.run) await settlePendingRunResult(member, result.run);
            else {
              unsettledSourceRuns.delete(member.id); attempted--;
              recordLaunchDecision(member.task, "DEFER", "National Congress publication remains due", result.owed!);
              notStarted.push(member.id);
            }
          }
        } finally {
          for (const member of unit.members) startedSourceChildren.delete(member.id);
          releaseChildMemory(run.id); sourceHandoffs.get(unit.id)?.cleanup(); sourceHandoffs.delete(unit.id);
        }
      } else if (unit.kind === "STATE_CALENDARS") await settleStateCalendars(unit, run);
      else await settlePendingRun(unit, run);
      await flushLaunchDecisions();
    },

    discardOutputAfterSettlement: true,
  },
  );
});

/** Each board of a state's program settles exactly as it would have alone; boards the program never reached stay owed. */
async function settleStateCalendars(group: StateCalendarGroup<PendingRun>, run: BoundedChildResult): Promise<void> {
  try {
    const started = startedSourceChildren.has(run.id);
    const results = stateCalendarMemberResults(run, group.members.map((member) => member.id), started);
    console.log(`RCD_TASK ${group.id}: ${group.members.length} board(s) given to the state's calendar program; ` +
      `${results.filter((result) => "run" in result).length} read, ${results.filter((result) => "owed" in result).length} still owed`);
    for (const [index, result] of results.entries()) {
      const member = group.members[index]!;
      if ("run" in result) { await settlePendingRunResult(member, result.run); continue; }
      laneLastEndedMs.set(member.task.acquisitionFailureDomain, Date.now());
      unsettledSourceRuns.delete(member.id);
      attempted -= 1;
      recordLaunchDecision(member.task, "DEFER", "State calendar read remains due", `${safeFailure(result.owed)}; source work remains owed`);
      notStarted.push(member.id);
    }
  } finally {
    for (const member of group.members) startedSourceChildren.delete(member.id);
    releaseChildMemory(run.id);
    sourceHandoffs.get(group.id)?.cleanup(); sourceHandoffs.delete(group.id);
  }
}

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
  const singleMeeting = pending.kind === "MEETING_PARTITION" && run.status === 0 && run.termination === "EXITED"
    ? stateCalendarMemberResults(run, [pending.id], true)[0] : null;
  const deferral = routineDeferral(run, startedSourceChildren.has(run.id)) ??
    (singleMeeting && "owed" in singleMeeting ? singleMeeting.owed : null);
  if (deferral !== null) {
    attempted -= 1;

    const detail = safeFailure(deferral);
    recordLaunchDecision(pending.task, "DEFER", /MEMORY/.test(detail) ? "Waiting for a worker slot" : "Next pass will continue the source read", `${detail}; source work remains owed`);
    notStarted.push(pending.task.id);
    return;
  }
  const crash = childCrash(run);
  if (crash !== null) {

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

  const ballotTask = parseStateBallotContractId(pending.task.id);
  const ballotReport = ballotTask?.family === "ballot-contests" ? parseBallotPublicationResult(output) : null;
  if (ballotReport && ballotReport.state === ballotTask?.state && ballotPublicationHasNoInput(ballotReport) &&
    run.termination === "EXITED" && run.status === 2 && !output.split(/\r?\n/).some(line => line.startsWith("RCD_RECEIPT=")) &&
    await store.readPromotionIdentity(pending.task.recordClass, pending.task.scope) === null) {
    await recordBallotReport(ballotReport);
    attempted -= 1;
    recordLaunchDecision(pending.task, "DEFER", "Waiting for the state ballot file", "No state ballot input is held; publication remains owed");
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
  if (ballotTask?.family === "ballot-contests") {
    const report = ballotReport;
    if (report?.state === ballotTask.state) {
      const settled: BallotPublicationResult = child.kind === "VERIFIED_SOURCE_SUCCESS"
        ? { ...report, status: "PUBLISHED", versionId: child.receipt.promotedVersion, reason: null }
        : { ...report, status: "HELD", versionId: null, reason: child.detail };
      await recordBallotReport(settled);
    }
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
      () => pending.task.id.startsWith("legistar-members:")
        ? Promise.resolve({ lastSucceededObservedAt: child.receipt.confirmedAt })
        : store.clock(pending.task.sourceId, pending.task.recordClass, pending.task.scope));
    verifiedSourceSuccesses += 1;
    captureTaskReceipt(pending, child.receipt, "VERIFIED_SOURCE_SUCCESS");
    console.log("RCD_RECEIPT=" + JSON.stringify(child.receipt));
    const delivered = (child.receipt as { delivered?: { records: number; gaps: number; gapReasons: Record<string, number> } }).delivered;

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
  const deferral = routineDeferral(run, run.termination !== "SPAWN_FAILED");
  if (deferral !== null) {
    const output = `${run.stdout}\n${run.stderr}`;
    const completed = new Set(parseRoutineReaderRepairRecords(output, domain.contracts).records.map(record => record.contractId));
    const reconciled = reconcileRoutineReaderRepairDomain({ ...domain,
      contracts: domain.contracts.filter(contract => completed.has(contract.id)) }, output, null);
    readerReadbackReferences.push(...reconciled.references, ...domain.contracts
      .filter(contract => !completed.has(contract.id))
      .map(contract => ({ contractId: contract.id, sourceId: contract.sourceId, recordClass: contract.recordClass,
        scope: contract.scope, projectionId: contract.readerProjection!.id, disposition: "BACKOFF" as const, receipt: null })));
    supervisorFailures.push(...reconciled.failures);
    for (const contract of domain.contracts) recordLaunchDecision({ id: contract.id, sourceId: contract.sourceId, scope: contract.scope }, "DEFER", "Reader repair waits for the next pass", `${safeFailure(deferral)}; the reader repair remains owed`);
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

const hotReadTasks = FORCE || PUBLISH_NOW
  ? []
  : clockReads.flatMap((read) => read.ok && read.task.contract.schedule?.kind === "SITTING_WINDOW" ? [read.task] : []);
const hotReadTaskIds = new Set(hotReadTasks.map(({ id }) => id));
const readerLaunch = [
  ...readerDomains.filter((domain) => repairDomainRacesHotReads(domain, hotReadTaskIds)),
  ...readerDomains.filter((domain) => !repairDomainRacesHotReads(domain, hotReadTaskIds)),
];
const repairingContractIds = new Set<string>();

function startReaderRepair(
  sourceRuns: readonly BoundedChildResult[],
): { readonly repair: Promise<readonly BoundedChildResult[]>; readonly unblocked: Promise<void> } {
  recordSourceSettlementFailures(sourceRuns);
  step = "running the Reader readbacks";
  const readerObservedAt = new Date().toISOString();
  for (const domain of readerLaunch.filter(domain => repairDomainRacesHotReads(domain, hotReadTaskIds))) {
    for (const contract of domain.contracts) repairingContractIds.add(contract.id);
  }
  const handoffs = new Map<string, ReturnType<typeof writeContractHandoff>>();
  const readerPass = runBoundedChildPass(
    readerLaunch.map((domain) => {
      const handoff = domain.mode === "MEETING_AGGREGATE" ? writeContractHandoff(domain.contracts) : null;
      if (handoff) handoffs.set(domain.id, handoff);
      return {
      id: domain.id,
      executable: process.execPath,
      args: [
        ...TS_CHILD,
        "scripts/routine-civic-data-reader-repair.mts",
        domain.mode === "MEETING_AGGREGATE" ? "--meeting-aggregate" : `--contract=${domain.contracts[0]!.id}`,
        ...(handoff?.args ?? []),
        `--observed-at=${readerObservedAt}`,
      ],
      timeoutMs: domain.timeoutMs,
      env: admittedRuntimeChildEnvironment({
        parentEnv: process.env,
        capability: "ROUTINE_SUPERVISOR",
        parentPid: process.pid,
      }),
    }; }),
    {
      cwd: ROOT,
      env: process.env,
      timeoutMs: ROUTINE_READER_SINGLE_TIMEOUT_MS,
      deadlineMs: PASS_REPAIR_DEADLINE_MS,
      maxBufferBytes: ROUTINE_CHILD_MAX_BUFFER_BYTES,
      concurrency: ROUTINE_READER_CHILD_CONCURRENCY,
      onStarting: async (command) => {
        if (Date.now() >= PASS_REPAIR_DEADLINE_MS) throw new Error("PASS_TIME_BUDGET: this pass's time is spent; the next pass repairs this reader");
        await acquireChildMemory(command);
      },
      onSettled: (run, index) => {
        const domain = readerLaunch[index]!;
        try {
          settleReaderDomain(domain, run);
        } finally {
          releaseChildMemory(run.id);
          handoffs.get(domain.id)?.cleanup(); handoffs.delete(domain.id);
          for (const contract of domain.contracts) repairingContractIds.delete(contract.id);
        }
      },
      discardOutputAfterSettlement: true,
    },
  ).finally(() => {
    for (const handoff of handoffs.values()) handoff.cleanup();
    repairingContractIds.clear();
  });
  return { repair: readerPass, unblocked: Promise.resolve() };
}

const hotReadClocks = new Map(clockReads.flatMap((read) => read.ok ? [[read.task.id, read.clock] as const] : []));
const launchedTaskIds = new Set(pendingRuns.map(({ id }) => id));
const hotReadLimitsMs = {
  SOURCE: Math.min(PASS_LAUNCH_DEADLINE_MS, routinePassSourceCatchUpDeadlineMs(Date.parse(RUN_STARTED_AT), readerDomains)),
  REPAIR: Math.min(PASS_REPAIR_DEADLINE_MS, routinePassWorkDeadlineMs(Date.parse(RUN_STARTED_AT), readerDomains)),
} as const;
const hotReadsPastLimit = new Set<string>();

function admitHotReads(phase: "SOURCE" | "REPAIR", nowMs: number, slots: number, runningLanes: ReadonlySet<string>) {
  const plan = hotReadCatchUpAdmission({
    nowMs,
    candidates: hotReadTasks
      .filter(({ id }) => !launchedTaskIds.has(id) && !repairingContractIds.has(id))
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
    recordLaunchDecision(task, "DEFER", "Too little time remains to finish this read", "The next pass will read this source; this read could outlast the pass limit");
  }
  return plan;
}

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
  const readDeadlineMs = Math.min(hotReadLimitsMs.REPAIR, atMs + HOT_READ_CATCH_UP_READ_BUDGET_MS);
  const command = sourceChildCommand(run);
  recordSourceSettlementFailures(await runBoundedChildPass([{
    ...command,
    env: withPassDeadline(command.env ?? process.env, readDeadlineMs),
  }], {
    cwd: ROOT,
    env: process.env,
    timeoutMs: ROUTINE_CHILD_TIMEOUT_MS,
    deadlineMs: readDeadlineMs,
    maxBufferBytes: ROUTINE_CHILD_MAX_BUFFER_BYTES,
    concurrency: 1,
    onStarting: command => acquireChildMemory(command, [run.id], readDeadlineMs),
    onSettled: async (result) => settlePendingRun(run, result),
    discardOutputAfterSettlement: true,
  }));
}

const factMaintenance = !PUBLISH_NOW && ONLY === null
  ? runFactMaintenance(Math.min(PASS_REPAIR_DEADLINE_MS, Date.now() + 60_000)).catch(error => {
    supervisorFailures.push({ taskId: "fact-maintenance", code: "FACT_MAINTENANCE_FAILED", detail: safeFailure(sanitizedErrorDiagnostic(error)) });
  }) : Promise.resolve();
const pass = await runRoutinePassWithHotReadCatchUp({
  source: sourcePass,
  startRepair: startReaderRepair,
  now: () => Date.now(),

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
await factMaintenance;
const readerRuns = pass.repair;
await flushLaunchDecisions();
if (!PUBLISH_NOW && ONLY === null && Date.now() < PASS_DEADLINE_MS - 30_000) {
  try { await reviewPublishedBoxFacts(readerFactDb().query); }
  catch (error) { supervisorFailures.push({ taskId: "box-fact-audit", code: "BOX_AUDIT_FAILED", detail: safeFailure(sanitizedErrorDiagnostic(error)) }); }
}
if (!PUBLISH_NOW && ONLY === null && Date.now() < PASS_DEADLINE_MS - 30_000) {
  try {
    const deadlineMs = PASS_DEADLINE_MS - 30_000, sql = neon(process.env.DATABASE_URL!);
    const query = (text: string, params: readonly unknown[]) => sql.query(text, [...params], { fetchOptions: {
      signal: AbortSignal.timeout(Math.max(1, Math.min(5_000, deadlineMs - Date.now()))),
    } });
    const origins = await reconcileNationalStatePointers({ query, env: process.env, deadlineMs,
      onDeferred: (id, scope, detail) => recordLaunchDecision({ id, sourceId: "state-pointer-retirement", scope }, "DEFER", detail.split(":")[0], detail) });
    const retired = await retireNationalStatePointers(query, origins);
    if (retired) console.log(`RCD_STATE_BUCKETS retired=${retired}`);
  } catch (error) {
    supervisorFailures.push({ taskId: "state-pointer-retirement", code: "STATE_POINTER_RETIREMENT_FAILED", detail: safeFailure(sanitizedErrorDiagnostic(error)) });
  }
  await flushLaunchDecisions();
}
for (const run of readerRuns) {
  if (run.settlementErrorMessage === null) continue;
  const detail = safeFailure(run.settlementErrorMessage ?? "unknown Reader settlement failure");
  supervisorFailures.push({ taskId: run.id, code: "READER_REPAIR_SETTLEMENT_FAILED", detail });
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
    ...(ballotPublications.size ? { ballotPublications: Object.fromEntries(ballotPublications) } : {}),
    campaignPublicationApprovalsByState: Object.fromEntries([...campaignPublicationInputs.values()].filter(input =>
      verifiedTaskReceipts.some(row => row.taskId === campaignPublicationTask(input.state))).map(input => [input.state, input.approvals])),
    failures: supervisorFailures,
    attemptedTasks: attempted,
    verifiedSourceSuccesses,
    verifiedSourceFailures,
    finishedAt: new Date().toISOString(),
    taskReceipts: [...verifiedTaskReceipts].sort((left, right) => left.taskId.localeCompare(right.taskId)),
    dueRequestLines: notStarted.length ? [...dueRequestLines, `${notStarted.length} due source read(s) did not start this pass (host memory or pass time) and stay owed: ${notStarted.slice(0, 25).join(", ")}${notStarted.length > 25 ? ", …" : ""}.`] : dueRequestLines,
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
    exactTaskReceipts: verifiedTaskReceipts.length,
    durable: true,
  }));
} catch (error) {
  supervisorFailures.push({
    taskId: "routine-civic-data-supervisor-outcome",
    code: "SUPERVISOR_OUTCOME_NOT_DURABLE",
    detail: safeFailure(sanitizedErrorDiagnostic(error)),
  });
  if (PUBLISH_NOW) await savePublishNowFailure(RUN_STARTED_AT, "SUPERVISOR_OUTCOME_NOT_DURABLE", safeFailure(sanitizedErrorDiagnostic(error)));
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

if (supervisorFailures.length > 0) process.exitCode = 2;
step = "saving the daily database byte counter";
if (!await flushDatabaseTransfer()) console.warn("RCD_TRANSFER daily byte counter could not be saved; data results are unchanged.");
step = "releasing the host-local singleton";
await ROUTINE_DATA_PROCESS_LEASE.release();
}
await readCacheHost.close();
await workerToolsHost?.close();
await sharedBrowser?.close();
