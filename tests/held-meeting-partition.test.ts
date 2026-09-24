import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  HELD_MEETING_PARTITIONS,
  MEETING_PARTITION_CONTRACTS,
  heldMeetingPartitionFor,
  meetingPartitionId,
  type MeetingPartitionContract,
} from "../lib/civic-data/meeting-partitions.ts";
import { processRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { clearPromotedReadModelCache } from "../lib/civic-data/read-model.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import {
  READER_PROOF_HARNESS_ENV,
  READER_PROOF_MEETING_PIN_ENV,
  readerProofMeetingPinFromReadback,
} from "../lib/meetings/proof-pin.ts";
import type { RoutineRecordClass } from "../lib/civic-data/types.ts";
import {
  preparePublishedMeetingSnapshot,
  readPreparedMeetingsProjection,
} from "../lib/meetings/prepared-snapshot.ts";
import {
  readMeetingsProjection,
  snapshotCounts,
  type MeetingsSnapshot,
} from "../lib/meetings/snapshot.ts";
import { RETIRED_MEETING_ROUTES } from "../lib/registry/source-wiring.ts";
import type { ChildRunReport } from "../lib/sources/composite/index.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { candidateForMeetingPartition, promoteMeetingPartitions } from "../scripts/ingest.ts";

/*
 * A route retired for permission hands its body to a successor partition. The
 * retired partition has no writer from the moment the change lands; until the
 * successor's first promotion its last promoted version is HELD — composed in
 * the successor's place and named on the successor's readback — and the first
 * promotion supersedes it. Never two authorities for one body, never none.
 */

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

// Any URL the meetings authority still admits; the retired host itself left the
// authority with the cutover, which is exactly why its version is held rather
// than re-acquired.
const ACQUIRED_URL = "https://www.pima.edu/about-pima/leadership-policies/governing-board/board-meetings/documents.html";

