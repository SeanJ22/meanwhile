import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { publishSupervisorReaderEdge, readerEdgeSupervisorFailure } from "../lib/civic-data/reader-edge-publication.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { LocalFileArtifactStore, type ReaderArtifactStore } from "../lib/meetings/edge-store.ts";
import { routineCivicDataSupervisorOutcome } from "../lib/control-plane/freshness-cycle-outcome.ts";
import { ownerDigestAttention } from "../lib/control-plane/owner-surface.ts";

const NOW = "2026-10-05T18:00:00.000Z";
// All transports here are temporary files; the Netlify-kind case tests the
// production decision without sending a write or purge to any real site.
for (const key of ["NETLIFY_SITE_ID", "NETLIFY_BLOBS_SITE_ID", "NETLIFY_API_TOKEN", "NETLIFY_BLOBS_TOKEN"]) delete process.env[key];

for (const [kind, env, expectedOk] of [
  ["local-file", {}, false],
  ["local-file", { WTP_READER_EDGE_LOCAL_OK: "1" }, true],
  ["local-file", { WTP_READER_EDGE_LOCAL_OK: "true" }, false],
  ["netlify-blobs", {}, true],
] as const) {
  test(`supervisor ${kind} with opt-in ${JSON.stringify(env)} reports the real destination`, async (t) => {
    const directory = mkdtempSync(join(tmpdir(), "slide-supervisor-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const local = new LocalFileArtifactStore(directory);
    const artifactStore: ReaderArtifactStore = new Proxy(local, { get(target, key) {
      if (key === "kind") return kind;
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const logs: string[] = [];
    t.mock.method(console, "log", (value: string) => logs.push(value));
    const outcome = await publishSupervisorReaderEdge(new MemoryRoutineDataStore(), NOW, [], { artifactStore }, env);
    assert.equal(outcome.ok, expectedOk);
    assert.equal(outcome.store, kind === "local-file" ? "local folder" : "Netlify Blobs");
    assert.deepEqual(JSON.parse(logs.at(-1)!), outcome);
    if (expectedOk) {
      assert.equal(outcome.readerEdge, "PUBLISHED");
      assert.equal(outcome.sequence, (await local.readManifest())!.manifest.sequence);
      assert.equal(readerEdgeSupervisorFailure(outcome), null);
    } else {
      assert.equal(await local.readManifest(), null, "a refused local destination is never mutated");
      const failure = readerEdgeSupervisorFailure(outcome)!;
      assert.equal(failure.code, "READER_EDGE_PUBLISH_FAILED");
      assert.match(failure.detail, /folder on the runner/);
      const durable = routineCivicDataSupervisorOutcome({ readerEdge: outcome, cycleId: "cycle", startedAt: NOW,
        finishedAt: NOW, testedSha: "a".repeat(40), host: "runner", provider: "postgres", durable: true,
        attemptedTasks: 0, verifiedSourceSuccesses: 0, verifiedSourceFailures: 0, failures: [failure], taskReceipts: [] });
      assert.equal(durable.state, "FAILED");
      assert.deepEqual(durable.readerEdge, outcome);
      assert.equal(ownerDigestAttention({ formatVersion: 1, digestId: "digest", writtenAt: NOW, headline: "routine cycle", lines: [], cycleOk: false,
        testedSha: "a".repeat(40), runtimeOutcome: durable }).level, "RED");
    }
  });
}

test("no configured publication store fails without reading data", async () => {
  const store = new Proxy(new MemoryRoutineDataStore(), { get() { throw new Error("unexpected data read"); } });
  const outcome = await publishSupervisorReaderEdge(store, NOW, [], { artifactStore: null }, {});
  assert.equal(outcome.ok, false);
  assert.equal(outcome.readerEdge, "SKIPPED_NO_STORE");
  assert.equal(outcome.store, "not configured");
  assert.equal(outcome.sequence, null);
  assert.match(readerEdgeSupervisorFailure(outcome)!.detail, /not configured/);
});

test("uncomposable meetings fail even with the development opt-in", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "slide-uncomposable-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const outcome = await publishSupervisorReaderEdge(new MemoryRoutineDataStore(), NOW,
    [{ recordClass: "MEETING", scope: "unprepared" }], { artifactStore: new LocalFileArtifactStore(directory) }, { WTP_READER_EDGE_LOCAL_OK: "1" });
  assert.equal(outcome.ok, false);
  assert.match(outcome.detail!, /could not be assembled/);
});
