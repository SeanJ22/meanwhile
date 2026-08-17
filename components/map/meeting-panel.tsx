"use client";

import { ExternalLink, X } from "lucide-react";

import {
  formatMeetingDate,
  formatMeetingTime,
  formatRelativeDay,
  locationLine,
  meetingHeadline,
} from "@/lib/map/format";
import { relativeAge } from "@/lib/meetings/freshness";
import type { Venue } from "@/lib/meetings/venues";
import { commentAccessFor } from "@/lib/registry/comment-access";
import { venueLink } from "@/lib/registry/links";
import type { Meeting } from "@/lib/sources/types";

import { CalendarLinks } from "./popup/calendar-links";

/**
 * What sits behind a pin.
 *
 * A pin is a building, so the panel is the building's docket: every sitting
 * scheduled there, each with the four things someone needs to actually show up
 * — who is meeting, when, where exactly, and what they'll be discussing.
 */

interface MeetingPanelProps {
  venue: Venue;
  onClose: () => void;
  /** Opens the meeting popup. Omitted leaves the rows inert. */
  onOpenMeeting?: (meeting: Meeting) => void;
}

export function MeetingPanel({ venue, onClose, onOpenMeeting }: MeetingPanelProps) {
  // A venue is a group of meetings at one building, so any of them carries the
  // building's coordinates. `groupByVenue` keys on them, so they agree.
  const directions = venue.meetings[0]
    ? venueLink(venue.meetings[0].location)
    : null;

  return (
    <aside
      aria-label={`Meetings at ${venue.name}`}
      className="panel pointer-events-auto flex max-h-[60vh] w-full flex-col sm:max-h-[calc(100dvh-8rem)] sm:w-[23rem]"
    >
      <header className="flex items-start justify-between gap-3 border-b border-rule px-5 py-4">
        <div className="min-w-0">
          {/* What it is FIRST (3): a single sitting leads with who is
              meeting; the venue is where, and where comes after what. A
              multi-meeting venue leads with the count — the list below is
              the what. */}
          {/* 3a (2026-08-16): WHAT it is, big and bold, on EVERY shape of
              venue — a building hosting three sittings of one body headlines
              that body, never the building. The building and address render
              once, deduped, because some sources publish the address AS the
              venue name. */}
          <p className="notice-eyebrow">
            {venue.meetings.length === 1
              ? "Public meeting"
              : `${venue.meetings.length} public meetings`}
          </p>
          <h2 className="mt-2 font-display text-lg font-semibold leading-snug tracking-tight text-paper">
            {new Set(venue.meetings.map((m) => m.bodyName)).size === 1
              ? meetingHeadline(venue.meetings[0])
              : locationLine(venue.name, null)}
          </h2>
          <p className="mt-1 text-[0.8125rem] leading-snug text-muted">
            {new Set(venue.meetings.map((m) => m.bodyName)).size === 1
              ? locationLine(venue.name, venue.address)
              : (venue.address ?? "")}
          </p>
          {/*
            The address used to end there — correct, and inert. Somebody reading
            it is usually deciding whether they can get to the room, and the
            coordinates behind this pin already answer that. Marked "derived"
            in the popup ladder for the same reason it is unlabelled here: it is
            built from coordinates we hold rather than a page anyone opened, so
            it is offered as a convenience and never as a citation.
          */}
          {directions && (
            <a
              href={directions.url}
              target="_blank"
              rel="noreferrer"
              title={directions.hint}
              className="mt-1 inline-flex items-baseline gap-1 text-[0.75rem] text-signal hover:underline"
            >
              Directions
              <ExternalLink className="size-3 translate-y-0.5" />
            </a>
          )}
        </div>

        <button
          onClick={onClose}
          aria-label="Close"
          className="-mr-1 -mt-1 shrink-0 p-1.5 text-muted transition-colors hover:text-paper"
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="divide-y divide-rule-soft overflow-y-auto">
        {venue.meetings.map((meeting) => (
          <MeetingEntry
            key={meeting.id}
            meeting={meeting}
            onOpen={onOpenMeeting}
          />
        ))}
      </div>
    </aside>
  );
}

