import { neonConfig } from "@neondatabase/serverless";
import { getDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import { performance } from "node:perf_hooks";
import { transferRead } from "../db/reader-route.ts";

/**
 * Canonical-store requests in a standing runtime must settle or abort. The
 * source-acquisition children have an OS process ceiling; this smaller bound
 * covers the supervisor's Neon HTTP coordination, readback, and receipts.
 */
export const STANDING_NEON_REQUEST_DEADLINE_MS = 30_000;

/** Keep the read/timer diagnosis in the heartbeat even when a stack or a later
 * crash-recording failure follows it in the child's stderr. */
export function neonReadFailureLine(stderr: string): string | null {
  return stderr.split(/\r?\n/).filter(line => /OPERATIONAL_REFERENCE_STATE_READ_FAILED:|Neon request deadline:/.test(line)).at(-1)?.trim().slice(0, 900) ?? null;
}

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
    // Query parameters can contain private values; table names identify the
    // transport operation without putting parameter contents in diagnostics.
    const read = transferRead(typeof init?.body === "string" ? init.body : undefined).replace(/:[^,]+/g, "");
    const started = performance.now();
    const loop = performance.eventLoopUtilization();
    let phase = "headers";
    const deadline = new AbortController();
    // Keep an outstanding request alive even when its transport has no active
    // socket (including mocked transports). AbortSignal.timeout is unref'd.
    const timer = setTimeout(() => {
      const elapsedMs = Math.round(performance.now() - started);
      const utilization = performance.eventLoopUtilization(loop);
      const diagnostic = { pid: process.pid, read, timer: "standing-neon-request-deadline", deadlineMs: timeoutMs, phase, elapsedMs, timerLateMs: Math.max(0, elapsedMs - timeoutMs),
        eventLoopUtilization: Number(utilization.utilization.toFixed(3)), rssBytes: process.memoryUsage.rss(),
        connectAttemptWindowMs: getDefaultAutoSelectFamilyAttemptTimeout() };
      console.error(`Neon request deadline: ${JSON.stringify(diagnostic)}`);
      deadline.abort(new DOMException(`NEON_REQUEST_DEADLINE: read=${read} timer=standing-neon-request-deadline deadlineMs=${timeoutMs} phase=${phase} elapsedMs=${elapsedMs}`, "TimeoutError"));
    }, timeoutMs);
    const caller = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = caller ? AbortSignal.any([caller, deadline.signal]) : deadline.signal;
    try {
      const response = await underlying(input, { ...init, signal });
      phase = "body";
      if (response.body === null) { clearTimeout(timer); return response; }
      const reader = response.body.getReader();
      const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
      const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            signal.throwIfAborted();
            const chunk = await reader.read();
            signal.throwIfAborted();
            if (chunk.done) { finish(); controller.close(); }
            else controller.enqueue(chunk.value);
          } catch (error) { finish(); controller.error(error); }
        },
        async cancel(reason) { try { await reader.cancel(reason); } finally { finish(); } },
      }, { highWaterMark: 0 });
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch (error) {
      clearTimeout(timer);
      throw error;
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
