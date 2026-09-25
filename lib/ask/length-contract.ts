/**
 * **ASK-19 — THE LENGTH CONTRACT.** (The 8.30.26 sweep; the owner's report was
 * *answers are far too long*. Worked 2026-08-31.)
 *
 * ## Why this is a contract and not a cap
 *
 * The row's blocker said it exactly: *not attempted rather than
 * half-attempted: a prose cap applied without one would truncate sourced
 * content.* A `slice(0, 700)` on a generated answer cuts a sentence in half,
 * and half a sentence about a government is a claim nobody made. It is also
 * the exact shape of ASK-17 — an answer a reader cannot finish reading is an
 * answer they did not get — solved by making the answer shorter rather than by
 * making it stop.
 *
 * So the budget is declared once, HERE, and used in three places that cannot
 * disagree because they read the same numbers:
 *
 * ```
 *   1. the SYSTEM PROMPT states it as a hard rule, in the model's own units
 *   2. the VALIDATOR measures the returned answer against it
 *   3. an over-budget answer is REJECTED, exactly as an invented URL is
 * ```
 *
 * **Rejection is not a loss of the answer.** `lib/ask/answer.ts` ships every
 * record whatever the synthesis did — *a rejected or unavailable synthesis
 * still ships every record, because the structured answer is a true answer* —
 * so the reader gets the sourced records without the essay. That degradation
 * already exists and this simply adds one more way in.
 *
 * ## The numbers, and where they come from
 *
 * The prompt has said *two to five sentences* since it was written, with an
 * escape hatch — *unless the records genuinely need more* — that nothing
 * measured and nothing enforced. The budget makes the sentence literal and
 * removes the hatch, because the hatch is what the owner met.
 *
 * `MAX_CHARACTERS` is 5 × 140, one long sentence each. It is the SECOND gate
 * on purpose: a model can write five sentences of two hundred words, and a
 * sentence count alone would pass the wall of text the owner photographed.
 *
 * ## What the roster does instead
 *
 * ASK-21 collapsed the roster behind a disclosure in the same sweep, and the
 * records list carries the detail. Length in the ANSWER is not where a reader
 * gets completeness — the evidence below it is — so a budget here removes no
 * fact from the surface.
 */

/** The budget. One declaration, read by the prompt and by the validator. */
export const ANSWER_LENGTH_CONTRACT = {
  /** The prompt has always said two to five. Now it is measured. */
  maxSentences: 5,
  /** Five long sentences. The second gate, because a count alone passes a wall. */
  maxCharacters: 700,
  /**
   * **THE TARGET THE WRITER AIMS AT, BELOW THE LIMIT IT IS HELD TO.**
   * (2026-09-25, the Ask latency repair.)
   *
   * Measured on production read-only data that day, 9 of 16 model answers
   * across Haiku 4.5, Sonnet 5 and Opus 5 were rejected for length ALONE —
   * 703 to 1,138 characters, or six and seven sentences — and discarded, the
   * reader getting the records without prose. A model told "at most 700" writes
   * to 700 and over it. Every generated token is also time the reader waits
   * (~10 ms each), so the answer is asked to be short and the limit stays where
   * it is: the validator still rejects past `maxSentences` / `maxCharacters`,
   * and the records below the answer carry the detail, as ASK-19 intended.
   */
  targetSentences: 3,
  targetCharacters: 450,
} as const;

export interface AnswerLength {
  readonly sentences: number;
  readonly characters: number;
}

/**
 * Measure an answer.
 *
 * Sentences are counted on terminal punctuation followed by whitespace or the
 * end of the string. It is deliberately a simple rule: an abbreviation ("St.
 * Louis", "U.S.") inflates the count slightly, which errs toward BREVITY —
 * the direction the owner asked for — and the character gate catches anything
 * the sentence rule mis-reads in the other direction.
 */
export function measureAnswer(answer: string): AnswerLength {
  const text = answer.trim();
  if (text.length === 0) return { sentences: 0, characters: 0 };
  const sentences = text.split(/[.!?]+(?:\s+|$)/).filter((s) => s.trim().length > 0).length;
  return { sentences, characters: text.length };
}

/**
 * The reason an answer is over budget, or null.
 *
 * Returns a REASON rather than a boolean so the verdict can name which gate it
 * failed and by how much — a rejection whose cause is unreadable is a rejection
 * nobody can act on, and the trace is where a session finds out the budget is
 * wrong rather than the model.
 */
export function overLengthBudget(answer: string): string | null {
  const { sentences, characters } = measureAnswer(answer);
  if (sentences > ANSWER_LENGTH_CONTRACT.maxSentences) {
    return `too-long:${sentences}-sentences-over-${ANSWER_LENGTH_CONTRACT.maxSentences}`;
  }
  if (characters > ANSWER_LENGTH_CONTRACT.maxCharacters) {
    return `too-long:${characters}-characters-over-${ANSWER_LENGTH_CONTRACT.maxCharacters}`;
  }
  return null;
}

/**
 * The budget as the model is told it, generated from the same constants.
 *
 * Written as a rule rather than as advice, and with the escape hatch gone. The
 * previous wording ended *unless the records genuinely need more*, which is an
 * instruction the model may always satisfy by deciding the records need more.
 */
export function lengthRuleForPrompt(): string {
  return (
    `- Aim for ${ANSWER_LENGTH_CONTRACT.targetSentences} sentences or fewer and about ` +
    `${ANSWER_LENGTH_CONTRACT.targetCharacters} characters. ` +
    `Length is a HARD LIMIT, not a preference: at most ` +
    `${ANSWER_LENGTH_CONTRACT.maxSentences} sentences and at most ` +
    `${ANSWER_LENGTH_CONTRACT.maxCharacters} characters. An answer over either limit is ` +
    `discarded and the reader is shown the records instead, so a longer answer is not a ` +
    `fuller one — it is no answer at all. Put the detail in the records; the reader can see ` +
    `them. Say the most important thing first.`
  );
}
