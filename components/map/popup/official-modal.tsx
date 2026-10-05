"use client";

import { Card } from "@/components/ui/card";
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
import {
  CardSection,
} from "@/components/officials/card-section";
import { SpeakYourMind } from "@/components/speak/speak-your-mind";

import { identityChipsFor } from "@/lib/officials/identity-chips";
import { ContactPills } from "@/components/officials/contact-pills";
import { OfficialTermNote } from "@/components/officials/official-term-note";
import { MemberDirectory } from "@/components/officials/member-directory";
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
      <Card
        title={holder.name}
        titleVisible={false}
        eyebrow={<span style={{ color: `var(--accent-${tier})` }}>{TIER_LABEL[tier]}</span>}
        onClose={embedded ? undefined : onClose}
        className={embedded ? "account-modal mw-entity mw-person" : "account-modal"}
        independent={embedded}
        sources={sources}
      >
          {/*
            Item 3 (2026-08-16). Circle portrait with a
            NEUTRAL ring, name as the dominant type, one chip row where party
            FILLS and state / chamber / incumbent are outlined neutrals.
            Fill-versus-outline carries the emphasis; every chip is one
            height. The test is under one second to "who is this person".
          */}
          <PersonIdentity
            holder={holder}
            seatLabel={seatLabel}
            large
            chips={identityChipsFor(holder, tier, "INCUMBENT")}
          />

          {/*
            Item 8 (2026-08-16): the full contact row, directly under the
            identity chips, per the reference. Officeholder cards only — the
            social handles come from the directory's OFFICIAL-accounts-only
            policy, which is the entire reason a social pill belongs on an
            officeholder's card. Render what is held, only what is held.
          */}
          <ContactPills holder={holder} />
          <OfficialTermNote holder={holder} />

          <CardSection title="What this office does">
            <OfficeBlurb holder={holder} bare />
          </CardSection>

          {/*
            D35 (2026-08-17): the Positions section, in the large popup, as the
            row specifies — topic-searchable against THIS PERSON'S corpus only,
            never the routing chat. Three answers, each its own sentence and
            its own register: what they published (quoted, linked, dated), what
            our bounded search did not find, or that we have not collected
            anything of theirs yet. Nothing here characterises anybody.
          */}
          <PositionsSection subjectId={holder.id} subjectName={holder.name} />

          {/*
            g3 item 9 (2026-08-16): the "How to reach them" accordion is GONE.
            The pill row above it is the contact surface.

            **Audited before deleting, field by field.** `ReachThem` rendered
            phone, email, contact form, official page and campaign site;
            `ContactPills` renders every one of those plus the official social
            accounts, and carries the same honest-absence line ("No published
            contact on record yet.") when a person has none. So the accordion
            held nothing the pills do not — it was the identical facts, one
            tap further away, under a header that promised something new.
            The one thing that WAS unique to it, the office addresses, moved
            to `MemberDirectory` before this session and is untouched below.

            The section set is still identical per office class — the rule
            6b4 set — because the section is gone for everyone, not gone for
            the people we happen to know less about.
          */}

          {/* Item 7: the member's LOCAL offices — the door near the reader —
              and their committee seats. Federal members only; the source's
              scope is the section's scope, and the section is identical for
              all 537. */}
          <MemberDirectory holder={holder} />

          {/* D34: campaign money — FUNDING tier, its own section, never
              blended with the votes. */}
          <CardSection title="Campaign money" defaultOpen={embedded}>
            <FundingBlock holder={holder} reactionContext={reactionContext} bare />
          </CardSection>
          <PublicStatementsProfile subjectId={holder.id} onProfile={setPrlProfile} />
          <OfficialActions subjectId={holder.id} />

          {/* Item 6b: two columns inside, each its own collapsed section. */}
          <RecentVotes
            holder={holder}
            reactionContext={reactionContext}
            columns
          />

          {/*
            **BC-11 (2026-08-24) — SPEAK YOUR MIND, above Sources, below
            Voting record.**

            The placement is the argument. A reader arrives at this card, reads
            what the person has actually DONE — their money, then their votes —
            and the invitation to say something lands at the moment they have
            just formed the opinion. Above the citations, because Sources is
            where a reader goes to check us rather than to speak.

            `subject` is the person's own name, so the framing asks what you
            would say if THEY were standing in front of you rather than "this
            person" — the words are the instrument and a placeholder in the
            middle of them would blunt it.
          */}
          <SpeakYourMind
            /*
              `key` on the person (RO04, 2026-08-25) — see the note in
              speak-your-mind.tsx. This card has no tab, so the holder is the
              key: moving from one official to another must never leave what
              a reader typed about the first sitting under the second's name.
            */
            key={holder.id}
            subjectType="OFFICIAL"
            subjectId={holder.id}
            subject={holder.name}
            context={reactionContext ?? undefined}
          />

      </Card>
    </div>
  );
}
