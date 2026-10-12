/**
 * `pnpm extract` — the extraction toolkit's command line.
 *
 *   pnpm extract text     <file.pdf | url>
 *   pnpm extract tables   <file.pdf | url>
 *   pnpm extract ocr      <file.pdf | url>
 *   pnpm extract payload  <file.html | url>          [--find "<name>"]
 *   pnpm extract roster   <file.html | url>          # who sits on the board
 *   pnpm extract auto     <file | url>               # text, then OCR if scanned
 *
 * Flags: `--json` prints the whole result object. `--find <text>` (payload
 * only) reports every payload string containing it, with its key path.
 *
 * A zero-row extraction exits non-zero: `ZERO_ROWS` ("the layer ran and
 * produced nothing") and `CANNOT_RUN` ("the layer could not look") both fail,
 * so a failed extraction is never recorded as an empty document.
 */

import { readFileSync } from "node:fs";

import { describe } from "../lib/extract/types.ts";
import type { ExtractResult } from "../lib/extract/types.ts";
import { extractTextLayer } from "../lib/extract/text-layer.ts";
import { extractTables } from "../lib/extract/tables.ts";
import { runOcr } from "../lib/extract/ocr.ts";
import { extractEmbeddedPayload, findInPayload } from "../lib/extract/embedded-payload.ts";
import { extractRosterTables } from "../lib/extract/roster-table.ts";
import { politeGetText } from "../lib/sources/http.ts";

const [, , layer, target, ...rest] = process.argv;
const asJson = rest.includes("--json");
const findAt = rest.indexOf("--find");
const needle = findAt >= 0 ? rest[findAt + 1] : null;

const LAYERS = ["text", "tables", "ocr", "payload", "roster", "auto"] as const;

if (!layer || !target || !(LAYERS as readonly string[]).includes(layer)) {
  console.error(
    `usage: pnpm extract <${LAYERS.join("|")}> <file|url> [--json] [--find "text"]`,
  );
  process.exit(2);
}

const isUrl = /^https?:\/\//i.test(target);

async function bytesOf(): Promise<Uint8Array> {
  if (!isUrl) return new Uint8Array(readFileSync(target!));
  const res = await fetch(target!, {
    headers: {
      "user-agent":
        "we-the-people/extract (+https://github.com/SeanJ22/meanwhile; seanj22@gmail.com)",
    },
  });
  if (!res.ok) {
    console.error(`CANNOT RUN: ${target} answered HTTP ${res.status}`);
    process.exit(1);
  }
  return new Uint8Array(await res.arrayBuffer());
}

async function textOf(): Promise<string> {
  if (!isUrl) return readFileSync(target!, "utf8");
  // The shared client throws on a bot interstitial served at 200 rather than returning an empty page.
  const { status, text } = await politeGetText(target!, {});
  if (status !== 200) {
    console.error(`CANNOT RUN: ${target} answered HTTP ${status}`);
    process.exit(1);
  }
  return text;
}

let result: ExtractResult<unknown>;

switch (layer) {
  case "text":
    result = await extractTextLayer(await bytesOf(), target!);
    break;
  case "tables":
    result = await extractTables(await bytesOf(), target!);
    break;
  case "ocr":
    result = await runOcr(await bytesOf(), target!);
    break;
  case "payload": {
    const html = await textOf();
    const payload = extractEmbeddedPayload(html, target!);
    if (needle) {
      const hits = findInPayload(payload, needle);
      console.log(`\nFIND ${JSON.stringify(needle)} — ${hits.length} hit(s)`);
      for (const h of hits.slice(0, 40)) {
        console.log(`  script ${h.script}  ${h.path}`);
        console.log(`      ${h.value.slice(0, 300)}`);
      }
      if (hits.length === 0) {
        console.log(
          "  NOT IN THE PAYLOAD. That is a finding about this page, not about the " +
            "person — check the rendered prose and the page's own network calls.",
        );
      }
    }
    result = payload;
    break;
  }
  case "roster": {
    /* Who sits on a board, off the body's own page. */
    const html = await textOf();
    const roster = extractRosterTables(html, target!, isUrl ? target! : null);
    for (const row of roster.items as {
      section: string;
      name: string;
      title: string | null;
      phone: string | null;
      email: string | null;
      contactUrl: string | null;
    }[]) {
      console.log(
        `  [${row.section}] ${row.name}` +
          (row.title ? ` — ${row.title}` : "") +
          (row.phone ? ` · ${row.phone}` : "") +
          (row.email ? ` · ${row.email}` : "") +
          (row.contactUrl ? ` · ${row.contactUrl}` : ""),
      );
    }
    result = roster;
    break;
  }
  case "auto": {
    /* Text layer first; `ZERO_ROWS` from it means a scan, so OCR. */
    const bytes = await bytesOf();
    const text = await extractTextLayer(bytes, target!);
    if (text.outcome === "EXTRACTED") {
      result = text;
    } else {
      console.log(`text layer: ${describe(text)}`);
      console.log("→ escalating to OCR, which is the next rung");
      result = await runOcr(bytes, target!);
    }
    break;
  }
  default:
    process.exit(2);
}

console.log(`\n${describe(result)}`);
if (asJson) console.log(JSON.stringify(result, null, 1));
else {
  for (const item of result.items.slice(0, 10)) {
    console.log(`  ${JSON.stringify(item).slice(0, 400)}`);
  }
  if (result.rows > 10) console.log(`  … ${result.rows - 10} more row(s)`);
}

if (result.outcome !== "EXTRACTED") process.exit(1);
