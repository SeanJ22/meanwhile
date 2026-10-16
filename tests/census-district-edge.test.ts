import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { BuiltDataset } from "../lib/census-geography/dataset.ts";
import { censusStateDataset, createCensusDistrictReaderEdge, readCensusDistrictState, type CensusDistrictEdge } from "../lib/census-geography/district-edge.ts";
import { buildCensusDistrictEdge, publishCensusDistrictState } from "../lib/census-geography/state-publication.ts";
import { createLookup } from "../lib/census-geography/lookup.ts";
import { publishReaderEdgeArtifacts, readerAuthorityEdge } from "../lib/meetings/edge-serving.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store-local.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { publishedZipDistricts, withCensusDistricts } from "../lib/geo/zip-census-districts.ts";

const directory = mkdtempSync(join(tmpdir(), "census-state-edge-"));
after(() => rmSync(directory, { recursive: true, force: true }));
const store = new LocalFileArtifactStore(directory);
const dataset = JSON.parse(readFileSync(new URL("../lib/census-geography/bootstrap-az.json", import.meta.url), "utf8")) as BuiltDataset;
const index = await buildCensusDistrictEdge(structuredClone(dataset), "isolated-promoted-census", store);

function observedStore() {
  const reads: string[] = [];
  const observed = Object.assign(Object.create(store) as LocalFileArtifactStore, {
    readBytes: async (key: string) => { reads.push(key); return store.readBytes(key); },
  });
  return { reads, observed };
}

test("state artifacts preserve every published membership without putting containers or codes in the state index", async () => {
  assert.equal(Object.hasOwn(index, "containers"), false);
  assert.equal(Object.hasOwn(index, "codes"), false);
  assert.ok(index.scopes.every(scope => !Object.hasOwn(scope, "groupings")));
  const lookup = createLookup(dataset, "isolated-promoted-census");
  const edge = createCensusDistrictReaderEdge(index, store);
  let compared = 0;
  for (const zip of dataset.zctaUniverse) {
    const expected = (await lookup.groupingsForZcta(zip)).memberships;
    const slice = await edge.loadZip(zip);
    assert.equal(slice.kind, "HELD");
    if (slice.kind !== "HELD") continue;
    const actual = slice.value.containers.map(c => [c.ref.type, c.ref.geoid, c.ref.version, c.overlaps?.[0].whole, c.overlaps?.[0].fraction]);
    const wanted = expected.map(m => [m.geography.type, m.geography.geoid, m.geography.version, m.whole, m.fraction]);
    assert.deepEqual(actual.sort(), wanted.sort(), zip);
    compared += actual.length;
  }
  assert.ok(compared > 500);
  const state = await readCensusDistrictState(index, "AZ", store);
  assert.ok(state);
  assert.deepEqual(censusStateDataset(state), dataset);
});

test("a cold ZIP request reads one prefix and its state artifact, without a database", async () => {
  const { observed, reads } = observedStore();
  const edge = createCensusDistrictReaderEdge(index, observed);
  const slice = await withReaderAuthorityEdge({ censusDistricts: edge, edgeOnly: true }, () => publishedZipDistricts("85635"));
  const local = "ocd-division/country:us/state:az/place:sierra_vista";
  const result = withCensusDistricts({ ids: [local], partial: [local], samples: 19 }, slice, "85635");
  for (const suffix of ["cd:6", "sldu:19", "sldl:19"]) assert.ok(result.ids.includes(`ocd-division/country:us/state:az/${suffix}`));
  assert.deepEqual(result.partial, [local]);
  assert.deepEqual(reads, [index.zipPrefixes["856"].key, index.states.AZ.key]);
  assert.equal((await withReaderAuthorityEdge({ edgeOnly: true }, () => publishedZipDistricts("85635"))).kind, "UNREAD");
});

test("a state read loads only that state's metadata and does not open ZIP or polygon artifacts", async () => {
  const { observed, reads } = observedStore();
  const edge = createCensusDistrictReaderEdge(index, observed);
  const state = await edge.loadState("AZ");
  assert.equal(state.kind, "HELD");
  assert.ok(state.kind === "HELD" && state.value.containers.every(container => container.ref.stateAbbr === "AZ" && !container.ref.geometry));
  assert.deepEqual(reads, [index.states.AZ.key]);
  assert.equal((await edge.loadState("NH")).kind, "NOT_PUBLISHED");
  assert.deepEqual(reads, [index.states.AZ.key]);
});

