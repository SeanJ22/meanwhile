import {
  ROUTINE_CLOCK_MAX_REQUESTS_PER_TASK,
  ROUTINE_CLOCK_READ_CONCURRENCY,
  ROUTINE_FAILURE_DOMAIN_FRONTIER_PER_PASS,
  ROUTINE_SOURCE_TASKS,
  routineFailureDomainFrontier,
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
  routineRunnerOuterTimeoutMs,
} from "./bounded-child-pass.ts";
import { ROUTINE_DURABLE_RECEIPT_MAX_REQUESTS } from "./runner-receipt.ts";
import {
  ROUTINE_READER_CHILD_CONCURRENCY,
  ROUTINE_READER_MEETING_TIMEOUT_MS,
  ROUTINE_READER_SINGLE_TIMEOUT_MS,
  type RoutineReaderRepairDomain,
} from "./reader-repair-protocol.ts";
import { STANDING_NEON_REQUEST_DEADLINE_MS } from "../ops/neon-request-deadline.ts";

/**
 * **A DUE MEETING READ NEVER WAITS BEHIND READER REPAIR (C6 residual, 2026-09-25).**
 *
 * The standing pilot admits the routine lane every five minutes and never while
 * the last pass is still running, and a pass ran its Reader repair after its
 * source reads. So a meeting read that fell due while repair was running (91
 * single Readers four at a time, plus the meeting aggregate: 1:34 at the median
 * and up to 15:52 on 2026-09-24) waited for the whole repair and the next
 * admission. The 30-day replay of production's schedule projected 4 hourly
 * reads a month late by up to 1.3 minutes from passes held open like that.
 *
 * The fix keeps admitting meeting reads while repair runs, on the lane's own
 * five-minute cadence counted from the pass's admission instant: exactly when a
 * free lane would have started the next pass. Each round applies the pass's own
 * rules to the pass's own clock reads (the durable clocks of reads not made this
 * pass cannot have moved: this runner is the only writer and holds the host
 * singleton): due by the sitting-window schedule, earliest deadline first, up
 * to three reads a lane, a minute between two reads of one host. Only
 * sitting-window tasks are admitted, so no other data family's schedule
 * changes. Why this rather than a separate lane or a capped repair:
 *
 *  - A separate repair lane would split the one supervisor outcome Admin proves
 *    Reader delivery from (every outcome carries exact per-contract Reader
 *    receipts), and still needs a second singleton and outer bound.
 *  - Capping repair and carrying the rest to the next pass still holds a read
 *    for the domains already running, and a busy lane (Tucson, 16 hourly bodies)
 *    would cut repair every pass, starving the domains at the end of the list.
 *
 * Rounds start only once no running repair can race a new meeting promotion:
 * the meeting aggregate and any repair of a task a round may read settle first
 * (the runner launches them first). A promotion made during repair is proved
 * and published by the next pass's repair, as any promotion after a pass is.
 * No round starts that could outlast the pass's outer time limit.
 */
export interface HotReadCatchUpInput<R> {
  /** The pass's Reader-repair phase, already running. */
  readonly repair: Promise<R>;
  /** Settles when no running repair can race a meeting promotion. */
  readonly unblocked: Promise<void>;
  /** The pass's frozen admission instant; rounds fall on the lane's cadence after it. */
  readonly admittedAtMs: number;
  readonly intervalMs: number;
  readonly now: () => number;
  readonly sleepUntil: (atMs: number) => Promise<void>;
  /** Admit and run one round at `atMs`; settles when every read it launched has settled. */
  readonly round: (atMs: number) => Promise<readonly string[]>;
}

export interface HotReadCatchUpRound {
  readonly atMs: number;
  readonly admitted: readonly string[];
  /** A round that threw: no further round runs, and the repair is still awaited and reported. */
  readonly error?: string;
}

/** The first cadence instant strictly after `afterMs`. */
function nextCadenceMs(admittedAtMs: number, intervalMs: number, afterMs: number): number {
  return admittedAtMs + (Math.floor((afterMs - admittedAtMs) / intervalMs) + 1) * intervalMs;
}

/**
 * Run meeting-read rounds while the Reader repair is in flight, and return the
 * repair's own result with the rounds made. A round that is due while the gate
 * is still closed runs as soon as it opens.
 */
export async function runHotReadCatchUp<R>(input: HotReadCatchUpInput<R>): Promise<{
  readonly repair: R;
  readonly rounds: readonly HotReadCatchUpRound[];
}> {
  if (!Number.isFinite(input.admittedAtMs) || !Number.isSafeInteger(input.intervalMs) || input.intervalMs <= 0) {
    throw new Error(`HOT_READ_CATCH_UP_CADENCE_INVALID:${input.admittedAtMs}:${input.intervalMs}`);
  }
  let repairDone = false;
  const repairSettled = input.repair.then(
    (value) => {
      repairDone = true;
      return value;
    },
    (error: unknown) => {
      repairDone = true;
      throw error;
    },
  );
  const repairEnded = repairSettled.then(() => undefined, () => undefined);
  const rounds: HotReadCatchUpRound[] = [];
  await Promise.race([input.unblocked.then(() => undefined, () => undefined), repairEnded]);
  let nextAt = input.admittedAtMs + input.intervalMs;
  while (!repairDone) {
    if (input.now() < nextAt) {
      await Promise.race([input.sleepUntil(nextAt), repairEnded]);
      if (repairDone) break;
    }
    const atMs = input.now();
    try {
      rounds.push({ atMs, admitted: await input.round(atMs) });
    } catch (error) {
      // A defect in a round never costs the pass its repair or its outcome.
      rounds.push({ atMs, admitted: [], error: error instanceof Error ? error.message : String(error) });
      break;
    }
    nextAt = nextCadenceMs(input.admittedAtMs, input.intervalMs, input.now());
  }
  return { repair: await repairSettled, rounds };
}

