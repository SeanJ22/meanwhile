import { positionsFor, type PositionAnswer, type PositionPassage } from "./positions.ts";
import { unifiedCorpus } from "./unified.ts";
import type { StatementCorpus } from "./types.ts";
import { verifiedReaderPersonKeys } from "../identity/reader-person.ts";

export interface ReaderPositionAnswer extends PositionAnswer {
  canonicalSubjectKeys: string[];
  passages: (PositionPassage & { canonicalSubjectId: string })[];
}

/** One sourced passage answer, whether the caller has an official or card ID. */
export function readerPositionsFor(subjectId: string, topic: string, corpus: StatementCorpus = unifiedCorpus()): ReaderPositionAnswer {
  const keys = verifiedReaderPersonKeys(subjectId);
  const selected = corpus.snapshots.filter((snapshot) => keys.includes(snapshot.subjectId));
  const answers = keys.map((key) => ({ key, answer: positionsFor(key, topic, corpus) }));
  const seen = new Set<string>();
  const passages = answers.flatMap(({ key, answer }) => answer.passages.flatMap((passage) => {
    const identity = `${passage.snapshotId}#${passage.quote}`;
    if (seen.has(identity)) return [];
    seen.add(identity);
    return [{ ...passage, canonicalSubjectId: key }];
  }));
  passages.sort((a, b) => b.matchedTerms.length - a.matchedTerms.length || b.retrievedAt.localeCompare(a.retrievedAt) || a.snapshotId.localeCompare(b.snapshotId));
  const readable = selected.filter((snapshot) => snapshot.extraction === "ok" && snapshot.text);
  return { kind: passages.length ? "MATCHED" : readable.length ? "SEARCHED_NOTHING_MATCHED" : "NOT_YET_COLLECTED", topic, passages, canonicalSubjectKeys: keys,
    searched: { pages: new Set(readable.map((snapshot) => snapshot.url)).size, snapshots: readable.length, unreadable: selected.length - readable.length, presentButUnquotable: answers.reduce((count, { answer }) => count + answer.searched.presentButUnquotable, 0) },
    theirPage: answers.find(({ answer }) => answer.theirPage)?.answer.theirPage ?? null };
}
