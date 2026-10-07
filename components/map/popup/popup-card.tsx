"use client";

import { Maximize2, Minus, X } from "lucide-react";
import { useRef, type ReactNode } from "react";

import { useCardVisibility } from "@/hooks/use-card-visibility";

import { useDismissOnOutside } from "@/hooks/use-dismiss-on-outside";
import type { Tier } from "@/lib/ocd/tiers";
import { LevelTag } from "@/components/ui/level-tag";
import lumenStyles from "./lumen-popup.module.css";

/**
 * Popup card primitives. Measurements live in `globals.css` under
 * `.popup-card`; the scoped surface treatment is `lumen-popup.module.css`.
 */

const TIER_VAR: Record<Tier, string> = {
  local: "var(--accent-local)",
  state: "var(--accent-state)",
  national: "var(--accent-national)",
};

export interface PopupBadge {
  label: string;
  /** Drives the badge colour. `CANCELED` and `CONCLUDED` are styled. */
  status?: string;
}

interface PopupCardProps {
  /** The eyebrow. Tier-coloured, 9px uppercase. */
  type: string;
  tier: Tier;
  title: string;
  /** Status badges appended to the eyebrow. */
  badges?: PopupBadge[];
  /** Opens the large tier. Omitted where there is nothing deeper. */
  onExpand?: () => void;
  /** What "More" opens, for the screen reader and the tooltip. */
  expandLabel?: string;
  onClose?: () => void;
  /** Keeps a selected boundary while returning its details to a pill. */
  onMinimize?: () => void;
  /** The body renders the title itself; the heading stays the accessible name via `aria-label`. */
  titleInBody?: boolean;
  /** The level word after the title, opt-in. */
  levelTier?: Tier | null;
  children: ReactNode;
}

/**
 * The compact glance card: a close X and a full-width "More" footer that opens
 * the large tier. A press outside dismisses it.
 */
export function PopupCard({
  type,
  tier,
  title,
  badges = [],
  onExpand,
  expandLabel,
  onClose,
  onMinimize,
  titleInBody = false,
  levelTier,
  children,
}: PopupCardProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  useCardVisibility(rootRef, `POPUP:${type}:${title}`, "POPUP");
  useDismissOnOutside(rootRef, onMinimize ?? onClose ?? (() => {}), Boolean(onMinimize ?? onClose));

  return (
    <div
      ref={rootRef}
      className={`popup-card pointer-events-auto ${lumenStyles.card}`}
      /* The tier ring colour comes from lumen-popup.module.css by data-tier. */
      data-tier={tier}
      role="dialog"
      aria-label={title}
    >
      {onMinimize && (
        <button type="button" className="popup-expand-btn popup-minimize-btn"
          onClick={onMinimize} aria-label="Minimize district details">
          <Minus className="size-3.5" />
        </button>
      )}
      {onClose && (
        <button
          type="button"
          className="popup-expand-btn"
          onClick={onClose}
          aria-label="Close"
        >
          <X className="size-3.5" />
        </button>
      )}

      {/* Fixed head, scrolling content, and More pinned at the foot. */}
      <div className="popup-card-head">
        <p className="popup-type" style={{ color: TIER_VAR[tier] }}>
          {type}
          {badges.map((badge) => (
            <span
              key={badge.label}
              className="popup-badge"
              data-status={badge.status}
            >
              {badge.label}
            </span>
          ))}
        </p>
        {!titleInBody && (
          <h3>
            {title}
            {levelTier !== undefined && <LevelTag tier={levelTier} />}
          </h3>
        )}
      </div>

      <div className={`popup-card-body${titleInBody ? "" : " mt-2.5"}`}>
        {children}
      </div>

      {onExpand && (
        <button
          type="button"
          onClick={onExpand}
          aria-label={expandLabel ?? `More about ${title}`}
          className="popup-card-more mt-3 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded border border-[var(--panel-border)] px-3 py-2 t-detail font-medium text-paper hover:border-[var(--signal)] hover:text-signal"
        >
          More
          <Maximize2 className="size-3" />
        </button>
      )}
    </div>
  );
}

export { PopupRow, NoValue } from "./popup-row";

export function PopupSectionLabel({ children }: { children: ReactNode }) {
  return <p className="popup-section-label">{children}</p>;
}
