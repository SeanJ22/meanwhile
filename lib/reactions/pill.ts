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
/**
 * TEXT_DROPPED (P03, 2026-08-18) settles the pill exactly like COUNTED: the
 * BINARY landed, which is what the pill is about. Only the verbatim was
 * refused, and the control says so in its own line rather than by dressing
 * a counted answer as uncounted.
 */
export type ReactionRenderOutcome =
  | "COUNTED"
  | "NOT_COUNTED"
  | "TEXT_DROPPED"
  | "SAVING"
  | null;

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
 * **The MARK a selected answer wears** — g4 item 7, the author.
 *
 * A checkmark on every affirmative, a small × on every negative, nothing on
 * the neutrals. The rule is stated as "the mark is the carrier, the colour is
 * reinforcement", and that ordering is an accessibility requirement rather
 * than a stylistic preference: the author's own neumorphism reference insists
 * that an active element must be identifiable without relying on contrast,
 * and roughly one reader in twelve cannot separate this green from this red.
 * A selected state carried by colour alone is a state those readers cannot
 * read at all.
 *
 * The checkmark already shipped on the pick control and nowhere else, so the
 * two halves of one grammar disagreed: a Yes on a candidate was ticked while a
 * Yes on a proposition was merely green. `tests/reaction-pill.test.ts` taps
 * every value and asserts the pairing, which is what stops the next scale
 * arriving with a colour and no mark.
 *
 * Nothing is marked when it is not SELECTED — an unselected row of ticks and
 * crosses would read as a set of answers already given.
 */
export const REACTION_MARK: Record<ReactionValue, string | null> = {
  YES: "✓",
  NO: "✕",
  // Unsure and abstain keep dark gray and NO mark, per the item. A mark on
  // an abstention would dress "I have no view" as a view.
  UNSURE: null,
  SOMEONE_ELSE: null,
  LOVE: "✓",
  LIKE: "✓",
  DISLIKE: "✕",
  HATE: "✕",
  DONT_CARE: null,
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

/**
 * Where the five-point scale is split into groups — g3 item 7, the author's
 * find (2026-08-16).
 *
 * ## The defect
 *
 * On the funding row — Love it · Like it · Don't like it · Hate it · Don't
 * care — **"Don't like it" sat dead centre**, and the eye defaults to the
 * middle of a row of equal buttons. That is a measuring instrument reading
 * its own layout: a mild negative collects extra answers because of where it
 * happens to fall, and this is the path whose aggregates are SOLD. A sensor
 * with a thumb on it is worse than no sensor, because the number still looks
 * like a number.
 *
 * ## The fix, and why it is placed by VALUE
 *
 * A separator before each group's first option splits the row into
 * favourable / unfavourable / abstain, so the centre of the row is a boundary
 * rather than a button and no single option owns it.
 *
 * Keyed on the VALUE, never on an index. The control filters its own choice
 * list (`SOMEONE_ELSE` renders only in a one-candidate contest), so an
 * index-based rule would slide a separator onto a different button the first
 * time a scale is filtered — and the failure would be invisible, because the
 * row would still look deliberate. This way the rule travels to every surface
 * the scale renders on, which is what the author asked for, and it renders
 * nowhere on the four-value v1 scale, which has no groups to mark.
 */
export const SCALE_GROUP_LEADERS: ReadonlySet<ReactionValue> = new Set<ReactionValue>([
  "DISLIKE",
  "DONT_CARE",
]);
