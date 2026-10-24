import { execFile } from "node:child_process";

import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { VITAL_SIGNS_LINE_PREFIX } from "../db/transfer-by-caller.ts";

/** Maximum quiet interval; each new source publication renews it. Never a child wall. */
export const ROUTINE_CHILD_TIMEOUT_MS = 30 * 60_000;
/** `execFile` applies this cap independently to stdout and stderr. */
export const ROUTINE_CHILD_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
/**
 * Four children bound worst-case buffered stdio to 128 MiB plus their Node
 * heaps. This is deliberately conservative for the standing owner host while
 * still isolating independent source/body acquisitions in parallel.
 */
export const ROUTINE_CHILD_CONCURRENCY = 4;
/** Two reads in one failure domain start at least a minute apart, so a host's published Crawl-delay holds. */
export const ROUTINE_SAME_DOMAIN_CHILD_GAP_MS = 60_000;
export const ROUTINE_RUNNER_COORDINATION_AND_PERSISTENCE_BUDGET_MS = 10 * 60_000;
export const ROUTINE_RUNNER_OUTER_GRACE_MS = 60_000;

export interface RoutineRunnerOuterBounds {
  readonly neonRequestDeadlineMs: number;
  readonly settlementRequestsPerCommand: number;
  readonly clockTaskCount: number;
  readonly clockConcurrency: number;
  readonly clockRequestsPerTask: number;
  readonly coordinationRequests: number;
  readonly readerSingleDomains: number;
  readonly readerSingleTimeoutMs: number;
  readonly readerMeetingDomains: number;
  readonly readerMeetingTimeoutMs: number;
  readonly readerConcurrency: number;
}

export type BoundedChildTermination =
  | "EXITED"
  | "TIMED_OUT"
  | "OUTPUT_LIMIT_EXCEEDED"
  | "SPAWN_FAILED";

export interface BoundedChildCommand {
  readonly id: string;
  readonly onStarted?: (pid: number) => void;
  /**
   * Commands in one upstream/provider failure domain never run concurrently.
   * Omitting this field keeps the command independent by using its unique id.
   */
  readonly failureDomain?: string;
  /** Commands sharing a serial lane run one at a time, back to back: no same-domain gap, which is a host's courtesy. */
  readonly serialLane?: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
  readonly maxBufferBytes?: number;
}

export interface BoundedChildResult {
  readonly id: string;
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly termination: BoundedChildTermination;
  readonly errorMessage: string | null;
  readonly settlementErrorMessage?: string | null;
}

export interface BoundedChildPassOptions {
  readonly cwd: string;
  /** The least time between one command of a failure domain ending and the next starting. */
  readonly sameDomainGapMs?: number;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
  /** The pass's deadline: a child still running then is ended, and its work stays owed. */
  readonly deadlineMs?: number;
  readonly maxBufferBytes?: number;
  readonly concurrency?: number;
  readonly onStarting?: (command: BoundedChildCommand, index: number) => Promise<void> | void;
  readonly onSettled?: (result: BoundedChildResult, index: number) => Promise<void> | void;
  readonly discardOutputAfterSettlement?: boolean;
}

export type BoundedChildLauncher = (
  command: BoundedChildCommand,
  options: BoundedChildPassOptions,
) => Promise<BoundedChildResult>;

