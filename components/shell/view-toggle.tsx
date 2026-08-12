"use client";

import { TIERS, TIER_LABEL, type Tier } from "@/lib/ocd/tiers";
import { useUi, useUiDispatch } from "@/lib/state/provider";

import { tierVars, tierSetVars } from "./tier-style";

/**
 * The primary mode switch: Local / State / National.
 *
 * Multi-select, unlike a segmented control — more than one tier can be on, and
 * when all three are the buttons take the all-tiers accent, the way Edia's
 * `active-both` does. Turning all three off is allowed and shows nothing; the
 * empty state says so rather than silently reverting to everything, because a
 * filter that undoes itself is how a reader ends up trusting a wrong answer.
 */
export function ViewToggle() {
  const { tiers } = useUi();
  const dispatch = useUiDispatch();
  const allOn = tiers.length === TIERS.length;

  return (
    <div className="view-toggle" role="group" aria-label="Government tier">
      {TIERS.map((tier: Tier) => {
        const active = tiers.includes(tier);

        return (
          <button
            key={tier}
            type="button"
            className="view-btn"
            data-active={active}
            aria-pressed={active}
            style={allOn && active ? tierSetVars(tiers) : tierVars(tier)}
            onClick={() => dispatch({ type: "tier/toggle", tier })}
          >
            {TIER_LABEL[tier]}
          </button>
        );
      })}
    </div>
  );
}
