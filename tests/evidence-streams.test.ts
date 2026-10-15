import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Store } from "@netlify/blobs";
import { contentHash } from "../lib/control-plane/ids.ts";
import { NetlifyEvidenceStore } from "../lib/control-plane/evidence/netlify-store.ts";
import { DurableEvidenceStore, keyToRelativePath } from "../lib/control-plane/evidence/durable-store.ts";
import type { StoredObjectStream } from "../lib/control-plane/evidence/store.ts";

async function digest(object: StoredObjectStream | null) {
  assert.ok(object);
  const hash = createHash("sha256"), reader = object.body.getReader();
  let byteLength = 0, largestChunk = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) return { hash: `sha256-${hash.digest("hex")}`, byteLength, largestChunk };
      hash.update(next.value); byteLength += next.value.byteLength;
      largestChunk = Math.max(largestChunk, next.value.byteLength);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

test("Netlify streams split envelope headers and verifies bodies without array buffers", async () => {
  const bytes = new Uint8Array(2 * 1024 * 1024).fill(65);
  const meta = { contentType: "application/pdf", contentHash: contentHash(bytes), byteLength: bytes.byteLength,
    custom: { canonicalUrl: "https://example.gov/measure.pdf", tier: "RAW", note: "source ".repeat(500) } };
  const header = new TextEncoder().encode(JSON.stringify({ meta, bodySha256: meta.contentHash }));
  const encoded = new Uint8Array(4 + header.byteLength + bytes.byteLength);
  new DataView(encoded.buffer).setUint32(0, header.byteLength); encoded.set(header, 4); encoded.set(bytes, 4 + header.byteLength);
  let cancelled = 0, reads = 0;
  const store = new NetlifyEvidenceStore({ async getWithMetadata(_key: string, options: { type: string }) {
    assert.equal(options.type, "stream");
    let offset = 0;
    return { metadata: { format: "evidence-envelope@1" }, data: new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset === encoded.byteLength) { controller.close(); return; }
        const end = Math.min(encoded.byteLength, offset + (offset < 4 ? 2 : 997));
        reads++; controller.enqueue(encoded.slice(offset, end)); offset = end;
      }, cancel() { cancelled++; },
    }, { highWaterMark: 0 }) };
  } } as unknown as Store);
  const held = await store.stream("measure");
  assert.deepEqual(held?.meta, meta);
  assert.ok(reads < 10, "opening an envelope only reads its metadata");
  const checked = await digest(held);
  assert.equal(checked.hash, meta.contentHash); assert.equal(checked.byteLength, bytes.byteLength);
  assert.ok(checked.largestChunk <= 997);
  const partial = (await store.stream("measure"))!;
  await partial.body.cancel(); assert.equal(cancelled, 1);
  encoded[encoded.byteLength - 1] ^= 1;
  await assert.rejects(digest(await store.stream("measure")), /corrupt/);
});

test("Netlify stream deadlines cancel an in-flight body read", async () => {
  const bytes = new Uint8Array([65]);
  const meta = { contentType: "text/plain", contentHash: contentHash(bytes), byteLength: 1 };
  let cancelled = false;
  const store = new NetlifyEvidenceStore({ async getWithMetadata() {
    return { metadata: { meta, bodySha256: meta.contentHash }, data: new ReadableStream<Uint8Array>({
      pull() {}, cancel() { cancelled = true; },
    }, { highWaterMark: 0 }) };
  } } as unknown as Store);
  const deadline = new AbortController();
  const held = await store.stream("measure", deadline.signal);
  const pending = digest(held);
  deadline.abort(new Error("test deadline"));
  await assert.rejects(pending, /test deadline/);
  assert.equal(cancelled, true);
});

test("filesystem evidence streams fixed-size chunks and refuses corruption", async t => {
  const root = await mkdtemp(join(tmpdir(), "evidence-stream-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new DurableEvidenceStore(root, { remote: null }), bytes = new Uint8Array(3 * 1024 * 1024 + 7).fill(42);
  const key = "project/test/source/document", meta = { contentType: "application/pdf", contentHash: contentHash(bytes), byteLength: bytes.byteLength };
  await store.put(key, bytes, meta);
  store.get = async () => { throw new Error("Streaming must not call get."); };
  const result = await digest(await store.stream(key));
  assert.equal(result.hash, meta.contentHash); assert.equal(result.byteLength, bytes.byteLength); assert.ok(result.largestChunk <= 64 * 1024);
  await writeFile(join(root, keyToRelativePath(key)), bytes.subarray(1));
  await assert.rejects(digest(await store.stream(key)), /corrupt/);
  assert.equal(await store.stream("missing"), null);
});

test("Netlify streaming timeouts measure active reads and exclude corpus-consumer pauses", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const bytes = new Uint8Array([65, 66]);
  const meta = { contentType: "text/plain", contentHash: contentHash(bytes), byteLength: 2 };
  const store = new NetlifyEvidenceStore({ async getWithMetadata() {
    let offset = 0;
    return { metadata: { meta, bodySha256: meta.contentHash }, data: new ReadableStream<Uint8Array>({
      pull(controller) { if (offset < bytes.length) controller.enqueue(bytes.slice(offset, ++offset)); else controller.close(); },
    }, { highWaterMark: 0 }) };
  } } as unknown as Store);
  const object = (await store.stream("manifest"))!, reader = object.body.getReader();
  t.mock.timers.tick(60_000);
  assert.deepEqual((await reader.read()).value, bytes.subarray(0, 1));
  t.mock.timers.tick(60_000);
  assert.deepEqual((await reader.read()).value, bytes.subarray(1));
  t.mock.timers.tick(60_000);
  assert.equal((await reader.read()).done, true);
  reader.releaseLock();
});
