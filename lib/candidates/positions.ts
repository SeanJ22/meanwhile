import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  answerFor,
  answerSentence,
  type CandidateAnswer,
  type CandidateCorpus,
  type CandidateDocument,
} from "./corpus.ts";
import { CANDIDATE_ISSUES, type CandidateIssue } from "./issues.ts";

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
 * Server-side: the corpus is a committed file read through `node:fs`, the
 * same posture as the funding and votes snapshots. Nothing fetches per page
 * load.
 */

let cache: CandidateCorpus | null = null;

export function getCandidateCorpus(): CandidateCorpus {
  if (!cache) {
    cache = JSON.parse(
      readFileSync(
        join(process.cwd(), "data", "candidates", "corpus-2026.json"),
        "utf8",
      ),
    ) as CandidateCorpus;
  }
  return cache;
}

export function documentsFor(candidateKey: string): CandidateDocument[] {
  return getCandidateCorpus().documents.filter(
    (d) => d.candidateKey === candidateKey,
  );
}

/**
 * Every retrieval that FAILED for this candidate, with its reason.
 *
 * Separate from the documents on purpose. A candidate whose site refused us
 * is not a candidate who published nothing, and a surface that shows only
 * the documents cannot tell the reader which happened.
 */
export function failuresFor(candidateKey: string) {
  return getCandidateCorpus().failures.filter(
    (f) => f.candidateKey === candidateKey,
  );
}

export interface IssuePosition {
  issue: CandidateIssue;
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
): IssuePosition[] {
  const documents = documentsFor(candidateKey);
  return CANDIDATE_ISSUES.map((issue) => {
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
 * The sentence above a candidate's issue list.
 *
 * States the denominator first, because every count under it is a count out
 * of the same issue list — and because "3 issues" means nothing without
 * "of the 12 we search for everyone".
 */
export function positionsHeadline(positions: readonly IssuePosition[]): string {
  const summary = positionsSummary(positions);
  if (summary.nothingCollected) {
    return (
      "We haven't collected anything this candidate has published yet. " +
      "That's a gap in our research, not a statement about them — we run " +
      "the same search for every candidate in every contest."
    );
  }
  return (
    `We search the same ${summary.issuesSearched} issues for every candidate ` +
    `in this contest. This one's own pages mention ` +
    `${summary.issuesWithPassages} of them, in their words below.`
  );
}
