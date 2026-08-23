/**
 * THE EXTRACTION TOOLKIT — the shared contract (F11, Prompt C item 12,
 * 2026-08-20).
 *
 * ## Why every layer returns the same shape
 *
 * **A ZERO-ROW EXTRACTION IS A FAILED EXTRACTION, NEVER AN EMPTY DOCUMENT.**
 * That is now law in `CLAUDE.md`, and it exists because the same shape has
 * been sighted five times in this repo: an empty RSS feed recorded as working,
 * a zero-match join presented as a clean build, a scripted edit that edited
 * nothing and exited 0, a portal returning 200 with zero meetings recorded as
 * a HIT, and — the one that changed F11's scope — an Apptegy page whose
 * rendered prose was read successfully and never contained the byline the
 * fetch was for.
 *
 * A parser that returns nothing has told you about ITSELF, not about the
 * document. So no layer here returns a bare string. Every one returns this,
 * carrying what it was given, what it produced, and — when it produced nothing
 * — WHY, in a form a caller has to handle rather than a falsy value a caller
 * can drop on the floor.
 *
 * ## The four layers, and why they are one toolkit
 *
 *   1. TEXT LAYER — born-digital PDFs. `lib/extract/text-layer.ts`
 *   2. TABLES — agenda and budget grids. `lib/extract/tables.ts`
 *   3. OCR — scanned PDFs. `lib/extract/ocr.ts`
 *   4. EMBEDDED PAYLOAD — CMS pages that ship their content as escaped JSON
 *      inside the HTML. `lib/extract/embedded-payload.ts`
 *   5. ROSTER TABLE — who sits on a board, off the body's own page.
 *      `lib/extract/roster-table.ts` (NH Hunt, 2026-08-20)
 *
 * The fourth is why F11 is no longer PDF-specific. Vail's superintendent was
 * missed because Apptegy ships page content as an escaped JSON payload inside
 * a `<script>` tag: the fetch worked, discovery worked, and extraction failed
 * on rendered prose that never contained the byline. That is not a PDF
 * problem. The class size is bounded — two bodies on Apptegy — but the failure
 * mode is not, and it is invisible from every layer above it.
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
  /**
   * The layer could not run at all — a missing engine, an unreadable file, an
   * unsupported shape. Reported separately from ZERO_ROWS on purpose: "I
   * looked and found nothing" and "I could not look" are different facts, and
   * a surface that rendered them alike would be the render-default defect.
   */
  | "CANNOT_RUN"
  /**
   * The layer ran, produced rows, and produced FEWER than the source itself
   * states are there. **RULING 100, 2026-08-23** — a partial extraction that
   * reconciles.
   *
   * The row count is non-zero, so `ZERO_ROWS` cannot see it and neither can
   * any caller that only asks whether something came back. It is a FAILED
   * extraction. `items` still carries what was found — throwing the rows away
   * would destroy evidence — but the outcome says the document was not read.
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
   * **What the SOURCE says is there, against what came back** — RULING 100.
   *
   * Never optional and never absent. A layer that cannot read a stated count
   * out of its document returns `NOT_ASSERTABLE` and names what it looked at,
   * which is a reportable state rather than a silent pass. Making the field
   * REQUIRED is the whole mechanism: a new layer cannot be written without
   * answering the question, and the answer "I could not ask" is legal while
   * the answer "I did not consider it" is not expressible.
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
   * **What the source states, and how it was read** — RULING 100.
   *
   * A `StatedCount` turns this into a checked extraction. The string form is
   * the honest other half: it names what was looked at when nothing stated a
   * count, and it is what a layer passes when its document simply does not
   * carry a denominator. There is no third option and no default that means
   * "did not consider" — omitting the argument produces the generic
   * `NOT_ASSERTABLE`, which still shows up in the census as unchecked.
   */
  stated: StatedCount | string | null = null,
): ExtractResult<T> {
  /*
   * The refusal is INSIDE the constructor, so a layer cannot report success
   * with an empty list even by accident. This is the rule as code rather than
   * as a convention every caller has to remember.
   */
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

  /*
   * **The downgrade, and it is the whole ruling.** A non-zero row count that
   * falls short of the document's own number is not a success with a caveat;
   * it is a failed extraction whose failure happens to be invisible to every
   * instrument that asks "did anything come back".
   */
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
  // The assertion is printed on EVERY line, including NOT_ASSERTABLE. A
  // census of what could not be checked is the half of RULING 100 that a
  // report would otherwise never see.
  return [head, assertionLine(r.count), counts, r.reason ? `— ${r.reason}` : ""]
    .filter(Boolean)
    .join("  ");
}

/**
 * **Did this extraction get what the document says is there?**
 *
 * `EXTRACTED` alone is not the question — a `PARTIAL` carries rows too. Call
 * sites that used to test `outcome === "EXTRACTED"` should test this, and
 * `tests/count-assertion.test.ts` pins the distinction.
 */
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
