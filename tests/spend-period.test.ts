import assert from "node:assert/strict";
import test from "node:test";
import { tierSpendForPeriod } from "../lib/control-plane/admin-view/spend-period.ts";

const spend = {
  byDay: [
    { day: "2026-10-01", byModel: [{ name: "Haiku 4.5", usd: 1 }, { name: "Sonnet 5.5", usd: 0.5 }] },
    { day: "2026-09-28", byModel: [{ name: "Haiku 4.5", usd: 2 }] },
    { day: "2026-09-05", byModel: [{ name: "Opus 5.5", usd: 4 }] },
  ],
  byMonth: [{ month: "2026-10", byTier: [{ name: "Haiku 4.5", usd: 1 }] }, { month: "2026-09", byTier: [{ name: "Opus 5.5", usd: 9 }, { name: "Haiku 4.5", usd: 3 }] }],
};
const now = new Date("2026-10-01T22:00:00Z");

test("Today, Last 7 days and Last 30 days sum the Eastern days inside them", () => {
  assert.deepEqual(tierSpendForPeriod(spend, "today", now), [{ name: "Haiku 4.5", usd: 1 }, { name: "Sonnet 5.5", usd: 0.5 }]);
  assert.deepEqual(tierSpendForPeriod(spend, "last-7d", now), [{ name: "Haiku 4.5", usd: 3 }, { name: "Sonnet 5.5", usd: 0.5 }]);
  assert.deepEqual(tierSpendForPeriod(spend, "last-30d", now), [{ name: "Opus 5.5", usd: 4 }, { name: "Haiku 4.5", usd: 3 }, { name: "Sonnet 5.5", usd: 0.5 }]);
});

test("a month is its own line, and a period with no priced charge has no figure, never zero", () => {
  assert.deepEqual(tierSpendForPeriod(spend, "2026-09", now), [{ name: "Opus 5.5", usd: 9 }, { name: "Haiku 4.5", usd: 3 }]);
  assert.equal(tierSpendForPeriod(spend, "2026-08", now), null);
  assert.equal(tierSpendForPeriod({ byDay: [], byMonth: [] }, "today", now), null);
  assert.equal(tierSpendForPeriod(spend, "whole-hunt", now), null);
});
