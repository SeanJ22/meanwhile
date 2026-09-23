import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";

import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { searchMeetings } from "../lib/meetings/query.ts";
import { snapshotSourceFor } from "../lib/meetings/registry.ts";
import { readMeetingsProjection, validateSnapshot } from "../lib/meetings/snapshot.ts";
import { collapseDuplicateSittings, type ChildRunReport } from "../lib/sources/composite/index.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { promoteMeetingPartitions } from "../scripts/ingest.ts";

const { MergedListingsNotice } = await tsImport("../components/map/meeting-listing-notice.tsx", import.meta.url) as typeof import("../components/map/meeting-listing-notice.tsx");

const NEWBURY = "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town";
const SELECTBOARD = `${NEWBURY}#governing`;
const FEED = "https://www.newbury.nh.gov/calendar/ical/export.ics";
const COLLECTED = "2026-09-22T21:49:11.096Z";

/** A row exactly as production held it on 2026-09-22 (ZIP 03255): only the series id and its page differ. */
function listing(series: number, startsAt = "2026-10-26T22:00:00.000Z", over: Partial<Meeting> = {}): Meeting {
  return {
    id: `ical:newbury-ical-governing:calendar.${series}.field_date_and_time.0@www.newbury.nh.gov`,
    ocdId: NEWBURY,
    bodyId: SELECTBOARD,
    bodyName: "Selectboard",
    title: "Selectboard Meeting",
    startsAt,
    startPrecision: "MINUTE",
    timeZone: "America/New_York",
    location: { lat: 43.321682, lng: -72.03705, name: "Newbury Town Office", address: "937 Route 103, Newbury, NH 03255" },
    agendaUrl: null,
    jurisdiction: "Newbury, NH",
    status: "SCHEDULED",
    provenance: {
      sourceOrg: "Town of Newbury",
      sourceUrl: `https://www.newbury.nh.gov/home/events/${series}`,
      verifiedAt: null,
      collectedAt: COLLECTED,
    },
    ...over,
  };
}

test("Newbury: two calendar series listing one Selectboard sitting are ONE row carrying BOTH listings", () => {
  const original = listing(42976);
  const repeat = listing(44076);
  const { rows, collapsed, dropped } = collapseDuplicateSittings([repeat, original]);
  assert.equal(collapsed, 1);
  assert.equal(rows.length, 1);
  assert.deepEqual(dropped.map(({ id }) => id), [repeat.id]);
  const [sitting] = rows;
  assert.equal(sitting!.id, original.id, "the lower series id stands for the sitting whatever the feed order");
  assert.deepEqual(sitting!.listings?.map(({ id }) => id), [original.id, repeat.id]);
  assert.deepEqual(sitting!.listings?.map(({ provenance }) => provenance.sourceUrl), [
    "https://www.newbury.nh.gov/home/events/42976",
    "https://www.newbury.nh.gov/home/events/44076",
  ]);

  const markup = renderToStaticMarkup(createElement(MergedListingsNotice, { listings: sitting!.listings }));
  assert.ok(markup.includes("Listed 2 times"), markup);
  for (const url of ["https://www.newbury.nh.gov/home/events/42976", "https://www.newbury.nh.gov/home/events/44076"]) {
    assert.ok(markup.includes(`href="${url}"`), url);
  }
});

