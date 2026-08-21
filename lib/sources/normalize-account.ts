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
 * ## What it deliberately does NOT require
 *
 * Full accounting — `meetings + drops === input` — is not the rule, because it
 * is false of honest adapters: one `.ics` document is one raw row and twenty
 * meetings, one schedule page is one raw row and nine sittings. The invariant
 * is narrower and exactly matches the defect: **documents in hand, nothing out,
 * and nothing dropped.** A source that fetched and dropped everything has
 * already said why, and is left alone. A source that fetched nothing has an
 * empty upstream, which the fetch layer is the right place to judge.
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
export type Accounted<R> = R & { readonly [ACCOUNTED]: true };

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
  } = {},
): Accounted<R> {
  const counters = result.drops as Readonly<Record<string, number>>;
  const droppedAny = Object.values(counters).some((n) => n > 0);
  const inHand = input.length - (options.unretrieved ?? 0);
  if (inHand > 0 && result.meetings.length === 0 && !droppedAny) {
    throw new ZeroRowExtractionError(source, inHand);
  }
  return Object.assign(result, { [ACCOUNTED]: true as const });
}
