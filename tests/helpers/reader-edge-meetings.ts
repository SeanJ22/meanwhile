import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MEETING_PARTITION_CONTRACTS, type MeetingPartitionContract } from "../../lib/civic-data/meeting-partitions.ts";
import { MemoryRoutineDataStore } from "../../lib/civic-data/store.ts";
import { stateRegistryRuntimeScope } from "../../lib/civic-data/state-scopes.ts";
import { planMeetingBodies } from "../../lib/meetings/body-publication.ts";
import { publishReaderEdgeArtifacts } from "../../lib/meetings/edge-serving.ts";
import { LocalFileArtifactStore } from "../../lib/meetings/edge-store.ts";
import type { AgendaDocument } from "../../lib/meetings/agenda-documents.ts";
import type { Meeting } from "../../lib/sources/types.ts";
import { promoteMeetingPartitions } from "../../scripts/ingest.ts";
import { ACQUIRED_URL } from "./meeting-body-fixtures.ts";
import { provenEdgeEntry } from "./promoted-edge-entry.ts";
import { registryTransferImport } from "./promoted-fixtures.ts";

/** A promotion through the real door: exactly these rows and agenda documents become the partition's pointed version. */
export async function promoteRows(store: MemoryRoutineDataStore, partition: MeetingPartitionContract, meetings: readonly Meeting[],
  agendaDocuments: readonly AgendaDocument[], readAt: string) {
  const bytes = `${partition.id}:${meetings.map((meeting) => meeting.id).join(",")}:${readAt}`;
  const [result] = await promoteMeetingPartitions({
    store, partitions: [partition], meetings, agendaDocuments: [...agendaDocuments],
    reports: [{
      source: partition.meetingSource, ok: true, error: null, fetched: meetings.length, normalized: meetings.length,
      drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
      acquisitions: [{ source: partition.meetingSource, requestedUrl: ACQUIRED_URL, finalUrl: ACQUIRED_URL, httpStatus: 200,
        rawHash: createHash("sha256").update(bytes).digest("hex"), byteCount: Buffer.byteLength(bytes) }],
    }],
    generatedAt: readAt,
    venueFetch: async () => { throw new Error("no network in a test"); },
  });
  return result!.outcome;
}

/** The partition that owns a recorded sitting, or null when only a state's derived family would hold it. */
export function ownPartition(meeting: Meeting): MeetingPartitionContract | null {
  return MEETING_PARTITION_CONTRACTS.find((row) =>
    row.derivedFamily === null && row.historyOf === undefined && row.bodyId === meeting.bodyId && meeting.id.startsWith(`${row.meetingSource}:`)) ?? null;
}

/** Recorded sittings promoted through the partitions that own them; the ones no partition owns are returned unplaced. */
export async function promoteRecorded(store: MemoryRoutineDataStore, meetings: readonly Meeting[], agendaDocuments: readonly AgendaDocument[], readAt: string):
  Promise<{ readonly promoted: readonly Meeting[]; readonly unplaced: readonly Meeting[] }> {
  const byPartition = new Map<MeetingPartitionContract, Meeting[]>();
  const unplaced: Meeting[] = [];
  for (const meeting of meetings) {
    const partition = ownPartition(meeting);
    if (partition === null) unplaced.push(meeting);
    else byPartition.set(partition, [...byPartition.get(partition) ?? [], meeting]);
  }
  for (const [partition, rows] of byPartition) await promoteRows(store, partition, rows, agendaDocuments, readAt);
  return { promoted: [...byPartition.values()].flat(), unplaced };
}

/** One agenda document of a sitting, as a body's agenda blob holds it. */
export function agendaFor(meeting: Meeting, ocdId: string | null, readAt: string): AgendaDocument {
  return {
    id: `${meeting.id}@agenda`, meetingId: meeting.id, ocdId, documentUrl: ACQUIRED_URL, contentHash: "a".repeat(64), retrievedAt: readAt,
    contentType: "text/html", text: "Official agenda.", extraction: "html", extractionNote: null,
    sourceUrl: ACQUIRED_URL, sourceOrg: meeting.provenance.sourceOrg, collectedAt: readAt, verifiedAt: null,
  };
}

/** Recorded sittings promoted through their partitions and published as per-body records on a temporary edge the routes read, with Arizona's registry beside them. */
export async function publishRecordedEdge(meetings: readonly Meeting[], agendaDocuments: readonly AgendaDocument[] = [], publishedAt = "2026-09-25T12:00:00.000Z") {
  const store = new MemoryRoutineDataStore();
  const { promoted } = await promoteRecorded(store, meetings, agendaDocuments, publishedAt);
  const dir = mkdtempSync(join(tmpdir(), "wtp-recorded-edge-"));
  process.env.WTP_READER_EDGE_DIR = dir;
  process.once("exit", () => rmSync(dir, { recursive: true, force: true }));
  const edge = new LocalFileArtifactStore(dir);
  const plan = await planMeetingBodies({ store, artifacts: edge, now: publishedAt, served: undefined, registryVersion: () => null, registry: async () => null });
  assert.deepEqual(plan.stats.failed, []);
  const versionId = `recorded:registry:AZ:${publishedAt}`;
  const registry = { AZ: { versionId, value: { kind: "PROMOTED_POINTERS" as const, entries: [provenEdgeEntry({
    recordClass: "REGISTRY_RUNTIME_BINDING", scope: stateRegistryRuntimeScope("AZ"), sourceId: "registry-reviewed-bindings",
    versionId, value: registryTransferImport().projection.payload })] } } };
  const published = await publishReaderEdgeArtifacts({ store: edge, now: publishedAt, meetingStates: plan.entries, extras: { everydayRouting: null }, stateAuthorities: { "registry-runtime": registry } });
  assert.equal(published.status, "PUBLISHED");
  await plan.settle();
  return { store, edge, promoted };
}
