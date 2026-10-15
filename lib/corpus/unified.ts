import { currentExtraction } from "../candidates/corpus.ts";
import type { CandidateCorpus, CandidateDocument } from "../candidates/corpus.ts";
import { getCandidateCorpus } from "../candidates/positions.ts";
import { currentOfficeholderStatements } from "./data-plane.ts";
import type { SourceSnapshot, StatementCorpus } from "./types.ts";
import { sweepPeople } from "./statement-sweep.ts";
import type { SweepPerson, SweepRecord } from "./statement-sweep.ts";

function candidates(states: readonly string[]): CandidateCorpus {
  const corpora = [...new Set(states)].map(state => getCandidateCorpus(state));
  const first = corpora[0];
  if (!first) throw new Error("Candidate corpus requires named states.");
  return { ...first, documents: corpora.flatMap(corpus => corpus.documents), failures: corpora.flatMap(corpus => corpus.failures),
    attempted: corpora.reduce((sum, corpus) => sum + corpus.attempted, 0) };
}

/** The officeholder-keyed canonical promoted projection. */
function readerStatementSnapshots(): readonly SourceSnapshot[] {
  return currentOfficeholderStatements().snapshots;
}

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
export function unifiedCorpus(states: readonly string[]): StatementCorpus {
  return unifiedCorpusFromHoldings({
    candidateCorpus: candidates(states),
    officeholderStatements: { snapshots: [...readerStatementSnapshots()] },
  });
}

/** Counts per half of the union. */
export function unifiedCorpusCounts(states: readonly string[]) {
  const fromStatements = readerStatementSnapshots();
  const current = currentExtraction(candidates(states).documents);
  const all = unifiedCorpus(states).snapshots;
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

export function unifiedStatementSweep(
  states: readonly string[],
  people: readonly SweepPerson[],
  topics?: readonly string[],
): SweepRecord[] {
  return sweepPeople(people, unifiedCorpus(states), topics);
}
