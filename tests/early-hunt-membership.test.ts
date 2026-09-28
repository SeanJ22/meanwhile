import assert from "node:assert/strict";
import test from "node:test";
import { createWorkItem, type WorkItem } from "../lib/control-plane/work-item.ts";
import type { FreshnessOccurrence } from "../lib/control-plane/scheduler/durable.ts";
import type { FreshnessObligation } from "../lib/control-plane/scheduler/obligation.ts";
import { exactInstructionAutonomousWorkIds } from "../lib/control-plane/workers/coordinator.ts";

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
