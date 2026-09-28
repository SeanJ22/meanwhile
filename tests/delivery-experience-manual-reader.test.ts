import assert from "node:assert/strict";
import test from "node:test";
import { collectWorkerManualReadback } from "../lib/control-plane/worker-reader-readback.ts";
import type { WorkItem } from "../lib/control-plane/work-item.ts";

const item = {
  id: "work-voter-link", autonomousPlan: { publication: { contractId: "ballot-navigation", bodyId: "az-voter-body" } },
  publicationOutcome: { status: "PUBLISHED", workerResultId: "approval-a", versionId: "version-a", acceptedRecordIds: ["registration:AZ"] },
} as unknown as WorkItem;

test("manual reader witnesses require exact accepted record, current version, and visible control", async () => {
  const seen: string[] = [];
  const input = {
    items: [item], now: "2026-09-28T09:00:00Z", previous: null,
    store: { readCandidate: async () => ({ candidate: { readModel: { kind: "ballot-navigation", records: [
      { id: "registration:AZ", kind: "REGISTRATION_LINK", value: { state: "AZ", label: "Register", url: "https://az.example/register" } },
    ] } } }) } as never,
    zipForDivision: async () => "85635",
    currentVersion: async () => "version-a",
    observe: async (visit: { kind: string; record: { id: string } }) => { seen.push(`${visit.kind}:${visit.record.id}`); return { confirmed: true, reason: "Visible exact link", responseSha256: "abc" }; },
  } as Parameters<typeof collectWorkerManualReadback>[0];
  const confirmed = await collectWorkerManualReadback(input);
  assert.equal(confirmed.witnesses[0]?.state, "CONFIRMED");
  assert.deepEqual([confirmed.witnesses[0]?.itemId, confirmed.witnesses[0]?.approvalId, confirmed.witnesses[0]?.versionId], ["work-voter-link", "approval-a", "version-a"]);
  assert.deepEqual(seen, ["ballot-navigation:registration:AZ"]);

  const stale = await collectWorkerManualReadback({ ...input, currentVersion: async () => "version-b" });
  assert.equal(stale.witnesses[0]?.state, "NOT_OBSERVED");
  assert.deepEqual(seen, ["ballot-navigation:registration:AZ"], "a stale pointer must not visit or confirm the old link");

  const absent = await collectWorkerManualReadback({ ...input, items: [{ ...item, publicationOutcome: { ...item.publicationOutcome!, acceptedRecordIds: ["another-row"] } }] });
  assert.equal(absent.witnesses[0]?.state, "NOT_OBSERVED");
});
