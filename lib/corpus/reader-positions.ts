import { positionsFor, type PositionAnswer, type PositionPassage } from "./positions.ts";
import { unifiedCorpus } from "./unified.ts";
import type { StatementCorpus } from "./types.ts";
import { verifiedReaderPersonKeys } from "../identity/reader-person.ts";
import { sourceCaptureFingerprint } from "../candidates/corpus.ts";

export interface ReaderPositionAnswer extends PositionAnswer {
  canonicalSubjectKeys: string[];
  passages: (PositionPassage & { canonicalSubjectId: string })[];
}

/** Search only the exact identity keys already established by the caller. */
export function readerPositionsForKeys(
  subjectId: string,
  topic: string,
  corpus: StatementCorpus,
  keys: readonly string[],
): ReaderPositionAnswer {
  const canonicalKeys = [...new Set(keys.length ? keys : [subjectId])].sort();
  const captures = new Map<string, string>();
  const selected = corpus.snapshots.filter((snapshot) => {
    if (!canonicalKeys.includes(snapshot.subjectId)) return false;
    const capture = sourceCaptureFingerprint(snapshot.sourceRevision, snapshot.contentHash,
      snapshot.url, snapshot.retrievedAt);
    if (capture === null) return true;
    const priorKey = captures.get(capture);
    if (priorKey !== undefined && priorKey !== snapshot.subjectId) return false;
    captures.set(capture, snapshot.subjectId);
    return true;
  });
  const selectedCorpus = { snapshots: selected };
  const answers = canonicalKeys.map((key) => ({ key, answer: positionsFor(key, topic, selectedCorpus) }));
  const seen = new Set<string>();
  const passages = answers.flatMap(({ key, answer }) => answer.passages.flatMap((passage) => {
    const identity = `${passage.snapshotId}#${passage.quote}`;
    if (seen.has(identity)) return [];
    seen.add(identity);
    return [{ ...passage, canonicalSubjectId: key }];
  }));
  passages.sort((a, b) => b.matchedTerms.length - a.matchedTerms.length || b.retrievedAt.localeCompare(a.retrievedAt) || a.snapshotId.localeCompare(b.snapshotId));
  const readable = selected.filter((snapshot) => snapshot.extraction === "ok" && snapshot.text);
  return { kind: passages.length ? "MATCHED" : readable.length ? "SEARCHED_NOTHING_MATCHED" : "NOT_YET_COLLECTED", topic, passages, canonicalSubjectKeys: canonicalKeys,
    searched: { pages: new Set(readable.map((snapshot) => snapshot.url)).size, snapshots: readable.length, unreadable: selected.length - readable.length, presentButUnquotable: answers.reduce((count, { answer }) => count + answer.searched.presentButUnquotable, 0) },
    theirPage: answers.find(({ answer }) => answer.theirPage)?.answer.theirPage ?? null };
}

/** One sourced passage answer, whether the caller has an official or card ID. */
export function readerPositionsFor(states: readonly string[], subjectId: string, topic: string, corpus: StatementCorpus = unifiedCorpus(states)): ReaderPositionAnswer {
  return readerPositionsForKeys(subjectId, topic, corpus, verifiedReaderPersonKeys(subjectId));
}
