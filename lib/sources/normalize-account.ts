import type { Meeting } from "./types.ts";

/**
 * **THE ZERO-ROW SHAPE, MADE INEXPRESSIBLE** — RULING 43, 2026-08-20.
 *
 * A source that fetched documents and normalized none of them, with no drop
 * recorded to account for one, has told you about its parser rather than about
 * the body's calendar. `CLAUDE.md` has said so in writing five separate times —
 * once per sighting — and the shape kept coming back, because a written
 * prohibition is a thing a session has to remember at the moment it writes a
 * `return`. The sixth sighting reached a reader: `ical` reported
 * `ok: true, fetched: 3, normalized: 0, drops 0` on the 02:00Z refresh of
 * 2026-08-20 and Wilmot, New Hampshire went from 23 meetings to none.
 *
 * ## Why this is structural and not a sixth written rule
 *
 * `ReportingMeetingSource.normalizeWithDrops` no longer returns a plain object.
 * It returns an `Accounted<...>` — a type carrying a `unique symbol` property
 * that only this module's factory attaches. An adapter that writes
 * `return { meetings, drops }` no longer compiles: `tsc` names the missing
 * brand at the `return` statement, in the adapter, at authorship time. The one
 * way to obtain the brand is `accountedNormalize()`, and that function REFUSES
 * the shape — it throws rather than returning a value.
 *
 * So the forbidden state has no representation:
 *
 * - There is no literal that satisfies the return type.
 * - There is one constructor, and it will not build this one.
 * - The composite already routes a throw from `normalizeWithDrops` to `JOB`,
 *   which turns the run red rather than carrying the emptiness onto a page.
 *
 * ## What THIS check does not require — and what the one below it does
 *
 * The zero-row check is narrow on purpose: **documents in hand, nothing out,
 * and nothing dropped.** A source that fetched and dropped everything has
 * already said why, and is left alone. A source that fetched nothing has an
 * empty upstream, which the fetch layer is the right place to judge.
 *
 * This paragraph used to continue: *full accounting is not the rule, because it
 * is false of honest adapters — one `.ics` document is one raw row and twenty
 * meetings.* **That observation was correct and the conclusion drawn from it
 * was wrong**, and A-002 is what the gap cost. Documents and events being
 * different units is a reason to count in the unit the disposition happens in,
 * not a reason to stop counting. The conservation contract below does exactly
 * that, and it never compares a document count with an event count.
 *
 * ## The honest limit
 *
 * `ACCOUNTED` is exported, because the type has to name it. A determined
 * adapter could write `{ ...result, [ACCOUNTED]: true }` and route around the
 * factory. Nothing in the type system stops that. `tests/zero-row-contract.test.ts`
 * greps every adapter for a hand-attached brand and fails the build on one, so
 * the route exists but cannot be taken quietly.
 */

/**
 * The brand. A real runtime symbol, so the value carries it and a structural
 * type check is not enough to forge one by accident.
 */
export const ACCOUNTED: unique symbol = Symbol.for("wtp.normalize.accounted");

/** A normalize result that went through {@link accountedNormalize}. */
export type Accounted<R> = R & {
  readonly [ACCOUNTED]: true;
  /** What the conservation check was given and what it concluded. */
  readonly accounting: ConservationRecord;
};

/* ======================================================================== *
 *  A-002 / S-001 · CONSERVATION, NOT "SOMETHING WAS DROPPED"
 * ======================================================================== */

