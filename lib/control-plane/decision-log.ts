/**
 * **ONE ROW PER DECISION.** (ADM-4, 9.4.26 admin feedback.)
 *
 * The decision log is append-only: the dashboard appends the owner's intent
 * as PENDING_CANONICALIZATION, and a later local run appends a twin record
 * suffixed `#resolved` carrying the state it reached. Read raw, the log shows
 * two rows per decision forever. This collapses them: one row per base intent
 * id, the latest state winning, newest first. PURE.
 */
import type { OwnerDecisionIntent } from "./owner-surface.ts";

const RESOLVED_SUFFIX = "#resolved";

export function baseIntentId(intentId: string): string {
  return intentId.endsWith(RESOLVED_SUFFIX) ? intentId.slice(0, -RESOLVED_SUFFIX.length) : intentId;
}

/** One record per decision, the `#resolved` twin winning over its original, newest decidedAt first. */
export function collapseDecisionLog(rows: readonly OwnerDecisionIntent[]): OwnerDecisionIntent[] {
  const byBase = new Map<string, OwnerDecisionIntent>();
  const twinSeen = new Set<string>();
  for (const row of rows) {
    const base = baseIntentId(row.intentId);
    const isTwin = row.intentId !== base;
    // A twin always wins over its original; an original never overrides a twin.
    if (isTwin) {
      byBase.set(base, { ...row, intentId: base });
      twinSeen.add(base);
    } else if (!twinSeen.has(base)) {
      byBase.set(base, row);
    }
  }
  return [...byBase.values()].sort((a, b) => (a.decidedAt < b.decidedAt ? 1 : a.decidedAt > b.decidedAt ? -1 : 0));
}

/** The newest decision recorded for a subject, or null. */
export function latestDecisionFor(rows: readonly OwnerDecisionIntent[], subjectId: string): OwnerDecisionIntent | null {
  return collapseDecisionLog(rows).find((r) => r.subjectId === subjectId) ?? null;
}
