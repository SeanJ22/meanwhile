import assert from "node:assert/strict";
import test from "node:test";
import { ORIGINAL_LIFETIME_HUNT, originalLifetimeHuntContinuation } from "../lib/control-plane/scheduler/hunt-continuation.ts";
import type { ExpansionScopeDecision } from "../lib/control-plane/expansion/scopes.ts";
import type { ExpansionCycleReading } from "../lib/control-plane/expansion/reading.ts";
import type { AssignmentCycleReading } from "../lib/control-plane/expansion/assignment-budget.ts";

const scope = { ...ORIGINAL_LIFETIME_HUNT, geography: { label: "ZIP 85635" } } as ExpansionScopeDecision;
const expansion = (due: number, dispatched: number) => ({ scopes: [{ key: scope.key, work: { dueThisCycle: due, dispatchedThisCycle: dispatched } }] }) as unknown as ExpansionCycleReading;
const assignments = (leftUsd: number | null, refused = 0) => ({ costsReadable: true, assignments: [{ key: scope.key, ref: scope.receiptId,
  completion: { kind: "NOT_COMPLETE", assignmentKey: scope.key, members: 1, settled: 0,
    unsettledCount: 1, refusedCount: 0, exceptions: [] }, budget: { lifetime: true, since: scope.budgetStartedAt, spentUsd: leftUsd === null ? null : 50 - leftUsd,
    leftUsd, refused, admitted: 0 } }] }) as unknown as AssignmentCycleReading;

test("every funded hunt continues promptly after progress using its own budget and receipt", () => {
  assert.deepEqual(originalLifetimeHuntContinuation([scope], expansion(20, 4), assignments(12), 3), {
    key: scope.key, label: "ZIP 85635", due: 20, dispatched: 4, delayMs: 60_000, reason: "DUE_AFTER_PROGRESS",
  });
  assert.ok(originalLifetimeHuntContinuation([{ ...scope, budgetUsd: 51 }], expansion(20, 4), assignments(12), 0));
  assert.equal(originalLifetimeHuntContinuation([{ ...scope, receiptId: "another-send" }], expansion(20, 4), assignments(12), 0), null);
  assert.equal(originalLifetimeHuntContinuation([scope], expansion(20, 4), assignments(0), 0), null);
  assert.equal(originalLifetimeHuntContinuation([scope], expansion(20, 4), assignments(null), 0), null);
});

test("zero-dispatch retries back off without an arbitrary count barrier, while budget refusal stops fast retries", () => {
  assert.equal(originalLifetimeHuntContinuation([scope], expansion(20, 0), assignments(12), 0)?.delayMs, 5 * 60_000);
  assert.equal(originalLifetimeHuntContinuation([scope], expansion(20, 0), assignments(12), 1)?.delayMs, 15 * 60_000);
  assert.equal(originalLifetimeHuntContinuation([scope], expansion(20, 0), assignments(12), 2)?.delayMs, 15 * 60_000);
  assert.equal(originalLifetimeHuntContinuation([scope], expansion(20, 0), assignments(12, 1), 0), null);
});

test("downstream work keeps the exact hunt moving after standing due work is dispatched", () => {
  assert.equal(originalLifetimeHuntContinuation([scope], expansion(4, 4), assignments(12), 0)?.delayMs, 60_000);
  assert.equal(originalLifetimeHuntContinuation([scope], expansion(0, 0), assignments(12), 0)?.delayMs, 5 * 60_000);
  assert.equal(originalLifetimeHuntContinuation([scope], expansion(0, 0), assignments(12), 2)?.delayMs, 15 * 60_000);
  const completed = { ...assignments(12), assignments: [{ ...assignments(12).assignments[0],
    completion: { kind: "COMPLETE", assignmentKey: scope.key, members: 1, satisfied: [] } }] } as AssignmentCycleReading;
  assert.equal(originalLifetimeHuntContinuation([scope], expansion(0, 0), completed, 0), null);
});
