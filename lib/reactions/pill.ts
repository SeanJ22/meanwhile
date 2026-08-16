import type { ReactionValue } from "@/lib/signal/reactions";

/**
 * The confirmation's face — extracted from the control (2026-08-16, the
 * correction pass) so the state machine can be TAPPED by a test.
 *
 * The defect this file exists to prevent shipped once and reached the
 * author on production: every class name in the component read correctly,
 * and the settled pill was still invisible, because `.reaction-choice`
 * appeared LATER in the stylesheet than `.reaction-choice--settled` at the
 * same specificity and took the background back. Near-white `--vote-text`
 * on `--panel-bg` measured 1.01:1 in light theme — a reader who tapped Yes
 * watched the button blank out and could not tell whether their answer
 * counted. The row had landed every time.
 *
 * Two halves, and the guard (`tests/reaction-pill.test.ts`) holds both:
 *  1. the STATE MACHINE here — which outcomes earn the pill, and which
 *     colour each captured value wears;
 *  2. the CASCADE in `app/globals.css` — that the pill's colour actually
 *     survives to the screen, measured as a contrast ratio in both themes.
 *
 * Nothing here renders an aggregate. The pill labels the reader's OWN
 * answer back to their OWN device; no count, no total, no other reader.
 */

/** What the server said about this session's tap, as the control tracks it. */
export type ReactionRenderOutcome = "COUNTED" | "NOT_COUNTED" | "SAVING" | null;

/**
 * The tone a settled answer wears.
 *
 * Green for yes, red for no, dark gray for unsure and for the answers that
 * are neither. The funding scale's two intensities take their own deeper
 * shades — "Love it" is a deeper green than "Like it", "Hate it" a deeper
 * red than "Don't like it".
 *
 * A red pill means the reader said no. It never means the vote was bad.
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
 * The labels, per value. The SCALE decides which of them a surface offers —
 * `scaleForTargetType` is the same function the server uses to decide what
 * it will accept, so the control cannot offer a button the write path would
 * refuse.
 */
export const REACTION_LABELS: Record<ReactionValue, string> = {
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
 * A settled answer is one the reader can trust the rendering of: the
 * server's 204 (`COUNTED`), or a selection restored from this device's own
 * memory (`null` — no tap this session), which is a claim about this
 * browser rather than about the totals.
 *
 * `SAVING` and `NOT_COUNTED` are NOT settled and never wear the pill. A
 * pill on a write that did not land would be exactly the implied success
 * the honest-outcome rule refuses.
 */
export function isSettled(
  isSelected: boolean,
  outcome: ReactionRenderOutcome,
): boolean {
  return isSelected && outcome !== "SAVING" && outcome !== "NOT_COUNTED";
}

/**
 * The class list for one choice button, given what the reader did to it.
 *
 * A CAPTURED reaction is never blank: the settled branch always carries
 * both `reaction-choice--settled` (the fill) and a `vote-pill--` tone (the
 * colour), so there is no state in which a tapped-and-counted button loses
 * its face.
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
