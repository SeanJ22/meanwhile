import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { LocalFileArtifactStore } from "../lib/meetings/edge-store-local.ts";
import {
  ensureReaderAuthorityEdge,
  publishReaderEdgeArtifacts,
  servedAuthorityVersion,
} from "../lib/meetings/edge-serving.ts";
import {
  primeRegistryRuntimeFromValue,
  registryRuntimeReadState,
  getRegistryRuntimeReadModel,
} from "../lib/registry/runtime-read-model.ts";
import { currentRegistryRuntimeEdge, enterReaderAuthorityEdge, ReaderEdgeOnlyRefusal, settleEdgeFirst } from "../lib/registry/runtime-edge.ts";
import type { MeetingsSnapshot } from "../lib/meetings/snapshot.ts";
import { registryTransferImport } from "./helpers/promoted-fixtures.ts";

function emptySnapshot(): MeetingsSnapshot {
  return {
    formatVersion: 1,
    generatedAt: "2026-09-15T12:00:00.000Z",
    counts: { fresh: 0, carried: 0, total: 0, duplicatesCollapsed: 0 },
    sources: [],
    meetings: [],
    agendaDocuments: [],
  };
}
const META = { sourceThrough: null, retrievedAt: null, promotedThrough: null };

test("the runner publishes registry-runtime as a compressed artifact the reader reads back losslessly", async () => {
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "rt-edge-")));
  const value = registryTransferImport().projection.payload;
  const versionId = "test-registry-runtime-v-lossless";

  const published = await publishReaderEdgeArtifacts(emptySnapshot(), META, { store, authority: { "registry-runtime": { value, versionId } } });
  assert.equal(published.status, "PUBLISHED");

  const manifest = (await store.readManifest())!.manifest;
  const ref = manifest.authorityArtifacts?.["registry-runtime"];
  assert.ok(ref?.key?.endsWith(".json.gz"), "manifest points at a gzip artifact");
  assert.equal(ref?.version, versionId);
  assert.ok(ref?.sha, "manifest records the artifact sha");

  const edge = await ensureReaderAuthorityEdge(manifest, store);
  assert.ok(edge.registryRuntime, "the reader fetches + decompresses the registry-runtime artifact");
  assert.equal(edge.registryRuntime!.versionId, versionId);
  assert.deepEqual(edge.registryRuntime!.value.registry, value.registry, "decompressed value round-trips");
  assert.deepEqual(Object.keys(edge.registryRuntime!.value).sort(), Object.keys(value).sort());
});

test("republishing the same authority version is idempotent; a new version advances the pointer", async () => {
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "rt-edge-")));
  const value = registryTransferImport().projection.payload;
  const first = await publishReaderEdgeArtifacts(emptySnapshot(), META, { store, authority: { "registry-runtime": { value, versionId: "rt-v1" } } });
  assert.equal(first.status, "PUBLISHED");
  const same = await publishReaderEdgeArtifacts(emptySnapshot(), META, { store, authority: { "registry-runtime": { value, versionId: "rt-v1" } } });
  assert.equal(same.status, "CURRENT", "same authority version + same meetings → nothing republished");
  const advanced = await publishReaderEdgeArtifacts(emptySnapshot(), META, { store, authority: { "registry-runtime": { value, versionId: "rt-v2" } } });
  assert.equal(advanced.status, "PUBLISHED", "a new authority version advances the pointer even with unchanged meetings");
});

test("primeRegistryRuntimeFromValue serves the value synchronously with its version, no DB", () => {
  const value = registryTransferImport().projection.payload;
  primeRegistryRuntimeFromValue(value, "rt-prime-v9");
  assert.equal(getRegistryRuntimeReadModel().bodyRosters.length, value.bodyRosters.length);
  const state = registryRuntimeReadState();
  assert.equal(state.metadata.versionId, "rt-prime-v9", "the registry authority key sees the edge version");
});

