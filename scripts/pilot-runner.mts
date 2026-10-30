import { LEGISTAR_MEMBER_DATABASE_BYTES } from "../lib/sources/legistar/members-queue.ts";
import { keysRunnerPass, savedKeysLane } from "../lib/core/keys-runner.ts";
import { readPlanningContinuation } from "../lib/control-plane/scheduler/state-planning.ts";
import { CENSUS_LANE_BUDGET_MS, CENSUS_LANE_INTERVAL_MS } from "../lib/control-plane/discovery/census-lane.ts";

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { reserveRoutineRefresh, finishRoutineRefresh } from "../lib/civic-data/owner-refresh.ts";
import { join } from "node:path";
import { assertProductionDatabaseTarget } from "./pilot-runtime-config.mjs";

import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { headSha } from "../lib/ops/git-facts.ts";
import { readCodeIdentity } from "../lib/control-plane/code-identity.ts";
import { CONTROL_PLANE_URL_VAR, controlPlaneUrlFromEnv, createPgRepositories, readRunnerPauseIntents } from "../lib/control-plane/repository/pg-store.ts";
import { JobRunBook } from "../lib/control-plane/job-runs.ts";
import { runResearchLoop } from "../lib/control-plane/scheduler/research-loop.ts";
import { formatEastern } from "../lib/control-plane/eastern-time.ts";
import {
  assertDurableRepositories,
  type ControlPlaneRepositories,
} from "../lib/control-plane/repository/types.ts";
import { DIGEST_LOG_KEY, RUNNER_ID } from "../lib/control-plane/admin-data.ts";
import { unacknowledgedResearchResume } from "../lib/control-plane/scheduler/launch-wake.ts";
import { OWNER_SURFACE_FORMAT_VERSION, assertAggregateOnly, type OwnerDigestRecord, type RunnerHeartbeat, type RoutineSupervisorLane } from "../lib/control-plane/owner-surface.ts";
import {
  parseIntakeRuntimeObservation,
  unreadableIntakeRuntimeObservation,
  type IntakeRuntimeObservation,
} from "../lib/ops/intake-runtime.ts";
import {
  RESEARCH_FORMAT_VERSION,
  RESEARCH_INTENT_LOG_KEY,
  readIntents,
  type ResearchIntent,
  type ResearchIntentRequest,
} from "../lib/control-plane/scheduler/research-policy.ts";
import type { CacheHitRate, ResearchMetrics } from "../lib/control-plane/research-metrics.ts";
import type { PrewarmOutcome } from "../lib/control-plane/scheduler/shadow-loop.ts";
import { researchDigestLines } from "../lib/control-plane/research-digest.ts";
import { costSection } from "../lib/control-plane/pilot-cost-digest.ts";
import { today } from "./doc-dates.mjs";
import {
  classifyProviderFailure,
  type FleetSafetySnapshot,
  type ProviderCircuit,
} from "../lib/control-plane/fleet-safety.ts";
import { installNeonCircuitBreaker, latchNeonCircuit, readNeonCircuit } from "../lib/control-plane/neon-circuit.ts";
import { liveCycleHeartbeat, standingHeartbeat } from "../lib/control-plane/runner-standing.ts";
import { hostMemoryReading, routineProcessSlots } from "../lib/control-plane/workers/worker-slots.ts";
import { parseRoutineSupervisorFailureSummary } from "../lib/control-plane/routine-outcome-summary.ts";
import { VITAL_SIGNS_REPORT_ENV, countVitalSign, formatNeonBytesLine, hourStart, keepNeonBytesInProcess,
  summarizeNeonBytes, takeNeonBytesHours, type NeonBytesHour } from "../lib/db/transfer-by-caller.ts";
import { collectDatabaseTransferJournals, keepRunnerTransfer } from "../lib/db/transfer.ts";
import { transferJournalDir } from "../lib/db/transfer-journal.ts";
import { startCivicReadCacheHost } from "../lib/db/civic-read-cache-host.ts";
import { keepNeonBytesPart, pruneNeonBytes, readNeonBytesHour } from "../lib/ops/vital-signs-hours.ts";
import { VITAL_COUNTERS, composeVitalSignsRow, formatVitalSignsLine, readHourCosts, writeVitalSignsRow,
  type HourCosts } from "../lib/control-plane/vital-signs.ts";
import { neon } from "../lib/db/client.ts";
import type { ChildProcess } from "node:child_process";
import { startHangWatchdog, hangWatchdogDisabled, type HangWatchdog } from "./runner-hang-watchdog.mts";
import {
  installNeonRequestDeadline,
  neonReadFailureLine,
} from "../lib/ops/neon-request-deadline.ts";
import { CONTROL_WAKE_POLL_MS, runnerControlReader } from "./pilot-runtime-control.mts";
import { consoleInputReader, consolePublisher, ownerCountsReady } from "./pilot-runtime-publish.mts";
import { endOwnedProcessTree, receiveChildVitalSigns, runRuntimeChildren, RUNTIME_NO_PROGRESS_MS, waitForRuntimeQuiescence } from "./pilot-runtime-child.mts";
import { PendingRestart } from "../lib/ops/pending-restart.ts";
import { auditPassClock } from "./audit-pass-clock.mts";
import { lastChildLines, recordFailedCycle } from "../lib/control-plane/scheduler/cycle-finalization.ts";
import {
  ROUTINE_DATA_ADMISSION_MS,
  ROUTINE_PASS_BUDGET_MS,
  ROUTINE_SUPERVISOR_STARTED_AT_ENV,
  routineSupervisorCycleId,
} from "../lib/civic-data/runner.ts";
import {
  routineSupervisorOuterEvidence,
} from "../lib/civic-data/runner-receipt.ts";
import { childFatalLine, childStderrCause, nativeAbortLine } from "../lib/ops/fatal-line.ts";
import { HUNTER_LANE_LIFE_MS, HUNTER_WORKER_WALL_MS } from "../lib/control-plane/workers/hunter-lane.ts";
import { IndependentRuntimeLaneScheduler, withPassDeadline } from "../lib/ops/independent-runtime-pass.ts";
import { boundedBeat } from "../lib/ops/bounded-beat.ts";
import { publishNowLane } from "../lib/civic-data/publish-now.ts";
import { placeMapsLane } from "../lib/civic-data/place-map-lane.ts";
import { drainPlacePageQueue, placePagesLane, placePageTurnResult, PLACE_PAGE_TURN_GRACE_MS, type PlacePageTurn } from "../lib/reader/place-page-worker.ts";
import { DOOR_PROBES_JOB, doorProbesLane, runStandingDoorProbes } from "../lib/doors/probe-lane.ts";
import { readerFactDb } from "../lib/facts/db.ts";
import {
  appendIntakeRuntimeObservationDigest,
  appendRoutineCivicDataSupervisorDigest,
  intakeRuntimeObservationOutcome,
  routineCivicDataSupervisorOutcome,
} from "../lib/control-plane/freshness-cycle-outcome.ts";
import {
  applyRuntimeRelease,
  resumeRuntimeReleaseInstall,
  fetchGithubCheckRuns,
  fetchRuntimeProductionDeploys,
  inspectNewestDeployedRuntimeRelease,
  runtimeGithubRepository,
  runtimeGithubCredential,
  runtimeProductionReadEnvironment,
  writeRuntimeReleaseHold,
  type RuntimeReleaseInspection,
} from "../lib/ops/runtime-release-handoff.ts";
import { discardStagedReleases, defaultAsyncRunCommand, ReleaseStaging, stagedReleaseDirectory } from "../lib/ops/runtime-release-stage.ts";
import { parentCodeChanged } from "../lib/ops/runtime-release-switch.ts";
import { fetchServedCommit, PRODUCTION_BASE_URL } from "./post-deploy-observer.mts";
import {
  acquireProcessSingleton,
  PILOT_RUNNER_SINGLETON_PORT,
} from "../lib/civic-data/process-singleton.ts";
import {
  admittedRuntimeChildEnvironment,
  assertRuntimeAuthority,
} from "../lib/civic-data/runtime-authority.ts";
import { BILLING_SECRET_NAMES, withoutBillingSecrets } from "../lib/control-plane/provider-billing.ts";
import { installConnectAttemptWindow } from "../lib/ops/connect-attempt-window.ts";
import { releaseWindowLeaseOfExitedLocalHolder } from "../lib/control-plane/promotion/window.ts";
import { ADMIN_COPY_POLL_MS, runAuthorizedAdminCopyTick } from "../lib/control-plane/evidence/admin-copy-runner.ts";
import { VAULT_DIR } from "../lib/control-plane/scheduler/vault.ts";
import { fireDueOrders } from "../lib/control-plane/gateway/scheduled-fire.ts";
import { runtimeContractRetry, runtimeContractContinues, RUNTIME_CONTRACT_ATTEMPT_MS } from "./apply-migrations.mts";
import { wakeHintWriterFromEnv } from "../lib/control-plane/gateway/wake-hint.ts";
import { JOB_BREAKER_INTERVAL_MS, JOB_BREAKER_JOB } from "../lib/control-plane/job-transfer-breaker.ts";
import { admitJobLaunch, JOB_BREAKER_PATH_ENV, JOB_SLOWED_WORDS } from "../lib/control-plane/job-breaker-local.ts";
import { JobTransferBreaker } from "../lib/control-plane/job-breaker-loop.ts";
import { withDatabaseJob, processNeonBytes } from "../lib/db/transfer-by-caller.ts";
import { isControlPlaneRequestTimeout } from "../lib/control-plane/repository/request-bounds.ts";
import { controlPlaneTimeoutLine, keepRunningThroughControlPlaneTimeouts } from "../lib/ops/control-plane-timeout-guard.ts";

installConnectAttemptWindow();
// A control-plane read that did not answer in time ends its pass, never the runner.
keepRunningThroughControlPlaneTimeouts();

const TS_CHILD = ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs"] as const;

const STDERR_TAIL_LINES = 40;

const ROOT = process.cwd();

const VITAL_SIGNS_DIR = join(ROOT, ".runtime", "vital-signs");
const DATABASE_TRANSFER_DIR = transferJournalDir();
if (DATABASE_TRANSFER_DIR) process.env.WTP_DATABASE_TRANSFER_DIR = DATABASE_TRANSFER_DIR;
process.env[VITAL_SIGNS_REPORT_ENV] = "1";


keepNeonBytesInProcess();

function keepHourPart(part: NeonBytesHour): void {
  keepNeonBytesPart(VITAL_SIGNS_DIR, part);
  keepRunnerTransfer(part);
}
receiveChildVitalSigns(keepHourPart);

function keepOwnNeonBytes(nowMs: number): void {
  if (DATABASE_TRANSFER_DIR) {
    for (const part of collectDatabaseTransferJournals(DATABASE_TRANSFER_DIR)) keepNeonBytesPart(VITAL_SIGNS_DIR, part);
  }
  for (const part of takeNeonBytesHours(nowMs)) keepHourPart(part);
}
process.once("exit", () => { keepOwnNeonBytes(Date.now()); });

if (!process.env.WTP_BILLING_ENV_FILE) {
  const launchFile = process.execArgv.find(a => a.startsWith("--env-file="));
  if (launchFile) process.env.WTP_BILLING_ENV_FILE = launchFile.slice("--env-file=".length);
}
for (const name of BILLING_SECRET_NAMES) delete process.env[name];
const argv = process.argv.slice(2);
const STAGING = argv.includes("--staging") || process.env.WTP_RUNTIME_MODE === "staging";
if (STAGING && process.env.WTP_DB_ROLE !== "local") throw new Error("Staging runner requires WTP_DB_ROLE=local");
if (STAGING) process.env.WTP_RUNTIME_MODE = "staging";
assertProductionDatabaseTarget(process.env);
const AUTO_RELEASE_HANDOFF = !STAGING && argv.includes("--release-handoff");
const provider = argv.includes("--provider=file") ? "file" : "postgres";
if (provider === "postgres") {
  if (!AUTO_RELEASE_HANDOFF && !STAGING) {
    throw new Error("PERMANENT_RUNTIME_AUTHORITY_REFUSED:postgres standing runtime requires --release-handoff");
  }
  assertRuntimeAuthority({ capabilities: ["STANDING_PARENT"] });
}

await startCivicReadCacheHost();

function standingChildEnvironment(
  capability: Parameters<typeof admittedRuntimeChildEnvironment>[0]["capability"],
  parentEnv: NodeJS.ProcessEnv = process.env,
  billingCollector = false,
): NodeJS.ProcessEnv {
  if (STAGING) return billingCollector ? { ...parentEnv } : withoutBillingSecrets(parentEnv);
  return provider === "postgres"
    ? admittedRuntimeChildEnvironment({
      parentEnv: ["RESEARCH_CYCLE", "CONSOLE_PUBLISHER"].includes(capability)
        && !STAGING ? runtimeProductionReadEnvironment(parentEnv)
        : parentEnv,
      capability,
      parentPid: process.pid,
      billingCollector,
    })
    : billingCollector ? { ...parentEnv } : withoutBillingSecrets(parentEnv);
}

const PILOT_PROCESS_LEASE = await acquireProcessSingleton(
  "pilot-runner",
  PILOT_RUNNER_SINGLETON_PORT,
);

const PARENT_CODE_SHA = headSha(ROOT);

