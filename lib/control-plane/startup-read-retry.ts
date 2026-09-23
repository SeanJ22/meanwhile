/**
 * The research cycle's startup authority reads, retried across a transient
 * store blip.
 *
 * Before a cycle can dispatch anything it reads two authorities: the method
 * candidate authority (control plane) and the operational reference bundle
 * (the production civic-data store). Both are idempotent reads, and both turn a
 * failed read into a named "store unreachable" result — a status, or a
 * CivicDataStoreUnavailableError that keeps only the cause's name — so
 * connect-retry's transport classifier never sees the transport failure. On
 * 2026-09-22 at 21:34:53Z, with the runner host's CPU saturated, one such read
 * failed and the hourly cycle crashed 18 s in having dispatched nothing; the
 * next chance was an hour away. Both endpoints answered 16 of 16 reads three
 * minutes later.
 *
 * So an unreachable startup read is re-read within connect-retry's bounds
 * (attempt count, capped jittered backoff), with two limits:
 *   - only a failed READ is retried — `STORE_READ_FAILED`, a transport
 *     transient, or the read's own unreachable status. A missing store
 *     configuration, a missing candidate or an invalid promotion proof is
 *     deterministic and fails on the first attempt, as before;
 *   - nothing is retried while the host-local Neon circuit is latched. That is
 *     a HARD refusal whose contract forbids an automated retry before its
 *     eligible time.
 * The last result or error is handed back unchanged, so a persistent outage
 * still fails the cycle through the read's own named-failure path.
 */
import { CivicDataStoreUnavailableError } from "../civic-data/read-model.ts";
import {
  isTransientControlPlaneConnectError,
  withControlPlaneConnectRetry,
  type ControlPlaneConnectRetryOptions,
} from "./repository/connect-retry.ts";

export interface StartupReadRetryOptions extends Omit<ControlPlaneConnectRetryOptions, "isRetryable"> {
  /** True while the host-local Neon circuit is latched (neon-circuit.ts). */
  readonly circuitLatched: () => boolean;
}

/** Carries an unreachable RESULT through the retry loop; it never escapes this module. */
class UnreachableStartupRead extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "UnreachableStartupRead";
  }
}

/** True for a failure worth one more read: a failed store read or a transport transient. */
export function isRetryableStartupReadError(error: unknown): boolean {
  if (error instanceof UnreachableStartupRead) return true;
  if (error instanceof CivicDataStoreUnavailableError) return error.result.code === "STORE_READ_FAILED";
  return isTransientControlPlaneConnectError(error);
}

/**
 * Run an idempotent startup read, re-reading while it reports the store could
 * not be asked. `unreachable` names a result that is itself an unreachable
 * status (its detail), or returns null for a usable result.
 */
export async function retryStartupRead<T>(
  read: () => Promise<T>,
  unreachable: (result: T) => string | null,
  options: StartupReadRetryOptions,
): Promise<T> {
  const { circuitLatched, ...retry } = options;
  const last: { held: boolean; value: T | undefined } = { held: false, value: undefined };
  try {
    return await withControlPlaneConnectRetry(async () => {
      const value = await read();
      const detail = unreachable(value);
      if (detail !== null) {
        last.held = true;
        last.value = value;
        throw new UnreachableStartupRead(detail);
      }
      return value;
    }, {
      ...retry,
      isRetryable: (error) => !circuitLatched() && isRetryableStartupReadError(error),
    });
  } catch (error) {
    // The final attempt was an unreachable RESULT: return it, so the caller's
    // own named failure runs exactly as it did before this retry existed.
    if (error instanceof UnreachableStartupRead && last.held) return last.value as T;
    throw error;
  }
}
