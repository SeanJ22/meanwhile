"use client";

import type { Tier } from "@/lib/ocd/tiers";
import type { Venue } from "@/lib/meetings/venues";

/**
 * Centred over the unobstructed map, saying what the map shows: a whole
 * boundary ("Viewing all of …") or one room ("Focused on …"). Details ↗
 * reopens the parked card; ← Whole area leaves the room; Fit boundary /
 * Recenter reframes; ✕ clears.
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
