"use client";

import { CardSubjectContext } from "@/components/ui/card-subject-context";
import { CheckedLink } from "@/components/ui/checked-link";
import { CardSourceContext, useCardSourceRegistry } from "@/components/ui/card-source-context";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import { CardGapContext, CardGapContribution, useCardGapRegistry } from "@/components/ui/card-gap-context";
import { CardFooter } from "@/components/ui/card-footer";
import { blurbForTitle } from "@/lib/officials/office-blurbs";
import { readerOfficeTitle } from "@/lib/officials/reader-office-title";
import { X } from "lucide-react";
import { PlacePublicRecords } from "../public-records";
import { PlaceOpenData } from "../open-data";
import { MeetingCard } from "@/components/ui/meeting-card";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useCardVisibility } from "@/hooks/use-card-visibility";

import { formatMeetingDate, formatMeetingTime } from "@/lib/map/format";
import { readerMeetingCount } from "@/lib/meetings/reader-listing-count";
import { useMeetingListingIdentity } from "@/lib/state/data";
import { MeetingListingNotice } from "../meeting-listing-notice";
import {
  groupMeetingsForReading,
  hasConcluded,
  orderByUpcomingFirst,
} from "@/lib/meetings/ordering";
import { runsSomething, topOfficesFor,
  rosterInReadingOrder,
} from "@/lib/officials/top-offices";
import { displayPersonName } from "@/lib/officials/person-name";
import { TIER_LABEL, type Tier } from "@/lib/ocd/tiers";
import type { SeatHolder } from "@/lib/officials/lookup";
import { partyColorVar } from "@/lib/officials/party-color";
import { readerPartyLabel } from "@/lib/text/reader-names";
import {
  type CardSource,
  meetingCardSources,
} from "@/lib/officials/card-sources";
import type { Meeting } from "@/lib/sources/types";

import {
  CardSection,
  CardSectionGroup,
} from "@/components/officials/card-section";
import { IdentityPortrait } from "@/components/officials/person-identity";
import { SpeakYourMind } from "@/components/speak/speak-your-mind";
import { RosterCompletenessGaps } from "@/components/officials/roster-completeness-gap";
import type { RosterReaderGap } from "@/lib/registry/body-rosters";

import { HowToBeHeard, MeetingSourceCredit } from "../meeting-panel";
import { venueLink } from "@/lib/registry/links";

import { BrowsingSubjectLine } from "./browsing-subject-line";
import { CalendarLinks } from "./calendar-links";
import { AgendaSection } from "./agenda-section";
import { PopupRow, PopupSectionLabel } from "./popup-card";

/**
 * The large card. Escape closes it. The Sources tab shows every source record
 * behind what is displayed.
 */

export type ModalTab =
  | "overview"
  | "representation"
  | "meetings"
  | "activity"
  | "sources";



/**
 * One held section of a body's card. Missing sections contribute to its footer.
 */
export interface BodyCardSection {
  id: string;
  title: string;
  /** Beside the title — a count, a date range. Never a judgement. */
  meta?: string;
  content: ReactNode | null;
}

/** One sourced description with its citation underneath. */
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
   * Two layers: `classDefinition` (what this kind of body does) always renders
   * where the class is known; `formDefinition` (its own charter or statute)
   * adds specificity beneath it.
   */
  whatItDoes: {
    classDefinition: BodyDefinitionText | null;
    formDefinition: BodyDefinitionText | null;
    /** One short line beneath a COMPLETE class definition. Never a refusal. */
    unreadNote: string | null;
  };
  /** A school district's superintendent, who is neither on the board nor elected. */
  superintendent: SeatHolder | null;
  /** Whether this body is a school district; decides section 3's line. */
  isSchoolDistrict: boolean;
  /** Section 5. Empty means no contact route has been sourced. */
  contact: { label: string; value: string; href: string | null }[];
  /** Section 6. Jurisdiction facts where held. */
  jurisdiction: { label: string; value: string }[];
}

/**
 * A place card: what the place is and every body we hold in it, each row
 * opening that body's battlecard. It elects no body to stand for the place.
 */
