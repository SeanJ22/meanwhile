"use client";

import { CheckedLink } from "@/components/ui/checked-link";
import { WorkingOnIt } from "@/components/demand/working-on-it";
import type { PublicBodyAttempt } from "@/lib/registry/body-attempt-read";
import { ExternalLink } from "lucide-react";
import { readerOfficeTitle } from "@/lib/officials/reader-office-title";

import {
  formatMeetingDate,
  formatMeetingTime,
  formatRelativeDay,
  locationLine,
  meetingEntryTitle,
  meetingSubline,
} from "@/lib/map/format";
import { tierForMeeting } from "@/lib/state/derive";
import type { SeatHolder } from "@/lib/officials/lookup";
import type { CoveredBody } from "@/lib/registry/coverage";
import { linksForMeeting, type OutboundLink } from "@/lib/registry/links";
import { carriedRowClause, relativeAge } from "@/lib/meetings/freshness";
import { isPlaceUnrecorded, onlineAccessFor, placelessWhereLine } from "@/lib/meetings/online";
import { minutesSummaryForMeeting } from "@/lib/meetings/minutes-summaries";
import { JurisdictionPill } from "@/components/address/jurisdiction-pill";
import { useMeetingBadge } from "@/hooks/use-meeting-badge";
import type { JurisdictionBadge } from "@/lib/meetings/jurisdiction-badge";
import { useShellData, useMeetingListingIdentity } from "@/lib/state/data";
import { readerMeetingCount } from "@/lib/meetings/reader-listing-count";
import { MeetingListingNotice } from "../meeting-listing-notice";
import type { Meeting } from "@/lib/sources/types";

import { CalendarLinks } from "./calendar-links";

import {
  PopupCard,
  PopupRow,
  PopupSectionLabel,
  type PopupBadge,
} from "./popup-card";

/**
 * One sitting of one body.
 *
 * Times render through `lib/map/format.ts`, which formats in the **meeting's**
 * zone rather than the reader's — someone checking a Tucson agenda from
 * Philadelphia needs the time they will be expected in the room. The instant
 * itself was built by `lib/time/zoned.ts` at ingest, which is DST-tested.
 * Neither is reimplemented here.
 */

const STATUS_BADGE: Record<Meeting["status"], PopupBadge | null> = {
  SCHEDULED: null,
  CONCLUDED: { label: "Concluded", status: "CONCLUDED" },
  CANCELED: { label: "Canceled", status: "CANCELED" },
};

interface MeetingPopupProps {
  meeting: Meeting;
  /**
   * People sourced as sitting on **this body**.
   *
   * Empty today for every body: officeholders exist for legislative divisions
   * (Congress, state chambers) and a county board or school board is neither.
   * That is tier 3, the curated local seed, and it has not been built.
   *
   * **The federal and state people we do hold must not be shown here.** A US
   * Representative does not sit on the Pima County Board, and putting them
   * under this heading because they share an OCD-ID would be exactly the
   * unsourced attribution CLAUDE.md line 17 forbids.
   */
  representation?: SeatHolder[];
  /**
   * The registry body governing this meeting's division, when one is known.
   *
   * Supplies the two ladder rungs the meeting record cannot: where all of this
   * body's agendas live, and the body's own page. Optional because a meeting
   * whose division has no registry row still deserves its agenda and venue
   * rungs.
   */
  body?: CoveredBody | null;
  onExpand?: () => void;
  onClose?: () => void;
}

