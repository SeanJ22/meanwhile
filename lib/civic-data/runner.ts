import { WORKER_PUBLICATION_TASK_IDS } from "./worker-reader-contracts.ts";
import { VALIDATION_CHECKS, type RoutineRecordClass } from "./types.ts";
import {
  ROUTINE_DATA_ADMISSION_MS,
  ROUTINE_SOURCE_CONTRACTS,
  cadenceMsAt,
  type RoutineSourceContract,
  type SittingWindowSchedule,
} from "./contracts.ts";
import { MEETING_PARTITION_CONTRACTS, onMeetingPartitionsRefreshed, sittingWindowSourceIds } from "./meeting-partitions.ts";
import { sittingWindowHotByConclusion, sittingWindowObligation } from "./sitting-window-admission.ts";
import { SOURCE_AUTHORITIES, authorityFor, sourceAuthority } from "./source-authority.ts";
import { derivedRequestedUrl } from "./derived-door.ts";
import {
  parseRoutineRunnerReceipt,
  successfulRoutineRunnerReceiptIssue,
} from "./runner-receipt.ts";
import { runBoundedWorkPool } from "../ops/bounded-work-pool.ts";
import type { BoundedChildResult } from "./bounded-child-pass.ts";

export function routinePreSpawnMemoryDeferral(run: BoundedChildResult, childStarted: boolean): string | null {
  return !childStarted && run.termination === "SPAWN_FAILED" && run.status === null && run.signal === null &&
    run.stdout === "" && run.stderr === "" && run.errorMessage?.startsWith("WORKER_MEMORY_DEADLINE:")
    ? run.errorMessage : null;
}

export const ROUTINE_SUPERVISOR_STARTED_AT_ENV = "WTP_ROUTINE_SUPERVISOR_STARTED_AT";

export function routineSupervisorCycleId(host: string, startedAt: string, lane: "routine-civic-data" | "publish-now" = "routine-civic-data"): string {
  const parsed = Date.parse(startedAt);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== startedAt) {
    throw new Error(`ROUTINE_SUPERVISOR_STARTED_AT_INVALID:${startedAt}`);
  }
  if (!host.trim() || /[\r\n]/.test(host)) throw new Error("ROUTINE_SUPERVISOR_HOST_INVALID");
  return `${lane}-supervisor:${host}:${startedAt}`;
}

export interface RoutineSourceTask {
  readonly id: string;
  readonly registeredContractId?: string;
  readonly sourceId: string;
  readonly acquisitionFailureDomain: string;
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly requestedUrl: string;
  readonly authorityMode: RoutineSourceContract["acquisitionAdapter"]["authorityMode"];
  readonly parserVersion: string;
  readonly command: readonly string[];
  readonly cadenceMs: number;
  readonly retryMs: number;
  readonly contract: Pick<RoutineSourceContract, "cadence" | "schedule" | "readerProjection">;
  readonly ownerInvocation?: {
    readonly publicationPending?: true;
    readonly requestedAt: string;
    readonly instructions: readonly string[];
  };
}

