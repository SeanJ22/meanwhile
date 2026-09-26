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

/**
 * **A DUE MEETING READ NEVER WAITS FOR THE PASS THAT HOLDS ITS LANE (C6, 2026-09-25).**
 *
 * The standing pilot admits the routine lane every five minutes and never while
 * the last pass is still running, and a pass admits at most three reads a
 * meeting lane. A pass is held open by its slowest work. On 2026-09-24 the 196
 * passes took 1:34 at the median and 15:52 at most, and that longest pass spent
 * 14:31 in its source reads (every family's children) and 1:21 in Reader repair
 * (tests/fixtures/routine-pass-durations-2026-09-24.json dates each pass's
 * Reader repair from its receipts). While a pass is held open, a meeting lane
 * that has made its reads sits idle, and a read that falls due waits for the
 * next pass.
 *
 * The first catch-up (batch B) admitted reads in rounds on the five-minute
 * cadence, and only while Reader repair ran. Replayed against production's
 * recorded passes split into those two phases (tests/helpers/routine-pass-replay.ts),
 * it still left reads late in 5 of 14 seeds: up to 14 hourly reads in 30 days
 * on Tucson's lane (by up to 4:02), and up to 11 hourly and 5 twice-daily reads
 * in the whole registry's first hour. A pass held open by its source reads ran
 * no round; a round skipped a lane still inside its same-host gap at the
 * round's instant; a round carrying reads for many lanes, two at a time, held
 * every lane until its last read ended; and a round started its reads in
 * registry order.
 *
 * So catch-up is per lane, for as long as a pass is held open: a meeting lane
 * with no read of this pass queued or running, and its same-host gap behind it,
 * starts the due read it owes soonest, and lanes take the catch-up children
 * earliest deadline first. Each decision applies the pass's own rules to the
 * pass's own clock reads (the durable clocks of reads not made this pass cannot
 * have moved: this runner is the only writer and holds the host singleton), and
 * a task is read at most once a pass. Only sitting-window tasks are admitted, so
 * no other data family's schedule changes. The same replays, 42 seeds each,
 * then read every hourly body within 52:44 and every body within 11:53, at 1.5%
 * to 4.1% more meeting reads (a due read is made when it falls due, not at the
 * next pass).
 *
 * Reader repair starts only once every catch-up read begun beside the source
 * reads has settled, and catch-up resumes only once no running repair can race
 * a new meeting promotion: the meeting aggregate and any repair of a task
 * catch-up may read settle first (the runner launches them first). A promotion
 * made during repair is proved and published by the next pass's repair, as any
 * promotion after a pass is. No read starts that could outlast the pass's outer
 * time limit; during the source reads, the repair's own worst case stays free.
 *
 * Why not a separate lane, or a capped repair: a separate repair lane would
 * split the one supervisor outcome Admin proves Reader delivery from (every
 * outcome carries exact per-contract Reader receipts) and still needs a second
 * singleton and outer bound; capping repair still holds a read for the domains
 * already running and cuts nothing from a pass held open by its source reads.
 */
export interface HotReadCandidate {
  readonly task: RoutineSourceTask;
  readonly clock: RoutineTaskClock | undefined;
  readonly lastConsideredAt: string | null;
}

/**
 * Catch-up reads share the host with the pass's four children (source reads,
 * then Reader repair), so at most two run at once: six children at the peak.
 */
export const HOT_READ_CATCH_UP_CONCURRENCY = Math.max(1, Math.floor(ROUTINE_CHILD_CONCURRENCY / 2));

/**
 * A lane not ready now is looked at again within this: a read falling due or a
 * body turning hourly waits at most a minute, as a lane's same-host gap does.
 */
export const HOT_READ_CATCH_UP_RECHECK_MS = 60_000;

/** The longest one catch-up read can take: the child's ceiling and its settlement. */
export function hotReadCatchUpReadWorstCaseMs(): number {
  const settlementMs = ROUTINE_DURABLE_RECEIPT_MAX_REQUESTS * STANDING_NEON_REQUEST_DEADLINE_MS;
  return routineChildPassWorstCaseMs(1, ROUTINE_CHILD_TIMEOUT_MS + settlementMs, 1, 1);
}

export interface HotReadCatchUpAdmission {
  /** The reads to start now, in order. */
  readonly start: readonly RoutineSourceTask[];
  /** Due reads that could outlast the pass's time limit: they wait for the next pass. */
  readonly pastLimit: readonly RoutineSourceTask[];
  /** When to look again if nothing else changes first. */
  readonly recheckAtMs: number;
}