export function MeetingPopup({
  meeting,
  representation = [],
  body = null,
  onExpand,
  onClose,
}: MeetingPopupProps) {
  const tier = tierForMeeting(meeting) ?? "local";
  const badge = STATUS_BADGE[meeting.status];
  /*
   * MTG-14: asked once, through the one helper. It returns null both for a
   * physical sitting and for an online-only one whose `online` half is missing
   * — the pair broken — and either way the "How to join" row does not render a
   * label with nothing behind it.
   */
  const onlineAccess = onlineAccessFor(meeting);
  /*
   * M81 — does this body govern the reader, or is it just close?
   *
   * Read off the SAME division set the map's own layers resolved from, never
   * a second geometry. It rides in the card's own row rather than the eyebrow
   * badges beside "Concluded" and "Cancelled": those two are claims about what
   * happened to the sitting, and this is a claim about who the body governs.
   */
  /*
   * `JUR-2` (2026-08-23): and it says so ONLY as far as the basis allows.
   * This card read "Governs your area" with "Your address is inside the area
   * this body governs" underneath it, to a reader who had given a zip. 07866
   * holds three municipalities; the card picked one.
   */
  const { location } = useShellData();
  const { badgeOf, bodyClassOf } = useMeetingBadge();
  const listingCount = readerMeetingCount([meeting], useMeetingListingIdentity());
  const jurisdiction: JurisdictionBadge = badgeOf(meeting);
  // 6a (2026-08-17): a concluded meeting is a record, not an errand —
  // Directions drops (nobody drives to a meeting that already happened),
  // and the card gains what happened + the office phone instead.
  /* MTG-8 (2026-08-24): the body alone — this card carries a Jurisdiction
     row of its own, so the em-dash prefix was the same fact twice. */
  const cardTitle = meetingEntryTitle(meeting, { bodyShown: true });
  const concluded = meeting.status === "CONCLUDED";
  const links = linksForMeeting(meeting, body).filter(
    (link) => !(concluded && link.rung === "VENUE_MAP"),
  );
  const minutes = concluded ? minutesSummaryForMeeting(meeting.id) : null;
  const officePhone = concluded ? body?.readerRoster?.officePhone ?? null : null;
  // The carried row's reason, decided once for both surfaces that state it.
  const carriedClause = carriedRowClause(meeting.carried);

  return (
    <PopupCard
      type={meeting.jurisdiction}
      tier={tier}
      title={cardTitle}
      /* MTG-15 (2026-09-02): the level word after the title on the compact
         meeting card too, so the map-pin glance and the full panel say the same
         thing. `tier` is already resolved from the meeting's OCD identity. */
      levelTier={tier}
      badges={badge ? [badge] : []}
      onExpand={onExpand}
      expandLabel={`More about ${meeting.title} — agenda and how to be heard`}
      onClose={onClose}
    >
      {/* 3a: the headline already says WHAT; the Body row repeats it only
          when the sitting title is a distinct thing worth its own line.

          MTG-2 (2026-08-23): `bodyName !== title` was the wrong test — it is
          true for "Township Council" against "Township Council Regular
          Meeting", so the row printed "Township Council" under a headline
          reading "Rockaway Township, NJ — Township Council". The question is
          whether the HEADLINE already carries it. */}
      {!cardTitle.toLowerCase().includes(meeting.bodyName.toLowerCase()) && (
        <PopupRow label="Body">{meeting.bodyName}</PopupRow>
      )}
      {/* And the sitting's own distinct name, where it has one. */}
      {meetingSubline(meeting) && (
        <PopupRow label="Sitting">{meetingSubline(meeting)}</PopupRow>
      )}

      {/* M81. Geometry only — the badge says which area a body governs and
          nothing about whether the reader should care. A reader who wants the
          next town's select board is entitled to it; this is so they know
          which one they clicked. */}
      <PopupRow label="Jurisdiction">
        <JurisdictionPill badge={jurisdiction} bodyClass={bodyClassOf(meeting)} zip={location?.zip ?? null} />
      </PopupRow>

      <PopupRow label="Date">
        {formatMeetingDate(meeting)}
        <span className="ml-1.5 text-muted">
          {formatRelativeDay(meeting.startsAt)}
        </span>
      </PopupRow>

      <PopupRow label="Time" mono>
        {formatMeetingTime(meeting)}
      </PopupRow>

      {meeting.location ? (
        <PopupRow label="Location">
          {locationLine(meeting.location.name, meeting.location.address)}
        </PopupRow>
      ) : (
        /*
         * D18: a meeting held online. The label is the body's own published
         * string, and the row says plainly that there is no room to go to —
         * a reader who reads "Location: Virtual Meeting" and nothing else
         * may still turn up at city hall.
         */
        <PopupRow label="Where">
          {/* MTG-14: the sentence lives in lib/meetings/online.ts now. It was
              written out here and again in map-entry.tsx, which is two places
              for one claim about a government's meeting. 2026-09-23: the
              online sentence only where the body published an online access;
              otherwise our own named gap for a place we do not hold. */}
          {isPlaceUnrecorded(meeting) ? <WorkingOnIt inline subject={body ? { type: "BODY", id: body.bodyId } : null} /> : placelessWhereLine(meeting)}
        </PopupRow>
      )}

      {onlineAccess && (
        <PopupRow label="How to join">
          {onlineAccess.joinUrl ? (
            <CheckedLink
              href={onlineAccess.joinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              {onlineAccess.label}
            </CheckedLink>
          ) : (
            /*
             * The render-default rule, exactly. The body published a location
             * that names no place and NO way in, and the gap gets a name that
             * says whose gap it is: theirs, not ours. Anything plausible here
             * — the body's homepage, the portal, the agenda — would look like
             * a way in and not be one.
             */
            <WorkingOnIt inline subject={body ? { type: "BODY", id: body.bodyId } : null} />
          )}
        </PopupRow>
      )}

      <PopupRow label="Status">{STATUS_LABEL[meeting.status]}</PopupRow>
      <MeetingListingNotice groups={listingCount.groups} />

      {/*
        hotfix-0817 (2026-08-17): a carried row does not inherit the snapshot's
        freshness. The map's "last checked" line belongs to the run that
        fetched the fresh rows; this sitting was carried forward out of an
        earlier one, so it states when we actually last reached it. No badge,
        no colour — the fact, in the rows the card already has.

        2026-09-23: the clause beside the date is the one its recorded reason
        earns, from `carriedRowClause` — the same decider the venue card uses.
        It used to be one fixed sentence about an unreachable calendar for
        every carried row, which was false of every row whose calendar had
        answered without it. A reasonless mark renders the date alone.
      */}
      {meeting.carried && (
        <PopupRow label="Last reached">
          <time
            dateTime={meeting.carried.lastFreshAt}
            title={new Date(Date.parse(meeting.carried.lastFreshAt)).toLocaleString()}
          >
            {relativeAge(meeting.carried.lastFreshAt)}
          </time>
          {carriedClause && (
            <span className="ml-1.5 text-muted">{carriedClause}</span>
          )}
        </PopupRow>
      )}

      {/* 6b: the upcoming meeting goes on the reader's own calendar. */}
      {!concluded && meeting.status === "SCHEDULED" && (
        <CalendarLinks meeting={meeting} />
      )}

      {/* 6a: the past-meeting variant — what happened, in plain language,
          where the minutes have been read; the honest state otherwise. */}
      {concluded && (
        <>
          <PopupSectionLabel>What happened</PopupSectionLabel>
          {minutes ? (
            <details className="mt-1" open>
              <summary className="cursor-pointer t-caption text-paper-dim underline decoration-dotted hover:text-signal">
                What happened — plain language
              </summary>
              {/* 3b: the product's voice renders BOLD. */}
              <p className="mt-1 t-caption font-semibold leading-relaxed text-paper-dim">
                {minutes.summary}
              </p>
              <p className="mt-0.5 t-caption leading-relaxed text-muted">
                Our paraphrase of{" "}
                <CheckedLink
                  href={minutes.minutesUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-dotted"
                >
                  the {minutes.sourceOrg} minutes
                </CheckedLink>{" "}
                — read {minutes.readAt}.
              </p>
            </details>
          ) : (
            <WorkingOnIt subject={body ? { type: "BODY", id: body.bodyId } : null} />
          )}
          {officePhone && (
            <PopupRow label="Office">
              <CheckedLink
                href={`tel:${officePhone.phone.replace(/[^\d+]/g, "")}`}
                title={`Published on the ${officePhone.sourceOrg} page`}
                className="text-signal hover:underline"
              >
                {officePhone.phone}
              </CheckedLink>
            </PopupRow>
          )}
        </>
      )}

      <PopupSectionLabel>{concluded ? "Records" : "Where to go"}</PopupSectionLabel>
      <LinkLadder links={links} lookedAt={body?.lookedAt ?? false} publicationAttempt={body?.publicationAttempts?.meetings?.latest ?? null} />

      <PopupSectionLabel>Representation</PopupSectionLabel>
      {representation.length > 0 ? (
        representation.map((holder) => (
          <PopupRow key={holder.id} label={readerOfficeTitle(holder.officeTitle)}>
            {holder.name}
          </PopupRow>
        ))
      ) : (
        <p className="mt-1.5 t-caption leading-relaxed text-muted">
          We haven&apos;t sourced who sits on this body yet. The people we hold
          for this area represent it in Congress and the state legislature, which
          is a different thing — they are on the district card, not here.
        </p>
      )}

    </PopupCard>
  );
}

const STATUS_LABEL: Record<Meeting["status"], string> = {
  SCHEDULED: "Scheduled",
  CONCLUDED: "Concluded",
  CANCELED: "Canceled",
};

/**
 * Every route out of this card, best first.
 *
 * **An empty ladder renders as empty.** That is the whole discipline: there is
 * no rung that constructs a plausible destination when the real ones are
 * missing, because a link that looks right and goes nowhere is invisible until
 * somebody clicks it — the same failure that nulled 34 fixture URLs in 4.5.3.
 *
 * A historical cited audit and a recent exact-body publication attempt are
 * both narrower than an exhaustive agenda search. Neither can establish that
 * no agenda exists, and an absent receipt cannot prove nobody looked.
 */
function LinkLadder({
  links,
  lookedAt,
  publicationAttempt,
}: {
  links: OutboundLink[];
  lookedAt: boolean;
  publicationAttempt?: PublicBodyAttempt | null;
}) {
  if (links.length === 0) {
    return (
      <p className="mt-1.5 t-caption leading-relaxed text-muted">
        {publicationAttempt
          ? `A source publication attempt for this body was ${publicationAttempt.status === "HELD" ? "held" : publicationAttempt.status === "PARTIALLY_PUBLISHED" ? "partly published" : "published"} on ${publicationAttempt.at.slice(0, 10)}. No agenda link is held here; this attempt does not establish whether the body posts one.`
          : lookedAt
            ? "A dated source audit exists for this body, but no agenda link is held here."
            : "No agenda link is held here. This view cannot establish whether an agenda search was attempted."}
      </p>
    );
  }

  return (
    <ul className="mt-1.5 space-y-1">
      {links.map((link) => (
        <li key={link.rung} className="flex items-baseline justify-between gap-3">
          <CheckedLink
            href={link.url}
            target="_blank"
            rel="noreferrer"
            title={link.hint}
            className="inline-flex min-w-0 items-baseline gap-1 truncate t-body text-signal hover:underline"
          >
            <span className="truncate">{link.label}</span>
            <ExternalLink className="size-3 shrink-0 translate-y-0.5" />
          </CheckedLink>
          {link.kind === "DERIVED" && (
            // A derived link is a convenience built from coordinates we hold,
            // not evidence about the meeting. It is marked so it can never be
            // read as a citation sitting in a list of sourced links.
            <span
              title="Built from coordinates we hold — not a source"
              className="trailing-space-trimmed shrink-0 font-mono t-caption uppercase tracking-[0.15em] text-muted"
            >
              derived
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
