import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { HELD_MEETING_PARTITIONS, MEETING_PARTITION_CONTRACTS, RETIRED_MEETING_PARTITIONS_WITHOUT_HOLD, heldMeetingPartitionFor, meetingPartitionId, type MeetingPartitionContract } from "../lib/civic-data/meeting-partitions.ts";
import { processRoutineCandidate } from "../lib/civic-data/candidate-lifecycle.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";

import { snapshotCounts, type MeetingsSnapshot } from "../lib/meetings/snapshot.ts";
import { RETIRED_MEETING_ROUTES } from "../lib/registry/source-wiring.ts";
import type { ChildRunReport } from "../lib/sources/composite/index.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { candidateForMeetingPartition, promoteMeetingPartitions } from "../scripts/ingest.ts";

import { readEveryBody } from "./helpers/meeting-body-national.ts";

const BEFORE_CUTOVER = "2026-09-20T12:00:00.000Z";
const FIRST_SUCCESSOR_RUN = "2026-09-20T14:00:00.000Z";
const READ_AT = "2026-09-20T15:00:00.000Z";

const [held] = HELD_MEETING_PARTITIONS;
const successor = MEETING_PARTITION_CONTRACTS.find((partition) => partition.id === held?.successorId)!;

/** The retired identity as it was registered before the cutover — used only to seed its held pointer. */
const retired = {
  ...successor,
  id: held!.id,
  scope: held!.scope,
  meetingSource: held!.meetingSource,
} as MeetingPartitionContract;

// Any URL the meetings authority still admits; the retired host itself left the authority.
const ACQUIRED_URL = "https://www.pima.edu/about-pima/leadership-policies/governing-board/board-meetings/documents.html";

function row(source: string, suffix: string, startsAt: string, collectedAt: string): Meeting {
  return {
    id: `${source}:pcc:${suffix}`,
    ocdId: successor.ocdId,
    bodyId: successor.bodyId,
    bodyName: "Pima Community College District Governing Board",
    title: `Regular Board Meeting ${suffix}`,
    startsAt,
    timeZone: successor.wiring!.timeZone,
    location: null,
    online: { label: "Zoom Webinar", joinUrl: null },
    agendaUrl: null,
    jurisdiction: successor.wiring!.jurisdiction,
    status: "SCHEDULED",
    provenance: { sourceUrl: ACQUIRED_URL, sourceOrg: successor.wiring!.publishingOrg, collectedAt, verifiedAt: null },
  };
}

function acquisitions(source: string, version: string) {
  const bytes = `${source}:${version}`;
  return [{
    source,
    requestedUrl: ACQUIRED_URL,
    finalUrl: ACQUIRED_URL,
    httpStatus: 200,
    rawHash: createHash("sha256").update(bytes).digest("hex"),
    byteCount: Buffer.byteLength(bytes),
  }];
}

async function seedRetiredPointer(store: MemoryRoutineDataStore): Promise<string> {
  const meetings = [
    row(held!.meetingSource, "706", "2026-09-25T17:00:00.000Z", BEFORE_CUTOVER),
    row(held!.meetingSource, "707", "2026-10-14T17:00:00.000Z", BEFORE_CUTOVER),
  ];
  const snapshot: MeetingsSnapshot = {
    formatVersion: 1,
    generatedAt: BEFORE_CUTOVER,
    counts: snapshotCounts(meetings, 0),
    sources: [{
      source: held!.meetingSource,
      ok: true,
      error: null,
      fetched: meetings.length,
      normalized: meetings.length,
      drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
      acquisitions: acquisitions(held!.meetingSource, BEFORE_CUTOVER),
    }],
    meetings,
    agendaDocuments: [],
  };
  const outcome = await processRoutineCandidate(store, candidateForMeetingPartition(retired, snapshot), BEFORE_CUTOVER);
  assert.ok(outcome.promoted, `the retired route's version was promoted before the cutover: ${outcome.candidate.failureDetail ?? ""}`);
  return outcome.promoted!.versionId;
}

function successorReport(version: string): ChildRunReport {
  return {
    source: successor.meetingSource,
    ok: true,
    error: null,
    fetched: 3,
    normalized: 3,
    drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
    acquisitions: acquisitions(successor.meetingSource, version),
  };
}

