/**
 * **THE DEMO-DELETION PROMISE, KEPT MECHANICALLY.** (`T10`, 2026-08-24:
 * *every row created during the password-walled test period is
 * marked; when the wall comes down, those rows delete automatically and the
 * deletion is logged.* Built with **wall-down as the trigger**.)
 *
 * ## The promise
 *
 * The tester was told that everything collected during the demo gets deleted
 * when testing ends. **A promise kept by memory is a promise broken** — it
 * depends on somebody remembering, on a particular day, to run something
 * nobody has written. This module is the mechanism that removes the
 * remembering.
 *
 * ## THE MARKER IS THE TIMESTAMP, AND THAT IS A DELIBERATE CHOICE
 *
 * The obvious build is a `demo` column on the reactions store and the search
 * log. **It is forbidden and it would also be worse.**
 *
 * Forbidden: the collection minimum is settled — zip or address for district
 * resolution, an email for account identity — and **no new column goes on the
 * search log or the reactions store**. Those two stores are sold precisely
 * because of what they do not contain, and every column added to them is a
 * column somebody has to be argued out of joining.
 *
 * Worse: a marker written at insert time is a marker an insert path can
 * forget. There are several write paths into these stores and there will be
 * more; one that missed the flag would leave demo rows unmarked, permanently,
 * and nothing would ever notice. **A row's `occurred_at` is written by every
 * path, cannot be omitted, and already answers the question exactly.** The
 * demo period is a stretch of time. Selecting on time is not a workaround for
 * the missing column; it is the correct predicate.
 *
 * ## Wall-down is the trigger, and it has not happened
 *
 * `WALL_DOWN` is `null` until the wall actually comes down. Nothing deletes
 * while it is null, and `pnpm demo:sweep` says so rather than deleting
 * nothing quietly — an armed mechanism that has not fired and a mechanism that
 * did nothing must never read the same (RULING 24).
 *
 * **The date is set by whoever takes the wall down, in the same change.** It
 * is not inferred from a deploy, a config read, or a probe: a wrong date here
 * deletes real reader rows or spares demo ones, and both are unrecoverable.
 */

/**
 * When the password wall went up over the demo.
 *
 * **`null` means this project has not established the date**, and that is
 * recorded rather than guessed. A plausible date here would delete rows by
 * arithmetic on a fabricated number, which is the fabrication rule pointed at
 * the one operation in this product that cannot be undone.
 */
export const WALL_UP: string | null = null;

/**
 * When the wall came down. **`null` until it actually does.**
 *
 * Setting this is what arms the deletion. It is set by the change that takes
 * the wall down, never by a scheduled job inferring it.
 */
export const WALL_DOWN: string | null = null;

export type DemoSweepVerdict =
  /** The wall is still up. Nothing to do, and that is a real answer. */
  | { state: "WALL_STILL_UP"; reason: string }
  /** The wall is down but the window cannot be bounded. Refuses to delete. */
  | { state: "CANNOT_RUN"; reason: string }
  /**
   * Armed and bounded: these rows are the demo's.
   *
   * `from` is `null` when the lower bound is **the beginning** — RULING 142.
   * It is not an unknown wearing a null; the two are kept apart by
   * `lowerBound`, which says which of them this is in words.
   */
  | { state: "READY"; from: string | null; to: string; lowerBound: string };

/**
 * What the sweep should do, decided from the two dates and nothing else.
 *
 * Kept pure and separate from any database call so the decision can be tested
 * without a store — and so the decision cannot quietly depend on what a query
 * happened to return.
 */
export function demoSweepVerdict(
  wallUp: string | null = WALL_UP,
  wallDown: string | null = WALL_DOWN,
): DemoSweepVerdict {
  if (wallDown === null) {
    return {
      state: "WALL_STILL_UP",
      reason:
        "The password wall has not come down. The deletion is ARMED and has not fired — " +
        "which is a different fact from a sweep that ran and found nothing, and it is " +
        "reported as one.",
    };
  }
  if (wallUp === null) {
    /*
     * RULING 142 — the line in the sand.
     *
     * This branch used to be a CANNOT_RUN, and the reasoning was right at the
     * time: deleting from the beginning of time would take real reader rows
     * with it. **The ruling removes the premise.** Nothing collected before
     * the wall comes down is ever sold or shown as signal, organic-looking or
     * not — so there are no real reader rows below this bound to protect, and
     * the lower bound is not an unknown. It is the beginning.
     *
     * The distinction is kept ON THE VERDICT rather than smoothed away: a
     * `from` of `null` here means *everything up to wall-down*, and it must
     * never read the same as a bound somebody failed to establish. That is why
     * `lowerBound` is a sentence rather than a flag.
     */
    return {
      state: "READY",
      from: null,
      to: wallDown,
      lowerBound:
        "the beginning — WALL_UP is unset, and under RULING 142 nothing collected before " +
        "the wall comes down is sellable, so every row up to WALL_DOWN is the demo's.",
    };
  }
  if (wallUp > wallDown) {
    return {
      state: "CANNOT_RUN",
      reason: `WALL_UP (${wallUp}) is after WALL_DOWN (${wallDown}), which is not a window.`,
    };
  }
  return {
    state: "READY",
    from: wallUp,
    to: wallDown,
    lowerBound: `WALL_UP (${wallUp}) — a bounded window, both ends established`,
  };
}

/**
 * The stores the promise covers, by name.
 *
 * Named as a list rather than discovered, because a store added later must be
 * a deliberate decision about whether the promise covers it — and a sweep that
 * silently widened to a new store would be deleting rows nobody promised to
 * delete.
 */
export const STORES_COVERED = ["reactions", "search_log"] as const;