export interface HotReadCandidate {
  readonly task: RoutineSourceTask;
  readonly clock: RoutineTaskClock | undefined;
  readonly lastConsideredAt: string | null;
}

/**
 * One round's admission at `nowMs`: the sitting-window tasks not yet read this
 * pass that are due, earliest deadline first, at most three a lane, skipping a
 * lane read less than the same-host gap ago. `clockReads` are the pass's own.
 */
export function hotReadRoundAdmission(input: {
  readonly nowMs: number;
  readonly candidates: readonly HotReadCandidate[];
  readonly clockReads: Parameters<typeof sittingWindowSignals>[0];
  readonly statedEnds: Parameters<typeof sittingWindowSignals>[2];
  /** When each lane's last read of this pass ended. */
  readonly laneLastEndedMs: ReadonlyMap<string, number>;
  readonly rotationSeed: number;
}): readonly RoutineSourceTask[] {
  const signals = sittingWindowSignals(input.clockReads, input.nowMs, input.statedEnds);
  const due = input.candidates.filter(({ task, clock }) =>
    task.contract.schedule?.kind === "SITTING_WINDOW" &&
    routineTaskDue(task, clock, input.nowMs, signals.get(task.id)) &&
    input.nowMs - (input.laneLastEndedMs.get(task.acquisitionFailureDomain) ?? Number.NEGATIVE_INFINITY) >=
      ROUTINE_SAME_DOMAIN_CHILD_GAP_MS);
  return routineFailureDomainFrontier(due.map(({ task, clock, lastConsideredAt }) => ({
    task,
    lastConsideredAt,
    deadlineMs: routineTaskDeadlineMs(task, clock, signals.get(task.id)),
  })), ROUTINE_FAILURE_DOMAIN_FRONTIER_PER_PASS, input.rotationSeed).map(({ task }) => task);
}

/**
 * Catch-up reads share the host with the running repair (four Reader children),
 * so a round runs at most two at once: six children at the peak, not eight.
 */
export const HOT_READ_CATCH_UP_CONCURRENCY = Math.max(1, Math.floor(ROUTINE_CHILD_CONCURRENCY / 2));

/** The longest one round of these reads can take: each child's ceiling, its settlement, and the same-host gaps. */
export function hotReadRoundWorstCaseMs(tasks: readonly Pick<RoutineSourceTask, "acquisitionFailureDomain">[]): number {
  if (tasks.length === 0) return 0;
  const perLane = new Map<string, number>();
  for (const { acquisitionFailureDomain } of tasks) perLane.set(acquisitionFailureDomain, (perLane.get(acquisitionFailureDomain) ?? 0) + 1);
  const largest = Math.max(...perLane.values());
  const settlementMs = ROUTINE_DURABLE_RECEIPT_MAX_REQUESTS * STANDING_NEON_REQUEST_DEADLINE_MS;
  return routineChildPassWorstCaseMs(tasks.length, ROUTINE_CHILD_TIMEOUT_MS + settlementMs, HOT_READ_CATCH_UP_CONCURRENCY, largest) +
    (largest - 1) * ROUTINE_SAME_DOMAIN_CHILD_GAP_MS;
}

/**
 * The outer time limit the standing pilot puts on a routine pass, from the same
 * inputs it uses (scripts/pilot-runner.mts, `ROUTINE_DATA_TIMEOUT_MS`), less
 * the coordination and grace the pass keeps for persisting its outcome: no
 * catch-up round may run past this.
 */
export function routinePassWorkDeadlineMs(
  startedAtMs: number,
  readerDomains: readonly Pick<RoutineReaderRepairDomain, "mode">[],
  tasks: readonly RoutineSourceTask[] = ROUTINE_SOURCE_TASKS,
): number {
  const bound = routineFrontierPassBound(tasks);
  const outer = routineRunnerOuterTimeoutMs(bound.commandCount, bound.largestFailureDomainSize, {
    neonRequestDeadlineMs: STANDING_NEON_REQUEST_DEADLINE_MS,
    settlementRequestsPerCommand: ROUTINE_DURABLE_RECEIPT_MAX_REQUESTS,
    clockTaskCount: tasks.length,
    clockConcurrency: ROUTINE_CLOCK_READ_CONCURRENCY,
    clockRequestsPerTask: ROUTINE_CLOCK_MAX_REQUESTS_PER_TASK,
    coordinationRequests: 3,
    readerSingleDomains: readerDomains.filter(({ mode }) => mode === "SINGLE").length,
    readerSingleTimeoutMs: ROUTINE_READER_SINGLE_TIMEOUT_MS,
    readerMeetingDomains: readerDomains.filter(({ mode }) => mode === "MEETING_AGGREGATE").length,
    readerMeetingTimeoutMs: ROUTINE_READER_MEETING_TIMEOUT_MS,
    readerConcurrency: ROUTINE_READER_CHILD_CONCURRENCY,
  });
  return startedAtMs + outer - ROUTINE_RUNNER_COORDINATION_AND_PERSISTENCE_BUDGET_MS - ROUTINE_RUNNER_OUTER_GRACE_MS;
}

/**
 * The repair domains a catch-up round could race: the meeting aggregate (it
 * composes every partition) and the single repair of any task a round may read.
 * The runner launches these first and opens rounds once they settle.
 */
export function repairDomainRacesHotReads(
  domain: Pick<RoutineReaderRepairDomain, "mode" | "contracts">,
  hotTaskIds: ReadonlySet<string>,
): boolean {
  return domain.mode === "MEETING_AGGREGATE" || domain.contracts.some(({ id }) => hotTaskIds.has(id));
}
