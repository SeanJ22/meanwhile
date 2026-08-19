"use client";

import { blurbForTitle } from "@/lib/officials/office-blurbs";
import { X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { formatMeetingDate, formatMeetingTime } from "@/lib/map/format";
import { hasConcluded, orderByUpcomingFirst } from "@/lib/meetings/ordering";
import { NO_BODY_BLURB_LINE } from "@/lib/officials/body-blurbs";
import { TIER_LABEL, type Tier } from "@/lib/ocd/tiers";
import type { SeatHolder } from "@/lib/officials/lookup";
import { partyColorVar } from "@/lib/officials/party-color";
import {
  sourceCountLabel,
  type CardSource,
} from "@/lib/officials/card-sources";
import type { Meeting } from "@/lib/sources/types";

import { CardSection } from "@/components/officials/card-section";
import { CardSourcesList } from "@/components/officials/card-sources-list";

import { HowToBeHeard } from "../meeting-panel";
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
  | "notes"
  | "sources";

const TABS: { id: ModalTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "representation", label: "Representation" },
  { id: "meetings", label: "Meetings" },
  { id: "activity", label: "Activity" },
  { id: "notes", label: "Notes" },
  { id: "sources", label: "Sources" },
];

/**
 * One collapsible section of a body's battlecard (M136, 2026-08-18).
 *
 * `content` is null when the product holds nothing for this section, and the
 * section STILL RENDERS: header visible, collapsed closed, the honest absence
 * line inside — the author's ruling of 2026-08-17 on M93's empty sections.
 *
 * Hiding an empty section would make a well-covered body's card taller than a
 * thin one's, which is the same layout thumb on the scale the equal-effort
 * rule catches for candidates. The SET of sections is identical for every
 * body; only what is inside them differs.
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
export interface BodyCardData {
  /** Section 2, or null where no statute has been read for this body. */
  whatItDoes: {
    text: string;
    basis: string;
    basisUrl: string | null;
    readOn: string;
  } | null;
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
 * A PLACE CARD (g18, 2026-08-18, the author's ruling A on M135's last row).
 *
 * M135's rule is that every row opens a card. Two rows did not, and this is
 * the one the author kept for himself: a PLACE row — "Pima County, AZ" in the
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
  agenda?: { meetingId: string; agendaUrl: string | null } | null;
  /** How to actually speak at it (D25), when the subject is a meeting. */
  commentAccess?: { ocdId: string | null; bodyName: string } | null;
  /**
   * 6f2 (2026-08-15, the author): a district battlecard's overview rendered
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
        <p className="mt-1.5 text-[0.75rem] leading-relaxed text-muted">
          {card.absence}
        </p>
      ) : (
        <ul className="mt-1.5 flex flex-col gap-1">
          {card.bodies.map((body) => (
            <li key={body.key}>
              <button
                type="button"
                onClick={() => onOpenPlaceBody?.(body.key)}
                className="flex w-full items-baseline justify-between gap-2 rounded border border-[var(--panel-border)] px-2.5 py-1.5 text-left hover:border-[var(--accent-local)]"
              >
                <span className="min-w-0 truncate text-[0.8125rem] text-paper">
                  {body.name}
                </span>
                <span
                  className="shrink-0 font-mono text-[0.5625rem] uppercase tracking-[0.15em]"
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
  const meetings = orderByUpcomingFirst(subject.meetings, now);
  const upcoming = meetings.filter((m) => !hasConcluded(m, now)).length;

  const sections: BodyCardSection[] = [
    {
      id: "what",
      title: "What this body does",
      content: card.whatItDoes ? (
        <>
          <p className="text-[0.8125rem] leading-relaxed text-paper-dim">
            {card.whatItDoes.text}
          </p>
          <p className="mt-1.5 text-[0.625rem] text-muted">
            Powers defined in:{" "}
            {card.whatItDoes.basisUrl ? (
              <a
                href={card.whatItDoes.basisUrl}
                target="_blank"
                rel="noreferrer"
                className="underline decoration-dotted hover:text-link"
              >
                {card.whatItDoes.basis}
              </a>
            ) : (
              card.whatItDoes.basis
            )}
            , read {card.whatItDoes.readOn}
          </p>
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
              note={subject.representationNote}
              onOpenHolder={onOpenHolder}
            />
            {/* The school district's non-elected seat, labelled as what it
                is. Absent for every other body kind rather than rendered
                empty, because a county has no superintendent to be missing. */}
            {card.isSchoolDistrict && (
              <div className="mt-2 border-t border-[var(--rule)] pt-2">
                <PopupSectionLabel>Runs the district day to day</PopupSectionLabel>
                {card.superintendent ? (
                  <Representation
                    holders={[card.superintendent]}
                    note=""
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
      title: "Meetings",
      meta: meetings.length > 0 ? `${upcoming} upcoming` : undefined,
      content: meetings.length > 0 ? <Meetings meetings={meetings} /> : null,
      absence:
        "No meetings on file for this body. That is our coverage, not a statement that nothing is scheduled.",
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
                  <a
                    href={row.href}
                    target="_blank"
                    rel="noreferrer"
                    className="text-link underline decoration-dotted underline-offset-2 hover:decoration-solid"
                  >
                    {row.value}
                  </a>
                ) : (
                  row.value
                )}
              </PopupRow>
            ))}
          </>
        ) : null,
      absence: "We haven't found a published way to contact this body yet.",
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
      absence: "We haven't recorded the area this body covers yet.",
    },
    {
      id: "sources",
      title: "Sources",
      meta: sourceCountLabel(subject.sources) ?? undefined,
      content:
        subject.sources.length > 0 ? <Sources sources={subject.sources} /> : null,
      absence: "Nothing on this card came from an external record.",
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

      {sections.map((section) => (
        <CardSection key={section.id} title={section.title} meta={section.meta}>
          {section.content ?? <Empty>{section.absence}</Empty>}
        </CardSection>
      ))}
    </div>
  );
}