function row(source: string, suffix: string, startsAt: string, collectedAt: string): Meeting {
  return {
    id: `${source}:pcc:${suffix}`,
    ocdId: successor.ocdId,
    bodyId: successor.bodyId,
    bodyName: "Pima Community College District Governing Board",
    title: `Regular Board Meeting ${suffix}`,
    startsAt,
    timeZone: successor.wiring.timeZone,
    location: null,
    online: { label: "Zoom Webinar", joinUrl: null },
    agendaUrl: null,
    jurisdiction: successor.wiring.jurisdiction,
    status: "SCHEDULED",
    provenance: { sourceUrl: ACQUIRED_URL, sourceOrg: successor.wiring.publishingOrg, collectedAt, verifiedAt: null },
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
  assert.equal(HELD_MEETING_PARTITIONS.length, RETIRED_MEETING_ROUTES.length);
  const registered = new Set(MEETING_PARTITION_CONTRACTS.map((partition) => partition.id));
  for (const route of RETIRED_MEETING_ROUTES) {
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
  const heldVersion = await seedRetiredPointer(store);

  const read = await readMeetingsProjection({ store, bypassCache: true, allowUnconfiguredBootstrap: false, now: READ_AT });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") return;
  assert.deepEqual(
    read.value.meetings.map((meeting) => meeting.id).sort(),
    [`${held!.meetingSource}:pcc:706`, `${held!.meetingSource}:pcc:707`],
    "the body's sittings stay on the page through the cutover",
  );
  const readback = read.partitions.find((partition) => partition.contractId === successor.id)!;
  assert.equal(readback.kind, "NOT_RECORDED", "the successor's own truth: it has no pointer yet");
  assert.equal(readback.versionId, null);
  assert.deepEqual(readback.heldFrom, { contractId: held!.id, scope: held!.scope, versionId: heldVersion });
  assert.match(readback.detail ?? "", /composed in its place until this partition's first promotion/);
  assert.equal(read.partitions.some((partition) => partition.contractId === held!.id), false, "the retired identity is not a partition");
  assert.equal(
    read.value.sources.some((source) => !source.ok && (source.unreachableOcdIds ?? []).includes(successor.ocdId!)),
    false,
    "no calendar-unreachable wall is shown for a body whose held version is composed",
  );
  assert.match(read.detail, /1 composed from a retired route's held version/);
});

test("the successor's first promotion supersedes the held version, which stays in the store untouched", async () => {
  const store = new MemoryRoutineDataStore();
  const heldVersion = await seedRetiredPointer(store);
  const successorVersion = await promoteSuccessor(store);

  const read = await readMeetingsProjection({ store, bypassCache: true, allowUnconfiguredBootstrap: false, now: READ_AT });
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
  const readback = read.partitions.find((partition) => partition.contractId === successor.id)!;
  assert.equal(readback.kind, "PROMOTED");
  assert.equal(readback.versionId, successorVersion);
  assert.equal(readback.heldFrom, undefined);
  assert.equal((await store.readPromotion("MEETING", held!.scope))?.versionId, heldVersion, "nothing moved the held pointer");
});

test("the held pointer is read only while its successor has none; a superseded route costs no further reads", async () => {
  class ScopeCountingStore extends MemoryRoutineDataStore {
    readonly requested: string[][] = [];
    override async readPromotions<T = unknown>(recordClass: RoutineRecordClass, scopes: readonly string[]) {
      this.requested.push([...scopes]);
      return super.readPromotions<T>(recordClass, scopes);
    }
    // The prepare pass asks for pointer identities only (7311f0cf); a held
    // pointer asked for that way is still a read of the retired route.
    override async readPromotionIdentities(recordClass: RoutineRecordClass, scopes: readonly string[]) {
      this.requested.push([...scopes]);
      return super.readPromotionIdentities(recordClass, scopes);
    }
  }
  const asksForHeld = (store: ScopeCountingStore) => store.requested.some((batch) => batch.includes(held!.scope));

  const store = new ScopeCountingStore();
  await seedRetiredPointer(store);
  await readMeetingsProjection({ store, bypassCache: true, allowUnconfiguredBootstrap: false, now: READ_AT });
  await preparePublishedMeetingSnapshot(store, READ_AT);
  assert.equal(asksForHeld(store), true, "in the window, the held version is what the page shows");

  await promoteSuccessor(store);
  store.requested.length = 0;
  await readMeetingsProjection({ store, bypassCache: true, allowUnconfiguredBootstrap: false, now: READ_AT });
  await preparePublishedMeetingSnapshot(store, READ_AT);
  assert.ok(store.requested.length > 0);
  assert.equal(asksForHeld(store), false, "after the first promotion, nothing reads the retired pointer again");
});

test("a Reader proof pin captured while the succession is held keeps composing the held version for the whole run", async () => {
  /*
   * Integration of the held-partition bridge with the Reader proof meeting pin
   * (lib/meetings/proof-pin.ts). The pin selects each REGISTERED partition's
   * version; a successor served from a held version is pinned NOT_RECORDED.
   * If the runner promotes the successor mid-run, the pinned run must still
   * compose what the capture composed — the held version — and never the
   * successor's new rows, or two reads in one run would disagree again.
   */
  clearPromotedReadModelCache();
  const store = new MemoryRoutineDataStore();
  const heldVersion = await seedRetiredPointer(store);
  const capture = await readMeetingsProjection({ store, bypassCache: true, allowUnconfiguredBootstrap: false, now: READ_AT });
  assert.equal(capture.kind, "PROMOTED");
  if (capture.kind !== "PROMOTED") return;
  const pin = readerProofMeetingPinFromReadback(capture.partitions, READ_AT);
  assert.equal(pin.partitions.find((row) => row.contractId === successor.id)?.kind, "NOT_RECORDED");
  const path = join(mkdtempSync(join(tmpdir(), "held-partition-pin-")), "pin.json");
  writeFileSync(path, JSON.stringify(pin));

  await promoteSuccessor(store);
  const env = { [READER_PROOF_MEETING_PIN_ENV]: path, [READER_PROOF_HARNESS_ENV]: "docs/evidence/reader-last-mile-production-authority.json" };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  let pinned: Awaited<ReturnType<typeof readMeetingsProjection>>;
  try {
    pinned = await readMeetingsProjection({ store, bypassCache: true, allowUnconfiguredBootstrap: false, now: READ_AT });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  assert.equal(pinned.kind, "PROMOTED");
  if (pinned.kind !== "PROMOTED") return;
  assert.deepEqual(
    pinned.value.meetings.map((meeting) => meeting.id).sort(),
    [`${held!.meetingSource}:pcc:706`, `${held!.meetingSource}:pcc:707`],
    "the pinned run composes the held version the capture composed, not the successor's mid-run promotion",
  );
  const readback = pinned.partitions.find((partition) => partition.contractId === successor.id)!;
  assert.equal(readback.kind, "NOT_RECORDED");
  assert.deepEqual(readback.heldFrom, { contractId: held!.id, scope: held!.scope, versionId: heldVersion });
  assert.match(pinned.detail, /Reader proof meeting pin/);

  // Outside the pin the successor's own first promotion is what readers see.
  const live = await readMeetingsProjection({ store, bypassCache: true, allowUnconfiguredBootstrap: false, now: READ_AT });
  assert.equal(live.kind, "PROMOTED");
  if (live.kind !== "PROMOTED") return;
  assert.equal(live.partitions.find((partition) => partition.contractId === successor.id)?.kind, "PROMOTED");
});

test("the prepared reader snapshot couples to the held version, then recomposes on the successor's first promotion", async () => {
  const store = new MemoryRoutineDataStore();
  const heldVersion = await seedRetiredPointer(store);

  const first = await preparePublishedMeetingSnapshot(store, READ_AT);
  assert.equal(first.status, "PUBLISHED");
  const servedHeld = await readPreparedMeetingsProjection({ store, now: READ_AT });
  assert.equal(servedHeld.kind, "PROMOTED");
  if (servedHeld.kind !== "PROMOTED") return;
  const heldReadback = servedHeld.partitions.find((partition) => partition.contractId === successor.id)!;
  assert.equal(heldReadback.kind, "NOT_RECORDED");
  assert.deepEqual(heldReadback.heldFrom, { contractId: held!.id, scope: held!.scope, versionId: heldVersion });
  assert.equal(servedHeld.value.meetings.length, 2);

  assert.equal((await preparePublishedMeetingSnapshot(store, READ_AT)).status, "CURRENT", "an unchanged held coupling never recomposes");

  const successorVersion = await promoteSuccessor(store);
  assert.equal((await preparePublishedMeetingSnapshot(store, READ_AT)).status, "PUBLISHED");
  const servedSuccessor = await readPreparedMeetingsProjection({ store, now: READ_AT });
  assert.equal(servedSuccessor.kind, "PROMOTED");
  if (servedSuccessor.kind !== "PROMOTED") return;
  const readback = servedSuccessor.partitions.find((partition) => partition.contractId === successor.id)!;
  assert.equal(readback.kind, "PROMOTED");
  assert.equal(readback.versionId, successorVersion);
  assert.equal(readback.heldFrom, undefined);
  assert.equal(
    servedSuccessor.value.meetings.every((meeting) => meeting.id.startsWith(`${successor.meetingSource}:`)),
    true,
  );
});
