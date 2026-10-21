import assert from "node:assert/strict";
import test from "node:test";
import { platformWiringDoors, reusePlatformDoor, legacyPlatformDoorId } from "../lib/doors/platform-census.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { upsertDerivedDoor } from "../lib/doors/registry.ts";
import type { DoorConfigValue } from "../lib/doors/registry.ts";
import { installDoorRecords } from "../lib/doors/meeting-doors.ts";
import { meetingPartitionContract, meetingPartitionOfId } from "../lib/civic-data/meeting-partitions.ts";
import { buildCompositeSource, wiringForSelectedMeetingSource } from "../lib/sources/composite/wiring.ts";
import type { DerivedWiringRow } from "../lib/civic-data/derived-meeting-wiring.ts";
import { primeCuratedReaderProjection } from "../lib/civic-data/curated-reader-read-model.ts";

const row: DerivedWiringRow = {
  bodyId: "government:US-ID:cog:fixture#governing", ocdId: "ocd-division/country:us/state:id", bodyName: "County Commissioners",
  kind: "ICAL", route: "https://county.example.gov/calendar.ics?catID=14", officialHost: "county.example.gov",
  jurisdictionId: "id:county:fixture", state: "US-ID", publishingOrg: "Fixture County", timeZone: "America/Boise",
  config: { slug: "fixture", feedUrl: "https://county.example.gov/calendar.ics?catID=14", feedScope: "category" },
  crosswalkRowId: "fixture", reviewedAt: "2026-10-20T12:00:00Z", verifiedAt: "2026-10-20T12:00:00Z",
};

test("complementary calendars of one body keep separate ordinary doors and acquire only their own route", async () => {
  primeCuratedReaderProjection("venue-resolutions", { kind: "venue-resolutions", records: [{ id: "unrelated-fixture", value: {} }] }, "fixture");
  const repos = createMemoryRepositories();
  const second = { ...row, route: row.route.replace("14", "23"), config: { ...row.config, feedUrl: row.route.replace("14", "23") } };
  const drafts = [row, second].flatMap(platformWiringDoors);
  assert.notEqual(drafts[0].doorId, drafts[1].doorId);
  for (const draft of drafts) await upsertDerivedDoor(repos.doors, draft, row.verifiedAt, row.verifiedAt);
  const installed = installDoorRecords((await repos.doors.list()).map(record => record.value));
  assert.deepEqual(installed.partitions.skipped, []);
  for (const [index, draft] of drafts.entries()) {
    const partition = meetingPartitionContract(draft.doorId)!;
    assert.equal(meetingPartitionOfId(partition.id)?.bodyId, row.bodyId);
    assert.equal(meetingPartitionOfId(partition.id)?.scope, partition.scope);
    const selection = { sourceName: "ical", bodyId: row.bodyId, route: partition.wiring!.config.partitionRoute };
    assert.equal(wiringForSelectedMeetingSource("ical", [selection]).length, 1);
    const calls: string[] = [];
    const source = buildCompositeSource({ sourceNames: ["ical"], meetingPartitions: [selection], fetchImpl: async url => {
      calls.push(String(url));
      return index === 0 ? new Response("unavailable", { status: 503 }) : new Response("BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:second\nSUMMARY:Commissioners Meeting\nDTSTART;TZID=America/Boise:20261021T190000\nEND:VEVENT\nEND:VCALENDAR", { headers: { "content-type": "text/calendar" } });
    } });
    const raw = await source.fetch({ lat: 43, lng: -114, radiusKm: 1000 });
    const meetings = source.normalize(raw);
    assert.ok(calls.length); assert.ok(calls.every(url => url === draft.config!.feedUrl));
    assert.equal(meetings.length, index === 0 ? 0 : 1, "a refused first calendar does not suppress the second calendar");
  }
});

test("rediscovery reuses an existing calendar's pointer and output slug without losing its suspension", async () => {
  const repos = createMemoryRepositories(), draft = platformWiringDoors(row)[0];
  const config: Record<string, DoorConfigValue> = { ...draft.config, slug: "original-output-id" }; delete config.partitionRoute;
  await upsertDerivedDoor(repos.doors, { ...draft, doorId: legacyPlatformDoorId(draft), config, status: "SUSPENDED" }, row.verifiedAt, row.verifiedAt);
  const held = (await repos.doors.mustRead(legacyPlatformDoorId(draft))).value;
  const reused = reusePlatformDoor(draft, held);
  assert.equal(reused.doorId, held.doorId); assert.equal(reused.config!.slug, "original-output-id");
  assert.equal(reused.config!.partitionRoute, undefined); assert.equal(reused.status, "SUSPENDED");
  assert.notEqual(reusePlatformDoor(platformWiringDoors({ ...row, config: { ...row.config, feedUrl: row.route + "&other=1" } })[0], held).doorId, held.doorId);
});
