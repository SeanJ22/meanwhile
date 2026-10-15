import { meetingPublication } from "./helpers/meeting-publication.ts";
import assert from "node:assert/strict";
import { mkdtemp,rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalFileArtifactStore,NetlifyBlobsArtifactStore,scopedReaderArtifactStore } from "../lib/meetings/edge-store.ts";
import { publishReaderEdgeArtifacts,publishReaderEdgeChecks,readReaderEdgeMeetings,ensureReaderAuthorityEdge } from "../lib/meetings/edge-serving.ts";
import { meetingSettingsFromValues } from "../lib/meetings/settings.ts";
import type { MeetingsSnapshot } from "../lib/meetings/snapshot.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { publishRoutineReaderEdgeOutcome } from "../lib/civic-data/reader-edge-publication.ts";
import { installFactReader } from "../lib/facts/db.ts";
import { partitionSnapshotByScope, type MeetingPublication } from "../lib/meetings/edge-artifacts.ts";

const now = "2026-10-15T00:00:00Z";
const metadata = { sourceThrough: now,retrievedAt: now,promotedThrough: now };
const snapshot = (id: string,state: string,title = id): MeetingsSnapshot => ({ formatVersion: 1,generatedAt: now,
  counts: { fresh: 1,carried: 0,total: 1,duplicatesCollapsed: 0 },sources: [],agendaDocuments: [],
  meetings: [{ id,title,ocdId: `ocd-division/country:us/state:${state.toLowerCase()}/place:fixture`,
    bodyId: `${state}-body`,startsAt: "2026-10-16T12:00:00Z",location: { lat: 32.2,lng: -110.9 } } as Meeting] });

