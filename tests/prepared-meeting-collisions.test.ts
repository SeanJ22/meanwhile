import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { MEETING_PARTITION_CONTRACTS, type MeetingPartitionContract } from "../lib/civic-data/meeting-partitions.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { installFactReader } from "../lib/facts/db.ts";
import { preparePublishedMeetingSnapshot, preparedMeetingScope, readPreparedMeetingPublication, type PreparedMeetingManifest } from "../lib/meetings/prepared-snapshot.ts";
import type { MeetingsSnapshot } from "../lib/meetings/snapshot.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { promoteMeetingPartitions } from "../scripts/ingest.ts";

const first = "2026-09-08T12:00:00.000Z", second = "2026-09-08T13:00:00.000Z";
const partitions = [
  ...MEETING_PARTITION_CONTRACTS.filter(partition => partition.meetingSource === "legistar-insite" && partition.bodyId.includes("state:az")),
  MEETING_PARTITION_CONTRACTS.find(partition => partition.meetingSource === "onbase" && partition.bodyId.includes("place:tucson"))!,
];
const rootScope = preparedMeetingScope("AZ");

async function publish(store: MemoryRoutineDataStore, partition: MeetingPartitionContract, id: string, title: string, at: string, documentId: string | null = `${id}@${"b".repeat(64)}`) {
  const url = partition.meetingSource === "onbase" ? "https://tucsonaz.hylandcloud.com/221agendaonline/" : "https://mesa.legistar.com/Calendar.aspx";
  const meeting: Meeting = { id, bodyId: partition.bodyId, ocdId: partition.ocdId,
    bodyName: partition.wiring!.config.insiteBodyName ?? partition.wiring!.publishingOrg, title,
    startsAt: "2026-09-20T17:00:00.000Z", timeZone: partition.wiring!.timeZone, location: null, agendaUrl: `${url}?agenda`,
    jurisdiction: partition.wiring!.jurisdiction, status: "SCHEDULED",
    provenance: { sourceUrl: url, sourceOrg: partition.wiring!.publishingOrg, collectedAt: at, verifiedAt: null } };
  const bytes = `${id}:${title}:${documentId}`;
  const [result] = await promoteMeetingPartitions({ store, partitions: [partition], meetings: [meeting], generatedAt: at,
    agendaDocuments: documentId === null ? [] : [{ id: documentId, meetingId: id, ocdId: partition.ocdId, documentUrl: `${url}?agenda`, contentHash: "b".repeat(64),
      retrievedAt: at, contentType: "text/html", text: "Official agenda", extraction: "html", extractionNote: null,
      sourceUrl: url, sourceOrg: partition.wiring!.publishingOrg, collectedAt: at, verifiedAt: null }],
    reports: [{ source: partition.meetingSource, ok: true, error: null, fetched: 1, normalized: 1,
      drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
      acquisitions: [{ source: partition.meetingSource, requestedUrl: url, finalUrl: url, httpStatus: 200,
        rawHash: createHash("sha256").update(bytes).digest("hex"), byteCount: Buffer.byteLength(bytes) }] }],
  });
  assert.ok(result?.outcome.promoted, JSON.stringify(result?.outcome.candidate.receipt));
}

