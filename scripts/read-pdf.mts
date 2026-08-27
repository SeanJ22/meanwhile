/**
 * `pnpm pdf:read` — READ A PDF, rather than record that one exists.
 *
 * `CLAUDE.md` ladder rung 9 and the project's own standing rule: a PDF link is
 * not a completed source walk. `lib/extract/text-layer.ts` already holds the
 * engine and, crucially, the distinction a bare string cannot carry — a scan
 * with no text layer is `EXTRACTION_FAILED`, never a document that says
 * nothing. This is a command-line front door for it, so a hunt can read a
 * document the moment it finds one.
 *
 * Usage:
 *   pnpm pdf:read data/hunt/x.pdf
 *   pnpm pdf:read data/hunt/x.pdf --pages 1-3 --grep "override|levy"
 */

import { readFileSync } from "node:fs";

import { extractTextLayer } from "../lib/extract/text-layer.ts";
import { floored } from "../lib/ops/denominator-floor.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const path = process.argv[2];
if (!path || path.startsWith("--")) {
  console.error("usage: pnpm pdf:read <file.pdf> [--pages 1-3] [--grep <regex>]");
  process.exit(2);
}

const bytes = new Uint8Array(readFileSync(path));
// The size is read BEFORE extraction. pdfjs takes ownership of the buffer and
// detaches it, so `bytes.length` afterwards is 0 — and a report that printed
// "0 bytes" beside a successful extraction would be describing the extractor
// rather than the document.
const inputBytes = bytes.length;
const result = await extractTextLayer(bytes, path);

console.log(`PDF ${path} — ${inputBytes} bytes`);
console.log(`  outcome        ${result.outcome}`);
if (result.counts) console.log(`  counts         ${JSON.stringify(result.counts)}`);
if (result.reason) console.log(`  reason         ${result.reason}`);
console.log("");

if (result.outcome !== "EXTRACTED") {
  // The whole reason this uses the toolkit rather than a string: an extraction
  // that could not run is reported as one, and the caller is told to escalate
  // to OCR rather than being handed an empty document.
  console.error(
    result.outcome === "ZERO_ROWS"
      ? "ZERO PAGES OF TEXT. This is a FAILED extraction, not an empty document — the " +
          "file is very likely a scan. Escalate to lib/extract/ocr.ts."
      : "The extraction could not run. That is a failure, never an absence.",
  );
  process.exit(1);
}

const pages = result.items ?? [];

// RULING 159 — pages WITH TEXT against pages IN THE DOCUMENT. This is the
// whole point of reading a PDF through the toolkit: 2 of 2 pages is a read
// document and 0 of 40 is a scan, and a bare page count cannot tell them apart.
floored(
  "PDF pages carrying text",
  path,
  result.counts?.pages ?? pages.length,
  result.counts?.pagesWithText ?? pages.length,
);
const range = arg("pages");
let selected = pages;
if (range) {
  const [a, b] = range.split("-").map(Number);
  selected = pages.filter((p) => p.page >= a && p.page <= (b || a));
}

const grep = arg("grep");
for (const p of selected) {
  const text = p.text.replace(/[ \t]+/g, " ");
  if (grep) {
    const re = new RegExp(grep, "i");
    const lines = text.split(/\n+/).filter((l) => re.test(l));
    if (lines.length === 0) continue;
    console.log(`--- page ${p.page} — ${lines.length} matching line(s)`);
    for (const l of lines) console.log(`  ${l.trim()}`);
  } else {
    console.log(`--- page ${p.page}`);
    console.log(text.trim());
  }
  console.log("");
}
