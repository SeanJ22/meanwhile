import assert from "node:assert/strict";
import { test } from "node:test";

import { installFundingFixture } from "./helpers/funding-fixture.ts";
import { fundingAnswerForTarget, smallDonorShare } from "../lib/funding/display.ts";
import { getFundingSnapshot } from "../lib/funding/snapshot.ts";

test("numeric funding totals copy the exact five held committee values for every target", async () => {
  let checked = 0;
  for (const state of ["AZ", "NJ", "NH"]) {
  await installFundingFixture(state);
  for (const candidate of getFundingSnapshot().candidates) {
    checked++;
    for (const targetKey of candidate.targetKeys) {
      const answer = fundingAnswerForTarget(targetKey);
      assert.equal(answer.kind, "funding", targetKey);
      if (answer.kind !== "funding") continue;
      assert.deepEqual(answer.data.totals, {
        receipts: candidate.totals.receipts,
        disbursements: candidate.totals.disbursements,
        cashOnHand: candidate.totals.cashOnHand,
        smallDonorShare: smallDonorShare(candidate.totals.individualItemized, candidate.totals.individualUnitemized),
        individualItemized: candidate.totals.individualItemized,
        individualUnitemized: candidate.totals.individualUnitemized,
        coverageEndDate: candidate.totals.coverageEndDate,
      }, targetKey);
    }
  }
  }
  assert.equal(checked, 24, "every recorded candidate is checked through its state pointer");

  const candidate = getFundingSnapshot().candidates.find(row => row.fecCandidateId === "S0NH00219");
  assert.ok(candidate);
  assert.notEqual(candidate.totals.receipts, null);
  assert.notEqual(candidate.totals.disbursements, null);
  assert.notEqual(candidate.totals.cashOnHand, candidate.totals.receipts! - candidate.totals.disbursements!);
  const answer = fundingAnswerForTarget(candidate.targetKeys[0]);
  assert.equal(answer.kind, "funding");
  if (answer.kind === "funding") assert.equal(answer.data.totals?.cashOnHand, candidate.totals.cashOnHand);
});

test("an absent small-donor share stays null in the numeric payload", async () => {
  await installFundingFixture("AZ");
  const candidate = getFundingSnapshot().candidates[0];
  const previous = candidate.totals.individualItemized;
  try {
    candidate.totals.individualItemized = null;
    const answer = fundingAnswerForTarget(candidate.targetKeys[0]);
    assert.equal(answer.kind, "funding");
    if (answer.kind === "funding") assert.equal(answer.data.totals?.smallDonorShare, null);
  } finally {
    candidate.totals.individualItemized = previous;
  }
});
