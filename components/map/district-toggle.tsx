"use client";

import { BoundaryLegend } from "./boundary-legend";

/**
 * The district overlay switch.
 *
 * On for a new reader, after the stored preference resolves. The hook renders
 * `pending` on the server so a returning reader's choice does not flash.
 *
 * When the boundary file cannot be loaded the control disables itself and says
 * why. Leaving it switched on with nothing drawn would read as "this area has
 * no districts", which is never true.
 */

interface DistrictToggleProps {
  enabled: boolean;
  /** False until the stored preference has resolved on the client. */
  restored: boolean;
  failed: boolean;
  onChange: (next: boolean) => void;
}

export function DistrictToggle({
  enabled,
  restored,
  failed,
  onChange,
}: DistrictToggleProps) {
  const disabled = failed || !restored;

  return (
    <div className="panel pointer-events-auto px-3 py-2">
      <label
        className={`flex items-center gap-2.5 ${
          disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
        }`}
      >
        <input
          type="checkbox"
          className="size-3.5 accent-signal"
          checked={enabled && !failed}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="font-mono t-caption uppercase trailing-space-trimmed-20 tracking-[0.2em] text-paper-dim">
          Show districts
        </span>
      </label>

      <BoundaryLegend />

      {failed && (
        <p className="mt-1.5 max-w-[15rem] t-detail leading-relaxed text-muted">
          District boundaries didn&apos;t load. Run{" "}
          <code className="font-mono text-paper-dim">pnpm districts:fetch</code> to
          rebuild them.
        </p>
      )}
    </div>
  );
}
