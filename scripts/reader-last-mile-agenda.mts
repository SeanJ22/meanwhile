import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import {
  readMeetingsProjection,
  requireReaderProofMeetingsProjection,
} from "../lib/meetings/snapshot.ts";
import { floored } from "../lib/ops/denominator-floor.ts";
import { classifyAgendaPublication } from "../lib/ask/agenda-publication.ts";
import {
  prepareReaderProofRuntime,
  requiredPreparedReaderProofMeetingsAuthority,
} from "./lib/reader-proof-runtime.ts";

const base = process.env.SHOOT_BASE_URL ?? "http://localhost:3210";
const outputPath = process.env.READER_PROOF_OUTPUT ?? "docs/evidence/reader-last-mile-agenda.json";
assert.match(new URL(base).hostname, /^(localhost|127\.0\.0\.1)$/);
await prepareReaderProofRuntime();
const snapshot = requireReaderProofMeetingsProjection(
  await readMeetingsProjection({ bypassCache: true }),
  requiredPreparedReaderProofMeetingsAuthority(),
);
const documents = snapshot.agendaDocuments ?? [];
floored("agenda document delivery", "every stored agenda document version", documents.length, documents.length);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const records = [];
for (const meetingId of [...new Set(documents.map(row => row.meetingId))].sort()) {
  const expected = documents.filter(row => row.meetingId === meetingId).sort((a, b) => Date.parse(b.retrievedAt) - Date.parse(a.retrievedAt));
  const response = await fetch(`${base}/api/agenda?meetingId=${encodeURIComponent(meetingId)}`);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.holdingStatus, "HELD");
  assert.equal(result.meetingId, meetingId);
  assert.equal(result.documentCount, expected.length);
  const meeting = snapshot.meetings.find(row => row.id === meetingId);
  const classification = classifyAgendaPublication({ meetingId, bodyName: meeting?.bodyName ?? "the publisher", documentsForMeeting: expected, documentsAcrossCorpus: documents, discoveredDocumentUrl: meeting?.agendaUrl, now: Date.now() });
  assert.equal(result.publication.acquisition, classification.acquisition);
  assert.deepEqual(result.documents, expected.map(row => ({ id: row.id, documentUrl: row.documentUrl, contentHash: row.contentHash, retrievedAt: row.retrievedAt, contentType: row.contentType, extraction: row.extraction, extractionNote: row.extractionNote, text: row.text, sourceOrg: row.sourceOrg })));
  records.push({ surface: "agenda", meetingId, bodyId: meeting?.bodyId ?? null, expectedIds: expected.map(row => row.id), returnedIds: result.documents.map((row: { id: string }) => row.id), returnedCount: result.documentCount, documents: result.documents, publication: result.publication, payloadSha256: hash(JSON.stringify(result)) });
}
writeFileSync(outputPath, JSON.stringify({ exactHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), buildId: readFileSync(".next/BUILD_ID", "utf8").trim(), sourceHashes: Object.fromEntries(["app/api/agenda/route.ts", "lib/meetings/snapshot.ts", "lib/civic-data/meeting-partitions.ts", "scripts/lib/reader-proof-runtime.ts"].map(path => [path, hash(readFileSync(path, "utf8"))])), expectedCount: documents.length, returnedCount: records.reduce((n, row) => n + row.returnedCount, 0), execution: "Actual HTTP agenda route against local deployed production build; every exact promoted document version, identity, text, extraction state and provenance compared.", records }, null, 2) + "\n");
console.log(JSON.stringify({ meetings: records.length, documents: documents.length }));