export function routineTaskFromContract(contract: RoutineSourceContract): RoutineSourceTask {
  if (contract.authorityConstraint.registry !== "SOURCE_AUTHORITIES" || contract.authorityConstraint.sourceId !== contract.sourceId) {
    throw new Error(`ROUTINE_CONTRACT_AUTHORITY_MISMATCH:${contract.id}`);
  }
  if (
    contract.validationContract.length !== VALIDATION_CHECKS.length ||
    contract.validationContract.some((check, index) => check !== VALIDATION_CHECKS[index])
  ) throw new Error(`ROUTINE_CONTRACT_VALIDATION_MISMATCH:${contract.id}`);
  if (!contract.autoPromotable) throw new Error(`ROUTINE_CONTRACT_NOT_AUTO_PROMOTABLE:${contract.id}`);
  const authority = contract.acquisitionAdapter.authorityMode === "SINGLE_ROUTE"
    ? authorityFor(contract.sourceId, contract.recordClass, contract.acquisitionAdapter.requestedUrl)
    : contract.acquisitionAdapter.authorityMode === "DERIVED"
    ? (() => {
        const registered = sourceAuthority(contract.sourceId);
        return registered !== null && registered.derivedPromotion !== undefined &&
            (registered.recordClasses as readonly RoutineRecordClass[]).includes(contract.recordClass) &&
            registered.routePrefixes.length === 0
          ? { ok: true as const, contract: registered }
          : { ok: false as const, code: "DERIVED_AUTHORITY_INVALID" };
      })()
    : (() => {
        const registered = SOURCE_AUTHORITIES[contract.sourceId];
        return (registered.recordClasses as readonly RoutineRecordClass[]).includes(contract.recordClass) && registered.routePrefixes.length > 0
          ? { ok: true as const, contract: registered }
          : { ok: false as const, code: "REGISTERED_SOURCE_ROUTES_INVALID" };
      })();
  if (!authority.ok || !authority.contract.routineAutoPromotion) {
    throw new Error(`ROUTINE_CONTRACT_AUTHORITY_REFUSED:${contract.id}:${authority.ok ? "SOURCE_NOT_AUTO_PROMOTABLE" : authority.code}`);
  }
  if (authority.contract.parserVersion !== contract.parserNormalizerVersion) {
    throw new Error(`ROUTINE_CONTRACT_PARSER_MISMATCH:${contract.id}`);
  }
  return {
    id: contract.id,
    sourceId: contract.sourceId,
    acquisitionFailureDomain: "acquisitionFailureDomain" in contract &&
        typeof contract.acquisitionFailureDomain === "string"
      ? contract.acquisitionFailureDomain
      : `routine-source:${contract.sourceId}`,
    recordClass: contract.recordClass,
    scope: contract.scope,
    requestedUrl: contract.acquisitionAdapter.authorityMode === "SINGLE_ROUTE"
      ? contract.acquisitionAdapter.requestedUrl
      : contract.acquisitionAdapter.authorityMode === "DERIVED"
        ? derivedRequestedUrl(contract.sourceId, contract.scope)
        : "",
    authorityMode: contract.acquisitionAdapter.authorityMode,
    parserVersion: contract.parserNormalizerVersion,
    command: contract.acquisitionAdapter.command,
    cadenceMs: contract.cadence.defaultEveryMs,
    retryMs: contract.retry.afterMs,
    contract,
  };
}

const routineSourceTasks = (): RoutineSourceTask[] => [...ROUTINE_SOURCE_CONTRACTS, ...MEETING_PARTITION_CONTRACTS].map(routineTaskFromContract);
/** Every standing task, the meeting doors' partitions included; replaced in place whenever this process installs the doors. */
export const ROUTINE_SOURCE_TASKS: readonly RoutineSourceTask[] = routineSourceTasks();
onMeetingPartitionsRefreshed(() => {
  (ROUTINE_SOURCE_TASKS as RoutineSourceTask[]).splice(0, ROUTINE_SOURCE_TASKS.length, ...routineSourceTasks());
});

/** At most one child from any shared upstream per pass; the next pass rotates to the least-recently-considered task. */
export const ROUTINE_FAILURE_DOMAIN_FRONTIER_PER_PASS = 1;
/** A sitting-window lane takes up to three reads a pass, run one after another with the same-host gap. Other lanes take one. */
export const SITTING_WINDOW_LANE_SLOTS_PER_PASS = 3;
export { ROUTINE_DATA_ADMISSION_MS };
export const ROUTINE_CLOCK_READ_CONCURRENCY = 8;
export const ROUTINE_CLOCK_MAX_REQUESTS_PER_TASK = 2;

export interface RoutineTaskAdmissionCandidate {
  readonly task: RoutineSourceTask;
  readonly lastConsideredAt: string | null;
  readonly deadlineMs?: number;
  readonly baselineOwed?: boolean;
}

/** Earliest deadline first; a task without a deadline sorts after every task with one. */
function deadlineOrder(candidate: RoutineTaskAdmissionCandidate): number {
  return candidate.deadlineMs === undefined || Number.isNaN(candidate.deadlineMs)
    ? Number.POSITIVE_INFINITY
    : candidate.deadlineMs;
}

