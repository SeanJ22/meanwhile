import { currentExtraction } from "../candidates/corpus.ts";
import type { CandidateCorpus, CandidateDocument } from "../candidates/corpus.ts";
import { getCandidateCorpus } from "../candidates/positions.ts";
import { currentOfficeholderStatements } from "./data-plane.ts";
import type { SourceSnapshot, StatementCorpus } from "./types.ts";
import { sweepPeople } from "./statement-sweep.ts";
import type { SweepPerson, SweepRecord } from "./statement-sweep.ts";

/**
 * The positions search index: the union of the officeholder statement
 * projection and the candidate document projection, in one snapshot shape.
 * Only the current extraction of each candidate document is included, so no
 * passage the current extractor no longer produces is quoted.
 */

/** The candidate-keyed canonical promoted projection. */
function candidates(): CandidateCorpus {
  return getCandidateCorpus();
}

/** The officeholder-keyed canonical promoted projection. */
function readerStatementSnapshots(): readonly SourceSnapshot[] {
  return currentOfficeholderStatements().snapshots;
}

/**
 * One candidate document in the snapshot shape. The subject name is the
 * candidate key: display only, never a join key, and never a guessed name.
 */
export function snapshotFromCandidateDocument(doc: CandidateDocument): SourceSnapshot {
  return {
    id: doc.id,
    subjectId: doc.candidateKey,
    subjectName: doc.candidateKey,
    kind: doc.sourceClass === "CAMPAIGN_SITE" ? "CAMPAIGN_SITE" : "OFFICIAL_PAGE",
    url: doc.documentUrl,
    contentHash: doc.contentHash,
    ...(doc.sourceRevision ? { sourceRevision: doc.sourceRevision } : {}),
    retrievedAt: doc.retrievedAt,
    // A held document was retrieved; no reader sees this status.
    httpStatus: 200,
    // Any extraction value other than "html" maps to failed.
    extraction: doc.extraction === "html" ? "ok" : "failed",
    text: doc.text ?? null,
    title: null,
  };
}

/** Build the shared shape from whichever independently held corpora succeeded. */
export function unifiedCorpusFromHoldings(input: {
  readonly candidateCorpus?: CandidateCorpus;
  readonly officeholderStatements?: StatementCorpus;
}): StatementCorpus {
  const fromStatements = input.officeholderStatements?.snapshots ?? [];
  const fromCandidates = currentExtraction(input.candidateCorpus?.documents ?? [])
    .map(snapshotFromCandidateDocument);
  return { snapshots: [...fromStatements, ...fromCandidates] };
}

/** Both corpora, one snapshot list. */
export function unifiedCorpus(): StatementCorpus {
  return unifiedCorpusFromHoldings({
    candidateCorpus: candidates(),
    officeholderStatements: { snapshots: [...readerStatementSnapshots()] },
  });
}

/** Counts per half of the union. */
export function unifiedCorpusCounts() {
  const fromStatements = readerStatementSnapshots();
  const current = currentExtraction(candidates().documents);
  const all = unifiedCorpus().snapshots;
  return {
    statements: fromStatements.length,
    statementSubjects: new Set(fromStatements.map((s) => s.subjectId)).size,
    candidateDocuments: current.length,
    candidateSubjects: new Set(current.map((d) => d.candidateKey)).size,
    total: all.length,
    subjects: new Set(all.map((s) => s.subjectId)).size,
    readable: all.filter((s) => s.extraction === "ok" && s.text).length,
  };
}

/**
 * One sweep record per person and topic, listing the sources searched. People
 * with no held page still get a record, reading "not yet collected".
 */
export function unifiedStatementSweep(
  people: readonly SweepPerson[],
  topics?: readonly string[],
): SweepRecord[] {
  return sweepPeople(people, unifiedCorpus(), topics);
}
