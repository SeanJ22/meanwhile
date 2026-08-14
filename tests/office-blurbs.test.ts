import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  OFFICE_BLURBS,
  blurbForContestTitle,
  officeTypeForContestTitle,
  officeTypeForTitle,
} from "../lib/officials/office-blurbs.ts";

/**
 * 4b (2026-08-17): every office type on any covered ballot carries an
 * explainer in the register. The denominator is the ballot files themselves
 * — a contest added without a blurb fails here, so "every office" can never
 * silently rot into "most offices".
 */

const BALLOT_FILES = [
  "nj-morris-2026.json",
  "nh-merrimack-2026.json",
  "az-pima-2026.json",
];

test("every candidacy contest on every covered ballot has an office explainer", () => {
  let contests = 0;
  for (const file of BALLOT_FILES) {
    const set = JSON.parse(
      readFileSync(join(process.cwd(), "data", "ballot", file), "utf8"),
    ) as { contests: { title: string; type: string }[] };
    for (const contest of set.contests) {
      if (contest.type !== "CANDIDACY") continue;
      contests += 1;
      assert.ok(
        blurbForContestTitle(contest.title),
        `${file}: no office explainer resolves for "${contest.title}"`,
      );
    }
  }
  // The denominator: 6 NJ + 12 NH + 12 AZ candidacy contests as of curation.
  assert.ok(contests >= 30, `expected ≥30 candidacy contests, saw ${contests}`);
});

test("county offices never borrow their state-level cousin's blurb", () => {
  assert.equal(
    officeTypeForContestTitle("Merrimack County Treasurer"),
    "county-treasurer",
  );
  assert.equal(officeTypeForContestTitle("State Treasurer"), "state-treasurer");
  assert.equal(
    officeTypeForContestTitle("Merrimack County Attorney"),
    "county-attorney",
  );
  assert.equal(
    officeTypeForContestTitle("Attorney General"),
    "attorney-general",
  );
});

test("the Selectboard maps to its own explainer, never a borrowed one (2e)", () => {
  assert.equal(officeTypeForTitle("Selectboard Chair"), "select-board");
  assert.equal(officeTypeForTitle("Selectboard Member"), "select-board");
  assert.ok(OFFICE_BLURBS["select-board"].text.includes("town meeting"));
});

test("blurbs describe offices in the register — no advocacy vocabulary", () => {
  // "how they should vote on a bill" is mechanical civics, so the banned
  // phrase is the advocacy form ("you should vote"), not the words alone.
  const banned = /\b(best|worst|you should vote|deserves|corrupt|failed leadership)\b/i;
  for (const [key, blurb] of Object.entries(OFFICE_BLURBS)) {
    assert.ok(!banned.test(blurb.text), `advocacy vocabulary in ${key}`);
  }
});
