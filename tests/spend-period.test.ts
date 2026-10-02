import assert from "node:assert/strict";
import test from "node:test";
import { moneySummary, tierSpendForPeriod } from "../lib/control-plane/admin-view/spend-period.ts";

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

const ledger = {
  byDay: [
    { day: "2026-10-01", searchUsd: 0.25, byModel: [{ name: "Haiku 4.5", usd: 1.1 }, { name: "Sonnet 5.5", usd: 0.4 }] },
    { day: "2026-09-30", searchUsd: 0.5, byModel: [{ name: "Haiku 4.5", usd: 2 }, { name: "Opus 5.5", usd: 3 }] },
  ],
  byMonth: [
    { month: "2026-10", searchUsd: 0.25, byTier: [{ name: "Haiku 4.5", usd: 1.1 }, { name: "Sonnet 5.5", usd: 0.4 }] },
    { month: "2026-09", searchUsd: 0.5, byTier: [{ name: "Haiku 4.5", usd: 2 }, { name: "Opus 5.5", usd: 3 }] },
  ],
};
const summarize = (period: string, held: number | null = 1.75) =>
  moneySummary({ spend: ledger, setAsideUsd: held, dailyLimitUsd: 100, period, now });

test("THE MONEY SUMMARY RECONCILES: the tiers add up to Spent, Today's settled charges never exceed a period that includes today", () => {
  for (const period of ["today", "last-7d", "last-30d", "2026-10", "2026-09"]) {
    const m = summarize(period);
    assert.equal(m.tiers === null ? null : Math.round(m.tiers.reduce((a, t) => a + t.usd, 0) * 1e4) / 1e4, m.spentUsd, period + ": tiers sum to Spent");
    if (period !== "2026-09") assert.ok(m.spentUsd !== null && m.todaySettledUsd !== null && m.todaySettledUsd <= m.spentUsd, period + ": today never above the period");
  }
  assert.equal(summarize("2026-10").spentUsd, 1.5);
  assert.equal(summarize("last-7d").spentUsd, 6.5);
  assert.equal(summarize("2026-09").spentUsd, 5);
  assert.equal(summarize("last-7d").searchUsd, 0.75);
});

test("Set aside is every open reservation now; Today is settled today plus set aside; Left is the daily limit minus Today, never the hunts' lifetime limits", () => {
  const m = summarize("2026-10");
  assert.equal(m.setAsideUsd, 1.75);
  assert.equal(m.todaySettledUsd, 1.5);
  assert.equal(m.todayUsd, 3.25);
  assert.equal(m.dailyLimitUsd, 100);
  assert.equal(m.leftUsd, 96.75);
  assert.equal(summarize("2026-09").todayUsd, 3.25, "Today does not move with the period picker");
  assert.equal(moneySummary({ spend: ledger, setAsideUsd: 0, dailyLimitUsd: 1, period: "today", now }).leftUsd, 0, "over the limit leaves nothing, not a negative");
});

test("the figures on screen add up: tiers are whole cents and Spent is their sum, even when the raw amounts do not round to it", () => {
  const raw = { byDay: [{ day: "2026-10-01", byModel: [{ name: "Haiku 4.5", usd: 1.0536 }, { name: "Sonnet 5.5", usd: 0.3547 }] }], byMonth: [] };
  const m = moneySummary({ spend: raw, setAsideUsd: 0, dailyLimitUsd: 100, period: "today", now });
  assert.deepEqual(m.tiers, [{ name: "Haiku 4.5", usd: 1.05 }, { name: "Sonnet 5.5", usd: 0.35 }]);
  assert.equal(m.spentUsd, 1.4, "1.05 + 0.35, not the raw 1.4083 shown as 1.41");
});

test("a figure the system does not have is null, never zero", () => {
  const none = moneySummary({ spend: null, setAsideUsd: null, dailyLimitUsd: null, period: "today", now });
  assert.deepEqual([none.spentUsd, none.searchUsd, none.setAsideUsd, none.todayUsd, none.leftUsd, none.tiers], [null, null, null, null, null, null]);
  assert.equal(summarize("today", null).todayUsd, null, "hunts not read: Today and Left are unknown");
  assert.equal(summarize("today", null).leftUsd, null);
  assert.equal(summarize("2026-08").spentUsd, null);
});
