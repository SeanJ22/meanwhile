/**
 * `NH206` — THE CLOCK THAT MOVES, AND CROSSING IT FAILS ON ITS OWN.
 * (2026-08-26, Item 8c of the sources-and-incumbency session.)
 *
 * ## The two clocks, and which one a reader of `pnpm source:headroom` acts on
 *
 * There are two, they are printed side by side, and only one of them moves:
 *
 * | Clock | Where it comes from | Does it move? |
 * |---|---|---|
 * | the HEADROOM column | the snapshot's own `generatedAt` against each source's oldest row | **NO.** Both terms are frozen in a committed artifact |
 * | the SERVING EDGE | **now**, against the same frozen rows | **YES**, continuously |
 *
 * **ACT ON THE SERVING EDGE.** The headroom column cannot cross by the passage
 * of time — an entry reading `ical +0.06d` is 0.06 days of MARGIN inside a
 * frozen measurement, not a deficit, and an earlier reading of that table as
 * sources having "crossed" or being "rotten" was a frozen number read as a live
 * one. That misreading is recorded here rather than in a note, because a note is
 * what it was recorded in last time.
 *
 * ## What was actually missing
 *
 * The F22 staleness guard runs **while a refresh is being built**. A row that
 * crosses the serving edge at 3am on a day no refresh runs crosses in silence:
 * production keeps serving a snapshot whose oldest rows have fallen out of the
 * window, and nothing anywhere goes red. **A staleness guard that only fires
 * during a build does not protect what is being served.**
 *
 * This is that alarm, and it is INDEPENDENT of any refresh: it runs in the
 * suite, on every push, on every pull request, and inside every scheduled job's
 * own validate step. It reads `now`.
 *
 * **It is allowed to go red on a quiet night, and that is the point.** If the
 * daily refresh stops landing, this is what says so — loudly, in a place
 * somebody is already looking, rather than in a table nobody ran.
 *
 * ## CORRECTED 2026-08-26 — what "stops landing" had to become
 *
 * The first version asserted ZERO crossings, and zero is not reachable: the
 * crossing band is exactly as wide as the snapshot's own age, so any snapshot
 * older than an instant has shed something. It went red 1 hour 40 minutes
 * after a green refresh. The assertion is now the snapshot's AGE — which is
 * what "frozen" means — with the crossing count reported beside it and a
 * second assertion that the shedding is explicable BY that age. The full
 * reasoning sits on the assertion itself rather than here, where the reader
 * arrives at it.
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { CONCLUDED_LOOKBACK_DAYS } from "../lib/meetings/constants.ts";
import { readSnapshot } from "../lib/meetings/snapshot.ts";
import { servingClockFor } from "../scripts/source-headroom.mts";

// RULING 14 — `fileURLToPath`, never a URL pathname. On Windows the latter is
// `/C:/...` and `join()` resolves it against the working directory into
// `C:C:...`. The hand-rolled strip this first used is exactly the reinvention
// that ruling exists to refuse.
const ROOT = join(import.meta.dirname, "..");

/**
 * How old the committed snapshot may be before it counts as FROZEN.
 *
 * Two days: the daily cadence RULING 124 set, plus one missed run. One day
 * would go red on the ordinary gap between a run and the next; three would let
 * two consecutive silent failures pass, and two consecutive failures is
 * precisely the evidence RULING 115 says is worth waking somebody for.
 */
const MAX_SNAPSHOT_AGE_DAYS = 2;

