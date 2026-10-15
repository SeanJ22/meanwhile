import assert from "node:assert/strict";
import test from "node:test";
import { pacedPortraitAcquire } from "../lib/photos/portrait-work.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { runWithSourceFetch } from "../lib/sources/fetch-source.ts";
import type { SourceFetchStore } from "../lib/sources/fetch-source-state.ts";
import type { KnownReleaseOptions } from "../lib/sources/known-release.ts";

test("profile and portrait readers share publisher holds and hourly allowance, and reuse saved captures", async () => {
  const repos = createMemoryRepositories(), vault = new MemoryEvidenceStore();
  const now = Date.parse("2026-10-12T12:00:00.000Z"), sent: string[] = [];
  const state: SourceFetchStore = { pacing: repos.websitePacing, withLease: async (_key, operation) => operation(), read: async () => null, readEntryRequest: async () => null, record: async () => {} };
  const request = (sourceId: string, url: string): KnownReleaseOptions => ({ sourceId, url, releaseId: url,
    parserVersion: "fixture/1", signal: new AbortController().signal, maxBytes: 1024,
    checkAfterMs: 7 * 86_400_000, now: () => new Date(now).toISOString(), store: vault, locks: repos.locks });
  await runWithSourceFetch({ vault, runtime: { store: state, now: () => now, transport: async input => {
    const url = String(input); sent.push(url);
    return url === "https://refused.example.gov/jane"
      ? new Response("wait", { status: 429, headers: { "retry-after": "120" } })
      : new Response("named official page", { headers: { "content-type": "text/html" } });
  } } }, async () => {
    const first = request("official-person-profile", "https://legislature.example.gov/jane");
    await Promise.all([
      pacedPortraitAcquire(first),
      pacedPortraitAcquire(request("person-portrait", "https://www.legislature.example.gov/jane.png")),
      pacedPortraitAcquire(request("official-person-profile", "https://another.example.gov/jane")),
    ]);
    assert.equal(sent.length, 3);
    assert.ok((await pacedPortraitAcquire(first)).reused);
    assert.equal(sent.length, 3);
    await assert.rejects(pacedPortraitAcquire(request("official-person-profile", "https://refused.example.gov/jane")), /KNOWN_SOURCE_HTTP_429/);
    await assert.rejects(pacedPortraitAcquire(request("person-portrait", "https://refused.example.gov/jane.png")), /SourceFetchDeferred/);
    assert.equal(sent.filter(url => url.includes("refused.example.gov")).length, 1);
    const small = { sizeFor: () => ({ kind: "local-government" as const, population: 2000 }) };
    for (let i = 0; i < 10; i += 1) await pacedPortraitAcquire(request(i % 2 ? "person-portrait" : "official-person-profile", `https://small.example.gov/${i}`), small);
    await assert.rejects(pacedPortraitAcquire(request("person-portrait", "https://small.example.gov/eleven"), small), /SourceFetchDeferred/);
    assert.equal(sent.filter(url => url.includes("small.example.gov")).length, 10);
  });
});
