/**
 * **A FRESHNESS DATE IS WRITTEN ONLY BY THE CODE PATH THAT PERFORMED THE
 * READ** — RULING 107, 2026-08-23.
 *
 * ## The defect, caught in the act
 *
 * `NH80` recorded a fear: that re-running `pnpm congress:migrate` would
 * restamp a `collectedAt` of 2026-08-16 without re-reading the data, so the
 * artifact was deliberately left un-regenerated. **The fear was half right and
 * the half it got wrong is the interesting half.**
 *
 * Regenerated on 2026-08-23 against the committed snapshot,
 * `lib/officials/directory-source.ts` came back **byte-identical**: its
 * `collectedAt` is propagated from `snapshot.source.collectedAt`, which is the
 * date the data was genuinely read. That generator was already honest.
 *
 * What DID move was `docs/congress-legislators-diff.md`, whose header went
 * from `Generated 2026-08-16` to `Generated 2026-08-23` **with nothing read**.
 * A clock call produced a date; the date sat at the top of a document; and
 * anything scanning that document for currency would read the data as one day
 * old when the read behind it was a week old.
 *
 * ## Why this is worse than an absent date
 *
 * RULING 96 makes last-walked dates the instrument that decides whether a
 * source is re-walked, and RULING 53 says a record that cannot say when it was
 * measured reads as STALE rather than fresh. A stamp that updates without a
 * read defeats both: it does not merely fail to help, **it suppresses the
 * re-walk that would have caught the staleness.** `UNKNOWN` sends a session
 * back to the source. A confident wrong date does not.
 *
 * ## The shape of the fix
 *
 * Two kinds of date, named apart, and the type system refuses to confuse them:
 *
 * - A **{@link ReadStamp}** answers *how current is this DATA*. It is mintable
 *   only from a {@link ReadReceipt} — evidence that a read happened and
 *   returned something — or {@link carried} forward from a prior read, which
 *   is what propagation is and is honest because the date still names the day
 *   somebody actually looked.
 * - A **{@link RunStamp}** answers *when did this PROGRAM run*. It comes from
 *   the clock, which is correct, and it may never be written into a freshness
 *   field.
 *
 * Both are branded strings, so `collectedAt: runStamp()` does not type-check.
 * The guard in `tests/freshness-provenance.test.ts` catches the same mistake
 * written in plain strings, which is how every existing instance is written.
 *
 * ## What this deliberately does NOT do
 *
 * It does not invent a date, ever, and there is no `--today` escape. Where no
 * read is evidenced the answer is {@link NEVER_READ}, which renders as stale.
 * `scripts/sources-freshness.mts` made the same choice for `docs/sources.md`
 * for the same reason, and this is that reasoning applied one layer down — to
 * the generators that WRITE the dates rather than the register that holds them.
 */

/** An ISO day, `YYYY-MM-DD`. */
export type IsoDay = string;

declare const READ_BRAND: unique symbol;
declare const RUN_BRAND: unique symbol;

/**
 * A date that answers *how current is this data*, and is therefore a claim
 * about a read that actually happened.
 */
export type ReadStamp = IsoDay & { readonly [READ_BRAND]: true };

/**
 * A date that answers *when did this program run*. Clock-derived and honest as
 * such. It is a different type from {@link ReadStamp} on purpose.
 */
export type RunStamp = IsoDay & { readonly [RUN_BRAND]: true };

/**
 * The sentinel for "no read is evidenced". It is a real value rather than
 * `null` so it survives serialization into an artifact and stays legible to a
 * reader, and it reads as STALE everywhere under RULING 53.
 */
export const NEVER_READ = "UNKNOWN" as const;
export type NeverRead = typeof NEVER_READ;

/**
 * Evidence that a read happened.
 *
 * `bytes` is required and is the reason this is not ceremony: a fetch that
 * returned nothing is not a read, and the zero-row-extraction rule already
 * says a layer that came back empty has told you about itself rather than
 * about the document. A receipt with `bytes: 0` cannot mint a stamp.
 */
