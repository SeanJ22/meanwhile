import { positionMatchCount, positionsFor, searchTerms } from "../corpus/positions.ts";
import { unifiedCorpus } from "../corpus/unified.ts";
import type { StatementCorpus } from "../corpus/types.ts";
import type { EvidenceGap, EvidenceRecord, EvidenceSubject } from "./evidence.ts";

/** Search the same committed, quoted evidence as the Positions reader. */
export function statementEvidenceFor(
  subject: EvidenceSubject,
  question: string,
  canonicalKeys: readonly string[],
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
  const keys = [...new Set(canonicalKeys.filter(Boolean))];
  const answers = keys.map((key) => ({ key, answer: positionsFor(key, topic, corpus) }));
  const ids = new Set<string>();
  for (const { key, answer } of answers) {
    for (const passage of answer.passages) {
      const id = `${passage.snapshotId}#${passage.quote}`;
      if (ids.has(id)) continue;
      ids.add(id);
      records.push({
        kind: "POSITION", id: passage.snapshotId, subjectId: subject.id,
        canonicalSubjectId: key,
        text: `Searching ${subject.name}'s published material for ${topic} found this passage: "${passage.quote}"`,
        sourceUrl: passage.url, retrievedAt: passage.retrievedAt,
      });
    }
  }
  const selected = corpus.snapshots.filter((snapshot) => keys.includes(snapshot.subjectId));
  denominators.statementSnapshotsRead = selected.filter((s) => s.extraction === "ok" && s.text).length;
  denominators.statementPagesRead = new Set(selected.filter((s) => s.extraction === "ok" && s.text).map((s) => s.url)).size;
  denominators.statementSnapshotsUnreadable = selected.filter((s) => s.extraction !== "ok" || !s.text).length;
  denominators.statementPassagesReturned = records.length;
  denominators.statementPassagesMatched = keys.reduce((sum, key) => sum + positionMatchCount(key, topic, corpus), 0);
  if (records.length === 0) {
    const unquotable = answers.reduce((sum, row) => sum + row.answer.searched.presentButUnquotable, 0);
    gaps.push({ whose: "OURS", statement: unquotable > 0
      ? `The held pages for ${subject.name} mention ${topic}, but the matching text is not a quotable passage.`
      : denominators.statementPagesRead > 0
        ? `Our search of ${subject.name}'s held published pages found no quotable passage matching ${topic}.`
        : `We have no readable published statement linked to ${subject.name} for this search.` });
  }
  return { records, gaps, denominators };
}