function consideredAtMs(candidate: RoutineTaskAdmissionCandidate): number {
  if (candidate.lastConsideredAt === null) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(candidate.lastConsideredAt);
    // A corrupt clock must not silently omit work: treat it as never considered so validation exposes it.
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function routineFailureDomainFrontier(
  candidates: readonly RoutineTaskAdmissionCandidate[],
  perDomain: number = ROUTINE_FAILURE_DOMAIN_FRONTIER_PER_PASS,
  rotationSeed: number = 0,
): readonly RoutineTaskAdmissionCandidate[] {
  if (!Number.isSafeInteger(perDomain) || perDomain <= 0) {
    throw new Error(`ROUTINE_FAILURE_DOMAIN_FRONTIER_INVALID:${perDomain}`);
  }
  if (!Number.isSafeInteger(rotationSeed) || rotationSeed < 0) {
    throw new Error(`ROUTINE_FAILURE_DOMAIN_FRONTIER_ROTATION_INVALID:${rotationSeed}`);
  }
  const ids = candidates.map(({ task }) => task.id);
  if (new Set(ids).size !== ids.length) throw new Error("ROUTINE_FAILURE_DOMAIN_FRONTIER_DUPLICATE_TASK");

  const registryIndex = new Map(ids.map((id, index) => [id, index]));
  const byDomain = new Map<string, RoutineTaskAdmissionCandidate[]>();
  for (const candidate of candidates) {
    const domain = candidate.task.acquisitionFailureDomain;
    if (!domain || domain !== domain.trim() || /[\r\n]/.test(domain)) {
      throw new Error(`ROUTINE_FAILURE_DOMAIN_INVALID:${candidate.task.id}`);
    }
    const group = byDomain.get(domain) ?? [];
    group.push(candidate);
    byDomain.set(domain, group);
  }

  const admitted = new Set<string>();
  for (const group of byDomain.values()) {
    const groupIndex = new Map(group.map(({ task }, index) => [task.id, index]));
    const rotation = rotationSeed % group.length;
    const slots = group.every(({ deadlineMs }) => deadlineMs !== undefined)
      ? Math.max(perDomain, SITTING_WINDOW_LANE_SLOTS_PER_PASS)
      : perDomain;
    group
      .sort((left, right) =>
        deadlineOrder(left) - deadlineOrder(right) ||
        consideredAtMs(left) - consideredAtMs(right) ||
        (
          (groupIndex.get(left.task.id)! - rotation + group.length) % group.length -
          (groupIndex.get(right.task.id)! - rotation + group.length) % group.length
        ) ||
        registryIndex.get(left.task.id)! - registryIndex.get(right.task.id)!,
      )
      .slice(0, slots)
      .forEach(({ task }) => admitted.add(task.id));
  }
  return candidates.filter(({ task }) => admitted.has(task.id));
}

/** First build missing/current-parser baselines; steady refreshes retain their existing order. */
export function routinePassLaunchOrder<T extends { readonly deadlineMs?: number; readonly baselineOwed?: boolean; readonly task?: Pick<RoutineSourceTask, "sourceId"> }>(admitted: readonly T[], nowMs?: number): T[] {
  const group = (candidate: T) => nowMs !== undefined && candidate.deadlineMs !== undefined && Number.isFinite(candidate.deadlineMs) && candidate.deadlineMs <= nowMs ? 0
    : candidate.baselineOwed ? 1 : candidate.deadlineMs === undefined || Number.isNaN(candidate.deadlineMs) ? 2 : 3;
  // National sources have many independent state projections of the same held release.
  // Offer one from each source before the next state so one portfolio cannot occupy the whole pool.
  const sourcePositions = new Map<string, number>();
  return admitted
    .map((candidate, index) => {
      const source = candidate.task?.sourceId ?? "";
      const position = candidate.baselineOwed ? sourcePositions.get(source) ?? 0 : 0;
      if (candidate.baselineOwed) sourcePositions.set(source, position + 1);
      return { candidate, index, position };
    })
    .sort((left, right) =>
      group(left.candidate) - group(right.candidate) ||
      (group(left.candidate) === 1 ? left.position - right.position : 0) ||
      ([0, 3].includes(group(left.candidate)) ? (left.candidate.deadlineMs! < right.candidate.deadlineMs! ? -1 : left.candidate.deadlineMs! > right.candidate.deadlineMs! ? 1 : 0) : 0) ||
      left.index - right.index)
    .map(({ candidate }) => candidate);
}

export function routineFailureDomainRotationSeed(startedAt: string): number {
  const parsed = Date.parse(startedAt);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== startedAt) {
    throw new Error(`ROUTINE_FAILURE_DOMAIN_ROTATION_TIME_INVALID:${startedAt}`);
  }
  return Math.floor(parsed / ROUTINE_DATA_ADMISSION_MS);
}

