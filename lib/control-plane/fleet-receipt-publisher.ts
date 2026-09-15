import type { FleetReceiptStore } from "./fleet-receipt-store.ts";
import type { WindowRunRecord } from "./promotion/types.ts";
import type { OwnerSnapshot } from "./owner-surface.ts";
import { FLEET_RECEIPT_SNAPSHOT_VERSION, isFleetReceiptSnapshot, type FleetReceiptSnapshot } from "./fleet-receipt-snapshot.ts";
import { isHistoricalReceiptTimestamp } from "./promotion/historical-receipt.ts";

/**
 * Runner-side collection only. The authorized owner-snapshot publisher supplies its trusted
 * store and canonical historical selector. No new schedule, database writer or publication path.
 * Compose this into the SAME snapshot put/CAS each cycle, never a competing partial writer.
 */
export async function withFleetReceiptSnapshot(snapshot: OwnerSnapshot, input: {
  readonly store: FleetReceiptStore;
  readonly readWindows: () => Promise<readonly WindowRunRecord[]>;
  /** Read from the same OwnerSnapshot revision the existing publisher will CAS. */
  readonly previous?: FleetReceiptSnapshot | null;
}): Promise<OwnerSnapshot> {
  if (!isHistoricalReceiptTimestamp(snapshot.publishedAt)) throw new Error("FLEET_RECEIPT_SNAPSHOT_CLOCK_INVALID");
  const base = { version: FLEET_RECEIPT_SNAPSHOT_VERSION, authority: "HISTORICAL_PROMOTER_1" as const, observedAt: snapshot.publishedAt } as const;
  const previous = isFleetReceiptSnapshot(input.previous) && Date.parse(input.previous.observedAt) <= Date.parse(snapshot.publishedAt) &&
    input.previous.loading.kind === "HELD" ? input.previous.loading.value : null;
  let extension: FleetReceiptSnapshot;
  try {
    const report = await input.store.read(await input.readWindows(), snapshot.publishedAt);
    extension = { ...base, loading: { kind: "HELD", value: report } };
    if (!isFleetReceiptSnapshot(extension)) throw new Error("FLEET_RECEIPT_SNAPSHOT_INVALID_OR_TOO_LARGE");
    if (previous) {
      const receipts = [...report.receipts];
      const entries = report.entries.map(entry => {
        if (!["MISSING", "INVALID", "UNAVAILABLE"].includes(entry.state)) return entry;
        const matches = (value: { receiptId: string; windowId: string | null }) => value.receiptId === entry.receiptId && value.windowId === entry.windowId;
        const priorEntry = previous.entries.find(value => matches(value) && value.target === entry.target);
        const receipt = previous.receipts.find(value => matches(value) && value.target.kind === entry.target);
        if (!receipt || !priorEntry?.lastSuccessfulReadAt || receipts.length >= report.limits.maximumReceipts) return entry;
        receipts.push(receipt);
        return { ...entry, state: "RETAINED" as const, lastSuccessfulReadAt: priorEntry.lastSuccessfulReadAt,
          gaps: [...entry.gaps, `RECEIPT_REFRESH_${entry.state}`, "RECEIPT_RETAINED_FROM_OWNER_SNAPSHOT"] };
      });
      const retained: FleetReceiptSnapshot = { ...base, loading: { kind: "HELD", value: { ...report, entries, receipts } } };
      // The current bounded reading wins if historical additions cannot fit the transport.
      if (isFleetReceiptSnapshot(retained)) extension = retained;
    }
  } catch {
    // Never re-date an older success or let a failed refresh resurrect prior materialization.
    // Per-file history retention remains owned by the trusted store, not by this snapshot cache.
    extension = { ...base, loading: { kind: "STORE_UNREACHABLE", detail: "Runner historical receipt collection failed or exceeded the snapshot transport bound. Archive evidence remains held by its authority." } };
    if (previous && previous.receipts.length > 0) {
      const retained: FleetReceiptSnapshot = { ...base, loading: { kind: "HELD", value: { ...previous,
        entries: previous.entries.map(entry => ({ ...entry, observedAt: snapshot.publishedAt,
          state: entry.state === "LOADED" ? "RETAINED" : entry.state,
          gaps: [...new Set([...entry.gaps, "RECEIPT_COLLECTION_FAILED_HISTORY_ONLY"])] })) } } };
      if (isFleetReceiptSnapshot(retained)) extension = retained;
    }
  }
  return { ...snapshot, fleetReceipts: extension };
}
