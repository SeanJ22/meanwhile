"use client";

import { useState } from "react";

import { BoundaryLegend } from "@/components/map/boundary-legend";
import { RadiusControl } from "@/components/shell/radius-control";
import { useDistrictLayer } from "@/hooks/use-district-layer";
import {
  CONCLUDED_LOOKBACK_DAYS,
  UPCOMING_HORIZON_DAYS,
} from "@/lib/meetings/constants";
import type { MeetingStatus } from "@/lib/sources/types";
import { BODY_TYPE_LABEL } from "@/lib/state/derive";
import {
  interactionTurnsOverlayOn,
  type DistrictInteraction,
} from "@/lib/state/district-intent";
import { ALL_DISTRICT_TYPES } from "@/lib/state/reducer";
import { activeControlCount } from "@/lib/state/reset";
import { useUi, useUiDispatch } from "@/lib/state/provider";
import type { BodyType, DistrictType } from "@/lib/state/types";

/** The filters panel. */

const STATUSES: { value: MeetingStatus; label: string; accent: string }[] = [
  { value: "SCHEDULED", label: "Upcoming", accent: "var(--accent-local)" },
  { value: "CONCLUDED", label: "Concluded", accent: "var(--concluded)" },
  { value: "CANCELED", label: "Canceled", accent: "var(--canceled)" },
];

const BODY_TYPES: BodyType[] = [
  "council",
  "commission",
  "school-board",
  "county-board",
  "committee",
];

const DISTRICT_LABEL: Record<DistrictType, string> = {
  congressional: "Congressional",
  "state-senate": "State Senate",
  "state-house": "State House",
  county: "County",
  // Plain language for the Census school-district kinds.
  "school-unified": "School (unified)",
  "school-elementary": "School (elementary)",
  "school-secondary": "School (secondary)",
  municipal: "Municipal",
};

