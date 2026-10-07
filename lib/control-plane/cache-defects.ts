/**
 * Cache-defect detector. Per turn N > 1, with `total = uncached + read + write`:
 *
 * ```
 *   appended        = total(N) − total(N−1)
 *   STATIONARY when   uncached(N) > appended + minimum
 *   ZERO_READ  when   read(N) === 0
 * ```
 *
 * A moving breakpoint leaves only the tail uncached; a stationary one leaves
 * the whole growing conversation uncached while still reading the static
 * prefix. The slack of one model minimum is what a moving breakpoint can
 * legitimately leave uncached.
 *
 * Pure over the per-turn usage rows.
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
