"use client";

import { ExternalLink, X } from "lucide-react";
import { useState } from "react";

import {
  formatMeetingDate,
  formatMeetingTime,
  formatRelativeDay,
  locationLine,
  meetingEntryTitle,
  meetingSubline,
  venueBodyTitle,
} from "@/lib/map/format";
import {
  sourceCreditFor,
  type SourceCredit,
} from "@/lib/meetings/list-attribution";
import { relativeAge } from "@/lib/meetings/freshness";
import { groupMeetingsForReading } from "@/lib/meetings/ordering";
import { JurisdictionPill } from "@/components/address/jurisdiction-pill";
import { badgeFor } from "@/lib/meetings/jurisdiction-badge";
import { useShellData } from "@/lib/state/data";
import { tierForMeeting } from "@/lib/state/derive";
import { LevelTag } from "@/components/ui/level-tag";
import type { Venue } from "@/lib/meetings/venues";
import { commentAccessFor } from "@/lib/registry/comment-access";
import { venueLink } from "@/lib/registry/links";
import type { Meeting } from "@/lib/sources/types";
import { agendaSentenceFor } from "@/lib/ask/agenda-sentence";

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
  // One `now` per mount, never read during render (item 11's rule): a clock
  // read in a render body would let a meeting crossing the 30-day line
  // reshuffle the list under a reader mid-scroll.
  const [now] = useState(() => Date.now());
  const groups = groupMeetingsForReading(venue.meetings, now);
  // Markers follow RENDER order, so the groups are flattened in group order
  // before the notes are built — not `venue.meetings`, which is the order the
  // reader no longer sees.
  // SRC-1/2/3: one credit line at the foot, built from the SAME flattened
  // render order the rows use — a credit built from an order the reader never
  // sees would name sources in an order that matches nothing on screen.
  const credit = sourceCreditFor(
    groups.flatMap((group) => group.meetings),
  );

  // A venue is a group of meetings at one building, so any of them carries the
  // building's coordinates. `groupByVenue` keys on them, so they agree.
  // A venue is a group of meetings at one building, so any of them carries
  // the building's coordinates — and a venue never holds an online meeting,
  // because `groupByVenue` keys on coordinates and skips the ones with none
  // (D18). The null check is the type being honest, not a case that occurs.
  const first = venue.meetings[0];
  const directions = first?.location ? venueLink(first.location) : null;
  // MTG-6/MTG-7/MTG-8: one descent, read once, and the rows below read its
  // `basis` so the card and its entries cannot disagree about whether the body
  // has already been named.
  const cardTitle = venueBodyTitle(venue.meetings, venue.name);

  return (
    <aside
      aria-label={`Meetings at ${venue.name}`}
      className="panel pointer-events-auto flex max-h-[60vh] w-full flex-col sm:max-h-[calc(100dvh-8rem)] sm:w-[23rem]"
    >
      <header className="flex items-start justify-between gap-3 border-b border-rule px-5 py-4">
        <div className="min-w-0">
          {/* **MTG-9 (2026-08-25): THE ENTITY IS THE FIRST THING ON THE CARD.**

              His spec capture `17-20-07` numbers the header outright — the
              entity, then the count, then the address — and the reason is in
              his own words: *the user has to understand what they are looking
              at.* The count led, so the first line a reader met was a number
              about a body nobody had named yet.

              MTG-6/MTG-8 unchanged in substance: the BODY is the title and the
              building is where. `venueBodyTitle` is the shared descent — see
              its note in `lib/map/format.ts` for why a distinct-`bodyName`
              count was the wrong question, and for the rung MTG-9 added when a
              shared `bodyName` turned out to name a sitting. */}
          <h2 className="font-display text-lg font-semibold leading-snug tracking-tight text-paper">
            {cardTitle.title}
            {/* MTG-15 (2026-09-02): the level tag right after the body name, so
                a reader knows whether this is a local, state or federal body
                without reading the address. Tier from the meeting's OCD
                identity via `tierForMeeting`, never the body name. */}
            <LevelTag tier={first ? tierForMeeting(first) : null} />
          </h2>
          <p className="notice-eyebrow mt-1.5">
            {venue.meetings.length === 1
              ? "Public meeting"
              : `${venue.meetings.length} public meetings`}
          </p>
          {/* MTG-6: venue name and address, in gray, beneath — the Parks and
              Recreation pattern the author named as the reference. Where the
              building IS the title there is nothing left to repeat under it,
              so the address stands alone rather than printing twice. */}
          <p className="mt-1 text-[0.8125rem] leading-snug text-muted">
            {cardTitle.basis === "venue"
              ? (venue.address ?? "")
              : locationLine(venue.name, venue.address)}
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

      {/* F01 3.1 + 3.2 (2026-08-19). This list used to render `venue.meetings`
          in whatever order the venue grouper produced — which, with a serving
          window reaching ninety days back, put "Concluded 70 days ago" in the
          first row of an eight-meeting card. It now renders the three groups,
          and the whole card's provenance collapses to ONE credit line at the
          foot (SRC-1). */}
      <div className="overflow-y-auto">
        {groups.map((group) => (
          <section key={group.id}>
            <p className="t-structure sticky top-0 z-[1] bg-[var(--panel)] px-5 py-2 text-label">
              {group.label}
            </p>
            {/* **MTG-10 (2026-08-25): the rules between sittings are gone.**

                His `17-20-07` boxes the empty strip each divider sits in and
                the note is *extra lines that serve no apparent purpose.* They
                had one — separating the entries — and the vertical rhythm
                already does it, which is the identical decision this
                stylesheet records for `.person-row`: *the rules are gone; the
                vertical rhythm does the separating.* Same reader, same
                objection, same answer. */}
            <div>
              {group.meetings.map((meeting) => (
                <MeetingEntry
                  key={meeting.id}
                  meeting={meeting}
                  onOpen={onOpenMeeting}
                  /* MTG-7: the card above already names the body, so the row
                     carries the sitting. False everywhere the card titled
                     itself with the building instead. */
                  bodyShown={cardTitle.basis !== "venue"}
                />
              ))}
            </div>
          </section>
        ))}

        <MeetingSourceCredit credit={credit} />
      </div>
    </aside>
  );
}

