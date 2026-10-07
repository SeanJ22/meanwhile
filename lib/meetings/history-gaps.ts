import { activeWiring, type BodySourceWiring } from "../registry/source-wiring.ts";
import type { CoveredBody } from "../registry/coverage.ts";

/** Bodies whose route publishes no past meetings, so an empty Concluded surface is never silent. Keyed by `bodyId`. */

export interface HistoryGap {
  bodyId: string;
  /** The publishing body, as the reader would say it. */
  bodyName: string;
  jurisdiction: string;
  reason: string;
}

/** Built from the doors in use, and rebuilt when a pass installs a different list. */
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

/** The sentence the empty Concluded surface renders, or null when there is nothing honest to add. */
export function concludedGapNote(
  askingForConcluded: boolean,
  bodies: readonly Pick<CoveredBody, "bodyId">[],
): string | null {
  return concludedGapNoteFor(askingForConcluded, historyGapsFor(bodies));
}

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
