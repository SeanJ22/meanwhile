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

/** The runner writes its beat at least once a minute, whether or not research runs. */
const RUNNER_BEAT_MS = 60_000;
/** Ten missed beats. A restart for a release takes a few minutes, and a fix is never auto-closed, so one hiccup must not open one. */
const RUNNER_SILENT_AFTER_MS = 10 * RUNNER_BEAT_MS;
export const silentFor = (ms: number) => ms < 2 * 3_600_000 ? `${Math.max(1, Math.round(ms / 60_000))} minutes` : `${Math.round(ms / 360_000) / 10} hours`;

/**
 * Everything the runner's heartbeat says about the runner and its jobs. The whole runner going quiet is its own problem, found from the beat
 * alone: a missing or stale beat, or a beat with no job clocks, is never read as "nothing is wrong". Each job past two intervals follows.
 */
export function runnerHealthProblems(read: { readonly jobs: JobRuns | null; readonly beatAt: string | null }, at: string): Omit<CountProblem, "kind" | "state" | "items">[] {
  const now = Date.parse(at), beat = read.beatAt === null ? Number.NaN : Date.parse(read.beatAt);
  const whole = { where: "The runner", owner: "the runner workers" };
  const silent = !Number.isFinite(beat)
    ? [{ ...whole, key: "runner-silent", says: "The runner has no recorded heartbeat, so nothing it runs can be checked.",
        next: "Find why the runner is not reporting, restore it, and check that its beat and every job clock are current." }]
    : now - beat > RUNNER_SILENT_AFTER_MS
      ? [{ ...whole, key: "runner-silent", says: `The runner has been silent for ${silentFor(now - beat)}: it last reported ${formatEastern(read.beatAt!)}, so none of its scheduled jobs are running.`,
          next: "Find why the runner stopped, restart it, and check that its beat and every job clock are current." }]
      : !read.jobs || Object.keys(read.jobs).length === 0
        ? [{ ...whole, key: "runner-jobs:none", says: "The runner is reporting, but its heartbeat carries no job clocks, so no scheduled job can be checked.",
            next: "Restore the job clocks on the runner heartbeat and check that every scheduled job appears." }]
        : [];
  return [...silent, ...stalledJobProblems(stalledJobs(read.jobs, read.beatAt, at))];
}
