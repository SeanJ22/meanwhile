"use client";

import type { Tier } from "@/lib/ocd/tiers";
import type { Venue } from "@/lib/meetings/venues";

/**
 * THE SELECTION PILL (approved reader design; INTERACTIONS §3).
 *
 * Centred over the unobstructed map. It says what the map is showing — a
 * whole boundary ("Viewing all of Tucson") or one room ("Focused on Tucson
 * City Hall") — and keeps the way back one tap away:
 *
 * - **Details ↗** reopens the parked card exactly as it was left;
 * - **← Whole area** leaves the room and returns to the area view;
 * - **Fit boundary / Recenter** puts the selection back in frame;
 * - **✕** clears the selection.
 *
 * Venue focus and jurisdiction are different facts and the pill never blurs
 * them: a room is "Focused on", a boundary is "Viewing all of".
 */
export function SelectionPill({
  venue,
  district,
  parked,
  onDetails,
  onBack,
  onRefit,
  onClear,
}: {
  venue: Venue | null;
  district: { ocdId: string; label: string; tier: Tier | "local" } | null;
  /** A card is set aside and can come back. */
  parked: boolean;
  onDetails: () => void;
  onBack?: () => void;
  onRefit: () => void;
  onClear: () => void;
}) {
  const label = venue ? venue.name : (district?.label ?? "");
  const tone = venue
    ? "var(--text)"
    : district
      ? `var(--accent-${district.tier === "national" ? "national" : district.tier})`
      : "transparent";

  return (
    <div className="mw-selection" role="status" aria-live="polite">
      <div className="mw-selection-pill">
        <span className="mw-selection-label">
          <span className="mw-selection-dot" style={{ background: tone }} aria-hidden="true" />
          <span>
            <span className="mw-dim">{venue ? "Focused on" : "Viewing all of"}</span>{" "}
            <strong>{label}</strong>
          </span>
        </span>
        {venue && onBack && (
          <button type="button" className="mw-pill-btn" onClick={onBack}>
            ← Whole area
          </button>
        )}
        {parked && (
          <button type="button" className="mw-pill-btn mw-pill-ring" onClick={onDetails}>
            Details ↗
          </button>
        )}
        <button type="button" className="mw-link-btn" onClick={onRefit}>
          {venue ? "Recenter" : "Fit boundary"}
        </button>
        <button
          type="button"
          className="mw-link-btn mw-dim"
          aria-label="Clear selection"
          onClick={onClear}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
