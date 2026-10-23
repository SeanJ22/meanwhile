import { execFile, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { cannotRun, extracted, zeroRows } from "./types.ts";
import type { ExtractResult } from "./types.ts";

/**
 * Layer 3: OCR for scanned PDFs, through a local `tesseract` binary (pages
 * rendered first with `pdftoppm`). No OCR engine is bundled; the deploy never
 * OCRs. With no engine present this returns `CANNOT_RUN`, never "no text":
 * nobody looked is not the same as nothing there. `opts.engine` injects
 * another engine.
 */

export interface OcrPage {
  page: number;
  text: string;
}

export interface OcrOptions {
  /** Override the binary. Default `tesseract`, resolved on PATH. */
  binary?: string;
  /** Poppler's local PDF-to-image converter. Default `pdftoppm` on PATH. */
  rasterizer?: string;
  /** Local process boundary, injectable for deterministic failure tests. */
  execute?: (binary: string, args: readonly string[]) => void | Promise<void>;
  /** Wall-time allowance for conversion and all pages together. */
  timeoutMs?: number;
  /**
   * A whole-engine override: given the PDF bytes, return one string per page.
   * Injected by tests, and the seam for a session with a better engine.
   */
  engine?: (bytes: Uint8Array) => Promise<string[]>;
  /** Language pack. Default `eng`. */
  language?: string;
}

/** Is a usable engine on PATH? Answered once, honestly, before any work. */
export function ocrEngineAvailable(binary = process.env.WTP_OCR_BINARY ?? "tesseract"): boolean {
  const probe = spawnSync(binary, ["--version"], { encoding: "utf8", timeout: 10_000, windowsHide: true });
  return probe.status === 0;
}

const MIN_PAGE_CHARS = 2;
const executeFile = promisify(execFile);

export async function runOcr(
  bytes: Uint8Array,
  source: string,
  opts: OcrOptions = {},
): Promise<ExtractResult<OcrPage>> {
  if (bytes.length === 0) {
    return cannotRun("OCR", source, "the input is zero bytes — nothing was fetched");
  }

  let pageTexts: string[];

  if (opts.engine) {
    pageTexts = await opts.engine(bytes);
  } else {
    const binary = opts.binary ?? process.env.WTP_OCR_BINARY ?? "tesseract";
    if (!ocrEngineAvailable(binary)) {
      /* The missing engine is a wall, never "the document has no text". */
      return cannotRun(
        "OCR",
        source,
        `no OCR engine: \`${binary}\` is not on PATH. This is NOT a finding that the ` +
          "document is empty — nobody has looked at it yet. Install Tesseract " +
          "(`winget install UB-Mannheim.TesseractOCR`, `brew install tesseract`, " +
          "`apt-get install tesseract-ocr`) and re-run, or pass an engine through " +
          "`opts.engine`.",
        { inputBytes: bytes.length },
      );
    }

    const deadline = Date.now() + (opts.timeoutMs ?? 60_000);
    const execute = opts.execute ?? (async (command: string, args: readonly string[]) => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("document OCR time allowance exhausted");
      // Each source already has its own worker. Tesseract's OpenMP threads
      // contend across those workers and can turn a small scan into a timeout.
      await executeFile(command, [...args], { encoding: "utf8", timeout: remaining, windowsHide: true,
        env: { ...process.env, OMP_THREAD_LIMIT: process.env.OMP_THREAD_LIMIT ?? "1" } });
    });
    const dir = mkdtempSync(join(tmpdir(), "wtp-ocr-"));
    let step = "PDF rasterisation";
    try {
      const pdf = join(dir, "in.pdf");
      writeFileSync(pdf, bytes);
      // Tesseract cannot read PDF input. Render every page first; a failed
      // conversion or missing page refuses the document, never an empty success.
      await execute(opts.rasterizer ?? process.env.WTP_PDF_RASTERIZER ?? "pdftoppm", ["-r", "300", "-png", pdf, join(dir, "page")]);
      const images = readdirSync(dir).map(name => ({ name, page: /^page-(\d+)\.png$/.exec(name)?.[1] }))
        .filter((row): row is { name: string; page: string } => row.page !== undefined)
        .sort((a, b) => Number(a.page) - Number(b.page));
      if (!images.length || images.some((row, i) => Number(row.page) !== i + 1)) throw new Error("converter produced no complete consecutive page sequence");
      pageTexts = [];
      for (const image of images) {
        step = `OCR page ${Number(image.page)}`;
        const out = join(dir, `text-${image.page}`);
        await execute(binary, [join(dir, image.name), out, "-l", opts.language ?? "eng", "txt"]);
        pageTexts.push(readFileSync(`${out}.txt`, "utf8"));
      }
    } catch (error) {
      return cannotRun(
        "OCR",
        source,
        `${step} failed: ${(error as Error).message.slice(0, 300)}. ` +
          "Check the local Poppler (pdftoppm) and Tesseract installations and the fetched PDF. " +
          "This is not a finding that the publisher supplied no text.",
        { inputBytes: bytes.length },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const pages: OcrPage[] = [];
  let pagesEmpty = 0;
  pageTexts.forEach((text, i) => {
    const clean = text.replace(/[ \t]+/g, " ").trim();
    if (clean.length >= MIN_PAGE_CHARS) pages.push({ page: i + 1, text: clean });
    else pagesEmpty += 1;
  });

  const counts = { pages: pageTexts.length, pagesWithText: pages.length, pagesEmpty };

  if (pages.length === 0) {
    return zeroRows(
      "OCR",
      source,
      bytes.length,
      `the engine ran over ${pageTexts.length} page(s) and recognised no text. That is ` +
        "a finding about THIS ENGINE on THIS DOCUMENT — a low-resolution scan, a " +
        "rotated page, or the wrong language pack all produce it. Try a higher DPI " +
        "rasterisation or the right `-l` before recording anything about what the " +
        "body published.",
      counts,
    );
  }

  return extracted("OCR", source, bytes.length, pages, counts);
}
