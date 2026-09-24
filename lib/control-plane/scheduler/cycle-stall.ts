/**
 * **A CYCLE THAT RUNS INTO THE WALL SAYS WHAT IT WAS WAITING ON.**
 * (Runner bounded store calls, 2026-09-23.)
 *
 * On 2026-09-23 four research cycles were killed at the supervisor's 15-minute
 * wall with nothing on stderr and no local record, so what each was waiting on
 * could only be guessed from the phases it had recorded before. This names it.
 *
 * The main thread keeps a small account of what it is waiting on and publishes
 * it (cycle-stall-report.ts):
 *
 * ```
 *   the last phase     every finishPhase() of the cycle
 *   labelled awaits    a label per await site in finalization, and around the
 *                      later phases (`step`, `enter`, `sync`)
 *   store calls        every repository call in flight (`trackStoreCalls`)
 *   event-loop turns   a ping every few seconds, so a blocked loop shows
 * ```
 *
 * A worker thread (cycle-stall-worker.ts) wakes about 90 s before the wall. If
 * the cycle has not written its record by then, it writes the pending await,
 * the store calls in flight, the last phase and whether the event loop is
 * blocked to stderr — which the runner's digest carries for a failed cycle —
 * and into the cycle's local record at the path reserved at start. It never
 * ends the cycle: the wall stays the supervisor's. A cycle that then finishes
 * carries the stall block forward into its own record at the same path.
 */
import { readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";

import type { ControlPlaneRepositories } from "../repository/types.ts";
import {
  MAIN_THREAD_BLOCKED_AFTER_MS,
  RECORD_CLAIM,
  STORE_CALLS_SHOWN,
  allocateStallBuffer,
  claimRecord as casRecordClaim,
  pingMainThread,
  recordClaim,
  waitWhileClaim,
  writePendingSnapshot,
  type PendingSnapshot,
  type PendingStep,
  type StallDiagnosticBlock,
} from "./cycle-stall-report.ts";

/** The diagnostic fires this long before the supervisor's wall. */
export const CYCLE_STALL_LEAD_MS = 90_000;
/** How often the main thread reports an event-loop turn. */
export const MAIN_THREAD_PING_MS = 5_000;

/** What the cycle is waiting on, kept by the main thread and published for the worker. */
export class PendingOperations {
  readonly sab: SharedArrayBuffer;
  private readonly now: () => number;
  private lastPhase: string | null = null;
  private lastPhaseAt: string | null = null;
  private lastFailed: PendingStep | null = null;
  private readonly steps: PendingStep[] = [];
  private readonly store = new Map<number, { readonly call: string; readonly since: string }>();
  private nextToken = 0;

  constructor(options: { readonly sab?: SharedArrayBuffer; readonly now?: () => number } = {}) {
    this.sab = options.sab ?? allocateStallBuffer();
    this.now = options.now ?? Date.now;
    this.publish();
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }

  phaseFinished(name: string): void {
    this.lastPhase = name;
    this.lastPhaseAt = this.iso();
    this.publish();
  }

  /** Enter a labelled await site; the returned function leaves it (idempotent). */
  enter(label: string): () => void {
    const step: PendingStep = { label, since: this.iso() };
    this.steps.push(step);
    this.publish();
    let left = false;
    return () => {
      if (left) return;
      left = true;
      const at = this.steps.lastIndexOf(step);
      if (at >= 0) this.steps.splice(at, 1);
      this.publish();
    };
  }

  async step<T>(label: string, fn: () => Promise<T> | T): Promise<T> {
    const leave = this.enter(label);
    try {
      return await fn();
    } catch (error) {
      this.failed(label);
      throw error;
    } finally {
      leave();
    }
  }

  /** A labelled synchronous section: if it blocks, the worker still reads this label. */
  sync<T>(label: string, fn: () => T): T {
    const leave = this.enter(label);
    try {
      return fn();
    } catch (error) {
      this.failed(label);
      throw error;
    } finally {
      leave();
    }
  }

  private failed(label: string): void {
    this.lastFailed = { label, since: this.iso() };
  }

  storeCallStarted(call: string): () => void {
    const token = this.nextToken++;
    this.store.set(token, { call, since: this.iso() });
    this.publish();
    return () => {
      if (this.store.delete(token)) this.publish();
    };
  }

  snapshot(): PendingSnapshot {
    const inFlight = [...this.store.values()];
    return {
      lastPhase: this.lastPhase,
      lastPhaseAt: this.lastPhaseAt,
      steps: this.steps.map((s) => ({ label: s.label, since: s.since })),
      lastFailed: this.lastFailed,
      store: inFlight.slice(0, STORE_CALLS_SHOWN).map((c) => ({ call: c.call.slice(0, 200), since: c.since })),
      storeInFlight: inFlight.length,
      updatedAt: this.iso(),
    };
  }

  private publish(): void {
    writePendingSnapshot(this.sab, this.snapshot());
  }
}

/** One line naming what was pending, for a crash record or a digest. */
export function describePending(snapshot: PendingSnapshot): string {
  const step = snapshot.steps.at(-1);
  const store = snapshot.store.map((c) => c.call);
  return (
    `pending: ${step ? step.label : "no labelled await"}` +
    (store.length > 0 ? `; store call${store.length === 1 ? "" : "s"} in flight: ${store.join(", ")}` : "") +
    (snapshot.lastFailed ? `; last failed await: ${snapshot.lastFailed.label} at ${snapshot.lastFailed.since}` : "") +
    `; last phase: ${snapshot.lastPhase ?? "none"}`
  );
}

/**
 * Wrap the repositories so every call made through them is tracked while it is
 * in flight, as `<repository>.<method>`. Arguments are never recorded.
 */
export function trackStoreCalls(repos: ControlPlaneRepositories, pending: PendingOperations): ControlPlaneRepositories {
  return new Proxy(repos, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (!value || typeof value !== "object") return value;
      return new Proxy(value, {
        get(repository, method) {
          const operation = Reflect.get(repository, method);
          if (typeof operation !== "function") return operation;
          return (...args: unknown[]) => {
            const end = pending.storeCallStarted(`${String(key)}.${String(method)}`);
            try {
              const result = operation.apply(repository, args);
              if (result !== null && typeof result === "object" && typeof (result as PromiseLike<unknown>).then === "function") {
                (result as PromiseLike<unknown>).then(end, end);
              } else {
                end();
              }
              return result;
            } catch (error) {
              end();
              throw error;
            }
          };
        },
      });
    },
  });
}

