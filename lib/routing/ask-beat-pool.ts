/**
 * The ask box's acknowledgment beat — a curated, approved pool.
 *
 * CLAUDE.md's register rule: the beat is an INTERACTION surface, so it
 * speaks playful. It is also an ACKNOWLEDGMENT and nothing more — "I heard
 * you, it's coming." It never claims deliberation, because nothing a reader
 * sees on this surface is generated: the answer was already resolved
 * (deterministically, from the curated routing map) before the beat began.
 * A "Thinking…" or "Pondering…" label would be a claim about a machine
 * reasoning, and the transparency page would be wrong the moment it shipped.
 *
 * **This list is fixed. Code never adds an entry to it.** An agent
 * that invented a fifth line would be writing product voice nobody approved,
 * on the most-read surface in the app. `tests/ask-box.test.ts` pins the pool
 * exactly — both its contents and its length — so a quiet addition fails the
 * suite rather than shipping.
 *
 * Client-safe by construction: a bare string array, no `node:` imports, no
 * data dependencies. The ask box is a client component and this module sits
 * on its graph.
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
