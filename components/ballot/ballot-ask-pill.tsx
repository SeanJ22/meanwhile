"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { BallotAsk } from "@/components/ask/ballot-ask";
import { useDismissOnOutside } from "@/hooks/use-dismiss-on-outside";
import type { AskSubjectRef } from "@/lib/ask/subject";

/**
 * **BAL-26 (2026-08-28) — ASK WAS THE LAST THING ON THE PAGE.**
 *
 * `<BallotAsk>` was mounted dead last in `app/ballot/page.tsx`: below every
 * contest card, below the shared source notes, below the measures, below the
 * scope notes, below the absence blocks and below the collection note. The
 * ballot page measures roughly 20,000px at 1280 and 25,000px at 390. A feature
 * at the bottom of that is a feature nobody finds, and the previous session's
 * own screenshot script had to call `scrollIntoViewIfNeeded()` before it could
 * even photograph the panel.
 *
 * **THE ENGINE WAS NEVER THE PROBLEM AND IS NOT TOUCHED.** `<BallotAsk>` posts
 * to `/api/ask/grounded` with `surface: "BALLOT"` — the same interpretation,
 * canonical resolution, retrieval, synthesis and validation the map's panel
 * uses. This file adds no second engine and holds no answering logic. It is
 * placement, and nothing else.
 *
 * ## What was borrowed from the map, and what deliberately was not
 *
 * The AFFORDANCE is the map's: a pill carrying `aria-expanded`, an expansion
 * that hangs under the row at the row's full width, focus landing in the input
 * one frame after it mounts, Escape and an outside press to dismiss.
 *
 * The COMPONENT is not, and could not be. `components/shell/pill-cluster.tsx`
 * imports `ZipSwitcher`, `CoverageSummary`, `SeatHolder` and `SearchItem`, and
 * mounts `AskBox`, which reads `useShellData()` and `useUi()` — providers that
 * exist only inside `map-entry.tsx`. Reusing it here would mean standing the
 * whole map shell up behind a page that has no map. `useDismissOnOutside` is
 * the one piece that is genuinely generic (no map coupling, pure React state,
 * no history entry) and it is imported rather than reimplemented.
 *
 * `takeForeground()` is NOT imported. That is MTG-11 machinery for a surface
 * with overlapping map floaters competing for the same z-space. This page has
 * a document flow and nothing to take the foreground from.
 *
 * ## Why the panel unmounts when it closes rather than hiding
 *
 * A closed pill renders no `[data-ballot-ask]` at all. That is the honest DOM:
 * the panel is not on the page. It also degrades correctly for the two
 * evidence scripts that read this surface — `scripts/walk-ask-0828.mts` guards
 * with `if (!input)` and `scripts/shoot-ballot-ask-0827.mts` guards with
 * `if (present !== 1)`, so both report the panel absent and continue. A panel
 * kept mounted behind `display: none` would satisfy a `count()` and then hang
 * a `fill()` for thirty seconds, which is a false instrument rather than an
 * honest one. Both scripts still need a pill click added to reach the input.
 *
 * ## G07 and why the label is local
 *
 * G07 forbids a bare "Ask" anywhere: the label teaches what can be asked
 * without the box being open. `lib/routing/ask-pill-labels.ts` holds the map's
 * three placements and `tests/pill-cluster.test.ts` asserts that the placement
 * set is exactly `map`, `sidebar`, `wgh` "and no others"; `AskPillPlacement`
 * in `lib/map/cluster-placement.ts` is documented as TOTAL over those three.
 * A fourth row would break both, so the ballot's label lives here, beside the
 * only thing that renders it, and `tests/ballot-ask-pill.test.ts` holds it to
 * the same G07 rule the shared file is held to.
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
   * `display: contents` (Tailwind's `contents`) so the pill and the expansion
   * are DIRECT children of `.ballot-top-pills`. The expansion needs
   * `flex: 1 0 100%` to take its own row under the pills, and a wrapper that
   * generated a box would swallow that. The element is still an ancestor in
   * the DOM tree, so `node.contains(target)` below reads exactly right.
   */
  const shell = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismissOnOutside(shell, close, open);

  /*
   * Escape closes. `components/ask/ballot-ask.tsx` handles Escape on the input
   * FIRST and stops the event where there is text to clear, so one press
   * clears a half-typed question and the next press closes the panel — the
   * nested behaviour a reader already expects from every other dismissable
   * thing on this product.
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
        // One frame, because the input is a child of the row the pill is in
        // rather than a surface that has to be opened first.
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
