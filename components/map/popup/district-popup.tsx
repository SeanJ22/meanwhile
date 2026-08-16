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
  /**
   * Whether the empty is EARNED (M112, 2026-08-16). A division the reader is
   * not standing in has to be asked about, and until the answer arrives there
   * is no absence to report — so `true` here suppresses the gap sentence in
   * favour of the looking line. Absence and not-yet-asked are different facts.
   */
  representationPending?: boolean;
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
  representationPending = false,
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
        /*
         * Item 2 (2026-08-16) — THE VERTICAL-TEXT DEFECT, diagnosed.
         *
         * These rows were `<PopupRow label={holder.officeTitle}>`, and
         * `.pk` is `white-space: nowrap`. Inside a 300px card that leaves
         * 264px for a label and a value; "County Supervisor, District 2
         * (Vice Chair)" refuses to wrap and eats all of it, the value column
         * collapses to a few pixels, and `.pv`'s `word-break: break-word`
         * breaks the NAME one character per line. That is what the author
         * saw live — Pima's supervisors reading vertically, "Dr. Matt Heinz"
         * as a column of letters.
         *
         * It is not a style preference and it was never fixable by tuning a
         * width: a two-column row whose key can be arbitrarily long will
         * always eventually starve its value. So the row is STACKED — name
         * first at full width, office beneath it — and nothing competes.
         */
        representation.map((holder) => (
          <div key={holder.id} className="person-row">
            <span className="person-row-name">
              {onOpenOfficial ? (
                // The name opens the rep popup — contact, photo, what the
                // office does. The official page link lives inside it.
                <button
                  type="button"
                  onClick={() => onOpenOfficial(holder)}
                  className="cursor-pointer text-left hover:text-link hover:underline"
                >
                  {holder.name}
                </button>
              ) : holder.websiteUrl ? (
                <a
                  href={holder.websiteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-link hover:underline"
                >
                  {holder.name}
                </a>
              ) : (
                holder.name
              )}
            </span>
            <span className="person-row-office">
              {holder.officeTitle}
              {holder.sourceUrl && (
                <>
                  {" · "}
                  <a
                    href={holder.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="Where this record was read from"
                    className="source-tag font-mono text-[0.5625rem] uppercase tracking-[0.1em] text-muted hover:text-link"
                  >
                    src
                  </a>
                </>
              )}
            </span>
          </div>
        ))
      ) : (
        <p className="mt-1.5 text-[0.6875rem] leading-relaxed text-muted">
          {/* The same line the battlecard shows for the same division — the
              two surfaces cannot say different things about one gap, and
              neither may claim a gap before the lookup answers (M112). */}
          {representationNoteFor(district.tier, representationPending)}
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
