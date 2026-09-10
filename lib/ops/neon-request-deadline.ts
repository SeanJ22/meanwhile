import { neonConfig } from "@neondatabase/serverless";

/**
 * Canonical-store requests in a standing runtime must settle or abort. The
 * source-acquisition children have an OS process ceiling; this smaller bound
 * covers the supervisor's Neon HTTP coordination, readback, and receipts.
 */
export const STANDING_NEON_REQUEST_DEADLINE_MS = 30_000;

type FetchLike = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => Promise<Response>;

function deadlineSignal(prior: AbortSignal | null | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return prior ? AbortSignal.any([prior, timeout]) : timeout;
}

/**
 * Compose a real transport cancellation around a fetch implementation.
 * Unlike Promise.race, aborting the signal tells the underlying request to
 * stop, so repeated standing cycles cannot accumulate abandoned I/O promises.
 */
export function neonRequestDeadlineFetch(
  underlying: FetchLike,
  timeoutMs: number = STANDING_NEON_REQUEST_DEADLINE_MS,
): FetchLike {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`NEON_REQUEST_DEADLINE_INVALID:${timeoutMs}`);
  }
  return async (input, init) => underlying(input, {
    ...init,
    signal: deadlineSignal(init?.signal, timeoutMs),
  });
}

/** Install before constructing any Neon client; safe to compose with the circuit breaker. */
export function installNeonRequestDeadline(
  timeoutMs: number = STANDING_NEON_REQUEST_DEADLINE_MS,
): FetchLike {
  const underlying = (neonConfig.fetchFunction ?? fetch) as FetchLike;
  const guarded = neonRequestDeadlineFetch(underlying, timeoutMs);
  neonConfig.fetchFunction = guarded;
  return guarded;
}
