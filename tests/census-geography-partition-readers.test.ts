import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadPublishedAreaLookupState } from "../lib/census-geography/area-lookup.ts";
import type { BuiltDataset, BuiltScope } from "../lib/census-geography/dataset.ts";
import { buildCensusDistrictEdge } from "../lib/census-geography/district-edge.ts";
import { createPublishedIndexLookup } from "../lib/census-geography/reader.ts";
import { loadPublishedScopeLookupState } from "../lib/census-geography/scope-lookup.ts";
import { containersOfCode, stateContainers, type ReadOnlyQuery } from "../lib/control-plane/admin-view/promoted-slices.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store-local.ts";

const bootstrap = JSON.parse(readFileSync("lib/census-geography/bootstrap-az.json", "utf8")) as BuiltDataset;
const zip = "85701", otherZip = "99999";
const county = bootstrap.scopes.find(scope => scope.type === "county")!;
const ownCounty = county.groupings.find(group => group.overlaps.some(overlap => overlap.zcta5 === zip))!;
const countyScope: BuiltScope = { ...county, groupings: [ownCounty, { ...ownCounty, geoid: "06001", stateAbbr: "CA", stateFips: "06", memberStates: ["CA"],
  overlaps: [{ zcta5: otherZip, whole: true, fraction: 1 }] }] };
const cbsa = bootstrap.scopes.find(scope => scope.type === "cbsa")!;
const shared = { ...cbsa.groupings[0], stateAbbr: "AZ", memberStates: ["AZ", "CA"],
  overlaps: [{ zcta5: zip, whole: false, fraction: .5 }, { zcta5: otherZip, whole: false, fraction: .5 }] };
const dataset: BuiltDataset = { ...bootstrap, zctaUniverse: [zip, otherZip], scopes: [countyScope, { ...cbsa, groupings: [shared] }] };

class RecordingStore extends LocalFileArtifactStore {
  reads: string[] = [];
  override async readBytes(key: string): Promise<Uint8Array | null> { this.reads.push(key); return super.readBytes(key); }
}

async function fixture(run: (store: RecordingStore, index: Awaited<ReturnType<typeof buildCensusDistrictEdge>>, query: ReadOnlyQuery) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "census-partition-readers-"));
  try {
    const store = new RecordingStore(directory);
    const index = await buildCensusDistrictEdge(dataset, "partition-test", store);
    store.reads = [];
    const query: ReadOnlyQuery = async statements => {
      assert.equal(statements.length, 1);
      assert.match(statements[0].text, /^SELECT current_version_id AS version_id, payload FROM/);
      assert.doesNotMatch(statements[0].text, /jsonb_array_elements/);
      return [[{ version_id: "canonical-test", payload: index }]];
    };
    await run(store, index, query);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test("canonical metadata reads summaries; state and ZIP reads never open unrelated state artifacts", async () => fixture(async (store, index, query) => {
  const lookup = createPublishedIndexLookup(index, "canonical-test", store);
  assert.equal((await lookup.manifest()).publishedVersion, "canonical-test");
  assert.equal((await lookup.listVersions()).length, 2);
  assert.equal((await lookup.enumerateGroupings("county")).status.kind, "UNKNOWN");
  assert.deepEqual(store.reads, []);
  const state = await stateContainers("AZ", ["county", "cbsa"], false, query, store);
  assert.equal(state.kind, "HELD");
  assert.deepEqual(store.reads, [index.states.AZ.key]);
  assert.ok(state.kind === "HELD" && state.value.containers.every(row => row.ref.memberStates.includes("AZ")));
  store.reads = [];
  const code = await containersOfCode(zip, ["county", "cbsa"], query, store);
  assert.equal(code.kind, "HELD");
  assert.deepEqual(store.reads, [index.zipPrefixes[zip.slice(0, 3)].key, index.states.AZ.key]);
  assert.ok(code.kind === "HELD" && code.value.known && code.value.containers.length === 2);
  store.reads = [];
  assert.equal((await lookup.zctasForGrouping({ type: "county", geoid: ownCounty.geoid, version: county.version })).status.kind, "OK");
  assert.deepEqual(store.reads, [index.states.AZ.key]);
}));

test("place readers keep touching districts within county states; explicit CBSA scope preserves its cross-state membership", async () => fixture(async (store, index, query) => {
  const area = await loadPublishedAreaLookupState([zip], query, store);
  assert.equal(area.source, "published");
  const areaCbsa = await area.lookup.zctasForGrouping({ type: "cbsa", geoid: shared.geoid, version: cbsa.version });
  assert.equal(areaCbsa.status.kind, "OK");
  assert.deepEqual(areaCbsa.overlaps.map(overlap => overlap.zcta5), [zip]);
  assert.ok(!store.reads.includes(index.states.CA.key));
  store.reads = [];
  const scope = await loadPublishedScopeLookupState([{ type: "cbsa", geoid: shared.geoid, version: cbsa.version, label: shared.label, stateAbbr: "AZ" }], query, store);
  assert.equal(scope.source, "published");
  const all = await scope.lookup.zctasForGrouping({ type: "cbsa", geoid: shared.geoid, version: cbsa.version });
  assert.equal(all.status.kind, "OK");
  assert.deepEqual(all.overlaps.map(overlap => overlap.zcta5), [zip, otherZip]);
  assert.deepEqual(store.reads, [index.states.AZ.key, index.states.CA.key]);
}));

test("missing state bytes are unread and never produce a successful empty place", async () => fixture(async (store, index, query) => {
  const original = store.readBytes.bind(store);
  store.readBytes = async key => key === index.states.AZ.key ? null : original(key);
  assert.equal((await stateContainers("AZ", ["county"], false, query, store)).kind, "UNREAD");
  const area = await loadPublishedAreaLookupState([zip], query, store);
  assert.equal(area.source, "unavailable");
  assert.notEqual((await area.lookup.groupingsForZcta(zip)).status.kind, "OK");
  const lookup = createPublishedIndexLookup(index, "canonical-test", store);
  assert.equal((await lookup.groupingsForZcta(zip)).status.kind, "UNKNOWN");
  assert.deepEqual(await lookup.reconcilePostalZips([zip]), [{ zip, isZcta: false, outsideCoverageReason: "unknown" }]);
}));
