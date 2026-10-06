"use client";

import { MeetingRow } from "@/components/ui/meeting-row";
import { CheckedLink } from "@/components/ui/checked-link";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import { meetingCardSources, type CardSource } from "@/lib/officials/card-sources";
import { WorkingOnIt } from "@/components/demand/working-on-it";

import { ExternalLink, X } from "lucide-react";
import { useState } from "react";

import { locationLine, venueBodyTitle } from "@/lib/map/format";
import {
  sourceCreditFor,
  type SourceCredit,
} from "@/lib/meetings/list-attribution";

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
import { isOnlineOnly, isPlaceUnrecorded, statedVenueText, venueGapOf } from "@/lib/meetings/online";

import { MeetingStatusPill } from "./meeting-status-pill";


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
  const { location } = useShellData();
  const { badgeOf, bodyClassOf } = useMeetingBadge();
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
                <MeetingRow
                  key={meeting.id}
                  meeting={meeting}
                  onOpen={onOpenMeeting}
                  /* MTG-7: the card above already names the body, so the row
                     carries the sitting. False everywhere the card titled
                     itself with the building instead. */
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
