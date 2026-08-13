"use client";

import { X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import {
  formatMeetingDate,
  formatMeetingTime,
  shortOcdId,
} from "@/lib/map/format";
import { TIER_LABEL, type Tier } from "@/lib/ocd/tiers";
import type { SeatHolder } from "@/lib/officials/lookup";
import type { Meeting, Provenance } from "@/lib/sources/types";

import { Copyable, NoValue, PopupRow, PopupSectionLabel } from "./popup-card";

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
  representation: SeatHolder[];
  /** Why representation is empty, when it is. */
  representationNote: string;
  meetings: Meeting[];
  /** Every record behind anything on screen. */
  sources: { what: string; provenance: Provenance }[];
}

interface EntityModalProps {
  subject: ModalSubject;
  onClose: () => void;
  /** Overridden in tests and screenshots so a tab can be captured directly. */
  initialTab?: ModalTab;
}

export function EntityModal({
  subject,
  onClose,
  initialTab = "overview",
}: EntityModalProps) {
  const [tab, setTab] = useState<ModalTab>(initialTab);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // On a touch viewport the back button should close the modal rather than
  // leave the app. Desktop keeps Escape and the close button, and gains no
  // history entry — a back press there should still navigate.
  useEffect(() => {
    if (!window.matchMedia("(max-width: 1024px)").matches) return;

    window.history.pushState({ overlay: true }, "");
    const onPop = () => onClose();
    window.addEventListener("popstate", onPop);

    return () => {
      window.removeEventListener("popstate", onPop);
      // Only unwind our own entry, and only if it is still the current one.
      if (window.history.state?.overlay) window.history.back();
    };
  }, [onClose]);

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
            </>
          )}

          {tab === "representation" && (
            <Representation
              holders={subject.representation}
              note={subject.representationNote}
            />
          )}

          {tab === "meetings" && <Meetings meetings={subject.meetings} />}

          {tab === "activity" && (
            <Empty>
              Civic engagement tracking arrives in Phase 7 — marking that you
              attended, commented, or are watching an item. It stays on this
              device and is never aggregated or sold.
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
}: {
  holders: SeatHolder[];
  note: string;
}) {
  if (holders.length === 0) return <Empty>{note}</Empty>;

  return (
    <>
      {holders.map((holder) => (
        <div key={holder.id} className="account-modal-person">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[0.875rem] font-medium text-paper">
              {holder.websiteUrl ? (
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
            {holder.partyLabel ? `${holder.partyLabel} · ` : ""}
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
function Sources({
  sources,
}: {
  sources: { what: string; provenance: Provenance }[];
}) {
  if (sources.length === 0) {
    return <Empty>Nothing on this card came from an external record.</Empty>;
  }

  return (
    <>
      {sources.map((entry, i) => (
        <div key={`${entry.what}-${i}`} className="account-modal-person">
          <p className="text-[0.8125rem] text-paper">{entry.what}</p>

          <PopupRow label="Published by">
            {entry.provenance.sourceOrg || <NoValue />}
          </PopupRow>

          <PopupRow label="Read from">
            {entry.provenance.sourceUrl ? (
              <a
                href={entry.provenance.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-signal hover:underline"
              >
                {hostOf(entry.provenance.sourceUrl)}
              </a>
            ) : (
              <NoValue>no published page</NoValue>
            )}
          </PopupRow>

          <PopupRow label="Collected" mono>
            {entry.provenance.collectedAt ? (
              <Copyable text={entry.provenance.collectedAt}>
                {entry.provenance.collectedAt.slice(0, 10)}
              </Copyable>
            ) : (
              <NoValue />
            )}
          </PopupRow>

          <PopupRow label="Verified" mono>
            {entry.provenance.verifiedAt ? (
              entry.provenance.verifiedAt.slice(0, 10)
            ) : (
              // Null means no human has confirmed this against the source. It
              // is the normal state and says so, rather than reading as a gap.
              <NoValue>not yet</NoValue>
            )}
          </PopupRow>
        </div>
      ))}
    </>
  );
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

export { PopupSectionLabel, shortOcdId };
