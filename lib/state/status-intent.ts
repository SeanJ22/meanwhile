import { CONCLUDED_LOOKBACK_DAYS } from "../meetings/constants.ts";

import type { MeetingStatus } from "../sources/types.ts";

/**
 * The window a meeting-status selection implies (M58, 2026-08-15).
 *
 * The defect, measured on production at all four demo zips before anything
 * was changed: **tapping the "Concluded" chip rendered "0 meetings — nothing
 * matches" everywhere, including Tucson, while the payload behind the screen
 * held twenty-four concluded Tucson sittings, four in Morris County and two
 * in Newbury.** The server has been sending the recent past along with every
 * successful rung for weeks. The client's default date window starts at
 * *now*, so `days < -daysBack` dropped every one of them, and the status chip
 * — the only control that names concluded meetings — could never match a
 * single row on its own.
 *
 * This is M27's shape exactly, one group over: a control that stays fully
 * interactive while a different control in a different visual group makes
 * every click a silent no-op. The friction rule counts a hidden gate as a
 * defect with the same standing as a wrong number, and this one is worse
 * than hidden — it answers with "nothing matches", which reads as a fact
 * about the government rather than a fact about a slider.
 *
 * So: a reader who asks for concluded meetings is asking to look backwards.
 * The selection carries its own window, and the date group's display follows
 * it, so the two controls tell the same story. Turning the chip back off
 * does NOT slam the window shut — the reader may have dragged it themselves
 * and inferring a retreat from a deselection would be guessing (the same
 * exception "clear" gets in `district-intent.ts`).
 *
 * Pure, so the guard holds the rule without mounting React.
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
