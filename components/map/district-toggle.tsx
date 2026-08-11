"use client";

/**
 * The district overlay switch.
 *
 * Off by default, and it stays off until the stored preference resolves — the
 * hook renders `pending` on the server so a returning reader never sees the
 * control flip during hydration.
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
        <span className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-paper-dim">
          Show districts
        </span>
      </label>

      {failed && (
        <p className="mt-1.5 max-w-[15rem] text-[0.75rem] leading-relaxed text-muted">
          District boundaries didn&apos;t load. Run{" "}
          <code className="font-mono text-paper-dim">pnpm districts:fetch</code> to
          rebuild them.
        </p>
      )}
    </div>
  );
}
