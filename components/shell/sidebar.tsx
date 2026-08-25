"use client";

import type { ReactNode } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import { useShellData } from "@/lib/state/data";

import { FiltersArea } from "./filters-area";
import { NearMeControl } from "./near-me-control";
import { ScopeSelectors } from "./scope-selectors";
import { StatsBar } from "./stats-bar";
import { ViewToggle } from "./view-toggle";
import { PRODUCT_NAME } from "@/lib/brand";

/**
 * The fixed left rail.
 *
 * Structure follows EdiaStratMap: a header that does not scroll, holding the
 * brand, the theme and reset buttons, the view toggle and the scope selectors;
 * then everything else in a scrolling column.
 *
 * ## M119 — ONE INPUT (2026-08-17)
 *
 * The rail used to carry two text inputs: the ask box near the top and the
 * entity search five controls down. The author's ruling was one, keyword-
 * first, with anything else routing as an ask. Both are now the single input
 * inside the pill cluster's Ask expansion (`components/ask/ask-box.tsx`), and
 * `search-box.tsx` is gone rather than left dark — a second component that
 * still renders an input is how "one input" quietly becomes two again.
 *
 * The rail therefore renders NO input of its own. What it renders is the slot
 * (4e) where the single pill cluster lands when the rail is the surface on
 * screen, and the cluster is constructed in `map-entry` so there is exactly
 * one of it.
 */

