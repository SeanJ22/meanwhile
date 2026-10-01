/**
 * **SAY EACH GAP ONCE.** (S2.4, 2026-10-01.)
 *
 * An Ask answer composed from held records can state a gap in its own sentence
 * ("We have not recorded who your state senator is yet.") and carry the same
 * gap as a named entry beside its records ("We have not recorded who holds the
 * office of state senator for your area yet."). Both rendered, so 10001 said
 * one thing twice. A gap entry the answer already states is the answer's, not a
 * second finding: it stays in the evidence the answer was built from and is not
 * printed again under it.
 *
 * Two statements are "the same" when the answer holds most of the gap's content
 * words. Boilerplate every gap shares ("we have not recorded") is not enough on
 * its own to match a different gap, because the match is over the whole
 * statement, not its opening.
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
