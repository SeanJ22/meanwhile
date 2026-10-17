import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { stateOfOcdId, type ReaderManifest, isStateAuthorityFamily } from "../lib/meetings/edge-artifacts.ts";
import { LocalFileArtifactStore, resolveReaderArtifactWriteStore } from "../lib/meetings/edge-store.ts";
import { publishReaderEdgeArtifacts, readReaderEdgeMeetings, readServedMeetingIndex, servedWholeFromReaderEdge, ensureReaderAuthorityEdge } from "../lib/meetings/edge-serving.ts";
import { emptyMeetingIndexRow, readerIndexOf, type MeetingStateIndex } from "../lib/meetings/body-records.ts";
import { bodyPointerOf, stateIndexOf } from "./helpers/meeting-body-national.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { meetingSettingsFromValues } from "../lib/meetings/settings.ts";

import { selectedStateEdgePointers } from "../lib/civic-data/promoted-edge-publication.ts";
import { installFactReader } from "../lib/facts/db.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { censusGeographyCandidate } from "../lib/census-geography/candidate.ts";
import { CENSUS_GEO_CONTRACT_ID } from "../lib/census-geography/publication.ts";
import { publishStatePeople } from "../lib/civic-data/state-people-publication.ts";
import { PUBLISH_NOW_INTERVAL_MS, publishNowHasNothingOwed, startPublishNowEdgeChecks } from "../lib/civic-data/publish-now.ts";
import { heldRegistrationReceipt } from "../lib/registration/acquire.ts";
import { registrationCandidate } from "../lib/registration/candidate.ts";
import { registrationTarget } from "../lib/registration/publication.ts";
import { loadRegistrationReference } from "../lib/registration/reference.ts";
import { normalize, yamlToPeople } from "../lib/sources/plural/index.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { publishSupervisorReaderEdge } from "../lib/civic-data/reader-edge-publication.ts";
import { prepareStateArtifactChild, stateArtifactResultLine } from "../lib/civic-data/state-artifact-dispatch.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import { registryTransferImport } from "./helpers/promoted-fixtures.ts";
import { registryJurisdictions } from "../lib/civic-data/state-scopes.ts";
import { provenEdgeEntry } from "./helpers/promoted-edge-entry.ts";
import { stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";
import { stateRegistryRuntimeContractId } from "../lib/civic-data/state-scopes.ts";
import { rowKeyedCivicRecordsFor } from "../lib/civic-data/changes.ts";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import { trustedLkgImportUrl } from "../lib/civic-data/trusted-lkg-import.ts";
import { withStateRecordHashes } from "../lib/civic-data/state-publication.ts";
import { candidateChangeSet } from "../lib/civic-data/changes.ts";
import { ROW_KEYED_CIVIC_CHANGE_CONTRACT } from "../lib/civic-data/changes.ts";
import { trustedLkgCandidateEnvelopeSha256 } from "../lib/civic-data/trusted-lkg-import.ts";
import { trustedLkgValidatorIds } from "../lib/civic-data/trusted-lkg-import.ts";
import { trustedLkgCandidateId } from "../lib/civic-data/trusted-lkg-import.ts";
import type { CandidateVersionRecord } from "../lib/civic-data/types.ts";
import type { PromotedProjection } from "../lib/civic-data/types.ts";
import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import {
  HOUR, NEWBURY, PIMA, T1, T2, T3, at, freshEdge, publishPass, readPartition, readPlace, row,
} from "./helpers/meeting-body-fixtures.ts";
import { agendaFor, promoteRows } from "./helpers/reader-edge-meetings.ts";

function stateRegistryRuntimeStore(state: string, store = new MemoryRoutineDataStore()): MemoryRoutineDataStore {
  const original = registryTransferImport();
  const payload = registryFixtureForState(state), scope = stateRegistryRuntimeScope(state), contractId = stateRegistryRuntimeContractId(state);
  const civicRecords = rowKeyedCivicRecordsFor("REGISTRY_RUNTIME_BINDING", payload), digest = canonicalCivicDataHash(payload);
  const candidate = { ...original.record.candidate, scope,
    retrieval: { ...original.record.candidate.retrieval, requestedUrl: trustedLkgImportUrl(contractId) },
    normalization: { ...original.record.candidate.normalization, normalizedHash: digest, normalizedPayloadHash: digest,
      inputRecords: civicRecords.length, outputRecords: civicRecords.length, droppedRecords: 0 },
    normalizedPayload: payload, readModel: payload, civicRecords, identities: [],
    horizon: { ...original.record.candidate.horizon, returnedRecords: civicRecords.length },
    sourceProjectionEvidence: { kind: "SOURCE_PROJECTION_CONTRACT" as const, sourceId: original.record.candidate.sourceId, recordClass: original.record.candidate.recordClass, scope },
  };
  Object.assign(candidate, { normalization: withStateRecordHashes(candidate).normalization });
  candidate.changeSet = candidateChangeSet(candidate, null, ROW_KEYED_CIVIC_CHANGE_CONTRACT);
  candidate.bootstrapImport = { ...original.record.candidate.bootstrapImport!, contractId, scope,
    normalizedPayloadSha256: digest, readModelSha256: digest, candidateEnvelopeSha256: trustedLkgCandidateEnvelopeSha256(candidate), validatorIds: trustedLkgValidatorIds(candidate) };
  candidate.id = trustedLkgCandidateId(candidate.bootstrapImport);
  const receipt = { ...original.record.receipt!, candidateId: candidate.id, scope };
  const record = { ...original.record, candidate, receipt, promotedVersion: candidate.id, lastKnownGoodVersion: candidate.id };
  const projection = { ...original.projection, key: `REGISTRY_RUNTIME_BINDING:${scope}`, scope, versionId: candidate.id,
    lastKnownGoodVersionId: candidate.id, payload, receipt };
  const held = store as unknown as { candidates: Map<string, CandidateVersionRecord>; promotions: Map<string, PromotedProjection> };
  held.candidates.set(candidate.id, record);
  held.promotions.set(projection.key, projection);
  return store;
}

function stateRegistryArtifacts(versionId: string, states: readonly string[], value: RegistryRuntimeReadModel = registryTransferImport().projection.payload) {
  return Object.fromEntries(states.map(state => [state, { versionId: `${versionId}:${state}`, value: { kind: "PROMOTED_POINTERS" as const,
    entries: [provenEdgeEntry({ recordClass: "REGISTRY_RUNTIME_BINDING", scope: stateRegistryRuntimeScope(state), sourceId: "registry-reviewed-bindings",
      versionId: `${versionId}:${state}`, value: registryFixtureForState(state, value) })] } }]));
}

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


type Inputs = Parameters<typeof publishSupervisorReaderEdge>;

function publishReaderEdgeOutcomeForTest(store: Inputs[0], now: Inputs[1], selected: Inputs[2] = null, options: Inputs[3] = {}) {
  const artifactStore = options.artifactStore === undefined ? resolveReaderArtifactWriteStore() : options.artifactStore;
  return publishSupervisorReaderEdge(store, now, selected, { ...options, stateArtifactChildren: {
    slots: { acquire: async () => () => {} },
    launch: async command => {
      const arg = (name: string) => command.args.find(value => value.startsWith(`--${name}=`))!.slice(name.length + 3);
      const state = arg("state"), family = arg("family");
      if (!artifactStore || !isStateAuthorityFamily(family)) throw new Error("TEST_STATE_ARTIFACT_INPUT_INVALID");
      const entry = await prepareStateArtifactChild(store, artifactStore, state, family, arg("version"), now);
      return { id: command.id, status: 0, signal: null, termination: "EXITED", stderr: "", errorMessage: null,
        stdout: stateArtifactResultLine(state, family, entry) };
    },
  } }, { WTP_READER_EDGE_LOCAL_OK: "1", WTP_RUNTIME_AUTHORITY_REPO: process.cwd(), WTP_RUNTIME_AUTHORITY_SHA: "f".repeat(40) });
}

async function publishReaderEdgeForTest(...args: Parameters<typeof publishReaderEdgeOutcomeForTest>): Promise<boolean> {
  return (await publishReaderEdgeOutcomeForTest(...args)).ok;
}

const CHANDLER = MEETING_PARTITION_CONTRACTS.find((p) => p.derivedFamily === null && p.meetingSource === "schedulepage" && p.bodyId === "ocd-division/country:us/state:az/place:chandler#governing")!;
const MORRIS = MEETING_PARTITION_CONTRACTS.find((p) => p.derivedFamily === null && p.meetingSource === "iqm2" && p.bodyId === "ocd-division/country:us/state:nj/county:morris#governing")!;
const MEETING_POINTERS = [{ recordClass: "MEETING" as const, scope: PIMA.scope }];

const sittingsOf = (read: Awaited<ReturnType<typeof readPlace>>) => read.kind === "PROMOTED" ? read.value.meetings.map((m) => m.id).sort() : [];
const anIndex = (state: string, version: string) => ({ versionId: version, value: readerIndexOf(emptyMeetingIndexRow(state, version)) });

async function servedIndex(edge: LocalFileArtifactStore, state: string): Promise<MeetingStateIndex> {
  const manifest = (await edge.readManifest())!.manifest;
  return (await readServedMeetingIndex(state, manifest.meetingStates![state], edge))!;
}

test("a losing publisher cannot overwrite any bytes selected by the winning manifest", async () => {
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-race-")));
  let releaseReads!: () => void, releaseLoser!: () => void;
  const readsReady = new Promise<void>(resolve => { releaseReads = resolve; });
  const winnerPublished = new Promise<void>(resolve => { releaseLoser = resolve; });
  let reads = 0;
  const writer = (loser: boolean) => new Proxy(store, { get(target, key) {
    if (key === "readManifest") return async () => {
      const value = await target.readManifest();
      if (++reads === 2) releaseReads();
      await readsReady;
      return value;
    };
    if (key === "putImmutable") return async (...args: Parameters<typeof store.putImmutable>) => {
      if (loser) await winnerPublished;
      return target.putImmutable(...args);
    };
    if (key === "writeManifest") return async (...args: Parameters<typeof store.writeManifest>) => {
      const result = await target.writeManifest(...args);
      if (!loser) releaseLoser();
      return result;
    };
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const publish = (loser: boolean) => publishReaderEdgeArtifacts({
    store: writer(loser), meetingStates: { AZ: anIndex("AZ", loser ? "loser" : "winner") },
    authority: { "federal-directory": { versionId: "next", value: { winner: !loser } } },
    registrations: { az: { versionId: "next", value: { winner: !loser } } },
  });
  const [winner, loser] = await Promise.all([publish(false), publish(true)]);
  assert.equal(winner.status, "PUBLISHED");
  assert.equal(loser.status, "RACED");
  const manifest = (await store.readManifest())!.manifest;
  assert.equal(manifest.meetingStates!.AZ.version, "winner");
  for (const ref of [manifest.authorityArtifacts!["federal-directory"]!, manifest.registrations!.az]) {
    const envelope = JSON.parse(gunzipSync((await store.readBytes(ref.key))!).toString("utf8"));
    assert.equal(envelope.value.base.winner, true);
  }
});

test("state people load only the requested jurisdiction and failed replacements keep accepted references", async () => {
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-state-people-")));
  assert.equal((await publishReaderEdgeArtifacts({ store, stateLegislators: {
    "US-AZ": { versionId: "az-1", value: { jurisdiction: "US-AZ", officeholders: [] } },
    "US-NH": { versionId: "nh-1", value: { jurisdiction: "US-NH", officeholders: [] } },
  } })).status, "PUBLISHED");
  const first = (await store.readManifest())!.manifest;
  let reads = 0;
  const counting = new Proxy(store, { get(target, key) {
    if (key === "readBytes") return async (path: string) => { reads++; return target.readBytes(path); };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  const bundle = await ensureReaderAuthorityEdge(first, counting, ["state-legislators"]);
  assert.equal(reads, 0, "entering a nationwide manifest opens no state payload");
  assert.deepEqual(new Set(bundle.stateLegislators?.jurisdictions), new Set(["US-AZ", "US-NH"]));
  assert.equal((await bundle.stateLegislators!.load("US-AZ"))?.versionId, "az-1");
  assert.equal(reads, 1);
  assert.equal((await bundle.stateLegislators!.load("US-AZ"))?.versionId, "az-1");
  assert.equal(reads, 1, "unchanged jurisdiction is reused");
  assert.equal((await publishReaderEdgeArtifacts({ store, stateLegislators: {
    "US-AZ": { versionId: "az-2", value: { jurisdiction: "US-AZ", officeholders: [] } },
    "US-NH": { versionId: "nh-1", carried: true },
  } })).status, "PUBLISHED");
  const next = (await store.readManifest())!.manifest;
  assert.deepEqual(next.stateLegislators!["US-NH"], first.stateLegislators!["US-NH"]);
  assert.equal(next.stateLegislators!["US-AZ"].version, "az-2");
  assert.equal((await publishReaderEdgeArtifacts({ store, meetingStates: { AZ: anIndex("AZ", "new-meeting") } })).status, "PUBLISHED");
  assert.deepEqual((await store.readManifest())!.manifest.stateLegislators, next.stateLegislators, "a meetings-only pass keeps the state references");
});

test("an obsolete country roster reference is never opened by a state reader", async () => {
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-state-country-ref-")));
  const manifest: ReaderManifest = { formatVersion: 1, sequence: 1,
    authorityArtifacts: Object.fromEntries([["state-legislators", { key: "country-roster", version: "US-AZ=az-v1", sha: "held" }]]) };
  let countryReads = 0;
  const guarded = new Proxy(store, { get(target, key) {
    if (key === "readBytes") return async () => { countryReads++; throw new Error("Country roster opened"); };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  const bundle = await ensureReaderAuthorityEdge(manifest, guarded, ["state-legislators"]);
  assert.equal(bundle.stateLegislators, undefined);
  assert.equal(countryReads, 0);
});

test("state ballot and auxiliary publication carries country facts, routing and people without querying or opening them", async t => {
  const artifacts = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-state-isolation-")));
  await publishReaderEdgeArtifacts({ store: artifacts, authority: {
    "everyday-routing": { value: { projection: { records: [{ id: "route" }] } }, versionId: "routing-v1" },
  }, stateLegislators: { "US-AZ": { value: { jurisdiction: "US-AZ", officeholders: [] }, versionId: "az-prior" } } });
  const before = (await artifacts.readManifest())!.manifest;
  let factReads = 0, artifactReads = 0;
  installFactReader(async () => { factReads++; return [{ newest: "552900", live: "552900" }]; });
  t.after(() => installFactReader(undefined));
  const guarded = new Proxy(artifacts, { get(target, key) {
    if (key === "readBytes") return async () => { artifactReads++; throw new Error("Unrelated country artifact opened"); };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  const memory = new MemoryRoutineDataStore();
  const scoped = new Proxy(memory, { get(target, key) {
    if (key === "listPromotionScopes") return async () => { throw new Error("Country pointer catalogue touched"); };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  for (const pointers of selectedStateEdgePointers(null).filter(row => row.state === "IL").map(row => row.pointers)) {
    assert.equal(await publishReaderEdgeForTest(scoped, "2026-10-15T00:00:00Z", pointers, { artifactStore: guarded }), true);
    const next = (await artifacts.readManifest())!.manifest;
    assert.deepEqual(next.authorityArtifacts, before.authorityArtifacts);
    assert.deepEqual(next.stateLegislators, before.stateLegislators, "unrelated publication preserves every jurisdiction reference unread");
    for (const field of ["commentAccess", "everydayRouting", "extrasVersionIds"]) assert.equal(Object.hasOwn(next, field), false);
  }
  assert.equal(factReads, 0, "changed unrelated facts do not trigger a country scan");
  assert.equal(artifactReads, 0);
});

test("a check-only meeting publication advances the manifest and preserves every accepted authority and state reference", async () => {
  const artifacts = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-manifest-checks-")));
  await publishReaderEdgeArtifacts({ store: artifacts, now: "2026-10-15T00:00:00Z",
    extras: { everydayRouting: { rows: [] }, versionIds: { "everyday-routing": "routing-v1" } },
    meetingStates: { AZ: anIndex("AZ", "index-1") },
    authority: { "everyday-routing": { value: { projection: null }, versionId: "routing-v1" } },
    stateAuthorities: { "ballot-contests": { AZ: { value: { kind: "PROMOTED_POINTERS", entries: [] }, versionId: "az-v1" } } } });
  const before = (await artifacts.readManifest())!.manifest;
  assert.equal((await publishReaderEdgeArtifacts({ store: artifacts, now: "2026-10-16T00:00:00Z", meetingStates: { AZ: anIndex("AZ", "index-2") } })).status, "PUBLISHED");
  const after = (await artifacts.readManifest())!.manifest;
  assert.equal(after.meetingStates!.AZ.version, "index-2");
  assert.equal(after.sequence, before.sequence + 1);
  for (const field of ["authorityArtifacts", "stateAuthorities", "everydayRouting", "extrasVersionIds"] as const) {
    assert.deepEqual(after[field], before[field]);
  }
});

test("state, national authority and meeting updates share one manifest CAS", async () => {
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-shared-cas-")));
  await publishReaderEdgeArtifacts({ store, meetingStates: { AZ: anIndex("AZ", "held") },
    authority: { "campaign-sites": { value: {}, versionId: "sites-v1" } } });
  const before = (await store.readManifest())!;
  assert.equal((await publishReaderEdgeArtifacts({ store,
    stateAuthorities: { "registry-runtime": { AZ: { value: { kind: "PROMOTED_POINTERS", entries: [] }, versionId: "az-v1" } } } })).status, "PUBLISHED");
  const after = (await store.readManifest())!;
  assert.deepEqual(after.manifest.meetingStates, before.manifest.meetingStates);
  assert.deepEqual(after.manifest.authorityArtifacts, before.manifest.authorityArtifacts);
  assert.equal(after.manifest.stateAuthorities!["registry-runtime"]!.AZ.version, "az-v1");
  assert.notEqual(after.etag, before.etag);
  assert.equal((await store.writeManifest({ ...before.manifest, sequence: 2 }, before.etag)).modified, false,
    "a stale meeting or national writer cannot erase newly published state references");
});

test("a lost manifest CAS remains a retryable supervisor publication failure", async () => {
  const artifacts = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-supervisor-race-")));
  const raced = new Proxy(artifacts, { get(target, key) {
    if (key === "writeManifest") return async () => ({ modified: false, etag: "winner" });
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  assert.equal(await publishReaderEdgeForTest(new MemoryRoutineDataStore(), "2026-09-06T00:00:00Z", [], { artifactStore: raced }), false);
  assert.equal(await artifacts.readManifest(), null);
});

test("stateOfOcdId derives the state a division lies in", () => {
  assert.equal(stateOfOcdId("ocd-division/country:us/state:az/place:tucson#governing"), "az");
  assert.equal(stateOfOcdId("ocd-division/country:us/state:nj/county:morris"), "nj");
  assert.equal(stateOfOcdId("ocd-division/country:us"), null);
  assert.equal(stateOfOcdId(null), null);
});

test("every area a canonical body governs receives the same meeting and agenda without duplicate copies", async () => {
  const store = new MemoryRoutineDataStore();
  const edge = freshEdge();
  const primary = PIMA.ocdId!, neighbour = "ocd-division/country:us/state:az/county:cochise";
  const sitting = row(PIMA, "shared", "2026-10-12T17:00:00.000Z", T1);
  await promoteRows(store, PIMA, [sitting], [agendaFor(sitting, primary, T1)], T1);
  const registry = async (state: string) => state === "AZ" ? { bodies: [{ id: PIMA.bodyId, ocdId: primary, alsoServesOcdIds: [neighbour, primary, neighbour] }] } : null;
  assert.equal((await publishPass(store, edge, at(T1, HOUR), registry)).status, "PUBLISHED");

  const index = await servedIndex(edge, "AZ");
  assert.deepEqual(index.bodies, [PIMA.bodyId], "one record for the body, not one per area");
  assert.deepEqual(index.places, { [neighbour]: [PIMA.bodyId], [primary]: [PIMA.bodyId] });
  for (const area of [primary, neighbour]) {
    const read = await readPlace(edge, store, [area], at(T1, HOUR), { includeAgenda: true });
    assert.equal(read.kind, "PROMOTED");
    assert.deepEqual(sittingsOf(read), [sitting.id]);
    assert.deepEqual(read.kind === "PROMOTED" && read.value.agendaDocuments.map((document) => document.meetingId), [sitting.id]);
  }
  const both = await readPlace(edge, store, [primary, neighbour], at(T1, HOUR), { includeAgenda: true });
  assert.deepEqual(sittingsOf(both), [sitting.id], "a read of both areas holds the sitting once");
  assert.equal(both.kind === "PROMOTED" && both.value.agendaDocuments.length, 1);
});

test("ordinary publication carries quiet bodies, files a body under every area its registry names, and rebuilds when the territory changes", async t => {
  const primary = PIMA.ocdId!, secondary = "ocd-division/country:us/state:az/county:cochise", bodyId = PIMA.bodyId;
  const artifacts = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "runner-area-edge-")));
  const memory = new MemoryRoutineDataStore();
  await readPartition(memory, PIMA, T1, ["a"]);
  const registryKeys = new Set<string>();
  const publishRegistry = async (version: string, others: string[]) => {
    await publishReaderEdgeArtifacts({ store: artifacts,
      stateAuthorities: { "registry-runtime": stateRegistryArtifacts(version, ["AZ"], { ...registryFixtureForState("AZ"), registry: {
        ...registryFixtureForState("AZ").registry, bodies: [{ ...registryFixtureForState("AZ").registry.bodies[0]!, id: bodyId, ocdId: primary, alsoServesOcdIds: others }],
      } }) } });
    registryKeys.add((await artifacts.readManifest())!.manifest.stateAuthorities!["registry-runtime"]!.AZ.key);
  };
  await publishRegistry("registry-v1", [secondary]);
  let registryReads = 0;
  const originalRead = artifacts.readBytes.bind(artifacts);
  t.mock.method(artifacts, "readBytes", async (key: string) => { if (registryKeys.has(key)) registryReads++; return originalRead(key); });
  const options = { artifactStore: artifacts };
  assert.equal(await publishReaderEdgeForTest(memory, at(T1, HOUR), MEETING_POINTERS, options), true);
  let held = (await artifacts.readManifest())!;
  assert.equal((await stateIndexOf(memory, "AZ"))!.registryVersion, "registry-v1:AZ");
  assert.deepEqual(Object.keys((await servedIndex(artifacts, "AZ")).places).sort(), [primary, secondary].sort());
  assert.equal(registryReads, 1);
  assert.equal(await publishReaderEdgeForTest(memory, at(T1, 2 * HOUR), MEETING_POINTERS, options), true);
  assert.equal(registryReads, 1, "a quiet pass does not open the registry again");
  assert.equal((await artifacts.readManifest())!.manifest.sequence, held.manifest.sequence);
  await publishRegistry("registry-v2", []);
  assert.equal(await publishReaderEdgeForTest(memory, at(T1, 3 * HOUR), MEETING_POINTERS, options), true);
  held = (await artifacts.readManifest())!;
  assert.equal((await stateIndexOf(memory, "AZ"))!.registryVersion, "registry-v2:AZ");
  assert.deepEqual(Object.keys((await servedIndex(artifacts, "AZ")).places), [primary]); assert.equal(registryReads, 2);
  const refs = held.manifest.stateAuthorities!["registry-runtime"]!;
  await artifacts.writeManifest({ ...held.manifest, stateAuthorities: { ...held.manifest.stateAuthorities,
    "registry-runtime": { ...refs, AZ: { ...refs.AZ, version: "raced-pointer" } } } }, held.etag ?? null);
  const beforeFailure = (await artifacts.readManifest())!.manifest;
  assert.equal(await publishReaderEdgeForTest(memory, at(T1, 4 * HOUR), MEETING_POINTERS, options), false);
  assert.deepEqual((await artifacts.readManifest())!.manifest, beforeFailure);
});

test("a body that races its row keeps its exact held record while an independent registry update publishes, then the next pass repairs it", async () => {
  const memory = stateRegistryRuntimeStore("AZ");
  const projection = (await memory.readPromotion("REGISTRY_RUNTIME_BINDING", "US-AZ:reader-registry-runtime"))!;
  const artifacts = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "meeting-registry-race-")));
  await readPartition(memory, PIMA, T1, ["held"]);
  await publishReaderEdgeArtifacts({ store: artifacts, stateAuthorities: { "registry-runtime": stateRegistryArtifacts("registry-old", ["AZ"]) } });
  const options = { artifactStore: artifacts };
  assert.equal(await publishReaderEdgeForTest(memory, at(T1, HOUR), MEETING_POINTERS, options), true);
  const before = (await bodyPointerOf(artifacts, "AZ", PIMA.bodyId))!;
  assert.equal((await stateIndexOf(memory, "AZ"))!.registryVersion, "registry-old:AZ");
  const held = await readPlace(artifacts, memory, [PIMA.ocdId!], at(T1, HOUR));
  assert.equal(sittingsOf(held).length, 1);

  await readPartition(memory, PIMA, T2, ["held", "new"]);
  let race = true;
  const store = new Proxy(memory, { get(target, key) {
    if (key === "writePreparedReaderProjection") return async (...args: Parameters<typeof memory.writePreparedReaderProjection>) => {
      if (race && args[0].scope.startsWith("US-AZ:meetings-body:")) { race = false; await memory.writePreparedReaderProjection(args[0], args[1]); }
      return memory.writePreparedReaderProjection(...args);
    };
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const selected = [{ recordClass: "REGISTRY_RUNTIME_BINDING" as const, scope: projection.scope }, ...MEETING_POINTERS];
  assert.equal(await publishReaderEdgeForTest(store, at(T2, HOUR), selected, options), false, "the raced body remains owed");
  const independent = (await artifacts.readManifest())!.manifest;
  assert.notEqual(independent.stateAuthorities!["registry-runtime"]!.AZ.version, "registry-old:AZ", "verified registry facts publish during meeting recovery");
  assert.deepEqual((await bodyPointerOf(artifacts, "AZ", PIMA.bodyId))!.record, before.record, "the body keeps the record it was served from");
  const stillHeld = await readPlace(artifacts, memory, [PIMA.ocdId!], at(T2, HOUR));
  assert.deepEqual(sittingsOf(stillHeld), sittingsOf(held), "readers keep the held sittings while the new ones are owed");
  assert.deepEqual((await memory.readMeetingQueue()).map((row) => row.scope), [PIMA.scope], "the new version stays queued");

  assert.equal(await publishReaderEdgeForTest(store, at(T2, 2 * HOUR), MEETING_POINTERS, options), true);
  assert.equal((await stateIndexOf(memory, "AZ"))!.registryVersion, independent.stateAuthorities!["registry-runtime"]!.AZ.version);
  assert.equal(sittingsOf(await readPlace(artifacts, memory, [PIMA.ocdId!], at(T2, 2 * HOUR))).length, 2, "the next pass serves the new sitting");
  assert.deepEqual(await memory.readMeetingQueue(), []);
});

test("a state's index files its bodies under the division each serves, in a stable order", async () => {
  const store = new MemoryRoutineDataStore();
  const edge = freshEdge();
  await readPartition(store, PIMA, T1, ["a"]);
  await readPartition(store, CHANDLER, T1, ["c"]);
  await readPartition(store, MORRIS, T1, ["m"]);
  await readPartition(store, NEWBURY, T1, ["n"]);
  await publishPass(store, edge, at(T1, HOUR));
  const az = await servedIndex(edge, "AZ");
  assert.deepEqual(Object.keys(az.places), [PIMA.ocdId, CHANDLER.ocdId], "city and county are separate places even inside the same state");
  assert.deepEqual(az.bodies, [PIMA.bodyId, CHANDLER.bodyId]);
  assert.deepEqual(az.places[PIMA.ocdId!], [PIMA.bodyId]);
  assert.deepEqual((await servedIndex(edge, "NJ")).bodies, [MORRIS.bodyId], "another state's body never stands in an Arizona place");
  assert.deepEqual(Object.keys((await servedIndex(edge, "NH")).places), [NEWBURY.ocdId]);
  const again = freshEdge();
  await publishPass(store, again, at(T1, HOUR));
  assert.deepEqual((await servedIndex(again, "AZ")).places, az.places, "the same bodies give the same index");
});

test("publish → read round-trips through the file store and a place reads only its own bodies", async () => {
  const store = new MemoryRoutineDataStore();
  const edge = freshEdge();
  await readPartition(store, PIMA, T1, ["az1", "az2"]);
  await readPartition(store, MORRIS, T1, ["nj1"]);
  const published = await publishPass(store, edge, at(T1, HOUR));
  assert.equal(published.status, "PUBLISHED");
  const manifest = (await edge.readManifest())!.manifest;
  assert.equal(manifest.sequence, 1);

  // An Arizona reader gets Arizona's bodies, never New Jersey's, and needs no database to be answered.
  const azRead = await readReaderEdgeMeetings({ store: edge, states: ["az"], ocdIds: [PIMA.ocdId!], now: at(T1, HOUR) });
  assert.equal(azRead.kind, "PROMOTED");
  if (azRead.kind !== "PROMOTED") return;
  assert.deepEqual(azRead.value.meetings.map((m) => m.id.split(":")[2]).sort(), ["az1", "az2"]);
  assert.match(azRead.detail, /Served from 1\/1 body record\(s\) in/);
  assert.equal(servedWholeFromReaderEdge(azRead), true);
});

test("republishing unchanged meetings is idempotent (CURRENT), and a check or changed data moves only the body's pointer, never the manifest", async () => {
  const store = new MemoryRoutineDataStore();
  const edge = freshEdge();
  await readPartition(store, PIMA, T1, ["az1"]);
  const sequence = async () => (await edge.readManifest())!.manifest.sequence;
  const first = await publishPass(store, edge, at(T1, HOUR));
  assert.equal(first.status, "PUBLISHED");
  assert.equal(await sequence(), 1);

  // The same data and the same "Last checked" → nothing republished.
  const same = await publishPass(store, edge, at(T1, 2 * HOUR));
  assert.equal(same.status, "CURRENT");
  assert.equal(await sequence(), 1);

  // The same data checked again later → the body's pointer alone moves, so "Last checked" moves; no record and no manifest is rewritten.
  const recordBefore = (await bodyPointerOf(edge, "AZ", PIMA.bodyId))!.record;
  await readPartition(store, PIMA, T2, ["az1"]);
  const again = await publishPass(store, edge, at(T2, 5 * 60_000));
  assert.equal(again.status, "CURRENT");
  assert.equal(again.plan.stats.recordsWritten, 0, "no artifact is rewritten for a check");
  assert.equal(again.plan.stats.pointersWritten, 1);
  assert.equal(await sequence(), 1);
  assert.deepEqual((await bodyPointerOf(edge, "AZ", PIMA.bodyId))!.record, recordBefore);
  const checked = await readPlace(edge, store, [PIMA.ocdId!], at(T2, 5 * 60_000));
  assert.equal(checked.kind === "PROMOTED" && checked.value.generatedAt, T2);

  // Changed data → a new immutable record, which the body's pointer now names.
  await readPartition(store, PIMA, T3, ["az1", "az2"]);
  const advanced = await publishPass(store, edge, at(T3, 60_000));
  assert.equal(advanced.status, "CURRENT");
  assert.equal(advanced.plan.stats.recordsWritten, 1);
  assert.notEqual((await bodyPointerOf(edge, "AZ", PIMA.bodyId))!.record, recordBefore);
  assert.equal(await sequence(), 1, "the manifest moves only when a state's index does");
  assert.equal(sittingsOf(await readPlace(edge, store, [PIMA.ocdId!], at(T3, 60_000))).length, 2);
});

test("a stale publisher that read an older manifest cannot regress the pointer (monotonic CAS)", async () => {
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-edge-")));
  await publishReaderEdgeArtifacts({ store, meetingStates: { AZ: anIndex("AZ", "first") } });

  const staleExpected = (await store.readManifest())!.etag;
  // First writer advances 1 -> 2.
  await publishReaderEdgeArtifacts({ store, meetingStates: { AZ: anIndex("AZ", "second") } });
  // Second (stale) writer tries to CAS against the OLD etag → refused, no regression.
  const refused = await store.writeManifest({ formatVersion: 1, sequence: 2 } as ReaderManifest, staleExpected);
  assert.equal(refused.modified, false, "a CAS against a superseded etag writes nothing");
  const now = (await store.readManifest())!.manifest;
  assert.equal(now.sequence, 2, "the newer publication still stands");
  assert.equal(now.meetingStates!.AZ.version, "second");
});

test("with no manifest on the edge the reader answers from the database and never claims the answer is the CDN's", async () => {
  const store = new MemoryRoutineDataStore();
  await readPartition(store, PIMA, T1, ["db1", "db2"]);
  await publishPass(store, freshEdge(), at(T1, HOUR));
  const nothingPublished = freshEdge();
  assert.equal(await nothingPublished.readManifest(), null);
  const read = await readPlace(nothingPublished, store, [PIMA.ocdId!], at(T1, HOUR));
  assert.equal(sittingsOf(read).length, 2, "the database's index and body row answer");
  assert.equal(servedWholeFromReaderEdge(read), false);
  assert.doesNotMatch(read.kind === "PROMOTED" ? read.detail : read.detail ?? read.kind, /Served from 0\//);
});

test("the reader caches each body record in-process per version and refreshes on a new one", async () => {
  const edge = freshEdge();
  const store = new MemoryRoutineDataStore();
  let reads = 0;
  // Count only blob reads; every other store call is delegated unchanged.
  const counting = new Proxy(edge, {
    get(target, prop) {
      const orig = (target as unknown as Record<string | symbol, unknown>)[prop];
      if (prop === "readBytes") {
        return (key: string) => {
          reads++;
          return (orig as (k: string) => unknown).call(target, key);
        };
      }
      return typeof orig === "function" ? (orig as (...a: unknown[]) => unknown).bind(target) : orig;
    },
  });

  await readPartition(store, PIMA, T1, ["cache-az1"]);
  await publishPass(store, counting, at(T1, HOUR));
  const read = () => readReaderEdgeMeetings({ store: counting, ocdIds: [PIMA.ocdId!], now: at(T1, HOUR) });

  const first = await read();
  assert.equal(first.kind, "PROMOTED");
  const readsAfterFirst = reads;
  assert.ok(readsAfterFirst >= 1, "the first read fetches the index and the body's record from the store");

  // A second read of the SAME published version serves from the in-process cache.
  const second = await read();
  assert.equal(second.kind, "PROMOTED");
  assert.equal(reads, readsAfterFirst, "a second read of the same version hits the cache, not the store");
  assert.equal(second, first, "readers of one unchanged area also share the composed read");

  // A new publication (changed data → new record sha) must refresh, never stale-serve.
  await readPartition(store, PIMA, T2, ["cache-az1", "cache-az2"]);
  await publishPass(store, counting, at(T2, HOUR));
  const third = await readReaderEdgeMeetings({ store: counting, ocdIds: [PIMA.ocdId!], now: at(T2, HOUR) });
  assert.equal(third.kind, "PROMOTED");
  if (third.kind !== "PROMOTED") return;
  assert.deepEqual(
    third.value.meetings.map((m) => m.id.split(":")[2]).sort(),
    ["cache-az1", "cache-az2"],
    "the changed body is refreshed from the store, not served stale from cache",
  );
  assert.ok(reads > readsAfterFirst, "a new version re-reads the changed record");
});

test("authority-only publication carries meeting references and writes no meeting artifacts", async () => {
  const store = new MemoryRoutineDataStore();
  const edge = freshEdge();
  await readPartition(store, PIMA, T1, ["cochise"]);
  let geographicWrites = 0;
  const counted = new Proxy(edge, { get(target, key) {
    const value = Reflect.get(target, key);
    if (key === "putImmutable") return (...args: Parameters<typeof edge.putImmutable>) => { if (args[1] === "json") geographicWrites++; return target.putImmutable(...args); };
    return typeof value === "function" ? value.bind(target) : value;
  } });
  await publishPass(store, counted, at(T1, HOUR));
  const before = (await edge.readManifest())!.manifest;
  const writesBefore = geographicWrites;
  const authority = { "campaign-sites": { value: { rows: [] }, versionId: "new-sites" },
    "everyday-routing": { value: { projection: { rows: [] } }, versionId: "routing-v1" } };
  assert.equal((await publishReaderEdgeArtifacts({ store: counted, authority })).status, "PUBLISHED");
  const authorityAfter = (await edge.readManifest())!.manifest;
  assert.deepEqual(authorityAfter.meetingStates, before.meetingStates);
  assert.equal(geographicWrites, writesBefore);
  assert.equal(authorityAfter.authorityArtifacts!["everyday-routing"]!.version, "routing-v1");
  const same = await publishReaderEdgeArtifacts({ store: counted, authority: {
    "campaign-sites": { carried: true, versionId: "new-sites" }, "everyday-routing": { carried: true, versionId: "routing-v1" } } });
  assert.equal(same.status, "CURRENT");
  assert.equal(geographicWrites, writesBefore);
  const read = await readPlace(edge, store, [PIMA.ocdId!], at(T1, HOUR));
  assert.equal(read.kind, "PROMOTED");
  assert.equal(sittingsOf(read).length, 1);
});

test("authority publication works before meeting composition without creating a meeting index", async () => {
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-first-authority-")));
  assert.equal((await publishReaderEdgeArtifacts({ store, authority: { "campaign-sites": { value: { rows: [] }, versionId: "first" } } })).status, "PUBLISHED");
  assert.equal((await store.readManifest())!.manifest.meetingStates, undefined);
  const read = await readReaderEdgeMeetings({ store, ocdIds: [PIMA.ocdId!], dataStore: new MemoryRoutineDataStore(), now: T1 });
  assert.equal(read.kind, "PROMOTED");
  assert.deepEqual(sittingsOf(read), [], "no meeting is claimed before any is published");
  assert.equal(servedWholeFromReaderEdge(read), false);
});

test("a changed meeting rewrites only its body and state; unchanged references survive publication", async () => {
  const store = new MemoryRoutineDataStore();
  const edge = freshEdge();
  await readPartition(store, PIMA, T1, ["delta-a"]);
  await readPartition(store, CHANDLER, T1, ["delta-b"]);
  await readPartition(store, MORRIS, T1, ["delta-c"]);
  await publishPass(store, edge, at(T1, HOUR));
  const before = (await edge.readManifest())!.manifest;
  const chandlerBefore = (await bodyPointerOf(edge, "AZ", CHANDLER.bodyId))!.record;
  const writes: string[] = [];
  const counted = new Proxy(edge, { get(target, key) {
    if (key === "putImmutable") return async (...args: Parameters<typeof edge.putImmutable>) => { const path = await target.putImmutable(...args); if (args[1] === "json.gz") writes.push(path); return path; };
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  await readPartition(store, PIMA, T2, ["delta-a", "delta-a2"]);
  await publishPass(store, counted, at(T2, 60_000));
  const after = (await edge.readManifest())!.manifest;
  assert.equal(writes.length, 1, "the body's record, and nothing else");
  assert.deepEqual(after.meetingStates!.NJ, before.meetingStates!.NJ);
  assert.deepEqual(after.meetingStates!.NH, before.meetingStates!.NH);
  assert.deepEqual(after.meetingStates!.AZ, before.meetingStates!.AZ, "the state's index moves only when a body comes or goes");
  assert.deepEqual((await bodyPointerOf(edge, "AZ", CHANDLER.bodyId))!.record, chandlerBefore, "the unchanged body in the same state keeps its record");
});

test("area reads preserve split ZIP divisions and empty held areas without nearby bodies", async () => {
  const store = new MemoryRoutineDataStore();
  const edge = freshEdge();
  await readPartition(store, PIMA, T1, ["area-governing"]);
  await readPartition(store, CHANDLER, T1, ["area-split"]);
  await readPartition(store, NEWBURY, T1, ["area-near"]);
  await readPartition(store, MORRIS, T1, ["area-far"]);
  await publishPass(store, edge, at(T1, HOUR));
  const read = await readPlace(edge, store, [PIMA.ocdId!, CHANDLER.ocdId!], at(T1, HOUR));
  assert.equal(read.kind, "PROMOTED");
  assert.deepEqual(sittingsOf(read).map((id) => id.split(":")[2]), ["area-governing", "area-split"]);
  const empty = await readPlace(edge, store, ["ocd-division/country:us/state:az/county:unheld"], at(T1, HOUR));
  assert.equal(empty.kind, "PROMOTED");
  if (empty.kind === "PROMOTED") assert.deepEqual(empty.value.meetings, []);
});

test("an agenda lookup opens only its meeting's body and keeps documents with mismatched document geography", async () => {
  const store = new MemoryRoutineDataStore();
  const edge = freshEdge();
  const sitting = row(PIMA, "agenda-area", "2026-10-12T17:00:00.000Z", T1);
  await promoteRows(store, PIMA, [sitting], [agendaFor(sitting, "ocd-division/country:us/state:nj", T1)], T1);
  await readPartition(store, MORRIS, T1, ["agenda-elsewhere"]);
  await publishPass(store, edge, at(T1, HOUR));
  const read = await readReaderEdgeMeetings({ store: edge, dataStore: store, bodyIds: [PIMA.bodyId], now: at(T1, HOUR), settings: meetingSettingsFromValues() });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind === "PROMOTED") {
    assert.deepEqual(read.value.meetings.map(row => row.id), [sitting.id]);
    assert.deepEqual(read.value.agendaDocuments.map(row => row.id), [`${sitting.id}@agenda`]);
  }
  const map = await readPlace(edge, store, [PIMA.ocdId!], at(T1, HOUR), { includeAgenda: false });
  assert.equal(map.kind, "PROMOTED");
  if (map.kind === "PROMOTED") {
    assert.deepEqual(map.value.meetings.map(row => row.id), [sitting.id]);
    assert.deepEqual(map.value.agendaDocuments, []);
  }
});

{
  const vault = new MemoryEvidenceStore();

  const NOW = "2026-10-01T12:00:00.000Z";

  test("publish-now copies real baseline pointers during an unresolved finance pass, honors owner pauses and retries independent failures", async () => {
    const memory = new MemoryRoutineDataStore();
    // The routine sweep also checks these existing canonical families. Seed them through their real promotion doors.
    const census = censusGeographyCandidate(JSON.parse(readFileSync("lib/census-geography/bootstrap-az.json", "utf8")));
    assert.ok((await processRegisteredRoutineCandidate(memory, CENSUS_GEO_CONTRACT_ID, census, NOW)).promoted);
    await readPartition(memory, PIMA, NOW, ["held"]);
    const artifacts = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "publish-now-baseline-")));
    assert.equal((await publishReaderEdgeOutcomeForTest(memory, NOW, null, { artifactStore: artifacts })).readerEdge, "PUBLISHED");
    const before = (await artifacts.readManifest())!.manifest;
    const meetingStatesBefore = (await artifacts.readManifest())!.manifest.meetingStates;
    assert.ok(meetingStatesBefore?.AZ, "the baseline publishes the held meetings");

    let finishFinance!: () => void;
    let financeSettled = false;
    const finance = new Promise<void>(resolve => { finishFinance = resolve; }).then(() => { financeSettled = true; });
    const target = registrationTarget("NH");
    const registration = registrationCandidate({ target, receipt: heldRegistrationReceipt(),
      reference: loadRegistrationReference(join(import.meta.dirname, ".."), "NH") });
    const registered = await processRegisteredRoutineCandidate(memory, target.contractId, registration, NOW);
    assert.equal(registered.promoted?.versionId, registration.id, registered.candidate.failureDetail ?? "");
    const releaseId = "a".repeat(40);
    const sourceUrl = `https://raw.githubusercontent.com/openstates/people/${releaseId}/data/az/legislature/Member.yml`;
    const body = "id: ocd-person/member-one\nname: Member One\nroles:\n  - type: upper\n    district: '7'\n    start_date: '2025-01-01'\n";
    const roster = normalize(yamlToPeople(body, "az", sourceUrl, NOW), new Map(), NOW, "US-AZ");
    const people = await publishStatePeople({ vault, store: memory, state: "az", roster, releaseId, now: NOW,
      acquisitions: [{ requestedUrl: sourceUrl, finalUrl: sourceUrl, httpStatus: 200, body, retrievedAt: NOW }] });
    assert.ok(people.outcome.promoted, JSON.stringify(people.outcome.candidate.receipt));

    let paused = true;
    let pauseReadFailure: Error | null = null;
    let failRegistration = true;
    let payloadReads = 0;
    const store = new Proxy(memory, { get(target, key) {
      if (key === "readPromotion") return async (...args: Parameters<typeof memory.readPromotion>) => {
        if (args[0] === "REGISTRATION" || args[0] === "STATE_LEGISLATOR") payloadReads++;
        if (args[0] === "REGISTRATION" && failRegistration) throw new Error("registration storage temporarily unavailable");
        return memory.readPromotion(...args);
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    let tick!: () => void;
    let cancelled = false;
    let sweeps = 0;
    let gate: Promise<void> | null = null;
    const outcomes: string[] = [];
    const errors: unknown[] = [];
    const checks = startPublishNowEdgeChecks({
      store: "local folder", readPaused: async () => { if (pauseReadFailure) throw pauseReadFailure; return paused; },
      onError: error => { errors.push(error); },
      schedule: (callback, everyMs) => { assert.equal(everyMs, PUBLISH_NOW_INTERVAL_MS); tick = callback; return () => { cancelled = true; }; },
      check: async () => {
        sweeps++;
        if (gate) await gate;
        const outcome = await publishReaderEdgeOutcomeForTest(store, NOW, null, { artifactStore: artifacts });
        outcomes.push(outcome.readerEdge);
        return outcome;
      },
    });
    try {
      assert.equal((await checks.run()).readerEdge, "SKIPPED_OWNER_PAUSE");
      assert.equal(sweeps, 0, "a pause at start performs no pointer or payload sweep");
      assert.deepEqual((await artifacts.readManifest())!.manifest, before);

      paused = false;
      tick();
      assert.equal((await checks.run()).readerEdge, "FAILED", "one failed family keeps publication owed");
      const partial = (await artifacts.readManifest())!.manifest;
      assert.equal(partial.stateLegislators!["US-AZ"].version, people.outcome.promoted!.versionId,
        "independent people publish while registration is unavailable");
      assert.equal(partial.registrations?.nh, undefined);
      assert.equal(financeSettled, false, "neither the source pass nor its long finance task has settled");

      paused = true;
      failRegistration = false;
      tick();
      assert.equal((await checks.run()).readerEdge, "SKIPPED_OWNER_PAUSE");
      assert.deepEqual((await artifacts.readManifest())!.manifest, partial, "pausing during the long pass preserves every artifact reference");

      paused = false;
      let releaseSweep!: () => void;
      gate = new Promise<void>(resolve => { releaseSweep = resolve; });
      tick(); tick();
      const running = checks.run();
      assert.equal(checks.run(), running, "overlapping ticks coalesce into the same sweep");
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      assert.equal(sweeps, 2);
      releaseSweep();
      assert.equal((await running).readerEdge, "PUBLISHED");
      gate = null;
      const published = (await artifacts.readManifest())!.manifest;
      assert.equal(published.registrations!.nh.version, registration.id);
      assert.equal(published.stateLegislators!["US-AZ"].version, people.outcome.promoted!.versionId);
      const edge = await ensureReaderAuthorityEdge(published, artifacts, ["state-legislators"]);
      assert.ok((await edge.registrations!.load("nh"))!.value.governments?.some(row => row.kind === "EDUCATION_AGENCY"));
      assert.equal((await edge.stateLegislators!.load("US-AZ"))!.value.roster.officeholders[0].personId, "plural:member-one");
      assert.equal(financeSettled, false, "both native source projections reach real reader artifacts before the long task finishes");

      const readCount = payloadReads;
      tick();
      const current = await checks.run();
      assert.equal(current.readerEdge, "CURRENT");
      assert.equal(payloadReads, readCount, "unchanged minutes compare narrow pointers without rereading held baseline payloads");
      assert.equal(publishNowHasNothingOwed(true, 0, 0, current), true);
      const summary = await checks.stop();
      assert.equal(summary?.readerEdge, "PUBLISHED", "a quiet final check does not erase a real publication from the supervisor receipt");
      assert.equal(publishNowHasNothingOwed(true, 0, 0, summary!), false);
      assert.deepEqual(outcomes, ["FAILED", "PUBLISHED", "CURRENT"]);
      assert.deepEqual(errors, []);
      assert.equal(cancelled, true);
      tick(); await Promise.resolve();
      assert.equal(sweeps, 3, "stopping the pass removes its minute check");
      paused = true;
      assert.equal((await checks.run()).readerEdge, "SKIPPED_OWNER_PAUSE", "the explicit final sweep checks the pause again after stopping ticks");
      assert.equal(sweeps, 3);
      assert.deepEqual((await artifacts.readManifest())!.manifest, published);
      assert.deepEqual((await artifacts.readManifest())!.manifest.meetingStates, meetingStatesBefore, "authority updates preserve meeting index references");
      pauseReadFailure = new Error("owner control temporarily unreadable");
      assert.equal((await checks.run()).readerEdge, "FAILED", "an unreadable owner control remains a durable failure, never permission to publish");
      assert.deepEqual(errors, [pauseReadFailure]);
      assert.equal((await checks.stop())?.readerEdge, "FAILED");
      assert.equal(sweeps, 3);
      assert.deepEqual((await artifacts.readManifest())!.manifest, published);
    } finally {
      await checks.stop();
      finishFinance();
      await finance;
    }
  });
}
