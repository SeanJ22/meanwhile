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
 * The per-contest pick control. Picks are kept on this device and also sent
 * as ballot-pick events with their race to the reader event store.
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
  /** Connects a choice to the reader's own answer on the reaction control above. */
  options: { id: string; label: string; reactionTargetId?: string }[];
  prominent?: boolean;
}) {
  const pick = useSyncExternalStore(
    subscribePicks,
    useCallback(
      () =>
        JSON.stringify({
          pick: getPick(contestId),
          // What a clear cleared, so a deleted derived pick does not return.
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
   * The derived pick, read from the device's own reaction answers
   * (`wtp.reactions`) and never stored, so an explicit pick always outranks it.
   * Read through `useSyncExternalStore` to avoid a hydration mismatch; the
   * subscription makes a Yes become the pick as soon as it is tapped.
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
    /* Same frame as the reaction prompt; the dashed border marks it as a private pick. */
    <div className="reaction-box" data-frame="standing" data-kind="pick">
      {/* States an existing pick instead of asking again; asks only when nothing is held or answers disagree. */}
      <p
        className={prominent ? "reaction-box-prompt text-link" : "reaction-box-prompt"}
        data-picked={resolution.asks ? undefined : "true"}
      >
        {resolution.asks
          ? `Your pick for this race${voteFor > 1 ? ` (pick up to ${voteFor})` : ""}`
          : `Your pick for this race: ${resolution.chosen.map(labelOf).join(", ")}`}
      </p>
      {resolution.basis === "DERIVED" && (
        // Says where the pick came from.
        <p
          data-derived-pick
          className="mt-0.5 t-caption leading-relaxed text-voice"
        >
          {DERIVED_PICK_LINE}
        </p>
      )}
      {resolution.conflicting.length > 0 && (
        // Surfaced, never resolved on the reader's behalf.
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
              /* A measure's Yes/No uses green/red; a candidate pick stays neutral. */
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
              {on && (
                <span className="reaction-mark" aria-hidden="true">
                  {measureTone(option.label) === "no" ? "✕" : "✓"}
                </span>
              )}
              {option.label}
            </button>
          );
        })}
        {/* Clear removes the explicit pick only, so it is not offered on a derived pick. */}
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
    </div>
  );
}

/**
 * Whether a pick option is a measure's Yes or No: exactly "yes" or "no",
 * case-insensitive after trimming. Anything else is a candidate.
 */
function measureTone(label: string): "yes" | "no" | null {
  const normalized = label.trim().toLowerCase();
  if (normalized === "yes") return "yes";
  if (normalized === "no") return "no";
  return null;
}
