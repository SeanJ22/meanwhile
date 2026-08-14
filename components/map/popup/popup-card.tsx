"use client";

import { Maximize2, X } from "lucide-react";
import { type ReactNode } from "react";

import type { Tier } from "@/lib/ocd/tiers";

/**
 * The port of EdiaStratMap's `.popup-card`, as React primitives.
 *
 * **Edia builds these as HTML strings** with `escapeHtml`/`escapeAttr` and
 * `onclick` attributes, because it is vanilla JS and has no other option. That
 * half is deliberately not ported: React escapes for us, and a real handler
 * cannot be broken by a body name containing a quote. What *is* ported exactly
 * is the visual grammar — the measurements live in `globals.css` under
 * `.popup-card`, since they are ported values rather than choices made here.
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
  /** Appended to the eyebrow — Edia's holdout-badge pattern, ours is status. */
  badges?: PopupBadge[];
  /** Opens the large tier. Omitted where there is nothing deeper. */
  onExpand?: () => void;
  /** What "More" opens, for the screen reader and the tooltip. */
  expandLabel?: string;
  onClose?: () => void;
  children: ReactNode;
}

/**
 * The compact glance card (3). Two affordances, both always visible when
 * available: a close X in the corner, and an obvious full-width "More"
 * footer that opens the large tier — a corner icon alone was an entry
 * point readers never found. The title is plain text: the reader gesture
 * on a card is expansion, never clipboard (4a).
 */
export function PopupCard({
  type,
  tier,
  title,
  badges = [],
  onExpand,
  expandLabel,
  onClose,
  children,
}: PopupCardProps) {
  return (
    <div className="popup-card pointer-events-auto" role="dialog" aria-label={title}>
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

      <h3>{title}</h3>

      <div className="mt-2.5">{children}</div>

      {onExpand && (
        <button
          type="button"
          onClick={onExpand}
          aria-label={expandLabel ?? `More about ${title}`}
          className="mt-3 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded border border-[var(--panel-border)] px-3 py-2 text-[0.75rem] font-medium text-paper hover:border-[var(--signal)] hover:text-signal"
        >
          More
          <Maximize2 className="size-3" />
        </button>
      )}
    </div>
  );
}

/** One key/value line. `mono` is Edia's `.pv.money` — digits and identifiers. */
export function PopupRow({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="popup-row">
      <span className="pk">{label}</span>
      <span className={mono ? "pv mono" : "pv"}>{children}</span>
    </div>
  );
}

export function PopupSectionLabel({ children }: { children: ReactNode }) {
  return <p className="popup-section-label">{children}</p>;
}

/*
 * `Copyable` (click-to-copy) is deliberately gone (4a): it was a developer
 * affordance that leaked to readers — the reader gesture on a card is
 * expansion, never clipboard.
 */

/**
 * A value the app does not have.
 *
 * Its own component so "we don't hold this" always renders the same way and is
 * never mistaken for a blank. Phase 5 keeps proving this matters: an empty
 * string reads as a bug, and worse, a plausible-looking placeholder reads as a
 * fact.
 */
export function NoValue({ children = "not recorded" }: { children?: ReactNode }) {
  return <span className="text-muted">{children}</span>;
}
