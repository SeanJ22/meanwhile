"use client";

import { ExternalLink, X } from "lucide-react";

import {
  formatMeetingDate,
  formatMeetingTime,
  formatRelativeDay,
  shortOcdId,
} from "@/lib/map/format";
import type { Venue } from "@/lib/meetings/venues";
import { commentAccessFor } from "@/lib/registry/comment-access";
import { venueLink } from "@/lib/registry/links";
import type { Meeting } from "@/lib/sources/types";

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
          <p className="notice-eyebrow">
            {venue.meetings.length === 1
              ? "Public meeting"
              : `${venue.meetings.length} public meetings`}
          </p>
          <h2 className="mt-2 font-display text-lg font-semibold leading-snug tracking-tight text-paper">
            {venue.name}
          </h2>
          {venue.address && (
            <p className="mt-1 text-[0.8125rem] leading-snug text-muted">
              {venue.address}
            </p>
          )}
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
              {meeting.bodyName}
            </button>
          </h3>
        ) : (
          <h3 className="font-display text-[0.95rem] font-semibold leading-snug tracking-tight text-paper">
            {meeting.bodyName}
          </h3>
        )}
      </div>

      <p className="mt-1 pl-[1rem] text-sm leading-snug text-paper-dim">
        {meeting.title}
      </p>

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

      <HowToBeHeard ocdId={meeting.ocdId} bodyName={meeting.bodyName} />

      <footer className="mt-4 border-t border-rule-soft pl-4 pt-3">
        <p className="font-mono text-[0.6875rem] leading-relaxed text-muted">
          <span className="text-paper-dim">{meeting.jurisdiction}</span>
          <br />
          {shortOcdId(meeting.ocdId)}
          <br />
          {meeting.provenance.sourceOrg}
          {!meeting.provenance.verifiedAt && (
            <>
              <br />
              <span className="text-signal-dim">Not independently verified</span>
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
function HowToBeHeard({
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
          <span className="uppercase tracking-[0.14em] text-paper-dim">
            To be heard
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
        To be heard
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
