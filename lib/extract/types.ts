/**
 * The extraction toolkit's shared result contract. A zero-row extraction is a
 * failed extraction, never an empty document, so no layer returns a bare
 * string: each returns what it was given, what it produced and, when nothing,
 * why.
 *
 *   1. TEXT LAYER: born-digital PDFs (`text-layer.ts`)
 *   2. TABLES: agenda and budget grids (`tables.ts`)
 *   3. OCR: scanned PDFs (`ocr.ts`)
 *   4. EMBEDDED PAYLOAD: CMS content shipped as JSON in the HTML (`embedded-payload.ts`)
 *   5. ROSTER TABLE: who sits on a board, off the body's own page (`roster-table.ts`)
 */

import {
  assertCount,
  assertionLine,
  notAssertable,
  type CountAssertion,
  type StatedCount,
} from "./count-assertion.ts";

export type { CountAssertion } from "./count-assertion.ts";

/** What an extraction did, whether or not it produced anything. */
export type ExtractOutcome =
  /** Rows were produced. `rows > 0` is guaranteed. */
  | "EXTRACTED"
  /**
   * The layer ran to completion and produced NOTHING. A finding about this
   * layer against this document, never a statement that the document is empty.
   */
  | "ZERO_ROWS"
  /** The layer could not run at all. "Could not look" is not "found nothing". */
  | "CANNOT_RUN"
  /**
   * The layer produced rows, but fewer than the source states are there. A
   * failed extraction; `items` still carries what was found.
   */
  | "PARTIAL";

export interface ExtractResult<T> {
  layer: "TEXT_LAYER" | "TABLES" | "OCR" | "EMBEDDED_PAYLOAD" | "ROSTER_TABLE";
  outcome: ExtractOutcome;
  /** What was extracted. Empty for every outcome except EXTRACTED. */
  items: T[];
  /** `items.length`, stated rather than left for the caller to compute. */
  rows: number;
  /** The size of the input, so a caller can see what was actually examined. */
  inputBytes: number;
  /** Named on ZERO_ROWS and CANNOT_RUN. Empty string on EXTRACTED. */
  reason: string;
  /** What the layer looked at — a path, a URL, or a description. */
  source: string;
  /**
   * Free-form counts a layer wants on the record: pages read, scripts scanned,
   * candidate grids rejected. Always integers, always stated.
   */
  counts: Record<string, number>;
  /**
   * What the source says is there, against what came back. Required: a layer
   * that cannot read a stated count returns `NOT_ASSERTABLE`.
   */
  count: CountAssertion;
}

export function extracted<T>(
  layer: ExtractResult<T>["layer"],
  source: string,
  inputBytes: number,
  items: T[],
  counts: Record<string, number> = {},
  /**
   * What the source states: a `StatedCount` makes this a checked extraction;
   * a string names what was looked at when nothing stated a count.
   */
  stated: StatedCount | string | null = null,
): ExtractResult<T> {
  /* Refused inside the constructor, so no layer can report success with an empty list. */
  if (items.length === 0) {
    return {
      layer,
      outcome: "ZERO_ROWS",
      items: [],
      rows: 0,
      inputBytes,
      reason:
        "the layer ran to completion and produced no rows — a failed extraction, " +
        "not an empty document",
      source,
      counts,
      count: notAssertable(0, "the extraction produced nothing, so there is nothing to reconcile"),
    };
  }

  const count =
    stated !== null && typeof stated === "object"
      ? assertCount(items.length, stated.count, `${stated.shape}: “${stated.evidence}”`)
      : notAssertable(
          items.length,
          typeof stated === "string"
            ? stated
            : "this layer was given no stated count to check against",
        );

  /* Short of the document's own count is a failed extraction, not success with a caveat. */
  if (count.verdict === "SHORT") {
    return {
      layer,
      outcome: "PARTIAL",
      items,
      rows: items.length,
      inputBytes,
      reason: count.reason,
      source,
      counts,
      count,
    };
  }

  return {
    layer,
    outcome: "EXTRACTED",
    items,
    rows: items.length,
    inputBytes,
    reason: "",
    source,
    counts,
    count,
  };
}

export function zeroRows<T>(
  layer: ExtractResult<T>["layer"],
  source: string,
  inputBytes: number,
  reason: string,
  counts: Record<string, number> = {},
): ExtractResult<T> {
  return {
    layer,
    outcome: "ZERO_ROWS",
    items: [],
    rows: 0,
    inputBytes,
    reason,
    source,
    counts,
    count: notAssertable(0, "the extraction produced nothing, so there is nothing to reconcile"),
  };
}

export function cannotRun<T>(
  layer: ExtractResult<T>["layer"],
  source: string,
  reason: string,
  counts: Record<string, number> = {},
): ExtractResult<T> {
  return {
    layer,
    outcome: "CANNOT_RUN",
    items: [],
    rows: 0,
    inputBytes: 0,
    reason,
    source,
    counts,
    count: notAssertable(0, "the layer could not run, so nothing was read to reconcile against"),
  };
}

/** One line of a report, in the form every adapter already reports counts. */
export function describe<T>(r: ExtractResult<T>): string {
  const counts = Object.entries(r.counts)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  const head = `${r.layer} ${r.outcome} rows=${r.rows} bytes=${r.inputBytes}`;
  // The assertion is printed on every line, including NOT_ASSERTABLE.
  return [head, assertionLine(r.count), counts, r.reason ? `— ${r.reason}` : ""]
    .filter(Boolean)
    .join("  ");
}

/** Did this extraction get what the document says is there? A `PARTIAL` carries rows too. */
export function isComplete<T>(r: ExtractResult<T>): boolean {
  return r.outcome === "EXTRACTED";
}

/** The census a report prints: how many extractions could be checked at all. */
export function assertionCensus<T>(
  results: ReadonlyArray<ExtractResult<T>>,
): Record<CountAssertion["verdict"], number> {
  const census: Record<CountAssertion["verdict"], number> = {
    MATCHED: 0,
    SHORT: 0,
    OVER: 0,
    NOT_ASSERTABLE: 0,
  };
  for (const r of results) census[r.count.verdict] += 1;
  return census;
}
