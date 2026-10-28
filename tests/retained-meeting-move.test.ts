import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { holdMeetingResponses } from "../lib/civic-data/retained-meeting-bytes.ts";
import { readRawCapture } from "../lib/civic-data/raw-capture-vault.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";

test("moving a retained meeting response verifies bytes and is repeatable", async () => {
  const vault = new MemoryEvidenceStore();
  const bytes = Buffer.from("official meeting feed");
  const rawHash = createHash("sha256").update(bytes).digest("hex");
  const response = { source: "legistar", requestedUrl: "https://example.gov/feed", finalUrl: "https://example.gov/feed",
    httpStatus: 200, rawHash, byteCount: bytes.length, contentType: "application/json", retrievedAt: "2026-10-28T00:00:00Z",
    base64: bytes.toString("base64") };
  const [moved] = await holdMeetingResponses(vault, [response]) as Record<string, unknown>[];
  assert.equal("base64" in moved, false);
  assert.equal(moved.vaultKey, `project/freshness/raw/sha256/${rawHash}`);
  assert.deepEqual(Buffer.from(await readRawCapture(vault, { vaultKey: String(moved.vaultKey), rawHash, byteLength: bytes.length })), bytes);
  assert.deepEqual(await holdMeetingResponses(vault, [moved]), [moved]);
  assert.equal((await vault.list("project/freshness/raw/sha256/")).length, 1);
  await assert.rejects(holdMeetingResponses(vault, [{ ...response, rawHash: "0".repeat(64) }]), /MEETING_CAPTURE_FINGERPRINT_MISMATCH/);
  await assert.rejects(holdMeetingResponses(new MemoryEvidenceStore(), [moved]), /MEETING_CAPTURE_VAULT_MISSING/);
});