test("unknown ZIPs and corrupt immutable artifacts do not manufacture certainty", async () => {
  const missing = await createCensusDistrictReaderEdge(index, store).loadZip("00000");
  assert.ok(missing.kind === "HELD" && !missing.value.known);
  const changed = createCensusDistrictReaderEdge({ ...index, versionId: "different-version" }, store);
  assert.equal((await changed.loadZip("85635")).kind, "UNREAD");
  const corrupted = createCensusDistrictReaderEdge({ ...index, states: { ...index.states, AZ: { ...index.states.AZ, sha256: "0".repeat(64) } } }, store);
  assert.equal((await corrupted.loadZip("85635")).kind, "UNREAD");
  assert.equal((await createCensusDistrictReaderEdge(index, store).loadZip("bad")).kind, "UNREAD");
});

function constructedState(state: string, fips: string, fraction: number): BuiltDataset {
  const source = dataset.scopes.find(scope => scope.type === "state_leg_lower")!;
  const url = `https://policy-fixture.example/${state}.txt`;
  return { ...dataset, coverage: "Constructed cross-state policy fixture", zctaUniverse: ["86515", "85635"], scopes: [{ ...source, instanceCount: 1, zctaEdgeCount: 1,
    versionMeta: { ...source.versionMeta, states: [state], provenance: { ...source.versionMeta.provenance,
      sourceUrls: [url], sourceFiles: [`${state}.txt`], sourceChecksums: [createHash("sha256").update(state).digest("hex")],
      sourceValidators: [{ url, etag: state, lastModified: null, bytes: state.length }] } },
    groupings: [{ ...source.groupings[0],
    stateAbbr: state, stateFips: fips, memberStates: [state], geoid: `${fips}001`, ocdId: null,
    overlaps: [{ zcta5: "86515", whole: false, fraction }],
  }] }] };
}

async function publishStateFixture(state: string, input: BuiltDataset, version: string): Promise<CensusDistrictEdge> {
  const value = await publishCensusDistrictState({ state, dataset: structuredClone(input) }, `${version}:${state}`, store);
  const result = await publishReaderEdgeArtifacts(null, { sourceThrough: null, retrievedAt: input.builtAt, promotedThrough: input.builtAt }, {
    store, now: "2026-10-16T00:00:00Z", censusDistricts: { [state]: { value, versionId: value.versionId } },
  });
  assert.equal(result.status, "PUBLISHED");
  return value;
}
async function manifestReader(observed = store) {
  const current = await store.readManifest();
  assert.ok(current);
  const edge = await readerAuthorityEdge(current.manifest, observed, ["census-districts"]);
  assert.ok(edge.censusDistricts);
  return { reader: edge.censusDistricts, manifest: current.manifest };
}

test("independent state publication joins cross-state ZIPs and preserves known ZIPs without representation rows", async () => {
  const order: string[] = [];
  const published: Record<string, CensusDistrictEdge> = {};
  for (const [state, fips, fraction] of [["AZ", "04", 0.4], ["NM", "35", 0.6]] as const) {
    order.push(state);
    published[state] = await publishStateFixture(state, constructedState(state, fips, fraction), "cross-state-policy-fixture");
  }
  const { observed, reads } = observedStore();
  const { reader: edge, manifest } = await manifestReader(observed);
  assert.deepEqual(order, ["AZ", "NM"]);
  const summaries = Object.values(published).map(index => index.scopes[0]);
  assert.deepEqual(summaries.flatMap(scope => scope.versionMeta.states ?? []), ["AZ", "NM"]);
  assert.deepEqual(summaries.flatMap(scope => scope.versionMeta.provenance.sourceFiles), ["AZ.txt", "NM.txt"]);
  assert.deepEqual(summaries.flatMap(scope => scope.versionMeta.provenance.sourceChecksums), ["AZ", "NM"].map(state => createHash("sha256").update(state).digest("hex")));
  assert.deepEqual(summaries.flatMap(scope => scope.versionMeta.provenance.sourceUrls), ["AZ", "NM"].map(state => `https://policy-fixture.example/${state}.txt`));
  assert.equal(summaries.flatMap(scope => scope.versionMeta.provenance.sourceValidators ?? []).length, 2);
  const zip = await edge.loadZip("86515");
  assert.equal(zip.kind, "HELD");
  assert.ok(zip.kind === "HELD" && zip.value.known);
  if (zip.kind === "HELD") assert.deepEqual(zip.value.containers.map(row => [row.ref.stateAbbr, row.overlaps?.[0].fraction]), [["AZ", 0.4], ["NM", 0.6]]);
  assert.deepEqual([...reads].sort(), [manifest.censusDistricts!.AZ.key, manifest.censusDistricts!.NM.key,
    published.AZ.zipPrefixes["865"].key, published.AZ.states.AZ.key, published.NM.zipPrefixes["865"].key, published.NM.states.NM.key].sort());
  const empty = await edge.loadZip("85635");
  assert.ok(empty.kind === "HELD" && empty.value.known && empty.value.containers.length === 0);
});

