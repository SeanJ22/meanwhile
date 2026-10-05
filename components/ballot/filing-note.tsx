"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * G05 RULE 4h — CANDIDATE-FILING PROVENANCE, BEHIND AN ANNOTATION.
 *
 * *"Candidate-filing provenance moves behind an annotation — a short
 * always-visible pointer attached to the candidate list (footnote marker,
 * info icon or small-type source note) with the full text one tap away,
 * verbatim and complete, opening IN THE APP, reachable by keyboard and at
 * 390px."*
 *
 * ## What is and is not being hidden
 *
 * Nothing is de-sourced. The provenance is the same text, the same link and
 * the same read date it has always been — it just stops occupying two lines
 * above every candidate list on a page that carries a dozen of them. What
 * stays ALWAYS VISIBLE is the pointer: small type, attached to the list it
 * belongs to, naming the source organisation so a reader can tell at a glance
 * whether this contest came from a filing list or a certified canvass. The
 * full record is one tap away and it is verbatim and complete.
 *
 * That distinction is the whole rule. "Where this came from" collapsed to an
 * unlabelled icon would be de-sourcing wearing a tidy face; the org name in
 * the pointer is what keeps the summary honest on its own.
 *
 * ## Why a button and not a link, and not `<details>`
 *
 * *"opening IN THE APP, reachable by keyboard and at 390px."*
 *
 * A link would leave. `<details>` would work and be keyboard-reachable, but
 * its open state is invisible to the rest of the page and its marker styling
 * is inconsistent across engines at small sizes. A real `<button>` with
 * `aria-expanded` says what it is to a screen reader, takes focus in DOM
 * order, responds to Enter and Space for free, and renders identically at
 * 390px and at desktop. The panel is a sibling, full width, so nothing
 * overflows a phone.
 *
 * Reader friction is a defect, and this component spends exactly one tap. It
 * buys back a dozen repeated provenance lines on a scrolling ballot page,
 * which is the trade the rule is making.
 */
export function FilingNote({
  /** The always-visible pointer. Small type, and it NAMES the source. */
  summary: summaryText,
  /** The full record, verbatim and complete. Rendered on tap, in place. */
  children,
  /** A footnote marker, when this contest shares its source with others. */
  marker,
}: {
  summary: string;
  children: ReactNode;
  marker?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div className="mt-1" data-filing-note>
      <button
        type="button"
        data-filing-note-toggle
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex max-w-full cursor-pointer items-center gap-1 rounded text-left t-caption leading-snug text-muted underline decoration-dotted underline-offset-2 hover:text-link focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--signal)]"
      >
        {marker && (
          <span aria-hidden="true" className="font-mono text-signal">
            {marker}
          </span>
        )}
        <span className="min-w-0">{summaryText}</span>
        <svg
          width="9"
          height="9"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          aria-hidden="true"
          className="zip-chevron shrink-0"
          data-open={open || undefined}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div
          id={panelId}
          data-filing-note-panel
          className="mt-1 rounded border border-[var(--panel-border)] bg-[var(--bg)] px-2.5 py-2 t-caption leading-relaxed text-muted"
        >
          {children}
        </div>
      )}
    </div>
  );
}
