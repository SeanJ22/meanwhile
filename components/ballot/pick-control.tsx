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
      {/*
        g3 item 7 (2026-08-16), the author's reframe — SUPERSEDES 3d's "What
        do you think?" (2026-08-19), which was this same label.

        The old wording is why the author read this control as a duplicate of
        the per-candidate sensor sitting a few lines above it. Both boxes
        asked "what do you think?"; one of them was a private ballot-builder
        and the other was a question whose answer is sold in an anonymous
        aggregate, and nothing on the page said which was which. Two
        differently-consequential asks wearing one sentence is a consent
        problem wearing a copy problem's clothes.

        "Your pick for this race" names the ACTION, not a feeling — this is
        the control that writes the running ballot below. The sensor keeps
        asking what the reader thinks, because that is what it is for.
      */}
      <p className={prominent ? "reaction-box-prompt text-link" : "reaction-box-prompt"}>
        Your pick for this race{voteFor > 1 ? ` (pick up to ${voteFor})` : ""}
      </p>
      {/* Playful register, on an interaction surface — and load-bearing: it
          is the one line that tells the reader this box goes nowhere. */}
      <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-muted">
        Building your own ballot. Stays on this phone.
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
              /*
               * g4 item 7: a MEASURE's Yes/No wears the vote grammar — green
               * fill for yes, red for no — while a CANDIDATE pick keeps the
               * neutral selected treatment.
               *
               * The distinction is not decorative. Green-for-yes and
               * red-for-no is a statement about a POSITION, and colouring a
               * candidate by it would be the product taking a view of a
               * person. A measure's Yes and No are the two sides of one
               * question and carry no such reading.
               */
              className={`reaction-choice ${
                on
                  ? measureTone(option.label) === "yes"
                    ? "reaction-choice--settled vote-pill--yes"
                    : measureTone(option.label) === "no"
                      ? "reaction-choice--settled vote-pill--no"
                      : "border-[var(--text)] bg-[var(--text)]/10 font-semibold"
                  : "border-[var(--panel-border)] text-paper-dim hover:text-paper"
              }`}
            >
              {/* The mark carries the state, the colour reinforces it — the
                  same rule the reaction row follows, so a Yes reads as a Yes
                  on both surfaces and with colour stripped. */}
              {on && (
                <span className="reaction-mark" aria-hidden="true">
                  {measureTone(option.label) === "no" ? "✕" : "✓"}
                </span>
              )}
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

/**
 * Whether a pick option is a measure's Yes or No (g4 item 7).
 *
 * Matched on the option's own LABEL rather than on a flag, because a
 * measure's options are built from the ballot record's Yes/No wording and
 * there is no separate field saying "this contest is a proposition". The
 * match is deliberately tight — exactly "yes" or "no", case-insensitively,
 * after trimming — so a candidate named Yeswitha or a write-in reading "No
 * preference" is never coloured as a position.
 *
 * Anything else is a candidate and keeps the neutral selected treatment: the
 * product does not colour a person green.
 */
function measureTone(label: string): "yes" | "no" | null {
  const normalized = label.trim().toLowerCase();
  if (normalized === "yes") return "yes";
  if (normalized === "no") return "no";
  return null;
}
