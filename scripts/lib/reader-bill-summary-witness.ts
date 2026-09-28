import assert from "node:assert/strict";

/** Select the screenshot that actually shows the reviewed bill-summary control. */
export function billSummaryWitnessSuffix(
  surface: "map" | "ballot",
  summary: {
    readonly sourceWindow: "CURRENT_RECENT" | "VERIFIED_EARLIER";
    readonly voteSourceVersionId: string;
    readonly summarySourceVersionId: string;
    readonly billUrl: string;
    readonly voteId: string;
    readonly visible: boolean;
  },
): string {
  assert.equal(summary.visible, true, "Bill summary must be visible in the actual reader run");
  assert.ok(summary.billUrl && summary.voteId, "Bill summary needs its exact bill and vote identity");
  assert.ok(summary.voteSourceVersionId && summary.summarySourceVersionId,
    "Vote and summary source versions must be recorded separately");
  if (summary.sourceWindow === "CURRENT_RECENT") {
    assert.equal(summary.voteSourceVersionId, summary.summarySourceVersionId,
      "Recent vote and reviewed summary must use the current canonical projection");
    return `${surface}-recent-votes`;
  }
  assert.equal(summary.sourceWindow, "VERIFIED_EARLIER", "Unknown bill-summary source window");
  assert.notEqual(summary.voteSourceVersionId, summary.summarySourceVersionId,
    "Earlier vote version must remain distinct from its current reviewed summary corpus");
  return `${surface}-earlier-votes-summary`;
}
