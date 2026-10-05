"use client";

import { CardSubjectContext } from "@/components/ui/card-subject-context";
import { CheckedLink } from "@/components/ui/checked-link";
import { CardSourceContext, useCardSourceRegistry } from "@/components/ui/card-source-context";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import { WorkingOnIt } from "@/components/demand/working-on-it";
import { blurbForTitle } from "@/lib/officials/office-blurbs";
import { readerOfficeTitle } from "@/lib/officials/reader-office-title";
import { X } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

import { useCardVisibility } from "@/hooks/use-card-visibility";

import { formatMeetingDate, formatMeetingTime } from "@/lib/map/format";
import { sourceCreditFor } from "@/lib/meetings/list-attribution";
import { readerMeetingCount } from "@/lib/meetings/reader-listing-count";
import { useMeetingListingIdentity } from "@/lib/state/data";
import { MeetingListingNotice } from "../meeting-listing-notice";
import {
  groupMeetingsForReading,
  hasConcluded,
  orderByUpcomingFirst,
} from "@/lib/meetings/ordering";
import { NO_BODY_BLURB_LINE } from "@/lib/officials/body-description";
import { TOP_OFFICES_GAP, runsSomething, topOfficesFor,
  rosterInReadingOrder,
} from "@/lib/officials/top-offices";
import { displayPersonName } from "@/lib/officials/person-name";
import { TIER_LABEL, type Tier } from "@/lib/ocd/tiers";
import type { SeatHolder } from "@/lib/officials/lookup";
import { partyColorVar } from "@/lib/officials/party-color";
import { readerPartyLabel } from "@/lib/text/reader-names";
import {
  sourceCountLabel,
  type CardSource,
  meetingCardSources,
} from "@/lib/officials/card-sources";
import type { Meeting } from "@/lib/sources/types";

import {
  CardSection,
  CardSectionGroup,
} from "@/components/officials/card-section";
import { CardSourcesList } from "@/components/officials/card-sources-list";
import { IdentityPortrait } from "@/components/officials/person-identity";
import { SpeakYourMind } from "@/components/speak/speak-your-mind";
import { DemandPill } from "@/components/demand/demand-pill";
import { RosterCompletenessGaps } from "@/components/officials/roster-completeness-gap";
import type { RosterReaderGap } from "@/lib/registry/body-rosters";

import { HowToBeHeard, MeetingSourceCredit } from "../meeting-panel";
import { venueLink } from "@/lib/registry/links";

import { BrowsingSubjectLine } from "./district-popup";
import { CalendarLinks } from "./calendar-links";
import { AgendaSection } from "./agenda-section";
import { NoValue, PopupRow, PopupSectionLabel } from "./popup-card";

/**
 * The port of EdiaStratMap's `.account-modal`.
 *
 * Opened from a popup's expand button. Escape closes it, and on a touch
 * viewport it pushes a history entry so the back button closes it rather than
 * leaving the app — the same handler Phase 8 will reuse for the bottom sheet.
 *
 * **The Sources tab is not decoration.** The product's entire claim is sourced
 * accuracy, so the surface that shows every `source_url` / `source_org` /
 * `collected_at` behind what is displayed ships in v1 rather than being a
 * later transparency gesture.
 */

export type ModalTab =
  | "overview"
  | "representation"
  | "meetings"
  | "activity"
  | "sources";



/**
 * One collapsible section of a body's battlecard (M136, 2026-08-18).
 *
 * `content` is null when the product holds nothing for this section, and the
 * section STILL RENDERS: header visible, collapsed closed, the honest absence
 * line inside — the 2026-08-17 decision on M93's empty sections.
 *
 * Hiding an empty section would make a well-covered body's card taller than a
 * thin one's, which is the same layout asymmetry the equal-effort rule catches
 * for candidates. The SET of sections is identical for every body; only what
 * is inside them differs.
 */
export interface BodyCardSection {
  id: string;
  title: string;
  /** Beside the title — a count, a date range. Never a judgement. */
  meta?: string;
  content: ReactNode | null;
  /** Renders inside when `content` is null. Describes US, never the body. */
  absence: string;
}

/**
 * The plain data a body battlecard needs beyond what every subject carries.
 *
 * Deliberately DATA, not `ReactNode`s: the caller (`bodySubject` in
 * map-entry) decides what is held and the modal decides how it looks, so a
 * section cannot end up rendered two different ways by two callers.
 */
/**
 * One sourced description with its citation underneath.
 *
 * Extracted when section 2 grew a second layer (DEF-1 to DEF-4, 2026-08-22):
 * the class definition and the form-specific definition render identically and
 * only their text and citation differ, so writing the markup twice would be two
 * places for the citation line to drift apart.
 */
function DefinitionBlock({ definition }: { definition: BodyDefinitionText }) {
  return (
    <>
      <p className="t-body leading-relaxed text-paper-dim">{definition.text}</p>
      <CardSourcesContribution id={`definition:${definition.basis}`} sources={[{ what: "What this body does", provenance: { sourceOrg: definition.basis, sourceUrl: definition.basisUrl, collectedAt: definition.readOn, verifiedAt: null } }]} />
    </>
  );
}

/** One sourced description — a class definition or a form-specific one. */
export interface BodyDefinitionText {
  text: string;
  basis: string;
  basisUrl: string | null;
  readOn: string;
}

