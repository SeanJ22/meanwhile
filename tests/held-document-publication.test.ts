import assert from "node:assert/strict";
import test from "node:test";
import { artifactId, recordAcquisition, type Artifact } from "../lib/control-plane/evidence/artifact.ts";
import { contentHash } from "../lib/control-plane/ids.ts";
import { MemoryEvidenceStore, objectKey, putArtifact } from "../lib/control-plane/evidence/store.ts";
import { readMeasureSource } from "../lib/ballot/measure-evidence.ts";
import { heldCaptureReader } from "../lib/civic-data/worker-publication-context.ts";
import { heldPageCopies, section3SourceReceipt, captureIntact } from "../lib/civic-data/worker-publication-evidence.ts";
import type { ArtifactRecord } from "../lib/control-plane/repository/types.ts";
import { createMemoryRepositories } from "./helpers/playbooks.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { runMeasureTranslation } from "../lib/translate/runtime.ts";
const at = "2026-10-05T12:00:00Z";
const record = (a: Artifact): ArtifactRecord => ({ artifactId: a.id, workItemId: a.workItemId, routeTaskId: null, attemptId: a.attemptId, tier: a.tier, contentHash: a.contentHash, byteLength: a.byteLength, contentType: a.contentType, canonicalUrl: a.canonicalUrl, partial: false, recordedAt: at });
const acquire = (text: string, contentType: string) => recordAcquisition({ canonicalUrl: "https://clerk.gov/filing.pdf", retrievedAt: at, httpStatus: 200, contentType, sourceId: "clerk.gov", methodRouteId: "fetch", workItemId: "work", attemptId: "attempt", permission: "ALLOWED", transport: "REACHABLE" }, text).artifact;
test("CA-31 hook: held PDF transcription retains its raw document receipt and CSV is discoverable", async () => {
  const store = new MemoryEvidenceStore();
  const raw = "%PDF-1.7 held fixture bytes", text = "Candidate,Office\nAlice Example,Mayor\n";
  const parent = acquire(raw, "application/pdf");
  const hash = contentHash(text);
  const extracted: Artifact = { ...parent, id: artifactId("EXTRACTED_DERIVED", hash), tier: "EXTRACTED_DERIVED", contentHash: hash,
    byteLength: Buffer.byteLength(text), contentType: "text/plain", extraction: { kind: "PDF_TEXT", version: "pdf-transcription/1", complete: true, pages: 1, parent } };
  await putArtifact(store, "freshness", parent, Buffer.from(raw));
  await putArtifact(store, "freshness", extracted, Buffer.from(text));
  const csv = acquire(text + "Bob Example,Council\n", "text/csv");
  assert.deepEqual(heldPageCopies([record(parent), record(extracted), record(csv)], 3).map(row => row.artifactId).sort(), [extracted.id, csv.id].sort());
  const capture = await heldCaptureReader(store)(record(extracted));
  assert.ok(capture && captureIntact(capture));
  assert.equal(capture.evidence.text, text);
  assert.equal(capture.evidence.sourceDocument?.contentHash, parent.contentHash);
  assert.equal(capture.sourceReference?.vault.key, objectKey("freshness", extracted));
  assert.equal(capture.sourceReference?.originals?.[0].vault.key, objectKey("freshness", parent));
  assert.equal(capture.sourceReference?.originals?.[0].sourceHash, parent.contentHash.slice(7));
  assert.equal(capture.originalSourceReceipts?.[0].rawHash, parent.contentHash.slice(7));
  assert.equal(await readMeasureSource(store, capture.sourceReference!), text);
  assert.equal(section3SourceReceipt([capture], at, "section3-validator", "Exact saved transcription").sources[0].rawHash, parent.contentHash.slice(7));
  assert.equal(await heldCaptureReader(store)({ ...record(extracted), partial: true }), null);
});

test("a parser-verified PDF measure publishes with its original receipt without reopening the document", async () => {
  const vault = new MemoryEvidenceStore(), store = new MemoryRoutineDataStore();
  const raw = "%PDF-1.7 original measure", whatItDoes = "The levy funds libraries.", yesMeans = "A YES vote adopts the levy.", noMeans = "A NO vote keeps the current levy.";
  const text = `Proposition 12. ${whatItDoes} ${yesMeans} ${noMeans}`, parent = acquire(raw, "application/pdf"), hash = contentHash(text);
  const extracted: Artifact = { ...parent, id: artifactId("EXTRACTED_DERIVED", hash), tier: "EXTRACTED_DERIVED", contentHash: hash,
    byteLength: Buffer.byteLength(text), contentType: "text/plain", extraction: { kind: "PDF_TEXT", version: "pdf-transcription/1", complete: true, pages: 1, parent } };
  await putArtifact(vault, "freshness", parent, Buffer.from(raw));
  await putArtifact(vault, "freshness", extracted, Buffer.from(text));
  const capture = (await heldCaptureReader(vault)(record(extracted)))!;
  vault.get = vault.stream = async () => { throw new Error("Publication must reuse the parser's verified lineage."); };
  const measure = { contestId: "measure:12", whatItDoes, yesMeans, noMeans, parts: [], sourceUrl: parent.canonicalUrl,
    sourceHash: hash.slice(7), writtenAt: at };
  const result = await runMeasureTranslation({ repos: createMemoryRepositories(), store, primary: capture, captures: [capture], now: at,
    subject: { contestId: measure.contestId, title: "Proposition 12", ocdId: "ocd-division/country:us/state:oh", state: "OH", prior: null },
    transportFor: () => async request => {
      const input = JSON.parse(request.messages[0].content as string);
      assert.equal(input.source ?? input.originalSource, text);
      const sentences = Object.entries({ whatItDoes, yesMeans, noMeans }).map(([field, text]) => ({ field, text, quote: text }));
      const value = request.tools[0].name === "write_measure_translation" ? { measure, sentences }
        : { checked: input.proposal.sentences.map((row: { field: string; text: string }) => ({ ...row, supported: true })) };
      return { model: request.model, stop_reason: "tool_use", content: [{ type: "tool_use", id: "result", name: request.tools[0].name, input: value }],
        usage: { input_tokens: 100, output_tokens: 50 } };
    } });
  assert.equal(result.status, "PUBLISHED", JSON.stringify(result));
  const published = (await store.readCandidate(result.versionId!))!;
  const receipts = published.candidate.retrieval.manualSourceReceipt!.sources;
  assert.equal(receipts.length, 1, "the parser's original-byte receipt and lineage receipt describe the same exact source");
  assert.equal(receipts[0].rawHash, parent.contentHash.slice(7));
  assert.deepEqual(capture.sourceReference?.originals?.map(original => original.sourceHash), [receipts[0].rawHash]);
});
