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
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { readSnapshot } from "../lib/meetings/snapshot.ts";
import { servingClockFor } from "../scripts/source-headroom.mts";

// RULING 14 — `fileURLToPath`, never a URL pathname. On Windows the latter is
// `/C:/...` and `join()` resolves it against the working directory into
// `C:C:...`. The hand-rolled strip this first used is exactly the reinvention
// that ruling exists to refuse.
const ROOT = join(import.meta.dirname, "..");

test("NH206: no committed row has fallen out of the serving window", () => {
  const snapshot = readSnapshot(ROOT);
  assert.ok(snapshot, "there is no committed meetings snapshot to measure — that is a broken read, not a clean board");

  const clock = servingClockFor(snapshot, Date.now());

  // RULING 159 — the floor is asserted before the count is reported. A snapshot
  // holding no rows would otherwise report zero crossings and read as health.
  assert.ok(clock.totalRows > 0, "the snapshot holds no meetings at all, so nothing could have crossed");

  assert.equal(
    clock.fallenOutOfServing,
    0,
    `${clock.fallenOutOfServing} of ${clock.totalRows} committed row(s) were inside the serving window when the ` +
      `snapshot was written and are outside it NOW. The snapshot is ${clock.snapshotAgeDays} day(s) old. ` +
      `By source: ${clock.bySource.map((s) => `${s.source} ${s.dropped}`).join(", ") || "none"}. ` +
      "This is the SERVING EDGE, which moves — not the headroom column, which is frozen. " +
      "The daily refresh has not landed recently enough; run `pnpm source:headroom` and dispatch refresh-daily.",
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
