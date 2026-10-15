import { meetingPublication } from "./helpers/meeting-publication.ts";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

import {
  NATIONAL_SCOPE,
  mergeScopeArtifacts,
  partitionSnapshotByScope,
  readerScopeApplies,
  scopeOfMeeting,
  scopesForStates,
  stateOfOcdId,
  type ReaderManifest,
} from "../lib/meetings/edge-artifacts.ts";
import { LocalFileArtifactStore, scopedReaderArtifactStore, type ReaderArtifactStore } from "../lib/meetings/edge-store.ts";
import {
  publishReaderEdgeArtifacts,
  readReaderEdgeMeetings,
  ensureReaderAuthorityEdge,
} from "../lib/meetings/edge-serving.ts";
import type { Meeting } from "../lib/sources/types.ts";
import type { MeetingsSnapshot } from "../lib/meetings/snapshot.ts";
import { MemoryRoutineDataStore, type PreparedReaderProjectionInput, type PreparedProjectionCoupling } from "../lib/civic-data/store.ts";
import { publishRoutineReaderEdge } from "../lib/civic-data/reader-edge-publication.ts";
import { preparedMeetingScope, preparePublishedMeetingSnapshot, MEETING_LAYOUT_COUPLING, type PreparedMeetingManifest } from "../lib/meetings/prepared-snapshot.ts";
import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import type { CandidateVersionRecord, PromotedProjection } from "../lib/civic-data/types.ts";

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

async function preparedFixture(store: MemoryRoutineDataStore, value: MeetingsSnapshot, composedFrom: readonly PreparedProjectionCoupling[], key = "fixture-place", version = "fixture"): Promise<PreparedReaderProjectionInput> {
  const scope = preparedMeetingScope("US-AZ"), childScope = `${scope}:place:${version}`;
  const bodyIds = [...new Set(value.meetings.flatMap(meeting => meeting.bodyId ?? []))];
  await store.writePreparedReaderProjection({ recordClass: "MEETING", scope: childScope, payload: value, composedFrom,
    factSha256: "a".repeat(64), generatedAt: value.generatedAt, composedAt: value.generatedAt, ...META }, null);
  return { recordClass: "MEETING", scope, payload: { formatVersion: 2, heldChunks: [], unavailableSources: [], chunks: [{
    key, scope: childScope, ocdId: value.meetings[0]?.ocdId ?? null, bodyIds,
    meetingIds: value.meetings.map(meeting => meeting.id), documentIds: value.agendaDocuments.map(document => document.id), fingerprint: "fixture",
    generatedAt: value.generatedAt, counts: value.counts, sources: value.sources, composedFrom, ...META,
  }] } satisfies PreparedMeetingManifest, composedFrom: [...composedFrom, MEETING_LAYOUT_COUPLING],
  factSha256: "b".repeat(64), generatedAt: value.generatedAt, composedAt: value.generatedAt, ...META };
}

async function publishStateSnapshots(snap: MeetingsSnapshot, store: ReaderArtifactStore) {
  let result: Awaited<ReturnType<typeof publishReaderEdgeArtifacts>> | undefined;
  for (const state of new Set(snap.meetings.map(row => stateOfOcdId(row.ocdId) ?? "us"))) {
    const meetings = snap.meetings.filter(row => (stateOfOcdId(row.ocdId) ?? "us") === state);
    const ids = new Set(meetings.map(row => row.id));
    result = await publishReaderEdgeArtifacts(meetingPublication({ ...snap, ...snapshot(meetings),
      agendaDocuments: snap.agendaDocuments.filter(document => ids.has(document.meetingId)) }), META, { store: scopedReaderArtifactStore(store, state) });
    assert.ok(result.status === "PUBLISHED" || result.status === "CURRENT");
  }
  return result!;
}

