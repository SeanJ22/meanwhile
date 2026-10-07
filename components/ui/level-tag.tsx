import { TIER_LABEL, type Tier } from "@/lib/ocd/tiers";

/**
 * The level tag (Local / State / Federal) in the Who Governs Here card's word
 * and colour. The caller derives the tier from OCD identity, never from a
 * title; a `null` tier renders nothing. It flows inline after the title's last
 * word and wraps beneath when there is no room (`.level-tag` in
 * `app/globals.css`).
 */
export function LevelTag({
  tier,
  className,
}: {
  tier: Tier | null;
  className?: string;
}) {
  if (tier === null) return null;
  return (
    <span
      data-level-tag={tier}
      className={`level-tag${className ? ` ${className}` : ""}`}
      style={{ color: `var(--accent-${tier})` }}
    >
      {TIER_LABEL[tier]}
    </span>
  );
}
