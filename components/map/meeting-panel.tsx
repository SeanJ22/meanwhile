"use client";

import { CheckedLink } from "@/components/ui/checked-link";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import { meetingCardSources, type CardSource } from "@/lib/officials/card-sources";
import { WorkingOnIt } from "@/components/demand/working-on-it";

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
import { carriedRowClause, relativeAge } from "@/lib/meetings/freshness";
import { groupMeetingsForReading } from "@/lib/meetings/ordering";
import { JurisdictionPill } from "@/components/address/jurisdiction-pill";
import { useMeetingBadge } from "@/hooks/use-meeting-badge";
import { useShellData } from "@/lib/state/data";
import { readerMeetingCount } from "@/lib/meetings/reader-listing-count";
import { MeetingListingNotice } from "./meeting-listing-notice";
import { tierForMeeting } from "@/lib/state/derive";
import { LevelTag } from "@/components/ui/level-tag";
import type { Venue } from "@/lib/meetings/venues";
import { projectedCommentAccessFor } from "@/lib/registry/comment-access-client";
import { venueLink } from "@/lib/registry/links";
import type { Meeting } from "@/lib/sources/types";
import {
  hasPhysicalLocation,
  isOnlineOnly,
  isPlaceUnrecorded,
  onlineAccessFor,
  statedVenueText,
  venueGapLine,
  venueGapOf,
} from "@/lib/meetings/online";

import { MeetingStatusPill } from "./meeting-status-pill";
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
  /**
   * **The same bodies' sittings that have no building** (2026-09-23) —
   * `placelessSittingsOfVenueBodies`. Online sittings and sittings whose place
   * we have not recorded. They get no pin, so without this a panel headed
   * "Tucson Unified School District" listed eight concluded sittings and none
   * of the district's three upcoming online committee meetings. Rendered in the
   * same reading groups, each marked as not held in this building.
   */
  placeless?: readonly Meeting[];
  onClose: () => void;
  /** Rendered inside the design card, which owns the frame and Close. */
  embedded?: boolean;
  /** "Show on the map": park the card and focus the map on this venue. */
  onShowOnMap?: () => void;
  /** Opens the meeting popup. Omitted leaves the rows inert. */
  onOpenMeeting?: (meeting: Meeting) => void;
}

