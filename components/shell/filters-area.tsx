"use client";

import { useDistrictLayer } from "@/hooks/use-district-layer";
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
  school: "School",
  municipal: "Municipal",
};

export function FiltersArea() {
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
    <div className="filters-area">
      <div className="filters-header">
        <button
          type="button"
          className="filters-title"
          aria-expanded={ui.filtersPanelOpen}
          onClick={() => dispatch({ type: "filter/togglePanel" })}
        >
          Filters
          {count > 0 && <span className="filters-count">{count}</span>}
        </button>

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
          <Group
            label="Body type"
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
              students. The stops are the cascade's own horizons: 60 forward,
              90 back (3g). The back slider counts NEGATIVE days so dragging
              LEFT reaches further into the past — the intuitive direction —
              and older meetings render wherever their sources publish them. */}
          <Group
            label="Date range"
            // 6f2 (2026-08-15): the default is 90 back → 60 ahead, matching
            // the served window. The clear link appears only when the reader
            // has actually moved a handle away from it — comparing against
            // the old `daysBack === 0` would have shown a permanently active
            // "clear" on a fresh page, which is the M24 defect exactly.
            onClear={
              ui.filters.daysAhead !== 60 || ui.filters.daysBack !== 90
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
                min={-90}
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
                max={60}
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
              <p className="mt-1 text-[0.6875rem] leading-relaxed text-muted">
                The overlay is off — checking a type turns it on.
              </p>
            )}
          </Group>

          {/* Edia's focusStatesOn: default-on, and visibly so. A reader who
              cannot see that jurisdictions are being hidden reads the gaps as
              "no government here" rather than "not ingested yet". */}
          <Group label="Coverage quality">
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
  children,
}: {
  label: string;
  onClear?: () => void;
  /** Named header links in the clear-btn style, for groups with more than
   *  one affordance (district types: select all / clear — M25). */
  actions?: Array<{ label: string; onClick: () => void }>;
  children: React.ReactNode;
}) {
  return (
    <div className="filter-group">
      <div className="filter-label">
        {label}
        {actions?.map((action) => (
          <button
            key={action.label}
            type="button"
            className="clear-btn"
            onClick={action.onClick}
          >
            {action.label}
          </button>
        ))}
        {onClear && (
          <button type="button" className="clear-btn" onClick={onClear}>
            clear
          </button>
        )}
      </div>
      {children}
    </div>
  );
}