for (const collision of ["meeting", "document"] as const) test(`cross-place ${collision} ID collisions hold every claimant, retain safe copies and leave unchanged payloads closed`, async () => {
  assert.equal(partitions.length, 3);
  assert.equal(new Set(partitions.map(partition => partition.ocdId)).size, 3);
  installFactReader(null);
  const store = new MemoryRoutineDataStore();
  const ids = partitions.map((partition, index) => `${partition.meetingSource}:collision-fixture-${index}`);
  for (const [index, partition] of partitions.entries()) await publish(store, partition, ids[index]!, `Accepted ${index}`, first, collision === "meeting" ? null : undefined);
  assert.equal((await preparePublishedMeetingSnapshot(store, first, { state: "AZ" })).status, "PUBLISHED");
  const read = store.readPreparedReaderProjection.bind(store);
  const original = (await read("MEETING", rootScope))!.payload as PreparedMeetingManifest;
  assert.equal(original.chunks.length, 3);
  const payloadReads: string[] = [];
  const write = store.writePreparedReaderProjection.bind(store), readPromotions = store.readPromotions.bind(store);
  store.readPreparedReaderProjection = async (recordClass, scope) => {
    payloadReads.push(scope); return read(recordClass, scope);
  };
  const sharedMeetingId = "legistar-insite:shared-collision", sharedDocumentId = `shared-document@${"b".repeat(64)}`;
  for (const index of [0, 1]) await publish(store, partitions[index]!, collision === "meeting" ? sharedMeetingId : ids[index]!,
    `Conflicting ${index}`, second, collision === "document" ? sharedDocumentId : null);
  await publish(store, partitions[2]!, ids[2]!, "Unrelated posted change", second, collision === "meeting" ? null : undefined);
  assert.equal((await preparePublishedMeetingSnapshot(store, second, { state: "AZ" })).status, "PUBLISHED");
  assert.deepEqual(payloadReads, [rootScope], "collision decisions read only the prepared metadata index");
  const held = (await read("MEETING", rootScope))!.payload as PreparedMeetingManifest;
  assert.equal(held.heldChunks.length, 2);
  assert.equal(held.chunks.length, 3, "safe accepted copies remain alongside the unrelated update");
  assert.ok(held.heldChunks.every(entry => entry.detail.includes(collision === "meeting" ? "MEETING_PARTITION_ID_COLLISION" : "MEETING_PARTITION_DOCUMENT_COLLISION")));
  for (const originalChunk of original.chunks) {
    if (originalChunk.bodyIds.includes(partitions[2]!.bodyId)) continue;
    assert.equal(held.chunks.find(chunk => chunk.key === originalChunk.key)?.scope, originalChunk.scope);
  }
  const publication = await readPreparedMeetingPublication({ store, state: "AZ", now: second });
  assert.ok(publication);
  const served: MeetingsSnapshot[] = [];
  for await (const chunk of publication.value.chunks) served.push((await chunk.read()).snapshot);
  const titles = served.flatMap(snapshot => snapshot.meetings.map(meeting => meeting.title));
  assert.ok(titles.includes("Accepted 0") && titles.includes("Accepted 1") && titles.includes("Unrelated posted change"));
  assert.ok(titles.every(title => !title.startsWith("Conflicting")));
  for (const partition of partitions.slice(0, 2)) assert.equal(publication.partitions.find(row => row.contractId === partition.id)?.kind, "STORE_UNREACHABLE");
  store.readPreparedReaderProjection = async () => { throw new Error("An unchanged pass must not open prepared payloads"); };
  store.readPromotions = async () => { throw new Error("An unchanged pass must not open source payloads"); };
  store.writePreparedReaderProjection = async () => { throw new Error("An unchanged pass must not write prepared payloads"); };
  assert.equal((await preparePublishedMeetingSnapshot(store, "2026-09-08T13:05:00.000Z", { state: "AZ" })).status, "CURRENT");
  store.readPreparedReaderProjection = async (recordClass, scope) => { payloadReads.push(scope); return read(recordClass, scope); };
  store.readPromotions = readPromotions;
  store.writePreparedReaderProjection = write;
  const third = "2026-09-08T14:00:00.000Z";
  await publish(store, partitions[2]!, ids[2]!, "Another unrelated update", third, collision === "meeting" ? null : undefined);
  const sourceReads: string[] = [];
  store.readPromotions = async (recordClass, scopes) => { sourceReads.push(...scopes); return readPromotions(recordClass, scopes); };
  payloadReads.length = 0;
  assert.equal((await preparePublishedMeetingSnapshot(store, third, { state: "AZ" })).status, "PUBLISHED");
  assert.deepEqual(payloadReads, [rootScope]);
  assert.ok(!sourceReads.includes(partitions[0]!.scope) && !sourceReads.includes(partitions[1]!.scope), "held unchanged claimants reuse only identity metadata");
});

test("first publication refuses colliding places without hiding an unrelated place", async () => {
  installFactReader(null);
  const store = new MemoryRoutineDataStore();
  for (const partition of partitions.slice(0, 2)) await publish(store, partition, "legistar-insite:shared", "Conflicting", first, null);
  await publish(store, partitions[2]!, "onbase:unrelated", "Unrelated", first, null);
  assert.equal((await preparePublishedMeetingSnapshot(store, first, { state: "AZ" })).status, "PUBLISHED");
  const manifest = (await store.readPreparedReaderProjection("MEETING", rootScope))!.payload as PreparedMeetingManifest;
  assert.equal(manifest.heldChunks.length, 2);
  assert.deepEqual(manifest.chunks.flatMap(chunk => chunk.meetingIds), ["onbase:unrelated"]);
});
