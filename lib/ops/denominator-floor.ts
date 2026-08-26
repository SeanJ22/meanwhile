/**
 * **RULING 159 — a counting script fails loudly when its denominator is zero.**
 * (Adopted 2026-08-25, the all-open-board session.)
 *
 * ## The shape, and this is its third venue
 *
 * The prior session's capture script reported **`0 offenders`** about a panel it
 * never opened. Three guessed selectors, none of which matched, and a clean
 * exit — because **an empty match set and a healthy surface produce the
 * identical number.**
 *
 * That is RULING 113's Chromium step that installed nothing and reported
 * success. It is RULING 100's partial extraction, six times over. It is
 * RULING 43's zero-row read recorded as an empty document. The failure is
 * always the same one: *did anything come back* is the wrong question, because
 * "no" is a legitimate answer to it and a catastrophic answer to the question
 * that was actually being asked.
 *
 * ## What this module is, and what it deliberately is not
 *
 * It is a FLOOR, not a counter. It does not measure anything; it refuses to let
 * a measurement be reported from a population nobody established. Three states,
 * kept apart on purpose (RULING 24):
 *
 * - **A population with members.** The count is reportable.
 * - **An empty population with NO stated reason** — `throw`. This is the
 *   defect: a selector that matched nothing, a directory that listed nothing, a
 *   query that joined nothing.
 * - **An empty population WITH a stated reason** — `COULD_NOT_ASSERT`, named
 *   and returned, never a silent pass. That is RULING 100's second state, and
 *   it is the half most likely to be dropped: *we counted four and the page
 *   never said how many there should be* is a far weaker claim than *we counted
 *   four and the page says four*, and a report running the two together tells a
 *   reader it checked something it did not.
 *
 * There is **no skip flag**, for the reason the build gate already gives: an
 * escape hatch on a gate is how the gate stops meaning anything.
 */

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
  /**
   * Present only on `COULD_NOT_ASSERT`, and it is the whole difference between
   * an honest empty and a broken instrument.
   */
  readonly reason?: string;
}

export class EmptyDenominatorError extends Error {
  /*
   * **Fields declared and assigned, never a PARAMETER PROPERTY.** The suite
   * runs under `node --test --experimental-strip-types`, and strip-only mode
   * refuses `constructor(readonly subject: string)` outright — it is a TS
   * feature that EMITS code rather than only types, so there is nothing to
   * strip. It compiles under `tsc` and fails under the runner, which means
   * `pnpm tsc` goes green while every test importing this file dies at parse.
   */
  readonly subject: string;
  readonly where: string;

  constructor(subject: string, where: string) {
    super(
      `DENOMINATOR FLOOR (RULING 159): counting "${subject}" over an EMPTY population at ${where}. ` +
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
 * @param reason  Supply ONLY when the population is genuinely, explicably
 *                empty. Supplying it turns a throw into a named
 *                `COULD_NOT_ASSERT`; it never turns one into a pass.
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

/**
 * The same floor for a SELECTOR sweep, where the population is the set of
 * elements/rows a pattern found.
 *
 * A selector is the case that produced the ruling, and it gets its own entry
 * point so the error can name the selector rather than a number.
 */
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
