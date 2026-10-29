import type { SavedJobBreakerState } from "../job-transfer-breaker.ts";
import { jobLabel, tableWords } from "../job-names.ts";

export interface SlowedJobView {
  readonly job: string;
  readonly label: string;
  readonly slowedAt: string;
  readonly hour: string;
  readonly gb: number;
  readonly normalGb: number;
  readonly times: number;
  /** Null while it is still slowed. */
  readonly backAt: string | null;
  readonly topTable: string | null;
  readonly topTableWords: string | null;
}
export interface SlowedJobsView {
  readonly jobs: readonly SlowedJobView[];
  readonly asOf: string;
}

/** Every job slowed in the last week for reading far more than its normal: still slowed first, then newest first. */
export function slowedJobsView(saved: SavedJobBreakerState | null, asOf: string): SlowedJobsView {
  return { asOf, jobs: Object.entries(saved?.state?.jobs ?? {}).flatMap(([job, pace]) => pace.slowed ? [{ job, label: jobLabel(job),
    slowedAt: pace.slowed.at, hour: pace.slowed.hour, gb: pace.slowed.bytes / 1e9, normalGb: pace.slowed.normal / 1e9, times: pace.times ?? pace.slowed.times,
    backAt: pace.times ? null : pace.slowed.back ?? null, topTable: pace.slowed.topTable, topTableWords: tableWords(pace.slowed.topTable) }] : [])
    .sort((a, b) => Number(a.backAt !== null) - Number(b.backAt !== null) || b.slowedAt.localeCompare(a.slowedAt) || a.job.localeCompare(b.job)) };
}
