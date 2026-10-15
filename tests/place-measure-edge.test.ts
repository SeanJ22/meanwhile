import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { PromotedEdgeEntry } from "../lib/civic-data/read-model.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { publishRoutineReaderEdgeOutcome } from "../lib/civic-data/reader-edge-publication.ts";
import { ensureReaderAuthorityEdge } from "../lib/meetings/edge-serving.ts";
import { publishReaderPlaceArtifact, readerPlaceManifestKey } from "../lib/meetings/place-edge.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";

const NOW = "2026-10-15T18:00:00.000Z";
const division = "ocd-division/country:us/state:co/county:denver";
const family = "ballot-measures";
const empty = (place: string): PromotedEdgeEntry => ({ kind: "NOT_RECORDED", recordClass: "BALLOT_CANDIDACY", scope: `US:${family}:${place}` });

test("place publications and reads never open a country manifest, and current pointers skip payloads", async t => {
  const directory = mkdtempSync(join(tmpdir(), "place-edge-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const artifacts = new LocalFileArtifactStore(directory);
  let manifests = 0, immutableReads = 0, payloadReads = 0;
  const store = new Proxy(artifacts, { get(target, key) {
    if (key === "readManifest") return async (path?: string) => {
      assert.ok(path?.startsWith("reader/places/"), "a place never reads the country index");
      manifests++;
      return target.readManifest(path);
    };
    if (key === "writeManifest") return async (...args: Parameters<typeof target.writeManifest>) => {
      assert.ok(args[2]?.startsWith("reader/places/"), "a place never writes the country index");
      return target.writeManifest(...args);
    };
    if (key === "readBytes") return async (path: string) => { immutableReads++; return target.readBytes(path); };
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const input = { family, division, versionId: "version-1", read: async () => { payloadReads++; return empty(division); } } as const;
  assert.equal((await publishReaderPlaceArtifact(input, { store, now: NOW })).status, "PUBLISHED");
  assert.equal((await publishReaderPlaceArtifact(input, { store, now: NOW })).status, "CURRENT");
  assert.equal(payloadReads, 1);
  assert.equal(await artifacts.readManifest(), null);
  const bundle = await ensureReaderAuthorityEdge({}, store);
  assert.equal(manifests, 2, "bundle setup reads no place or national index");
  assert.deepEqual(await bundle.localMeasures!.load(division), empty(division));
  assert.deepEqual(await bundle.localMeasures!.load(division), empty(division));
  assert.equal(manifests, 3);
  assert.equal(immutableReads, 1, "one request retains only its requested places");
  const missing = "ocd-division/country:us/state:co/county:adams";
  assert.deepEqual(await bundle.localMeasures!.load(missing), empty(missing));
  assert.equal(immutableReads, 1, "an unpublished place is answered absent without reading another place");
  const nextRequest = await ensureReaderAuthorityEdge({}, store);
  await nextRequest.localMeasures!.load(division);
  assert.equal(immutableReads, 2, "there is no process-wide growing collection of place payloads");
});

test("an absent selected place publishes nothing and reads only its own database identity", async t => {
  const directory = mkdtempSync(join(tmpdir(), "place-empty-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const scope = `US:${family}:${division}`;
  const data = new Proxy(new MemoryRoutineDataStore(), { get(_target, key) {
    if (key === "readPromotionIdentity") return async (recordClass: string, foundScope: string) => {
      assert.equal(recordClass, "BALLOT_CANDIDACY");
      assert.equal(foundScope, scope);
      return null;
    };
    throw new Error(`unexpected country data access: ${String(key)}`);
  } });
  const artifacts = new Proxy(new LocalFileArtifactStore(directory), { get(target, key) {
    if (key === "kind") return target.kind;
    throw new Error(`unexpected country artifact access: ${String(key)}`);
  } });
  const outcome = await publishRoutineReaderEdgeOutcome(data, NOW, [{ recordClass: "BALLOT_CANDIDACY", scope }], { artifactStore: artifacts });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.readerEdge, "CURRENT");
});

test("a corrupt place artifact stays unreadable without another-place fallback", async t => {
  const directory = mkdtempSync(join(tmpdir(), "place-corrupt-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new LocalFileArtifactStore(directory);
  await publishReaderPlaceArtifact({ family, division, versionId: "version-1", read: async () => empty(division) }, { store, now: NOW });
  const key = readerPlaceManifestKey(family, division);
  const held = (await store.readManifest(key))!;
  await store.writeManifest({ ...held.manifest, place: { ...held.manifest.place!, division: "ocd-division/country:us/state:ca/county:alameda" } }, held.etag, key);
  const bundle = await ensureReaderAuthorityEdge({}, store);
  assert.equal(await bundle.localMeasures!.load(division), null);
});

test("concurrent updates to a place keep the winning immutable bytes", async t => {
  const directory = mkdtempSync(join(tmpdir(), "place-race-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new LocalFileArtifactStore(directory);
  let releaseWinner!: () => void, releaseLoser!: () => void;
  const bothRead = new Promise<void>(resolve => { releaseWinner = resolve; });
  const winnerSaved = new Promise<void>(resolve => { releaseLoser = resolve; });
  let reads = 0;
  const writer = (loser: boolean) => new Proxy(store, { get(target, key) {
    if (key === "readManifest") return async (path?: string) => {
      const held = await target.readManifest(path);
      if (++reads === 2) releaseWinner();
      await bothRead;
      return held;
    };
    if (key === "putImmutable") return async (...args: Parameters<typeof target.putImmutable>) => {
      if (loser) await winnerSaved;
      return target.putImmutable(...args);
    };
    if (key === "writeManifest") return async (...args: Parameters<typeof target.writeManifest>) => {
      const result = await target.writeManifest(...args);
      if (!loser) releaseLoser();
      return result;
    };
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const publish = (loser: boolean) => publishReaderPlaceArtifact({ family, division, versionId: loser ? "loser" : "winner", read: async () => empty(division) }, { store: writer(loser), now: NOW });
  const [winner, loser] = await Promise.all([publish(false), publish(true)]);
  assert.equal(winner.status, "PUBLISHED");
  assert.equal(loser.status, "RACED");
  assert.equal((await store.readManifest(readerPlaceManifestKey(family, division)))!.manifest.place!.artifact.version, "winner");
});