function runOneBoundedChild(
  command: BoundedChildCommand,
  options: BoundedChildPassOptions,
): Promise<BoundedChildResult> {
  const timeout = command.timeoutMs ?? options.timeoutMs ?? ROUTINE_CHILD_TIMEOUT_MS;
  const maxBuffer = command.maxBufferBytes ?? options.maxBufferBytes ?? ROUTINE_CHILD_MAX_BUFFER_BYTES;
  if (!Number.isSafeInteger(timeout) || timeout < 0) throw new Error(`BOUNDED_CHILD_TIMEOUT_INVALID:${timeout}`);
  if (!Number.isSafeInteger(maxBuffer) || maxBuffer <= 0) throw new Error(`BOUNDED_CHILD_OUTPUT_LIMIT_INVALID:${maxBuffer}`);

  return new Promise((resolve) => {
    let idle: ReturnType<typeof setTimeout> | undefined;
    let paused = false;
    let late = false;
    let lines = "";
    const observed = new Set<string>();
    const renew = () => {
      clearTimeout(idle);
      if (timeout > 0) idle = setTimeout(() => {
        paused = true;
        child.kill("SIGTERM");
      }, timeout);
    };
    const child = execFile(
      command.executable,
      [...command.args],
      {
        cwd: options.cwd,
        env: { ...(command.env ?? options.env), WTP_DATABASE_JOB: command.id },
        encoding: "utf8",
        maxBuffer,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        clearTimeout(idle);
        clearTimeout(wall);
        const code = error && "code" in error ? error.code : null;
        const signal = error && "signal" in error && error.signal
          ? error.signal as NodeJS.Signals
          : null;
        const killed = Boolean(error && "killed" in error && error.killed);
        const outputLimited = code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
        const timedOut = !outputLimited && (paused || late || killed);
        const termination: BoundedChildTermination = outputLimited
            ? "OUTPUT_LIMIT_EXCEEDED"
            : timedOut
              ? "TIMED_OUT"
              : error === null || typeof code === "number"
                ? "EXITED"
                : "SPAWN_FAILED";
        resolve({
          id: command.id,
          status: error === null ? 0 : typeof code === "number" ? code : null,
          signal,
          stdout,
          stderr,
          termination,
          errorMessage: late ? "PASS_TIME_BUDGET: the pass reached its deadline; the next pass continues this work"
            : paused ? `NO_PROGRESS_PAUSED: no new publication for ${timeout}ms. ${error?.message ?? ""}` : error?.message ?? null,
        });
      },
    );
    const wall = options.deadlineMs === undefined ? undefined : setTimeout(() => {
      late = true;
      child.kill("SIGTERM");
    }, Math.max(0, options.deadlineMs - Date.now()));
    child.once("spawn", () => command.onStarted?.(child.pid!));
    child.stdout?.on("data", chunk => {
      lines += String(chunk);
      const complete = lines.split(/\r?\n/);
      lines = complete.pop() ?? "";
      for (const line of complete) {
        if (line.startsWith(VITAL_SIGNS_LINE_PREFIX)) { process.stdout.write(`${line}\n`); continue; }
        if (!line.startsWith("RCD_PROGRESS=")) continue;
        try {
          const progress = JSON.parse(line.slice("RCD_PROGRESS=".length)) as { key?: unknown; records?: unknown };
          if (typeof progress.key === "string" && progress.key && typeof progress.records === "number" &&
            Number.isSafeInteger(progress.records) && progress.records > 0 && !observed.has(progress.key)) {
            observed.add(progress.key); renew();
          }
        } catch {}
      }
    });
    renew();
  });
}

export async function runBoundedChildPass(
  commands: readonly BoundedChildCommand[],
  options: BoundedChildPassOptions,
  launch: BoundedChildLauncher = runOneBoundedChild,
): Promise<readonly BoundedChildResult[]> {
  const ids = commands.map((command) => command.id);
  if (new Set(ids).size !== ids.length) throw new Error("BOUNDED_CHILD_IDS_NOT_UNIQUE");
  const failureDomains = commands.map((command) => command.failureDomain ?? command.id);
  for (const failureDomain of failureDomains) {
    if (!failureDomain || failureDomain !== failureDomain.trim() || /[\r\n]/.test(failureDomain)) {
      throw new Error(`BOUNDED_CHILD_FAILURE_DOMAIN_INVALID:${failureDomain}`);
    }
  }
  const concurrency = options.concurrency ?? ROUTINE_CHILD_CONCURRENCY;
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
    throw new Error(`BOUNDED_CHILD_CONCURRENCY_INVALID:${concurrency}`);
  }
  const results = new Array<BoundedChildResult>(commands.length);
  const runAt = async (index: number): Promise<void> => {
    const command = commands[index]!;
    let result: BoundedChildResult;
    try {
      if (options.onStarting) await options.onStarting(command, index);
      result = await launch(command, options);
    } catch (error) {
      result = {
        id: command.id,
        status: null,
        signal: null,
        stdout: "",
        stderr: "",
        termination: "SPAWN_FAILED",
        errorMessage: sanitizedErrorDiagnostic(error),
      };
    }
    let settlementErrorMessage: string | null = null;
    try {
      await options.onSettled?.(result, index);
    } catch (error) {
      settlementErrorMessage = sanitizedErrorDiagnostic(error);
    }
    results[index] = {
      ...result,
      stdout: options.discardOutputAfterSettlement ? "" : result.stdout,
      stderr: options.discardOutputAfterSettlement ? "" : result.stderr,
      settlementErrorMessage,
    };
  };

  // A central dispatcher is necessary here: workers that dequeue a second
  // command for an already-active provider would otherwise block while free
  // work from unrelated providers remained queued. Scan in registry order for
  // the next runnable domain, fill every free global lane, and release that
  // domain only after its result has been durably classified by `onSettled`.
  const gapMs = options.sameDomainGapMs ?? 0;
  if (!Number.isSafeInteger(gapMs) || gapMs < 0) throw new Error(`BOUNDED_CHILD_DOMAIN_GAP_INVALID:${gapMs}`);
  const started = new Set<number>();
  const activeDomains = new Set<string>();
  const activeLanes = new Set<string>();
  const domainFreeAt = new Map<string, number>();
  const activeRuns = new Map<number, Promise<void>>();
  let completed = 0;
  const waiting = () => commands
    .map((_, index) => index)
    .filter((index) => !started.has(index) && !activeDomains.has(failureDomains[index]!) &&
      (commands[index]!.serialLane === undefined || !activeLanes.has(commands[index]!.serialLane!)));

  while (completed < commands.length) {
    while (activeRuns.size < concurrency) {
      const now = Date.now();
      const index = waiting().find((candidate) => (domainFreeAt.get(failureDomains[candidate]!) ?? 0) <= now);
      if (index === undefined) break;

      const failureDomain = failureDomains[index]!;
      const lane = commands[index]!.serialLane;
      started.add(index);
      activeDomains.add(failureDomain);
      if (lane !== undefined) activeLanes.add(lane);
      const activeRun = runAt(index).finally(() => {
        activeDomains.delete(failureDomain);
        if (lane !== undefined) activeLanes.delete(lane);
        if (gapMs > 0) domainFreeAt.set(failureDomain, Date.now() + gapMs);
        activeRuns.delete(index);
        completed += 1;
      });
      activeRuns.set(index, activeRun);
    }

    const pending = waiting();
    const gated = pending.map((index) => domainFreeAt.get(failureDomains[index]!) ?? 0).filter((at) => at > Date.now());
    if (activeRuns.size === 0 && gated.length === 0) {
      // A host's gap can expire between dispatch and this clock read. Offer that waiting work again.
      if (pending.length > 0) continue;
      throw new Error("BOUNDED_CHILD_DISPATCH_DEADLOCK");
    }
    const wake = gated.length > 0 && activeRuns.size < concurrency
      ? new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, Math.min(...gated) - Date.now())))
      : null;
    await Promise.race([...activeRuns.values(), ...(wake ? [wake] : [])]);
  }
  return results;
}

