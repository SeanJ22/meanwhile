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
    /*
     * Item 5 (2026-08-16), the author's pass: "no prompt renders quieter
     * because its subject is a measure instead of a person." The person
     * prompt is 6c's framed `.reaction-box`; this was a dashed box with
     * smaller type, and a proposition asking a reader what they think was
     * visibly the lesser question on the page.
     *
     * It takes the SAME frame and the same prompt weight now.
     *
     * **What deliberately does NOT change: this is a PICK, not a reaction.**
     * Picks are the reader's private note and never leave the device;
     * reactions join anonymous local totals and say so at capture. The
     * DASHED border is what carries that distinction, and it stays — the two
     * asks are equally loud and still visibly different kinds of thing.
     * Matching the weight is a styling decision; merging them would be a
     * collection decision, and that is the author's to make.
     */
    <div className="reaction-box" data-frame="standing" data-kind="pick">
      {/* 3d (2026-08-19): the author's words. Same options, same
          device-local behavior — only the label changed. */}
      <p className={prominent ? "reaction-box-prompt text-link" : "reaction-box-prompt"}>
        What do you think?{voteFor > 1 ? ` (pick up to ${voteFor})` : ""}
      </p>
      <div className="reaction-box-choices">
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
              className={`reaction-choice ${
                on
                  ? "border-[var(--text)] bg-[var(--text)]/10 font-semibold"
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
