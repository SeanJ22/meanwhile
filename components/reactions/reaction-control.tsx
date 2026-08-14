"use client";

import { useState } from "react";

import {
  getStoredReaction,
  submitReaction,
  type ReactionViewContext,
} from "@/lib/reactions/client";
import type {
  ReactionTargetType,
  ReactionValue,
} from "@/lib/signal/reactions";

/**
 * The reaction control (P03) — one component, keyed by target type + id, so
 * measures and agenda items can reuse it later; this session wires votes.
 *
 * Three one-tap buttons, no account, no friction. The disclosure sentence is
 * ALWAYS visible adjacent to the input — CLAUDE.md requires the
 * aggregated-and-sold statement at the point of capture, not behind a link —
 * and the "why we ask" link expands the fuller explanation. That sentence
 * and this placement are the one kind of friction the product protects
 * (friction exception 1/3: disclosure and consent at the capture point).
 *
 * A tap is instant and changeable: the choice renders selected immediately
 * from the device's own record, and a changed answer overwrites this
 * browser's prior one server-side. No aggregate is ever rendered back —
 * reactions are write-only from the reader's side.
 */

interface ReactionControlProps {
  targetType: ReactionTargetType;
  targetId: string;
  /** The question in plain words — "Do you like this vote?" for votes. */
  prompt: string;
  context: ReactionViewContext | null;
}

const CHOICES: { value: ReactionValue; label: string }[] = [
  { value: "YES", label: "Yes" },
  { value: "NO", label: "No" },
  { value: "UNSURE", label: "Unsure" },
];

export function ReactionControl({
  targetType,
  targetId,
  prompt,
  context,
}: ReactionControlProps) {
  // Lazy init: this control only mounts inside client-side popups, so the
  // device's stored answer is readable synchronously without hydration risk.
  const [selected, setSelected] = useState<ReactionValue | null>(() =>
    getStoredReaction(targetType, targetId),
  );
  const [whyOpen, setWhyOpen] = useState(false);

  const choose = (value: ReactionValue) => {
    setSelected(value);
    submitReaction(targetType, targetId, value, context);
  };

  return (
    <div className="mt-1.5">
      <p className="text-[0.6875rem] text-muted">{prompt}</p>
      <div className="mt-1 flex gap-1.5" role="group" aria-label={prompt}>
        {CHOICES.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            aria-pressed={selected === value}
            onClick={() => choose(value)}
            className={`min-h-9 flex-1 cursor-pointer rounded border px-2 text-[0.75rem] transition-colors ${
              selected === value
                ? "border-[var(--signal)] bg-[var(--signal)]/15 font-semibold text-signal"
                : "border-[var(--panel-border)] text-paper-dim hover:border-[var(--signal)]/50 hover:text-paper"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[0.5625rem] leading-relaxed text-muted">
        Your answer joins anonymous local totals we may sell. We never know
        who you are.{" "}
        <button
          type="button"
          className="cursor-pointer underline decoration-dotted hover:text-signal"
          onClick={() => setWhyOpen((v) => !v)}
        >
          why we ask
        </button>
      </p>
      {whyOpen && (
        <p className="mt-1 text-[0.5625rem] leading-relaxed text-muted">
          Counts by area — how many people near you liked or disliked a vote
          — are what keeps this site free: they may be shared or sold to
          political organizations. Nothing that could identify you is stored
          with your answer, and nobody&apos;s answers are ever shown here.
          The full picture is on the{" "}
          <a
            href="/transparency"
            target="_blank"
            className="underline decoration-dotted hover:text-signal"
          >
            transparency page
          </a>
          .
        </p>
      )}
    </div>
  );
}
