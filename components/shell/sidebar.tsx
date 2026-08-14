"use client";

import { ThemeToggle } from "@/components/theme-toggle";
import type { SearchItem } from "@/lib/search";
import { useShellData } from "@/lib/state/data";

import { FiltersArea } from "./filters-area";
import { NearMeControl } from "./near-me-control";
import { RadiusControl } from "./radius-control";
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
export function Sidebar({
  onSearchPick,
  onReset,
  onChangeLocation,
  showDistricts,
  districtsFailed,
  onToggleDistricts,
  mobileOpen,
  onMobileClose,
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

        <ViewToggle />
        <ScopeSelectors />
      </div>

      <div className="sidebar-scroll">
        <StatsBar />
        <SearchBox onPick={onSearchPick} />
        <RadiusControl />
        <NearMeControl />

        <div className="prox-control">
          <label className="prox-toggle">
            <input
              type="checkbox"
              checked={showDistricts}
              disabled={districtsFailed}
              onChange={(e) => onToggleDistricts(e.target.checked)}
            />
            <span className="prox-slider" />
            <span className="prox-label">Show districts</span>
          </label>
          {districtsFailed && (
            <p className="prox-note" style={{ color: "var(--danger)" }}>
              Boundary file didn&apos;t load.
            </p>
          )}
        </div>

        <FiltersArea />

        {/* The sidebar's footer: the disclosure link and the feedback path.
            One line each — the transparency page carries the substance. */}
        <div className="mt-auto border-t border-[var(--panel-border)] px-1 pt-3 pb-2 text-[0.6875rem] leading-relaxed text-muted">
          <p>
            {/* Same tab, zip attached (2c/2d) — no interstitial asking for a
                zip the app already knows. The map's bubble is the primary
                entry point; this stays for readers who look in menus. */}
            <a
              href={location ? `/ballot?zip=${location.zip}` : "/ballot"}
              className="underline decoration-dotted underline-offset-2 hover:text-signal"
            >
              What&apos;s on the ballot
            </a>
          </p>
          <p className="mt-1">
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
