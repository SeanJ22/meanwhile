import assert from "node:assert/strict";
import test from "node:test";
import { assignmentMembership } from "../lib/control-plane/expansion/assignment-budget.ts";
import { COMPLETION_EXCEPTION_CAP, evaluateAssignmentFromRecords, evaluateMissionDone, memberRecordsForSend } from "../lib/control-plane/assignment-completion.ts";
import { DiskRows } from "../lib/control-plane/scheduler/disk-rows.ts";
import { createPlannerSpool } from "../lib/control-plane/scheduler/planner-spool.ts";
import type { ObligationAssignment } from "../lib/control-plane/scheduler/obligation.ts";

test("Send membership and completion stream every member while retaining only exact disk lookups and bounded exceptions", async () => {
  const planner = await createPlannerSpool();
  try {
    const key = "scope:test", ref = "receipt:test", now = "2026-10-20T00:00:00.000Z";
    const rows = planner.table<{ id: string; subjectId: string; assignments: ObligationAssignment[]; lastWorkedAt?: string; nextDueAt?: string }>("test-assignment-work", row => row.id);
    for (let n = 0; n < 2_000; n += 1) rows.add({ id: `o${String(n).padStart(4, "0")}`, subjectId: `subject:${n}`,
      assignments: [{ assignmentKey: key, ref, relation: n % 2 ? "REORDERED" : "CREATED", at: now }],
      ...(n % 2 ? { lastWorkedAt: now, nextDueAt: now } : {}) });
    const membership = assignmentMembership(rows.rows, [], planner);
    assert.equal(membership.keysOf instanceof Map, false);
    const slot = membership.byKey.get(key)!;
    assert.equal(slot.created instanceof Map, false);
    assert.equal(slot.created.size, 1_000);
    assert.equal(slot.reordered.size, 1_000);
    assert.deepEqual(membership.keysOf.get("o1999"), [key]);
    const records = memberRecordsForSend(key, membership, rows.rows, ref, planner);
    assert.ok(records instanceof DiskRows);
    assert.equal(records.length, 2_000);
    const debtFor = (id: string) => id === "o1999" ? { consecutiveFailures: 1, detail: "not read", retryAt: now } : null;
    const completion = evaluateAssignmentFromRecords({ assignmentKey: key, obligations: records, debtFor, now });
    assert.equal(completion.kind, "NOT_COMPLETE");
    if (completion.kind !== "NOT_COMPLETE") return;
    assert.equal(completion.members, 2_000);
    assert.equal(completion.settled, 999);
    assert.equal(completion.refusedCount, 1);
    assert.equal(completion.unsettledCount, 1_000);
    assert.equal(completion.exceptions.length, COMPLETION_EXCEPTION_CAP);
    const mission = evaluateMissionDone({ assignmentKey: key, obligations: records, debtFor, map: { owed: 2_000, unfilled: 1, stale: 0, before: 1 } });
    assert.equal(mission.kind, "NOT_COMPLETE");
    if (mission.kind !== "NOT_COMPLETE") return;
    assert.equal(mission.settled, 1_000);
    assert.equal(mission.refusedCount, 1);
    assert.equal(mission.unsettledCount, 1_001);
    assert.equal(mission.exceptions.length, COMPLETION_EXCEPTION_CAP);
  } finally { await planner.close(); }
});
