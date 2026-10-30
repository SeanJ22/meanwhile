/** Campaign finance: can a reader ask and get a grounded answer. Tests on ids beginning fixture: are function inputs, never claims about real filings; each seeded failure is paired with a positive control. */

import test from "node:test";
import assert from "node:assert/strict";
import { installFundingFirstSeed } from "./helpers/registry-runtime-first-seed.ts";

await installFundingFirstSeed();

/** Does this sentence assert that no money was raised? The disclaimer tail is cut first, and only the claim it makes is tested. */
function assertsAbsence(sentence: string): boolean {
  const head = sentence.split(
    /not a statement that|not a sign that|rather than a finding|not a finding|is not a statement/i,
  )[0];
  return /no money was raised|raised nothing|none was raised|did not raise|there are no contributions/i.test(
    head,
  );
}

test("WHOSE GAP: the absence-assertion detector actually detects one", () => {
  // The guard must catch a real assertion...
  assert.equal(assertsAbsence("This committee raised nothing in this period."), true);
  assert.equal(assertsAbsence("No money was raised for the yes side."), true);
  // ...and must NOT flag the honest disclaimer that names the same words.
  assert.equal(
    assertsAbsence(
      "We have not recorded any contributions yet. That is a gap in our records, not a statement " +
        "that no money was raised.",
    ),
    false,
  );
});

