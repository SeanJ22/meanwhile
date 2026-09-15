import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { createFleetReceiptStore } from "../lib/control-plane/fleet-receipt-store.ts";
import { liveAuthority, promoteFacts, receiptSummary, RECEIPTS_DIR, type PromotionReceipt } from "./helpers/legacy-promoter.ts";
import { readActivationGate } from "../lib/control-plane/promotion/activation-gate.ts";
import type { HistoricalWindowRun } from "../lib/control-plane/fleet-delivery.ts";

const AT = "2026-09-05T18:00:00.000Z";
const LATER = "2026-09-05T18:01:00.000Z";
const LATEST = "2026-09-05T18:02:00.000Z";

async function removeFixtureRoot(root: string, prefix: string) {
  const target = resolve(root);
  assert.equal(dirname(target), resolve(tmpdir()));
  assert.ok(basename(target).startsWith(prefix));
  await rm(target, { recursive: true, force: true, maxRetries: 3 });
}

function windowFor(receipt: PromotionReceipt): HistoricalWindowRun {
  const gate = readActivationGate(process.cwd());
  return { formatVersion: 1, windowId: receipt.windowId!, localDate: "2026-09-05", zone: "America/New_York", scheduledFor: AT,
    trigger: "MANUAL", mode: "SHADOW", startedAt: AT, finishedAt: LATER, host: "fixture", testedSha: null, provider: "fixture",
    caughtUp: [], lock: { leaseId: "fixture", holder: "fixture", claimedAt: AT, expiresAt: LATEST, releasedAt: LATER },
    activationGate: gate, stages: [],
    pipeline: { items: 1, byStage: { SCOUTED: 0, CONFIRMED: 0, VERIFIED: 0, AUDITED: 0, APPROVED_FOR_PROMOTION: 0 }, refused: 1,
      verdicts: [{ itemId: "fixture-item", recordClass: "meeting-times", stage: null, verdict: "REFUSE_WOULD", reason: "fixture policy hold" }], byRecordClass: [] },
    promoted: 0, controls: null, incidents: [], digestPath: null, mirrored: null, recordPath: null,
    promotionReceipts: [receiptSummary(receipt)] };
}

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "fleet-receipt-loader-"));
  t.after(() => removeFixtureRoot(root, "fleet-receipt-loader-"));
  const receipt = await promoteFacts({ target: { kind: "SHADOW", root }, authority: liveAuthority(readActivationGate(process.cwd())),
    verdicts: [{ itemId: "fixture-item", recordClass: "meeting-times", stage: null, verdict: "REFUSE_WOULD", reason: "isolated loader fixture" }],
    facts: new Map(), now: AT, windowId: "fixture-window" });
  assert.ok(receipt.receiptPath);
  const path = receipt.receiptPath;
  const save = (value: unknown) => writeFile(path, JSON.stringify(value));
  return { root, receipt, path, save, window: windowFor(receipt), store: createFleetReceiptStore({ targets: [{ kind: "SHADOW", root }] }) };
}

test("loads an actual promoter refusal from the configured root; missing storage preserves its last trustworthy receipt and stamp", async t => {
  const f = await fixture(t);
  const first = await f.store.read([f.window], LATER);
  assert.equal(first.entries[0].state, "LOADED");
  assert.equal(first.entries[0].lastSuccessfulReadAt, LATER);
  assert.equal(first.receipts[0].refused[0].code, "PROMOTION_OFF");
  await unlink(f.path);
  const retained = await f.store.read([f.window], LATEST);
  assert.equal(retained.entries[0].state, "RETAINED");
  assert.equal(retained.entries[0].lastSuccessfulReadAt, LATER);
  assert.ok(retained.entries[0].gaps.includes("RECEIPT_FILE_MISSING"));
  assert.ok(retained.entries[0].gaps.includes("RETAINED_HISTORICAL_RECEIPT_NOT_CURRENT_PROOF"));
  assert.deepEqual(retained.receipts[0], first.receipts[0]);
  const fresh = createFleetReceiptStore({ targets: [{ kind: "SHADOW", root: f.root }] });
  assert.equal((await fresh.read([f.window], LATEST)).entries[0].state, "MISSING");
});

