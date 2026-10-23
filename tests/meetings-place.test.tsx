import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { GET as meetingsGET } from "../app/api/meetings/route.ts";
import { resolveZip } from "../lib/geo/zcta.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { CoverageNotice } from "../components/map/coverage-notice.tsx";
import { DataProvider } from "../lib/state/data.tsx";
import { installRegistryAuthority } from "./helpers/promoted-fixtures.ts";
import { publishPointers } from "./helpers/edge-pointers.ts";
import { publishMeetingBodies } from "./helpers/meeting-body-edge.ts";
import { currentReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";

for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "NEON_DATABASE_URL"]) delete process.env[key];
await installRegistryAuthority();

import { meetingBodyIds, searchMeetings } from "../lib/meetings/query.ts";
import { snapshotSourceFor } from "../lib/meetings/snapshot-source.ts";
import type { MeetingsSnapshot } from "../lib/meetings/snapshot.ts";
import type { Meeting } from "../lib/sources/types.ts";

const NOW = new Date("2026-10-01T18:00:00.000Z");
const DAY = 86_400_000;

const TOWN = { lat: 40.0, lng: -100.0 };
// A different place, about 40 km south of TOWN.
const OUTLYING = { lat: 39.64, lng: -100.0 };
// Hundreds of kilometres from TOWN, holding only concluded meetings.
const REMOTE = { lat: 37.0, lng: -95.0 };
const EMPTY = { lat: 47.0, lng: -85.0 };

function meeting(id: string, at: { lat: number; lng: number }, offsetDays: number, status: Meeting["status"]): Meeting {
  return {
    id: `fixture:${id}`,
    ocdId: at === REMOTE ? "ocd-division/country:us/state:ks/place:remote" : "ocd-division/country:us/state:ks/place:example",
    bodyName: "Example Council",
    title: `Council meeting ${id}`,
    startsAt: new Date(NOW.getTime() + offsetDays * DAY).toISOString(),
    timeZone: "America/Chicago",
    location: { lat: at.lat, lng: at.lng, name: "Example Hall", address: "1 Main Street, Example, KS 67000" },
    agendaUrl: null,
    jurisdiction: "Example, KS",
    status,
    provenance: { sourceUrl: null, sourceOrg: "Example Clerk", collectedAt: "2026-09-30T00:00:00.000Z", verifiedAt: null },
  };
}

const MEETINGS: Meeting[] = [
  meeting("town-5d", TOWN, 5, "SCHEDULED"),
  meeting("town-2d", TOWN, 2, "SCHEDULED"),
  meeting("town-canceled", TOWN, 3, "CANCELED"),
  meeting("town-past", TOWN, -3, "CONCLUDED"),
  meeting("remote-2d-ago", REMOTE, -2, "CONCLUDED"),
  meeting("remote-6d-ago", REMOTE, -6, "CONCLUDED"),
];

const SNAPSHOT: MeetingsSnapshot = {
  formatVersion: 1,
  generatedAt: "2026-09-30T00:00:00.000Z",
  counts: { fresh: MEETINGS.length, carried: 0, total: MEETINGS.length },
  sources: [],
  meetings: MEETINGS,
  agendaDocuments: [],
};

const search = (at: { lat: number; lng: number }) =>
  searchMeetings(at.lat, at.lng, 25, NOW, new Set(at === TOWN ? ["ocd-division/country:us/state:ks/place:example"] : at === REMOTE ? ["ocd-division/country:us/state:ks/place:remote"] : []), snapshotSourceFor(SNAPSHOT));

test("a search keeps the meetings of bodies whose territory covers the place, and falls back to the division for a meeting with no body", async () => {
  const division = "ocd-division/country:us/state:ks/place:example";
  const divisions = new Set([division]);
  const snapshot = { ...SNAPSHOT, meetings: [{ ...MEETINGS[0], bodyId: "council" }, { ...MEETINGS[1], bodyId: "other-council" }, MEETINGS[2]] };
  const query = (bodyIds: ReadonlySet<string>) => searchMeetings(TOWN.lat, TOWN.lng, 25, NOW, divisions, snapshotSourceFor(snapshot), undefined, bodyIds);
  const ids = (bodies: Parameters<typeof meetingBodyIds>[0]) => meetingBodyIds(bodies, divisions);
  assert.deepEqual([...ids([{ id: "council", ocdId: division }, { id: "elsewhere", ocdId: "ocd-division/country:us/state:az/place:elsewhere" }])], ["council"]);
  assert.deepEqual([...ids([{ id: "shared", ocdId: null, alsoServesOcdIds: [division] }])], ["shared"], "a shared territory counts");
  const served = await query(ids([{ id: "council", ocdId: division }]));
  assert.deepEqual(served.meetings.map((row) => row.id).sort(), [MEETINGS[0].id, MEETINGS[2].id].sort(), "a body outside the set is excluded; a body-less meeting follows its division");
  assert.equal((await query(ids([{ id: "council", ocdId: "ocd-division/country:us/state:az/place:elsewhere" }]))).meetings.some((row) => row.id === MEETINGS[0].id), false);
});

