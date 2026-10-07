import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  agendaDocumentRecordKey,
  candidateChangeSet,
  civicRecordsFor,
  ROW_KEYED_CIVIC_CHANGE_CONTRACT,
  rowKeyedCivicRecordsFor,
} from "../lib/civic-data/changes.ts";
import { MEETING_PARTITION_CONTRACTS, type MeetingPartitionContract } from "../lib/civic-data/meeting-partitions.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";
import { AgendaDocumentStore, type AgendaDocument } from "../lib/meetings/agenda-documents.ts";
import type { MeetingsSnapshot } from "../lib/meetings/snapshot.ts";
import type { ChildRunReport } from "../lib/sources/composite/index.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { promoteMeetingPartitions, reconcileSuccessfulMeetingPartition } from "../scripts/ingest.ts";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const partitionFor = (fragment: string): MeetingPartitionContract => {
  const partition = MEETING_PARTITION_CONTRACTS.find((row) => row.bodyId.includes(fragment));
  assert.ok(partition, fragment);
  return partition;
};
const ROCKAWAY_BOA = partitionFor("rockaway_township#board-of-adjustment");
const TUSD = partitionFor("tucson_unified_district#board");

function routeOf(partition: MeetingPartitionContract): string {
  const url = partition.wiring!.config.icalUrl ?? partition.wiring!.config.serviceBase;
  assert.ok(url, partition.id);
  return url;
}

/** One successful fetch. The feed's bytes differ on every read, exactly as production observed. */
function report(partition: MeetingPartitionContract, fetchedAt: string, rows: number): ChildRunReport {
  const bytes = `${partition.id} response read at ${fetchedAt}`;
  return {
    source: partition.meetingSource,
    ok: true,
    error: null,
    fetched: rows,
    normalized: rows,
    drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
    acquisitions: [{
      source: partition.meetingSource,
      requestedUrl: routeOf(partition),
      finalUrl: routeOf(partition),
      httpStatus: 200,
      rawHash: sha256(bytes),
      byteCount: Buffer.byteLength(bytes),
    }],
  };
}

function sitting(partition: MeetingPartitionContract, nativeId: string, collectedAt: string, over: Partial<Meeting> = {}): Meeting {
  return {
    id: `${partition.meetingSource}:${nativeId}`,
    ocdId: partition.ocdId,
    bodyId: partition.bodyId,
    bodyName: partition.wiring!.config.bodyName ?? partition.wiring!.publishingOrg,
    title: `${partition.wiring!.config.bodyName ?? partition.wiring!.publishingOrg} Meeting`,
    startsAt: "2026-10-07T23:30:00.000Z",
    timeZone: partition.wiring!.timeZone,
    location: { name: "Municipal Building", address: "65 Mount Hope Road, Rockaway, NJ 07866", lat: 40.93, lng: -74.51 },
    agendaUrl: null,
    jurisdiction: partition.wiring!.jurisdiction,
    status: "SCHEDULED",
    provenance: {
      sourceUrl: `${routeOf(partition)}#${nativeId}`,
      sourceOrg: partition.wiring!.publishingOrg,
      collectedAt,
      verifiedAt: null,
    },
    ...over,
  };
}

function agendaRow(meeting: Meeting, retrievedAt: string, text: string, bytes: string): AgendaDocument {
  const contentHash = sha256(bytes);
  return {
    id: `${meeting.id}@${contentHash}`,
    meetingId: meeting.id,
    ocdId: meeting.ocdId,
    documentUrl: "https://tusd1-schooldesk.community.diligentoneplatform.com/Portal/MeetingInformation.aspx?Org=Cal&Id=499",
    contentHash,
    retrievedAt,
    contentType: "text/html",
    text,
    extraction: "html",
    extractionNote: null,
    sourceUrl: "https://tusd1-schooldesk.community.diligentoneplatform.com/Portal/MeetingInformation.aspx?Org=Cal&Id=499",
    sourceOrg: "Tucson Unified School District",
    collectedAt: retrievedAt,
    verifiedAt: null,
  };
}

