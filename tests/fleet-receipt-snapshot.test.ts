import assert from "node:assert/strict";
import test from "node:test";
import { gap, type OwnerSnapshot } from "../lib/control-plane/owner-surface.ts";
import { PULSE_STALE_MS } from "../lib/control-plane/live-pulse.ts";
import { FLEET_RECEIPT_SNAPSHOT_MAX_BYTES, FLEET_RECEIPT_SNAPSHOT_VERSION, isFleetReceiptSnapshot,
  readFleetReceiptSnapshot, type FleetReceiptSnapshot } from "../lib/control-plane/fleet-receipt-snapshot.ts";
import type { FleetReceiptLoadReport, FleetReceiptStore } from "../lib/control-plane/fleet-receipt-store.ts";
import type { PromotionReceipt } from "../lib/control-plane/promotion/historical-receipt.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { SNAPSHOT_ID } from "../lib/control-plane/admin-data.ts";
import { readFleetOperations } from "../lib/control-plane/fleet-operations.ts";

const AT = "2026-09-05T18:00:00.000Z";
const FIRST = "2026-09-05T18:01:00.000Z";
const NEXT = "2026-09-05T18:02:00.000Z";

test("Admin snapshot reads preserve stale clocks, name malformed or missing evidence and isolate read outages", async () => {
  const repos = createMemoryRepositories();
  const missing = await readFleetOperations(repos, { observedAt: NEXT });
  assert.equal(missing.receiptLoading.kind, "NOT_RECORDED");
  assert.equal(missing.deliveryFreshness, "UNKNOWN");
  const snapshot = { ...owner(FIRST), fleetReceipts: extension() };
  await repos.ownerSnapshots.put(SNAPSHOT_ID, snapshot, FIRST);
  const now = new Date(Date.parse(FIRST) + PULSE_STALE_MS).toISOString();
  const stale = await readFleetOperations(repos, { observedAt: now });
  assert.equal(stale.deliveryFreshness, "STALE");
  assert.equal(stale.receiptSource?.observedAt, FIRST);
  assert.equal(stale.receiptSource?.permanentAuthority, "NOT_CONNECTED");
  assert.equal(stale.receiptLoading.kind, "HELD");
  if (stale.receiptLoading.kind !== "HELD") throw new Error("EXPECTED_HELD");
  assert.equal(stale.receiptLoading.value.entries[0].state, "RETAINED");
  assert.equal(stale.receiptLoading.value.entries[0].lastSuccessfulReadAt, FIRST);
  const broken = await readFleetOperations({ ...repos, windowRuns: { ...repos.windowRuns,
    readAll: async () => { throw new Error("fixture-private-connection-error"); } } }, { observedAt: now });
  assert.equal(broken.deliveryFreshness, "UNKNOWN");
  assert.equal(broken.operations.kind, "HELD");
  assert.ok(!JSON.stringify(broken).includes("fixture-private-connection-error"));
  const prior = await repos.ownerSnapshots.read(SNAPSHOT_ID);
  const corrupt = { ...snapshot, fleetReceipts: { ...snapshot.fleetReceipts, authority: "PERMANENT" } } as unknown as OwnerSnapshot;
  await repos.ownerSnapshots.compareAndSet(SNAPSHOT_ID, prior!.revision, corrupt, NEXT);
  const invalid = await readFleetOperations(repos, { observedAt: NEXT, deliveryEvidence: { receipts: [receipt()] } });
  assert.equal(invalid.receiptLoading.kind, "STORE_UNREACHABLE");
  assert.equal(invalid.deliveryFreshness, "UNKNOWN");
});

