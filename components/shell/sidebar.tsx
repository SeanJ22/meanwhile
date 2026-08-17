"use client";

import { ThemeToggle } from "@/components/theme-toggle";
import type { SearchItem } from "@/lib/search";
import { useShellData } from "@/lib/state/data";

import { AskBox } from "@/components/ask/ask-box";

import { FiltersArea } from "./filters-area";
import { NearMeControl } from "./near-me-control";
import { ScopeSelectors } from "./scope-selectors";
import { SearchBox } from "./search-box";
import { StatsBar } from "./stats-bar";
import { ViewToggle } from "./view-toggle";

/**
 * The fixed left rail.
 *
 * Structure follows EdiaStratMap: a header that does not scroll, holding the
 * brand, the theme and reset buttons, the view toggle and the scope selectors;
 * then everything else in a scrolling column.
 */
function SidebarAskBox() {
  const { result, location } = useShellData();
  const coverage = result?.coverage ?? null;
  if (!coverage) return null;
  return (
    <div className="px-1">
      <AskBox
        coverage={coverage}
        zip={location?.zip ?? null}
        ocdIds={[
          ...new Set(
            [
              ...coverage.bodies.map((b) => b.ocdId),
              ...coverage.seats.map((s) => s.ocdId),
            ].filter((id): id is string => Boolean(id)),
          ),
        ]}
      />
    </div>
  );
}

export function Sidebar({
  onSearchPick,
  onReset,
  onChangeLocation,
  showDistricts,
  districtsFailed,
  onToggleDistricts,
  mobileOpen,
  onMobileClose,
  onNearMePoint,
}: {
  onSearchPick: (item: SearchItem) => void;
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
}) {
  const { location } = useShellData();

  return (
    <aside className={`sidebar${mobileOpen ? " sidebar-open" : ""}`}>
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
            We the People
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
        <a
          href={location ? `/ballot?zip=${location.zip}` : "/ballot"}
          className="sidebar-ballot-entry"
        >
          <span>What&apos;s on the ballot</span>
          <span aria-hidden="true">→</span>
        </a>

        {/*
          Item 2 (2026-08-15): the ask box moves to the TOP of the rail,
          directly under the ballot entry — "first things first," the author.
          It used to sit below the filters, five controls down a scrolling
          column, which is the same burial the ballot link was rescued from
          on 2026-08-14. The two doors a reader actually came for now open
          the rail; the machinery for narrowing what is already on screen
          follows underneath.
        */}
        <SidebarAskBox />

        <ViewToggle />
        <ScopeSelectors />
      </div>

      <div className="sidebar-scroll">
        <StatsBar />
        <SearchBox onPick={onSearchPick} />
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

        {/* The sidebar's footer: the disclosure link and the feedback path.
            One line each — the transparency page carries the substance. */}
        <div className="mt-auto border-t border-[var(--panel-border)] px-1 pt-3 pb-2 text-[0.6875rem] leading-relaxed text-muted">
          <p>
            <a
              href="/transparency"
              className="underline decoration-dotted underline-offset-2 hover:text-signal"
            >
              What this site collects
            </a>
          </p>
          <p className="mt-1">
            Feedback:{" "}
            <a
              href="mailto:seanj22@gmail.com"
              className="underline decoration-dotted underline-offset-2 hover:text-signal"
            >
              seanj22@gmail.com
            </a>
          </p>
        </div>
      </div>
    </aside>
  );
}
