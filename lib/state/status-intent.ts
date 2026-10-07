import { CONCLUDED_LOOKBACK_DAYS } from "../meetings/constants.ts";

import type { MeetingStatus } from "../sources/types.ts";

/**
 * The window a meeting-status selection implies. A reader who asks for
 * concluded meetings is asking to look backwards, so the selection carries its
 * own window (the default date window starts at now and would match nothing).
 * Turning the chip off does NOT shrink the window: the reader may have set it
 * themselves.
 */

/** Statuses that can only ever be satisfied by a meeting in the past. */
const BACKWARD_ONLY: ReadonlySet<MeetingStatus> = new Set<MeetingStatus>([
  "CONCLUDED",
]);

/**
 * The days-back window a status selection needs to be answerable at all.
 *
 * Returns `null` when the current window already reaches far enough — the
 * rule never narrows a reader's own choice, only widens it to the cascade's
 * own lookback, which is the furthest back any payload can go.
 */
export function daysBackForStatuses(
  selected: readonly MeetingStatus[],
  currentDaysBack: number,
): number | null {
  const needsPast = selected.some((s) => BACKWARD_ONLY.has(s));
  if (!needsPast) return null;
  if (currentDaysBack >= CONCLUDED_LOOKBACK_DAYS) return null;
  return CONCLUDED_LOOKBACK_DAYS;
}
