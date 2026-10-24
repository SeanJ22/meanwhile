"use client";

import { MeetingRow } from "@/components/ui/meeting-row";
import { CheckedLink } from "@/components/ui/checked-link";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import { fieldSourceLabel, meetingCardSources, type CardSource } from "@/lib/officials/card-sources";
import { CardGapContribution } from "@/components/ui/card-gap-context";

import { ExternalLink, Landmark, X } from "lucide-react";
import { useState } from "react";

import { locationLine, venueBodyTitle } from "@/lib/map/format";
import { groupMeetingsForReading } from "@/lib/meetings/ordering";
import { JurisdictionPill } from "@/components/address/jurisdiction-pill";
import { useMeetingBadge } from "@/hooks/use-meeting-badge";
import { useShellData } from "@/lib/state/data";
import { readerMeetingCount } from "@/lib/meetings/reader-listing-count";
import { MeetingListingNotice } from "./meeting-listing-notice";
import { tierForMeeting } from "@/lib/state/derive";
import { LevelTag } from "@/components/ui/level-tag";
import type { Venue } from "@/lib/meetings/venues";
import { addressKey } from "@/lib/officials/office-locations";
import type { OfficePin } from "@/lib/map/office-pins";
import { projectedCommentAccessFor } from "@/lib/registry/comment-access-client";
import { venueLink } from "@/lib/registry/links";
import type { Meeting } from "@/lib/sources/types";
import { isOnlineOnly, statedVenueText, venueGapOf } from "@/lib/meetings/online";

import { MeetingStatusPill } from "./meeting-status-pill";


/**
 * What sits behind a pin: the building's docket, every sitting scheduled
 * there with who, when, where and what.
 */

interface MeetingPanelProps {
  venue: Venue;
  /**
   * The same bodies' sittings with no building (online, or place not
   * recorded), rendered in the same groups and marked as not held here.
   */
  placeless?: readonly Meeting[];
  onClose: () => void;
  /** Rendered inside the design card, which owns the frame and Close. */
  embedded?: boolean;
  /** "Show on the map": park the card and focus the map on this venue. */
  onShowOnMap?: () => void;
  /** Opens the meeting popup. Omitted leaves the rows inert. */
  onOpenMeeting?: (meeting: Meeting) => void;
  /** The reader's representatives' offices in this building, listed here instead of as their own pins. */
  offices?: readonly OfficePin[];
  /** Opens the office owner's battlecard. */
  onOpenOffice?: (office: OfficePin) => void;
}

