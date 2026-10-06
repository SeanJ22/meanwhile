import assert from "node:assert/strict";
import test from "node:test";
import { artifactId, recordAcquisition, type Artifact } from "../lib/control-plane/evidence/artifact.ts";
import { contentHash } from "../lib/control-plane/ids.ts";
import { MemoryEvidenceStore, putArtifact } from "../lib/control-plane/evidence/store.ts";
import { heldCaptureReader } from "../lib/civic-data/worker-publication-context.ts";
import { heldPageCopies, section3SourceReceipt, captureIntact } from "../lib/civic-data/worker-publication-evidence.ts";
import type { ArtifactRecord } from "../lib/control-plane/repository/types.ts";
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
  assert.equal(section3SourceReceipt([capture], at, "section3-validator", "Exact saved transcription").sources[0].rawHash, parent.contentHash.slice(7));
  assert.equal(await heldCaptureReader(store)({ ...record(extracted), partial: true }), null);
});
