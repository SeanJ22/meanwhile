import assert from "node:assert/strict";
import test from "node:test";
import { unacknowledgedResearchResume, unacknowledgedScope } from "../lib/control-plane/scheduler/launch-wake.ts";
import type { ResearchIntent, ResearchIntentRequest } from "../lib/control-plane/scheduler/research-policy.ts";
import type { ExpansionScopeDecision } from "../lib/control-plane/expansion/scopes.ts";
import type { AssignmentCycleReading } from "../lib/control-plane/expansion/assignment-budget.ts";

const at = "2026-09-27T22:00:00.000Z";
const request = (action: "PAUSE" | "RESUME", intentId: string): ResearchIntentRequest => ({
  formatVersion: 1, kind: "INTENT", intentId, action, requestedAt: at,
  actor: "owner", adminSessionRef: "session", note: null,
});

test("a research Resume wakes once, but a later Pause or acknowledgment does not", () => {
  const resume = request("RESUME", "resume-1");
  assert.equal(unacknowledgedResearchResume([resume]), "resume-1");
  const honored: ResearchIntent = { formatVersion: 1, kind: "HONORED", intentId: "ack-1", honors: "resume-1", action: "RESUME", honoredAt: at, honoredBy: "runner", detail: "applied" };
  assert.equal(unacknowledgedResearchResume([resume, honored]), null);
  assert.equal(unacknowledgedResearchResume([resume, { ...request("PAUSE", "pause-1"), requestedAt: "2026-09-27T22:01:00.000Z" }]), null);
});

test("a Send wakes only until a completed cycle names its exact receipt", () => {
  const scope = { key: "zcta:2020/85635", receiptId: "receipt-new" } as ExpansionScopeDecision;
  const reading = { assignments: [{ key: scope.key, ref: "receipt-old" }] } as unknown as AssignmentCycleReading;
  assert.equal(unacknowledgedScope([scope], reading)?.receiptId, "receipt-new");
  assert.equal(unacknowledgedScope([scope], { ...reading, assignments: [{ ...reading.assignments[0], ref: scope.receiptId }] }), null);
  assert.equal(unacknowledgedScope([scope], null)?.receiptId, scope.receiptId);
  assert.equal(unacknowledgedScope([], null), null);
});
