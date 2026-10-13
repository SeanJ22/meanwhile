"use client";

import { TIER_LABEL } from "@/lib/ocd/tiers";
import type { readerMeetingCount } from "@/lib/meetings/reader-listing-count";
import { MeetingListingNotice } from "../meeting-listing-notice";
import { useResolvedLocation } from "@/hooks/use-resolved-location";
import { browsingSubject } from "@/lib/state/resolved-location";
import { readerOfficeTitle } from "@/lib/officials/reader-office-title";
import type { SeatHolder } from "@/lib/officials/lookup";
import { TOP_OFFICES_GAP, runsSomething, topOfficesFor,
  rosterInReadingOrder,
} from "@/lib/officials/top-offices";
import { displayPersonName } from "@/lib/officials/person-name";
import type { DistrictHit } from "@/lib/map/districts";
import { representationNoteFor } from "@/lib/registry/representation";
import type { RosterReaderGap } from "@/lib/registry/body-rosters";
import { RosterCompletenessGaps } from "@/components/officials/roster-completeness-gap";
import { FederalMoneySection } from "@/components/funding/federal-money-section";

import {
  NoValue,
  PopupCard,
  PopupRow,
  PopupSectionLabel,
} from "./popup-card";

/**
 * Names the district card's subject and, where the reader's address can
 * settle it, how their home stands relative to it: `CONFIRMED` (inside),
 * `ELSEWHERE_IN_ZIP` (their address named another district at an exclusive
 * level), `OVERLAP_NOT_RULED_OUT` (another district at a level that can
 * overlap) or `UNSETTLED`. Exclusivity comes from
 * `lib/state/division-levels.ts`. Reads a `BROWSING` location, so it never
 * writes the home store.
 */
export function BrowsingSubjectLine({
  label,
  homeZip,
  ocdId,
}: {
  /** The district on screen, in the reader's words. Never an OCD-ID. */
  label: string;
  /** The zip the reader told us about, if any. */
  homeZip: string | null;
  /** The subject division, for the standing comparison. */
  ocdId: string | null;
}) {
  const home = useResolvedLocation(homeZip);
  const subject = browsingSubject(home, ocdId);

  return (
    <p
      data-browsing-standing={subject.standing}
      className="mt-1 t-caption leading-relaxed text-muted"
    >
      {subject.standing === "CONFIRMED" ? (
        <>You&apos;re looking at {label} — the one your address is in.</>
      ) : subject.standing === "ELSEWHERE_IN_ZIP" ? (
        <>
          You&apos;re looking at {label}. Your address is in a different one —
          this is here because you tapped it, not because it governs you.
        </>
      ) : subject.standing === "OVERLAP_NOT_RULED_OUT" ? (
        /*
         * Their address named a different district of this kind, and this kind
         * can overlap. Nothing tested this boundary against their point, so the
         * line claims neither "not yours" nor "also yours".
         */
        <>
          You&apos;re looking at {label}. Your address is in a different one of
          these — and areas like this can overlap, so this one may cover you as
          well.
        </>
      ) : (
        // Never "this is not your district": nothing has settled that.
        <>You&apos;re looking at {label}. This card is about that district.</>
      )}
    </p>
  );
}

interface DistrictPopupProps {
  district: DistrictHit;
  /** People sourced as representing this division. Empty is a real answer. */
  representation?: SeatHolder[];
  /** Completeness evidence projected beside the representation response. */
  rosterGaps?: RosterReaderGap[];
  /** Which empty this is: a gap, a lookup in flight, or a failed lookup; each gets its own sentence. */
  representationNoteState?: "gap" | "looking" | "unavailable";
  /** Upcoming meetings for this division. Null means the fetch failed: "couldn't check", not 0. */
  upcomingMeetings: number | null;
  listingCount?: ReturnType<typeof readerMeetingCount>;
  /** The reader's home zip, read-only; absent, the card claims nothing about the reader. */
  homeZip?: string | null;
  /** Opens the rep popup for a clicked name. */
  onOpenOfficial?: (holder: SeatHolder) => void;
  /** Minimizes this card and shows this body's upcoming meetings. Absent, the count is plain text. */
  onShowMeetings?: () => void;
  onExpand?: () => void;
  onClose?: () => void;
  onMinimize?: () => void;
}

