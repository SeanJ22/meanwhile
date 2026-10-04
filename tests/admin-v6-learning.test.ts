/**
 * **THE "IS IT LEARNING" VIEW STATES ONLY WHAT IS MEASURED.** A week with no
 * record is a gap, never a zero; a question nothing measures is listed as
 * "not measured yet" with what it needs.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { buildLearningTrends, type WeekLearningRow } from "../lib/control-plane/admin-view/learning-trends.ts";
import { v6LearningView } from "../lib/control-plane/admin-view/v6-learning-read.ts";

const week = (wk: string, over: Partial<WeekLearningRow> = {}): WeekLearningRow => ({
  week: wk, walks: 10, pairRecorded: 10, handed: 4, usedRecorded: 4, usedWalks: 2, reusedDoors: 3,
  rebuiltRecorded: 10, rebuiltRoutes: 1, resumed: 5, resumedFound: 3, fresh: 5, freshFound: 1, found: 4, usd: 2, unpriced: 0, ...over,
});

test("measured weeks become columns, a week between them is a gap, and the numbers keep their denominators", () => {
  const trends = buildLearningTrends([week("2026-09-14"), week("2026-09-28")], "2026-09-30T12:00:00.000Z");
  const view = v6LearningView(trends, { walks: 6, given: 12, used: 5, since: "2026-09-25" });
  const manual = view.trends.find((t) => t.question.startsWith("Are ways in learned"));
  assert.ok(manual, "the manual trend is drawn");
  assert.deepEqual(manual.weeks.map((w) => w.week), ["2026-09-14", "2026-09-21", "2026-09-28"]);
  assert.equal(manual.weeks[1].values, null, "the week with no walk is a gap, not a zero");
  assert.deepEqual(manual.weeks[0].values, [40, 50]);
  assert.equal(manual.format, "pct");
  assert.equal(view.readings[0].big, "5 of 12");
});

test("nothing recorded yields no trend and says what each unmeasured question needs", () => {
  const view = v6LearningView(buildLearningTrends([], "2026-09-30T12:00:00.000Z"), null);
  assert.equal(view.trends.length, 0);
  assert.equal(view.readings.length, 0);
  assert.ok(view.notMeasured.length >= 5);
  for (const n of view.notMeasured) assert.ok(n.why.length > 0 && n.needs.length > 0, n.question);
});

test('Bank write errors show a measured zero, a count, or an unavailable number', () => {
  const trends = buildLearningTrends([], '2026-10-04T00:00:00Z');
  for (const count of [0, 3, null]) {
    const view = v6LearningView(trends, null, count);
    assert.equal(view.readings.find(r => r.bigNote === 'Bank write errors')!.big, count === null ? '—' : String(count));
  }
});
