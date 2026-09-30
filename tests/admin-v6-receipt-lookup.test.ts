import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { ADMIN_ORIGIN } from "../lib/ops/origins.ts";
import { ADMIN_RECEIPT_LOG_KEY, type ActionReceipt } from "../lib/control-plane/gateway/contract.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { lookupAdminReceipt, validReceiptIdentity } from "../lib/control-plane/admin-view/receipt-lookup.ts";
import { GET } from "../app/api/admin/v6/receipt/route.ts";

test("exact type and key find only the saved receipt without resubmitting an action", async () => {
  const repos = createMemoryRepositories();
  const now = "2026-09-28T20:20:00.000Z";
  const receipt: ActionReceipt = {
    formatVersion: 1, receiptId: "runner.pause:exact-key-123", idempotencyKey: "exact-key-123",
    type: "runner.pause", label: "Pause", authority: "REVERSIBLE_NONPRODUCTION",
    subjectKind: "runner", subject: "standing-runner", inputDigest: "sha256-test",
    caller: "OWNER_SESSION", actorRef: "session-test", stateVersion: null,
    codeSha: null, startedAt: now, completedAt: now, outcome: "QUEUED",
    says: "Asked to pause", refusal: null, openedWork: [], readBackAt: "/admin", undo: "Resume",
  };
  await repos.adminReceipts.append(ADMIN_RECEIPT_LOG_KEY, receipt.receiptId, receipt, now);
  assert.deepEqual(await lookupAdminReceipt(repos, "runner.pause", "exact-key-123"), receipt);
  assert.equal(await lookupAdminReceipt(repos, "runner.resume", "exact-key-123"), null);
  assert.equal(await lookupAdminReceipt(repos, "runner.pause", "different-123"), null);
  assert.equal((await repos.adminReceipts.read(ADMIN_RECEIPT_LOG_KEY)).length, 1);
});

test("malformed receipt identities and unauthenticated route reads fail closed", async () => {
  assert.equal(validReceiptIdentity("runner.pause", "exact-key-123"), true);
  assert.equal(validReceiptIdentity("runner.pause", "short"), false);
  assert.equal(validReceiptIdentity("runner.pause/other", "exact-key-123"), false);
  const repos = createMemoryRepositories();
  await assert.rejects(lookupAdminReceipt(repos, "runner.pause", "short"), /INVALID_RECEIPT_IDENTITY/);
  const request = new NextRequest(`${ADMIN_ORIGIN}/api/admin/v6/receipt?type=runner.pause&key=exact-key-123`,
    { headers: { host: new URL(ADMIN_ORIGIN).host } });
  const response = await GET(request);
  assert.equal(response.status, 401);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});