function ascending(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * The catch-up reads to start at `nowMs`: for each lane with no read of this
 * pass queued or running and its same-host gap behind it, the due sitting-window
 * read it owes soonest (least recently considered on a tie); across lanes,
 * earliest deadline first, up to `slots`. `clockReads` are the pass's own.
 */
export function hotReadCatchUpAdmission(input: {
  readonly nowMs: number;
  /** Tasks not yet read this pass. */
  readonly candidates: readonly HotReadCandidate[];
  readonly clockReads: Parameters<typeof sittingWindowSignals>[0];
  readonly statedEnds: Parameters<typeof sittingWindowSignals>[2];
  /** When each lane's last read of this pass ended. */
  readonly laneLastEndedMs: ReadonlyMap<string, number>;
  /** Lanes with a read of this pass queued or running. */
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
  // A task due as hourly is the only kind that can be due at all (hourly is the
  // shortest schedule, and an unknown window reads as hourly), so the window is
  // decided only for those, from their own clocks and the partitions they follow.
  const possible = input.candidates.flatMap((candidate, index) =>
    candidate.task.contract.schedule?.kind === "SITTING_WINDOW" &&
    !input.busyLanes.has(candidate.task.acquisitionFailureDomain) &&
    routineTaskDue(candidate.task, candidate.clock, nowMs, true)
      ? [{ ...candidate, index }]
      : []);
  if (possible.length === 0) return { start: [], pastLimit: [], recheckAtMs };
  const decides = new Set(possible.flatMap(({ task }) => [task.id, ...sittingWindowSourceIds(task.id)]));
  const signals = sittingWindowSignals(input.clockReads.filter(({ task }) => decides.has(task.id)), nowMs, input.statedEnds);
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
  /** The phase holding the pass open (its source reads, or its Reader repair), already running. */
  readonly work: Promise<R>;
  /** No read starts before this settles. */
  readonly unblocked: Promise<void>;
  readonly now: () => number;
  readonly sleepUntil: (atMs: number) => Promise<void>;
  readonly concurrency: number;
  /** The reads to start at `nowMs` in `slots` free children, lanes of running catch-up reads excluded. */
  readonly admit: (nowMs: number, slots: number, runningLanes: ReadonlySet<string>) => Pick<HotReadCatchUpAdmission, "start" | "recheckAtMs">;
  /** Run one read and settle it exactly as the pass's own. */
  readonly read: (task: RoutineSourceTask, atMs: number) => Promise<void>;
}

export interface HotReadCatchUpResult<R> {
  readonly work: R;
  readonly reads: readonly HotReadCatchUpRead[];
  /** A defect in admission or a read: no further read starts, and the phase is still awaited and reported. */
  readonly error?: string;
}

/**
 * Start due meeting reads while `work` holds the pass open, and return the
 * work's own result with the reads made. Every read begun settles before this
 * returns. A read due while the gate is closed starts as soon as it opens.
 */
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
        // A defect in a read never costs the pass its phase or its outcome.
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

/**
 * One routine pass: its source reads, then its Reader repair, with catch-up
 * reads for as long as either holds the pass open. `startRepair` is called
 * once the source reads and every catch-up read begun beside them have
 * settled; it launches the repair and returns the gate that opens when no
 * running repair can race a meeting promotion. A catch-up defect in the source
 * phase stops catch-up for the rest of the pass.
 */
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

/**
 * The outer time limit the standing pilot puts on a routine pass, from the same
 * inputs it uses (scripts/pilot-runner.mts, `ROUTINE_DATA_TIMEOUT_MS`), less
 * the coordination and grace the pass keeps for persisting its outcome: no
 * catch-up read may run past this.
 */
export function routinePassWorkDeadlineMs(
  startedAtMs: number,
  readerDomains: readonly Pick<RoutineReaderRepairDomain, "mode">[],
  tasks: readonly RoutineSourceTask[] = ROUTINE_SOURCE_TASKS,
): number {
  const bound = routineFrontierPassBound(tasks);
  const outer = routineRunnerOuterTimeoutMs(bound.commandCount, bound.largestFailureDomainSize, routinePassOuterBounds(readerDomains, tasks));
  return startedAtMs + outer - ROUTINE_RUNNER_COORDINATION_AND_PERSISTENCE_BUDGET_MS - ROUTINE_RUNNER_OUTER_GRACE_MS;
}

/**
 * The same limit for a catch-up read begun beside the source reads: the Reader
 * repair starts after it settles, so the repair's own worst case stays free.
 */
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

/**
 * The repair domains a catch-up read could race: the meeting aggregate (it
 * composes every partition) and the single repair of any task catch-up may read.
 * The runner launches these first and resumes catch-up once they settle.
 */
export function repairDomainRacesHotReads(
  domain: Pick<RoutineReaderRepairDomain, "mode" | "contracts">,
  hotTaskIds: ReadonlySet<string>,
): boolean {
  return domain.mode === "MEETING_AGGREGATE" || domain.contracts.some(({ id }) => hotTaskIds.has(id));
}
