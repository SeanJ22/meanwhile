"use client";

import { useId, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * A five-cell comb field. One real input carries the value, focus and
 * assistive-tech semantics; the painted cells are hidden from screen readers.
 */

const CELLS = [0, 1, 2, 3, 4];

interface ZipCombProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  invalid?: boolean;
  /** Ties the field to its error message for assistive tech. */
  describedBy?: string;
  autoFocus?: boolean;
}

export function ZipComb({
  value,
  onChange,
  onSubmit,
  disabled,
  invalid,
  describedBy,
  autoFocus,
}: ZipCombProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const id = useId();

  const digits = value.split("");
  // The cell the caret sits in, clamped so a full field highlights its last.
  const caret = Math.min(value.length, CELLS.length - 1);

  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        ZIP code
      </label>

      <input
        ref={inputRef}
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="postal-code"
        maxLength={5}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 5))}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onSubmit();
          }
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        // The real input sits on top of the cells, transparent. Caret is drawn
        // by the active cell instead, so it lands in the right box.
        className="absolute inset-0 z-10 w-full cursor-text bg-transparent text-transparent caret-transparent outline-none selection:bg-transparent disabled:cursor-not-allowed"
      />

      <div
        aria-hidden="true"
        className={cn(
          "grid grid-cols-5 gap-2",
          disabled && "opacity-50",
        )}
      >
        {CELLS.map((index) => {
          const isActive = focused && index === caret && !disabled;
          const digit = digits[index];

          return (
            <div
              key={index}
              className={cn(
                "relative flex h-13 items-center justify-center rounded-md border transition-colors",
                "bg-bg font-mono t-display tabular-nums text-text",
                invalid
                  ? "border-danger"
                  : isActive
                    ? "border-local"
                    : digit
                      ? "border-panel-border"
                      : "border-panel-border/60",
              )}
            >
              {digit ?? ""}
              {isActive && !digit && (
                <span className="absolute h-6 w-px animate-pulse bg-local" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
