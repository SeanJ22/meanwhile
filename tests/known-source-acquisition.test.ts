import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { acquireKnownRelease, type KnownRelease } from "../lib/sources/known-release.ts";
import { RepositoryLockHeld, type LockManager } from "../lib/control-plane/repository/types.ts";

const T0 = "2026-10-01T00:00:00.000Z", T1 = "2026-10-03T00:00:00.000Z", DAY = 86_400_000;
const url = "https://publisher.example/releases/current.csv";
function harness() {
  const store = new MemoryEvidenceStore(), { locks } = createMemoryRepositories();
  let at = T0, requests = 0, respond = (_headers: Headers): Response => new Response("id,name\n1,A\n", { headers: { etag: '"one"' } });
  const options = { store, locks, sourceId: "known-publisher", releaseId: "current", url, parserVersion: "csv/1",
    signal: AbortSignal.timeout(10_000), maxBytes: 1024, checkAfterMs: DAY, now: () => at,
    fetchImpl: (async (_url, init) => { requests++; return respond(new Headers(init?.headers)); }) as typeof fetch };
  return { options, store, requests: () => requests, time: (value: string) => { at = value; }, response: (fn: typeof respond) => { respond = fn; } };
}
test("parallel consumers share one source request and byte identity without re-dating held evidence", async () => {
  const h = harness();
  const results = await Promise.all(Array.from({ length: 8 }, () => acquireKnownRelease(h.options)));
  assert.equal(h.requests(), 1); assert.equal(new Set(results.map(row => row.sha256)).size, 1);
  assert.ok(results.every(row => row.retrievedAt === T0));
  h.time("2026-10-01T12:00:00.000Z");
  const held = await acquireKnownRelease(h.options);
  assert.equal(h.requests(), 1); assert.equal(held.reused, true); assert.equal(held.checkedAt, T0);
});
test("another process's source lock is awaited within the caller deadline before reusing its result", async () => {
  const h = harness(); await acquireKnownRelease(h.options);
  let attempts = 0;
  const locks: LockManager = { withLock: async (name, work) => {
    if (++attempts === 1) throw new RepositoryLockHeld(name, "another source child is committing the release");
    return work();
  } };
  const held = await acquireKnownRelease({ ...h.options, locks });
  assert.equal(attempts, 2); assert.equal(h.requests(), 1); assert.equal(held.checkedAt, T0);
  await assert.rejects(acquireKnownRelease({ ...h.options, locks, signal: AbortSignal.abort() }), /abort/i);
});
test("304 confirms a complete held body without changing its source date or original status", async () => {
  const h = harness(), first = await acquireKnownRelease(h.options); h.time(T1);
  h.response(headers => { assert.equal(headers.get("if-none-match"), '"one"'); return new Response(null, { status: 304 }); });
  const confirmed = await acquireKnownRelease(h.options);
  assert.equal(confirmed.httpStatus, 200); assert.equal(confirmed.lastCheckStatus, 304); assert.equal(confirmed.checkedAt, T1);
  assert.equal(confirmed.retrievedAt, T0); assert.equal(confirmed.sourceObservedAt, T0);
  assert.deepEqual(confirmed.bytes, first.bytes);
  assert.equal(confirmed.vaultKey, first.vaultKey);
  h.time("2026-10-05T00:00:00.000Z"); h.response(() => new Response("id,name\n1,A\n"));
  assert.equal((await acquireKnownRelease(h.options)).vaultKey, first.vaultKey, "an unchanged 200 retains the exact immutable source object");
});
test("new parser consumes held bytes before an overdue source request and does not mark that request complete", async () => {
  const h = harness(); await acquireKnownRelease(h.options); h.time(T1); let checked = 0;
  const replay = await acquireKnownRelease({ ...h.options, parserVersion: "csv/2", validate: () => { checked++; } });
  assert.equal(h.requests(), 1); assert.equal(checked, 1); assert.equal(replay.checkedAt, T0);
  await acquireKnownRelease({ ...h.options, parserVersion: "csv/2" }); assert.equal(h.requests(), 2);
});
test("a partial transfer or failed parser cannot replace the last complete release", async () => {
  const h = harness(), first = await acquireKnownRelease(h.options); h.time(T1);
  h.response(() => new Response("broken", { headers: { "content-length": "20" } }));
  await assert.rejects(acquireKnownRelease(h.options), /LENGTH|length|TRANSFER/);
  h.response(() => new Response("id,name\n2,B\n"));
  await assert.rejects(acquireKnownRelease({ ...h.options, validate: () => { throw new Error("SCHEMA_MISMATCH"); } }), /SCHEMA_MISMATCH/);
  h.time(T0); const held = await acquireKnownRelease(h.options); assert.equal(held.sha256, first.sha256);
  assert.equal(held.checkedAt, T0);
});
test("adopting a complete old vault capture does not need a first network request", async () => {
  const h = harness(); h.time(T1); const bytes = new TextEncoder().encode("id,name\n7,Held\n");
  const original: KnownRelease = { sourceId: h.options.sourceId, releaseId: h.options.releaseId, requestedUrl: url, finalUrl: url,
    bytes, sha256: createHash("sha256").update(bytes).digest("hex"), httpStatus: 200, retrievedAt: T0, sourceObservedAt: T0,
    checkedAt: T0, lastCheckStatus: 200, etag: null, lastModified: null, contentType: "text/csv", reused: true };
  const held = await acquireKnownRelease({ ...h.options, readHeld: async () => original });
  assert.equal(h.requests(), 0); assert.equal(held.retrievedAt, T0);
  await acquireKnownRelease(h.options); assert.equal(h.requests(), 1);
});
test("returning to an earlier byte release preserves its first evidence date", async () => {
  const h = harness(), first = await acquireKnownRelease(h.options); h.time(T1);
  h.response(() => new Response("id,name\n2,B\n")); await acquireKnownRelease(h.options);
  h.time("2026-10-05T00:00:00.000Z"); h.response(() => new Response("id,name\n1,A\n"));
  const returned = await acquireKnownRelease(h.options); assert.equal(returned.sha256, first.sha256);
  assert.equal(returned.retrievedAt, T0); assert.equal(returned.checkedAt, "2026-10-05T00:00:00.000Z");
});
test("credential URLs and an unsolicited 304 cannot become source evidence", async () => {
  const h = harness(); await assert.rejects(acquireKnownRelease({ ...h.options, url: `${url}?api_key=secret` }), /MUST_BE_PUBLIC/);
  h.response(() => new Response(null, { status: 304 })); await assert.rejects(acquireKnownRelease(h.options), /304_WITHOUT_BYTES/);
  assert.equal((await h.store.list("project/")).length, 0);
});
test("a provider Retry-After applies to the next native request without sleeping or advancing evidence", async () => {
  const h = harness();
  h.response(() => new Response("rate limited", { status: 429, headers: { "retry-after": "86400" } }));
  await assert.rejects(acquireKnownRelease(h.options), /KNOWN_SOURCE_HTTP_429/);
  await assert.rejects(acquireKnownRelease({ ...h.options, url: "https://publisher.example/releases/other.csv", releaseId: "other" }), /KNOWN_SOURCE_RETRY_AFTER/);
  assert.equal(h.requests(), 1);
  assert.ok((await h.store.list("project/")).every(key => key.includes("/retry/")), "a refusal has no source body or good-release pointer");
  h.time(T1); h.response(() => new Response("id,name\n1,A\n"));
  await acquireKnownRelease(h.options); assert.equal(h.requests(), 2);
});
