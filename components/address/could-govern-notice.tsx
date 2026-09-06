"use client";

import { useState } from "react";

import { AddressPrompt } from "@/components/address/address-prompt";
import { COULD_GOVERN_ACTION, COULD_GOVERN_TEXT } from "@/lib/ballot/could-govern";

/**
 * **WGH-1 and WGH-2 — one pill for the whole panel, and it works.**
 * (2026-08-22, the author's 8/22 walkthrough, item 10.)
 *
 * ## What this replaces
 *
 * Every affected row in Who Governs Here carried the full sentence *"Could
 * govern — add your address to confirm."* At 12 bodies that was noise; after NJ
 * Hunt 6 the registry holds 174, and the same sentence repeated down a panel is
 * the product's most visible tic. The author named it the headline UX problem of
 * the New Jersey pass, not a cosmetic note: it makes the app look like it is
 * ballparking.
 *
 * So the rows carry an **asterisk** — `CouldGovernMark` — and the message is
 * said **once**, here, between the Local listing and the State listing.
 *
 * ## And it does something now
 *
 * The old pill was dead: clicking it did nothing at all. This opens the one
 * address prompt (WGH-5) — street only — and on a resolved answer every
 * jurisdiction on the page re-resolves and the hedges drop. On an ambiguous
 * street it escalates to a house number, naming which boundary is split and
 * which office that boundary decides.
 *
 * ## It is still an INVITATION, not a disclosure of our incompleteness
 *
 * Unchanged from the per-row pill and worth restating, because moving it is the
 * moment somebody would mistake it for a completeness marker: our data here is
 * complete — we hold Rockaway Borough's government and Rockaway Township's,
 * both in full. What is unsettled is which one is the reader's, and the reader
 * is the only party who can settle it. RULING 44 is untouched.
 */

/**
 * The per-row mark. An asterisk, and nothing else.
 *
 * The `*` on the ballot page is reserved for the incumbency footnote across
 * that whole page (RULING 28). This is the map panel, a different surface with
 * no such reservation, and the mark points at a notice sitting a few rows below
 * it rather than at a page footer.
 */
export function CouldGovernMark({ jurisdiction }: { jurisdiction?: string | null }) {
  return (
    <span
      className="could-govern-mark"
      data-could-govern="true"
      aria-label={
        jurisdiction
          ? `${jurisdiction}: ${COULD_GOVERN_TEXT} — ${COULD_GOVERN_ACTION}`
          : `${COULD_GOVERN_TEXT} — ${COULD_GOVERN_ACTION}`
      }
    >
      <span aria-hidden="true">*</span>
    </span>
  );
}

export function CouldGovernNotice({
  zip,
  count,
  onResolved,
  onCleared,
}: {
  zip: string;
  /** How many rows carry the mark. Stated, because a count with no rows is a claim. */
  count: number;
  onResolved?: (scope: { divisionIds: string[]; contestIds: string[] }) => void;
  onCleared?: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (count === 0) return null;

  return (
    <div className="could-govern-notice">
      {!open ? (
        <button
          type="button"
          className="could-govern-notice-pill"
          data-pearl
          onClick={() => setOpen(true)}
        >
          <span aria-hidden="true" className="could-govern-notice-mark">
            *
          </span>{" "}
          {COULD_GOVERN_TEXT} <span className="could-govern-action">— {COULD_GOVERN_ACTION}</span>
        </button>
      ) : (
        <AddressPrompt
          zip={zip}
          startOpen
          onResolved={(scope) => {
            onResolved?.(scope);
          }}
          onCleared={() => {
            setOpen(false);
            onCleared?.();
          }}
        />
      )}
    </div>
  );
}
