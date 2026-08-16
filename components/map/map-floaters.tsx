"use client";

import Link from "next/link";
import { useState } from "react";

import {
  ballotCoveredForState,
  stateFromOcdIds,
} from "@/lib/ballot/covered-states";
import type { CoverageSummary } from "@/lib/registry/coverage";

import { ZipSwitcher } from "./zip-switcher";

/**
 * The top-right floaters: the ballot entry, the zip, and Ask (item 2,
 * 2026-08-15).
 *
 * The author's two notes drive the whole shape. The ballot pill "is a
 * standout entry and renders like one" — so it is large, filled and
 * unmistakable at 390px rather than a 10px mono whisper among the map
 * controls. And "I don't want to have to dig to find it" about the ask box —
 * so Ask sits beside it as a peer, one tap from anywhere on the map.
 *
 * **Three tap targets, two of them nested in one pill.** The ballot pill
 * carries the ballot link AND the zip button, because they belong to the same
 * thought ("what's on the ballot — here"): an `<a>` cannot contain a
 * `<button>`, so they are siblings inside a shared shell with a hairline
 * between them. The zip is a button because tapping the place you are is how
 * a reader asks to be somewhere else (item 3).
 *
 * Ask does NOT mount a second ask box. There are already two on the page (the
 * who-governs card's and the rail's) and a third instance would be a third
 * place for the same question to be half-typed. It expands the card and puts
 * the cursor in the box that is already there — the affordance is the
 * discovery problem, not the box.
 */
export function MapFloaters({
  zip,
  coverage,
  onPickZip,
  onAsk,
}: {
  /** The zip the viewport currently resolves to. Null hides the pills. */
  zip: string | null;
  coverage: CoverageSummary | null;
  onPickZip: (zip: string, lat: number, lng: number) => void;
  /** Opens the who-governs card and focuses its ask box. */
  onAsk: () => void;
}) {
  const [switching, setSwitching] = useState(false);

  if (!zip || !/^\d{5}$/.test(zip)) return null;

  const state = coverage
    ? stateFromOcdIds([
        ...coverage.seats.map((s) => s.ocdId),
        ...coverage.bodies.map((b) => b.ocdId),
      ])
    : null;
  const covered = state === null || ballotCoveredForState(state);

  return (
    <div className="map-floaters">
      <div className="map-floaters-row">
        <div className="ballot-pill">
          <Link
            href={`/ballot?zip=${zip}`}
            className="ballot-pill-main"
            title={
              covered
                ? `What's on the ballot near ${zip}`
                : "Ballot for this area coming soon"
            }
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              aria-hidden="true"
            >
              <path d="M5 12l4 4L19 6" />
              <rect x="3" y="10" width="18" height="10" rx="1.5" />
            </svg>
            <span>Ballot</span>
            {!covered && <span className="ballot-pill-soon">soon</span>}
          </Link>
          <button
            type="button"
            className="ballot-pill-zip"
            aria-label={`Showing ${zip} — change`}
            aria-expanded={switching}
            onClick={() => setSwitching((v) => !v)}
          >
            {zip}
            {/* Item 4's chevron audit (2026-08-16): this one never moved at
                all. `aria-expanded` flipped and the arrow stayed pointing
                down while the switcher was open — a state indicator that
                does not indicate its state is worse than none, because the
                reader learns the app's signals are noise. */}
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              aria-hidden="true"
              className="zip-chevron"
              data-open={switching || undefined}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>

        <button type="button" className="ask-pill" onClick={onAsk}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            aria-hidden="true"
          >
            <path d="M9.1 9a3 3 0 1 1 4.2 2.7c-.8.4-1.3 1.1-1.3 2" />
            <line x1="12" y1="17.5" x2="12.01" y2="17.5" />
            <circle cx="12" cy="12" r="9.5" />
          </svg>
          <span>Ask</span>
        </button>
      </div>

      {switching && (
        <ZipSwitcher
          current={zip}
          onPick={onPickZip}
          onClose={() => setSwitching(false)}
        />
      )}
    </div>
  );
}
