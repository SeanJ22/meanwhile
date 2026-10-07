/**
 * The future-date rules. Every published row is stored, but:
 *
 * 1. Nothing dated after now is displayed or counted (`isVisibleAsOf`, applied
 *    at read time by the presentation layer).
 * 2. The high-water mark is capped at now (`advanceWatermark`), so one
 *    future-dated row cannot skip every real row that arrives before its date.
 *
 * Cursors are a `date` (`2017-06-21`) or a `last_updated`
 * (`2025-07-20 21:48:58`), neither with a timezone; both are normalized to a UTC
 * instant so comparison does not depend on the host timezone.
 */

/** Parse a PRL `date` or `last_updated` to epoch ms (UTC), or null if unusable. */
export function parsePrlInstant(raw: string | null | undefined): number | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  // A bare date, or a `YYYY-MM-DD HH:MM:SS` stamp. Normalize to ISO UTC.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.exec(trimmed);
  const dateTime = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?$/.exec(trimmed);
  let iso: string | null = null;
  if (dateOnly) iso = `${trimmed}T00:00:00Z`;
  else if (dateTime) iso = `${dateTime[1]}T${dateTime[2]}Z`;
  if (iso === null) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** A row is visible only if its publication date is at or before now. */
export function isVisibleAsOf(dateRaw: string | null | undefined, nowMs: number): boolean {
  const instant = parsePrlInstant(dateRaw);
  // A row with no parseable date is not asserted to be in the past — it is not
  // counted as visible, because a null date must not read as "now or earlier".
  return instant !== null && instant <= nowMs;
}

/** Is this row's cursor strictly newer than the stored mark? A null mark takes all. */
export function isNewerThanMark(cursorRaw: string | null | undefined, markRaw: string | null): boolean {
  const cursor = parsePrlInstant(cursorRaw);
  if (cursor === null) return false; // an unparseable cursor is not "newer"; it is a row to store but not to advance on
  if (markRaw === null) return true;
  const mark = parsePrlInstant(markRaw);
  if (mark === null) return true;
  return cursor > mark;
}

export interface WatermarkAdvance {
  /**
   * The new high-water mark: the newest cursor value at or before now, never
   * later than the previous mark's predecessor. Stored as PRL's own raw string
   * so it compares directly with future rows. Null only if nothing at or before
   * now has ever been seen.
   */
  readonly mark: string | null;
  /** Rows whose cursor is at or before now (they advance the mark). */
  readonly atOrBeforeNow: number;
  /** Rows whose cursor is after now (stored, but never advance the mark). */
  readonly afterNow: number;
  /** Rows whose cursor did not parse (stored, never advance the mark). */
  readonly unparseable: number;
}

/**
 * Advance the mark over a batch of cursor values, capped at now.
 *
 * The new mark is the newest cursor at or before now, or the previous mark if
 * this batch adds nothing earlier-or-equal-to-now. Future cursors are counted
 * and reported but never move the mark — that is the whole point.
 */
export function advanceWatermark(
  previousMarkRaw: string | null,
  cursorRawValues: Iterable<string | null | undefined>,
  nowMs: number,
): WatermarkAdvance {
  let bestRaw = previousMarkRaw;
  let bestMs = parsePrlInstant(previousMarkRaw);
  let atOrBeforeNow = 0;
  let afterNow = 0;
  let unparseable = 0;
  for (const raw of cursorRawValues) {
    const ms = parsePrlInstant(raw);
    if (ms === null) {
      unparseable += 1;
      continue;
    }
    if (ms > nowMs) {
      afterNow += 1;
      continue;
    }
    atOrBeforeNow += 1;
    if (bestMs === null || ms > bestMs) {
      bestMs = ms;
      bestRaw = (raw as string).trim();
    }
  }
  // The mark can never itself exceed now; the floor below also covers a
  // previous mark stored later than now.
  if (bestMs !== null && bestMs > nowMs) {
    bestRaw = previousMarkRaw;
  }
  return { mark: bestRaw, atOrBeforeNow, afterNow, unparseable };
}