export interface PlaceCardData {
  /** What kind of division this is, in reader language. Never an enum. */
  typeLabel: string;
  /** The tier's label, or null when unknown; null renders the named gap, never a guessed tier. */
  tierLabel: string | null;
  /** Every body we hold in this place. Empty renders the named gap below. */
  bodies: { key: string; name: string; tier: Tier; meta?: string }[];
  /** Renders in place of the list when `bodies` is empty. Describes us. */
  absence: string;
}

/** Everything the modal renders, whichever entity opened it. */
export interface ModalSubject {
  publicRecordsDivisionId?: string | null;
  title: string;
  subtitle: string;
  tier: Tier;
  /**
   * The ocd-id, body id or meeting id this card is about; Speak Your Mind
   * stores it rather than a title, which several bodies can share.
   * `subjectKind` says which.
   */
  subjectId: string;
  subjectKind: "OFFICIAL" | "BODY" | "MEETING";
  /** A meeting's body by registry id, so "Held by" opens its card. Absent when not in coverage. */
  heldByBodyId?: string | null;
  /**
   * The subject's kind, in the registry vocabulary (place, county,
   * school_district, cd, sldu, sldl) or the map one (municipal, congressional,
   * state-senate). Decides whether the card carries "Who runs it".
   */
  divisionKind?: string | null;
  badges?: { label: string; status?: string }[];
  /** Overview rows. */
  facts: { label: string; value: ReactNode; mono?: boolean }[];
  /** A body battlecard; when present the modal renders its sections instead of the tab strip. */
  bodyCard?: BodyCardData;
  /** A place card; when present the modal renders the body list. `bodyCard` is read first. */
  placeCard?: PlaceCardData;
  /** A meeting's stored agenda content, rendered in the overview. */
  agenda?: {
    meetingId: string;
    agendaUrl: string | null;
    /* The publisher observation travels to the surface that renders the sentence. */
    agendaSlotObservedEmpty?: boolean;
    provenance?: {
      sourceUrl: string | null;
      sourceOrg: string;
      collectedAt: string;
      secondHand?: boolean;
    };
    carried?: unknown;
  } | null;
  /** How to speak at it, when the subject is a meeting. */
  commentAccess?: { ocdId: string | null; bodyName: string; bodyId?: string | null } | null;
  /** The office title of whoever represents the district, for that office's explainer. */
  representedByOfficeTitle?: string | null;
  representation: SeatHolder[];
  /** Each legislative district at the clicked point and its statewide offices. */
  spotRepresentation?: {
    ocdId: string;
    label: string;
    holders: SeatHolder[];
    rosterGaps?: RosterReaderGap[];
    note: string;
  }[];
  rosterGaps?: RosterReaderGap[];
  /** Why representation is empty, when it is. */
  representationNote: string;
  /**
   * The division this card is about. Lets the caller re-derive the card when a
   * division-keyed officeholder lookup answers after the click.
   */
  divisionOcdId?: string | null;
  meetings: Meeting[];
  /** Every record behind anything on screen, from `lib/officials/card-sources.ts`. */
  sources: CardSource[];
}

interface EntityModalProps {
  subject: ModalSubject;
  onClose: () => void;
  /** A representation row opens the person's full card. */
  onOpenHolder?: (holder: SeatHolder) => void;
  /** A place card's body row opens that body's battlecard, keyed by `placeCard.bodies[].key`. */
  onOpenPlaceBody?: (key: string) => void;
  /** Overridden in tests and screenshots so a tab can be captured directly. */
  initialTab?: ModalTab;
  /**
   * The reader's home zip, read-only, for the subject line on division cards.
   * Absent, the card claims nothing about the reader.
   */
  homeZip?: string | null;
  /** Rendered as the body of the reader's one large card, which owns the frame, Escape, Back and Close. */
  embedded?: boolean;
  /** "Show the whole boundary on the map": parks the card and fits the map. */
  onShowOnMap?: () => void;
  /** A meeting's "Where": opens the venue card for this meeting's room. */
  onOpenVenue?: () => void;
}

