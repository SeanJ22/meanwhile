import assert from "node:assert/strict";
import test from "node:test";
import { continuingDirectedHunt } from "../lib/control-plane/scheduler/hunt-continuation.ts";
import { huntActivity } from "../lib/control-plane/admin-view/hunt-activity.ts";
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
    row("other", { assignmentKeys: ["another-send"], publiclyAvailable: "CONFIRMED" }),
  ], scope.key);
  assert.equal(activity.listed, 3);
  assert.deepEqual(activity.stages, { found: 1, parsed: 1, verified: 1, promoted: 2, live: 1 });
  assert.deepEqual(activity.roles, [["SCOUT · haiku", 1]]);
});
