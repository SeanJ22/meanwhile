import { ONLINE_MARK_WORD } from "./online.ts";

/**
 * **THE MARK CARRIES THE STATE; THE COLOUR REINFORCES IT.** (MTG-14,
 * 2026-08-28. `docs/DESIGN.md` §"The mark carries the state", 2026-08-16 — law
 * regardless of which build it was written for.)
 *
 * ## What was wrong with the pills
 *
 * Three of them shipped — Concluded, Cancelled and Online — and they were
 * **distinguished only by background colour**. Same shape, same size, same
 * uppercase mono type, no icon, no screen-reader qualifier; three fills,
 * `--concluded`, `--canceled` and `--online`, selected by one `data-status`
 * attribute. The house rule says the ordering is not stylistic: *roughly one
 * reader in twelve cannot separate this green from this red*, and a build is
 * checked by STRIPPING COLOUR and asking whether the answer is still legible.
 *
 * Stripped of colour, all three were the same grey lozenge — and the three
 * states they name are not even the same KIND of fact. Two are claims about
 * what happened to the sitting. The third is a claim about WHERE it is, and it
 * is the only place a reader learns there is no room to turn up at.
 *
 * ## Why this is a MARK and not an outline pill
 *
 * `components/map/list-overlay.tsx` asserted in its own comment that the online
 * pill was *"an outline pill rather than a filled one"* while
 * `app/globals.css` has always rendered `[data-status="online"]` FILLED. The
 * code and its comment disagreed, and **the CSS is what ships, so the CSS
 * wins** — the comment is corrected rather than the rule. Two reasons, both
 * measured rather than argued:
 *
 * 1. **An outline `--online` cannot clear the house bar.** The pill paints its
 *    text in `--bg`; inverting it puts `--online` on the page, which measures
 *    **5.73:1 dark and 5.06:1 light against `--bg`** — under the 7:1 sun bar
 *    every text token must clear. Filled, the same pair is a large isolated
 *    control at the AA bar, which it clears. An outline would trade a legible
 *    mark for an unreadable one.
 * 2. **The three are peers in one metadata line.** One outline among two fills
 *    encodes *lesser*, not *different kind* — a difference of degree where the
 *    real difference is of category.
 *
 * ## Why the vocabulary is here and the markup is not
 *
 * The test runner strips types from `.ts` and cannot load `.tsx`, so a
 * vocabulary that lived beside the JSX could not be asserted at all — and the
 * assertion that no two statuses share a mark is the entire content of the
 * colour-stripping check. Data here, view in
 * `components/map/meeting-status-pill.tsx`.
 */
export type MeetingPillStatus = "concluded" | "canceled" | "online";

/**
 * One mark per state, and no two alike.
 *
 * `concluded` U+2713 CHECK MARK — it happened, it is done.
 * `canceled` U+00D7 MULTIPLICATION SIGN — it did not happen. Both follow the
 * vote grammar `docs/DESIGN.md` already sets for affirmative and negative.
 * `online` U+25A1 WHITE SQUARE — an empty room. Deliberately from neither half
 * of that grammar, because online-ness is not a verdict on the sitting.
 *
 * All three are BMP characters this repo already ships elsewhere. If a mono
 * font lacks one, what degrades is decoration — never the answer, which is the
 * word beside it.
 */
export const STATUS_MARK: Readonly<Record<MeetingPillStatus, string>> = {
  concluded: "✓",
  canceled: "×",
  online: "□",
};

/** The visible word. Distinct in length and in shape, colour or no colour. */
export const STATUS_WORD: Readonly<Record<MeetingPillStatus, string>> = {
  concluded: "Concluded",
  canceled: "Cancelled",
  // Not "Online". The extra word is the whole fact — see ONLINE_MARK_WORD.
  online: ONLINE_MARK_WORD,
};

/**
 * What a screen reader hears after the word.
 *
 * Not decoration: "Online only" beside a time is ambiguous out loud, and this
 * is the one surface that tells a reader there is nowhere to go. Each is a fact
 * about the SITTING, never about our research.
 */
export const STATUS_QUALIFIER: Readonly<Record<MeetingPillStatus, string>> = {
  concluded: " — this sitting has already happened",
  canceled: " — this sitting was called off",
  online: " — there is no room to attend in person",
};
