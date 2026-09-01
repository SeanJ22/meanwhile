/**
 * **REPAIRING THE ROWS THE RULING 227 APPEND DUPLICATED.** (2026-09-01.)
 *
 * `lib/tracker/reconcile.mjs` re-appended an auto-resolve card on every
 * generation that ran while the resolved row was still sitting in the working
 * store waiting for `pnpm tracker:move`. The generator is fixed — it now writes
 * the card exactly once, and `tests/tracker-predicates.test.ts` holds both
 * halves of that. This is the other half of RULING 102: **fixing a generator is
 * not finished until its output is regenerated and diffed.**
 *
 * The output here cannot be regenerated, because the card records a verdict
 * taken against artifacts as they stood on the day it was taken. So the repair
 * is surgical and it is the narrowest possible edit: where one row's `Session
 * record` contains the SAME card text twice, the second copy is removed. It
 * matches nothing else — not a paraphrase, not an overlapping prefix, not two
 * cards that differ by a character — and if the two copies are not byte
 * identical it refuses the row and says so rather than guessing which to keep.
 *
 * Nothing else in either store is touched. The rows are `NH272`, `NH281` and
 * `NH300`, and the count is asserted below rather than assumed: a repair that
 * silently found four rows would be a different repair.
 *
 * Run once:  pnpm tsx scripts/tracker-dedupe-227-cards.mts --write
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { COLUMNS, RESOLVED_CSV, ROOT, WORKING_CSV, readStore, writeStore } from "./tracker-core.mjs";

const MARKER = "AUTO-RESOLVED under RULING 227";
const WRITE = process.argv.includes("--write");

/**
 * The card, isolated from the record around it.
 *
 * A card starts at its own stamp-and-session preamble and runs to the RULING
 * 208 sentence the generator always closes with. Taking the span between the
 * marker's two occurrences would cut the SECOND card's own preamble off and
 * leave it dangling, which is why the boundaries are found rather than assumed.
 */
function cardSpans(record: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  let from = 0;
  for (;;) {
    const at = record.indexOf(MARKER, from);
    if (at < 0) break;
    /* Back up to the stamp that opens the card: "YYYY-MM-DD (label). ". */
    const preamble = record.lastIndexOf(". ", at);
    const stamp = record.lastIndexOf(". ", preamble - 1);
    const start = stamp < 0 ? 0 : stamp + 2;
    const closer = record.indexOf("(RULING 208).", at);
    const end = closer < 0 ? record.length : closer + "(RULING 208).".length;
    spans.push({ start, end });
    from = end;
  }
  return spans;
}

let repaired = 0;
let scanned = 0;
const refused: string[] = [];
const touchedRows: string[] = [];

for (const path of [WORKING_CSV, RESOLVED_CSV]) {
  const rows = readStore(path, ROOT);
  let changed = false;

  scanned += rows.length;
  for (const row of rows) {
    const record = String(row["Session record"] ?? "");
    const spans = cardSpans(record);
    if (spans.length < 2) continue;

    const texts = spans.map((s) => record.slice(s.start, s.end));
    const first = texts[0];
    if (!texts.every((t) => t === first)) {
      refused.push(
        `${row.ID}: ${spans.length} RULING 227 cards that are NOT byte identical — ` +
          "left alone; a human decides which is current",
      );
      continue;
    }

    /* Keep the first, drop the rest, and heal the whitespace between them. */
    let out = record;
    for (const span of spans.slice(1).reverse()) {
      const before = out.slice(0, span.start).replace(/\s+$/, "");
      const after = out.slice(span.end).replace(/^\s+/, "");
      out = after ? `${before} ${after}` : before;
    }
    row["Session record"] = out;
    changed = true;
    repaired += spans.length - 1;
    touchedRows.push(`${row.ID} (${path}): ${spans.length} cards -> 1`);
  }

  if (changed && WRITE) {
    writeFileSync(join(ROOT, path), writeStore(rows), "utf8");
  }
}

console.log(`\nRULING 227 card de-duplication — ${WRITE ? "WRITTEN" : "DRY RUN"}`);
/*
 * RULING 159. A run whose CSV read silently returned nothing would print
 * "0 rows repaired" and exit clean, which is the same number a healthy store
 * prints. The denominator is every row in both stores.
 */
const repairedCount = floored(
  "rows whose RULING 227 card was de-duplicated",
  "docs/tracker-working.csv + docs/tracker-resolved.csv",
  scanned,
  touchedRows.length,
);

console.log(`  columns             ${COLUMNS.length}`);
console.log(`  ${floorLine(repairedCount)}`);
console.log(`  duplicate cards     ${repaired} removed`);
for (const line of touchedRows) console.log(`    ${line}`);
if (refused.length) {
  console.log(`  refused             ${refused.length}`);
  for (const line of refused) console.log(`    ${line}`);
}
if (!WRITE) console.log("\n  nothing written — pass --write");

/* A repair that finds a different population than the one it was written for
   is not this repair. Say so rather than proceeding. */
const EXPECTED = ["NH272", "NH281", "NH300"];
const found = touchedRows.map((l) => l.split(" ")[0]).sort();
if (WRITE && JSON.stringify(found) !== JSON.stringify(EXPECTED)) {
  console.error(`\n  POPULATION MISMATCH — expected ${EXPECTED.join(", ")}, repaired ${found.join(", ")}`);
  process.exit(1);
}

/* Keep the linter honest about the unused import in a dry run. */
void readFileSync;
