import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { NATIONAL_SCOPE, mergeScopeArtifacts, partitionSnapshotByScope, readerScopeApplies, scopeOfMeeting, scopesForStates, stateOfOcdId, type ReaderManifest, isStateAuthorityFamily } from "../lib/meetings/edge-artifacts.ts";
import { LocalFileArtifactStore, resolveReaderArtifactWriteStore } from "../lib/meetings/edge-store.ts";
import { publishReaderEdgeArtifacts, publishReaderEdgeChecks, readReaderEdgeMeetings, ensureReaderAuthorityEdge } from "../lib/meetings/edge-serving.ts";
import { type Meeting } from "../lib/sources/types.ts";
import { type MeetingsSnapshot } from "../lib/meetings/snapshot.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { selectedStateEdgePointers } from "../lib/civic-data/promoted-edge-publication.ts";
import { installFactReader } from "../lib/facts/db.ts";
import { MEETINGS_PREPARED_SCOPE, preparePublishedMeetingSnapshot } from "../lib/meetings/prepared-snapshot.ts";
import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import { type RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import { type CandidateVersionRecord, type PromotedProjection } from "../lib/civic-data/types.ts";
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

function meeting(id: string, ocdId: string | null, extra: Partial<Meeting> = {}): Meeting {
  return {
    id,
    ocdId,
    title: `Meeting ${id}`,
    startsAt: "2026-09-20T18:00:00.000Z",
    location: { lat: 32.2, lng: -110.9 },
    ...extra,
  } as unknown as Meeting;
}

function snapshot(meetings: Meeting[]): MeetingsSnapshot {
  const carried = meetings.filter((m) => (m as { carried?: unknown }).carried).length;
  return {
    formatVersion: 1,
    generatedAt: "2026-09-15T12:00:00.000Z",
    counts: { fresh: meetings.length - carried, carried, total: meetings.length, duplicatesCollapsed: 0 },
    sources: [{ source: "az-portal", ok: true, error: null, fetched: 2, normalized: 2 } as never],
    meetings,
    agendaDocuments: [],
  };
}

const META = { sourceThrough: "2026-09-15T00:00:00.000Z", retrievedAt: "2026-09-15T00:00:00.000Z", promotedThrough: "2026-09-15T00:00:00.000Z" };

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
  const publish = (loser: boolean) => publishReaderEdgeArtifacts(snapshot([meeting(loser ? "loser" : "winner", "ocd-division/country:us/state:az")]), META, {
    store: writer(loser), authority: { "federal-directory": { versionId: "next", value: { winner: !loser } } },
    registrations: { az: { versionId: "next", value: { winner: !loser } } },
  });
  const [winner, loser] = await Promise.all([publish(false), publish(true)]);
  assert.equal(winner.status, "PUBLISHED");
  assert.equal(loser.status, "RACED");
  const manifest = (await store.readManifest())!.manifest;
  assert.equal((await store.readArtifact(manifest.scopes[0].key))!.meetings[0].id, "winner");
  const authorityManifest = (await store.readManifest())!.manifest;
  for (const ref of [authorityManifest.authorityArtifacts!["federal-directory"]!, authorityManifest.registrations!.az]) {
    const envelope = JSON.parse(gunzipSync((await store.readBytes(ref.key))!).toString("utf8"));
    assert.equal(envelope.value.base.winner, true);
  }
});

