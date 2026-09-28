import assert from "node:assert/strict";
import test from "node:test";
import { decodeAdminActionResponse } from "../app/(admin)/_mw/action-receipt.ts";

test("Admin actions claim saved state only from a DONE receipt", () => {
  const receipt = { receiptId: "receipt-1", says: "Accepted", readBackAt: "2026-09-28T09:00:00Z" };
  assert.equal(decodeAdminActionResponse(200, { ok: true }).kind, "UNCONFIRMED");
  assert.equal(decodeAdminActionResponse(200, { ok: true, receipt: { ...receipt, outcome: "QUEUED" } }).kind, "PENDING");
  assert.equal(decodeAdminActionResponse(200, { ok: false, receipt: { ...receipt, outcome: "REFUSED" } }).kind, "REFUSED");
  assert.deepEqual(decodeAdminActionResponse(200, { ok: true, replayed: true, receipt: { ...receipt, outcome: "DONE" } }), {
    kind: "DONE", says: "Accepted", receiptId: "receipt-1", readBackAt: "2026-09-28T09:00:00Z", replayed: true,
  });
  assert.equal(decodeAdminActionResponse(503, { ok: false, says: "Unavailable" }).kind, "UNCONFIRMED");
  assert.equal(decodeAdminActionResponse(200, { receipt: { ...receipt, outcome: "SOMETHING_ELSE" } }).kind, "UNCONFIRMED");
});
