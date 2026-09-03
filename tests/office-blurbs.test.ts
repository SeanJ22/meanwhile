import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ballotPath } from "../lib/holdings/files.ts";

import {
  OFFICE_BLURBS,
  blurbForContestTitle,
  blurbForTitle,
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
      readFileSync(join(process.cwd(), ballotPath(file)), "utf8"),
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

test("a New Jersey mayor is never described as a city's elected leader", () => {
  /*
   * RULING 114: closing a layer converts every wrong entry in it from silence
   * into a false claim. The generic `mayor` blurb was written for Tucson's
   * neighbours — "Your mayor is the city's elected leader… in some cities the
   * mayor runs city hall directly" — and it was ALREADY rendering for New
   * Jersey, because the committed rosters carry `officeTitle: "Mayor"`.
   * Recovering nine mayoral CONTESTS on 2026-08-25 would have put the same
   * sentence on nine more surfaces.
   *
   * The nine municipalities electing a mayor in this filing are eight boroughs
   * and one Faulkner Act township. None is a city and none is council-manager.
   */
  const njPlace = "ocd-division/country:us/state:nj/place:butler";
  const nj = blurbForContestTitle("Mayor", njPlace);
  assert.ok(nj, "a New Jersey mayoral contest must resolve an explainer");
  assert.doesNotMatch(nj.text, /\bcity\b/i, "New Jersey's mayors do not run cities here");
  assert.match(nj.text, /form(s)? of government|charter/i, "it must name the variation rather than resolve it");

  // The roster path resolves the same way — one resolver, two entry points.
  const fromRoster = blurbForTitle("Mayor", njPlace);
  assert.deepEqual(fromRoster, nj, "the roster and contest paths must agree");

  // The place-specific entry still outranks the state one.
  const tucson = blurbForTitle("Mayor", "ocd-division/country:us/state:az/place:tucson");
  assert.match(tucson?.text ?? "", /city manager/, "Tucson keeps its own charter's text");

  // And with no division at all the generic text is still what comes back,
  // rather than a state entry leaking to everybody.
  assert.deepEqual(blurbForTitle("Mayor"), OFFICE_BLURBS.mayor);
});

test("the bare word MAYOR is a contest title, and does not catch the council titles", () => {
  assert.equal(officeTypeForContestTitle("Mayor"), "mayor");
  assert.equal(officeTypeForContestTitle("Member of the Borough Council"), "nj-municipal-governing-body");
  assert.equal(officeTypeForContestTitle("Mayor and Council"), null);
});