function MeetingEntry({
  meeting,
  onOpen,
}: {
  meeting: Meeting;
  onOpen?: (meeting: Meeting) => void;
}) {
  const concluded = meeting.status === "CONCLUDED";

  return (
    <article className="px-5 py-4">
      <div className="flex items-baseline gap-2.5">
        <span
          aria-hidden="true"
          className={`mt-1 size-1.5 shrink-0 rounded-full ${
            concluded ? "bg-concluded" : "bg-signal"
          }`}
        />
        {onOpen ? (
          // The body name is the control, because that is where a reader
          // aiming at "tell me more about this" will click.
          <h3>
            <button
              type="button"
              onClick={() => onOpen(meeting)}
              className="text-left font-display text-[0.95rem] font-semibold leading-snug tracking-tight text-paper hover:text-signal"
            >
              {meetingHeadline(meeting)}
            </button>
          </h3>
        ) : (
          <h3 className="font-display text-[0.95rem] font-semibold leading-snug tracking-tight text-paper">
            {meetingHeadline(meeting)}
          </h3>
        )}
      </div>

      {/* Some sources title a sitting with the body's own name — one line
          then, not the same words twice. */}
      {meeting.title !== meeting.bodyName && (
        <p className="mt-1 pl-[1rem] text-sm leading-snug text-paper-dim">
          {meeting.title}
        </p>
      )}

      <dl className="mt-3 pl-4 font-mono text-[0.8125rem] tabular-nums">
        <div className="flex gap-2">
          <dt className="sr-only">Date</dt>
          <dd className={concluded ? "text-concluded" : "text-signal"}>
            {formatMeetingDate(meeting)}
          </dd>
          <dt className="sr-only">Time</dt>
          <dd className="text-paper-dim">{formatMeetingTime(meeting)}</dd>
        </div>
        <div className="mt-0.5 text-muted">
          <dt className="sr-only">Relative</dt>
          <dd>
            {concluded ? "Concluded " : ""}
            {formatRelativeDay(meeting.startsAt)}
          </dd>
        </div>
      </dl>

      <div className="mt-3.5 pl-4">
        {meeting.agendaUrl ? (
          <a
            href={meeting.agendaUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 border-b border-signal-dim pb-0.5 font-mono text-[0.75rem] uppercase tracking-[0.14em] text-signal transition-colors hover:border-signal"
          >
            Read the agenda
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        ) : (
          <p className="font-mono text-[0.75rem] uppercase tracking-[0.14em] text-muted">
            No agenda posted yet
          </p>
        )}
      </div>

      {/* 3i (2026-08-19): the calendar links ride on EVERY upcoming-meeting
          surface — they shipped 08-17 on the compact card alone, and a
          reader working from this list never saw them. */}
      {meeting.status === "SCHEDULED" && (
        <div className="pl-4">
          <CalendarLinks meeting={meeting} />
        </div>
      )}

      {/* 6a: nothing left to be heard at once the meeting has concluded. */}
      {meeting.status !== "CONCLUDED" && (
        <HowToBeHeard ocdId={meeting.ocdId} bodyName={meeting.bodyName} />
      )}

      <footer className="mt-4 border-t border-rule-soft pl-4 pt-3">
        {/* No identifier here: internal keys never render to readers (4a).
            Jurisdiction and source org are the reader-facing provenance. */}
        <p className="font-mono text-[0.6875rem] leading-relaxed text-muted">
          <span className="text-paper-dim">{meeting.jurisdiction}</span>
          <br />
          {meeting.provenance.sourceOrg}
          {/*
            6f2 (2026-08-15, the author's ruling): "Not independently
            verified" is RETIRED where the source is the body's own site or
            feed — which is nearly everything here.

            The line was self-undermining noise. When Newbury's own Planning
            Board page is where a sitting came from, there is no independent
            party who could verify it and none is wanted: the body IS the
            authority on its own calendar, and the SOURCE link above is the
            verification. Telling a reader that a town's own published agenda
            is unverified teaches them to distrust the most reliable record
            this product has.

            It renders only where the data genuinely came from somewhere
            OTHER than the body's own publication — `secondHand` on the
            provenance, which no adapter sets today and which exists so the
            line is available the day one does. The provenance data
            underneath is untouched; this is about what a reader is told.
          */}
          {meeting.provenance.secondHand && !meeting.provenance.verifiedAt && (
            <>
              <br />
              <span className="text-signal-dim">Not independently verified</span>
            </>
          )}
          {/*
            hotfix-0817 (2026-08-17): this row was NOT retrieved by the run behind the
            map's "last checked" line — its calendar refused us, and it is
            here because a failed fetch may never silently empty a
            previously-full surface. It does not inherit that line's
            freshness: it states its own, on the row, where the reader
            deciding whether to trust it is actually looking.
          */}
          {meeting.carried && (
            <>
              <br />
              Last reached{" "}
              <time
                dateTime={meeting.carried.lastFreshAt}
                title={new Date(
                  Date.parse(meeting.carried.lastFreshAt),
                ).toLocaleString()}
              >
                {relativeAge(meeting.carried.lastFreshAt)}
              </time>
              {" — our latest check couldn't reach this calendar"}
            </>
          )}
        </p>
      </footer>
    </article>
  );
}

/**
 * How to actually be heard — D25.
 *
 * A meeting record that does not say how to speak is a notification without a
 * next step. Renders the body's curated standing rule with its citation; where
 * the rule is unknown it says unknown and links the body's own page, because a
 * comment period must never be inferred from the meeting being public — many
 * are public to observe and closed to speak.
 */
export function HowToBeHeard({
  ocdId,
  bodyName,
}: {
  ocdId: string | null;
  bodyName: string;
}) {
  const access = commentAccessFor(ocdId, bodyName);
  if (!access) return null;

  if (access.commentPeriod === "UNKNOWN") {
    return (
      <div className="mt-3 pl-4">
        <p className="font-mono text-[0.6875rem] leading-relaxed text-muted">
          {/* Item 4 (2026-08-14 second session): renamed to a call to
              action — the tester's words, verbatim. */}
          <span className="uppercase tracking-[0.14em] text-paper-dim">
            Make your voice heard
          </span>
          <br />
          We don&apos;t know this body&apos;s public-comment rules yet —{" "}
          <a
            href={access.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="border-b border-signal-dim text-signal hover:border-signal"
          >
            check its own page
          </a>
          .
        </p>
      </div>
    );
  }

  const lines = [
    access.commentPeriodDetail,
    access.timeLimit,
    access.signup,
    access.writtenComment,
    access.attend,
  ].filter((l): l is string => Boolean(l));

  return (
    <div className="mt-3 pl-4">
      <p className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-paper-dim">
        Make your voice heard
      </p>
      <ul className="mt-1 space-y-1 text-[0.75rem] leading-relaxed text-paper-dim">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <a
        href={access.sourceUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="mt-1 inline-block font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted underline-offset-2 hover:text-signal"
      >
        source
      </a>
    </div>
  );
}
