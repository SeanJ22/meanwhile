/**
 * **RULING 56's decision, separated from its plumbing.** (NH Hunt 3,
 * 2026-08-21.)
 *
 * The retired watcher talked to the GitHub Actions API and the tracker writer;
 * both executable doors are now gone. None of that was the rule. The historical
 * rule is one pure function over a list of runs, retained only so
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
  /**
   * What triggered it — `schedule`, `workflow_dispatch`, `push`.
   *
   * Optional so a caller that does not ask for it still type-checks, and so a
   * fixture written before this existed still parses. `undefined` is treated as
   * NOT a drill: an unknown trigger must never be able to silence the watcher,
   * because that is the direction that loses a real failure.
   */
  event?: string;
}

/**
 * **A DRILL IS NOT A FAILURE, AND IT MUST NOT RAISE A ROW.**
 * (2026-08-23, closing the diagnosis on `JOB02`.)
 *
 * `JOB02` records that `refresh-meetings-snapshot` failed on two CONSECUTIVE
 * runs and healed, and reasons — correctly, by the rule as it stood — that two
 * in a row is evidence the cause is ours rather than a host refusing on a
 * schedule. The watcher raised a P1 Needs Sean row and asked somebody to find
 * out why.
 *
 * **Both runs were deliberate drills.** Read on 2026-08-23: runs 32543393133
 * and 32543652154, five minutes apart, both `workflow_dispatch`, both carrying
 * `WTP_INGEST_FORCE_JOB_FAILURE: true`, and both logging the ingest's own
 * sentence — *"This failure is FORCED … No vendor failed. No source failed. The
 * snapshot written above is unchanged."* Somebody was testing this very
 * watcher, and it worked.
 *
 * That is the defect. **An alarm that cannot tell a drill from a fire spends
 * the credibility of the next real one**, and the Needs Sean queue is exactly
 * where that cost lands: a P1 row nobody can act on teaches a reader to skim.
 *
 * ## Why the trigger, rather than reading the log for the forced flag
 *
 * The flag lives in the run's INPUTS, which the run list does not carry, so
 * finding it means fetching a log per run — forty logs to answer one question.
 * The trigger is already in the list.
 *
 * And it is the better question anyway. **The watcher exists to catch this job
 * breaking on its own cadence.** A `workflow_dispatch` is a person doing
 * something deliberate — a drill, a backfill, a debug run against a branch —
 * and none of those is the cadence. The workflow file already refuses the force
 * flag unless the run is a dispatch, so every drill is a dispatch by
 * construction.
 *
 * ## Nothing is dropped silently
 *
 * A dispatched failure is still information and it is still counted and
 * printed; it is excluded only from the CONSECUTIVE test that raises a row, and
 * the number excluded is stated. A deliberate clip that reads as a clean run is
 * the shape this repo names most often.
 */
export function isDrillTrigger(run: WorkflowRun): boolean {
  return run.event === "workflow_dispatch";
}

/**
 * The runs the consecutive test may reason about: scheduled and pushed only.
 *
 * Returns the kept runs AND the count set aside, so the caller can print the
 * pair rather than a single number standing in front of two measurements.
 */
