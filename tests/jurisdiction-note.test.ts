/**
 * **JUR-4 ON THE BALLOT PAGE** (`NH84`, 2026-08-23) — one deliberate annotation
 * instead of the pill repeated down the page, and the two uncertainty states
 * kept apart while it happens.
 *
 * ## The repetition
 *
 * Every affected contest heading carried the full RULING 71 pill, *"Could
 * govern you — add your address to confirm"*. The map surfaces had already been
 * fixed the same way — the who-governs panel from six sentences to six marks
 * and one pill, the meetings list from nineteen consecutive rows to one per
 * group — and the ballot page, which the author named the headline UX problem
 * of the New Jersey pass, was the one left untouched.
 *
 * ## The defect that only reading the rendered page showed, and it is the
 * important half of this file
 *
 * The block names the bodies that cover only part of the reader's zip. Built
 * on `needsPill`, it named the **11th Congressional District** at 07866 — and
 * 07866 sits entirely inside NJ-11.
 *
 * `needsPill` returns true for `AMBIGUOUS` **and** for `UNKNOWN`, and says in
 * its own header that it collapses two of three states on purpose. For the
 * INVITATION that is right: offering to narrow is safe under uncertainty. This
 * block makes a much stronger claim — it names a body as partial — and
 * `UNKNOWN` does not mean partial. It means we hold no boundary for that
 * division at all.
 *
 * Rendering it as partial is a render default converting an absence into an
 * assertion, about a named district, which is the failure `CLAUDE.md`'s
 * render-default rule exists to prevent. So `UNKNOWN` contests are **counted
 * and never named**, and the sentence that counts them says whose gap it is.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { jurisdictionNameFromOcdId } from "../lib/ballot/could-govern.ts";
import { needsPill } from "../lib/geo/zip-certainty.ts";

const ROOT = process.cwd();

test("JUR-4: the page-level block names bodies, never offices", () => {
  /*
   * The first version mapped `contest.title` and told the reader the
   * governments covering part of their zip were "Member of the Borough
   * Council, Member of the Board of Education, Member of the Board of
   * Education — Unexpired Term": three job titles, two of them the same one,
   * useless to a reader who knows their own town. Naming the jurisdictions is
   * the entire purpose of the block.
   */
  assert.equal(
    jurisdictionNameFromOcdId("ocd-division/country:us/state:nj/county:morris/place:rockaway_township"),
    "Rockaway Township",
  );
  assert.equal(
    jurisdictionNameFromOcdId(
      "ocd-division/country:us/state:nj/school_district:rockaway_borough_school_district",
    ),
    "Rockaway Borough School District",
  );
  // The two types that do not carry their own noun in the identifier.
  assert.equal(
    jurisdictionNameFromOcdId("ocd-division/country:us/state:nj/county:morris"),
    "Morris County",
  );
  assert.equal(
    jurisdictionNameFromOcdId("ocd-division/country:us/state:nj/cd:11"),
    "11th Congressional District",
  );
  assert.equal(jurisdictionNameFromOcdId("ocd-division/country:us/state:nj/cd:1"), "1st Congressional District");
  assert.equal(jurisdictionNameFromOcdId("ocd-division/country:us/state:nj/cd:12"), "12th Congressional District");
  assert.equal(jurisdictionNameFromOcdId("ocd-division/country:us/state:nj/cd:23"), "23rd Congressional District");

  // A container is not a body. "New Jersey covers only part of your zip" would
  // be false as well as useless.
  assert.equal(jurisdictionNameFromOcdId("ocd-division/country:us/state:nj"), null);
});

test("JUR-4: UNKNOWN is counted and never named as partial", () => {
  // The collapse the pill relies on, asserted so a change to it is visible here.
  assert.equal(needsPill("AMBIGUOUS"), true);
  assert.equal(needsPill("UNKNOWN"), true);
  assert.equal(needsPill("CERTAIN"), false);

  const page = readFileSync(join(ROOT, "app", "ballot", "page.tsx"), "utf8");
  // The NAMED list is built from AMBIGUOUS only.
  assert.match(
    page,
    /certainty\.certaintyOf\(contest\.ocdId\) === "AMBIGUOUS"/,
    "the named jurisdiction list is no longer restricted to measured-partial divisions",
  );
  // The COUNT is built from UNKNOWN only.
  assert.match(
    page,
    /certainty\.certaintyOf\(contest\.ocdId\) === "UNKNOWN"/,
    "the unplaceable count is no longer restricted to divisions we hold no boundary for",
  );
  // And the block must not be fed by the collapsing helper.
  assert.doesNotMatch(
    page,
    /jurisdictions=\{\[[\s\S]{0,400}?needsPill\(/,
    "the named list is back on needsPill, which collapses UNKNOWN into AMBIGUOUS",
  );
});

test("JUR-4: the unplaceable sentence says whose gap it is", () => {
  const note = readFileSync(
    join(ROOT, "components", "ballot", "jurisdiction-note.tsx"),
    "utf8",
  );
  assert.match(
    note,
    /That is a gap on our side, not a finding about the district\./,
    "the unplaceable sentence lost its whose-gap attribution",
  );
  assert.match(note, /not a finding about those districts\./, "the plural form lost its attribution");
});

test("JUR-4: the full pill no longer renders per contest on the ballot page", () => {
  const page = readFileSync(join(ROOT, "app", "ballot", "page.tsx"), "utf8");
  assert.doesNotMatch(
    page,
    /<CouldGovernPill/,
    "the eleven-word pill is back on every affected contest heading",
  );
  assert.match(page, /<JurisdictionMark \/>/, "the short mark is gone");
  assert.match(page, /<JurisdictionNote/, "the page-level block is gone");
});
