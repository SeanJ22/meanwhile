import assert from "node:assert/strict";
import test from "node:test";
import { assignmentMembership, type AssignmentMember, type AssignmentMembership } from "../lib/control-plane/expansion/assignment-budget.ts";
import { COMPLETION_EXCEPTION_CAP, evaluateAssignmentFromRecords, evaluateMissionDone, memberRecordsForSend, type MemberRecord } from "../lib/control-plane/assignment-completion.ts";
import { DiskRows } from "../lib/control-plane/scheduler/disk-rows.ts";
import { createPlannerSpool } from "../lib/control-plane/scheduler/planner-spool.ts";
import { instructionReceiptKey, type ObligationAssignment } from "../lib/control-plane/scheduler/obligation.ts";

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
    const records = memberRecordsForSend(key, membership, id => rows.read(id), ref, planner);
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

test("each Send resolves only its members and never copies a place's source plan or the country's records", async () => {
  const planner = await createPlannerSpool();
  try {
    const key = "scope:az", ref = "receipt:current", early = "2026-10-20T00:00:00.000Z", late = "2026-10-20T01:00:00.000Z";
    const entry = { assignmentKey: "prior", relation: "REORDERED", at: early };
    const held: MemberRecord = { id: "created", assignments: [Object.defineProperty({ ...entry }, "questions", {
      enumerable: true, get: () => { throw new Error("the Send copied unrelated question history"); },
    })], lastWorkedAt: early, openOccurrenceId: null, nextDueAt: late, absentUntil: null, instructionJoinedAt: early };
    Object.defineProperty(held, "autonomousPlan", { enumerable: true, get: () => { throw new Error("the Send copied a full source plan"); } });
    const member = (id: string, joinedAt = early): AssignmentMember => ({ obligationId: id, subjectId: `subject:${id}`, joinedAt });
    const slot = { created: new Map([member("created"), member("duplicate"), member("missing")].map(row => [row.obligationId, row])),
      reordered: new Map([member("reordered"), member("duplicate", late)].map(row => [row.obligationId, row])) };
    const membership: AssignmentMembership = { byKey: new Map([[key, slot]]), byInstruction: new Map([[instructionReceiptKey(key, ref), slot]]),
      keysOf: new Map(), refsOf: new Map() };
    const lookups: string[] = [];
    const readRecord = Object.assign((id: string): MemberRecord | undefined => {
      lookups.push(id);
      assert.ok(["created", "duplicate", "missing", "reordered"].includes(id), "an unrelated place was looked up");
      return id === "created" ? held : id === "missing" ? undefined : { id, lastWorkedAt: early };
    }, { [Symbol.iterator]: () => { throw new Error("a Send attempted a country scan"); } });
    const native = memberRecordsForSend(key, membership, readRecord, ref);
    const order = ["created", "duplicate", "missing", "reordered", "duplicate"];
    assert.deepEqual(lookups, order, "created members precede reordered members, including repeated identities");
    assert.deepEqual(native[0], { id: "created", assignments: [entry, { assignmentKey: key, relation: "CREATED", at: early }],
      lastWorkedAt: early, openOccurrenceId: null, nextDueAt: late, absentUntil: null, instructionJoinedAt: early,
    });
    assert.deepEqual(native[2], { id: "missing", instructionJoinedAt: early,
      assignments: [{ assignmentKey: key, relation: "CREATED", at: early }] }, "a missing member remains unsettled");
    assert.deepEqual(native.map(row => row.id), order, "the native result preserves duplicate submissions");
    lookups.length = 0;
    const disk = memberRecordsForSend(key, membership, readRecord, ref, planner);
    assert.deepEqual(lookups, [], "a disk reading does not hydrate the whole Send before its cooperative consumer starts");
    assert.ok(disk instanceof DiskRows);
    assert.deepEqual([...disk].map(row => row.id), ["created", "duplicate", "missing", "reordered"]);
    assert.deepEqual(lookups, ["created", "duplicate", "missing", "reordered"], "only final selected member values are hydrated, in created-before-reordered order");
    const duplicate = [...disk].find(row => row.id === "duplicate")!;
    assert.equal(duplicate.instructionJoinedAt, late, "the last duplicate value replaces the first at its original output position");
    assert.deepEqual(duplicate.assignments, [{ assignmentKey: key, relation: "CREATED", at: late }], "created membership governs the relation even on its later reordered copy");
    const before = lookups.length;
    assert.deepEqual(memberRecordsForSend("scope:foreign", membership, readRecord), []);
    assert.equal(lookups.length, before, "a different Send does not read anything");
    for (const row of disk) assert.ok(Object.keys(row).every(field => ["id", "assignments", "lastWorkedAt", "openOccurrenceId", "nextDueAt", "absentUntil", "instructionJoinedAt"].includes(field)));
  } finally { await planner.close(); }
});
