/**
 * A roll call is never skipped between one version and the next. The roll-call
 * projection is a window of the latest rolls; earlier rolls stay answerable from
 * the promoted versions that held them (`lib/votes/history.ts`), which is
 * complete only if each window reaches back to the roll after the previous
 * version's newest.
 *
 * `windowStart` reads the usual recent window, or advances forward from the prior version's newest roll.
 * A bounded catch-up ends after `maxCatchUp` rolls; its published end is the next pass's durable position.
 */
export interface RollWindow {
  readonly start: number;
  readonly end:number;
  /** Newer rolls after this bounded window which remain standing work. */
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
  const usual = Math.max(1, input.latest - Math.min(window,maxCatchUp) + 1);
  if (input.previousNewest === null || input.previousNewest >= input.latest) return { start: usual,end:input.latest, unreached: 0 };
  const wanted = input.previousNewest + 1;
  const start = Math.min(usual,wanted),end=Math.min(input.latest,start+maxCatchUp-1);
  return { start,end,unreached:Math.max(0,input.latest-end) };
}
