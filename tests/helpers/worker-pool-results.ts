import assert from "node:assert/strict";
import type { DispatchResult } from "../../lib/control-plane/scheduler/dispatch.ts";
import { runLeaseWorkerProcesses as runPool } from "../../lib/control-plane/workers/process-pool.ts";

/** Small fixture callers can inspect their callback results; the pool retains only totals. */
export async function runLeaseWorkerProcesses(input: Parameters<typeof runPool>[0]): Promise<DispatchResult[]> {
  const results: DispatchResult[] = [];
  const summary = await runPool({ ...input, onDispatched: async result => { results.push(result); await input.onDispatched?.(result); } });
  assert.equal(summary.dispatched, results.length);
  return results;
}
