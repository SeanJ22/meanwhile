import type { ReactionValue } from "@/lib/signal/reactions";

/**
 * The confirmation pill's state machine, separate from the control so a test can tap it. The CSS
 * cascade in `app/globals.css` must let the settled pill's colour survive (checked as contrast in both
 * themes). The pill labels the reader's own answer back to their own device; never an aggregate.
 */

/** What the server said about this session's tap, as the control tracks it. */
export type ReactionRenderOutcome =
  | "COUNTED"
  | "NOT_COUNTED"
  | "SAVING"
  | null;

/**
 * The tone a settled answer wears: green for yes, red for no, dark gray for unsure and neutrals; the
 * funding scale's strong answers take deeper shades. Red means the reader said no, never that the vote
 * was bad.
 */
export const REACTION_TONE: Record<ReactionValue, string> = {
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

/**
 * The mark a selected answer wears: a checkmark on affirmatives, × on negatives, nothing on neutrals.
 * The mark carries the state and colour only reinforces it, so readers who cannot separate red from
 * green can still read it. Nothing is marked unless selected.
 */
export const REACTION_MARK: Record<ReactionValue, string | null> = {
  YES: "✓",
  NO: "✕",
  // A mark on an abstention would dress "I have no view" as a view.
  UNSURE: null,
  SOMEONE_ELSE: null,
  LOVE: "✓",
  LIKE: "✓",
  DISLIKE: "✕",
  HATE: "✕",
  DONT_CARE: null,
};

/**
 * The labels, per value. `scaleForTargetType` decides which a surface offers, the same function the
 * server uses, so the control cannot offer a button the write path would refuse.
 */
export const REACTION_LABELS: Record<ReactionValue, string> = {
  YES: "Yes",
  NO: "No",
  UNSURE: "Unsure",
  SOMEONE_ELSE: "Someone else",
  // The five-point funding scale. "Don't care" is a real answer, distinct from unsure.
  LOVE: "Love it",
  LIKE: "Like it",
  DISLIKE: "Don't like it",
  HATE: "Hate it",
  DONT_CARE: "Don't care",
};

/**
 * Settled: the server's 204 (`COUNTED`), or a selection restored from this device's memory (`null`).
 * `SAVING` and `NOT_COUNTED` never wear the pill.
 */
export function isSettled(
  isSelected: boolean,
  outcome: ReactionRenderOutcome,
): boolean {
  return isSelected && outcome !== "SAVING" && outcome !== "NOT_COUNTED";
}

/**
 * The class list for one choice button. A settled reaction always carries both
 * `reaction-choice--settled` and a `vote-pill--` tone.
 */
export function reactionChoiceClass(
  value: ReactionValue,
  isSelected: boolean,
  outcome: ReactionRenderOutcome,
): string {
  if (isSettled(isSelected, outcome)) {
    return `reaction-choice reaction-choice--settled vote-pill--${REACTION_TONE[value]}`;
  }
  if (!isSelected) {
    return "reaction-choice border-[var(--panel-border)] text-paper-dim hover:border-[var(--link)]/50 hover:text-paper";
  }
  if (outcome === "SAVING") {
    return "reaction-choice reaction-choice--saving border-[var(--link)]/50 text-paper-dim";
  }
  // NOT_COUNTED: the honest line renders beside it, and the control wears a
  // dashed outline rather than a fill — absence of a landed row never
  // borrows a landed row's styling.
  return "reaction-choice reaction-choice--uncounted border-dashed border-[var(--link)]/60 text-paper-dim";
}

/**
 * Where the five-point scale splits into favourable / unfavourable / abstain groups, so no single
 * option owns the centre of the row. Keyed on the value, never an index, because the control filters
 * its own choice list.
 */
export const SCALE_GROUP_LEADERS: ReadonlySet<ReactionValue> = new Set<ReactionValue>([
  "DISLIKE",
  "DONT_CARE",
]);
