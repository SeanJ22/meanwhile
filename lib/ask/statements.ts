import { searchTerms } from "../corpus/positions.ts";
import { readerPositionsFor, readerPositionsForKeys } from "../corpus/reader-positions.ts";
import { ReaderPersonIdentityError } from "../identity/reader-person.ts";
import { unifiedCorpus } from "../corpus/unified.ts";
import type { StatementCorpus } from "../corpus/types.ts";
import type { EvidenceGap, EvidenceRecord, EvidenceSubject } from "./evidence.ts";

export function statementEvidenceFor(
  states: readonly string[],
  subject: EvidenceSubject,
  question: string,
  _canonicalKeys: readonly string[],
  readCorpus: () => StatementCorpus = () => unifiedCorpus(states),
  provenKeys?: readonly string[],
): { records: EvidenceRecord[]; gaps: EvidenceGap[]; denominators: Record<string, number> } {
  const records: EvidenceRecord[] = [];
  const gaps: EvidenceGap[] = [];
  const denominators: Record<string, number> = {};
  if (subject.kind !== "PERSON" || !/\b(say|said|says|think|thought|position|positions|stance|views?|published|statement|believe|believes|support|oppose)\b/i.test(question)) {
    return { records, gaps, denominators };
  }
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
  try { answer = provenKeys ? readerPositionsForKeys(subject.id, topic, corpus, provenKeys) : readerPositionsFor(states, subject.id, topic, corpus); }
  catch (error) {
    denominators[error instanceof ReaderPersonIdentityError ? "statementIdentityUnresolved" : "statementLoaderFailures"] = 1;
    gaps.push({ whose: "OURS", statement: error instanceof ReaderPersonIdentityError ? error.message : `The published statements for ${subject.name} could not be read for this answer.` });
    return { records, gaps, denominators };
  }
  const snapshots = new Map(corpus.snapshots.map(snapshot => [snapshot.id, snapshot]));
  const latestBySource = new Map<string, string>();
  for (const snapshot of corpus.snapshots) {
    const key = `${snapshot.subjectId}\u0000${snapshot.url}`;
    const previous = snapshots.get(latestBySource.get(key) ?? "");
    if (!previous || snapshot.retrievedAt > previous.retrievedAt ||
      (snapshot.retrievedAt === previous.retrievedAt && snapshot.id > previous.id)) latestBySource.set(key, snapshot.id);
  }
  for (const passage of answer.passages) {
    const snapshot = snapshots.get(passage.snapshotId);
    const source = passage.kind === "CAMPAIGN_SITE" ? "campaign page" : "official page";
    const latest = snapshot ? latestBySource.get(`${snapshot.subjectId}\u0000${snapshot.url}`) : null;
    const version = latest === null || latest === undefined ? "Source version status unknown." :
      latest === passage.snapshotId ? "Latest captured version." : "Earlier captured version, not the latest captured page.";
      records.push({
        kind: "SOURCE_PASSAGE", id: passage.snapshotId, subjectId: subject.id,
        canonicalSubjectId: passage.canonicalSubjectId,
        text: `Searching a held ${source} linked to ${subject.name} for ${topic} found this passage: "${passage.quote}". ` +
          `${version} Read ${passage.retrievedAt}. A phrase match does not establish a personal stance or the passage's speaker.`,
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
