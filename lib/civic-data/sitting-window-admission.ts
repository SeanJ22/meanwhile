/**
 * **WHEN A MEETING BODY MUST BE READ, AND WHEN THE RUNNER MAY READ IT (C6).**
 *
 * The owner's rule (2026-09-24): every meeting body is read twice daily, and
 * hourly while it has a meeting in the next seven days or one that concluded
 * in the previous seven. "Hourly" is at most 60 minutes between reads and
 * "twice daily" at most 12 hours: those are the deadlines, and nothing here
 * treats a later read as on time.
 *
 * - **Conclusion.** Published sittings carry a start and almost never an end
 *   (3 of 880 on 2026-09-25), so a sitting counts as concluded up to a day after
 *   it starts. A body therefore stays hourly for at least seven full days after
 *   its meeting ends; the bound errs toward more reads, never fewer.
 * - **Lead.** An hourly read becomes eligible 15 minutes before its deadline. The
 *   runner admits on 5-minute passes and a child's first event lands seconds
 *   after its pass starts, so a read made due at 55 minutes landed at
 *   60:08-60:15 on quiet lanes (production, 2026-09-24). The lead covers the wait
 *   for the next pass, one pass queued behind an earlier deadline, the child's
 *   start and a release handoff, so a read lands about 50 minutes after the last.
 *   A twice-daily read becomes eligible 2 hours early, so the lane reads it in
 *   slots the hourly bodies leave free: twice-daily reads that fell due together
 *   (as after the B3 switch) spread out instead of returning as the same burst
 *   every 12 hours.
 * - **Never published (R20).** A partition with no promotion has no meeting on
 *   record, so it takes the twice-daily deadline after each attempt, not the
 *   contract's one-hour failure retry. Never-published retries had taken 4.2 of
 *   New London's 12 reads an hour.
 *
 * The runner admits on these instants and orders each lane by deadline; Admin
 * shows the same instants.
 */
import { sittingWindowHot, sittingWindowRereadMs, type SittingWindowSchedule } from "./contracts.ts";

/** An hourly read, or a retry, is eligible this long before its deadline. */
export const SITTING_WINDOW_ADMISSION_LEAD_MS = 15 * 60_000;
/** A twice-daily read is eligible this long before its deadline. */
export const SITTING_WINDOW_BASE_ADMISSION_LEAD_MS = 2 * 60 * 60_000;
/** A sitting without an end time counts as concluded no later than this after it starts. */
export const SITTING_CONCLUSION_BOUND_MS = 24 * 60 * 60_000;

/**
 * Hot by the owner's rule: a sitting starting within the window ahead, or one
 * that concluded within the window behind (conclusion bounded as above).
 * `undefined` means a sitting list could not be read, which reads as hot.
 */
export function sittingWindowHotByConclusion(
  schedule: SittingWindowSchedule,
  sittingLists: readonly (readonly string[] | undefined)[],
  nowMs: number,
): boolean | undefined {
  const byStart = sittingWindowHot(schedule, sittingLists, nowMs);
  if (byStart === true) return true;
  const concluded = sittingLists.map((starts) => starts?.map((start) => {
    const at = Date.parse(start);
    return Number.isFinite(at) ? new Date(at + SITTING_CONCLUSION_BOUND_MS).toISOString() : start;
  }));
  return sittingWindowHot(schedule, concluded, nowMs) === true ? true : byStart;
}

export function sittingWindowRetryMs(
  schedule: SittingWindowSchedule,
  retryMs: number,
  published: boolean,
): number {
  return published ? retryMs : Math.max(retryMs, schedule.baseEveryMs);
}

/** What a sitting-window deadline is computed from: store-observed instants, in ms. */
export interface SittingWindowReads {
  readonly attemptedMs: number;
  /** NaN when no success is proven. */
  readonly succeededMs: number;
  /** The scope holds a promotion. */
  readonly published: boolean;
}

export interface SittingWindowObligation {
  /** The instant by which the next read is owed. */
  readonly deadlineMs: number;
  /** The instant the runner may admit it. */
  readonly eligibleAtMs: number;
}

/** The next read a sitting-window task owes, and when the runner may make it. */
export function sittingWindowObligation(
  schedule: SittingWindowSchedule,
  retryMs: number,
  reads: SittingWindowReads,
  hot: boolean | undefined,
): SittingWindowObligation {
  const [fromMs, periodMs] = !Number.isFinite(reads.succeededMs)
    ? [reads.attemptedMs, sittingWindowRetryMs(schedule, retryMs, reads.published)]
    : reads.attemptedMs > reads.succeededMs
      ? [reads.attemptedMs, retryMs]
      : [reads.succeededMs, sittingWindowRereadMs(schedule, hot)];
  const leadMs = periodMs >= schedule.baseEveryMs ? SITTING_WINDOW_BASE_ADMISSION_LEAD_MS : SITTING_WINDOW_ADMISSION_LEAD_MS;
  return { deadlineMs: fromMs + periodMs, eligibleAtMs: fromMs + periodMs - leadMs };
}
