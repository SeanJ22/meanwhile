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
 * The officeholder's large card: identity, contact, the roll-call record with
 * reaction capture, and what the office does. The parent keeps one large
 * surface open at a time.
 */

interface OfficialModalProps {
  holder: SeatHolder;
  seatLabel: string | null;
  tier: Tier;
  reactionContext: ReactionViewContext | null;
  onClose: () => void;
  /** Rendered as the body of the reader's one large card, which owns the frame, Escape, Back and Close. */
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
   * Directory facts (accounts, committee seats, offices) cite their project
   * once on the Sources section; money, votes and PRL keep per-section
   * citations. A state legislator's offices come from Open States.
   */
  const [prlProfile, setPrlProfile] = useState<PrlReaderProfile | null>(null);
  const { directory } = useMemberDirectory(holder.id,holder.state);
  const officeSource = directory?.officeDetails?.[0];
  const sources = personCardSources(
    holder,
    [
      ...(officeSource
        ? [{ what: "Their capitol and district offices", provenance: { sourceUrl: officeSource.sourceUrl, sourceOrg: officeSource.sourceOrg, collectedAt: officeSource.collectedAt, verifiedAt: null } }]
        : []),
      ...(prlProfile ? [prlCardSource(prlProfile)] : []),
    ],
  );

  /*
   * No pushed history entry: it makes the App Router remount the island
   * holding this modal's state. ×, Escape and backdrop click close.
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