export function MeetingPanel({
  venue,
  placeless = [],
  onClose,
  onOpenMeeting,
  embedded = false,
  onShowOnMap,
  offices = [],
  onOpenOffice,
}: MeetingPanelProps) {
  // One `now` per mount, never read during render, so rows don't reshuffle mid-scroll.
  const [now] = useState(() => Date.now());
  const { location } = useShellData();
  const { badgeOf, bodyClassOf } = useMeetingBadge();
  // The building's sittings, then the same bodies' placeless ones, ordered together.
  const rows = [...venue.meetings, ...placeless];
  const onlineCount = placeless.filter(isOnlineOnly).length;
  // A place held in words remains visible even when it has no map coordinates.
  const statedPlaceCount = placeless.filter((meeting) => {
    const gap = venueGapOf(meeting);
    return gap !== null && statedVenueText(gap) !== null;
  }).length;
  const groups = groupMeetingsForReading(rows, now);

  // An ONLINE_ONLY venue orients the reader at the body's office. It has
  // no physical directions action; joining online is the primary action.
  const first = venue.meetings[0];
  const directions = first?.location ? venueLink(first.location) : null;
  // One descent, read once, so the card and its rows agree on whether the body is named.
  const cardTitle = venueBodyTitle(venue.meetings, venue.name);
  const listingCount = readerMeetingCount(rows, venue.listingIdentity);
  /* Stated N equals rendered rows; a split for sittings not in this building is said on the same line. */
  const elsewhere = [
    onlineCount > 0 ? `${onlineCount} online` : null,
    statedPlaceCount > 0
      ? `${statedPlaceCount} at ${statedPlaceCount === 1 ? "a place" : "places"} named below`
      : null,
  ].filter((part): part is string => part !== null);
  const eyebrow = listingCount.unresolved
    ? `${listingCount.count} ${listingCount.unit}`
    : rows.length === 1
      ? "Public meeting"
      : `${rows.length} public meetings`;
  const split =
    elsewhere.length > 0 ? ` · ${venue.meetings.length} at this building · ${elsewhere.join(" · ")}` : "";

  return (
    <aside
      aria-label={`${listingCount.heading} at ${venue.name}${elsewhere.length > 0 ? `, and ${elsewhere.join(" and ")} from the bodies that meet here` : ""}`}
      className={
        embedded
          ? "mw-embedded mw-venue flex flex-col"
          : "panel pointer-events-auto flex max-h-[60vh] w-full flex-col sm:max-h-[calc(100dvh-8rem)] sm:w-[23rem]"
      }
    >
      <header className="flex items-start justify-between gap-3 border-b border-rule px-5 py-4">
        <div className="min-w-0">
          {/* The body is the title; `venueBodyTitle` in `lib/map/format.ts` is the shared descent. */}
          <h2 className="font-display t-title font-semibold leading-snug tracking-tight text-paper">
            {cardTitle.title}
            {/* Tier from the meeting's OCD identity, never the body name. */}
            <LevelTag tier={first ? tierForMeeting(first) : null} />
          </h2>
          <p className="notice-eyebrow mt-1.5" data-venue-panel-count={rows.length}>
            {eyebrow}
            {split}
          </p>
          {/* Where the building is the title, the address stands alone. */}
          <p className="mt-1 t-body leading-snug text-muted">
            {venue.kind === "ONLINE_ONLY" && <MeetingStatusPill status="online" />}
            {venue.pinBasis === "BODY_OFFICE" ? "Board’s office: " : venue.pinBasis === "GOVERNMENT_OFFICE" ? "Government’s office: " : "Published meeting location: "}
            {cardTitle.basis === "venue"
              ? (venue.address ?? "")
              : locationLine(venue.name, venue.address)}
          </p>
          {/* Directions are built from coordinates we hold: a convenience, never a citation. */}
          {embedded ? (
            <div className="mw-action-row">
              {directions && (
                <CheckedLink
                  href={directions.url}
                  target="_blank"
                  rel="noreferrer"
                  title={directions.hint}
                  className="mw-directions"
                >
                  <span aria-hidden="true">➚</span> Directions
                </CheckedLink>
              )}
              {onShowOnMap && (
                <button type="button" className="mw-pill-btn" onClick={onShowOnMap}>
                  Show on the map
                </button>
              )}
            </div>
          ) : directions && (
            <CheckedLink
              href={directions.url}
              target="_blank"
              rel="noreferrer"
              title={directions.hint}
              className="mt-1 inline-flex items-baseline gap-1 t-detail text-signal hover:underline"
            >
              Directions
              <ExternalLink className="size-3 translate-y-0.5" />
            </CheckedLink>
          )}
        </div>

        {!embedded && (
        <button
          onClick={onClose}
          aria-label="Close"
          className="-mr-1 -mt-1 shrink-0 p-1.5 text-muted transition-colors hover:text-paper"
        >
          <X className="size-4" />
        </button>
        )}
      </header>

      {offices.length > 0 && (
        <section className="mw-venue-offices" aria-label="Representatives’ offices in this building">
          <p className="t-structure text-label">Offices in this building</p>
          <ul>
            {offices.map((office) => (
              <li key={office.id}>
                <button
                  type="button"
                  className="mw-venue-office"
                  data-tier={office.tier}
                  data-office-id={office.id}
                  disabled={!onOpenOffice}
                  onClick={() => onOpenOffice?.(office)}
                >
                  <span className="mw-venue-office__glyph" aria-hidden="true"><Landmark /></span>
                  <span className="min-w-0">
                    <span className="block font-semibold text-paper">{office.name}</span>
                    <span className="block t-detail text-muted">
                      {office.role === "State office" ? "State legislator" : office.role} district office
                      {venue.address && addressKey(office.address) === addressKey(venue.address) ? "" : ` · ${office.address}`}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Three groups, with one credit line at the foot. */}
      <div className={embedded ? "" : "min-h-0 overflow-y-auto"}>
        {/* In the scrolling body: in the pinned header a long notice collapsed the list to zero height. */}
        {listingCount.groups.length > 0 && (
          <div className="px-5 pt-2">
            <MeetingListingNotice groups={listingCount.groups} />
          </div>
        )}
        {groups.map((group) => (
          <section key={group.id}>
            <p className="t-structure sticky top-0 z-[1] bg-[var(--panel)] px-5 py-2 text-label">
              {group.label}
            </p>
            <div>
              {group.meetings.map((meeting) => (
                <MeetingRow
                  key={meeting.id}
                  meeting={meeting}
                  onOpen={onOpenMeeting}
                  /* False where the card titled itself with the building. */
                  bodyShown={cardTitle.basis !== "venue"}
                  sourcesInParent
                  jurisdiction={<JurisdictionPill badge={badgeOf(meeting)} bodyClass={bodyClassOf(meeting)} zip={location?.zip ?? null} detail={false} />}
                >
                  {meeting.status !== "CONCLUDED" && <HowToBeHeard ocdId={meeting.ocdId} bodyName={meeting.bodyName} bodyId={meeting.bodyId} />}
                </MeetingRow>
              ))}
            </div>
          </section>
        ))}

        <MeetingSourceCredit sources={[...rows.flatMap(meeting => meetingCardSources(meeting, [])),
          ...offices.map(office => ({ what: `${office.name}: district office address`, provenance: { sourceUrl: office.sourceUrl, sourceOrg: office.sourceOrg ?? "", collectedAt: office.collectedAt ?? "", verifiedAt: null } }))]} />
      </div>
    </aside>
  );
}

/** The attribution, once per distinct body, at the foot of the list. */
export function MeetingSourceCredit({ sources }: { sources: readonly CardSource[] }) {
  return <CardSourcesContribution id="meeting-calendar" sources={sources} />;
}

/**
 * The body's held participation instructions and their citations. Unknown
 * fields contribute to the card's gap line without hiding held instructions.
 */
export function HowToBeHeard({
  ocdId,
  bodyName,
  bodyId,
}: {
  ocdId: string | null;
  bodyName: string;
  bodyId?: string | null;
}) {
  const access = projectedCommentAccessFor(
    ocdId,
    bodyName,
    bodyId,
    useShellData().commentAccess ?? [],
  );
  const subject = bodyId ? { type: "BODY" as const, id: bodyId } : null;
  const gap = (!access || access.commentPeriod === "UNKNOWN")
    ? <CardGapContribution id={`comment-rules:${bodyId ?? ocdId ?? bodyName}`} label="public-comment rules" subject={subject} />
    : null;
  if (!access) return gap;

  const sources: CardSource[] = [{ what: "Public-comment rules", provenance: { sourceUrl: access.sourceUrl, sourceOrg: bodyName, collectedAt: access.collectedAt, verifiedAt: access.verifiedAt } },
    ...Object.entries(access.fieldSources ?? {}).map(([field, source]) => ({ what: fieldSourceLabel(field), provenance: { sourceUrl: source!.sourceUrl, sourceOrg: bodyName, collectedAt: source!.collectedAt, verifiedAt: source!.verifiedAt } }))];

  const lines = [
    access.commentPeriodDetail ?? (access.commentPeriod === "YES" ? "Public comment is allowed." : access.commentPeriod === "NO" ? "No public-comment period." : null),
    access.timeLimit,
    access.signup,
    access.writtenComment,
    access.attend,
  ].filter((l): l is string => Boolean(l));

  /* `<details>` so it works before hydration and is keyboard and screen-reader operable without script. */
  return (
    <>
    {gap}
    <CardSourcesContribution id={`comment-rules:${bodyId ?? ocdId}`} sources={sources} />
    {lines.length > 0 && <details className="how-to-be-heard mt-3 pl-4">
      <summary className="trailing-space-trimmed-14 how-to-be-heard-summary font-mono t-caption uppercase tracking-[0.14em] text-paper-dim">
        Make your voice heard
      </summary>
      <ul className="mt-1 space-y-1 t-detail leading-relaxed text-paper-dim">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </details>}
    </>
  );
}
