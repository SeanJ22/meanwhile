"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useCardVisibility } from "@/hooks/use-card-visibility";

import { TIER_LABEL, type Tier } from "@/lib/ocd/tiers";
import type { SeatHolder } from "@/lib/officials/lookup";
import type { ReactionViewContext } from "@/lib/reactions/client";

import {
  personCardSources,
  prlCardSource,
  sourceCountLabel,
} from "@/lib/officials/card-sources";

import { FundingBlock } from "@/components/funding/funding-block";
import type { PrlReaderProfile } from "@/lib/sources/prl/snapshot";
import { PublicStatementsProfile } from "@/components/officials/public-statements-profile";
import { OfficialActions } from "@/components/officials/official-actions";
import {
  CardSection,
  CardSectionGroup,
} from "@/components/officials/card-section";
import { CardSourcesList } from "@/components/officials/card-sources-list";
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
      <div className={embedded ? "account-modal mw-entity mw-person" : "account-modal"}>
        {/*
          Item 3 (2026-08-16): the header carries the TIER EYEBROW and the
          close control, and nothing else.

          It used to repeat the name as an h2 and the seat as a subtitle,
          four pixels above an identity block that says both again at the
          size it was designed at. Three renderings of "Mayor" and
          two of the person's name on one card is friction with no exception
          claiming it — the reader is trying to find out who this is, and
          saying it twice does not help them do that faster. The identity
          block's name is the card's heading now.
        */}
        <header className="account-modal-header">
          <div className="min-w-0">
            <p
              className="popup-type"
              style={{ color: `var(--accent-${tier})` }}
            >
              {TIER_LABEL[tier]}
            </p>
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

        {/*
          Item 6b4 (2026-08-15) — the card's information order is a design
          decision, and this is it. Recorded in DESIGN.md beside the tokens.

          IDENTITY IS OPEN. Name, photo, office, party, in-seat-until: what a
          stranger sees in the first screen-height before any tap is the
          card's argument, and the argument is "here is who this is".

          EVERYTHING ELSE IS A COLLAPSED HEADER, in this order:

            1. What this office does — the stranger test. A reader who does
               not know what a ward council member IS cannot use a phone
               number or a donor list. It sits directly under identity for
               that reason, ahead of the other three.
            2. How to reach them   ┐
            3. Campaign money      ├ the stated order:
            4. Their votes         ┘ identity → contact → funding → votes.

          THE SECTION SET IS IDENTICAL PER OFFICE CLASS. A thin challenger
          renders the same headers as a thirty-year incumbent, with honest
          content behind each — collapse is organization, never a way to
          render some people smaller than others. The one exception is
          structural rather than editorial: a person with no roll-call store
          at all (a mayor, a selectboard member) has no votes section, because
          there is no such thing as their voting record to be missing.
        */}
        {/* F01 4.1 (2026-08-19): every top-level pill on this card belongs to
            ONE group, so opening any collapses the rest. The wrap is here, at
            the card, because the pills are constructed by five different
            components and only their common ancestor can hold the state. */}
        <CardSectionGroup independent={embedded}>
        <div className="account-modal-body">
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

          {/*
            Item 1 (2026-08-16): the person battlecard's answer to "says
            who?".

            The division battlecard has a Sources TAB and this card has no tab
            bar, so the same obligation lands in this card's own grammar — a
            6b4 collapsible section, fed by the same assembler, with the
            stated N in the header meta. A card class that answers the
            question differently is fine; a card class that cannot answer it
            at all was the defect.

            Money and votes are deliberately absent from the list: those
            sections cite themselves on the row, and the same claim in two
            registers reads as two claims.
          */}
          <CardSection title="Sources" meta={sourceCountLabel(sources)}>
            {sources.length === 0 ? (
              <p className="text-[0.75rem] leading-relaxed text-muted">
                We’re working on getting this info.
              </p>
            ) : (
              <CardSourcesList sources={sources} />
            )}
          </CardSection>
        </div>
        </CardSectionGroup>
      </div>
    </div>
  );
}