/**
 * **ONE RECORDED DROP MAY NOT LAUNDER NINETY-NINE DISAPPEARANCES.**
 *
 * A-002 and S-001, from the external correctness audit of `336a3eb`,
 * remediated 2026-08-24. Reproduced before it was fixed: the auditor's
 * adversarial case — 100 logical inputs, 0 output, `drops: {malformed: 1}` —
 * was branded and returned clean.
 *
 * The cause was a BOOLEAN. `accountedNormalize` asked `droppedAny`, and
 * `droppedAny` cannot tell one drop from ninety-nine. It was the right question
 * for RULING 43, which is about a pass that produced NOTHING; it is silent
 * about a pass that produced SOME, which is precisely RULING 100's partial —
 * *a total that reconciles is not a total that is correct*.
 *
 * ## The invariant, and why it is at the LOGICAL-RECORD layer
 *
 * The old doc comment on this module argued against full accounting, and its
 * reasoning was sound as far as it went: *one `.ics` document is one raw row
 * and twenty meetings*, so `meetings.length + drops === input.length` is false
 * of every honest adapter. **The conclusion drawn from it was the wrong one.**
 * The answer to "documents and events are different units" is to count in the
 * unit the disposition happens in, not to abandon counting.
 *
 * So the pass declares how many LOGICAL RECORDS it considered — candidate
 * events, agenda rows, calendar entries, whatever the thing is that either
 * becomes a meeting or does not — and every one of them has exactly one
 * disposition:
 *
 *     produced + dropped + outOfWindow + duplicates === logicalInput
 *
 * Exactly. Not at least, not approximately. A record that is none of those four
 * things vanished, and a vanished record is the defect this exists to name.
 *
 * **Document count is never compared with event count**, and that is why
 * `unretrieved` is NOT a term in the sum. A refused feed is a DOCUMENT that
 * never arrived; it contributes no logical records, so it is already absent
 * from `logicalInput`. Adding it would double-count, and it did — the first
 * version of this contract failed `ical`'s refusal fixtures with *1 more
 * disposition than records*, which is the contract catching its own author
 * mixing the two layers.
 *
 * `unretrieved` is still carried, reported, and used by the RULING 43 zero-row
 * check below, which is the one question here that IS about documents in hand.
 *
 * **Deviation from the brief, stated rather than smoothed.** The remediation
 * brief wrote the invariant as `produced + dropped + outOfWindow + unretrieved
 * === input` and, two sentences later, required that where an adapter counts
 * documents but yields events the invariant move to the logical-record layer
 * and document count never be compared with event count. Those two cannot both
 * hold. The second governs, because it is the one that is true of `ical`.
 *
 * ## The second state, which is the load-bearing half
 *
 * A pass that CANNOT say how many logical records it considered records
 * `COULD_NOT_ASSERT` — a named, reported state, never a silent pass. That is
 * RULING 100's own second clause: *where a source states no count, extraction
 * records that it could not assert one.* "We produced four and nothing told us
 * how many there should be" is a far weaker claim than "we produced four and
 * there were four", and a report that runs them together says it checked
 * something it did not.
 */
export interface ConservationTerms {
  /**
   * How many logical records the pass CONSIDERED, or `null` when the pass
   * genuinely cannot say. `null` is honest; a guessed number is not.
   */
  logicalInput: number | null;
  /** Records that became meetings. */
  produced: number;
  /** Records the pass rejected, with a counted reason. */
  dropped: number;
  /** Records placed in time and then set aside as outside the served window. */
  outOfWindow: number;
  /** Records that were the same logical record already seen. */
  duplicates: number;
  /** Records that arrived with no retrieved document behind them. */
  unretrieved: number;
}

export type ConservationOutcome = "CONSERVED" | "COULD_NOT_ASSERT";

export interface ConservationRecord extends ConservationTerms {
  outcome: ConservationOutcome;
  /** Every disposition summed — the left-hand side of the invariant. */
  accountedFor: number;
}

/**
 * Thrown when the dispositions do not sum to the records considered.
 *
 * It names EVERY term, because "counts do not match" sends a reader back to the
 * parser with nothing to go on, and the gap's sign is the first thing that
 * tells them which way to look: short means records vanished, over means
 * something was counted twice.
 */
export class ConservationError extends Error {
  readonly source: string;
  readonly terms: ConservationTerms;

  constructor(source: string, terms: ConservationTerms, detail: string) {
    const { logicalInput, produced, dropped, outOfWindow, duplicates, unretrieved } = terms;
    super(
      `${source}: extraction does not conserve — ${detail}. ` +
        `considered ${logicalInput}, accounted for ${produced + dropped + outOfWindow + duplicates} ` +
        `(produced ${produced}, dropped ${dropped}, out of window ${outOfWindow}, ` +
        `duplicates ${duplicates}; and ${unretrieved} document(s) never retrieved, which are NOT part of this sum). ` +
        "Every logical record has exactly one disposition and the sum is exact; " +
        "a record that is none of these vanished silently (A-002).",
    );
    this.name = "ConservationError";
    this.source = source;
    this.terms = terms;
  }
}

const isCount = (n: number) => Number.isInteger(n) && n >= 0;

