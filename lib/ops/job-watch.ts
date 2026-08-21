/**
 * **RULING 56's decision, separated from its plumbing.** (NH Hunt 3,
 * 2026-08-21.)
 *
 * `scripts/watch-workflows.mts` talks to the GitHub Actions API, reads the
 * tracker store and shells out to the tracker writer. None of that is the rule.
 * The rule is one function over a list of runs, and it lives here so
 * `tests/watch-workflows.test.ts` can hold it against fixed lists without a
 * network — a watcher whose own logic is only exercised in production is the
 * shape it exists to catch.
 */

/** One completed workflow run, as the Actions API reports it. */
export interface WorkflowRun {
  databaseId: number;
  conclusion: string | null;
  status: string;
  createdAt: string;
}

/**
 * Runs the watcher may reason about, newest first.
 *
 * Two filters, and both are load-bearing:
 *
 * - **Completed only.** An in-flight run has no conclusion, and treating a
 *   `null` conclusion as "not a failure" would let a job that is currently
 *   hanging mask the failure before it.
 * - **`asOf`**, so the detector can be held against a window whose outcome is
 *   already known. See the script's header.
 */
export function completedRuns(runs: WorkflowRun[], asOf?: Date): WorkflowRun[] {
  return runs
    .filter((r) => r.status === "completed")
    .filter((r) => (asOf ? new Date(r.createdAt) <= asOf : true))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/** The failure rate as a PAIR, because a bare percentage hides its denominator. */
export function failureRate(runs: WorkflowRun[]): { failures: number; completed: number } {
  return {
    failures: runs.filter((r) => r.conclusion === "failure").length,
    completed: runs.length,
  };
}

/**
 * Has this workflow failed on its two most recent completed runs?
 *
 * **Two, not one.** One failure is often a wall — a host refusing on a
 * schedule, a runner losing a connection — and a row per wall would bury the
 * Needs Sean queue in noise until nobody read it, which is exactly the failure
 * mode this whole mechanism is built against. Two consecutive is the cheapest
 * available evidence that the cause is ours rather than the world's, because a
 * wall does not usually repeat to the minute.
 *
 * It is a HEURISTIC and the row it raises says so. The watcher reports what it
 * observed; the diagnosis belongs to whoever reads it.
 *
 * A workflow with fewer than two completed runs returns `null` — "not enough
 * history to say", which is a different claim from "healthy" and must not print
 * as one.
 */
export function failedTwiceConsecutively(
  runs: WorkflowRun[],
): { newest: WorkflowRun; previous: WorkflowRun } | null {
  const [newest, previous] = runs;
  if (!newest || !previous) return null;
  if (newest.conclusion !== "failure" || previous.conclusion !== "failure") return null;
  return { newest, previous };
}
