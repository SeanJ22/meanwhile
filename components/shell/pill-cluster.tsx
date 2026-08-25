"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";

import { useDismissOnOutside } from "@/hooks/use-dismiss-on-outside";

import { AskBox } from "@/components/ask/ask-box";
import { ZipSwitcher } from "@/components/map/zip-switcher";
import {
  ballotCoveredForState,
  stateFromOcdIds,
} from "@/lib/ballot/covered-states";
import type { CoverageSummary, CoveredBody } from "@/lib/registry/coverage";
import type { SeatHolder } from "@/lib/officials/lookup";
import { ASK_PILL_LABELS } from "@/lib/routing/ask-pill-labels";
import type { AskPillPlacement } from "@/lib/map/cluster-placement";
import type { SearchItem } from "@/lib/search";

/**
 * THE PILL CLUSTER — G05 rules 4a, 4e and G07, in one component.
 *
 * ## 4e: one instance, and its location is a function of two booleans
 *
 * *"A SINGLE instance of the Ballot/zip+Ask pill cluster: WGH open renders it
 * at the top of WGH; sidebar open and WGH closed renders it at the top of the
 * sidebar; both closed renders it as the map's top-right pill. Location is
 * determined ONLY by which of sidebar and WGH is open; a large battlecard
 * never hosts it, so with a battlecard open the cluster is on the map."*
 *
 * The rule is enforced by `clusterPlacement` below and by the fact that
 * `map-entry` renders this component exactly once — the placements are not
 * three mounts guarded by three conditions, which is the shape that produces
 * two on screen the day a fourth state appears. `tests/pill-cluster.test.ts`
 * pins the function; `scripts/walk-all.mts` COUNTS RENDERED INSTANCES in the
 * live DOM at four zips and both viewports, because a function returning one
 * answer and a page painting one cluster are different claims.
 *
 * ## 4a: Ask is standalone and expands in place
 *
 * *"tapping the Ask pill never opens WGH, Ask expands in place (heading,
 * one-line explainer, input, Ask button), identical wherever the pill
 * appears; Ask's expansion is NOT a surface for 4c and never closes the
 * sidebar, WGH or a battlecard."*
 *
 * Before this, the map's Ask pill called `openAsk`, which un-collapsed the
 * who-governs card and scrolled its cursor into the box living inside it —
 * tapping Ask opened a different surface, which is exactly what 4a forbids.
 * The expansion is now local state on this component: it opens under the pill,
 * it closes nothing, and no other surface learns that it happened. It is
 * deliberately NOT wired into the one-surface-at-a-time rule (4c) — that rule
 * governs sidebar, WGH and the battlecard, and the ruling exempts Ask by name.
 *
 * ## G07: the label teaches
 *
 * The pill never reads a bare "Ask". Every placement's label names at least
 * one concrete example, and the strings and the widths that forced them live
 * in `lib/routing/ask-pill-labels.ts` so the doc and the render cannot drift.
 */

export function PillCluster({
  placement,
  zip,
  coverage,
  onPickZip,
  askOpen,
  onToggleAsk,
  ocdIds,
  onSearchPick,
  onOpenBody,
  onOpenPerson,
}: {
  placement: AskPillPlacement;
  /** The zip the viewport currently resolves to. Null hides the pills. */
  zip: string | null;
  coverage: CoverageSummary | null;
  onPickZip: (zip: string, lat: number, lng: number) => void;
  askOpen: boolean;
  onToggleAsk: (open: boolean) => void;
  /** The divisions in view, for the ask log row. */
  ocdIds: string[];
  /** M119's search half. Present wherever a map is behind the cluster. */
  onSearchPick?: (item: SearchItem) => void;
  /** ASK-4/ASK-8: the who-governs card's own body opener, threaded to Ask so
      every placement of the panel opens battlecards rather than leaving. */
  onOpenBody?: (body: CoveredBody) => void;
  /** ASK-3/ASK-8: the who-governs card's own person opener. */
  onOpenPerson?: (holder: SeatHolder) => void;
}) {
  const [switching, setSwitching] = useState(false);

  /*
   * F01 8.1 (2026-08-19, the author): "there is also no way for me to close
   * the ask pop-up... tapping or clicking anywhere else should close that ask
   * box. It does that if I click on who governs here, but if I click on a
   * meeting pin it does not. Make it uniform."
   *
   * It was never uniform, because the Ask expansion had NO dismiss path of its
   * own. What looked like "it works on who-governs" was the who-governs card
   * minimising itself and taking the cluster it hosts down with it — a side
   * effect of a DIFFERENT surface's dismissal, which is exactly why it vanished
   * the moment the cluster was on the map instead.
   *
   * So the expansion gets the SAME hook every other dismissible surface on the
   * map already uses (`useDismissOnOutside`, M90) rather than a second
   * implementation of the idea: pointerdown in the capture phase, no history
   * entry, and it dismisses nothing but itself. The ref is on the whole
   * cluster, so pressing the pill, the ballot link or the zip switcher is an
   * INSIDE press and the pill's own toggle stays the explicit control.
   */
  const rootRef = useRef<HTMLDivElement>(null);
  const closeAsk = useCallback(() => onToggleAsk(false), [onToggleAsk]);
  useDismissOnOutside(rootRef, closeAsk, askOpen);

  if (!zip || !/^\d{5}$/.test(zip)) return null;

  const state = coverage
    ? stateFromOcdIds([
        ...coverage.seats.map((s) => s.ocdId),
        ...coverage.bodies.map((b) => b.ocdId),
      ])
    : null;
  const covered = state === null || ballotCoveredForState(state);
  const pill = ASK_PILL_LABELS[placement];

  return (
    <div className="map-floaters" data-pill-cluster={placement} ref={rootRef}>
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

        <button
          type="button"
          className="ask-pill"
          data-ask-pill={placement}
          aria-expanded={askOpen}
          aria-label={pill.ariaLabel}
          onClick={() => onToggleAsk(!askOpen)}
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
            <path d="M9.1 9a3 3 0 1 1 4.2 2.7c-.8.4-1.3 1.1-1.3 2" />
            <line x1="12" y1="17.5" x2="12.01" y2="17.5" />
            <circle cx="12" cy="12" r="9.5" />
          </svg>
          <span>{pill.label}</span>
        </button>
      </div>

      {switching && (
        <ZipSwitcher
          current={zip}
          onPick={onPickZip}
          onClose={() => setSwitching(false)}
        />
      )}

      {/*
        4a: the expansion, in place. It opens under the pill that produced it
        and closes nothing else. `coverage` is required to answer at all, so
        the pill still opens without it and the panel says what is missing
        rather than rendering an input that cannot route.
      */}
      {askOpen && (
        <div className="ask-expansion pointer-events-auto">
          {coverage ? (
            <AskBox
              coverage={coverage}
              zip={zip}
              ocdIds={ocdIds}
              onSearchPick={onSearchPick}
              onOpenBody={onOpenBody}
              onOpenPerson={onOpenPerson}
            />
          ) : (
            <p className="mt-3.5 rounded-[10px] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-3.5 text-[0.75rem] leading-relaxed text-voice shadow-[var(--shadow-panel)]">
              We have not resolved who governs this point yet, so there is
              nothing here to route a question against. Move the map or set a
              zip and ask again.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
