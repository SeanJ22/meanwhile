"use client";

import { blurbForTitle } from "@/lib/officials/office-blurbs";
import { X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { formatMeetingDate, formatMeetingTime } from "@/lib/map/format";
import { TIER_LABEL, type Tier } from "@/lib/ocd/tiers";
import type { SeatHolder } from "@/lib/officials/lookup";
import { partyColorVar } from "@/lib/officials/party-color";
import {
  sourceCountLabel,
  type CardSource,
} from "@/lib/officials/card-sources";
import type { Meeting } from "@/lib/sources/types";

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

/** Everything the modal renders, whichever entity opened it. */
export interface ModalSubject {
  title: string;
  subtitle: string;
  tier: Tier;
  badges?: { label: string; status?: string }[];
  /** Overview rows. */
  facts: { label: string; value: ReactNode; mono?: boolean }[];
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
  /** Overridden in tests and screenshots so a tab can be captured directly. */
  initialTab?: ModalTab;
}

export function EntityModal({
  subject,
  onClose,
  onOpenHolder,
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
