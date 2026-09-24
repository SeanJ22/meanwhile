/**
 * **A BODY IS IN VIEW BY ITS BUILDING, WHICHEVER LIST THE BUILDING IS IN.**
 * (2026-09-24.)
 *
 * `/api/meetings` at 85701 (32.2217, -110.9695, radiusKm=40) stopped serving
 * two concluded sittings of Pima Community College's Governing Board once the
 * college's own pages replaced its Diligent tenant: the 10 August study
 * session ("VIRTUAL MEETING") and the 28 August Finance and Audit Committee
 * ("Zoom Webinar"). Both are online and the college has no division, so the
 * only clause that can put them in view is "one of the same body's physical
 * sittings is in radius" — and `within()` answered it from the list it was
 * filtering. The college's building, the District Office, appeared only among
 * its upcoming sittings, so the concluded list, asked about itself, found no
 * building and dropped both. Before the cutover the 10 August row carried the
 * building, which is why the old rows were served.
 *
 * These run the real `searchMeetings` over an injected snapshot through
 * `snapshotSourceFor`, exactly as the route does. No live calls. The college's
 * sittings carry the ids, dates and places `tests/pima-edu-source.test.ts`
 * normalizes from the recorded pages; the other bodies are fixtures.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { searchMeetings } from "../lib/meetings/query.ts";
import { snapshotSourceFor } from "../lib/meetings/registry.ts";
import type { Meeting } from "../lib/sources/types.ts";

/** The instant production was measured at. */
const NOW = new Date("2026-09-24T06:07:00.000Z");

const AT_85701 = { lat: 32.2217, lng: -110.9695 };
const DIVISIONS_AT_85701: ReadonlySet<string> = new Set([
  "ocd-division/country:us/state:az",
  "ocd-division/country:us/state:az/county:pima",
  "ocd-division/country:us/state:az/place:tucson",
]);
/** ZCTA 85614: the District Office is ~41 km away, outside 25 and inside 60. */
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
  // Outside every rung: nothing of the college's is in view, and the concluded
  // fallback does not reach for its online sittings either.
  const far = await searchMeetings(PHOENIX.lat, PHOENIX.lng, 25, NOW, new Set(), served(PCC));
  assert.equal(far.tier, "none");
  assert.deepEqual(far.meetings, []);

  // Inside the ladder, at a rung another body earns: the District Office is
  // ~41 km out, so at 25 km none of the college's sittings, online or not,
  // upcoming or concluded, rides along.
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
  // A second division-less body with only a recent past: its building is ~1 km
  // from the centre. It rides along, and it must not earn the 25 km rung —
  // the recent past places a body but never counts as a hit.
  const recentOnly = [
    sitting("fixture:recent-only:2026-09-02", "2026-09-02T18:00:00-07:00", {
      building: "Fixture Community Center",
      lat: 31.87,
      lng: -111.0,
    }),
    sitting("fixture:recent-only:2026-09-16", "2026-09-16T18:00:00-07:00", { online: "Teleconference" }),
  ].map((m) => ({ ...m, bodyId: "curated:az/fixture-recent-only#governing", bodyName: "Fixture District Board" }));

  const result = await searchMeetings(GREEN_VALLEY.lat, GREEN_VALLEY.lng, 25, NOW, new Set(), served([...PCC, ...recentOnly]));

  // What the cascade said before the fix: nothing upcoming in view at 25 km,
  // so it stepped out to 60 and said so.
  assert.equal(result.tier, "widened");
  assert.equal(result.radiusKm, 60);
  assert.equal(result.requestedRadiusKm, 25);
  // At 60 km the District Office is in radius, so the college's concluded
  // online sittings ride along beside the rest.
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
  // The Diligent-era shape: the 10 August row carried the District Office,
  // and every upcoming sitting is online. Asked about itself, the upcoming
  // list found no building, no rung was earned, and the reader was told the
  // college had nothing upcoming while its committee was due to meet.
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
