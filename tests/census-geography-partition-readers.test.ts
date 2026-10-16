import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadPublishedAreaLookupState } from "../lib/census-geography/area-lookup.ts";
import type { BuiltDataset, BuiltScope } from "../lib/census-geography/dataset.ts";
import { type CensusDistrictEdge } from "../lib/census-geography/district-edge.ts";
import { publishCensusDistrictState } from "../lib/census-geography/state-publication.ts";
import { createPublishedIndexLookup, loadPublishedLookupState } from "../lib/census-geography/reader.ts";
import { censusGeographyScope } from "../lib/census-geography/publication.ts";
import { loadPublishedScopeLookupState } from "../lib/census-geography/scope-lookup.ts";
import { containersOfCode, readCensusGeographyIndex, stateContainers, type ReadOnlyQuery, type Statement } from "../lib/control-plane/admin-view/promoted-slices.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store-local.ts";

const bootstrap = JSON.parse(readFileSync("lib/census-geography/bootstrap-az.json", "utf8")) as BuiltDataset;
const zip = "85701", otherZip = "99999";
const county = bootstrap.scopes.find(scope => scope.type === "county")!;
const ownCounty = { ...county.groupings.find(group => group.overlaps.some(overlap => overlap.zcta5 === zip))!,
  overlaps: [{ zcta5: zip, whole: true, fraction: 1 }] };
const cbsa = bootstrap.scopes.find(scope => scope.type === "cbsa")!;
const shared = { ...cbsa.groupings[0], stateAbbr: "AZ", memberStates: ["AZ", "CA"] };

class RecordingStore extends LocalFileArtifactStore {
  reads: string[] = [];
  override async readBytes(key: string): Promise<Uint8Array | null> { this.reads.push(key); return super.readBytes(key); }
}

