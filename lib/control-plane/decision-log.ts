/**
 * Folds the append-only owner-decision log to one row per decision. A
 * resolution is a second record with the same intent id plus `#resolved`.
 * Pure: rows in, rows out.
 */

import type { OwnerDecisionIntent } from "./owner-surface.ts";

/** The suffix on the id of a resolution record. */
export const RESOLVED_SUFFIX = "#resolved";

/** The id of the decision a record is about; strips the suffix however many times it was applied. */
export function baseIntentId(intentId: string): string {
  let id = intentId;
  while (id.endsWith(RESOLVED_SUFFIX)) id = id.slice(0, -RESOLVED_SUFFIX.length);
  return id;
}

/** Is this record a resolution of a decision, not the decision itself? */
export function isResolutionRecord(row: Pick<OwnerDecisionIntent, "intentId">): boolean {
  return row.intentId.endsWith(RESOLVED_SUFFIX);
}

/**
 * One row per decision, carrying the latest state, newest `decidedAt` first
 * (ties by id). A resolution wins for `state`, `canonicalRef` and
 * `refusedReason`; everything else comes from the original when present, so a
 * resolution cannot change what was decided. Input order is irrelevant.
 */
export function collapseDecisionLog(
  rows: readonly OwnerDecisionIntent[],
): readonly OwnerDecisionIntent[] {
  const originals = new Map<string, OwnerDecisionIntent>();
  const resolutions = new Map<string, OwnerDecisionIntent>();
  for (const row of rows) {
    const id = baseIntentId(row.intentId);
    if (isResolutionRecord(row)) resolutions.set(id, row);
    else originals.set(id, row);
  }
  const ids = new Set<string>([...originals.keys(), ...resolutions.keys()]);
  const out: OwnerDecisionIntent[] = [];
  for (const id of ids) {
    const original = originals.get(id);
    const resolution = resolutions.get(id);
    // A resolution with no surviving original carries every field, so it stands alone.
    const base = original ?? (resolution as OwnerDecisionIntent);
    const latest = resolution ?? base;
    out.push({
      ...base,
      intentId: id,
      state: latest.state,
      canonicalRef: latest.canonicalRef,
      refusedReason: latest.refusedReason,
      ownerAnswer: base.ownerAnswer ?? null,
      // Absent on older records.
      openedWork: latest.openedWork ?? base.openedWork,
      subjectTitle: latest.subjectTitle ?? base.subjectTitle ?? null,
    });
  }
  return out.sort(compareNewestFirst);
}

function compareNewestFirst(a: OwnerDecisionIntent, b: OwnerDecisionIntent): number {
  if (a.decidedAt !== b.decidedAt) return a.decidedAt < b.decidedAt ? 1 : -1;
  if (a.intentId === b.intentId) return 0;
  return a.intentId < b.intentId ? 1 : -1;
}
