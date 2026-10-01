import assert from "node:assert/strict";
import test from "node:test";
import { continuingDirectedHunt } from "../lib/control-plane/scheduler/hunt-continuation.ts";
import { pulseRevision } from "../lib/control-plane/live-pulse.ts";
import type { ExpansionScopeDecision } from "../lib/control-plane/expansion/scopes.ts";
import type { ExpansionCycleReading } from "../lib/control-plane/expansion/reading.ts";
import type { AssignmentCycleReading } from "../lib/control-plane/expansion/assignment-budget.ts";

const scope = { key: "scope:one", receiptId: "send:one", budgetStartedAt: "2026-09-27T00:00:00Z", geography: { label: "Selected place" } } as ExpansionScopeDecision;
const expansion = { scopes: [{ key: scope.key, work: { dueThisCycle: 30, dispatchedThisCycle: 10 } }] } as unknown as ExpansionCycleReading;
const assignments = { assignments: [{ key: scope.key, ref: scope.receiptId, completion: { kind: "NOT_COMPLETE" } }] } as unknown as AssignmentCycleReading;

test("a directed hunt continues promptly when its own cycle dispatched work and left due members", () => {
  assert.deepEqual(continuingDirectedHunt([scope], expansion, assignments), { key: scope.key, label: "Selected place", due: 30, dispatched: 10 });
  assert.equal(continuingDirectedHunt([scope], { ...expansion, scopes: [{ key: scope.key, work: { dueThisCycle: 30, dispatchedThisCycle: 0 } }] } as unknown as ExpansionCycleReading, assignments), null);
  assert.equal(continuingDirectedHunt([scope], { ...expansion, scopes: [{ key: scope.key, work: { dueThisCycle: 10, dispatchedThisCycle: 10 } }] } as unknown as ExpansionCycleReading, assignments), null);
  assert.equal(continuingDirectedHunt([scope], expansion, { ...assignments, assignments: [{ key: scope.key, ref: scope.receiptId, completion: { kind: "COMPLETE" } }] } as unknown as AssignmentCycleReading), null);
  assert.equal(continuingDirectedHunt([scope], expansion, { ...assignments, assignments: [{ key: scope.key, ref: "older-send", completion: { kind: "NOT_COMPLETE" } }] } as unknown as AssignmentCycleReading), null);
  assert.equal(continuingDirectedHunt([{ ...scope, budgetStartedAt: undefined }], expansion, assignments), null);
});

test("a next-cycle heartbeat update refreshes Admin even when beatAt is unchanged", () => {
  const prior = { beatAt: "2026-09-27T01:00:00Z", heartbeatRevision: 4, snapshotRevision: 1,
    decisionCount: 0, researchRevision: 1, receiptCount: 0, researchIntentCount: 0, sourceProgressId: null };
  assert.notEqual(pulseRevision(prior), pulseRevision({ ...prior, heartbeatRevision: 5 }));
});
