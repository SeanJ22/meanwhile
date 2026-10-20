import { appendFreshnessCycleDetails } from "./freshness-cycle-details.ts";
import type { FreshnessDetailReference } from "./owner-surface.ts";
import type { ControlPlaneRepositories } from "./repository/types.ts";
import type { PlannerSpool } from "./scheduler/planner-spool.ts";

/** Exact condition strings stay in the existing temporary planner until their
 * owner-history page is acknowledged. State reads retain only a finite example. */
export function freshnessConditions(planner: PlannerSpool,
  cycle: { readonly cycleId: string; readonly finishedAt: string; readonly testedSha: string | null }) {
  const pending = planner.table<{ readonly sequence: number; readonly condition: string }>("runtime-conditions", row => String(row.sequence));
  const examples: string[] = [];
  let total = 0, deferred = false, retryThrough: number | null = null, failure: string | null = null;
  let reference: FreshnessDetailReference = { cycleId: cycle.cycleId, logKey: `freshness-details:${cycle.cycleId}:runtimeConditions`, section: "runtimeConditions", rows: 0, pages: 0 };
  let flight: Promise<void> | null = null;
  const snapshot = () => ({ runtimeConditions: [...examples], runtimeConditionCount: total,
    runtimeConditionDetails: { ...reference }, runtimeConditionDetailsUnavailable: reference.rows < total
      ? failure ?? "Additional runtime conditions have not yet been saved to this report." : null });
  return {
    get length() { return total; },
    get hasDeferred() { return deferred; },
    push(...conditions: string[]) {
      for (const condition of conditions) {
        pending.add({ sequence: ++total, condition });
        if (examples.length < 12) examples.push(condition);
        if (/\bdeferred: /.test(condition)) deferred = true;
      }
      return total;
    },
    snapshot,
    line() { return total === 0 ? "no condition prevents eligible Scout work"
      : `${total} runtime conditions${total > examples.length ? `; first ${examples.length} shown, all exact conditions in the cycle report` : ""}: ${examples.join("; ")}`; },
    /** Existing local diagnostics preserve only unacknowledged rows across an
     * outage, including the frozen boundary needed to retry the same page. */
    localPending() { return pending.rows.length ? { ...snapshot(), cycle, retryThrough,
      pendingRuntimeConditions: pending.rows.map(row => row.condition) } : null; },
    flush(repos: ControlPlaneRepositories): Promise<void> {
      flight ??= (async () => {
        if (reference.rows === total) return;
        retryThrough ??= total;
        try {
          reference = await appendFreshnessCycleDetails(repos, cycle, "runtimeConditions",
            pending.rows.slice(0, retryThrough - reference.rows).map(row => row.condition), {
              previous: reference,
              onPage: next => {
                for (let sequence = reference.rows + 1; sequence <= next.rows; sequence++) pending.delete(String(sequence));
                reference = next;
              },
            });
          retryThrough = null; failure = null;
        } catch (error) {
          failure = `Additional runtime condition details could not be saved: ${error instanceof Error ? error.message : String(error)}. Pending records remain local; they are not durable report details.`;
        }
      })().finally(() => { flight = null; });
      return flight;
    },
  };
}
