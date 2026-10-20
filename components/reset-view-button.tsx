"use client";

import { RotateCcw } from "lucide-react";

/** Back to the default view: filters, tiers and the map camera. The ZIP stays. */
export function ResetViewButton({
  onReset,
  className = "",
}: {
  onReset: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`mw-ctl-btn mw-reset-btn ${className}`}
      onClick={onReset}
      title="Reset view"
      aria-label="Reset view"
    >
      <RotateCcw className="mw-reset-glyph" strokeWidth={1.5} aria-hidden="true" />
    </button>
  );
}