/**
 * F01 3.2 — the attribution, once per distinct body, at the foot of the list.
 *
 * Level register: this is a claim surface. The jurisdiction and the publishing
 * organisation render verbatim, exactly as they did on every row before; what
 * changed is how many times.
 */
export function MeetingSourceCredit({
  credit,
  className = "border-t border-rule-soft px-5 py-3",
}: {
  credit: SourceCredit;
  className?: string;
}) {
  // SRC-1: nothing to credit renders NOTHING — no heading, no placeholder.
  if (credit.kind === "none") return null;
  return (
    <div className={className}>
      <p className="text-[0.6875rem] leading-relaxed text-muted">
        {credit.lead}
      </p>
      {/* The multi-source list, still at the bottom, each source verbatim.
          Empty for the single form, which already names its source in the
          sentence above — printing it twice is the repetition SRC-1 removes. */}
      {credit.sources.length > 0 && (
        <ul className="mt-1">
          {credit.sources.map((note) => (
            <li
              key={`${note.jurisdiction} ${note.sourceOrg}`}
              className="text-[0.6875rem] leading-relaxed text-muted"
            >
              <span className="text-paper-dim">{note.jurisdiction}</span>
              {" — "}
              {note.sourceOrg}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MeetingEntry({
  meeting,
  onOpen,
  bodyShown = false,
}: {
  meeting: Meeting;
  onOpen?: (meeting: Meeting) => void;
  /**
   * **MTG-7 (2026-08-24).** The card above this row already names the body, so
   * the row names the SITTING. Default false, because a row that assumed its
   * context had introduced it would drop the body's name on every surface that
   * has no such context.
   */
  bodyShown?: boolean;
}) {
  const concluded = meeting.status === "CONCLUDED";
  /*
   * SWEEP-01 (2026-08-31). This row rendered "No agenda posted yet" whenever
   * `meeting.agendaUrl` was null — a sentence about a GOVERNMENT derived from
   * a measurement of US. `agendaSentenceFor` is the single decider, shared
   * with the popup's agenda section so the two surfaces cannot disagree about
   * what a null means, and it attributes the gap to the publisher ONLY where a
   * fresh first-party observation measured the publisher's own empty slot.
   */
  const agendaState = agendaSentenceFor(meeting);
  const { governing, zipPartial, basis, location } = useShellData();
  const jurisdiction = badgeFor(meeting, governing, basis, zipPartial);

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
              {meetingEntryTitle(meeting, { bodyShown })}
            </button>
          </h3>
        ) : (
          <h3 className="font-display text-[0.95rem] font-semibold leading-snug tracking-tight text-paper">
            {meetingEntryTitle(meeting, { bodyShown })}
          </h3>
        )}
      </div>

      {/* Some sources title a sitting with the body's own name — one line
          then, not the same words twice.

          MTG-2 (2026-08-23): the guard was `title !== bodyName`, which is
          true for "Board of County Commissioners – Work Session" and printed
          the body's name straight back under a headline that already said it.
          `meetingSubline` asks the question that matters — what does the
          headline NOT already say — and answers "Work Session". */}
      {meetingSubline(meeting) && (
        <p className="mt-1 pl-[1rem] text-sm leading-snug text-paper-dim">
          {meetingSubline(meeting)}
        </p>
      )}

      {/* M81. Every meeting card and list row says which it is — this is the
          third such surface, and all three read the SAME resolved division
          set, so they cannot disagree with each other.

          JUR-2 (2026-08-23): and all three now read the same PILL, so the
          claim and the way out of it cannot drift apart on one of them. The
          detail sentence is off here — this is a dense list of sittings, and
          the row already carries the body's name above it. */}
      <p className="mt-2 pl-4">
        <JurisdictionPill
          badge={jurisdiction}
          zip={location?.zip ?? null}
          detail={false}
        />
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
            className="trailing-space-trimmed-14 inline-flex items-center gap-1.5 border-b border-signal-dim pb-0.5 font-mono text-[0.75rem] uppercase tracking-[0.14em] text-signal transition-colors hover:border-signal"
          >
            Read the agenda
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        ) : (
          <p className="trailing-space-trimmed-14 font-mono text-[0.75rem] uppercase tracking-[0.14em] text-muted">
            {agendaState.sentence}
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
            Jurisdiction and source org are the reader-facing provenance.

            SRC-1 (2026-08-24): those two strings live in ONE credit line at
            the foot of the card, and the footnote marker that used to point
            at them is gone from the row — the author put a red arrow on a bare
            asterisk floating between two meetings. What stays on the row is
            the provenance that is genuinely PER ROW — second-hand sourcing and
            the carry-forward stamp — which varies from meeting to meeting and
            would be a lie if collapsed. */}
        <p className="font-mono text-[0.6875rem] leading-relaxed text-muted">
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
          <span className="trailing-space-trimmed-14 uppercase tracking-[0.14em] text-paper-dim">
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

  /*
   * **MTG-5 (2026-08-23, the author's 8/22 walkthrough) — collapsed, and the
   * content is kept word for word.**
   *
   * The Tucson Unified and Morris County captures both show this block fully
   * expanded to four and five paragraphs, so the reader scrolls past all of it
   * to reach the next meeting on the card. Tucson's runs to 180 words about
   * Requests to Address the Board.
   *
   * The prose is good and none of it is cut — the author said so explicitly.
   * What changes is that it waits to be asked for. This is not the honesty
   * exception the friction rule protects: those three are the disclosure at
   * reaction capture, the optionality of the narrowing prompt, and consent to
   * collection. A body's standing comment rules are a reference the reader
   * opens when they are deciding whether to go, and a reference nobody asked
   * for sitting between them and the next meeting date is friction.
   *
   * `<details>` rather than React state: it works before hydration, it is
   * keyboard-operable and screen-reader-announced without any of it being
   * written here, and the summary is the disclosure whether or not a script
   * runs. The chevron is CSS.
   *
   * Register: the summary is an EXPANDER, which the voice doctrine puts on the
   * interaction side — but every word inside it is a claim about a real
   * government's rules and stays level. That seam is the rule, not an
   * exception to it.
   */
  return (
    <details className="how-to-be-heard mt-3 pl-4">
      <summary className="trailing-space-trimmed-14 how-to-be-heard-summary font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-paper-dim">
        Make your voice heard
      </summary>
      <ul className="mt-1 space-y-1 text-[0.75rem] leading-relaxed text-paper-dim">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <a
        href={access.sourceUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="trailing-space-trimmed-14 mt-1 inline-block font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted underline-offset-2 hover:text-signal"
      >
        source
      </a>
    </details>
  );
}