test("the reader composition states one row per sitting, and the rows it states are the rows it serves", async () => {
  const partition = MEETING_PARTITION_CONTRACTS.find((row) => row.meetingSource === "ical" && row.bodyId === SELECTBOARD);
  assert.ok(partition);
  const at = "2026-09-22T21:49:16.438Z";
  const sittings = ["2026-10-26T22:00:00.000Z", "2026-11-09T23:00:00.000Z"];
  const held = sittings.flatMap((startsAt, index) => [listing(42976 + index * 5, startsAt), listing(44076 + index * 5, startsAt)]);
  const bytes = "BEGIN:VCALENDAR";
  const report: ChildRunReport = {
    source: "ical", ok: true, error: null, fetched: held.length, normalized: held.length,
    drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
    acquisitions: [{ source: "ical", requestedUrl: FEED, finalUrl: FEED, httpStatus: 200,
      rawHash: createHash("sha256").update(bytes).digest("hex"), byteCount: bytes.length }],
  };
  const store = new MemoryRoutineDataStore();
  const [promoted] = await promoteMeetingPartitions({ store, partitions: [partition], meetings: held, agendaDocuments: [], reports: [report], generatedAt: at });
  assert.equal(promoted?.outcome.candidate.state, "PROMOTED", promoted?.outcome.candidate.failureDetail ?? "");
  assert.equal((promoted?.outcome.promoted?.payload as { meetings: Meeting[] }).meetings.length, 4, "the partition keeps every listing as its own row");

  const read = await readMeetingsProjection({ store, bypassCache: true, allowUnconfiguredBootstrap: false, now: at });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") return;
  const snapshot = read.value;
  const selectboard = snapshot.meetings.filter((meeting) => meeting.bodyId === SELECTBOARD);
  assert.equal(selectboard.length, 2);
  assert.equal(snapshot.counts.total, snapshot.meetings.length, "stated N equals rendered rows");
  assert.equal(snapshot.counts.duplicatesCollapsed, 2);
  assert.ok(selectboard.every((meeting) => meeting.listings?.length === 2));
  validateSnapshot(snapshot, { allowAllSourcesFailedForDurableTransfer: true });

  // The reader's own path: the route hands this snapshot to searchMeetings.
  const result = await searchMeetings(43.321682, -72.03705, 25, new Date(at), new Set([NEWBURY]), snapshotSourceFor(snapshot));
  const onScreen = result.meetings.filter((meeting) => meeting.bodyId === SELECTBOARD);
  assert.deepEqual(onScreen.map(({ startsAt }) => startsAt), sittings);
  assert.deepEqual(onScreen.map((meeting) => meeting.listings?.map(({ id }) => id)), [
    [listing(42976).id, listing(44076).id],
    [listing(42981).id, listing(44081).id],
  ]);
});

test("different meetings at the same hour stay separate: a different title or status is a different sitting", () => {
  const regular = listing(42976);
  const workSession = listing(44076, undefined, { title: "Selectboard Work Session" });
  const canceled = listing(45000, undefined, { status: "CANCELED" });
  const { rows, collapsed } = collapseDuplicateSittings([regular, workSession, canceled]);
  assert.equal(collapsed, 0);
  assert.deepEqual(rows.map(({ id }) => id), [regular.id, workSession.id, canceled.id]);
  assert.ok(rows.every((row) => row.listings === undefined));
});

test("the merge never drops a carried row, a date-only row, or one of two document-holding listings", () => {
  const carried = listing(44076, undefined, { carried: { source: "ical", lastFreshAt: "2026-09-01T00:00:00.000Z", reason: "UNEXPLAINED_DISAPPEARANCE" } });
  assert.equal(collapseDuplicateSittings([listing(42976), carried]).rows.length, 2);

  const dateOnly = (series: number) => listing(series, "2026-10-26T04:00:00.000Z", { startPrecision: "DAY" });
  assert.equal(collapseDuplicateSittings([dateOnly(42976), dateOnly(44076)]).rows.length, 2);

  const both = collapseDuplicateSittings([listing(42976), listing(44076)], { holdsDocuments: () => true });
  assert.equal(both.rows.length, 2, "either listing could hold a document version the other does not");

  const one = collapseDuplicateSittings([listing(42976), listing(44076)], { holdsDocuments: (id) => id.includes("44076") });
  assert.equal(one.rows.length, 1);
  assert.equal(one.rows[0]!.id, listing(44076).id, "the listing holding the documents keeps its sitting");
});

test("the cross-source merge now carries the listing it absorbs instead of dropping it silently", () => {
  const withAgenda = listing(42976, undefined, {
    id: "diligent:newburynh:3370",
    title: "Selectboard",
    agendaUrl: "https://newburynh.civicweb.net/Portal/MeetingInformation.aspx?Id=3370",
    provenance: { sourceOrg: "Town of Newbury", sourceUrl: "https://newburynh.civicweb.net/Portal/MeetingInformation.aspx?Id=3370", verifiedAt: null, collectedAt: COLLECTED },
  });
  const { rows, collapsed } = collapseDuplicateSittings([listing(42976), withAgenda, listing(44076)]);
  assert.equal(collapsed, 2);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.id, withAgenda.id, "the agenda-bearing listing still wins across sources");
  assert.deepEqual(rows[0]!.listings?.map(({ id }) => id), [withAgenda.id, listing(42976).id, listing(44076).id]);
  assert.deepEqual(rows[0]!.listings?.map(({ title }) => title), ["Selectboard", "Selectboard Meeting", "Selectboard Meeting"]);
});
