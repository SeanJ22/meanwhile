/**
 * **THE WORDS RULING 71's PILL SAYS.** (NJ Hunt 3 item 3, 2026-08-22.)
 *
 * Here rather than in the component for two reasons, and the second is the real
 * one:
 *
 * 1. The test runner cannot import a `.tsx`, so a guard that pins the SENTENCE
 *    rather than a class name needs the sentence to live in a `.ts` module.
 * 2. **The wording is the rule.** RULING 71 specifies the pill "in substance",
 *    and the substance is what separates it from a completeness marker: its
 *    subject must be the READER and their street, never us and never this
 *    record. `tests/could-govern-pill.test.ts` asserts that mechanically
 *    against the same lexicons the RULING 44 guard uses — so a future rewording
 *    that drifted toward *we don't know which one is yours* would fail the
 *    build rather than quietly reintroduce the badge RULING 42 deleted.
 *
 * The register is LEVEL, not playful: a contest card is a claim surface, and
 * nothing here is cute about a real municipality or a reader's home.
 */

/** The claim. Present tense, about the body, addressed to the reader. */
export const COULD_GOVERN_TEXT = "Could govern you";

/** The invitation. An offer the reader may decline at no cost. */
export const COULD_GOVERN_ACTION = "add your address to confirm";

/** The whole sentence, assembled once so nothing assembles it differently. */
export const COULD_GOVERN_SENTENCE = `${COULD_GOVERN_TEXT} — ${COULD_GOVERN_ACTION}`;
