/**
 * `pnpm pdf:read` — read a PDF (a local path or a URL fetched through the
 * project's ladder) through `lib/extract/text-layer.ts`, where a scan with no
 * text layer is `EXTRACTION_FAILED`, never a document that says nothing.
 *
 * Usage:
 *   pnpm pdf:read data/hunt/x.pdf
 *   pnpm pdf:read https://example.gov/schedule.pdf --grep "September|October"
 *   pnpm pdf:read data/hunt/x.pdf --pages 1-3 --grep "override|levy"
 *   pnpm pdf:read <url> --save data/hunt/schedule.pdf   (keep the bytes)
 */

import { readFileSync, writeFileSync } from "node:fs";

import { extractTextLayer } from "../lib/extract/text-layer.ts";
import { floored } from "../lib/ops/denominator-floor.ts";
import { politeGetBytes } from "../lib/sources/http.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const path = process.argv[2];
if (!path || path.startsWith("--")) {
  console.error(
    "usage: pnpm pdf:read <file.pdf|url> [--pages 1-3] [--grep <regex>] [--save <file.pdf>]",
  );
  process.exit(2);
}

const isUrl = /^https?:\/\//i.test(path);
let bytes: Uint8Array;
if (isUrl) {
  const got = await politeGetBytes(path, { accept: "application/pdf,*/*" });
  console.log(`fetched ${path}`);
  console.log(`  rung ${got.rung} · HTTP ${got.status} · ${got.contentType} · ${got.bytes.length} bytes`);
  // The content type is reported and never gates extraction; the extractor's verdict decides.
  bytes = got.bytes;
  const save = arg("save");
  if (save) {
    writeFileSync(save, bytes);
    console.log(`  saved to ${save}`);
  }
  console.log("");
} else {
  bytes = new Uint8Array(readFileSync(path));
}
// Read the size before extraction: pdfjs detaches the buffer, so `bytes.length` is 0 afterwards.
const inputBytes = bytes.length;
const result = await extractTextLayer(bytes, path);

console.log(`PDF ${path} — ${inputBytes} bytes`);
console.log(`  outcome        ${result.outcome}`);
if (result.counts) console.log(`  counts         ${JSON.stringify(result.counts)}`);
if (result.reason) console.log(`  reason         ${result.reason}`);
console.log("");

if (result.outcome !== "EXTRACTED") {
  // An extraction that could not run is reported as one, and the caller is told to escalate to OCR.
  console.error(
    result.outcome === "ZERO_ROWS"
      ? "ZERO PAGES OF TEXT. This is a FAILED extraction, not an empty document — the " +
          "file is very likely a scan. Escalate to lib/extract/ocr.ts."
      : "The extraction could not run. That is a failure, never an absence.",
  );
  process.exit(1);
}

const pages = result.items ?? [];

// Pages with text against pages in the document: 0 of 40 is a scan.
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