/** A lane never admits more tasks than it holds, so a one-task lane counts once toward the bound. */
export function routineFrontierPassBound(
  tasks: readonly Pick<RoutineSourceTask, "acquisitionFailureDomain" | "contract">[] = ROUTINE_SOURCE_TASKS,
): { readonly commandCount: number; readonly largestFailureDomainSize: number } {
  routineFailureDomainCount(tasks);
  const lanes = new Map<string, { windowed: boolean; size: number }>();
  for (const task of tasks) {
    const windowed = task.contract.schedule?.kind === "SITTING_WINDOW";
    const lane = lanes.get(task.acquisitionFailureDomain) ?? { windowed: true, size: 0 };
    lanes.set(task.acquisitionFailureDomain, { windowed: lane.windowed && windowed, size: lane.size + 1 });
  }
  const slots = [...lanes.values()].map(({ windowed, size }) =>
    Math.min(size, windowed ? SITTING_WINDOW_LANE_SLOTS_PER_PASS : ROUTINE_FAILURE_DOMAIN_FRONTIER_PER_PASS));
  return { commandCount: slots.reduce((sum, n) => sum + n, 0), largestFailureDomainSize: Math.max(...slots) };
}

export function routineFailureDomainCount(
  tasks: readonly Pick<RoutineSourceTask, "acquisitionFailureDomain">[] = ROUTINE_SOURCE_TASKS,
): number {
  const domains = tasks.map(({ acquisitionFailureDomain }) => acquisitionFailureDomain);
  if (domains.some((domain) => !domain || domain !== domain.trim() || /[\r\n]/.test(domain))) {
    throw new Error("ROUTINE_FAILURE_DOMAIN_INVALID");
  }
  return new Set(domains).size;
}

export interface RoutineSupervisorHistoryIssue {
  readonly rowIndex: number;
  readonly digestId: string;
  readonly code: "ROUTINE_SUPERVISOR_HISTORY_ROW_INVALID";
  readonly detail: string;
}

export interface RoutineSupervisorAttemptHistory {
  readonly attempts: ReadonlyMap<string, string>;
  readonly issues: readonly RoutineSupervisorHistoryIssue[];
}

function historyObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function canonicalHistoryTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? value : null;
}

function historyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !/[\r\n]/.test(value);
}