export interface BodyCardData {
  /**
   * Section 2 — **TWO LAYERS** (DEF-1 to DEF-4, 2026-08-22, item 11).
   *
   * `classDefinition` describes what this KIND of body is and generally does,
   * and it always renders where the class is known. `formDefinition` is this
   * body's own charter or statute, and it adds specificity beneath it —
   * superseding nothing.
   *
   * The card used to carry one slot and, empty, printed *"We haven't yet read
   * the law that defines what this body can decide, so we're not going to
   * describe it."* **That copy does not ship again.** Rockaway Township,
   * Rockaway Township School District and Morris County all rendered nothing
   * useful under it, which is a card refusing to do the one thing it exists
   * for.
   */
  whatItDoes: {
    classDefinition: BodyDefinitionText | null;
    formDefinition: BodyDefinitionText | null;
    /** One short line beneath a COMPLETE class definition. Never a refusal. */
    unreadNote: string | null;
  };
  /**
   * Section 3's extra seat for a school district: the superintendent is not
   * on the board and is not elected, so a card that lists only the board
   * leaves out the person who actually runs the district.
   */
  superintendent: SeatHolder | null;
  /** Whether this body is a school district at all — decides section 3's line. */
  isSchoolDistrict: boolean;
  /** Section 5. Empty means no contact route has been sourced. */
  contact: { label: string; value: string; href: string | null }[];
  /** Section 6. Jurisdiction facts where held. */
  jurisdiction: { label: string; value: string }[];
}

/**
 * A PLACE CARD (g18, 2026-08-18, option A on M135's last row).
 *
 * M135's rule is that every row opens a card. Two rows did not, and this is
 * the one left open as a design question: a PLACE row — "Pima County, AZ" in the
 * ask panel's autocomplete — flew the camera and opened nothing, because a
 * place is not a body and this product had no card for one.
 *
 * The reason it was left rather than bodged is the useful part. A place is a
 * division that SEVERAL bodies sit in, and electing one of them to stand for
 * the place — the largest, the first, the one with the most meetings — would
 * be an invented answer about who speaks for a jurisdiction. So the card
 * elects nobody. It says what the place is and lists every body we hold in
 * it, and each of those rows opens that body's own battlecard: the reader
 * chooses, which is the only honest resolution of a one-to-many.
 *
 * Deliberately SMALL. No tab strip, no seven sections — a place has no
 * roster, no statute, no contact route and no sittings of its own, and a card
 * with five empty sections would be five gaps wearing the shape of content.
 */
export interface PlaceCardData {
  /** What kind of division this is, in reader language. Never an enum. */
  typeLabel: string;
  /**
   * The tier's label, or NULL when `tierForOcdId` did not recognise the
   * division and no body we hold in the place supplied one. Null renders as
   * the named gap — a fact about us — and never as a tier we picked.
   */
  tierLabel: string | null;
  /**
   * Every body we hold in this place. EMPTY IS A STATED ABSENCE, not an empty
   * list: the card renders the named gap below rather than nothing, because a
   * place with no visible bodies and a place we hold no bodies for are
   * different facts and may never render the same way.
   */
  bodies: { key: string; name: string; tier: Tier; meta?: string }[];
  /** Renders in place of the list when `bodies` is empty. Describes US. */
  absence: string;
}

/** Everything the modal renders, whichever entity opened it. */
export interface ModalSubject {
  title: string;
  subtitle: string;
  tier: Tier;
  /**
   * **BC-11 (2026-08-24) — WHAT THIS CARD IS ABOUT, as a public identifier.**
   *
   * Speak Your Mind stores who was spoken TO, and it stores it as an id rather
   * than as a title. A title is display text: two bodies can share one
   * ("Township Council" is nine different governments in Morris County alone),
   * it changes when copy changes, and a store keyed on it would silently merge
   * unrelated subjects. This is the ocd-id, body id or meeting id the rest of
   * the product already keys on.
   *
   * `subjectKind` says which of the three it is, so the row can be read back
   * without guessing from the id's shape.
   */
  subjectId: string;
  subjectKind: "OFFICIAL" | "BODY" | "MEETING";
  /**
   * A meeting card's body, by its registry id, so "Held by" opens the body's
   * card one level deeper (approved reader design, 2026-09-28). Absent when
   * the meeting's body is not in the coverage set.
   */
  heldByBodyId?: string | null;
  /**
   * What KIND of thing this subject is, in either the registry vocabulary
   * (place, county, school_district, cd, sldu, sldl) or the map one
   * (municipal, congressional, state-senate). LBL-1 (2026-08-22) is the only
   * reader of it so far: it decides whether the card carries a Who runs it
   * heading at all, because nobody runs a congressional district and nobody
   * runs a U.S. Senate seat.
   */
  divisionKind?: string | null;
  badges?: { label: string; status?: string }[];
  /** Overview rows. */
  facts: { label: string; value: ReactNode; mono?: boolean }[];
  /**
   * A body battlecard (M136). Present ONLY on body subjects; when present the
   * modal renders the seven sections instead of the tab strip.
   */
  bodyCard?: BodyCardData;
  /**
   * A place card (g18). Present ONLY on place subjects; when present the
   * modal renders the body list instead of the tab strip. A subject carrying
   * both this and `bodyCard` would be a contradiction — a place is not a body
   * — and the modal reads `bodyCard` first, so the two can never stack.
   */
  placeCard?: PlaceCardData;
  /**
   * When the subject is a meeting: its stored agenda content renders in the
   * overview (4c) — what the meeting is about, on the surface, not behind a
   * link.
   */
  agenda?: {
    meetingId: string;
    agendaUrl: string | null;
    /* SWEEP-01: the publisher observation travels to the surface that renders
       the sentence. Without it the section can only reason from a null link. */
    agendaSlotObservedEmpty?: boolean;
    provenance?: {
      sourceUrl: string | null;
      sourceOrg: string;
      collectedAt: string;
      secondHand?: boolean;
    };
    carried?: unknown;
  } | null;
  /** How to actually speak at it (D25), when the subject is a meeting. */
  commentAccess?: { ocdId: string | null; bodyName: string; bodyId?: string | null } | null;
  /**
   * 6f2 (2026-08-15): a district battlecard's overview rendered
   * type/tier/state and nothing else — three identifiers where a stranger
   * needs a sentence. This is the office title of whoever REPRESENTS the
   * district, so the card can render that office's shipped explainer.
   *
   * Deliberately not new prose: it reuses the per-office-type library the
   * officeholder cards already use, and it explains the OFFICE, never the
   * district's politics. "What the person who represents this district does"
   * is the honest framing — a congressional district is not a government, it
   * is a constituency, and the useful thing to know about it is what the
   * person elected from it can actually do.
   */
  representedByOfficeTitle?: string | null;
  representation: SeatHolder[];
  rosterGaps?: RosterReaderGap[];
  /** Why representation is empty, when it is. */
  representationNote: string;
  /**
   * The division this card is about, when it is about one (M112,
   * 2026-08-16). The subject is a snapshot taken at click time; this is what
   * lets the caller recognise its own division and re-derive the card when a
   * division-keyed officeholder lookup answers, so a battlecard opened while
   * the lookup was in flight fills in instead of freezing on the looking line.
   */
  divisionOcdId?: string | null;
  meetings: Meeting[];
  /**
   * Every record behind anything on screen, from the ONE assembler
   * (`lib/officials/card-sources.ts`, item 1). Never built inline by a
   * caller: two card classes building this two ways is how the district card
   * came to build it zero ways.
   */
  sources: CardSource[];
}

