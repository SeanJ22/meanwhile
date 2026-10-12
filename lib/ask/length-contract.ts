/**
 * The answer length contract. A generated answer is never truncated: half a
 * sentence about a government is a claim nobody made. The budget is declared
 * here once and read by the system prompt (as a hard rule), the validator
 * (which measures the answer) and the rejection of an over-budget answer.
 * Rejection keeps every record (`lib/ask/answer.ts`), so the reader still gets
 * the sourced records. `maxCharacters` is a second gate because a sentence
 * count alone passes five very long sentences.
 */

/** The budget. One declaration, read by the prompt and by the validator. */
export const ANSWER_LENGTH_CONTRACT = {
  /** Measured, not advised. */
  maxSentences: 5,
  /** Five long sentences. The second gate, because a count alone passes a wall. */
  maxCharacters: 700,
  /**
   * The target the writer aims at, below the limit it is held to: a model told
   * "at most 700" writes to and past 700, and every token is reader wait time.
   * The validator still enforces `maxSentences` / `maxCharacters`.
   */
  targetSentences: 3,
  targetCharacters: 450,
} as const;

export interface AnswerLength {
  readonly sentences: number;
  readonly characters: number;
}

/**
 * Measure an answer. Sentences end at terminal punctuation followed by
 * whitespace or the end; abbreviations inflate the count slightly, erring
 * toward brevity, and the character gate catches the other direction.
 */
export function measureAnswer(answer: string): AnswerLength {
  const text = answer.trim();
  if (text.length === 0) return { sentences: 0, characters: 0 };
  const sentences = text.split(/[.!?]+(?:\s+|$)/).filter((s) => s.trim().length > 0).length;
  return { sentences, characters: text.length };
}

/** The reason an answer is over budget (which gate, by how much), or null. */
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

/** The budget as the model is told it, from the same constants, as a rule with no escape hatch. */
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
