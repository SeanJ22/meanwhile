import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { ADMIN_ORIGIN } from "../lib/ops/origins.ts";
import { GET, originalEvidenceAttachment } from "../app/api/admin/evidence/[workItemId]/[attemptId]/[artifactId]/route.ts";
import { contentHash } from "../lib/control-plane/ids.ts";
import { artifactId } from "../lib/control-plane/evidence/artifact.ts";
import type { ArtifactRecord } from "../lib/control-plane/repository/types.ts";

const ids = { params: Promise.resolve({ workItemId: "wi-123", attemptId: "at-456", artifactId: "ar-789" }) };

test("private original route hides on the public host before storage access", async () => {
  const request = new NextRequest("https://meanwhileusa.com/api/admin/evidence/wi-123/at-456/ar-789", {
    headers: { host: "meanwhileusa.com" },
  });
  const response = await GET(request, ids);
  assert.equal(response.status, 404);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("private original route requires a valid Admin session before reading an artifact", async () => {
  const host = new URL(ADMIN_ORIGIN).host;
  const request = new NextRequest(`${ADMIN_ORIGIN}/api/admin/evidence/wi-123/at-456/ar-789`, {
    headers: { host },
  });
  const response = await GET(request, ids);
  assert.equal(response.status, 401);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});

test("verified HTML source bytes are exact but always delivered as an inert attachment", async () => {
  const bytes = new TextEncoder().encode("<html><script>alert('source code')</script></html>");
  const hash = contentHash(bytes);
  const id = artifactId("RAW", hash);
  const record: ArtifactRecord = { artifactId: id, workItemId: "wi-123", attemptId: "at-456", routeTaskId: null,
    tier: "RAW", contentHash: hash, byteLength: bytes.length, contentType: "text/html",
    canonicalUrl: "https://city.example.gov/record", partial: false, recordedAt: "2026-09-28T00:00:00Z" };
  const response = originalEvidenceAttachment(record, { bytes, copy: { artifactId: id, workItemId: record.workItemId,
    attemptId: record.attemptId, contentHash: hash, byteLength: bytes.length, tier: "RAW", source: "VERIFIED_ORIGINAL_CAPTURE" } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/octet-stream");
  assert.match(response.headers.get("content-disposition") ?? "", /^attachment;/);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-security-policy") ?? "", /sandbox/);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
});

test("verified binary PDF source bytes are an exact inert download, never an inline PDF", async () => {
  const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 10, 0, 255]);
  const hash = contentHash(bytes);
  const id = artifactId("RAW", hash);
  const record: ArtifactRecord = { artifactId: id, workItemId: "wi-123", attemptId: "at-456", routeTaskId: null,
    tier: "RAW", contentHash: hash, byteLength: bytes.length, contentType: "application/pdf",
    canonicalUrl: "https://city.example.gov/agenda.pdf", partial: false, recordedAt: "2026-09-28T00:00:00Z" };
  const response = originalEvidenceAttachment(record, { bytes, copy: { artifactId: id, workItemId: record.workItemId,
    attemptId: record.attemptId, contentHash: hash, byteLength: bytes.length, tier: "RAW", source: "VERIFIED_ORIGINAL_CAPTURE" } });
  assert.equal(response.headers.get("content-type"), "application/octet-stream");
  assert.match(response.headers.get("content-disposition") ?? "", /^attachment;/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
});
