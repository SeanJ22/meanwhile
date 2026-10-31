import assert from "node:assert/strict";
import test from "node:test";

import { prepareActionHistoryProjection } from "../lib/control-plane/admin-view/action-history-projection.ts";
import type { ExpansionScopeDecision } from "../lib/control-plane/expansion/scopes.ts";
import type { ActionReceipt } from "../lib/control-plane/gateway/contract.ts";

const original = "expansion.scope.set:scope:85635:1yfuc2c:pgfomast";
const at = "2026-09-28T20:00:00.000Z";
function receipt(type: string, id: string, subject: string): ActionReceipt {
  return { formatVersion: 1, receiptId: `${type}:${id}`, idempotencyKey: id, type,
    label: type, authority: "OWNER_DECISION_REQUIRED", subjectKind: type.startsWith("runner.") ? "the standing runner" : "a geography you want worked first",
    subject, inputDigest: "sha256-input", caller: "OWNER_SESSION", actorRef: "owner-test",
    stateVersion: null, codeSha: null, startedAt: at, completedAt: at, outcome: "DONE", says: "Saved.",
    refusal: null, openedWork: [], readBackAt: "/admin/work", undo: null };
}
function decision(actionId: string, instructionId: string): ExpansionScopeDecision {
  return { key: "zcta:2020/85635", geography: { type: "zcta", version: "zcta:2020", geoid: "85635",
    label: "Sierra Vista", stateAbbr: "AZ" }, priority: 1, budgetUsd: 50,
    budgetStartedAt: at, note: null, decidedAt: at, decidedBy: "owner-test",
    receiptId: instructionId, latestDecisionReceiptId: actionId, previous: null };
}

test("validated runner controls bind global scope but never imply application or effect", () => {
  const action = receipt("runner.pause", "once", "intent-1");
  const row = prepareActionHistoryProjection({ receipt: action, sourcePosition: 5, sourceRecordedAt: at,
    validatedAction: { kind: "GLOBAL_RUNNER", type: "runner.pause" } });
  assert.equal(row.actionKind, "global-runner-pause");
  assert.deepEqual(row.scopeRefs, [{ scopeKey: "us", instructionReceiptId: null, kind: "GLOBAL" }]);
  assert.deepEqual(row.effectRefs, []);
  assert.match(row.sourceHash, /^[a-f0-9]{64}$/);
  assert.throws(() => prepareActionHistoryProjection({ receipt: action, sourcePosition: 5, sourceRecordedAt: at,
    validatedAction: { kind: "GLOBAL_RUNNER", type: "runner.resume" } }), /VALIDATION_MISMATCH/);
});

test("a mismatched post-save decision, receipt identity or position fails closed", () => {
  const action = receipt("expansion.scope.set", "edit", "zcta:2020/85635");
  assert.throws(() => prepareActionHistoryProjection({ receipt: action, sourcePosition: 1, sourceRecordedAt: at,
    validatedAction: { kind: "SCOPE_SET_COMMITTED", canonicalScopeKey: "zcta:2020/85635",
      savedDecision: decision("another-action", original) } }), /VALIDATION_MISMATCH/);
  assert.throws(() => prepareActionHistoryProjection({ receipt: { ...action, receiptId: "forged" }, sourcePosition: 1,
    sourceRecordedAt: at, validatedAction: { kind: "UNAVAILABLE", legacy: true } }), /INVALID_CANONICAL/);
  assert.throws(() => prepareActionHistoryProjection({ receipt: action, sourcePosition: -1,
    sourceRecordedAt: at, validatedAction: { kind: "UNAVAILABLE", legacy: true } }), /INVALID_CANONICAL/);
});

