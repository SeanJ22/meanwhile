import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { meetingReaderRecords } from "../lib/meetings/reader-records.ts";
import { outcomeEvidenceFor, useOutcomeSnapshotForTests } from "../lib/outcomes/store.ts";
import type { OutcomeSnapshot } from "../lib/outcomes/types.ts";
import { GET } from "../app/api/agenda/route.ts";

const held = JSON.parse(readFileSync("data/states/az/outcomes/legistar-outcomes.json", "utf8")) as OutcomeSnapshot;

test("every held sitting reaches the real agenda route with the same class-filtered records as Ask", async () => {
  assert.ok(held.sittings.length >= 20);
  let actions = 0;
  let votes = 0;
  for (const sitting of held.sittings) {
    const response = await GET(new Request(`http://localhost/api/agenda?meetingId=${encodeURIComponent(sitting.meetingId)}`));
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.meetingId, sitting.meetingId);
    assert.equal(payload.documentCount, payload.documents.length);
    assert.equal(payload.records.bodyId, sitting.bodyId);
    assert.deepEqual(payload.records.actions, outcomeEvidenceFor({ meetingId: sitting.meetingId, bodyId: sitting.bodyId, questionClass: "WHAT_WAS_DECIDED" }).records.filter((r) => r.recordClass === "ACTION_SUMMARY"));
    assert.deepEqual(payload.records.rollCalls, outcomeEvidenceFor({ meetingId: sitting.meetingId, bodyId: sitting.bodyId, questionClass: "HOW_DID_THEY_VOTE" }).records.filter((r) => r.recordClass === "ROLL_CALL"));
    assert.equal(payload.records.counts.actions, payload.records.actions.length);
    assert.equal(payload.records.counts.rollCalls, payload.records.rollCalls.length);
    actions += payload.records.counts.actions;
    votes += payload.records.counts.votes;
  }
  assert.equal(actions, held.sittings.reduce((n, s) => n + s.outcomes.length, 0));
  assert.equal(votes, held.sittings.reduce((n, s) => n + s.rollCalls.reduce((sum, r) => sum + r.votes.length, 0), 0));
  assert.ok(actions > 500);
  assert.ok(votes > 2000);
});

test("vendor/event ambiguity and a different body cannot inherit recorded actions", () => {
  const sitting = held.sittings[0];
  assert.equal(meetingReaderRecords(sitting.meetingId, "another-body").status, "IDENTITY_UNRESOLVED");
  assert.equal(meetingReaderRecords(sitting.meetingId.replace("pima", "another-tenant")).status, "NOT_HELD");
  try {
    useOutcomeSnapshotForTests({ ...held, sittings: [sitting, { ...sitting, bodyId: "another-body" }] });
    const result = meetingReaderRecords(sitting.meetingId);
    assert.equal(result.status, "IDENTITY_UNRESOLVED");
    assert.equal(result.counts.actions, 0);
    assert.equal(result.counts.votes, 0);
  } finally { useOutcomeSnapshotForTests(null); }
});

test("an agenda never supplies a decision or inferred per-member vote", () => {
  const sitting = held.sittings[0];
  try {
    useOutcomeSnapshotForTests({ ...held, sittings: [{ ...sitting, outcomes: [], rollCalls: [] }] });
    const result = meetingReaderRecords(sitting.meetingId);
    assert.ok(result.agenda.length > 0);
    assert.deepEqual(result.actions, []);
    assert.deepEqual(result.rollCalls, []);
  } finally { useOutcomeSnapshotForTests(null); }
});
