"use client";

import { X } from "lucide-react";
import { useEffect } from "react";

import { TIER_LABEL, type Tier } from "@/lib/ocd/tiers";
import type { SeatHolder } from "@/lib/officials/lookup";
import type { ReactionViewContext } from "@/lib/reactions/client";

import {
  personCardSources,
  sourceCountLabel,
} from "@/lib/officials/card-sources";

import { FundingBlock } from "@/components/funding/funding-block";
import { CardSection } from "@/components/officials/card-section";
import { CardSourcesList } from "@/components/officials/card-sources-list";

import { identityChipsFor } from "@/lib/officials/identity-chips";
import { ContactPills } from "@/components/officials/contact-pills";
import { MemberDirectory } from "@/components/officials/member-directory";
import { PersonIdentity } from "@/components/officials/person-identity";

import { OfficeBlurb, ReachThem, RecentVotes } from "./official-popup";

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
}

export function OfficialModal({
  holder,
  seatLabel,
  tier,
  reactionContext,
  onClose,
}: OfficialModalProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sources = personCardSources(holder);

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
      className="account-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={holder.name}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="account-modal">
        <header className="account-modal-header">
          <div className="min-w-0">
            <p
              className="popup-type"
              style={{ color: `var(--accent-${tier})` }}
            >
              {TIER_LABEL[tier]} · {holder.officeTitle}
            </p>
            <h2 className="account-modal-title">{holder.name}</h2>
            {seatLabel && (
              <p className="account-modal-subtitle">{seatLabel}</p>
            )}
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
               that reason, ahead of the author's four.
            2. How to reach them   ┐
            3. Campaign money      ├ the author's stated order:
            4. Their votes         ┘ identity → contact → funding → votes.

          THE SECTION SET IS IDENTICAL PER OFFICE CLASS. A thin challenger
          renders the same headers as a thirty-year incumbent, with honest
          content behind each — collapse is organization, never a way to
          render some people smaller than others. The one exception is
          structural rather than editorial: a person with no roll-call store
          at all (a mayor, a selectboard member) has no votes section, because
          there is no such thing as their voting record to be missing.
        */}
        <div className="account-modal-body">
          {/*
            Item 3 (2026-08-16), the author's ruling. Circle portrait with a
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

          <CardSection title="What this office does">
            <OfficeBlurb holder={holder} bare />
          </CardSection>

          {/* The section stays — collapse is organization, and the set of
              sections is identical per office class. It now holds the office
              addresses rather than repeating the pill row above it. */}
          <CardSection title="How to reach them">
            <ReachThem holder={holder} bare />
          </CardSection>

          {/* Item 7: the member's LOCAL offices — the door near the reader —
              and their committee seats. Federal members only; the source's
              scope is the section's scope, and the section is identical for
              all 537. */}
          <MemberDirectory holder={holder} />

          {/* D34: campaign money — FUNDING tier, its own section, never
              blended with the votes. */}
          <CardSection title="Campaign money">
            <FundingBlock holder={holder} reactionContext={reactionContext} bare />
          </CardSection>

          {/* Item 6b: two columns inside, each its own collapsed section. */}
          <RecentVotes
            holder={holder}
            reactionContext={reactionContext}
            columns
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
                Nothing on this card came from an external record.
              </p>
            ) : (
              <CardSourcesList sources={sources} />
            )}
          </CardSection>
        </div>
      </div>
    </div>
  );
}
