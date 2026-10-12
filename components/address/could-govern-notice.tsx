"use client";

import { useState } from "react";

import { AddressPrompt } from "@/components/address/address-prompt";
import { COULD_GOVERN_ACTION, COULD_GOVERN_TEXT } from "@/lib/ballot/could-govern";

/**
 * The per-row mark: an asterisk pointing at the `CouldGovernNotice` below,
 * which says the message once and opens the address prompt.
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