let RUNNING_CODE_SHA = PARENT_CODE_SHA;
let CODE_ROOT = ROOT;
const jobBreakerPath = process.env[JOB_BREAKER_PATH_ENV] ?? join(ROOT, ".mirror", "job-transfer-breaker.json");
if (provider === "postgres" && !STAGING) process.env[JOB_BREAKER_PATH_ENV] = jobBreakerPath;
/** When each job this runner schedules last started, finished or failed; it rides on the heartbeat for the line keeper. */
const jobRuns = new JobRunBook();
const RESEARCH_JOB = "research-cycle";
const BREAKER_SLOWED = `Slowed by the job transfer breaker: it ${JOB_SLOWED_WORDS}.`;
let jobBreaker: JobTransferBreaker | null = null;
let jobBreakerWork: Promise<void> | null = null;
let jobBreakerTimer: ReturnType<typeof setInterval> | null = null;
function breakerOwnBytes() {
  return processNeonBytes().map(part => ({ hour: part.hour, counts: Object.entries(part.reads ?? {})
    .filter(([key]) => key.split("\t")[1] === JOB_BREAKER_JOB).map(([,counts]) => counts) }))
    .map(part => ({ hour: part.hour, requests: part.counts.reduce((n,c)=>n+c[0],0),
      bytes: part.counts.reduce((n,c)=>n+c[1]+c[2],0) }));
}
async function checkJobTransfers(): Promise<void> {
  if (provider !== "postgres" || STAGING || canary) return;
  const controlUrl = controlPlaneUrlFromEnv(), readerUrl = process.env.DATABASE_URL;
  if (!controlUrl || !readerUrl) throw new Error("Job transfer breaker requires both databases");
  await withDatabaseJob(JOB_BREAKER_JOB, async () => {
    if (!jobBreaker) {
      const bounded = (url: string) => { const sql=neon(url); return {query:(text:string,params:readonly unknown[]=[])=>
        sql.query(text,[...params],{fetchOptions:{signal:AbortSignal.timeout(10_000)}})}; };
      jobBreaker = new JobTransferBreaker({path:jobBreakerPath,control:bounded(controlUrl),reader:bounded(readerUrl),
        release:()=>RUNNING_CODE_SHA??"unknown",meter:breakerOwnBytes,
        log:line=>console.log(`  job transfer breaker: ${line}`)});
    }
    await jobBreaker.check();
  });
}
function jobTransferTick(): Promise<void> {
  if (jobBreakerWork) return jobBreakerWork;
  jobRuns.started(JOB_BREAKER_JOB);
  jobBreakerWork = checkJobTransfers().then(() => jobRuns.finished(JOB_BREAKER_JOB)).catch(error => {
    const message = error instanceof Error ? error.message : String(error);
    jobRuns.failed(JOB_BREAKER_JOB, message);
    console.error(`  job transfer breaker check failed; each job keeps its current pace: ${message}`);
  }).finally(() => { jobBreakerWork = null; });
  return jobBreakerWork;
}
function jobLaunchAllowed(job: string): boolean {
  const admitted = admitJobLaunch(job);
  if (!admitted) {
    console.log(`  job transfer breaker: ${job} ${JOB_SLOWED_WORDS}`);
    jobRuns.held(job, BREAKER_SLOWED);
  }
  return admitted;
}
const cyclesArg = argv.find((a) => a.startsWith("--cycles="));
const CYCLES = cyclesArg ? Number(cyclesArg.slice("--cycles=".length)) : Infinity;
const intervalArg = argv.find((a) => a.startsWith("--interval="));
const INTERVAL_MIN = intervalArg ? Number(intervalArg.slice("--interval=".length)) : 60;
jobRuns.register(RESEARCH_JOB, INTERVAL_MIN * 60_000);

const maxArg = argv.find((a) => a.startsWith("--max="));
const onlyArg = argv.find((a) => a.startsWith("--only="));
const idsArg = argv.find((a) => a.startsWith("--ids="));
const scoutMaxArg = argv.find((a) => a.startsWith("--scout-max="));
const canary = argv.includes("--canary");

const DIGEST_DIR = join(ROOT, ".mirror");
const RUNS_DIR = join(ROOT, ".runtime", "freshness-shadow-runs");

let hangWatchdog: HangWatchdog | null = null;
if (provider === "postgres") {

  installNeonRequestDeadline();
  installNeonCircuitBreaker(ROOT);
  if (!canary && !hangWatchdogDisabled()) hangWatchdog = startHangWatchdog();
}

interface RunRecord {
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly provider?: string;
  readonly registry?: {
    readonly providers?: readonly {
      readonly providerId: string;
      readonly records: number;
      readonly units: number;
      readonly readFailure: string | null;
      readonly emptyReason: string | null;
    }[];
    readonly registeredUnits?: number;

    readonly nonMeetingUnits?: number;
  };
  readonly dueCount?: number;
  readonly dispatched?: number;
  readonly workedCount?: number;
  readonly incidentCount?: number;
  readonly dispositionCounts?: Readonly<Record<string, number>>;
  readonly worked?: readonly string[];
  readonly dispositions?: readonly { obligationId: string; disposition: string | null; artifacts: number }[];
  readonly staged?: readonly {
    readonly obligationId: string;
    readonly state: string;
    readonly rowCount: number;
    readonly declaredTotal: number | null;
    readonly complete: boolean;
    readonly readerSentence: string;
    readonly snapshotPath: string | null;
  }[];
  readonly health?: { readonly green?: boolean; readonly readings?: readonly { contract: string; state: string; reason: string }[] };
  readonly debts?: number;
  readonly incidents?: readonly { cause: string; target: string; obligationsAffected: number; nextRetryAt: string }[];
  readonly promotedToReaderTruth?: boolean;
  readonly digest?: readonly string[];

  readonly research?: {
    readonly state?: {

      readonly metrics?: ResearchMetrics | null;
      readonly modelLaneEnabled?: boolean;
      readonly modelLaneDisabledReason?: string | null;
      readonly workerCredential?: { readonly name?: string; readonly configured?: boolean };
      readonly model?: string;
      readonly spend?: { readonly windowUsd?: number | null; readonly measuredAttempts?: number; readonly unmeasuredAttempts?: number };
      readonly bounds?: { readonly dailyCeilingUsd?: number; readonly maxConcurrentScouts?: number; readonly maxScoutDispatchesPerCycle?: number };
      readonly queue?: { readonly modelClassDue?: number; readonly modelClassUnits?: number; readonly modelClassDispatchedThisCycle?: number };
      readonly runtimeConditions?: readonly string[];
      readonly fleetSafety?: FleetSafetySnapshot | null;
    };
    readonly lanes?: {
      readonly deterministic?: { readonly due?: number; readonly dispatched?: number };
      readonly model?: {
        readonly due?: number; readonly dispatched?: number; readonly deferred?: number; readonly deferredBy?: Readonly<Record<string, number>>;

        readonly prewarm?: PrewarmOutcome | null;
      };
    } | null;

    readonly cacheThisCycle?: readonly CacheHitRate[] | null;
    readonly scoutCost?: { readonly attempts:number; readonly usd:number; readonly unmeasured:number };
    readonly scouts?: readonly {
      readonly obligationId: string;
      readonly attemptId: string | null;
      readonly outcome: string | null;
      readonly disposition: string | null;
      readonly worker: { readonly role?: string; readonly provider?: string; readonly version?: string } | null;
      readonly cost: { readonly usd?: number | null; readonly inputTokens?: number | null; readonly outputTokens?: number | null } | null;
      readonly artifacts: number;
    }[];
    readonly results?: readonly {
      readonly obligationId: string;
      readonly outcome: string;
      readonly refused: boolean;
      readonly stoppedBy: string;
      readonly rungs: number;
      readonly distinctEvidenceRungs: number;
      readonly candidates: number;
      readonly usd: number | null;
      readonly elapsedMs: number;
    }[];
  };
}

async function runOneCycle(owner: { readonly ownerIntentsUnreadable: boolean }): Promise<{
  readonly ok: boolean;
  readonly recordPath: string | null;
  readonly stdout: string;

  readonly stderrTail: string;
  readonly signal: string | null;
  readonly exitCode: number | null;
  readonly circuit: ProviderCircuit | null;
  readonly failedAtMs?: number;
}> {
  const before = new Date().toISOString();
  const latched = provider === "postgres" ? readNeonCircuit(ROOT, before) : null;
  if (latched) {
    return { ok: false, recordPath: null, stdout: "", stderrTail: `${latched.provider}: ${latched.condition}; no automated retry before ${latched.eligibleAt}`, signal: null, exitCode: null, circuit: latched };
  }
  const args = [

    ...TS_CHILD,
    "scripts/freshness-shadow.mts",
    `--provider=${provider}`,

    `--interval=${INTERVAL_MIN}`,
    ...(maxArg ? [maxArg] : []),
    ...(onlyArg ? [onlyArg] : []),
    ...(idsArg ? [idsArg] : []),
    ...(scoutMaxArg ? [scoutMaxArg] : []),
    ...(canary ? ["--canary"] : []),
    ...(owner.ownerIntentsUnreadable ? ["--owner-intents-unreadable"] : []),
  ];
  const [run] = await runRuntimeChildren([{
    id: "research-cycle",
    databaseBytesPerRun: 2_583_549_313,
    executable: process.execPath,
    args,
    env: standingChildEnvironment("RESEARCH_CYCLE"),
  }], {
    cwd: CODE_ROOT,
    env: process.env,
    maxBufferBytes: 64 * 1024 * 1024,
    noProgressMs: RUNTIME_NO_PROGRESS_MS,
    onStdout: (_id, output) => { process.stdout.write(output); currentCycleOutput = `${currentCycleOutput}${output}`.slice(-8000); },
    onStderr: (_id, output) => {
      process.stderr.write(output);
      currentCycleErrors = `${currentCycleErrors}${output}`.slice(-8000);
      currentCycleOutput = `${currentCycleOutput}${output}`.slice(-8000);
    },
    onStarted: (_id, child) => { researchCycleChild = child; },
  });
  if (!run) throw new Error("RESEARCH_CYCLE_CHILD_RESULT_MISSING");
  const failedAtMs = Date.now();
  let supervisorRecordPath: string | null = null;
  if (run.termination === "TIMED_OUT") {
    const reason = run.errorMessage ?? "RESEARCH_CHILD_NO_PROGRESS";
    countVitalSign(VITAL_COUNTERS.roundsKilled);
    const outcome = await recordFailedCycle({
      repos: await ownerRepositories(), error: new Error(reason),
      cycleId: `research-supervisor:${hostname()}:${before}`, startedAt: before,
      finishedAt: new Date(failedAtMs).toISOString(), testedSha: RUNNING_CODE_SHA, host: hostname(), pending: null,

      lastOutput: lastChildLines(currentCycleOutput),
      writeLocalRecord: record => {
        mkdirSync(RUNS_DIR, { recursive: true });
        const path = join(RUNS_DIR, `supervisor-${failedAtMs}.json`);
        writeFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
        return path;
      },
      log: line => console.error(line),
    });
    supervisorRecordPath = outcome.recordPath;
    console.error(`  research round FAILED: ${reason}; canonical outcome ${outcome.canonical}; retry within 10 minutes`);
  }
  const stdout = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const match = [...stdout.matchAll(/local diagnostic: (.+\.json)/g)].at(-1);
  const stderrLines = (run.stderr ?? "").split("\n").filter((l) => l.trim() !== "");
  const failure = classifyProviderFailure(new Error(`${run.stderr ?? ""}\n${run.stdout ?? ""}`));
  const databaseNamed = /neon|postgres|database|control plane|transfer allowance|compute quota|storage quota/i.test(failure.condition);
  const circuit = provider === "postgres" && run.termination !== "TIMED_OUT" && run.status !== 0 && failure.class === "HARD" && databaseNamed
    ? latchNeonCircuit(ROOT, failure.condition, new Date().toISOString())
    : null;
  return {
    ok: run.status === 0,
    recordPath: supervisorRecordPath ?? (match ? match[1].trim() : null),
    stdout,

    stderrTail: stderrLines.slice(-STDERR_TAIL_LINES).join("\n"),
    signal: run.signal ?? null,
    exitCode: run.status,
    circuit,
    ...(run.status !== 0 ? { failedAtMs } : {}),
  };
}

function laneShare(record: RunRecord): string[] {
  const digest = record.digest ?? [];
  const executors = digest.find((l) => l.includes("executors          "));
  const research = record.research;
  const state = research?.state;
  const lanes = research?.lanes ?? null;
  const out = [
    "## DETERMINISTIC vs MODEL",
    "",
    executors
      ? `- ${executors.trim().replace(/^executors\s+/, "")}`
      : "- the cycle recorded no executor split, which is a defect in the run record",
  ];
  if (!research) {
    out.push("- this record was written before Level 1 — Research was wired; it carries no Scout lane");
    return out;
  }
  const safety = state?.fleetSafety;
  out.push("", "## FLEET SAFETY", "");
  if (!safety) {
    out.push("- no aggregate safety snapshot was recorded; this is not a zero-use reading");
  } else {
    out.push(
      `- state: **${safety.status}**`,
      `- model spend: cycle ${safety.cycle.modelUsd === null ? "UNMEASURED" : `$${safety.cycle.modelUsd.toFixed(4)}`}; ` +
        `rolling 24h ${safety.rolling24Hours.modelUsd === null ? "UNMEASURED" : `$${safety.rolling24Hours.modelUsd.toFixed(4)}`} / $${safety.bounds.rolling24HourModelUsd.toFixed(2)} (the one spend ceiling)`,
      `- aggregate: dispatches ${safety.cycle.dispatches}; requests ${safety.cycle.requests}; payload bytes ${safety.cycle.payloadBytes}; ` +
        `per-download cap ${safety.bounds.maxDownloadBytes}; elapsed ${safety.cycle.elapsedMs}ms`,
      `- stopped because: ${safety.stoppedBecause.join("; ") || "no ceiling or circuit stopped work"}`,
      `- provider circuits: ${safety.providerCircuits.map(c => `${c.provider} until ${c.eligibleAt}: ${c.condition}`).join("; ") || "none"}`,
      `- last successful Fleet activity: ${safety.lastSuccessfulActivity ?? "none recorded"}`,
    );
  }
  out.push(
    `- deterministic lane: ${lanes?.deterministic?.dispatched ?? 0} dispatched of ${lanes?.deterministic?.due ?? 0} due`,
    `- Scout lane: ${lanes?.model?.dispatched ?? 0} dispatched of ${lanes?.model?.due ?? 0} due model-class` +
      ` · deferred ${lanes?.model?.deferred ?? 0}` +
      (lanes?.model?.deferredBy && Object.keys(lanes.model.deferredBy).length > 0
        ? ` (${Object.entries(lanes.model.deferredBy).map(([k, v]) => `${k} ${v}`).join(", ")})`
        : ""),
  );
  out.push("", "## RESEARCH — LEVEL 1", "");
  out.push(
    `- lane: ${state?.modelLaneEnabled ? "ENABLED" : `CLOSED — ${state?.modelLaneDisabledReason ?? "reason unrecorded"}`}`,
    `- credential: ${state?.workerCredential?.name ?? "WTP_WORKERS_ANTHROPIC_API_KEY"} configured in the cycle process: ${state?.workerCredential?.configured ? "yes" : "NO"} (by name)`,
    `- model: ${state?.model ?? "unrecorded"} · concurrency ${state?.bounds?.maxConcurrentScouts ?? "?"} · per cycle ${state?.bounds?.maxScoutDispatchesPerCycle ?? "?"}`,
    `- spend: ${state?.spend?.windowUsd === null || state?.spend?.windowUsd === undefined ? "UNMEASURED" : `$${state.spend.windowUsd.toFixed(4)}`} of $${state?.bounds?.dailyCeilingUsd ?? "?"} rolling ceiling` +
      ` (measured ${state?.spend?.measuredAttempts ?? 0}, unmeasured ${state?.spend?.unmeasuredAttempts ?? 0})`,
  );
  for (const r of research.results ?? []) {
    out.push(
      `  - ${r.refused ? "REFUSED" : r.outcome} (${r.stoppedBy}) — \`${r.obligationId}\` — ${r.rungs} rung(s), ` +
        `${r.distinctEvidenceRungs} evidence-backed, ${r.candidates} candidate(s), ` +
        `${r.usd === null ? "usd UNMEASURED" : `$${r.usd.toFixed(4)}`}, ${Math.round(r.elapsedMs / 1000)}s`,
    );
  }
  if ((state?.runtimeConditions ?? []).length > 0) {
    out.push(`- runtime conditions: ${(state?.runtimeConditions ?? []).join("; ")}`);
  }
  out.push("- PROMOTION: OFF. A Scout finding is inventory and a candidate; nothing it produced changed what a reader is told.");

  out.push("", "## RESEARCH METRICS (reader-impact ordering)", "");
  if (state?.metrics) {
    for (const line of researchDigestLines(state.metrics)) out.push(`- ${line.trim()}`);
  } else {
    out.push("- not yet computed by a cycle: this record's research state carries no metrics (a cycle on code before Work Item 5, or a cycle that did not reach the metrics step)");
  }
  return out;
}

