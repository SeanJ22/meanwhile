import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import test from "node:test";
import { prepareStateAuthorityArtifact, type PublishAuthorityValue } from "../lib/meetings/edge-serving.ts";
import { READER_ARTIFACT_FORMAT_VERSION } from "../lib/meetings/edge-artifacts.ts";
import type { ReaderArtifactStore } from "../lib/meetings/edge-store.ts";

test("state artifact encoding streams records with the same JSON and compressed digest", async t => {
  const now = "2026-10-16T12:00:00.000Z";
  const value = { kind: "PROMOTED_POINTERS", entries: [], records: Array.from({ length: 4_000 }, (_, id) => ({
    id, text: "Unicode: 🗳️; quote: \"; newline: \n; slash: \\", absent: undefined,
    numbers: [id, NaN, Infinity, undefined], checkedAt: new Date(now),
  })), longText: "A captured document. ".repeat(10_000) };
  const expected = JSON.stringify({ formatVersion: READER_ARTIFACT_FORMAT_VERSION, family: "candidate-publications",
    state: "AZ", versionId: "v1", generatedAt: now, value });
  let stored: Uint8Array | undefined;
  const store = { async putImmutable(bytes: Uint8Array, suffix: string) {
    assert.equal(suffix, "json.gz"); stored = bytes; return "streamed-state.json.gz";
  } } as ReaderArtifactStore;
  const stringify = JSON.stringify;
  t.mock.method(JSON, "stringify", (part: unknown) => {
    assert.ok(part === null || typeof part !== "object", "encoding must not stringify an entire object or record collection");
    return stringify(part);
  });
  const published = await prepareStateAuthorityArtifact("candidate-publications", "AZ",
    { versionId: "v1", value } as unknown as PublishAuthorityValue, store, now);
  assert.ok(stored);
  assert.equal(gunzipSync(stored).toString("utf8"), expected);
  assert.deepEqual(stored, gzipSync(expected), "the streaming replacement preserves immutable artifact bytes");
  assert.equal(published.artifact.sha, createHash("sha256").update(stored).digest("hex"));
});

test("a cyclic state payload fails before any artifact is written", async () => {
  const value: Record<string, unknown> = {};
  value.self = value;
  const store = { async putImmutable() { assert.fail("invalid JSON cannot reach the artifact store"); } } as unknown as ReaderArtifactStore;
  await assert.rejects(prepareStateAuthorityArtifact("candidate-profiles", "AZ",
    { versionId: "invalid", value } as unknown as PublishAuthorityValue, store, "2026-10-16T12:00:00.000Z"), /circular structure/);
});
