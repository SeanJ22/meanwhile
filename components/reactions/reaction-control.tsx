"use client";

import { Fragment, useState, useSyncExternalStore } from "react";

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
import {
  REACTION_LABELS,
  REACTION_MARK,
  SCALE_GROUP_LEADERS,
  reactionChoiceClass,
} from "@/lib/reactions/pill";

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
        {choices.map((value, i) => {
          // The full selected-and-counted rendering is earned by the 204;
          // a stored selection with no tap this session (outcome null) is
          // the device's own memory and renders selected on that basis.
          //
          // Item 5 (2026-08-16): the CONFIRMED state renders as a pill in
          // the vote grammar — green for yes, red for no, dark gray for
          // unsure, and the five-point funding scale in its own shades. The
          // state machine and the tones live in lib/reactions/pill.ts so a
          // test can tap every value and read back what it wears; the
          // honest-outcome rendering is unchanged underneath, and SAVING and
          // NOT_COUNTED never reach the pill.
          const isSelected = selected === value;
          return (
            <Fragment key={value}>
              {/*
                g3 item 7 (2026-08-16), the author's find: on the five-point
                row "Don't like it" sat DEAD CENTRE, and the eye defaults to
                the middle of a row of equal buttons. That is a sensor reading
                its own layout — a measurement instrument with a thumb on it,
                on the one path this product sells.
                The separators the author specified split the row into
                favourable / unfavourable / abstain, so no single option owns
                the centre: the centre is now a boundary rather than a button.
                Rendered wherever this scale renders, per the ruling.
              */}
              {i > 0 && SCALE_GROUP_LEADERS.has(value) && (
                <span className="scale-sep" aria-hidden="true" />
              )}
              <button
                type="button"
                aria-pressed={isSelected}
                onClick={() => choose(value)}
                className={reactionChoiceClass(value, isSelected, outcome)}
              >
                {/*
                  g4 item 7: the MARK carries the state and the colour
                  reinforces it. A reader who cannot separate this green from
                  this red still reads the answer off the tick or the cross.
                  aria-hidden because `aria-pressed` above already says the
                  same thing to a screen reader, and a literal "✓" read aloud
                  in front of "Yes" is noise.
                */}
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
