import assert from "node:assert/strict";
import test from "node:test";
import { CivicReadCache } from "../lib/db/civic-read-cache.ts";
import { MemoryEvidenceStore, type EvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { meetingsCandidate } from "../lib/civic-data/candidate-builders.ts";
import { meetingSourceSession, probeMeetingSource, confirmAcquiredMeetingSource, withMeetingSourceProbe } from "../lib/civic-data/meeting-source-probe.ts";
import { meetingSourceContinuationPending } from "../lib/civic-data/meeting-source-progress.ts";
import type { SourceHead } from "../lib/civic-data/store.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { MeetingPartitionContract } from "../lib/civic-data/meeting-partitions.ts";
import { FIXTURE_DOOR_ROWS } from "./helpers/meeting-doors-fixture.ts";
import { meetingPartitionForRow } from "../lib/civic-data/meeting-partitions.ts";
import { captureSourceAcquisitions } from "../lib/sources/acquisition-trace.ts";
import { withFetch } from "./helpers/with-fetch.ts";

const row = FIXTURE_DOOR_ROWS.find(row => row.agendaSourceType === "ICAL")!;
const partition: MeetingPartitionContract = meetingPartitionForRow("ical", row.bodyId);
const calendar = "https://meeting.example.gov/calendar.ics", agenda = "https://meeting.example.gov/agenda.html";
function cache() { const rows = new Map<string,string>(); return new CivicReadCache({ read: async key => rows.get(key) ?? null,
  write: async (key,value) => { rows.set(key,value); } }).jobState(); }

test("meeting hash comparison includes independently changing agendas before any held snapshot is read", async () => {
  const checkpoint = cache(), vault = new MemoryEvidenceStore(), now = new Date().toISOString();
  let head: SourceHead | null = null, heldPlan: unknown = null, agendaBody = "Agenda one", calls = 0, confirmations = 0;
  const fetchImpl: typeof fetch = async resource => { calls++; return new Response(String(resource) === agenda ? agendaBody : "Calendar", { headers: { "content-type": "text/plain" } }); };
  const store = Object.assign(new MemoryRoutineDataStore(), { async readSourceHead() { return head; }, async readCandidatePath<T>(_id: string, path: readonly string[]) {
    assert.deepEqual(path, ["normalizedPayload", "sourceProbe"]); return heldPlan as T;
  }, async confirmUnchanged() { confirmations++; return { kind: "CONFIRMED" as const, versionId: head!.versionId, at: now }; } });
  const first = await meetingSourceSession(partition, "normalization:one", store, now, vault, undefined, undefined, { checkpoint, fetchImpl, publicationPending:async()=>false });
  await first.fetch(calendar); await first.fetch(agenda);
  const candidate = withMeetingSourceProbe(meetingsCandidate({ snapshot: { formatVersion: 1, generatedAt: now, counts: { fresh: 0, carried: 0, total: 0 },
    sources: [{ source: "ical", ok: true, fetched: 0, normalized: 0 }], meetings: [], agendaDocuments: [] },
    partition: { sourceName: "ical", bodyId: partition.bodyId, scope: partition.scope }, requestedUrl: calendar, finalUrl: calendar, retrievedAt: now }),
    partition, "normalization:one", [...first.responses.values()], true);
  heldPlan = (candidate.normalizedPayload as { sourceProbe: unknown }).sourceProbe;
  head = { sourceId: partition.sourceId, recordClass: "MEETING", scope: partition.scope, versionId: candidate.id, lastKnownGoodVersionId: candidate.id,
    rawHash: candidate.retrieval.rawHash, rawHashBasis: "SOURCE_CONTENT_V1", normalizedHash: candidate.normalization.normalizedHash,
    parserVersion: "meetings-composite/2", promotedAt: now, candidateState: "PROMOTED", acquisitionSucceeded: true, imported: false };
  await first.clear();
  let owed = 0; const probe = async () => {
    const session = await meetingSourceSession(partition, "normalization:one", store, now, vault, undefined, undefined, { checkpoint, fetchImpl, publicationPending:async()=>false });
    const result = await probeMeetingSource({ store, partition, session, normalizationInputHash: "normalization:one", now, continueFacts: async () => { owed++; return true; } });
    await session.clear(); return result;
  };
  assert.ok(await probe(), "owed facts continue on the confirmed version"); assert.equal(calls, 4); assert.equal(confirmations, 1); assert.equal(owed, 1);
  agendaBody = "Agenda two";
  assert.equal(await probe(), null, "an unchanged calendar cannot hide a changed agenda");
  assert.equal(confirmations, 1);
});

test("a deadline resumes completed page hashes from the ordinary vault and preserves their provider observation", async () => {
  const checkpoint = cache(), vault = new MemoryEvidenceStore(), now = new Date().toISOString(), previous = process.env.WTP_PASS_DEADLINE_AT;
  let calls = 0;
  const fetchImpl: typeof fetch = async () => { calls++; return new Response("Held source bytes", { headers: { "content-type": "text/plain" } }); };
  const store = { async readSourceHead() { return null; } };
  try {
    delete process.env.WTP_PASS_DEADLINE_AT;
    const first = await meetingSourceSession(partition, "normalization:resume", store, now, vault, undefined, undefined, { checkpoint, fetchImpl, publicationPending:async()=>false });
    await first.fetch(calendar);
    const observedAt = [...first.responses.values()][0]!.retrievedAt;
    process.env.WTP_PASS_DEADLINE_AT = new Date(Date.now() + 44_000).toISOString();
    await assert.rejects(first.fetch(agenda), /MEETING_SOURCE_CONTINUATION_PENDING/);
    assert.equal(await meetingSourceContinuationPending(partition.scope, checkpoint, null), true);
    delete process.env.WTP_PASS_DEADLINE_AT;
    const next = await meetingSourceSession(partition, "normalization:resume", store, now, vault, undefined, undefined, { checkpoint, fetchImpl, publicationPending:async()=>false });
    const replay=await captureSourceAcquisitions(run=>run("ical",()=>next.fetch(calendar)));
    assert.equal(replay.evidence.length,1,"a resumed adapter still has exact acquired-byte authority");
    await next.fetch(agenda);
    assert.equal(calls, 2, "the completed calendar is not fetched again during a continuation");
    assert.equal([...next.responses.values()][0]!.retrievedAt, observedAt);
    await next.clear();
    assert.equal(await meetingSourceContinuationPending(partition.scope, checkpoint, null), false);
  } finally {
    if (previous === undefined) delete process.env.WTP_PASS_DEADLINE_AT; else process.env.WTP_PASS_DEADLINE_AT = previous;
  }
});

test("later page saves and source cleanup cannot erase unfinished field publication",async()=>{
  const checkpoint=cache(),vault=new MemoryEvidenceStore(),now=new Date().toISOString();
  let pending=true;
  const session=await meetingSourceSession(partition,"pending-fields",{readSourceHead:async()=>null},now,vault,undefined,undefined,
    {checkpoint,fetchImpl:async()=>new Response("Source bytes"),publicationPending:async()=>pending});
  await session.fetch(calendar);await session.defer();await session.fetch(agenda);await session.clear();
  assert.equal(await meetingSourceContinuationPending(partition.scope,checkpoint,null),true);
  pending=false;await session.clear();
  assert.equal(await meetingSourceContinuationPending(partition.scope,checkpoint,null),false);
});

test("internal evidence HTTP copies do not become off-host adapter acquisitions",async()=>{
  const saved=new MemoryEvidenceStore(),checkpoint=cache(),internalUrl="https://storage.example.net/evidence";
  let internalReads=0;
  const io=async()=>{await fetch(internalUrl);};
  const vault:EvidenceStore={
    put:async(key,bytes,meta)=>{await io();await saved.put(key,bytes,meta);},
    get:async key=>{await io();return saved.get(key);},head:async key=>{await io();return saved.head(key);},list:async prefix=>saved.list(prefix),
  };
  await withFetch(async(resource:RequestInfo|URL)=>{assert.equal(String(resource),internalUrl);internalReads++;return new Response("internal copy");},async()=>{
    const session=await meetingSourceSession(partition,"internal-io",{readSourceHead:async()=>null},new Date().toISOString(),vault,undefined,undefined,
      {checkpoint,fetchImpl:async()=>new Response("public calendar"),publicationPending:async()=>false});
    const trace=await captureSourceAcquisitions(run=>run("ical",()=>session.fetch(calendar)));
    assert.ok(internalReads>0,"the vault really used HTTP while an adapter was in scope");
    assert.deepEqual(trace.evidence.map(page=>page.requestedUrl),[calendar],"only the actual public provider belongs to its acquisition evidence");
  });
});

test("an ephemeral calendar session compares acquired hashes before held output without saving cookies", async () => {
  const checkpoint = cache(), vault = new MemoryEvidenceStore(), now = new Date().toISOString(), eventList = "https://meeting.example.gov/event-list";
  let head: SourceHead | null = null, plan: unknown = null, calls = 0, confirmations = 0;
  const fetchImpl: typeof fetch = async (resource, init) => {
    calls++;
    if (String(resource) === calendar) return new Response("Calendar session page", { headers: { "content-type": "text/html", "set-cookie": "session=private; Secure" } });
    assert.equal(new Headers(init?.headers).get("cookie"), "session=private");
    return new Response("Council events", { headers: { "content-type": "text/html" } });
  };
  const store = Object.assign(new MemoryRoutineDataStore(), { async readSourceHead() { return head; }, async readCandidatePath<T>(_id: string, path: readonly string[]) {
    assert.deepEqual(path, ["normalizedPayload", "sourceProbe"]); return plan as T;
  }, async confirmUnchanged() { confirmations++; return { kind: "CONFIRMED" as const, versionId: head!.versionId, at: now }; } });
  const acquire = async () => {
    const session = await meetingSourceSession(partition, "session-input", store, now, vault, undefined, undefined, { checkpoint, fetchImpl, publicationPending:async()=>false });
    await session.fetch(calendar);
    await session.fetch(eventList, { method: "POST", body: "body=one", headers: { cookie: "session=private", "content-type": "application/x-www-form-urlencoded" } });
    assert.equal(session.complete, false); assert.equal(session.acquisitionComplete, true);
    return session;
  };
  const first = await acquire();
  const candidate = withMeetingSourceProbe(meetingsCandidate({ snapshot: { formatVersion: 1, generatedAt: now, counts: { fresh: 0, carried: 0, total: 0 },
    sources: [{ source: "ical", ok: true, fetched: 0, normalized: 0 }], meetings: [], agendaDocuments: [] },
    partition: { sourceName: "ical", bodyId: partition.bodyId, scope: partition.scope }, requestedUrl: calendar, finalUrl: calendar, retrievedAt: now }),
    partition, "session-input", [...first.responses.values()], false, true);
  plan = (candidate.normalizedPayload as {sourceProbe:unknown}).sourceProbe;
  assert.ok(!JSON.stringify(plan).includes("session=private"), "the saved input set contains no cookie or session POST body");
  head = { sourceId: partition.sourceId, recordClass: "MEETING", scope: partition.scope, versionId: candidate.id, lastKnownGoodVersionId: candidate.id,
    rawHash: candidate.retrieval.rawHash, rawHashBasis: "SOURCE_CONTENT_V1", normalizedHash: candidate.normalization.normalizedHash,
    parserVersion: "meetings-composite/2", promotedAt: now, candidateState: "PROMOTED", acquisitionSucceeded: true, imported: false };
  await first.clear();
  const next = await acquire();
  assert.ok(await confirmAcquiredMeetingSource({ store, partition, session: next, normalizationInputHash: "session-input", now, continueFacts: async () => true }), "owed facts do not republish an unchanged source");
  assert.equal(confirmations, 1); assert.equal(calls, 4, "each pass acquires its own session before comparing source content");
});


test("hash-matched source bytes remain available to repair the accepted candidate's unfinished fact evidence",async()=>{
  const checkpoint=cache(),vault=new MemoryEvidenceStore(),now=new Date().toISOString();let pending=true;
  const session=await meetingSourceSession(partition,"retained-field-evidence",{readSourceHead:async()=>null},now,vault,async()=>{},undefined,
    {checkpoint,fetchImpl:async()=>new Response("Exact official source bytes"),publicationPending:async()=>pending});
  await session.fetch(calendar);
  const page=[...session.responses.values()][0]!;
  const plan={formatVersion:1 as const,complete:true,normalizationInputHash:"retained-field-evidence",sourceRawHash:page.rawHash,sourceHashKind:"REQUESTS" as const,
    requests:[{requestedUrl:page.requestedUrl,finalUrl:page.finalUrl,rawHash:page.rawHash}],meetingIds:[],bodyIds:[partition.bodyId]};
  assert.equal(await session.probe(plan),true);
  assert.ok([...session.responses.values()][0]!.bytes.length>0,"an unchanged source can repair staged evidence without loading the held body snapshot");
  pending=false;assert.equal(await session.probe(plan),true);
  assert.equal([...session.responses.values()][0]!.bytes.length,0,"completed hash-only passes release their source buffers");
});
