import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReaderCensus } from "../../lib/holdings/reader-census.ts";
import { unifiedCorpus } from "../../lib/corpus/unified.ts";
import { positionsFor } from "../../lib/candidates/positions.ts";

const DEFAULT_OUTPUT = "docs/evidence/reader-last-mile-candidate-corpus-map.json";

export function readerCandidateCorpusMapOutput(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  if (!("READER_CANDIDATE_CORPUS_MAP_OUTPUT" in environment)) return DEFAULT_OUTPUT;
  const output = environment.READER_CANDIDATE_CORPUS_MAP_OUTPUT?.trim();
  assert.ok(output, "READER_CANDIDATE_CORPUS_MAP_OUTPUT is present but empty");
  return output;
}

export function generateReaderCandidateCorpusMap(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): void {
  const census = buildReaderCensus(process.cwd());
  const corpus = unifiedCorpus();
  const records = census.records.filter(record => record.family === "candidate-corpus" && record.eligibility.state === "READER_ELIGIBLE").map(record => {
    const snapshot = corpus.snapshots.find(snapshot => record.canonicalIdentity.includes(snapshot.id));
    if (!snapshot) throw new Error(record.auditId);
    return { auditId: record.auditId, snapshotId: snapshot.id, subjectId: snapshot.subjectId, sourceUrl: snapshot.url, selector: "positionsFor(subjectId), or PositionsQuestion /api/positions subject query", curated: positionsFor(snapshot.subjectId), sourceSnapshot: snapshot };
  });
  writeFileSync(readerCandidateCorpusMapOutput(environment), JSON.stringify({ holdingsDigest: census.holdingsDigest, records }, null, 2) + "\n");
  console.log(JSON.stringify({ records: records.length, subjectIds: [...new Set(records.map(record => record.subjectId))] }));
}

const main = typeof process.argv[1] === "string" &&
  resolve(process.argv[1]).toLowerCase() === resolve(fileURLToPath(import.meta.url)).toLowerCase();

if (main) generateReaderCandidateCorpusMap();
