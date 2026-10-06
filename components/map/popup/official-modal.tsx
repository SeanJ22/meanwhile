"use client";

import { memberDirectoryReaches } from "@/lib/officials/member-directory-scope";
import { PersonCard } from "@/components/ui/person-card";
import { useEffect, useRef, useState } from "react";

import { useCardVisibility } from "@/hooks/use-card-visibility";

import { TIER_LABEL, type Tier } from "@/lib/ocd/tiers";
import type { SeatHolder } from "@/lib/officials/lookup";
import type { ReactionViewContext } from "@/lib/reactions/client";

import {
  personCardSources,
  prlCardSource,
} from "@/lib/officials/card-sources";

import { FundingBlock } from "@/components/funding/funding-block";
import type { PrlReaderProfile } from "@/lib/sources/prl/snapshot";
import { PublicStatementsProfile } from "@/components/officials/public-statements-profile";
import { OfficialActions } from "@/components/officials/official-actions";
import { SpeakYourMind } from "@/components/speak/speak-your-mind";

import { identityChipsFor } from "@/lib/officials/identity-chips";
import { ContactPills } from "@/components/officials/contact-pills";
import { OfficialTermNote } from "@/components/officials/official-term-note";
import { MemberCommitteesContent, MemberOfficesContent } from "@/components/officials/member-directory";
import { useMemberDirectory } from "@/hooks/use-member-directory";
import { PersonIdentity } from "@/components/officials/person-identity";
import { PositionsSection } from "@/components/officials/positions-section";

import { OfficeBlurb, RecentVotes } from "./official-popup";

/**
 * The rep surface's large tier (3): the full record in the strat-map
 * pattern — one large centered surface, reached from the compact card's
 * "More". Identity, contact, the roll-call record with reaction capture,
 * and what the office does.
 *
 * One-at-a-time is enforced by the parent: opening this closes any other
 * large popup and subsumes the compact card that opened it. The close
 * control is visible in the header, Escape closes, and on a touch viewport
 * the back button closes it rather than leaving the app.
 */

interface OfficialModalProps {
  holder: SeatHolder;
  seatLabel: string | null;
  tier: Tier;
  reactionContext: ReactionViewContext | null;
  onClose: () => void;
  /**
   * Rendered as the body of the reader's one large card (approved design,
   * 2026-09-28), which owns the frame, Escape, Back and Close.
   */
  embedded?: boolean;
}

export function OfficialModal({
  holder,
  seatLabel,
  tier,
  reactionContext,
  onClose,
  embedded = false,
}: OfficialModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  useCardVisibility(cardRef, `OFFICIAL:${holder.id}`, "OFFICIAL");
  useEffect(() => {
    if (embedded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, embedded]);

  /*
   * Item 7's clean render, on the Sources section: the congress-legislators
   * project is cited ONCE for every directory fact on this card — the
   * official accounts in the pill row, the committee seats, the district
   * offices — rather than once per row beside each of them. Money, votes and
   * PRL keep their per-section citations; a claim surface is a different
   * register from a directory fact.
   */
  // A state legislator's offices are read from Open States onto the legislature's own row;
  // the card names that source once, beside the legislature's.
  const [prlProfile, setPrlProfile] = useState<PrlReaderProfile | null>(null);
  const { directory } = useMemberDirectory(holder.id);
  const officeSource = directory?.officeDetails?.[0];
  const sources = personCardSources(
    holder,
    [
      ...(holder.id.startsWith("congress:") && holder.provenance
        ? [
            {
              what: "Their official accounts, committee seats and district offices",
              provenance: holder.provenance,
            },
          ]
        : officeSource
          ? [{ what: "Their capitol and district offices", provenance: { sourceUrl: officeSource.sourceUrl, sourceOrg: officeSource.sourceOrg, collectedAt: officeSource.collectedAt, verifiedAt: null } }]
          : []),
      ...(prlProfile ? [prlCardSource(prlProfile)] : []),
    ],
  );

  /*
   * NO pushed history entry, deliberately (diagnosed 2026-08-14 third
   * session). The phone back-button-closes-the-modal behavior worked by
   * pushing {overlay:true} onto window.history — but Next's App Router
   * owns history, and the push makes it re-render the route, which
   * REMOUNTS the island holding the modal's open state: the modal dies
   * in the same tick it opens, at every viewport under 1024px, on the
   * map AND the ballot. That was the tester-era "official card won't
   * open on the phone" defect and the prior session's "hydration live,
   * click dead" mystery — proven by toggling the push alone. Both push
   * shapes (bare and router-state-preserving) kill it. A modal that
   * cannot open loses to a back button that leaves the page; × ,
   * Escape, and backdrop click all close.
   */

  return (
    <div
      ref={cardRef}
      className={embedded ? "account-modal-overlay mw-embedded" : "account-modal-overlay"}
      role={embedded ? undefined : "dialog"}
      aria-modal={embedded ? undefined : "true"}
      aria-label={embedded ? undefined : holder.name}
      onClick={(event) => {
        if (!embedded && event.target === event.currentTarget) onClose();
      }}
    >
      <PersonCard
        title={holder.name}
        identityKey={holder.id}
        subject={{ type: "CANDIDATE", id: holder.id }}
        eyebrow={<span style={{ color: `var(--accent-${tier})` }}>{TIER_LABEL[tier]}</span>}
        onClose={embedded ? undefined : onClose}
        className={embedded ? "account-modal mw-entity mw-person" : "account-modal"}
        independent={embedded}
        sources={sources}
        identity={<PersonIdentity holder={holder} seatLabel={seatLabel} large chips={identityChipsFor(holder, tier, "INCUMBENT")} />}
        contact={<><ContactPills holder={holder} /><OfficialTermNote holder={holder} /></>}
        sections={{
          office: <OfficeBlurb holder={holder} bare />,
          positions: <PositionsSection subjectId={holder.id} subjectName={holder.name} contentOnly />,
          committees: memberDirectoryReaches(holder.id, "committees") ? <MemberCommitteesContent holder={holder} /> : null,
          offices: memberDirectoryReaches(holder.id, "offices") ? <MemberOfficesContent holder={holder} /> : null,
          money: <FundingBlock holder={holder} reactionContext={reactionContext} bare />,
          record: <RecentVotes holder={holder} reactionContext={reactionContext} columns contentOnly />,
        }}
        afterSections={<>
          <PublicStatementsProfile subjectId={holder.id} onProfile={setPrlProfile} />
          <OfficialActions subjectId={holder.id} />
          <SpeakYourMind key={holder.id} context={reactionContext ?? undefined} subjectType="OFFICIAL" subjectId={holder.id} subject={holder.name} />
        </>}
      />
    </div>
  );
}