export function DistrictPopup({
  district,
  representation = [],
  rosterGaps = [],
  representationNoteState = "gap",
  upcomingMeetings,
  listingCount,
  homeZip = null,
  onOpenOfficial,
  onShowMeetings,
  onExpand,
  onClose,
  onMinimize,
}: DistrictPopupProps) {
  // "Who runs it" only where the office holds executive authority over a governing entity.
  const showsWhoRunsIt = runsSomething(district.type);
  // The appointed executive leads, as on the large card.
  const ordered = rosterInReadingOrder(representation);
  const topOffices = showsWhoRunsIt ? topOfficesFor(ordered) : [];

  return (
    <PopupCard
      type={district.typeLabel}
      tier={district.tier}
      title={district.label}
      onExpand={onExpand}
      expandLabel={`More about ${district.label}`}
      onClose={onClose}
      onMinimize={onMinimize}
    >
      <BrowsingSubjectLine
        label={district.label}
        homeZip={homeZip}
        ocdId={district.ocdId}
      />

      {/* No OCD-ID row: internal identifiers never render to readers. */}
      <PopupRow label="Type">{district.typeLabel}</PopupRow>
      <PopupRow label="Tier">{TIER_LABEL[district.tier]}</PopupRow>
      <RosterCompletenessGaps gaps={rosterGaps} />

      {/* The count opens the upcoming list; zero and "couldn't check" are not doors. */}
      <PopupRow label={listingCount?.unresolved ? "Upcoming calendar listings" : "Upcoming"} mono>
        {upcomingMeetings === null ? (
          <NoValue>couldn&apos;t check</NoValue>
        ) : onShowMeetings && upcomingMeetings > 0 ? (
          <button
            type="button"
            onClick={onShowMeetings}
            className="cursor-pointer text-link underline decoration-dotted underline-offset-2 hover:text-paper"
            aria-label={`Show the ${upcomingMeetings} upcoming ${listingCount?.unresolved ? "calendar listings" : "meetings"} for ${district.label}`}
          >
            {upcomingMeetings}
          </button>
        ) : (
          upcomingMeetings
        )}
      </PopupRow>
      <MeetingListingNotice groups={listingCount?.groups ?? []} />

      {/*
        Top offices first, by `lib/officials/top-offices.ts` (shared with the
        large card); an unsourced top office renders a named gap, never a blank.
      */}
      {showsWhoRunsIt && <PopupSectionLabel>Who runs it</PopupSectionLabel>}
      {!showsWhoRunsIt ? null : topOffices.length > 0 ? (
        topOffices.map((office) => (
          <div key={`top:${office.holder.id}`} className="person-row">
            <span className="person-row-name">
              {onOpenOfficial ? (
                <button
                  type="button"
                  onClick={() => onOpenOfficial(office.holder)}
                  className="cursor-pointer text-left hover:text-link hover:underline"
                >
                  {displayPersonName(office.holder.name)}
                </button>
              ) : (
                displayPersonName(office.holder.name)
              )}
            </span>
            {/* Our role wording, with the body's own published title beneath; never merged. */}
            <span className="person-row-office">
              {office.role}
              {office.holder.officeTitle ? ` · ${readerOfficeTitle(office.holder.officeTitle)}` : ""}
            </span>
          </div>
        ))
      ) : (
        <p className="mt-1 t-caption leading-relaxed text-muted">
          {TOP_OFFICES_GAP}
        </p>
      )}

      <PopupSectionLabel>Representation</PopupSectionLabel>
      {representation.length > 0 ? (
        /* Stacked rows: a long office title in a two-column row starves the name. */
        ordered.map((holder) => (
          <div key={holder.id} className="person-row">
            <span className="person-row-name">
              {onOpenOfficial ? (
                // The name opens the rep popup.
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
              {readerOfficeTitle(holder.officeTitle)}
            </span>
          </div>
        ))
      ) : (
        <p className="mt-1.5 t-caption leading-relaxed text-muted">
          {/* The same line the battlecard shows for the same division. */}
          {representationNoteFor(district.tier, representationNoteState)}
        </p>
      )}

      {district.ocdId && /\/(?:county|place|school_district|cd):/.test(district.ocdId) && <>
        <PopupSectionLabel>Federal money and records</PopupSectionLabel>
        <FederalMoneySection key={district.ocdId} divisionId={district.ocdId} />
      </>}

    </PopupCard>
  );
}
