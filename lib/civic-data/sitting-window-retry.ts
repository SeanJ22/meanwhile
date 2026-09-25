/**
 * **A MEETING PARTITION NEVER PUBLISHED WAITS THE BASE CADENCE, NOT THE HOUR
 * (R20; C6, 2026-09-25).**
 *
 * The owner's rule re-reads a meeting body hourly while it has a sitting within
 * seven days and twice daily otherwise. A partition with no promotion has no
 * sitting on record, so it takes the twice-daily side: its next attempt comes
 * the base cadence after its last one, not an hour later. A published
 * partition's failed read keeps its contract's own retry.
 *
 * Measured on production (2026-09-24 10:30 PM to 2026-09-25 12:49 AM EDT, the
 * deployed lane rule): never-published partitions took 4.2 of New London's 12
 * reads an hour, 4.6 on each Google calendar and 7.9 on Newbury, and 10 of 46
 * in-window bodies waited 68-70 minutes for their hourly read.
 *
 * The runner admits on this and Admin shows it, so the owner sees the instant
 * the runner acts on.
 */
import type { SittingWindowSchedule } from "./contracts.ts";

export function sittingWindowRetryMs(
  schedule: SittingWindowSchedule,
  retryMs: number,
  published: boolean,
): number {
  return published ? retryMs : Math.max(retryMs, schedule.baseEveryMs);
}
