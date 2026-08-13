"use client";

import { RADIUS_LADDER_KM } from "@/lib/meetings/constants";
import { formatMiles } from "@/lib/map/format";
import { useShellData } from "@/lib/state/data";
import { useUi, useUiDispatch } from "@/lib/state/provider";

/**
 * Meeting radius.
 *
 * Ports Edia's `.prox-control`: a toggle, a paired range and number input, a
 * unit label and a live count, with the radius row hidden until the toggle is
 * on.
 *
 * The cascade in lib/meetings/query.ts works in km with rungs at 25/60/150, so
 * this is a continuous slider with those as snap points and the rung the
 * current result actually came from named underneath. That last part is the
 * point: the cascade widens on its own, and a reader who cannot see which rung
 * answered cannot tell "nothing near you" from "nothing within 95 miles".
 */

const MIN_KM = 5;
const MAX_KM = 200;
/** Snap when within this of a rung, so the rungs are easy to land on without
 *  making the slider feel notched. */
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
                ? // Start from the rung the visible results actually came
                  // from, not from the untouched default. On a zip the cascade
                  // widened for — 85641 lands on the 60 km rung — seeding 25
                  // discarded every meeting the reader was looking at the
                  // instant they touched the control, and the map went blank
                  // with no explanation.
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
            {meetings.length} within {formatMiles(km)} mi
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