// Synthetic historical wire evidence only. No promotion, window, filesystem or database is executed.
function receipt(): PromotionReceipt {
  return { formatVersion: 1, version: "promoter/1", receiptId: `pr-${"a".repeat(24)}`, at: AT,
    windowId: "synthetic-historical-window", target: { kind: "SHADOW", root: "/synthetic-archive-not-opened" },
    authority: { enabled: true, basis: "SHADOW_CANARY_AS_IF", openRecordClasses: ["meeting-times"], reason: "Synthetic historical shape" },
    items: [{ itemId: "synthetic-item", recordClass: "meeting-times", factKey: "synthetic-fact", meetingId: "synthetic-meeting", change: "ADD", changedFields: ["time"] }],
    refused: [], before: { path: "/synthetic-archive-not-opened/data/meetings-snapshot.json", existed: true, sha256: "a".repeat(64), copy: null },
    after: { sha256: "b".repeat(64), meetings: 1, written: true },
    verification: { instrument: "synthetic-check", exitCode: 0, passed: true, detail: "Fixture value; no verifier executed" },
    regression: null, reversal: null, incident: null, receiptPath: "/synthetic-archive-not-opened/receipt.json",
    lines: ["Synthetic historical receipt; never production proof"] };
}

function report(at = FIRST, value = receipt()): FleetReceiptLoadReport {
  return { version: "fleet-receipt-loading/v1", receipts: [value], entries: [{ receiptId: value.receiptId,
    windowId: value.windowId!, target: value.target.kind, state: "LOADED", observedAt: at, lastSuccessfulReadAt: at, gaps: [] }],
    limits: { maximumReceipts: 4, maxReceiptBytes: 16_384 }, truncated: 0 };
}

function extension(at = FIRST, value = report(at)): FleetReceiptSnapshot {
  return { version: FLEET_RECEIPT_SNAPSHOT_VERSION, authority: "HISTORICAL_PROMOTER_1", observedAt: at,
    loading: { kind: "HELD", value } };
}

function owner(at = NEXT): OwnerSnapshot {
  const missing = gap<never>("OURS", "Synthetic fixture: not measured");
  return { formatVersion: 1, publishedAt: at, publishedFromSha: null, publisher: "synthetic-test",
    pilotGreen: null, contracts: [], decisionCards: [], obligationsByState: [], obligationsByProvider: [], freshnessDebtRows: missing,
    incidents: [], costByRole: [], costByModel: [], cacheHitRateByCaller: [], deterministicShare: missing, costPerVerifiedRecord: missing,
    zipRows: missing, intakeFolder: missing, intakeItemsFound: missing, intakeItemsProcessed: missing, intakeUnidentifiable: missing };
}

function held(value: FleetReceiptSnapshot | null | undefined): FleetReceiptLoadReport {
  assert.ok(value);
  assert.equal(value.loading.kind, "HELD");
  if (value.loading.kind !== "HELD") throw new Error("Expected held fixture report");
  return value.loading.value;
}

test("snapshot reads distinguish absent, malformed, wrong-version and future data", () => {
  for (const absent of [undefined, null]) {
    const result = readFleetReceiptSnapshot(absent, NEXT);
    assert.equal(result.loading.kind, "NOT_RECORDED");
    assert.equal(result.freshness, "UNKNOWN");
    assert.equal(result.observedAt, null);
  }
  const good = extension();
  assert.equal(isFleetReceiptSnapshot(good), true);
  assert.equal(readFleetReceiptSnapshot(good, FIRST).freshness, "FRESH");
  for (const invalid of [{}, { ...good, version: "fleet-receipt-snapshot/v99" },
    { ...good, authority: "PERMANENT_CIVIC_DATA" }, { ...good, observedAt: "not-a-time" }]) {
    assert.equal(isFleetReceiptSnapshot(invalid), false);
    assert.equal(readFleetReceiptSnapshot(invalid, NEXT).loading.kind, "STORE_UNREACHABLE");
  }
  for (const now of [AT, "bad-clock"]) {
    assert.equal(readFleetReceiptSnapshot(good, now).loading.kind, "STORE_UNREACHABLE");
    assert.equal(readFleetReceiptSnapshot(good, now).freshness, "UNKNOWN");
  }
});

