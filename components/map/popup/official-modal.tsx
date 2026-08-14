"use client";

import { X } from "lucide-react";
import { useEffect } from "react";

import { TIER_LABEL, type Tier } from "@/lib/ocd/tiers";
import type { SeatHolder } from "@/lib/officials/lookup";
import type { ReactionViewContext } from "@/lib/reactions/client";

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

  useEffect(() => {
    if (!window.matchMedia("(max-width: 1024px)").matches) return;
    window.history.pushState({ overlay: true }, "");
    const onPop = () => onClose();
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (window.history.state?.overlay) window.history.back();
    };
  }, [onClose]);

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
          <OfficialIdentity holder={holder} seatLabel={seatLabel} />
          <ReachThem holder={holder} />
          <RecentVotes holder={holder} reactionContext={reactionContext} />
          <OfficeBlurb holder={holder} />
        </div>
      </div>
    </div>
  );
}
