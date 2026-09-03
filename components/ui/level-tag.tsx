import { TIER_LABEL, type Tier } from "@/lib/ocd/tiers";

/**
 * The level tag — Local / State / Federal (BAL-41, MTG-15, 2026-09-02).
 *
 * The owner asked every race, measure, meeting and section header to say what
 * level of government it belongs to, in the exact word and colour the Who
 * Governs Here card wears (`.popup-type`): the tier's own accent, uppercase,
 * letter-spaced. This is that word, in one place, so a ballot race and a
 * meeting card cannot drift on how they say "State".
 *
 * **The tier is derived from OCD identity, never from the title.** The caller
 * resolves it through `tierForOcdId` / `tierForMeeting` — a name string is
 * display text and would put "Superior Court of Pima County" under Local by
 * matching "county". A `null` tier renders NOTHING rather than a guessed level:
 * an unrecognised division type is a stated gap, not a coin flip between three
 * governments.
 *
 * Placement is the caller's: it renders the tag immediately after the last word
 * of a title. The deterministic fallback the owner asked for is inline flow —
 * `display: inline-block` with `white-space: nowrap` follows the last word when
 * the line has room and drops to its own line beneath the title when it does
 * not, and `.level-tag` in `app/globals.css` carries the measurements.
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
