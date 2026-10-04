import assert from "node:assert/strict";
import test from "node:test";
import { huntersTheDialBuys, researchPaidWorkerCapacity, scoutRequestUsd } from "../lib/control-plane/scheduler/research-policy.ts";

test("the dial's hunters are the runner's own paid-capacity math at the same request price", () => {
  const n = huntersTheDialBuys({ dailyLimitUsd: 20, spentLast24hUsd: 5 });
  assert.equal(n, researchPaidWorkerCapacity({ modelEnabled: true, spentUsd: 5, ceilingUsd: 20, requestUsd: scoutRequestUsd() }));
  assert.ok(n !== null && n > 0);
});

test("a bigger daily limit buys at least as many hunters, and spending the limit buys none", () => {
  const small = huntersTheDialBuys({ dailyLimitUsd: 5, spentLast24hUsd: 0 })!;
  const big = huntersTheDialBuys({ dailyLimitUsd: 50, spentLast24hUsd: 0 })!;
  assert.ok(big >= small);
  assert.equal(huntersTheDialBuys({ dailyLimitUsd: 5, spentLast24hUsd: 5 }), 0);
});

test("a provider request rate caps the hunters", () => {
  assert.equal(huntersTheDialBuys({ dailyLimitUsd: 1000, spentLast24hUsd: 0, requestsPerMinute: 3 }), 3);
});

test("an unread limit or unread spend shows no number, never zero", () => {
  assert.equal(huntersTheDialBuys({ dailyLimitUsd: null, spentLast24hUsd: 0 }), null);
  assert.equal(huntersTheDialBuys({ dailyLimitUsd: 20, spentLast24hUsd: null }), null);
});