/** Each row is validated independently: a corrupt newer row is reported but cannot reset clocks recovered from valid rows. */
export function routineUnreceiptedSupervisorAttemptHistory(
  rows: readonly unknown[],
  registeredTaskIds: ReadonlySet<string>,
  parserUpgrades?: { readonly taskIds: ReadonlySet<string>; readonly codeSha: string | null },
): RoutineSupervisorAttemptHistory {
  const attempts = new Map<string, string>();
  const issues: RoutineSupervisorHistoryIssue[] = [];

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = historyObject(rows[rowIndex]);
    const outcome = historyObject(row?.runtimeOutcome);
    if (outcome?.kind !== "ROUTINE_CIVIC_DATA_SUPERVISOR") continue;

    const digestId = historyText(row?.digestId) ? row.digestId : `owner-digest-row-${rowIndex}`;
    const reasons: string[] = [];
    const startedAt = canonicalHistoryTime(outcome.startedAt);
    const finishedAt = canonicalHistoryTime(outcome.finishedAt);
    if (startedAt === null || finishedAt === null || Date.parse(finishedAt) < Date.parse(startedAt)) {
      reasons.push("cycle time is not a canonical increasing ISO interval");
    }
    if (!historyText(outcome.cycleId) || !historyText(outcome.host) || !historyText(outcome.provider)) {
      reasons.push("cycle, host, or provider identity is missing");
    }
    if (outcome.durable !== true) reasons.push("outcome is not durable");
    if (
      !Number.isSafeInteger(outcome.attemptedTasks) || Number(outcome.attemptedTasks) < 0 ||
      !Number.isSafeInteger(outcome.verifiedSourceSuccesses) || Number(outcome.verifiedSourceSuccesses) < 0 ||
      !Number.isSafeInteger(outcome.verifiedSourceFailures) || Number(outcome.verifiedSourceFailures) < 0
    ) reasons.push("attempt or source-outcome counts are malformed");

    const failures = Array.isArray(outcome.failures) ? outcome.failures : null;
    const taskReceipts = Array.isArray(outcome.taskReceipts) ? outcome.taskReceipts : null;
    const receiptEvidence = outcome.taskReceiptEvidence;
    if (failures === null) reasons.push("failures are not an array");
    if (taskReceipts === null) reasons.push("task receipts are not an array");
    if (receiptEvidence !== "EXACT" && receiptEvidence !== "UNAVAILABLE_OUTER_SUPERVISOR") {
      reasons.push("task-receipt evidence mode is invalid");
    }

    const failureTaskIds: string[] = [];
    if (failures !== null) {
      for (const failureValue of failures) {
        const failure = historyObject(failureValue);
        if (
          failure === null || !historyText(failure.taskId) ||
          !historyText(failure.code) || typeof failure.detail !== "string"
        ) {
          reasons.push("a supervisor failure reference is malformed");
          continue;
        }
        failureTaskIds.push(failure.taskId);
      }
    }

    const exactReceiptTaskIds = new Set<string>();
    let exactSuccesses = 0;
    let exactFailures = 0;
    if (taskReceipts !== null) {
      for (const referenceValue of taskReceipts) {
        const reference = historyObject(referenceValue);
        const receiptValue = historyObject(reference?.receipt);
        let parsedReceipt: ReturnType<typeof parseRoutineRunnerReceipt> | null = null;
        try {
          parsedReceipt = receiptValue === null
            ? null
            : parseRoutineRunnerReceipt(`RCD_RECEIPT=${JSON.stringify(receiptValue)}`);
        } catch {
          parsedReceipt = null;
        }
        if (
          reference === null || !historyText(reference.taskId) ||
          (reference.classification !== "VERIFIED_SOURCE_SUCCESS" &&
            reference.classification !== "VERIFIED_SOURCE_FAILURE") ||
          parsedReceipt === null || !parsedReceipt.ok ||
          parsedReceipt.receipt.source !== reference.taskId
        ) {
          reasons.push("an exact task receipt reference is malformed or contradictory");
          continue;
        }
        if (exactReceiptTaskIds.has(reference.taskId)) {
          reasons.push("exact task receipt identity is duplicated");
          continue;
        }
        const successIssue = successfulRoutineRunnerReceiptIssue(parsedReceipt.receipt);
        if (
          (reference.classification === "VERIFIED_SOURCE_SUCCESS" && successIssue !== null) ||
          (reference.classification === "VERIFIED_SOURCE_FAILURE" && (
            parsedReceipt.receipt.state === "PROMOTED" ||
            parsedReceipt.receipt.decision === "GOOD" ||
            parsedReceipt.receipt.promotedVersion !== null
          ))
        ) {
          reasons.push("an exact task receipt classification contradicts its receipt");
          continue;
        }
        exactReceiptTaskIds.add(reference.taskId);
        if (reference.classification === "VERIFIED_SOURCE_SUCCESS") exactSuccesses += 1;
        else exactFailures += 1;
      }
    }

    if (receiptEvidence === "UNAVAILABLE_OUTER_SUPERVISOR" && (taskReceipts?.length ?? 0) !== 0) {
      reasons.push("unavailable task-receipt evidence carries task receipts");
    }
    if (receiptEvidence === "EXACT") {
      if (exactSuccesses !== outcome.verifiedSourceSuccesses || exactFailures !== outcome.verifiedSourceFailures) {
        reasons.push("exact task receipts do not reconcile to source-outcome counts");
      }
      if ((taskReceipts?.length ?? 0) > Number(outcome.attemptedTasks)) {
        reasons.push("exact task receipts exceed the attempted-task denominator");
      }
    }
    const expectedState = (failures?.length ?? 0) === 0 ? "SUCCEEDED" : "FAILED";
    if (outcome.state !== expectedState) reasons.push("outcome state contradicts supervisor failures");

    if (reasons.length > 0 || finishedAt === null) {
      issues.push({
        rowIndex,
        digestId,
        code: "ROUTINE_SUPERVISOR_HISTORY_ROW_INVALID",
        detail: [...new Set(reasons)].join("; ") || "finished-at time is invalid",
      });
      continue;
    }

    for (const taskId of failureTaskIds) {
      if (parserUpgrades?.codeSha && parserUpgrades.taskIds.has(taskId) && outcome.testedSha !== parserUpgrades.codeSha) continue;
      if (!registeredTaskIds.has(taskId) || exactReceiptTaskIds.has(taskId)) continue;
      const prior = attempts.get(taskId);
      if (prior === undefined || Date.parse(prior) < Date.parse(finishedAt)) attempts.set(taskId, finishedAt);
    }
  }
  return { attempts, issues };
}

