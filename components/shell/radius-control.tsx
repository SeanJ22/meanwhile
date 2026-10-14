"use client";

import { formatMiles } from "@/lib/map/format";
import { useShellData, useMeetingListingIdentity } from "@/lib/state/data";
import { readerMeetingCount } from "@/lib/meetings/reader-listing-count";
import { useUi, useUiDispatch } from "@/lib/state/provider";

const MIN_KM = 5;
const MAX_KM = 200;
export function RadiusControl() {
  const ui = useUi();
  const dispatch = useUiDispatch();
  const { meetings, result } = useShellData();
  const listingCount = readerMeetingCount(meetings, useMeetingListingIdentity());

  const enabled = ui.radiusOverridden;
  const km = ui.radiusKm;

  return (
    <div className="prox-control">
      <label className="prox-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) =>
            dispatch(
              e.target.checked
                ? { type: "radius/set", km: result?.radiusKm ?? km }
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
              dispatch({ type: "radius/set", km: Number(e.target.value) })
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

        </div>
      )}
    </div>
  );
}
