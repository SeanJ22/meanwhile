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

/** Carry a freshness date forward from a prior read; `why` is required. */
export function carried(prior: string | null | undefined, why: string): ReadStamp | NeverRead {
  if (why.trim().length === 0) return NEVER_READ;
  if (typeof prior !== "string" || !ISO_DAY.test(prior)) return NEVER_READ;
  return prior as ReadStamp;
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

/** How a run date may appear in a generated document: worded so it is never read as data currency. */
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

/** The field names this project uses for a freshness date, one list for every caller. */
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

/** Expressions that produce a date from the clock rather than from a read. */
export const CLOCK_EXPRESSIONS = [
  "stamp()",
  "today()",
  "runStamp()",
  "new Date()",
  "Date.now()",
  "toISOString()",
] as const;
