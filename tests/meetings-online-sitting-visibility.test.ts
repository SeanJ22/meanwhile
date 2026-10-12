/**
 * A body is in view by its building, whichever list the building is in: a division-less body's online sittings
 * ride along when one of the same body's physical sittings, upcoming or concluded, is in radius. These run the real
 * `searchMeetings` over an injected snapshot through `snapshotSourceFor`, as the route does.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { searchMeetings } from "../lib/meetings/query.ts";
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
/** About 41 km from the District Office: outside 25 and inside 60. */
const GREEN_VALLEY = { lat: 31.86404, lng: -110.99902 };
/** ~176 km from the District Office: outside every rung. */
const PHOENIX = { lat: 33.4484, lng: -112.074 };

const DISTRICT_OFFICE = { lat: 32.2217, lng: -110.8871 };

type Place = { building: string; lat: number; lng: number } | { online: string };

function sitting(id: string, startsAt: string, place: Place, fields: Partial<Meeting> = {}): Meeting {
  return {
    id,
    ocdId: null,
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

/** The college as the pima-edu partition serves it: its building only among upcoming sittings. */
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

test("(a) a division-less body's online concluded sittings are in view by its upcoming building", async () => {
  const result = await searchMeetings(AT_85701.lat, AT_85701.lng, 40, NOW, DIVISIONS_AT_85701, served(PCC));

  assert.equal(result.tier, "exact");
  assert.equal(result.radiusKm, 60);
  assert.equal(result.requestedRadiusKm, 40);
  assert.deepEqual(ids(result.meetings), PCC_IDS, "every sitting of the college, oldest first");

  const concluded = result.meetings.filter((m) => m.status === "CONCLUDED");
  assert.deepEqual(ids(concluded), PCC_CONCLUDED_ONLINE);
  for (const m of concluded) {
    assert.equal(m.location, null, `${m.id} gained a coordinate`);
    assert.ok(m.online, `${m.id} lost its online access`);
  }
});

test("(b) with none of the body's buildings in radius in either list, none of its online sittings is in view", async () => {
  // Outside every rung: nothing of the college's is in view.
  const far = await searchMeetings(PHOENIX.lat, PHOENIX.lng, 25, NOW, new Set(), served(PCC));
  assert.equal(far.tier, "none");
  assert.deepEqual(far.meetings, []);

  // At 25 km, a rung another body earns, the District Office is out of radius, so none of the college's sittings ride along.
  const TOWN = "ocd-division/country:us/state:az/place:sahuarita";
  const neighbour = sitting(
    "fixture:neighbour:2026-09-30",
    "2026-09-30T18:00:00-07:00",
    { building: "Fixture Town Hall", lat: 31.87, lng: -111.0 },
    { ocdId: TOWN, bodyId: `${TOWN}#governing`, bodyName: "Town Council", jurisdiction: "Sahuarita, AZ" },
  );
  const near = await searchMeetings(GREEN_VALLEY.lat, GREEN_VALLEY.lng, 25, NOW, new Set([TOWN]), served([...PCC, neighbour]));
  assert.equal(near.tier, "exact");
  assert.equal(near.radiusKm, 25);
  assert.deepEqual(ids(near.meetings), [neighbour.id]);
});

test("(c) the division clause still reaches an online sitting whose division contains the centre", async () => {
  const COUNTY = "ocd-division/country:us/state:az/county:pima";
  const onlineOnly = [
    sitting("fixture:online-only:2026-09-10", "2026-09-10T10:00:00-07:00", { online: "Webinar" }),
    sitting("fixture:online-only:2026-10-08", "2026-10-08T10:00:00-07:00", { online: "Webinar" }),
  ].map((m) => ({ ...m, ocdId: COUNTY, bodyId: `${COUNTY}#fixture`, bodyName: "Fixture Commission" }));

  const inside = await searchMeetings(AT_85701.lat, AT_85701.lng, 25, NOW, DIVISIONS_AT_85701, served(onlineOnly));
  assert.equal(inside.tier, "exact");
  assert.equal(inside.radiusKm, 25);
  assert.deepEqual(ids(inside.meetings), ids(onlineOnly));

  // No building anywhere and no division at the point: out of view.
  const outside = await searchMeetings(AT_85701.lat, AT_85701.lng, 25, NOW, new Set(), served(onlineOnly));
  assert.equal(outside.tier, "none");
  assert.deepEqual(outside.meetings, []);
});

test("(d) the widened tier behaves as before, and the rule holds at the rung it lands on", async () => {
  // A second division-less body with only a recent past, its building near the centre: it rides along but never earns a rung.
  const recentOnly = [
    sitting("fixture:recent-only:2026-09-02", "2026-09-02T18:00:00-07:00", {
      building: "Fixture Community Center",
      lat: 31.87,
      lng: -111.0,
    }),
    sitting("fixture:recent-only:2026-09-16", "2026-09-16T18:00:00-07:00", { online: "Teleconference" }),
  ].map((m) => ({ ...m, bodyId: "curated:az/fixture-recent-only#governing", bodyName: "Fixture District Board" }));

  const result = await searchMeetings(GREEN_VALLEY.lat, GREEN_VALLEY.lng, 25, NOW, new Set(), served([...PCC, ...recentOnly]));

  // Nothing upcoming in view at 25 km, so the cascade steps out to 60 and says so.
  assert.equal(result.tier, "widened");
  assert.equal(result.radiusKm, 60);
  assert.equal(result.requestedRadiusKm, 25);
  // At 60 km the District Office is in radius, so the college's concluded online sittings ride along.
  assert.deepEqual(ids(result.meetings), [
    "pima-edu:pcc:2026-08-10-study-session",
    "pima-edu:pcc:2026-08-28-committee",
    "fixture:recent-only:2026-09-02",
    "fixture:recent-only:2026-09-16",
    "pima-edu:pcc:2026-09-25-regular",
    "pima-edu:pcc:2026-10-16-committee",
  ]);
});

test("the reverse holds too: a building among concluded sittings keeps the body's online upcoming ones in view", async () => {
  // The building is on a concluded sitting and every upcoming sitting is online.
  const rows = [
    sitting("pima-edu:pcc:2026-08-10-study-session", "2026-08-10T17:00:00-07:00", {
      building: "PCC District Office",
      ...DISTRICT_OFFICE,
    }),
    ...PCC.filter((m) => m.id === "pima-edu:pcc:2026-08-28-committee" || m.id === "pima-edu:pcc:2026-10-16-committee"),
  ];

  const result = await searchMeetings(AT_85701.lat, AT_85701.lng, 40, NOW, DIVISIONS_AT_85701, served(rows));

  assert.equal(result.tier, "exact");
  assert.equal(result.radiusKm, 60);
  assert.deepEqual(ids(result.meetings), [
    "pima-edu:pcc:2026-08-10-study-session",
    "pima-edu:pcc:2026-08-28-committee",
    "pima-edu:pcc:2026-10-16-committee",
  ]);
  assert.equal(result.meetings.find((m) => m.id === "pima-edu:pcc:2026-10-16-committee")?.location, null);
});
