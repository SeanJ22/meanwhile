import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import { readPostingToLive, postingToLiveFromVersion, readbackPassAt } from "../lib/civic-data/posting-to-live.ts";
import { repairMeetingReaderProjectionReadbacks } from "../lib/civic-data/reader-verification.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { publisherPostedAt as icalPostedAt } from "../lib/sources/ical/index.ts";
import { publisherPostedAt as legistarPostedAt } from "../lib/sources/legistar/index.ts";
import type { LegistarEvent } from "../lib/sources/legistar/types.ts";
import type { Meeting } from "../lib/sources/types.ts";
import type { ChildRunReport } from "../lib/sources/composite/index.ts";
import { promoteMeetingPartitions } from "../scripts/ingest.ts";

/** DB-27: four times kept apart for each change, and the clock stops at the reader readback PASS. */

const legistar = MEETING_PARTITION_CONTRACTS.find((partition) => partition.meetingSource === "legistar")!;
const url = "https://webapi.legistar.com/v1/pima/events";
const FIRST = "2026-10-01T12:00:00.000Z";
const SECOND = "2026-10-01T15:00:00.000Z";
const POSTED = "2026-10-01T14:20:00.000Z";
const LIVE = "2026-10-01T15:07:00.000Z";

function meeting(suffix: string, extra: Partial<Meeting> = {}): Meeting {
  return {
    id: `legistar:${suffix}`, ocdId: legistar.ocdId, bodyId: legistar.bodyId, bodyName: "Board", title: "Board meeting",
    startsAt: "2026-10-03T17:00:00.000Z", timeZone: legistar.wiring!.timeZone, location: null, agendaUrl: null,
    jurisdiction: legistar.wiring!.jurisdiction, status: "SCHEDULED",
    provenance: { sourceUrl: url, sourceOrg: legistar.wiring!.publishingOrg, collectedAt: FIRST, verifiedAt: null },
    ...extra,
  };
}

function report(at: string): ChildRunReport {
  const bytes = `legistar:${at}`;
  return {
    source: "legistar", ok: true, error: null, fetched: 1, normalized: 1,
    drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
    acquisitions: [{ source: "legistar", requestedUrl: url, finalUrl: url, httpStatus: 200, rawHash: createHash("sha256").update(bytes).digest("hex"), byteCount: bytes.length }],
  };
}

test("DB-27: the publisher's own stamps are read as stamps, never as our clock", () => {
  const event = { EventAgendaLastPublishedUTC: "2026-08-25T18:04:04.46", EventMinutesLastPublishedUTC: "2026-08-26T09:00:00" } as LegistarEvent;
  assert.equal(legistarPostedAt(event), "2026-08-26T09:00:00.000Z", "the later of agenda and minutes, read as UTC");
  assert.equal(legistarPostedAt({} as LegistarEvent), null);
  assert.equal(icalPostedAt({ lastModified: "20260420T133910Z" }), "2026-04-20T13:39:10.000Z");
  assert.equal(icalPostedAt({ lastModified: null }), null, "DTSTAMP is never used");
});

