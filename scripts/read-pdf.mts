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
 * **A URL IS ALSO AN ARGUMENT** (2026-08-27, the coverage-truth session).
 *
 * This took a local path only, and the shape of a hunt is that you find the
 * document as a LINK: the CAWCD board's own meetings page links its 2026
 * schedule, and reading it meant downloading by hand, inventing a filename,
 * and remembering where it went. That is a manual maneuver repeated once per
 * document found, which is the definition of something that should be an
 * instrument. A URL is now fetched through the PROJECT'S ladder —
 * `politeGetText`'s sibling, so the rung, the identified agent and the
 * escalation behaviour are the ones every other retrieval in this repository
 * uses, rather than a private client with its own failure modes.
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
  /*
   * The content type is REPORTED and does not gate the extraction. A
   * government file server that serves a PDF as `application/octet-stream` is
   * ordinary, and refusing to read it on the strength of a header would
   * manufacture a wall in front of a document that is right there. The
   * extractor's own verdict is the one that decides, and it can tell a scan
   * from a text layer, which a header cannot.
   */
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
