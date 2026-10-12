import assert from "node:assert/strict";
import test from "node:test";

import {
  accountCarriedCollapses,
  snapshotCounts,
  validateSnapshot,
  type MeetingsSnapshot,
  type SnapshotSourceReport,
} from "../lib/meetings/snapshot.ts";
import { collapseDuplicateSittings } from "../lib/sources/composite/index.ts";
import type { Meeting } from "../lib/sources/types.ts";

/**
 * The composed snapshot's accounting when the cross-route merge drops a CARRIED row
 * (lib/meetings/snapshot.ts `accountCarriedCollapses`): a dropped carried row is not a collapsed fresh row.
 */

const GENERATED_AT = "2026-09-26T01:27:53.681Z";
const BODY = "ocd-division/country:us/state:az/place:flagstaff#body:tourism-commission";
const SITTING = "2026-09-24T20:30:00.000Z";
const DROPS = { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 };

function row(id: string, overrides: Partial<Meeting> = {}): Meeting {
  return {
    id,
    ocdId: "ocd-division/country:us/state:az/place:flagstaff",
    bodyId: BODY,
    bodyName: "Tourism Commission",
    title: "Tourism Commission",
    startsAt: SITTING,
    timeZone: "America/Phoenix",
    location: null,
    agendaUrl: null,
    jurisdiction: "Flagstaff, AZ",
    status: "SCHEDULED",
    provenance: { sourceUrl: "https://www.flagstaff.az.gov/calendar", sourceOrg: "City of Flagstaff", collectedAt: GENERATED_AT, verifiedAt: null },
    ...overrides,
  };
}

const carriedFromFeed = row("ical:derived-state-az-place-flagstaff-body-tourism-commission:3031", {
  carried: { reason: "UNEXPLAINED_DISAPPEARANCE", source: "ical", lastFreshAt: "2026-09-25T06:48:16.960Z" },
  provenance: { sourceUrl: "https://www.flagstaff.az.gov/calendar.ics", sourceOrg: "City of Flagstaff", collectedAt: "2026-09-25T06:48:16.960Z", verifiedAt: null },
});
const freshFromPage = row("official-page-events:derived-state-az-place-flagstaff-body-tourism-commission:2026-09-24T1330:board-meeting");
const feedReport: SnapshotSourceReport = { source: "ical", ok: true, error: null, fetched: 0, normalized: 0, carriedForward: 1, drops: DROPS };
const pageReport: SnapshotSourceReport = { source: "official-page-events", ok: true, error: null, fetched: 1, normalized: 1, drops: DROPS };

function compose(
  partitions: readonly Pick<MeetingsSnapshot, "meetings" | "sources">[],
  accounting: "NEW" | "OLD" = "NEW",
): MeetingsSnapshot {
  const meetings = partitions.flatMap((partition) => partition.meetings);
  const sources = partitions.flatMap((partition) => partition.sources);
  const collapsed = collapseDuplicateSittings(meetings);
  const accounted = accountCarriedCollapses(partitions, sources, collapsed.dropped);
  return {
    formatVersion: 1,
    generatedAt: GENERATED_AT,
    counts: snapshotCounts(collapsed.rows, accounting === "NEW" ? accounted.freshCollapsed : collapsed.dropped.length),
    sources: accounting === "NEW" ? [...accounted.sources] : sources,
    meetings: collapsed.rows,
    agendaDocuments: [],
  };
}

test("the Flagstaff shape: a carried row collapsed into a fresh listing of the same sitting reconciles, and the collapse is stated on its own report", () => {
  const family = { meetings: [carriedFromFeed, freshFromPage], sources: [feedReport, pageReport] };
  assert.throws(() => validateSnapshot(compose([family], "OLD")), /1 fresh meetings plus 1 collapsed but sources claim 1/, "the old accounting refuses the composition");
  const snapshot = compose([family]);
  validateSnapshot(snapshot);
  assert.deepEqual(snapshot.meetings.map((meeting) => meeting.id), [freshFromPage.id], "the sitting is listed once, by the fresh route");
  assert.deepEqual(snapshot.counts, { fresh: 1, duplicatesCollapsed: 0, carried: 0, total: 1 });
  assert.deepEqual(snapshot.sources.find((report) => report.source === "ical"), { ...feedReport, carriedForward: 0, carriedCollapsed: 1 });
  assert.deepEqual(family.sources, [feedReport, pageReport], "the partition's own reports are unchanged");
  assert.equal(feedReport.carriedForward, 1);
});

test("a dropped fresh row is still a collapsed duplicate, whichever row wins", () => {
  const second = row("schedulepage:flagstaff-tourism:2026-09-24");
  const other = { meetings: [second], sources: [{ source: "schedulepage", ok: true, error: null, fetched: 1, normalized: 1, drops: DROPS }] satisfies SnapshotSourceReport[] };
  const page = { meetings: [freshFromPage], sources: [pageReport] };
  const snapshot = compose([page, other]);
  validateSnapshot(snapshot);
  assert.equal(snapshot.meetings.length, 1);
  assert.equal(snapshot.counts.duplicatesCollapsed, 1);
  assert.ok(snapshot.sources.every((report) => report.carriedCollapsed === undefined));
});

test("a row carried after a failed read is charged to the failed report, never to a successful one", () => {
  const failedFeed: SnapshotSourceReport = { source: "ical", ok: false, error: "the feed timed out", failure: "WALL", fetched: 0, normalized: 0, carriedForward: 1, drops: DROPS };
  const carried = { ...carriedFromFeed, carried: { reason: "SOURCE_UNAVAILABLE" as const, source: "ical", lastFreshAt: "2026-09-25T06:48:16.960Z" } };
  const answeredFeed: SnapshotSourceReport = { source: "ical", ok: true, error: null, fetched: 0, normalized: 0, drops: DROPS };
  const family = { meetings: [carried, freshFromPage], sources: [answeredFeed, failedFeed, pageReport] };
  const accounted = accountCarriedCollapses([family], family.sources, collapseDuplicateSittings([...family.meetings]).dropped);
  assert.deepEqual(accounted.sources, [answeredFeed, { ...failedFeed, carriedForward: 0, carriedCollapsed: 1 }, pageReport]);
});

test("a carried row with no report of its kind to charge is left unaccounted, and validation refuses the snapshot as before", () => {
  // Carried after a failed read, but the partition states only a successful read of that route.
  const carried = { ...carriedFromFeed, carried: { reason: "SOURCE_UNAVAILABLE" as const, source: "ical", lastFreshAt: "2026-09-25T06:48:16.960Z" } };
  const snapshot = compose([{ meetings: [carried, freshFromPage], sources: [feedReport, pageReport] }]);
  assert.ok(snapshot.sources.every((report) => report.carriedCollapsed === undefined));
  assert.throws(() => validateSnapshot(snapshot), /ical: reports 1 meeting\(s\) carried forward but 0 row\(s\) carry its mark/);
});

test("a stated carriedCollapsed must be a positive integer", () => {
  const family = { meetings: [carriedFromFeed, freshFromPage], sources: [feedReport, pageReport] };
  const snapshot = compose([family]);
  const edited = { ...snapshot, sources: snapshot.sources.map((report) => report.source === "ical" ? { ...report, carriedCollapsed: 0 } : report) };
  assert.throws(() => validateSnapshot(edited), /carriedCollapsed must be stated as a positive integer/);
});
