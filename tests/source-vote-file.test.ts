import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { acquireVoteSourceFile } from "../lib/state-rollcalls/source-file.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";

const at = "2026-10-13T12:00:00.000Z", next = "2026-10-14T12:00:00.001Z";
function setup(fetchImpl: typeof fetch) {
  const store = new MemoryEvidenceStore(), locks = createMemoryRepositories().locks;
  const input = { sourceId: "plural-openstates-votes", releaseId: "wa:session:2025-2026", parserVersion: "plural-votes/2",
    url: "https://data.openstates.org/csv/latest/WA_2025-2026_csv_test.zip", allowedHosts: ["data.openstates.org"],
    signal: AbortSignal.timeout(10_000), maxBytes: 16 * 1024 * 1024, checkAfterMs: 86_400_000, now: () => at, store, locks, fetchImpl };
  const manifest = async () => {
    const key = (await store.list("project/freshness/source/plural-openstates-votes/files/")).find(key => key.endsWith("/manifest.json"));
    return key ? store.get(key) : null;
  };
  return { store, input, manifest };
}

test("vote source files cache bounded chunks and a 304 preserves the original immutable capture", async () => {
  const body = Buffer.alloc(9 * 1024 * 1024 + 3, 91);
  const requests: Headers[] = [];
  const h = setup((async (_url, init) => {
    const headers = new Headers(init?.headers); requests.push(headers);
    return headers.has("if-none-match") ? new Response(null, { status: 304 })
      : new Response(body, { headers: { etag: "saved-source", "content-length": String(body.length) } });
  }) as typeof fetch);
  const first = await acquireVoteSourceFile(h.input);
  let originalCapture: Uint8Array;
  try {
    assert.deepEqual(await readFile(first.path), body);
    await first.capture();
    assert.equal(await h.manifest(), null, "unvalidated bytes cannot move the accepted cache index");
    originalCapture = (await h.store.get(first.vaultKey!))!.bytes;
    const chunks = (await h.store.list("project/freshness/source/")).filter(key => key.endsWith(".bin"));
    assert.equal(chunks.length, 3);
    for (const key of chunks) assert.ok((await h.store.head(key))!.byteLength <= 4 * 1024 * 1024);
    await first.accept();
  } finally { await first.dispose(); }
  const cached = await acquireVoteSourceFile({ ...h.input, fetchImpl: async () => { assert.fail("not due yet"); } });
  try {
    assert.equal(cached.reused, true);
    assert.equal(cached.retrievedAt, at);
    assert.deepEqual(await readFile(cached.path), body);
  } finally { await cached.dispose(); }
  const checked = await acquireVoteSourceFile({ ...h.input, now: () => next });
  try {
    assert.equal(checked.reused, true);
    assert.equal(checked.retrievedAt, at);
    assert.equal(checked.checkedAt, next);
    assert.equal(checked.lastCheckStatus, 304);
    assert.equal(requests[1].get("if-none-match"), "saved-source");
    await checked.accept();
    assert.deepEqual((await h.store.get(checked.vaultKey!))!.bytes, originalCapture!);
    assert.deepEqual(await readFile(checked.path), body);
  } finally { await checked.dispose(); }
});

test("a truncated download preserves the accepted source index and its reusable bytes", async () => {
  const body = Buffer.from("the complete source archive bytes");
  const h = setup((async () => new Response(body, { headers: { etag: "complete" } })) as typeof fetch);
  const first = await acquireVoteSourceFile(h.input);
  try { await first.accept(); } finally { await first.dispose(); }
  const accepted = (await h.manifest())!.bytes;
  await assert.rejects(acquireVoteSourceFile({ ...h.input, now: () => next,
    fetchImpl: async () => new Response(body.subarray(0, body.length - 1), { headers: { "content-length": String(body.length) } }),
  }), /VOTE_SOURCE_TRUNCATED/);
  assert.deepEqual((await h.manifest())!.bytes, accepted);
  const reused = await acquireVoteSourceFile({ ...h.input, fetchImpl: async () => { assert.fail("the last accepted source remains reusable"); } });
  try { assert.deepEqual(await readFile(reused.path), body); assert.equal(reused.retrievedAt, at); }
  finally { await reused.dispose(); }
});

test("cancellation and size refusals cancel the source stream without accepting partial bytes", async () => {
  const abort = new AbortController();
  let cancelled = false;
  const failure = new Error("test source acquisition cancelled");
  const h = setup((async () => new Response(new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(Buffer.from("partial")); abort.abort(failure); },
    cancel() { cancelled = true; },
  }))) as typeof fetch);
  await assert.rejects(acquireVoteSourceFile({ ...h.input, signal: abort.signal }), error => error === failure);
  assert.equal(cancelled, true);
  assert.equal(await h.manifest(), null);
  let oversizeCancelled = false;
  await assert.rejects(acquireVoteSourceFile({ ...h.input, maxBytes: 3,
    fetchImpl: async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(Buffer.from("too many bytes")); },
      cancel() { oversizeCancelled = true; },
    })),
  }), /VOTE_SOURCE_TOO_LARGE/);
  assert.equal(oversizeCancelled, true);
  assert.equal(await h.manifest(), null);
});

test("a repository temp root is refused before source acquisition writes or fetches", async () => {
  const prior = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP };
  const h = setup(async () => { assert.fail("a refused destination must not fetch source bytes"); });
  try {
    process.env.TMPDIR = process.cwd(); process.env.TEMP = process.cwd(); process.env.TMP = process.cwd();
    await assert.rejects(acquireVoteSourceFile(h.input), /outside the repository/);
    assert.equal(await h.manifest(), null);
  } finally {
    for (const key of ["TMPDIR", "TEMP", "TMP"] as const) {
      if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key];
    }
  }
});
