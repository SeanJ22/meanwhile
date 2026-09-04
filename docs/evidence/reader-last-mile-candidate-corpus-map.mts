import { writeFileSync } from "node:fs";
import { buildReaderCensus } from "../../lib/holdings/reader-census.ts";
import { unifiedCorpus } from "../../lib/corpus/unified.ts";
import { positionsFor } from "../../lib/candidates/positions.ts";
const census = buildReaderCensus(process.cwd());
const corpus = unifiedCorpus();
const records = census.records.filter(record => record.family === "candidate-corpus" && record.eligibility.state === "READER_ELIGIBLE").map(record => {
  const snapshot = corpus.snapshots.find(snapshot => record.canonicalIdentity.includes(snapshot.id));
  if (!snapshot) throw new Error(record.auditId);
  return { auditId: record.auditId, snapshotId: snapshot.id, subjectId: snapshot.subjectId, sourceUrl: snapshot.url, selector: "positionsFor(subjectId), or PositionsQuestion /api/positions subject query", curated: positionsFor(snapshot.subjectId), sourceSnapshot: snapshot };
});
writeFileSync("docs/evidence/reader-last-mile-candidate-corpus-map.json", JSON.stringify({ holdingsDigest: census.holdingsDigest, records }, null, 2) + "\n");
console.log(JSON.stringify({ records: records.length, subjectIds: [...new Set(records.map(record => record.subjectId))] }));
