import assert from "node:assert/strict";
import { test } from "node:test";

import { contributorEntityExplanation } from "../lib/funding/contributor-entity.ts";
import type { ContributorGroup } from "../lib/funding/grouping.ts";

function group(name: string, entityType = "PAC"): ContributorGroup {
  return {
    key: name,
    contributorName: name,
    city: null,
    state: null,
    kind: "COMMITTEE_OR_ORGANIZATION",
    amount: 5000,
    count: 1,
    countNoun: "contributions",
    filings: [],
    entityType,
    lineNumber: "11AI",
    committeeType: null,
    organizationType: null,
    designation: null,
    contributorCommitteeId: null,
  };
}

test("named fundraising platforms get exact, self-sourced explanations", () => {
  const actBlue = contributorEntityExplanation(group("ACTBLUE"), null, "an organization");
  assert.ok(actBlue);
  assert.match(actBlue.text, /nonprofit digital fundraising platform/);
  assert.equal(actBlue.sourceUrl, "https://www.actblue.com/about/");

  const winRed = contributorEntityExplanation(group("WinRed", "ORG"), null, "an organization");
  assert.ok(winRed);
  assert.match(winRed.text, /conservative and Republican/);
  assert.equal(winRed.sourceUrl, "https://winred.com/about");

  const actBlueTechnical = contributorEntityExplanation(
    group("ACTBLUE TECHNICAL SERVICES"),
    null,
    "an organization",
  );
  assert.equal(actBlueTechnical?.sourceUrl, "https://www.actblue.com/about/");
  const winRedTechnical = contributorEntityExplanation(
    group("WINRED TECHNICAL SERVICES LLC"),
    null,
    "an organization",
  );
  assert.equal(winRedTechnical?.sourceUrl, "https://winred.com/about");
});

test("unknown entities stay on the filing and are never characterized from a name", () => {
  const answer = contributorEntityExplanation(group("EXAMPLE VICTORY FUND"), null, "an organization");
  assert.ok(answer);
  assert.equal(answer.text, "The FEC filing identifies this contributor as an organization.");
  assert.equal(answer.sourceUrl, "https://www.fec.gov/data/receipts/");
  assert.equal(contributorEntityExplanation(group("A PERSON", "IND"), null, null), null);
});