interface EntityModalProps {
  subject: ModalSubject;
  onClose: () => void;
  /** A representation row opens the person's full card (5a). */
  onOpenHolder?: (holder: SeatHolder) => void;
  /**
   * A place card's body row opens that body's battlecard (g18). Keyed by the
   * same `key` the caller put in `placeCard.bodies`, so the modal never has
   * to re-resolve a body it was handed — re-resolution is where the wrong
   * card comes from, and M135's other open row is that failure exactly.
   */
  onOpenPlaceBody?: (key: string) => void;
  /** Overridden in tests and screenshots so a tab can be captured directly. */
  initialTab?: ModalTab;
  /**
   * **WGH-15 (2026-08-28) — WHOSE QUESTION THIS MODAL IS ANSWERING.**
   *
   * The large card is the district popup's expansion, so it inherits the exact
   * defect the popup had: a reader who lives in House 17 opens the House 19
   * card and reads a full page of *another district's* representation with
   * nothing on it saying so.
   *
   * **The subject division is NOT a new prop.** `ModalSubject.divisionOcdId`
   * already means exactly *the division this card is about* and is already
   * null for a person's card and a meeting's card — which is precisely the
   * condition under which the line must not render, because *"you're looking at
   * a district"* would be false there. Adding a second field for the same fact
   * is how two fields come to disagree about one card.
   *
   * So this adds ONE prop, it is optional, and it is read-only: `homeZip`, the
   * zip the reader told us about, so their home standing can be computed.
   * Absent, the card names its own subject and claims nothing about the reader
   * — the right answer for someone who panned the map without naming a place.
   *
   * **It cannot change where the reader lives.** Everything downstream runs
   * through a `BROWSING` location, which settles nothing by construction.
   */
  homeZip?: string | null;
  /**
   * Rendered as the body of the reader's one large card (approved design,
   * 2026-09-28), which owns the frame, Escape, Back and Close.
   */
  embedded?: boolean;
  /** "Show the whole boundary on the map": parks the card and fits the map. */
  onShowOnMap?: () => void;
  /** A meeting's "Where": opens the venue card for this meeting's room. */
  onOpenVenue?: () => void;
}

/**
 * The body battlecard's section grammar, rendered instead of the tab strip
 * when a subject supplies it (M136).
 *
 * A body card carrying BOTH would say everything twice — the tabs and the
 * sections read the same data — and a duplicate route to the same fact is
 * reader friction with nothing earning its place. So a subject picks one, and
 * the district and meeting cards keep their tabs untouched.
 */
/**
 * The place card's body (g18). Name, type, and who sits in it.
 *
 * Every row is a button that opens that body's battlecard — the reader stays
 * in the product, which is M135's whole ruling. Nothing here links out.
 */