/** The place card's body. Every row opens that body's battlecard; nothing links out. */
function PlaceSections({
  subject,
  onOpenPlaceBody,
  homeZip,
}: {
  subject: ModalSubject;
  onOpenPlaceBody?: (key: string) => void;
  homeZip?: string | null;
}) {
  const card = subject.placeCard!;
  return (
    <div className="account-modal-body">
      <PopupRow label="Type">{card.typeLabel}</PopupRow>
      <PopupRow label="Tier">
{card.tierLabel}
      </PopupRow>

      <PopupSectionLabel>
        Who governs here
        {card.bodies.length > 0 && (
          <span className="account-modal-tab-count">{card.bodies.length}</span>
        )}
      </PopupSectionLabel>

      {card.bodies.length === 0 ? (
        <CardGapContribution id={`place:${subject.subjectId}:bodies`} label="who governs here" />
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
      <PublicRecordSection subject={subject} zip={homeZip} />
    </div>
  );
}

function PublicRecordSection({ subject, zip }: { subject: ModalSubject; zip?: string | null }) {
  const divisionId = subject.publicRecordsDivisionId ?? subject.divisionOcdId;
  if (subject.subjectKind === "MEETING" || !divisionId) return null;
  return <CardSection title="Public records">
    <PlacePublicRecords key={divisionId} divisionId={divisionId} bodyId={subject.bodyCard ? subject.subjectId : undefined} />
    <PlaceOpenData divisionId={divisionId} bodyId={subject.bodyCard ? subject.subjectId : undefined} zip={zip} />
  </CardSection>;
}

function BodySections({
  subject,
  onOpenHolder,
  homeZip,
}: {
  subject: ModalSubject;
  onOpenHolder?: (holder: SeatHolder) => void;
  homeZip?: string | null;
}) {
  const card = subject.bodyCard!;
  const listingCount = readerMeetingCount(subject.meetings, useMeetingListingIdentity());
  /* One `now`, pinned at mount, so the ordering and the "upcoming" count agree. */
  const [now] = useState(() => Date.now());
  // The flat ordering gives the count; <Meetings> groups the raw list.
  const meetings = orderByUpcomingFirst(subject.meetings, now);
  const upcoming = meetings.filter((m) => !hasConcluded(m, now)).length;

  const sections: BodyCardSection[] = [
    {
      id: "what",
      title: "What this body does",
      /* Class definition first, then the form-specific one, each with its own citation. */
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
            {card.whatItDoes.unreadNote && (
              <p className="mt-2 t-caption leading-relaxed text-muted">
                {card.whatItDoes.unreadNote}
              </p>
            )}
          </>
        ) : null,
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
              /* No "Who runs it" where nothing is run. */
              showTopOffices={runsSomething(subject.divisionKind)}
            />
            {/* Rendered only for school districts. */}
            {card.isSchoolDistrict && (
              <div className="mt-2 border-t border-[var(--panel-border)] pt-2">
                <PopupSectionLabel>Runs the district day to day</PopupSectionLabel>
                {card.superintendent ? (
                  // This block is the top office, so no "Who runs it" heading over it.
                  <Representation
                    holders={[card.superintendent]}
                    note=""
                    showTopOffices={false}
                    onOpenHolder={onOpenHolder}
                  />
                ) : (
                  <CardGapContribution id={`body:${subject.subjectId}:superintendent`} label="the superintendent" />
                )}
              </div>
            )}
          </>
        ) : null,
    },
    {
      id: "meetings",
      title: listingCount.heading,
      meta: meetings.length > 0 ? `${upcoming} upcoming${listingCount.unresolved ? " listings" : ""}` : undefined,
      content: meetings.length > 0 ? <Meetings meetings={meetings} /> : null,
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
    },
  ];

  return (
    <div className="account-modal-body">
      {/* Section 1, identity: never collapsed. */}
      {subject.facts.map((fact) => (
        <PopupRow key={fact.label} label={fact.label} mono={fact.mono}>
          {fact.value}
        </PopupRow>
      ))}

      {/* One group, one open pill. */}
      <CardSectionGroup>
        {sections.map((section) => section.content ? (
          <CardSection key={section.id} title={section.title} meta={section.meta}>{section.content}</CardSection>
        ) : <CardGapContribution key={section.id} id={`body:${subject.subjectId}:${section.id}`} label={section.title.toLowerCase()} />)}
        <PublicRecordSection subject={subject} zip={homeZip} />
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
  const { register, sources: allSources, insideCard } = useCardSourceRegistry(subject.sources, `${subject.subjectKind}:${subject.subjectId}`);
  const { register: registerGaps, gaps: allGaps } = useCardGapRegistry([], `${subject.subjectKind}:${subject.subjectId}`);

  useEffect(() => {
    if (embedded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, embedded]);

  /*
   * No pushed history entry: it makes the App Router remount the island
   * holding this modal's state. ×, Escape and backdrop click close.
   */

  // The overview, shared by the tabbed card and the design card's single scrolling view.
  const overview = (
              <>
                {subject.agenda && <MeetingListingNotice groups={listingCount.groups} />}
                {subject.subjectKind !== "MEETING" && subject.facts.map((fact) => (
                  <PopupRow key={fact.label} label={fact.label} mono={fact.mono}>
                    {fact.value}
                  </PopupRow>
                ))}
  
                {/* Renders nothing when the office-type library has no entry. */}
                {subject.representedByOfficeTitle &&
                  (() => {
                    const blurb = blurbForTitle(subject.representedByOfficeTitle);
                    if (!blurb) return null;
                    return (
                      <>
                        {/* A government division gets a body heading; a constituency gets the representative's. */}
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
  
                {subject.subjectKind !== "MEETING" && subject.agenda &&
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

  // "Where" and "Held by" rows on a meeting, each one level deeper inside the same card.
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

  if (subject.subjectKind === "MEETING" && subject.meetings[0]) return <div ref={cardRef}
    className={embedded ? "mw-embedded" : "account-modal-overlay"} role={embedded ? undefined : "dialog"} aria-modal={embedded ? undefined : "true"} aria-label={subject.title}
    onClick={event => { if (!embedded && event.target === event.currentTarget) onClose(); }}>
    <MeetingCard meeting={subject.meetings[0]} title={subject.title} subtitle={subject.subtitle} representation={subject.representation} sources={subject.sources} onClose={embedded ? undefined : onClose}>
      {meetingLinks}
      <CardSection title="What this meeting is about" defaultOpen>{overview}</CardSection>
      <CardSection title="Who sits on it"><Representation holders={subject.representation} note={subject.representationNote} gaps={subject.rosterGaps} onOpenHolder={onOpenHolder} /></CardSection>
      <SpeakYourMind subjectType="MEETING" subjectId={subject.subjectId} subject={subject.title} />
    </MeetingCard>
  </div>;

  return (
    <CardSubjectContext.Provider value={subject.subjectKind === "BODY" ? { type: "BODY", id: subject.subjectId } : null}><CardSourceContext.Provider value={register}><CardGapContext.Provider value={registerGaps}><div
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
            {/* Only when this modal is about a division. */}
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
          <BodySections subject={{ ...subject, sources: allSources }} onOpenHolder={onOpenHolder} homeZip={homeZip} />
        ) : subject.placeCard ? (
          <PlaceSections subject={subject} onOpenPlaceBody={onOpenPlaceBody} homeZip={homeZip} />
        ) : (
        <div className="account-modal-body mw-sections">
          <CardSectionGroup independent={embedded}>
            <CardSection title="What this body does">{overview}{meetingLinks}</CardSection>
            <CardSection title={subject.subjectKind === "MEETING" || subject.divisionOcdId == null ? "Who sits on it" : "Representation"}>
              <Representation holders={subject.representation} gaps={subject.rosterGaps} note={subject.representationNote}
                onOpenHolder={onOpenHolder} showTopOffices={runsSomething(subject.divisionKind)} />
            </CardSection>
            {subject.spotRepresentation && subject.spotRepresentation.length > 0 && (
              <CardSection title="Who represents this spot" defaultOpen>
                {subject.spotRepresentation.map(division => (
                  <div key={division.ocdId} data-spot-division={division.ocdId} className="mb-4 last:mb-0">
                    <PopupSectionLabel>{division.label}</PopupSectionLabel>
                    <Representation holders={division.holders} gaps={division.rosterGaps} note={division.note}
                      onOpenHolder={onOpenHolder} showTopOffices={false} />
                  </div>
                ))}
              </CardSection>
            )}
            {subject.subjectKind !== "MEETING" && <CardSection title={listingCount.heading}><Meetings meetings={subject.meetings} /></CardSection>}
            <PublicRecordSection subject={subject} zip={homeZip} />
          </CardSectionGroup>
        </div>
        )}

        {/* A pinned foot on every card shape: exactly one Speak Your Mind pill per card. */}
        {(
          <div className="account-modal-foot">
            {/* Keyed on the tab so a tab switch collapses it. */}
            <SpeakYourMind
              key={`${tab}:${subject.subjectId}`}
              subjectType={subject.subjectKind}
              subjectId={subject.subjectId}
              subject={subject.title}
            />
          </div>
        )}
        {!insideCard && <CardFooter gaps={allGaps} sources={allSources} />}
      </div>
    </div></CardGapContext.Provider></CardSourceContext.Provider></CardSubjectContext.Provider>
  );
}

export function Representation({
  holders,
  gaps = [],
  onOpenHolder,
  /** Lead with the top offices. False only where the list already is the top office. */
  showTopOffices = true,
}: {
  holders: SeatHolder[];
  note: string;
  gaps?: readonly RosterReaderGap[];
  onOpenHolder?: (holder: SeatHolder) => void;
  showTopOffices?: boolean;
}) {
  if (holders.length === 0) return <><RosterCompletenessGaps gaps={gaps} /><CardGapContribution id="representation" label="who sits on it" /></>;

  // The appointed executive leads the list.
  const ordered = rosterInReadingOrder(holders);
  const topOffices = showTopOffices ? topOfficesFor(ordered) : [];
  // A single-person list is the top office; no heading over a duplicate.
  const leadsWorthShowing = topOffices.length > 0 && holders.length > 1;

  return (
    <>
      <RosterCompletenessGaps gaps={gaps} />
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
        <CardGapContribution id="top-offices" label="who runs it" />
      )}
      {ordered.map((holder) => (
        <div key={holder.id} data-roster-holder={holder.id} className="account-modal-person flex items-start gap-3">
          {/* `IdentityPortrait` renders initials where no portrait exists. */}
          <IdentityPortrait name={holder.name} photoUrl={holder.photoUrl} />

          <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="t-body font-medium text-paper">
              {onOpenHolder ? (
                // The name opens the full card.
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
            {/* trailing-space-trimmed removes the tracking's trailing space from the box. */}
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

/** Every meetings list on a battlecard, in three groups with one credit line. */
export function Meetings({ meetings }: { meetings: Meeting[] }) {
  const listingCount = readerMeetingCount(meetings, useMeetingListingIdentity());
  // Pinned at mount; never a clock read in a render body.
  const [now] = useState(() => Date.now());

  if (meetings.length === 0) {
    return <CardGapContribution id="meetings" label="meetings" />;
  }

  const groups = groupMeetingsForReading(meetings, now);

  return (
    <>
      <MeetingListingNotice groups={listingCount.groups} />
      {groups.map((group) => (
        <section key={group.id}>
          <p className="t-structure mt-3 mb-1 text-label first:mt-0">
            {group.label}
          </p>
          {group.meetings.map((meeting) => (
            <div key={meeting.id} data-meeting-id={meeting.id} className="account-modal-person">
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

      {/* One credit line at the foot of the tab. */}
      <MeetingSourceCredit
        sources={meetings.flatMap(meeting => meetingCardSources(meeting, []))}
      />
    </>
  );
}

export { PopupSectionLabel };
