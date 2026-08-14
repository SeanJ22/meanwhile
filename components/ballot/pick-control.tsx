"use client";

import { useSyncExternalStore, useCallback } from "react";

import {
  clearPick,
  getPick,
  subscribePicks,
  togglePick,
} from "@/lib/ballot/picks";

/**
 * The per-contest pick control (4a). One row per contest, listing every
 * choice as a toggle — visually and textually DISTINCT from the reaction
 * buttons above it: reactions join anonymous local totals (and say so at
 * capture); picks are the reader's private note and never leave the device.
 * The distinction is stated in the control itself, every time.
 */

export function PickControl({
  contestId,
  contestTitle,
  voteFor,
  options,
}: {
  contestId: string;
  contestTitle: string;
  voteFor: number;
  options: { id: string; label: string }[];
}) {
  const pick = useSyncExternalStore(
    subscribePicks,
    useCallback(() => JSON.stringify(getPick(contestId)), [contestId]),
    () => "null",
  );
  const parsed = JSON.parse(pick) as { choiceIds: string[] } | null;
  const selected = new Set(parsed?.choiceIds ?? []);

  return (
    <div className="mt-3 rounded border border-dashed border-[var(--panel-border)] p-2.5">
      {/* 3d (2026-08-19): the author's words. Same options, same
          device-local behavior — only the label changed. */}
      <p className="font-mono text-[0.5625rem] uppercase tracking-[0.15em] text-muted">
        What do you think?{voteFor > 1 ? ` (pick up to ${voteFor})` : ""}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {options.map((option) => {
          const on = selected.has(option.id);
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={on}
              onClick={() =>
                togglePick(contestId, contestTitle, option.id, option.label, voteFor)
              }
              className={`min-h-8 cursor-pointer rounded border px-2 text-[0.75rem] transition-colors ${
                on
                  ? "border-[var(--paper,#e8e8ec)] bg-[var(--paper,#e8e8ec)]/10 font-semibold"
                  : "border-[var(--panel-border)] text-paper-dim hover:text-paper"
              }`}
            >
              {on ? "✓ " : ""}
              {option.label}
            </button>
          );
        })}
        {selected.size > 0 && (
          <button
            type="button"
            onClick={() => clearPick(contestId)}
            className="min-h-8 cursor-pointer px-1.5 text-[0.6875rem] text-muted underline decoration-dotted"
          >
            clear
          </button>
        )}
      </div>
      {/* 3e (2026-08-19): the disclosure moved to ONE statement at the
          bottom of the ballot page (the TOS pattern) — repeating it under
          every contest was reader friction, not consent (picks are never
          collected, so no consent is at stake). tests/ballot-picks.test.ts
          pins the single statement. */}
    </div>
  );
}
