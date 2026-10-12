/**
 * The ask box's acknowledgment beat: a curated, approved pool. The beat only acknowledges ("I heard you,
 * it's coming") and never claims deliberation, because the answer was resolved deterministically before
 * it began. The list is fixed; code never adds an entry, and `tests/ask-box.test.ts` pins it exactly.
 * Client-safe: a bare string array with no data dependencies.
 */

/**
 * The approved set, verbatim and in its fixed order. Trailing ellipses are
 * part of the copy; the surface animates its own dots
 * and strips exactly one trailing ellipsis so the reader never sees "......".
 */
export const ASK_BEAT_POOL: readonly string[] = [
  "Hang tight, I got you...",
  "Bet — one sec...",
  "On it...",
  "Let me grab that...",
] as const;

/**
 * Words that would turn an acknowledgment into a deliberation claim. Not a
 * style preference — the guard for the rule above, asserted against the pool
 * in the suite so a future entry cannot smuggle one in.
 */
export const PROHIBITED_BEAT_WORDS: readonly string[] = [
  "thinking",
  "pondering",
  "analyzing",
  "analysing",
  "reasoning",
  "considering",
  "computing",
  "generating",
] as const;

/**
 * One entry at random. Called at ask time in the browser — never during
 * server render, which would either freeze one line into the HTML or
 * mismatch on hydration.
 */
export function drawAskBeat(): string {
  return ASK_BEAT_POOL[Math.floor(Math.random() * ASK_BEAT_POOL.length)];
}

/** The entry minus its trailing ellipsis; the animated dots follow it. */
export function beatStem(entry: string): string {
  return entry.replace(/\.{3}$/, "");
}
