import assert from "node:assert/strict";
import test from "node:test";
import { CivicReadCache } from "../lib/db/civic-read-cache.ts";
import { MemoryEvidenceStore, type EvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { meetingsCandidate } from "../lib/civic-data/candidate-builders.ts";
import { meetingSourceSession, confirmMeetingSource, meetingSourceContentHash, withMeetingSourceProbe } from "../lib/civic-data/meeting-source-probe.ts";
import { meetingSourceContinuationPending } from "../lib/civic-data/meeting-source-progress.ts";
import type { Meeting } from "../lib/sources/types.ts";
import type { AgendaDocument } from "../lib/meetings/agenda-documents.ts";
import { makeIcalSource } from "../lib/sources/ical/index.ts";
import { withVenueEntries } from "../lib/meetings/venue-cache.ts";
import type { SourceHead } from "../lib/civic-data/store.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { MeetingPartitionContract } from "../lib/civic-data/meeting-partitions.ts";
import { FIXTURE_DOOR_ROWS } from "./helpers/meeting-doors-fixture.ts";
import { meetingPartitionForRow } from "../lib/civic-data/meeting-partitions.ts";
import { captureSourceAcquisitions } from "../lib/sources/acquisition-trace.ts";
import { reconcileSuccessfulMeetingPartition } from "../scripts/ingest.ts";

const row = FIXTURE_DOOR_ROWS.find(row => row.agendaSourceType === "ICAL")!;
const partition: MeetingPartitionContract = meetingPartitionForRow("ical", row.bodyId);
const calendar = "https://meeting.example.gov/calendar.ics", agenda = "https://meeting.example.gov/agenda.html";
function cache() { const rows = new Map<string,string>(); return new CivicReadCache({ read: async key => rows.get(key) ?? null,
  write: async (key,value) => { rows.set(key,value); } }).jobState(); }

const at = "2026-11-06T12:00:00.000Z";
const feed = (stamp = "20261106T120000Z") => ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:meeting-1",
  "DTSTART:20261114T230000Z", `DTSTAMP:${stamp}`, "SUMMARY:Advisory Budget Committee", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
const report = (ics = feed(), observedAt = at) => withVenueEntries([], () => makeIcalSource([row]).normalizeWithDrops([
  { wiring: row, ics, collectedAt: observedAt, sourceUrl: calendar }], new Date(observedAt)));
const parse = (ics = feed(), observedAt = at) => report(ics, observedAt).meetings;
const document = (): AgendaDocument => ({ id: "agenda-1", meetingId: parse()[0]!.id, ocdId: partition.ocdId,
  documentUrl: agenda, contentHash: "a".repeat(64), retrievedAt: at, contentType: "text/html", text: "Approve the budget",
  extraction: "html", extractionNote: null, sourceUrl: agenda, sourceOrg: "Town Clerk", collectedAt: at, verifiedAt: null });

test("changing export bytes confirm the same parsed meetings and agenda on both next scheduled runs without held payload reads", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(at) });
  const checkpoint = cache(), vault = new MemoryEvidenceStore(), contentHash = meetingSourceContentHash(parse(), [document()]);
  let head: SourceHead | null = null, heldPlan: unknown, calls = 0, confirmations = 0, continued = 0, moved = false;
  const store = Object.assign(new MemoryRoutineDataStore(), {
    readSourceHead: async () => head,
    readCandidate: async () => { assert.fail("an unchanged source must not load the old candidate"); },
    readCandidatePath: async <T>(_id: string, path: readonly string[]) => {
      assert.deepEqual(path, ["normalizedPayload", "sourceProbe"]); return heldPlan as T;
    },
    confirmUnchanged: async (input: Parameters<NonNullable<MemoryRoutineDataStore["confirmUnchanged"]>>[0]) => {
      assert.equal(input.basis, "READ_MODEL_RECOMPUTED"); assert.equal(input.inputDigest, contentHash);
      assert.equal(input.readModelHash, head!.normalizedHash); confirmations++;
      return moved ? { kind: "POINTER_MOVED" as const, detail: "changed concurrently" } : { kind: "CONFIRMED" as const, versionId: head!.versionId, at: new Date().toISOString() };
    },
  });
  const acquire = async () => {
    const now = new Date().toISOString();
    const session = await meetingSourceSession(partition, "normalization:one", store, now, vault, undefined, undefined, {
      checkpoint, publicationPending: async () => false, fetchImpl: async () => {
        calls++; return new Response(feed(now.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")), { headers: { "set-cookie": "session=private; Secure" } });
      },
    });
    const response = await session.fetch(calendar, { headers: { cookie: "session=private" } });
    return { session, now, hash: meetingSourceContentHash(parse(await response.text(), now), [{ ...document(),
      id: `agenda-${calls}`, contentHash: String(calls).repeat(64), text: " Approve  the\n budget ", retrievedAt: now, collectedAt: now }]) };
  };
  const first = await acquire();
  assert.equal(first.hash, contentHash); assert.equal(first.session.acquisitionComplete, true);
  const candidate = withMeetingSourceProbe(meetingsCandidate({ snapshot: { formatVersion: 1, generatedAt: at,
    counts: { fresh: 1, carried: 0, total: 1 }, sources: [{ source: "ical", ok: true, fetched: 1, normalized: 1 }],
    meetings: parse(), agendaDocuments: [document()] }, partition: { sourceName: "ical", bodyId: partition.bodyId, scope: partition.scope },
    requestedUrl: calendar, finalUrl: calendar, retrievedAt: at }), partition, "normalization:one", [...first.session.responses.values()], true, true, contentHash);
  heldPlan = (candidate.normalizedPayload as { sourceProbe: unknown }).sourceProbe;
  assert.ok(!JSON.stringify(heldPlan).includes("session=private"));
  head = { sourceId: partition.sourceId, recordClass: "MEETING", scope: partition.scope, versionId: candidate.id, lastKnownGoodVersionId: candidate.id,
    rawHash: candidate.retrieval.rawHash, rawHashBasis: "SOURCE_CONTENT_V1", normalizedHash: candidate.normalization.normalizedHash,
    parserVersion: "meetings-composite/2", promotedAt: at, candidateState: "PROMOTED", acquisitionSucceeded: true, imported: false };
  const firstRawHash = [...first.session.responses.values()][0]!.rawHash;
  await first.session.clear();
  let next = first;
  for (let run = 1; run <= 2; run++) {
    t.mock.timers.setTime(Date.parse(at) + run * 3_600_000);
    next = await acquire();
    assert.notEqual([...next.session.responses.values()][0]!.rawHash, firstRawHash);
    const confirmed = await confirmMeetingSource({ store, partition, session: next.session, normalizationInputHash: "normalization:one",
      contentHash: next.hash, complete: true, now: next.now, continueFacts: async () => { continued++; } });
    assert.equal(confirmed?.head.versionId, candidate.id); await next.session.clear();
  }
  assert.equal(calls, 3); assert.equal(confirmations, 2); assert.equal(continued, 2);
  const input = { store, partition, session: next.session, normalizationInputHash: "normalization:one", contentHash,
    complete: true, now: next.now, continueFacts: async () => { assert.fail("refused work cannot confirm facts"); } };
  assert.equal(await confirmMeetingSource({ ...input, complete: false }), null);
  assert.equal(await confirmMeetingSource({ ...input, contentHash: "c".repeat(64) }), null);
  for (const change of [{ imported: true }, { acquisitionSucceeded: false }, { acquisitionComplete: false },
    { lastKnownGoodVersionId: "other" }, { parserVersion: "new-parser" }, { sourceId: "other" }, { scope: "other" }, { recordClass: "VOTING_SITE" }] as Partial<SourceHead>[]) {
    assert.equal(await confirmMeetingSource({ ...input, session: { ...next.session, head: { ...head, ...change } } }), null, JSON.stringify(change));
  }
  const validPlan = heldPlan;
  for (const change of [{ formatVersion: 1 }, { complete: false }, { normalizationInputHash: "new-input" }, { contentHash: "d".repeat(64) }]) {
    heldPlan = { ...validPlan as object, ...change }; assert.equal(await confirmMeetingSource(input), null);
  }
  const series = feed().replace("DTSTART:20261114T230000Z", "DTSTART;TZID=America/New_York:20261114T180000\r\nRRULE:FREQ=WEEKLY;BYDAY=SA;COUNT=1");
  const before = report(series), after = report(series.replace("END:VEVENT", "RDATE;TZID=America/New_York:20261107T180000\r\nEXDATE;TZID=America/New_York:20261107T180000\r\nEND:VEVENT"));
  assert.deepEqual(before.meetings, after.meetings, "an explicit cancellation can leave the fresh list identical");
  const sourceHash = (value: typeof before) => meetingSourceContentHash(value.meetings, [], [[partition.meetingSource, value.recurrence ?? null, null]]);
  heldPlan = { ...validPlan as object, contentHash: sourceHash(before) };
  assert.equal(await confirmMeetingSource({ ...input, contentHash: sourceHash(after) }), null, "the changed exclusion must reach reconciliation");
  const canceled = { ...before.meetings[0]!, id: after.recurrence!.exclusions[0]!.meetingId, startsAt: "2026-11-07T23:00:00.000Z" };
  const rebuilt = reconcileSuccessfulMeetingPartition({ sourceName: "ical", generatedAt: at, freshMeetings: after.meetings, freshAgendaDocuments: [], publisherExclusions: after.recurrence!.exclusions,
    previous: { formatVersion: 1, generatedAt: at, counts: { fresh: 1, carried: 1, total: 2 }, sources: [], meetings: [...before.meetings, canceled], agendaDocuments: [] } });
  assert.deepEqual(rebuilt.meetings.map(meeting => meeting.id), before.meetings.map(meeting => meeting.id), "the canceled carried sitting leaves the reader's calendar");
  assert.equal(confirmations, 2); heldPlan = validPlan; moved = true;
  assert.equal(await confirmMeetingSource(input), null, "the pointer compare-and-set owns a concurrent change");
});