function buildDigest(record: RunRecord, cycle: number, at: string, ok: boolean): string {
  const out: string[] = [];
  const health = record.health;
  out.push(`# Pilot digest — cycle ${cycle}, ${at}`);
  out.push("");
  out.push(
    `Written by the standing pilot runner on the \`${record.provider ?? "unknown"}\` control plane. ` +
      "Each state records its work and publication results separately.",
  );
  out.push("");

  out.push("## PILOT HEALTH");
  out.push("");
  if (health?.readings) {
    for (const r of health.readings) {
      out.push(`- **${r.contract} — ${r.state}**`);
      out.push(`  - ${r.reason}`);
    }
    out.push(`- **ROLLUP — ${health.green ? "GREEN" : "NOT GREEN"}**`);
  } else {
    out.push("- the cycle produced no health rollup. That is a defect in the run and not a green.");
  }
  out.push("");

  out.push(...costSection(record).lines);
  out.push("");
  out.push(...laneShare(record));
  out.push("");

  out.push("## WHAT ADVANCED, UNATTENDED");
  out.push("");
  const registry = record.registry;
  out.push(
    `- ${registry?.registeredUnits ?? 0} scheduled unit(s) registered across ` +
      `${registry?.providers?.length ?? 0} provider(s)`,
  );
  for (const p of registry?.providers ?? []) {
    out.push(
      `  - \`${p.providerId}\` — ${p.records} record(s) -> ${p.units} route unit(s)` +
        (p.readFailure ? ` — **READ FAILURE:** ${p.readFailure}` : "") +
        (p.units === 0 && p.emptyReason ? ` — ${p.emptyReason}` : ""),
    );
  }
  out.push(
    `- ${floorLine(
      floored(
        "obligations DUE this cycle",
        "the whole registry",
        registry?.registeredUnits ?? 0,
        record.dueCount ?? 0,
        (registry?.registeredUnits ?? 0) === 0
          ? "the registry produced no units, which is a defect and not an idle night"
          : undefined,
      ),
    )}`,
  );
  out.push(
    `- ${floorLine(
      floored(
        "DISCHARGED",
        "what was dispatched",
        record.dispatched ?? 0,
        record.workedCount ?? (record.worked ?? []).length,
        (record.dispatched ?? 0) === 0 ? "nothing was dispatched this cycle" : undefined,
      ),
    )}`,
  );
  for (const [disposition, count] of Object.entries(record.dispositionCounts ?? {})) out.push(`  - ${disposition}: ${count}`);
  for (const d of record.dispositions ?? []) {
    out.push(`  - \`${d.disposition}\` — ${d.obligationId} (${d.artifacts} artifact(s))`);
  }
  out.push("");

  out.push("## STAGED, PROMOTION-READY");
  out.push("");
  const staged = record.staged ?? [];
  const ready = staged.filter((s) => s.state === "STAGED_PROMOTION_READY");
  const gaps = staged.filter((s) => s.state === "STAGED_GAP");
  out.push(
    `${staged.length} entry(ies) staged — ${ready.length} promotion-ready, ${gaps.length} honest gap(s). ` +
      "Verified records publish through the builders; gaps stay open.",
  );
  out.push("");
  for (const s of ready) {
    out.push(
      `- **READY** \`${s.obligationId}\` — ${s.rowCount} of ${s.declaredTotal ?? "an undeclared total"}` +
        `${s.complete ? " (RESPONSE WHOLE — not the whole index)" : " (PARTIAL — the rest is still owed)"} at \`${s.snapshotPath}\``,
    );
  }
  for (const s of gaps) {
    out.push(`- **GAP** \`${s.obligationId}\` — ${s.readerSentence}`);
  }
  out.push("");

  out.push("## DEBT AND WALLS");
  out.push("");
  out.push(`${record.debts ?? 0} debt row(s) across ${record.incidentCount ?? (record.incidents ?? []).length} incident(s).`);
  for (const i of record.incidents ?? []) {
    out.push(
      `- \`${i.cause}\` at ${i.target} — ${i.obligationsAffected} obligation(s), next retry ${i.nextRetryAt}`,
    );
  }
  out.push("");
  out.push(
    `Promotion to reader truth: **${record.promotedToReaderTruth === false ? "none" : "UNSTATED — investigate"}**. ` +
      `Cycle process exit: ${ok ? "clean" : "NON-ZERO — the cycle did not finish and this digest describes a partial run"}.`,
  );
  out.push("");
  return `${out.join("\n")}\n`;
}

function deliver(body: string, headline: string): { readonly where: string } {
  mkdirSync(DIGEST_DIR, { recursive: true });
  const path = join(DIGEST_DIR, "pilot-digest.md");
  writeFileSync(path, body, "utf8");
  appendFileSync(join(DIGEST_DIR, "pilot-digest-log.md"), `${headline}\n`, "utf8");
  return { where: path };
}

const CONSOLE_PUBLISHERS: readonly { readonly databaseBytesPerRun: number; readonly name: string; readonly args: readonly string[] }[] = [

  // CP-01 full production-copy publisher: 4,657,448 cold bytes; 452,484 steady; 452,413 after a lease heartbeat and five minutes.
  // Reserve the observed cold run; source fingerprints keep a cold-plus-eleven-pass hour under 0.01 GB.
  { databaseBytesPerRun: 5_000_000, name: "owner snapshot", args: ["scripts/publish-owner-snapshot.mts"] },
];

const publishChangedConsole = consolePublisher({
  readInputs: async () => {

    const env = STAGING ? process.env : runtimeProductionReadEnvironment(process.env);
    const controlUrl = controlPlaneUrlFromEnv(env);
    const readerUrl = env.DATABASE_URL;
    if (!controlUrl || !readerUrl) throw new Error("CONSOLE_INPUTS_UNCONFIGURED");
    return consoleInputReader(controlUrl, readerUrl, RUNNING_CODE_SHA)();
  },
  inputReadFailed: error => console.error(`  console publish: inputs unreadable (${(error as Error)?.name ?? "error"}); publishing without reuse`),
  publish: publishConsoleChildren,
});

async function publishConsole(): Promise<void> {
  if (canary && STAGING) {
    console.log("  console publish: staging canary is scoped to research; billing and live-site readbacks are skipped");
    return;
  }
  if (provider !== "postgres") {
    console.log("  console publish: skipped — the file provider is a local proof with no deployed console to publish to");
    return;
  }

  if (process.env.WTP_OWNER_SNAPSHOT_PUBLISH === "off") {
    console.log("  console publish: owner snapshot switched off (WTP_OWNER_SNAPSHOT_PUBLISH=off); Admin keeps the last snapshot");
    return;
  }
  if (await publishChangedConsole() === "UNCHANGED") {
    console.log("  console publish: unchanged inputs; owner snapshot retained");
  }
}

async function publishConsoleChildren(): Promise<boolean> {
  let succeeded = true;
  for (const publisher of CONSOLE_PUBLISHERS) {
    if (publisher.name === "owner snapshot") {
      const env = STAGING ? process.env : runtimeProductionReadEnvironment(process.env);
      const controlUrl = controlPlaneUrlFromEnv(env);
      const ready = controlUrl ? await ownerCountsReady(controlUrl).catch(() => false) : false;
      if (!ready) {
        console.log("  console publish: owner count inputs are unavailable or initializing; retaining the last snapshot until they are ready");
        succeeded = false;
        continue;
      }
    }
    if (!jobLaunchAllowed(`console-publish:${publisher.name}`)) { succeeded = false; continue; }
    const started = Date.now();
    const [run] = await runRuntimeChildren([{
      id: `console-publish:${publisher.name}`,
      databaseBytesPerRun: publisher.databaseBytesPerRun,
      executable: process.execPath,

      args: [...TS_CHILD, ...publisher.args],
      env: standingChildEnvironment("CONSOLE_PUBLISHER", process.env, publisher.name === "owner snapshot"),
    }], {
      cwd: CODE_ROOT,
      env: process.env,

      maxBufferBytes: 16 * 1024 * 1024,
      noProgressMs: RUNTIME_NO_PROGRESS_MS,
    });
    if (!run) {
      succeeded = false;
      console.error(`  console publish: ${publisher.name} FAILED — child result missing`);
      continue;
    }
    const seconds = Math.round((Date.now() - started) / 1000);
    if (run.status === 0) {
      console.log(`  console publish: ${publisher.name} OK (${seconds}s)`);
      continue;
    }
    succeeded = false;
    const last = childStderrCause(run.stderr ?? "") ?? run.errorMessage ?? "(nothing on stderr)";
    const exit = run.status === null ? `signal ${run.signal ?? "none"}` : String(run.status);
    console.error(`  console publish: ${publisher.name} FAILED exit ${exit} — ${last}`);
  }
  return succeeded;
}

async function runRoutineCivicData(deadlineMs: number): Promise<void> {
  if (provider !== "postgres" || canary) {
    console.log("  routine civic data: skipped — only the standing production runner owns this data plane");
    return;
  }
  const startedAt = new Date().toISOString();
  const cycleId = routineSupervisorCycleId(hostname(), startedAt);
  const refreshRepos = await ownerRepositories();
  const ownerRefresh = refreshRepos ? await reserveRoutineRefresh(refreshRepos, startedAt) : null;
  if (ownerRefresh) console.log(`  owner routine refresh ${ownerRefresh.requestId}: attempt ${ownerRefresh.ordinal + 1} of exact partition ${ownerRefresh.contractId}`);
  const childEnvironment = standingChildEnvironment(
    "ROUTINE_SUPERVISOR",
    {
      ...process.env,
      [ROUTINE_SUPERVISOR_STARTED_AT_ENV]: startedAt,
    },
  );

  const beatTimer = setInterval(() => { if (!researchCycleActive) void standingBeat(); }, 60_000);
  const [run] = await runRuntimeChildren([{
    id: "routine-civic-data",
    databaseBytesPerRun: 128_890_931,
    executable: process.execPath,
    args: [...TS_CHILD, "scripts/routine-civic-data-runner.mts", ...(ownerRefresh?.args ?? [])],
    env: withPassDeadline(childEnvironment, deadlineMs),
  }], {
    cwd: CODE_ROOT,
    env: process.env,
    deadlineMs,

    maxBufferBytes: 64 * 1024 * 1024,
    onStdout: (_id, output) => process.stdout.write(output),
    onStderr: (_id, output) => process.stderr.write(output),
  }).finally(() => clearInterval(beatTimer));
  if (!run) throw new Error("ROUTINE_CIVIC_DATA_CHILD_RESULT_MISSING");
  if (ownerRefresh && refreshRepos) await finishRoutineRefresh(refreshRepos, ownerRefresh, new Date().toISOString(), run.status);
  const lines = `${run.stdout ?? ""}\n${run.stderr ?? ""}`.split("\n").filter((line) => /^(RCD_|RCD_RECEIPT=)/.test(line));
  const readerFailures = lines.filter((line) =>
    line.startsWith("RCD_READER_READBACK ") &&
    (line.includes(": RECORDED FAIL") || line.includes(": CURRENT FAIL (BACKOFF)")),
  ).length;
  if (readerFailures > 0) {
    console.error(
      `  routine civic data: ${readerFailures} canonical Reader delivery failure(s) recorded or under retry backoff; ` +
        "source dispositions and LKG remain unchanged",
    );
  }
  if (run.status !== 0) {
    const sourceFailures = lines.filter((line) => line.startsWith("RCD_TASK ") && line.includes("SOURCE_HELD_LKG")).length;
    const supervisorFailures = lines.filter((line) => line.startsWith("RCD_TASK ") && line.includes("SUPERVISOR_FAILURE")).length;
    const exit = run.status ?? `signal ${run.signal ?? "none"}`;
    if (sourceFailures > 0) {
      console.error(`  routine civic data: ${sourceFailures} verified source failure receipt(s) held exact LKG (exit ${exit})`);
    }
    if (supervisorFailures > 0) {
      console.error(
        `  routine civic data: ${supervisorFailures} supervisor/process failure(s); ` +
          `exact durable source dispositions, if any, remain authoritative and unaltered (exit ${exit})`,
      );
    }
    if (sourceFailures === 0 && supervisorFailures === 0) {
      console.error(
        `  routine civic data: runner process failed outside exact durable source receipt classification; ` +
        `no source disposition was fabricated or changed (exit ${exit})`,
      );
    }
    await persistOuterRoutineChildFailure(cycleId, startedAt, run, `${run.stdout ?? ""}\n${run.stderr ?? ""}`);
  }
}

