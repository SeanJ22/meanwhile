import {
  ROUTINE_CLOCK_MAX_REQUESTS_PER_TASK,
  ROUTINE_CLOCK_READ_CONCURRENCY,
  ROUTINE_SOURCE_TASKS,
  routineFrontierPassBound,
  routineTaskDeadlineMs,
  routineTaskDue,
  sittingWindowSignals,
  type RoutineSourceTask,
  type RoutineTaskClock,
} from "./runner.ts";
import {
  ROUTINE_CHILD_CONCURRENCY,
  ROUTINE_CHILD_TIMEOUT_MS,
  ROUTINE_RUNNER_COORDINATION_AND_PERSISTENCE_BUDGET_MS,
  ROUTINE_RUNNER_OUTER_GRACE_MS,
  ROUTINE_SAME_DOMAIN_CHILD_GAP_MS,
  routineChildPassWorstCaseMs,
  routineRunnerBoundedWorkMs,
  routineRunnerOuterTimeoutMs,
  type RoutineRunnerOuterBounds,
} from "./bounded-child-pass.ts";
import { sittingWindowSourceIds } from "./meeting-partitions.ts";
import { ROUTINE_DURABLE_RECEIPT_MAX_REQUESTS } from "./runner-receipt.ts";
import {
  ROUTINE_READER_CHILD_CONCURRENCY,
  ROUTINE_READER_MEETING_TIMEOUT_MS,
  ROUTINE_READER_SINGLE_TIMEOUT_MS,
  type RoutineReaderRepairDomain,
} from "./reader-repair-protocol.ts";
import { STANDING_NEON_REQUEST_DEADLINE_MS } from "../ops/neon-request-deadline.ts";


export interface HotReadCandidate {
  readonly task: RoutineSourceTask;
  readonly clock: RoutineTaskClock | undefined;
  readonly lastConsideredAt: string | null;
}


export const HOT_READ_CATCH_UP_CONCURRENCY = Math.max(1, Math.floor(ROUTINE_CHILD_CONCURRENCY / 2));


export const HOT_READ_CATCH_UP_RECHECK_MS = 60_000;

/** The longest one catch-up read can take: the child's ceiling and its settlement. */
export function hotReadCatchUpReadWorstCaseMs(): number {
  const settlementMs = ROUTINE_DURABLE_RECEIPT_MAX_REQUESTS * STANDING_NEON_REQUEST_DEADLINE_MS;
  return routineChildPassWorstCaseMs(1, ROUTINE_CHILD_TIMEOUT_MS + settlementMs, 1, 1);
}

export interface HotReadCatchUpAdmission {
  readonly start: readonly RoutineSourceTask[];
  readonly pastLimit: readonly RoutineSourceTask[];
  readonly recheckAtMs: number;
}

function ascending(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0;
}


export function hotReadCatchUpAdmission(input: {
  readonly nowMs: number;
  readonly candidates: readonly HotReadCandidate[];
  readonly clockReads: Parameters<typeof sittingWindowSignals>[0];
  readonly statedEnds: Parameters<typeof sittingWindowSignals>[2];
  readonly sourceIds?: (taskId: string) => readonly string[];
  readonly laneLastEndedMs: ReadonlyMap<string, number>;
  readonly busyLanes: ReadonlySet<string>;
  readonly slots: number;
  /** No read starts that could outlast this instant. */
  readonly limitMs: number;
}): HotReadCatchUpAdmission {
  const { nowMs } = input;
  if (!Number.isSafeInteger(input.slots) || input.slots < 0) throw new Error(`HOT_READ_CATCH_UP_SLOTS_INVALID:${input.slots}`);
  let recheckAtMs = nowMs + HOT_READ_CATCH_UP_RECHECK_MS;
  // No child is free: a running read settling is the next change that matters.
  if (input.slots === 0) return { start: [], pastLimit: [], recheckAtMs };
  const possible = input.candidates.flatMap((candidate, index) =>
    candidate.task.contract.schedule?.kind === "SITTING_WINDOW" &&
    !input.busyLanes.has(candidate.task.acquisitionFailureDomain) &&
    routineTaskDue(candidate.task, candidate.clock, nowMs, true)
      ? [{ ...candidate, index }]
      : []);
  if (possible.length === 0) return { start: [], pastLimit: [], recheckAtMs };
  const sourceIds = input.sourceIds ?? sittingWindowSourceIds;
  const decides = new Set(possible.flatMap(({ task }) => [task.id, ...sourceIds(task.id)]));
  const signals = sittingWindowSignals(input.clockReads.filter(({ task }) => decides.has(task.id)), nowMs, input.statedEnds, sourceIds);
  const ready: { readonly task: RoutineSourceTask; readonly deadlineMs: number; readonly consideredMs: number; readonly index: number }[] = [];
  possible.forEach(({ task, clock, lastConsideredAt, index }) => {
    const lane = task.acquisitionFailureDomain;
    const hot = signals.get(task.id);
    if (!routineTaskDue(task, clock, nowMs, hot)) return;
    const freeAtMs = (input.laneLastEndedMs.get(lane) ?? Number.NEGATIVE_INFINITY) + ROUTINE_SAME_DOMAIN_CHILD_GAP_MS;
    if (nowMs < freeAtMs) {
      recheckAtMs = Math.min(recheckAtMs, freeAtMs);
      return;
    }
    const considered = lastConsideredAt === null ? Number.NEGATIVE_INFINITY : Date.parse(lastConsideredAt);
    ready.push({
      task,
      deadlineMs: routineTaskDeadlineMs(task, clock, hot) ?? Number.POSITIVE_INFINITY,
      consideredMs: Number.isFinite(considered) ? considered : Number.NEGATIVE_INFINITY,
      index,
    });
  });
  ready.sort((left, right) =>
    ascending(left.deadlineMs, right.deadlineMs) || ascending(left.consideredMs, right.consideredMs) || left.index - right.index);
  const lanes = new Set<string>();
  const start: RoutineSourceTask[] = [];
  const pastLimit: RoutineSourceTask[] = [];
  for (const { task } of ready) {
    if (lanes.has(task.acquisitionFailureDomain)) continue;
    lanes.add(task.acquisitionFailureDomain);
    if (nowMs + hotReadCatchUpReadWorstCaseMs() > input.limitMs) pastLimit.push(task);
    else if (start.length < input.slots) start.push(task);
  }
  return { start, pastLimit, recheckAtMs };
}

