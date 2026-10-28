import { protectedJob, type JobBreakerLatest } from "../job-transfer-breaker.ts";
import { jobLabel, tableWords } from "../job-names.ts";

export interface PausedJobView {
  readonly job: string;
  readonly label: string;
  readonly pausedAt: string;
  readonly gb: number;
  readonly topTable: string | null;
  readonly topTableWords: string | null;
}
export interface PausedJobsView {
  readonly jobs: readonly PausedJobView[];
  readonly asOf: string;
}

/** Every job its hourly transfer breaker paused and nobody has released yet, newest first. */
export function pausedJobsView(latest: readonly JobBreakerLatest[], asOf: string): PausedJobsView {
  return { asOf, jobs: latest.filter(row => row.action === "PAUSE" && !protectedJob(row.job))
    .sort((a, b) => b.at.localeCompare(a.at) || a.job.localeCompare(b.job))
    .map(row => ({ job: row.job, label: jobLabel(row.job), pausedAt: row.at, gb: row.gb, topTable: row.topTable, topTableWords: tableWords(row.topTable) })) };
}
