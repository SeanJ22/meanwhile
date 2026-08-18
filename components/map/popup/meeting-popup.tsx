"use client";

import { ExternalLink } from "lucide-react";

import {
  formatMeetingDate,
  formatMeetingTime,
  formatRelativeDay,
  locationLine,
  meetingHeadline,
} from "@/lib/map/format";
import { tierForMeeting } from "@/lib/state/derive";
import type { SeatHolder } from "@/lib/officials/lookup";
import type { CoveredBody } from "@/lib/registry/coverage";
import { linksForMeeting, type OutboundLink } from "@/lib/registry/links";
import { relativeAge } from "@/lib/meetings/freshness";
import { minutesSummaryForMeeting } from "@/lib/meetings/minutes-summaries";
import { officePhoneForBody } from "@/lib/meetings/office-phone";
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
  // 6a (2026-08-17): a concluded meeting is a record, not an errand —
  // Directions drops (nobody drives to a meeting that already happened),
  // and the card gains what happened + the office phone instead.
  const concluded = meeting.status === "CONCLUDED";
  const links = linksForMeeting(meeting, body).filter(
    (link) => !(concluded && link.rung === "VENUE_MAP"),
  );
  const minutes = concluded ? minutesSummaryForMeeting(meeting.id) : null;
  const officePhone = concluded ? officePhoneForBody(body?.bodyId ?? null) : null;

  return (
    <PopupCard
      type={meeting.jurisdiction}
      tier={tier}
      title={meetingHeadline(meeting)}
      badges={badge ? [badge] : []}
      onExpand={onExpand}
      expandLabel={`More about ${meeting.title} — agenda and how to be heard`}
      onClose={onClose}
    >
      {/* 3a: the headline already says WHAT; the Body row repeats it only
          when the sitting title is a distinct thing worth its own line. */}
      {meeting.bodyName !== meeting.title && (
        <PopupRow label="Body">{meeting.bodyName}</PopupRow>
      )}

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
          Online only — there is no room to attend in person.
        </PopupRow>
      )}

      {meeting.online && (
        <PopupRow label="How to join">
          {meeting.online.joinUrl ? (
            <a
              href={meeting.online.joinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              {meeting.online.label}
            </a>
          ) : (
            /*
             * The render-default rule, exactly. The body published a location
             * that names no place and NO way in, and the gap gets a name that
             * says whose gap it is: theirs, not ours. Anything plausible here
             * — the body's homepage, the portal, the agenda — would look like
             * a way in and not be one.
             */
            <span className="text-muted">
              {meeting.online.label} — the body hasn&apos;t published a join link
            </span>
          )}
        </PopupRow>
      )}

      <PopupRow label="Status">{STATUS_LABEL[meeting.status]}</PopupRow>

      {/*
        hotfix-0817 (2026-08-17): a carried row does not inherit the snapshot's
        freshness. The map's "last checked" line belongs to the run that
        fetched the fresh rows; this sitting was carried forward because its
        calendar refused that run, so it states when we actually last reached
        it. No badge, no colour — the fact, in the rows the card already has.
      */}
      {meeting.carried && (
        <PopupRow label="Last reached">
          <time
            dateTime={meeting.carried.lastFreshAt}
            title={new Date(Date.parse(meeting.carried.lastFreshAt)).toLocaleString()}
          >
            {relativeAge(meeting.carried.lastFreshAt)}
          </time>
          <span className="ml-1.5 text-muted">
            our latest check couldn&apos;t reach this calendar
          </span>
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
              <summary className="cursor-pointer text-[0.6875rem] text-paper-dim underline decoration-dotted hover:text-signal">
                What happened — plain language
              </summary>
              {/* 3b: the product's voice renders BOLD. */}
              <p className="mt-1 text-[0.6875rem] font-semibold leading-relaxed text-paper-dim">
                {minutes.summary}
              </p>
              <p className="mt-0.5 text-[0.5625rem] leading-relaxed text-muted">
                Our paraphrase of{" "}
                <a
                  href={minutes.minutesUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-dotted"
                >
                  the {minutes.sourceOrg} minutes
                </a>{" "}
                — read {minutes.readAt}.
              </p>
            </details>
          ) : (
            <p className="mt-1.5 text-[0.6875rem] leading-relaxed text-muted">
              Minutes not posted yet, or not yet read by us — what happened
              here isn&apos;t summarized. The links below go to the body&apos;s
              own records.
            </p>
          )}
          {officePhone && (
            <PopupRow label="Office">
              <a
                href={`tel:${officePhone.phone.replace(/[^\d+]/g, "")}`}
                title={`Published on the ${officePhone.sourceOrg} page`}
                className="text-signal hover:underline"
              >
                {officePhone.phone}
              </a>
            </PopupRow>
          )}
        </>
      )}

      <PopupSectionLabel>{concluded ? "Records" : "Where to go"}</PopupSectionLabel>
      <LinkLadder links={links} lookedAt={body?.lookedAt ?? false} />

      <PopupSectionLabel>Representation</PopupSectionLabel>
      {representation.length > 0 ? (
        representation.map((holder) => (
          <PopupRow key={holder.id} label={holder.officeTitle}>
            {holder.name}
          </PopupRow>
        ))
      ) : (
        <p className="mt-1.5 text-[0.6875rem] leading-relaxed text-muted">
          We haven&apos;t sourced who sits on this body yet. The people we hold
          for this area represent it in Congress and the state legislature, which
          is a different thing — they are on the district card, not here.
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
 * The empty copy distinguishes the two reasons a body has nothing here, using
 * the audit's `lookedAt`. "We haven't looked yet" is a promise we can keep;
 * "we looked and there's nothing published" is a finding about the body. Saying
 * the second when the first is true would be claiming diligence we never spent.
 */
function LinkLadder({
  links,
  lookedAt,
}: {
  links: OutboundLink[];
  lookedAt: boolean;
}) {
  if (links.length === 0) {
    return (
      <p className="mt-1.5 text-[0.6875rem] leading-relaxed text-muted">
        {lookedAt
          ? "We went looking and this body publishes nothing we can link to."
          : "Nothing to link to yet — nobody has gone looking for this body's agendas."}
      </p>
    );
  }

  return (
    <ul className="mt-1.5 space-y-1">
      {links.map((link) => (
        <li key={link.rung} className="flex items-baseline justify-between gap-3">
          <a
            href={link.url}
            target="_blank"
            rel="noreferrer"
            title={link.hint}
            className="inline-flex min-w-0 items-baseline gap-1 truncate text-[0.8125rem] text-signal hover:underline"
          >
            <span className="truncate">{link.label}</span>
            <ExternalLink className="size-3 shrink-0 translate-y-0.5" />
          </a>
          {link.kind === "DERIVED" && (
            // A derived link is a convenience built from coordinates we hold,
            // not evidence about the meeting. It is marked so it can never be
            // read as a citation sitting in a list of sourced links.
            <span
              title="Built from coordinates we hold — not a source"
              className="shrink-0 font-mono text-[0.5625rem] uppercase tracking-[0.15em] text-muted"
            >
              derived
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

