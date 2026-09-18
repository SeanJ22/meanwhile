/**
 * **The future-date law, in one place.**
 *
 * PRL's Press Releases set advertises a range ending July 2027. We store every
 * row it publishes — dropping rows would be the product deciding a government's
 * record for it. But two things must hold, and they are different:
 *
 * 1. **Nothing dated after now is displayed or counted.** A row claiming
 *    January 2027, read on 22 September 2026, is not in any answer or
 *    percentage. That is `isVisibleAsOf`, applied at read time by the
 *    presentation layer — this module supplies the predicate.
 *
 * 2. **The high-water mark is capped at now.** The incremental cursor advances
 *    only over rows dated at or before now. A single future-dated row must not
 *    push the marker to 2027 and silently skip every real row that arrives
 *    between now and then. That is `advanceWatermark`.
 *
 * PRL's cursors come in two widths: a `date` like `2017-06-21` and a
 * `last_updated` like `2025-07-20 21:48:58`, neither carrying a timezone. They
 * are normalized to a UTC instant for comparison; the few hours of possible
 * skew are immaterial at a weekly cadence, and comparison is deterministic
 * rather than dependent on the host timezone (which raw `Date.parse` of a
 * space-separated stamp is).
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
  // The mark can never itself exceed now, by construction (only ms<=now move
  // it). The explicit floor below defends against a previous mark that was
  // written before this cap existed.
  if (bestMs !== null && bestMs > nowMs) {
    bestRaw = previousMarkRaw;
  }
  return { mark: bestRaw, atOrBeforeNow, afterNow, unparseable };
}
