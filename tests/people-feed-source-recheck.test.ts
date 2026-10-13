import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { acquireKnownRelease, knownReleaseSourceCheck } from "../lib/sources/known-release.ts";

test("a next-pass people check asks the publisher after its mark and shares the conditional result", async () => {
  const bytes = readFileSync(new URL("./fixtures/official-rosters/senate-current.xml", import.meta.url));
  const store = new MemoryEvidenceStore(), {locks} = createMemoryRepositories();
  let now = "2026-10-13T03:00:00.000Z";
  const calls: Headers[] = [];
  const options = {sourceId: "official-rosters", releaseId: "source-recheck-test", url: "https://www.senate.gov/general/contact_information/senators_cfm.xml",
    parserVersion: "official-rosters/1", signal: AbortSignal.timeout(10_000), maxBytes: 1024 * 1024,
    checkAfterMs: 86_400_000, store, locks, now: () => now,
    fetchImpl: (async (_url, init) => {
      const headers = new Headers(init?.headers); calls.push(headers);
      return headers.get("if-none-match") === '"senate-fixture"' ? new Response(null, {status: 304})
        : new Response(bytes, {status: 200, headers: {etag: '"senate-fixture"', "content-type": "application/xml"}});
    }) as typeof fetch};
  const first = await acquireKnownRelease(options);
  now = "2026-10-13T03:10:00.000Z";
  await acquireKnownRelease(options);
  assert.equal(calls.length, 1, "the ordinary daily cache still reuses a recent observation");
  const markedAt = "2026-10-13T03:20:00.000Z";
  now = "2026-10-13T03:21:00.000Z";
  const checked = await acquireKnownRelease({...options, checkedAfter: markedAt});
  assert.equal(calls.length, 2);
  assert.equal(calls[1].get("if-none-match"), '"senate-fixture"');
  assert.deepEqual(checked.bytes, first.bytes);
  assert.equal(checked.retrievedAt, first.retrievedAt, "a check never redates the held response");
  assert.equal(knownReleaseSourceCheck(checked).httpStatus, 304);
  assert.equal(knownReleaseSourceCheck(checked).checkedAt, now);
  await Promise.all([acquireKnownRelease({...options, checkedAfter: markedAt}), acquireKnownRelease({...options, checkedAfter: markedAt})]);
  assert.equal(calls.length, 2, "state consumers reuse the source check from this runner pass");

  const restored = await acquireKnownRelease({...options, store: new MemoryEvidenceStore(), refresh: true,
    readHeld: async () => first});
  assert.equal(calls.length, 3, "a restored evidence cache still asks the publisher during a scheduled refresh");
  assert.equal(restored.lastCheckStatus, 304);
  assert.equal(restored.retrievedAt, first.retrievedAt);
});
