"use client";

import { useState, useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};

import {
  getStoredReaction,
  submitReaction,
  NOT_COUNTED_LINE,
  type ReactionSubmitOutcome,
  type ReactionViewContext,
} from "@/lib/reactions/client";
import type {
  ReactionTargetType,
  ReactionValue,
} from "@/lib/signal/reactions";

/**
 * The reaction control (P03) — one component, keyed by target type + id, so
 * measures, candidates, and agenda items reuse it; votes wired first.
 *
 * Disclosure is the TOS pattern (3c, 2026-08-16, author-approved; the
 * CLAUDE.md record was updated in the same commit): the FIRST reaction tap
 * this device ever makes surfaces a one-time notice — "Your answer joins
 * anonymous local totals. We never know who you are. How we use this →" —
 * that must be acknowledged before the answer is recorded. The
 * acknowledgment stores device-local (`wtp.reaction_disclosure_ack`) and
 * the notice never repeats; the linked transparency page keeps the full
 * truth, including that totals may be licensed. The gate blocks capture until
 * acknowledged — friction exceptions (1) and (3), disclosure and consent at
 * the capture point. The old always-visible per-button line retired with
 * that decision.
 *
 * A tap is instant and changeable: the choice renders selected immediately
 * from the device's own record, and a changed answer overwrites this
 * browser's prior one server-side. No aggregate is ever rendered back —
 * reactions are write-only from the reader's side.
 */

const DISCLOSURE_ACK_KEY = "wtp.reaction_disclosure_ack";

function disclosureAcknowledged(): boolean {
  try {
    return window.localStorage.getItem(DISCLOSURE_ACK_KEY) === "1";
  } catch {
    // No storage means the notice shows every time — the safe direction.
    return false;
  }
}

function acknowledgeDisclosure() {
  try {
    window.localStorage.setItem(DISCLOSURE_ACK_KEY, "1");
  } catch {
    // Survivable; the notice will show again.
  }
}

interface ReactionControlProps {
  targetType: ReactionTargetType;
  targetId: string;
  /** The question in plain words — "Do you like this vote?" for votes. */
  prompt: string;
  context: ReactionViewContext | null;
  /**
   * This candidate is the only one in their contest (M63). The fourth
   * answer — "Someone else" — renders only here, because only here does it
   * mean anything: Yes is what an uncontested ballot forces, No cannot
   * separate disliking the candidate from wanting a choice at all, and
   * wanting somebody else is otherwise unsayable. The server enforces the
   * same restriction; this prop decides what is offered, never what is
   * allowed.
   */
  singleCandidateContest?: boolean;
}

const CHOICES: { value: ReactionValue; label: string }[] = [
  { value: "YES", label: "Yes" },
  { value: "NO", label: "No" },
  { value: "UNSURE", label: "Unsure" },
];

const SOMEONE_ELSE: { value: ReactionValue; label: string } = {
  value: "SOMEONE_ELSE",
  label: "Someone else",
};

export function ReactionControl({
  targetType,
  targetId,
  prompt,
  context,
  singleCandidateContest = false,
}: ReactionControlProps) {
  const choices = singleCandidateContest ? [...CHOICES, SOMEONE_ELSE] : CHOICES;
  // The device's stored answer reads through useSyncExternalStore: this
  // control now also renders inside server-rendered pages (the ballot, 3d),
  // and the store pattern hydrates against the server's blank then re-reads
  // — no mismatch, no setState-in-effect. Taps land in `override` so the
  // selection updates without a store notification round-trip.
  const stored = useSyncExternalStore(
    emptySubscribe,
    () => getStoredReaction(targetType, targetId),
    () => null,
  );
  const [override, setOverride] = useState<ReactionValue | null>(null);
  const selected = override ?? stored;
  // A tap made before the one-time disclosure is acknowledged parks here
  // and applies on acknowledgment — the answer is never recorded first.
  const [pendingValue, setPendingValue] = useState<ReactionValue | null>(null);
  // The server's answer for THIS session's tap. The selected-and-counted
  // rendering is EARNED by the 204 (outcome === "COUNTED"): while the write
  // is in flight the tapped choice renders as saving, and anything short of
  // a 204 renders the honest not-counted line instead of implied success.
  // A selection restored from device storage (no tap this session) renders
  // selected as the device's own memory — that claim is about this browser,
  // not the totals.
  const [outcome, setOutcome] = useState<ReactionSubmitOutcome | "SAVING" | null>(
    null,
  );

  const record = async (value: ReactionValue) => {
    setOverride(value);
    setOutcome("SAVING");
    setOutcome(await submitReaction(targetType, targetId, value, context));
  };

  const choose = (value: ReactionValue) => {
    if (!disclosureAcknowledged()) {
      setPendingValue(value);
      return;
    }
    void record(value);
  };

  return (
    <div className="mt-2">
      {/* The standing prominence rule (design pass): the question is the
          product's revenue-bearing ask and never whispers. */}
      <p className="text-[0.8125rem] font-medium text-paper-dim">{prompt}</p>
      {/* Wraps rather than squeezing: "Someone else" is a fourth control at
          390px and four on one row would each be under a thumb's width. */}
      <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label={prompt}>
        {choices.map(({ value, label }) => {
          // The full selected-and-counted rendering is earned by the 204;
          // a stored selection with no tap this session (outcome null) is
          // the device's own memory and renders selected on that basis.
          const isSelected = selected === value;
          const style = !isSelected
            ? "border-[var(--panel-border)] text-paper-dim hover:border-[var(--signal)]/50 hover:text-paper"
            : outcome === "SAVING"
              ? "border-[var(--signal)]/50 text-paper-dim"
              : outcome === "NOT_COUNTED"
                ? "border-dashed border-[var(--signal)]/60 text-paper-dim"
                : "border-[var(--signal)] bg-[var(--signal)]/15 font-semibold text-signal";
          return (
            <button
              key={value}
              type="button"
              aria-pressed={isSelected}
              onClick={() => choose(value)}
              className={`min-h-9 flex-1 cursor-pointer rounded border px-2 text-[0.75rem] transition-colors ${style}`}
            >
              {label}
            </button>
          );
        })}
      </div>
      {outcome === "NOT_COUNTED" && (
        // Anything short of the 204 — 500, network failure, or the
        // never-happens 202 — renders this line, never implied success.
        <p className="mt-1 text-[0.6875rem] leading-relaxed text-muted">
          {NOT_COUNTED_LINE}
        </p>
      )}
      {pendingValue !== null && (
        // The one-time notice: shown on this device's first-ever tap, gone
        // for good once acknowledged. The transparency link carries the
        // full truth, including that totals may be licensed.
        <div className="mt-1.5 rounded border border-[var(--signal)]/40 bg-[var(--signal)]/5 p-2">
          <p className="text-[0.6875rem] leading-relaxed text-paper-dim">
            Your answer joins anonymous local totals. We never know who you
            are.{" "}
            <a
              href="/transparency"
              target="_blank"
              className="underline decoration-dotted hover:text-signal"
            >
              How we use this →
            </a>
          </p>
          <button
            type="button"
            className="mt-1.5 min-h-8 w-full cursor-pointer rounded border border-[var(--signal)] px-2 text-[0.75rem] font-medium text-signal transition-colors hover:bg-[var(--signal)]/10"
            onClick={() => {
              acknowledgeDisclosure();
              const value = pendingValue;
              setPendingValue(null);
              if (value) void record(value);
            }}
          >
            OK — record my answer
          </button>
        </div>
      )}
    </div>
  );
}
