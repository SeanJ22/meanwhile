import { neonConfig } from "@neondatabase/serverless";
import { statementWritesRows } from "../db/sql-mutation.ts";

/**
 * Canonical-store reads in a standing runtime must settle or abort. The
 * source-acquisition children have an OS process ceiling; this smaller bound
 * covers the supervisor's Neon HTTP coordination and readback. Row writes
 * finish without our transport deadline.
 */
export const STANDING_NEON_REQUEST_DEADLINE_MS = 30_000;

type FetchLike = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => Promise<Response>;

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
  return async (input, init) => {
    let persistsRows = false;
    if (typeof init?.body === "string") {
      try {
        const body = JSON.parse(init.body) as { query?: unknown; queries?: { query?: unknown }[] };
        const queries = body.queries ?? [body];
        persistsRows = queries.some(query => typeof query.query === "string" && statementWritesRows(query.query));
      } catch { /* A non-query request retains its existing transport deadline. */ }
    }
    if (persistsRows) return await underlying(input, init);
    const deadline = new AbortController();
    // Keep an outstanding request alive even when its transport has no active
    // socket (including mocked transports). AbortSignal.timeout is unref'd.
    const timer = setTimeout(() => deadline.abort(new DOMException("Neon request timed out", "TimeoutError")), timeoutMs);
    try {
      return await underlying(input, {
        ...init,
        signal: init?.signal ? AbortSignal.any([init.signal, deadline.signal]) : deadline.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };
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