export type RoutineTaskSelection =
  | {
      readonly ok: true;
      readonly only: ReadonlySet<string> | null;
    }
  | {
      readonly ok: false;
      readonly code: "EMPTY_ROUTINE_TASK_SELECTION" | "UNKNOWN_ROUTINE_TASK_SELECTION";
      readonly detail: string;
    };

/** A misspelled or retired task id refuses the whole pass rather than running an empty or partial one. */
export function routineTaskSelection(
  args: readonly string[],
  tasks: readonly Pick<RoutineSourceTask, "id">[] = [...ROUTINE_SOURCE_TASKS, ...WORKER_PUBLICATION_TASK_IDS.map(id => ({ id }))],
): RoutineTaskSelection {
  const onlyArgs = args.filter((arg) => arg === "--only" || arg.startsWith("--only="));
  if (onlyArgs.length === 0) return { ok: true, only: null };

  const tokens = onlyArgs.flatMap((arg) =>
    arg === "--only" ? [""] : arg.slice("--only=".length).split(","),
  );
  if (tokens.some((token) => token.trim().length === 0)) {
    return {
      ok: false,
      code: "EMPTY_ROUTINE_TASK_SELECTION",
      detail: "--only requires one or more non-empty routine source task ids",
    };
  }

  const only = new Set(tokens.map((token) => token.trim()));
  const known = new Set(tasks.map((task) => task.id));
  const unknown = [...only].filter((id) => !known.has(id)).sort();
  if (unknown.length > 0) {
    return {
      ok: false,
      code: "UNKNOWN_ROUTINE_TASK_SELECTION",
      detail: `unknown or retired routine source task id(s): ${unknown.join(", ")}`,
    };
  }
  return { ok: true, only };
}

export interface RoutineTaskClock {
  readonly lastAttemptedAt?: string;
  readonly lastSucceededAt?: string;
  readonly lastSucceededObservedAt?: string;
  readonly lastSucceededParserVersion?: string;
  readonly sittingStarts?: readonly string[];
}

export type RoutineTaskClockRead =
  | {
      readonly task: RoutineSourceTask;
      readonly ok: true;
      readonly clock: RoutineTaskClock | undefined;
      readonly error: null;
    }
  | {
      readonly task: RoutineSourceTask;
      readonly ok: false;
      readonly clock: undefined;
      readonly error: string;
    };

export async function readRoutineTaskClocks(
  tasks: readonly RoutineSourceTask[],
  readClock: (task: RoutineSourceTask) => Promise<RoutineTaskClock | undefined>,
  concurrency: number = ROUTINE_CLOCK_READ_CONCURRENCY,
): Promise<readonly RoutineTaskClockRead[]> {
  const reads = await runBoundedWorkPool(tasks, concurrency, readClock);
  return reads.map((read) => read.ok
    ? { task: tasks[read.index]!, ok: true as const, clock: read.value, error: null }
    : { task: tasks[read.index]!, ok: false as const, clock: undefined, error: read.error });
}