async function fixture(run: (store: RecordingStore, indexes: Record<string, CensusDistrictEdge>, query: ReadOnlyQuery,
  seen: Statement[]) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "census-partition-readers-"));
  try {
    const store = new RecordingStore(directory), indexes: Record<string, CensusDistrictEdge> = {};
    for (const [state, stateZip, geoid] of [["AZ", zip, ownCounty.geoid], ["CA", otherZip, "06001"], ["NH", "03579", "33007"], ["ME", "03579", "23017"]]) {
      const group = { ...ownCounty, geoid, stateAbbr: state, stateFips: geoid.slice(0, 2), memberStates: [state],
        overlaps: [{ zcta5: stateZip, whole: state !== "NH" && state !== "ME", fraction: state === "NH" || state === "ME" ? .5 : 1 }] };
      const scopes: BuiltScope[] = [{ ...county, groupings: [group], instanceCount: 1, zctaEdgeCount: 1 }];
      if (state === "AZ" || state === "CA") scopes.push({ ...cbsa,
        groupings: [{ ...shared, overlaps: [{ zcta5: stateZip, whole: false, fraction: .5 }] }], instanceCount: 1, zctaEdgeCount: 1 });
      const dataset: BuiltDataset = { ...bootstrap, zctaUniverse: [stateZip], scopes };
      indexes[state] = await publishCensusDistrictState({ state, dataset }, `partition-test-${state}`, store);
    }
    store.reads = [];
    const seen: Statement[] = [];
    const query: ReadOnlyQuery = async statements => {
      seen.push(...statements);
      assert.equal(statements.length, 1);
      assert.match(statements[0].text, /^SELECT current_version_id AS version_id, payload FROM/);
      assert.doesNotMatch(statements[0].text, /jsonb_array_elements/);
      const state = Object.keys(indexes).find(state => statements[0].params[1] === censusGeographyScope(state));
      assert.ok(state, "every SQL read names exactly one state publication");
      return [[{ version_id: `canonical-${state}`, payload: indexes[state] }]];
    };
    await run(store, indexes, query, seen);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test("canonical metadata and ZIP reads open only the selected state publication", async () => fixture(async (store, indexes, query, seen) => {
  const index = indexes.AZ, lookup = createPublishedIndexLookup(index, "canonical-AZ", store);
  assert.equal((await lookup.manifest()).publishedVersion, "canonical-AZ");
  assert.equal((await lookup.listVersions()).length, 2);
  assert.deepEqual(store.reads, []);
  assert.equal((await lookup.enumerateGroupings("county")).status.kind, "OK");
  assert.deepEqual(store.reads, [index.states.AZ.key]);
  store.reads = [];
  const state = await stateContainers("AZ", ["county", "cbsa"], false, query, store);
  assert.equal(state.kind, "HELD");
  assert.deepEqual(store.reads, [index.states.AZ.key]);
  assert.ok(state.kind === "HELD" && state.value.containers.every(row => row.ref.memberStates.includes("AZ")));
  store.reads = [];
  const code = await containersOfCode(zip, ["county", "cbsa"], query, store);
  assert.equal(code.kind, "HELD");
  assert.deepEqual(store.reads, [index.zipPrefixes[zip.slice(0, 3)].key, index.states.AZ.key]);
  assert.ok(code.kind === "HELD" && code.value.known && code.value.containers.length === 2);
  assert.ok(seen.every(statement => statement.params[1] === censusGeographyScope("AZ")));
}));

test("place readers keep touching districts within county states; explicit CBSA scope preserves cross-state membership", async () => fixture(async (store, indexes, query, seen) => {
  const area = await loadPublishedAreaLookupState([zip], query, store);
  assert.equal(area.source, "published");
  const areaCbsa = await area.lookup.zctasForGrouping({ type: "cbsa", geoid: shared.geoid, version: cbsa.version });
  assert.equal(areaCbsa.status.kind, "OK");
  assert.deepEqual(areaCbsa.overlaps.map(overlap => overlap.zcta5), [zip]);
  assert.ok(!store.reads.includes(indexes.CA.states.CA.key));
  assert.deepEqual(seen.map(statement => statement.params[1]), [censusGeographyScope("AZ")]);
  store.reads = []; seen.length = 0;
  const scope = await loadPublishedScopeLookupState([{ type: "cbsa", geoid: shared.geoid, version: cbsa.version, label: shared.label, stateAbbr: "AZ" }], query, store);
  assert.equal(scope.source, "published");
  const all = await scope.lookup.zctasForGrouping({ type: "cbsa", geoid: shared.geoid, version: cbsa.version });
  assert.equal(all.status.kind, "OK");
  assert.deepEqual(all.overlaps.map(overlap => overlap.zcta5), [zip, otherZip]);
  assert.deepEqual(store.reads, [indexes.AZ.states.AZ.key, indexes.CA.states.CA.key]);
  assert.deepEqual(seen.map(statement => statement.params[1]), [censusGeographyScope("AZ"), censusGeographyScope("CA")]);
}));

test("a cross-state ZIP reads both raw touching states and preserves both counties", async () => fixture(async (store, indexes, query, seen) => {
  const slice = await containersOfCode("03579", ["county"], query, store);
  assert.equal(slice.kind, "HELD");
  assert.ok(slice.kind === "HELD" && slice.value.known);
  assert.deepEqual(slice.kind === "HELD" && slice.value.containers.map(row => row.ref.stateAbbr).sort(), ["ME", "NH"]);
  assert.deepEqual(seen.map(statement => statement.params[1]).sort(), [censusGeographyScope("ME"), censusGeographyScope("NH")]);
  assert.ok(!store.reads.includes(indexes.AZ.states.AZ.key));
  const area = await loadPublishedAreaLookupState(["03579"], query, store);
  assert.deepEqual((await area.lookup.groupingsForZcta("03579")).memberships.map(row => row.geography.stateAbbr).sort(), ["ME", "NH"]);
}));

test("missing state bytes and a missing ZIP-state graph cannot produce a successful empty place", async () => fixture(async (store, indexes, query) => {
  const original = store.readBytes.bind(store);
  store.readBytes = async key => key === indexes.AZ.states.AZ.key ? null : original(key);
  assert.equal((await stateContainers("AZ", ["county"], false, query, store)).kind, "UNREAD");
  const area = await loadPublishedAreaLookupState([zip], query, store);
  assert.equal(area.source, "unavailable");
  assert.notEqual((await area.lookup.groupingsForZcta(zip)).status.kind, "OK");
  const lookup = createPublishedIndexLookup(indexes.AZ, "canonical-AZ", store);
  assert.equal((await lookup.groupingsForZcta(zip)).status.kind, "UNKNOWN");
  assert.deepEqual(await lookup.reconcilePostalZips([zip]), [{ zip, isZcta: false, outsideCoverageReason: "unknown" }]);
  assert.equal((await containersOfCode("00000", ["county"], query, store)).kind, "UNREAD");
}));

test("unbounded reads are unknown and a state scope refuses a country index", async () => fixture(async (store, indexes) => {
  const unbounded = await loadPublishedLookupState({ artifactStore: store });
  assert.equal(unbounded.source, "unavailable");
  assert.equal(unbounded.versionId, "STATE_REQUIRED");
  assert.equal((await unbounded.lookup.enumerateGroupings("county")).status.kind, "UNKNOWN");
  assert.deepEqual((await unbounded.lookup.manifest()).scopes, []);
  assert.deepEqual(await unbounded.lookup.listVersions(), []);
  assert.deepEqual(store.reads, []);
  const country = { ...indexes.AZ, states: { ...indexes.AZ.states, ...indexes.CA.states } };
  assert.equal((await readCensusGeographyIndex(async () => [[{ version_id: "invalid", payload: country }]], "AZ")).kind, "UNREAD");
}));