test("state people load only the requested jurisdiction and failed replacements keep accepted references", async () => {
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-state-people-")));
  assert.equal((await publishReaderEdgeArtifacts(null, META, { store, stateLegislators: {
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
  assert.equal((await publishReaderEdgeArtifacts(null, META, { store, stateLegislators: {
    "US-AZ": { versionId: "az-2", value: { jurisdiction: "US-AZ", officeholders: [] } },
    "US-NH": { versionId: "nh-1", carried: true },
  } })).status, "PUBLISHED");
  const next = (await store.readManifest())!.manifest;
  assert.deepEqual(next.stateLegislators!["US-NH"], first.stateLegislators!["US-NH"]);
  assert.equal(next.stateLegislators!["US-AZ"].version, "az-2");
  assert.equal((await publishReaderEdgeArtifacts(snapshot([meeting("new-meeting", "ocd-division/country:us/state:az")]), META, { store })).status, "PUBLISHED");
  assert.deepEqual((await store.readManifest())!.manifest.stateLegislators, next.stateLegislators, "a meetings-only pass keeps the state references");
});

test("an obsolete country roster reference is never opened by a state reader", async () => {
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-state-country-ref-")));
  const manifest: ReaderManifest = { formatVersion: 1, sequence: 1, generatedAt: META.retrievedAt, ...META, sources: [], scopes: [],
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
  await publishReaderEdgeArtifacts(null, META, { store: artifacts, authority: {
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

test("checks-only publication preserves every accepted authority and state reference", async () => {
  const artifacts = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-manifest-checks-")));
  const checks = { composition: "same", freshChecks: {} };
  await publishReaderEdgeArtifacts(null, META, { store: artifacts, now: "2026-10-15T00:00:00Z", checks,
    extras: { everydayRouting: { rows: [] }, versionIds: { "everyday-routing": "routing-v1" } },
    authority: { "everyday-routing": { value: { projection: null }, versionId: "routing-v1" } },
    stateAuthorities: { "ballot-contests": { AZ: { value: { kind: "PROMOTED_POINTERS", entries: [] }, versionId: "az-v1" } } } });
  const before = (await artifacts.readManifest())!.manifest;
  assert.equal((await publishReaderEdgeChecks({ generatedAt: "2026-10-16T00:00:00Z", retrievedAt: null, checks }, { store: artifacts })).status, "PUBLISHED");
  const after = (await artifacts.readManifest())!.manifest;
  for (const field of ["authorityArtifacts", "stateAuthorities", "everydayRouting", "extrasVersionIds"] as const) {
    assert.deepEqual(after[field], before[field]);
  }
});

test("state, national authority and meeting updates share one manifest CAS", async () => {
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-shared-cas-")));
  await publishReaderEdgeArtifacts(snapshot([meeting("held", "ocd-division/country:us/state:az")]), META,
    { store, authority: { "campaign-sites": { value: {}, versionId: "sites-v1" } } });
  const before = (await store.readManifest())!;
  assert.equal((await publishReaderEdgeArtifacts(null, META, { store,
    stateAuthorities: { "registry-runtime": { AZ: { value: { kind: "PROMOTED_POINTERS", entries: [] }, versionId: "az-v1" } } } })).status, "PUBLISHED");
  const after = (await store.readManifest())!;
  assert.deepEqual(after.manifest.scopes, before.manifest.scopes);
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

test("stateOfOcdId / scopeOfMeeting derive the geographic partition key", () => {
  assert.equal(stateOfOcdId("ocd-division/country:us/state:az/place:tucson#governing"), "az");
  assert.equal(stateOfOcdId("ocd-division/country:us/state:nj/county:morris"), "nj");
  assert.equal(stateOfOcdId("ocd-division/country:us"), null);
  assert.equal(stateOfOcdId(null), null);
  assert.equal(scopeOfMeeting(meeting("x", null)), NATIONAL_SCOPE);
  assert.equal(scopeOfMeeting(meeting("y", "ocd-division/country:us/state:nh/place:newbury")), "nh");
});

test("every area a canonical body governs receives the same meeting and agenda without duplicate copies", async () => {
  const primary = "ocd-division/country:us/state:az/county:cochise";
  const neighbour = "ocd-division/country:us/state:az/county:pima";
  const row = meeting("shared", primary, { bodyId: "shared-body" });
  const snap = snapshot([row]);
  snap.agendaDocuments = [{ id: "agenda", meetingId: row.id, ocdId: primary }] as MeetingsSnapshot["agendaDocuments"];
  const bodies = [{ id: "shared-body", ocdId: primary, alsoServesOcdIds: [neighbour, primary, neighbour] }];
  const artifacts = partitionSnapshotByScope(snap, snap.generatedAt, bodies);
  assert.equal(artifacts.length, 4, "one calendar and one agenda piece in each area");
  for (const area of [primary, neighbour]) {
    const matching = artifacts.filter(artifact => artifact.ocdId === area);
    assert.equal(matching.flatMap(artifact => artifact.meetings).length, 1);
    assert.equal(matching.flatMap(artifact => artifact.agendaDocuments).length, 1);
    assert.ok(matching.every(artifact => readerScopeApplies(artifact, { ocdIds: [area] })));
  }
  const merged = mergeScopeArtifacts(artifacts, snap);
  assert.equal(merged.meetings.length, 1);
  assert.equal(merged.agendaDocuments.length, 1);
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-edge-shared-")));
  const published = await publishReaderEdgeArtifacts(snap, META, { store, meetingBodies: bodies });
  assert.equal(published.status, "PUBLISHED");
});

test("ordinary publication repairs old area copies once, carries quiet data, and rebuilds changed territories", async () => {
  const primary = "ocd-division/country:us/state:az/county:cochise";
  const secondary = "ocd-division/country:us/state:az/county:pima";
  const bodyId = `${primary}#governing`;
  const snap = snapshot([meeting("shared", "raw-area-key", { bodyId })]);
  const artifacts = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "runner-area-edge-")));
  await publishReaderEdgeArtifacts(snap, META, { store: artifacts,
    authority: { "registry-runtime": { value: {}, versionId: "registry-v1" } } });
  assert.equal((await artifacts.readManifest())!.manifest.meetingRegistryVersion, undefined);
  const memory = new MemoryRoutineDataStore();
  await memory.writePreparedReaderProjection({ recordClass: "MEETING", scope: MEETINGS_PREPARED_SCOPE,
    payload: snap, composedFrom: [], factSha256: "a".repeat(64), generatedAt: snap.generatedAt,
    composedAt: snap.generatedAt, ...META }, null);
  let payloadReads = 0, registryReads = 0, registryVersion = "registry-v1";
  let otherAreas: string[] = [secondary];
  const store = new Proxy(memory, { get(target, key) {
    const value = Reflect.get(target, key);
    if (key === "readPreparedReaderProjection") return (...args: unknown[]) => { payloadReads++; return value.apply(target, args); };
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const options = { artifactStore: artifacts, readMeetingRegistry: async (divisions: readonly string[], bodies: readonly string[], acceptedVersion: string) => {
    registryReads++;
    assert.deepEqual(divisions, ["raw-area-key"]);
    assert.deepEqual(bodies, [bodyId]);
    assert.equal(acceptedVersion, (await artifacts.readManifest())!.manifest.authorityArtifacts!["registry-runtime"]!.version,
      "territories are requested from the accepted edge version, not the independently advancing database pointer");
    return { kind: "PROMOTED" as const, metadata: { recordClass: "REGISTRY_RUNTIME_BINDING" as const,
      scope: "US:reader-registry-runtime-bindings", versionId: registryVersion },
      value: { registry: { bodies: [{ id: bodyId, ocdId: primary, alsoServesOcdIds: otherAreas }] } } as unknown as RegistryRuntimeReadModel };
  } };
  const selected = [{ recordClass: "MEETING" as const, scope: "changed-meetings" }];
  assert.equal(await publishReaderEdgeForTest(store, snap.generatedAt, selected, options), true);
  let held = (await artifacts.readManifest())!;
  assert.equal(held.manifest.meetingRegistryVersion, "registry-v1");
  assert.deepEqual(held.manifest.scopes.map(s => s.ocdId).sort(), [primary, secondary].sort());
  assert.equal(registryReads, 1);
  const readCount = payloadReads;
  assert.equal(await publishReaderEdgeForTest(store, snap.generatedAt, selected, options), true);
  assert.equal(payloadReads, readCount, "quiet compositions do not read meeting payloads");
  assert.equal(registryReads, 1, "quiet compositions do not read registry payloads");
  assert.equal((await artifacts.readManifest())!.manifest.sequence, held.manifest.sequence);
  const authorityHeld = (await artifacts.readManifest())!;
  const changedAuthority = { ...authorityHeld.manifest.authorityArtifacts!, "registry-runtime": {
    ...authorityHeld.manifest.authorityArtifacts!["registry-runtime"]!, version: "registry-v2" } };
  await artifacts.writeManifest({ ...authorityHeld.manifest, authorityArtifacts: changedAuthority }, authorityHeld.etag ?? null);
  registryVersion = "registry-v2";
  otherAreas = [];
  assert.equal(await publishReaderEdgeForTest(store, snap.generatedAt, selected, options), true);
  held = (await artifacts.readManifest())!;
  assert.equal(held.manifest.meetingRegistryVersion, registryVersion);
  assert.deepEqual(held.manifest.scopes.map(s => s.ocdId), [primary], "removed territories stop serving the body's meetings");
  assert.equal(registryReads, 2);
  // A selected read that races the registry pointer must retain the entire LKG manifest.
  const lastValid = held.manifest;
  await artifacts.writeManifest({ ...lastValid, meetingRegistryVersion: "old-format" }, held.etag ?? null);
  const beforeFailure = (await artifacts.readManifest())!.manifest;
  registryVersion = "raced-pointer";
  assert.equal(await publishReaderEdgeForTest(store, snap.generatedAt, selected, options), false);
  assert.deepEqual((await artifacts.readManifest())!.manifest, beforeFailure);
});

test("a racing prepared meeting copy keeps its exact LKG while an independent registry update publishes, then the next pass repairs meetings", async () => {
  const imported = JSON.parse(gunzipSync(readFileSync("tests/fixtures/registry-transfer-import.json.gz")).toString("utf8")) as {
    record: CandidateVersionRecord; projection: PromotedProjection<RegistryRuntimeReadModel>;
  };
  const body = imported.projection.payload.registry.bodies.find(body => body.ocdId && body.id.endsWith("#governing"))!;
  const older = snapshot([meeting("held-meeting", body.ocdId, { bodyId: body.id })]);
  const newer = { ...snapshot([meeting("new-meeting", body.ocdId, { bodyId: body.id })]), generatedAt: "2026-10-09T12:00:00.000Z" };
  const artifacts = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "meeting-registry-race-")));
  await publishReaderEdgeArtifacts(older, META, { store: artifacts, meetingBodies: [body], meetingRegistryVersion: "registry-old",
    authority: { "registry-runtime": { value: {}, versionId: "registry-old" } }, checks: { composition: "held-composition", freshChecks: {} } });
  const before = (await artifacts.readManifest())!.manifest;
  const memory = new MemoryRoutineDataStore();
  Object.assign(memory, { candidates: new Map([[imported.record.candidate.id, imported.record]]), promotions: new Map([[imported.projection.key, imported.projection]]) });
  const partition = MEETING_PARTITION_CONTRACTS[0];
  const preparedInput = { recordClass: "MEETING" as const, scope: MEETINGS_PREPARED_SCOPE, payload: newer,
    composedFrom: [{ contractId: partition.id, versionId: "meeting-v1", routes: [`az-portal|${body.id}`], checkedAt: newer.generatedAt }],
    factSha256: "a".repeat(64), generatedAt: newer.generatedAt, composedAt: newer.generatedAt, ...META };
  await memory.writePreparedReaderProjection(preparedInput, null);
  let race = true;
  const store = new Proxy(memory, { get(target, key) {
    if (key === "readPromotionIdentities") return async (...args: Parameters<typeof memory.readPromotionIdentities>) =>
      args[0] === "MEETING" && args[1].includes(partition.scope)
        ? [{ key: `MEETING:${partition.scope}`, recordClass: "MEETING", scope: partition.scope, sourceId: partition.sourceId,
          versionId: "meeting-v1", lastKnownGoodVersionId: "meeting-v1", promotedAt: newer.generatedAt }]
        : memory.readPromotionIdentities(...args);
    if (key === "readPreparedReaderProjection") return async (...args: Parameters<typeof memory.readPreparedReaderProjection>) => {
      if (race) { race = false; await memory.writePreparedReaderProjection(preparedInput, 1); }
      return memory.readPreparedReaderProjection(...args);
    };
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const selected = [{ recordClass: "REGISTRY_RUNTIME_BINDING" as const, scope: imported.projection.scope }];
  const options = { artifactStore: artifacts, readMeetingRegistry: async (_divisions: readonly string[], _bodies: readonly string[], versionId: string) => ({
    kind: "PROMOTED" as const, metadata: { recordClass: "REGISTRY_RUNTIME_BINDING" as const, scope: imported.projection.scope, versionId },
    value: { registry: { bodies: [body] } } as RegistryRuntimeReadModel,
  }) };
  const prepared = await preparePublishedMeetingSnapshot(store, newer.generatedAt);
  assert.equal(prepared.status, "CURRENT");
  if (prepared.status === "CURRENT") assert.equal(prepared.checkedAt, newer.generatedAt, "the failed read has a newer check it must not apply to the held copy");
  assert.equal(await publishReaderEdgeForTest(store, newer.generatedAt, selected, options), false, "the raced meeting composition remains owed");
  const independent = (await artifacts.readManifest())!.manifest;
  assert.equal((await artifacts.readManifest())!.manifest.authorityArtifacts!["registry-runtime"]!.version, imported.projection.versionId, "verified registry facts publish during meeting recovery");
  assert.deepEqual(independent.scopes, before.scopes);
  assert.equal(independent.meetingRegistryVersion, before.meetingRegistryVersion);
  assert.equal(independent.composition, before.composition);
  assert.equal(independent.generatedAt, before.generatedAt, "a failed composition cannot renew held meeting dates");
  assert.equal(independent.retrievedAt, before.retrievedAt, "CURRENT preparation cannot renew the held retrieval date when its payload read races");
  assert.equal(independent.sourceThrough, before.sourceThrough);
  assert.equal(independent.promotedThrough, before.promotedThrough);
  assert.deepEqual(independent.freshChecks, before.freshChecks);
  assert.equal(await publishReaderEdgeForTest(store, newer.generatedAt, [{ recordClass: "MEETING", scope: "changed-meetings" }], options), true);
  const recovered = (await artifacts.readManifest())!.manifest;
  assert.equal(recovered.meetingRegistryVersion, imported.projection.versionId);
  assert.equal(recovered.generatedAt, newer.generatedAt);
  assert.ok(recovered.scopes.some(scope => scope.meetingIds?.includes("new-meeting")));
  assert.ok(recovered.scopes.every(scope => !scope.meetingIds?.includes("held-meeting")));
});

test("scopesForStates dedupes, lowercases, validates, and always includes the national bucket", () => {
  assert.deepEqual(scopesForStates(["AZ", "az", "nj"]), ["az", "nj", "us"]);
  assert.deepEqual(scopesForStates([]), ["us"]);
  assert.deepEqual(scopesForStates(["bogus", "z"]), ["us"], "malformed states are dropped, us remains");
});

test("partitionSnapshotByScope splits meetings by governing area with a national bucket, deterministic order", () => {
  const snap = snapshot([
    meeting("az1", "ocd-division/country:us/state:az/place:tucson#governing"),
    meeting("nj1", "ocd-division/country:us/state:nj/county:morris#governing"),
    meeting("az2", "ocd-division/country:us/state:az/county:pima#governing"),
    meeting("none", null),
  ]);
  const artifacts = partitionSnapshotByScope(snap);
  assert.deepEqual(artifacts.map((a) => a.scope), artifacts.map((a) => a.scope).sort(), "sorted scope order");
  assert.equal(artifacts.length, 4, "city and county are separate pieces even inside the same state");
  const az = artifacts.filter(a => a.ocdId?.includes("state:az"));
  assert.equal(az.reduce((sum, a) => sum + a.meetings.length, 0), 2);
  assert.equal(az.reduce((sum, a) => sum + a.counts.total, 0), 2);
  assert.equal(artifacts.find((a) => a.scope === "us")!.meetings.length, 1);
});

test("publish → read round-trips through the file store and merges only the requested scopes", async () => {
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-edge-")));
  const snap = snapshot([
    meeting("az1", "ocd-division/country:us/state:az/place:tucson#governing"),
    meeting("nj1", "ocd-division/country:us/state:nj/county:morris#governing"),
    meeting("none", null),
  ]);
  const published = await publishReaderEdgeArtifacts(snap, META, { store });
  assert.equal(published.status, "PUBLISHED");
  if (published.status === "PUBLISHED") assert.equal(published.sequence, 1);

  // An AZ reader gets AZ + the national bucket, never NJ.
  const azRead = await readReaderEdgeMeetings({ store, states: ["az"] });
  assert.equal(azRead.kind, "PROMOTED");
  if (azRead.kind !== "PROMOTED") return;
  const ids = azRead.value.meetings.map((m) => m.id).sort();
  assert.deepEqual(ids, ["az1", "none"], "AZ reader gets AZ meetings + the national bucket, not NJ");
  assert.match(azRead.detail, /reader edge artifacts/);
});

test("republishing an unchanged composition is idempotent (CURRENT), a changed one advances the sequence monotonically", async () => {
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-edge-")));
  const snap = snapshot([meeting("az1", "ocd-division/country:us/state:az/place:tucson#governing")]);
  const first = await publishReaderEdgeArtifacts(snap, META, { store });
  assert.equal(first.status, "PUBLISHED");

  // The same data and the same "Last checked" → nothing republished.
  const same = await publishReaderEdgeArtifacts(snap, META, { store });
  assert.equal(same.status, "CURRENT");
  if (same.status === "CURRENT") assert.equal(same.sequence, 1);

  // The same data checked again later → the manifest alone advances, so
  // "Last checked" moves; every scope artifact it points at is the one served.
  const scopesBefore = (await store.readManifest())!.manifest.scopes;
  const again = await publishReaderEdgeArtifacts({ ...snap, generatedAt: "2026-09-15T13:00:00.000Z" }, META, { store });
  assert.equal(again.status, "PUBLISHED");
  if (again.status === "PUBLISHED") assert.equal(again.sequence, 2);
  const rechecked = (await store.readManifest())!.manifest;
  assert.equal(rechecked.generatedAt, "2026-09-15T13:00:00.000Z");
  assert.deepEqual(rechecked.scopes, scopesBefore, "no artifact is rewritten for a check");

  // Changed data → new immutable sequence.
  const changed = snapshot([
    meeting("az1", "ocd-division/country:us/state:az/place:tucson#governing"),
    meeting("az2", "ocd-division/country:us/state:az/county:pima#governing"),
  ]);
  const advanced = await publishReaderEdgeArtifacts(changed, META, { store });
  assert.equal(advanced.status, "PUBLISHED");
  if (advanced.status === "PUBLISHED") assert.equal(advanced.sequence, 3, "monotonic advance");
});

test("a stale publisher that read an older manifest cannot regress the pointer (monotonic CAS)", async () => {
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-edge-")));
  const a = snapshot([meeting("az1", "ocd-division/country:us/state:az/place:tucson#governing")]);
  await publishReaderEdgeArtifacts(a, META, { store });

  const staleExpected = (await store.readManifest())!.etag;
  // First writer advances 1 -> 2.
  const changed = snapshot([
    meeting("az1", "ocd-division/country:us/state:az/place:tucson#governing"),
    meeting("az2", "ocd-division/country:us/state:az/county:pima#governing"),
  ]);
  await publishReaderEdgeArtifacts(changed, META, { store });
  // Second (stale) writer tries to CAS against the OLD etag → refused, no regression.
  const refused = await store.writeManifest(
    { formatVersion: 1, sequence: 2, generatedAt: "old", sourceThrough: null, retrievedAt: null, promotedThrough: null, sources: [], scopes: [] } as ReaderManifest,
    staleExpected,
  );
  assert.equal(refused.modified, false, "a CAS against a superseded etag writes nothing");
  const now = (await store.readManifest())!.manifest;
  assert.equal(now.sequence, 2, "the newer publication still stands");
});

test("the reader defers to the injected fallback when no manifest exists", async () => {
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-edge-empty-")));
  let fellBack = false;
  const read = await readReaderEdgeMeetings({
    store,
    states: ["az"],
    fallback: async () => {
      fellBack = true;
      return { kind: "NOT_RECORDED", detail: "FALLBACK" } as never;
    },
  });
  assert.equal(fellBack, true, "an empty store defers to the fallback, not the edge path");
  assert.doesNotMatch(read.kind === "PROMOTED" ? read.detail : read.detail ?? read.kind, /reader edge artifacts/);
});

test("the reader caches each scope artifact in-process per version and refreshes on a new one", async () => {
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-edge-cache-")));
  let reads = 0;
  // Count only readArtifact; every other store call is delegated unchanged.
  const counting = new Proxy(store, {
    get(target, prop) {
      const orig = (target as unknown as Record<string | symbol, unknown>)[prop];
      if (prop === "readArtifact") {
        return (key: string) => {
          reads++;
          return (orig as (k: string) => unknown).call(target, key);
        };
      }
      return typeof orig === "function" ? (orig as (...a: unknown[]) => unknown).bind(target) : orig;
    },
  });

  const v1 = snapshot([meeting("cache-az1", "ocd-division/country:us/state:az/place:tucson#governing")]);
  await publishReaderEdgeArtifacts(v1, META, { store: counting });

  const first = await readReaderEdgeMeetings({ store: counting, states: ["az"] });
  assert.equal(first.kind, "PROMOTED");
  const readsAfterFirst = reads;
  assert.ok(readsAfterFirst >= 1, "the first read fetches the scope artifact from the store");

  // A second read of the SAME published version serves from the in-process cache.
  const second = await readReaderEdgeMeetings({ store: counting, states: ["az"] });
  assert.equal(second.kind, "PROMOTED");
  assert.equal(reads, readsAfterFirst, "a second read of the same version hits the cache, not the store");
  assert.equal(second, first, "readers of one unchanged area also share the composed read");

  // A new publication (changed AZ data → new per-scope sha) must refresh, never stale-serve.
  const v2 = snapshot([
    meeting("cache-az1", "ocd-division/country:us/state:az/place:tucson#governing"),
    meeting("cache-az2", "ocd-division/country:us/state:az/county:pima#governing"),
  ]);
  await publishReaderEdgeArtifacts(v2, META, { store: counting });
  const third = await readReaderEdgeMeetings({ store: counting, states: ["az"] });
  assert.equal(third.kind, "PROMOTED");
  if (third.kind !== "PROMOTED") return;
  assert.deepEqual(
    third.value.meetings.map((m) => m.id).sort(),
    ["cache-az1", "cache-az2"],
    "the changed scope is refreshed from the store, not served stale from cache",
  );
  assert.ok(reads > readsAfterFirst, "a new version re-reads the changed artifact");
});

test("mergeScopeArtifacts dedupes by id and takes the national sources accounting from the manifest", () => {
  const snap = snapshot([
    meeting("az1", "ocd-division/country:us/state:az/place:tucson#governing"),
    meeting("us1", null),
  ]);
  const [az, us] = [
    ...partitionSnapshotByScope(snap).filter((a) => a.ocdId?.includes("state:az")),
    partitionSnapshotByScope(snap).find((a) => a.scope === "us")!,
  ];
  const manifest = { generatedAt: "2026-09-15T12:00:00.000Z", sources: snap.sources };
  const merged = mergeScopeArtifacts([az, us], manifest);
  assert.deepEqual(merged.meetings.map((m) => m.id).sort(), ["az1", "us1"]);
  assert.equal(merged.counts.total, 2);
  assert.equal(merged.sources, snap.sources.length ? merged.sources : merged.sources); // sources carried through
  assert.equal(merged.sources.length, 1);
});

test("authority-only publication carries geographic references and writes no meeting artifacts", async () => {
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-carry-")));
  let geographicWrites = 0;
  const counted = new Proxy(store, { get(target, key) {
    const value = Reflect.get(target, key);
    if (key === "putImmutable") return (...args: Parameters<typeof store.putImmutable>) => { if (args[1] === "json") geographicWrites++; return target.putImmutable(...args); };
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const snap = snapshot([meeting("cochise", "ocd-division/country:us/state:az/county:cochise")]);
  await publishReaderEdgeArtifacts(snap, META, { store: counted, checks: { composition: "held-meetings", freshChecks: { calendar: META.retrievedAt } } });
  const before = (await store.readManifest())!.manifest;
  const writesBefore = geographicWrites;
  const authority = { "campaign-sites": { value: { rows: [] }, versionId: "new-sites" },
    "everyday-routing": { value: { projection: { rows: [] } }, versionId: "routing-v1" } };
  assert.equal((await publishReaderEdgeArtifacts(null, META, { store: counted, authority })).status, "PUBLISHED");
  const after = (await store.readManifest())!.manifest;
  assert.deepEqual(after.scopes, before.scopes);
  assert.deepEqual(after.freshChecks, before.freshChecks);
  assert.equal(after.composition, before.composition);
  assert.equal(after.generatedAt, before.generatedAt);
  assert.equal(geographicWrites, writesBefore);
  const authorityAfter = (await store.readManifest())!.manifest;
  assert.equal(authorityAfter.authorityArtifacts!["everyday-routing"]!.version, "routing-v1");
  assert.deepEqual(authorityAfter.scopes, before.scopes);
  const same = await publishReaderEdgeArtifacts(null, META, { store: counted, authority: {
    "campaign-sites": { carried: true, versionId: "new-sites" }, "everyday-routing": { carried: true, versionId: "routing-v1" } } });
  assert.equal(same.status, "CURRENT");
  assert.equal(geographicWrites, writesBefore);
  const read = await readReaderEdgeMeetings({ store });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind === "PROMOTED") assert.equal(read.value.meetings[0].id, "cochise");
});

test("authority publication works before meeting composition without creating a meeting index", async () => {
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-first-authority-")));
  assert.equal((await publishReaderEdgeArtifacts(null, META, { store, authority: { "campaign-sites": { value: { rows: [] }, versionId: "first" } } })).status, "PUBLISHED");
  assert.deepEqual((await store.readManifest())!.manifest.scopes, []);
  let fallback = false;
  await readReaderEdgeMeetings({ store, fallback: async () => { fallback = true; return { kind: "NOT_RECORDED" } as never; } });
  assert.equal(fallback, true);
});

test("a changed meeting rewrites only its area; unchanged references survive publication", async () => {
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-delta-")));
  const a = meeting("delta-a", "ocd-division/country:us/state:az/county:pima");
  const b = meeting("delta-b", "ocd-division/country:us/state:az/county:cochise");
  const c = meeting("delta-c", "ocd-division/country:us/state:nj/county:morris");
  await publishReaderEdgeArtifacts(snapshot([a, b, c]), META, { store });
  const before = (await store.readManifest())!.manifest;
  const writes: string[] = [];
  const counted = new Proxy(store, { get(target, key) {
    if (key === "putImmutable") return async (...args: Parameters<typeof store.putImmutable>) => { const path = await target.putImmutable(...args); if (args[1] === "json") writes.push(path); return path; };
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  await publishReaderEdgeArtifacts(snapshot([{ ...a, title: "Changed sitting" }, b, c]), META, { store: counted });
  const after = (await store.readManifest())!.manifest;
  assert.equal(writes.length, 1);
  for (const ref of before.scopes.filter(ref => !ref.meetingIds?.includes(a.id))) {
    assert.deepEqual(after.scopes.find(next => next.scope === ref.scope), ref);
  }
});

test("area reads preserve split ZIP divisions and empty held areas without nearby bodies", async () => {
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-area-")));
  const county = "ocd-division/country:us/state:az/county:pima";
  const split = "ocd-division/country:us/state:az/county:cochise";
  await publishReaderEdgeArtifacts(snapshot([
    meeting("area-governing", county, { location: null }),
    meeting("area-split", split, { location: null }),
    meeting("area-near", "ocd-division/country:us/state:nm/place:near", { location: { lat: 32.2, lng: -110.9 } as never }),
    meeting("area-far", "ocd-division/country:us/state:az/place:far", { location: { lat: 35, lng: -112 } as never }),
  ]), META, { store });
  const read = await readReaderEdgeMeetings({ store, states: ["az"], ocdIds: [county, split] });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind === "PROMOTED") assert.deepEqual(read.value.meetings.map(row => row.id).sort(), ["area-governing", "area-split"]);
  const empty = await readReaderEdgeMeetings({ store, states: ["az"], ocdIds: ["ocd-division/country:us/state:az/county:unheld"], fallback: async () => { throw new Error("must not read nationally"); } });
  assert.equal(empty.kind, "PROMOTED");
  if (empty.kind === "PROMOTED") assert.deepEqual(empty.value.meetings, []);
});

test("agenda lookup opens only its meeting's area and keeps documents with mismatched document geography", async () => {
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-agenda-area-")));
  const snap = snapshot([
    meeting("agenda-area", "ocd-division/country:us/state:az/county:pima"),
    meeting("agenda-elsewhere", "ocd-division/country:us/state:nj/county:morris"),
  ]);
  snap.agendaDocuments.push({ id: "held-agenda", meetingId: "agenda-area", ocdId: "ocd-division/country:us/state:nj" } as never);
  await publishReaderEdgeArtifacts(snap, META, { store });
  const read = await readReaderEdgeMeetings({ store, meetingId: "agenda-area" });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind === "PROMOTED") {
    assert.deepEqual(read.value.meetings.map(row => row.id), ["agenda-area"]);
    assert.deepEqual(read.value.agendaDocuments.map(row => row.id), ["held-agenda"]);
  }
  const map = await readReaderEdgeMeetings({ store, states: ["az"], includeAgenda: false });
  assert.equal(map.kind, "PROMOTED");
  if (map.kind === "PROMOTED") {
    assert.deepEqual(map.value.meetings.map(row => row.id), ["agenda-area"]);
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
    await memory.writePreparedReaderProjection({ recordClass: "MEETING", scope: MEETINGS_PREPARED_SCOPE,
      payload: { formatVersion: 1, generatedAt: NOW, counts: { fresh: 0, carried: 0, total: 0, duplicatesCollapsed: 0 },
        meetings: [], agendaDocuments: [], sources: [] }, composedFrom: [], factSha256: "a".repeat(64),
      generatedAt: NOW, composedAt: NOW, sourceThrough: null, retrievedAt: null, promotedThrough: null,
    }, null);
    const artifacts = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "publish-now-baseline-")));
    assert.equal((await publishReaderEdgeOutcomeForTest(memory, NOW, null, { artifactStore: artifacts })).readerEdge, "PUBLISHED");
    const before = (await artifacts.readManifest())!.manifest;
    const meetingScopesBefore = (await artifacts.readManifest())!.manifest.scopes;

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
      assert.deepEqual((await artifacts.readManifest())!.manifest.scopes, meetingScopesBefore, "authority updates preserve meeting artifact references");
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
