import assert from "node:assert/strict";
import test from "node:test";
import { CivicReadCache } from "../lib/db/civic-read-cache.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { meetingsCandidate } from "../lib/civic-data/candidate-builders.ts";
import { meetingSourceSession, probeMeetingSource, withMeetingSourceProbe, meetingSourceContinuationPending } from "../lib/civic-data/meeting-source-probe.ts";
import type { RoutineDataStore, SourceHead } from "../lib/civic-data/store.ts";
import type { MeetingPartitionContract } from "../lib/civic-data/meeting-partitions.ts";
import { FIXTURE_DOOR_ROWS } from "./helpers/meeting-doors-fixture.ts";
import { meetingPartitionForRow } from "../lib/civic-data/meeting-partitions.ts";

const row = FIXTURE_DOOR_ROWS.find(row => row.agendaSourceType === "ICAL")!;
const partition: MeetingPartitionContract = meetingPartitionForRow("ical", row.bodyId);
const calendar = "https://meeting.example.gov/calendar.ics", agenda = "https://meeting.example.gov/agenda.html";
function cache() { const rows = new Map<string,string>(); return new CivicReadCache({ read: async key => rows.get(key) ?? null,
  write: async (key,value) => { rows.set(key,value); } }).jobState(); }

test("meeting hash comparison includes independently changing agendas before any held snapshot is read", async () => {
  const checkpoint = cache(), vault = new MemoryEvidenceStore(), now = new Date().toISOString();
  let head: SourceHead | null = null, heldPlan: unknown = null, agendaBody = "Agenda one", calls = 0, confirmations = 0;
  const fetchImpl: typeof fetch = async resource => { calls++; return new Response(String(resource) === agenda ? agendaBody : "Calendar", { headers: { "content-type": "text/plain" } }); };
  const store = { async readSourceHead() { return head; }, async readCandidatePath<T>(_id: string, path: readonly string[]) {
    assert.deepEqual(path, ["normalizedPayload", "sourceProbe"]); return heldPlan as T;
  }, async confirmUnchanged() { confirmations++; return { kind: "CONFIRMED" as const, versionId: head!.versionId, at: now }; } } as RoutineDataStore;
  const first = await meetingSourceSession(partition, "normalization:one", store, now, vault, undefined, undefined, { checkpoint, fetchImpl });
  await first.fetch(calendar); await first.fetch(agenda);
  const candidate = withMeetingSourceProbe(meetingsCandidate({ snapshot: { formatVersion: 1, generatedAt: now, counts: { fresh: 0, carried: 0, total: 0 },
    sources: [{ source: "ical", ok: true, error: null, fetched: 0, normalized: 0, drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 } }], meetings: [], agendaDocuments: [] },
    partition: { sourceName: "ical", bodyId: partition.bodyId, scope: partition.scope }, requestedUrl: calendar, finalUrl: calendar, retrievedAt: now }),
    partition, "normalization:one", [...first.responses.values()], true);
  heldPlan = (candidate.normalizedPayload as { sourceProbe: unknown }).sourceProbe;
  head = { sourceId: partition.sourceId, recordClass: "MEETING", scope: partition.scope, versionId: candidate.id, lastKnownGoodVersionId: candidate.id,
    rawHash: candidate.retrieval.rawHash, rawHashBasis: "SOURCE_CONTENT_V1", normalizedHash: candidate.normalization.normalizedHash,
    parserVersion: "meetings-composite/2", promotedAt: now, candidateState: "PROMOTED", acquisitionSucceeded: true, imported: false };
  await first.clear();
  const probe = async () => {
    const session = await meetingSourceSession(partition, "normalization:one", store, now, vault, undefined, undefined, { checkpoint, fetchImpl });
    const result = await probeMeetingSource({ store, partition, session, normalizationInputHash: "normalization:one", now, workRemains: async () => false });
    await session.clear(); return result;
  };
  assert.ok(await probe()); assert.equal(calls, 4); assert.equal(confirmations, 1);
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
    const first = await meetingSourceSession(partition, "normalization:resume", store, now, vault, undefined, undefined, { checkpoint, fetchImpl });
    await first.fetch(calendar);
    const observedAt = [...first.responses.values()][0]!.retrievedAt;
    process.env.WTP_PASS_DEADLINE_AT = new Date(Date.now() + 44_000).toISOString();
    await assert.rejects(first.fetch(agenda), /MEETING_SOURCE_CONTINUATION_PENDING/);
    assert.equal(await meetingSourceContinuationPending(partition.scope, checkpoint), true);
    delete process.env.WTP_PASS_DEADLINE_AT;
    const next = await meetingSourceSession(partition, "normalization:resume", store, now, vault, undefined, undefined, { checkpoint, fetchImpl });
    await next.fetch(calendar); await next.fetch(agenda);
    assert.equal(calls, 2, "the completed calendar is not fetched again during a continuation");
    assert.equal([...next.responses.values()][0]!.retrievedAt, observedAt);
    await next.clear();
    assert.equal(await meetingSourceContinuationPending(partition.scope, checkpoint), false);
  } finally {
    if (previous === undefined) delete process.env.WTP_PASS_DEADLINE_AT; else process.env.WTP_PASS_DEADLINE_AT = previous;
  }
});