export function runsOnOwnCadence(runs: WorkflowRun[]): {
  kept: WorkflowRun[];
  dispatchedSetAside: number;
} {
  const kept = runs.filter((r) => !isDrillTrigger(r));
  return { kept, dispatchedSetAside: runs.length - kept.length };
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

/**
 * THE SAME QUESTION, ASKED OF THE WHOLE WINDOW RATHER THAN OF THE HEAD.
 * (NJ Hunt 3 item 1c, 2026-08-22.)
 *
 * `failedTwiceConsecutively` reads the two most recent completed runs, and the
 * watcher reads it once a day at 15:40 UTC. That is a two-run window sampled
 * every twenty-four hours, and a double failure that heals in between is
 * invisible to it — not misjudged, never seen.
 *
 * It happened on 2026-08-22. `refresh-meetings-snapshot.yml` failed at 01:25
 * and again at 01:30, and went green at 01:51. By the 15:40 reading the two
 * most recent runs were both successes. Job watch ran, passed, and opened
 * nothing; no Needs Sean row exists for it. Replaying the detector with
 * `--asof=2026-08-22T01:45:00Z` fires correctly and names both run ids — the
 * RULE was never wrong. The SAMPLING was.
 *
 * That matters because "it broke twice in a row and fixed itself" is not a
 * non-event. Nobody learned why. The next occurrence starts from zero
 * knowledge, and the failure rate — 17 of 40 completed runs, printed by this
 * watcher every day since it was built — is what a run of unexamined
 * self-healing doubles looks like from outside.
 *
 * So the window is scanned for the most recent ADJACENT PAIR of failures
 * anywhere in it, newest first. Returns `null` when there is none.
 *
 * It does not spam: the caller is idempotent per workflow on a marker string,
 * so a window holding six historical pairs still yields at most one open row.
 * And `healed` is stated rather than inferred, because "this job is broken
 * right now" and "this job broke twice last night and recovered" are different
 * sentences and must not be written as the same one.
 */
export function failedTwiceInWindow(runs: WorkflowRun[]): {
  newest: WorkflowRun;
  previous: WorkflowRun;
  healed: boolean;
} | null {
  for (let i = 0; i + 1 < runs.length; i += 1) {
    const newest = runs[i];
    const previous = runs[i + 1];
    if (newest?.conclusion === "failure" && previous?.conclusion === "failure") {
      // Healed when anything newer than the pair completed successfully — i.e.
      // the pair is not at the head of the list.
      return { newest, previous, healed: i > 0 };
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* THE STANDING STATUS TABLE (2026-08-26, Item 8b(b))                          */
/* -------------------------------------------------------------------------- */

/**
 * One scheduled workflow's standing, as a row.
 *
 * **DAYS SINCE LAST SUCCESS IS THE NUMBER THAT MATTERS, and it is why this
 * exists rather than a look at the Actions tab.** Reported as a last outcome
 * alone, a job that has failed silently for a week looks identical to one that
 * ran an hour ago and failed once: both say `failure`. The gap between now and
 * the last time the job actually did its work is the only figure that separates
 * a blip from a data path that has been dead since Tuesday.
 *
 * `null` is kept apart from a number in both directions (RULING 24): no run at
 * all, and no SUCCESSFUL run in the window read, are different facts and
 * neither may print as a number of days.
 */
export interface JobStanding {
  readonly workflow: string;
  readonly lastRunAt: string | null;
  readonly lastConclusion: string | null;
  readonly lastSuccessAt: string | null;
  /** null when no success appears in the runs read — NOT the same as zero. */
  readonly daysSinceLastSuccess: number | null;
  readonly consecutiveFailures: number;
  readonly runsRead: number;
}

/**
 * Build one workflow's standing from its runs, newest first.
 *
 * `asOf` is a parameter and never a clock call, so this is testable and so the
 * caller — which knows when it ran — owns the time (RULING 107's shape: a run
 * stamp comes from the caller, never from inside a pure reader).
 */
export function standingFor(workflow: string, runs: WorkflowRun[], asOf: Date): JobStanding {
  const completed = completedRuns(runs, asOf);
  const newestFirst = [...completed].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  const last = newestFirst[0] ?? null;
  const lastSuccess = newestFirst.find((r) => r.conclusion === "success") ?? null;

  let consecutiveFailures = 0;
  for (const r of newestFirst) {
    if (r.conclusion === "success") break;
    consecutiveFailures += 1;
  }

  const daysSinceLastSuccess =
    lastSuccess === null
      ? null
      : Math.max(0, (asOf.getTime() - Date.parse(lastSuccess.createdAt)) / 86_400_000);

  return {
    workflow,
    lastRunAt: last?.createdAt ?? null,
    lastConclusion: last?.conclusion ?? null,
    lastSuccessAt: lastSuccess?.createdAt ?? null,
    daysSinceLastSuccess: daysSinceLastSuccess === null ? null : Math.round(daysSinceLastSuccess * 100) / 100,
    consecutiveFailures,
    runsRead: completed.length,
  };
}

/** Render the table. Plain text, so it reads in a workflow log. */
export function renderStandings(rows: readonly JobStanding[]): string {
  const head = ["workflow", "last run", "outcome", "last success", "days since", "consec fail", "runs read"];
  const body = rows.map((r) => [
    r.workflow,
    r.lastRunAt ?? "never",
    r.lastConclusion ?? "—",
    r.lastSuccessAt ?? "NONE IN WINDOW",
    r.daysSinceLastSuccess === null ? "UNKNOWN" : String(r.daysSinceLastSuccess),
    String(r.consecutiveFailures),
    String(r.runsRead),
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  return [line(head), line(widths.map((w) => "-".repeat(w))), ...body.map(line)].join("\n");
}