async function fetchAndPromote(
  store: MemoryRoutineDataStore,
  partition: MeetingPartitionContract,
  generatedAt: string,
  meetings: readonly Meeting[],
  agendaDocuments: MeetingsSnapshot["agendaDocuments"] = [],
) {
  const [result] = await promoteMeetingPartitions({
    store,
    partitions: [partition],
    meetings,
    agendaDocuments,
    reports: [report(partition, generatedAt, meetings.length)],
    generatedAt,
  });
  assert.ok(result);
  return result;
}

test("Rockaway: a fetch differing only in stamps, raw hashes and collectedAt is a validated no-change", async () => {
  const store = new MemoryRoutineDataStore();
  const first = "2026-09-22T21:15:40.000Z";
  const second = "2026-09-22T22:15:52.000Z";
  const rows = (collectedAt: string) => [
    sitting(ROCKAWAY_BOA, "rockaway-boa:2026-10-07", collectedAt),
    sitting(ROCKAWAY_BOA, "rockaway-boa:2026-11-04", collectedAt, { startsAt: "2026-11-04T23:30:00.000Z" }),
  ];
  const seeded = await fetchAndPromote(store, ROCKAWAY_BOA, first, rows(first));
  assert.equal(seeded.outcome.candidate.state, "PROMOTED", seeded.outcome.candidate.failureDetail ?? "");
  assert.equal(seeded.outcome.candidate.candidate.changeSet?.outcome, "CHANGED");

  const refetched = await fetchAndPromote(store, ROCKAWAY_BOA, second, rows(second));
  const before = seeded.outcome.candidate.candidate;
  // The re-check is confirmed on the pointed version rather than stored.
  assert.ok(refetched.outcome.confirmed, "a validated no-change is confirmed, not republished");
  const after = refetched.outcome.confirmed.recheck;
  // Everything volatile moved...
  assert.notEqual(after.temporal.version, before.temporal.version);
  assert.notEqual(after.temporal.sourceThrough, before.temporal.sourceThrough);
  assert.notEqual(after.retrieval.rawHash, before.retrieval.rawHash);
  assert.notEqual(after.normalization.normalizedHash, before.normalization.normalizedHash);
  assert.notEqual(after.normalization.normalizedPayloadHash, before.normalization.normalizedPayloadHash);
  assert.notEqual((after.readModel as MeetingsSnapshot).generatedAt, (before.readModel as MeetingsSnapshot).generatedAt);
  // ...and none of it is a fact, so the delta is a validated no-change.
  assert.equal(after.changeSet?.outcome, "UNCHANGED");
  assert.deepEqual(after.changeSet?.added, []);
  assert.deepEqual(after.changeSet?.changed, []);
  assert.deepEqual(after.changeSet?.removed, []);
  // The stamps stay on the stored record as provenance.
  assert.ok((after.readModel as MeetingsSnapshot).meetings.every((meeting) => meeting.provenance.collectedAt === second));
  // Readers keep the pointed version; the confirmation records the re-check.
  assert.equal(refetched.outcome.candidate.candidate.id, before.id);
  assert.equal(refetched.outcome.promoted?.versionId, before.id);
  assert.equal(await store.readCandidate(after.id), null);
});

test("a real fact change is still a change, and only the record whose facts moved is changed", async () => {
  const store = new MemoryRoutineDataStore();
  const first = "2026-09-22T21:15:40.000Z";
  const second = "2026-09-22T22:15:52.000Z";
  const moved = "rockaway-boa:2026-10-07";
  const still = "rockaway-boa:2026-11-04";
  await fetchAndPromote(store, ROCKAWAY_BOA, first, [
    sitting(ROCKAWAY_BOA, moved, first),
    sitting(ROCKAWAY_BOA, still, first, { startsAt: "2026-11-04T23:30:00.000Z" }),
  ]);
  const rescheduled = await fetchAndPromote(store, ROCKAWAY_BOA, second, [
    sitting(ROCKAWAY_BOA, moved, second, { startsAt: "2026-10-08T23:30:00.000Z", status: "SCHEDULED" }),
    sitting(ROCKAWAY_BOA, still, second, { startsAt: "2026-11-04T23:30:00.000Z" }),
  ]);
  const changeSet = rescheduled.outcome.candidate.candidate.changeSet;
  assert.equal(changeSet?.outcome, "CHANGED");
  assert.deepEqual(changeSet?.changed.map(({ key }) => key), [`meeting:civicplus:${moved}`]);
  assert.deepEqual(changeSet?.added, []);
  assert.deepEqual(changeSet?.removed, []);
  const [delta] = changeSet!.changed;
  assert.equal((delta!.before as Meeting).startsAt, "2026-10-07T23:30:00.000Z");
  assert.equal((delta!.after as Meeting).startsAt, "2026-10-08T23:30:00.000Z");
  assert.equal((delta!.after as Meeting).provenance.collectedAt, second, "the persisted delta keeps its provenance");
});