async function runPublishNow(deadlineMs: number): Promise<void> {
  if (provider !== "postgres" || canary) return;
  const startedAt = new Date().toISOString();
  const [run] = await runRuntimeChildren([{
    id: "publish-now",
    databaseBytesPerRun: 137_544_447,
    executable: process.execPath,
    args: [...TS_CHILD, "scripts/publish-now-runner.mts"],
    env: withPassDeadline(standingChildEnvironment("ROUTINE_SUPERVISOR", { ...process.env, [ROUTINE_SUPERVISOR_STARTED_AT_ENV]: startedAt }), deadlineMs),
  }], {
    cwd: CODE_ROOT,
    env: process.env,
    deadlineMs,
    maxBufferBytes: 16 * 1024 * 1024,
    onStdout: (_id, output) => process.stdout.write(output),
    onStderr: (_id, output) => process.stderr.write(output),
  });
  if (!run) throw new Error("PUBLISH_NOW_CHILD_RESULT_MISSING");
  if (run.status !== 0) {
    await persistOuterRoutineChildFailure(routineSupervisorCycleId(hostname(), startedAt, "publish-now"), startedAt, run,
      `${run.stdout ?? ""}\n${run.stderr ?? ""}`, "publish-now");
  }
}

/** Each state's map runs in its own lane, one at a time, with the same source children, receipts and launch log as the
 * routine pass, so the routine pass's time and memory never hold it back. */
async function runPlaceMaps(deadlineMs: number): Promise<void> {
  if (provider !== "postgres" || canary) return;
  if (!jobLaunchAllowed("place-maps")) return;
  const startedAt = new Date().toISOString();
  const [run] = await runRuntimeChildren([{
    id: "place-maps",
    databaseBytesPerRun: 16_777_216,
    executable: process.execPath,
    args: [...TS_CHILD, "scripts/routine-civic-data-runner.mts", "--place-maps"],
    env: withPassDeadline(standingChildEnvironment("ROUTINE_SUPERVISOR", { ...process.env, [ROUTINE_SUPERVISOR_STARTED_AT_ENV]: startedAt }), deadlineMs),
  }], {
    cwd: CODE_ROOT,
    env: process.env,
    deadlineMs,
    maxBufferBytes: 16 * 1024 * 1024,
    onStdout: (_id, output) => process.stdout.write(output),
    onStderr: (_id, output) => process.stderr.write(output),
  });
  if (!run) throw new Error("PLACE_MAPS_CHILD_RESULT_MISSING");
  if (run.status !== 0) {
    await persistOuterRoutineChildFailure(routineSupervisorCycleId(hostname(), startedAt, "place-maps"), startedAt, run,
      `${run.stdout ?? ""}\n${run.stderr ?? ""}`, "place-maps");
  }
}

async function persistOuterRoutineChildFailure(
  cycleId: string,
  startedAt: string,
  run: Awaited<ReturnType<typeof runRuntimeChildren>>[number],
  output: string,
  lane: RoutineSupervisorLane = "routine-civic-data",
): Promise<void> {
  const name = lane === "publish-now" ? "publish now" : lane === "place-maps" ? "state place maps" : "routine civic data";
  const outer = routineSupervisorOuterEvidence({
    output,
    termination: run.termination,
    exitStatus: run.status,
  });

  const fatal = childFatalLine(output);
  const childSummary = parseRoutineSupervisorFailureSummary(output, cycleId);
  const evidence = { ...outer, detail: `${outer.detail}${run.errorMessage ? ` ${run.errorMessage}` : ""}${fatal ? ` The child's own last line: ${fatal}.` : ""}` };
  try {
    const repos = await ownerRepositories();
    if (repos === null) throw new Error("production control plane is not configured");

    const existing = (await repos.ownerDigests.readRecentWhere(DIGEST_LOG_KEY, ["digestId"], cycleId, 20,
      { runtimeOutcome: ["kind"] }, startedAt) as readonly Pick<OwnerDigestRecord, "runtimeOutcome">[]).find(
      (row) => row.runtimeOutcome?.kind === "ROUTINE_CIVIC_DATA_SUPERVISOR",
    );
    if (existing) {
      console.error(`  ${name}: canonical supervisor incident ${cycleId} was already persisted by the child`);
      return;
    }
    const finishedAt = new Date().toISOString();
    const outcome = routineCivicDataSupervisorOutcome({
      lane,
      cycleId,
      startedAt,
      finishedAt,
      testedSha: RUNNING_CODE_SHA,
      host: hostname(),
      provider,
      durable: true,
      attemptedTasks: evidence.attemptedTasks,
      verifiedSourceSuccesses: evidence.verifiedSourceSuccesses,
      verifiedSourceFailures: evidence.verifiedSourceFailures,
      failures: [...(childSummary?.examples ?? []), { taskId: `${lane}-runner`, code: evidence.code, detail: evidence.detail }],
    });
    const recorded = childSummary ? { ...outcome, summary: {
      failureCount: childSummary.total + 1,
      failuresByCode: { ...childSummary.counts, [evidence.code]: (childSummary.counts[evidence.code] ?? 0) + 1 },
      failuresOmitted: childSummary.total + 1 - outcome.failures.length,
      readerReadbacksOmitted: 0, taskReceiptsOmitted: 0, crashedTasksOmitted: 0, linesOmitted: 0,
    } } : outcome;
    await appendRoutineCivicDataSupervisorDigest(repos, {
      outcome: recorded,
      lines: [
        `${name.toUpperCase()} OUTER SUPERVISOR FAILED — ${evidence.code}`,
        evidence.detail,
        ...(childSummary ? [`The child's failure counts: ${Object.entries(childSummary.counts).map(([code, count]) => `${code}=${count}`).join(", ")}.`] : []),
        "The standing parent recorded this because the bounded child ended nonzero; exact source receipts remain the only source-disposition authority.",
      ],
    });
    console.error(`  ${name}: outer supervisor incident persisted for Admin as ${cycleId}`);
  } catch (error) {
    console.error(
      `  ${name}: outer supervisor incident could not reach canonical Admin storage ` +
        `(${error instanceof Error ? error.name : "error"}); the standing runner will retry and no source disposition was changed`,
    );
  }
}

async function runIntakeRuntime(deadlineMs: number): Promise<void> {
  if (!jobLaunchAllowed("intake-runtime")) return;
  if (provider !== "postgres" || canary) {
    console.log("  intake runtime: skipped — only the standing production runner owns this observation");
    return;
  }
  const startedAt = new Date().toISOString();
  const [run] = await runRuntimeChildren([{
    id: "intake-runtime",
    databaseBytesPerRun: 22_277,
    executable: process.execPath,
    args: [...TS_CHILD, "scripts/intake-tripwire.mts"],
    env: withPassDeadline(standingChildEnvironment("INTAKE_RUNTIME"), deadlineMs),
  }], {
    cwd: CODE_ROOT,
    env: process.env,
    deadlineMs,

    maxBufferBytes: 16 * 1024 * 1024,

  });
  if (!run) throw new Error("INTAKE_RUNTIME_CHILD_RESULT_MISSING");
  const receiptLines = `${run.stdout ?? ""}${run.stderr ?? ""}`
    .split("\n")
    .filter((line) => line.startsWith("INTAKE_RUNTIME_RECEIPT="));
  let observation: IntakeRuntimeObservation | null = null;
  if (receiptLines.length === 1) {
    try {
      observation = parseIntakeRuntimeObservation(JSON.parse(receiptLines[0].slice("INTAKE_RUNTIME_RECEIPT=".length)));
    } catch {
      observation = null;
    }
  }
  if (observation === null || (run.status !== 0 && observation.outcome !== "UNREADABLE")) {
    observation = unreadableIntakeRuntimeObservation(
      startedAt,
      `The standing intake child returned ${receiptLines.length} readable receipt line(s) and exit ${run.status ?? `signal ${run.signal ?? "none"}`}; no healthy verdict was recorded.`,
    );
  }
  assertAggregateOnly(observation, "standing intake runtime observation");
  try {
    const repos = await ownerRepositories();
    if (repos === null) throw new Error("the production control-plane connection is not configured");
    assertDurableRepositories(repos, "intake runtime outcome history");
    const finishedAt = new Date().toISOString();
    const outcome = intakeRuntimeObservationOutcome({
      startedAt,
      finishedAt,
      testedSha: RUNNING_CODE_SHA,
      host: hostname(),
      provider: repos.describe(),
      durable: repos.durable,
      observation,
    });
    await appendIntakeRuntimeObservationDigest(repos, {
      outcome,
      lines: [
        `INTAKE RUNTIME ${observation.outcome} — ${observation.detail}`,
        "The append-only owner outcome log is canonical; the runner heartbeat is only its latest projection.",
        "No Git write, deploy, software Build check, or release event was created.",
      ],
    });
    console.log(`  INTAKE_RUNTIME ${observation.outcome}: durable outcome ${outcome.cycleId} appended`);

    try {
      const current = await repos.runnerHeartbeat.read(RUNNER_ID);
      const currentObservation = current?.value.intakeRuntime === undefined || current.value.intakeRuntime === null
        ? null
        : parseIntakeRuntimeObservation(current.value.intakeRuntime);
      if (currentObservation !== null && Date.parse(currentObservation.observedAt) > Date.parse(observation.observedAt)) {
        console.error(
          `  intake runtime: append-only outcome ${outcome.cycleId} retained; heartbeat already projects a newer observation`,
        );
        return;
      }
      const base: RunnerHeartbeat = current?.value ?? {
        formatVersion: OWNER_SURFACE_FORMAT_VERSION,
        beatAt: observation.observedAt,
        lastCycleStartedAt: null,
        lastCycleFinishedAt: null,
        nextCycleDueAt: null,
        lastCycleOk: null,
        testedSha: RUNNING_CODE_SHA,
        host: hostname(),
        codeIdentity: readCodeIdentity({ cwd: CODE_ROOT, runnerTestedSha: RUNNING_CODE_SHA, now: observation.observedAt, fetch: false }),
      };
      const next: RunnerHeartbeat = { ...base, intakeRuntime: observation };
      if (current === null) await repos.runnerHeartbeat.put(RUNNER_ID, next, observation.observedAt);
      else await repos.runnerHeartbeat.compareAndSet(RUNNER_ID, current.revision, next, observation.observedAt);
      console.log(`  intake runtime: heartbeat now projects ${outcome.cycleId}`);
    } catch (error) {
      console.error(
        `  intake runtime: durable outcome retained, but the latest heartbeat projection could not be updated ` +
          `(${error instanceof Error ? error.message : String(error)})`,
      );
    }
  } catch (error) {
    console.error(
      `  intake runtime: append-only outcome could not be persisted (${error instanceof Error ? error.message : String(error)}); ` +
        "the runner continues, and no software release or Git write is attempted",
    );
  }
}

let currentCycleErrors = "";

let currentCycleOutput = "";
let researchCycleChild: ChildProcess | null = null;

const RELEASE_QUICK_SWITCH = process.env.WTP_RELEASE_QUICK_SWITCH === "1";
/** One bounded staging at a time, for the newest target only; its state rides on the standing heartbeat. */
const releaseStaging = new ReleaseStaging({ root: ROOT, log: line => console.log(`  ${line}`), error: line => console.error(`  ${line}`) });

type StagedReleaseStep = "STAGING" | "SWITCHED" | "DRAIN";
const parentChangeReported = new Set<string>();
async function advanceStagedRelease(targetSha: string): Promise<StagedReleaseStep> {
  const staged = releaseStaging.advance(targetSha, CODE_ROOT === ROOT ? [] : [CODE_ROOT]);
  if (staged === "STAGING") return "STAGING";
  if (staged === "FAILED" || !RELEASE_QUICK_SWITCH || PARENT_CODE_SHA === null) return "DRAIN";
  const parent = await parentCodeChanged({ root: ROOT, parentSha: PARENT_CODE_SHA, targetSha, run: defaultAsyncRunCommand });
  if (parent.changed) {
    if (!parentChangeReported.has(targetSha)) {
      parentChangeReported.add(targetSha);
      console.log(`  release ${targetSha.slice(0, 8)} changes the runner's own code (${parent.why.slice(0, 3).join(", ")}${parent.why.length > 3 ? ", …" : ""}); it loads by the drain-and-restart path`);
    }
    return "DRAIN";
  }
  const directory = stagedReleaseDirectory(ROOT, targetSha);

  const previous = RUNNING_CODE_SHA;
  CODE_ROOT = directory;
  RUNNING_CODE_SHA = targetSha;
  runtimeContracts.request(targetSha, directory);
  console.log(`  release ${targetSha.slice(0, 8)} switched without a drain: new children start from it; children already running finish on ${previous?.slice(0, 8) ?? "the code they loaded"}; partition admissions continued`);
  return "SWITCHED";
}

const pendingRestart = new PendingRestart();
let releaseCheck: Promise<void> | null = null;
/** The standing clock looks for a new release every minute, whether or not a research cycle is running. */
function checkReleaseForRestart(): void {
  if (!AUTO_RELEASE_HANDOFF || pendingRestart.target !== null || releaseCheck !== null) return;
  releaseCheck = (async () => {
    const release = await inspectRuntimeRelease();
    if (release.state !== "UPDATE_REQUIRED" || release.targetSha === null) return;
    if (await advanceStagedRelease(release.targetSha) !== "DRAIN") return;
    holdForRestart(release.targetSha);
  })().catch(error => {
    console.error(`  runtime release inspection failed (${error instanceof Error ? error.name : "error"}); standing work continues and the next minute looks again`);
  }).finally(() => { releaseCheck = null; });
}

/** No new standing run starts; the runs already started end by their deadlines, research ends its current wave, and the main loop wakes to restart. */
function holdForRestart(targetSha: string): void {
  if (!pendingRestart.mark(targetSha)) return;
  runtimeAdmissionsHeld = true;
  const running = standingRuntimeScheduler.inFlightIds();
  console.log(`  release ${targetSha.slice(0, 8)} loads by restart: no new standing run starts; ` +
    `${running.length ? `${running.join(", ")} end by their deadlines` : "nothing is running"}, then the runner restarts`);
  drainHunterLane();
  drainMemberLane();
  drainParserLane();
  if (researchCycleActive && researchCycleChild?.connected) researchCycleChild.send({ kind: "RUNTIME_RELEASE_DRAIN" }, error => {
    if (error) console.error("  runtime release drain message could not be delivered; the research cycle ends on its own");
  });
}

function neonBytesReading(nowMs = Date.now()): NonNullable<RunnerHeartbeat["neonBytes"]> {
  keepOwnNeonBytes(nowMs);
  const current = hourStart(nowMs);
  return {
    lastFullHour: summarizeNeonBytes(readNeonBytesHour(VITAL_SIGNS_DIR, hourStart(nowMs - 3_600_000)), 20),
    currentHour: summarizeNeonBytes(readNeonBytesHour(VITAL_SIGNS_DIR, current), 10),
  };
}

let vitalSignsFinalHour = "";
let vitalSignsPartialAt = 0;
let vitalSignsWork: Promise<void> | null = null;
async function writeVitalSigns(hour: string, label: string, nowMs: number): Promise<void> {
  const accounting = readNeonBytesHour(VITAL_SIGNS_DIR, hour);
  console.log(`  ${formatNeonBytesLine(summarizeNeonBytes(accounting, 20), label, label === "last full hour" ? 20 : 10)}`);
  const url = provider === "postgres" ? controlPlaneUrlFromEnv() : null;
  let costs: HourCosts | null = null;
  const sql = url ? neon(url) : null;
  if (sql) {
    try { costs = await readHourCosts(sql, hour); }
    catch (error) { console.error(`  vital signs: the hour's spend could not be read (${error instanceof Error ? error.name : "error"}); spend stays unknown`); }
  }
  const row = composeVitalSignsRow({ accounting, costs, releaseSha: RUNNING_CODE_SHA, writtenAt: new Date(nowMs).toISOString() });
  console.log(`  ${formatVitalSignsLine(row, label)}`);
  if (sql && (await writeVitalSignsRow(sql, row)) === "TABLE_NOT_INSTALLED") {
    console.error("  vital signs: the hourly table is not installed yet; the row is in this journal only");
  }
}
const vitalSignsTimer = setInterval(() => {
  if (vitalSignsWork) return;
  vitalSignsWork = (async () => {
    const nowMs = Date.now();
    keepOwnNeonBytes(nowMs);
    const previous = hourStart(nowMs - 3_600_000);
    if (nowMs - Date.parse(hourStart(nowMs)) >= 120_000 && vitalSignsFinalHour !== previous) {
      vitalSignsFinalHour = previous;
      await writeVitalSigns(previous, "last full hour", nowMs);
      pruneNeonBytes(VITAL_SIGNS_DIR, nowMs);
      if (DATABASE_TRANSFER_DIR) pruneNeonBytes(DATABASE_TRANSFER_DIR, nowMs);
    }
    if (nowMs - vitalSignsPartialAt >= 600_000) {
      vitalSignsPartialAt = nowMs;
      await writeVitalSigns(hourStart(nowMs), "so far this hour", nowMs);
    }
  })().catch(error => {
    console.error(`  vital signs could not be written (${error instanceof Error ? error.name : "error"}); work continues`);
  }).finally(() => { vitalSignsWork = null; });
}, 60_000);
vitalSignsTimer.unref();

async function writeLiveCycleBeat(startedAt: string | null, exit?: { code: number | null; signal: string | null }): Promise<void> {
  if (provider !== "postgres") return;

  const abort = nativeAbortLine(currentCycleErrors);
  const failedRead = neonReadFailureLine(currentCycleErrors);
  const tail = currentCycleErrors.split("\n").filter(line => line && line.trim() !== abort).slice(-8).join("\n");
  let lastError = [abort?.slice(0, 400), failedRead, tail.slice(-1600)].filter(Boolean).join("\n").slice(0, 2000) || null;
  if (lastError) {
    for (const [name, value] of Object.entries(process.env)) {
      if (value && value.length >= 5 && /TOKEN|SECRET|PASSWORD|KEY|DATABASE_URL/.test(name)) lastError = lastError.split(value).join("[private]");
    }
    lastError = lastError.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "[private connection]");
  }
  try {
    const repos = await ownerRepositories();
    if (!repos) return;

    const memory = await hostMemoryReading().catch(() => null);
    let neonBytes: RunnerHeartbeat["neonBytes"] = null;
    try { neonBytes = neonBytesReading(); } catch {  }
    let codeIdentity: RunnerHeartbeat["codeIdentity"] = null;
    if (startedAt === null) {
      try { codeIdentity = readCodeIdentity({ cwd: CODE_ROOT, runnerTestedSha: RUNNING_CODE_SHA, now: new Date().toISOString(), fetch: false }); }
      catch {  }
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const at = new Date().toISOString();
      const current = await repos.runnerHeartbeat.read(RUNNER_ID);

      if (!exit && startedAt !== null && Date.parse(current?.value.lastCycleFinishedAt ?? "") >= Date.parse(startedAt)) return;
      const next = { ...(startedAt === null
        ? standingHeartbeat(current?.value ?? null, { at, testedSha: RUNNING_CODE_SHA, host: hostname(), codeIdentity,
          releaseStaging: releaseStaging.status(), memory, neonBytes })
        : liveCycleHeartbeat(current?.value ?? null, { at, startedAt,
          testedSha: RUNNING_CODE_SHA, host: hostname(), lastError, memory, neonBytes,
          ...(exit ? { finishedAt: at, exitCode: exit.code, signal: exit.signal,
            nextCycleDueAt: new Date(Date.parse(at) + (exit.code === 0 ? INTERVAL_MIN : Math.min(INTERVAL_MIN, 10)) * 60_000).toISOString() } : {}) })), jobs: jobRuns.merged(current?.value.jobs) };
      try {
        if (current) await repos.runnerHeartbeat.compareAndSet(RUNNER_ID, current.revision, next, at);
        else await repos.runnerHeartbeat.put(RUNNER_ID, next, at);
        return;
      } catch (error) { if (attempt === 2) throw error; }
    }
  } catch (error) {
    console.error(`  live cycle heartbeat could not be saved (${error instanceof Error ? error.name : "error"}); work continues`);
  }
}

