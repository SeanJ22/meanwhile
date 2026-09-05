/**
 * **THE DECISION LOG, COLLAPSED TO ONE ROW PER DECISION.**
 * (ADM-4, the 9.4.26 admin feedback. Lane C.)
 *
 * The owner-decision log in the control plane is APPEND-ONLY. A decision is
 * appended once as the owner makes it, and what became of it is appended
 * later as a SECOND record carrying the same intent id plus a `#resolved`
 * suffix (`scripts/canonicalize-owner-decisions.mts`). Nothing is ever
 * rewritten, which is correct — what he decided at that instant is not
 * editable — and it means the raw log holds two rows for one decision once
 * the decision has landed anywhere.
 *
 * Every consumer that wants "the decisions, and where each one stands" has to
 * fold those pairs the same way, or two surfaces will disagree about whether a
 * decision is still pending. This module is that fold, written once, and it is
 * PURE: it takes rows and returns rows. It reads no store, no clock and no
 * environment, so a test can hand it any log it likes.
 *
 * Type-only imports from `owner-surface.ts`, deliberately: the contract owns
 * the record shape, and this module owns nothing but the fold.
 */

import type { OwnerDecisionIntent } from "./owner-surface.ts";

/** The suffix the canonicalizer appends to the id of a resolution record. */
export const RESOLVED_SUFFIX = "#resolved";

/**
 * The id of the DECISION a record is about.
 *
 * A resolution record's id is the decision's id plus the suffix; stripping it
 * (however many times it was applied — a defensive loop, because a twin of a
 * twin would otherwise be a third "decision" nobody made) names the decision.
 */
export function baseIntentId(intentId: string): string {
  let id = intentId;
  while (id.endsWith(RESOLVED_SUFFIX)) id = id.slice(0, -RESOLVED_SUFFIX.length);
  return id;
}

/** The id a resolution record for `intentId` carries. */
export function resolvedIntentId(intentId: string): string {
  return `${baseIntentId(intentId)}${RESOLVED_SUFFIX}`;
}

/** Is this record the canonicalizer's resolution of a decision, not the decision itself? */
export function isResolutionRecord(row: Pick<OwnerDecisionIntent, "intentId">): boolean {
  return row.intentId.endsWith(RESOLVED_SUFFIX);
}

/**
 * One row per decision, carrying the LATEST state.
 *
 * The rule, in full:
 *
 * - Records are grouped by their base id (the `#resolved` suffix stripped).
 * - A resolution record WINS over the original for `state`, `canonicalRef` and
 *   `refusedReason`, because it is the later fact about the same decision.
 *   Everything the owner wrote — subject, option, consequence, his words, the
 *   session he decided in, when — is taken from the original when one is
 *   present, so a resolution can never quietly change what was decided.
 * - The output is ordered newest `decidedAt` first, and by id when two
 *   decisions share an instant, so the order is a function of the rows and
 *   not of the order the store handed them over in.
 *
 * Input order is irrelevant on purpose: `readDecisions` reverses the log and
 * the file store returns it in append order, and a fold that depended on
 * which of those it was given would be right on exactly one of them.
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
    // A resolution with no surviving original is still a decision the owner
    // made — the record carries every field — so it stands on its own.
    const base = original ?? (resolution as OwnerDecisionIntent);
    const latest = resolution ?? base;
    out.push({
      ...base,
      intentId: id,
      state: latest.state,
      canonicalRef: latest.canonicalRef,
      refusedReason: latest.refusedReason,
      ownerAnswer: base.ownerAnswer ?? null,
      // What the tracker did with it travels on the resolution (ADM-16), so
      // the later fact wins here too; absent on records written before it.
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

/**
 * The newest decision the owner has recorded about one subject, or null when
 * he has recorded none.
 *
 * "Newest" is by `decidedAt`, never by log position, and it is the ONLY
 * decision the tracker applier acts on: a later decision about the same row
 * supersedes an earlier one, and applying both would close a row on an answer
 * he had already changed his mind about.
 */
export function latestDecisionFor(
  rows: readonly OwnerDecisionIntent[],
  subjectId: string,
): OwnerDecisionIntent | null {
  const mine = collapseDecisionLog(rows).filter((r) => r.subjectId === subjectId);
  return mine.length === 0 ? null : mine[0];
}