test("the meeting fingerprint retains every changed fact and independently changed agenda", () => {
  const meetings = parse(), original = meetings[0]!, doc = document(), hash = meetingSourceContentHash(meetings, [doc]);
  for (const change of [{ title: "Advisory Budget Committee Hearing" }, { startsAt: "2026-11-15T00:00:00.000Z" },
    { status: "CANCELED" }, { timeZone: "America/Phoenix" }, { location: { name: "Town Hall", address: "1 Main Street", lat: 43, lng: -72 } },
    { agendaUrl: `${agenda}?revised` }, { online: { label: "Zoom", joinUrl: "https://zoom.us/new" } },
    { videoUrl: "https://meeting.example.gov/video" }] as Partial<Meeting>[]) {
    assert.notEqual(meetingSourceContentHash([{ ...original, ...change }], [doc]), hash, JSON.stringify(change));
  }
  assert.notEqual(meetingSourceContentHash([], [doc]), hash, "removed meetings are a change");
  assert.notEqual(meetingSourceContentHash(meetings, [{ ...doc, text: "Reject the budget" }]), hash);
  assert.notEqual(meetingSourceContentHash(meetings, [{ ...doc, documentUrl: `${agenda}?revised` }]), hash);
  assert.notEqual(meetingSourceContentHash(meetings, [{ ...doc, text: null, extraction: "failed" }]), hash);
  const second = { ...original, id: `${original.id}-2` };
  assert.equal(meetingSourceContentHash([original, second], [doc]), meetingSourceContentHash([second, original], [doc]));
});

