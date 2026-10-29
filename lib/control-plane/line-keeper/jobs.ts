import type { Sql } from "../repository/pg-store.ts";
import type { CountProblem } from "../../counts/hour.ts";
import type { JobRuns } from "../job-runs.ts";
import { formatEastern } from "../eastern-time.ts";
import { jobLabel } from "../job-names.ts";
import { query } from "./read.ts";

/** Only the runner's job clocks and its beat time cross the wire, never the rest of the heartbeat. */
export const RUNNER_JOBS_SQL = "SELECT value->'jobs' AS jobs,value->>'beatAt' AS beat_at FROM cp_runner_heartbeat WHERE id='pilot-runner'";
export async function readRunnerJobs(control: Sql): Promise<{ readonly jobs: JobRuns | null; readonly beatAt: string | null }> {
  const [row] = await query(control, "runner-jobs", RUNNER_JOBS_SQL);
  return { jobs: (row?.jobs as JobRuns | undefined) ?? null, beatAt: (row?.beat_at as string | undefined) ?? null };
}

const every = (ms: number) => ms <= 60_000 ? "every minute" : ms < 3_600_000 ? `every ${Math.round(ms / 60_000)} minutes` : ms === 3_600_000 ? "every hour" : `every ${Math.round(ms / 360_000) / 10} hours`;

/** Each job past two of its own intervals without a finished run, judged on recorded finish times, never on the beat alone. */
export function stalledJobs(jobs: JobRuns | null, beatAt: string | null, at: string): { readonly job: string; readonly says: string }[] {
  const now = Date.parse(at);
  return Object.entries(jobs ?? {}).sort(([a], [b]) => a.localeCompare(b)).flatMap(([job, run]) => {
    if (now - Date.parse(run.lastFinishedAt ?? run.since) <= 2 * run.everyMs) return [];
    const failedLast = run.lastFailedAt !== null && (run.lastFinishedAt === null || Date.parse(run.lastFailedAt) > Date.parse(run.lastFinishedAt));
    const reason = beatAt !== null && now - Date.parse(beatAt) > 2 * run.everyMs ? `The runner itself last reported ${formatEastern(beatAt)}.`
      : run.heldBy ?? (failedLast ? `Its last run failed ${formatEastern(run.lastFailedAt)}: ${run.lastError}` : "The runner recorded no reason.");
    const last = run.lastFinishedAt === null ? `it was scheduled ${formatEastern(run.since)}` : formatEastern(run.lastFinishedAt);
    return [{ job, says: `${jobLabel(job)} has not finished a run since ${last}; it runs ${every(run.everyMs)}. ${reason}` }];
  });
}

/** The hourly keeper's flags, in the shape of its other observations. */
export const stalledJobProblems = (stalled: readonly { job: string; says: string }[]): Omit<CountProblem, "kind" | "state" | "items">[] =>
  stalled.map(({ job, says }) => ({ key: `stalled-job:${job}`, where: `Runner job · ${jobLabel(job)}`, says, owner: "the runner workers",
    next: `Find why ${jobLabel(job)} stopped finishing, fix that cause, and check that its next run finishes.` }));
