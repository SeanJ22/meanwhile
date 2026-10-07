import type { Meeting } from "./types.ts";

/**
 * Branded normalize results. A source that fetched documents and normalized
 * none of them, with nothing dropped, has reported on its parser rather than
 * on the body's calendar. `normalizeWithDrops` must return an `Accounted<...>`,
 * which only `accountedNormalize()` can build, and that factory throws on the
 * zero-row shape. The composite routes the throw to `JOB`.
 *
 * `ACCOUNTED` is exported because the type must name it; adapters must never
 * attach it by hand.
 */

/** A real runtime symbol, so a structural type check cannot forge one by accident. */
export const ACCOUNTED: unique symbol = Symbol.for("wtp.normalize.accounted");

/** A normalize result that went through {@link accountedNormalize}. */
export type Accounted<R> = R & {
  readonly [ACCOUNTED]: true;
  /** What the conservation check was given and what it concluded. */
  readonly accounting: ConservationRecord;
};

/**
 * Conservation at the LOGICAL-RECORD layer (candidate events, agenda rows,
 * calendar entries — not documents). Every record considered has exactly one
 * disposition:
 *
 *     produced + dropped + outOfWindow + duplicates === logicalInput
 *
 * `unretrieved` is not a term: a refused feed is a document that never
 * arrived and contributes no logical records. A pass that cannot count its
 * records reports `COULD_NOT_ASSERT`, never a silent pass.
 */
export interface ConservationTerms {
  /** Logical records the pass considered, or `null` when it genuinely cannot say. */
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

/** Thrown when the dispositions do not sum to the records considered; names every term. */
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

/** Checks the invariant, or records that it could not be checked. */
export function conserve(source: string, terms: ConservationTerms): ConservationRecord {
  const { logicalInput, produced, dropped, outOfWindow, duplicates, unretrieved } = terms;

  // Bounds first: a negative or fractional counter is a caller bug, not a conservation failure.
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

/** Sums a drop-counter object. */
export function totalDropped(counters: object): number {
  let total = 0;
  for (const n of Object.values(counters as Record<string, unknown>)) {
    if (typeof n === "number") total += n;
  }
  return total;
}

/** Documents in hand, nothing out, nothing dropped. */
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
 * An adapter's normalize result before branding. `drops` is loose on purpose;
 * the precise shape is pinned on `ReportingMeetingSource.normalizeWithDrops`.
 */
export interface NormalizeAccountInput {
  meetings: Meeting[];
  drops: object;
  unreachableOcdIds?: string[];
}

/** Thrown when an adapter tries to report a zero-row extraction as a result. */
export class ZeroRowExtractionError extends Error {
  readonly source: string;
  readonly fetched: number;

  constructor(source: string, fetched: number) {
    super(
      `${source}: fetched ${fetched} document(s) and extracted 0 meeting(s), ` +
        "with no drop recorded to account for one — a zero-row extraction is a " +
        "failed extraction, never an empty calendar",
    );
    this.name = "ZeroRowExtractionError";
    this.source = source;
    this.fetched = fetched;
  }
}

/**
 * Brands a normalize result, or refuses to.
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
    /** Rows that reached normalize with an empty body (a refused fetch), not a document in hand. */
    unretrieved?: number;
    /**
     * Events correctly placed in time and set aside as outside the served
     * window. A count, so a pass that sets aside nothing cannot claim it.
     */
    outOfWindow?: number;
    /** Logical records considered, not documents. Omit only when the pass genuinely cannot count them. */
    logicalInput?: number | null;
    /** Records skipped because the same logical record was already seen. */
    duplicates?: number;
    /**
     * Drop counters that tallied a record which was nevertheless produced
     * (`placeless` counts online-only meetings that are kept in some adapters).
     */
    countedButProduced?: number;
  } = {},
): Accounted<R> {
  const dropped = totalDropped(result.drops) - (options.countedButProduced ?? 0);
  const outOfWindow = options.outOfWindow ?? 0;
  const unretrieved = options.unretrieved ?? 0;
  const duplicates = options.duplicates ?? 0;

  // Zero-row check, at the document layer.
  const documentsInHand = input.length - unretrieved;
  if (isZeroRowExtraction({ documentsInHand, produced: result.meetings.length, dropped, outOfWindow })) {
    throw new ZeroRowExtractionError(source, documentsInHand);
  }

  // Conservation, at the logical-record layer. A ConservationError goes to `JOB`.
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
