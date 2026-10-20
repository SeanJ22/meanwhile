/** The weekly audit accuracy reading. */
import assert from "node:assert/strict";
import test from "node:test";

import { coverageLineFrom, weeklyAuditAccuracy, type AuditCorrection } from "../lib/control-plane/admin-view/v6-audit-read.ts";
import type { LiveAuditResult } from "../lib/control-plane/workers/live-audit.ts";

const NOW = "2026-10-05T12:00:00.000Z";
const result = (factId: string, verdict: LiveAuditResult["verdict"], checkedAt: string, over: Partial<LiveAuditResult> = {}): LiveAuditResult => ({
  pickedBecause: "ROUTINE", factId, family: "comment-access", area: `area-${factId}`, verdict, checkedAt, sourceUrl: "https://a.example.gov/", reread: null,
  basis: "REREAD", checks: [], reason: "r", ...over });

test("nothing audited reads a dash, never 0%", () => {
  const r = weeklyAuditAccuracy({ results: [], corrections: [], now: NOW });
  assert.equal(r.sentence, "—");
  assert.equal(r.accuratePercent, null);
  assert.match(r.notMeasured ?? "", /No published fact/);
});

test("the sentence counts facts the audit could judge, once each by the latest result, and names what was fixed", () => {
  const results = [
    result("a", "GREEN", "2026-10-01T00:00:00.000Z"),
    result("b", "RED", "2026-10-02T00:00:00.000Z"),
    result("b", "GREEN", "2026-10-04T00:00:00.000Z"),
    result("c", "RED", "2026-10-03T00:00:00.000Z"),
    result("d", "GREEN", "2026-10-03T00:00:00.000Z", { pickedBecause: "DEMAND" }),
    result("e", "INCONCLUSIVE", "2026-10-03T00:00:00.000Z"),
    result("old", "RED", "2026-09-01T00:00:00.000Z"),
  ];
  const corrections: AuditCorrection[] = [
    { factId: "c", action: "FIXED", at: "2026-10-03T06:00:00.000Z", summary: "The comment rule now says five minutes." },
    { factId: "old", action: "PULLED", at: "2026-09-01T06:00:00.000Z", summary: "too old for this week" },
  ];
  const r = weeklyAuditAccuracy({ results, corrections, now: NOW });
  assert.deepEqual([r.audited, r.stillRight, r.wrong, r.couldNotJudge], [4, 3, 1, 1]);
  assert.equal(r.accuratePercent, 75);
  assert.equal(r.sentence, "Of 4 facts audited this week, 75% are still accurate. Here is the one we fixed.");
  assert.deepEqual(r.fixedFacts.map((f) => [f.factId, f.area]), [["c", "area-c"]]);
  assert.equal(r.byReason.DEMAND, 1);
  assert.equal(r.byReason.ROUTINE, 4);
});

test("pulled facts are named as pulled; the old coverage report rides as a second line", () => {
  const r = weeklyAuditAccuracy({
    results: [result("x", "RED", "2026-10-04T00:00:00.000Z"), result("y", "GREEN", "2026-10-04T00:00:00.000Z")],
    corrections: [{ factId: "x", action: "PULLED", at: "2026-10-04T01:00:00.000Z", summary: "Taken off the page." }],
    now: NOW,
    coverage: { validated: 20, audited: 20, modelReviewed: 4, broke: 1, strata: 3, strataModelReviewed: 3, auditedPercent: 100, modelReviewedPercent: 20,
      strataModelReviewedPercent: 100, sourcesCheckedPercent: null, recordsExtractedPercent: null },
  });
  assert.match(r.sentence, /50% are still accurate\. Here is the one we pulled\.$/);
  assert.equal(r.coverageLine, "100% of the 20 checked results were audited, 20% had a closer second look.");
  assert.equal(coverageLineFrom(null), null);
});
