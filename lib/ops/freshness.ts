/** A freshness date is written only by the code path that performed the read; a run date is a different type. */

/** An ISO day, `YYYY-MM-DD`. */
export type IsoDay = string;

declare const READ_BRAND: unique symbol;
declare const RUN_BRAND: unique symbol;

/** A date answering how current this data is: a claim about a read that happened. */
export type ReadStamp = IsoDay & { readonly [READ_BRAND]: true };

/** A date answering when this program ran; clock-derived, and a different type from {@link ReadStamp}. */
export type RunStamp = IsoDay & { readonly [RUN_BRAND]: true };

/** The sentinel for "no read is evidenced"; a real value so it survives serialization, and always read as stale. */
export const NEVER_READ = "UNKNOWN" as const;
export type NeverRead = typeof NEVER_READ;

/** Evidence that a read happened; `bytes: 0` cannot mint a stamp. */
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

/** Mint a freshness date from a read, or {@link NEVER_READ}; it never throws and never substitutes today. */
export function stampFromRead(receipt: ReadReceipt): ReadStamp | NeverRead {
  if (!receipt.ok) return NEVER_READ;
  if (!Number.isFinite(receipt.bytes) || receipt.bytes <= 0) return NEVER_READ;
  if (!ISO_DAY.test(receipt.on)) return NEVER_READ;
  return receipt.on as ReadStamp;
}

/** The day this program ran, in `America/Phoenix`, typed so it cannot be written into a freshness field. */
export function runStamp(now: Date = new Date()): RunStamp {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now) as RunStamp;
}