const BEAT_BOUND_MS = 45_000;
const lateBeat = () => console.error("  live cycle heartbeat did not answer in time; the next beat starts fresh");
/** Startup and the standing clock write which code runs, at most once a minute, whether or not research runs. */
const STANDING_BEAT_MS = 60_000;
let standingBeatAt = 0;
const standingBeat = boundedBeat(async () => {
  if (Date.now() - standingBeatAt < STANDING_BEAT_MS) return;
  standingBeatAt = Date.now();
  await writeLiveCycleBeat(null);
}, BEAT_BOUND_MS, lateBeat);

const POLL_MS = 60_000;
const PAUSE_BEAT_MS = 30 * 60_000;

const INTAKE_RUNTIME_TICK_MS = Math.max(POLL_MS, INTERVAL_MIN * 60_000);
const INTAKE_RUNTIME_BUDGET_MS = 5 * 60_000;
let intentRepos: ControlPlaneRepositories | null = null;
let intentReposOpening: Promise<ControlPlaneRepositories> | null = null;
let controlReader: ReturnType<typeof runnerControlReader> | null = null;
let intentReadFailed = false;
let pauseBeatFailed = false;
let runtimeAdmissionsHeld = false;
let standingRuntimeTimer: ReturnType<typeof setInterval> | null = null;
let ownerControlTimer: ReturnType<typeof setInterval> | null = null;
let adminCopyTimer: ReturnType<typeof setInterval> | null = null;
let scheduledOrderTimer: ReturnType<typeof setInterval> | null = null;
let scheduledOrderWork: Promise<void> | null = null;
let adminCopyWork: Promise<void> | null = null;
let researchCycleActive = false;
let ownerWakePending = false;
let activeControlRead: Promise<void> | null = null;

let announcedPause: string | null = null;
let lastPauseBeatMs = 0;

const actedOn = new Set<string>();
const honorFailurePrinted = new Set<string>();

const CONTINUOUS_HUNTERS = process.env.WTP_CONTINUOUS_HUNTERS === "1";
let hunterLaneChild: ChildProcess | null = null;
async function runHunterLane(deadlineMs: number): Promise<void> {
  if (!CONTINUOUS_HUNTERS || canary || runtimeAdmissionsHeld) return;
  if (!jobLaunchAllowed("hunter-lane")) return;
  const [run] = await runRuntimeChildren([{
    id: "hunter-lane",
    databaseBytesPerRun: 1_907_347_669,
    executable: process.execPath,
    args: [...TS_CHILD, "scripts/hunter-lane.mts", `--provider=${provider}`],
    env: withPassDeadline(standingChildEnvironment("RESEARCH_CYCLE"), deadlineMs),
  }], {
    cwd: CODE_ROOT,
    env: process.env,
    deadlineMs,
    maxBufferBytes: 16 * 1024 * 1024,
    noProgressMs: RUNTIME_NO_PROGRESS_MS,
    onStdout: (_id, output) => process.stdout.write(output),
    onStderr: (_id, output) => process.stderr.write(output),
    onStarted: (_id, child) => { hunterLaneChild = child; },
  });
  hunterLaneChild = null;
  if (!run) throw new Error("HUNTER_LANE_CHILD_RESULT_MISSING");
  if (run.status !== 0) throw new Error(`HUNTER_LANE_EXITED: ${run.status ?? `signal ${run.signal ?? "none"}`}; queued work remains owed and the lane starts again`);
}

function drainHunterLane(): void {
  if (!hunterLaneChild?.connected) return;
  hunterLaneChild.send({ kind: "RUNTIME_RELEASE_DRAIN" }, error => {
    if (error) console.error("  hunter lane drain message could not be delivered; the lane ends at the end of its life");
  });
}

let memberLaneChild: ChildProcess | null = null;
async function runMemberLane(deadlineMs: number): Promise<void> {
  if (canary || runtimeAdmissionsHeld || provider !== "postgres" || !jobLaunchAllowed("legistar-members")) return;
  const [run] = await runRuntimeChildren([{id:"legistar-members",databaseBytesPerRun:LEGISTAR_MEMBER_DATABASE_BYTES,
    executable:process.execPath,args:[...TS_CHILD,"scripts/legistar-members-worker.mts"],
    env:withPassDeadline(standingChildEnvironment("ROUTINE_SUPERVISOR"),deadlineMs)}],{
    cwd:CODE_ROOT,env:process.env,deadlineMs,maxBufferBytes:16*1024*1024,noProgressMs:RUNTIME_NO_PROGRESS_MS,
    onStdout:(_id,output)=>process.stdout.write(output),onStderr:(_id,output)=>process.stderr.write(output),
    onStarted:(_id,child)=>{memberLaneChild=child;}});
  memberLaneChild=null;
  if(!run || run.status!==0) throw Error("Legistar members stopped; queued records remain due");
}
function drainMemberLane():void {
  if(memberLaneChild?.connected)memberLaneChild.send({kind:"RUNTIME_RELEASE_DRAIN"},error=>{if(error)console.error("Legistar member drain failed",error);});
}

// Expected SQL request and response bytes for one 55-minute turn: claims, page copies, fact checks and new links.
const PARSER_LANE_DATABASE_BYTES = 150_000_000;
let parserLaneChild: ChildProcess | null = null;
/** Reads the links on the work list with the reader of each kind of website; the lane ends at its life and starts again. */
async function runParserLane(deadlineMs: number): Promise<void> {
  if (canary || runtimeAdmissionsHeld || provider !== "postgres" || !jobLaunchAllowed("parser-lane")) return;
  const [run] = await runRuntimeChildren([{ id: "parser-lane", databaseBytesPerRun: PARSER_LANE_DATABASE_BYTES,
    executable: process.execPath, args: [...TS_CHILD, "scripts/parser-worker.mts"],
    env: withPassDeadline(standingChildEnvironment("ROUTINE_SUPERVISOR"), deadlineMs) }], {
    cwd: CODE_ROOT, env: process.env, deadlineMs, maxBufferBytes: 16 * 1024 * 1024, noProgressMs: RUNTIME_NO_PROGRESS_MS,
    onStdout: (_id, output) => process.stdout.write(output), onStderr: (_id, output) => process.stderr.write(output),
    onStarted: (_id, child) => { parserLaneChild = child; } });
  parserLaneChild = null;
  if (!run || run.status !== 0) throw new Error("The page readers stopped; the links they had remain on the work list");
}
function drainParserLane(): void {
  if (parserLaneChild?.connected) parserLaneChild.send({ kind: "RUNTIME_RELEASE_DRAIN" }, error => { if (error) console.error("Page reader drain failed", error); });
}

const auditPasses = auditPassClock({
  statePath: join(ROOT, ".mirror", "audit-pass-clock.json"),
  codeRoot: () => CODE_ROOT,
  env: () => standingChildEnvironment("CONSOLE_PUBLISHER"),
});

const censusMemory = routineProcessSlots();
async function runPlatformCensus(deadlineMs: number): Promise<void> {
  if (provider !== "postgres" || canary || runtimeAdmissionsHeld) return;
  if (!jobLaunchAllowed("platform-census")) return;
  const release = await censusMemory.acquire("platform-census-runner.mts", Date.now() + 60_000);
  try {
    const [run] = await runRuntimeChildren([{
      id: "platform-census",
      databaseBytesPerRun: 11_852_414, executable: process.execPath,
      args: [...TS_CHILD, "scripts/platform-census-runner.mts"],
      env: withPassDeadline(standingChildEnvironment("ROUTINE_SUPERVISOR"), deadlineMs),
    }], { cwd: CODE_ROOT, env: process.env, maxBufferBytes: 16 * 1024 * 1024, deadlineMs,
      onStarted: (_id, child) => { if (child.pid) release.observe?.(child.pid); },
      onStdout: (_id, output) => process.stdout.write(output), onStderr: (_id, output) => process.stderr.write(output) });
    if (!run || run.status !== 0) throw new Error(`CENSUS_LANE_FAILED: ${run?.errorMessage ?? run?.status ?? "no child result"}`);
  } finally { release(); }
}

