import type { CSSProperties } from "react";

import { ALL_TIERS_ACCENT_VAR, TIER_ACCENT_VAR, type Tier } from "@/lib/ocd/tiers";

/**
 * Inline custom properties that point a component at a tier's accent.
 *
 * The CSS reads `var(--tier-accent)` / `var(--tier-glow)`, so a dot, a chip and
 * a stat number all take their colour from whichever tier they are showing
 * without any of them knowing what the colours are. Values stay as `var(...)`
 * references rather than resolved hexes so they keep following the theme.
 */
export function tierVars(tier: Tier | null): CSSProperties {
  const name = tier ? TIER_ACCENT_VAR[tier] : null;
  if (!name) return {};

  return {
    "--tier-accent": `var(${name})`,
    "--tier-glow": `var(${name}-glow)`,
  } as CSSProperties;
}

/** The tier's own accent when one is active, the all-tiers accent when several are. */
export function tierSetVars(tiers: readonly Tier[]): CSSProperties {
  if (tiers.length === 1) return tierVars(tiers[0]);
  if (tiers.length === 0) return {};

  return {
    "--tier-accent": `var(${ALL_TIERS_ACCENT_VAR})`,
    "--tier-glow": `var(${ALL_TIERS_ACCENT_VAR}-glow)`,
  } as CSSProperties;
}
