import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import {
  ensureReaderAuthorityEdge,
  publishReaderEdgeArtifacts,
} from "../lib/meetings/edge-serving.ts";
import {
  primeRegistryRuntimeFromValue,
  registryRuntimeFirstSeed,
  registryRuntimeReadState,
  getRegistryRuntimeReadModel,
} from "../lib/registry/runtime-read-model.ts";
import { currentRegistryRuntimeEdge } from "../lib/registry/runtime-edge.ts";
import type { MeetingsSnapshot } from "../lib/meetings/snapshot.ts";

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
  const value = registryRuntimeFirstSeed().value;
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
  assert.equal(edge.registryRuntime!.value.bodyRosters.length, value.bodyRosters.length, "decompressed value round-trips");
  assert.deepEqual(Object.keys(edge.registryRuntime!.value).sort(), Object.keys(value).sort());
});

test("republishing the same authority version is idempotent; a new version advances the pointer", async () => {
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "rt-edge-")));
  const value = registryRuntimeFirstSeed().value;
  const first = await publishReaderEdgeArtifacts(emptySnapshot(), META, { store, authority: { "registry-runtime": { value, versionId: "rt-v1" } } });
  assert.equal(first.status, "PUBLISHED");
  const same = await publishReaderEdgeArtifacts(emptySnapshot(), META, { store, authority: { "registry-runtime": { value, versionId: "rt-v1" } } });
  assert.equal(same.status, "CURRENT", "same authority version + same meetings → nothing republished");
  const advanced = await publishReaderEdgeArtifacts(emptySnapshot(), META, { store, authority: { "registry-runtime": { value, versionId: "rt-v2" } } });
  assert.equal(advanced.status, "PUBLISHED", "a new authority version advances the pointer even with unchanged meetings");
});

test("primeRegistryRuntimeFromValue serves the value synchronously with its version, no DB", () => {
  const value = registryRuntimeFirstSeed().value;
  primeRegistryRuntimeFromValue(value, "rt-prime-v9");
  assert.equal(getRegistryRuntimeReadModel().bodyRosters.length, value.bodyRosters.length);
  const state = registryRuntimeReadState();
  assert.equal(state.metadata.versionId, "rt-prime-v9", "the registry authority key sees the edge version");
});

test("the registry-runtime edge value is request-scoped: absent by default (runner/workers keep the DB path)", () => {
  // No enterRegistryRuntimeEdge on this synchronous context → null, so
  // settleRegistryAuthorityReads falls through to refreshRegistryRuntimeFromPromoted.
  assert.equal(currentRegistryRuntimeEdge(), null);
});
