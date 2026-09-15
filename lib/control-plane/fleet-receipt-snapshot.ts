import { isHistoricalPromotionReceipt, isHistoricalReceiptTimestamp } from "./promotion/historical-receipt.ts";
import type { FleetReceiptLoadReport } from "./fleet-receipt-store.ts";
import type { ReadOutcome } from "./admin-data.ts";
import { PULSE_STALE_MS } from "./live-pulse.ts";

export const FLEET_RECEIPT_SNAPSHOT_VERSION = "fleet-receipt-snapshot/v1";
/** Transport bounds, not acquisition/concurrency policy or a receipt retention policy. */
export const FLEET_RECEIPT_SNAPSHOT_MAX_BYTES = 1_048_576;

/** Runner-produced reporting cache on OwnerSnapshot/current. The archive remains the evidence authority. */
export interface FleetReceiptSnapshot {
  readonly version: typeof FLEET_RECEIPT_SNAPSHOT_VERSION;
  readonly authority: "HISTORICAL_PROMOTER_1";
  readonly observedAt: string;
  readonly loading: ReadOutcome<FleetReceiptLoadReport>;
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
const key = (r: { receiptId: string; windowId: string | null; target: string }) => `${r.target}:${r.windowId}:${r.receiptId}`;

/** Validate the transport as well as the frozen historical receipt shape; never opens a path. */
export function isFleetReceiptSnapshot(value: unknown): value is FleetReceiptSnapshot {
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > FLEET_RECEIPT_SNAPSHOT_MAX_BYTES || !object(value) ||
      value.version !== FLEET_RECEIPT_SNAPSHOT_VERSION || value.authority !== "HISTORICAL_PROMOTER_1" ||
      !isHistoricalReceiptTimestamp(value.observedAt) || !object(value.loading)) return false;
    const loading = value.loading;
    if (loading.kind === "NOT_RECORDED" || loading.kind === "STORE_UNREACHABLE") return typeof loading.detail === "string";
    if (loading.kind !== "HELD" || !object(loading.value)) return false;
    const report = loading.value;
    if (report.version !== "fleet-receipt-loading/v1" || !object(report.limits) ||
      !integer(report.limits.maximumReceipts, 1, 1024) || !integer(report.limits.maxReceiptBytes, 1, 16_777_216) ||
      !integer(report.truncated, 0, Number.MAX_SAFE_INTEGER) || !Array.isArray(report.entries) ||
      report.entries.length > report.limits.maximumReceipts + 1 || !Array.isArray(report.receipts) ||
      report.receipts.length > report.limits.maximumReceipts) return false;
    const entries = new Map<string, Record<string, unknown>>();
    for (const entry of report.entries) {
      if (!object(entry) || typeof entry.receiptId !== "string" || typeof entry.windowId !== "string" ||
        (entry.target !== "SHADOW" && entry.target !== "READER") ||
        !["LOADED", "MISSING", "INVALID", "UNAVAILABLE", "RETAINED", "LIMIT_REACHED"].includes(String(entry.state)) ||
        entry.observedAt !== value.observedAt || !Array.isArray(entry.gaps) || !entry.gaps.every(g => typeof g === "string") ||
        (entry.lastSuccessfulReadAt !== null && (!isHistoricalReceiptTimestamp(entry.lastSuccessfulReadAt) ||
          Date.parse(entry.lastSuccessfulReadAt) > Date.parse(value.observedAt)))) return false;
      if ((entry.state === "LOADED" && (entry.lastSuccessfulReadAt !== value.observedAt || entry.gaps.length > 0)) ||
        (entry.state === "RETAINED" && (entry.lastSuccessfulReadAt === null || entry.gaps.length === 0))) return false;
      const id = key({ receiptId: entry.receiptId, windowId: entry.windowId, target: entry.target });
      if (entries.has(id)) return false;
      entries.set(id, entry);
    }
    const receipts = new Set<string>();
    for (const receipt of report.receipts) {
      if (!isHistoricalPromotionReceipt(receipt)) return false;
      const id = key({ ...receipt, target: receipt.target.kind }), entry = entries.get(id);
      if (receipts.has(id) || !entry || !["LOADED", "RETAINED"].includes(String(entry.state)) ||
        typeof entry.lastSuccessfulReadAt !== "string" || Date.parse(receipt.at) > Date.parse(entry.lastSuccessfulReadAt) ||
        new TextEncoder().encode(JSON.stringify(receipt)).byteLength > report.limits.maxReceiptBytes) return false;
      receipts.add(id);
    }
    return [...entries].every(([id, entry]) => !["LOADED", "RETAINED"].includes(String(entry.state)) || receipts.has(id));
  } catch { return false; }
}

/** Reading the database today cannot advance the runner's last successful file-read timestamp. */
export function readFleetReceiptSnapshot(value: unknown, now: string): {
  readonly observedAt: string | null;
  readonly freshness: "FRESH" | "STALE" | "UNKNOWN";
  readonly loading: ReadOutcome<FleetReceiptLoadReport>;
} {
  if (value === undefined || value === null) return { observedAt: null, freshness: "UNKNOWN",
    loading: { kind: "NOT_RECORDED", detail: "The owner snapshot has no historical receipt reading. Runner receipt collection is not connected." } };
  if (!isFleetReceiptSnapshot(value) || !isHistoricalReceiptTimestamp(now) || Date.parse(value.observedAt) > Date.parse(now)) {
    return { observedAt: null, freshness: "UNKNOWN", loading: { kind: "STORE_UNREACHABLE", detail: "Historical receipt snapshot has an invalid contract, binding, size or observation time." } };
  }
  const stale = Date.parse(now) - Date.parse(value.observedAt) >= PULSE_STALE_MS;
  const complete = value.loading.kind === "HELD" && value.loading.value.truncated === 0 && value.loading.value.entries.every(e => e.state === "LOADED");
  return { observedAt: value.observedAt, freshness: complete ? stale ? "STALE" : "FRESH" : "UNKNOWN",
    loading: stale && value.loading.kind === "HELD" ? { kind: "HELD", value: { ...value.loading.value,
      entries: value.loading.value.entries.map(entry => entry.state === "LOADED" ? { ...entry, state: "RETAINED",
        gaps: [...entry.gaps, "RECEIPT_SNAPSHOT_STALE"] } : entry) } } : value.loading };
}
