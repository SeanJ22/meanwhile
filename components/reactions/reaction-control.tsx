"use client";

import { Fragment, useState, useSyncExternalStore } from "react";

import {
  getStoredReaction,
  submitReaction,
  subscribeReactions,
  NOT_COUNTED_LINE,
  type ReactionSubmitOutcome,
  type ReactionViewContext,
} from "@/lib/reactions/client";
import {
  scaleForTargetType,
  FREE_TEXT_MAX_CHARS,
  FREE_TEXT_PROMPT,
  FREE_TEXT_THREAT_NOTICE,
  type ReactionTargetType,
  type ReactionValue,
} from "@/lib/signal/reactions";
import { captureEvent } from "@/lib/events/client";
import {
  REACTION_LABELS,
  REACTION_MARK,
  SCALE_GROUP_LEADERS,
  reactionChoiceClass,
} from "@/lib/reactions/pill";

/**
 * The reaction control, keyed by target type and id. A tap records at once,
 * renders selected from the device's own record, and a changed answer
 * overwrites this browser's prior one. No aggregate is ever rendered back.
 */


interface ReactionControlProps {
  targetType: ReactionTargetType;
  targetId: string;
  /** The question in plain words — "Do you like this vote?" for votes. */
  prompt: string;
  context: ReactionViewContext | null;
  /**
   * The only candidate in the contest: offers "Someone else". The server
   * enforces the same restriction; this decides what is offered.
   */
  singleCandidateContest?: boolean;
  /** `"standing"` is the framed default; `"compact"` is the smaller size for vote rows inside a battlecard. */
  frame?: "standing" | "compact";
}

export function ReactionControl({
  targetType,
  targetId,
  prompt,
  context,
  singleCandidateContest = false,
  frame = "standing",
}: ReactionControlProps) {
  // The scale the server accepts for this target; SOMEONE_ELSE only in a one-candidate contest.
  const scale = scaleForTargetType(targetType);
  const choices = scale.values.filter(
    (value) => value !== "SOMEONE_ELSE" || singleCandidateContest,
  );
  /*
   * The stored answer reads through `useSyncExternalStore`, subscribed to
   * `REACTIONS_EVENT` and cross-tab `storage`, so every control for the same
   * target agrees. `override` makes the tap render before `record` settles.
   */
  const stored = useSyncExternalStore(
    subscribeReactions,
    () => getStoredReaction(targetType, targetId),
    () => null,
  );
  const [override, setOverride] = useState<ReactionValue | null>(null);
  const selected = override ?? stored;
  // Selected-and-counted is earned by the 204; in flight renders as saving,
  // and anything else renders the not-counted line. A stored selection with no
  // tap this session renders selected as the device's memory.
  const [outcome, setOutcome] = useState<ReactionSubmitOutcome | "SAVING" | null>(
    null,
  );
  /* The optional text box opens only after this session's counted tap; never required. */
  const [text, setText] = useState("");
  const [textOpen, setTextOpen] = useState(false);
  const [textOutcome, setTextOutcome] = useState<
    "SAVING" | "SAVED" | "FAILED" | null
  >(null);

  const record = async (value: ReactionValue) => {
    setOverride(value);
    setOutcome("SAVING");
    // A changed answer re-sends what the reader already wrote.
    const result = await submitReaction(
      targetType,
      targetId,
      value,
      context,
      text.trim() || null,
    );
    setOutcome(result);
  };

  /** Send the verbatim alongside the answer already given. */
  const sendText = async () => {
    const value = selected;
    if (!value) return;
    setTextOutcome("SAVING");
    const result = await submitReaction(
      targetType,
      targetId,
      value,
      context,
      text.trim() || null,
    );
    setTextOutcome(
      result === "COUNTED" ? "SAVED" : "FAILED",
    );
  };

  const choose = (value: ReactionValue) => {
    captureEvent({ type: "REACTION", cardId: `${targetType}:${targetId}`, cardKind: targetType, reaction: value });
    void record(value);
  };

  return (
    /* Controls wrap to keep a thumb's width at 390px; never truncated or shrunk. */
    <div className="reaction-box" data-frame={frame}>
      <p className="reaction-box-prompt">{prompt}</p>
      <div className="reaction-box-choices" role="group" aria-label={prompt}>
        {choices.map((value, i) => {
          // Selected-and-counted is earned by the 204; tones live in lib/reactions/pill.ts.
          const isSelected = selected === value;
          return (
            <Fragment key={value}>
              {/* Separators split favourable / unfavourable / abstain, so no option owns the centre. */}
              {i > 0 && SCALE_GROUP_LEADERS.has(value) && (
                <span className="scale-sep" aria-hidden="true" />
              )}
              <button
                type="button"
                aria-pressed={isSelected}
                onClick={() => choose(value)}
                className={reactionChoiceClass(value, isSelected, outcome)}
              >
                {/* The mark carries the state; aria-hidden since `aria-pressed` already says it. */}
                {isSelected && REACTION_MARK[value] && (
                  <span className="reaction-mark" aria-hidden="true">
                    {REACTION_MARK[value]}
                  </span>
                )}
                {REACTION_LABELS[value]}
              </button>
            </Fragment>
          );
        })}
      </div>
      {outcome === "NOT_COUNTED" && (
        // Anything short of the 204 renders this line.
        <p className="mt-1 text-[0.6875rem] leading-relaxed text-muted">
          {NOT_COUNTED_LINE}
        </p>
      )}
      {/* Opens only after an answer landed this session. */}
      {outcome === "COUNTED" && (
        <div className="mt-2">
          {!textOpen ? (
            <button
              type="button"
              className="cursor-pointer text-[0.6875rem] text-muted underline decoration-dotted underline-offset-2 hover:text-signal"
              onClick={() => setTextOpen(true)}
            >
              Want to say more?
            </button>
          ) : (
            <div>
              <label
                htmlFor={`rx-text-${targetType}-${targetId}`}
                className="block text-[0.6875rem] text-muted"
              >
                {FREE_TEXT_PROMPT}
              </label>
              <textarea
                id={`rx-text-${targetType}-${targetId}`}
                value={text}
                maxLength={FREE_TEXT_MAX_CHARS}
                rows={3}
                onChange={(e) => {
                  setText(e.target.value);
                  if (textOutcome !== null) setTextOutcome(null);
                }}
                className="mt-1 w-full rounded border border-[var(--panel-border)] bg-transparent p-2 text-[0.75rem] leading-relaxed text-paper placeholder:text-muted focus:border-[var(--signal)] focus:outline-none"
              />
              {/* Adjacent to the field, never behind a link. */}
              <p className="mt-1 text-[0.6875rem] leading-relaxed text-muted">
                {FREE_TEXT_THREAT_NOTICE}
              </p>
              <div className="mt-1.5 flex items-center gap-2">
                <button
                  type="button"
                  disabled={text.trim().length === 0 || textOutcome === "SAVING"}
                  onClick={() => void sendText()}
                  className="min-h-8 cursor-pointer rounded border border-[var(--signal)] px-2.5 text-[0.75rem] font-medium text-signal transition-colors hover:bg-[var(--signal)]/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {textOutcome === "SAVING" ? "Sending…" : "Send it"}
                </button>
                {textOutcome === "SAVED" && (
                  <span className="text-[0.6875rem] text-muted">Got it.</span>
                )}
                {textOutcome === "FAILED" && (
                  <span className="text-[0.6875rem] text-muted">
                    {NOT_COUNTED_LINE}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
