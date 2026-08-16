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
import {
  scaleForTargetType,
  type ReactionTargetType,
  type ReactionValue,
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
  /**
   * How loudly the frame speaks (item 6c, 2026-08-15).
   *
   * `"standing"` — the default, and the ballot's own treatment: a framed
   * block in the family of THE NEXT ELECTION box, so the sensor reads as the
   * point of the surface rather than as an afterthought under it.
   * `"compact"` — the same component at the author's smaller size, for the
   * vote rows inside a battlecard: "as prominent, not as large." A vote card
   * carries a dozen of these, and a dozen full-size frames would turn the
   * record into a questionnaire.
   */
  frame?: "standing" | "compact";
}

/**
 * The labels, per value. The SCALE decides which of them a surface offers —
 * `scaleForTargetType` is the same function the server uses to decide what
 * it will accept, so the control cannot offer a button the write path would
 * refuse.
 */
const LABELS: Record<ReactionValue, string> = {
  YES: "Yes",
  NO: "No",
  UNSURE: "Unsure",
  SOMEONE_ELSE: "Someone else",
  // The five-point funding scale (2026-08-15, the author's design). "Don't
  // care" is the honest fifth answer and on a funding display it is very
  // often the true one; a scale without it collects a shrug as a shrug-shaped
  // "unsure", which is a different feeling.
  LOVE: "Love it",
  LIKE: "Like it",
  DISLIKE: "Don't like it",
  HATE: "Hate it",
  DONT_CARE: "Don't care",
};

/**
 * The tone a settled answer wears (item 5, 2026-08-16).
 *
 * Green for yes, red for no, dark gray for unsure and for the answers that
 * are neither. The funding scale's two intensities take their own deeper
 * shades — "Love it" is a deeper green than "Like it", "Hate it" a deeper red
 * than "Don't like it".
 *
 * **These label the reader's own answer back to them and nothing else.** No
 * aggregate is rendered, nothing is summed, and the tone carries no judgment
 * of the target — a red pill means the reader said no, never that the vote
 * was bad.
 */
const REACTION_TONE: Record<ReactionValue, string> = {
  YES: "yes",
  NO: "no",
  UNSURE: "neutral",
  SOMEONE_ELSE: "neutral",
  LOVE: "yes-strong",
  LIKE: "yes",
  DISLIKE: "no",
  HATE: "no-strong",
  DONT_CARE: "neutral",
};



export function ReactionControl({
  targetType,
  targetId,
  prompt,
  context,
  singleCandidateContest = false,
  frame = "standing",
}: ReactionControlProps) {
  // The scale the server will accept for this target, and nothing else.
  // SOMEONE_ELSE rides on top of the v1 scale in a one-candidate contest,
  // which is the only place the server accepts it either.
  const scale = scaleForTargetType(targetType);
  const choices = scale.values.filter(
    (value) => value !== "SOMEONE_ELSE" || singleCandidateContest,
  );
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
    /*
     * Item 6c (2026-08-15): the question is a FRAMED BOX now, in the family
     * of THE NEXT ELECTION panel. The standing prominence rule already said
     * the ask never whispers, and it still whispered — an unframed line and a
     * row of small outlines under a candidate reads as a footer to the card
     * above it rather than as the thing the surface is for. This is the
     * revenue-bearing path and the transparency page describes it as the
     * point; the rendering now says so too.
     *
     * The GEOMETRY TEST is the five-option funding row (D61: Love it / Like
     * it / Don't like it / Hate it / Don't care). Five controls at 390px is
     * the hard case, and the frame is built around it rather than retrofitted
     * — `flex-wrap` with a `min-height` and a sane `min-width` per control,
     * so the row wraps to two lines and every control keeps a thumb's width.
     * Never truncated, never shrunk below tap size.
     *
     * Nothing here edits a question or an option set. Item 6c styles them.
     */
    <div className="reaction-box" data-frame={frame}>
      <p className="reaction-box-prompt">{prompt}</p>
      <div className="reaction-box-choices" role="group" aria-label={prompt}>
        {choices.map((value) => {
          const label = LABELS[value];
          // The full selected-and-counted rendering is earned by the 204;
          // a stored selection with no tap this session (outcome null) is
          // the device's own memory and renders selected on that basis.
          const isSelected = selected === value;
          /*
           * Item 5 (2026-08-16): the CONFIRMED state renders as a pill in the
           * vote grammar — green for yes, red for no, dark gray for unsure,
           * and the five-point funding scale in its own shades.
           *
           * THE HONEST-OUTCOME RENDERING IS UNCHANGED UNDERNEATH. This is the
           * confirmation's face, not its truth: only a settled answer wears
           * the pill — the server's 204 (`COUNTED`), or a selection restored
           * from this device's own memory, which is a claim about this
           * browser rather than about the totals. `SAVING` and `NOT_COUNTED`
           * keep their own distinct renderings and never borrow the pill,
           * because a pill on a write that did not land would be exactly the
           * implied success the outcome rule exists to refuse.
           */
          const settled =
            isSelected && outcome !== "SAVING" && outcome !== "NOT_COUNTED";
          const style = !isSelected
            ? "border-[var(--panel-border)] text-paper-dim hover:border-[var(--link)]/50 hover:text-paper"
            : outcome === "SAVING"
              ? "border-[var(--link)]/50 text-paper-dim"
              : outcome === "NOT_COUNTED"
                ? "border-dashed border-[var(--link)]/60 text-paper-dim"
                : "";
          return (
            <button
              key={value}
              type="button"
              aria-pressed={isSelected}
              onClick={() => choose(value)}
              className={
                settled
                  ? `reaction-choice reaction-choice--settled vote-pill--${REACTION_TONE[value]}`
                  : `reaction-choice ${style}`
              }
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
