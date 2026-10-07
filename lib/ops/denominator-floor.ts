/** A counting script fails loudly when its denominator is zero: an empty match set and a healthy surface give the same number. */

/** What a floored measurement is allowed to say about itself. */
export type FloorOutcome = "MEASURED" | "COULD_NOT_ASSERT";

export interface FlooredCount {
  readonly outcome: FloorOutcome;
  /** Size of the population the count was taken over. */
  readonly denominator: number;
  /** How many of the population matched. Never reported without a denominator. */
  readonly matched: number;
  /** What was being counted, in words, for the report. */
  readonly subject: string;
  /** Present only on `COULD_NOT_ASSERT`: the difference between an honest empty and a broken instrument. */
  readonly reason?: string;
}

export class EmptyDenominatorError extends Error {
  // Fields declared and assigned, never a parameter property: strip-only mode refuses parameter properties.
  readonly subject: string;
  readonly where: string;

  constructor(subject: string, where: string) {
    super(
      `DENOMINATOR FLOOR: counting "${subject}" over an EMPTY population at ${where}. ` +
        `Zero is a result that must be earned, never defaulted to. Either the selector/query matched ` +
        `nothing — which is a defect in the instrument, not a fact about the data — or the population ` +
        `is genuinely empty, in which case say why via \`reason\` and take COULD_NOT_ASSERT.`,
    );
    this.name = "EmptyDenominatorError";
    this.subject = subject;
    this.where = where;
  }
}

/**
 * Report `matched` out of `population`, refusing to do so over nothing.
 *
 * @param reason  Supply only when the population is genuinely, explicably empty. It turns a throw into a named
 *                `COULD_NOT_ASSERT`, never into a pass.
 */
export function floored(
  subject: string,
  where: string,
  population: number,
  matched: number,
  reason?: string,
): FlooredCount {
  if (!Number.isFinite(population) || population < 0) {
    throw new EmptyDenominatorError(subject, `${where} (denominator is not a count: ${population})`);
  }
  if (population === 0) {
    if (!reason) throw new EmptyDenominatorError(subject, where);
    return { outcome: "COULD_NOT_ASSERT", denominator: 0, matched: 0, subject, reason };
  }
  if (matched > population) {
    throw new EmptyDenominatorError(
      subject,
      `${where} (matched ${matched} exceeds the population ${population} — the two were counted over different things)`,
    );
  }
  return { outcome: "MEASURED", denominator: population, matched, subject };
}

/** The same floor for a selector sweep, so the error names the selector. */
export function flooredSelector<T>(
  subject: string,
  selector: string,
  found: readonly T[],
  matches: (item: T) => boolean,
): FlooredCount {
  if (found.length === 0) {
    throw new EmptyDenominatorError(
      subject,
      `selector \`${selector}\` matched NOTHING — the surface was never reached`,
    );
  }
  return floored(subject, `selector \`${selector}\``, found.length, found.filter(matches).length);
}

/** One line for a report, stating both numbers or stating why there are none. */
export function floorLine(c: FlooredCount): string {
  return c.outcome === "MEASURED"
    ? `${c.subject}: ${c.matched} of ${c.denominator}`
    : `${c.subject}: COULD NOT ASSERT — ${c.reason}`;
}
