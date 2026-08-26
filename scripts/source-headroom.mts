/**
 * `pnpm source:headroom` — **how close is every meetings source to tripping
 * the F22 window guard?**
 *
 * ## Why this exists (`R59`, 2026-08-25)
 *
 * The daily refresh failed both of its runs on 2026-08-25 at *Validate*, before
 * committing anything. The offender was `clerksboards`: oldest row 2026-05-27
 * against a declared 90-day window, and ninety days before that day is exactly
 * 2026-05-27. **Nothing changed in the code. The DATA crossed the line**, at a
 * moment nobody could have predicted from reading the repo.
 *
 * The guard was right and stayed. What was missing is the thing that would have
 * seen it coming: **a source's distance from its own edge is a number nobody
 * was printing.** `clerksboards` was the first to cross, not necessarily the
 * only one near the line — the F22 guard's own comment records FIVE sources
 * inside a day and a half of the edge, and which one trips is decided by what
 * time of day the refresh happens to run.
 *
 * So this prints the table: **oldest row, declared window, days of headroom**,
 * per source, sorted by how close each is to failing. Anything under fourteen
 * days is named as OWED A ROW, because a source that fails silently on a
 * Tuesday is a snapshot that does not refresh and nobody finds out until a
 * reader looks at a stale calendar.
 *
 * ## The floor (RULING 159)
 *
 * The population is the set of sources in the committed snapshot. If that set
 * is EMPTY this script throws rather than printing a reassuring `0 sources
 * under 14 days` — an unreadable snapshot and a perfectly healthy corpus
 * produce the identical number, and that is the exact failure the ruling names.
 */
import { join } from "node:path";

import { CONCLUDED_LOOKBACK_DAYS } from "../lib/meetings/constants.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { readSnapshot } from "../lib/meetings/snapshot.ts";
import { CAPABILITIES } from "../lib/sources/composite/wiring.ts";
import { wiringForTypes } from "../lib/registry/source-wiring.ts";

const ROOT = join(import.meta.dirname, "..");

/** Under this many days of headroom, a source gets a tracker row today. */
export const HEADROOM_ROW_THRESHOLD_DAYS = 14;

export interface Headroom {
  source: string;
  oldestRow: string;
  declaredWindowDays: number | null;
  /** Days between the oldest row and the edge its declaration puts it behind. */
  headroomDays: number | null;
  rows: number;
}

export function headroomFor(
  snapshot: NonNullable<ReturnType<typeof readSnapshot>>,
): Headroom[] {
  const declared = new Map<string, number | null | undefined>();
  for (const capability of CAPABILITIES) {
    const rows = wiringForTypes(capability.types);
    if (rows.length === 0) continue;
    declared.set(capability.name, capability.make(rows).publishedLookbackDays);
  }

  const generatedAt = Date.parse(snapshot.generatedAt);
  if (!Number.isFinite(generatedAt)) {
    throw new Error("the snapshot has no readable generatedAt — nothing can be measured against it");
  }

  const oldest = new Map<string, number>();
  const rowCount = new Map<string, number>();
  for (const meeting of snapshot.meetings) {
    const source = meeting.id.split(":")[0];
    rowCount.set(source, (rowCount.get(source) ?? 0) + 1);
    const at = Date.parse(meeting.startsAt);
    if (!Number.isFinite(at)) continue;
    oldest.set(source, Math.min(oldest.get(source) ?? Infinity, at));
  }

  const out: Headroom[] = [];
  for (const [source, at] of oldest) {
    const window = declared.has(source) ? declared.get(source) : undefined;
    // `null` means the adapter declares NO back clip at all — its archive is
    // whole, so there is no edge to be close to. That is a real answer and it
    // is kept apart from "we do not know", which is what an unwired source is.
    const days = window === null ? null : (window ?? CONCLUDED_LOOKBACK_DAYS);
    const edge = days === null ? null : generatedAt - days * 86_400_000;
    out.push({
      source,
      oldestRow: new Date(at).toISOString().slice(0, 10),
      declaredWindowDays: days,
      headroomDays: edge === null ? null : Math.round(((at - edge) / 86_400_000) * 100) / 100,
      rows: rowCount.get(source) ?? 0,
    });
  }
  return out.sort((a, b) => (a.headroomDays ?? Infinity) - (b.headroomDays ?? Infinity));
}

/* -------------------------------------------------------------------------- */
/* THE SECOND CLOCK (2026-08-26, the deploy-key cutover session)               */
/* -------------------------------------------------------------------------- */

/**
 * **THE TABLE ABOVE CANNOT CROSS BY THE PASSAGE OF TIME, AND THREE SESSIONS
 * RUNNING HAVE READ IT AS THOUGH IT COULD.**
 *
 * `headroomDays` is `oldestRow + window - generatedAt`. **Both of those terms
 * are frozen values inside a committed artifact**, so the number is arithmetic
 * over two constants — it is identical to the digit on every run until a
 * refresh lands, and a brief expecting it to have moved is expecting the wrong
 * thing. That is not a defect in the guard: it is the right question for the
 * F22 guard, which measures a snapshot against the instant it was built.
 *
 * It is the wrong question for a READER. What a reader sees is clipped against
 * **now**, and `now` moves while the snapshot does not. So a snapshot that
 * stops refreshing loses reader-visible rows one day at a time, and **nothing
 * goes red when it does** — the F22 guard cannot see it, because the guard only
 * runs when a refresh is being built, which is exactly the thing that has
 * stopped happening.
 *
 * Two clocks, both reported, neither standing in for the other (the two-numbers
 * rule). The guard clock is the standing figure for "will the refresh commit";
 * this one is the standing figure for "is the calendar still whole".
 */
