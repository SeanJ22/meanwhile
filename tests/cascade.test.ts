import assert from "node:assert/strict";
import { test } from "node:test";

import { RADIUS_LADDER_KM, searchMeetings } from "../lib/meetings/query.ts";
import { snapshotSourceFor } from "../lib/meetings/registry.ts";
import type { MeetingsSnapshot } from "../lib/meetings/snapshot.ts";
import type { Meeting } from "../lib/sources/types.ts";

const NOW = new Date("2026-10-01T18:00:00.000Z");
const DAY = 86_400_000;

const TOWN = { lat: 40.0, lng: -100.0 };
// About 40 km south of TOWN: outside the first rung, inside the second.
const OUTLYING = { lat: 39.64, lng: -100.0 };
// Hundreds of kilometres from TOWN, holding only concluded meetings.
const REMOTE = { lat: 37.0, lng: -95.0 };
const EMPTY = { lat: 47.0, lng: -85.0 };

function meeting(id: string, at: { lat: number; lng: number }, offsetDays: number, status: Meeting["status"]): Meeting {
  return {
    id: `fixture:${id}`,
    ocdId: "ocd-division/country:us/state:ks/place:example",
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
  searchMeetings(at.lat, at.lng, RADIUS_LADDER_KM[0], NOW, new Set(), snapshotSourceFor(SNAPSHOT));

test("a nearby point finds upcoming meetings at the first radius", async () => {
  const result = await search(TOWN);

  assert.equal(result.tier, "exact");
  assert.equal(result.radiusKm, RADIUS_LADDER_KM[0]);
  const scheduled = result.meetings.filter((m) => m.status === "SCHEDULED");
  assert.ok(scheduled.length > 0, "the exact rung must be earned by upcoming meetings");
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

test("an outlying point widens the radius and reports that it did", async () => {
  const result = await search(OUTLYING);

  assert.equal(result.tier, "widened");
  assert.ok(
    result.radiusKm > result.requestedRadiusKm,
    "a widened result must report a larger radius than was asked for",
  );
  assert.ok(result.meetings.length > 0);
});

test("with no upcoming meetings anywhere on the ladder, recent ones fill in", async () => {
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
        "the concluded fallback must not be padded with cancellations",
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

test("the first successful radius never loads the wider area", async () => {
  const calls: number[] = [];
  const source = snapshotSourceFor(SNAPSHOT);
  const result = await searchMeetings(TOWN.lat, TOWN.lng, 25, NOW, new Set(), {
    name: "bounded-area",
    load: async (query, now) => { calls.push(query.radiusKm); return source.load(query, now); },
  });
  assert.deepEqual(calls, [25]);
  assert.deepEqual(result, await search(TOWN));
});
