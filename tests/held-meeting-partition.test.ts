import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { type TestContext } from "node:test";

import {
  HELD_MEETING_PARTITIONS,
  MEETING_PARTITION_CONTRACTS,
  RETIRED_MEETING_PARTITIONS_WITHOUT_HOLD,
  heldMeetingPartitionFor,
  meetingPartitionId,
  type MeetingPartitionContract,
} from "../lib/civic-data/meeting-partitions.ts";
import { processRoutineCandidate } from "../lib/civic-data/candidate-lifecycle.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { RoutineRecordClass } from "../lib/civic-data/types.ts";
import { installFactReader } from "../lib/facts/db.ts";
import { meetingCompositionOf } from "../lib/meetings/body-records.ts";
import { snapshotCounts, type MeetingsSnapshot } from "../lib/meetings/snapshot.ts";
import { RETIRED_MEETING_ROUTES } from "../lib/registry/source-wiring.ts";
import type { ChildRunReport } from "../lib/sources/composite/index.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { candidateForMeetingPartition, promoteMeetingPartitions } from "../scripts/ingest.ts";
import { freshEdge, publishPass } from "./helpers/meeting-body-fixtures.ts";
import { meetingStateOf } from "../lib/meetings/body-records.ts";
import { bodyPointerOf, coupledContracts, readEveryBody, readBody } from "./helpers/meeting-body-national.ts";

const BEFORE_CUTOVER = "2026-09-20T12:00:00.000Z";
const FIRST_SUCCESSOR_RUN = "2026-09-20T14:00:00.000Z";
const READ_AT = "2026-09-20T15:00:00.000Z";

const [held] = HELD_MEETING_PARTITIONS;
const successor = MEETING_PARTITION_CONTRACTS.find((partition) => partition.id === held?.successorId)!;
const STATE = meetingStateOf(successor.bodyId);

function rejectMeetingFactReads(t: TestContext): string[] {
  const reads: string[] = [];
  installFactReader(async text => {
    reads.push(text);
    assert.fail("published meeting composition must not query facts");
  });
  t.after(() => installFactReader(undefined));
  return reads;
}

const retired = {
  ...successor,
  id: held!.id,
  scope: held!.scope,
  meetingSource: held!.meetingSource,
} as MeetingPartitionContract;

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

test("until its successor promotes, the retired route's held version is composed in its place and named", async (t) => {
  const store = new MemoryRoutineDataStore();
  const heldVersion = await seedRetiredPointer(store);

  const factReads = rejectMeetingFactReads(t);
  const { read, edge } = await readEveryBody(store, READ_AT);
  assert.deepEqual(factReads, [], "published meeting composition does not query facts");
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") return;
  assert.deepEqual(
    read.value.meetings.map((meeting) => meeting.id).sort(),
    [`${held!.meetingSource}:pcc:706`, `${held!.meetingSource}:pcc:707`],
    "the body's sittings stay on the page through the cutover",
  );
  assert.deepEqual(await coupledContracts(store, STATE, successor.bodyId), [held!.id], "the body is coupled to the retired route's held version, named by its own identity");
  assert.equal((await bodyPointerOf(edge, STATE, successor.bodyId))?.composition, meetingCompositionOf([{ contractId: held!.id, versionId: heldVersion }]));
  assert.equal(
    read.value.sources.some((source) => !source.ok && (source.unreachableOcdIds ?? []).includes(successor.ocdId!)),
    false,
    "no calendar-unreachable wall is shown for a body whose held version is composed",
  );
});

test("the successor's first promotion supersedes the held version, which stays in the store untouched", async (t) => {
  const store = new MemoryRoutineDataStore();
  const heldVersion = await seedRetiredPointer(store);
  const successorVersion = await promoteSuccessor(store);

  const factReads = rejectMeetingFactReads(t);
  const { read, edge } = await readEveryBody(store, READ_AT);
  assert.deepEqual(factReads, [], "published meeting composition does not query facts");
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
  assert.deepEqual(await coupledContracts(store, STATE, successor.bodyId), [successor.id]);
  assert.equal((await bodyPointerOf(edge, STATE, successor.bodyId))?.composition, meetingCompositionOf([{ contractId: successor.id, versionId: successorVersion }]));
  assert.equal((await store.readPromotion("MEETING", held!.scope))?.versionId, heldVersion, "nothing moved the held pointer");
});

test("the held pointer's payload is read only while its successor has none; a superseded route costs no further reads", async (t) => {
  class ScopeCountingStore extends MemoryRoutineDataStore {
    readonly requested: string[] = [];
    override async readPromotion<T = unknown>(recordClass: RoutineRecordClass, scope: string) {
      this.requested.push(scope);
      return super.readPromotion<T>(recordClass, scope);
    }
    override async readPromotions<T = unknown>(recordClass: RoutineRecordClass, scopes: readonly string[]) {
      this.requested.push(...scopes);
      return super.readPromotions<T>(recordClass, scopes);
    }
  }

  const store = new ScopeCountingStore();
  const edge = freshEdge();
  await seedRetiredPointer(store);
  const factReads = rejectMeetingFactReads(t);
  await publishPass(store, edge, READ_AT);
  assert.equal(store.requested.includes(held!.scope), true, "in the window, the held version is what the page shows");

  await promoteSuccessor(store);
  store.requested.length = 0;
  await publishPass(store, edge, READ_AT);
  assert.ok(store.requested.includes(successor.scope), "the successor is what is read now");
  assert.equal(store.requested.includes(held!.scope), false, "after the first promotion, nothing reads the retired pointer's payload again");
  assert.deepEqual(factReads, [], "published meeting composition does not query facts");
});

test("the body's record couples to the held version, then recomposes on the successor's first promotion", async (t) => {
  const store = new MemoryRoutineDataStore();
  const edge = freshEdge();
  const heldVersion = await seedRetiredPointer(store);

  const factReads = rejectMeetingFactReads(t);
  const first = await publishPass(store, edge, READ_AT);
  assert.deepEqual(factReads, [], "published meeting composition does not query facts");
  assert.equal(first.status, "PUBLISHED");
  const servedHeld = await readBody(edge, store, READ_AT, successor.bodyId);
  assert.equal(servedHeld.kind, "PROMOTED");
  if (servedHeld.kind !== "PROMOTED") return;
  assert.equal(servedHeld.value.meetings.length, 2);
  assert.equal((await bodyPointerOf(edge, STATE, successor.bodyId))?.composition,
    meetingCompositionOf([{ contractId: held!.id, versionId: heldVersion }]));

  const again = await publishPass(store, edge, READ_AT);
  assert.equal(again.status, "CURRENT", "an unchanged held coupling never recomposes");
  assert.equal(again.plan.stats.composed, 0);

  const successorVersion = await promoteSuccessor(store);
  const second = await publishPass(store, edge, READ_AT);
  assert.equal(second.plan.stats.composed, 1);
  const servedSuccessor = await readBody(edge, store, READ_AT, successor.bodyId);
  assert.equal(servedSuccessor.kind, "PROMOTED");
  if (servedSuccessor.kind !== "PROMOTED") return;
  assert.equal((await bodyPointerOf(edge, STATE, successor.bodyId))?.composition,
    meetingCompositionOf([{ contractId: successor.id, versionId: successorVersion }]));
  assert.equal(
    servedSuccessor.value.meetings.every((meeting) => meeting.id.startsWith(`${successor.meetingSource}:`)),
    true,
  );
  assert.deepEqual(factReads, [], "published meeting composition does not query facts");
});
