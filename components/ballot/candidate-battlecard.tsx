"use client";

import { PersonCard } from "@/components/ui/person-card";
import { CardGapContext, CardGapContribution } from "@/components/ui/card-gap-context";
import { CardSourceContext } from "@/components/ui/card-source-context";
import { useEffect, useState } from "react";

import { captureEvent } from "@/lib/events/client";

import type { BattlecardSectionId } from "@/lib/ballot/battlecard-sections";
import { ContactPills } from "@/components/officials/contact-pills";
import { OfficialTermNote } from "@/components/officials/official-term-note";
import type { SeatHolder } from "@/lib/officials/lookup";
import { IdentityChip, IdentityPortrait, PersonIdentity } from "@/components/officials/person-identity";
import { LegislatorBills } from "@/components/officials/legislator-bills";
import { prlCardSource } from "@/lib/officials/card-sources";
import type { PrlReaderProfile } from "@/lib/sources/prl/snapshot";
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
  divisionIds = [],
  sections,
  contactHolder = null,
  contact,
  tier = null,
  sectionIds,
  actionsGap = true,
}: {
  name: string;

  contactHolder?: SeatHolder | null;
  contact?: React.ReactNode;

  tier?: Tier | null;

  /** The sections the contested office has; the rest are never reported as still being gathered. */
  sectionIds?: readonly BattlecardSectionId[];
  actionsGap?: boolean;

  partyLabel?: string | null;

  photoUrl?: string | null;

  incumbency?: Incumbency;

  incumbencyGap?: IncumbencyGap | null;

  speakContext?: { lat?: number | null; lng?: number | null } | null;

  partyLine?: React.ReactNode;

  subjectId: string;
  divisionIds?: readonly string[];

  sections?: Partial<Record<BattlecardSectionId, React.ReactNode>>;

}) {
  const [open, setOpen] = useState(false);
  const [prlProfile, setPrlProfile] = useState<PrlReaderProfile | null>(null);

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
          <CardSourceContext.Provider value={null}><CardGapContext.Provider value={null}><PersonCard
            title={name}
            className="account-modal"
            onClose={() => setOpen(false)}
            subject={{ type: "CANDIDATE", id: subjectId }}
            sources={prlProfile ? [prlCardSource(prlProfile)] : []}
            identity={contactHolder ? <PersonIdentity holder={{ ...contactHolder, name, photoUrl,
              partyLabel: partyLabel ?? contactHolder.partyLabel }} seatLabel={null} large
              chips={["Candidate", incumbencyLabel(incumbency, incumbencyGap ?? undefined)].filter((chip): chip is string => chip !== null)} /> : (
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
            sectionIds={sectionIds}
            sections={{ ...sections, positions: <>{sections?.positions}<PositionsSection context={speakContext} divisionIds={divisionIds} subjectId={contactHolder?.id ?? subjectId} subjectName={name} contentOnly /></> }}
            afterSections={<>
              <FederalMemberRecords key={contactHolder?.id ?? subjectId} memberId={contactHolder?.id ?? subjectId} />
              {contactHolder && !contactHolder.id.startsWith("congress:") && <LegislatorBills holder={contactHolder} />}
              {(contactHolder?.id ?? subjectId).startsWith("congress:") && <FederalCommentRules />}
              <PublicStatementsProfile subjectId={contactHolder?.id ?? subjectId} onProfile={setPrlProfile} />
              <OfficialActions context={speakContext} divisionIds={divisionIds} subjectId={contactHolder?.id ?? subjectId} gapWhenEmpty={actionsGap} />
              <div className="mt-5"><SpeakYourMind subjectType="CANDIDATE" subjectId={subjectId} subject={name} context={speakContext ?? undefined} /></div>
            </>}
          /></CardGapContext.Provider></CardSourceContext.Provider>
        </div>
      )}
    </>
  );
}
