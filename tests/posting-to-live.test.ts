import assert from "node:assert/strict";
import test from "node:test";

import { postingToLiveFromVersion } from "../lib/civic-data/posting-to-live.ts";

import { publisherPostedAt as icalPostedAt } from "../lib/sources/ical/index.ts";
import { publisherPostedAt as legistarPostedAt } from "../lib/sources/legistar/index.ts";
import type { LegistarEvent } from "../lib/sources/legistar/types.ts";

const FIRST = "2026-10-01T12:00:00.000Z";
const SECOND = "2026-10-01T15:00:00.000Z";

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
