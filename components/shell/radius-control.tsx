"use client";

import { RADIUS_LADDER_KM } from "@/lib/meetings/constants";
import { formatMiles } from "@/lib/map/format";
import { useShellData, useMeetingListingIdentity } from "@/lib/state/data";
import { readerMeetingCount } from "@/lib/meetings/reader-listing-count";
import { useUi, useUiDispatch } from "@/lib/state/provider";

/**
 * Meeting radius: a toggle, a paired range and number input, and the rung the
 * current result came from named underneath. The cascade in
 * lib/meetings/query.ts works in km with rungs at 25/60/150, used as snap
 * points.
 */

const MIN_KM = 5;
const MAX_KM = 200;
/** Snap distance to a rung, in km. */
const SNAP_KM = 6;

function snap(km: number): number {
  for (const rung of RADIUS_LADDER_KM) {
    if (Math.abs(km - rung) <= SNAP_KM) return rung;
  }
  return km;
}

export function RadiusControl() {
  const ui = useUi();
  const dispatch = useUiDispatch();
  const { meetings, result } = useShellData();
  const listingCount = readerMeetingCount(meetings, useMeetingListingIdentity());

  const enabled = ui.radiusOverridden;
  const km = ui.radiusKm;

  const rung = result
    ? RADIUS_LADDER_KM.find((r) => r === result.radiusKm) ?? null
    : null;

  return (
    <div className="prox-control">
      <label className="prox-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) =>
            dispatch(
              e.target.checked
                ? // Seed from the rung the visible results came from, so touching the control keeps them.
                  { type: "radius/set", km: result?.radiusKm ?? km }
                : { type: "radius/clear" },
            )
          }
        />
        <span className="prox-slider" />
        <span className="prox-label">Limit radius</span>
      </label>

      {enabled && (
        <div className="prox-radius-wrap">
          <input
            className="prox-range"
            type="range"
            min={MIN_KM}
            max={MAX_KM}
            step={1}
            value={km}
            aria-label="Radius in kilometres"
            onChange={(e) =>
              dispatch({ type: "radius/set", km: snap(Number(e.target.value)) })
            }
          />
          <input
            className="prox-number"
            type="number"
            min={MIN_KM}
            max={MAX_KM}
            value={km}
            aria-label="Radius in kilometres"
            onChange={(e) => {
              const next = Number(e.target.value);
              if (Number.isFinite(next)) {
                dispatch({
                  type: "radius/set",
                  km: Math.min(MAX_KM, Math.max(MIN_KM, next)),
                });
              }
            }}
          />
          <span className="prox-unit">km</span>

          <p className="prox-count">
            {meetings.length}{listingCount.unresolved ? ` ${listingCount.unit}` : ""} within {formatMiles(km)} mi
          </p>

          {rung !== null && (
            <p className="prox-note">
              Results came from the {formatMiles(rung)} mi rung of the search.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
