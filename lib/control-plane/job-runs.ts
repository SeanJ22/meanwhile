/** When each job the runner schedules last started, finished or failed. It rides on the heartbeat and survives restarts. */
export interface JobRun {
  /** How often a healthy job finishes: its launch interval, or its run budget when a run may last longer. */
  readonly everyMs: number;
  /** When it was first scheduled; the clock for a job with no finished run yet. */
  readonly since: string;
  readonly lastStartedAt: string | null;
  readonly lastFinishedAt: string | null;
  readonly lastFailedAt: string | null;
  readonly lastError: string | null;
  /** Why the runner is not launching it now (an owner pause, or the breaker spacing its launches), when it knows. */
  readonly heldBy: string | null;
}
export type JobRuns = Readonly<Record<string, JobRun>>;
const newer = <T extends string | null>(a: T, b: T): T => a === null ? b : b === null || Date.parse(a) >= Date.parse(b) ? a : b;

export class JobRunBook {
  readonly #runs = new Map<string, JobRun>();
  readonly now: () => string;
  constructor(now = () => new Date().toISOString()) { this.now = now; }
  /** Only registered jobs are written, so a job a release removed stops being reported. */
  register(job: string, everyMs: number): void {
    this.#runs.set(job, { since: this.now(), lastStartedAt: null, lastFinishedAt: null, lastFailedAt: null, lastError: null, heldBy: null,
      ...this.#runs.get(job), everyMs });
  }
  #update(job: string, change: Partial<JobRun>): void {
    const held = this.#runs.get(job);
    if (held) this.#runs.set(job, { ...held, ...change });
  }
  started(job: string, at = this.now()): void { this.#update(job, { lastStartedAt: at, heldBy: null }); }
  finished(job: string): void { this.#update(job, { lastFinishedAt: this.now(), heldBy: null }); }
  /** A run that returned because it was held is not a finished run. */
  completed(job: string): void { if (this.#runs.get(job)?.heldBy === null) this.finished(job); }
  failed(job: string, error: string): void {
    this.#update(job, { lastFailedAt: this.now(), lastError: error.trim().slice(-400) || "no error was recorded", heldBy: null });
  }
  held(job: string, reason: string): void { this.#update(job, { heldBy: reason }); }
  /** Each stored clock keeps its newest value, so a restart loses no finish time. */
  merged(stored: JobRuns | null | undefined): JobRuns {
    return Object.fromEntries([...this.#runs].map(([job, mine]) => {
      const kept = stored?.[job];
      if (!kept) return [job, mine];
      const lastFailedAt = newer(kept.lastFailedAt, mine.lastFailedAt);
      return [job, { ...mine, since: newer(kept.since, mine.since) === kept.since ? mine.since : kept.since,
        lastStartedAt: newer(kept.lastStartedAt, mine.lastStartedAt), lastFinishedAt: newer(kept.lastFinishedAt, mine.lastFinishedAt),
        lastFailedAt, lastError: lastFailedAt === mine.lastFailedAt ? mine.lastError : kept.lastError }];
    }));
  }
}
