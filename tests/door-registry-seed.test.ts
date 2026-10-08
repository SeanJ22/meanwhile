import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import { meetingPartitionId } from "@/lib/civic-data/meeting-partitions.ts";
import { MEETING_PARTITION_CONTRACTS } from "@/lib/civic-data/meeting-partitions.ts";
import { meetingSourceNamesForWiring } from "@/lib/registry/source-wiring.ts";
import { FIXTURE_DOOR_ROWS } from "./helpers/meeting-doors-fixture.ts";
import { derivedWiringKey, type DerivedWiringRecord } from "@/lib/civic-data/derived-meeting-wiring.ts";
import { doorFromDerivedRecord, seedMeetingDoors } from "@/lib/doors/seed-meetings.ts";
import { listDoors } from "@/lib/doors/registry.ts";

const AT = "2026-10-04T12:00:00.000Z";

const DERIVED: DerivedWiringRecord = {
  id: derivedWiringKey("ICAL", "ocd-division/country:us/state:xx/place:example", "https://example.gov/cal.ics"),
  status: "ACTIVE",
  row: {
    bodyId: "ocd-division/country:us/state:xx/place:example",
    ocdId: "ocd-division/country:us/state:xx/place:example",
    bodyName: "Example Council",
    kind: "ICAL",
    route: "https://example.gov/cal.ics",
    officialHost: "example.gov",
    jurisdictionId: "j1",
    state: "US-AZ",
    publishingOrg: "Example",
    timeZone: "America/Phoenix",
    config: { slug: "derived-x", feedUrl: "https://example.gov/cal.ics" },
    crosswalkRowId: "cw-1",
    reviewedAt: "2026-09-01",
    verifiedAt: "2026-09-02",
  },
};

test("every hand-wired meeting door becomes a registry record under its partition id", async () => {
  const repos = createMemoryRepositories();
  const expectedIds = FIXTURE_DOOR_ROWS.flatMap((row) => meetingSourceNamesForWiring(row).map((s) => meetingPartitionId(s, row.bodyId)));
  assert.ok(expectedIds.length > 100, "the seed is not trivial");
  const counts = await seedMeetingDoors({ repo: repos.doors, wiring: FIXTURE_DOOR_ROWS, derived: [], deriveInputAt: AT, at: AT });
  assert.deepEqual(counts.refused, []);
  const { doors } = await listDoors(repos.doors);
  assert.equal(new Set(expectedIds).size, doors.length, "one door per unique (source, body)");
  assert.deepEqual(doors.map((d) => d.doorId).sort(), [...new Set(expectedIds)].sort());
  assert.ok(MEETING_PARTITION_CONTRACTS.filter((p) => p.wiring !== null).every((p) => doors.some((d) => d.doorId === p.id)), "every wired partition has its door");
  for (const door of doors) assert.ok(door.hosts.length > 0, `${door.doorId} names a host`);
});

test("a derived member is a door under its wiring row id, in its state's family", async () => {
  const draft = doorFromDerivedRecord(DERIVED);
  assert.equal(draft.doorId, DERIVED.id);
  assert.equal(draft.kind, "ical");
  assert.equal(draft.config?.familyPartition, "meetings:derived:US-AZ");
  assert.ok(MEETING_PARTITION_CONTRACTS.some((p) => p.id === draft.meeting?.family), "the family named is a partition that exists");
  const repos = createMemoryRepositories();
  const first = await seedMeetingDoors({ repo: repos.doors, wiring: [], derived: [DERIVED], deriveInputAt: AT, at: AT });
  assert.deepEqual(first.refused, []);
  assert.equal(first.created, 1);
  const again = await seedMeetingDoors({ repo: repos.doors, wiring: [], derived: [DERIVED], deriveInputAt: AT, at: AT });
  assert.equal(again.unchanged, 1, "importing twice changes nothing");
  const suspended = await seedMeetingDoors({ repo: repos.doors, wiring: [], derived: [{ ...DERIVED, status: "SUSPENDED" }], deriveInputAt: AT, at: AT });
  assert.equal(suspended.unchanged, 1, "a derive step does not change the status of a door that already exists");
});