export interface HotReadCatchUpRead {
  readonly atMs: number;
  readonly taskId: string;
}

export interface HotReadCatchUpInput<R> {
  readonly work: Promise<R>;
  readonly unblocked: Promise<void>;
  readonly now: () => number;
  readonly sleepUntil: (atMs: number) => Promise<void>;
  readonly concurrency: number;
  readonly admit: (nowMs: number, slots: number, runningLanes: ReadonlySet<string>) => Pick<HotReadCatchUpAdmission, "start" | "recheckAtMs">;
  readonly read: (task: RoutineSourceTask, atMs: number) => Promise<void>;
}

export interface HotReadCatchUpResult<R> {
  readonly work: R;
  readonly reads: readonly HotReadCatchUpRead[];
  readonly error?: string;
}

export async function runHotReadCatchUp<R>(input: HotReadCatchUpInput<R>): Promise<HotReadCatchUpResult<R>> {
  if (!Number.isSafeInteger(input.concurrency) || input.concurrency <= 0) {
    throw new Error(`HOT_READ_CATCH_UP_CONCURRENCY_INVALID:${input.concurrency}`);
  }
  let workDone = false;
  const workSettled = input.work.then(
    (value) => {
      workDone = true;
      return value;
    },
    (error: unknown) => {
      workDone = true;
      throw error;
    },
  );
  const workEnded = workSettled.then(() => undefined, () => undefined);
  const reads: HotReadCatchUpRead[] = [];
  const running = new Map<Promise<void>, string>();
  let error: string | undefined;
  const fail = (cause: unknown) => {
    error ??= cause instanceof Error ? cause.message : String(cause);
  };
  await Promise.race([input.unblocked.then(() => undefined, () => undefined), workEnded]);
  while (!workDone && error === undefined) {
    const nowMs = input.now();
    let recheckAtMs: number;
    try {
      const slots = input.concurrency - running.size;
      const plan = input.admit(nowMs, slots, new Set(running.values()));
      if (plan.start.length > slots) throw new Error(`HOT_READ_CATCH_UP_OVER_ADMITTED:${plan.start.length}>${slots}`);
      for (const task of plan.start) {
        reads.push({ atMs: nowMs, taskId: task.id });
        let launched: Promise<void>;
        try {
          launched = input.read(task, nowMs);
        } catch (cause) {
          launched = Promise.reject(cause);
        }
        const settled: Promise<void> = launched.catch(fail).finally(() => { running.delete(settled); });
        running.set(settled, task.acquisitionFailureDomain);
      }
      recheckAtMs = Math.min(Math.max(plan.recheckAtMs, nowMs + 1), nowMs + HOT_READ_CATCH_UP_RECHECK_MS);
    } catch (cause) {
      fail(cause);
      break;
    }
    await Promise.race([workEnded, input.sleepUntil(recheckAtMs), ...running.keys()]);
  }
  await Promise.all(running.keys());
  const work = await workSettled;
  return error === undefined ? { work, reads } : { work, reads, error };
}