test("a deadline resumes saved source evidence without tracing internal HTTP and preserves unfinished publication", async t => {
  const checkpoint = cache(), saved = new MemoryEvidenceStore(), now = new Date().toISOString(), previous = process.env.WTP_PASS_DEADLINE_AT;
  let calls = 0, pending = false, internalReads = 0;
  const internalUrl = "https://storage.example.net/evidence", io = async () => { await fetch(internalUrl); };
  t.mock.method(globalThis, "fetch", async (resource: RequestInfo | URL) => { assert.equal(String(resource), internalUrl); internalReads++; return new Response("internal copy"); });
  const vault: EvidenceStore = { put: async (key, bytes, meta) => { await io(); await saved.put(key, bytes, meta); },
    get: async key => { await io(); return saved.get(key); }, head: async key => { await io(); return saved.head(key); }, list: prefix => saved.list(prefix) };
  const fetchImpl: typeof fetch = async () => { calls++; return new Response("Held source bytes", { headers: { "content-type": "text/plain" } }); };
  const store = { async readSourceHead() { return null; } };
  try {
    delete process.env.WTP_PASS_DEADLINE_AT;
    const first = await meetingSourceSession(partition, "normalization:resume", store, now, vault, undefined, undefined, { checkpoint, fetchImpl, publicationPending:async()=>pending });
    await first.fetch(calendar);
    const observedAt = [...first.responses.values()][0]!.retrievedAt;
    process.env.WTP_PASS_DEADLINE_AT = new Date(Date.now() + 44_000).toISOString();
    await assert.rejects(first.fetch(agenda), /MEETING_SOURCE_CONTINUATION_PENDING/);
    assert.equal(await meetingSourceContinuationPending(partition.scope, checkpoint, null), true);
    delete process.env.WTP_PASS_DEADLINE_AT;
    const next = await meetingSourceSession(partition, "normalization:resume", store, now, vault, undefined, undefined, { checkpoint, fetchImpl, publicationPending:async()=>pending });
    const replay=await captureSourceAcquisitions(run=>run("ical",()=>next.fetch(calendar)));
    assert.ok(internalReads > 0); assert.deepEqual(replay.evidence.map(page => page.requestedUrl), [calendar], "only the resumed public provider is traced");
    await next.fetch(agenda);
    assert.equal(calls, 2, "the completed calendar is not fetched again during a continuation");
    assert.equal([...next.responses.values()][0]!.retrievedAt, observedAt);
    pending=true; await next.clear();
    assert.equal(await meetingSourceContinuationPending(partition.scope, checkpoint, null), true, "later source saves and cleanup preserve unfinished field publication");
    pending=false; await next.clear();
    assert.equal(await meetingSourceContinuationPending(partition.scope, checkpoint, null), false);
  } finally {
    if (previous === undefined) delete process.env.WTP_PASS_DEADLINE_AT; else process.env.WTP_PASS_DEADLINE_AT = previous;
  }
});
