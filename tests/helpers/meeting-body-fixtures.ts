import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MEETING_PARTITION_CONTRACTS, type MeetingPartitionContract } from "../../lib/civic-data/meeting-partitions.ts";
import { MemoryRoutineDataStore, type RoutineDataStore } from "../../lib/civic-data/store.ts";
import { VALIDATION_CHECKS, type RoutineCandidate, type ValidationReceipt } from "../../lib/civic-data/types.ts";
import { planMeetingBodies, type MeetingBodyPlan } from "../../lib/meetings/body-publication.ts";
import { publishReaderMeetings, readReaderEdgeMeetings } from "../../lib/meetings/edge-serving.ts";
import { LocalFileArtifactStore, type ReaderArtifactStore } from "../../lib/meetings/edge-store.ts";
import { meetingSettingsFromValues } from "../../lib/meetings/settings.ts";
import type { Meeting } from "../../lib/sources/types.ts";
import { promoteMeetingPartitions } from "../../scripts/ingest.ts";

export const ACQUIRED_URL = "https://www.pima.edu/about-pima/leadership-policies/governing-board/board-meetings/documents.html";
export const HOUR = 3_600_000;
export const T1 = "2026-09-20T12:00:00.000Z";
export const T2 = "2026-09-22T04:00:00.000Z";
export const T3 = "2026-09-22T04:30:00.000Z";
export const T4 = "2026-09-22T05:00:00.000Z";
export const at = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();

export const PIMA = MEETING_PARTITION_CONTRACTS.find((p) => p.id === "meetings:legistar:ocd-division%2Fcountry%3Aus%2Fstate%3Aaz%2Fcounty%3Apima%23governing")!;
export const NEWBURY = MEETING_PARTITION_CONTRACTS.find((p) => p.id === "meetings:schedulepage:ocd-division%2Fcountry%3Aus%2Fstate%3Anh%2Fcounty%3Amerrimack%2Fplace%3Anewbury_town%23energy-committee")!;

export function row(partition: MeetingPartitionContract, suffix: string, startsAt: string, collectedAt: string): Meeting {
  return {
    id: `${partition.meetingSource}:${partition.wiring!.jurisdiction.slice(0, 4).toLowerCase()}:${suffix}`,
    ocdId: partition.ocdId,
    bodyId: partition.bodyId,
    bodyName: partition.wiring!.publishingOrg,
    title: `Regular Meeting ${suffix}`,
    startsAt,
    timeZone: partition.wiring!.timeZone,
    location: null,
    online: { label: "Zoom Webinar", joinUrl: null },
    agendaUrl: null,
    jurisdiction: partition.wiring!.jurisdiction,
    status: "SCHEDULED",
    provenance: { sourceUrl: ACQUIRED_URL, sourceOrg: partition.wiring!.publishingOrg, collectedAt, verifiedAt: null },
  };
}

/** One routine read of a partition exactly as its child makes it: a new version, or a receipt when nothing changed. */
export async function readPartition(store: MemoryRoutineDataStore, partition: MeetingPartitionContract, readAt: string, suffixes: readonly string[]) {
  const bytes = `${partition.id}:${suffixes.join(",")}:${readAt}`;
  const meetings = suffixes.map((suffix, index) => row(partition, suffix, `2026-10-${String(10 + index).padStart(2, "0")}T17:00:00.000Z`, readAt));
  const [result] = await promoteMeetingPartitions({
    store,
    partitions: [partition],
    meetings,
    agendaDocuments: [],
    reports: [{
      source: partition.meetingSource,
      ok: true,
      error: null,
      fetched: meetings.length,
      normalized: meetings.length,
      drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
      acquisitions: [{
        source: partition.meetingSource,
        requestedUrl: ACQUIRED_URL,
        finalUrl: ACQUIRED_URL,
        httpStatus: 200,
        rawHash: createHash("sha256").update(bytes).digest("hex"),
        byteCount: Buffer.byteLength(bytes),
      }],
    }],
    generatedAt: readAt,
  });
  assert.ok(result?.outcome.promoted, `${partition.id} read at ${readAt}: ${result?.outcome.candidate.failureDetail ?? ""}`);
  return result!.outcome;
}

