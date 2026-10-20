import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { installFactReader } from "../lib/facts/db.ts";
import type { VenueEntry } from "../lib/meetings/venue-cache.ts";
import { snapshotCounts, type MeetingsSnapshot } from "../lib/meetings/snapshot.ts";
import type { ChildRunReport } from "../lib/sources/composite/index.ts";
import type { Meeting } from "../lib/sources/types.ts";
import {
  placeCarriedFromReviewedVenue,
  promoteMeetingPartition,
  reconcileSuccessfulMeetingPartition,
} from "../scripts/ingest.ts";
import { freshEdge, publishPass, readPlace } from "./helpers/meeting-body-fixtures.ts";

const PARTITION = MEETING_PARTITION_CONTRACTS.find((partition) =>
  partition.meetingSource === "official-page-events" &&
  (partition.wiring?.config as { slug?: string } | undefined)?.slug === "tusd1-reconfiguration",
)!;
const PAGE = "https://www.tusd1.org/Reconfiguration";

const LAST_LISTED = "2026-09-24T05:55:08.378Z";
const NEXT_READ = "2026-09-24T21:14:38.903Z";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const CHOLLA: VenueEntry = {
  sourceId: "official-page-events",
  bodyOcdId: "ocd-division/country:us/state:az/school_district:tucson_unified_district",
  match: "Cholla High School South Gym",
  name: "Cholla High School, South Gym",
  address: "2001 W. Starr Pass Blvd., Tucson, AZ 85713",
  lat: 32.20685,
  lng: -111.009039,
  addressSourceUrl: "https://chollahs.tusd1.org/contactus",
  coordinateSourceUrl:
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=2001+W+Starr+Pass+Blvd%2C+Tucson%2C+AZ+85713&benchmark=Public_AR_Current&format=json",
  verifiedAt: "2026-09-24",
};

const SEPT_23: Meeting = {
  id: "official-page-events:tusd1-reconfiguration:2026-09-23T1600:community-engagement-session",
  ocdId: PARTITION.ocdId,
  bodyId: PARTITION.bodyId,
  bodyName: "Tucson Unified School District",
  title: "Tucson Unified Facility Plans Community Engagement",
  eventType: "Community engagement session",
  startsAt: "2026-09-23T16:00:00-07:00",
  startPrecision: "MINUTE",
  endsAt: "2026-09-23T18:30:00-07:00",
  timeZone: "America/Phoenix",
  location: null,
  venueGap: { kind: "STATED_NOT_PLACED", publishedText: "Cholla High School South Gym", publisher: "Tucson Unified School District" },
  agendaUrl: null,
  jurisdiction: "Tucson Unified School District, AZ",
  status: "CONCLUDED",
  provenance: {
    sourceUrl: PAGE,
    sourceOrg: "Tucson Unified School District",
    collectedAt: LAST_LISTED,
    verifiedAt: null,
    evidenceExcerpt:
      "Tucson Unified Facility Plans Community Engagement | 9/23/2026 | Cholla High School South Gym | 4:00pm - 6:30pm | Consolidation | Cholla High School | RSVP for Community Engagement",
  },
};

const SEPT_26: Meeting = {
  ...SEPT_23,
  id: "official-page-events:tusd1-reconfiguration:2026-09-26T0900:community-engagement-session",
  startsAt: "2026-09-26T09:00:00-07:00",
  endsAt: "2026-09-26T11:30:00-07:00",
  location: { name: "Tucson High Magnet School, East Gym", address: "400 N. 2nd Ave., Tucson, AZ 85705", lat: 32.227621, lng: -110.962451 },
  venueGap: undefined,
  status: "SCHEDULED",
  provenance: {
    sourceUrl: PAGE,
    sourceOrg: "Tucson Unified School District",
    collectedAt: NEXT_READ,
    verifiedAt: null,
    evidenceExcerpt:
      "Tucson Unified Facility Plans Community Engagement | 9/26/2026 | Tucson High Magnet School East Gym | 9:00am - 11:30am | Consolidation | Tucson High Magnet | RSVP for Community Engagement",
  },
};
delete (SEPT_26 as { venueGap?: unknown }).venueGap;

const venues = (...rows: VenueEntry[]) => () => rows;

function answered(at: string, rows: number): ChildRunReport {
  const bytes = `official-page-events tusd1-reconfiguration page read at ${at}`;
  return {
    source: "official-page-events",
    ok: true,
    error: null,
    fetched: rows,
    normalized: rows,
    drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
    acquisitions: [{
      source: "official-page-events",
      requestedUrl: PAGE,
      finalUrl: PAGE,
      httpStatus: 200,
      rawHash: sha256(bytes),
      byteCount: Buffer.byteLength(bytes),
    }],
  };
}

function partitionSnapshot(at: string, meetings: readonly Meeting[]): MeetingsSnapshot {
  const fresh = meetings.filter((row) => !row.carried).length;
  const carried = meetings.length - fresh;
  return {
    formatVersion: 1,
    generatedAt: at,
    counts: snapshotCounts([...meetings], 0),
    sources: [{ ...answered(at, fresh), error: null, ...(carried > 0 ? { carriedForward: carried } : {}) }],
    meetings: [...meetings],
    agendaDocuments: [],
  };
}