test("shared metros retain each state's ZIP rows without forcing the other state's artifact into a cold request", async () => {
  const original = dataset.scopes.find(scope => scope.type === "cbsa")!;
  const published: Record<string, CensusDistrictEdge> = {};
  for (const [state, fips, zip] of [["AZ", "04", "85635"], ["NM", "35", "88001"]] as const) {
    const local = constructedState(state, fips, 1);
    const input: BuiltDataset = { ...local, zctaUniverse: [zip], scopes: [
      { ...local.scopes[0], groupings: local.scopes[0].groupings.map(group => ({ ...group, overlaps: [{ zcta5: zip, whole: true, fraction: 1 }] })) },
      { ...original, instanceCount: 1, zctaEdgeCount: 1, groupings: [{ ...original.groupings[0], geoid: "99999", stateAbbr: "AZ", stateFips: "04", memberStates: ["AZ", "NM"],
        overlaps: [{ zcta5: zip, whole: true, fraction: 1 }] }] },
    ] };
    published[state] = await publishStateFixture(state, input, "shared-metro-policy-fixture");
  }
  const states = await Promise.all(Object.entries(published).map(([state, index]) => readCensusDistrictState(index, state, store)));
  const metros = states.flatMap(state => state ? censusStateDataset(state).scopes.filter(scope => scope.type === "cbsa").flatMap(scope => scope.groupings) : []);
  assert.equal(new Set(metros.map(group => group.geoid)).size, 1);
  assert.equal(metros.reduce((sum, group) => sum + group.overlaps.length, 0), 2);
  const state = await readCensusDistrictState(published.NM, "NM", store);
  assert.ok(state);
  assert.deepEqual(censusStateDataset(state).scopes.find(scope => scope.type === "cbsa")!.groupings[0].overlaps, [{ zcta5: "88001", whole: true, fraction: 1 }]);
  const { observed, reads } = observedStore();
  const { reader, manifest } = await manifestReader(observed);
  const zip = await reader.loadZip("88001");
  assert.ok(zip.kind === "HELD" && zip.value.containers.some(row => row.ref.type === "cbsa"));
  assert.deepEqual(reads, [manifest.censusDistricts!.NM.key, published.NM.zipPrefixes["880"].key, published.NM.states.NM.key]);
});

test("publishing a state writes its polygon separately and cold metadata reads leave polygon bytes unopened", async () => {
  const input = constructedState("AZ", "04", 1);
  const square = { type: "Polygon" as const, coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] };
  const polygonDataset = { ...input, scopes: input.scopes.map(scope => ({ ...scope, groupings: scope.groupings.map(group => ({ ...group, geometry: square })) })) };
  const published = await buildCensusDistrictEdge(structuredClone(polygonDataset), "separate-boundary-fixture", store);
  const { observed, reads } = observedStore();
  const state = await createCensusDistrictReaderEdge(published, observed).loadState("AZ");
  assert.equal(state.kind, "HELD");
  if (state.kind !== "HELD") return;
  const ref = state.value.containers[0].ref;
  assert.equal(ref.geometry, undefined);
  assert.ok(ref.geometryRef?.key);
  assert.deepEqual(reads, [published.states.AZ.key]);
  assert.ok(await store.readBytes(ref.geometryRef.key));
});

test("a proven empty source scope survives state reconstruction for the next conditional refresh", async () => {
  const input = constructedState("AZ", "04", 1);
  const empty = { ...input.scopes[0], type: "state_leg_upper" as const, version: "sldu:proven-empty", instanceCount: 0, zctaEdgeCount: 0, groupings: [],
    versionMeta: { ...input.scopes[0].versionMeta, type: "state_leg_upper" as const, key: "sldu:proven-empty", retrievalComplete: true } };
  const published = await buildCensusDistrictEdge(structuredClone({ ...input, scopes: [...input.scopes, empty] }), "empty-scope-reuse", store);
  assert.ok(published.scopes.every(scope => scope.instanceCount > 0));
  const state = await readCensusDistrictState(published, "AZ", store);
  assert.ok(state);
  const restored = censusStateDataset(state).scopes.find(scope => scope.version === empty.version);
  assert.ok(restored);
  assert.equal(restored.versionMeta.retrievalComplete, true);
  assert.deepEqual(restored.groupings, []);
  assert.deepEqual(restored.versionMeta.provenance, empty.versionMeta.provenance);
});