/** A check that failed at the source: a refused candidate, the pointer and its receipts untouched. */
export async function failedCheck(store: MemoryRoutineDataStore, partition: MeetingPartitionContract, readAt: string): Promise<void> {
  const pointer = (await store.readPromotion("MEETING", partition.scope))!;
  const pointed = (await store.readCandidate(pointer.versionId))!;
  const candidate: RoutineCandidate = { ...pointed.candidate, id: `cv-failed-${partition.bodyId.length}-${Date.parse(readAt)}`, retrieval: { ...pointed.candidate.retrieval, retrievedAt: readAt } };
  await store.create({
    candidate, state: "FETCHED", acquisitionSucceeded: true, receipt: null, promotedVersion: null,
    lastKnownGoodVersion: pointer.versionId, failureCode: null, failureDetail: null,
  }, { candidateId: candidate.id, sequence: 1, state: "FETCHED", at: readAt, detail: "persisted acquisition" });
  await store.transition(candidate.id, "NORMALIZED", readAt, "persisted normalization");
  const refused: ValidationReceipt = {
    contractVersion: 2, decision: "FAIL", candidateId: candidate.id, sourceId: candidate.sourceId, recordClass: candidate.recordClass,
    scope: candidate.scope, validatedAt: readAt, excludedFacts: [],
    checks: VALIDATION_CHECKS.map((check, index) => index === 0
      ? { check, verdict: "FAIL" as const, code: `${check}_FAIL`, detail: "the calendar page did not answer" }
      : { check, verdict: "PASS" as const, code: `${check}_PASS`, detail: "persisted proof" }),
  };
  const first = refused.checks[0]!;
  await store.transition(candidate.id, "SEMANTIC_INVALID", readAt, "refused", refused, { code: first.code, detail: first.detail });
}

export const freshEdge = (): LocalFileArtifactStore => new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "meeting-bodies-")));

/** What a pass wrote, counted at the two places it can write. */
export interface WriteCounts {
  records: number;
  rows: number;
}

export function countWrites(store: RoutineDataStore, edge: ReaderArtifactStore): WriteCounts & { stop: () => void } {
  const counts = { records: 0, rows: 0 };
  const put = edge.putImmutable.bind(edge);
  const write = store.writePreparedReaderProjection.bind(store);
  edge.putImmutable = async (bytes, suffix) => { counts.records += 1; return put(bytes, suffix); };
  (store as { writePreparedReaderProjection: RoutineDataStore["writePreparedReaderProjection"] }).writePreparedReaderProjection = (input, expected) => { counts.rows += 1; return write(input, expected); };
  return Object.assign(counts, { stop: () => { edge.putImmutable = put; (store as { writePreparedReaderProjection: RoutineDataStore["writePreparedReaderProjection"] }).writePreparedReaderProjection = write; } });
}

/** One publication pass as the supervisor runs it: plan the changed bodies, publish the manifest, then settle the queue. */
export async function publishPass(store: RoutineDataStore, edge: ReaderArtifactStore, now: string, registry: Parameters<typeof planMeetingBodies>[0]["registry"] = async () => null):
  Promise<{ readonly plan: MeetingBodyPlan; readonly status: string }> {
  const served = (await edge.readManifest())?.manifest.meetingStates;
  const plan = await planMeetingBodies({ store, artifacts: edge, now, served, registryVersion: () => null, registry });
  const published = await publishReaderMeetings({ store: edge, now, meetingStates: plan.entries });
  if (published.status === "PUBLISHED" || published.status === "CURRENT") await plan.settle();
  return { plan, status: published.status };
}

/** A read as the map makes it: the viewed place's divisions, from the edge, the database standing by. */
export function readPlace(edge: ReaderArtifactStore, store: RoutineDataStore, ocdIds: readonly string[], now: string, extra: { readonly window?: "SHOWN" | "HELD"; readonly includeAgenda?: boolean } = {}) {
  return readReaderEdgeMeetings({ store: edge, dataStore: store, ocdIds, now, settings: meetingSettingsFromValues(), ...extra });
}
