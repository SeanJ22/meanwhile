/**
 * The intake tripwire (T08 1f) — pure analysis, so the mechanism is
 * fixture-testable. Day counts in, flags out; the script that runs it
 * daily (scripts/intake-tripwire.mts) supplies the counts by identifier-
 * free SQL and writes docs/intake-report.md.
 *
 * Flags are FLAGGED, never acted on: nothing here deletes, quarantines,
 * or closes anything. The author reads the report and decides.
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
 * - VOLUME_SPIKE: a day at or past max(VOLUME_FLOOR, VOLUME_MULTIPLE ×
 *   trailing median) — far outside the trailing normal range. The floor
 *   keeps single-digit demo days from flagging on a median of one or two,
 *   and a day needs at least MIN_TRAILING_DAYS of history to be judged:
 *   "outside the normal range" is not a claim that can be made about the
 *   window's first days, and a flag that fires on every fresh window is a
 *   flag the author learns to ignore.
 * - SUSPECT_SHARE: a day where suspect rows are at least SUSPECT_SHARE of
 *   the day's total, with at least SUSPECT_MIN_ROWS rows so a lone
 *   quarantined tap on a three-row day does not read as an attack.
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

/**
 * Render the committed report. Identifier-free by construction: everything
 * in it is a date, a count, or a stated threshold.
 */
export function renderIntakeReport(input: {
  generatedAt: string;
  reactionDays: IntakeDayCount[];
  searchLogDays: IntakeDayCount[];
  limiterRowsPurged: number;
  limiterRowsRemaining: number;
}): string {
  const t = TRIPWIRE_THRESHOLDS;
  const flags = [
    ...analyzeStore("reactions", input.reactionDays),
    ...analyzeStore("search_log", input.searchLogDays),
  ].sort((a, b) => b.day.localeCompare(a.day));

  const table = (days: IntakeDayCount[], withSuspect: boolean): string => {
    const ordered = [...days].sort((a, b) => b.day.localeCompare(a.day));
    if (ordered.length === 0) return "_No rows in the window._\n";
    const header = withSuspect
      ? "| Day (UTC) | Rows | Quarantined |\n|---|---|---|\n"
      : "| Day (UTC) | Rows |\n|---|---|\n";
    return (
      header +
      ordered
        .map((d) =>
          withSuspect
            ? `| ${d.day} | ${d.total} | ${d.suspect} |`
            : `| ${d.day} | ${d.total} |`,
        )
        .join("\n") +
      "\n"
    );
  };

  const flagLines =
    flags.length === 0
      ? "**None.** Every day in the window sits inside the trailing normal range.\n"
      : flags
          .map((f) => `- **FLAGGED ${f.day} — ${f.store} ${f.kind}**: ${f.detail}`)
          .join("\n") + "\n";

  return `# Intake tripwire report

Generated ${input.generatedAt} by \`scripts/intake-tripwire.mts\` (T08 1f).
Everything in this file is a date, a count, or a threshold — never an
identifier. Flags are flagged, never auto-acted-on: the author decides.

Thresholds: a day flags on volume at max(${t.VOLUME_FLOOR}, ${t.VOLUME_MULTIPLE}× the trailing
${t.TRAILING_DAYS}-day median), and on quarantine share at ${t.SUSPECT_SHARE * 100}% with at least
${t.SUSPECT_MIN_ROWS} rows.

## Flags

${flagLines}
## Reactions store, trailing 30 days

${table(input.reactionDays, true)}
## Search log, trailing 30 days

${table(input.searchLogDays, false)}
## Limiter housekeeping

Expired limiter rows purged this run: ${input.limiterRowsPurged}. Rows
remaining: ${input.limiterRowsRemaining}. (Transient state only — the
limiter table holds counters against an unjoinable digest, nothing else.)
`;
}
