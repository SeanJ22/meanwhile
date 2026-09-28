import assert from "node:assert/strict";
import test from "node:test";
import { createWorkItem, type WorkItem } from "../lib/control-plane/work-item.ts";
import type { FreshnessOccurrence } from "../lib/control-plane/scheduler/durable.ts";
import type { FreshnessObligation } from "../lib/control-plane/scheduler/obligation.ts";
import { autonomousCycleAllowed, exactInstructionAutonomousWorkIds } from "../lib/control-plane/workers/coordinator.ts";

test("filtered and explicitly paused cycles cannot start either autonomous slice", () => {
  const active = { dry: false, canary: false, only: null, ids: null, runnerPaused: false,
    scheduledBlackout: false, hasLifetimeHunt: true };
  assert.equal(autonomousCycleAllowed(active), true);
  for (const blocked of [{ only: "roster" }, { ids: new Set(["wi-1"]) }, { runnerPaused: true },
    { dry: true }, { canary: true }, { scheduledBlackout: true, hasLifetimeHunt: false }]) {
    assert.equal(autonomousCycleAllowed({ ...active, ...blocked }), false);
  }
  assert.equal(autonomousCycleAllowed({ ...active, scheduledBlackout: true }), true,
    "the exact original lifetime hunt retains its authorized blackout continuation");
});

test("an old original-hunt occurrence remains eligible without new ownerInstructions, while a later same-key Send does not inherit it", () => {
  const at = "2026-09-28T09:00:00Z";
  const original = createWorkItem({ project: "normal-work", subject: "fixture:body", obligation: "original period",
    why: "Historical original instruction", contract: { requiresValidation: true, requiresAudit: true }, now: at });
  const later = createWorkItem({ project: "normal-work", subject: "fixture:body", obligation: "later period",
    why: "New instruction", contract: { requiresValidation: true, requiresAudit: true }, now: "2026-09-28T11:00:00Z" });
  const child = { ...createWorkItem({ project: "normal-work", subject: "fixture:body", obligation: "repair child",
    why: "Retained original evidence", contract: { requiresValidation: true, requiresAudit: true }, now: at }),
    planRepair: { parentWorkItemId: original.id, authority: "WORK_INSTRUCTIONS_ONLY" } } as WorkItem;
  const unrelated = { ...child, id: "unrelated", subject: "fixture:other" };
  const key = "zcta:2020/85635";
  const obligations = [{ id: "standing", assignments: [
    { assignmentKey: key, ref: "original-receipt", at, relation: "CREATED" },
    { assignmentKey: key, ref: "new-receipt", at: "2026-09-28T10:00:00Z", relation: "REORDERED" },
  ] }] as unknown as FreshnessObligation[];
  const occurrence = (workItemId: string, openedAt: string): FreshnessOccurrence => ({
    id: `occ:${workItemId}`, obligationId: "standing", sequence: 1, dueAt: openedAt,
    workItemId, routeTaskId: `rt:${workItemId}`, openedAt, closedAt: null, disposition: null, unresolvedReason: null,
  });
  const admitted = exactInstructionAutonomousWorkIds({ obligations,
    occurrences: [occurrence(original.id, "2026-09-28T09:30:00Z"), occurrence(later.id, "2026-09-28T11:00:00Z")],
    workItems: [original, later, child, unrelated], assignmentKey: key, receiptId: "original-receipt" });
  assert.equal(admitted.has(original.id), true);
  assert.equal(admitted.has(child.id), true);
  assert.equal(admitted.has(later.id), false);
  assert.equal(admitted.has(unrelated.id), false);
});

test("effective receipt uses instants, and conflicting same-instant marks fail closed", () => {
  const item = createWorkItem({ project: "normal-work", subject: "fixture:body", obligation: "period",
    why: "Exact receipt control", contract: { requiresValidation: true, requiresAudit: true }, now: "2026-09-28T16:30:00Z" });
  const occurrence: FreshnessOccurrence = { id: "occ", obligationId: "standing", sequence: 1,
    dueAt: "2026-09-28T16:30:00Z", workItemId: item.id, routeTaskId: "route", openedAt: "2026-09-28T16:30:00Z",
    closedAt: null, disposition: null, unresolvedReason: null };
  const key = "zcta:2020/85635";
  const original = { assignmentKey: key, ref: "original-receipt", at: "2026-09-28T09:00:00-07:00", relation: "CREATED" };
  const olderNew = { assignmentKey: key, ref: "new-receipt", at: "2026-09-28T15:30:00Z", relation: "REORDERED" };
  const select = (marks: unknown[]) => exactInstructionAutonomousWorkIds({
    obligations: [{ id: "standing", assignments: marks }] as unknown as FreshnessObligation[],
    occurrences: [occurrence], workItems: [item], assignmentKey: key, receiptId: "original-receipt" });
  assert.equal(select([original, olderNew]).has(item.id), true,
    "09:00-07:00 is later than 15:30Z despite its lexically earlier hour");
  assert.equal(select([original, { ...olderNew, at: "2026-09-28T16:00:00Z" }]).has(item.id), false,
    "two receipts at the same instant cannot choose an owner by string order");
  assert.equal(select([original, { ...olderNew, at: "invalid" }]).has(item.id), false);
});
