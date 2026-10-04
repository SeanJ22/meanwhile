/**
 * **A ROLL CALL IS NEVER SKIPPED BETWEEN ONE VERSION AND THE NEXT** (DB-08).
 *
 * The roll-call projection is a window of the latest rolls, replaced at each promotion; every earlier roll stays
 * answerable from the promoted versions that held it (`lib/votes/history.ts`). That is complete only if each window
 * reaches back to the roll after the last one the previous version held. A fixed 20-roll window fell short on a busy
 * day (the House can vote thirty times) or after a missed run, and the rolls in the gap were never acquired.
 *
 * `windowStart` is the first roll to read: the usual `latest - window + 1`, or the roll after the previous version's
 * newest if that is earlier, but never further back than `maxCatchUp` rolls from the latest. A gap larger than that is
 * reported, not silently shortened, so the next run (which starts from what this one holds) closes the rest.
 */
export interface RollWindow {
  readonly start: number;
  /** Rolls between the previous version's newest and this window's start that this run could not reach; 0 when none. */
  readonly unreached: number;
}

export const ROLL_WINDOW = 20;
export const ROLL_MAX_CATCH_UP = 150;

export function windowStart(input: {
  /** The newest roll the chamber has published. */
  readonly latest: number;
  /** The newest roll the previous promoted version held for this chamber, or null when there is none. */
  readonly previousNewest: number | null;
  readonly window?: number;
  readonly maxCatchUp?: number;
}): RollWindow {
  const window = input.window ?? ROLL_WINDOW;
  const maxCatchUp = input.maxCatchUp ?? ROLL_MAX_CATCH_UP;
  const usual = Math.max(1, input.latest - window + 1);
  if (input.previousNewest === null || input.previousNewest >= input.latest) return { start: usual, unreached: 0 };
  const wanted = input.previousNewest + 1;
  const floor = Math.max(1, input.latest - maxCatchUp + 1);
  const start = Math.max(floor, Math.min(usual, wanted));
  return { start, unreached: Math.max(0, start - wanted) };
}
