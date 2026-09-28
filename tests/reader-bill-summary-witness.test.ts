import assert from "node:assert/strict";
import { test } from "node:test";
import { billSummaryWitnessSuffix } from "../scripts/lib/reader-bill-summary-witness.ts";

const current = {
  sourceWindow: "CURRENT_RECENT" as const,
  voteSourceVersionId: "current-canonical-v1",
  summarySourceVersionId: "current-canonical-v1",
  billUrl: "https://www.congress.gov/bill/119th-congress/house-bill/6500",
  voteId: "house:119-2:286",
  visible: true,
};

test("bill-summary witness uses the actually visible source window and distinct provenance", () => {
  assert.equal(billSummaryWitnessSuffix("map", current), "map-recent-votes");
  const earlier = { ...current, sourceWindow: "VERIFIED_EARLIER" as const,
    voteSourceVersionId: "approved-former-v1" };
  assert.equal(billSummaryWitnessSuffix("ballot", earlier), "ballot-earlier-votes-summary");
  assert.throws(() => billSummaryWitnessSuffix("map", { ...earlier, voteSourceVersionId: current.summarySourceVersionId }),
    /must remain distinct/);
  assert.throws(() => billSummaryWitnessSuffix("ballot", { ...current, summarySourceVersionId: "unrelated-v2" }),
    /current canonical projection/);
  assert.throws(() => billSummaryWitnessSuffix("ballot", { ...earlier, visible: false }), /must be visible/);
  assert.throws(() => billSummaryWitnessSuffix("ballot", { ...earlier, billUrl: "" }), /exact bill and vote identity/);
});
