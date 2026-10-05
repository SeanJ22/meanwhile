import {
  answerFor,
  answerSentence,
  sourceCaptureFingerprint,
  type CandidateAnswer,
  type CandidateCorpus,
  type CandidateDocument,
} from "./corpus.ts";
import { DEFAULT_STANCE_TOPICS, type StanceTopic } from "../stances/topics.ts";
import { verifiedReaderPersonKeys } from "../identity/reader-person.ts";
import { currentCandidateCorpusProjection } from "../civic-data/manual-read-models.ts";

/**
 * **P02's reader-facing shape** — one candidate, the same issue list,
 * every answer sourced.
 *
 * This module reads the committed corpus and produces per-issue answers. It
 * is the whole of P02's output, and there is deliberately no function here
 * that returns a number for a candidate, no ordering of candidates, and no
 * comparison between two of them. A per-issue answer is not summable, which
 * is the point: a composite ranks candidates, and ranking candidates is a
 * vote recommendation with extra steps.
 *
 * Server-side: the corpus is process-loaded from its proof-validated canonical
 * promotion pointer. Nothing fetches a publisher per page load, and a tracked
 * first seed is never a production fallback.
 */

export function getCandidateCorpus(): CandidateCorpus {
  return currentCandidateCorpusProjection();
}

export function documentsFor(candidateKey: string, corpus?: CandidateCorpus): CandidateDocument[] {
  const keys = verifiedReaderPersonKeys(candidateKey);
  const seen = new Map<string, string>();
  return (corpus ?? getCandidateCorpus()).documents.filter((document) => {
    if (!keys.includes(document.candidateKey)) return false;
    const capture = sourceCaptureFingerprint(document.sourceRevision, document.contentHash,
      document.documentUrl, document.retrievedAt);
    // Older rows without exact capture provenance remain separate. This joins
    // only copies carried by already verified aliases of the requested person.
    if (capture === null) return true;
    const priorKey = seen.get(capture);
    if (priorKey !== undefined && priorKey !== document.candidateKey) return false;
    seen.set(capture, document.candidateKey);
    return true;
  });
}

/**
 * Every retrieval that FAILED for this candidate, with its reason.
 *
 * Separate from the documents on purpose. A candidate whose site refused us
 * is not a candidate who published nothing, and a surface that shows only
 * the documents cannot tell the reader which happened.
 */
export function failuresFor(candidateKey: string) {
  const keys = verifiedReaderPersonKeys(candidateKey);
  return getCandidateCorpus().failures.filter(
    (f) => keys.includes(f.candidateKey),
  );
}

export interface IssuePosition {
  issue: StanceTopic;
  answer: CandidateAnswer;
  /** The level-register sentence for this answer. */
  sentence: string;
}

/**
 * The identical issue list, run over one candidate.
 *
 * **Equal effort in code**: there is no argument by which a caller can ask
 * for fewer issues for one candidate than another, and no path that skips
 * the search because a candidate looks thin. `SEARCHED_NOTHING_MATCHED`
 * renders, so a candidate with fewer matches renders as one who has
 * published less — with the pages and dates we searched named — rather than
 * as a blank a reader reads as absence.
 */
export function positionsFor(
  candidateKey: string,
  ownSiteUrl: string | null = null,
  topics: readonly StanceTopic[] = DEFAULT_STANCE_TOPICS,
): IssuePosition[] {
  const documents = documentsFor(candidateKey);
  return topics.map((issue) => {
    const answer = answerFor(documents, issue.phrases, ownSiteUrl);
    return { issue, answer, sentence: answerSentence(answer, issue.label) };
  });
}

/**
 * The issues this candidate has published something on, in the curated
 * order — **never sorted by how much they said**.
 *
 * The sort key is the author's own issue order and nothing else. Sorting by
 * match count would order issues by how loudly a campaign talks, which reads
 * as a ranking of what the candidate cares about and is a claim we cannot
 * make from a word search.
 */
export function matchedIssues(positions: readonly IssuePosition[]): IssuePosition[] {
  return positions.filter((p) => p.answer.kind === "MATCHED");
}

/**
 * How the whole run went for this candidate, for the honest header line.
 * Counts only — never a share of the issue list presented as a score.
 */
export function positionsSummary(positions: readonly IssuePosition[]) {
  return {
    issuesSearched: positions.length,
    issuesWithPassages: positions.filter((p) => p.answer.kind === "MATCHED").length,
    nothingCollected: positions.every((p) => p.answer.kind === "NOTHING_COLLECTED"),
  };
}

/**
 * The provenance line above a candidate's quotes — **never a count**.
 * (Rewritten 2026-08-20 under RULING 44 and RULING 47.)
 *
 * It used to state the denominator and the number matched: *"We search the
 * same 12 issues for every candidate in this contest. This one's own pages
 * mention 3 of them."* That is a measurement of our coverage rendered beside
 * a named person, which RULING 47 removed from the ballot row and RULING 44
 * forbids on a card in any wording — a digit is the banned statement
 * compressed. The one disclosure is now page-level and says the same thing
 * about every card at once: *"What we have found, we are displaying here."*
 *
 * Returns `null` when we hold nothing this candidate has published, because
 * there is then no section to put a line above — `CandidatePositions`
 * renders nothing at all in that case (RULING 28).
 */
export function positionsHeadline(
  positions: readonly IssuePosition[],
): string | null {
  if (positionsSummary(positions).nothingCollected) return null;
  return (
    "Passages below are this candidate's own words, from the pages named " +
    "under each one."
  );
}
