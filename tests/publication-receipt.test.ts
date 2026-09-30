import assert from "node:assert/strict";
import test from "node:test";
import { printWorkerPublicationReceipt } from "../lib/civic-data/worker-publication-tasks.ts";

const record = (id: string) => ({ candidate: { id }, acquisitionSucceeded: true, state: "PROMOTED", receipt: { decision: "GOOD" }, lastKnownGoodVersion: id });
const store = { readCandidate: async (id: string) => (["cv-old", "cv-new"].includes(id) ? record(id) : null) } as never;
const outcome = (at: string, versionId: string, extra: Record<string, unknown> = {}) =>
  ({ at, status: "PUBLISHED", code: "VERIFIED_RESULT_PUBLISHED", detail: "", workerResultId: "r", candidateId: versionId, versionId, ...extra });

test("the receipt names this pass's publication and counts only what this pass put live", async () => {
  const lines: string[] = [];
  const log = console.log;
  console.log = (line: string) => { lines.push(line); };
  try {
    // An item published in an earlier pass reports its old outcome, and can come last.
    await printWorkerPublicationReceipt(store, "registry-runtime-bindings", [
      { workItemId: "wi-roster", outcome: outcome("2026-09-30T19:14:00.000Z", "cv-new", { acceptedRecordIds: ["m1", "m2", "m3"] }) },
      { workItemId: "wi-sibling", outcome: outcome("2026-09-30T19:14:00.000Z", "cv-new", { code: "VERIFIED_RESULT_REUSED" }) },
      { workItemId: "wi-held", outcome: outcome("2026-09-30T19:14:00.000Z", "", { status: "HELD", code: "ROSTER_PAGE_NOT_THIS_BODY", versionId: null }) },
      { workItemId: "wi-directory", outcome: outcome("2026-09-30T17:58:00.000Z", "cv-old", { bodyIds: ["b1", "b2"] }) },
    ] as never);
  } finally { console.log = log; }
  const receipt = JSON.parse(lines.find(line => line.startsWith("RCD_RECEIPT="))!.slice("RCD_RECEIPT=".length));
  assert.equal(receipt.candidateId, "cv-new");
  assert.deepEqual(receipt.delivered, { records: 3, gaps: 1, gapReasons: { ROSTER_PAGE_NOT_THIS_BODY: 1 } });
});

test("without the door pointer, a pass that only re-reports earlier publications prints no receipt and exits non-zero", async () => {
  const lines: string[] = [];
  const log = console.log;
  const exitCode = process.exitCode;
  console.log = (line: string) => { lines.push(line); };
  try {
    const printed = await printWorkerPublicationReceipt(store, "registry-runtime-bindings", [
      { workItemId: "wi-roster", outcome: outcome("2026-09-30T17:55:00.000Z", "cv-old", { acceptedRecordIds: ["m1"] }) },
    ] as never, null, "2026-09-30T21:04:00.000Z");
    assert.equal(printed, false, "an earlier version is never this pass's receipt");
    assert.equal(process.exitCode, 2);
  } finally { console.log = log; process.exitCode = exitCode; }
  assert.equal(lines.some(line => line.startsWith("RCD_RECEIPT=")), false);
});

test("a pass with nothing new confirms the door's current version and delivers nothing", async () => {
  const lines: string[] = [];
  const log = console.log;
  console.log = (line: string) => { lines.push(line); };
  try {
    const confirming = { ...(store as object), readPromotionIdentity: async () => ({ versionId: "cv-new" }) } as never;
    assert.equal(await printWorkerPublicationReceipt(confirming, "registry-runtime-bindings", [
      { workItemId: "wi-roster", outcome: outcome("2026-09-30T17:55:00.000Z", "cv-old", { acceptedRecordIds: ["m1"] }) },
    ] as never, null, "2026-09-30T21:04:00.000Z"), true);
  } finally { console.log = log; }
  const receipt = JSON.parse(lines.find(line => line.startsWith("RCD_RECEIPT="))!.slice("RCD_RECEIPT=".length));
  assert.deepEqual([receipt.candidateId, receipt.promotedVersion, receipt.confirmedAt, receipt.delivered.records], ["cv-new", "cv-new", undefined, 0], "the runner re-proves the canonical version; only the store records a confirmation");
});
