/**
 * **THE CACHE-DEFECT DETECTOR — the stationary-breakpoint signature, and the
 * zero-read one beside it.** (Prompt-caching session, 2026-09-06.)
 *
 * ## What the old detector measured, and what it missed
 *
 * The RULING 244 detector flagged a turn after the first that read ZERO
 * cached tokens. Every measured Scout Attempt of 2026-09-02 passed it, and
 * every one of them re-sent its whole conversation at full price on every
 * turn: the breakpoint sat on the system prompt and never moved, so each turn
 * read the 4,082-token static prefix (never zero) and paid for everything
 * after it uncached. Twenty-three Attempts, 4.4 million uncached tokens, and
 * the detector reported clean — it was measuring the wrong thing.
 *
 * ## The signature this detector reads
 *
 * With a breakpoint that moves forward each turn, turn N's prompt is turn
 * N−1's prompt plus what was appended since (the previous assistant output
 * and the new tool results): everything before the new breakpoint is either
 * read from the cache or written to it, and `input_tokens` — the uncached
 * remainder — is only the tail past the last breakpoint, a few tokens. With a
 * stationary breakpoint the uncached remainder IS the conversation and grows
 * every turn.
 *
 * So, per turn N > 1, with `total = uncached + read + write`:
 *
 * ```
 *   appended        = total(N) − total(N−1)
 *   STATIONARY when   uncached(N) > appended + minimum
 *   ZERO_READ  when   read(N) === 0
 * ```
 *
 * The slack of one model minimum (512 tokens on claude-opus-5) is the amount a
 * moving breakpoint can legitimately leave uncached — a prefix increment under
 * the minimum is not cacheable and shows up as uncached input. Both conditions
 * are cache defects; both are counted, each by name, with the denominator.
 *
 * Pure over the per-turn usage rows. Nothing here reads a clock or a store.
 */

export interface TurnUsage {
  /** 1-based provider turn. */
  readonly turn: number;
  /** The API's `input_tokens`: the uncached remainder. */
  readonly uncachedInput: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

export interface CacheDefectReading {
  /** Turns after the first whose uncached remainder exceeds what the turn appended by more than the minimum. */
  readonly stationaryTurns: readonly number[];
  /** Turns after the first that read zero cached tokens. */
  readonly zeroReadTurns: readonly number[];
  /** The union, ascending, for a one-line report. */
  readonly turns: readonly number[];
  /** Turns after the first that were examined — the denominator. */
  readonly examinedTurns: number;
  readonly minimumCacheablePrefixTokens: number;
}

export function detectCacheDefects(rows: readonly TurnUsage[], minimumCacheablePrefixTokens: number): CacheDefectReading {
  const ordered = [...rows].sort((a, b) => a.turn - b.turn);
  const stationary: number[] = [];
  const zeroRead: number[] = [];
  let examined = 0;
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const cur = ordered[i];
    examined += 1;
    const total = (r: TurnUsage): number => r.uncachedInput + r.cacheRead + r.cacheWrite;
    const appended = total(cur) - total(prev);
    if (cur.uncachedInput > appended + minimumCacheablePrefixTokens) stationary.push(cur.turn);
    if (cur.cacheRead === 0) zeroRead.push(cur.turn);
  }
  const turns = [...new Set([...stationary, ...zeroRead])].sort((a, b) => a - b);
  return { stationaryTurns: stationary, zeroReadTurns: zeroRead, turns, examinedTurns: examined, minimumCacheablePrefixTokens };
}

/** The sentence the Attempt record carries when a defect was read. */
export function describeCacheDefects(reading: CacheDefectReading): string {
  const parts: string[] = [];
  if (reading.stationaryTurns.length > 0) {
    parts.push(
      `turn(s) ${reading.stationaryTurns.join(", ")} paid for more uncached input than the turn appended (by more than the ` +
        `${reading.minimumCacheablePrefixTokens}-token minimum): the STATIONARY-BREAKPOINT signature — the conversation was re-sent at full price`,
    );
  }
  if (reading.zeroReadTurns.length > 0) {
    parts.push(`turn(s) ${reading.zeroReadTurns.join(", ")} read ZERO cached tokens over a prefix identical to the previous turn's`);
  }
  return `${parts.join("; ")}; a repeated-prefix turn that does not read its prefix from the cache is a defect in our request assembly (RULING 244)`;
}