export function MeetingPanel({
  venue,
  placeless = [],
  onClose,
  onOpenMeeting,
  embedded = false,
  onShowOnMap,
}: MeetingPanelProps) {
  // One `now` per mount, never read during render (item 11's rule): a clock
  // read in a render body would let a meeting crossing the 30-day line
  // reshuffle the list under a reader mid-scroll.
  const [now] = useState(() => Date.now());
  // Every row this panel renders: the building's sittings, then the same
  // bodies' sittings with no building. The groups below order them together,
  // so an upcoming online sitting leads a card whose room saw only past ones.
  const rows = [...venue.meetings, ...placeless];
  const onlineCount = placeless.filter(isOnlineOnly).length;
  const unrecordedCount = placeless.filter(isPlaceUnrecorded).length;
  // A named venue gap (official-page events, 2026-09-23) is a physical sitting
  // with no pin: the publisher either stated its place in words, which the row
  // shows, or stated none, which is the publisher's gap. Neither is online and
  // neither is "no place recorded". With the two counts above, the four
  // partition the building-less rows exactly.
  const statedPlaceCount = placeless.filter((meeting) => {
    const gap = venueGapOf(meeting);
    return gap !== null && statedVenueText(gap) !== null;
  }).length;
  const notStatedCount = placeless.filter((meeting) => {
    const gap = venueGapOf(meeting);
    return gap !== null && statedVenueText(gap) === null;
  }).length;
  const groups = groupMeetingsForReading(rows, now);
  // Markers follow RENDER order, so the groups are flattened in group order
  // before the notes are built — not `venue.meetings`, which is the order the
  // reader no longer sees.
  // SRC-1/2/3: one credit line at the foot, built from the SAME flattened
  // render order the rows use — a credit built from an order the reader never
  // sees would name sources in an order that matches nothing on screen.
  const credit = sourceCreditFor(
    groups.flatMap((group) => group.meetings),
  );

  // An ONLINE_ONLY venue orients the reader at the body's office. It has
  // no physical directions action; joining online is the primary action.
  const first = venue.meetings[0];
  const directions = first?.location ? venueLink(first.location) : null;
  // MTG-6/MTG-7/MTG-8: one descent, read once, and the rows below read its
  // `basis` so the card and its entries cannot disagree about whether the body
  // has already been named.
  const cardTitle = venueBodyTitle(venue.meetings, venue.name);
  const listingCount = readerMeetingCount(rows, venue.listingIdentity);
  /*
   * Stated N equals rendered rows: the eyebrow's first number is every row
   * below, and where some of them are not in this building the split is said
   * on the same line, so "8 public meetings" beside this address can never be
   * read as the count of a panel that also lists online sittings.
   */
  const elsewhere = [
    onlineCount > 0 ? `${onlineCount} online` : null,
    statedPlaceCount > 0
      ? `${statedPlaceCount} at ${statedPlaceCount === 1 ? "a place" : "places"} named below`
      : null,
    notStatedCount > 0 ? `${notStatedCount} with no place stated by the publisher` : null,
    unrecordedCount > 0 ? `${unrecordedCount} with no place recorded yet` : null,
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
          {/* **MTG-9 (2026-08-25): THE ENTITY IS THE FIRST THING ON THE CARD.**

              Spec capture `17-20-07` numbers the header outright — the
              entity, then the count, then the address — because the reader
              has to understand what they are looking at. The count led, so the first line a reader met was a number
              about a body nobody had named yet.

              MTG-6/MTG-8 unchanged in substance: the BODY is the title and the
              building is where. `venueBodyTitle` is the shared descent — see
              its note in `lib/map/format.ts` for why a distinct-`bodyName`
              count was the wrong question, and for the rung MTG-9 added when a
              shared `bodyName` turned out to name a sitting. */}
          <h2 className="font-display t-title font-semibold leading-snug tracking-tight text-paper">
            {cardTitle.title}
            {/* MTG-15 (2026-09-02): the level tag right after the body name, so
                a reader knows whether this is a local, state or federal body
                without reading the address. Tier from the meeting's OCD
                identity via `tierForMeeting`, never the body name. */}
            <LevelTag tier={first ? tierForMeeting(first) : null} />
          </h2>
          <p className="notice-eyebrow mt-1.5" data-venue-panel-count={rows.length}>
            {eyebrow}
            {split}
          </p>
          {/* MTG-6: venue name and address, in gray, beneath — the Parks and
              Recreation pattern, used as the reference. Where the
              building IS the title there is nothing left to repeat under it,
              so the address stands alone rather than printing twice. */}
          <p className="mt-1 t-body leading-snug text-muted">
            {venue.kind === "ONLINE_ONLY" && <><MeetingStatusPill status="online" /> Body’s office: </>}
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

      {/* F01 3.1 + 3.2 (2026-08-19). This list used to render `venue.meetings`
          in whatever order the venue grouper produced — which, with a serving
          window reaching ninety days back, put "Concluded 70 days ago" in the
          first row of an eight-meeting card. It now renders the three groups,
          and the whole card's provenance collapses to ONE credit line at the
          foot (SRC-1). */}
      <div className={embedded ? "" : "min-h-0 overflow-y-auto"}>
        {/* The unresolved-listing notice lives in this SCROLLING body, never the
            pinned header above. It grows one line per listing group, and in the
            header a long one outgrew the panel's height cap on a phone (Newbury
            NH, `.bottom-sheet > .panel` at 55dvh): the header cannot shrink
            below its content, so this list collapsed to zero height and every
            sitting in it was unreachable. Here it still reads first, directly
            under the count it explains, and scrolls with the sittings. */}
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
            {/* **MTG-10 (2026-08-25): the rules between sittings are gone.**

                Capture `17-20-07` boxes the empty strip each divider sits in:
                the lines looked like they served no purpose. They
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

        <MeetingSourceCredit credit={credit} sources={[...rows.flatMap(meeting => meetingCardSources(meeting, [])), ...(venue.officeAddressSource ? [{ what: "Online-only pin at the body’s published office address", provenance: venue.officeAddressSource }] : [])]} />
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
export function MeetingSourceCredit({ credit, sources = [], className = "border-t border-rule-soft px-5 py-3" }: { credit: SourceCredit; sources?: readonly CardSource[]; className?: string }) {
  if (credit.kind === "none" && sources.length === 0) return null;
  return <div className={className}><CardSourcesContribution id="meeting-calendar" sources={sources} /></div>;
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
  // The carried row's reason, decided once for both surfaces that state it.
  const carriedClause = carriedRowClause(meeting.carried);
  const { location } = useShellData();
  const { badgeOf, bodyClassOf } = useMeetingBadge();
  const nearby = useShellData().result?.readerScope?.nearbyMeetingIds.includes(meeting.id) ?? false;
  const jurisdiction = badgeOf(meeting);

  return (
    <article className="px-5 py-4" data-meeting-id={meeting.id}>
      {nearby && <span className="t-detail text-muted" data-meeting-nearby>Nearby</span>}
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
              className="text-left font-display t-heading font-semibold leading-snug tracking-tight text-paper hover:text-signal"
            >
              {meetingEntryTitle(meeting, { bodyShown })}
            </button>
          </h3>
        ) : (
          <h3 className="font-display t-heading font-semibold leading-snug tracking-tight text-paper">
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
        <p className="mt-1 pl-4 t-body leading-snug text-paper-dim">
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
          bodyClass={bodyClassOf(meeting)}
          zip={location?.zip ?? null}
          detail={false}
        />
      </p>

      {/*
        2026-09-23: a row with no building says where it is instead — this
        panel's header names a building, and a sitting listed under it without
        a word would read as held there. Online: the mark and what the body
        published. Place not recorded: our own named gap, never "online".
      */}
      {!hasPhysicalLocation(meeting) && <PlacelessWhere meeting={meeting} />}

      <dl className="mt-3 pl-4 font-mono t-body tabular-nums">
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
          <CheckedLink
            href={meeting.agendaUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="trailing-space-trimmed-14 inline-flex items-center gap-1.5 border-b border-signal-dim pb-0.5 font-mono t-detail uppercase tracking-[0.14em] text-signal transition-colors hover:border-signal"
          >
            Read the agenda
            <ExternalLink className="size-3" aria-hidden="true" />
          </CheckedLink>
        ) : (
          <p className="trailing-space-trimmed-14 font-mono t-detail uppercase tracking-[0.14em] text-muted">
            <WorkingOnIt inline state={meeting.agendaSlotObservedEmpty ? { kind: "not-published", item: "Agenda" } : undefined} />
          </p>
        )}
        {/* BX-10: a concluded sitting links the recording its publisher's own record gives; its source is the card's Sources. */}
        {concluded && meeting.videoUrl ? (
          <CheckedLink
            href={meeting.videoUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="trailing-space-trimmed-14 mt-2 flex w-fit items-center gap-1.5 border-b border-signal-dim pb-0.5 font-mono t-detail uppercase tracking-[0.14em] text-signal transition-colors hover:border-signal"
          >
            Watch the recording
            <ExternalLink className="size-3" aria-hidden="true" />
          </CheckedLink>
        ) : null}
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
        <HowToBeHeard ocdId={meeting.ocdId} bodyName={meeting.bodyName} bodyId={meeting.bodyId} />
      )}

      <footer className="mt-4 border-t border-rule-soft pl-4 pt-3">
        {/* No identifier here: internal keys never render to readers (4a).
            Jurisdiction and source org are the reader-facing provenance.

            SRC-1 (2026-08-24): those two strings live in ONE credit line at
            the foot of the card, and the footnote marker that used to point
            at them is gone from the row — it was a bare asterisk floating
            between two meetings. What stays on the row is
            the provenance that is genuinely PER ROW — second-hand sourcing and
            the carry-forward stamp — which varies from meeting to meeting and
            would be a lie if collapsed. */}
        <p className="font-mono t-caption leading-relaxed text-muted">
          {/*
            6f2 (2026-08-15): "Not independently
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
            map's "last checked" line, and it is here because a failed or thin
            fetch may never silently empty a previously-full surface. It does
            not inherit that line's freshness: it states its own, on the row,
            where the reader deciding whether to trust it is actually looking.

            2026-09-23: and it states WHY in the words its recorded reason
            earns. The clause after the date used to be one fixed sentence
            about an unreachable calendar, rendered for every carried row —
            including a calendar that answered and simply no longer held this
            listing, which on 2026-09-23 was every carried row in production.
            `carriedRowClause` (lib/meetings/freshness.ts) decides it for this
            row and the popup alike; a reasonless mark gets the date alone.
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
              {carriedClause && ` — ${carriedClause}`}
            </>
          )}
        </p>
      </footer>
    </article>
  );
}

/**
 * Where a sitting with no building is held, on a panel whose header names one.
 *
 * Every string comes from `lib/meetings/online.ts`: the online mark and the
 * body's own published label (with the join-link gap when there is no link);
 * for a named venue gap, the place the publisher stated, verbatim, or the
 * publisher's own gap when its page states none; or `PLACE_UNRECORDED_LINE`
 * when the body published neither a room nor an online access.
 */
function PlacelessWhere({ meeting }: { meeting: Meeting }) {
  const access = onlineAccessFor(meeting);
  const gap = access ? null : venueGapOf(meeting);
  const where = access
    ? "online"
    : gap
      ? statedVenueText(gap) !== null ? "stated" : "not-stated"
      : "unrecorded";
  return (
    <p
      className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 pl-4 t-detail leading-snug text-muted"
      data-meeting-where={where}
    >
      {access ? (
        <>
          <MeetingStatusPill status="online" />
          {access.joinUrl ? (
            <CheckedLink
              href={access.joinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="border-b border-signal-dim text-signal hover:border-signal"
            >
              {access.label}
            </CheckedLink>
          ) : (
            <>{access.label}{" · "}<WorkingOnIt inline subject={meeting.bodyId ? { type: "BODY", id: meeting.bodyId } : null} /></>
          )}
        </>
      ) : gap ? (
        <span>{venueGapLine(gap)}</span>
      ) : (
        <WorkingOnIt inline subject={meeting.bodyId ? { type: "BODY", id: meeting.bodyId } : null} />
      )}
    </p>
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
  if (!access) return null;

  const sources: CardSource[] = [{ what: "Public-comment rules", provenance: { sourceUrl: access.sourceUrl, sourceOrg: bodyName, collectedAt: access.collectedAt, verifiedAt: access.verifiedAt } },
    ...Object.entries(access.fieldSources ?? {}).map(([field, source]) => ({ what: `Public-comment ${field}`, provenance: { sourceUrl: source!.sourceUrl, sourceOrg: bodyName, collectedAt: source!.collectedAt, verifiedAt: source!.verifiedAt } }))];
  if (access.commentPeriod === "UNKNOWN") return <div className="mt-3 pl-4"><WorkingOnIt subject={bodyId ? { type: "BODY", id: bodyId } : null} /><CardSourcesContribution id={`comment-rules:${bodyId ?? ocdId}`} sources={sources} /></div>;

  const lines = [
    access.commentPeriodDetail,
    access.timeLimit,
    access.signup,
    access.writtenComment,
    access.attend,
  ].filter((l): l is string => Boolean(l));

  /*
   * **MTG-5 (2026-08-23, the 8/22 walkthrough) — collapsed, and the
   * content is kept word for word.**
   *
   * The Tucson Unified and Morris County captures both show this block fully
   * expanded to four and five paragraphs, so the reader scrolls past all of it
   * to reach the next meeting on the card. Tucson's runs to 180 words about
   * Requests to Address the Board.
   *
   * The prose is good and none of it is cut. What changes is that it waits to be asked for. This is not the honesty
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
      <summary className="trailing-space-trimmed-14 how-to-be-heard-summary font-mono t-caption uppercase tracking-[0.14em] text-paper-dim">
        Make your voice heard
      </summary>
      <ul className="mt-1 space-y-1 t-detail leading-relaxed text-paper-dim">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <CardSourcesContribution id={`comment-rules:${bodyId ?? ocdId}`} sources={sources} />
    </details>
  );
}