test("settleEdgeFirst (R24): the edge value is primed with no read; without one the database is read; an edge-only context refuses", async () => {
  const calls: string[] = [];
  const settle = (edge: { value: { n: number }; versionId: string } | null) => settleEdgeFirst(
    () => edge,
    (value, versionId) => { calls.push(`prime:${value.n}:${versionId}`); },
    async () => { calls.push("database"); },
    "The probe family",
  );
  await settle({ value: { n: 7 }, versionId: "edge-v7" });
  assert.deepEqual(calls.splice(0), ["prime:7:edge-v7"], "an edge value never reaches the database");
  await settle(null);
  assert.deepEqual(calls.splice(0), ["database"], "no edge value: the authoritative database read");
  await (async () => {
    // Entered after this helper's first await, so the edge-only context stays inside it.
    await Promise.resolve();
    enterReaderAuthorityEdge({ edgeOnly: true });
    await assert.rejects(settle(null), (error: unknown) => error instanceof ReaderEdgeOnlyRefusal && /The probe family/.test(error.message));
  })();
  assert.deepEqual(calls, [], "an edge-only context refuses before any database read");
});

test("the registry-runtime edge value is request-scoped: absent by default (runner/workers keep the DB path)", () => {
  // No enterRegistryRuntimeEdge on this synchronous context → null, so
  // settleRegistryAuthorityReads falls through to refreshRegistryRuntimeFromPromoted.
  assert.equal(currentRegistryRuntimeEdge(), null);
});

test("an unchanged authority version carries its served artifact forward; the runner never re-reads it", async () => {
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "rt-edge-")));
  const value = registryTransferImport().projection.payload;
  const first = await publishReaderEdgeArtifacts(emptySnapshot(), META, { store, authority: { "registry-runtime": { value, versionId: "rt-v1" } } });
  assert.equal(first.status, "PUBLISHED");
  const servedManifest = (await store.readManifest())!.manifest;
  const servedRef = servedManifest.authorityArtifacts?.["registry-runtime"];
  assert.equal(servedAuthorityVersion(servedManifest, "registry-runtime"), "rt-v1");
  assert.equal(servedAuthorityVersion(servedManifest, "federal-directory"), null);

  // Nothing changed: a carried family is as current as a re-read one.
  const same = await publishReaderEdgeArtifacts(emptySnapshot(), META, { store, authority: { "registry-runtime": { versionId: "rt-v1", carried: true } } });
  assert.equal(same.status, "CURRENT");

  // Another family changed, so a new manifest is written: the carried family
  // keeps pointing at the exact artifact already served, and the Reader reads
  // the same value back from it.
  const campaignSites = { records: [{ id: "site-1" }] };
  const advanced = await publishReaderEdgeArtifacts(emptySnapshot(), META, {
    store,
    authority: {
      "registry-runtime": { versionId: "rt-v1", carried: true },
      "campaign-sites": { value: campaignSites, versionId: "cs-v1" },
    },
  });
  assert.equal(advanced.status, "PUBLISHED");
  const manifest = (await store.readManifest())!.manifest;
  assert.deepEqual(manifest.authorityArtifacts?.["registry-runtime"], servedRef, "the served artifact is carried, never rewritten");
  assert.equal(manifest.authorityArtifacts?.["campaign-sites"]?.version, "cs-v1");
  const edge = await ensureReaderAuthorityEdge(manifest, store);
  assert.equal(edge.registryRuntime?.versionId, "rt-v1");
  assert.deepEqual(edge.registryRuntime?.value.registry, value.registry);

  // A stale producer cannot remove a newer served authority while publishing
  // another family. It retries against the winning manifest.
  const moved = await publishReaderEdgeArtifacts(emptySnapshot(), META, {
    store,
    authority: {
      "registry-runtime": { versionId: "rt-v0-not-served", carried: true },
      "campaign-sites": { value: campaignSites, versionId: "cs-v2" },
    },
  });
  assert.equal(moved.status, "RACED");
  assert.deepEqual((await store.readManifest())!.manifest, manifest, "a stale carry leaves every winning artifact unchanged");

  // The runner asks the served manifest first and reads a family's value only
  // when its pointer has moved past the served version.
  const script = readFileSync("lib/civic-data/reader-edge-publication.ts", "utf8");
  for (const family of ["registry-runtime", "federal-directory", "campaign-sites", "meeting-outcomes"]) {
    assert.match(script, new RegExp(`servedIfCurrent\\("${family}"`), `${family} is checked against the served manifest`);
    assert.match(script, new RegExp(`authority\\["${family}"\\] = \\{ versionId: carried, carried: true \\}`), `${family} carries forward`);
  }
  assert.match(script, /publishReaderEdgeArtifacts\([\s\S]*store: artifactStore/, "publish compares against the manifest the runner read");
});
