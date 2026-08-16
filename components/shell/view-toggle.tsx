"use client";

import { TIERS, TIER_LABEL, type Tier } from "@/lib/ocd/tiers";
import { useUi, useUiDispatch } from "@/lib/state/provider";

import { tierVars } from "./tier-style";

/**
 * The primary mode switch: Local / State / Federal.
 *
 * Multi-select, unlike a segmented control — more than one tier can be on.
 * Turning all three off is allowed and shows nothing; the empty state says so
 * rather than silently reverting to everything, because a filter that undoes
 * itself is how a reader ends up trusting a wrong answer.
 *
 * **Each selected tier wears its OWN colour** (item 5, 2026-08-15 — the
 * author and the fifteen-year-old tester, independently). This used to switch
 * every active button to `--accent-all` when all three were on, ported from
 * Edia's `active-both`. The result at the default view — which IS all three —
 * was a uniform orange mass that matched nothing else on screen: not the map
 * legend, not the boundary lines, not the tier headers in the who-governs
 * card. A control that names three things has to look like the three things
 * it names, and now it does, from the same `TIER_ACCENT_VAR` family the map
 * reads. Change one, both move.
 *
 * `--accent-all` survives for genuinely mixed marks (a pin covering several
 * tiers); it is no longer allowed to stand in for "all three of these".
 */
export function ViewToggle() {
  const { tiers } = useUi();
  const dispatch = useUiDispatch();

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
            data-tier={tier}
            aria-pressed={active}
            style={tierVars(tier)}
            onClick={() => dispatch({ type: "tier/toggle", tier })}
          >
            {TIER_LABEL[tier]}
          </button>
        );
      })}
    </div>
  );
}
