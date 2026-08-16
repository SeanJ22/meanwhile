"use client";

import { useId, useState } from "react";

/**
 * A collapsible section of a person's battlecard — item 6b4, 2026-08-15.
 *
 * ## What this is for
 *
 * The author: every major block on a person card collapses, "so the card
 * never reads as infinite scroll". Identity stays open; contact, campaign
 * money, contributions, recent votes, when-it-mattered and everything else
 * collapses to a header.
 *
 * ## The header's bar, and why it is a pill
 *
 * The author's bar was "the header must make me want to open it", with the
 * shape left to the design and pill/bubble as his instinct. A pill is what
 * this system already uses for every OTHER tappable thing that is not a link
 * — the funding type pills, the narrowing chip, the map floaters — so a pill
 * here is not a new pattern, it is the existing one applied. Nothing that
 * hits the bar harder turned up inside the committed tokens, and inventing a
 * second affordance language to beat it would cost more than it won.
 *
 * **It draws its strength from item 5, not from adding another loud thing.**
 * The palette pass took the interactive accent off structural labels, seat
 * titles and counters; what is left wearing it is small and deliberate, so a
 * pill in the link accent now pops by CONTRAST. Before that pass this header
 * would have been the seventh gold thing on the card and would have
 * disappeared into the others — which is exactly why 5 and 6b4 were designed
 * together and share one token family.
 *
 * ## The equal-effort rule, enforced at the component
 *
 * A section renders its header whether or not it has anything behind it: the
 * SET of sections is identical for every person of an office class, and the
 * honest empty content lives inside. Hiding a section for a thin challenger
 * and showing it for the incumbent would make the incumbent's card taller and
 * more substantial — a layout thumb on the scale, which is precisely the
 * information asymmetry the equal-effort rule exists to catch. Collapse is
 * organization. It is never a way to render some people smaller than others.
 */
export function CardSection({
  title,
  /** Rendered beside the title — a count, a date range. Never a judgement. */
  meta,
  defaultOpen = false,
  children,
}: {
  title: string;
  meta?: string | null;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();

  return (
    <section className="card-section" data-open={open || undefined}>
      <button
        type="button"
        className="card-section-header"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="card-section-title">{title}</span>
        {meta && <span className="card-section-meta">{meta}</span>}
        <svg
          className="card-section-chevron"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div id={id} className="card-section-body">
          {children}
        </div>
      )}
    </section>
  );
}