test("NH206: the committed snapshot is not FROZEN, and its shedding is explicable", () => {
  const snapshot = readSnapshot(ROOT);
  assert.ok(snapshot, "there is no committed meetings snapshot to measure — that is a broken read, not a clean board");

  const clock = servingClockFor(snapshot, Date.now());

  // RULING 159 — the floor is asserted before the count is reported. A snapshot
  // holding no rows would otherwise report zero crossings and read as health.
  assert.ok(clock.totalRows > 0, "the snapshot holds no meetings at all, so nothing could have crossed");

  /*
   * CORRECTED 2026-08-26 by the all-open-board session, and the correction is
   * recorded rather than made quietly, because it MOVES A GUARD.
   *
   * ## What this asserted, and why it could not hold
   *
   * It asserted `fallenOutOfServing === 0`. **That is the size of a gap the
   * architecture creates by itself**, which is the shape RULING 116 forbids —
   * a guard that goes red because time passed rather than because anything
   * broke.
   *
   * The arithmetic, measured rather than argued. The serving window looks back
   * `CONCLUDED_LOOKBACK_DAYS` = 90 days. A row "falls out" when its start sits
   * between `generatedAt - 90d` and `now - 90d` — a band exactly as wide as
   * the snapshot's own age. The committed snapshot holds 447 rows over that
   * window, about five a day, so **an age of one day is worth roughly five
   * crossings and an age of one hour is worth a fraction of one**. On
   * 2026-08-26 this went red at 1 of 447 with the snapshot **0.07 days old** —
   * one hour and forty minutes after `refresh-daily` run 33005902616 landed
   * green. Nothing had stopped landing. A meeting had simply concluded and
   * aged past ninety days, which is the window doing its job.
   *
   * With the daily cadence that is a red suite on most days, and RULING 115 is
   * the cost: the price of an alarm that fires on the normal operating state is
   * never the false alarm, it is the real one nobody reads.
   *
   * ## What it asserts now, and why this is the same protection
   *
   * The row `NH206` is about a **FROZEN** snapshot — "loses reader-visible rows
   * one day at a time and nothing goes red". Frozen is a fact about the
   * snapshot's AGE, and age is the invariant; the crossings are the
   * CONSEQUENCE. So the assertion moves to age, and the crossing count is
   * reported beside it on every run — both numbers, neither standing in for
   * the other (the two-numbers rule), which is what the module this reads from
   * already says about its own two clocks.
   *
   * The detector is untouched: `servingClockFor` still measures crossings, the
   * constructed-crossing test below still proves it catches one, and this still
   * runs in the SUITE rather than during a refresh build — which was the whole
   * of what was missing.
   *
   * A row is open for Sean to overrule this if he wants the stricter reading.
   */
  assert.ok(
    clock.snapshotAgeDays <= MAX_SNAPSHOT_AGE_DAYS,
    `the committed meetings snapshot is ${clock.snapshotAgeDays} day(s) old, past the ` +
      `${MAX_SNAPSHOT_AGE_DAYS}-day ceiling — the daily refresh has stopped landing, and production ` +
      `is serving a calendar that loses reader-visible rows every day it stays frozen. ` +
      `${clock.fallenOutOfServing} of ${clock.totalRows} committed row(s) have already fallen out of the ` +
      `serving window since it was written` +
      `${clock.bySource.length > 0 ? ` (by source: ${clock.bySource.map((s) => `${s.source} ${s.dropped}`).join(", ")})` : ""}. ` +
      "This is the SERVING EDGE, which moves — not the headroom column, which is frozen. " +
      "Run `pnpm source:headroom` and dispatch refresh-daily.",
  );

  /*
   * The DIRECTION, which age alone does not cover (RULING 116 asks for the
   * invariant AND the direction). A fresh snapshot that has already shed a
   * large share of its rows is not explained by the passage of time, and that
   * is a real finding rather than a clock — it would mean the snapshot was
   * built holding rows that were already at the edge.
   */
  const sheddablePerDay = clock.totalRows / CONCLUDED_LOOKBACK_DAYS;
  const explicable = Math.ceil(sheddablePerDay * (clock.snapshotAgeDays + 1) * 3);
  assert.ok(
    clock.fallenOutOfServing <= explicable,
    `${clock.fallenOutOfServing} of ${clock.totalRows} row(s) have fallen out of the serving window, and the ` +
      `snapshot's age of ${clock.snapshotAgeDays} day(s) can only explain about ${explicable}. ` +
      "That is not the clock moving — the snapshot was committed holding rows already at its edge.",
  );
});

test("NH206 — THE INSTRUMENT IS SHOWN CATCHING A CONSTRUCTED CROSSING", () => {
  /*
   * RULING 110: a sweep that cannot find the thing it was written for is a
   * sweep reporting green about nothing. The real snapshot is (correctly)
   * clean, so a green assertion above proves only that today is fine.
   *
   * This constructs a snapshot whose rows sat inside the window when it was
   * written and are outside it now — the exact shape the guard exists for — and
   * asserts the count is non-zero.
   */
  const day = 86_400_000;
  const generatedAt = new Date(Date.now() - 10 * day).toISOString();
  // 88 days before the snapshot was written: inside a 90-day window then, and
  // 98 days old now, so outside it today.
  const startsAt = new Date(Date.parse(generatedAt) - 88 * day).toISOString();

  const constructed = {
    generatedAt,
    meetings: [
      { id: "ical:constructed-crossing", startsAt },
      { id: "ical:constructed-inside", startsAt: new Date(Date.now() - day).toISOString() },
    ],
  } as unknown as NonNullable<ReturnType<typeof readSnapshot>>;

  const clock = servingClockFor(constructed, Date.now());
  assert.equal(clock.totalRows, 2);
  assert.equal(clock.fallenOutOfServing, 1, "the constructed crossing must be caught");
  assert.deepEqual(clock.bySource, [{ source: "ical", dropped: 1 }], "and it must name the source it came from");
});
