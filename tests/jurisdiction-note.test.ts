/**
 * One page-level annotation instead of a pill on every contest heading. `needsPill` is true for both
 * `AMBIGUOUS` and `UNKNOWN`, but `UNKNOWN` means we hold no boundary, not that a body is partial, so `UNKNOWN`
 * contests are counted and never named.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { jurisdictionNameFromOcdId } from "../lib/ballot/could-govern.ts";
import { needsPill } from "../lib/geo/zip-certainty.ts";

const ROOT = process.cwd();

test("JUR-4: the page-level block names bodies, never offices", () => {
  /* The block names jurisdictions, not job titles. */
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
 * The block makes no claim about any district on the strength of a polygon we do not hold, and still attributes
 * the limit to us and to the zip, without announcing a failure.
 */
test("BAL-7: the block attributes the limit to us without announcing a failure", () => {
  const note = readFileSync(
    join(ROOT, "components", "ballot", "jurisdiction-note.tsx"),
    "utf8",
  );
  /* Comments stripped first, so a note quoting cut copy is not read as shipped copy. */
  const code = note.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  // The self-deprecating form is gone from what a reader sees.
  assert.doesNotMatch(
    code,
    /gap on our side/,
    "the failure-announcing sentence is back (BAL-7)",
  );

  // The attribution stays on the page.
  assert.match(
    note,
    /what we cannot tell from a zip code alone is\s*\n?\s*which of them is yours/,
    "the block no longer attributes the limit to the zip and to us",
  );

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