test("invalid JSON, nested schema, bytes, target, window, summary and paths are named refusals; historical receipt is retained", async t => {
  const f = await fixture(t);
  await f.store.read([f.window], LATER);
  const variants: readonly [string, unknown][] = [
    ["RECEIPT_SCHEMA_INVALID", { ...f.receipt, verification: { passed: true } }],
    ["RECEIPT_ID_TARGET_OR_WINDOW_MISMATCH", { ...f.receipt, windowId: "other-window" }],
    ["RECEIPT_ID_TARGET_OR_WINDOW_MISMATCH", { ...f.receipt, target: { kind: "READER", root: f.root } }],
    ["RECEIPT_BOUND_PATH_MISMATCH", { ...f.receipt, before: { ...f.receipt.before, path: join(f.root, "..", "escape.json") } }],
    ["RECEIPT_FROM_FUTURE", { ...f.receipt, at: "2030-01-01T00:00:00.000Z" }],
  ];
  for (const [gap, value] of variants) {
    await f.save(value);
    const result = await f.store.read([f.window], LATEST);
    assert.equal(result.entries[0].state, "RETAINED", gap);
    assert.ok(result.entries[0].gaps.includes(gap), JSON.stringify(result.entries));
    assert.equal(result.receipts[0].windowId, f.receipt.windowId);
  }
  await writeFile(f.path, "{malformed");
  assert.ok((await f.store.read([f.window], LATEST)).entries[0].gaps.includes("RECEIPT_JSON_INVALID"));
  await f.save(f.receipt);
  const over = createFleetReceiptStore({ targets: [{ kind: "SHADOW", root: f.root }], maxReceiptBytes: 32 });
  const oversized = await over.read([f.window], LATER);
  assert.equal(oversized.entries[0].state, "INVALID");
  assert.ok(oversized.entries[0].gaps.includes("RECEIPT_BYTE_LIMIT_EXCEEDED"));
  const summary = f.window.promotionReceipts![0];
  for (const changed of [{ ...summary, promoted: 123 }, { ...summary, path: join(f.root, "..", "outside.json") }]) {
    const result = await f.store.read([{ ...f.window, promotionReceipts: [changed] }], LATEST);
    assert.ok(result.entries[0].gaps.includes("WINDOW_RECEIPT_SUMMARY_MISMATCH"));
  }
});

test("new valid failed/reversed receipt replaces cached prior content; retention cannot resurrect earlier success", async t => {
  const f = await fixture(t);
  // Shape-only lifecycle controls: these are not civic facts or claims of an executed promotion.
  const prior = { ...f.receipt, verification: { instrument: "fixture", passed: true, exitCode: 0, detail: "prior fixture result" },
    regression: { action: "NONE" as const, reason: "prior fixture result" } };
  await f.save(prior);
  await f.store.read([windowFor(prior)], LATER);
  const failed: PromotionReceipt = { ...f.receipt, verification: { instrument: "fixture", passed: false, exitCode: 1, detail: "new failed control" },
    regression: { action: "REVERT_AND_INCIDENT", reason: "new failed control" },
    reversal: { executed: true, at: LATER, restoredSha256: null, matchesBefore: true, detail: "negative fixture lifecycle record" },
    incident: { formatVersion: 1, incidentId: "fixture-incident", windowId: f.window.windowId, stage: "PROMOTION",
      code: "POST_PROMOTION_VERIFICATION_FAILED", detail: "negative fixture lifecycle record", openedAt: LATER, missedScope: ["fixture-item"] } };
  await f.save(failed);
  const window = windowFor(failed);
  const newest = await f.store.read([window], LATEST);
  assert.equal(newest.entries[0].state, "LOADED");
  assert.equal(newest.receipts[0].verification?.passed, false);
  assert.equal(newest.receipts[0].reversal?.executed, true);
  await f.save(prior);
  const outOfOrder = await f.store.read([windowFor(prior)], LATER);
  assert.equal(outOfOrder.entries[0].state, "RETAINED");
  assert.equal(outOfOrder.entries[0].lastSuccessfulReadAt, LATEST);
  assert.ok(outOfOrder.entries[0].gaps.includes("RECEIPT_READ_SUPERSEDED_BY_NEWER_OBSERVATION"));
  assert.equal(outOfOrder.receipts[0].verification?.passed, false, "an older completing observation cannot overwrite newer failed history");
  await unlink(f.path);
  const retained = await f.store.read([window], "2026-09-05T18:03:00.000Z");
  assert.equal(retained.entries[0].state, "RETAINED");
  assert.equal(retained.receipts[0].verification?.passed, false);
  assert.equal(retained.receipts[0].incident?.incidentId, "fixture-incident");
});

