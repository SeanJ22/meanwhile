"use client";

import { useSyncExternalStore, useCallback } from "react";

import {
  clearPick,
  getPick,
  getSuppressedDerived,
  getUnsure,
  markUnsure,
  subscribePicks,
  togglePick,
} from "@/lib/ballot/picks";
import { DERIVED_PICK_LINE, conflictLine } from "@/lib/ballot/derived-picks";
import { resolveWithSuppression } from "@/lib/ballot/pick-tally";
import { getStoredReaction, subscribeReactions } from "@/lib/reactions/client";

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
  /**
   * M134: `reactionTargetId` is how a choice connects to the reader's OWN
   * answer on the reaction control above. Optional, because a contest whose
   * choices carry no reaction target simply derives nothing and behaves
   * exactly as it did before this change.
   */
  options: { id: string; label: string; reactionTargetId?: string }[];
  /** 6a (2026-08-14 second session): on measure cards the ask renders
   *  with visual weight — same words, bigger presence. It whispered. */
  prominent?: boolean;
}) {
  const pick = useSyncExternalStore(
    subscribePicks,
    useCallback(
      () =>
        JSON.stringify({
          pick: getPick(contestId),
          // F01-continued item 9: what a clear cleared here, so a derived
          // pick the reader deleted does not walk back in on the next render.
          cleared: getSuppressedDerived()[contestId] ?? [],
          unsure: getUnsure()[contestId] === true,
        }),
      [contestId],
    ),
    () => JSON.stringify({ pick: null, cleared: [], unsure: false }),
  );
  const { pick: parsed, cleared, unsure: unsureHere } = JSON.parse(pick) as {
    pick: {
      contestId: string;
      contestTitle: string;
      choiceIds: string[];
      labels: Record<string, string>;
    } | null;
    cleared: string[];
    unsure: boolean;
  };

  /*
   * M134 — THE DERIVED PICK.
   *
   * Read from the DEVICE's own record of what it answered (`wtp.reactions`),
   * never from the server and never from an aggregate. Nothing is written
   * here: a derived pick is a rendering decision recomputed every time, which
   * is what keeps "explicit outranks derived" meaningful — the moment a
   * derived pick were stored it would be indistinguishable from a tapped one.
   *
   * Read through `useSyncExternalStore`, exactly as the picks file above is,
   * and NOT during a bare render. A bare `localStorage` read here rendered the
   * ask on the server and the derived pick on the client — a real hydration
   * mismatch, caught in the browser rather than reasoned about, which React
   * logs and recovers from by throwing the tree away. The server snapshot is
   * "nothing answered", so the first paint is the ask and the client replaces
   * it in the same commit rather than after one.
   *
   * It also subscribes, which is what makes a Yes become the pick the MOMENT
   * it is tapped: the reaction control is elsewhere in the tree, and without
   * the subscription the two would agree only after a reload.
   */
  const yesKey = useSyncExternalStore(
    subscribeReactions,
    useCallback(
      () =>
        JSON.stringify(
        options
          .filter(
            (o) =>
              o.reactionTargetId &&
              getStoredReaction("CANDIDATE", o.reactionTargetId) === "YES",
          )
          .map((o) => o.id)
          .sort()),
      [options],
    ),
    () => "[]",
  );
  const yesChoiceIds = JSON.parse(yesKey) as string[];

  const resolution = resolveWithSuppression(parsed, yesChoiceIds, voteFor, cleared);
  const selected = new Set(resolution.chosen);
  const labelOf = (id: string) =>
    options.find((o) => o.id === id)?.label ?? parsed?.labels?.[id] ?? id;

  if (voteFor <= 0) return null;

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
      {/*
        M134: the race stops asking twice. When the reader has already
        answered — by tapping here, or by saying they'd vote for someone above
        — this STATES the pick instead of asking for it again. It asks only
        when there is nothing to state, or when the answers disagree.
      */}
      <p
        className={prominent ? "reaction-box-prompt text-link" : "reaction-box-prompt"}
        data-picked={resolution.asks ? undefined : "true"}
      >
        {resolution.asks
          ? `Your pick for this race${voteFor > 1 ? ` (pick up to ${voteFor})` : ""}`
          : `Your pick for this race: ${resolution.chosen.map(labelOf).join(", ")}`}
      </p>
      {resolution.basis === "DERIVED" && (
        // Says WHERE the pick came from. A checkmark the reader does not
        // remember making is worse than none — they would not know whether
        // the product had guessed.
        <p
          data-derived-pick
          className="mt-0.5 t-caption leading-relaxed text-voice"
        >
          {DERIVED_PICK_LINE}
        </p>
      )}
      {resolution.conflicting.length > 0 && (
        // Rule 3: surfaced, never resolved on the reader's behalf. Nothing
        // has been changed and the sentence says so.
        <p
          data-pick-conflict
          className="mt-0.5 t-caption leading-relaxed text-signal"
        >
          {conflictLine(
            resolution.chosen.map(labelOf),
            resolution.conflicting.map(labelOf),
          )}
        </p>
      )}
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
        {/*
          M134 rule 1: a recorded pick gets a change/clear affordance. `clear`
          removes the EXPLICIT pick only — it cannot and must not touch a
          reaction (rule 4, the two records stay separate), so on a DERIVED
          pick it would clear nothing and is not offered. Tapping another
          choice is the change affordance, and it writes an explicit pick that
          then outranks the derived one.
        */}
        <button
          type="button"
          aria-pressed={unsureHere}
          onClick={() => markUnsure(contestId)}
          className="min-h-8 cursor-pointer px-1.5 t-caption text-muted underline decoration-dotted"
        >
          {unsureHere ? "not sure yet ✓" : "not sure"}
        </button>
        {resolution.basis === "EXPLICIT" && (
          <button
            type="button"
            onClick={() => clearPick(contestId)}
            className="min-h-8 cursor-pointer px-1.5 t-caption text-muted underline decoration-dotted"
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