function reconcile(reviewedVenues?: () => readonly VenueEntry[]) {
  return reconcileSuccessfulMeetingPartition({
    sourceName: PARTITION.meetingSource,
    generatedAt: NEXT_READ,
    freshMeetings: [SEPT_26],
    freshAgendaDocuments: [],
    previous: partitionSnapshot(LAST_LISTED, [SEPT_23]),
    ...(reviewedVenues ? { reviewedVenues } : {}),
  });
}

test("CARRIED-PLACE · (a) the measured case: the carried 23 September session is placed at the reviewed venue for its own words, and stays carried", () => {
  assert.ok(PARTITION, "the Tucson Unified Reconfiguration partition is registered");
  const reconciled = reconcile(venues(CHOLLA));
  const row = reconciled.meetings.find(({ id }) => id === SEPT_23.id)!;
  assert.deepEqual(row.location, { name: CHOLLA.name, address: CHOLLA.address, lat: CHOLLA.lat, lng: CHOLLA.lng });
  assert.equal("venueGap" in row, false);
  assert.deepEqual(row.carried, { source: "official-page-events", lastFreshAt: LAST_LISTED, reason: "UNEXPLAINED_DISAPPEARANCE" });
  assert.deepEqual(reconciled.carriedMeetingIds, [SEPT_23.id]);
  const { location: _l, venueGap: _g, carried: _c, ...facts } = SEPT_23;
  const { location: _l2, carried: _c2, ...carriedFacts } = row;
  assert.deepEqual(carriedFacts, facts);
});

test("CARRIED-PLACE · (b) with no reviewed venue for its words, or no venues handed in, the carried row keeps its stated words and no pin", () => {
  for (const [label, reconciled] of [
    ["no matching venue", reconcile(venues({ ...CHOLLA, match: "Cholla High School North Gym" }))],
    ["venues omitted", reconcile()],
  ] as const) {
    const row = reconciled.meetings.find(({ id }) => id === SEPT_23.id)!;
    assert.equal(row.location, null, label);
    assert.deepEqual(row.venueGap, SEPT_23.venueGap, label);
  }
});

test("CARRIED-PLACE · (c) only the row's own division places it; unstated, online, placed and division-less rows are returned as they were", () => {
  const elsewhere = { ...CHOLLA, bodyOcdId: "ocd-division/country:us/state:az/county:pima" };
  assert.equal(placeCarriedFromReviewedVenue(SEPT_23, "official-page-events", venues(elsewhere)), SEPT_23);
  assert.equal(placeCarriedFromReviewedVenue(SEPT_23, "ical", venues(CHOLLA)), SEPT_23);
  const unstated: Meeting = { ...SEPT_23, venueGap: { kind: "NOT_STATED_BY_PUBLISHER", publishedText: null, publisher: "Tucson Unified School District" } };
  const online: Meeting = { ...SEPT_23, online: { label: "Via Zoom Webinar", joinUrl: null } };
  const placed: Meeting = { ...SEPT_26 };
  const divisionless: Meeting = { ...SEPT_23, ocdId: null };
  let read = 0;
  const counted = () => { read += 1; return [CHOLLA]; };
  for (const row of [unstated, online, placed, divisionless]) {
    assert.equal(placeCarriedFromReviewedVenue(row, "official-page-events", counted), row);
  }
  assert.equal(read, 0, "the venue projection is read only for a row that needs it");
});

test("CARRIED-PLACE · (d) the promotion door accepts the placed carried row, and a reader is served its pin", async (t) => {
  const store = new MemoryRoutineDataStore();
  const seeded = await promoteMeetingPartition(store, PARTITION, partitionSnapshot(LAST_LISTED, [SEPT_23]));
  assert.equal(seeded.outcome.candidate.state, "PROMOTED", seeded.outcome.candidate.failureDetail ?? "");
  const reconciled = reconcile(venues(CHOLLA));
  const accepted = await promoteMeetingPartition(store, PARTITION, partitionSnapshot(NEXT_READ, reconciled.meetings), [], reconciled.removalEvidence);
  assert.equal(accepted.outcome.candidate.state, "PROMOTED", accepted.outcome.candidate.failureDetail ?? "");
  const factReads: string[] = [];
  installFactReader(async text => {
    factReads.push(text);
    assert.fail("published meeting composition must not query facts");
  });
  t.after(() => installFactReader(undefined));
  const edge = freshEdge();
  await publishPass(store, edge, NEXT_READ);
  const read = await readPlace(edge, store, [PARTITION.ocdId!], NEXT_READ);
  assert.deepEqual(factReads, [], "published meeting composition does not query facts");
  assert.equal(read.kind, "PROMOTED");
  const served = (read as { value: MeetingsSnapshot }).value.meetings.find(({ id }) => id === SEPT_23.id)!;
  assert.deepEqual(served.location, { name: CHOLLA.name, address: CHOLLA.address, lat: CHOLLA.lat, lng: CHOLLA.lng });
  assert.equal(served.carried?.reason, "UNEXPLAINED_DISAPPEARANCE");
});
