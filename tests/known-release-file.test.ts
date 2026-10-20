import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { acquireKnownRelease } from "../lib/sources/known-release.ts";
import { acquireKnownReleaseFile, KnownReleaseFileUnavailable, type KnownReleaseFileOptions } from "../lib/sources/known-release-file.ts";

const first = "2026-10-01T00:00:00.000Z", later = "2026-10-03T00:00:00.000Z";
function harness() {
  const store = new MemoryEvidenceStore(), { locks } = createMemoryRepositories();
  const bytes = new Uint8Array(2 * 1024 * 1024 + 7).fill(83);
  let requests = 0;
  const options: KnownReleaseFileOptions = { sourceId: "fixture-source", releaseId: "country-release", url: "https://source.example.gov/release.zip",
    parserVersion: "fixture/1", signal: AbortSignal.timeout(30000), maxBytes: 4 * 1024 * 1024, checkAfterMs: 86400000,
    store, locks, now: () => first,
    fetchImpl: async () => { requests++; return new Response(new ReadableStream({ start(controller) {
      for (let offset = 0; offset < bytes.length; offset += 32768) controller.enqueue(bytes.subarray(offset, offset + 32768)); controller.close();
    } }), { headers: { etag: "fixture-etag", "content-length": String(bytes.byteLength) } }); },
    validate: async path => { assert.equal((await stat(path)).size, bytes.byteLength); },
  };
  return { options, store, bytes, requests: () => requests };
}

test("file releases retain complete hashed evidence and replay chunks without a second country download", async () => {
  const h = harness();
  const release = await acquireKnownReleaseFile(h.options);
  try { assert.deepEqual(new Uint8Array(await readFile(release.path)), h.bytes); assert.equal(release.reused, false); assert.equal(release.raw.chunked, true); }
  finally { await release.dispose(); }
  const get = h.store.get.bind(h.store);
  h.store.get = async key => { const saved = await get(key); assert.ok(!saved || saved.bytes.byteLength <= 1024 * 1024, "no whole-country object enters a cache read"); return saved; };
  const held = await acquireKnownReleaseFile(h.options);
  try { assert.equal(h.requests(), 1); assert.equal(held.retrievedAt, first); assert.equal(held.reused, true); assert.deepEqual(new Uint8Array(await readFile(held.path)), h.bytes); }
  finally { await held.dispose(); }
});

test("file checks preserve source dates on304 and retain GOOD evidence with the failure named on an outage", async () => {
  const h = harness(), initial = await acquireKnownReleaseFile(h.options); await initial.dispose();
  const checked = await acquireKnownReleaseFile({ ...h.options, now: () => later, fetchImpl: async (_url, init) => {
    assert.equal(new Headers(init?.headers).get("if-none-match"), "fixture-etag"); return new Response(null, { status: 304 });
  } });
  try { assert.equal(checked.checkedAt, later); assert.equal(checked.retrievedAt, first); assert.equal(checked.sourceObservedAt, first); assert.equal(checked.lastCheckStatus, 304); }
  finally { await checked.dispose(); }
  try {
    await acquireKnownReleaseFile({ ...h.options, now: () => "2026-10-05T00:00:00.000Z", fetchImpl: async () => new Response("unavailable", { status: 503 }) });
    assert.fail("a held release must not hide a failed source check");
  } catch (error) {
    assert.ok(error instanceof KnownReleaseFileUnavailable);
    try { assert.match(error.held.outage ?? "", /503/); assert.equal(error.held.retrievedAt, first); assert.equal(error.held.checkedAt, later); assert.deepEqual(new Uint8Array(await readFile(error.held.path)), h.bytes); }
    finally { await error.held.dispose(); }
  }
});

test("legacy byte releases migrate through the streaming vault and keep their original evidence dates", async () => {
  const h = harness();
  await acquireKnownRelease({ ...h.options, validate: undefined, readHeld: undefined, fetchImpl: async () => new Response(h.bytes) });
  const get = h.store.get.bind(h.store);
  h.store.get = async key => { if (key.endsWith(".bin")) throw new Error("national legacy body must stream"); return get(key); };
  const held = await acquireKnownReleaseFile({ ...h.options, parserVersion: "fixture/2", now: () => later, fetchImpl: async () => { throw new Error("held parser replay must not reacquire"); } });
  try { assert.equal(held.retrievedAt, first); assert.equal(held.checkedAt, first); assert.equal(held.raw.chunked, true); assert.deepEqual(new Uint8Array(await readFile(held.path)), h.bytes); }
  finally { await held.dispose(); }
});
