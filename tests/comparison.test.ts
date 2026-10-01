import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  COMPARISON_INTRO,
  NOT_WRITTEN_UP,
  comparablePairs,
  compareStates,
} from "../lib/area/comparison.ts";
import { AREA_FACTS } from "../lib/area/facts.ts";

/**
 * D47 — two states side by side.
 *
 * The guards hold the one thing this surface must never become. A comparison
 * that ranks is a recommendation, and `CLAUDE.md` is explicit that the moment
 * this product recommends, its neutrality claim is gone.
 */

/** Keys `CLAUDE.md` forbids on anything that could imply a preference. */
const RANKING_KEYS = [
  "score",
  "rank",
  "rating",
  "match",
  "fit",
  "grade",
  "alignment",
  "recommendation",
  "better",
  "winner",
  "best",
];

test("D47: every covered pair compares, and none compares with itself", () => {
  const pairs = comparablePairs();
  const n = AREA_FACTS.length;
  assert.equal(
    pairs.length,
    n * (n - 1),
    "the pair list is not every ordered pair of covered states",
  );
  for (const { left, right } of pairs) {
    assert.notEqual(left, right);
    assert.ok(compareStates(left, right), `${left}/${right} did not compare`);
  }
  assert.equal(compareStates("NH", "NH"), null, "a state compared with itself");
  assert.equal(compareStates("NH", "ZZ"), null, "an unknown state compared");
});

test("D47: rows align by TOPIC, never by position", () => {
  const c = compareStates("NH", "NJ")!;
  for (const row of c.rows) {
    if (row.left.fact) assert.equal(row.left.fact.topic, row.topic);
    if (row.right.fact) assert.equal(row.right.fact.topic, row.topic);
  }
  // All three states carry the same seven topics today. Building on that
  // coincidence would break silently the first time a state is onboarded
  // with six, so the alignment is asserted rather than the count.
  assert.ok(c.rows.length >= 7, `only ${c.rows.length} rows`);
  const topics = c.rows.map((r) => r.topic);
  assert.equal(new Set(topics).size, topics.length, "a topic appears twice");
});

test("D47: the census states its own denominators", () => {
  const c = compareStates("AZ", "NJ")!;
  assert.equal(c.census.rows, c.rows.length);
  assert.equal(
    c.census.bothAnswered + c.census.onlyLeft + c.census.onlyRight,
    c.rows.length,
    "a row is in no bucket — the census lost it",
  );
  // A comparison that aligned nothing would render as two empty columns and
  // read as "these states are the same".
  assert.ok(c.census.bothAnswered > 0, "nothing aligned at all");
});

test("D47: nothing ranks — no key and no copy declares a better state", () => {
  const c = compareStates("NH", "NJ")!;
  const serialised = JSON.stringify(c).toLowerCase();
  for (const key of RANKING_KEYS) {
    assert.ok(
      !serialised.includes(`"${key}"`),
      `the comparison carries a "${key}" key`,
    );
  }
  // And the reader-facing copy says so out loud rather than merely omitting
  // the ranking, because a reader cannot see an absence.
  assert.match(COMPARISON_INTRO, /don't rank|do not rank/i);
  assert.match(COMPARISON_INTRO, /yours to decide/i);
});

test("D47: an unanswered cell is a named gap about US, never about the state", () => {
  assert.match(NOT_WRITTEN_UP, /gap in our pages/i);
  assert.ok(
    !/no rule|does not have|has none/i.test(NOT_WRITTEN_UP),
    "the gap sentence makes a claim about the state",
  );
});

test("D47: every rendered answer carries its own source and read date", () => {
  for (const { left, right } of comparablePairs()) {
    const c = compareStates(left, right)!;
    for (const row of c.rows) {
      for (const cell of [row.left, row.right]) {
        if (!cell.fact) continue;
        assert.match(cell.fact.sourceUrl, /^https:\/\//, row.topic);
        assert.ok(cell.fact.sourceOrg.length > 0, row.topic);
        // The verification note is how a reader knows whether the citation
        // was fetched or read through a wall. A citation with no read record
        // is a claim with nothing behind it.
        assert.ok(cell.fact.verification.length > 0, row.topic);
      }
    }
  }
});

test("D47: the page orders by the manifest, never by the content", () => {
  const page = readFileSync(
    join(process.cwd(), "app", "about-area", "compare", "page.tsx"),
    "utf8",
  );
  for (const forbidden of [".sort(", "orderBy", "byDifference", "mostAsked"]) {
    assert.ok(
      !page.includes(forbidden),
      `the comparison page sorts (${forbidden}) — an ordering derived from the content is a ranking`,
    );
  }
});