export function largestFailureDomainCardinality(failureDomains: readonly string[]): number {
  const counts = new Map<string, number>();
  let largest = 0;
  for (const failureDomain of failureDomains) {
    if (!failureDomain || failureDomain !== failureDomain.trim() || /[\r\n]/.test(failureDomain)) {
      throw new Error(`BOUNDED_CHILD_FAILURE_DOMAIN_INVALID:${failureDomain}`);
    }
    const count = (counts.get(failureDomain) ?? 0) + 1;
    counts.set(failureDomain, count);
    largest = Math.max(largest, count);
  }
  return largest;
}

export function routineChildPassWorstCaseMs(
  commandCount: number,
  childTimeoutMs: number = ROUTINE_CHILD_TIMEOUT_MS,
  concurrency: number = ROUTINE_CHILD_CONCURRENCY,
  largestFailureDomainSize: number = commandCount === 0 ? 0 : 1,
): number {
  if (!Number.isSafeInteger(commandCount) || commandCount < 0) {
    throw new Error(`BOUNDED_CHILD_COMMAND_COUNT_INVALID:${commandCount}`);
  }
  if (!Number.isSafeInteger(childTimeoutMs) || childTimeoutMs <= 0) {
    throw new Error(`BOUNDED_CHILD_TIMEOUT_INVALID:${childTimeoutMs}`);
  }
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
    throw new Error(`BOUNDED_CHILD_CONCURRENCY_INVALID:${concurrency}`);
  }
  if (
    !Number.isSafeInteger(largestFailureDomainSize) ||
    largestFailureDomainSize < (commandCount === 0 ? 0 : 1) ||
    largestFailureDomainSize > commandCount
  ) {
    throw new Error(`BOUNDED_CHILD_FAILURE_DOMAIN_SIZE_INVALID:${largestFailureDomainSize}`);
  }
  if (commandCount === 0) return 0;

  // With independent commands the exact bound remains the ordinary pool wave
  // count. For domain chains, this is the standard work-plus-critical-path
  // list-scheduling bound: (W-L)/C + L. It cannot understate a portfolio whose
  // largest provider must be processed serially.
  const waves = largestFailureDomainSize === 1
    ? Math.ceil(commandCount / concurrency)
    : Math.ceil(
        (commandCount + (concurrency - 1) * largestFailureDomainSize) / concurrency,
      );
  return waves * childTimeoutMs;
}

