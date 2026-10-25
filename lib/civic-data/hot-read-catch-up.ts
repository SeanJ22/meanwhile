import {
  routineTaskDeadlineMs,
  routineTaskDue,
  sittingWindowSignals,
  type RoutineSourceTask,
  type RoutineTaskClock,
} from "./runner.ts";
import {
  ROUTINE_CHILD_CONCURRENCY,
  ROUTINE_SAME_DOMAIN_CHILD_GAP_MS,
} from "./bounded-child-pass.ts";
import { sittingWindowSourceIds } from "./meeting-partitions.ts";
import { ROUTINE_DURABLE_RECEIPT_MAX_REQUESTS } from "./runner-receipt.ts";
import { STANDING_NEON_REQUEST_DEADLINE_MS } from "../ops/neon-request-deadline.ts";

/**
 * While a pass is held open, a meeting lane with no read of this pass queued or running and its same-host gap
 * behind it starts the due sitting-window read it owes soonest, earliest deadline first across lanes, at most once a
 * pass. No read starts that could outlast the pass's time limit.
 */
export interface HotReadCandidate {
  readonly task: RoutineSourceTask;
  readonly clock: RoutineTaskClock | undefined;
  readonly lastConsideredAt: string | null;
}

/**
 * Catch-up reads share the host with the pass's four source children,
 * so at most two run at once: six children at the peak.
 */
export const HOT_READ_CATCH_UP_CONCURRENCY = Math.max(1, Math.floor(ROUTINE_CHILD_CONCURRENCY / 2));

/**
 * A lane not ready now is looked at again within this: a read falling due or a
 * body turning hourly waits at most a minute, as a lane's same-host gap does.
 */
export const HOT_READ_CATCH_UP_RECHECK_MS = 60_000;

/** A single board's 120-second acquisition plus bounded bootstrap and evidence work. */
export const HOT_READ_CATCH_UP_READ_BUDGET_MS = 5 * 60_000;

/** The enforced child wall budget plus the parent's durable settlement. */
export function hotReadCatchUpReadWorstCaseMs(): number {
  const settlementMs = ROUTINE_DURABLE_RECEIPT_MAX_REQUESTS * STANDING_NEON_REQUEST_DEADLINE_MS;
  return HOT_READ_CATCH_UP_READ_BUDGET_MS + settlementMs;
}

export interface HotReadCatchUpAdmission {
  readonly start: readonly RoutineSourceTask[];
  readonly pastLimit: readonly RoutineSourceTask[];
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
  readonly candidates: readonly HotReadCandidate[];
  readonly clockReads: Parameters<typeof sittingWindowSignals>[0];
  readonly statedEnds: Parameters<typeof sittingWindowSignals>[2];
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
