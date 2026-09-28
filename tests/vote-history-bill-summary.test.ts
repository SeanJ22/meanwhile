import assert from "node:assert/strict";
import { test } from "node:test";

import { reviewedHistoricalBill } from "../lib/votes/history.ts";
import type { BillSummariesFile } from "../lib/votes/bill-summaries.ts";

test("older roll calls retain reviewed bill explanations only at their exact official URL", () => {
  const officialBillUrl = "https://www.congress.gov/bill/119th-congress/house-bill/1234";
  const reviewed: BillSummariesFile = {
    curatedAt: "2026-09-01",
    summaries: {
      [officialBillUrl]: {
        legisNum: "H.R. 1234", title: "Official bill", summary: "Reviewed plain-language account.",
        basis: "Official summary at the cited bill URL", curatedAt: "2026-09-01",
      },
    },
    pending: [{ billUrl: "https://www.congress.gov/bill/119th-congress/house-bill/5678",
      legisNum: "H.R. 5678", title: "Another bill", reason: "Review pending" }],
  };
  assert.deepEqual(reviewedHistoricalBill(officialBillUrl, reviewed), {
    billSummary: reviewed.summaries[officialBillUrl], billSummaryPending: false,
  });
  assert.deepEqual(reviewedHistoricalBill("https://www.congress.gov/bill/119th-congress/house-bill/12345", reviewed), {
    billSummary: null, billSummaryPending: false,
  }, "a similar bill URL cannot inherit another bill's summary");
  assert.deepEqual(reviewedHistoricalBill("https://www.congress.gov/bill/119th-congress/house-bill/5678", reviewed), {
    billSummary: null, billSummaryPending: true,
  }, "a pending explanation stays pending, not fabricated");
  assert.deepEqual(reviewedHistoricalBill(null, reviewed), { billSummary: null, billSummaryPending: false });
});
