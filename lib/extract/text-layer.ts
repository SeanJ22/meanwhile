import { cannotRun, extracted, zeroRows } from "./types.ts";
import type { ExtractResult } from "./types.ts";

/**
 * LAYER 1 — the text layer of a born-digital PDF (F11, Prompt C item 12).
 *
 * `lib/meetings/agenda-documents.ts` already had `extractPdfText`, which
 * returns a string. This is that engine under the toolkit's contract, and the
 * difference is the whole point: a string cannot distinguish "this PDF has no
 * text layer, it is a scan, send it to OCR" from "this PDF says nothing".
 * A caller holding `""` has to guess, and the guess that costs is the one that
 * records a scanned document as a document that published nothing.
 *
 * PDFS ARE DATA. `CLAUDE.md`'s ladder rung 9: text-layer extraction first, OCR
 * when scanned. "Paper-only" and "not machine-readable" are honest ONLY when
 * the document does not exist online — never when a PDF is sitting on the
 * body's site unparsed.
 *
 * ## The interface
 *
 *   extractTextLayer(bytes, source) -> ExtractResult<PdfPage>
 *
 * One item per page that produced text. A page with no text contributes no
 * item and is counted in `counts.pagesEmpty`, so a mostly-scanned document
 * reports as a mostly-scanned document rather than as a short one.
 */

export interface PdfPage {
  page: number;
  text: string;
}

/** How little text a page can hold before it is treated as no text at all. */
const MIN_PAGE_CHARS = 2;

export async function extractTextLayer(
  bytes: Uint8Array,
  source: string,
): Promise<ExtractResult<PdfPage>> {
  if (bytes.length === 0) {
    return cannotRun("TEXT_LAYER", source, "the input is zero bytes — nothing was fetched");
  }

  // `%PDF` — checked before the engine, so a fetched HTML error page reports
  // as the wrong TYPE rather than as a PDF that says nothing. That distinction
  // is exactly the F20 shape: a challenge page served at 200 and parsed
  // successfully into an empty document.
  const magic = new TextDecoder("latin1").decode(bytes.slice(0, 5));
  if (!magic.startsWith("%PDF")) {
    return cannotRun(
      "TEXT_LAYER",
      source,
      `the input does not begin with %PDF (saw ${JSON.stringify(magic)}) — this is ` +
        "not a PDF, and reading it as one would report a document that says nothing",
      { inputBytes: bytes.length },
    );
  }

  let doc;
  try {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    doc = await getDocument({ data: bytes, useWorkerFetch: false }).promise;
  } catch (error) {
    return cannotRun(
      "TEXT_LAYER",
      source,
      `the PDF engine refused the file: ${(error as Error).message}`,
      { inputBytes: bytes.length },
    );
  }

  const pages: PdfPage[] = [];
  let pagesEmpty = 0;
  try {
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item: unknown) =>
          item && typeof item === "object" && "str" in item ? String(item.str) : "",
        )
        .join(" ")
        .replace(/[ \t]+/g, " ")
        .trim();
      if (text.length >= MIN_PAGE_CHARS) pages.push({ page: i, text });
      else pagesEmpty += 1;
    }
  } finally {
    await doc.cleanup();
  }

  const counts = { pages: doc.numPages, pagesWithText: pages.length, pagesEmpty };

  if (pages.length === 0) {
    /*
     * THE ANSWER THAT MATTERS, and the reason this layer returns a result
     * rather than a string: every page rendered and none carried text. That is
     * a SCAN, and the next rung is OCR — not a finding that the body published
     * an empty document.
     */
    return zeroRows(
      "TEXT_LAYER",
      source,
      bytes.length,
      `all ${doc.numPages} page(s) rendered and none carried a text layer — this is ` +
        "a scanned PDF. The next rung is OCR (lib/extract/ocr.ts), NOT a finding " +
        "that the document is empty.",
      counts,
    );
  }

  return extracted("TEXT_LAYER", source, bytes.length, pages, counts);
}