/**
 * Check the invariant, or record honestly that it could not be checked.
 *
 * Exported and tested on its own so the contract has one implementation rather
 * than one per adapter — RULING 103's predicate, applied before there is
 * anything to sweep.
 */
export function conserve(source: string, terms: ConservationTerms): ConservationRecord {
  const { logicalInput, produced, dropped, outOfWindow, duplicates, unretrieved } = terms;

  // Bounds first. A negative or fractional counter means the caller's own
  // arithmetic is broken, and checking a sum built out of nonsense would report
  // a conservation failure for the wrong reason.
  for (const [name, n] of [
    ["produced", produced],
    ["dropped", dropped],
    ["outOfWindow", outOfWindow],
    ["duplicates", duplicates],
      ["unretrieved", unretrieved],
  ] as const) {
    if (!isCount(n)) {
      throw new ConservationError(source, terms, `${name} is ${n}, which is not a count`);
    }
  }
  const accountedFor = produced + dropped + outOfWindow + duplicates;

  if (logicalInput === null || logicalInput === undefined) {
    return { ...terms, logicalInput: null, outcome: "COULD_NOT_ASSERT", accountedFor };
  }
  if (!isCount(logicalInput)) {
    throw new ConservationError(source, terms, `logicalInput is ${logicalInput}, which is not a count`);
  }
  if (accountedFor !== logicalInput) {
    const gap = logicalInput - accountedFor;
    throw new ConservationError(
      source,
      terms,
      gap > 0
        ? `${gap} logical record(s) have NO disposition and vanished`
        : `${-gap} more disposition(s) than records — something is counted twice`,
    );
  }
  return { ...terms, outcome: "CONSERVED", accountedFor };
}

/**
 * Sum a drop-counter object.
 *
 * One implementation, called by both this module and the composite's own
 * defence-in-depth copy of the zero-row check — the two `droppedAny` sites the
 * S-001 sweep found (2 of 2).
 */
export function totalDropped(counters: object): number {
  let total = 0;
  for (const n of Object.values(counters as Record<string, unknown>)) {
    if (typeof n === "number") total += n;
  }
  return total;
}

/**
 * RULING 43's question, unchanged and asked at the DOCUMENT layer.
 *
 * Documents in hand, nothing out, nothing dropped. Shared so the composite's
 * copy and this module's copy cannot drift apart.
 */
export function isZeroRowExtraction(args: {
  documentsInHand: number;
  produced: number;
  dropped: number;
  outOfWindow: number;
}): boolean {
  return (
    args.documentsInHand > 0 && args.produced === 0 && args.dropped === 0 && args.outOfWindow === 0
  );
}

/**
 * The shape every adapter's normalize pass produces, before branding.
 *
 * `drops` is typed loosely on purpose: `legistar` counts three reasons and
 * every other adapter counts four, and the factory only ever asks whether any
 * counter is above zero. The precise shape is pinned where it belongs — on
 * `ReportingMeetingSource.normalizeWithDrops` in `./types.ts`.
 */
export interface NormalizeAccountInput {
  meetings: Meeting[];
  drops: object;
  unreachableOcdIds?: string[];
}

/**
 * Thrown when an adapter tries to report a zero-row extraction as a result.
 *
 * Carried as an ordinary `Error` subclass so the composite's existing catch
 * routes it to `JOB` with no new branch: our parser, on bytes we already hold,
 * is our bug and the run goes red.
 */
export class ZeroRowExtractionError extends Error {
  readonly source: string;
  readonly fetched: number;

  constructor(source: string, fetched: number) {
    super(
      `${source}: fetched ${fetched} document(s) and extracted 0 meeting(s), ` +
        "with no drop recorded to account for one — a zero-row extraction is a " +
        "failed extraction, never an empty calendar (RULING 43)",
    );
    this.name = "ZeroRowExtractionError";
    this.source = source;
    this.fetched = fetched;
  }
}

/**
 * Brand a normalize result, or refuse to.
 *
 * @param source The adapter's own `name`, so the refusal names who refused.
 * @param input  The raw rows the pass was given. Only its length is read.
 * @param result What the pass produced.
 */
