"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { BallotAsk } from "@/components/ask/ballot-ask";
import { useDismissOnOutside } from "@/hooks/use-dismiss-on-outside";
import type { AskSubjectRef } from "@/lib/ask/subject";

/**
 * The ballot page's Ask pill. Placement only: `<BallotAsk>` holds the engine.
 * The panel unmounts when closed rather than hiding. The label lives here
 * because the shared pill-label placements are exactly the map's three.
 */

/** What the pill says. Never a bare verb — it names a concrete question. */
export const BALLOT_ASK_PILL_LABEL = "Ask: what does this office do?";

/** The accessible name, which may be longer than the visible label. */
export const BALLOT_ASK_PILL_ARIA =
  "Ask about this ballot — what an office does, who is running, what a proposition would do";

export function BallotAskPill({
  zip,
  ocdIds,
  activeSubjects,
}: {
  zip: string | null;
  ocdIds: string[];
  activeSubjects: AskSubjectRef[];
}) {
  const [open, setOpen] = useState(false);
  /*
   * `display: contents` keeps the pill and expansion direct children of
   * `.ballot-top-pills`, so the expansion's `flex: 1 0 100%` takes its own row.
   */
  const shell = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismissOnOutside(shell, close, open);

  /*
   * `BallotAsk` handles Escape on the input first and stops it where there is
   * text to clear, so the next press closes the panel.
   */
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      document
        .querySelector<HTMLButtonElement>("[data-ballot-ask-pill]")
        ?.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const toggle = useCallback(() => {
    setOpen((was) => {
      const next = !was;
      if (next) {
        requestAnimationFrame(() => {
          document
            .querySelector<HTMLInputElement>("[data-ballot-ask] [data-ask-input]")
            ?.focus({ preventScroll: true });
        });
      }
      return next;
    });
  }, []);

  return (
    <div ref={shell} className="contents">
      <button
        type="button"
        data-ballot-ask-pill
        aria-expanded={open}
        aria-controls="ballot-ask-panel"
        aria-label={BALLOT_ASK_PILL_ARIA}
        onClick={toggle}
        className="ballot-top-pill ballot-ask-pill"
      >
        <span aria-hidden="true" className="ballot-ask-caret">
          ›
        </span>
        {BALLOT_ASK_PILL_LABEL}
      </button>
      {open && (
        <div id="ballot-ask-panel" className="ballot-ask-expansion">
          <BallotAsk zip={zip} ocdIds={ocdIds} activeSubjects={activeSubjects} />
        </div>
      )}
    </div>
  );
}
