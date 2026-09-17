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

import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";
import {
  classifyRoutineChildOutcome,
  durableRoutineRunnerReceiptIssue,
  parseMeetingPartitionRunnerReceipts,
  parseRoutineRunnerReceipt,
  successfulRoutineRunnerReceiptIssue,
} from "../lib/civic-data/runner-receipt.ts";
import {
  ROUTINE_FAILURE_DOMAIN_FRONTIER_PER_PASS,
  ROUTINE_SOURCE_TASKS,
  ROUTINE_SUPERVISOR_STARTED_AT_ENV,
  readRoutineTaskClocks,
  routineFailureDomainFrontier,
  routineFailureDomainRotationSeed,
  routineSupervisorCycleId,
  routineTaskDue,
  routineTaskSelection,
  routineUnreceiptedSupervisorAttemptHistory,
  type RoutineSupervisorAttemptHistory,
  type RoutineTaskClock,
  type RoutineSourceTask,
} from "../lib/civic-data/runner.ts";
import {
  MEETING_PARTITION_CONTRACTS,
  observableRoutineContracts,
} from "../lib/civic-data/meeting-partitions.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import {
  ROUTINE_CHILD_CONCURRENCY,
  ROUTINE_CHILD_MAX_BUFFER_BYTES,
  ROUTINE_CHILD_TIMEOUT_MS,
  runBoundedChildPass,
  type BoundedChildResult,
} from "../lib/civic-data/bounded-child-pass.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "../lib/civic-data/manual-contracts.ts";
import {
  ROUTINE_READER_CHILD_CONCURRENCY,
  ROUTINE_READER_SINGLE_TIMEOUT_MS,
  reconcileRoutineReaderRepairDomain,
  routineReaderRepairDomains,
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
import type {
  RoutineCivicDataReaderReadbackReference,
  RoutineCivicDataTaskReceiptReference,
} from "../lib/control-plane/owner-surface.ts";
import {
  CONTROL_PLANE_URL_VAR,
  controlPlaneUrlFromEnv,
  createPgRepositories,
} from "../lib/control-plane/repository/pg-store.ts";
import { assertDurableRepositories } from "../lib/control-plane/repository/types.ts";
import { assertWriteAllowed } from "../lib/db/write-guard.ts";
import { resolveProductionWriteHandle } from "../lib/db/write-handle.ts";
import { floored } from "../lib/ops/denominator-floor.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import {
  admittedRuntimeChildEnvironment,
  assertRuntimeAuthority,
} from "../lib/civic-data/runtime-authority.ts";

const ROOT = process.cwd();
const FORCE = process.argv.includes("--force");
const TASK_SELECTION = routineTaskSelection(process.argv.slice(2));
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
const RUNNING_CODE_SHA = TASK_SELECTION.ok
  ? assertRuntimeAuthority({ capabilities: ["ROUTINE_SUPERVISOR"] }).sha
  : null;

// Manual invocation and the standing pilot share this same atomic host-local
// door. A second runner fails before opening the store or reading due clocks;
// the kernel releases the lease if this process dies.
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
 * rotate it behind its same-provider siblings. Its append-only supervisor
 * fault is the operational attempt clock. Reading that clock from the same
 * owner log Admin consumes prevents one broken partition from monopolizing a
 * shared publisher frontier without fabricating a source attempt.
 */
async function latestUnreceiptedSupervisorAttempts(): Promise<RoutineSupervisorAttemptHistory> {
  const connection = controlPlaneUrlFromEnv();
  if (connection === null) {
    throw new Error(`${CONTROL_PLANE_URL_VAR} is not configured; provider-frontier fairness cannot be proved.`);
  }
  const repos = await createPgRepositories(connection, RUN_STARTED_AT, { skipBootstrap: true });
  assertDurableRepositories(repos, "routine civic-data provider-frontier history");
  const taskIds = new Set(ROUTINE_SOURCE_TASKS.map(({ id }) => id));
  return routineUnreceiptedSupervisorAttemptHistory(
    /* Only supervisor outcomes matter here; fetch them by kind, not the whole log. */
    await repos.ownerDigests.readWhere(DIGEST_LOG_KEY, ["runtimeOutcome", "kind"], "ROUTINE_CIVIC_DATA_SUPERVISOR"),
    taskIds,
  );
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
  readonly failures: readonly SupervisorFailure[];
  readonly attemptedTasks: number;
  readonly verifiedSourceSuccesses: number;
  readonly verifiedSourceFailures: number;
  readonly finishedAt: string;
  readonly taskReceipts: readonly RoutineCivicDataTaskReceiptReference[];
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
      ...input.failures.map((failure) => `${failure.taskId}: ${failure.code} — ${failure.detail}`),
      "Source outcomes were attributed only from exact durable receipts; the supervisor neither fabricated nor altered candidates, pointers, or LKG.",
    ],
  });
  return cycleId;
}