export interface CycleStallDiagnostic {
  /**
   * Claim the reserved record path for the cycle's own record. Returns the
   * stall block when the diagnostic fired first (having waited for its write),
   * so the cycle's record carries it forward; null when the cycle was first.
   */
  readonly claimRecord: () => StallDiagnosticBlock | null;
  /** Stop pinging and end the worker. */
  readonly stop: () => Promise<void>;
}

/**
 * Start the diagnostic. The worker writes at `fireAtMs` unless the cycle
 * claimed its record first; `stdoutFd` and `stderrFd` default to the process's.
 */
export function startCycleStallDiagnostic(input: {
  readonly pending: PendingOperations;
  readonly fireAtMs: number;
  readonly processStartedMs: number;
  readonly wallAtMs: number;
  readonly recordPath: string;
  readonly startedAt: string;
  readonly cycleId: string;
  readonly testedSha: string | null;
  readonly stdoutFd?: number;
  readonly stderrFd?: number;
  readonly pingMs?: number;
  /** A main thread silent this long reads as blocked. Default MAIN_THREAD_BLOCKED_AFTER_MS. */
  readonly blockedAfterMs?: number;
}): CycleStallDiagnostic {
  const sab = input.pending.sab;
  pingMainThread(sab, Date.now());
  const pinger = setInterval(() => pingMainThread(sab, Date.now()), input.pingMs ?? MAIN_THREAD_PING_MS);
  pinger.unref();

  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL("./cycle-stall-worker.ts", import.meta.url), {
      execArgv: ["--experimental-strip-types"],
      workerData: {
        sab,
        fireAtMs: input.fireAtMs,
        processStartedMs: input.processStartedMs,
        wallAtMs: input.wallAtMs,
        recordPath: input.recordPath,
        startedAt: input.startedAt,
        cycleId: input.cycleId,
        testedSha: input.testedSha,
        stdoutFd: input.stdoutFd ?? 1,
        stderrFd: input.stderrFd ?? 2,
        blockedAfterMs: input.blockedAfterMs ?? MAIN_THREAD_BLOCKED_AFTER_MS,
      },
    });
    /* A pending diagnostic never holds the cycle open, and a dead one never takes it down. */
    worker.unref();
    worker.on("error", (error) => {
      console.error(`freshness:shadow · the stall diagnostic stopped: ${error instanceof Error ? error.message : String(error)}`);
    });
  } catch (error) {
    console.error(`freshness:shadow · the stall diagnostic could not start: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    claimRecord: () => {
      const was = casRecordClaim(sab, RECORD_CLAIM.ARMED, RECORD_CLAIM.FINALIZED);
      if (was === RECORD_CLAIM.ARMED || was === RECORD_CLAIM.FINALIZED) return null;
      /* The diagnostic fired: let its write finish, then carry its block forward. */
      if (was === RECORD_CLAIM.STALL_WRITING) waitWhileClaim(sab, RECORD_CLAIM.STALL_WRITING, 5_000);
      try {
        const held = JSON.parse(readFileSync(input.recordPath, "utf8")) as { stallDiagnostic?: StallDiagnosticBlock };
        return held.stallDiagnostic ?? null;
      } catch {
        return null;
      } finally {
        casRecordClaim(sab, recordClaim(sab), RECORD_CLAIM.FINALIZED);
      }
    },
    stop: async () => {
      clearInterval(pinger);
      try {
        await worker?.terminate();
      } catch {
        /* already gone */
      }
    },
  };
}