test("Tucson Unified: the sitting's agenda is one record; re-fetches are no change and a revision is one CHANGE of that key", async () => {
  const store = new MemoryRoutineDataStore();
  const t1 = "2026-09-19T00:05:00.000Z";
  const t2 = "2026-09-19T01:05:00.000Z";
  const t3 = "2026-09-19T02:05:00.000Z";
  const shell = "Skip Navigation Jump to SideBar Tucson Unified School District";
  const meeting = (at: string) => sitting(TUSD, "tusd1:499", at, { location: null, online: { label: "Livestream", joinUrl: null } });
  const d1 = agendaRow(meeting(t1), t1, shell, "bytes of read one");
  // What the byte-hash store appended for the next read: same words, new bytes, new row id.
  const d2 = agendaRow(meeting(t2), t2, shell, "bytes of read two");
  const d3 = agendaRow(meeting(t3), t3, "1. Call to order. 2. Approval of the budget. 3. Adjournment.", "bytes of read three");
  const key = agendaDocumentRecordKey({ meetingId: "diligent:tusd1:499" });

  const seeded = await fetchAndPromote(store, TUSD, t1, [meeting(t1)], [d1]);
  assert.equal(seeded.outcome.candidate.state, "PROMOTED", seeded.outcome.candidate.failureDetail ?? "");
  assert.ok(seeded.outcome.candidate.candidate.changeSet?.added.some((delta) => delta.key === key));

  const refetched = await fetchAndPromote(store, TUSD, t2, [meeting(t2)], [d1, d2]);
  // Same words, new bytes: a validated no-change, so readers keep the one agenda row they had.
  assert.ok(refetched.outcome.confirmed, refetched.outcome.candidate.failureDetail ?? "");
  assert.equal(refetched.outcome.confirmed.recheck.changeSet?.outcome, "UNCHANGED");
  assert.equal((refetched.outcome.confirmed.recheck.readModel as MeetingsSnapshot).agendaDocuments.length, 2, "the re-check saw every stored row");
  assert.equal((refetched.outcome.promoted?.payload as MeetingsSnapshot).agendaDocuments.length, 1, "readers keep the version they had");

  const revised = await fetchAndPromote(store, TUSD, t3, [meeting(t3)], [d1, d2, d3]);
  const changeSet = revised.outcome.candidate.candidate.changeSet;
  assert.equal(changeSet?.outcome, "CHANGED");
  assert.deepEqual(changeSet?.changed.map((delta) => delta.key), [key]);
  assert.deepEqual(changeSet?.added, [], "a revision is never an add");
  assert.deepEqual(changeSet?.removed, [], "a revision is never a remove");
  const versions = (value: unknown) => (value as { versions: AgendaDocument[] }).versions.map((row) => row.id);
  assert.deepEqual(versions(changeSet!.changed[0]!.before), [d1.id]);
  assert.deepEqual(versions(changeSet!.changed[0]!.after), [d1.id, d3.id]);
});

test("the ingest store appends a new version only when the content changed", () => {
  const store = new AgendaDocumentStore();
  const meeting = sitting(TUSD, "tusd1:500", "2026-09-19T00:00:00.000Z");
  const shell = "Skip Navigation Jump to SideBar Tucson Unified School District";
  assert.deepEqual(store.append(agendaRow(meeting, "2026-09-19T00:05:00.000Z", shell, "a")), { stored: true, revised: false });
  assert.deepEqual(store.append(agendaRow(meeting, "2026-09-19T01:05:00.000Z", `${shell}\n`, "b")), { stored: false, revised: false },
    "same words, new bytes: a re-read, not a version");
  assert.deepEqual(store.append(agendaRow(meeting, "2026-09-19T02:05:00.000Z", "1. Call to order. 2. Adjournment.", "c")), { stored: true, revised: true });
  const elsewhere = { ...agendaRow(meeting, "2026-09-19T03:05:00.000Z", "1. Call to order. 2. Adjournment.", "d"), documentUrl: "https://govboard.tusd1.org/agenda.pdf" };
  assert.deepEqual(store.append(elsewhere), { stored: true, revised: true }, "the same words at another address are held at that address");
  assert.equal(store.versionsFor(meeting.id).length, 3);
});

