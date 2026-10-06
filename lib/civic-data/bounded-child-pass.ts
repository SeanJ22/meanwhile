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
/**
 * **TWO READS OF ONE HOST IN ONE PASS ARE AT LEAST A MINUTE APART (C6, 2026-09-25).**
 * A meeting lane may take two reads a pass. They never run together, and the
 * second starts no sooner than this after the first ends, so a host's own
 * Crawl-delay holds between them: the largest any meeting host publishes is 60
 * s (morriscountynj.iqm2.com; also www.kearsarge.org and www.newbury.nh.gov 10
 * s, www.mhrd.org 5 s, read 2026-09-25).
 */
export const ROUTINE_SAME_DOMAIN_CHILD_GAP_MS = 60_000;
/** Clock reads, durable receipt readback, and the supervisor digest share this bounded allowance. */
export const ROUTINE_RUNNER_COORDINATION_AND_PERSISTENCE_BUDGET_MS = 10 * 60_000;
/** Process shutdown and timer jitter beyond the explicit coordination allowance. */
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
  /** Associate the live child tree with its already-acquired host memory slot. */
  readonly onStarted?: (pid: number) => void;
  /**
   * Commands in one upstream/provider failure domain never run concurrently.
   * Omitting this field keeps the command independent by using its unique id.
   */
  readonly failureDomain?: string;
  readonly executable: string;
  readonly args: readonly string[];
  /** Narrow per-command authority/environment; never leak one sibling's envelope to another. */
  readonly env?: NodeJS.ProcessEnv;
  /** Optional command-specific maximum interval without new facts. */
  readonly timeoutMs?: number;
  /** Optional command-specific output ceiling. */
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
  /** A settlement/classification callback failure, contained to this child. */
  readonly settlementErrorMessage?: string | null;
}

export interface BoundedChildPassOptions {
  readonly cwd: string;
  /** The least time between one command of a failure domain ending and the next starting. */
  readonly sameDomainGapMs?: number;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
  readonly maxBufferBytes?: number;
  readonly concurrency?: number;
  /** Run once when the command wins a worker slot, before source access begins. */
  readonly onStarting?: (command: BoundedChildCommand, index: number) => Promise<void> | void;
  /** Classify/persist a result as soon as its worker settles. */
  readonly onSettled?: (result: BoundedChildResult, index: number) => Promise<void> | void;
  /** Drop stdout/stderr after onSettled so a large portfolio cannot accumulate it. */
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
    let lines = "";
    const observed = new Set<string>();
    const renew = () => {
      clearTimeout(idle);
      if (timeout > 0) idle = setTimeout(() => {
        paused = true;
        // Stop this no-progress pass cooperatively; retained work remains due.
        child.kill("SIGTERM");
      }, timeout);
    };
    const child = execFile(
      command.executable,
      [...command.args],
      {
        cwd: options.cwd,
        env: command.env ?? options.env,
        encoding: "utf8",
        maxBuffer,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        clearTimeout(idle);
        const code = error && "code" in error ? error.code : null;
        const signal = error && "signal" in error && error.signal
          ? error.signal as NodeJS.Signals
          : null;
        const killed = Boolean(error && "killed" in error && error.killed);
        const outputLimited = code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
        const timedOut = !outputLimited && (paused || killed);
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
          errorMessage: paused ? `NO_PROGRESS_PAUSED: no new publication for ${timeout}ms. ${error?.message ?? ""}` : error?.message ?? null,
        });
      },
    );
    child.once("spawn", () => command.onStarted?.(child.pid!));
    child.stdout?.on("data", chunk => {
      lines += String(chunk);
      const complete = lines.split(/\r?\n/);
      lines = complete.pop() ?? "";
      for (const line of complete) {
        /* Vital signs: a child's hour totals reach the runner through this process's own output (transfer-by-caller.ts). */
        if (line.startsWith(VITAL_SIGNS_LINE_PREFIX)) { process.stdout.write(`${line}\n`); continue; }
        if (!line.startsWith("RCD_PROGRESS=")) continue;
        try {
          const progress = JSON.parse(line.slice("RCD_PROGRESS=".length)) as { key?: unknown; records?: unknown };
          if (typeof progress.key === "string" && progress.key && typeof progress.records === "number" &&
            Number.isSafeInteger(progress.records) && progress.records > 0 && !observed.has(progress.key)) {
            observed.add(progress.key); renew();
          }
        } catch { /* Ordinary output never renews the progress clock. */ }
      }
    });
    renew();
  });
}

/**
 * Drain the complete due set through a fixed-size pool. Results retain registry
 * order, and every queued sibling is eventually launched even when an earlier
 * child times out, exceeds its output limit, or throws in the launcher.
 */
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
  const domainFreeAt = new Map<string, number>();
  const activeRuns = new Map<number, Promise<void>>();
  let completed = 0;
  const waiting = () => commands
    .map((_, index) => index)
    .filter((index) => !started.has(index) && !activeDomains.has(failureDomains[index]!));

  while (completed < commands.length) {
    while (activeRuns.size < concurrency) {
      const now = Date.now();
      const index = waiting().find((candidate) => (domainFreeAt.get(failureDomains[candidate]!) ?? 0) <= now);
      if (index === undefined) break;

      const failureDomain = failureDomains[index]!;
      started.add(index);
      activeDomains.add(failureDomain);
      const activeRun = runAt(index).finally(() => {
        activeDomains.delete(failureDomain);
        if (gapMs > 0) domainFreeAt.set(failureDomain, Date.now() + gapMs);
        activeRuns.delete(index);
        completed += 1;
      });
      activeRuns.set(index, activeRun);
    }

    // A command held only by its domain's gap wakes the dispatcher when the gap ends.
    const gated = waiting().map((index) => domainFreeAt.get(failureDomains[index]!) ?? 0).filter((at) => at > Date.now());
    if (activeRuns.size === 0 && gated.length === 0) {
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

/** Exact worst-case sum of every killable/cancellable phase plus local margin. */
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
  // A domain's commands run one after another with a gap between them (C6).
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
