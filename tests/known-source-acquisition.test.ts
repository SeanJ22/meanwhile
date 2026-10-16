import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { MemoryEvidenceStore, type EvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { acquireKnownRelease, type KnownRelease } from "../lib/sources/known-release.ts";
import { RepositoryLockHeld, type LockManager } from "../lib/control-plane/repository/types.ts";
import { isSourceAcquisitionFailure } from "../lib/civic-data/source-acquisition-error.ts";
import { fetchSource, prefetchSourceRequests, runWithSourceFetch } from "../lib/sources/fetch-source.ts";
import { fileSourceFetchStore } from "../lib/sources/fetch-source-state.ts";

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
test("independent source children reuse a first release that holds the shared lock beyond one minute", async t => {
  const h = harness();
  // Separate store handles model separate processes sharing the same vault:
  // the in-process pending Promise cannot satisfy the waiting child.
  const peerStore: EvidenceStore = {
    put: h.store.put.bind(h.store), get: h.store.get.bind(h.store),
    head: h.store.head.bind(h.store), list: h.store.list.bind(h.store),
  };
  const validating = Promise.withResolvers<void>(), finishValidation = Promise.withResolvers<void>();
  let clockMs = 0, held = false, contentions = 0, validations = 0;
  t.mock.method(Date, "now", () => clockMs);
  const locks: LockManager = { withLock: async (name, work) => {
    if (held) {
      contentions++;
      // A national archive download and full validation can exceed one minute
      // while remaining within the unchanged caller acquisition deadline.
      clockMs = 65_000;
      if (contentions === 2) finishValidation.resolve();
      throw new RepositoryLockHeld(name, "another state is validating the shared national archive");
    }
    held = true;
    try { return await work(); } finally { held = false; }
  } };
  const owner = acquireKnownRelease({ ...h.options, locks, validate: async () => {
    validations++; validating.resolve(); await finishValidation.promise;
  } });
  await validating.promise;
  try {
    const peer = await acquireKnownRelease({ ...h.options, locks, store: peerStore });
    const first = await owner;
    assert.equal(contentions, 2);
    assert.equal(h.requests(), 1); assert.equal(validations, 1);
    assert.equal(peer.reused, true); assert.equal(peer.vaultKey, first.vaultKey);
    assert.equal(peer.sha256, first.sha256); assert.deepEqual(peer.bytes, first.bytes);
    assert.equal(peer.retrievedAt, T0); assert.equal(peer.checkedAt, T0);
  } finally {
    finishValidation.resolve(); await owner;
  }
});
test("a waiting source child stops at its own acquisition deadline without fetching", async () => {
  const h = harness(), controller = new AbortController(), waiting = Promise.withResolvers<void>();
  const reason = new Error("source child acquisition deadline reached");
  let attempts = 0;
  const locks: LockManager = { withLock: async name => {
    attempts++; waiting.resolve(); throw new RepositoryLockHeld(name, "another state is acquiring the shared release");
  } };
  const child = acquireKnownRelease({ ...h.options, locks, signal: controller.signal });
  const rejected = assert.rejects(child, error => {
    assert.ok(error instanceof Error); assert.equal(error.name, "AbortError");
    assert.equal(error.cause, reason); return true;
  });
  await waiting.promise;
  controller.abort(reason);
  await rejected;
  assert.equal(attempts, 1); assert.equal(h.requests(), 0);
  assert.deepEqual(await h.store.list("project/"), []);
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
test("prefetch revalidates held validators without a receipt key once and preserves its wire time for serial release consumers", async () => {
  const h = harness(), durable = fileSourceFetchStore(`prefetch-known:${randomUUID()}`);
  let checkedAt = T0, requests = 0, missingReceipt = false, receiptKey = "";
  const store = { ...durable, read: async (key: string) => {
    const saved = await durable.read(key);
    if (!saved || !missingReceipt) return saved;
    const held = { ...saved, checkedAt };
    Reflect.deleteProperty(held, "checkKey");
    receiptKey = key;
    return held;
  } };
  const modified = "Thu, 01 Oct 2026 00:00:00 GMT";
  const transport: typeof fetch = async (_input, init) => {
    requests++;
    if (requests === 1) return new Response("id,name\n1,A\n", { headers: { etag: '"one"', "last-modified": modified } });
    assert.equal(requests, 2, "the serial adapter must reuse the completed conditional check");
    assert.equal(new Headers(init?.headers).get("if-none-match"), '"one"');
    assert.equal(new Headers(init?.headers).get("if-modified-since"), modified);
    missingReceipt = false;
    return new Response(null, { status: 304 });
  };
  const sourceId = h.options.sourceId, seed = { url, headers: [], redirect: "follow" as const, byteCount: 12 };
  const read = () => runWithSourceFetch({ sourceId, state: "US-NJ", dueAt: checkedAt, vault: h.store,
    runtime: { store, transport, now: () => Date.parse(checkedAt) } }, async () => {
    await prefetchSourceRequests({ sourceId, state: "US-NJ", dueAt: checkedAt, seeds: [seed] });
    return acquireKnownRelease({ ...h.options, fetchImpl: fetchSource });
  });
  h.time(T1);
  const first = await read();
  assert.equal(first.checkedAt, T0);
  assert.equal(first.retrievedAt, T0);
  checkedAt = T1;
  missingReceipt = true;
  h.time("2026-10-05T00:00:00.000Z");
  const next = await read();
  assert.equal(next.checkedAt, T1);
  assert.equal(next.retrievedAt, T0);
  assert.equal(next.lastCheckStatus, 304);
  assert.deepEqual(next.bytes, first.bytes);
  assert.equal((await durable.read(receiptKey))?.checkKey, receiptKey);
  assert.equal(requests, 2, "parsing reused each completed prefetch without another source request");
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
test("publisher request and body failures are classified without making a source release current", async () => {
  const h = harness();
  await assert.rejects(acquireKnownRelease({ ...h.options, fetchImpl: async () => { throw new TypeError("socket unavailable"); } }), error => {
    assert.ok(isSourceAcquisitionFailure(error)); assert.equal(error.code, "PUBLISHER_UNAVAILABLE"); return true;
  });
  h.response(() => new Response(new ReadableStream({ start(controller) { controller.error(new Error("broken publisher stream")); } })));
  await assert.rejects(acquireKnownRelease(h.options), error => {
    assert.ok(isSourceAcquisitionFailure(error)); assert.equal(error.code, "PUBLISHER_RESPONSE_REFUSED"); return true;
  });
  h.response(() => new Response("refused", { status: 403 }));
  await assert.rejects(acquireKnownRelease(h.options), error => {
    assert.ok(isSourceAcquisitionFailure(error)); assert.equal(error.code, "PUBLISHER_RESPONSE_REFUSED");
    assert.match(error.message, /KNOWN_SOURCE_HTTP_403/); return true;
  });
  assert.deepEqual(await h.store.list("project/"), []);
});
test("vault, index, lock, and parser program failures escape unchanged rather than blaming the publisher", async () => {
  for (const operation of ["get", "head", "put"] as const) {
    const h = harness(), problem = new Error(`fixture vault ${operation} failed`);
    Object.defineProperty(h.store, operation, { value: async () => { throw problem; } });
    await assert.rejects(acquireKnownRelease(h.options), error => {
      assert.equal(error, problem); assert.equal(isSourceAcquisitionFailure(error), false); return true;
    });
  }
  const h = harness(), problem = new TypeError("fixture parser bug");
  await assert.rejects(acquireKnownRelease({ ...h.options, validate: () => { throw problem; } }), error => error === problem);
  await assert.rejects(acquireKnownRelease({ ...h.options, locks: { withLock: async () => { throw problem; } } }), error => error === problem);
  await acquireKnownRelease(h.options);
  const indexKey = (await h.store.list("project/")).find(key => key.endsWith("/manifest.json"))!;
  const originalGet = h.store.get.bind(h.store);
  h.store.get = async key => {
    const object = await originalGet(key);
    return object && key === indexKey ? { ...object, bytes: new TextEncoder().encode("broken index JSON") } : object;
  };
  await assert.rejects(acquireKnownRelease(h.options), error => error instanceof SyntaxError && !isSourceAcquisitionFailure(error));
});
