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
  | "CANNOT_RUN";

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
}

export function extracted<T>(
  layer: ExtractResult<T>["layer"],
  source: string,
  inputBytes: number,
  items: T[],
  counts: Record<string, number> = {},
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
  };
}

export function zeroRows<T>(
  layer: ExtractResult<T>["layer"],
  source: string,
  inputBytes: number,
  reason: string,
  counts: Record<string, number> = {},
): ExtractResult<T> {
  return { layer, outcome: "ZERO_ROWS", items: [], rows: 0, inputBytes, reason, source, counts };
}

export function cannotRun<T>(
  layer: ExtractResult<T>["layer"],
  source: string,
  reason: string,
  counts: Record<string, number> = {},
): ExtractResult<T> {
  return { layer, outcome: "CANNOT_RUN", items: [], rows: 0, inputBytes: 0, reason, source, counts };
}

/** One line of a report, in the form every adapter already reports counts. */
export function describe<T>(r: ExtractResult<T>): string {
  const counts = Object.entries(r.counts)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  const head = `${r.layer} ${r.outcome} rows=${r.rows} bytes=${r.inputBytes}`;
  return [head, counts, r.reason ? `— ${r.reason}` : ""].filter(Boolean).join("  ");
}
