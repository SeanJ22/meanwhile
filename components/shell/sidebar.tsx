"use client";

import { useState, type ReactNode } from "react";

import { Logo } from "@/components/brand/logo";
import { DataFreshness } from "@/components/map/data-freshness";
import { Legend } from "@/components/map/legend";
import { TutorialReplayButton } from "@/components/map/tutorial-overlay";
import { ResetViewButton } from "@/components/reset-view-button";
import { ThemeToggle } from "@/components/theme-toggle";
import type { SnapshotStatus } from "@/lib/meetings/freshness";
import { useShellData } from "@/lib/state/data";

import { FiltersArea } from "./filters-area";
import { NearMeControl } from "./near-me-control";
import { ScopeSelectors } from "./scope-selectors";
import { StatsBar } from "./stats-bar";
import { NationalLink } from "./national-link";
import { ViewToggle } from "./view-toggle";

/**
 * The reader's sidebar: wordmark and controls, the compound nav with Ask (one
 * node from `map-entry`), the tier well, Jurisdiction and Body selects, then
 * stat tiles, Near me, Filters and About this data. On a phone it is the
 * bottom sheet.
 */
export function Sidebar({
  onReset,
  showDistricts,
  districtsFailed,
  onToggleDistricts,
  mobileOpen,
  onMobileClose,
  onNearMePoint,
  nav,
  snapshot,
  onJurisdictionChosen,
}: {
  onReset: () => void;
  /** Owned by use-district-layer, which persists it. The store mirrors it. */
  showDistricts: boolean;
  districtsFailed: boolean;
  onToggleDistricts: (value: boolean) => void;
  /** The rail's open state at phone width (the bottom sheet). */
  mobileOpen: boolean;
  /** Collapses the rail at any width. */
  onMobileClose: () => void;
  /** Near me resolved a point — the map answers at it. */
  onNearMePoint?: (point: { lat: number; lng: number }) => void;
  /** The compound nav and the Ask pill, built once in map-entry. */
  nav?: ReactNode;
  /** A jurisdiction was picked — the map shows its whole boundary. */
  onJurisdictionChosen?: (ocdId: string) => void;
  /** The meetings snapshot, for the About this data freshness line. */
  snapshot?: SnapshotStatus | null;
}) {
  const { location } = useShellData();
  const [aboutOpen, setAboutOpen] = useState(false);
  const carriedShown = (snapshot?.carried?.count ?? 0) > 0;

  return (
    <aside
      data-dismiss-exempt
      className={`sidebar${mobileOpen ? " sidebar-open" : ""}`}
      aria-label="Meetings, filters and more"
    >
      <button
        type="button"
        className="mw-sheet-close"
        onClick={onMobileClose}
      >
        <span aria-hidden="true">▾</span> Close
      </button>
      <div className="sidebar-header">
        <div className="brand">
          <span className="brand-name">
            <Logo variant="wordmark" size={32} />
          </span>
          <span className="mw-brand-actions">
            <ResetViewButton onReset={onReset} />
            <ThemeToggle className="theme-toggle-btn" />
            <button
              type="button"
              className="mw-ctl-btn mw-collapse-btn"
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              onClick={onMobileClose}
            >
              <span aria-hidden="true">«</span>
            </button>
          </span>
        </div>

        {nav ?? (
          <a
            href={location ? `/ballot?zip=${location.zip}` : "/ballot"}
            className="sidebar-ballot-entry"
          >
            <span>What&apos;s on the ballot</span>
            <span aria-hidden="true">→</span>
          </a>
        )}

        <ViewToggle />
        <NationalLink />
        <ScopeSelectors onJurisdictionChosen={onJurisdictionChosen} />
      </div>

      <div className="sidebar-scroll">
        <StatsBar />
        <NearMeControl onPoint={onNearMePoint} />
        <FiltersArea
          showDistricts={showDistricts}
          districtsFailed={districtsFailed}
          onToggleDistricts={onToggleDistricts}
        />
        <div className="mw-phone-legend">
          <Legend inline />
        </div>
        {carriedShown && snapshot && (
          // Listings this refresh could not re-fetch are older than "Checked … ago".
          <div className="mw-carried-note">
            <DataFreshness snapshot={snapshot} />
          </div>
        )}
        <div className="mw-disclosure" data-open={aboutOpen || undefined}>
          <button
            type="button"
            className="mw-disclosure-head"
            aria-expanded={aboutOpen}
            onClick={() => setAboutOpen((v) => !v)}
          >
            <span>
              <span aria-hidden="true">{aboutOpen ? "▾" : "▸"}</span> About this
              data
            </span>
            {snapshot && (
              <span className="mw-disclosure-meta">
                <DataFreshness snapshot={snapshot} compact />
              </span>
            )}
          </button>
          {aboutOpen && (
            <div className="mw-disclosure-body">
              {snapshot && !carriedShown && <DataFreshness snapshot={snapshot} />}
              <div className="mw-link-row">
                <a href="/about-area/compare">Compare states</a>
                {location && (
                  <a href={`/about-area?zip=${location.zip}`}>About this area</a>
                )}
                <a href="/transparency">What this site collects</a>
                <a href="/feedback">Feedback</a>
              </div>
              <div className="mw-link-row">
                <TutorialReplayButton />
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
