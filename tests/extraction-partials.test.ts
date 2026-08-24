import assert from "node:assert/strict";
import test from "node:test";

import type { StatedCount } from "../lib/extract/count-assertion.ts";
import { extractRosterTables } from "../lib/extract/roster-table.ts";
import {
  assertionCensus,
  cannotRun,
  extracted,
  isComplete,
  zeroRows,
  type ExtractResult,
} from "../lib/extract/types.ts";
import { parseRoster } from "../lib/hunt/wikipedia.ts";

/* ========================================================================== */
/* RULING 100 — THE THREE NAMED SHAPES, LOCKED AS REGRESSIONS                 */
/* ========================================================================== */

/**
 * The brief for 2026-08-23 says the fetch layer and extraction are where the
 * six silent partials lived. Three of them are named in RULING 100 itself, with
 * the exact defect in each. **All three read correctly today** — this file is
 * what stops them coming back, because every one of them failed by returning
 * SOME rows and a clean exit, which is invisible to any check asking whether
 * something came back.
 *
 * Each test states the shape, not the string (RULING 110): *a roster sentence
 * cut short by stray markup*, not one particular `<br>` tag.
 */

test("partials: a roster sentence cut short by stray markup still reads every member", () => {
  /*
   * SHAPE 1 — Rockaway Township. A stray `<br id="isPasted">` mid-sentence
   * ended the parse early. **Four of nine council members vanished, the parse
   * reported five rows and exited clean**, and every instrument in the repo
   * read that as healthy because every instrument was asking whether anything
   * came back.
   */
  const section =
    "The governing body is comprised of a Mayor and a Township Council of nine members. " +
    "The members of the Township Council are Michael Puzio (R, 2027; Ward 1), " +
    "Jeremy Jedynak (R, 2026; Ward 2), Adam Salberg (R, 2028; Ward 3), " +
    "Tucker Kelley (R, 2027; Ward 4), Phyllis Smith (R, 2026; Ward 5)<br id=\"isPasted\">, " +
    "Sarah Doe (R, 2028; Ward 6), John Roe (R, 2027; At-large), " +
    "Jane Coe (R, 2026; At-large), Alex Poe (R, 2028; At-large).";

  const parsed = parseRoster(section, "Township Council");
  assert.equal(parsed.count.stated, 9, "the article's nine must still be read");
  assert.equal(
    parsed.officials.length,
    9,
    "stray markup truncated the roster again — this is the Rockaway shape",
  );
  assert.equal(parsed.count.verdict, "MATCHED");
});

test("partials: the least-documented members are not filtered out for being thin", () => {
  /*
   * SHAPE 2 — Mount Olive. A filter requiring a party letter, a term year or a
   * seat deleted the two members the article says least about. **That is the
   * equal-effort failure pointed the other way**: the people with the least
   * public material were the ones the parser dropped.
   */
  const section =
    "The governing body is comprised of a Township Council of seven members. " +
    "The members of the Township Council are Joe Nicastro (D, 2026), Alex Roman (D, 2025), " +
    "Colleen Labow, John Ferrante, Ray Perkins (R, 2027), Greg Stewart (R, 2026), " +
    "Phil Tobey (R, 2025).";

  const parsed = parseRoster(section, "Township Council");
  assert.equal(parsed.count.stated, 7);
  assert.equal(parsed.officials.length, 7, "a member with no party, year or seat was dropped");
  const names = parsed.officials.map((o) => o.name);
  assert.ok(names.includes("Colleen Labow"), "the thinnest row was filtered out");
  assert.ok(names.includes("John Ferrante"), "the thinnest row was filtered out");
});

test("partials: a past-tense copula is still a body that exists", () => {
  /*
   * SHAPE 3 — Pequannock. The article's sentence read *"was composed of"*
   * rather than *"is composed of"*, and **five sitting members read as an empty
   * body.** A tense is not a fact about whether a government exists.
   */
  const section =
    "As of 2023, the Township Council was composed of five members. " +
    "The members of the Township Council are Ann Ryan (R, 2025), Ryan Herd (R, 2024), " +
    "David Kohle (R, 2026), Adam Sullivan (R, 2025), Melissa Florance-Lynch (R, 2024).";

  const parsed = parseRoster(section, "Township Council");
  assert.equal(parsed.count.stated, 5, "a past-tense composition sentence states a count too");
  assert.equal(parsed.officials.length, 5, "a past-tense copula emptied a sitting body");
  assert.notEqual(parsed.count.verdict, "NOT_ASSERTABLE");
});

test("partials: the guard would CATCH a truncation — it is not green about nothing", () => {
  /*
   * The other half of RULING 110: an instrument that cannot find the defect it
   * was written for is an instrument reporting green about nothing. This is the
   * Rockaway article with four members genuinely missing, and the result must
   * be PARTIAL rather than a clean five.
   */
  const truncated =
    "The governing body is comprised of a Mayor and a Township Council of nine members. " +
    "The members of the Township Council are Michael Puzio (R, 2027; Ward 1), " +
    "Jeremy Jedynak (R, 2026; Ward 2), Adam Salberg (R, 2028; Ward 3), " +
    "Tucker Kelley (R, 2027; Ward 4), Phyllis Smith (R, 2026; Ward 5).";

  const parsed = parseRoster(truncated, "Township Council");
  assert.equal(parsed.count.stated, 9);
  assert.equal(parsed.officials.length, 5);
  assert.equal(
    parsed.count.verdict,
    "SHORT",
    "five rows against a stated nine must be SHORT — a total that reconciles is not a total that is correct",
  );
  assert.match(parsed.count.reason, /4 missing/);
});

/* ========================================================================== */
/* PARTIAL travels — a caller that only asks EXTRACTED must not read it clean */
/* ========================================================================== */

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

/* ========================================================================== */
/* The roster-table layer — CANNOT_RUN is not ZERO_ROWS                       */
/* ========================================================================== */

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