test("receipt IDs and roots cannot select paths; symlink/junction receipt directories are refused", async t => {
  const f = await fixture(t);
  const unknownTarget = createFleetReceiptStore({ targets: [{ kind: "READER", root: f.root }] });
  const unknown = await unknownTarget.read([f.window], LATER);
  assert.equal(unknown.entries[0].state, "UNAVAILABLE");
  assert.ok(unknown.entries[0].gaps.includes("RECEIPT_TARGET_NOT_CONFIGURED"));
  const traversal = { ...f.window, promotionReceipts: [{ ...f.window.promotionReceipts![0], receiptId: "../../outside" }] };
  const bad = await f.store.read([traversal], LATER);
  assert.equal(bad.entries[0].state, "INVALID");
  assert.ok(bad.entries[0].gaps.includes("RECEIPT_ID_INVALID"));
  assert.throws(() => createFleetReceiptStore({ targets: [{ kind: "SHADOW", root: f.root }, { kind: "SHADOW", root: f.root }] }), /TARGET_AMBIGUOUS/);
  assert.throws(() => createFleetReceiptStore({ targets: [{ kind: "SHADOW", root: "relative/path" }] }), /TARGET_INVALID/);
  const external = await mkdtemp(join(tmpdir(), "fleet-receipt-external-"));
  t.after(() => removeFixtureRoot(external, "fleet-receipt-external-"));
  const content = await readFile(f.path);
  await writeFile(join(external, `${f.receipt.receiptId}.json`), content);
  const directory = join(f.root, ...RECEIPTS_DIR);
  assert.equal(resolve(directory), resolve(f.root, "data", "health", "promotion-receipts"));
  await rm(directory, { recursive: true, force: true });
  await symlink(external, directory, process.platform === "win32" ? "junction" : "dir");
  const linked = await f.store.read([f.window], LATER);
  assert.equal(linked.entries[0].state, "INVALID");
  assert.ok(linked.entries[0].gaps.includes("RECEIPT_SYMLINK_REFUSED"));
  await unlink(directory);
  await mkdir(directory);
  assert.deepEqual(await readFile(join(external, `${f.receipt.receiptId}.json`)), content);
});

test("count bounds cover file reads, returned receipts/statuses and historical cache; conflicting summaries cannot pass", async t => {
  const f = await fixture(t);
  const store = createFleetReceiptStore({ targets: [{ kind: "SHADOW", root: f.root }], maximumReceipts: 1 });
  const summary = f.window.promotionReceipts![0];
  const windows = [{ ...f.window, promotionReceipts: [summary, ...Array.from({ length: 100 }, (_, index) => ({ ...summary,
    receiptId: `pr-${(index + 1).toString(16).padStart(24, "0")}`, path: null }))] }];
  const capped = await store.read(windows, LATER);
  assert.equal(capped.receipts.length, 1);
  assert.equal(capped.entries.length, 2);
  assert.equal(capped.entries[1].state, "LIMIT_REACHED");
  assert.equal(capped.truncated, 100);
  const contradictory = await store.read([{ ...f.window, promotionReceipts: [summary, { ...summary, refused: 99 }] }], LATEST);
  assert.equal(contradictory.entries[0].state, "RETAINED");
  assert.ok(contradictory.entries[0].gaps.includes("WINDOW_RECEIPT_SUMMARIES_CONTRADICT"));
  const second = await promoteFacts({ target: { kind: "SHADOW", root: f.root }, authority: liveAuthority(readActivationGate(process.cwd())),
    verdicts: [{ itemId: "fixture-item-2", recordClass: "meeting-times", stage: null, verdict: "REFUSE_WOULD", reason: "second isolated loader fixture" }],
    facts: new Map(), now: LATER, windowId: "fixture-window-2" });
  assert.equal((await store.read([windowFor(second)], LATEST)).entries[0].state, "LOADED");
  await unlink(f.path);
  assert.equal((await store.read([f.window], LATEST)).entries[0].state, "MISSING", "a one-receipt cache evicts the older entry");
  assert.throws(() => createFleetReceiptStore({ targets: [], maximumReceipts: 0 }), /LIMIT_INVALID/);
});