/** Place pages are built by the runner, the one process holding the production write address. */
const placePageMemory = routineProcessSlots({ admissionsOpen: () => !runtimeAdmissionsHeld });
let placePagePauseUnread = false;
async function placePagesAdmitted(): Promise<boolean> {
  // Asked before every turn: each turn is a launch, so a slowed run spaces its turns out.
  if (runtimeAdmissionsHeld || !jobLaunchAllowed("place-pages")) return false;
  try {
    const repos = await ownerRepositories();
    if (repos && readIntents([...await readRunnerPauseIntents(repos)]).runnerPause.paused) return false;
    placePagePauseUnread = false;
  } catch (error) {
    if (!placePagePauseUnread) console.error(`  place pages: the owner's pause could not be read (${error instanceof Error ? error.message : String(error)}); no turn starts until it reads`);
    placePagePauseUnread = true;
    return false;
  }
  return !runtimeAdmissionsHeld;
}

async function runPlacePageTurn(deadlineMs: number): Promise<PlacePageTurn> {
  const release = await placePageMemory.acquire("rebuild-place-pages.mts", Math.min(deadlineMs, Date.now() + 60_000));
  try {
    const [run] = await runRuntimeChildren([{
      id: "place-pages",
      databaseBytesPerRun: 32_000_000, executable: process.execPath,
      args: [...TS_CHILD, "scripts/rebuild-place-pages.mts"],
      env: withPassDeadline(standingChildEnvironment("ROUTINE_SUPERVISOR"), deadlineMs),
    }], { cwd: CODE_ROOT, env: process.env, maxBufferBytes: 16 * 1024 * 1024, deadlineMs: deadlineMs + PLACE_PAGE_TURN_GRACE_MS,
      onStarted: (_id, child) => { if (child.pid) release.observe?.(child.pid); },
      onStdout: (_id, output) => process.stdout.write(output), onStderr: (_id, output) => process.stderr.write(output) });
    const result = run?.status === 0 ? placePageTurnResult(run.stdout ?? "") : null;
    if (!result) throw new Error(`PLACE_PAGE_TURN_FAILED: ${run?.errorMessage ?? run?.status ?? "no child result"}`);
    return result;
  } finally { release(); }
}

async function runPlacePages(deadlineMs: number): Promise<void> {
  if (provider !== "postgres" || canary) return;
  await drainPlacePageQueue({ deadlineMs, admitted: placePagesAdmitted, turn: runPlacePageTurn, log: line => console.log(line) });
}

/**
 * Hot meeting doors are looked at in their own standing turn, several websites at once, so a new meeting shows within
 * the hour. The turn runs in this process and starts no child, so bulk workers holding the host's memory never delay it.
 */
async function runDoorProbes(deadlineMs: number): Promise<void> {
  if (provider !== "postgres" || canary || runtimeAdmissionsHeld) return;
  if (!jobLaunchAllowed(DOOR_PROBES_JOB.id)) return;
  const repos = await ownerRepositories();
  if (!repos) return;
  await runStandingDoorProbes({ repos, readerQuery: readerFactDb().query, deadlineMs,
    admitted: () => !runtimeAdmissionsHeld, log: line => console.log(line) });
}

const standingRuntimeScheduler = new IndependentRuntimeLaneScheduler([
  savedKeysLane(async () => {
    if (provider === "postgres" && !canary) await keysRunnerPass();
  }),
  { id: "platform-census", everyMs: CENSUS_LANE_INTERVAL_MS, budgetMs: CENSUS_LANE_BUDGET_MS, run: runPlatformCensus },
  { id: "routine-civic-data", everyMs: ROUTINE_DATA_ADMISSION_MS, budgetMs: ROUTINE_PASS_BUDGET_MS, run: runRoutineCivicData },
  { id: "intake-runtime", everyMs: INTAKE_RUNTIME_TICK_MS, budgetMs: INTAKE_RUNTIME_BUDGET_MS, run: runIntakeRuntime },
  // The lane retires at its life; the wall covers the last task a worker still holds.
  { id: "legistar-members", everyMs: 60_000, budgetMs: 55*60_000, run: runMemberLane },
  { id: "hunter-lane", everyMs: 60_000, budgetMs: HUNTER_LANE_LIFE_MS + HUNTER_WORKER_WALL_MS, run: runHunterLane },
  { id: "parser-lane", everyMs: 60_000, budgetMs: 55 * 60_000, run: runParserLane },
  placePagesLane(runPlacePages),
  publishNowLane(runPublishNow),
  placeMapsLane(runPlaceMaps),
  doorProbesLane(runDoorProbes),
], (outcome) => {
  if (outcome.state === "FAILED") {
    jobRuns.failed(outcome.id, outcome.error);
    console.error(`  ${outcome.id}: standing operation failed — ${outcome.error}`);
  } else jobRuns.completed(outcome.id);
}, id => jobRuns.started(id));
// A lane whose run may outlast its launch interval finishes at most once per run budget.
for (const lane of standingRuntimeScheduler.lanes) jobRuns.register(lane.id, Math.max(lane.everyMs, lane.budgetMs));

async function ownerRepositories(): Promise<ControlPlaneRepositories | null> {
  if (provider !== "postgres") return null;
  if (intentRepos === null) {
    const url = controlPlaneUrlFromEnv();
    if (url === null) return null;
    intentReposOpening ??= createPgRepositories(url, new Date().toISOString());
    try { intentRepos = await intentReposOpening; }
    finally { intentReposOpening = null; }
  }
  return intentRepos;
}

function runAdminCopyTick(): void {
  if (runtimeAdmissionsHeld || adminCopyWork || provider !== "postgres" ||
      process.env.WTP_ADMIN_EVIDENCE_REQUESTS_ENABLED !== "1" ||
      !process.env.NETLIFY_SITE_ID || !process.env.NETLIFY_BLOBS_TOKEN) return;
  adminCopyWork = (async () => {
    const repos = await ownerRepositories();
    if (!repos) return;
    const result = await runAuthorizedAdminCopyTick({ repos, vaultRoot: join(ROOT, ...VAULT_DIR), env: {
      WTP_ADMIN_EVIDENCE_REQUESTS_ENABLED: process.env.WTP_ADMIN_EVIDENCE_REQUESTS_ENABLED,
      NETLIFY_SITE_ID: process.env.NETLIFY_SITE_ID,
      NETLIFY_BLOBS_TOKEN: process.env.NETLIFY_BLOBS_TOKEN,
    } });
    if (result.examined) console.log(`  private Admin exact-copy request: copied ${result.copied}, refused ${result.refused}, pending ${result.pending}`);
  })().catch(error => {
    console.error(`  private Admin exact-copy request remains owed (${error instanceof Error ? error.name : "unknown failure"}); no availability was claimed`);
  }).finally(() => { adminCopyWork = null; });
}

function startAdminCopyClock(): void {
  if (runtimeAdmissionsHeld || adminCopyTimer !== null || provider !== "postgres" ||
      process.env.WTP_ADMIN_EVIDENCE_REQUESTS_ENABLED !== "1" ||
      !process.env.NETLIFY_SITE_ID || !process.env.NETLIFY_BLOBS_TOKEN) return;
  runAdminCopyTick();
  adminCopyTimer = setInterval(runAdminCopyTick, ADMIN_COPY_POLL_MS);
}

async function stopAdminCopyClock(): Promise<void> {
  if (adminCopyTimer !== null) { clearInterval(adminCopyTimer); adminCopyTimer = null; }
  if (adminCopyWork) await adminCopyWork;
}

async function readRunnerControls(repos: ControlPlaneRepositories, force = false) {
  if (controlReader === null) {
    const url = controlPlaneUrlFromEnv();
    if (url === null) throw new Error("RUNNER_CONTROLS_UNCONFIGURED");
    controlReader = runnerControlReader(url, repos);
  }
  return controlReader.read(force);
}

const SCHEDULED_ORDER_POLL_MS = 60_000;
const SCHEDULED_ORDERS_JOB = "scheduled-orders";
function runScheduledOrderTick(): void {
  if (runtimeAdmissionsHeld || scheduledOrderWork || provider !== "postgres" || canary) return;
  jobRuns.started(SCHEDULED_ORDERS_JOB);
  scheduledOrderWork = (async () => {
    const repos = await ownerRepositories();
    if (!repos) return;
    const fired = await fireDueOrders({ repos, now: () => new Date().toISOString(), currentStateVersion: null,
      codeSha: RUNNING_CODE_SHA, wake: wakeHintWriterFromEnv() }, new Date().toISOString());
    for (const order of fired) {
      console.log(`  scheduled order ${order.id} (${order.orderType}) due ${order.occurrence}: ${order.ok ? "sent" : "refused by the gateway"}`);
    }
    jobRuns.finished(SCHEDULED_ORDERS_JOB);
  })().catch(error => {
    jobRuns.failed(SCHEDULED_ORDERS_JOB, error instanceof Error ? error.message : String(error));
    console.error(`  scheduled orders could not be checked (${error instanceof Error ? error.name : "error"}); the next tick tries again`);
  }).finally(() => { scheduledOrderWork = null; });
}

function startScheduledOrderClock(): void {
  if (runtimeAdmissionsHeld || scheduledOrderTimer !== null || provider !== "postgres" || canary) return;
  jobRuns.register(SCHEDULED_ORDERS_JOB, SCHEDULED_ORDER_POLL_MS);
  runScheduledOrderTick();
  scheduledOrderTimer = setInterval(runScheduledOrderTick, SCHEDULED_ORDER_POLL_MS);
}

async function stopScheduledOrderClock(): Promise<void> {
  if (scheduledOrderTimer !== null) { clearInterval(scheduledOrderTimer); scheduledOrderTimer = null; }
  if (scheduledOrderWork) await scheduledOrderWork;
}

function runStandingRuntimeTick(reason: string, force = false): void {
  if (!canary) void standingBeat();
  checkReleaseForRestart();
  if (runtimeAdmissionsHeld) return;
  const launched = standingRuntimeScheduler.tick(Date.now(), force);
  if (launched.length > 0) {
    console.log(`  standing runtime tick: ${reason} — launched ${launched.join(", ")}`);
  }
}

function startStandingRuntimeClock(): void {
  if (runtimeAdmissionsHeld || standingRuntimeTimer !== null) return;
  startScheduledOrderClock();

  if (provider === "postgres" && !canary && !STAGING) auditPasses.start();
  runStandingRuntimeTick("independent standing clock startup", true);
  standingRuntimeTimer = setInterval(
    () => {
      runStandingRuntimeTick("independent standing clock");
    },
    POLL_MS,
  );

  ownerControlTimer = setInterval(() => {
    if (researchCycleActive && !canary && activeControlRead === null) {
      activeControlRead = ownerSays().then(says => {
        if (says === "START_NOW") ownerWakePending = true;
      }).catch(error => {
        console.error(`  active runner controls could not be applied: ${error instanceof Error ? error.message : String(error)}`);
      }).finally(() => { activeControlRead = null; });
    }
    },
    CONTROL_WAKE_POLL_MS,
  );
}

let standingDrainFailed = false;
async function holdStandingRuntimeAtQuiescence(): Promise<void> {
  runtimeAdmissionsHeld = true;
  drainHunterLane();
  if (standingRuntimeTimer !== null) {
    clearInterval(standingRuntimeTimer);
    standingRuntimeTimer = null;
  }
  if (ownerControlTimer !== null) { clearInterval(ownerControlTimer); ownerControlTimer = null; }
  try {
    await waitForRuntimeQuiescence(async () => {
      await stopAdminCopyClock();
      await stopScheduledOrderClock();
      await activeControlRead;
      await standingRuntimeScheduler.waitForIdle();
      await auditPasses.stop();
    }, { reason: "release handoff quiescence" });
  } catch (error) {
    standingDrainFailed = true;
    throw error;
  }
}

function releaseInspectionRefusal(code: string, detail: string, targetSha: string | null = null): RuntimeReleaseInspection {
  return {
    state: "REFUSED",
    code,
    detail,
    runningSha: RUNNING_CODE_SHA ?? "unknown",
    targetSha,
    reliedOn: [],
  };
}

async function inspectRuntimeRelease(): Promise<RuntimeReleaseInspection> {
  const served = await fetchServedCommit(process.env.WTP_RUNTIME_BASE_URL ?? PRODUCTION_BASE_URL, {
    runId: `pilot-runtime-release:${process.pid}`, timeoutMs: 15_000,
  });
  const repository = runtimeGithubRepository(ROOT);
  if (repository === null) return releaseInspectionRefusal("GITHUB_ORIGIN_UNRESOLVED", "runtime origin is not a GitHub repository", served.sha);
  const checkRuns = typeof served.sha === "string" && /^[0-9a-f]{40}$/i.test(served.sha)
    ? await fetchGithubCheckRuns({ repository, sha: served.sha, token: runtimeGithubCredential({ root: ROOT, env: process.env }) })
    : null;
  return inspectNewestDeployedRuntimeRelease({ runningSha: RUNNING_CODE_SHA, served, checkRuns,
    readDeploys: () => fetchRuntimeProductionDeploys({
      siteId: process.env.NETLIFY_SITE_ID ?? process.env.WTP_BLOBS_SITE_ID,
      token: process.env.NETLIFY_AUTH_TOKEN ?? process.env.NETLIFY_TOKEN ?? process.env.WTP_BLOBS_TOKEN ?? process.env.NETLIFY_BLOBS_TOKEN,
    }),
    readChecks: sha => fetchGithubCheckRuns({ repository, sha, token: runtimeGithubCredential({ root: ROOT, env: process.env }) }),
  });
}

