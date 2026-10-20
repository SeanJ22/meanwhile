/** Public delivery evidence belongs to an exact approval and Reader key, never a fleet counter. */
export interface ServedReaderWitness {
  readonly itemId: string;
  readonly approvalId: string;
  readonly versionId: string;
  readonly readerKey: string;
  readonly url: string;
  readonly checkedAt: string;
  readonly state: "CONFIRMED" | "NOT_OBSERVED";
  readonly reason: string;
  readonly responseSha256: string | null;
}
export interface ServedReaderReadback {
  readonly checkedAt: string;
  readonly syntheticRunId?: string;
  readonly witnesses: readonly ServedReaderWitness[];
  readonly errors: readonly string[];
}
export const SERVED_READER_MAX_AGE_MS = 3 * 60 * 60 * 1000;
/** Preserve a failed readback's exact reason without counting it as delivery. */
export function latestServedObservation(read: ServedReaderReadback | null, itemId: string, approvalId: string): ServedReaderWitness | null {
  return [...(read?.witnesses ?? [])].filter(w => w.itemId === itemId && w.approvalId === approvalId)
    .sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt))[0] ?? null;
}
export function servedWitness(read: ServedReaderReadback | null, itemId: string, approvalId: string, now: string): ServedReaderWitness | null {
  return read?.witnesses.find(w => w.itemId === itemId && w.approvalId === approvalId && w.state === "CONFIRMED" &&
    Date.parse(now) >= Date.parse(w.checkedAt) && Date.parse(now) - Date.parse(w.checkedAt) <= SERVED_READER_MAX_AGE_MS) ?? null;
}
