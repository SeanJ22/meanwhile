import { activeWiring, type BodySourceWiring } from "../registry/source-wiring.ts";
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

/** Built from the doors in use, and rebuilt when a pass installs a different list (DB-15). */
let gapsFor: { readonly wiring: readonly BodySourceWiring[]; readonly gaps: ReadonlyMap<string, HistoryGap> } | null = null;

function gapsByBodyId(): ReadonlyMap<string, HistoryGap> {
  const wiring = activeWiring();
  if (gapsFor?.wiring !== wiring) gapsFor = { wiring, gaps: buildGaps(wiring) };
  return gapsFor.gaps;
}

function buildGaps(wiring: readonly BodySourceWiring[]): Map<string, HistoryGap> {
  return new Map<string, HistoryGap>(
  wiring.filter((row) => row.publishesHistory === false).map((row) => [
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
}

/** Every wired body, anywhere, whose route serves no concluded meetings. */
export function allHistoryGaps(): HistoryGap[] {
  return [...gapsByBodyId().values()];
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
    const gap = gapsByBodyId().get(body.bodyId);
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
  return concludedGapNoteFor(askingForConcluded, historyGapsFor(bodies));
}

/**
 * The same sentence, built from gaps the caller already has.
 *
 * Split out on 2026-08-15 because M59 closed the last two gaps and the wiring
 * rows now record none — which left the note's own behaviour untestable
 * through the registry. It is not dead code: it is the machinery that keeps a
 * Concluded surface from being silently empty, and the next unwired vendor
 * will need it. Testing it directly is how it survives the interval.
 */
export function concludedGapNoteFor(
  askingForConcluded: boolean,
  gaps: readonly HistoryGap[],
): string | null {
  if (!askingForConcluded) return null;
  if (gaps.length === 0) return null;

  const named = gaps.map((g) => `${g.bodyName} — ${g.reason}`);
  return `We can't show past meetings for ${
    gaps.length === 1 ? "one body" : `${gaps.length} bodies`
  } here: ${named.join(" ")}`;
}