export interface ServingClock {
  /** How old the committed snapshot is right now, in days. */
  readonly snapshotAgeDays: number;
  /** Rows inside the serving window when the snapshot was written, outside it now. */
  readonly fallenOutOfServing: number;
  readonly totalRows: number;
  /** Per source, only where it is non-zero. */
  readonly bySource: readonly { readonly source: string; readonly dropped: number }[];
}

export function servingClockFor(
  snapshot: NonNullable<ReturnType<typeof readSnapshot>>,
  now: number,
): ServingClock {
  const generatedAt = Date.parse(snapshot.generatedAt);
  if (!Number.isFinite(generatedAt)) {
    throw new Error("the snapshot has no readable generatedAt — nothing can be measured against it");
  }

  const guardEdge = generatedAt - CONCLUDED_LOOKBACK_DAYS * 86_400_000;
  const servingEdge = now - CONCLUDED_LOOKBACK_DAYS * 86_400_000;

  const dropped = new Map<string, number>();
  let total = 0;
  for (const meeting of snapshot.meetings) {
    total += 1;
    const at = Date.parse(meeting.startsAt);
    if (!Number.isFinite(at)) continue;
    if (at >= guardEdge && at < servingEdge) {
      const source = meeting.id.split(":")[0];
      dropped.set(source, (dropped.get(source) ?? 0) + 1);
    }
  }

  return {
    snapshotAgeDays: Math.round(((now - generatedAt) / 86_400_000) * 100) / 100,
    fallenOutOfServing: [...dropped.values()].reduce((a, b) => a + b, 0),
    totalRows: total,
    bySource: [...dropped].map(([source, d]) => ({ source, dropped: d })).sort((a, b) => b.dropped - a.dropped),
  };
}

if (import.meta.filename === process.argv[1]) {
  const snapshot = readSnapshot(ROOT);
  if (!snapshot) throw new Error("no committed meetings snapshot to measure");

  const table = headroomFor(snapshot);

  // RULING 159 — the floor. A snapshot that parsed but held no source would
  // otherwise print a clean "0 under threshold" and read as health.
  const tight = table.filter(
    (r) => r.headroomDays !== null && r.headroomDays < HEADROOM_ROW_THRESHOLD_DAYS,
  );
  const measured = floored(
    `meetings sources with under ${HEADROOM_ROW_THRESHOLD_DAYS} days of window headroom`,
    "the committed meetings snapshot",
    table.length,
    tight.length,
  );

  console.log(`source headroom — snapshot generated ${snapshot.generatedAt}`);
  console.log(`serving window ${CONCLUDED_LOOKBACK_DAYS}d; a source's edge is its OWN declared window\n`);
  console.log(
    `  ${"source".padEnd(16)}${"oldest row".padEnd(13)}${"window".padEnd(9)}${"headroom".padStart(10)}${"rows".padStart(8)}`,
  );
  for (const r of table) {
    const flag =
      r.headroomDays === null
        ? "  (no back clip declared — archive is whole)"
        : r.headroomDays < HEADROOM_ROW_THRESHOLD_DAYS
          ? "   <-- OWED A ROW"
          : "";
    console.log(
      `  ${r.source.padEnd(16)}${r.oldestRow.padEnd(13)}${(r.declaredWindowDays === null ? "none" : `${r.declaredWindowDays}d`).padEnd(9)}` +
        `${(r.headroomDays === null ? "n/a" : `${r.headroomDays}d`).padStart(10)}${String(r.rows).padStart(8)}${flag}`,
    );
  }
  console.log(`\n  ${floorLine(measured)}`);
  if (tight.length > 0) {
    console.log(`  tight: ${tight.map((r) => `${r.source} (${r.headroomDays}d)`).join(", ")}`);
  }

  // THE SECOND CLOCK. The table above is frozen against the snapshot's own
  // generatedAt; this one moves. Both, always — neither stands in for the other.
  const serving = servingClockFor(snapshot, Date.now());
  console.log(
    `\n  the headroom column above is measured against the SNAPSHOT'S generatedAt and is a ` +
      "CONSTANT until a refresh lands — it cannot cross by the passage of time.",
  );
  console.log(`  snapshot age right now: ${serving.snapshotAgeDays}d`);
  console.log(
    `  rows inside the serving window when it was written and outside it now: ` +
      `${serving.fallenOutOfServing} of ${serving.totalRows}` +
      (serving.bySource.length > 0
        ? ` — ${serving.bySource.map((s) => `${s.source} ${s.dropped}`).join(", ")}`
        : ""),
  );
  if (serving.fallenOutOfServing > 0) {
    console.log(
      "  Those rows have left a reader's calendar with NOTHING going red: the F22 guard only " +
        "runs while a refresh is being built, which is the thing that has stopped.",
    );
  }
}
