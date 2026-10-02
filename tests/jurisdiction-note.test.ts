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

/**
 * **AMENDED 2026-08-24 (BAL-7) — THE SENTENCE IS CUT, AND ITS OBLIGATION IS
 * ASSERTED INSTEAD OF ITS WORDING.**
 *
 * This asserted the literal strings *"That is a gap on our side, not a finding
 * about the district."* and its plural. The author red-boxed both on
 * `12-16-38` and ruled the class product-wide: **stop announcing that the site
 * is failing.**
 *
 * The render-default rule survives that cut unchanged, and this is what it
 * actually requires — it says in as many words that **the rule is the
 * ATTRIBUTION, never a particular sentence**, and that what may be rewritten
 * at any time is how it is said. So the guard now asserts the two things that
 * must remain true:
 *
 *  1. **No claim is made about any district.** The block may not say a
 *     district covers part of this zip on the strength of a polygon we do not
 *     hold — that is the assertion the deleted sentence was hedging, and
 *     deleting the hedge would be a defect if the assertion had stayed.
 *  2. **The limit is still attributed to US and to the zip.** The surviving
 *     paragraph carries it: *what we cannot tell from a zip code alone is
 *     which of them is yours.*
 */
test("BAL-7: the block attributes the limit to us without announcing a failure", () => {
  const note = readFileSync(
    join(ROOT, "components", "ballot", "jurisdiction-note.tsx"),
    "utf8",
  );
  /*
   * Comments stripped first. The component's own note QUOTES the sentence the
   * author cut, so a sweep over the raw file would flag the record of the fix
   * as the defect — an instrument that cannot tell shipped copy from a comment
   * about shipped copy is reading the wrong thing (RULING 110).
   */
  const code = note.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  // The self-deprecating form is gone from what a reader sees.
  assert.doesNotMatch(
    code,
    /gap on our side/,
    "the failure-announcing sentence is back (BAL-7)",
  );

  // The attribution it used to carry is still on the page, in the paragraph
  // the author left unmarked.
  assert.doesNotMatch(
    code,
    /not a boundary|what we cannot tell/,
    "rulings §10: no disclaimer sentence in the block",
  );
  assert.match(code, /This zip crosses several governments/);

  // And nothing was upgraded into a claim about a district in the process:
  // `unplaceable` divisions are still COUNTED rather than named.
  assert.doesNotMatch(
    note,
    /unplaceable[\s\S]{0,200}jurisdictions\.join/,
    "unplaceable divisions are being named alongside measured ones",
  );
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
