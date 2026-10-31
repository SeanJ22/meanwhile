import type { WorkList, WorkRow } from "../core/work.ts";
import { runBoundedWorkPool } from "./bounded-work-pool.ts";
import { sanitizedErrorDiagnostic } from "./error-diagnostic.ts";

/** This many database failures in a row end the turn; the runner starts it again. */
export const HICCUPS_BEFORE_STOPPING = 5;
/** One item's work ends here, well inside the runner's 10-minute no-progress limit. */
export const ITEM_READ_MS = 180_000;

/** A lane's claim loop: slots claim one row each, renew its lease each minute, and race its work against the lease, `readMs` (settles with `slow`, else fails) and the turn's end (the row goes back, unfailed). A failure is written back with `later`; if that fails too the lease runs out. */
export async function runClaimLoop<R>(input: { readonly concurrency: number; readonly maxClaims?: number; readonly stopRequested: () => boolean;
  readonly turnEnd?: AbortSignal; readonly sleep?: (ms: number) => Promise<void>; readonly log?: (line: string) => void;
  readonly stats: { claimed: number; failed: number; released: number };
  readonly list: Pick<WorkList, "renew" | "release" | "later">; readonly claim: () => Promise<WorkRow | undefined>; readonly readMs?: number; readonly slow?: R;
  readonly work: (claim: WorkRow, signal: AbortSignal) => Promise<R>; readonly settle: (claim: WorkRow, result: R) => Promise<void> }) {
  const { stats, list, readMs } = input, maximum = input.maxClaims ?? Infinity, sleep = input.sleep ?? (ms => new Promise<void>(done => setTimeout(done, ms)));
  if (input.maxClaims !== undefined && (!Number.isSafeInteger(maximum) || maximum < 1)) throw Error("WORK_INVALID_BATCH");
  const quiet = (write: Promise<unknown>) => write.catch(inner => input.log?.(sanitizedErrorDiagnostic(inner)));
  let reserved = 0, hiccups = 0;
  const results = await runBoundedWorkPool(Array.from({ length: input.concurrency }, (_, i) => i), input.concurrency, async () => {
    while (!input.stopRequested() && reserved < maximum) {
      reserved++;
      let claim: WorkRow | undefined;
      // A database that is slow for one claim holds this slot for a moment; it does not end every other slot's turn.
      try { claim = await input.claim(); hiccups = 0; }
      catch (error) {
        reserved--; stats.failed++; input.log?.(sanitizedErrorDiagnostic(error));
        if (++hiccups >= HICCUPS_BEFORE_STOPPING) throw error;
        await sleep(5_000); continue;
      }
      if (!claim) { reserved--; if (!input.sleep) break; await sleep(5_000); continue; }
      stats.claimed++;
      const controller = new AbortController(), signal = input.turnEnd ? AbortSignal.any([controller.signal, input.turnEnd]) : controller.signal;
      let renewing = false, limit: ReturnType<typeof setTimeout> | undefined;
      const timer = setInterval(() => {
        if (renewing) return;
        renewing = true;
        void list.renew(claim).then(held => { if (!held) controller.abort(new Error("WORK_LEASE_LOST")); }).catch(error => controller.abort(error)).finally(() => { renewing = false; });
      }, 60_000);
      try {
        // Work that ignores the signal, or never answers, cannot hold the turn open past its end.
        const result = await Promise.race([input.work(claim, signal), new Promise<R>((done, fail) => {
          if (readMs !== undefined) limit = setTimeout(() => input.slow === undefined ? fail(new Error(`READ_TIMED_OUT: no answer in ${readMs / 1000} s`)) : done(input.slow), readMs);
        }), new Promise<never>((_, reject) => { if (signal.aborted) reject(signal.reason); else signal.addEventListener("abort", () => reject(signal.reason), { once: true }); })]);
        controller.signal.throwIfAborted();
        await input.settle(claim, result);
      } catch (error) {
        if (input.turnEnd?.aborted) { stats.released++; await quiet(list.release(claim)); continue; }
        stats.failed++;
        const detail = sanitizedErrorDiagnostic(error);
        input.log?.(detail);
        await quiet(list.later(claim, detail));
      } finally { clearInterval(timer); clearTimeout(limit); }
    }
  });
  for (const result of results) if (!result.ok) throw Error(result.error);
}
