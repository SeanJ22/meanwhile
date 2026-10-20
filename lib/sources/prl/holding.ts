import type { PrlArchiveStore } from "./archive-store.ts";
import type { PrlIngestReceipt } from "./receipt.ts";

/**
 * The receipt is the durable per-dataset state. It lives in the object store as
 * `<datasetId>/state.json`, beside the dataset's rows, so the restart cursor and
 * the raw rows share one durable home and a run reads back exactly what the
 * prior run wrote.
 */

export function receiptKey(datasetId: string): string {
  return `${datasetId}/state.json`;
}

export async function writeReceipt(archive: PrlArchiveStore, receipt: PrlIngestReceipt): Promise<void> {
  const body = new TextEncoder().encode(`${JSON.stringify(receipt, null, 2)}\n`);
  await archive.put(receiptKey(receipt.datasetId), body, "application/json");
}

/** Read the prior receipt for a dataset, or null on first load / unreadable state. */
export async function readReceipt(archive: PrlArchiveStore, datasetId: string): Promise<PrlIngestReceipt | null> {
  const bytes = await archive.get(receiptKey(datasetId));
  if (!bytes) return null;
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as PrlIngestReceipt;
    return value.formatVersion === 1 && value.datasetId === datasetId ? value : null;
  } catch {
    return null;
  }
}