export function accountedNormalize<R extends NormalizeAccountInput>(
  source: string,
  input: readonly unknown[],
  result: R,
  options: {
    /**
     * How many of `input` were never RETRIEVED — a refused row that reached
     * normalize carrying an empty body rather than a document.
     *
     * The invariant is *documents in hand, nothing out, nothing dropped*, and
     * a refusal is not a document in hand. Without this the contract fires on
     * the honest case it was never about: `ical` builds one raw row per wiring
     * row, so a town refusing the whole feed arrives as ten rows, zero
     * meetings and zero drops — a WALL, correctly reported as unreachable by
     * the adapter, and the factory would have called it a broken parser. Found
     * the day the contract shipped, against the Town of Newbury's own
     * calendar, which is exactly the sort of thing a contract is supposed to
     * be tried against before it is trusted.
     */
    unretrieved?: number;
    /**
     * Events the pass PLACED IN TIME and then set aside as outside the served
     * window (NH Hunt 3, 2026-08-21).
     *
     * The sibling of `unretrieved`, and it closes the same hole from the other
     * end. The invariant is *documents in hand, nothing out, nothing dropped*,
     * and an event correctly parsed, correctly dated, and correctly judged to
     * fall outside the 60-days-forward / 90-days-back window is none of those
     * three — it is the pass working. A town whose calendar genuinely holds no
     * sitting in the next sixty days is an honest empty result and must not
     * turn a nightly refresh red; that would be the WALL-versus-JOB confusion
     * RULING 12 names, pointed at ourselves.
     *
     * It is a COUNT rather than a boolean so the window filter has to say how
     * many it took, which is what keeps it from becoming a blanket excuse: a
     * pass that sets aside nothing cannot claim this exemption.
     */
    outOfWindow?: number;
    /**
     * How many LOGICAL RECORDS this pass considered — A-002.
     *
     * Candidate events, agenda rows, calendar entries: the thing that either
     * becomes a meeting or does not. NOT documents. Omit it only when the pass
     * genuinely cannot count them, in which case the result records
     * `COULD_NOT_ASSERT` and says so rather than passing quietly.
     */
    logicalInput?: number | null;
    /**
     * Records skipped because the same logical record had already been seen.
     *
     * A duplicate is neither produced nor dropped, so before A-002 it was a
     * `continue` that left no trace at all — which is also how A-005's
     * same-night collisions disappeared uncounted.
     */
    duplicates?: number;
    /**
     * Counters that TALLIED a record which was nevertheless PRODUCED.
     *
     * `NormalizeDropCounts.placeless` is the live case and it is mis-modelled:
     * in `boardbook`, `civicplus` and `diligent` it is incremented for an
     * online-only meeting that is then pushed as a meeting (D18 keeps those on
     * purpose), while in `iqm2` the same counter is a real drop with a
     * `continue` behind it. So the same field name means two different things
     * across the adapters that share its type.
     *
     * Conservation cannot be computed without knowing which, so the adapter
     * says. This is a NAMED, DECLARED subtraction rather than a special case
     * hidden in the sum — tracker row `AUD-PLACELESS` proposes moving the tally
     * out of `NormalizeDropCounts` entirely, which is the real fix and is a
     * change to twelve adapters' reporting shape rather than to their
     * arithmetic.
     */
    countedButProduced?: number;
  } = {},
): Accounted<R> {
  const dropped = totalDropped(result.drops) - (options.countedButProduced ?? 0);
  const outOfWindow = options.outOfWindow ?? 0;
  const unretrieved = options.unretrieved ?? 0;
  const duplicates = options.duplicates ?? 0;

  /*
   * RULING 43's zero-row question, at the DOCUMENT layer, unchanged. It asks
   * whether we held bytes and produced nothing from them; that is a different
   * question from conservation and neither one subsumes the other.
   */
  const documentsInHand = input.length - unretrieved;
  if (isZeroRowExtraction({ documentsInHand, produced: result.meetings.length, dropped, outOfWindow })) {
    throw new ZeroRowExtractionError(source, documentsInHand);
  }

  /*
   * A-002's conservation question, at the LOGICAL-RECORD layer. It throws a
   * `ConservationError`, which the composite's existing catch routes to `JOB`
   * with no new branch — our arithmetic, on bytes we already hold, is our bug.
   */
  const accounting = conserve(source, {
    logicalInput: options.logicalInput ?? null,
    produced: result.meetings.length,
    dropped,
    outOfWindow,
    duplicates,
    unretrieved,
  });

  return Object.assign(result, { [ACCOUNTED]: true as const, accounting });
}
