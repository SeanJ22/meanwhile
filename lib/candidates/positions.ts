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

export function getCandidateCorpus(): CandidateCorpus {
  return currentCandidateCorpusProjection();
}

export function documentsFor(candidateKey: string, corpus?: CandidateCorpus, holderId?: string): CandidateDocument[] {
  const keys = [...verifiedReaderPersonKeys(candidateKey), ...(holderId ? verifiedReaderPersonKeys(holderId) : [])];
  const seen = new Map<string, string>();
  return (corpus ?? getCandidateCorpus()).documents.filter((document) => {
    if (!keys.includes(document.candidateKey)) return false;
    const capture = sourceCaptureFingerprint(document.sourceRevision, document.contentHash,
      document.documentUrl, document.retrievedAt);
    if (capture === null) return true;
    const priorKey = seen.get(capture);
    if (priorKey !== undefined && priorKey !== document.candidateKey) return false;
    seen.set(capture, document.candidateKey);
    return true;
  });
}

export function failuresFor(candidateKey: string) {
  const keys = verifiedReaderPersonKeys(candidateKey);
  return getCandidateCorpus().failures.filter(
    (f) => keys.includes(f.candidateKey),
  );
}

export interface IssuePosition {
  issue: StanceTopic;
  answer: CandidateAnswer;
  sentence: string;
}

export function positionsFor(
  candidateKey: string,
  ownSiteUrl: string | null = null,
  topics: readonly StanceTopic[] = DEFAULT_STANCE_TOPICS,
  holderId?: string,
): IssuePosition[] {
  const documents = documentsFor(candidateKey, undefined, holderId);
  return topics.map((issue) => {
    const answer = answerFor(documents, issue.phrases, ownSiteUrl);
    return { issue, answer, sentence: answerSentence(answer, issue.label) };
  });
}

export function matchedIssues(positions: readonly IssuePosition[]): IssuePosition[] {
  return positions.filter((p) => p.answer.kind === "MATCHED");
}

export function positionsSummary(positions: readonly IssuePosition[]) {
  return {
    issuesSearched: positions.length,
    issuesWithPassages: positions.filter((p) => p.answer.kind === "MATCHED").length,
    nothingCollected: positions.every((p) => p.answer.kind === "NOTHING_COLLECTED"),
  };
}

export function positionsHeadline(
  positions: readonly IssuePosition[],
): string | null {
  if (positionsSummary(positions).nothingCollected) return null;
  return (
    "Passages below are this candidate's own words, from the pages named " +
    "under each one."
  );
}
