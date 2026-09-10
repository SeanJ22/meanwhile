import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { unifiedCorpus } from "../../lib/corpus/unified.ts";
import { positionsFor, searchTerms } from "../../lib/corpus/positions.ts";
import { readerPositionsFor } from "../../lib/corpus/reader-positions.ts";
import { BALLOT_SOURCES } from "../../lib/ballot/registry.ts";
import { lineupForContest } from "../../lib/ballot/general-lineup.ts";
import { ballotAskInventory, type BallotSubjectRecord } from "../../lib/ask/ballot-inventory.ts";
import { allSeatHolders } from "../../lib/registry/server.ts";
import { reconciledCandidacyIdForCard } from "../../lib/identity/az-2026.ts";
import type { AskAnswerPayload } from "../../lib/ask/answer.ts";
import { synthesisContextPayload } from "../../lib/ask/synthesize.ts";
import type { EvidencePack, EvidenceRecord } from "../../lib/ask/evidence.ts";
export async function corpusAskProof() {
delete process.env.ANTHROPIC_API_KEY;
process.env.WTP_LIMIT_LOG_IP_PER_MINUTE = "10000";
const { POST, resetGroundedState } = await import("../../app/api/ask/grounded/route.ts");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const sourcePaths = ["app/api/ask/grounded/route.ts", "lib/ask/statements.ts", "lib/ask/synthesize.ts", "lib/ask/subject.ts", "lib/ask/resolve.ts", "lib/ask/ballot-inventory.ts", "lib/ask/server-sources.ts", "lib/funding/campaign-money.ts", "lib/registry/runtime-data-plane.ts", "lib/registry/runtime-read-model.ts", "lib/corpus/data-plane.ts", "lib/corpus/statement-identity-transfer.ts", "lib/corpus/fixtures/statement-identity-first-seed-v1.json", "lib/corpus/unified.ts", "lib/corpus/positions.ts", "lib/corpus/reader-positions.ts", "lib/identity/reader-person.ts", "data/corpus/statements.json", "data/candidates/corpus-2026.json"];
const sourceHashes = sourcePaths.map((path) => ({ path, sha256: hash(readFileSync(path, "utf8")) }));
const canonicalBallot = new Map<string, BallotSubjectRecord>();
for (const { source } of BALLOT_SOURCES) {
  const set = source.normalize(await source.fetch());
  const inventory = ballotAskInventory(set, set.contests, (id) => lineupForContest(id)?.nominees ?? []);
  for (const subject of inventory.subjects.values()) if (subject.kind === "PERSON") {
    canonicalBallot.set(subject.id, subject);
    const candidacy = reconciledCandidacyIdForCard(subject.id) ?? subject.candidacyId;
    if (candidacy) canonicalBallot.set(candidacy, subject);
  }
}
const holders = new Map((await allSeatHolders()).map((holder) => [holder.id, holder]));
const corpus = unifiedCorpus();
const subjectKeys = [...new Set(corpus.snapshots.map((snapshot) => snapshot.subjectId))].sort();
const names = new Set([...canonicalBallot.values()].flatMap((subject) => searchTerms(subject.name)).concat([...holders.values()].flatMap((holder) => searchTerms(holder.name))));
const proofs = [];
for (const snapshot of corpus.snapshots) {
  const subjectId = snapshot.subjectId;
  const readable = snapshot.extraction === "ok" && snapshot.text ? [snapshot] : [];
  const candidate = canonicalBallot.get(subjectId);
  const holder = holders.get(subjectId);
  const displayName = candidate?.name ?? holder?.name ?? snapshot.subjectName;
  const words = [...new Set(readable.flatMap((snapshot) => snapshot.text!.match(/\b[A-Za-z]{5,}\b/g) ?? []))];
  const topic = words.find((word) => !names.has(word.toLowerCase()) && positionsFor(subjectId, word, corpus).passages.some((passage) => passage.snapshotId === snapshot.id));
  if (!topic) {
    proofs.push({ subjectId, snapshotId: snapshot.id, executionLevel: "NOT_EXECUTED", readableSnapshotIds: readable.map((snapshot) => snapshot.id), reason: readable.length ? "No quotable matching passage in this current canonical snapshot after testing its non-name content words." : `No readable extraction for this snapshot (extraction=${snapshot.extraction}).` });
    continue;
  }
  const expected = readerPositionsFor(subjectId, topic, corpus);
  const question = `What does ${displayName} say about ${topic}?`;
  const state = candidate?.ocdId.split("/").slice(0, 3).join("/") ?? `ocd-division/country:us/state:${holder?.state?.toLowerCase() ?? "az"}`;
  const request = { question, surface: candidate ? "BALLOT" : "MAP", ocdIds: [...new Set([state, ...(candidate ? [candidate.ocdId] : [])])], today: "2026-09-04", activeSubjects: [{ id: candidate?.id ?? subjectId, name: displayName, kind: "PERSON", focused: true }] };
  resetGroundedState();
  const response = await POST(new Request("https://wtp.test/api/ask/grounded", { method: "POST", headers: { "content-type": "application/json", origin: "https://wtp.test", "x-wtp-synthetic-run": "reader-last-mile-corpus-proof" }, body: JSON.stringify(request) }));
  const payloadText = await response.text();
  const payload = JSON.parse(payloadText) as AskAnswerPayload;
  const records = payload.records ?? [];
  const matching = records.filter((record) => record.kind === "POSITION" && record.canonicalSubjectId === subjectId);
  const expectedRecords = expected.passages.filter((passage) => passage.snapshotId === snapshot.id).map((passage) => ({ id: passage.snapshotId, quote: passage.quote, sourceUrl: passage.url, retrievedAt: passage.retrievedAt }));
  const missing = expectedRecords.filter((passage) => !matching.some((record) => record.id === passage.id && record.text.includes(passage.quote) && record.sourceUrl === passage.sourceUrl && record.retrievedAt === passage.retrievedAt));
  const pack: EvidencePack = { question, records, gaps: payload.gaps, denominators: payload.denominators, subject: payload.subject, intent: "PERSON_RECORD", temporal: { kind: "NONE" }, today: request.today };
  const synthesisReceivesEveryRecord = JSON.stringify((JSON.parse(synthesisContextPayload(pack)) as { records: EvidenceRecord[] }).records) === JSON.stringify(records);
  const countAgrees = payload.trace?.retrieval.recordCount === records.length;
  proofs.push({ subjectId, snapshotId: snapshot.id, executionLevel: "REAL_ROUTE_HANDLER", request, httpStatus: response.status, mode: payload.mode, resolvedSubjectId: payload.subject?.id ?? null, payloadSha256: hash(payloadText), modelAnswer: payload.answer, expectedRecordIds: [...new Set(expectedRecords.map((record) => record.id))], expectedRecords, retrievedRecordIds: [...new Set(records.map((record) => record.id))], retrievedCanonicalPositionIds: [...new Set(matching.map((record) => record.id))], returnedRecords: records, traceRecordCount: payload.trace?.retrieval.recordCount ?? null, actualRecordCount: records.length, countAgrees, synthesisReceivesEveryRecord, missingExpectedRecords: missing, gaps: payload.gaps, currentIdentityAvailable: Boolean(candidate || holder), status: response.status === 200 && payload.answer === null && countAgrees && synthesisReceivesEveryRecord && missing.length === 0 ? "PROVEN" : "ELIGIBLE_QUERY_NOT_FULLY_RETRIEVED" });
}
const pilotArtifactPath = "docs/evidence/reader-last-mile-ask-after.json";
const pilotArtifact = readFileSync(pilotArtifactPath, "utf8");
const pilotReadbacks = (JSON.parse(pilotArtifact) as { readbacks: { zip: string; question?: string; status?: number; payload?: AskAnswerPayload }[] }).readbacks;
const pilotProofs = pilotReadbacks.flatMap((row) => row.payload ? [{ executionLevel: "REAL_ROUTE_HANDLER", sourceArtifact: pilotArtifactPath, sourceArtifactSha256: hash(pilotArtifact), zip: row.zip, request: { question: row.question }, httpStatus: row.status, mode: row.payload.mode, resolvedSubjectId: row.payload.subject?.id ?? null, returnedRecordIds: [...new Set(row.payload.records.map((record) => record.id))], returnedRecords: row.payload.records, modelAnswer: row.payload.answer, traceRecordCount: row.payload.trace.retrieval.recordCount, actualRecordCount: row.payload.records.length, countAgrees: row.payload.trace.retrieval.recordCount === row.payload.records.length, payloadSha256: hash(JSON.stringify(row.payload)), gaps: row.payload.gaps }] : []);
const output = { purpose: "Executed canonical Ask POST proof for each current quotable snapshot, selecting a known-answer query whose canonical selector returns a verbatim passage from that exact snapshot. Unreadable or unquotable snapshots remain explicitly unexecuted. This proves source retrieval and attribution, not that every possible question can be answered.", modelDisabled: true, exactHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), executionLevel: "REAL_ROUTE_HANDLER", sourceHashScope: "Working-tree source bytes; not a deployed build proof", sourceHashes, corpusSnapshotCount: corpus.snapshots.length, subjectCount: subjectKeys.length, proofs, pilotProofs };
return output;
}
