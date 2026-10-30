
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { STORE_CALLS_SHOWN, allocateStallBuffer, writePendingSnapshot, type PendingSnapshot, type PendingStep, type StallDiagnosticBlock } from "./cycle-stall-report.ts";

export const MAIN_THREAD_PING_MS = 5_000;

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
  readonly stop: () => Promise<void>;
}

