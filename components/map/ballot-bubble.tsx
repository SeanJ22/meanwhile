"use client";

import Link from "next/link";

import {
  ballotCoveredForState,
  stateFromOcdIds,
} from "@/lib/ballot/covered-states";
import type { CoverageSummary } from "@/lib/registry/coverage";

/**
 * The ballot entry point (2b/2d/2e): a visible bubble at the top of the map,
 * in the same visual family as the other floating controls — not a footer
 * link a reader has to hunt for.
 *
 * It goes straight to the ballot page in the same tab, and the zip context
 * travels with the click — no confirmation interstitial, no re-asking for a
 * zip the app already knows. And it follows the map: the zip here is the one
 * the viewport currently resolves to (typed or settled), so a reader looking
 * at Tucson is never dropped onto New Jersey's ballot.
 *
 * Where the resolved state has no built ballot yet, the bubble says "coming
 * soon" rather than hiding — an honest gap, not a smoothed-over one. The
 * page behind the click states the same gap with the coverage list.
 */
export function BallotBubble({
  zip,
  coverage,
}: {
  /** The zip the viewport currently resolves to. Null hides the bubble. */
  zip: string | null;
  coverage: CoverageSummary | null;
}) {
  if (!zip || !/^\d{5}$/.test(zip)) return null;

  const state = coverage
    ? stateFromOcdIds([
        ...coverage.seats.map((s) => s.ocdId),
        ...coverage.bodies.map((b) => b.ocdId),
      ])
    : null;
  const covered = state === null || ballotCoveredForState(state);

  return (
    <Link
      href={`/ballot?zip=${zip}`}
      className="ballot-bubble pointer-events-auto"
      title={
        covered
          ? `What's on the ballot near ${zip}`
          : `Ballot for this area coming soon`
      }
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="M5 12l4 4L19 6" />
        <rect x="3" y="10" width="18" height="10" rx="1.5" />
      </svg>
      <span className="ballot-bubble-label">
        Ballot · {zip}
        {!covered && <span className="ballot-bubble-soon">coming soon</span>}
      </span>
    </Link>
  );
}
