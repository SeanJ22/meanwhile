/**
 * Say each gap once. An Ask answer can state a gap in its own sentence and also
 * carry the same gap as a named entry beside its records; the entry stays in
 * the evidence but is not printed again under the answer.
 *
 * Two statements are "the same" when the answer holds most of the gap's content
 * words, matched over the whole statement, so shared boilerplate ("we have not
 * recorded") alone never matches a different gap.
 */

const FILLER = new Set([
  "a", "an", "the", "of", "for", "to", "in", "on", "is", "are", "be", "we", "our", "your", "you",
  "yet", "this", "that", "it", "its", "and", "or", "so", "which", "their", "them", "there",
]);

/** The words that carry a statement's meaning, lower-cased and unpunctuated. */
function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word !== "" && !FILLER.has(word));
}

/** How much of `statement` the `answer` already says, 0..1. */
function shareOfStatementIn(answer: string, statement: string): number {
  const said = new Set(contentWords(answer));
  const words = contentWords(statement);
  if (words.length === 0) return 0;
  return words.filter((word) => said.has(word)).length / words.length;
}

/** The gaps worth printing under an answer: those it has not already said. */
export function gapsNotInAnswer<G extends { statement: string }>(
  answer: string | null | undefined,
  gaps: readonly G[],
): G[] {
  if (!answer) return [...gaps];
  return gaps.filter((gap) => shareOfStatementIn(answer, gap.statement) < 0.6);
}