export async function runRoutinePassWithHotReadCatchUp<S, R>(input: {
  readonly source: Promise<S>;
  readonly startRepair: (source: S) => { readonly repair: Promise<R>; readonly unblocked: Promise<void> };
  readonly now: () => number;
  readonly sleepUntil: (atMs: number) => Promise<void>;
  readonly concurrency: number;
  readonly admit: (phase: "SOURCE" | "REPAIR", nowMs: number, slots: number, runningLanes: ReadonlySet<string>) =>
    Pick<HotReadCatchUpAdmission, "start" | "recheckAtMs">;
  readonly read: (task: RoutineSourceTask, atMs: number) => Promise<void>;
}): Promise<{
  readonly source: S;
  readonly repair: R;
  readonly reads: readonly HotReadCatchUpRead[];
  readonly errors: readonly string[];
}> {
  const common = { now: input.now, sleepUntil: input.sleepUntil, concurrency: input.concurrency, read: input.read };
  const during = await runHotReadCatchUp({
    ...common,
    work: input.source,
    unblocked: Promise.resolve(),
    admit: (nowMs, slots, running) => input.admit("SOURCE", nowMs, slots, running),
  });
  const { repair, unblocked } = input.startRepair(during.work);
  const after = during.error === undefined
    ? await runHotReadCatchUp({
        ...common,
        work: repair,
        unblocked,
        admit: (nowMs, slots, running) => input.admit("REPAIR", nowMs, slots, running),
      })
    : { work: await repair, reads: [] as const };
  return {
    source: during.work,
    repair: after.work,
    reads: [...during.reads, ...after.reads],
    errors: [during.error, "error" in after ? after.error : undefined].filter((row): row is string => row !== undefined),
  };
}

function routinePassOuterBounds(
  readerDomains: readonly Pick<RoutineReaderRepairDomain, "mode">[],
  tasks: readonly RoutineSourceTask[],
): RoutineRunnerOuterBounds {
  return {
    neonRequestDeadlineMs: STANDING_NEON_REQUEST_DEADLINE_MS,
    settlementRequestsPerCommand: ROUTINE_DURABLE_RECEIPT_MAX_REQUESTS,
    clockTaskCount: tasks.length,
    clockConcurrency: ROUTINE_CLOCK_READ_CONCURRENCY,
    clockRequestsPerTask: ROUTINE_CLOCK_MAX_REQUESTS_PER_TASK,
    coordinationRequests: 4,
    readerSingleDomains: readerDomains.filter(({ mode }) => mode === "SINGLE").length,
    readerSingleTimeoutMs: ROUTINE_READER_SINGLE_TIMEOUT_MS,
    readerMeetingDomains: readerDomains.filter(({ mode }) => mode === "MEETING_AGGREGATE").length,
    readerMeetingTimeoutMs: ROUTINE_READER_MEETING_TIMEOUT_MS,
    readerConcurrency: ROUTINE_READER_CHILD_CONCURRENCY,
  };
}

export function routinePassWorkDeadlineMs(
  startedAtMs: number,
  readerDomains: readonly Pick<RoutineReaderRepairDomain, "mode">[],
  tasks: readonly RoutineSourceTask[] = ROUTINE_SOURCE_TASKS,
): number {
  const bound = routineFrontierPassBound(tasks);
  const outer = routineRunnerOuterTimeoutMs(bound.commandCount, bound.largestFailureDomainSize, routinePassOuterBounds(readerDomains, tasks));
  return startedAtMs + outer - ROUTINE_RUNNER_COORDINATION_AND_PERSISTENCE_BUDGET_MS - ROUTINE_RUNNER_OUTER_GRACE_MS;
}

export function routinePassSourceCatchUpDeadlineMs(
  startedAtMs: number,
  readerDomains: readonly Pick<RoutineReaderRepairDomain, "mode">[],
  tasks: readonly RoutineSourceTask[] = ROUTINE_SOURCE_TASKS,
): number {
  const bound = routineFrontierPassBound(tasks);
  const bounds = routinePassOuterBounds(readerDomains, tasks);
  const readerWorstMs =
    routineRunnerBoundedWorkMs(bound.commandCount, bound.largestFailureDomainSize, bounds) -
    routineRunnerBoundedWorkMs(bound.commandCount, bound.largestFailureDomainSize, { ...bounds, readerSingleDomains: 0, readerMeetingDomains: 0 });
  return routinePassWorkDeadlineMs(startedAtMs, readerDomains, tasks) - readerWorstMs;
}

export function repairDomainRacesHotReads(
  domain: Pick<RoutineReaderRepairDomain, "mode" | "contracts">,
  hotTaskIds: ReadonlySet<string>,
): boolean {
  return domain.mode === "MEETING_AGGREGATE" || domain.contracts.some(({ id }) => hotTaskIds.has(id));
}
