import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cannotRun, extracted, zeroRows } from "./types.ts";
import type { ExtractResult } from "./types.ts";

/**
 * LAYER 3 — OCR for scanned PDFs (F11, Prompt C item 12).
 *
 * ## Why the engine is not a dependency
 *
 * A scanned PDF is a picture of a public record, and `CLAUDE.md`'s ladder rung
 * 9 says OCR it: "paper-only" and "not machine-readable" are honest only when
 * the document does not exist online. So this layer exists.
 *
 * It shells out to a LOCAL `tesseract` binary rather than bundling an OCR
 * engine, and that is a decision rather than a shortcut. `tesseract.js` ships
 * a WASM build and language data measured in tens of megabytes; every one of
 * those bytes would join `package.json`, the lockfile, and the file-count
 * budget that already refused a build at 1138 traced files — to serve a code
 * path that runs in a hunt session and never in a request. The deploy does not
 * OCR anything.
 *
 * ## And the absence is a STATE, never an empty result
 *
 * When no engine is present this returns `CANNOT_RUN` naming the wall and the
 * install, and it NEVER returns "no text". Those are different facts: one says
 * the document has nothing on it, and the other says nobody looked. A scanned
 * agenda recorded as a document that published nothing is precisely the
 * "failed operation rendering as empty success" defect the toolkit exists to
 * refuse — and it would be a false claim about a public body.
 *
 * ## The interface
 *
 *   runOcr(bytes, source, opts?) -> ExtractResult<OcrPage>
 *
 * `opts.engine` injects a different engine for tests and for a session that
 * has something better than tesseract available.
 */

export interface OcrPage {
  page: number;
  text: string;
}

export interface OcrOptions {
  /** Override the binary. Default `tesseract`, resolved on PATH. */
  binary?: string;
  /**
   * A whole-engine override: given the PDF bytes, return one string per page.
   * Injected by tests, and the seam for a session with a better engine.
   */
  engine?: (bytes: Uint8Array) => Promise<string[]>;
  /** Language pack. Default `eng`. */
  language?: string;
}

/** Is a usable engine on PATH? Answered once, honestly, before any work. */
export function ocrEngineAvailable(binary = "tesseract"): boolean {
  const probe = spawnSync(binary, ["--version"], { encoding: "utf8" });
  return probe.status === 0;
}

const MIN_PAGE_CHARS = 2;

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
    const binary = opts.binary ?? "tesseract";
    if (!ocrEngineAvailable(binary)) {
      /*
       * THE WALL, NAMED — and named as a wall rather than as a result. The
       * next rung is installing the engine, and saying so is what stops this
       * being recorded as "the document has no text".
       */
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

    const dir = mkdtempSync(join(tmpdir(), "wtp-ocr-"));
    try {
      const pdf = join(dir, "in.pdf");
      writeFileSync(pdf, bytes);
      /*
       * Tesseract reads images, not PDFs. Rather than add a rasteriser as a
       * second dependency, the PDF goes in whole and tesseract's own PDF
       * handling (via Leptonica) is used where the build has it; where it does
       * not, the failure is reported as CANNOT_RUN with tesseract's own words,
       * which names the next rung rather than guessing at it.
       */
      const out = join(dir, "out");
      execFileSync(
        opts.binary ?? "tesseract",
        [pdf, out, "-l", opts.language ?? "eng", "txt"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      pageTexts = [readFileSync(`${out}.txt`, "utf8")];
    } catch (error) {
      return cannotRun(
        "OCR",
        source,
        `the OCR engine refused the file: ${(error as Error).message.slice(0, 300)}. ` +
          "Rasterise the pages first (pdftoppm) and OCR the images, which is the " +
          "next rung — this is not a finding about the document.",
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