test("an aged-out sitting's agenda is removed by exactly one evidence row, however many stored versions it has", async () => {
  const store = new MemoryRoutineDataStore();
  const seedAt = "2026-01-01T12:00:00.000Z";
  const old = sitting(TUSD, "tusd1:400", seedAt, { startsAt: "2025-12-20T17:00:00.000Z" });
  const rows = [
    agendaRow(old, "2025-12-18T10:00:00.000Z", "1. Call to order. 2. Adjournment.", "v1"),
    agendaRow(old, "2025-12-18T11:00:00.000Z", "1. Call to order. 2. Adjournment.", "v1 again"),
    agendaRow(old, "2025-12-19T10:00:00.000Z", "1. Call to order. 2. Budget. 3. Adjournment.", "v2"),
  ];
  const seeded = await fetchAndPromote(store, TUSD, seedAt, [old], rows);
  assert.equal(seeded.outcome.candidate.state, "PROMOTED", seeded.outcome.candidate.failureDetail ?? "");

  const at = "2026-09-08T13:00:00.000Z";
  const fresh = sitting(TUSD, "tusd1:499", at, { startsAt: "2026-09-20T17:00:00.000Z" });
  const previous = seeded.outcome.promoted!.payload as MeetingsSnapshot;
  const reconciliation = reconcileSuccessfulMeetingPartition({
    sourceName: TUSD.meetingSource,
    generatedAt: at,
    freshMeetings: [fresh],
    freshAgendaDocuments: [],
    previous,
  });
  assert.deepEqual(reconciliation.removalEvidence.map(({ key }) => key).sort(), [
    agendaDocumentRecordKey({ meetingId: old.id }),
    `meeting:${old.id}`,
  ].sort());

  const promoted = await fetchAndPromote(store, TUSD, at, [fresh]);
  assert.equal(promoted.outcome.candidate.state, "PROMOTED", promoted.outcome.candidate.failureDetail ?? "");
  assert.deepEqual(promoted.outcome.candidate.candidate.changeSet?.removed.map(({ key }) => key).sort(), [
    agendaDocumentRecordKey({ meetingId: old.id }),
    `meeting:${old.id}`,
  ].sort());
});

test("durable trusted-LKG transfers keep proving against the row-keyed contract they were written under", () => {
  // Pointers written under the row-keyed contract keep proving against it; live deltas use the sitting-keyed one.
  const meeting = sitting(TUSD, "tusd1:498", "2026-09-14T04:24:00.000Z");
  const rows = [
    agendaRow(meeting, "2026-09-10T00:00:00.000Z", "1. Call to order.", "x"),
    agendaRow(meeting, "2026-09-11T00:00:00.000Z", "1. Call to order.", "y"),
  ];
  const payload = { meetings: [meeting], agendaDocuments: rows };
  assert.deepEqual(rowKeyedCivicRecordsFor("MEETING", payload).map(({ key }) => key), [
    `meeting:${meeting.id}`,
    ...rows.map((row) => `agenda-document:${row.id}`),
  ]);
  assert.deepEqual(civicRecordsFor("MEETING", payload).map(({ key }) => key), [
    `meeting:${meeting.id}`,
    agendaDocumentRecordKey({ meetingId: meeting.id }),
  ]);
  const transfer = { recordClass: "MEETING", readModel: payload, excludedFacts: [] } as unknown as RoutineCandidate;
  const legacy = candidateChangeSet(transfer, null, ROW_KEYED_CIVIC_CHANGE_CONTRACT);
  assert.deepEqual(legacy.added.map(({ key }) => key), rowKeyedCivicRecordsFor("MEETING", payload).map(({ key }) => key));
  assert.deepEqual(legacy.added.map(({ after }) => after), [meeting, ...rows]);
});
