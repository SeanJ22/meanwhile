import test from "node:test";
import assert from "node:assert/strict";
import { coverageLearning, weeklyFactRates } from "../lib/control-plane/admin-view/factory-learning.ts";

const first = { subjectId: "synthetic-government", targetSet: "same-owed-facts", ordinal: 1 as const,
  startedAt: "2026-10-01T00:00:00Z", coveredAt: "2026-10-01T01:00:00Z", headStartOnly: false };
const second = { ...first, ordinal: 2 as const, startedAt: "2026-10-02T00:00:00Z", coveredAt: "2026-10-02T00:15:00Z", headStartOnly: true };
test("second coverage compares complete same-government same-target runs without counting replay", () => {
  assert.equal(coverageLearning([first, second, second]).secondCoverage.ratio, 0.25);
  assert.equal(coverageLearning([first, { ...second, targetSet: "fewer-facts" }]).secondCoverage.pairs, 0);
  assert.equal(coverageLearning([first, { ...second, subjectId: "other-government" }]).secondCoverage.pairs, 0);
  assert.equal(coverageLearning([first, { ...second, coveredAt: "invalid" }]).secondCoverage.pairs, 0);
  assert.equal(coverageLearning([first, { ...second, startedAt: first.startedAt }]).secondCoverage.pairs, 0);
  assert.equal(coverageLearning([]).secondCoverage.ratio, null);
});
test("head-start hit rate counts solved target outcomes, preserving unknowns and failed targets", () => {
  const a = { attemptId: "a", targetId: "a", solved: true, headStartOnly: true };
  const reading = coverageLearning([], [a, a, { ...a, targetId: "b", solved: false }, { ...a, targetId: "c", headStartOnly: null }]);
  assert.deepEqual(reading.headStart, { solved: 1, measured: 2, share: 0.5 });
  assert.equal(coverageLearning([first, second]).headStart.share, null, "door or government coverage does not invent target outcomes");
});
test("facts per hour uses only the observed part of each week and preserves gaps", () => {
  const reading = weeklyFactRates([{ week: "2026-10-05T00:00:00Z", facts: 24 }], "2026-10-05T12:00:00Z", "2026-10-06T00:00:00Z");
  assert.equal(reading[0].observedHours, 12);
  assert.equal(reading[0].perHour, 2);
  assert.deepEqual(weeklyFactRates([], "2026-10-05T12:00:00Z", "2026-10-06T00:00:00Z"), []);
});
