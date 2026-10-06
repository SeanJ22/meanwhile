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

/**
 * The filters panel.
 *
 * Ports Edia's `.filter-group` wholesale, including the staggered fade-in and
 * the active-count badge on the header (`updateFiltersActiveCount`), plus
 * `clearFilter`, `resetFilters` and `toggleFiltersPanel`.
 */

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
  // M12 (2026-08-17): three checkboxes, three labels. Plain language — a
  // reader who has never met an "scsd" reads "School (secondary)".
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
  /**
   * The district overlay's master switch (g4 item 14).
   *
   * Owned by `use-district-layer`, which persists it, and threaded down from
   * the sidebar rather than read again here — two components each holding
   * their own copy of one switch is how a control ends up disagreeing with
   * itself. `useDistrictLayer` is still called below for the "touching a
   * type turns the overlay on" rule, which is a different question.
   */
  showDistricts: boolean;
  districtsFailed: boolean;
  onToggleDistricts: (value: boolean) => void;
}) {
  const ui = useUi();
  const dispatch = useUiDispatch();
  // Counts every registered control, not just `filters` — and "active" means
  // "differs from the default view", so a fresh page reads zero and Reset all
  // visibly returns to it (M24).
  const count = activeControlCount(ui);

  // The district-type checkboxes used to be live while "Show districts" was
  // off — every click a silent no-op, which read as "the checkboxes are
  // broken" (defect 2026-08-14). Touching the group now expresses intent to
  // see districts, so it turns the overlay on; the rule lives in
  // lib/state/district-intent.ts where a test can hold it.
  const districtLayer = useDistrictLayer();
  const overlayOff = districtLayer.restored && !districtLayer.enabled;
  const wantOverlay = (kind: DistrictInteraction) => {
    if (overlayOff && interactionTurnsOverlayOn(kind)) {
      districtLayer.setEnabled(true);
    }
  };

  return (
    /*
     * **LAY-6 (2026-08-24) — collapsed is the DEFAULT, and collapsed reserves
     * NOTHING.**
     *
     * `filtersPanelOpen` already defaulted to false, so the panel was closed
     * on arrival and capture `11-57-33` still shows a band of
     * empty space under the word FILTERS: the header carried a 12px bottom
     * margin and the area a 20px bottom padding whether or not anything
     * followed them. Closed, that is 32px of nothing — dead space is exactly
     * what the friction rule counts as a defect, and `data-open` is what lets
     * the CSS charge for the gap only when there is something in it.
     */
    <div className="filters-area" data-open={ui.filtersPanelOpen || undefined}>
      <div className="filters-header">
        <button
          type="button"
          className="filters-title"
          aria-expanded={ui.filtersPanelOpen}
          onClick={() => dispatch({ type: "filter/togglePanel" })}
        >
          {/* A right-pointing arrow: closed it points
              right, open it turns down. One control, and its direction is the
              state — a disclosure with no marker is a button a reader has to
              press to discover. */}
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
          {/* g4 item 14: the two narrowing controls that used to live loose
              in the rail. Radius first, because it is the one that changes
              what is on the map rather than what is drawn over it. */}
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
            /* LAY-2: every group states where it stands on its own header, so
               a closed one is an answer rather than a question. */
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

          {/* Edia's dual-handle enrollment slider, measuring days instead of
              students. The stops are the cascade's own shared forward and
              backward horizons. The back slider counts NEGATIVE days so dragging
              LEFT reaches further into the past — the intuitive direction —
              and older meetings render wherever their sources publish them. */}
          <Group
            label="Date range"
            collapsible
            badge={`${ui.filters.daysBack}d → ${ui.filters.daysAhead}d`}
            openWhenNarrowed={
              ui.filters.daysAhead !== UPCOMING_HORIZON_DAYS ||
              ui.filters.daysBack !== CONCLUDED_LOOKBACK_DAYS
            }
            // The defaults match the cascade's shared served window. The
            // clear link appears only when the reader
            // has actually moved a handle away from it — comparing against
            // the old `daysBack === 0` would have shown a permanently active
            // "clear" on a fresh page, which is the M24 defect exactly.
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

          {/* All types default on (session item 2, 2026-08-14 second
              session): a body the who-governs card counts must be findable
              without knowing which checkbox to tick. Reset all returns to
              all-on. Labels hold back at low zoom to keep it legible. */}
          <Group
            label="District types"
            // g4 item 14: collapsed by default, with the count on the header
            // so a reader can see how many types are on without opening it.
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

          {/* Edia's focusStatesOn: default-on, and visibly so. A reader who
              cannot see that jurisdictions are being hidden reads the gaps as
              "no government here" rather than "not ingested yet". */}
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
  /** Named header links in the clear-btn style, for groups with more than
   *  one affordance (district types: select all / clear — M25). */
  actions?: Array<{ label: string; onClick: () => void }>;
  /**
   * Starts CLOSED, and its header becomes the control that opens it (g4
   * item 14).
   *
   * **LAY-2 (2026-08-23) — this is now EVERY group.** The comment here used
   * to say collapsing everything would trade one wall of controls for a wall
   * of headers, and against a panel of six open sections that was the right
   * caution. The 8/22 pass settled it the other way: the filter panel was
   * off-center and crammed, with coverage block, body-type block, meeting
   * status, date range, district types and the coverage-quality toggle all
   * competing. Six headers each carrying its own state is not a
   * wall; six open sections of chips, sliders and checkboxes is. And
   * `openWhenNarrowed` is what keeps a set filter from hiding behind one.
   */
  collapsible?: boolean;
  /**
   * **LAY-2 (item 4, 2026-08-23) — a NARROWED group opens itself.**
   *
   * Collapsing every group is what turns the wall of controls into a list of
   * answers, and the risk the original comment named is real: a filter the
   * reader has set, hidden behind a closed header, is a hidden reason the map
   * is showing less than it holds. So a group whose value is away from its
   * default starts OPEN, and only the ones sitting at their defaults start
   * closed. The badge carries the state either way.
   */
  openWhenNarrowed?: boolean;
  /**
   * A count on the collapsed header, "where cheap" per the item.
   *
   * The whole point of collapsing a group is that a reader does not have to
   * open it to know where it stands — a closed group with no state on its
   * header is a question, not an answer.
   */
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
