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

export function getCandidateCorpus(state: string): CandidateCorpus {
  return currentCandidateCorpusProjection(state);
}

const documentIndexes = new WeakMap<CandidateCorpus, ReadonlyMap<string, CandidateDocument[]>>();
export function candidateDocumentsByKey(corpus: CandidateCorpus): ReadonlyMap<string, CandidateDocument[]> {
  let index = documentIndexes.get(corpus);
  if (!index) {
    const built = new Map<string, CandidateDocument[]>();
    for (const document of corpus.documents) {
      const rows = built.get(document.candidateKey);
      if (rows) rows.push(document); else built.set(document.candidateKey, [document]);
    }
    index = built; documentIndexes.set(corpus, index);
  }
  return index;
}

function documentsFor(state: string, candidateKey: string, corpus?: CandidateCorpus, holderId?: string): CandidateDocument[] {
  const keys = [...verifiedReaderPersonKeys(candidateKey), ...(holderId ? verifiedReaderPersonKeys(holderId) : [])];
  const seen = new Map<string, string>();
  const index = candidateDocumentsByKey(corpus ?? getCandidateCorpus(state));
  return [...new Set(keys)].flatMap(key => index.get(key) ?? []).filter((document) => {
    const capture = sourceCaptureFingerprint(document.sourceRevision, document.contentHash,
      document.documentUrl, document.retrievedAt);
    if (capture === null) return true;
    const priorKey = seen.get(capture);
    if (priorKey !== undefined && priorKey !== document.candidateKey) return false;
    seen.set(capture, document.candidateKey);
    return true;
  });
}

export interface IssuePosition {
  issue: StanceTopic;
  answer: CandidateAnswer;
  sentence: string;
}

export function positionsFor(
  state: string,
  candidateKey: string,
  ownSiteUrl: string | null = null,
  topics: readonly StanceTopic[] = DEFAULT_STANCE_TOPICS,
  holderId?: string,
): IssuePosition[] {
  const documents = documentsFor(state, candidateKey, undefined, holderId);
  return topics.map((issue) => {
    const answer = answerFor(documents, issue.phrases, ownSiteUrl);
    return { issue, answer, sentence: answerSentence(answer, issue.label) };
  });
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
