"use client";

import { CardSourceContext, useCardSourceRegistry } from "@/components/ui/card-source-context";
import { CardGapContext, useCardGapRegistry } from "@/components/ui/card-gap-context";
import { CardFooter } from "@/components/ui/card-footer";
import { CardSubjectContext } from "@/components/ui/card-subject-context";
import type { CardGap } from "@/lib/design/card-gaps";
import type { CardSource } from "@/lib/officials/card-sources";
import { feedbackHref } from "@/lib/feedback/shape";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";

/**
 * The large detail card over a scrim. One view at a time; "← Back to …"
 * restores the previous view and its scroll position. Escape, ✕ and a scrim
 * click close it. Focus moves to Close on open and returns to the opener;
 * Tab is trapped; everything behind is `inert`. Views render with `embedded`.
 */
export function ReaderCard({
  viewKey,
  kicker,
  kickerTone,
  zipContext,
  zip,
  recordId,
  backLabel,
  onBack,
  onClose,
  restoreScroll,
  onScroll,
  fixed = false,
  children,
  sources = [],
  gaps = [],
  subject,
}: {
  /** Identity of the view on screen; a new key starts at the top. */
  viewKey: string;
  kicker: string;
  /** A tier colour for the kicker when it names a tier. */
  kickerTone?: string;
  /** The ZIP context line on list views. */
  zipContext?: string | null;
  zip?: string | null;
  recordId?: string | null;
  backLabel: string | null;
  onBack: () => void;
  onClose: () => void;
  /** Scroll position to restore for this view (Back). */
  restoreScroll?: number;
  /** Reports the body's scroll position so Back can restore it. */
  onScroll?: (top: number) => void;
  /** A route-level card (the Ballot) sits over the whole viewport. */
  fixed?: boolean;
  children: ReactNode;
  sources?: readonly CardSource[];
  gaps?: readonly CardGap[];
  subject?: CardGap["subject"];
}) {
  const { register, sources: allSources } = useCardSourceRegistry(sources, viewKey);
  const { register: registerGaps, gaps: allGaps } = useCardGapRegistry(gaps, viewKey);
  const cardRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Record the opener before the background goes inert (inert blurs focus inside it).
  useFocusReturn(closeRef);
  useBackgroundInert(cardRef);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const target = restoreScroll ?? 0;
    body.scrollTop = target;
    if (target === 0) return;
    // Late layout can clamp the restored position; re-apply for a few frames.
    let frames = 0;
    let handle = 0;
    const settle = () => {
      if (!bodyRef.current) return;
      bodyRef.current.scrollTop = target;
      frames += 1;
      if (Math.abs(bodyRef.current.scrollTop - target) > 1 && frames < 10) {
        handle = requestAnimationFrame(settle);
      }
    };
    handle = requestAnimationFrame(settle);
    return () => cancelAnimationFrame(handle);
  }, [viewKey, restoreScroll]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // A dialog opened from the card lives outside it and handles its own keys.
      const active = document.activeElement;
      const card = cardRef.current;
      if (card && active && active !== document.body && !card.contains(active)) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === "Tab") trapTab(event, cardRef.current);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <CardSubjectContext.Provider value={subject ?? null}><CardSourceContext.Provider value={register}><CardGapContext.Provider value={registerGaps}>
      <div className={fixed ? "mw-scrim mw-fixed" : "mw-scrim"} onClick={onClose} aria-hidden="true" />
      <section
        ref={cardRef}
        className={fixed ? "mw-card mw-fixed" : "mw-card"}
        role="dialog"
        aria-modal="true"
        aria-label={kicker}
        data-reader-card={viewKey}
      >
        <header className="mw-card-head">
          {backLabel && (
            <button type="button" className="mw-card-back" onClick={onBack}>
              <span aria-hidden="true">← </span>
              <span className="mw-card-back-label">Back to {backLabel}</span>
            </button>
          )}
          <div className="mw-card-kicker-wrap">
            <span
              className="mw-card-kicker"
              style={kickerTone ? { color: kickerTone } : undefined}
            >
              {kicker}
            </span>
            {zipContext && <span className="mw-card-zipctx">{zipContext}</span>}
          </div>
          <button
            ref={closeRef}
            type="button"
            className="mw-card-close"
            aria-label="Close"
            data-mw="card-close"
            onClick={onClose}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </header>
        <div
          key={viewKey}
          ref={bodyRef}
          className="mw-card-body"
          onScroll={(e) => onScroll?.(e.currentTarget.scrollTop)}
        >
          {children}
          <CardFooter gaps={allGaps} sources={allSources} />
        </div>
        {/* Feedback opens in a new tab so the view and any draft stay put. */}
        <footer className="mw-card-foot">
          <a
            className="mw-report-link"
            href={feedbackHref({ about: kicker, zip, recordId })}
            target="_blank"
            rel="noopener noreferrer"
          >
            Report a problem with this card
          </a>
        </footer>
      </section>
    </CardGapContext.Provider></CardSourceContext.Provider></CardSubjectContext.Provider>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), summary';

/** Keeps Tab and Shift+Tab inside `root`. */
export function trapTab(event: KeyboardEvent, root: HTMLElement | null): void {
  if (!root) return;
  const nodes = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
  if (nodes.length === 0) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  const active = document.activeElement as HTMLElement | null;
  if (!active || !root.contains(active)) {
    event.preventDefault();
    first.focus();
    return;
  }
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * Marks every sibling of the card's layer `inert` while the card is up, and
 * restores exactly what it changed. Siblings that were already inert stay so.
 */
function useBackgroundInert(cardRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const card = cardRef.current;
    const layer = card?.parentElement;
    if (!card || !layer) return;
    const changed: Element[] = [];
    for (const el of layer.children) {
      if (el === card || el.classList.contains("mw-scrim")) continue;
      if (el.hasAttribute("inert")) continue;
      el.setAttribute("inert", "");
      changed.push(el);
    }
    return () => {
      for (const el of changed) el.removeAttribute("inert");
    };
  }, [cardRef]);
}

/** Focus Close on open; hand focus back to the opener on close. */
function useFocusReturn(closeRef: RefObject<HTMLButtonElement | null>): void {
  const opener = useRef<Element | null>(null);
  const restore = useCallback(() => {
    const el = opener.current as HTMLElement | null;
    if (el && document.contains(el)) el.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    opener.current = document.activeElement;
    const frame = requestAnimationFrame(() =>
      closeRef.current?.focus({ preventScroll: true }),
    );
    return () => {
      cancelAnimationFrame(frame);
      // After the inert cleanup, so the opener can take focus.
      setTimeout(restore, 0);
    };
  }, [closeRef, restore]);
}