test("a meeting of a body the registry does not list is placed by its own division", async () => {
  const division = "ocd-division/country:us/state:ks/place:example";
  const snapshot = { ...SNAPSHOT, meetings: [{ ...MEETINGS[0], bodyId: "committee" }, { ...MEETINGS[1], bodyId: "other-council" }] };
  const registered = new Set(["other-council"]);
  const result = await searchMeetings(TOWN.lat, TOWN.lng, 25, NOW, new Set([division]), snapshotSourceFor(snapshot), undefined, new Set(), registered);
  assert.deepEqual(result.meetings.map((row) => row.id), [MEETINGS[0].id], "the unlisted body follows its division; the listed body outside the set stays out");
});

test("a place with meetings keeps its upcoming and recent calendar", async () => {
  const result = await search(TOWN);

  assert.equal(result.tier, "exact");
  assert.equal(result.radiusKm, 25);
  const scheduled = result.meetings.filter((m) => m.status === "SCHEDULED");
  assert.ok(scheduled.length > 0, "the exact tier requires upcoming meetings");
  assert.ok(
    scheduled.every((m) => Date.parse(m.startsAt) >= NOW.getTime() - 60_000),
    "every scheduled row on the exact tier is in the future",
  );
});

test("upcoming meetings come back in chronological order", async () => {
  const { meetings } = await search(TOWN);
  const times = meetings.map((m) => Date.parse(m.startsAt));

  assert.deepEqual(times, [...times].sort((a, b) => a - b));
});

test("an empty place never borrows another place's calendar", async () => {
  const result = await search(OUTLYING);
  assert.equal(result.tier, "none");
  assert.equal(result.radiusKm, 25);
  assert.deepEqual(result.meetings, []);
});

test("with no upcoming meetings for this place, its recent ones are returned", async () => {
  const result = await search(REMOTE);

  assert.equal(result.tier, "concluded");
  assert.ok(result.meetings.length > 0, "expected recently concluded meetings");
  assert.ok(
    result.meetings.every((m) => m.status === "CONCLUDED"),
    "the concluded tier must not mix in upcoming meetings",
  );
});

test("concluded meetings come back most recent first", async () => {
  const { meetings } = await search(REMOTE);
  const times = meetings.map((m) => Date.parse(m.startsAt));

  assert.deepEqual(times, [...times].sort((a, b) => b - a));
});

test("nothing on file anywhere reports the none tier rather than throwing", async () => {
  const result = await search(EMPTY);

  assert.equal(result.tier, "none");
  assert.deepEqual(result.meetings, []);
});

test("canceled meetings ride along but never fill an empty map", async () => {
  const results = await Promise.all([TOWN, OUTLYING, REMOTE].map(search));

  for (const result of results) {
    if (result.meetings.some((m) => m.status === "CANCELED")) {
      assert.ok(
        result.meetings.some((m) => m.status === "SCHEDULED"),
        "a canceled meeting must never be what fills the map",
      );
    }
    if (result.tier === "concluded") {
      assert.ok(
        result.meetings.every((m) => m.status !== "CANCELED"),
        "the concluded tier must not be padded with cancellations",
      );
    }
  }
});

test("every returned meeting carries its provenance", async () => {
  const { meetings } = await search(TOWN);

  assert.ok(meetings.length > 0);
  for (const meeting of meetings) {
    // sourceUrl is nullable; what must never happen is the key going missing in a transform.
    assert.ok(
      "sourceUrl" in meeting.provenance,
      `${meeting.id} dropped source_url in the transform`,
    );
    assert.ok(meeting.provenance.sourceOrg, `${meeting.id} lost its source org`);
    assert.ok(meeting.provenance.collectedAt, `${meeting.id} lost its collected_at`);
    assert.ok(
      meeting.ocdId !== null && meeting.ocdId.startsWith("ocd-division/"),
      `${meeting.id} has no OCD-ID`,
    );
  }
});