function PlaceSections({
  subject,
  onOpenPlaceBody,
}: {
  subject: ModalSubject;
  onOpenPlaceBody?: (key: string) => void;
}) {
  const card = subject.placeCard!;
  return (
    <div className="account-modal-body">
      <PopupRow label="Type">{card.typeLabel}</PopupRow>
      <PopupRow label="Tier">
        {card.tierLabel ?? (
          // The gap in its own register — never the tier the header painted.
          <span className="text-muted">
            We don&apos;t recognise this division type yet
          </span>
        )}
      </PopupRow>

      <PopupSectionLabel>
        Who governs here
        {card.bodies.length > 0 && (
          <span className="account-modal-tab-count">{card.bodies.length}</span>
        )}
      </PopupSectionLabel>

      {card.bodies.length === 0 ? (
        <WorkingOnIt />
      ) : (
        <ul className="mt-1.5 flex flex-col gap-1">
          {card.bodies.map((body) => (
            <li key={body.key}>
              <button
                type="button"
                onClick={() => onOpenPlaceBody?.(body.key)}
                className="flex w-full items-baseline justify-between gap-2 rounded border border-[var(--panel-border)] px-2.5 py-1.5 text-left hover:border-[var(--accent-local)]"
              >
                <span className="min-w-0 truncate t-body text-paper">
                  {body.name}
                </span>
                <span
                  className="trailing-space-trimmed shrink-0 font-mono t-caption uppercase tracking-[0.15em]"
                  style={{ color: `var(--accent-${body.tier})` }}
                >
                  {TIER_LABEL[body.tier]}
                  {body.meta ? ` · ${body.meta}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BodySections({
  subject,
  onOpenHolder,
}: {
  subject: ModalSubject;
  onOpenHolder?: (holder: SeatHolder) => void;
}) {
  const card = subject.bodyCard!;
  const listingCount = readerMeetingCount(subject.meetings, useMeetingListingIdentity());
  /*
   * One `now` for the whole card (item 11's rule): the ordering and the
   * "upcoming" count below are computed from the same instant, so the number
   * in the header can never disagree with the block it is counting.
   *
   * Pinned at mount rather than read during render — reading the clock in a
   * render body is impure, and it would also let a re-render reshuffle the
   * list under a reader mid-scroll if a meeting's start time passed between
   * two renders.
   */
  const [now] = useState(() => Date.now());
  // The body card states "N upcoming" beside the section title, so it keeps
  // the flat ordering for the COUNT and hands the raw list to <Meetings>,
  // which groups it. One list, one order, computed once.
  const meetings = orderByUpcomingFirst(subject.meetings, now);
  const upcoming = meetings.filter((m) => !hasConcluded(m, now)).length;

  const sections: BodyCardSection[] = [
    {
      id: "what",
      title: "What this body does",
      /*
       * TWO LAYERS, in order (DEF-1 to DEF-4, 2026-08-22).
       *
       * The class definition first, because it is what the reader needs before
       * anything else: what KIND of thing is this. The form-specific one below
       * it, adding what this body's own charter says where we have read it.
       *
       * Each carries its own citation. That is what keeps a class definition
       * clear of the never-generate rule: it is a sourced statement about a
       * class of government, not an unsourced statement about this one.
       */
      content:
        card.whatItDoes.classDefinition || card.whatItDoes.formDefinition ? (
          <>
            {card.whatItDoes.classDefinition && (
              <DefinitionBlock definition={card.whatItDoes.classDefinition} />
            )}
            {card.whatItDoes.formDefinition && (
              <div className={card.whatItDoes.classDefinition ? "mt-3" : undefined}>
                <DefinitionBlock definition={card.whatItDoes.formDefinition} />
              </div>
            )}
            {/*
              What replaces the refusal. The old line said we were not going to
              describe the body; this says what we have not read, underneath a
              description that has already been given.
            */}
            {card.whatItDoes.unreadNote && (
              <p className="mt-2 t-caption leading-relaxed text-muted">
                {card.whatItDoes.unreadNote}
              </p>
            )}
          </>
        ) : null,
      absence: NO_BODY_BLURB_LINE,
    },
    {
      id: "representation",
      title: "Who sits on it",
      meta:
        subject.representation.length > 0
          ? `${subject.representation.length}`
          : undefined,
      content:
        subject.representation.length > 0 || card.superintendent ? (
          <>
            <Representation
              holders={subject.representation}
              gaps={subject.rosterGaps}
              note={subject.representationNote}
              onOpenHolder={onOpenHolder}
              /* LBL-1: removed, not renamed, where nothing is run. */
              showTopOffices={runsSomething(subject.divisionKind)}
            />
            {/* The school district's non-elected seat, labelled as what it
                is. Absent for every other body kind rather than rendered
                empty, because a county has no superintendent to be missing. */}
            {card.isSchoolDistrict && (
              <div className="mt-2 border-t border-[var(--panel-border)] pt-2">
                <PopupSectionLabel>Runs the district day to day</PopupSectionLabel>
                {card.superintendent ? (
                  // F01 2.2: this block IS the top office, so it must not print
                  // a “Who runs it” heading over a duplicate of its one row.
                  <Representation
                    holders={[card.superintendent]}
                    note=""
                    showTopOffices={false}
                    onOpenHolder={onOpenHolder}
                  />
                ) : (
                  <Empty>
                    We haven&rsquo;t sourced who the superintendent is. They are
                    hired by this board, not elected.
                  </Empty>
                )}
              </div>
            )}
          </>
        ) : null,
      absence: subject.representationNote,
    },
    {
      id: "meetings",
      title: listingCount.heading,
      meta: meetings.length > 0 ? `${upcoming} upcoming${listingCount.unresolved ? " listings" : ""}` : undefined,
      content: meetings.length > 0 ? <Meetings meetings={meetings} /> : null,
      absence: "",
    },
    {
      id: "contact",
      title: "Contact",
      content:
        card.contact.length > 0 ? (
          <>
            {card.contact.map((row) => (
              <PopupRow key={row.label} label={row.label}>
                {row.href ? (
                  <CheckedLink
                    href={row.href}
                    target="_blank"
                    rel="noreferrer"
                    className="text-link underline decoration-dotted underline-offset-2 hover:decoration-solid"
                  >
                    {row.value}
                  </CheckedLink>
                ) : (
                  row.value
                )}
              </PopupRow>
            ))}
          </>
        ) : null,
      absence: "",
    },
    {
      id: "jurisdiction",
      title: "Where it governs",
      content:
        card.jurisdiction.length > 0 ? (
          <>
            {card.jurisdiction.map((row) => (
              <PopupRow key={row.label} label={row.label}>
                {row.value}
              </PopupRow>
            ))}
          </>
        ) : null,
      absence: "",
    },
    {
      id: "sources",
      title: "Sources",
      meta: sourceCountLabel(subject.sources) ?? undefined,
      content:
        subject.sources.length > 0 ? <Sources sources={subject.sources} /> : null,
      absence: "",
    },
  ];

  return (
    <div className="account-modal-body">
      {/* Section 1, IDENTITY — never collapsed. The card's own header already
          carries the name, tier and jurisdiction; these are the rows that
          qualify it. */}
      {subject.facts.map((fact) => (
        <PopupRow key={fact.label} label={fact.label} mono={fact.mono}>
          {fact.value}
        </PopupRow>
      ))}

      {/* F01 4.1 (2026-08-19), applied as a CLASS: the item named the person
          card, and a body battlecard is the same stack of pills with the same
          failure available to it. One group, one open pill. */}
      <CardSectionGroup>
        {sections.map((section) => (
          <Fragment key={section.id}>
            {/*
              **BC-11 (2026-08-24) — ABOVE SOURCES, which on THIS card shape is
              a position rather than a neighbour.**

              The placement is "above Sources, below Voting record".
              The tabbed card has no Sources SECTION — it has a Sources tab — so
              the pill sits below the whole panel there. This card does have
              one, and it is the last section, so "below the card" and "above
              Sources" are different places. The capture is what showed the
              difference: the pill rendered underneath the citations.

              Keyed off the section id rather than an index, so inserting or
              reordering a section cannot silently move the pill somewhere it
              was not placed.
            */}
            {/*
              **BC-29 (2026-08-25): the body card's in-section pill is GONE**,
              and it moved rather than being deleted — it renders at the pinned
              foot below, with every other card shape. Two placements for one
              control was the thing that let the tabbed card ship a clipped one
              while the body card's was fine.
            */}
            <CardSection title={section.title} meta={section.meta}>
              {section.content ?? <WorkingOnIt subject={subject.subjectKind === "BODY" ? { type: "BODY", id: subject.subjectId } : null} />}
            </CardSection>
          </Fragment>
        ))}
      </CardSectionGroup>
    </div>
  );
}

export function EntityModal({
  subject,
  onClose,
  onOpenHolder,
  onOpenPlaceBody,
  initialTab = "overview",
  homeZip = null,
  embedded = false,
  onShowOnMap,
  onOpenVenue,
}: EntityModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  useCardVisibility(cardRef, `${subject.subjectKind}:${subject.subjectId}`, subject.subjectKind);
  const tab = initialTab;
  const listingCount = readerMeetingCount(subject.meetings, useMeetingListingIdentity());
  const { register, sources: allSources } = useCardSourceRegistry(subject.sources, `${subject.subjectKind}:${subject.subjectId}`);
  const sourceCount = sourceCountLabel(allSources);

  useEffect(() => {
    if (embedded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, embedded]);

  /*
   * NO pushed history entry (2026-08-14 third session, same diagnosis as
   * official-modal.tsx): pushing {overlay:true} makes Next's App Router
   * re-render the route and remount the island holding this modal's open
   * state — the modal dies the tick it opens, at every phone viewport.
   * ×, Escape, and backdrop click close; the back button navigates.
   */

  // The overview, shared by the tabbed card and the design card's single
  // scrolling view (which renders every section in order instead of tabs).
  const overview = (
              <>
                {subject.agenda && <MeetingListingNotice groups={listingCount.groups} />}
                {subject.facts.map((fact) => (
                  <PopupRow key={fact.label} label={fact.label} mono={fact.mono}>
                    {fact.value}
                  </PopupRow>
                ))}
  
                {/* 6f2: the district explainer, from the shipped office-type
                    library. Renders nothing when the library has no entry for
                    the office — an absent explainer is better than a made-up
                    one, and the tabs below still carry the record. */}
                {subject.representedByOfficeTitle &&
                  (() => {
                    const blurb = blurbForTitle(subject.representedByOfficeTitle);
                    if (!blurb) return null;
                    return (
                      <>
                        {/*
                          **BC-17 (2026-08-25) — THE HEADING BRANCHES ON WHETHER
                          THE DIVISION IS A GOVERNMENT OR A CONSTITUENCY.**
  
                          Tucson Unified District rendered "What the person who
                          represents this district does" on
                          `09-04-04`. The sentence is not wrong in general, and
                          the note on `representedByOfficeTitle` above explains
                          why it was chosen: a CONGRESSIONAL district is not a
                          government, it is a constituency, and the useful thing
                          to know about it is what the person elected from it can
                          actually do.
  
                          A SCHOOL DISTRICT is a government. It has a board, it
                          meets, it sets a budget — and the paragraph underneath
                          this heading says exactly that. So the heading
                          described a person while its own prose described a
                          body.
  
                          `runsSomething` is the discriminator this card already
                          uses a few lines away to decide whether to render a
                          "Who runs it" section at all. Asking it here means the
                          two answers cannot disagree about the same division.
                        */}
                        <PopupSectionLabel>
                          {runsSomething(subject.divisionKind)
                            ? "What this body does"
                            : "What the person who represents this district does"}
                        </PopupSectionLabel>
                        <p className="mt-1.5 t-detail leading-relaxed text-paper-dim">
                          {blurb.text}
                        </p>
                        <CardSourcesContribution id={`definition:${blurb.basis}`} sources={[{ what: "What this office does", provenance: { sourceOrg: blurb.basis, sourceUrl: blurb.basisUrl, collectedAt: "", verifiedAt: null } }]} />
                      </>
                    );
                  })()}
  
                {/*
                  MTG-3 (2026-08-23, the 8/22 walkthrough). Add to
                  Calendar lived on the Meetings tab and nowhere else, and
                  Directions lived on the venue panel and nowhere else — so the
                  large battlecard, which is the surface a reader lands on when
                  they click a meeting, had neither. A reader deciding whether to
                  go needs both, on whichever tab they are standing on.
  
                  The Location row above is the Directions link. This is the
                  other half.
                */}
                {subject.agenda &&
                  subject.meetings.length === 1 &&
                  subject.meetings[0].status === "SCHEDULED" && (
                    <CalendarLinks meeting={subject.meetings[0]} />
                  )}
  
                {subject.agenda && (
                  <>
                    <PopupSectionLabel>What this meeting is about</PopupSectionLabel>
                    <AgendaSection
                      meetingId={subject.agenda.meetingId}
                      agendaUrl={subject.agenda.agendaUrl}
                      agendaSlotObservedEmpty={subject.agenda.agendaSlotObservedEmpty}
                      provenance={subject.agenda.provenance}
                      carried={subject.agenda.carried}
                    />
                  </>
                )}
  
                {subject.commentAccess && (
                  <HowToBeHeard
                    ocdId={subject.commentAccess.ocdId}
                    bodyName={subject.commentAccess.bodyName}
                    bodyId={subject.commentAccess.bodyId}
                  />
                )}
              </>
    );

  // Approved reader design: "Where" and "Held by" rows on a meeting, each one
  // level deeper inside the same card.
  const meetingLinks =
    embedded && subject.subjectKind === "MEETING" && (onOpenVenue || (subject.heldByBodyId && onOpenPlaceBody)) ? (
      <div className="mw-link-rows">
        {onOpenVenue && subject.meetings[0]?.location && (
          <button type="button" className="mw-row-link" onClick={onOpenVenue}>
            <span className="mw-row-link-label">Where</span>
            <span className="mw-row-link-value">
              {subject.meetings[0].location.name ?? subject.meetings[0].location.address}
            </span>
            <span aria-hidden="true">›</span>
          </button>
        )}
        {subject.heldByBodyId && onOpenPlaceBody && (
          <button
            type="button"
            className="mw-row-link"
            onClick={() => onOpenPlaceBody(subject.heldByBodyId!)}
          >
            <span className="mw-row-link-label">Held by</span>
            <span className="mw-row-link-value">{subject.subtitle}</span>
            <span aria-hidden="true">›</span>
          </button>
        )}
      </div>
    ) : null;

  return (
    <CardSubjectContext.Provider value={subject.subjectKind === "BODY" ? { type: "BODY", id: subject.subjectId } : null}><CardSourceContext.Provider value={register}><div
      ref={cardRef}
      className={embedded ? "account-modal-overlay mw-embedded" : "account-modal-overlay"}
      role={embedded ? undefined : "dialog"}
      aria-modal={embedded ? undefined : "true"}
      aria-label={embedded ? undefined : subject.title}
      onClick={(event) => {
        if (!embedded && event.target === event.currentTarget) onClose();
      }}
    >
      <div className={embedded ? "account-modal mw-entity" : "account-modal"}>
        <header className="account-modal-header">
          <div className="min-w-0">
            <p
              className="popup-type"
              style={{ color: `var(--accent-${subject.tier})` }}
            >
              {TIER_LABEL[subject.tier]}
              {subject.badges?.map((badge) => (
                <span
                  key={badge.label}
                  className="popup-badge"
                  data-status={badge.status}
                >
                  {badge.label}
                </span>
              ))}
            </p>
            <h2 className="account-modal-title">{subject.title}</h2>
            <p className="account-modal-subtitle">{subject.subtitle}</p>
            {/*
              WGH-15: only when this modal is about a DIVISION. A person's card
              and a meeting's card have no district subject to be about, and
              rendering the line there would be the modal claiming something
              nobody asked it.
            */}
            {subject.divisionOcdId != null && (
              <BrowsingSubjectLine
                label={subject.title}
                homeZip={homeZip}
                ocdId={subject.divisionOcdId}
              />
            )}
          </div>

          {!embedded && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="popup-expand-btn !static shrink-0"
          >
            <X className="size-4" />
          </button>
          )}
        </header>
        {onShowOnMap && (
          <div className="mw-action-row mw-entity-actions">
            <button type="button" className="mw-pill-btn mw-pill-ring" onClick={onShowOnMap}>
              Show the whole boundary on the map
            </button>
          </div>
        )}

        {subject.bodyCard ? (
          <BodySections subject={{ ...subject, sources: allSources }} onOpenHolder={onOpenHolder} />
        ) : subject.placeCard ? (
          <PlaceSections subject={subject} onOpenPlaceBody={onOpenPlaceBody} />
        ) : (
        <div className="account-modal-body mw-sections">
          <CardSectionGroup independent={embedded}>
            <CardSection title="What this body does">{overview}{meetingLinks}</CardSection>
            <CardSection title={subject.subjectKind === "MEETING" || subject.divisionOcdId == null ? "Who sits on it" : "Representation"}>
              <Representation holders={subject.representation} gaps={subject.rosterGaps} note={subject.representationNote}
                onOpenHolder={onOpenHolder} showTopOffices={runsSomething(subject.divisionKind)} />
            </CardSection>
            {subject.subjectKind !== "MEETING" && <CardSection title={listingCount.heading}><Meetings meetings={subject.meetings} /></CardSection>}
            <CardSection title="Sources" meta={sourceCount}><Sources sources={allSources} /></CardSection>
          </CardSectionGroup>
        </div>
        )}

        {/*
          **BC-11 (2026-08-24) — SPEAK YOUR MIND, ON EVERY SHAPE THIS CARD
          TAKES, and it took reading a capture to find that it was not.**

          The pill belongs on every battlecard and every large meeting
          battlecard. This component renders THREE different cards from
          one function — a seven-section BODY card, a PLACE card, and the tabbed
          division/meeting card — and the first version put the pill inside the
          tabbed branch only.

          The DOM assertion was content: it found the modal, and the modal was
          open. **The capture is what showed a Pima County body card with six
          section pills and no Speak Your Mind on it** — the exact shape of
          failure the 8/24 brief names: closed at the instance, open at the
          class. It sits outside the branch now, so a fourth card shape cannot
          ship without it either.

          Below the card body rather than inside it: on the tabbed form Sources
          is a TAB, so a pill inside the panel would appear and vanish as the
          reader moved between tabs. Below the panel it is on every tab, which
          is what "above Sources" means when Sources is not a section.

          The subject's own title feeds the framing, so it asks what you would
          say if THE TOWNSHIP COUNCIL were standing in front of you rather than
          "this person" — a board is not a person and the copy may not pretend
          otherwise.
        */}
        {/*
          **NOT on the body card, which renders its own ABOVE Sources.**

          Without this condition the body card carried TWO pills — measured, not
          reasoned about: the shooter counted `[data-speak-pill]` and found 2.
          The body card is the one shape with a Sources SECTION, so it places
          the pill itself to satisfy "above Sources"; the tabbed card and the
          place card have no such section and take it here.
        */}
        {/*
          **BC-29 (2026-08-25) — IT IS A PINNED FOOT NOW, ON EVERY CARD SHAPE.**

          On the Kearsarge card the Speak Your Mind pill sat in a small scroll
          region of its own. It is now fixed at the bottom: only the board
          member list scrolls, and the pill stays put, never covered by
          anything — on every large battlecard with a scrolling list.

          The container was a SECOND `account-modal-body` — `flex: 1` with its
          own `overflow-y: auto` — so two siblings both claimed the remaining
          height and both grew scrollbars, and the pill ended up clipped inside
          a strip of its own. `account-modal-foot` is `flex: 0 0 auto`, so the
          list above takes the remainder and scrolls alone.

          **The `!subject.bodyCard` condition is GONE, and that is the "every
          card shape" half.** It existed so the body card could place its own
          pill above its Sources SECTION while the tabbed card took one here;
          two placements, one of which is now the wrong one. Pinned at the foot
          is below everything on every shape, which still satisfies BC-20's
          actual requirement — reachable from anywhere on the card — and now
          satisfies the stronger one, that it is never scrolled away from.

          Exactly ONE pill still renders per card, which is what the earlier
          two-pill defect was measured on: the body card's in-section render
          went with the condition.
        */}
        {(
          <div className="account-modal-foot">
            {/*
              **BC-20 (2026-08-25) — A TAB SWITCH COLLAPSES IT TO ITS PILL.**

              The panel sits BELOW the tab strip and stays mounted across every
              tab, which is deliberate — the placement is meant to be
              reachable from anywhere on the card. What it must not do is stay
              OPEN across a tab change: a reader who moves to Sources has
              stopped writing, and half-typed text left under a heading they
              are no longer looking at is the surface deciding it knows better.

              Keying it on the tab is the whole mechanism. React unmounts and
              remounts on a changed key, so `open` returns to false with no
              handler, no effect, and nothing for a future tab to forget.
            */}
            <SpeakYourMind
              key={`${tab}:${subject.subjectId}`}
              subjectType={subject.subjectKind}
              subjectId={subject.subjectId}
              subject={subject.title}
            />
            {/*
              **OWN-Q6 (2026-08-31) — the reader asking us to go get it.**

              On the BODY card only, and that is the item's scope rather than
              a hedge: the row asks for the pill on every body and candidate
              card. An OFFICIAL card is a person and a MEETING card is an
              event; neither is a record class this pill's sentence is true
              about, and rendering it there would be inventing a fourth
              meaning for one enum value.

              The SAME component as the candidate card, with the same props,
              so the two cannot drift — a pill that appeared only where
              coverage is good would itself be a coverage claim.
            */}
            {subject.subjectKind === "BODY" && (
              <DemandPill
                subjectType="BODY"
                subjectId={subject.subjectId}
                className="mt-3"
              />
            )}
          </div>
        )}
      </div>
    </div></CardSourceContext.Provider></CardSubjectContext.Provider>
  );
}

export function Representation({
  holders,
  note,
  gaps = [],
  onOpenHolder,
  /**
   * F01 2.2 (2026-08-19): lead with WHO RUNS IT.
   *
   * Default ON, so a surface that forgets to ask for it still gets it — the
   * rule is that every Representation list carries its top offices,
   * and a default-off flag is how half of them would end up without one. Set
   * false only where the list is ALREADY the top offices (a single-seat
   * division), which would otherwise print the same person twice.
   */
  showTopOffices = true,
}: {
  holders: SeatHolder[];
  note: string;
  gaps?: readonly RosterReaderGap[];
  onOpenHolder?: (holder: SeatHolder) => void;
  showTopOffices?: boolean;
}) {
  if (holders.length === 0) return <><RosterCompletenessGaps gaps={gaps} /><Empty>{note}</Empty></>;

  // OFF-4 (2026-08-24): the appointed executive leads the list. See
  // rosterInReadingOrder for why it reuses the precedence table above.
  const ordered = rosterInReadingOrder(holders);
  const topOffices = showTopOffices ? topOfficesFor(ordered) : [];
  // One person in the list IS the top office; a heading over a duplicate of
  // the only row is furniture, not information.
  const leadsWorthShowing = topOffices.length > 0 && holders.length > 1;

  return (
    <>
      <RosterCompletenessGaps gaps={gaps} />
      {/*
        F01 2.2 — the same question the small card answers, answered the same
        way, from the same precedence table. *"When I look at representation, as
        mentioned, there should be the superintendent in there."*

        The list below is the roster in the body’s own published order, which
        answers “who sits on it”. This answers “who runs it”, and a reader
        should not have to work the second out of the first.
      */}
      {leadsWorthShowing && (
        <div className="mb-2.5 border-b border-[var(--panel-border)] pb-2.5">
          <PopupSectionLabel>Who runs it</PopupSectionLabel>
          {topOffices.map((office) => (
            <p
              key={`top:${office.holder.id}`}
              className="mt-1 t-body leading-snug text-paper"
            >
              {onOpenHolder ? (
                <button
                  type="button"
                  onClick={() => onOpenHolder(office.holder)}
                  className="cursor-pointer font-medium hover:text-signal hover:underline"
                >
                  {displayPersonName(office.holder.name)}
                </button>
              ) : (
                <span className="font-medium">{displayPersonName(office.holder.name)}</span>
              )}
              <span className="text-muted">
                {" — "}
                {office.role}
              </span>
            </p>
          ))}
        </div>
      )}
      {showTopOffices && topOffices.length === 0 && (
        <p className="mb-2.5 border-b border-[var(--panel-border)] pb-2.5 t-caption leading-relaxed text-muted">
          {TOP_OFFICES_GAP}
        </p>
      )}
      {ordered.map((holder) => (
        <div key={holder.id} data-roster-holder={holder.id} className="account-modal-person flex items-start gap-3">
          {/*
            F01 2.3 (2026-08-19): on AZ-6's Representation list, each person's
            picture belongs on the left of their name and party, at the
            battlecard's size.

            We already had it: `holder.photoUrl` has ridden
            on the seat holder all along and this list was the one place that
            rendered a person WITHOUT the circle every other surface gives them.
            902 portraits were collected and this list showed none of them.

            `IdentityPortrait` rather than an `<img>`: it is the one geometry,
            it carries the neutral ring the party colour may never touch, and
            it renders honest INITIALS where no portrait exists — so a person
            we hold no picture of gets the same circle at the same size rather
            than a ragged row, which is the equal-effort rule applied to
            layout. `--sm` is the small battlecard's size.
          */}
          <IdentityPortrait name={holder.name} photoUrl={holder.photoUrl} />

          <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="t-body font-medium text-paper">
              {onOpenHolder ? (
                // The name opens the full card — contact, office blurb —
                // rather than navigating away.
                <button
                  type="button"
                  onClick={() => onOpenHolder(holder)}
                  className="cursor-pointer hover:text-signal hover:underline"
                >
                  {holder.name}
                </button>
              ) : holder.websiteUrl ? (
                <CheckedLink
                  href={holder.websiteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-signal hover:underline"
                >
                  {holder.name}
                </CheckedLink>
              ) : (
                holder.name
              )}
            </span>
            {/* LBL-2 (2026-08-23): the tracking adds its space AFTER the last
                letter, and this span sits hard against the row edge with
                shrink-0 — so a right-edge clip takes the space and then the
                glyph. trailing-space-trimmed removes the space from the box. */}
            <span className="trailing-space-trimmed shrink-0 font-mono t-caption uppercase tracking-[0.15em] text-muted">
              {readerOfficeTitle(holder.officeTitle)}
            </span>
          </div>

          {holder.partyLabel && <p className="mt-1 t-caption" style={{ color: partyColorVar(holder.partyLabel) }}>{readerPartyLabel(holder.partyLabel)}</p>}
          <CardSourcesContribution id={`holder:${holder.id}`} sources={holder.provenance ? [{ what: `Who represents it — ${holder.name}`, provenance: holder.provenance }] : holder.sourceUrl ? [{ what: `Who represents it — ${holder.name}`, provenance: { sourceUrl: holder.sourceUrl, sourceOrg: "", collectedAt: "", verifiedAt: null } }] : []} />
          </div>
        </div>
      ))}
    </>
  );
}

/**
 * Every meetings list on a battlecard — F01 3.1 and 3.2, 2026-08-19.
 *
 * Both callers (the division card's Meetings tab, the body card's Meetings
 * section) render through here, so the three groups and the collapsed
 * attribution cannot diverge between them. That was the actual defect: the tab
 * path never sorted at all while the body path did, and one shared function
 * used by half its callers is not a shared function.
 */
function Meetings({ meetings }: { meetings: Meeting[] }) {
  const listingCount = readerMeetingCount(meetings, useMeetingListingIdentity());
  // Pinned at mount — never a clock read in a render body (item 11's rule).
  const [now] = useState(() => Date.now());

  if (meetings.length === 0) {
    return (
      <Empty>
        No meetings on file for this division. That is our coverage, not a
        statement that nothing is scheduled.
      </Empty>
    );
  }

  const groups = groupMeetingsForReading(meetings, now);
  // SRC-1/2/3: one credit line at the foot of this tab, no inline markers.
  const credit = sourceCreditFor(
    groups.flatMap((group) => group.meetings),
  );

  return (
    <>
      <MeetingListingNotice groups={listingCount.groups} />
      {groups.map((group) => (
        <section key={group.id}>
          <p className="t-structure mt-3 mb-1 text-label first:mt-0">
            {group.label}
          </p>
          {group.meetings.map((meeting) => (
            <div key={meeting.id} className="account-modal-person">
              <div className="flex items-baseline justify-between gap-3">
                <span className="t-body text-paper">
                  {meeting.title}
                </span>
                <span className="shrink-0 font-mono t-caption text-muted">
                  {formatMeetingDate(meeting)}
                </span>
              </div>
              <p className="mt-0.5 t-caption text-muted">
                {formatMeetingTime(meeting)}
              </p>
              {/* 3i (2026-08-19): calendar links on every upcoming-meeting
                  surface, this tab included.

                  MTG-3 (2026-08-23): and Directions beside them. The two
                  belong together — a reader who has just added a meeting to
                  their calendar is the reader who next wants to know how to
                  get to it — and Meetings carried one of them while Overview
                  carried neither. */}
              {meeting.status === "SCHEDULED" && (
                <CalendarLinks meeting={meeting} />
              )}
              {meeting.location &&
                meeting.status !== "CONCLUDED" &&
                (() => {
                  const directions = venueLink(meeting.location);
                  if (!directions) return null;
                  return (
                    <CheckedLink
                      href={directions.url}
                      target="_blank"
                      rel="noreferrer"
                      title={directions.hint}
                      className="trailing-space-trimmed-14 mt-1 inline-flex items-baseline gap-1 font-mono t-caption uppercase tracking-[0.14em] text-muted underline-offset-2 hover:text-signal"
                    >
                      Directions
                    </CheckedLink>
                  );
                })()}
            </div>
          ))}
        </section>
      ))}

      {/* SRC-1 (2026-08-24): ONE credit line at the foot of the tab. The body
          name and jurisdiction still render in full here — what is gone is the
          footnote marker that used to sit on every row pointing at them. */}
      <MeetingSourceCredit
        credit={credit}
        sources={meetings.flatMap(meeting => meetingCardSources(meeting, []))}
        className="mt-3 border-t border-[var(--panel-border)] pt-2.5"
      />
    </>
  );
}

/**
 * Every record behind everything on screen.
 *
 * A null `sourceUrl` renders as such rather than being hidden — a source list
 * that quietly omits the unsourced rows is a worse lie than no source list,
 * because it implies everything shown was cited.
 */
function Sources({ sources }: { sources: CardSource[] }) {
  if (sources.length === 0) {
    return <WorkingOnIt />;
  }
  return <CardSourcesList sources={sources} />;
}

function Empty(_props: { children: ReactNode }) {
  return <WorkingOnIt className="px-1 py-3" />;
}

/* `hostOf` REMOVED (F01 3.2, 2026-08-19). Its only caller was the per-row
   provenance line the attribution collapse retired; a helper nothing calls is
   dead weight that reads as a capability. Deleted rather than allowlisted — an
   allowlist entry for an unused symbol is permission for the next one. */

export { PopupSectionLabel };
