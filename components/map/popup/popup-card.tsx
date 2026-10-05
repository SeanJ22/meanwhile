"use client";

import { WorkingOnIt } from "@/components/demand/working-on-it";
import { Maximize2, Minus, X } from "lucide-react";
import { useRef, type ReactNode } from "react";

import { useCardVisibility } from "@/hooks/use-card-visibility";

import { useDismissOnOutside } from "@/hooks/use-dismiss-on-outside";
import type { Tier } from "@/lib/ocd/tiers";
import { LevelTag } from "@/components/ui/level-tag";
import lumenStyles from "./lumen-popup.module.css";

/**
 * The port of EdiaStratMap's `.popup-card`, as React primitives.
 *
 * **Edia builds these as HTML strings** with `escapeHtml`/`escapeAttr` and
 * `onclick` attributes, because it is vanilla JS and has no other option. That
 * half is deliberately not ported: React escapes for us, and a real handler
 * cannot be broken by a body name containing a quote. What *is* ported exactly
 * is the visual grammar — the measurements live in `globals.css` under
 * `.popup-card`. DSN-2 adds the workbook's scoped surface treatment through
 * `lumen-popup.module.css`; the fixed head, scrolling body and More stay.
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
  /** Keeps a selected boundary while returning its details to a pill. */
  onMinimize?: () => void;
  /**
   * The body renders the title itself (item 2, 2026-08-16) — the person
   * card's identity block leads with the name as its dominant type, and the
   * card heading above it was the same fact a second time, four pixels away.
   * The heading is still the accessible name via `aria-label`.
   */
  titleInBody?: boolean;
  /**
   * MTG-15 (2026-09-02): the level word after the title, opt-in.
   *
   * The eyebrow above already wears the tier's COLOUR on the jurisdiction
   * string, but not the WORD — so a reader learns "Tucson, AZ" is local from
   * the ink, never in as many words. The meeting card asks for the word by
   * passing its tier; the official and district compact cards leave it unset
   * and are unchanged, so this closes the meeting class without restyling the
   * other two.
   */
  levelTier?: Tier | null;
  children: ReactNode;
}

/**
 * The compact glance card (3). Two affordances, both always visible when
 * available: a close X in the corner, and an obvious full-width "More"
 * footer that opens the large tier — a corner icon alone was an entry
 * point readers never found. The title is plain text: the reader gesture
 * on a card is expansion, never clipboard (4a).
 *
 * **A press outside dismisses it** (item 1, 2026-08-15, the author: "that's
 * natural mobile behavior"). One hook here rather than three in the callers,
 * because all three compact cards — official, district, meeting — are this
 * component, and a dismissal gesture that worked on two of the three would be
 * worse than none. The corner X stays: the gesture is an addition, and a way
 * out nobody discovers is not a way out.
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
      /* The tier ring (design handoff 2026-09-13): the card wears its real
         level-of-government colour. Styled in lumen-popup.module.css by
         data-tier; the colour is never set here at the call site. */
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

      {/*
        F01 1.3 (2026-08-19, the author): *"On the small battlecard I have to
        scroll to expand for More. What I would like is to have More locked at
        the bottom — and if there is more to scroll, maybe Sadie Shaw doesn't
        show up on the first shot, I want to scroll into the data. But if I
        want to just simply click More, that should never be hidden."*

        Everything used to scroll together inside a `max-height: 55vh` card, so
        a district with five board members pushed the one control that opens
        the FULL card off the bottom. The path to the large battlecard was
        behind a scroll — a hidden entry point, which the friction rule counts
        as a defect with the same standing as a wrong number.

        Three bands now, in one flex column: the type and title are fixed
        furniture, the content scrolls, and More is pinned. Rows falling below
        the fold is expected and fine, which is exactly what the author said.
      */}
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
export function NoValue(_props: { children?: ReactNode }) {
  return <WorkingOnIt inline />;
}
