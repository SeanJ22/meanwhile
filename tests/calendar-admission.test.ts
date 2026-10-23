import assert from "node:assert/strict";
import test from "node:test";
import { REGISTRY_STATES } from "../lib/civic-data/state-scopes.ts";
import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import { routinePassLaunchOrder, routineTaskDeadlineMs, routineTaskFromContract } from "../lib/civic-data/runner.ts";

test("a calendar never read is overdue in every state, ahead of unrelated baselines and the existing states' next reads", () => {
  const now = Date.parse("2026-10-22T20:00:00.000Z");
  const calendars = REGISTRY_STATES.map(state => {
    const contract = MEETING_PARTITION_CONTRACTS.find(partition => partition.derivedFamily === `US-${state}`);
    assert.ok(contract, `${state} has a standing calendar family`);
    const task = routineTaskFromContract(contract);
    return { state, task, deadlineMs: routineTaskDeadlineMs(task, undefined) };
  });
  assert.ok(calendars.every(calendar => calendar.deadlineMs === Number.NEGATIVE_INFINITY));
  const existing = ["AZ", "NH", "NJ"].map(state => ({ state: `existing-${state}`, task: { sourceId: "meetings-public-bodies" }, deadlineMs: now - 60_000 }));
  const baseline = { state: "unrelated-national-baseline", task: { sourceId: "national-people" }, baselineOwed: true };
  const order = routinePassLaunchOrder([baseline, ...existing, ...calendars], now);
  assert.deepEqual(order.slice(0, calendars.length).map(item => item.state), [...REGISTRY_STATES]);
  assert.deepEqual(order.slice(calendars.length).map(item => item.state), ["existing-AZ", "existing-NH", "existing-NJ", "unrelated-national-baseline"]);
});

test("unknown and future deadlines stay behind overdue calendars without turning invalid values into overdue work", () => {
  const now = Date.now();
  const order = routinePassLaunchOrder([
    { id: "nan", deadlineMs: Number.NaN }, { id: "future", deadlineMs: now + 1 },
    { id: "unknown" }, { id: "never", deadlineMs: Number.NEGATIVE_INFINITY }, { id: "later", deadlineMs: Number.POSITIVE_INFINITY },
  ], now);
  assert.equal(order[0]!.id, "never");
  assert.equal(order.at(-1)!.id, "later");
});