async function promoteSuccessor(store: MemoryRoutineDataStore): Promise<string> {
  const [result] = await promoteMeetingPartitions({
    store,
    partitions: [successor],
    meetings: [
      row(successor.meetingSource, "2026-09-25-regular", "2026-09-25T17:00:00.000Z", FIRST_SUCCESSOR_RUN),
      row(successor.meetingSource, "2026-10-14-regular", "2026-10-14T17:00:00.000Z", FIRST_SUCCESSOR_RUN),
      row(successor.meetingSource, "2026-10-29-study-session", "2026-10-29T17:00:00.000Z", FIRST_SUCCESSOR_RUN),
    ],
    agendaDocuments: [],
    reports: [successorReport(FIRST_SUCCESSOR_RUN)],
    generatedAt: FIRST_SUCCESSOR_RUN,
  });
  assert.ok(result?.outcome.promoted, `the successor's first promotion lands: ${result?.outcome.candidate.failureDetail ?? ""}`);
  return result!.outcome.promoted!.versionId;
}

test("every retired route is a held partition whose successor is registered and whose own identity is not", () => {
  // A route retired beside a successor already wired for the body has nothing to hold.
  const cutovers = RETIRED_MEETING_ROUTES.filter((route) => !route.successorAlreadyWired);
  assert.equal(HELD_MEETING_PARTITIONS.length, cutovers.length);
  const registered = new Set(MEETING_PARTITION_CONTRACTS.map((partition) => partition.id));
  for (const route of RETIRED_MEETING_ROUTES.filter((candidate) => candidate.successorAlreadyWired)) {
    const id = meetingPartitionId(route.meetingSource, route.bodyId);
    assert.equal(registered.has(id), false, "the retired identity has no contract, clock or writer");
    assert.ok(registered.has(meetingPartitionId(route.replacedBy, route.bodyId)), "the already-wired successor is registered");
    assert.equal(HELD_MEETING_PARTITIONS.some((row) => row.id === id), false, "nothing is held beside a successor that already promotes");
    assert.deepEqual(
      RETIRED_MEETING_PARTITIONS_WITHOUT_HOLD.find((row) => row.id === id),
      { id, successorId: meetingPartitionId(route.replacedBy, route.bodyId) },
    );
  }
  for (const route of cutovers) {
    const id = meetingPartitionId(route.meetingSource, route.bodyId);
    const row = HELD_MEETING_PARTITIONS.find((candidate) => candidate.id === id);
    assert.ok(row, `${id} is held`);
    assert.equal(registered.has(id), false, "the retired identity has no contract, clock or writer");
    assert.equal(row!.successorId, meetingPartitionId(route.replacedBy, route.bodyId));
    assert.ok(registered.has(row!.successorId), "the successor carries the same body");
    assert.equal(heldMeetingPartitionFor(row!.successorId), row);
  }
  assert.equal(heldMeetingPartitionFor(MEETING_PARTITION_CONTRACTS.find((p) => !heldMeetingPartitionFor(p.id))!.id), null);
});

test("until its successor promotes, the retired route's held version is composed in its place and named", async () => {
  const store = new MemoryRoutineDataStore();
  await seedRetiredPointer(store);

  const { read } = await readEveryBody(store, READ_AT);
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") return;
  assert.deepEqual(
    read.value.meetings.map((meeting) => meeting.id).sort(),
    [`${held!.meetingSource}:pcc:706`, `${held!.meetingSource}:pcc:707`],
    "the body's sittings stay on the page through the cutover",
  );

  assert.equal(
    read.value.sources.some((source) => !source.ok && (source.unreachableOcdIds ?? []).includes(successor.ocdId!)),
    false,
    "no calendar-unreachable wall is shown for a body whose held version is composed",
  );
});

test("the successor's first promotion supersedes the held version, which stays in the store untouched", async () => {
  const store = new MemoryRoutineDataStore();
  const heldVersion = await seedRetiredPointer(store);
  await promoteSuccessor(store);

  const { read } = await readEveryBody(store, READ_AT);
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") return;
  assert.deepEqual(
    read.value.meetings.map((meeting) => meeting.id).sort(),
    [
      `${successor.meetingSource}:pcc:2026-09-25-regular`,
      `${successor.meetingSource}:pcc:2026-10-14-regular`,
      `${successor.meetingSource}:pcc:2026-10-29-study-session`,
    ],
    "one authority for the body: the successor's rows only",
  );

  assert.equal((await store.readPromotion("MEETING", held!.scope))?.versionId, heldVersion, "nothing moved the held pointer");
});
