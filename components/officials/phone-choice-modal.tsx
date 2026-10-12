"use client";

import { X } from "lucide-react";
import { useEffect } from "react";

import { telHref, type PhoneChoice } from "@/lib/officials/phone-numbers";

/**
 * Which number to call: the numbers listed, each labelled by the office it
 * rings (from recorded data, never an area code) and rendered as published.
 * `data-dismiss-exempt` keeps a press in here from closing the card behind it.
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
