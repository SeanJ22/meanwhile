"use client";

import { X } from "lucide-react";
import { useEffect } from "react";

import { telHref, type PhoneChoice } from "@/lib/officials/phone-numbers";

/**
 * **Which number to call** — R39, 2026-08-17, the author's production feedback.
 *
 * ## The defect this replaces
 *
 * Jeanne Shaheen's card rendered SEVEN stacked phone pills, one per office,
 * each carrying its office label and its full number. That is the example, not
 * the instance: 531 of the 1,157 officeholders in the registry carry more than
 * one recorded number, and every one of them rendered the same wall. A column
 * of numbers is not a contact row, it is a directory that shouldered its way
 * onto a card whose job is "how do I reach this person" — and the reader who
 * wanted to press ONE thing had to read seven before pressing anything.
 *
 * ## What it is
 *
 * One pill, labelled `Phone`. Pressing it opens this: the numbers listed
 * vertically, each labelled by the office it rings, each a `tel:` link that
 * dials in the device's own phone app. Exactly one number never reaches here —
 * the pill is the `tel:` link itself, because a modal over a single row is
 * friction with nothing to choose.
 *
 * ## Three rules that are not styling
 *
 * - **Every label comes from the recorded data.** The city on a district
 *   office row is the city `congress-legislators` publishes for that office;
 *   the Washington label is what the member's own term record IS. Nothing is
 *   inferred from an area code — a guessed office label is a generated claim
 *   about a public official, and it is generated in the exact register that
 *   reads as researched.
 * - **The number renders as published.** No reformatting. A number we retyped
 *   is a number we typed, not one they published.
 * - **Dismissal returns the card untouched.** `data-dismiss-exempt` is read by
 *   `useDismissOnOutside` (M90): a press anywhere in here — the backdrop
 *   included — is not an outside press on the battlecard behind it. Escape,
 *   the ×, and the backdrop all close this and nothing else. No history entry
 *   is pushed, per M52.
 */

export function PhoneChoiceModal({
  name,
  choices,
  onClose,
}: {
  /** Whose numbers these are, so the dialog says what it is about. */
  name: string;
  choices: PhoneChoice[];
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="phone-modal-overlay"
      data-dismiss-exempt
      role="dialog"
      aria-modal="true"
      aria-label={`Phone numbers for ${name}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="phone-modal">
        <header className="phone-modal-header">
          <div className="min-w-0">
            {/* Interaction register: this is an ask, and the ask is which
                line. The rows below are claim surface and stay level. */}
            <h2 className="phone-modal-title">Which line?</h2>
            <p className="phone-modal-subtitle">{name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="popup-expand-btn !static shrink-0"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="phone-modal-body">
          {choices.map((choice) => (
            <a
              key={`${choice.label}-${choice.phone}`}
              href={telHref(choice.phone)}
              className="phone-modal-row"
              onClick={onClose}
            >
              <span className="phone-modal-row-label">{choice.label}</span>
              <span className="phone-modal-row-number">{choice.phone}</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
