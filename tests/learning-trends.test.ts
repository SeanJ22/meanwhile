/**
 * What the Scout results measure is drawn week by week; a week with no record is a gap, never a zero.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { buildLearningTrends, mondayOf, pointWords, weekRange, type WeekLearningRow } from "../lib/control-plane/admin-view/learning-trends.ts";

function row(week: string, over: Partial<WeekLearningRow> = {}): WeekLearningRow {
  return {
    week, walks: 10, pairRecorded: 10, handed: 4, usedRecorded: 4, usedWalks: 1, reusedDoors: 2, rebuiltRecorded: 10, rebuiltRoutes: 1,
    resumed: 5, resumedFound: 2, fresh: 5, freshFound: 1, found: 3, usd: 6, unpriced: 0, ...over,
  };
}

test("MW-027: the weeks run from the first record through now, and a week with no record is a gap in every series", () => {
  assert.equal(mondayOf("2026-09-25T12:00:00.000Z"), "2026-09-21");
  assert.equal(mondayOf("2026-09-21T00:00:00.000Z"), "2026-09-21");
  assert.deepEqual(weekRange("2026-09-07", "2026-09-25T12:00:00.000Z"), ["2026-09-07", "2026-09-14", "2026-09-21"]);

  const t = buildLearningTrends([row("2026-09-07"), row("2026-09-21", { usedRecorded: 0, usedWalks: 0, reusedDoors: 0, unpriced: 2 })], "2026-09-25T12:00:00.000Z");
  assert.deepEqual(t.weeks, ["2026-09-07", "2026-09-14", "2026-09-21"]);
  for (const s of Object.values(t.series)) assert.equal(s.points[1]!.value, null, `${s.key}: a week with no walk is a gap, never 0`);
  assert.equal(t.series.handed.points[0]!.value, 0.4);
  assert.equal(t.series.handed.points[0]!.of, 10);
  assert.equal(t.series.used.points[2]!.value, null, "a week whose walks do not record use is a gap");
  assert.equal(t.series.reused.points[2]!.value, null);
  assert.equal(t.series.perFind.points[0]!.value, 2);
  assert.equal(t.series.perFind.points[2]!.floor, true, "an unpriced walk makes the week's dollars a floor");
  assert.equal(pointWords("usd", t.series.perFind.points[2]!), "at least $2.00 over 3");
  assert.equal(pointWords("share", t.series.handed.points[0]!), "40% of 10");
  assert.equal(pointWords("share", t.series.handed.points[1]!), null);
  assert.equal(t.series.used.says, "Measured in 1 of 3 weeks; the other 2 hold no record of it — gaps, not zeros.");
  assert.match(t.escalations.says, /^None of the \d+ paid walks on record carries a model ladder: they ran before escalations were recorded \(MW-031, 2026-09-25\)/);
  assert.equal(t.escalations.ladderWalks, 0);

  // Walks that record their ladder are counted; older walks are named, never counted as 0.
  const withLadder = buildLearningTrends(
    [row("2026-09-07"), row("2026-09-21", { usedRecorded: 0, usedWalks: 0, reusedDoors: 0, unpriced: 2, ladderRecorded: 4, escalated: 1 })],
    "2026-09-25T12:00:00.000Z",
  );
  assert.equal(withLadder.escalations.recorded, 1);
  assert.match(withLadder.escalations.says, /^1 of 4 walks that recorded their model ladder escalated to a more capable model; \d+ earlier walks ran before the ladder was recorded\.$/);
});

test("MW-027: no rows means no weeks and no measured series, never a row of zeros", () => {
  const t = buildLearningTrends([], "2026-09-25T12:00:00.000Z");
  assert.deepEqual(t.weeks, []);
  assert.equal(t.series.handed.measuredWeeks, 0);
  assert.equal(t.series.handed.says, "Not recorded in any of the 0 weeks on record.");
  assert.equal(t.escalations.says, "No paid walk is on record, so no model escalation is either.");
});

test('route reuse splits by recorded finder and leaves unattributed history as a gap', () => {
  const trends = buildLearningTrends([row('2026-09-07'), row('2026-09-21', { finderAttributed: 5, scoutReusedDoors: 2, detectiveReusedDoors: 3 })], '2026-09-25T12:00:00Z');
  assert.equal(trends.series.detectiveReused.points[0]!.value, null);
  assert.equal(trends.series.detectiveReused.points[2]!.value, 3);
  assert.equal(trends.series.scoutReused.points[2]!.value, 2);
});