export function EntityModal({
  subject,
  onClose,
  onOpenHolder,
  onOpenPlaceBody,
  initialTab = "overview",
}: EntityModalProps) {
  const [tab, setTab] = useState<ModalTab>(initialTab);
  const sourceCount = sourceCountLabel(subject.sources);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /*
   * NO pushed history entry (2026-08-14 third session, same diagnosis as
   * official-modal.tsx): pushing {overlay:true} makes Next's App Router
   * re-render the route and remount the island holding this modal's open
   * state — the modal dies the tick it opens, at every phone viewport.
   * ×, Escape, and backdrop click close; the back button navigates.
   */

  return (
    <div
      className="account-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={subject.title}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="account-modal">
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
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="popup-expand-btn !static shrink-0"
          >
            <X className="size-4" />
          </button>
        </header>

        {subject.bodyCard ? (
          <BodySections subject={subject} onOpenHolder={onOpenHolder} />
        ) : subject.placeCard ? (
          <PlaceSections subject={subject} onOpenPlaceBody={onOpenPlaceBody} />
        ) : (
        <>
        <div className="account-modal-tabs" role="tablist">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              role="tab"
              type="button"
              aria-selected={tab === entry.id}
              className="account-modal-tab"
              data-active={String(tab === entry.id)}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
              {/* Item 1 (2026-08-16): the stated N, computed from the SAME
                  array the tab maps over. A count derived a second way is how
                  a number comes to disagree with what is on screen. */}
              {entry.id === "sources" && sourceCount && (
                <span className="account-modal-tab-count">{sourceCount}</span>
              )}
            </button>
          ))}
        </div>

        <div className="account-modal-body" role="tabpanel">
          {tab === "overview" && (
            <>
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
                      <PopupSectionLabel>
                        What the person who represents this district does
                      </PopupSectionLabel>
                      <p className="mt-1.5 text-[0.75rem] leading-relaxed text-paper-dim">
                        {blurb.text}
                      </p>
                      <p className="mt-1 text-[0.625rem] text-muted">
                        Powers defined in:{" "}
                        {blurb.basisUrl ? (
                          <a
                            href={blurb.basisUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="underline decoration-dotted hover:text-link"
                          >
                            {blurb.basis}
                          </a>
                        ) : (
                          blurb.basis
                        )}
                      </p>
                    </>
                  );
                })()}

              {subject.agenda && (
                <>
                  <PopupSectionLabel>What this meeting is about</PopupSectionLabel>
                  <AgendaSection
                    meetingId={subject.agenda.meetingId}
                    agendaUrl={subject.agenda.agendaUrl}
                  />
                </>
              )}

              {subject.commentAccess && (
                <HowToBeHeard
                  ocdId={subject.commentAccess.ocdId}
                  bodyName={subject.commentAccess.bodyName}
                />
              )}
            </>
          )}

          {tab === "representation" && (
            <Representation
              holders={subject.representation}
              note={subject.representationNote}
              onOpenHolder={onOpenHolder}
            />
          )}

          {tab === "meetings" && <Meetings meetings={subject.meetings} />}

          {tab === "activity" && (
            <Empty>
              Civic engagement tracking arrives in Phase 7 — marking that you
              attended, commented, or are watching an item. It stays on this
              device and is never aggregated or licensed.
            </Empty>
          )}

          {tab === "notes" && (
            <Empty>
              Notes arrive in Phase 7. They stay on this device — never synced,
              never shown to another reader, never exported.
            </Empty>
          )}

          {tab === "sources" && <Sources sources={subject.sources} />}
        </div>
        </>
        )}
      </div>
    </div>
  );
}

