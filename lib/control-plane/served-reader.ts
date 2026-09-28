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
/** One latest observation per exact item, approval, Reader key, and version.
 * An invalid observation time makes that identity unprovable, rather than
 * letting an older success stand in for it. */
export function latestServedWitnesses(read: ServedReaderReadback | null): readonly ServedReaderWitness[] {
  const latest = new Map<string, ServedReaderWitness | null>();
  for (const witness of read?.witnesses ?? []) {
    // A newer failed observation revokes only its own Reader key and version.
    const key = JSON.stringify([witness.itemId, witness.approvalId, witness.readerKey, witness.versionId]);
    const checkedAt = Date.parse(witness.checkedAt);
    if (!Number.isFinite(checkedAt)) {
      latest.set(key, null);
      continue;
    }
    const prior = latest.get(key);
    if (prior === null && latest.has(key)) continue;
    const priorAt = prior ? Date.parse(prior.checkedAt) : -Infinity;
    if (checkedAt > priorAt || (checkedAt === priorAt && witness.state === "NOT_OBSERVED")) latest.set(key, witness);
  }
  return [...latest.values()].filter((w): w is ServedReaderWitness => w !== null);
}
export function servedWitness(read: ServedReaderReadback | null, itemId: string, approvalId: string, now: string, versionId?: string): ServedReaderWitness | null {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) return null;
  return latestServedWitnesses(read).filter(w => w.itemId === itemId && w.approvalId === approvalId &&
    (versionId === undefined || w.versionId === versionId) && w.state === "CONFIRMED" &&
    nowMs >= Date.parse(w.checkedAt) && nowMs - Date.parse(w.checkedAt) <= SERVED_READER_MAX_AGE_MS)
    .sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt))[0] ?? null;
}
