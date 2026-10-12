import assert from "node:assert/strict";
import test from "node:test";

import { actionHistorySourceSetHash, prepareActionHistoryProjection, selectActionHistoryProjection } from "../lib/control-plane/admin-view/action-history-projection.ts";
import type { ExpansionScopeDecision } from "../lib/control-plane/expansion/scopes.ts";
import type { ActionReceipt } from "../lib/control-plane/gateway/contract.ts";

const original = "expansion.scope.set:scope:85635:1yfuc2c:pgfomast";
const later = "expansion.scope.set:another-send";
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
function scopeRow(position: number, actionId: string, instructionId: string) {
  const action = receipt("expansion.scope.set", actionId.replace(/^expansion\.scope\.set:/, ""), "zcta:2020/85635");
  return prepareActionHistoryProjection({ receipt: action, sourcePosition: position, sourceRecordedAt: at,
    validatedAction: { kind: "SCOPE_SET_COMMITTED", canonicalScopeKey: "zcta:2020/85635",
      savedDecision: decision(action.receiptId, instructionId) } });
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

test("same geography's later Send cannot inherit original instruction membership", () => {
  const first = scopeRow(1, original, original);
  const second = scopeRow(2, later, later);
  const continuation = scopeRow(3, "expansion.scope.set:edit", original);
  const ready = { status: "READY" as const, throughPosition: 3, sourceCount: 3, projectedCount: 3,
    sourceSetHash: actionHistorySourceSetHash([first, second, continuation]) };
  const selected = selectActionHistoryProjection([first, second, continuation], ready,
    { scopeKey: "zcta:2020/85635", instructionReceiptId: original });
  assert(selected.available);
  assert.equal(selected.total, 2);
  assert.deepEqual(selected.rows.map(row => row.gatewayReceiptId), [original, "expansion.scope.set:edit"]);
  assert.equal(second.scopeRefs[0]?.instructionReceiptId, later);
  assert.equal(continuation.actionKind, null, "scope-set cannot be mislabeled a new hunt");
  assert.equal(continuation.unmappedReason, "SCOPE_SET_V6_KIND_UNPROVEN");
  assert.throws(() => selectActionHistoryProjection([first, second, continuation], ready,
    { scopeKey: "zcta:2020/85635" }), /INSTRUCTION_RECEIPT_REQUIRED/);
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

test("legacy and unclassified action rows remain explicit with no invented scope", () => {
  const old = prepareActionHistoryProjection({ receipt: receipt("decision.record", "old", "card-1"),
    sourcePosition: 0, sourceRecordedAt: at, validatedAction: { kind: "UNAVAILABLE", legacy: true } });
  assert.equal(old.actionKind, null);
  assert.equal(old.unmappedReason, "LEGACY_ACTION_UNCLASSIFIED");
  assert.deepEqual(old.scopeRefs, []);
  assert.equal(selectActionHistoryProjection([old], { status: "READY", throughPosition: 0, sourceCount: 1, projectedCount: 1,
    sourceSetHash: actionHistorySourceSetHash([old]) },
    { scopeKey: "us" }).total, null, "an unmapped receipt could belong to this scope");
});

test("missing, incomplete, duplicate or partial source census never appears as empty complete history", () => {
  const row = scopeRow(2, original, original);
  const q = { scopeKey: "zcta:2020/85635", instructionReceiptId: original };
  const sourceSetHash = actionHistorySourceSetHash([row]);
  assert.equal(selectActionHistoryProjection([row], null, q).available, false);
  assert.equal(selectActionHistoryProjection([row], { status: "INCOMPLETE", throughPosition: 2, sourceCount: 1, projectedCount: 1, sourceSetHash }, q).total, null);
  assert.equal(selectActionHistoryProjection([row], { status: "READY", throughPosition: 2, sourceCount: 2, projectedCount: 1, sourceSetHash }, q).available, false);
  assert.equal(selectActionHistoryProjection([row], { status: "READY", throughPosition: 2, sourceCount: 2, projectedCount: 2, sourceSetHash }, q).available, false);
  assert.equal(selectActionHistoryProjection([row, row], { status: "READY", throughPosition: 2, sourceCount: 2, projectedCount: 2, sourceSetHash }, q).available, false);
  assert.equal(selectActionHistoryProjection([row], { status: "READY", throughPosition: 2, sourceCount: 1, projectedCount: 1,
    sourceSetHash: "0".repeat(64) }, q).available, false);
});
