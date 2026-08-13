import assert from "node:assert/strict";
import { test } from "node:test";

// The suite never touches the network: pin the mock before the first query.
// getMeetingSource() reads this per call, so setting it here is early enough.
process.env.WTP_MEETING_SOURCE = "mock";

import {
  RADIUS_LADDER_KM,
  searchMeetings,
} from "../lib/meetings/query.ts";

/**
 * The cascade is the one piece of logic a user can't see working. A silently
 * widened radius looks identical to an exact hit, so these pin the tier the
 * search reports as much as the meetings it returns.
 *
 * These tests exercise the cascade *mechanism* against fixtures, which is why
 * they run on the mock even though the app's active source is the composite.
 */

const TUCSON = { lat: 32.22174, lng: -110.97133 };
// ZCTA 85614, Green Valley — far enough south that downtown Tucson is outside
// the first rung but inside the second.
const GREEN_VALLEY = { lat: 31.86404, lng: -110.99902 };
// ZCTA 85607, Douglas — outside every rung of the ladder from either metro.
const DOUGLAS = { lat: 31.38002, lng: -109.56003 };
// Absarokee, MT. Nothing on file within a thousand miles.
const MONTANA = { lat: 45.52002, lng: -109.44003 };

test("downtown zip finds upcoming meetings at the first radius", async () => {
  const result = await searchMeetings(TUCSON.lat, TUCSON.lng);

  assert.equal(result.tier, "exact");
  assert.equal(result.radiusKm, RADIUS_LADDER_KM[0]);
  assert.ok(result.meetings.length > 0, "expected Tucson meetings");
  assert.ok(
    result.meetings.every((m) => m.status === "SCHEDULED"),
    "the exact tier must only ever show upcoming meetings",
  );
});

test("upcoming meetings come back in chronological order", async () => {
  const { meetings } = await searchMeetings(TUCSON.lat, TUCSON.lng);
  const times = meetings.map((m) => Date.parse(m.startsAt));

  assert.deepEqual(times, [...times].sort((a, b) => a - b));
});

test("an outlying zip widens the radius and reports that it did", async () => {
  const result = await searchMeetings(GREEN_VALLEY.lat, GREEN_VALLEY.lng);

  assert.equal(result.tier, "widened");
  assert.ok(
    result.radiusKm > result.requestedRadiusKm,
    "a widened result must report a larger radius than was asked for",
  );
  assert.ok(result.meetings.length > 0);
});

test("with no upcoming meetings anywhere on the ladder, recent ones fill in", async () => {
  const result = await searchMeetings(DOUGLAS.lat, DOUGLAS.lng);

  assert.equal(result.tier, "concluded");
  assert.ok(result.meetings.length > 0, "expected recently concluded meetings");
  assert.ok(
    result.meetings.every((m) => m.status === "CONCLUDED"),
    "the concluded tier must not mix in upcoming meetings",
  );
});

test("concluded meetings come back most recent first", async () => {
  const { meetings } = await searchMeetings(DOUGLAS.lat, DOUGLAS.lng);
  const times = meetings.map((m) => Date.parse(m.startsAt));

  assert.deepEqual(times, [...times].sort((a, b) => b - a));
});

test("nothing on file anywhere reports the none tier rather than throwing", async () => {
  const result = await searchMeetings(MONTANA.lat, MONTANA.lng);

  assert.equal(result.tier, "none");
  assert.deepEqual(result.meetings, []);
});

test("canceled meetings never fill an empty map", async () => {
  const results = await Promise.all(
    [TUCSON, GREEN_VALLEY, DOUGLAS].map((p) => searchMeetings(p.lat, p.lng)),
  );

  for (const result of results) {
    assert.ok(
      result.meetings.every((m) => m.status !== "CANCELED"),
      "a canceled meeting is not something to attend",
    );
  }
});

test("every returned meeting carries its provenance", async () => {
  const { meetings } = await searchMeetings(TUCSON.lat, TUCSON.lng);

  for (const meeting of meetings) {
    // `sourceUrl` is nullable on purpose: a body with no published permalink
    // has none, and the fixtures were not read from anywhere, so inventing one
    // to satisfy this assertion is the exact failure the field guards against.
    // What must never happen is the key going missing in a transform.
    assert.ok(
      "sourceUrl" in meeting.provenance,
      `${meeting.id} dropped source_url in the transform`,
    );
    assert.ok(meeting.provenance.sourceOrg, `${meeting.id} lost its source org`);
    assert.ok(meeting.provenance.collectedAt, `${meeting.id} lost its collected_at`);
    assert.ok(meeting.ocdId.startsWith("ocd-division/"), `${meeting.id} has no OCD-ID`);
  }
});