test("publication input identity advances atomically even when meeting content stays current", async () => {
  const root = await mkdtemp(join(tmpdir(), "reader-publication-inputs-"));
  try {
    const base = new LocalFileArtifactStore(root), store = scopedReaderArtifactStore(base, "AZ");
    const fingerprint = "a".repeat(64), next = "b".repeat(64);
    assert.equal(await store.readPublicationIdentity(), null);
    const initial = await publishReaderEdgeArtifacts(meetingPublication(snapshot("meeting", "AZ")), metadata,
      { store, publicationFingerprint: fingerprint });
    assert.equal(initial.status, "PUBLISHED");
    const held = (await store.readManifest())!;
    assert.deepEqual(await store.readPublicationIdentity(), { fingerprint, sequence: 1 });
    assert.equal(await base.readPublicationIdentity(), null);
    assert.equal(await base.readPublicationIdentity("NJ"), null);
    assert.ok((await readFile(join(root, "reader/states/AZ/manifest.json"), "utf8"))
      .startsWith(`{"publicationFingerprint":"${fingerprint}","sequence":1,`));
    assert.equal((await publishReaderEdgeArtifacts(null, metadata, { store, publicationFingerprint: fingerprint })).status, "CURRENT");
    const noPayloadWrites = new Proxy(store, { get(target, key) {
      if (key === "putImmutable") return async () => { throw new Error("Unchanged publication must not write meeting artifacts"); };
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } });
    assert.equal((await publishReaderEdgeArtifacts(null, metadata,
      { store: noPayloadWrites, publicationFingerprint: next })).status, "PUBLISHED");
    assert.deepEqual(await store.readPublicationIdentity(), { fingerprint: next, sequence: 2 });
    assert.equal((await store.writeManifest({ ...held.manifest, publicationFingerprint: "c".repeat(64) }, held.etag)).modified, false);
    assert.deepEqual(await store.readPublicationIdentity(), { fingerprint: next, sequence: 2 });
    assert.equal((await publishReaderEdgeChecks({ generatedAt: "2026-10-15T01:00:00Z", retrievedAt: now,
      checks: { composition: "updated-check", freshChecks: { source: "2026-10-15T01:00:00Z" } } }, { store })).status, "PUBLISHED");
    assert.equal(await store.readPublicationIdentity(), null, "partial checks invalidate an uncomputed input identity");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("blob publication identity uses strong metadata reads and the manifest's conditional write", async () => {
  const fingerprint = "d".repeat(64), calls: unknown[] = [];
  const store = new Proxy(new NetlifyBlobsArtifactStore(), { get(target, key) {
    if (key === "store") return async (consistency: string) => {
      assert.equal(consistency, "strong");
      return {
        getMetadata: async (path: string) => { calls.push(path); return { metadata: { publicationFingerprint: fingerprint, publicationSequence: 9 } }; },
        setJSON: async (path: string, value: unknown, options: unknown) => { calls.push({ path, value, options }); return { modified: true, etag: "new" }; },
      };
    };
    return Reflect.get(target, key);
  } });
  assert.deepEqual(await store.readPublicationIdentity("NJ"), { fingerprint, sequence: 9 });
  const manifest = { formatVersion: 1 as const, sequence: 10, generatedAt: now, sourceThrough: null, retrievedAt: null,
    promotedThrough: null, sources: [], scopes: [], publicationFingerprint: fingerprint };
  await store.writeManifest(manifest, "prior", "NJ");
  assert.deepEqual(calls, ["reader/states/NJ/manifest.json", { path: "reader/states/NJ/manifest.json", value: manifest,
    options: { onlyIfMatch: "prior", metadata: { publicationFingerprint: fingerprint, publicationSequence: 10 } } }]);
});

for (const second of [false,true]) test(`state artifact publications stay separate${second ? " after an update" : ""} and IDs select one state`,async () => {
  const root = await mkdtemp(join(tmpdir(),"reader-states-"));
  try {
    const store = new LocalFileArtifactStore(root);
    const az = scopedReaderArtifactStore(store,"AZ"),nj = scopedReaderArtifactStore(store,"NJ");
    assert.equal((await publishReaderEdgeArtifacts(meetingPublication(snapshot("az-meeting","AZ")),metadata,{ store: az })).status,"PUBLISHED");
    assert.equal((await publishReaderEdgeArtifacts(meetingPublication(snapshot("nj-meeting","NJ")),metadata,{ store: nj })).status,"PUBLISHED");
    const before = await store.readManifest("NJ");
    if (second) assert.equal((await publishReaderEdgeArtifacts(meetingPublication(snapshot("az-meeting","AZ","Changed agenda")),metadata,{ store: az })).status,"PUBLISHED");
    assert.deepEqual(await store.readManifest("NJ"),before);
    assert.equal(await store.readManifest(),null);
    const states: (string | undefined)[] = [];
    const counted = new Proxy(store,{ get(target,key) {
      if (key === "readManifest") return async (state?: string) => { states.push(state); assert.ok(state); return target.readManifest(state); };
      const value = Reflect.get(target,key); return typeof value === "function" ? value.bind(target) : value;
    } });
    const read = await readReaderEdgeMeetings({ store: counted,meetingId: "nj-meeting",now,settings: meetingSettingsFromValues(),
      fallback: async () => { throw new Error("Unexpected database read"); } });
    assert.equal(read.kind,"PROMOTED");
    if (read.kind === "PROMOTED") assert.deepEqual(read.value.meetings.map(meeting => meeting.id),["nj-meeting"]);
    assert.deepEqual(states,["NJ"]);
    states.length = 0;
    const scoped = await readReaderEdgeMeetings({ store: counted,ocdIds: ["ocd-division/country:us/state:az/place:fixture"],now,
      settings: meetingSettingsFromValues(),fallback: async () => { throw new Error("Unexpected database read"); } });
    assert.equal(scoped.kind,"PROMOTED");
    assert.deepEqual(states,["AZ","US"]);
    states.length = 0;
    assert.equal((await readReaderEdgeMeetings({ store: counted,now,settings: meetingSettingsFromValues(),
      fallback: async () => { throw new Error("Unscoped queries cannot read the database"); } })).kind,"NOT_RECORDED");
    assert.deepEqual(states,[]);
  } finally { await rm(root,{ recursive: true,force: true }); }
});

test("state authority references hydrate only the requested state beside national references",async () => {
  const root = await mkdtemp(join(tmpdir(),"reader-state-authority-"));
  try {
    const store = new LocalFileArtifactStore(root);
    await publishReaderEdgeArtifacts(null,metadata,{ store,authority: { "federal-directory": { versionId: "federal",value: { federal: true } } } });
    for (const state of ["AZ","NJ"]) await publishReaderEdgeArtifacts(null,metadata,{ store: scopedReaderArtifactStore(store,state),
      authority: { "comment-access": { versionId: state,value: { kind: "comment-access",records: [{ id: state }] } } },
      registrations: { [state.toLowerCase()]: { versionId: state,value: { state } } } });
    const manifest = (await store.readManifest())!.manifest;
    const reads: (string | undefined)[] = [];
    const counted = new Proxy(store,{ get(target,key) {
      if (key === "readManifest") return async (state?: string) => { reads.push(state); return target.readManifest(state); };
      const value = Reflect.get(target,key); return typeof value === "function" ? value.bind(target) : value;
    } });
    const result = await ensureReaderAuthorityEdge(manifest,counted,["comment-access","federal-directory"],["az"]);
    assert.deepEqual(result.commentAccess?.value.records.map(row => row.id),["AZ"]);
    assert.deepEqual([...result.registrations?.states ?? []],["az"]);
    assert.equal(result.federalDirectory?.versionId,"federal");
    assert.deepEqual(reads,["AZ"]);
  } finally { await rm(root,{ recursive: true,force: true }); }
});

test("federal meetings use their own manifest and accompany scoped geography reads",async () => {
  const root = await mkdtemp(join(tmpdir(),"reader-federal-meetings-"));
  try {
    const store = new LocalFileArtifactStore(root);
    await publishReaderEdgeArtifacts(meetingPublication(snapshot("local","AZ")),metadata,{ store: scopedReaderArtifactStore(store,"AZ") });
    const federal = snapshot("federal","US");
    federal.meetings[0] = { ...federal.meetings[0]!,ocdId: "ocd-division/country:us" };
    await publishReaderEdgeArtifacts(meetingPublication(federal),metadata,{ store: scopedReaderArtifactStore(store,"US") });
    const read = await readReaderEdgeMeetings({ store,states: ["AZ"],now,settings: meetingSettingsFromValues() });
    assert.equal(read.kind,"PROMOTED");
    if (read.kind === "PROMOTED") assert.deepEqual(read.value.meetings.map(meeting => meeting.id).sort(),["federal","local"]);
    assert.equal(await store.readManifest(),null);
    assert.equal(await store.readMeetingState("federal"),"US");
  } finally { await rm(root,{ recursive: true,force: true }); }
});

test("the national dispatcher retains reference authority at the root without preparing state meetings",async () => {
  const root = await mkdtemp(join(tmpdir(),"reader-national-dispatch-"));
  installFactReader(null);
  try {
    const artifacts = new LocalFileArtifactStore(root);
    await publishReaderEdgeArtifacts(null,metadata,{ store: artifacts,authority: {
      "federal-directory": { versionId: "federal-1",value: { federal: true } } } });
    const store = new Proxy(new MemoryRoutineDataStore(),{ get(target,key) {
      if (key === "readPreparedSnapshot" || key === "readPromotedPointers" || key === "readMeetingDependencies") {
        return () => { throw new Error("Reference publication opened meeting content"); };
      }
      const value = Reflect.get(target,key); return typeof value === "function" ? value.bind(target) : value;
    } });
    const result = await publishRoutineReaderEdgeOutcome(store,now,[],{ artifactStore: artifacts,state: "US" });
    assert.equal(result.ok,true);
    const manifest = (await artifacts.readManifest())!.manifest;
    assert.equal(manifest.authorityArtifacts?.["federal-directory"]?.version,"federal-1");
    assert.deepEqual(manifest.scopes,[]);
    assert.equal(await artifacts.readManifest("US"),null);
  } finally {
    installFactReader(undefined);
    await rm(root,{ recursive: true,force: true });
  }
});

test("artifact uploads are bounded and only new meeting IDs are indexed before manifest publication",async () => {
  const root = await mkdtemp(join(tmpdir(),"reader-artifact-pool-"));
  try {
    const base = scopedReaderArtifactStore(new LocalFileArtifactStore(root),"AZ");
    let active = 0,peak = 0,refuseIndex = false;
    const indexed: string[] = [];
    const store = new Proxy(base,{ get(target,key) {
      if (key === "putImmutable") return async (...args: Parameters<typeof base.putImmutable>) => {
        active++; peak = Math.max(peak,active);
        try {
          await new Promise(resolve => setTimeout(resolve,2));
          return await target.putImmutable(...args);
        } finally { active--; }
      };
      if (key === "writeMeetingStates") return async (ids: readonly string[],state: string) => {
        if (refuseIndex) throw new Error("Index storage unavailable");
        indexed.push(...ids); return target.writeMeetingStates(ids,state);
      };
      const value = Reflect.get(target,key); return typeof value === "function" ? value.bind(target) : value;
    } });
    const initial = snapshot("meeting-0","AZ");
    initial.meetings = Array.from({ length: 24 },(_,index) => ({ ...initial.meetings[0]!,id: `meeting-${index}`,
      bodyId: `body-${index}`,ocdId: `ocd-division/country:us/state:az/place:fixture${index}` }));
    initial.counts = { ...initial.counts,fresh: 24,total: 24 };
    assert.equal((await publishReaderEdgeArtifacts(meetingPublication(initial),metadata,{ store,now })).status,"PUBLISHED");
    assert.equal(peak,8);
    assert.deepEqual((await store.readManifest())!.manifest.scopes.map(scope => scope.scope),partitionSnapshotByScope(initial,now).map(scope => scope.scope));
    assert.deepEqual(new Set(indexed),new Set(initial.meetings.map(meeting => meeting.id)));
    indexed.length = 0;
    const changed = { ...initial,meetings: initial.meetings.map(meeting => ({ ...meeting,title: "Posted agenda changed" })) };
    assert.equal((await publishReaderEdgeArtifacts(meetingPublication(changed),metadata,{ store,now })).status,"PUBLISHED");
    assert.deepEqual(indexed,[]);
    const before = await store.readManifest();
    refuseIndex = true;
    const added = { ...changed,meetings: [...changed.meetings,{ ...changed.meetings[0]!,id: "new-meeting" }] };
    assert.equal((await publishReaderEdgeArtifacts(meetingPublication(added),metadata,{ store,now })).status,"FAILED");
    assert.deepEqual(await store.readManifest(),before);
  } finally { await rm(root,{ recursive: true,force: true }); }
});

test("publication drains each place before reading the next and retains overlapping service areas", async () => {
  const root = await mkdtemp(join(tmpdir(), "reader-place-stream-"));
  try {
    const base = new LocalFileArtifactStore(root);
    const scoped = scopedReaderArtifactStore(base, "AZ");
    let completed = 0;
    const store = new Proxy(scoped, { get(target, key) {
      if (key === "putImmutable") return async (...args: Parameters<typeof scoped.putImmutable>) => {
        const result = await target.putImmutable(...args);
        completed++;
        return result;
      };
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } });
    const area = "ocd-division/country:us/state:az/place:fixture";
    const publication: MeetingPublication = { generatedAt: now, sources: [], meetingCount: 3, chunks: (async function* () {
      for (let index = 0; index < 3; index++) {
        assert.equal(completed, index, "The previous place must be saved before another is loaded");
        yield { key: `place-${index}`, version: "v1", read: async () => ({ snapshot: snapshot(`meeting-${index}`, "AZ"),
          bodies: [{ id: "AZ-body", ocdId: area, alsoServesOcdIds: [area] }] }) };
      }
    })() };
    assert.equal((await publishReaderEdgeArtifacts(publication, metadata, { store })).status, "PUBLISHED");
    const manifest = (await store.readManifest())!.manifest;
    assert.equal(manifest.scopes.length, 3);
    assert.equal(new Set(manifest.scopes.map(scope => scope.scope)).size, 3);
    const read = await readReaderEdgeMeetings({ store: base, ocdIds: [area], now, settings: meetingSettingsFromValues(),
      fallback: async () => { throw new Error("Unexpected database read"); } });
    assert.equal(read.kind, "PROMOTED");
    if (read.kind === "PROMOTED") assert.deepEqual(read.value.meetings.map(meeting => meeting.id).sort(), ["meeting-0", "meeting-1", "meeting-2"]);
    const before = await store.readManifest();
    const failed: MeetingPublication = { generatedAt: now, sources: [], meetingCount: 2, chunks: (async function* () {
      yield { key: "new-place", version: "v1", read: async () => ({ snapshot: snapshot("replacement", "AZ") }) };
      throw new Error("Next place could not be read");
    })() };
    assert.equal((await publishReaderEdgeArtifacts(failed, metadata, { store })).status, "FAILED");
    assert.deepEqual(await store.readManifest(), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("streamed federal pieces remain in every place's meeting read", async () => {
  const root = await mkdtemp(join(tmpdir(), "reader-federal-stream-"));
  try {
    const base = new LocalFileArtifactStore(root);
    const local = snapshot("local", "AZ");
    const federal = snapshot("federal", "US");
    federal.meetings[0] = { ...federal.meetings[0]!, ocdId: null };
    await publishReaderEdgeArtifacts(meetingPublication(local), metadata, { store: scopedReaderArtifactStore(base, "AZ") });
    const publication: MeetingPublication = { generatedAt: now, sources: [], meetingCount: 1,
      chunks: (async function* () { yield { key: "federal-body", version: "v1", read: async () => ({ snapshot: federal }) }; })() };
    assert.equal((await publishReaderEdgeArtifacts(publication, metadata, { store: scopedReaderArtifactStore(base, "US") })).status, "PUBLISHED");
    const read = await readReaderEdgeMeetings({ store: base, states: ["AZ"], now, settings: meetingSettingsFromValues(),
      fallback: async () => { throw new Error("Unexpected database read"); } });
    assert.equal(read.kind, "PROMOTED");
    if (read.kind === "PROMOTED") assert.deepEqual(read.value.meetings.map(meeting => meeting.id).sort(), ["federal", "local"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a changed place reads only its payload while registry changes reread affected territories", async () => {
  const root = await mkdtemp(join(tmpdir(), "reader-lazy-chunks-"));
  try {
    const store = scopedReaderArtifactStore(new LocalFileArtifactStore(root), "AZ");
    const reads: number[] = [];
    const publication = (changed: boolean): MeetingPublication => ({ generatedAt: now, sources: [], meetingCount: 20,
      chunks: (async function* () {
        for (let index = 0; index < 20; index++) yield { key: `place-${index}`, version: changed && index === 5 ? "v2" : "v1",
          read: async () => {
            reads.push(index);
            return { snapshot: snapshot(`meeting-${index}`, "AZ", changed && index === 5 ? "Posted change" : `meeting-${index}`) };
          } };
      })() });
    assert.equal((await publishReaderEdgeArtifacts(publication(false), metadata, { store, meetingRegistryVersion: "registry-1" })).status, "PUBLISHED");
    reads.length = 0;
    assert.equal((await publishReaderEdgeArtifacts(publication(true), metadata, { store, meetingRegistryVersion: "registry-1" })).status, "PUBLISHED");
    assert.deepEqual(reads, [5]);
    reads.length = 0;
    assert.equal((await publishReaderEdgeArtifacts(publication(true), metadata, { store, meetingRegistryVersion: "registry-1" })).status, "CURRENT");
    assert.deepEqual(reads, []);
    assert.equal((await publishReaderEdgeArtifacts(publication(true), metadata, { store, meetingRegistryVersion: "registry-2" })).status, "PUBLISHED");
    assert.deepEqual(reads, Array.from({ length: 20 }, (_, index) => index));
  } finally { await rm(root, { recursive: true, force: true }); }
});
