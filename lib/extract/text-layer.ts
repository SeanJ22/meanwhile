import { cannotRun, extracted, zeroRows } from "./types.ts";
import type { ExtractResult } from "./types.ts";

/**
 * Layer 1: the text layer of a born-digital PDF, under the toolkit's result
 * contract so "no text layer, it is a scan" is distinguishable from "this PDF
 * says nothing". One item per page that produced text; empty pages are counted
 * in `counts.pagesEmpty`.
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

  // `%PDF` is checked first, so a fetched HTML error page reports as the wrong type, not an empty PDF.
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
  let loadingTask: ReturnType<(typeof import("pdfjs-dist/legacy/build/pdf.mjs"))["getDocument"]> | undefined;
  try {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    loadingTask = getDocument({ data: bytes, useWorkerFetch: false });
    doc = await loadingTask.promise;
  } catch (error) {
    await loadingTask?.destroy();
    return cannotRun(
      "TEXT_LAYER",
      source,
      `the PDF engine refused the file: ${(error as Error).message}`,
      { inputBytes: bytes.length },
    );
  }

  const pages: PdfPage[] = [];
  const numPages = doc.numPages;
  let pagesEmpty = 0;
  try {
    for (let i = 1; i <= numPages; i += 1) {
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
    await loadingTask!.destroy();
  }

  const counts = { pages: numPages, pagesWithText: pages.length, pagesEmpty };

  if (pages.length === 0) {
    /* Every page rendered and none carried text: a scan, for OCR, not an empty document. */
    return zeroRows(
      "TEXT_LAYER",
      source,
      bytes.length,
      `all ${numPages} page(s) rendered and none carried a text layer — this is ` +
        "a scanned PDF. The next rung is OCR (lib/extract/ocr.ts), NOT a finding " +
        "that the document is empty.",
      counts,
    );
  }

  return extracted("TEXT_LAYER", source, bytes.length, pages, counts);
}
