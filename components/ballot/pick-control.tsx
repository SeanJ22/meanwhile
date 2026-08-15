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
  prominent = false,
}: {
  contestId: string;
  contestTitle: string;
  voteFor: number;
  options: { id: string; label: string }[];
  /** 6a (2026-08-14 second session): on measure cards the ask renders
   *  with visual weight — same words, bigger presence. It whispered. */
  prominent?: boolean;
}) {
  const pick = useSyncExternalStore(
    subscribePicks,
    useCallback(() => JSON.stringify(getPick(contestId)), [contestId]),
    () => "null",
  );
  const parsed = JSON.parse(pick) as { choiceIds: string[] } | null;
  const selected = new Set(parsed?.choiceIds ?? []);

  return (
    <div className="mt-3 rounded-md border border-dashed border-[var(--panel-border)] p-3">
      {/* 3d (2026-08-19): the author's words. Same options, same
          device-local behavior — only the label changed. The standing
          prominence rule (design pass): the ask never whispers — the
          prominent variant keeps its signal color, the default carries
          the same weight in the text color. */}
      <p
        className={
          prominent
            ? "text-[0.875rem] font-semibold text-signal"
            : "text-[0.8125rem] font-semibold text-paper"
        }
      >
        What do you think?{voteFor > 1 ? ` (pick up to ${voteFor})` : ""}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
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
