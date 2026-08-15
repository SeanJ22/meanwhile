import { SOURCE_WIRING } from "../registry/source-wiring.ts";
import type { CoveredBody } from "../registry/coverage.ts";

/**
 * Which bodies at this point publish no past meetings, and why (M58).
 *
 * The rule this exists to keep: **a Concluded surface is never silently
 * empty.** Either the jurisdiction has concluded meetings and they render,
 * or it does not and the reader is told which body's system is the reason.
 * An empty list with no explanation reads as a claim about a government —
 * "this council does not meet" — when the truth is a fact about a vendor's
 * feed, and CLAUDE.md's honesty-about-coverage-gaps exception is one of the
 * exactly four kinds of friction allowed to survive.
 *
 * Keyed by `bodyId`, never by name (the universal-join-key rule).
 */

export interface HistoryGap {
  bodyId: string;
  /** The publishing body, as the reader would say it. */
  bodyName: string;
  jurisdiction: string;
  reason: string;
}

const GAPS_BY_BODY_ID = new Map<string, HistoryGap>(
  SOURCE_WIRING.filter((row) => row.publishesHistory === false).map((row) => [
    row.bodyId,
    {
      bodyId: row.bodyId,
      bodyName: row.publishingOrg,
      jurisdiction: row.jurisdiction,
      // Enforced by tests/source-adapters.test.ts: the flag may not ship
      // without a reader-facing reason, or the note would say nothing.
      reason: row.historyGapReason ?? "",
    },
  ]),
);

/** Every wired body, anywhere, whose route serves no concluded meetings. */
export function allHistoryGaps(): HistoryGap[] {
  return [...GAPS_BY_BODY_ID.values()];
}

/**
 * The gaps that apply to the bodies covering the reader's point.
 *
 * Coverage bodies come from the registry and carry the same `bodyId` the
 * wiring rows do, so this is an id join and cannot drift on a renamed board.
 */
export function historyGapsFor(
  bodies: readonly Pick<CoveredBody, "bodyId">[],
): HistoryGap[] {
  const out: HistoryGap[] = [];
  for (const body of bodies) {
    const gap = GAPS_BY_BODY_ID.get(body.bodyId);
    if (gap) out.push(gap);
  }
  return out;
}

/**
 * The sentence the empty Concluded surface renders, or null when there is
 * nothing honest to add.
 *
 * Null in two cases, and they are different facts: the reader is not asking
 * about the past at all, or every body here does publish its history and the
 * emptiness is a real "nothing in the last 90 days" — which the caller's own
 * copy already covers.
 */
export function concludedGapNote(
  askingForConcluded: boolean,
  bodies: readonly Pick<CoveredBody, "bodyId">[],
): string | null {
  if (!askingForConcluded) return null;
  const gaps = historyGapsFor(bodies);
  if (gaps.length === 0) return null;

  const named = gaps.map((g) => `${g.bodyName} — ${g.reason}`);
  return `We can't show past meetings for ${
    gaps.length === 1 ? "one body" : `${gaps.length} bodies`
  } here: ${named.join(" ")}`;
}
