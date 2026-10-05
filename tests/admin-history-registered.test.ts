import test from "node:test";
import assert from "node:assert/strict";
import { actionDefinitions } from "../lib/control-plane/gateway/registry.ts";
import { registeredHistoryEvidence } from "../lib/control-plane/gateway/history-evidence.ts";
import { receiptIdFor, type ActionReceipt } from "../lib/control-plane/gateway/contract.ts";
import { prepareActionHistoryProjection } from "../lib/control-plane/admin-view/action-history-projection.ts";
test("every registered gateway receipt stores its identity and receipt-owned scope",()=>{
  for (const action of actionDefinitions()) for (const scope of ["us","st:az"]) {
    const receipt={receiptId:receiptIdFor(action.type,"test"),type:action.type,idempotencyKey:"test",subject:scope,requestedSubject:scope,
      subjectKind:action.subjectKind,outcome:"QUEUED",startedAt:"2026-10-05T00:00:00Z"} as ActionReceipt;
    const row=prepareActionHistoryProjection({receipt,sourcePosition:1,sourceRecordedAt:receipt.startedAt,validatedAction:registeredHistoryEvidence(receipt)});
    assert.ok(row.actionKind,action.type); assert.equal(row.unmappedReason,null,action.type); assert.equal(row.scopeRefs.length,1,action.type);
    assert.deepEqual(row.effectRefs,[],"mapping does not invent a finished order");
    if (!action.type.startsWith("runner.")) assert.equal(row.scopeRefs[0].scopeKey,scope,action.type);
  }
});
