/**
 * `pnpm extract` — the extraction toolkit's command line (F11, Prompt C item
 * 12, 2026-08-20).
 *
 *   pnpm extract text     <file.pdf | url>
 *   pnpm extract tables   <file.pdf | url>
 *   pnpm extract ocr      <file.pdf | url>
 *   pnpm extract payload  <file.html | url>          [--find "John Carruth"]
 *   pnpm extract roster   <file.html | url>          # who sits on the board
 *   pnpm extract auto     <file | url>               # text, then OCR if scanned
 *
 * Flags: `--json` prints the whole result object. `--find <text>` (payload
 * only) reports every payload string containing it, with its key path.
 *
 * ## What it guarantees
 *
 * **A zero-row extraction exits NON-ZERO.** Every layer returns its outcome,
 * and this turns `ZERO_ROWS` and `CANNOT_RUN` into a failing exit code, so a
 * pipeline cannot record a failed extraction as an empty document. The two are
 * printed differently and mean different things: `ZERO_ROWS` is "the layer ran
 * and produced nothing", `CANNOT_RUN` is "the layer could not look".
 *
 * Every run prints its counts. An operation that can return nothing must be
 * asked what it returned.
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
  /*
   * The identified, serialized client every adapter uses — with its challenge
   * detection, which is what stops a bot interstitial served at 200 being
   * parsed into an empty document (F20).
   */
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
  // politeGetText is the shared client with the F20 challenge escalation: a bot
  // interstitial served at 200 THROWS naming the wall rather than coming back
  // as a page that says nothing.
  const { status, text } = await politeGetText(target!, { profile: "browser" });
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
    /*
     * Layer 5 (NH Hunt, 2026-08-20). Who sits on a board, off the body's own
     * page. Built because Newbury's Selectboard roster is a Drupal Views table
     * and nothing here could read one — the record was reachable and
     * unreadable, which is friction and never refusal.
     */
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
    /*
     * The ladder, in code: text layer first, OCR when the document turns out
     * to be a scan. `ZERO_ROWS` from the text layer is exactly that signal, and
     * the whole reason the layer returns a result rather than a string.
     */
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