export function sittingWindowSignals(
  reads: readonly { readonly task: RoutineSourceTask; readonly ok: boolean; readonly clock?: RoutineTaskClock }[],
  nowMs: number,
  statedEnds: ReadonlyMap<string, ReadonlyMap<string, number>> = new Map(),
): ReadonlyMap<string, boolean | undefined> {
  const clocks = new Map(reads.map((read) => [read.task.id, read.ok ? read.clock ?? {} : undefined]));
  const signals = new Map<string, boolean | undefined>();
  for (const read of reads) {
    const schedule = read.task.contract.schedule;
    if (schedule?.kind !== "SITTING_WINDOW") continue;
    const sources = sittingWindowSourceIds(read.task.id);
    const lists = sources.map((id) => clocks.get(id)?.sittingStarts);
    const ends = new Map(sources.flatMap((id) => [...(statedEnds.get(id) ?? new Map<string, number>())]));
    signals.set(read.task.id, sittingWindowHotByConclusion(schedule, lists, nowMs, ends));
  }
  return signals;
}

/**
 * A sitting-window task owes its next read an hour (hot) or twelve hours after its last success, eligible 15 minutes
 * or 2 hours before. A failed later attempt retries on the contract clock; a partition never published owes one
 * twice daily.
 */
function sittingWindowTaskDue(
  task: RoutineSourceTask,
  schedule: SittingWindowSchedule,
  clock: RoutineTaskClock | undefined,
  nowMs: number,
  hot: boolean | undefined,
): boolean {
  if (!clock?.lastAttemptedAt) return true;
  const attempted = Date.parse(clock.lastAttemptedAt);
  const succeeded = clock.lastSucceededObservedAt ? Date.parse(clock.lastSucceededObservedAt) : Number.NaN;
  if (!Number.isFinite(attempted)) return true;
  if (attempted > nowMs || (Number.isFinite(succeeded) && succeeded > nowMs)) return true;
  const { eligibleAtMs } = sittingWindowObligation(
    schedule,
    task.retryMs,
    { attemptedMs: attempted, succeededMs: succeeded, published: sittingTaskPublished(task, clock) },
    hot,
  );
  return nowMs >= eligibleAtMs;
}

export function routineTaskDeadlineMs(
  task: RoutineSourceTask,
  clock: RoutineTaskClock | undefined,
  sittingHot?: boolean,
): number | undefined {
  const schedule = task.contract?.schedule;
  if (schedule?.kind !== "SITTING_WINDOW") return undefined;
  if (!clock?.lastAttemptedAt) return Number.NEGATIVE_INFINITY;
  const attempted = Date.parse(clock.lastAttemptedAt);
  const succeeded = clock.lastSucceededObservedAt ? Date.parse(clock.lastSucceededObservedAt) : Number.NaN;
  if (!Number.isFinite(attempted)) return Number.NEGATIVE_INFINITY;
  return sittingWindowObligation(
    schedule,
    task.retryMs,
    { attemptedMs: attempted, succeededMs: succeeded, published: sittingTaskPublished(task, clock) },
    sittingHot,
  ).deadlineMs;
}

function sittingTaskPublished(task: RoutineSourceTask, clock: RoutineTaskClock): boolean {
  return task.recordClass !== "MEETING" || clock.sittingStarts !== undefined;
}

export function routineAdmissionClock(
  clock: RoutineTaskClock | undefined,
  supervisorAttemptAt: string | undefined,
  nowMs: number,
): RoutineTaskClock | undefined {
  const attempted = Date.parse(supervisorAttemptAt ?? "");
  if (!Number.isFinite(attempted) || attempted > nowMs) return clock;
  const sourceTimes = [clock?.lastAttemptedAt, clock?.lastSucceededAt, clock?.lastSucceededObservedAt]
    .map(value => Date.parse(value ?? "")).filter(Number.isFinite);
  if (sourceTimes.some(at => at >= attempted)) return clock;
  return { ...clock, lastAttemptedAt: supervisorAttemptAt! };
}