async function persistRuntimeBoundaryFailure(
  result: Pick<RuntimeReleaseInspection, "code" | "detail" | "targetSha">,
  startedAt: string,
  context: {
    readonly taskId: string;
    readonly headline: string;
  } = { taskId: "runtime-code-handoff", headline: "RUNTIME CODE HANDOFF HELD" },
): Promise<void> {
  const finishedAt = new Date().toISOString();
  try {
    writeRuntimeReleaseHold(ROOT, {
      formatVersion: 1,
      state: "HELD",
      code: result.code,
      detail: result.detail,
      runningSha: RUNNING_CODE_SHA,
      targetSha: result.targetSha,
      taskId: context.taskId,
      observedAt: finishedAt,
    });
  } catch (error) {
    console.error(`  runtime release hold could not be written locally (${error instanceof Error ? error.name : "error"})`);
  }
  try {
    const repos = await ownerRepositories();
    if (repos === null) throw new Error("production control plane is not configured");
    const outcome = routineCivicDataSupervisorOutcome({
      cycleId: `${context.taskId}:${finishedAt}`,
      startedAt,
      finishedAt,
      testedSha: RUNNING_CODE_SHA,
      host: hostname(),
      provider,
      durable: true,
      attemptedTasks: 0,
      verifiedSourceSuccesses: 0,
      verifiedSourceFailures: 0,
      failures: [{ taskId: context.taskId, code: result.code, detail: result.detail }],
    });
    await appendRoutineCivicDataSupervisorDigest(repos, {
      outcome,
      lines: [
        `${context.headline} — ${result.code}`,
        result.detail,
        "Routine source admissions are closed; no candidate, pointer, LKG, Git commit, build, or deploy was attempted.",
      ],
    });
    console.error(`  ${context.taskId} HELD and persisted for Admin: ${result.code} — ${result.detail}`);
  } catch (error) {
    console.error(
      `  ${context.taskId} HELD but its canonical Admin receipt could not be persisted ` +
        `(${error instanceof Error ? error.name : "error"}); the ignored host hold remains and no source admission resumes`,
    );
  }
}

async function reconcileRuntimeReleaseAtBoundary(): Promise<number | null> {
  if (!AUTO_RELEASE_HANDOFF) return null;
  const startedAt = new Date().toISOString();
  const recovered = resumeRuntimeReleaseInstall({ root: ROOT });
  if (recovered?.state === "REFUSED") {
    await persistRuntimeBoundaryFailure(recovered, startedAt);
    return 2;
  }
  if (recovered?.state === "UPDATED") {
    console.log(`  ${recovered.detail}; restarting after recovered install to load the installed dependencies`);
    return 0;
  }
  const first = await inspectRuntimeRelease();
  if (first.state === "CURRENT") {
    pendingRestart.clear();
    runtimeAdmissionsHeld = false;
    startStandingRuntimeClock();
    startAdminCopyClock();
    runtimeContracts.request(RUNNING_CODE_SHA, CODE_ROOT);
    return null;
  }

  const reopenStandingClock = standingRuntimeTimer !== null;
  const reopenAdminCopyClock = adminCopyTimer !== null;

  if (RELEASE_QUICK_SWITCH && first.state === "UPDATE_REQUIRED" && first.targetSha !== null && reopenStandingClock && !runtimeAdmissionsHeld) {
    const step = await advanceStagedRelease(first.targetSha);
    if (step !== "DRAIN") return null;
  }
  try { await holdStandingRuntimeAtQuiescence(); }
  catch (error) {
    await persistRuntimeBoundaryFailure(releaseInspectionRefusal("RUNTIME_DRAIN_NO_PROGRESS",
      error instanceof Error ? error.message : String(error), first.targetSha), startedAt);
    return 2;
  }
  if (first.state === "REFUSED") {
    await persistRuntimeBoundaryFailure(first, startedAt);
    return 2;
  }

  const final = await inspectRuntimeRelease();
  if (final.state === "REFUSED") {
    await persistRuntimeBoundaryFailure(final, startedAt);
    return 2;
  }
  if (final.state === "CURRENT") {
    pendingRestart.clear();
    runtimeAdmissionsHeld = false;
    if (reopenStandingClock) startStandingRuntimeClock();
    if (reopenAdminCopyClock) startAdminCopyClock();
    return null;
  }
  if (final.targetSha !== first.targetSha || final.targetSha === null) {
    const changed = releaseInspectionRefusal(
      "DEPLOYED_TARGET_CHANGED_DURING_DRAIN",
      `deployment target changed while runtime lanes drained (${first.targetSha ?? "unknown"} -> ${final.targetSha ?? "unknown"})`,
      final.targetSha,
    );
    await persistRuntimeBoundaryFailure(changed, startedAt);
    return 2;
  }

  const applied = applyRuntimeRelease({ root: ROOT, targetSha: final.targetSha });
  if (applied.state === "REFUSED") {
    await persistRuntimeBoundaryFailure(applied, startedAt);
    return 2;
  }
  await discardStagedReleases(ROOT).catch(() => undefined);
  console.log(`  ${applied.detail}; exiting for the stable Scheduled Task launcher to relaunch this exact code`);
  return 0;
}

let runtimeContractChild: ChildProcess | null = null;
let runtimeContractsStopping = false;
const runtimeContracts = runtimeContractRetry({
  run: applyRuntimeContracts,
  cancelActive: async () => { runtimeContractsStopping = true; if (runtimeContractChild) await endOwnedProcessTree(runtimeContractChild); },
  onError: async (error, sha) => {
    if (runtimeContractsStopping) return;
    console.error(`  contract migration attempt failed: ${error instanceof Error ? error.message : String(error)}; collection continues`);
    await persistRuntimeBoundaryFailure(releaseInspectionRefusal("PRODUCTION_CONTRACT_MIGRATION_FAILED",
      "Production cleanup failed; collection continues and cleanup will retry automatically.", sha), new Date().toISOString(),
      { taskId: "production-contract-migrations", headline: "PRODUCTION CLEANUP NEEDS ANOTHER TRY" });
  },
});
async function applyRuntimeContracts(sha: string, cwd: string): Promise<boolean> {
  const deadlineMs = Date.now() + RUNTIME_CONTRACT_ATTEMPT_MS;
  // CP-01's one-time, checkpointed backlog used at most 90,725,008 bytes in one bounded copy attempt.
  const [result] = await runRuntimeChildren([{ id: "production-contract-migrations", databaseBytesPerRun: 100_000_000, executable: process.execPath,
    args: [...TS_CHILD, "scripts/db-apply.mts", "--target=production", "--phase=contract",
      "--production-runtime", `--runtime-commit=${sha}`] }], {
    cwd, env: withPassDeadline(process.env, deadlineMs), maxBufferBytes: 16 * 1024 * 1024,
    deadlineMs,
    onStarted: (_id, child) => { runtimeContractChild = child; },
    onStdout: (_id, output) => process.stdout.write(output),
    onStderr: (_id, output) => process.stderr.write(output),
  }).finally(() => { runtimeContractChild = null; });
  if (result?.status === 0) return true;
  if (result && runtimeContractContinues(result.status, `${result.stdout}\n${result.stderr}`)) return false;
  if (runtimeContractsStopping) return false;
  await persistRuntimeBoundaryFailure(releaseInspectionRefusal("PRODUCTION_CONTRACT_MIGRATION_FAILED",
    "Production cleanup failed; collection continues and cleanup will retry automatically.", sha), new Date().toISOString(),
    { taskId: "production-contract-migrations", headline: "PRODUCTION CLEANUP NEEDS ANOTHER TRY" });
  return false;
}

function unhonoredResume(log: readonly ResearchIntent[]): ResearchIntentRequest | null {
  const honored = new Set(log.filter((r) => r.kind === "HONORED").map((r) => r.honors));
  const resumes = log
    .filter((r): r is ResearchIntentRequest => r.kind === "INTENT" && r.action === "RESUME_RUNNER")
    .sort((a, b) => (a.requestedAt < b.requestedAt ? -1 : a.requestedAt > b.requestedAt ? 1 : 0));
  const latest = resumes.at(-1) ?? null;
  return latest !== null && !honored.has(latest.intentId) ? latest : null;
}

async function honorRunnerIntent(
  repos: ControlPlaneRepositories,
  intent: ResearchIntentRequest,
  detail: string,
): Promise<boolean> {
  const id = `${intent.intentId}:honored`;
  const at = new Date().toISOString();
  try {
    const committed = await repos.researchIntents.append(
      RESEARCH_INTENT_LOG_KEY,
      id,
      {
        formatVersion: RESEARCH_FORMAT_VERSION,
        kind: "HONORED",
        intentId: id,
        honors: intent.intentId,
        action: intent.action,
        honoredAt: at,
        honoredBy: `pilot-runner@${hostname()}#${process.pid}`,
        detail,
      },
      at,
    );
    controlReader?.rememberResearchAppend(committed);
    return true;
  } catch (error) {
    if (!honorFailurePrinted.has(intent.intentId)) {
      honorFailurePrinted.add(intent.intentId);
      console.error(
        `  intent ${intent.intentId} (${intent.action}) could not be marked honored ` +
          `(${error instanceof Error ? error.message : String(error)}); retried at the next poll. This is printed once.`,
      );
    }
    return false;
  }
}

async function beatWhilePaused(repos: ControlPlaneRepositories, intent: ResearchIntentRequest): Promise<void> {
  const now = new Date().toISOString();
  const current = await repos.runnerHeartbeat.read(RUNNER_ID);
  const base: RunnerHeartbeat = current?.value ?? {
    formatVersion: OWNER_SURFACE_FORMAT_VERSION,
    beatAt: now,
    lastCycleStartedAt: null,
    lastCycleFinishedAt: null,
    nextCycleDueAt: null,
    lastCycleOk: null,
    testedSha: RUNNING_CODE_SHA,
    host: hostname(),

    codeIdentity: readCodeIdentity({ cwd: CODE_ROOT, runnerTestedSha: RUNNING_CODE_SHA, now, fetch: false }),
  };
  const next: RunnerHeartbeat = {
    ...base,
    beatAt: now,
    nextCycleDueAt: null,
    nextCycleReason: null,
    pause: { intentId: intent.intentId, since: intent.requestedAt, note: intent.note },
  };
  if (current === null) await repos.runnerHeartbeat.put(RUNNER_ID, next, now);
  else await repos.runnerHeartbeat.compareAndSet(RUNNER_ID, current.revision, next, now);
}

type OwnerSays = "HOLD" | "START_NOW" | "NOTHING" | "UNREADABLE";

