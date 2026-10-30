import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { StatedCount } from "../lib/extract/count-assertion.ts";
import { extractRosterTables } from "../lib/extract/roster-table.ts";
import { extractTextLayer } from "../lib/extract/text-layer.ts";
import {
  assertionCensus,
  cannotRun,
  extracted,
  isComplete,
  zeroRows,
  type ExtractResult,
} from "../lib/extract/types.ts";

test("successive native election PDFs retain their text and page counts after extraction closes", async () => {
  const bytes = readFileSync(new URL("./fixtures/cochise-2026-vote-centers.pdf", import.meta.url));
  const source = "https://www.cochise.az.gov/elections/2026-vote-centers.pdf";
  const first = await extractTextLayer(Uint8Array.from(bytes), source);
  assert.equal(first.outcome, "EXTRACTED");
  if (first.outcome !== "EXTRACTED") return;
  assert.ok(Number(first.counts.pages) > 0);
  assert.match(first.items.map(page => page.text).join(" "), /Cochise/i);
  assert.deepEqual(await extractTextLayer(Uint8Array.from(bytes), source), first);
});

/** A stated count as a layer reads one out of its own document. */
const states = (count: number): StatedCount => ({
  count,
  evidence: `a Council of ${count} members`,
  shape: "test",
});

function partial(): ExtractResult<string> {
  return extracted("ROSTER_TABLE", "test", 128, ["a", "b"], {}, states(5));
}

test("partials: PARTIAL is not complete, and its rows are kept as evidence", () => {
  const result = partial();
  assert.equal(result.outcome, "PARTIAL", "fewer rows than stated must not report EXTRACTED");
  assert.equal(isComplete(result), false);
  assert.equal(result.rows, 2);
  assert.equal(
    result.items.length,
    2,
    "throwing the rows away would destroy evidence — the outcome says it failed, not the items",
  );
});

test("partials: OVER is reported and is NOT a failure by itself", () => {
  const over = extracted("ROSTER_TABLE", "test", 128, ["a", "b", "c"], {}, states(2));
  assert.equal(over.count.verdict, "OVER");
  assert.equal(over.outcome, "EXTRACTED", "more rows than stated is reported, never silent, never fatal");
  assert.match(over.count.reason, /1 more than the document claims/);
});

test("partials: NOT_ASSERTABLE is a named state, distinguishable from a checked pass", () => {
  const unasserted = extracted(
    "ROSTER_TABLE",
    "test",
    128,
    ["a"],
    {},
    "the page states no membership count",
  );
  assert.equal(unasserted.count.verdict, "NOT_ASSERTABLE");
  assert.equal(unasserted.outcome, "EXTRACTED");
  assert.equal(
    isComplete(unasserted),
    true,
    "an unasserted count is not a failure — but it is a WEAKER claim and must be reportable as one",
  );
});

test("partials: the census separates what could be checked from what was", () => {
  const census = assertionCensus([
    partial(),
    extracted("ROSTER_TABLE", "t", 64, ["a"], {}, states(1)),
    extracted("ROSTER_TABLE", "t", 64, ["a"], {}, "no membership sentence"),
    zeroRows<string>("ROSTER_TABLE", "t", 64, "nothing matched", {}),
    cannotRun<string>("ROSTER_TABLE", "t", "no engine", {}),
  ]);
  assert.equal(
    census.MATCHED + census.SHORT + census.OVER + census.NOT_ASSERTABLE,
    5,
    "every result must land in exactly one bucket — the census is its own denominator",
  );
  assert.equal(census.SHORT, 1, "the PARTIAL was not counted as SHORT");
  assert.ok(
    census.NOT_ASSERTABLE >= 3,
    "an unasserted count, a zero-row and a cannot-run must all read as unchecked rather than as passes",
  );
});

test("partials: a prose page CANNOT RUN this layer rather than reading as an empty board", () => {
  const result = extractRosterTables(
    "<p>The board is Ann Ryan, Ryan Herd and David Kohle.</p>",
    "https://example.gov/board",
  );
  assert.equal(
    result.outcome,
    "CANNOT_RUN",
    "a page listing its board in prose is not a page with an empty board",
  );
  assert.match(result.reason, /no <table>/i);
  assert.equal(result.rows, 0);
  assert.ok(
    Number.isInteger(result.counts.bytes) && result.counts.bytes > 0,
    "the layer must state what it actually examined — `cannotRun` zeroes inputBytes by design, so the size lives in counts",
  );
});

test("partials: a table with no roster in it is ZERO_ROWS, and names the next rung", () => {
  const result = extractRosterTables(
    "<table><tr><td>Monday</td><td>9am</td></tr><tr><td>Tuesday</td><td>10am</td></tr></table>",
    "https://example.gov/hours",
  );
  assert.equal(result.outcome, "ZERO_ROWS", "a table of opening hours is not a roster");
  assert.notEqual(
    result.reason,
    "",
    "ZERO_ROWS without a reason is a layer telling you about itself and saying nothing",
  );
});

test("partials: every extract result states its counts as integers", () => {
  for (const result of [
    partial(),
    zeroRows<string>("TABLES", "t", 512, "nothing", { pages: 3 }),
    cannotRun<string>("OCR", "t", "no engine", { bytes: 0 }),
  ]) {
    assert.ok(Number.isInteger(result.rows), "rows is not an integer");
    assert.ok(Number.isInteger(result.inputBytes), "inputBytes is not an integer");
    for (const [name, value] of Object.entries(result.counts)) {
      assert.ok(Number.isInteger(value), `counts.${name} is not an integer`);
    }
    assert.ok(result.count, "a result carries no count assertion — the field is required");
  }
});
