"use client";

import { TIER_LABEL } from "@/lib/ocd/tiers";
import type { SeatHolder } from "@/lib/officials/lookup";
import type { DistrictHit } from "@/lib/map/districts";
import { representationNoteFor } from "@/lib/registry/representation";

import {
  NoValue,
  PopupCard,
  PopupRow,
  PopupSectionLabel,
} from "./popup-card";

/**
 * The district behind a click.
 *
 * Unlike the meeting popup, this one has real people to show: officeholders
 * attach to *divisions*, and a congressional or legislative district is exactly
 * a division. A county or school district shows the honest absence instead,
 * because that is tier 3 and it has not been built.
 */

interface DistrictPopupProps {
  district: DistrictHit;
  /** People sourced as representing this division. Empty is a real answer. */
  representation?: SeatHolder[];
  /** Municipalities inside this division, where the registry knows them. */
  placesWithin?: string[];
  /**
   * Upcoming meetings on file for this division. Null means the fetch that
   * would answer failed — "couldn't check" and 0 are different facts (2a).
   */
  upcomingMeetings: number | null;
  /** Opens the rep popup (3c) for a clicked name. */
  onOpenOfficial?: (holder: SeatHolder) => void;
  onExpand?: () => void;
  onClose?: () => void;
}

export function DistrictPopup({
  district,
  representation = [],
  placesWithin,
  upcomingMeetings,
  onOpenOfficial,
  onExpand,
  onClose,
}: DistrictPopupProps) {
  return (
    <PopupCard
      type={district.typeLabel}
      tier={district.tier}
      title={district.label}
      onExpand={onExpand}
      expandLabel={`More about ${district.label}`}
      onClose={onClose}
    >
      {/* No OCD-ID row: internal identifiers never render to readers (4a).
          The identifier still keys everything behind this card. */}
      <PopupRow label="Type">{district.typeLabel}</PopupRow>
      <PopupRow label="Tier">{TIER_LABEL[district.tier]}</PopupRow>

      <PopupRow label="Places within" mono>
        {placesWithin === undefined ? (
          // The registry does not compute containment for every division type,
          // and an absent count is not zero.
          <NoValue>—</NoValue>
        ) : (
          placesWithin.length
        )}
      </PopupRow>

      <PopupRow label="Upcoming" mono>
        {upcomingMeetings === null ? (
          <NoValue>couldn&apos;t check</NoValue>
        ) : (
          upcomingMeetings
        )}
      </PopupRow>

      <PopupSectionLabel>Representation</PopupSectionLabel>
      {representation.length > 0 ? (
        representation.map((holder) => (
          <PopupRow key={holder.id} label={holder.officeTitle}>
            <span className="inline-flex items-baseline gap-1.5">
              {onOpenOfficial ? (
                // The name opens the rep popup — contact, photo, what the
                // office does. The official page link lives inside it.
                <button
                  type="button"
                  onClick={() => onOpenOfficial(holder)}
                  className="hover:text-signal hover:underline"
                >
                  {holder.name}
                </button>
              ) : holder.websiteUrl ? (
                <a
                  href={holder.websiteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-signal hover:underline"
                >
                  {holder.name}
                </a>
              ) : (
                holder.name
              )}
              {holder.sourceUrl && (
                <a
                  href={holder.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  title="Where this record was read from"
                  className="font-mono text-[0.5625rem] uppercase tracking-[0.1em] text-muted hover:text-signal"
                >
                  src
                </a>
              )}
            </span>
          </PopupRow>
        ))
      ) : (
        <p className="mt-1.5 text-[0.6875rem] leading-relaxed text-muted">
          {/* The same line the battlecard shows for the same division — the
              two surfaces cannot say different things about one gap. */}
          {representationNoteFor(district.tier)}
        </p>
      )}

      <PopupSectionLabel>Notes</PopupSectionLabel>
      <p className="mt-1.5 text-[0.6875rem] leading-relaxed text-muted">
        Notes arrive in Phase 7. They stay on this device — never synced, never
        shown to another reader.
      </p>
    </PopupCard>
  );
}