test("DB-27: a new meeting, a new agenda link and a status change are each their own measured change", () => {
  const rows = postingToLiveFromVersion({
    versionId: "v2", firstSeenAt: "2026-10-01T12:00:00.000Z", liveAt: "2026-10-01T12:40:00.000Z", lastUnchangedAt: "2026-10-01T13:00:00.000Z",
    changeSet: {
      added: [{ key: "meeting:a", before: null, after: { id: "a", startsAt: "2026-10-03T17:00:00.000Z", status: "SCHEDULED", agendaUrl: "https://x/a.pdf", postedAt: "2026-10-01T11:30:00.000Z" } }],
      changed: [
        { key: "meeting:b", before: { id: "b", startsAt: "2026-10-03T17:00:00.000Z", status: "SCHEDULED", agendaUrl: null }, after: { id: "b", startsAt: "2026-10-03T17:00:00.000Z", status: "SCHEDULED", agendaUrl: "https://x/b.pdf" } },
        { key: "meeting:c", before: { id: "c", startsAt: "2026-12-03T17:00:00.000Z", status: "SCHEDULED", agendaUrl: null }, after: { id: "c", startsAt: "2026-12-03T17:00:00.000Z", status: "CANCELED", agendaUrl: null } },
      ],
    },
  });
  const by = (key: string, kind: string) => rows.find((row) => row.recordKey === key && row.kind === kind)!;
  assert.deepEqual(rows.map((row) => `${row.recordKey}:${row.kind}`), ["meeting:a:MEETING_NEW", "meeting:a:AGENDA_LINK", "meeting:b:AGENDA_LINK", "meeting:c:STATUS"]);
  const posted = by("meeting:a", "AGENDA_LINK");
  assert.equal(posted.basis, "POSTED");
  assert.equal(posted.postedAt, "2026-10-01T11:30:00.000Z");
  assert.equal(posted.minutesToLive, 70, "from the publisher's stamp to live");
  const seen = by("meeting:b", "AGENDA_LINK");
  assert.equal(seen.basis, "FIRST_SEEN");
  assert.equal(seen.postedAt, null);
  assert.equal(seen.minutesToLive, 40, "from first seen, and labelled so");
  assert.equal(seen.lastUnchangedAt, "2026-10-01T13:00:00.000Z");
  assert.equal(seen.insideSevenDayWindow, true);
  assert.equal(by("meeting:c", "STATUS").insideSevenDayWindow, false);
  // Until the readback passes there is no live time, and so no figure.
  const pending = postingToLiveFromVersion({ versionId: "v", firstSeenAt: FIRST, liveAt: null, lastUnchangedAt: null, changeSet: { added: [{ key: "meeting:z", before: null, after: { id: "z", startsAt: FIRST } }], changed: [] } });
  assert.equal(pending[0]!.minutesToLive, null);
  assert.equal(pending[0]!.liveAt, null);
});

test("DB-27: an unchanged stamp is not a new posting", () => {
  const rows = postingToLiveFromVersion({
    versionId: "v", firstSeenAt: FIRST, liveAt: SECOND, lastUnchangedAt: null,
    changeSet: { added: [], changed: [{ key: "meeting:x", before: { id: "x", startsAt: FIRST, status: "SCHEDULED", agendaUrl: null, postedAt: "2026-09-01T00:00:00.000Z" }, after: { id: "x", startsAt: FIRST, status: "SCHEDULED", agendaUrl: "https://x/x.pdf", postedAt: "2026-09-01T00:00:00.000Z" } }] },
  });
  assert.equal(rows[0]!.basis, "FIRST_SEEN", "the stamp did not move with this change, so it dates nothing about it");
});

test("DB-27: read from the store, the clock stops at the readback PASS of the version", async () => {
  const store = new MemoryRoutineDataStore();
  const seed = await promoteMeetingPartitions({ store, partitions: [legistar], meetings: [meeting("sitting")], agendaDocuments: [], reports: [report(FIRST)], generatedAt: FIRST });
  assert.equal(seed[0]?.outcome.candidate.state, "PROMOTED");
  const [changed] = await promoteMeetingPartitions({
    store, partitions: [legistar], meetings: [meeting("sitting", { agendaUrl: "https://example.gov/agenda/1.pdf", postedAt: POSTED })], agendaDocuments: [],
    reports: [report(SECOND)], generatedAt: SECOND,
  });
  const versionId = changed!.outcome.promoted!.versionId;
  const before = await readPostingToLive(store, versionId);
  assert.ok(before);
  const agenda = before!.find((row) => row.kind === "AGENDA_LINK")!;
  assert.equal(agenda.basis, "POSTED");
  assert.equal(agenda.postedAt, POSTED);
  assert.equal(agenda.firstSeenAt, SECOND);
  assert.equal(agenda.liveAt, null, "promoted but not yet read back");
  assert.equal(agenda.minutesToLive, null);

  await repairMeetingReaderProjectionReadbacks(store, [legistar], LIVE, "f".repeat(40));
  const after = (await readPostingToLive(store, versionId))!.find((row) => row.kind === "AGENDA_LINK")!;
  assert.equal(after.liveAt, LIVE);
  assert.equal(after.minutesToLive, 47, "posted 14:20, live 15:07");
  assert.equal(readbackPassAt(await store.events(versionId), versionId), LIVE);
  assert.equal(await readPostingToLive(store, "cv-nothing-here"), null);
});
