import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { BuiltDataset } from "../lib/census-geography/dataset.ts";
import { buildCensusDistrictEdge, censusStateDataset, createCensusDistrictReaderEdge, publishCensusDistrictStates, readCensusDistrictState } from "../lib/census-geography/district-edge.ts";
import { createLookup } from "../lib/census-geography/lookup.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { publishedZipDistricts, withCensusDistricts } from "../lib/geo/zip-census-districts.ts";

const directory = mkdtempSync(join(tmpdir(), "census-state-edge-"));
after(() => rmSync(directory, { recursive: true, force: true }));
const store = new LocalFileArtifactStore(directory);
const dataset = JSON.parse(readFileSync(new URL("../lib/census-geography/bootstrap-az.json", import.meta.url), "utf8")) as BuiltDataset;
const index = await buildCensusDistrictEdge(dataset, "isolated-promoted-census", store);

function observedStore() {
  const reads: string[] = [];
  const observed = Object.assign(Object.create(store) as LocalFileArtifactStore, {
    readBytes: async (key: string) => { reads.push(key); return store.readBytes(key); },
  });
  return { reads, observed };
}

test("state artifacts preserve every published membership without putting containers or codes in the national index", async () => {
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
  return { ...dataset, coverage: "Constructed cross-state policy fixture", zctaUniverse: ["00001", "00002"], scopes: [{ ...source,
    versionMeta: { ...source.versionMeta, states: [state], provenance: { ...source.versionMeta.provenance,
      sourceUrls: [url], sourceFiles: [`${state}.txt`], sourceChecksums: [createHash("sha256").update(state).digest("hex")],
      sourceValidators: [{ url, etag: state, lastModified: null, bytes: state.length }] } },
    groupings: [{ ...source.groupings[0],
    stateAbbr: state, stateFips: fips, memberStates: [state], geoid: `${fips}001`, ocdId: null,
    overlaps: [{ zcta5: "00001", whole: false, fraction }],
  }] }] };
}

test("streamed state publication joins cross-state ZIPs and preserves known ZIPs without representation rows", async () => {
  const order: string[] = [];
  async function* inputs() {
    for (const [state, fips, fraction] of [["AZ", "04", 0.4], ["NM", "35", 0.6]] as const) {
      order.push(state);
      yield { state, dataset: constructedState(state, fips, fraction) };
    }
  }
  const published = await publishCensusDistrictStates(inputs(), "cross-state-policy-fixture", store);
  const { observed, reads } = observedStore();
  const edge = createCensusDistrictReaderEdge(published, observed);
  assert.deepEqual(order, ["AZ", "NM"]);
  assert.deepEqual(published.scopes[0].versionMeta.states, ["AZ", "NM"]);
  assert.deepEqual(published.scopes[0].versionMeta.provenance.sourceFiles, ["AZ.txt", "NM.txt"]);
  assert.deepEqual(published.scopes[0].versionMeta.provenance.sourceChecksums, ["AZ", "NM"].map(state => createHash("sha256").update(state).digest("hex")));
  assert.deepEqual(published.scopes[0].versionMeta.provenance.sourceUrls, ["AZ", "NM"].map(state => `https://policy-fixture.example/${state}.txt`));
  assert.equal(published.scopes[0].versionMeta.provenance.sourceValidators?.length, 2);
  const zip = await edge.loadZip("00001");
  assert.equal(zip.kind, "HELD");
  assert.ok(zip.kind === "HELD" && zip.value.known);
  if (zip.kind === "HELD") assert.deepEqual(zip.value.containers.map(row => [row.ref.stateAbbr, row.overlaps?.[0].fraction]), [["AZ", 0.4], ["NM", 0.6]]);
  assert.deepEqual(reads, [published.zipPrefixes["000"].key, published.states.AZ.key, published.states.NM.key]);
  const empty = await edge.loadZip("00002");
  assert.ok(empty.kind === "HELD" && empty.value.known && empty.value.containers.length === 0);
});

test("shared metros retain each state's ZIP rows without forcing the other state's artifact into a cold request", async () => {
  const original = dataset.scopes.find(scope => scope.type === "cbsa")!;
  async function* inputs() {
    for (const [state, fips, zip] of [["AZ", "04", "00001"], ["NM", "35", "00002"]] as const) {
      const local = constructedState(state, fips, 1);
      yield { state, dataset: { ...local, zctaUniverse: [zip], scopes: [
        { ...local.scopes[0], groupings: local.scopes[0].groupings.map(group => ({ ...group, overlaps: [{ zcta5: zip, whole: true, fraction: 1 }] })) },
        { ...original, groupings: [{ ...original.groupings[0], geoid: "99999", stateAbbr: "AZ", stateFips: "04", memberStates: ["AZ", "NM"],
          overlaps: ["00001", "00002"].map(zcta5 => ({ zcta5, whole: true, fraction: 1 })) }] },
      ] } };
    }
  }
  const published = await publishCensusDistrictStates(inputs(), "shared-metro-policy-fixture", store);
  const summary = published.scopes.find(scope => scope.type === "cbsa")!;
  assert.equal(summary.instanceCount, 1);
  assert.equal(summary.zctaEdgeCount, 2);
  const state = await readCensusDistrictState(published, "NM", store);
  assert.ok(state);
  assert.deepEqual(censusStateDataset(state).scopes.find(scope => scope.type === "cbsa")!.groupings[0].overlaps, [{ zcta5: "00002", whole: true, fraction: 1 }]);
  const { observed, reads } = observedStore();
  const zip = await createCensusDistrictReaderEdge(published, observed).loadZip("00002");
  assert.ok(zip.kind === "HELD" && zip.value.containers.some(row => row.ref.type === "cbsa"));
  assert.deepEqual(reads, [published.zipPrefixes["000"].key, published.states.NM.key]);
});

test("publishing a state writes its polygon separately and cold metadata reads leave polygon bytes unopened", async () => {
  const input = constructedState("AZ", "04", 1);
  const square = { type: "Polygon" as const, coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] };
  const polygonDataset = { ...input, scopes: input.scopes.map(scope => ({ ...scope, groupings: scope.groupings.map(group => ({ ...group, geometry: square })) })) };
  const published = await buildCensusDistrictEdge(polygonDataset, "separate-boundary-fixture", store);
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