export function FiltersArea({
  showDistricts,
  districtsFailed,
  onToggleDistricts,
}: {
  /** The district overlay's master switch, owned and persisted by `use-district-layer`. */
  showDistricts: boolean;
  districtsFailed: boolean;
  onToggleDistricts: (value: boolean) => void;
}) {
  const ui = useUi();
  const dispatch = useUiDispatch();
  // "Active" means differs from the default view, so a fresh page reads zero.
  const count = activeControlCount(ui);

  // Touching a district type turns the overlay on (lib/state/district-intent.ts).
  const districtLayer = useDistrictLayer();
  const overlayOff = districtLayer.restored && !districtLayer.enabled;
  const wantOverlay = (kind: DistrictInteraction) => {
    if (overlayOff && interactionTurnsOverlayOn(kind)) {
      districtLayer.setEnabled(true);
    }
  };

  return (
    /* `data-open` lets the CSS reserve spacing only when the panel is open. */
    <div className="filters-area" data-open={ui.filtersPanelOpen || undefined}>
      <div className="filters-header">
        <button
          type="button"
          className="filters-title"
          aria-expanded={ui.filtersPanelOpen}
          onClick={() => dispatch({ type: "filter/togglePanel" })}
        >
          {/* The caret's direction is the state. */}
          <span className="filters-caret" aria-hidden="true">
            {ui.filtersPanelOpen ? "▾" : "▸"}
          </span>
          Filters
        </button>
        {/* The design states where Filters stands while it is closed. */}
        {count > 0 ? (
          <span className="filters-count">{count} active</span>
        ) : (
          <span className="mw-disclosure-meta">None active</span>
        )}

        {count > 0 && (
          <button
            type="button"
            className="clear-btn"
            onClick={() => dispatch({ type: "filter/reset" })}
          >
            Reset all
          </button>
        )}
      </div>

      {ui.filtersPanelOpen && (
        <>
          {/* Radius first: it changes what is on the map. */}
          <RadiusControl />

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
            <BoundaryLegend />
            {districtsFailed && (
              <p className="prox-note" style={{ color: "var(--danger)" }}>
                Boundary file didn&apos;t load.
              </p>
            )}
          </div>

          <Group
            label="Body type"
            collapsible
            /* Every group states where it stands on its header. */
            badge={
              ui.filters.bodyTypes.length === 0
                ? "all"
                : `${ui.filters.bodyTypes.length} of ${BODY_TYPES.length}`
            }
            openWhenNarrowed={ui.filters.bodyTypes.length > 0}
            onClear={
              ui.filters.bodyTypes.length > 0
                ? () => dispatch({ type: "filter/clear", group: "bodyTypes" })
                : undefined
            }
          >
            <div className="filter-chips filter-chips-scroll">
              {BODY_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  className="filter-chip"
                  data-active={ui.filters.bodyTypes.includes(type)}
                  aria-pressed={ui.filters.bodyTypes.includes(type)}
                  onClick={() =>
                    dispatch({ type: "filter/toggleBodyType", value: type })
                  }
                >
                  {BODY_TYPE_LABEL[type]}
                </button>
              ))}
            </div>
          </Group>

          <Group
            label="Meeting status"
            collapsible
            badge={
              ui.filters.statuses.length === 0
                ? "all"
                : `${ui.filters.statuses.length} of ${STATUSES.length}`
            }
            openWhenNarrowed={ui.filters.statuses.length > 0}
            onClear={
              ui.filters.statuses.length > 0
                ? () => dispatch({ type: "filter/clear", group: "statuses" })
                : undefined
            }
          >
            <div className="filter-chips">
              {STATUSES.map((status) => (
                <button
                  key={status.value}
                  type="button"
                  className="filter-chip"
                  data-active={ui.filters.statuses.includes(status.value)}
                  aria-pressed={ui.filters.statuses.includes(status.value)}
                  style={
                    { "--chip-accent": status.accent } as React.CSSProperties
                  }
                  onClick={() =>
                    dispatch({ type: "filter/toggleStatus", value: status.value })
                  }
                >
                  {status.label}
                </button>
              ))}
            </div>
          </Group>

          {/* The back slider counts negative days, so dragging left reaches into the past. */}
          <Group
            label="Date range"
            collapsible
            badge={`${ui.filters.daysBack}d → ${ui.filters.daysAhead}d`}
            openWhenNarrowed={
              ui.filters.daysAhead !== UPCOMING_HORIZON_DAYS ||
              ui.filters.daysBack !== CONCLUDED_LOOKBACK_DAYS
            }
            // Clear appears only once a handle moved from the served window's defaults.
            onClear={
              ui.filters.daysAhead !== UPCOMING_HORIZON_DAYS ||
              ui.filters.daysBack !== CONCLUDED_LOOKBACK_DAYS
                ? () => dispatch({ type: "filter/clear", group: "daysAhead" })
                : undefined
            }
          >
            <p className="range-display">
              {ui.filters.daysBack > 0 ? `${ui.filters.daysBack}d back` : "now"}
              {" → "}
              {ui.filters.daysAhead}d ahead
            </p>
            <div className="range-row">
              <input
                className="prox-range"
                type="range"
                min={-CONCLUDED_LOOKBACK_DAYS}
                max={0}
                value={-ui.filters.daysBack}
                aria-label="Days back"
                onChange={(e) =>
                  dispatch({
                    type: "filter/dateWindow",
                    daysBack: -Number(e.target.value),
                  })
                }
              />
              <input
                className="prox-range"
                type="range"
                min={1}
                max={UPCOMING_HORIZON_DAYS}
                value={ui.filters.daysAhead}
                aria-label="Days ahead"
                onChange={(e) =>
                  dispatch({
                    type: "filter/dateWindow",
                    daysAhead: Number(e.target.value),
                  })
                }
              />
            </div>
          </Group>

          {/* All types default on, so every body the who-governs card counts is findable. */}
          <Group
            label="District types"
            // Collapsed by default, with the count on the header.
            collapsible
            badge={`${ui.filters.districtTypes.length} of ${ALL_DISTRICT_TYPES.length}`}
            openWhenNarrowed={
              ui.filters.districtTypes.length < ALL_DISTRICT_TYPES.length
            }
            actions={[
              ...(ui.filters.districtTypes.length < ALL_DISTRICT_TYPES.length
                ? [
                    {
                      label: "select all",
                      onClick: () => {
                        wantOverlay("select-all");
                        dispatch({
                          type: "filter/districtTypesSet",
                          value: [...ALL_DISTRICT_TYPES],
                        });
                      },
                    },
                  ]
                : []),
              ...(ui.filters.districtTypes.length > 0
                ? [
                    {
                      label: "clear",
                      onClick: () =>
                        dispatch({ type: "filter/districtTypesSet", value: [] }),
                    },
                  ]
                : []),
            ]}
          >
            {ALL_DISTRICT_TYPES.map((type) => {
              const on = ui.filters.districtTypes.includes(type);
              return (
                <label key={type} className="filter-check" data-active={on}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => {
                      wantOverlay("toggle-type");
                      dispatch({ type: "filter/toggleDistrictType", value: type });
                    }}
                  />
                  {DISTRICT_LABEL[type]}
                </label>
              );
            })}
            {overlayOff && (
              <p className="mt-1 t-caption leading-relaxed text-muted">
                The overlay is off — checking a type turns it on.
              </p>
            )}
          </Group>

          {/* Default on, and visibly so: hidden jurisdictions must not read as "no government here". */}
          <Group
            label="Coverage quality"
            collapsible
            badge={ui.filters.hideUncovered ? "hiding gaps" : "showing gaps"}
            openWhenNarrowed={!ui.filters.hideUncovered}
          >
            <label className="filter-check" data-active={ui.filters.hideUncovered}>
              <input
                type="checkbox"
                checked={ui.filters.hideUncovered}
                onChange={(e) =>
                  dispatch({
                    type: "filter/hideUncovered",
                    value: e.target.checked,
                  })
                }
              />
              Hide jurisdictions with no ingestion yet
            </label>
          </Group>
        </>
      )}
    </div>
  );
}

function Group({
  label,
  onClear,
  actions,
  collapsible,
  openWhenNarrowed = false,
  badge,
  children,
}: {
  label: string;
  onClear?: () => void;
  /** Named header links, for groups with more than one action. */
  actions?: Array<{ label: string; onClick: () => void }>;
  /** Starts closed; its header opens it. */
  collapsible?: boolean;
  /** A group away from its default starts open, so a set filter never hides behind a header. */
  openWhenNarrowed?: boolean;
  /** The group's state on its collapsed header. */
  badge?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!collapsible || openWhenNarrowed);

  return (
    <div className="filter-group">
      <div className="filter-label">
        {collapsible ? (
          <button
            type="button"
            className="filter-group-toggle"
            aria-expanded={open}
            onClick={() => setOpen((was) => !was)}
          >
            <span aria-hidden="true">{open ? "▾" : "▸"}</span> {label}
            {badge && <span className="filters-count">{badge}</span>}
          </button>
        ) : (
          label
        )}
        {(!collapsible || open) &&
          actions?.map((action) => (
            <button
              key={action.label}
              type="button"
              className="clear-btn"
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        {(!collapsible || open) && onClear && (
          <button type="button" className="clear-btn" onClick={onClear}>
            clear
          </button>
        )}
      </div>
      {open && children}
    </div>
  );
}