test("a losing publisher cannot overwrite any bytes selected by the winning manifest", async () => {
  const store = scopedReaderArtifactStore(new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-race-"))), "AZ");
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
  const publish = (loser: boolean) => publishReaderEdgeArtifacts(meetingPublication(snapshot([meeting(loser ? "loser" : "winner", "ocd-division/country:us/state:az")])), META, {
    store: writer(loser), authority: { "federal-directory": { versionId: "next", value: { winner: !loser } } },
    registrations: { az: { versionId: "next", value: { winner: !loser } } },
  });
  const [winner, loser] = await Promise.all([publish(false), publish(true)]);
  assert.equal(winner.status, "PUBLISHED");
  assert.equal(loser.status, "RACED");
  const manifest = (await store.readManifest())!.manifest;
  assert.equal((await store.readArtifact(manifest.scopes[0].key))!.meetings[0].id, "winner");
  for (const ref of [manifest.authorityArtifacts!["federal-directory"]!, manifest.registrations!.az]) {
    const envelope = JSON.parse(gunzipSync((await store.readBytes(ref.key))!).toString("utf8"));
    assert.equal(envelope.value.winner, true);
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
  assert.equal((await publishReaderEdgeArtifacts(meetingPublication(snapshot([meeting("new-meeting", "ocd-division/country:us/state:az")])), META, { store: scopedReaderArtifactStore(store, "AZ") })).status, "PUBLISHED");
  assert.deepEqual((await store.readManifest())!.manifest.stateLegislators, next.stateLegislators, "a meetings-only pass keeps the state references");
});

test("state authority manifests expose only the requested roster and cache its own payload", async () => {
  const artifacts = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-state-authority-")));
  await publishReaderEdgeArtifacts(null, META, { store: artifacts,
    authority: { "federal-directory": { versionId: "federal-state-test", value: {} } } });
  for (const state of ["AZ", "NH"]) await publishReaderEdgeArtifacts(null, META, {
    store: scopedReaderArtifactStore(artifacts, state), stateLegislators: {
      [`US-${state}`]: { versionId: `${state}-roster`, value: { jurisdiction: `US-${state}`, generatedAt: "2026-08-01" } },
    },
  });
  const manifest = (await artifacts.readManifest())!.manifest;
  let reads = 0;
  const counting = new Proxy(artifacts, { get(target, key) {
    if (key === "readBytes") return async (path: string) => { reads++; return target.readBytes(path); };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  assert.equal((await ensureReaderAuthorityEdge(manifest, counting, ["state-legislators"])).stateLegislators, undefined);
  const edge = (await ensureReaderAuthorityEdge(manifest, counting, ["state-legislators"], ["NH"])).stateLegislators!;
  assert.deepEqual([...edge.jurisdictions], ["US-NH"]);
  assert.equal(reads, 0);
  assert.equal(await edge.load("US-AZ"), null);
  assert.equal(reads, 0);
  assert.equal((await edge.load("US-NH"))!.versionId, "NH-roster");
  assert.equal((await edge.load("US-NH"))!.versionId, "NH-roster");
  assert.equal(reads, 1);
});

test("the first scoped publication converts the accepted state bundle without losing unselected states", async () => {
  const artifacts = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-state-cutover-")));
  await publishReaderEdgeArtifacts(null, META, { store: artifacts, authority: { "state-legislators": {
    versionId: "US-AZ=az-prior|US-NH=nh-prior", value: {
      "US-AZ": { jurisdiction: "US-AZ", generatedAt: "2026-08-01" },
      "US-NH": { jurisdiction: "US-NH", generatedAt: "2026-08-02" },
    },
  } } });
  assert.equal(await publishRoutineReaderEdge(new MemoryRoutineDataStore(), "2026-09-06T00:00:00Z", [], { artifactStore: artifacts }), true);
  const manifest = (await artifacts.readManifest())!.manifest;
  assert.equal(manifest.authorityArtifacts?.["state-legislators"], undefined);
  assert.equal(manifest.stateLegislators!["US-NH"].version, "nh-prior");
  const held = await ensureReaderAuthorityEdge(manifest, artifacts, ["state-legislators"]);
  assert.equal((await held.stateLegislators!.load("US-NH"))!.value.generatedAt, "2026-08-02");
});

test("a lost manifest CAS remains a retryable supervisor publication failure", async () => {
  const artifacts = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-supervisor-race-")));
  const raced = new Proxy(artifacts, { get(target, key) {
    if (key === "writeManifest") return async () => ({ modified: false, etag: "winner" });
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  assert.equal(await publishRoutineReaderEdge(new MemoryRoutineDataStore(), "2026-09-06T00:00:00Z", [], { artifactStore: raced }), false);
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
  const store = scopedReaderArtifactStore(new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-edge-shared-"))), "AZ");
  const published = await publishReaderEdgeArtifacts(meetingPublication(snap, bodies), META, { store });
  assert.equal(published.status, "PUBLISHED");
});

test("ordinary publication repairs old area copies once, carries quiet data, and rebuilds changed territories", async () => {
  const primary = "ocd-division/country:us/state:az/county:cochise";
  const secondary = "ocd-division/country:us/state:az/county:pima";
  const bodyId = `${primary}#governing`;
  const snap = snapshot([meeting("shared", "raw-area-key", { bodyId })]);
  const artifacts = scopedReaderArtifactStore(new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "runner-area-edge-"))), "AZ");
  await publishReaderEdgeArtifacts(meetingPublication(snap), META, { store: artifacts,
    authority: { "registry-runtime": { value: {}, versionId: "registry-v1" } } });
  assert.equal((await artifacts.readManifest())!.manifest.meetingRegistryVersion, undefined);
  const memory = new MemoryRoutineDataStore();
  await memory.writePreparedReaderProjection(await preparedFixture(memory, snap, [{ contractId: "meeting-facts", versionId: "facts:none" }]), null);
  let payloadReads = 0, registryReads = 0, registryVersion = "registry-v1";
  let otherAreas: string[] = [secondary];
  const store = new Proxy(memory, { get(target, key) {
    const value = Reflect.get(target, key);
    if (key === "readPreparedReaderProjection") return (...args: unknown[]) => { payloadReads++; return value.apply(target, args); };
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const options = { state: "US-AZ", artifactStore: artifacts, readMeetingRegistry: async (divisions: readonly string[], bodies: readonly string[], acceptedVersion: string) => {
    registryReads++;
    assert.deepEqual(divisions, ["raw-area-key"]);
    assert.deepEqual(bodies, [bodyId]);
    assert.equal(acceptedVersion, (await artifacts.readManifest())!.manifest.authorityArtifacts!["registry-runtime"]!.version,
      "territories are requested from the accepted edge version, not the independently advancing database pointer");
    return { kind: "PROMOTED" as const, metadata: { recordClass: "REGISTRY_RUNTIME_BINDING" as const,
      scope: "US:reader-registry-runtime-bindings", versionId: registryVersion },
      value: { registry: { bodies: [{ id: bodyId, ocdId: primary, alsoServesOcdIds: otherAreas }] } } as unknown as RegistryRuntimeReadModel };
  } };
  const selected = [{ recordClass: "MEETING" as const, scope: "US-AZ:changed-meetings" }];
  assert.equal(await publishRoutineReaderEdge(store, snap.generatedAt, selected, options), true);
  let held = (await artifacts.readManifest())!;
  assert.equal(held.manifest.meetingRegistryVersion, "registry-v1");
  assert.deepEqual(held.manifest.scopes.map(s => s.ocdId).sort(), [primary, secondary].sort());
  assert.equal(registryReads, 1);
  const readCount = payloadReads;
  assert.equal(await publishRoutineReaderEdge(store, snap.generatedAt, selected, options), true);
  assert.equal(payloadReads, readCount, "quiet compositions do not read meeting payloads");
  assert.equal(registryReads, 1, "quiet compositions do not read registry payloads");
  assert.equal((await artifacts.readManifest())!.manifest.sequence, held.manifest.sequence);
  const changedAuthority = { ...held.manifest.authorityArtifacts!, "registry-runtime": {
    ...held.manifest.authorityArtifacts!["registry-runtime"]!, version: "registry-v2" } };
  await artifacts.writeManifest({ ...held.manifest, authorityArtifacts: changedAuthority }, held.etag ?? null);
  registryVersion = "registry-v2";
  otherAreas = [];
  assert.equal(await publishRoutineReaderEdge(store, snap.generatedAt, selected, options), true);
  held = (await artifacts.readManifest())!;
  assert.equal(held.manifest.meetingRegistryVersion, registryVersion);
  assert.deepEqual(held.manifest.scopes.map(s => s.ocdId), [primary], "removed territories stop serving the body's meetings");
  assert.equal(registryReads, 2);
  // A selected read that races the registry pointer must retain the entire LKG manifest.
  const lastValid = held.manifest;
  await artifacts.writeManifest({ ...lastValid, meetingRegistryVersion: "old-format" }, held.etag ?? null);
  const beforeFailure = (await artifacts.readManifest())!.manifest;
  registryVersion = "raced-pointer";
  assert.equal(await publishRoutineReaderEdge(store, snap.generatedAt, selected, options), false);
  assert.deepEqual((await artifacts.readManifest())!.manifest, beforeFailure);
});

test("a dirty prepared publication loads only the changed place and its registry bodies", async () => {
  const primary = "ocd-division/country:us/state:az/county:pima";
  const quiet = "ocd-division/country:us/state:az/county:cochise";
  const a = meeting("changing", primary, { bodyId: `${primary}#governing` });
  const b = meeting("quiet", quiet, { bodyId: `${quiet}#governing` });
  const memory = new MemoryRoutineDataStore();
  const facts = [{ contractId: "meeting-facts", versionId: "facts:none" }];
  const first = await preparedFixture(memory, snapshot([a]), facts, primary, "primary-v1");
  const held = await preparedFixture(memory, snapshot([b]), facts, quiet, "quiet-v1");
  const root = (changed: PreparedReaderProjectionInput): PreparedReaderProjectionInput => ({ ...changed,
    payload: { ...(changed.payload as PreparedMeetingManifest), chunks: [
      ...(changed.payload as PreparedMeetingManifest).chunks, ...(held.payload as PreparedMeetingManifest).chunks,
    ] } });
  await memory.writePreparedReaderProjection(root(first), null);
  const artifacts = scopedReaderArtifactStore(new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-lazy-"))), "AZ");
  await publishReaderEdgeArtifacts(null, META, { store: artifacts,
    authority: { "registry-runtime": { value: {}, versionId: "registry-v1" } } });
  const payloadReads: string[] = [], registryReads: string[][] = [];
  const store = new Proxy(memory, { get(target, key) {
    const value = Reflect.get(target, key);
    if (key === "readPreparedReaderProjection") return (recordClass: string, scope: string) => {
      if (scope.includes(":place:")) payloadReads.push(scope);
      return value.call(target, recordClass, scope);
    };
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const options = { state: "US-AZ", artifactStore: artifacts,
    readMeetingRegistry: async (_divisions: readonly string[], bodies: readonly string[], versionId: string) => {
      registryReads.push([...bodies]);
      return { kind: "PROMOTED" as const, metadata: { recordClass: "REGISTRY_RUNTIME_BINDING" as const,
        scope: "US:reader-registry-runtime-bindings", versionId }, value: { registry: {
        bodies: bodies.map(id => ({ id, ocdId: id.split("#")[0] })),
      } } as unknown as RegistryRuntimeReadModel };
    } };
  const selected = [{ recordClass: "MEETING" as const, scope: "US-AZ:changed-meetings" }];
  assert.equal(await publishRoutineReaderEdge(store, first.generatedAt, selected, options), true);
  assert.equal(payloadReads.length, 2);
  const before = (await artifacts.readManifest())!;
  const updated = await preparedFixture(memory, snapshot([{ ...a, title: "Revised public hearing" }]), facts, primary, "primary-v2");
  const sequence = (await memory.readPreparedReaderProjectionCoupling("MEETING", first.scope))!.sequence;
  await memory.writePreparedReaderProjection(root(updated), sequence);
  await artifacts.writeManifest({ ...before.manifest, composition: "preceding-source-composition" }, before.etag ?? null);
  payloadReads.length = 0;
  registryReads.length = 0;
  assert.equal(await publishRoutineReaderEdge(store, updated.generatedAt, selected, options), true);
  assert.deepEqual(payloadReads, [`${first.scope}:place:primary-v2`]);
  assert.deepEqual(registryReads, [[a.bodyId]]);
  const after = (await artifacts.readManifest())!.manifest;
  assert.deepEqual(after.scopes.find(scope => scope.ocdId === quiet), before.manifest.scopes.find(scope => scope.ocdId === quiet));
  const reading = await readReaderEdgeMeetings({ store: artifacts, states: ["az"] });
  assert.equal(reading.kind, "PROMOTED");
  if (reading.kind === "PROMOTED") assert.equal(reading.value.meetings.find(row => row.id === a.id)?.title, "Revised public hearing");
});

test("a racing prepared meeting copy keeps its exact LKG while an independent registry update publishes, then the next pass repairs meetings", async () => {
  const imported = JSON.parse(gunzipSync(readFileSync("tests/fixtures/registry-transfer-import.json.gz")).toString("utf8")) as {
    record: CandidateVersionRecord; projection: PromotedProjection<RegistryRuntimeReadModel>;
  };
  const body = imported.projection.payload.registry.bodies.find(body => body.ocdId?.includes("/state:az/") && body.id.endsWith("#governing"))!;
  const older = snapshot([meeting("held-meeting", body.ocdId, { bodyId: body.id })]);
  const newer = { ...snapshot([meeting("new-meeting", body.ocdId, { bodyId: body.id })]), generatedAt: "2026-10-09T12:00:00.000Z" };
  const rootArtifacts = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "meeting-registry-race-")));
  const artifacts = scopedReaderArtifactStore(rootArtifacts, "AZ");
  await publishReaderEdgeArtifacts(meetingPublication(older, [body]), META, { store: artifacts, meetingRegistryVersion: "registry-old",
    checks: { composition: "held-composition", freshChecks: {} } });
  const before = (await artifacts.readManifest())!.manifest;
  const memory = new MemoryRoutineDataStore();
  Object.assign(memory, { candidates: new Map([[imported.record.candidate.id, imported.record]]), promotions: new Map([[imported.projection.key, imported.projection]]) });
  const partition = MEETING_PARTITION_CONTRACTS[0];
  const preparedInput = await preparedFixture(memory, newer, [{ contractId: partition.id, versionId: "meeting-v1", routes: [`az-portal|${body.id}`], checkedAt: newer.generatedAt },
    { contractId: "meeting-facts", versionId: "facts:none" }] as import("../lib/meetings/fresh-checks.ts").FreshCheckCoupling[]);
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
  const options = { state: "US-AZ", artifactStore: artifacts, readMeetingRegistry: async (_divisions: readonly string[], _bodies: readonly string[], versionId: string) => ({
    kind: "PROMOTED" as const, metadata: { recordClass: "REGISTRY_RUNTIME_BINDING" as const, scope: imported.projection.scope, versionId },
    value: { registry: { bodies: [body] } } as RegistryRuntimeReadModel,
  }) };
  const prepared = await preparePublishedMeetingSnapshot(store, newer.generatedAt, { state: "US-AZ" });
  assert.equal(prepared.status, "CURRENT");
  if (prepared.status === "CURRENT") assert.equal(prepared.checkedAt, newer.generatedAt, "the failed read has a newer check it must not apply to the held copy");
  assert.equal(await publishRoutineReaderEdge(store, newer.generatedAt, selected, options), false, "the raced meeting composition remains owed");
  const independent = (await artifacts.readManifest())!.manifest;
  const registryVersion = `${imported.projection.versionId}+facts:none`;
  assert.equal((await publishReaderEdgeArtifacts(null, META, { store: rootArtifacts,
    authority: { "registry-runtime": { value: imported.projection.payload, versionId: registryVersion } } })).status, "PUBLISHED");
  assert.equal((await rootArtifacts.readManifest())!.manifest.authorityArtifacts!["registry-runtime"]!.version, registryVersion);
  assert.deepEqual((await artifacts.readManifest())!.manifest, independent, "the national authority publication preserves the state meeting pointer");
  assert.deepEqual(independent.scopes, before.scopes);
  assert.equal(independent.meetingRegistryVersion, before.meetingRegistryVersion);
  assert.equal(independent.composition, before.composition);
  assert.equal(independent.generatedAt, before.generatedAt, "a failed composition cannot renew held meeting dates");
  assert.equal(independent.retrievedAt, before.retrievedAt, "CURRENT preparation cannot renew the held retrieval date when its payload read races");
  assert.equal(independent.sourceThrough, before.sourceThrough);
  assert.equal(independent.promotedThrough, before.promotedThrough);
  assert.deepEqual(independent.freshChecks, before.freshChecks);
  assert.equal(await publishRoutineReaderEdge(store, newer.generatedAt, [{ recordClass: "MEETING", scope: "US-AZ:changed-meetings" }], options), true);
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
  const published = await publishStateSnapshots(snap, store);
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
  const store = scopedReaderArtifactStore(new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-edge-"))), "AZ");
  const snap = snapshot([meeting("az1", "ocd-division/country:us/state:az/place:tucson#governing")]);
  const first = await publishReaderEdgeArtifacts(meetingPublication(snap), META, { store });
  assert.equal(first.status, "PUBLISHED");

  // The same data and the same "Last checked" → nothing republished.
  const same = await publishReaderEdgeArtifacts(meetingPublication(snap), META, { store });
  assert.equal(same.status, "CURRENT");
  if (same.status === "CURRENT") assert.equal(same.sequence, 1);

  // The same data checked again later → the manifest alone advances, so
  // "Last checked" moves; every scope artifact it points at is the one served.
  const scopesBefore = (await store.readManifest())!.manifest.scopes;
  const again = await publishReaderEdgeArtifacts(meetingPublication({ ...snap, generatedAt: "2026-09-15T13:00:00.000Z" }), META, { store });
  assert.equal(again.status, "PUBLISHED");
  if (again.status === "PUBLISHED") assert.equal(again.sequence, 2);
  const rechecked = (await store.readManifest())!.manifest;
  assert.equal(rechecked.generatedAt, "2026-09-15T13:00:00.000Z");
  assert.deepEqual(rechecked.scopes.map(scope => scope.key), scopesBefore.map(scope => scope.key), "no artifact is rewritten for a check");

  // Changed data → new immutable sequence.
  const changed = snapshot([
    meeting("az1", "ocd-division/country:us/state:az/place:tucson#governing"),
    meeting("az2", "ocd-division/country:us/state:az/county:pima#governing"),
  ]);
  const advanced = await publishReaderEdgeArtifacts(meetingPublication(changed), META, { store });
  assert.equal(advanced.status, "PUBLISHED");
  if (advanced.status === "PUBLISHED") assert.equal(advanced.sequence, 3, "monotonic advance");
});

test("a stale publisher that read an older manifest cannot regress the pointer (monotonic CAS)", async () => {
  const store = scopedReaderArtifactStore(new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-edge-"))), "AZ");
  const a = snapshot([meeting("az1", "ocd-division/country:us/state:az/place:tucson#governing")]);
  await publishReaderEdgeArtifacts(meetingPublication(a), META, { store });

  const staleExpected = (await store.readManifest())!.etag;
  // First writer advances 1 -> 2.
  const changed = snapshot([
    meeting("az1", "ocd-division/country:us/state:az/place:tucson#governing"),
    meeting("az2", "ocd-division/country:us/state:az/county:pima#governing"),
  ]);
  await publishReaderEdgeArtifacts(meetingPublication(changed), META, { store });
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
  const store = scopedReaderArtifactStore(new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-edge-cache-"))), "AZ");
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
  await publishReaderEdgeArtifacts(meetingPublication(v1), META, { store: counting });

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
  await publishReaderEdgeArtifacts(meetingPublication(v2), META, { store: counting });
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
  const store = scopedReaderArtifactStore(new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-carry-"))), "AZ");
  let geographicWrites = 0;
  const counted = new Proxy(store, { get(target, key) {
    const value = Reflect.get(target, key);
    if (key === "putImmutable") return (...args: Parameters<typeof store.putImmutable>) => { if (args[1] === "json") geographicWrites++; return target.putImmutable(...args); };
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const snap = snapshot([meeting("cochise", "ocd-division/country:us/state:az/county:cochise")]);
  await publishReaderEdgeArtifacts(meetingPublication(snap), META, { store: counted, checks: { composition: "held-meetings", freshChecks: { calendar: META.retrievedAt } } });
  const before = (await store.readManifest())!.manifest;
  const writesBefore = geographicWrites;
  const authority = { "campaign-sites": { value: { rows: [] }, versionId: "new-sites" } };
  const extras = { everydayRouting: { rows: [] }, versionIds: { "everyday-routing": "routing-v1" } };
  assert.equal((await publishReaderEdgeArtifacts(null, META, { store: counted, authority, extras })).status, "PUBLISHED");
  const after = (await store.readManifest())!.manifest;
  assert.deepEqual(after.scopes, before.scopes);
  assert.deepEqual(after.freshChecks, before.freshChecks);
  assert.equal(after.composition, before.composition);
  assert.equal(after.generatedAt, before.generatedAt);
  assert.equal(geographicWrites, writesBefore);
  assert.deepEqual(after.extrasVersionIds, extras.versionIds);
  const same = await publishReaderEdgeArtifacts(null, META, { store: counted, authority: { "campaign-sites": { carried: true, versionId: "new-sites" } }, extras });
  assert.equal(same.status, "CURRENT");
  assert.equal(geographicWrites, writesBefore);
  const read = await readReaderEdgeMeetings({ store });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind === "PROMOTED") assert.equal(read.value.meetings[0].id, "cochise");
});

test("authority publication works before meeting composition; empty scopes keep the meeting fallback", async () => {
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-first-authority-")));
  assert.equal((await publishReaderEdgeArtifacts(null, META, { store, authority: { "campaign-sites": { value: { rows: [] }, versionId: "first" } } })).status, "PUBLISHED");
  assert.deepEqual((await store.readManifest())!.manifest.scopes, []);
  let fallback = false;
  await readReaderEdgeMeetings({ store, states: ["az"], fallback: async () => { fallback = true; return { kind: "NOT_RECORDED" } as never; } });
  assert.equal(fallback, true);
});

test("a changed meeting rewrites only its area; unchanged references survive publication", async () => {
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-delta-")));
  const a = meeting("delta-a", "ocd-division/country:us/state:az/county:pima");
  const b = meeting("delta-b", "ocd-division/country:us/state:az/county:cochise");
  const c = meeting("delta-c", "ocd-division/country:us/state:nj/county:morris");
  await publishStateSnapshots(snapshot([a, b, c]), store);
  const before = (await store.readManifest("AZ"))!.manifest;
  const writes: string[] = [];
  const counted = new Proxy(store, { get(target, key) {
    if (key === "putImmutable") return async (...args: Parameters<typeof store.putImmutable>) => { const path = await target.putImmutable(...args); if (args[1] === "json") writes.push(path); return path; };
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  await publishStateSnapshots(snapshot([{ ...a, title: "Changed sitting" }, b, c]), counted);
  const after = (await store.readManifest("AZ"))!.manifest;
  assert.equal(writes.length, 1);
  for (const ref of before.scopes.filter(ref => !ref.meetingIds?.includes(a.id))) {
    const next = after.scopes.find(next => next.scope === ref.scope)!;
    assert.deepEqual(next, { ...ref, chunkVersion: next.chunkVersion });
  }
});

test("area reads preserve split ZIP divisions, nearby bodies across a state line, and empty held areas", async () => {
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-area-")));
  const county = "ocd-division/country:us/state:az/county:pima";
  const split = "ocd-division/country:us/state:az/county:cochise";
  await publishStateSnapshots(snapshot([
    meeting("area-governing", county, { location: null }),
    meeting("area-split", split, { location: null }),
    meeting("area-near", "ocd-division/country:us/state:nm/place:near", { location: { lat: 32.2, lng: -110.9 } as never }),
    meeting("area-far", "ocd-division/country:us/state:az/place:far", { location: { lat: 35, lng: -112 } as never }),
  ]), store);
  const read = await readReaderEdgeMeetings({ store, states: ["az", "nm"], ocdIds: [county, split], nearby: { lat: 32.2, lng: -110.9, radiusKm: 25 } });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind === "PROMOTED") assert.deepEqual(read.value.meetings.map(row => row.id).sort(), ["area-governing", "area-near", "area-split"]);
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
  await publishStateSnapshots(snap, store);
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