if (ROUTINE_DATA_PROCESS_LEASE !== null) {
const handle = resolveProductionWriteHandle();
process.env.DATABASE_URL = handle.connection;
process.env.WTP_DB_ROLE = "production";
process.env.WTP_SANCTIONED_WRITE = "routine-civic-data-promotion";
assertWriteAllowed("a routine civic data candidate/version promotion");
const store = new PostgresRoutineDataStore();
let attempted = 0;
let verifiedSourceSuccesses = 0;
let verifiedSourceFailures = 0;
const supervisorFailures: SupervisorFailure[] = [];
const pendingRuns: PendingRun[] = [];
const verifiedTaskReceipts: RoutineCivicDataTaskReceiptReference[] = [];
const dueCandidates: { readonly pending: PendingRun; readonly clock: RoutineTaskClock | undefined }[] = [];

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
  });
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
const selectedTasks = ROUTINE_SOURCE_TASKS.filter((task) => !ONLY || ONLY.has(task.id));
const clockReads = FORCE
  ? selectedTasks.map((task) => ({ task, ok: true as const, clock: undefined, error: null }))
  : await readRoutineTaskClocks(
      selectedTasks,
      (task) => store.clock(task.sourceId, task.recordClass, task.scope),
    );
for (const read of clockReads) {
  const { task } = read;
  if (!read.ok) {
    const detail = safeFailure(read.error);
    supervisorFailures.push({ taskId: task.id, code: "DURABLE_CLOCK_READ_FAILED", detail });
    console.error(`RCD_TASK ${task.id}: SUPERVISOR_FAILURE (CANNOT_TELL) — ${detail}`);
    continue;
  }
  const durableClock: RoutineTaskClock | undefined = read.clock;
  if (!FORCE && !routineTaskDue(task, durableClock, admissionNowMs)) {
    console.log(`RCD_SKIP ${task.id}: cadence not due`);
    continue;
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

let supervisorAttempts: ReadonlyMap<string, string> = new Map();
try {
  const history = await latestUnreceiptedSupervisorAttempts();
  supervisorAttempts = history.attempts;
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
  const detail = safeFailure(error instanceof Error ? error.message : String(error));
  supervisorFailures.push({
    taskId: "routine-civic-data-provider-frontier",
    code: "SUPERVISOR_HISTORY_READ_FAILED",
    detail,
  });
  console.error(`RCD_TASK routine-civic-data-provider-frontier: SUPERVISOR_FAILURE (CANNOT_TELL) — ${detail}`);
}

const admitted = routineFailureDomainFrontier(dueCandidates.map(({ pending, clock }) => ({
  task: pending.task,
  lastConsideredAt: newestConsideredAt(clock, supervisorAttempts.get(pending.task.id)),
})), ROUTINE_FAILURE_DOMAIN_FRONTIER_PER_PASS, routineFailureDomainRotationSeed(RUN_STARTED_AT));
const admittedIds = new Set(admitted.map(({ task }) => task.id));
for (const candidate of dueCandidates) {
  if (admittedIds.has(candidate.pending.id)) pendingRuns.push(candidate.pending);
  else {
    console.log(
      `RCD_DEFER ${candidate.pending.id}: provider frontier ` +
        `(domain=${candidate.pending.task.acquisitionFailureDomain}; per-pass=${ROUTINE_FAILURE_DOMAIN_FRONTIER_PER_PASS})`,
    );
  }
}
attempted = pendingRuns.length;

console.log(
  `RCD_PASS launching ${pendingRuns.length} isolated command(s) through a bounded pool; ` +
    `concurrency=${ROUTINE_CHILD_CONCURRENCY}; ` +
    `provider-frontier=${ROUTINE_FAILURE_DOMAIN_FRONTIER_PER_PASS}; ` +
    `per-child timeout=${ROUTINE_CHILD_TIMEOUT_MS}ms; per-stream output=${ROUTINE_CHILD_MAX_BUFFER_BYTES} bytes`,
);
const childRuns = await runBoundedChildPass(
  pendingRuns.map((pending) => ({
    id: pending.id,
    // One degraded provider may occupy one lane, never the whole standing
    // pool. Distinct sources keep running and settling independently.
    failureDomain: pending.task.acquisitionFailureDomain,
    executable: process.execPath,
    args: ["--experimental-strip-types", ...pending.command],
    env: admittedRuntimeChildEnvironment({
      parentEnv: process.env,
      capability: "ROUTINE_CONTRACT",
      contract: pending.task.id,
      parentPid: process.pid,
    }),
  })),
  {
    cwd: ROOT,
    env: process.env,
    timeoutMs: ROUTINE_CHILD_TIMEOUT_MS,
    maxBufferBytes: ROUTINE_CHILD_MAX_BUFFER_BYTES,
    concurrency: ROUTINE_CHILD_CONCURRENCY,
    onSettled: async (run, index) => settlePendingRun(pendingRuns[index]!, run),
    // Classification consumes the exact receipt before this worker advances.
    // Retaining only the small result summary bounds memory across the full portfolio.
    discardOutputAfterSettlement: true,
  },
);

for (const run of childRuns) {
  if (run.settlementErrorMessage === null) continue;
  const detail = safeFailure(run.settlementErrorMessage ?? "unknown settlement failure");
  supervisorFailures.push({ taskId: run.id, code: "CHILD_SETTLEMENT_FAILED", detail });
  console.error(`RCD_TASK ${run.id}: SUPERVISOR_FAILURE (CANNOT_TELL) — ${detail}`);
}

async function settlePendingRun(pending: PendingRun, run: BoundedChildResult): Promise<void> {
  if (run.id !== pending.id) {
    const detail = `expected result ${pending.id}; observed ${run.id}`;
    supervisorFailures.push({ taskId: pending.id, code: "BOUNDED_CHILD_RESULT_ORDER_MISMATCH", detail });
    console.error(`RCD_TASK ${pending.id}: SUPERVISOR_FAILURE (CANNOT_TELL) — ${detail}`);
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
      captureTaskReceipt(pending, receipt, "VERIFIED_SOURCE_SUCCESS");
      console.log("RCD_RECEIPT=" + JSON.stringify(receipt));
      console.log(`RCD_TASK ${pending.task.id}: GOOD (${receipt.state})`);
    } else {
      verifiedSourceFailures += 1;
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
    parsed: parsedReceipt,
    durableIssue,
    exitStatus: run.status,
    childDiagnostic: run.status === 0 ? null : safeFailure(`${run.errorMessage ?? ""}\n${output}`),
  });
  if (child.kind === "VERIFIED_SOURCE_SUCCESS") {
    verifiedSourceSuccesses += 1;
    captureTaskReceipt(pending, child.receipt, "VERIFIED_SOURCE_SUCCESS");
    console.log("RCD_RECEIPT=" + JSON.stringify(child.receipt));
    console.log(`RCD_TASK ${pending.task.id}: GOOD (${child.state})`);
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
const readerContracts = [
  ...observableRoutineContracts(),
  ...MANUAL_PRODUCTION_SOURCE_CONTRACTS,
];
const readerDomains = routineReaderRepairDomains(readerContracts);
const readerObservedAt = new Date().toISOString();
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
    detail: safeFailure(`${run.errorMessage ?? ""}\n${run.stdout}\n${run.stderr}`),
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

const readerRuns = await runBoundedChildPass(
  readerDomains.map((domain) => ({
    id: domain.id,
    executable: process.execPath,
    args: [
      "--experimental-strip-types",
      "scripts/routine-civic-data-reader-repair.mts",
      domain.mode === "MEETING_AGGREGATE" ? "--meeting-aggregate" : `--contract=${domain.contracts[0]!.id}`,
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
    onSettled: (run, index) => settleReaderDomain(readerDomains[index]!, run),
    discardOutputAfterSettlement: true,
  },
);
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

try {
  const cycleId = await persistSupervisorOutcome({
    failures: supervisorFailures,
    attemptedTasks: attempted,
    verifiedSourceSuccesses,
    verifiedSourceFailures,
    finishedAt: new Date().toISOString(),
    taskReceipts: [...verifiedTaskReceipts].sort((left, right) => left.taskId.localeCompare(right.taskId)),
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
    detail: safeFailure(error instanceof Error ? error.message : String(error)),
  });
  console.error("RCD_OPERATIONAL_OUTCOME=" + JSON.stringify({
    kind: "ROUTINE_CIVIC_DATA_SUPERVISOR",
    state: "STORE_UNREACHABLE",
    detail: safeFailure(error instanceof Error ? error.message : String(error)),
    durable: false,
  }));
}

const attemptedCount = floored(
  "attempted routine source tasks",
  "the configured routine source/body partition registry",
  ROUTINE_SOURCE_TASKS.length,
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
await ROUTINE_DATA_PROCESS_LEASE.release();
}
