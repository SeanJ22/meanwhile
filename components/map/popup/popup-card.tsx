"use client";

import { Maximize2, X } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";

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
  /** Opens the full-screen modal. Omitted where there is nothing to expand to. */
  onExpand?: () => void;
  onClose?: () => void;
  /** Copied when the title is clicked. Omit to leave the title inert. */
  copyTitle?: string;
  children: ReactNode;
}

export function PopupCard({
  type,
  tier,
  title,
  badges = [],
  onExpand,
  onClose,
  copyTitle,
  children,
}: PopupCardProps) {
  return (
    <div className="popup-card pointer-events-auto" role="dialog" aria-label={title}>
      {onExpand && (
        <button
          type="button"
          className="popup-expand-btn"
          onClick={onExpand}
          aria-label={`Open ${title} in full view`}
        >
          <Maximize2 className="size-3.5" />
        </button>
      )}

      {!onExpand && onClose && (
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

      <h3>
        {copyTitle ? <Copyable text={copyTitle}>{title}</Copyable> : title}
      </h3>

      <div className="mt-2.5">{children}</div>
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

/**
 * Click to copy, with the tooltip affordance.
 *
 * The confirmation is visible rather than silent: a copy that may or may not
 * have worked is worse than a button that plainly did nothing, because the
 * reader only finds out when they paste.
 */
export function Copyable({
  text,
  children,
}: {
  text: string;
  children: ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    // `navigator.clipboard` is absent over plain HTTP and in some embedded
    // webviews. Say nothing rather than claim a copy that did not happen.
    if (!navigator.clipboard?.writeText) return;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  }, [text]);

  return (
    <span
      className="copyable"
      role="button"
      tabIndex={0}
      data-tooltip={copied ? "Copied" : "Click to copy"}
      data-copied={String(copied)}
      onClick={copy}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          copy();
        }
      }}
    >
      {children}
    </span>
  );
}

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
