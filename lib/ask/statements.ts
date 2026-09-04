import { searchTerms } from "../corpus/positions.ts";
import { readerPositionsFor } from "../corpus/reader-positions.ts";
import { ReaderPersonIdentityError } from "../identity/reader-person.ts";
import { unifiedCorpus } from "../corpus/unified.ts";
import type { StatementCorpus } from "../corpus/types.ts";
import type { EvidenceGap, EvidenceRecord, EvidenceSubject } from "./evidence.ts";

/** Search the same committed, quoted evidence as the Positions reader. */
export function statementEvidenceFor(
  subject: EvidenceSubject,
  question: string,
  _canonicalKeys: readonly string[],
  readCorpus: () => StatementCorpus = unifiedCorpus,
): { records: EvidenceRecord[]; gaps: EvidenceGap[]; denominators: Record<string, number> } {
  const records: EvidenceRecord[] = [];
  const gaps: EvidenceGap[] = [];
  const denominators: Record<string, number> = {};
  if (subject.kind !== "PERSON" || !/\b(say|said|says|think|thought|position|positions|stance|views?|published|statement|believe|believes|support|oppose)\b/i.test(question)) {
    return { records, gaps, denominators };
  }
  // Entity words locate a person; they are not the topic we are searching for.
  const names = new Set(searchTerms(subject.name));
  const topic = searchTerms(question).filter((word) => !names.has(word)).join(" ");
  if (!topic) return { records, gaps, denominators };
  let corpus: StatementCorpus;
  try { corpus = readCorpus(); }
  catch {
    gaps.push({ whose: "OURS", statement: `The published statements for ${subject.name} could not be read for this answer.` });
    denominators.statementLoaderFailures = 1;
    return { records, gaps, denominators };
  }
  let answer;
  try { answer = readerPositionsFor(subject.id, topic, corpus); }
  catch (error) {
    denominators[error instanceof ReaderPersonIdentityError ? "statementIdentityUnresolved" : "statementLoaderFailures"] = 1;
    gaps.push({ whose: "OURS", statement: error instanceof ReaderPersonIdentityError ? error.message : `The published statements for ${subject.name} could not be read for this answer.` });
    return { records, gaps, denominators };
  }
    for (const passage of answer.passages) {
      records.push({
        kind: "POSITION", id: passage.snapshotId, subjectId: subject.id,
        canonicalSubjectId: passage.canonicalSubjectId,
        text: `Searching ${subject.name}'s published material for ${topic} found this passage: "${passage.quote}"`,
        sourceUrl: passage.url, retrievedAt: passage.retrievedAt,
      });
    }
  denominators.statementSnapshotsRead = answer.searched.snapshots;
  denominators.statementPagesRead = answer.searched.pages;
  denominators.statementSnapshotsUnreadable = answer.searched.unreadable;
  denominators.statementPassagesReturned = records.length;
  denominators.statementPassagesMatched = answer.passages.length;
  if (records.length === 0) {
    const unquotable = answer.searched.presentButUnquotable;
    gaps.push({ whose: "OURS", statement: unquotable > 0
      ? `The held pages for ${subject.name} mention ${topic}, but the matching text is not a quotable passage.`
      : denominators.statementPagesRead > 0
        ? `Our search of ${subject.name}'s held published pages found no quotable passage matching ${topic}.`
        : `We have no readable published statement linked to ${subject.name} for this search.` });
  }
  return { records, gaps, denominators };
}