for (const place of [
  { zip: "85643", lat: 32.2529, lng: -109.832, city: "willcox", county: "cochise" },
  { zip: "85122", lat: 32.8795, lng: -111.7574, city: "casa_grande", county: "pinal" },
]) {
  test(`${place.zip} serves only its divisions, including meetings beyond the requested radius`, async () => {
    const city = `ocd-division/country:us/state:az/place:${place.city}`;
    const county = `ocd-division/country:us/state:az/county:${place.county}`;
    const neighbourDivisions = ["place:tucson", "county:pima", "school_district:tucson_unified_district", "place:mesa", "place:chandler"];
    const neighbours = neighbourDivisions.map((division, i) => ({
      ...meeting(`neighbour-${i}`, place, 1, "SCHEDULED"),
      ocdId: `ocd-division/country:us/state:az/${division}`,
    }));
    const own = [
      { ...meeting("own-city", place, 2, "SCHEDULED"), ocdId: city },
      { ...meeting("own-county", REMOTE, 3, "SCHEDULED"), ocdId: county },
      { ...meeting("own-online", place, -2, "CONCLUDED"), ocdId: city, location: null },
    ];
    const run = (rows: Meeting[]) => searchMeetings(place.lat, place.lng, 25, NOW,
      new Set([city, county]), snapshotSourceFor({ ...SNAPSHOT, meetings: rows }));
    const empty = await run(neighbours);
    assert.equal(empty.tier, "none");
    assert.deepEqual(empty.meetings, []);
    const result = await run([...own, ...neighbours]);
    assert.equal(result.tier, "exact");
    assert.deepEqual(result.meetings.map(row => row.id), ["fixture:own-online", "fixture:own-city", "fixture:own-county"]);
  });
}

test("unresolved divisions cannot borrow a physically nearby meeting", async () => {
  const result = await searchMeetings(TOWN.lat, TOWN.lng, 25, NOW, new Set(), snapshotSourceFor(SNAPSHOT));
  assert.equal(result.tier, "none");
  assert.deepEqual(result.meetings, []);
});

for (const zip of ["85643", "85122", "85701"]) {
  test(`/api/meetings keeps ${zip}'s divisions and shows a plain gap for an empty place`, async (context) => {
    const resolved = resolveZip(zip);
    assert.ok(resolved.ok);
    const dir = mkdtempSync(join(tmpdir(), "mt01-edge-"));
    const previous = process.env.WTP_READER_EDGE_DIR;
    process.env.WTP_READER_EDGE_DIR = dir;
    context.mock.timers.enable({ apis: ["Date"], now: NOW });
    try {
      const at = resolved.centroid;
      const city = zip === "85643" ? "willcox" : zip === "85122" ? "casa_grande" : "tucson";
      const ownDivision = `ocd-division/country:us/state:az/place:${city}`;
      const rows = ["tucson", "mesa", "chandler"].map((name, i) => ({
        ...meeting(name, at, 1 + i, "SCHEDULED"),
        ocdId: `ocd-division/country:us/state:az/place:${name}`,
        bodyId: `ocd-division/country:us/state:az/place:${name}#governing`,
      }));
      const request = () => meetingsGET(new Request(`https://example.test/api/meetings?zip=${zip}&lat=${at.lat}&lng=${at.lng}&radiusKm=25`));
      const store = new LocalFileArtifactStore(dir);
      const registry = await currentReaderAuthorityEdge()!.stateAuthorities!.load("registry-runtime", "AZ");
      await publishPointers(store, { stateAuthorities: { "registry-runtime": { AZ: { versionId: "fixture:AZ", value: registry } } } });
      const publish = async (meetings: Meeting[]) => {
        const bodies = [...new Set(meetings.map((row) => row.bodyId!))].map((bodyId) => ({
          bodyId, divisions: [bodyId.split("#")[0]!], meetings: meetings.filter((row) => row.bodyId === bodyId),
        }));
        const result = await publishMeetingBodies(store, NOW.toISOString(), bodies);
        assert.ok(result.status === "PUBLISHED" || result.status === "CURRENT", result.status);
      };
      await publish(rows);
      const response = await request();
      assert.equal(response.status, 200);
      const empty = await response.json() as import("../lib/meetings/query.ts").MeetingSearchResult;
      assert.ok(empty.governingOcdIds?.includes(ownDivision), `${zip} must resolve its city division`);
      const expected = rows.filter(row => row.ocdId === ownDivision);
      assert.deepEqual(empty.meetings.map(row => row.id), expected.map(row => row.id));
      assert.equal(empty.radiusKm, 25);
      if (expected.length === 0) {
        assert.equal(empty.tier, "none");
        const markup = renderToStaticMarkup(
          <DataProvider value={{ result: { ...empty, readerScope: undefined } } as never}>
            <CoverageNotice tier={empty.tier} zip={zip} coverage={null} />
          </DataProvider>,
        );
        assert.match(markup, /We don&#x27;t have this place&#x27;s meetings yet\./);
      }
      const ownMeeting = { ...meeting(`${zip}-own`, REMOTE, 2, "SCHEDULED"),
        ocdId: ownDivision, bodyId: `${ownDivision}#governing` };
      await publish([...rows, ownMeeting]);
      const populatedResponse = await request();
      assert.equal(populatedResponse.status, 200);
      const populated = await populatedResponse.json() as import("../lib/meetings/query.ts").MeetingSearchResult;
      assert.equal(populated.tier, "exact");
      assert.deepEqual(populated.meetings.map(row => row.id).sort(), [...expected, ownMeeting].map(row => row.id).sort());
    } finally {
      context.mock.timers.reset();
      if (previous === undefined) delete process.env.WTP_READER_EDGE_DIR;
      else process.env.WTP_READER_EDGE_DIR = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
