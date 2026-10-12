"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * Candidate-filing provenance behind a small always-visible pointer that names
 * the source; the full record opens in place, verbatim, from a real `<button>`
 * with `aria-expanded`.
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