function Representation({
  holders,
  note,
  onOpenHolder,
}: {
  holders: SeatHolder[];
  note: string;
  onOpenHolder?: (holder: SeatHolder) => void;
}) {
  if (holders.length === 0) return <Empty>{note}</Empty>;

  return (
    <>
      {holders.map((holder) => (
        <div key={holder.id} className="account-modal-person">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[0.875rem] font-medium text-paper">
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
                <a
                  href={holder.websiteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-signal hover:underline"
                >
                  {holder.name}
                </a>
              ) : (
                holder.name
              )}
            </span>
            <span className="shrink-0 font-mono text-[0.5625rem] uppercase tracking-[0.15em] text-muted">
              {holder.officeTitle}
            </span>
          </div>

          {/*
            Provenance inline, not behind a link. This is the tab where a reader
            asks "says who?", and making them navigate to find out defeats it.
          */}
          <p className="mt-1 text-[0.6875rem] text-muted">
            {/* 3a: the party label wears its color; the rest of the
                provenance line stays muted. */}
            {holder.partyLabel ? (
              <span style={{ color: partyColorVar(holder.partyLabel) }}>
                {holder.partyLabel} ·{" "}
              </span>
            ) : (
              ""
            )}
            {holder.sourceUrl ? (
              <a
                href={holder.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="hover:text-signal hover:underline"
              >
                source
              </a>
            ) : (
              <NoValue>no source recorded</NoValue>
            )}
          </p>
        </div>
      ))}
    </>
  );
}

function Meetings({ meetings }: { meetings: Meeting[] }) {
  if (meetings.length === 0) {
    return (
      <Empty>
        No meetings on file for this division. That is our coverage, not a
        statement that nothing is scheduled.
      </Empty>
    );
  }

  return (
    <>
      {meetings.map((meeting) => (
        <div key={meeting.id} className="account-modal-person">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[0.875rem] text-paper">{meeting.title}</span>
            <span className="shrink-0 font-mono text-[0.6875rem] text-muted">
              {formatMeetingDate(meeting)}
            </span>
          </div>
          <p className="mt-0.5 text-[0.6875rem] text-muted">
            {meeting.bodyName} · {formatMeetingTime(meeting)}
          </p>
          {/* 3i (2026-08-19): calendar links on every upcoming-meeting
              surface, this tab included. */}
          {meeting.status === "SCHEDULED" && <CalendarLinks meeting={meeting} />}
        </div>
      ))}
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
    return <Empty>Nothing on this card came from an external record.</Empty>;
  }
  return <CardSourcesList sources={sources} />;
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="px-1 py-3 text-[0.8125rem] leading-relaxed text-muted">
      {children}
    </p>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export { PopupSectionLabel };
