/**
 * The research cycle's startup authority reads, re-read within connect-retry's bounds when the store could not
 * be asked. Only a failed read is retried (never a deterministic failure), and nothing is retried while the
 * host-local Neon circuit is latched. The last result or error is returned unchanged.
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
    // The final attempt was an unreachable result: return it so the caller's own named failure runs.
    if (error instanceof UnreachableStartupRead && last.held) return last.value as T;
    throw error;
  }
}
