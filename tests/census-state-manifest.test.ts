import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { processRegisteredFanOutCandidate } from "../lib/civic-data/promotion.ts";
import { publishRoutineReaderEdgeOutcome } from "../lib/civic-data/reader-edge-publication.ts";
import { promoteCensusState } from "../lib/census-geography/state-publication.ts";
import { censusGeographyCandidate } from "../lib/census-geography/candidate.ts";
import { CENSUS_GEO_CONTRACT_ID, censusGeographyScope } from "../lib/census-geography/publication.ts";
import type { BuiltDataset } from "../lib/census-geography/dataset.ts";
import { buildCensusDistrictEdge } from "../lib/census-geography/state-publication.ts";
import { withReaderSelection } from "../lib/db/reader-route.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store-local.ts";
import type { ReaderArtifactReadStore } from "../lib/meetings/edge-store.ts";
import { publishReaderEdgeArtifacts, readerAuthorityEdge } from "../lib/meetings/edge-serving.ts";

const now = "2026-10-16T00:00:00Z";
const metadata = { sourceThrough: now, retrievedAt: now, promotedThrough: now };
function dataset(state: string, stateFips: string, zip: string): BuiltDataset {
  return { formatVersion: 1, builtAt: now, coverage: "Constructed state manifest fixture", zctaUniverse: [zip], scopes: [{
    type: "county", version: "county:2020", fractionBasis: "area", instanceCount: 1, zctaEdgeCount: 1,
    versionMeta: { key: "county:2020", type: "county", plan: "Constructed test", zctaTabulation: "2020", effectiveFor: "Constructed test",
      provenance: { sourceUrls: ["https://publisher.gov/constructed"], sourceDataset: "CONSTRUCTED_TEST", sourceFiles: [], sourceChecksums: [], method: "Constructed test", computedAt: now } },
    groupings: [{ geoid: stateFips + "001", stateAbbr: state, stateFips, memberStates: [state], label: "Constructed county",
      ocdId: `ocd-division/country:us/state:${state.toLowerCase()}/county:constructed`, overlaps: [{ zcta5: zip, whole: true, fraction: 1 }] }],
  }] };
}