export function routineRunnerOuterTimeoutMs(
  commandCount: number,
  largestFailureDomainSize: number = commandCount === 0 ? 0 : 1,
  bounds?: RoutineRunnerOuterBounds,
): number {
  const work = routineRunnerBoundedWorkMs(commandCount, largestFailureDomainSize, bounds);
  return work +
    ROUTINE_RUNNER_COORDINATION_AND_PERSISTENCE_BUDGET_MS +
    ROUTINE_RUNNER_OUTER_GRACE_MS;
}

function nonNegativeSafeInteger(value: number, code: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${code}:${value}`);
}

export function routineRunnerBoundedWorkMs(
  commandCount: number,
  largestFailureDomainSize: number = commandCount === 0 ? 0 : 1,
  bounds?: RoutineRunnerOuterBounds,
): number {
  if (!bounds) {
    return routineChildPassWorstCaseMs(
      commandCount,
      ROUTINE_CHILD_TIMEOUT_MS,
      ROUTINE_CHILD_CONCURRENCY,
      largestFailureDomainSize,
    );
  }
  for (const [value, code] of [
    [bounds.neonRequestDeadlineMs, "ROUTINE_NEON_DEADLINE_INVALID"],
    [bounds.settlementRequestsPerCommand, "ROUTINE_SETTLEMENT_REQUEST_COUNT_INVALID"],
    [bounds.clockTaskCount, "ROUTINE_CLOCK_TASK_COUNT_INVALID"],
    [bounds.clockConcurrency, "ROUTINE_CLOCK_CONCURRENCY_INVALID"],
    [bounds.clockRequestsPerTask, "ROUTINE_CLOCK_REQUEST_COUNT_INVALID"],
    [bounds.coordinationRequests, "ROUTINE_COORDINATION_REQUEST_COUNT_INVALID"],
    [bounds.readerSingleDomains, "ROUTINE_READER_SINGLE_COUNT_INVALID"],
    [bounds.readerSingleTimeoutMs, "ROUTINE_READER_SINGLE_TIMEOUT_INVALID"],
    [bounds.readerMeetingDomains, "ROUTINE_READER_MEETING_COUNT_INVALID"],
    [bounds.readerMeetingTimeoutMs, "ROUTINE_READER_MEETING_TIMEOUT_INVALID"],
    [bounds.readerConcurrency, "ROUTINE_READER_CONCURRENCY_INVALID"],
  ] as const) nonNegativeSafeInteger(value, code);
  if (
    bounds.neonRequestDeadlineMs === 0 || bounds.clockConcurrency === 0 ||
    bounds.readerConcurrency === 0 ||
    (bounds.readerSingleDomains > 0 && bounds.readerSingleTimeoutMs === 0) ||
    (bounds.readerMeetingDomains > 0 && bounds.readerMeetingTimeoutMs === 0)
  ) throw new Error("ROUTINE_RUNNER_OUTER_BOUND_ZERO");

  const settlementMs = bounds.settlementRequestsPerCommand * bounds.neonRequestDeadlineMs;
  const acquisitionMs = routineChildPassWorstCaseMs(
    commandCount,
    ROUTINE_CHILD_TIMEOUT_MS + settlementMs,
    ROUTINE_CHILD_CONCURRENCY,
    largestFailureDomainSize,
  ) + Math.max(0, largestFailureDomainSize - 1) * ROUTINE_SAME_DOMAIN_CHILD_GAP_MS;
  const clockMs = Math.ceil(bounds.clockTaskCount / bounds.clockConcurrency) *
    bounds.clockRequestsPerTask * bounds.neonRequestDeadlineMs;
  const coordinationMs = bounds.coordinationRequests * bounds.neonRequestDeadlineMs;
  // Mixed per-command timeouts are conservatively summed by class. This may
  // overstate overlap, but can never let the parent kill a conforming child.
  const readerMs = Math.ceil(bounds.readerSingleDomains / bounds.readerConcurrency) *
      bounds.readerSingleTimeoutMs +
    bounds.readerMeetingDomains * bounds.readerMeetingTimeoutMs;
  return acquisitionMs + clockMs + coordinationMs + readerMs;
}

export function routineRunnerOuterTimeoutCompatible(
  outerTimeoutMs: number,
  commandCount: number,
  largestFailureDomainSize: number = commandCount === 0 ? 0 : 1,
  bounds?: RoutineRunnerOuterBounds,
): boolean {
  return outerTimeoutMs > routineRunnerBoundedWorkMs(
    commandCount,
    largestFailureDomainSize,
    bounds,
  ) + ROUTINE_RUNNER_COORDINATION_AND_PERSISTENCE_BUDGET_MS;
}