export function Sidebar({
  onReset,
  onChangeLocation,
  showDistricts,
  districtsFailed,
  onToggleDistricts,
  mobileOpen,
  onMobileClose,
  onNearMePoint,
  pillCluster,
  clusterElsewhere = false,
}: {
  onReset: () => void;
  /** Reopens the welcome overlay. */
  onChangeLocation: () => void;
  /** Owned by use-district-layer, which persists it. The store mirrors it. */
  showDistricts: boolean;
  districtsFailed: boolean;
  onToggleDistricts: (value: boolean) => void;
  /** Phone width only: the rail is a drawer, and this is its state. */
  mobileOpen: boolean;
  onMobileClose: () => void;
  /** 6f: Near me resolved a point — the map answers at it (D53 machinery). */
  onNearMePoint?: (point: { lat: number; lng: number }) => void;
  /**
   * 4e: the single pill cluster, when the rail is where it belongs. Null at
   * every other moment — the rail never builds one of its own, because a
   * second constructor is a second instance waiting to happen.
   */
  pillCluster?: ReactNode;
  /**
   * A cluster painted SOMEWHERE — here, or on the who-governs card. The rail's
   * own ballot link is the fallback for there being no cluster AT ALL, so it
   * is suppressed by this rather than by the local slot being empty. Without
   * the distinction, a desktop showing the rail and the card at once carries
   * two doors onto one surface.
   */
  clusterElsewhere?: boolean;
}) {
  const { location } = useShellData();

  return (
    /*
     * `data-dismiss-exempt` — g12, and the defect it fixes is a real one that
     * `pnpm walk:all` caught against production before anybody read a line of
     * this file.
     *
     * The who-governs card dismisses on any press outside it. Before 4e that
     * was harmless: the rail's header was a static ballot link and minimizing
     * the card changed nothing in the rail. Now the card minimizing MOVES THE
     * PILL CLUSTER INTO THE RAIL'S HEADER, which grows it by about a hundred
     * pixels — so the reader's first press on any rail control at desktop
     * minimized the card, shifted everything under their finger downward, and
     * the mouseup landed somewhere else. **The click did nothing**, which is
     * the exact class of defect this session's own rules name.
     *
     * The rail is a PEER SURFACE, not the background: pressing it is using the
     * app, not putting down what you were reading. So it is exempt, the layout
     * never shifts under a press, and 4c is untouched — every explicit open
     * still goes through `openSurface`, which closes the other two.
     */
    <aside
      data-dismiss-exempt
      className={`sidebar${mobileOpen ? " sidebar-open" : ""}`}
    >
      <div className="sidebar-header">
        <div className="brand">
          {/* Slide the rail away — any width (2f); 44px thumb target. The
              hamburger in map-entry brings it back. */}
          <button
            type="button"
            className="icon-btn -ml-1 flex size-11 shrink-0 items-center justify-center"
            aria-label="Hide sidebar"
            title="Hide sidebar"
            onClick={onMobileClose}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <polyline points="11 17 6 12 11 7" />
              <polyline points="18 17 13 12 18 7" />
            </svg>
          </button>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--accent-local)"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M21 10c0 6-9 12-9 12s-9-6-9-12a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>

          <span className="brand-name">
            {PRODUCT_NAME}
            <span className="brand-sub">
              {location ? (
                <>
                  Meetings near {location.zip}
                  <button
                    type="button"
                    className="brand-change"
                    onClick={onChangeLocation}
                  >
                    Change
                  </button>
                </>
              ) : (
                "Public meetings near you"
              )}
            </span>
          </span>

          <ThemeToggle className="theme-toggle-btn" />

          <button
            type="button"
            className="icon-btn reset-view-btn"
            title="Reset view"
            aria-label="Reset view"
            onClick={onReset}
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
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <polyline points="3 4 3 9 8 9" />
            </svg>
          </button>
        </div>

        {/*
          Item 2 of the tester's mobile pass (2026-08-14): the ballot link
          used to sit in this rail's FOOTER, under `mt-auto` — the very
          bottom of a drawer that on a phone runs under the browser chrome.
          The tester: "I don't think I would have found that without knowing
          it existed." It moves to the header, above the fold at every
          width, in words rather than an icon. The product's core surface
          does not live at the bottom of a menu.
        */}
        {/*
          4e: when the cluster is here, IT carries the ballot door — its
          ballot pill is the same entry, with the zip beside it. Rendering the
          rail's own link as well would be two doors onto one surface, which is
          the duplicate-entry-point friction CLAUDE.md calls a defect.

          The plain link stays as the fallback for the moments the cluster is
          somewhere else (the first paint before the breakpoint is read, and
          the case where no zip has resolved and the cluster renders nothing).
          The rail never loses its ballot door; it just stops carrying two.
        */}
        {pillCluster ??
          (clusterElsewhere ? null : (
            <a
              href={location ? `/ballot?zip=${location.zip}` : "/ballot"}
              className="sidebar-ballot-entry"
            >
              <span>What&apos;s on the ballot</span>
              <span aria-hidden="true">→</span>
            </a>
          ))}

        <ViewToggle />
        <ScopeSelectors />
      </div>

      <div className="sidebar-scroll">
        {/*
          LAY-4 (2026-08-24): the who-governs card is NOT here. LAY-1 nested
          it in this column; the author's arrows put it back in the viewport
          BENEATH the rail, and the supersession table says LAY-1 must not
          exist as built. The rail renders the counts and nothing else claims
          its column.
        */}
        <StatsBar />
        {/* M119: the rail's second input is gone. Searching a meeting, body,
            district or person by name happens in the one input above. */}
        {/*
          g4 item 14: "Limit radius" and "Show districts" MOVED INSIDE
          Filters; "Near me" stays out here.

          The distinction the author is drawing is what each control is FOR.
          Near me answers "where am I" — it is a way of telling the product
          where the reader is standing, which is the same job as the zip, and
          it keeps its honest approximate-location note beside it. Limiting
          the radius and drawing district boundaries are both ways of
          narrowing or annotating what is ALREADY on screen, which is what
          Filters is.

          6f: the resolved point rides up to the map, which answers at it.
        */}
        <NearMeControl onPoint={onNearMePoint} />

        <FiltersArea
          showDistricts={showDistricts}
          districtsFailed={districtsFailed}
          onToggleDistricts={onToggleDistricts}
        />

        {/*
          **LAY-8 (2026-08-25) — the footer LEFT this column.**

          The author's annotated capture `08-53-15` draws a red DOTTED ARROW
          from this block down past the bottom of the rail to the "Last
          checked" line at the foot of the page. It is now rendered there, in
          `components/map/site-footnote.tsx`, beside the freshness line rather
          than inside the rail.

          Why it belongs there and not here: both are the same KIND of thing —
          quiet standing provenance about the product itself, read once and
          then ignored — and the rail is the column a reader is trying to get
          THROUGH. Two footnotes in two places is one of them nobody finds.

          The links are unchanged and neither was deleted. The block is only
          gone from this component; see `site-footnote.tsx` for why it renders
          unconditionally there.
        */}
      </div>
    </aside>
  );
}
