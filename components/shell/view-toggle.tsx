"use client";

import { TIERS, TIER_LABEL, type Tier } from "@/lib/ocd/tiers";
import { useUi, useUiDispatch } from "@/lib/state/provider";

import { tierVars } from "./tier-style";

/**
 * Local / State / Federal, multi-select. All off is allowed and shows nothing,
 * with the empty state saying so. Each selected tier wears its own colour from
 * `TIER_ACCENT_VAR`.
 */
export function ViewToggle() {
  const { tiers } = useUi();
  const dispatch = useUiDispatch();

  return (
    <div
      className="view-toggle"
      role="group"
      aria-label="Government tier"
      // Arrow keys move between the three toggles.
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (at < 0) return;
        event.preventDefault();
        const step = event.key === "ArrowRight" ? 1 : -1;
        buttons[(at + step + buttons.length) % buttons.length]?.focus();
      }}
    >
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