export function unchangedRoutineProtocolFailure(
  task: RoutineSourceTask,
  clock: RoutineTaskClock | undefined,
  rows: readonly unknown[],
  codeSha: string | null,
  nowMs: number,
): boolean {
  if (!task.ownerInvocation || !codeSha) return false;
  const failures = rows.flatMap(value => {
    const row = historyObject(value), progress = historyObject(row?.huntSourceProgress);
    const at = canonicalHistoryTime(progress?.at);
    if (!progress || progress.taskId !== task.id || progress.stage !== "FAILED" || row?.testedSha !== codeSha ||
        !at || Date.parse(at) > nowMs || typeof progress.detail !== "string" ||
        !/RECEIPT_(?:COUNT|JSON|SCHEMA)_INVALID/.test(progress.detail) ||
        /HTTP(?: status)? (?:429|5\d\d)|NeonDbError|fetch failed|ECONNRESET|provider.*(?:rate.?limit|overload)/i.test(progress.detail) ||
        !Array.isArray(progress.instructionIds) ||
        JSON.stringify([...progress.instructionIds].sort()) !== JSON.stringify([...task.ownerInvocation!.instructions].sort())) return [];
    return [Date.parse(at)];
  });
  if (!failures.length) return false;
  const failedAt = Math.max(...failures);
  if (Date.parse(task.ownerInvocation.requestedAt) > failedAt) return false;
  return ![clock?.lastAttemptedAt, clock?.lastSucceededAt, clock?.lastSucceededObservedAt]
    .some(at => Number.isFinite(Date.parse(at ?? "")) && Date.parse(at!) > failedAt && Date.parse(at!) <= nowMs);
}

/** The hourly floor: an observed change rate never makes a door's check faster than this. Same number as lib/doors/observed-rate.ts. */
const MIN_OBSERVED_CHECK_MS = 60 * 60_000;

export function routineBaselineOwed(task: RoutineSourceTask, clock: RoutineTaskClock | undefined): boolean {
  return !task.ownerInvocation && task.authorityMode !== "DERIVED" &&
    task.recordClass !== "MEETING" && task.recordClass !== "MEETING_OUTCOME" && (
    !clock?.lastSucceededObservedAt ||
    (clock.lastSucceededParserVersion !== undefined && clock.lastSucceededParserVersion !== task.parserVersion)
  );
}

export function routineTaskDue(
  task: RoutineSourceTask,
  clock: RoutineTaskClock | undefined,
  nowMs: number,
  sittingHot?: boolean,
  observedEveryMs?: number,
): boolean {
  if (task.ownerInvocation) {
    const requested = Date.parse(task.ownerInvocation.requestedAt);
    const succeeded = Date.parse(clock?.lastSucceededObservedAt ?? clock?.lastSucceededAt ?? "");
    const attempted = Date.parse(clock?.lastAttemptedAt ?? "");
    if (task.ownerInvocation.publicationPending) return !Number.isFinite(attempted) || attempted < requested ||
      (Number.isFinite(succeeded) && succeeded >= attempted && succeeded <= nowMs) || nowMs - attempted >= task.retryMs;
    if (Number.isFinite(succeeded) && succeeded >= requested && succeeded <= nowMs) return false;
    return !Number.isFinite(attempted) || attempted < requested || nowMs - attempted >= task.retryMs;
  }
  if (clock?.lastSucceededParserVersion !== undefined && clock.lastSucceededParserVersion !== task.parserVersion) {
    // The store scopes attempts to this parser. A prior parser's GOOD remains live,
    // but cannot postpone a held-byte reparse for the source's full refresh cadence.
    const attempted = Date.parse(clock.lastAttemptedAt ?? "");
    return !Number.isFinite(attempted) || attempted > nowMs || nowMs - attempted >= task.retryMs;
  }
  const schedule = task.contract?.schedule;
  if (schedule?.kind === "SITTING_WINDOW") return sittingWindowTaskDue(task, schedule, clock, nowMs, sittingHot);
  if (!clock?.lastAttemptedAt) return true;
  const attempted = Date.parse(clock.lastAttemptedAt);
  const succeeded = clock.lastSucceededObservedAt ? Date.parse(clock.lastSucceededObservedAt) : Number.NaN;
  if (!Number.isFinite(attempted)) return true;
  if (attempted > nowMs || (Number.isFinite(succeeded) && succeeded > nowMs)) return true;
  if (!Number.isFinite(succeeded)) return nowMs - attempted >= task.retryMs;
    // Once a due read fails, the source's retry clock owns the next attempt.
  if (attempted > succeeded) return nowMs - attempted >= task.retryMs;
  const policyMs = cadenceMsAt(task.contract, nowMs);
  return nowMs - succeeded >= (observedEveryMs === undefined ? policyMs
    : Math.min(policyMs, Math.max(observedEveryMs, MIN_OBSERVED_CHECK_MS)));
}
