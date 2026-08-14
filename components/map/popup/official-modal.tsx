"use client";

import { X } from "lucide-react";
import { useEffect } from "react";

import { TIER_LABEL, type Tier } from "@/lib/ocd/tiers";
import type { SeatHolder } from "@/lib/officials/lookup";
import type { ReactionViewContext } from "@/lib/reactions/client";

import { FundingBlock } from "@/components/funding/funding-block";

import {
  OfficeBlurb,
  OfficialIdentity,
  ReachThem,
  RecentVotes,
} from "./official-popup";

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

        <div className="account-modal-body">
          {/* 3h (2026-08-16): what-the-office-does moved to the TOP — the
              reader orients on the office before the record. */}
          <OfficialIdentity holder={holder} seatLabel={seatLabel} large />
          <OfficeBlurb holder={holder} />
          <ReachThem holder={holder} />
          {/* D34: campaign money — FUNDING tier, visually its own section,
              never blended with the votes below it. */}
          <FundingBlock holder={holder} reactionContext={reactionContext} />
          <RecentVotes holder={holder} reactionContext={reactionContext} />
        </div>
      </div>
    </div>
  );
}
