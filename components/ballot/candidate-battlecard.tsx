"use client";

import { PersonCard } from "@/components/ui/person-card";
import { CardGapContribution } from "@/components/ui/card-gap-context";
import { useEffect, useState } from "react";

import { captureEvent } from "@/lib/events/client";

import type { BattlecardSectionId } from "@/lib/ballot/battlecard-sections";
import { ContactPills } from "@/components/officials/contact-pills";
import { OfficialTermNote } from "@/components/officials/official-term-note";
import type { SeatHolder } from "@/lib/officials/lookup";
import { IdentityChip, IdentityPortrait } from "@/components/officials/person-identity";
import { incumbencyLabel, type Incumbency, type IncumbencyGap } from "@/lib/ballot/incumbency";
import { SpeakYourMind } from "@/components/speak/speak-your-mind";
import { partyColorVar } from "@/lib/officials/party-color";
import { readerPartyLabel } from "@/lib/text/reader-names";
import type { Tier } from "@/lib/ocd/tiers";
import { PositionsSection } from "@/components/officials/positions-section";
import { PublicStatementsProfile } from "@/components/officials/public-statements-profile";
import { OfficialActions } from "@/components/officials/official-actions";
import { FederalMemberRecords } from "@/components/officials/federal-records";
import { FederalCommentRules } from "@/components/officials/federal-comment-rules";

export function CandidateBattlecard({
  name,
  partyLine,
  partyLabel = null,
  photoUrl = null,
  incumbency = "UNKNOWN",
  incumbencyGap = null,
  speakContext = null,
  subjectId,
  sections,
  contactHolder = null,
  contact,
  tier = null,
}: {
  name: string;

  contactHolder?: SeatHolder | null;
  contact?: React.ReactNode;

  tier?: Tier | null;

  partyLabel?: string | null;

  photoUrl?: string | null;

  incumbency?: Incumbency;

  incumbencyGap?: IncumbencyGap | null;

  speakContext?: { lat?: number | null; lng?: number | null } | null;

  partyLine?: React.ReactNode;

  subjectId: string;

  sections?: Partial<Record<BattlecardSectionId, React.ReactNode>>;

}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>

      <button
        type="button"
        data-battlecard-pill
        onClick={() => {
          captureEvent({ type: "CARD_OPEN", cardId: `BATTLECARD:${subjectId}`, cardKind: "BATTLECARD" });
          setOpen(true);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}

        className="battlecard-cta w-full"
      >
        View Battlecard
      </button>

      {open && (
        <div
          className="account-modal-overlay" data-candidate-battlecard data-candidate-subject={subjectId} data-tier={tier ?? undefined}
          role="dialog"
          aria-modal="true"
          aria-label={name}
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <PersonCard
            title={name}
            className="account-modal"
            onClose={() => setOpen(false)}
            subject={{ type: "CANDIDATE", id: subjectId }}
            identity={(
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <IdentityPortrait name={name} photoUrl={photoUrl} />

                <div className="min-w-0 flex-1">

                  <p
                    className="popup-type"
                    style={{ color: tier ? `var(--accent-${tier})` : "var(--text-dim)" }}
                  >
                    Candidate
                  </p>
                  <p className="truncate t-title font-semibold tracking-tight">
                    {name}
                  </p>

                  <div className="id-chip-row">
                    {partyLabel ? (
                      <IdentityChip fill={partyColorVar(partyLabel)}>{readerPartyLabel(partyLabel)}</IdentityChip>
                    ) : (
                      partyLine && <span className="t-detail text-muted">{partyLine}</span>
                    )}

                    <IdentityChip
                      className={incumbency === "UNKNOWN" ? "id-chip-unsourced" : undefined}
                    >
                      {incumbencyLabel(incumbency, incumbencyGap ?? undefined)}
                    </IdentityChip>
                  </div>
                </div>
              </div>

            )}
            contact={contact ?? (contactHolder ? <div data-ballot-contact-row><ContactPills holder={contactHolder} scope="primary" /><OfficialTermNote holder={contactHolder} /></div> : <CardGapContribution id={`contact:${subjectId}`} label="contact details" subject={{ type: "CANDIDATE", id: subjectId }} />)}
            sections={{ ...sections, positions: <>{sections?.positions}<PositionsSection subjectId={contactHolder?.id ?? subjectId} subjectName={name} contentOnly /></> }}
            afterSections={<>
              <FederalMemberRecords key={contactHolder?.id ?? subjectId} memberId={contactHolder?.id ?? subjectId} />
              {(contactHolder?.id ?? subjectId).startsWith("congress:") && <FederalCommentRules />}
              <PublicStatementsProfile subjectId={contactHolder?.id ?? subjectId} />
              <OfficialActions subjectId={contactHolder?.id ?? subjectId} />
              <div className="mt-5"><SpeakYourMind subjectType="CANDIDATE" subjectId={subjectId} subject={name} context={speakContext ?? undefined} /></div>
            </>}
          />
        </div>
      )}
    </>
  );
}
