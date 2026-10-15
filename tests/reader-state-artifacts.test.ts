import assert from "node:assert/strict";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalFileArtifactStore,scopedReaderArtifactStore } from "../lib/meetings/edge-store.ts";
import { publishReaderEdgeArtifacts,readReaderEdgeMeetings,ensureReaderAuthorityEdge } from "../lib/meetings/edge-serving.ts";
import { meetingSettingsFromValues } from "../lib/meetings/settings.ts";
import type { MeetingsSnapshot } from "../lib/meetings/snapshot.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { publishRoutineReaderEdgeOutcome } from "../lib/civic-data/reader-edge-publication.ts";
import { installFactReader } from "../lib/facts/db.ts";
import { partitionSnapshotByScope } from "../lib/meetings/edge-artifacts.ts";

const now = "2026-10-15T00:00:00Z";
const metadata = { sourceThrough: now,retrievedAt: now,promotedThrough: now };
const snapshot = (id: string,state: string,title = id): MeetingsSnapshot => ({ formatVersion: 1,generatedAt: now,
  counts: { fresh: 1,carried: 0,total: 1,duplicatesCollapsed: 0 },sources: [],agendaDocuments: [],
  meetings: [{ id,title,ocdId: `ocd-division/country:us/state:${state.toLowerCase()}/place:fixture`,
    bodyId: `${state}-body`,startsAt: "2026-10-16T12:00:00Z",location: { lat: 32.2,lng: -110.9 } } as Meeting] });

for (const second of [false,true]) test(`state artifact publications stay separate${second ? " after an update" : ""} and IDs select one state`,async () => {
  const root = await mkdtemp(join(tmpdir(),"reader-states-"));
  try {
    const store = new LocalFileArtifactStore(root);
    const az = scopedReaderArtifactStore(store,"AZ"),nj = scopedReaderArtifactStore(store,"NJ");
    assert.equal((await publishReaderEdgeArtifacts(snapshot("az-meeting","AZ"),metadata,{ store: az })).status,"PUBLISHED");
    assert.equal((await publishReaderEdgeArtifacts(snapshot("nj-meeting","NJ"),metadata,{ store: nj })).status,"PUBLISHED");
    const before = await store.readManifest("NJ");
    if (second) assert.equal((await publishReaderEdgeArtifacts(snapshot("az-meeting","AZ","Changed agenda"),metadata,{ store: az })).status,"PUBLISHED");
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
    await publishReaderEdgeArtifacts(snapshot("local","AZ"),metadata,{ store: scopedReaderArtifactStore(store,"AZ") });
    const federal = snapshot("federal","US");
    federal.meetings[0] = { ...federal.meetings[0]!,ocdId: "ocd-division/country:us" };
    await publishReaderEdgeArtifacts(federal,metadata,{ store: scopedReaderArtifactStore(store,"US") });
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
    assert.equal((await publishReaderEdgeArtifacts(initial,metadata,{ store,now })).status,"PUBLISHED");
    assert.equal(peak,8);
    assert.deepEqual((await store.readManifest())!.manifest.scopes.map(scope => scope.scope),partitionSnapshotByScope(initial,now).map(scope => scope.scope));
    assert.deepEqual(new Set(indexed),new Set(initial.meetings.map(meeting => meeting.id)));
    indexed.length = 0;
    const changed = { ...initial,meetings: initial.meetings.map(meeting => ({ ...meeting,title: "Posted agenda changed" })) };
    assert.equal((await publishReaderEdgeArtifacts(changed,metadata,{ store,now })).status,"PUBLISHED");
    assert.deepEqual(indexed,[]);
    const before = await store.readManifest();
    refuseIndex = true;
    const added = { ...changed,meetings: [...changed.meetings,{ ...changed.meetings[0]!,id: "new-meeting" }] };
    assert.equal((await publishReaderEdgeArtifacts(added,metadata,{ store,now })).status,"FAILED");
    assert.deepEqual(await store.readManifest(),before);
  } finally { await rm(root,{ recursive: true,force: true }); }
});