test("snapshot rejects receipt-entry identity, target, clock and completeness contradictions", () => {
  const source = report();
  const entry = source.entries[0];
  const badReports: FleetReceiptLoadReport[] = [
    { ...source, receipts: [{ ...receipt(), receiptId: "different-receipt" }] },
    { ...source, receipts: [{ ...receipt(), windowId: "different-window" }] },
    { ...source, receipts: [{ ...receipt(), target: { kind: "READER", root: "/synthetic" } }] },
    { ...source, receipts: [{ ...receipt(), at: NEXT }] },
    { ...source, receipts: [] },
    { ...source, entries: [] },
    { ...source, entries: [entry, entry] },
    { ...source, receipts: [receipt(), receipt()] },
    { ...source, entries: [{ ...entry, observedAt: NEXT }] },
    { ...source, entries: [{ ...entry, lastSuccessfulReadAt: NEXT }] },
    { ...source, entries: [{ ...entry, state: "MISSING" }] },
    { ...source, entries: [{ ...entry, gaps: ["contradiction"] }] },
    { ...source, entries: [{ ...entry, state: "RETAINED", gaps: [] }] },
  ];
  for (const value of badReports) assert.equal(isFleetReceiptSnapshot(extension(FIRST, value)), false, JSON.stringify(value));
});

test("snapshot enforces transport and receipt bounds and reports incomplete loads as unknown", () => {
  const good = report();
  for (const value of [
    { ...good, limits: { ...good.limits, maximumReceipts: 0 } },
    { ...good, limits: { ...good.limits, maximumReceipts: 1025 } },
    { ...good, limits: { ...good.limits, maxReceiptBytes: 16_777_217 } },
    { ...good, limits: { ...good.limits, maxReceiptBytes: 1 } },
    { ...good, truncated: -1 },
    { ...good, truncated: 0.5 },
  ]) assert.equal(isFleetReceiptSnapshot(extension(FIRST, value)), false);
  const overCount = { ...good, receipts: Array.from({ length: 5 }, (_, index) => ({ ...receipt(), receiptId: `synthetic-${index}` })),
    entries: Array.from({ length: 5 }, (_, index) => ({ ...good.entries[0], receiptId: `synthetic-${index}` })) };
  assert.equal(isFleetReceiptSnapshot(extension(FIRST, overCount)), false, "Five otherwise bound receipts exceed maximumReceipts=4");
  assert.equal(isFleetReceiptSnapshot({ ...extension(), loading: { kind: "HELD", value: {
    ...good, receipts: [{ ...receipt(), version: "permanent-receipt/v2" }],
  } } }), false, "A permanent or unknown receipt schema cannot enter the historical cache");
  const tooLarge = extension(FIRST, { ...good, limits: { ...good.limits, maxReceiptBytes: 16_777_216 },
    receipts: [{ ...receipt(), lines: ["x".repeat(FLEET_RECEIPT_SNAPSHOT_MAX_BYTES)] }] });
  assert.equal(isFleetReceiptSnapshot(tooLarge), false);
  const truncated = extension(FIRST, { ...good, truncated: 1 });
  assert.equal(isFleetReceiptSnapshot(truncated), true);
  assert.equal(readFleetReceiptSnapshot(truncated, FIRST).freshness, "UNKNOWN");
  const unavailable: FleetReceiptSnapshot = { ...extension(), loading: { kind: "STORE_UNREACHABLE", detail: "Synthetic failure" } };
  assert.equal(readFleetReceiptSnapshot(unavailable, FIRST).freshness, "UNKNOWN");
});

test("staleness preserves original collection and successful-read timestamps without mutating evidence", () => {
  const value = extension();
  const original = structuredClone(value);
  const boundary = new Date(Date.parse(FIRST) + PULSE_STALE_MS).toISOString();
  assert.equal(readFleetReceiptSnapshot(value, new Date(Date.parse(boundary) - 1).toISOString()).freshness, "FRESH");
  const stale = readFleetReceiptSnapshot(value, boundary);
  assert.equal(stale.freshness, "STALE");
  assert.equal(stale.observedAt, FIRST);
  assert.equal(stale.loading.kind, "HELD");
  if (stale.loading.kind !== "HELD") throw new Error("Expected historical data");
  assert.equal(stale.loading.value.entries[0].state, "RETAINED");
  assert.equal(stale.loading.value.entries[0].observedAt, FIRST);
  assert.equal(stale.loading.value.entries[0].lastSuccessfulReadAt, FIRST);
  assert.ok(stale.loading.value.entries[0].gaps.includes("RECEIPT_SNAPSHOT_STALE"));
  assert.deepEqual(stale.loading.value.receipts, original.loading.kind === "HELD" ? original.loading.value.receipts : []);
  assert.deepEqual(value, original);
});
