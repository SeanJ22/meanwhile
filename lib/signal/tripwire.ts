/**
 * Intake-volume analysis, kept pure so the standing runtime can turn identifier-free aggregate counts
 * into deterministic flags. Flags are observations, never automatic enforcement.
 */

export interface IntakeDayCount {
  /** UTC day, YYYY-MM-DD. */
  day: string;
  /** Rows written that day. */
  total: number;
  /** Of those, rows carrying a suspect_reason (0 for stores without one). */
  suspect: number;
}

export interface TripwireFlag {
  day: string;
  store: string;
  kind: "VOLUME_SPIKE" | "SUSPECT_SHARE";
  /** The numbers behind the flag — count and denominator, always. */
  detail: string;
}

/**
 * The thresholds, stated in the report so a flag is checkable by number:
 * - VOLUME_SPIKE: a day at or past max(VOLUME_FLOOR, VOLUME_MULTIPLE × trailing median). A day needs at
 *   least MIN_TRAILING_DAYS of history to be judged.
 * - SUSPECT_SHARE: suspect rows at least SUSPECT_SHARE of the day's total, with at least
 *   SUSPECT_MIN_ROWS rows.
 */
export const TRIPWIRE_THRESHOLDS = {
  VOLUME_MULTIPLE: 4,
  VOLUME_FLOOR: 30,
  MIN_TRAILING_DAYS: 3,
  SUSPECT_SHARE: 0.25,
  SUSPECT_MIN_ROWS: 12,
  TRAILING_DAYS: 14,
} as const;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Analyze one store's daily counts (ascending by day). Each day is judged
 * against the up-to-TRAILING_DAYS days before it, so a sustained attack
 * flags on its first day rather than normalizing itself into the range.
 */
export function analyzeStore(
  store: string,
  days: IntakeDayCount[],
): TripwireFlag[] {
  const t = TRIPWIRE_THRESHOLDS;
  const flags: TripwireFlag[] = [];
  const ordered = [...days].sort((a, b) => a.day.localeCompare(b.day));

  ordered.forEach((day, index) => {
    const trailing = ordered
      .slice(Math.max(0, index - t.TRAILING_DAYS), index)
      .map((d) => d.total);
    const trailingMedian = median(trailing);
    const spikeAt = Math.max(t.VOLUME_FLOOR, t.VOLUME_MULTIPLE * trailingMedian);
    if (trailing.length >= t.MIN_TRAILING_DAYS && day.total >= spikeAt) {
      flags.push({
        day: day.day,
        store,
        kind: "VOLUME_SPIKE",
        detail: `${day.total} rows against a trailing median of ${trailingMedian} over ${trailing.length} prior days (flag threshold ${spikeAt})`,
      });
    }
    if (
      day.total >= t.SUSPECT_MIN_ROWS &&
      day.suspect / day.total >= t.SUSPECT_SHARE
    ) {
      flags.push({
        day: day.day,
        store,
        kind: "SUSPECT_SHARE",
        detail: `${day.suspect} of ${day.total} rows quarantined (${Math.round((day.suspect / day.total) * 100)}% — flag threshold ${t.SUSPECT_SHARE * 100}%)`,
      });
    }
  });

  return flags;
}
