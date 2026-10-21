/** Address-dependent contests use a short mark and one shared label. */
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

test("address-dependent contests include ambiguous and unknown boundaries", () => {
  assert.equal(needsPill("AMBIGUOUS"), true);
  assert.equal(needsPill("UNKNOWN"), true);
  assert.equal(needsPill("CERTAIN"), false);
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
