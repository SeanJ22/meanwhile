import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { authorityPointerKey, ensureReaderAuthorityEdge, readServedPointer, writeAuthorityPointer } from "../lib/meetings/edge-serving.ts";
import { publishPointers } from "./helpers/edge-pointers.ts";
import { readRegistryRuntimeProjection, registryRuntimeReadState, getRegistryRuntimeReadModel } from "../lib/registry/runtime-read-model.ts";
import { withReaderAuthorityEdge, ReaderEdgeOnlyRefusal, settleEdgeFirst } from "../lib/registry/runtime-edge.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import { registryTransferImport } from "./helpers/promoted-fixtures.ts";
import { provenEdgeEntry } from "./helpers/promoted-edge-entry.ts";
import { stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";
import { registryJurisdictions } from "../lib/civic-data/state-scopes.ts";
import { seatHolderById } from "../lib/registry/server.ts";
import { rosterHoldersForBody } from "../lib/registry/body-rosters.ts";

function registryFixtureForState(state: string, value: RegistryRuntimeReadModel = registryTransferImport().projection.payload): RegistryRuntimeReadModel {
  const own = (id: string | null) => registryJurisdictions(id).includes(state.toUpperCase());
  const bodies = value.registry.bodies.filter(row => own(row.id) || own(row.ocdId) || row.alsoServesOcdIds?.some(own));
  const bodyIds = new Set(bodies.map(row => row.id));
  const bodyRosters = value.bodyRosters.filter(row => bodyIds.has(row.bodyId));
  const statewideExecutives = value.statewideExecutives.filter(row => own(row.stateOcdId));
  const bridge = value.officialCandidacies.rows.filter(row => row.holder.divisions.some(own));
  const holders = new Set([...bodyRosters.flatMap(row => row.members.map(member => member.id)),
    ...statewideExecutives.map(row => row.holder.id), ...bridge.map(row => row.holder.id)]);
  return { ...value, registry: { ...value.registry, bodies,
    divisions: value.registry.divisions.filter(row => row.ocdId === "ocd-division/country:us" || own(row.ocdId)) },
    bodyRosters, statewideExecutives, officialCandidacies: { ...value.officialCandidacies, rows: bridge },
    officialPhotos: { photos: value.officialPhotos.photos.filter(row => holders.has(row.officeholderId)) },
    rosterPhotos: Object.fromEntries(Object.entries(value.rosterPhotos).filter(([id]) => holders.has(id) || own(id))),
    rosterReaderDispositions: value.rosterReaderDispositions.filter(row => own(row.sourceId) || holders.has(row.sourceId) || (row.canonicalId !== null && holders.has(row.canonicalId)) ||
      [...holders].some(id => id.startsWith("roster:") && id.split("#")[0] === row.sourceId.split("#")[0])) };
}

function stateRegistryArtifacts(versionId: string, states: readonly string[], value: RegistryRuntimeReadModel = registryTransferImport().projection.payload) {
  return Object.fromEntries(states.map(state => [state, { versionId: `${versionId}:${state}`, value: { kind: "PROMOTED_POINTERS" as const,
    entries: [provenEdgeEntry({ recordClass: "REGISTRY_RUNTIME_BINDING", scope: stateRegistryRuntimeScope(state), sourceId: "registry-reviewed-bindings",
      versionId: `${versionId}:${state}`, value: registryFixtureForState(state, value) })] } }]));
}



const stateAuthorities = (version: string) => ({ "registry-runtime": stateRegistryArtifacts(version, ["AZ"]) });
function artifacts(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(join(tmpdir(), "rt-edge-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  return new LocalFileArtifactStore(dir);
}

test("a member lookup reuses its already-held state without narrowing the other explicitly loaded states", async t => {
  const store = artifacts(t);
  await publishPointers(store, { stateAuthorities: { "registry-runtime": stateRegistryArtifacts("member-context", ["AZ", "NJ"]) } });
  const readBytes = store.readBytes.bind(store), keys: string[] = [];
  store.readBytes = async key => { keys.push(key); return readBytes(key); };
  const edge = await ensureReaderAuthorityEdge(null, store, ["registry-runtime"]);
  await withReaderAuthorityEdge({ ...edge!, edgeOnly: true }, async () => {
    const current = await readRegistryRuntimeProjection(["AZ", "NJ"]);
    const before = [...keys];
    const njRoster = getRegistryRuntimeReadModel().bodyRosters.find(roster => roster.bodyId.includes("/state:nj/"))!;
    const njHolder = rosterHoldersForBody(njRoster.bodyId).find(holder => holder.termNote)!;
    assert.ok(njHolder);
    assert.equal((await seatHolderById(njHolder.id))?.termNote, njHolder.termNote);
    assert.equal(registryRuntimeReadState(), current);
    const azHolders = rosterHoldersForBody("ocd-division/country:us/state:az/county:pima#central-arizona-water-conservation-district");
    assert.equal(azHolders.length, 15);
    for (const holder of azHolders) assert.equal((await seatHolderById(holder.id, "AZ"))?.termNote, holder.termNote);
    assert.equal(registryRuntimeReadState(), current);
    assert.deepEqual(keys, before, "nested member lookups open no additional state artifact");
  });
});

test("the runner publishes one state registry losslessly, and its reader stays lazy until that state is requested", async t => {
  const store = artifacts(t);
  assert.deepEqual(await publishPointers(store, { stateAuthorities: stateAuthorities("rt-v1") }), ["registry-runtime/AZ"]);
  const ref = (await readServedPointer(store, authorityPointerKey("registry-runtime", "AZ")))!.ref;
  assert.ok(ref.key.endsWith(".json.gz")); assert.equal(ref.version, "rt-v1:AZ"); assert.ok(ref.sha);
  assert.equal(await store.readManifest(), null, "a state pointer writes no manifest");
  const edge = await ensureReaderAuthorityEdge(null, store, ["registry-runtime"]);
  await withReaderAuthorityEdge({ ...edge!, edgeOnly: true }, async () => {
    assert.throws(getRegistryRuntimeReadModel, /STORE_UNREACHABLE/);
    const read = await readRegistryRuntimeProjection(["AZ"]);
    assert.equal(read.kind, "PROMOTED"); assert.equal(read.metadata.versionId, "rt-v1:AZ");
    assert.deepEqual(read.value, registryFixtureForState("AZ"));
    assert.equal(getRegistryRuntimeReadModel(), read.value);
    assert.equal(registryRuntimeReadState(), read);
  });
});

test("the same state version writes nothing and a successor rewrites only that state's pointer", async t => {
  const store = artifacts(t);
  await publishPointers(store, { stateAuthorities: { "registry-runtime": stateRegistryArtifacts("rt-v1", ["AZ", "NH"]) } });
  const nh = await store.readJsonPointer(authorityPointerKey("registry-runtime", "NH"));
  assert.deepEqual(await publishPointers(store, { stateAuthorities: stateAuthorities("rt-v1") }), []);
  assert.deepEqual(await publishPointers(store, { stateAuthorities: stateAuthorities("rt-v2") }), ["registry-runtime/AZ"]);
  assert.equal((await readServedPointer(store, authorityPointerKey("registry-runtime", "AZ")))!.ref.version, "rt-v2:AZ");
  assert.deepEqual(await store.readJsonPointer(authorityPointerKey("registry-runtime", "NH")), nh);
});

test("settleEdgeFirst uses an edge value, falls back only when absent, and refuses a database read in an edge-only context", async () => {
  const calls: string[] = [];
  const settle = (edge: { value: { n: number }; versionId: string } | null) => settleEdgeFirst(() => edge,
    (value, version) => { calls.push(`prime:${value.n}:${version}`); }, async () => { calls.push("database"); }, "The probe family");
  await settle({ value: { n: 7 }, versionId: "edge-v7" }); assert.deepEqual(calls.splice(0), ["prime:7:edge-v7"]);
  await settle(null); assert.deepEqual(calls.splice(0), ["database"]);
  await withReaderAuthorityEdge({ edgeOnly: true }, () => assert.rejects(settle(null), ReaderEdgeOnlyRefusal));
  assert.deepEqual(calls, []);
});

test("a new request starts without another request's registry payload", async () => {
  await withReaderAuthorityEdge({}, async () => {
    assert.throws(getRegistryRuntimeReadModel, /STORE_UNREACHABLE/);
    await assert.rejects(readRegistryRuntimeProjection([]), /REGISTRY_STATES_NOT_SELECTED/);
  });
});

test("an unchanged family reads no bytes, and a stale writer never replaces the pointer that won", async t => {
  const store = artifacts(t);
  await publishPointers(store, { authority: { "campaign-sites": { value: { records: [] }, versionId: "cs-v1" } } });
  let reads = 0; const original = store.readBytes.bind(store);
  t.mock.method(store, "readBytes", async (key: string) => { reads++; return original(key); });
  assert.deepEqual(await publishPointers(store, { authority: { "campaign-sites": { value: { records: [] }, versionId: "cs-v1" } } }), []);
  assert.equal(reads, 0);
  const stale = await readServedPointer(store, authorityPointerKey("campaign-sites"));
  await publishPointers(store, { authority: { "campaign-sites": { value: { records: [] }, versionId: "cs-v2" } } });
  assert.equal(await writeAuthorityPointer(store, "campaign-sites", undefined, { value: { records: [] }, versionId: "cs-old" }, stale, "2026-10-17T00:00:00.000Z"), false);
  assert.equal((await readServedPointer(store, authorityPointerKey("campaign-sites")))!.ref.version, "cs-v2");
});