async function ownerSays(): Promise<OwnerSays> {

  if (provider !== "postgres") return "NOTHING";
  let repos: ControlPlaneRepositories | null;
  let log: readonly ResearchIntent[];
  let controls: Awaited<ReturnType<typeof readRunnerControls>>;
  try {
    repos = await ownerRepositories();
    if (repos === null) throw new Error(`${CONTROL_PLANE_URL_VAR} is not set, so the control plane cannot be opened`);
    controls = await readRunnerControls(repos);
    log = controls.research;
  } catch (error) {
    if (!intentReadFailed) {
      intentReadFailed = true;
      console.error(
        `  research intents could not be read while waiting (${error instanceof Error ? error.message : String(error)}); ` +
          "the ordinary interval stands, and each cycle runs with its paid model lane held closed until the log reads again. " +
          "This is printed once.",
      );
    }
    return "UNREADABLE";
  }
  const reading = readIntents(log);
  const pause = reading.runnerPause;

  if (pause.paused && pause.intent !== null) {
    jobRuns.held(RESEARCH_JOB, `Paused by you in Admin since ${formatEastern(pause.intent.requestedAt)}.`);
    if (announcedPause !== pause.intent.intentId) {
      announcedPause = pause.intent.intentId;
      lastPauseBeatMs = 0;
      console.log(`  runner paused by owner since ${pause.intent.requestedAt}: ${pause.intent.note ?? "(no reason given)"}`);
    }
    if (pause.honored === null) {
      await honorRunnerIntent(repos, pause.intent, researchCycleActive
        ? "pause applied; the current cycle is settling and no next cycle starts until RESUME_RUNNER"
        : "idling on the owner's pause; no cycle starts until RESUME_RUNNER");
    }
    if (Date.now() - lastPauseBeatMs >= PAUSE_BEAT_MS) {
      try {
        await beatWhilePaused(repos, pause.intent);
        lastPauseBeatMs = Date.now();
      } catch (error) {
        if (!pauseBeatFailed) {
          pauseBeatFailed = true;
          console.error(
            `  the paused heartbeat could not be written (${error instanceof Error ? error.message : String(error)}); ` +
              "the dashboard may read this deliberate pause as SILENT. Retried at the next poll; this is printed once.",
          );
        }
      }
    }
    return "HOLD";
  }
  announcedPause = null;
  if(controls.planningPending)return "START_NOW";

  const resume = unhonoredResume(log);
  if (resume !== null) {
    const first = !actedOn.has(resume.intentId);
    actedOn.add(resume.intentId);
    await honorRunnerIntent(repos, resume, researchCycleActive
      ? "resumed; next cycle follows the current active cycle"
      : "resumed; next cycle starts now");
    if (first) {
      console.log(
        `  runner resumed by owner (${resume.requestedAt}${resume.note ? `: ${resume.note}` : ""}) — ` +
          (researchCycleActive ? "next cycle follows the current active cycle" : `starting the next cycle now at ${new Date().toISOString()}`),
      );
      return "START_NOW";
    }
  }
  if (reading.pendingRunNow.length > 0) {
    if (!researchCycleActive) console.log(`  a RUN_CYCLE_NOW intent is pending — starting the next cycle early at ${new Date().toISOString()}`);
    return "START_NOW";
  }
  if (!reading.paused && reading.pendingDispatch.length > 0) {
    const first = reading.pendingDispatch[0];
    if (!researchCycleActive) console.log(
      `  ${reading.pendingDispatch.length} DISPATCH intent(s) pending (oldest: "${first.note ?? ""}") — ` +
        `starting the next cycle early at ${new Date().toISOString()}`,
    );
    return "START_NOW";
  }

  if (!reading.paused) {
    const resumeId = unacknowledgedResearchResume(log);
    if (resumeId !== null) {
      console.log(`  research resumed by owner (${resumeId}) — starting the next cycle now`);
      return "START_NOW";
    }

  }
  return "NOTHING";
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function recoverExitedWindowHolder(before: string): Promise<string | null> {
  let repos: ControlPlaneRepositories | null;
  try {
    repos = await ownerRepositories();
  } catch {
    return null;
  }
  if (repos === null) return null;
  try {
    const outcome = await releaseWindowLeaseOfExitedLocalHolder(repos, {
      host: hostname(),
      now: new Date().toISOString(),
      processExists,
    });
    if (outcome.state !== "RELEASED") return null;
    const line =
      `released the window lease that exited process ${outcome.holder} left behind (it would have held until ` +
      `${outcome.expiresAt}), before the ${before}`;
    console.log(`  ${line}`);
    return line;
  } catch (error) {
    console.error(
      `  the window lease could not be checked before the ${before} (${error instanceof Error ? error.message : String(error)}); ` +
        "the child's own acquisition decides",
    );
    return null;
  }
}

async function sleepUnlessRunNow(totalMs: number): Promise<void> {
  if (ownerWakePending) { ownerWakePending = false; return; }
  const until = Date.now() + totalMs;
  while (Date.now() < until) {
    await pendingRestart.sleep(Math.min(CONTROL_WAKE_POLL_MS, until - Date.now()));
    if (pendingRestart.target !== null) return;

    const says = await ownerSays();
    if (says === "START_NOW") return;

    if (says === "HOLD") continue;
  }
}

let lifetimeHuntStalledCycles = 0;

async function nextCycleWaitMs(cycleOk: boolean): Promise<number> {
  const ordinary = (cycleOk ? INTERVAL_MIN : Math.min(INTERVAL_MIN, 10)) * 60_000;
  if (provider !== "postgres" || canary) return ordinary;
  try {
    const repos = await ownerRepositories();
    if (repos === null) return ordinary;
    const currentBeat=await repos.runnerHeartbeat.read(RUNNER_ID);
    if(currentBeat?.value.nextCycleReason)await repos.runnerHeartbeat.compareAndSet(RUNNER_ID,currentBeat.revision,{...currentBeat.value,nextCycleReason:null},new Date().toISOString());
    const { research: intents } = await readRunnerControls(repos, true);
    const intent = readIntents(intents);
    if (intent.runnerPause.paused || intent.paused) return ordinary;
    const continuation=await readPlanningContinuation(repos,cycleOk,lifetimeHuntStalledCycles);
    if(!continuation)return ordinary;
    const {hunt,lifetime}=continuation;
    if(lifetime?.reason==="ELIGIBLE_ZERO_DISPATCH")lifetimeHuntStalledCycles=Math.min(lifetimeHuntStalledCycles+1,2);
    else if(lifetime?.reason==="DUE_AFTER_PROGRESS")lifetimeHuntStalledCycles=0;
    const requestedWaitMs = lifetime?.delayMs ?? POLL_MS;
    const waitMs = cycleOk ? requestedWaitMs : Math.min(requestedWaitMs, ordinary);
    const reason = lifetime?.reason === "ELIGIBLE_ZERO_DISPATCH"
      ? `Directed hunt ${hunt.label}: eligible work remains without a dispatch; bounded retry in ${waitMs / 60_000} minutes.`
      : hunt.due > hunt.dispatched
        ? `Directed hunt ${hunt.label}: ${hunt.due - hunt.dispatched} due member obligations remain after this cycle.`
        : `Directed hunt ${hunt.label}: downstream verification or publication remains after dispatch; next bounded cycle in ${waitMs / 1000} seconds.`;
    const nextAt = new Date(Date.now() + waitMs).toISOString();
    try {
      const current = await repos.runnerHeartbeat.read(RUNNER_ID);
      if (current !== null && current.value.testedSha === RUNNING_CODE_SHA) {
        await repos.runnerHeartbeat.compareAndSet(RUNNER_ID, current.revision, {
          ...current.value,
          nextCycleDueAt: nextAt,
          nextCycleReason: reason,
        }, new Date().toISOString());
      }
    } catch (error) {
      console.error(`  directed-hunt next-cycle heartbeat could not be updated: ${error instanceof Error ? error.message : String(error)}`);
    }
    console.log(`  directed hunt ${hunt.label}: ${hunt.dispatched} of ${hunt.due} due member obligations dispatched; next bounded cycle in ${waitMs / 1000}s`);
    return waitMs;
  } catch (error) {
    console.error(`  directed-hunt continuation could not be read; ordinary interval stands: ${error instanceof Error ? error.message : String(error)}`);
    return ordinary;
  }
}

async function holdWhilePaused(): Promise<{ readonly ownerIntentsUnreadable: boolean }> {
  if (canary) return { ownerIntentsUnreadable: false };
  let says = await ownerSays();
  while (says === "HOLD" && pendingRestart.target === null) {
    await pendingRestart.sleep(CONTROL_WAKE_POLL_MS);
    says = await ownerSays();
  }
  return { ownerIntentsUnreadable: says === "UNREADABLE" };
}

// The breaker's first check writes this release's snapshot before anything can launch, including the standing clock a
// release handoff reopens below.
if (provider === "postgres" && !STAGING && !canary) jobRuns.register(JOB_BREAKER_JOB, JOB_BREAKER_INTERVAL_MS);
await jobTransferTick();
let handoffExitCode = await reconcileRuntimeReleaseAtBoundary();
let cycle = 0;

async function researchCycle(cycle: number, owner: { readonly ownerIntentsUnreadable: boolean }) {
  const startedAt = new Date().toISOString();
  console.log(
    `\npilot-runner · cycle ${cycle} started ${startedAt}` +
      (owner.ownerIntentsUnreadable ? " — the owner's intents could not be read, so its paid model lane is held closed" : ""),
  );

  jobRuns.started(RESEARCH_JOB, startedAt);
  const leaseRecovered = await recoverExitedWindowHolder("research cycle");
  researchCycleActive = true;
  currentCycleErrors = "";
  currentCycleOutput = "";
  const beat = boundedBeat(() => writeLiveCycleBeat(startedAt), BEAT_BOUND_MS, lateBeat);
  const lastBeat = (exit: { code: number | null; signal: string | null }) =>
    boundedBeat(() => writeLiveCycleBeat(startedAt, exit), BEAT_BOUND_MS, lateBeat)();
  await beat();
  let cycleBeat = Promise.resolve();
  const cycleBeatTimer = setInterval(() => {
    if (!researchCycleActive) return;
    cycleBeat = beat();
  }, 60_000);
  const result = await runOneCycle(owner).finally(async () => {
    researchCycleActive = false;
    researchCycleChild = null;
    clearInterval(cycleBeatTimer);
    await cycleBeat;
  }).catch(async error => {
    currentCycleErrors = error instanceof Error ? error.message : "research child launch failed";
    jobRuns.failed(RESEARCH_JOB, currentCycleErrors);
    await lastBeat({ code: null, signal: null });
    throw error;
  });
  await activeControlRead;
  if (result.ok) jobRuns.finished(RESEARCH_JOB);
  else jobRuns.failed(RESEARCH_JOB, result.circuit ? `${result.circuit.provider}: ${result.circuit.condition}`
    : nativeAbortLine(result.stderrTail) ?? result.stderrTail.split("\n").filter(Boolean).at(-1) ?? `exit ${result.exitCode ?? result.signal}`);
  await lastBeat({ code: result.exitCode, signal: result.signal });
  if (result.circuit) {
    const c = result.circuit;
    const headline = `${new Date().toISOString()} - cycle ${cycle} - CIRCUIT BROKEN - ${c.provider} latched until ${c.eligibleAt}`;
    const digest =
      `# Pilot digest — cycle ${cycle}, ${today()}\n\n` +
      `## FLEET SAFETY\n\n- **CIRCUIT BROKEN**\n- provider: ${c.provider}\n- exact condition: ${c.condition}\n` +
      `- first observed: ${c.firstObservedAt}\n- work deferred: ${c.workDeferred.join("; ")}\n` +
      `- next automated eligibility: ${c.eligibleAt}\n- no provider probe, paid substitution, control-plane test write, or promotion was attempted\n`;
    const delivered = deliver(digest, headline);
    console.error(`  ${headline}`);
    console.log(`  digest: ${delivered.where}`);

    return { ok: false, waitMs: async () => INTERVAL_MIN * 60_000 };
  }
  let record: RunRecord = {};
  if (result.recordPath !== null && existsSync(result.recordPath)) {
    try {
      record = JSON.parse(readFileSync(result.recordPath, "utf8")) as RunRecord;
    } catch (error) {
      console.error(
        `  the local cycle diagnostic at ${result.recordPath} could not be parsed (${
          error instanceof Error ? error.message : String(error)
        }). The digest will say the cycle produced no readable record rather than reporting zeros.`,
      );
    }
  } else {
    console.error(
      "  this cycle produced NO readable local diagnostic. Its canonical outcome is authoritative; the mirror digest says the child failed — it is " +
        "not a cycle with nothing to report.",
    );
  }

  const stagedRows = record.staged ?? [];
  const discharge = floored(
    "obligations DISCHARGED",
    "what this cycle dispatched",
    record.dispatched ?? 0,
    record.workedCount ?? (record.worked ?? []).length,
    (record.dispatched ?? 0) === 0
      ? "this cycle dispatched nothing, so there is no population to measure a discharge rate over"
      : undefined,
  );
  const readiness = floored(
    "staged entries PROMOTION-READY",
    "this cycle's promotion tail",
    stagedRows.length,
    stagedRows.filter((s) => s.state === "STAGED_PROMOTION_READY").length,
    stagedRows.length === 0 ? "this cycle staged nothing" : undefined,
  );

  const budgetLine = (record.digest ?? []).find((l) => l.includes("dispatch budget"));
  const budgetSpent = budgetLine !== undefined && /SPENT/.test(budgetLine);
  const headline =
    `${new Date().toISOString()} - cycle ${cycle} - ` +
    `${floorLine(discharge)} - ${floorLine(readiness)} - ` +
    `health ${record.health?.green ? "GREEN" : "NOT GREEN"} - ` +
    (budgetSpent ? "dispatch budget SPENT, rest deferred by name - " : "") +
    `exit ${result.ok ? "clean" : "NON-ZERO"}`;

  let failureSection = "";
  if (!result.ok) {
    failureSection =
      "\n## WHY THE CYCLE DID NOT FINISH\n\n" +
      `- process signal: ${result.signal ?? "none (the child exited non-zero on its own)"}\n` +
      "- last stderr lines from the cycle:\n\n```\n" +
      (result.stderrTail || "(the child wrote nothing to stderr)") +
      "\n```\n";
    console.error(
      `  the cycle exited NON-ZERO${result.signal ? ` (signal ${result.signal})` : ""}; last stderr:\n` +
        (result.stderrTail || "    (nothing on stderr)")
          .split("\n")
          .map((l) => `    ${l}`)
          .join("\n"),
    );
  }

  const beforeSection = leaseRecovered === null ? "" : `\n## BEFORE THE CYCLE\n\n- ${leaseRecovered}\n`;
  const delivered = deliver(buildDigest(record, cycle, today(), result.ok) + beforeSection + failureSection, headline);
  console.log(`  digest: ${delivered.where}`);
  console.log(`  ${headline}`);

  await publishConsole();
  return { ok: result.ok, waitMs: async () => {
    const waitMs = await nextCycleWaitMs(result.ok);
    return result.failedAtMs === undefined ? waitMs : Math.max(0, waitMs - (Date.now() - result.failedAtMs));
  } };
}

if (handoffExitCode === null) {
console.log(
  `pilot-runner · control plane ${provider}, interval ${INTERVAL_MIN} min, ` +
    `${CYCLES === Infinity ? "running until stopped" : `${CYCLES} cycle(s)`}\n` +
    `  singleton: ${PILOT_PROCESS_LEASE.host}:${PILOT_PROCESS_LEASE.port}\n` +
    `  digest: ${DIGEST_DIR}`,
);

console.log("\npilot-runner · publishing the console before the first cycle (the runner may have just come up on new code)");

jobBreakerTimer = setInterval(() => { void jobTransferTick(); },JOB_BREAKER_INTERVAL_MS);
jobBreakerTimer.unref();
startStandingRuntimeClock();
startAdminCopyClock();
await publishConsole();

const loop = await runResearchLoop({
  cycles: CYCLES,
  waitForOwner: holdWhilePaused,
  releaseExit: reconcileRuntimeReleaseAtBoundary,
  // A slowed launch waits its spaced turn; jobLaunchAllowed names the wait on the heartbeat, where the line keeper reads it.
  hold: () => jobLaunchAllowed(RESEARCH_JOB) ? null : BREAKER_SLOWED,
  held: () => pendingRestart.sleep(CONTROL_WAKE_POLL_MS),
  cycle: (n, owner) => { cycle = n; return researchCycle(n, owner); },
  sleep: sleepUnlessRunNow,
  recover: async error => {
    if (!isControlPlaneRequestTimeout(error)) throw error;
    researchCycleActive = false;
    researchCycleChild = null;
    console.error(controlPlaneTimeoutLine(error));
    await sleepUnlessRunNow(POLL_MS);
  },
});
handoffExitCode = loop.exitCode;
}

if (jobBreakerTimer !== null) clearInterval(jobBreakerTimer);
await jobBreakerWork;
if (standingRuntimeTimer !== null) clearInterval(standingRuntimeTimer);
if (ownerControlTimer !== null) clearInterval(ownerControlTimer);
await runtimeContracts.stop();
if (!standingDrainFailed) {
  try {
    await waitForRuntimeQuiescence(async () => {
      await stopAdminCopyClock();
      await stopScheduledOrderClock();
      await activeControlRead;
      await standingRuntimeScheduler.waitForIdle();
      await auditPasses.stop();
    }, { reason: "runner shutdown" });
  } catch (error) {
    standingDrainFailed = true;
    handoffExitCode = 2;
    await persistRuntimeBoundaryFailure(releaseInspectionRefusal("RUNTIME_DRAIN_NO_PROGRESS",
      error instanceof Error ? error.message : String(error)), new Date().toISOString());
  }
}
if (hangWatchdog !== null) await hangWatchdog.stop();
await PILOT_PROCESS_LEASE.release();
if (handoffExitCode === null) {
  console.log(`\npilot-runner · ${cycle} cycle(s) complete. Canonical outcomes are in the owner control-plane log; disposable diagnostics are under ${RUNS_DIR}.`);
} else {
  process.exitCode = handoffExitCode;
}

if (handoffExitCode !== null) process.exit(handoffExitCode);
