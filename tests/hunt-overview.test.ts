import test from "node:test";
import assert from "node:assert/strict";
import { huntOverview } from "../lib/control-plane/admin-view/hunt-overview.ts";
import { instructionReceiptKey } from "../lib/control-plane/scheduler/obligation.ts";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";

type Input = Parameters<typeof huntOverview>[0];
const now = "2026-09-28T14:00:00.000Z";
const receipt = "original-receipt";
const key = "zcta:2020/85635";
const identity = instructionReceiptKey(key, receipt);
function fixture(): Input {
  return {
    now, decision: { key, receiptId: receipt, budgetStartedAt: "2026-09-27T22:17:50.236Z", budgetUsd: 50,
      geography: { label: "ZIP 85635", type: "zcta", stateAbbr: "AZ", geoid: "85635", version: "zcta:2020" } },
    assignments: {
      rows: [], allRowsIndex: [{ id: "work-a", label: "Official roster", subjectName: "Example council", state: "SUCCEEDED",
        assignmentRefs: [{ key, ref: receipt }], assignmentKeys: [key], instructionStates: { [identity]: "SUCCEEDED" } }],
      instructionCountsByReceipt: { [identity]: { WORKING: 0, WAITING: 0, UNKNOWN: 0, BLOCKED: 0, FAILED: 0, SUCCEEDED: 1, RETIRED: 0 } },
      bodyAttempts: [{ bodyId: "body-a", workItemId: "work-a", workerResultId: "approved-a", versionId: "version-a",
        assignmentRefs: [{ key, ref: receipt }], status: "PUBLISHED", at: now,
        recordChanges: [{ readerId: "person-a", change: "NEW" }] }],
    },
    billing: { readAt: now, providers: [], hunts: [{ key, receiptId: receipt, startedAt: "2026-09-27T22:17:50.236Z", anthropicKnownUsd: 2 }] },
    reader: { checkedAt: now, errors: [], witnesses: [{ itemId: "work-a", approvalId: "approved-a", versionId: "version-a", readerKey: "person-a",
      state: "CONFIRMED", checkedAt: now, url: `${PUBLIC_SITE_ORIGIN}/ballot?zip=85635`, responseSha256: "b".repeat(64), reason: "Visible" }] },
  } as unknown as Input;
}
test("hunt overview joins exact receipt, approval, version and public key rather than counting published jobs", () => {
  const input = fixture();
  const output = huntOverview(input);
  assert.equal(output.knownWork, 1);
  assert.equal(output.unfinished, 0);
  assert.equal(output.delivered.length, 1);
  assert.equal(output.delivered[0].change, "NEW");
  assert.equal(output.delivered[0].url, `${PUBLIC_SITE_ORIGIN}/ballot?zip=85635`);
  assert.equal(output.money?.anthropicKnownUsd, 2);
  assert.equal(huntOverview({ ...input, decision: { ...input.decision, receiptId: "later-receipt" } }).delivered.length, 0);
  assert.equal(huntOverview({ ...input, decision: { ...input.decision, receiptId: "later-receipt" } }).money, null);
});
test("newer failed public observation overrides an earlier pass; independent keys stay visible", () => {
  const input = fixture();
  const witness = input.reader!.witnesses[0];
  const reader = { ...input.reader!, witnesses: [
    { ...witness, checkedAt: "2026-09-28T13:00:00.000Z" },
    { ...witness, state: "NOT_OBSERVED" as const },
    { ...witness, readerKey: "person-b" },
  ] };
  const output = huntOverview({ ...input, reader });
  assert.deepEqual(output.delivered.map(row => row.readerKey), ["person-b"]);
  assert.equal(output.delivered[0].change, "NOT_RECORDED");
});
test("stale, future, mismatched, unhashed and private-link observations cannot become delivered records", () => {
  const input = fixture();
  const witness = input.reader!.witnesses[0];
  for (const patch of [{ checkedAt: "2026-09-28T10:00:00Z" }, { checkedAt: "2026-09-28T15:00:00Z" },
    { versionId: "old-version" }, { approvalId: "another-approval" }, { responseSha256: null },
    { url: `${PUBLIC_SITE_ORIGIN}/admin/work` }, { url: `${PUBLIC_SITE_ORIGIN}/ballot?token=secret` }]) {
    assert.equal(huntOverview({ ...input, reader: { ...input.reader!, witnesses: [{ ...witness, ...patch }] } }).delivered.length, 0);
  }
});
test("contradictory or missing full-population counts remain unknown", () => {
  const input = fixture();
  const assignments = { ...input.assignments!, instructionCountsByReceipt: {
    [identity]: { WORKING: 0, WAITING: 0, UNKNOWN: 0, BLOCKED: 0, FAILED: 0, SUCCEEDED: 2, RETIRED: 0 },
  } };
  assert.equal(huntOverview({ ...input, assignments }).knownWork, null);
  assert.equal(huntOverview({ ...input, assignments: null }).unfinished, null);
  assert.equal(huntOverview({ ...input, reader: null }).deliveryReadComplete, false);
});
test("incomplete, stale and malformed public reads remain incomplete even with an independently valid check", () => {
  const input = fixture();
  for (const patch of [{ errors: ["One public route could not be read"] },
    { checkedAt: "invalid" }, { checkedAt: "2026-09-28T10:00:00Z" }, { checkedAt: "2026-09-28T15:00:00Z" }]) {
    const result = huntOverview({ ...input, reader: { ...input.reader!, ...patch } });
    assert.equal(result.deliveryReadComplete, false);
    assert.equal(result.delivered.length, 1);
  }
});
test("publication versions remain independent and malformed same-version observations cannot preserve an old pass", () => {
  const input = fixture();
  const witness = input.reader!.witnesses[0];
  const otherVersion = { ...witness, versionId: "version-b", state: "NOT_OBSERVED" as const };
  assert.equal(huntOverview({ ...input, reader: { ...input.reader!, witnesses: [witness, otherVersion] } }).delivered.length, 1);
  for (const witnesses of [[witness, { ...witness, state: "NOT_OBSERVED" as const, checkedAt: "invalid" }],
    [{ ...witness, state: "NOT_OBSERVED" as const, checkedAt: "invalid" }, witness]]) {
    assert.equal(huntOverview({ ...input, reader: { ...input.reader!, witnesses } }).delivered.length, 0);
  }
});
test("standing publication labels use the recorded body when its assignment index is keyed by obligation", () => {
  const input = fixture();
  const assignments = { ...input.assignments!, allRowsIndex: input.assignments!.allRowsIndex!.map(row => ({ ...row, id: "obligation-a" })),
    bodyAttempts: input.assignments!.bodyAttempts!.map(row => ({ ...row, bodyId: "az:city:city-of-sierra-vista" })) };
  const result = huntOverview({ ...input, assignments });
  assert.match(result.delivered[0].label, /Sierra Vista/);
});
