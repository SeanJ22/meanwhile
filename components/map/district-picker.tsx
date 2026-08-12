"use client";

import { useEffect } from "react";

import { TIERS, TIER_LABEL } from "@/lib/ocd/tiers";
import { useUi, useUiDispatch } from "@/lib/state/provider";

import { tierVars } from "../shell/tier-style";

/**
 * Which district did you mean?
 *
 * A point on a map is inside a *set* of districts, so this is the ordinary
 * case, not an error. Downtown Tucson is in a congressional district, a state
 * senate district, a state house district, a county, a city and a school
 * district at the same time; Rockaway NJ is in a K-8 elementary district and a
 * regional high school district simultaneously.
 *
 * Grouped by tier, and never a two-option prompt: the list is however many
 * districts actually contain the point. This is also the moment the product's
 * rule about zip becomes real — the reader's own click chooses the district,
 * rather than anything being inferred from where their zip code centroid fell.
 */
export function DistrictPicker() {
  const { districtPick } = useUi();
  const dispatch = useUiDispatch();

  useEffect(() => {
    if (!districtPick) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dispatch({ type: "district/pick", pick: null });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [districtPick, dispatch]);

  if (!districtPick) return null;

  const groups = TIERS.map((tier) => ({
    tier,
    choices: districtPick.choices.filter((c) => c.tier === tier),
  })).filter((g) => g.choices.length > 0);

  return (
    <div
      className="district-picker"
      style={{ left: districtPick.at.x, top: districtPick.at.y }}
      role="dialog"
      aria-label="Choose a district"
    >
      <div className="district-picker-head">
        <span>
          {districtPick.choices.length} districts here
        </span>
        <button
          type="button"
          className="clear-btn"
          aria-label="Dismiss"
          onClick={() => dispatch({ type: "district/pick", pick: null })}
        >
          ✕
        </button>
      </div>

      {groups.map((group) => (
        <div key={group.tier}>
          <p className="district-picker-tier" style={tierVars(group.tier)}>
            {TIER_LABEL[group.tier]}
          </p>

          {group.choices.map((choice) => (
            <button
              key={choice.ocdId}
              type="button"
              className="district-picker-row"
              style={tierVars(choice.tier)}
              onClick={() =>
                dispatch({
                  type: "select/district",
                  ocdId: choice.ocdId,
                  districtType: choice.type,
                })
              }
            >
              <span className="district-picker-label">{choice.label}</span>
              <span className="district-picker-type">{choice.typeLabel}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