test("Census publication patches only its selected state; cold readers open only their state's index and children", async () => {
  const directory = mkdtempSync(join(tmpdir(), "census-state-manifest-"));
  try {
    const store = new LocalFileArtifactStore(directory);
    const first = await buildCensusDistrictEdge(dataset("AZ", "04", "85635"), "state-AZ-1", store);
    const other = await buildCensusDistrictEdge(dataset("NJ", "34", "07866"), "state-NJ-1", store);
    assert.equal((await publishReaderEdgeArtifacts(null, metadata, { store, now,
      censusDistricts: { AZ: { value: first, versionId: "state-AZ-1" }, NJ: { value: other, versionId: "state-NJ-1" } },
    })).status, "PUBLISHED");
    const before = (await store.readManifest())!.manifest;
    assert.equal(before.authorityArtifacts?.["census-districts"], undefined);
    const reads: string[] = [];
    const readonly: ReaderArtifactReadStore = { kind: store.kind, readManifest: () => store.readManifest(), readArtifact: key => store.readArtifact(key),
      readBytes: key => { reads.push(key); return store.readBytes(key); } };
    const edge = await readerAuthorityEdge(before, readonly, ["census-districts"]);
    assert.equal(reads.length, 0, "a manifest read must not load any state payload");
    const state = await edge.censusDistricts!.loadState("AZ");
    assert.equal(state.kind, "HELD");
    assert.deepEqual(reads, [before.censusDistricts!.AZ.key, first.states.AZ.key]);
    assert.ok(!reads.includes(before.censusDistricts!.NJ.key));
    reads.length = 0;
    const zipEdge = await readerAuthorityEdge(before, readonly, ["census-districts"]);
    const zip = await zipEdge.censusDistricts!.loadZip("85635");
    assert.ok(zip.kind === "HELD" && zip.value.known && zip.value.containers.length === 1);
    assert.deepEqual(reads, [before.censusDistricts!.AZ.key, first.zipPrefixes["856"].key, first.states.AZ.key]);
    const selection = { keys: new Set(["85635"]) };
    await withReaderSelection(selection, () => readerAuthorityEdge(before, readonly, ["census-districts"]));
    assert.ok(selection.keys.has("ocd-division/country:us/state:az/county:constructed"));
    reads.length = 0;
    const second = { ...first, coverage: "Updated one-state metadata" };
    assert.equal((await publishReaderEdgeArtifacts(null, metadata, { store: Object.assign(Object.create(store), {
      readBytes: (key: string) => { reads.push(key); return store.readBytes(key); },
    }), now, censusDistricts: { AZ: { value: second, versionId: "state-AZ-2" } } })).status, "PUBLISHED");
    const after = (await store.readManifest())!.manifest;
    assert.deepEqual(after.censusDistricts!.NJ, before.censusDistricts!.NJ);
    assert.notEqual(after.censusDistricts!.AZ.key, before.censusDistricts!.AZ.key);
    assert.equal(reads.length, 0, "updating one state must not reread accepted state payloads");
    const envelope = JSON.parse(gunzipSync((await store.readBytes(after.censusDistricts!.AZ.key))!).toString("utf8"));
    assert.equal(envelope.state, "AZ");
    assert.deepEqual(Object.keys(envelope.value.states), ["AZ"]);
    assert.equal((await publishReaderEdgeArtifacts(null, metadata, { store, now, censusDistricts: { AZ: { value: second, versionId: "state-AZ-2" } } })).status, "CURRENT");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("a malformed multi-state replacement cannot move any accepted Census reference", async () => {
  const directory = mkdtempSync(join(tmpdir(), "census-state-refusal-"));
  try {
    const store = new LocalFileArtifactStore(directory);
    const first = await buildCensusDistrictEdge(dataset("AZ", "04", "85635"), "one-state", store);
    await publishReaderEdgeArtifacts(null, metadata, { store, now, censusDistricts: { AZ: { value: first, versionId: "accepted" } } });
    const before = (await store.readManifest())!.manifest;
    const malformed = { ...first, states: { ...first.states, NJ: first.states.AZ } };
    assert.equal((await publishReaderEdgeArtifacts(null, metadata, { store, now,
      censusDistricts: { AZ: { value: malformed, versionId: "rejected" } },
    })).status, "FAILED");
    assert.deepEqual((await store.readManifest())!.manifest, before);
    const readonly: ReaderArtifactReadStore = { kind: store.kind, readManifest: () => store.readManifest(), readArtifact: key => store.readArtifact(key), readBytes: async () => null };
    const edge = await readerAuthorityEdge(before, readonly, ["census-districts"]);
    assert.equal((await edge.censusDistricts!.loadState("AZ")).kind, "UNREAD");
    assert.equal((await edge.censusDistricts!.loadZip("85635")).kind, "UNREAD");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("the ordinary selected publication reads only that state's canonical payload and retains other state's references", async () => {
  const directory = mkdtempSync(join(tmpdir(), "census-selected-publication-"));
  try {
    const artifacts = new LocalFileArtifactStore(directory);
    const memory = new MemoryRoutineDataStore();
    const first = await buildCensusDistrictEdge(dataset("AZ", "04", "85635"), "selected-state-AZ", artifacts);
    const other = await buildCensusDistrictEdge(dataset("NJ", "34", "07866"), "selected-state-NJ", artifacts);
    for (const index of [first, other]) {
      const candidate = censusGeographyCandidate(index);
      const promoted = await processRegisteredFanOutCandidate(memory, CENSUS_GEO_CONTRACT_ID, candidate, now);
      assert.ok(promoted.promoted, promoted.candidate.failureDetail ?? JSON.stringify(promoted.candidate.receipt));
    }
    await publishReaderEdgeArtifacts(null, metadata, { store: artifacts, now, censusDistricts: { NJ: { value: other, versionId: "accepted-other-state" } } });
    const before = (await artifacts.readManifest())!.manifest;
    const payloads: string[] = [];
    const store = new Proxy(memory, { get(target, key) {
      if (key === "readPromotion") return async (...args: Parameters<typeof memory.readPromotion>) => {
        if (args[0] === "CENSUS_GEOGRAPHY") payloads.push(args[1]);
        return target.readPromotion(...args);
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const result = await publishRoutineReaderEdgeOutcome(store, now,
      [{ recordClass: "CENSUS_GEOGRAPHY", scope: censusGeographyScope("AZ") }], { artifactStore: artifacts });
    assert.equal(result.ok, true, result.detail ?? "");
    assert.equal(result.readerEdge, "PUBLISHED");
    const after = (await artifacts.readManifest())!.manifest;
    assert.deepEqual(after.censusDistricts!.NJ, before.censusDistricts!.NJ);
    assert.ok(after.censusDistricts!.AZ);
    assert.deepEqual(payloads, [censusGeographyScope("AZ")]);
    assert.equal(after.authorityArtifacts?.["census-districts"], undefined);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("an accepted state repairs a failed reader publication without replacing the canonical version", async () => {
  const directory = mkdtempSync(join(tmpdir(), "census-state-retry-"));
  try {
    const artifacts = new LocalFileArtifactStore(directory);
    const memory = new MemoryRoutineDataStore();
    const writeManifest = artifacts.writeManifest.bind(artifacts);
    artifacts.writeManifest = async () => ({ modified: false, etag: null });
    const input = () => ({ state: "AZ", dataset: dataset("AZ", "04", "85635"), sourceVersion: "state-retry-source" });
    await assert.rejects(() => promoteCensusState(input(), { store: memory, artifactStore: artifacts, now }), /reader publication failed/);
    const accepted = await memory.readPromotionIdentity("CENSUS_GEOGRAPHY", censusGeographyScope("AZ"));
    assert.ok(accepted?.versionId, "the independently verified canonical state must remain published");
    assert.equal(await artifacts.readManifest(), null, "the losing reader write cannot claim a serving copy");
    artifacts.writeManifest = writeManifest;
    const repaired = await promoteCensusState(input(), { store: memory, artifactStore: artifacts, now });
    assert.equal(repaired.promoted?.versionId, accepted.versionId);
    const manifest = (await artifacts.readManifest())!.manifest;
    assert.deepEqual(Object.keys(manifest.censusDistricts!), ["AZ"]);
    const edge = await readerAuthorityEdge(manifest, artifacts, ["census-districts"]);
    const read = await edge.censusDistricts!.loadZip("85635");
    assert.ok(read.kind === "HELD" && read.value.known && read.value.containers.length === 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
