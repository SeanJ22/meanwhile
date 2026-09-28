import assert from "node:assert/strict";
import test from "node:test";
import { continuingDirectedHunt } from "../lib/control-plane/scheduler/hunt-continuation.ts";
import { currentScoutsForHunt, huntActivity } from "../lib/control-plane/admin-view/hunt-activity.ts";
import { pulseRevision } from "../lib/control-plane/live-pulse.ts";
import type { ExpansionScopeDecision } from "../lib/control-plane/expansion/scopes.ts";
import type { ExpansionCycleReading } from "../lib/control-plane/expansion/reading.ts";
import type { AssignmentCycleReading } from "../lib/control-plane/expansion/assignment-budget.ts";
import type { AssignmentListRow } from "../lib/control-plane/assignment-view.ts";

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

test("Admin stage counts use exact Send marks and separate publication from reader readback", () => {
  const row = (id: string, extra: Partial<AssignmentListRow>): AssignmentListRow => ({
    id, assignmentKeys: [scope.key], lastActivityAt: "2026-09-27T01:00:00Z", discovered: null, parsed: null,
    verification: null, promoted: null, publiclyAvailable: null, workers: null, ...extra,
  } as AssignmentListRow);
  const activity = huntActivity([
    row("found", { discovered: { routes: 1, records: 0, pointers: 0, sourceRows: null }, workers: [{ role: "SCOUT", model: { kind: "MODEL", id: "haiku" }, attempts: 1 }] }),
    row("approved", { parsed: { succeeded: 1, failed: 0, usable: null }, verification: { unit: "pipeline item", items: 1, passed: 1, needsMoreEvidence: 0, rejected: 0, refusedFinishes: 0 }, promoted: "PROMOTED" }),
    row("served", { promoted: "PROMOTED", publiclyAvailable: "CONFIRMED" }),
    row("partial-check", { verification: { unit: "validation check", items: 3, passed: 1, needsMoreEvidence: 2, rejected: 0, refusedFinishes: 0 } }),
    row("other", { assignmentKeys: ["another-send"], publiclyAvailable: "CONFIRMED" }),
  ], scope.key);
  assert.equal(activity.listed, 4);
  assert.deepEqual(activity.stages, { found: 1, parsed: 1, verified: 2, promoted: 2, live: 1 });
  assert.deepEqual(activity.roles, [["SCOUT · haiku", 1]]);
});

test("a next-cycle heartbeat update refreshes Admin even when beatAt is unchanged", () => {
  const prior = { beatAt: "2026-09-27T01:00:00Z", heartbeatRevision: 4, snapshotRevision: 1,
    decisionCount: 0, researchRevision: 1, receiptCount: 0, researchIntentCount: 0, sourceProgressId: null };
  assert.notEqual(pulseRevision(prior), pulseRevision({ ...prior, heartbeatRevision: 5 }));
});

test("current Scout activity is attributed to the exact Send rather than the fleet", () => {
  const running = [
    { attemptId: "one", obligationId: "a", startedAt: "2026-09-27T01:00:00Z", assignmentKeys: [scope.key] },
    { attemptId: "two", obligationId: "b", startedAt: "2026-09-27T01:00:00Z", assignmentKeys: ["other"] },
  ];
  assert.equal(currentScoutsForHunt(running, scope.key), 1);
  assert.equal(currentScoutsForHunt(running, "unknown"), 0);
  assert.equal(currentScoutsForHunt([{ attemptId: "older", obligationId: "a", startedAt: "2026-09-27T01:00:00Z" }], scope.key), null);
});
