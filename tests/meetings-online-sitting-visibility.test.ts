import assert from "node:assert/strict";
import { test } from "node:test";

import { meetingBodyIds, searchMeetings } from "../lib/meetings/query.ts";
import { snapshotSourceFor } from "../lib/meetings/registry.ts";
import type { Meeting } from "../lib/sources/types.ts";

/** The instant the fixture is judged at. */
const NOW = new Date("2026-09-24T06:07:00.000Z");

const AT_85701 = { lat: 32.2217, lng: -110.9695 };
const DIVISIONS_AT_85701: ReadonlySet<string> = new Set([
  "ocd-division/country:us/state:az",
  "ocd-division/country:us/state:az/county:pima",
  "ocd-division/country:us/state:az/place:tucson",
]);
const DISTRICT_OFFICE = { lat: 32.2217, lng: -110.8871 };

type Place = { building: string; lat: number; lng: number } | { online: string };

function sitting(id: string, startsAt: string, place: Place, fields: Partial<Meeting> = {}): Meeting {
  return {
    id,
    ocdId: "ocd-division/country:us/state:az/county:pima",
    bodyId: "curated:az/pima-community-college#governing",
    bodyName: "Governing Board",
    title: id.split(":").at(-1)!,
    startsAt,
    timeZone: "America/Phoenix",
    location: "building" in place
      ? { name: place.building, address: null, lat: place.lat, lng: place.lng }
      : null,
    ...("online" in place ? { online: { label: place.online, joinUrl: null } } : {}),
    agendaUrl: null,
    jurisdiction: "Pima County, AZ",
    status: Date.parse(startsAt) < NOW.getTime() ? "CONCLUDED" : "SCHEDULED",
    provenance: {
      sourceUrl: "https://www.pima.edu/about-pima/leadership/board-of-governors/",
      sourceOrg: "Pima Community College",
      collectedAt: "2026-09-24T05:55:00.000Z",
      verifiedAt: null,
    },
    ...fields,
  };
}

const COMMITTEE = { bodyName: "Finance and Audit Committee" };

const PCC = [
  sitting("pima-edu:pcc:2026-08-10-study-session", "2026-08-10T17:00:00-07:00", { online: "VIRTUAL MEETING" }),
  sitting("pima-edu:pcc:2026-08-28-committee", "2026-08-28T09:00:00-07:00", { online: "Zoom Webinar" }, COMMITTEE),
  sitting("pima-edu:pcc:2026-09-25-regular", "2026-09-25T17:30:00-07:00", {
    building: "PCC District Office, Community/Board Room C-105",
    ...DISTRICT_OFFICE,
  }),
  sitting("pima-edu:pcc:2026-10-16-committee", "2026-10-16T09:00:00-07:00", { online: "Zoom Webinar" }, COMMITTEE),
];
const PCC_IDS = PCC.map((m) => m.id);
const PCC_CONCLUDED_ONLINE = ["pima-edu:pcc:2026-08-10-study-session", "pima-edu:pcc:2026-08-28-committee"];

function served(meetings: Meeting[]) {
  return snapshotSourceFor({
    formatVersion: 1,
    generatedAt: "2026-09-24T05:55:00.000Z",
    counts: { fresh: meetings.length, carried: 0, total: meetings.length },
    sources: [],
    meetings,
    agendaDocuments: [],
  });
}

const ids = (meetings: readonly Meeting[]) => meetings.map((m) => m.id);

const COUNTY = "ocd-division/country:us/state:az/county:pima";
const BODY_ID = "curated:az/pima-community-college#governing";
/** The college's board is registered for the county, as the registry names it. */
const COLLEGE = [{ id: BODY_ID, ocdId: COUNTY }];

test("a place keeps its physical and online meetings together", async () => {
  const result = await searchMeetings(AT_85701.lat, AT_85701.lng, 25, NOW, DIVISIONS_AT_85701, served(PCC), undefined, meetingBodyIds(COLLEGE, DIVISIONS_AT_85701));
  assert.equal(result.tier, "exact");
  assert.equal(result.radiusKm, 25);
  assert.deepEqual(ids(result.meetings), PCC_IDS);
  assert.deepEqual(ids(result.meetings.filter(m => m.status === "CONCLUDED")), PCC_CONCLUDED_ONLINE);
});

test("a nearby venue cannot bring another government's online meetings into the place", async () => {
  const outside = new Set(["ocd-division/country:us/state:az/county:cochise"]);
  const result = await searchMeetings(AT_85701.lat, AT_85701.lng, 150, NOW, outside, served(PCC), undefined, meetingBodyIds(COLLEGE, outside));
  assert.equal(result.tier, "none");
  assert.deepEqual(result.meetings, []);
});

test("online meetings remain visible without any physical sitting", async () => {
  const rows = PCC.filter(m => m.location === null);
  const result = await searchMeetings(AT_85701.lat, AT_85701.lng, 25, NOW, DIVISIONS_AT_85701, served(rows), undefined, meetingBodyIds(COLLEGE, DIVISIONS_AT_85701));
  assert.equal(result.tier, "exact");
  assert.deepEqual(ids(result.meetings), ids(rows));
});

test("a body with no recorded division is never inferred from its venue", async () => {
  const rows = PCC.map(m => ({ ...m, ocdId: null }));
  const result = await searchMeetings(AT_85701.lat, AT_85701.lng, 25, NOW, DIVISIONS_AT_85701, served(rows), undefined, meetingBodyIds([{ id: BODY_ID, ocdId: null }], DIVISIONS_AT_85701));
  assert.equal(result.tier, "none");
  assert.deepEqual(result.meetings, []);
});

test("canonical body divisions and shared territories keep their online calendars visible", async () => {
  const rows = PCC.map(m => ({ ...m, ocdId: null }));
  const shared = "ocd-division/country:us/state:az/county:cochise";
  const bodies = [{ id: rows[0].bodyId!, ocdId: COUNTY, alsoServesOcdIds: [shared] }];
  for (const own of [DIVISIONS_AT_85701, new Set([shared])]) {
    const result = await searchMeetings(AT_85701.lat, AT_85701.lng, 25, NOW, own, served(rows), undefined, meetingBodyIds(bodies, own));
    assert.equal(result.tier, "exact");
    assert.deepEqual(ids(result.meetings), PCC_IDS);
  }
});