export interface ReadReceipt {
  /** What was read — a URL, or a repo-relative path for a committed input. */
  readonly source: string;
  /** Whether the read succeeded. A refusal is not a read. */
  readonly ok: boolean;
  /** How much came back. Zero is a failed read, not an empty document. */
  readonly bytes: number;
  /** The day the read happened, `YYYY-MM-DD`. */
  readonly on: IsoDay;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Mint a freshness date FROM A READ.
 *
 * Returns {@link NEVER_READ} when the receipt does not evidence one — a
 * refusal, an empty body, or a malformed date. It never throws and it never
 * substitutes today, because both of those are how a caller ends up with a
 * plausible date instead of a true one.
 */
export function stampFromRead(receipt: ReadReceipt): ReadStamp | NeverRead {
  if (!receipt.ok) return NEVER_READ;
  if (!Number.isFinite(receipt.bytes) || receipt.bytes <= 0) return NEVER_READ;
  if (!ISO_DAY.test(receipt.on)) return NEVER_READ;
  return receipt.on as ReadStamp;
}

/**
 * Carry a freshness date forward from a prior read.
 *
 * This is what propagation is, and it is the honest operation: the date still
 * names the day somebody actually looked at the source. It is what
 * `congress:migrate` already does correctly with `snapshot.source.collectedAt`.
 *
 * `why` is required so a carried date arrives with the reason attached — a
 * carry with no stated basis is indistinguishable from a guess at the call
 * site, and the meetings carry-forward rule already learned that lesson.
 */
export function carried(prior: string | null | undefined, why: string): ReadStamp | NeverRead {
  if (why.trim().length === 0) return NEVER_READ;
  if (typeof prior !== "string" || !ISO_DAY.test(prior)) return NEVER_READ;
  return prior as ReadStamp;
}

/**
 * The day this program ran. Clock-derived, `America/Phoenix`, and typed so it
 * cannot be written into a freshness field.
 *
 * The timezone matches `scripts/stamp.mts` and `scripts/doc-dates.mjs`
 * deliberately: a UTC read after 5pm local is a day ahead, which is the same
 * fabrication wearing a smaller hat.
 */
export function runStamp(now: Date = new Date()): RunStamp {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now) as RunStamp;
}

/**
 * How a run date is allowed to appear in a generated document.
 *
 * The wording is the point. `Generated 2026-08-23` invites a reader — human or
 * script — to treat it as data currency. This says what the date is a fact
 * about, and states the read date beside it when one is known, so the two can
 * never be read as one number.
 */
export function provenanceLine(
  command: string,
  ran: RunStamp,
  read: ReadStamp | NeverRead,
): string {
  const readPart =
    read === NEVER_READ
      ? "No read date is recorded for the data below, so it reads as stale."
      : `The data below was read ${read}.`;
  return `Written by \`${command}\` on a run of ${ran} — that is when the program ran, not when the data was read. ${readPart}`;
}

/**
 * The field names this project uses for a freshness date.
 *
 * Exported so the guard and any future caller read the SAME list. Two copies
 * of one register is how five scripts came to be unaccounted for in the
 * browser census, and `lib/ops/generated-register.ts` says so in its own
 * header for the same reason.
 */
export const FRESHNESS_FIELDS = [
  "collectedAt",
  "verifiedAt",
  "attemptedAt",
  "fetchedAt",
  "retrievedAt",
  "readOn",
  "lastWalked",
  "observedAt",
  "checkedOn",
  "testedOn",
] as const;

export type FreshnessField = (typeof FRESHNESS_FIELDS)[number];

/**
 * Expressions that produce a date from the CLOCK rather than from a read.
 *
 * A freshness field assigned from one of these is the defect this ruling
 * names, whatever the surrounding code looks like.
 */
export const CLOCK_EXPRESSIONS = [
  "stamp()",
  "today()",
  "runStamp()",
  "new Date()",
  "Date.now()",
  "toISOString()",
] as const;
