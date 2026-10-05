import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { recordDoorOutcome } from "../lib/doors/outcome.ts";
import { listDoors } from "../lib/doors/registry.ts";
import { seedMeetingDoors } from "../lib/doors/seed-meetings.ts";
import {
  doorInDivisions,
  doorPartitionIds,
  markDoorsReadNow,
  ocdInside,
  readNowDueRequests,
  settleReadNow,
} from "../lib/doors/mission-refresh.ts";
import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import { SOURCE_WIRING } from "../lib/registry/source-wiring.ts";
import { routineDueRequestFor } from "../lib/civic-data/routine-due-request.ts";
import { ROUTINE_SOURCE_TASKS } from "../lib/civic-data/runner.ts";

/** DB-56: starting a mission marks every open door already known in the place to be read now. */

const SEEDED = "2026-10-04T12:00:00.000Z";
const MISSION = "2026-10-04T13:00:00.000Z";
const LATER = "2026-10-04T13:20:00.000Z";

async function seeded() {
  const repos = createMemoryRepositories();
  await seedMeetingDoors({ repo: repos.doors, wiring: SOURCE_WIRING, derived: [], deriveInputAt: SEEDED, at: SEEDED });
  return repos;
}

describe("DB-56: mission start refreshes the doors already known in the place", () => {
  it("an OCD id is inside a division when it is that division, a child of it, or a body of it", () => {
    const county = "ocd-division/country:us/state:az/county:pima";
    assert.equal(ocdInside(county, county), true);
    assert.equal(ocdInside(`${county}/place:tucson`, county), true);
    assert.equal(ocdInside(`${county}#governing`, county), true);
    assert.equal(ocdInside("ocd-division/country:us/state:az/county:pinal", county), false);
    assert.equal(ocdInside("ocd-division/country:us/state:az/county:pima_extra", county), false, "a longer name is not a child");
  });

  it("marks only the open doors inside the place, and only their read-now flag", async () => {
    const repos = await seeded();
    const before = (await listDoors(repos.doors)).doors;
    const target = before.find((door) => door.ocdId !== null)!;
    const division = target.ocdId!;
    const inside = before.filter((door) => doorInDivisions(door, [division]));
    assert.ok(inside.length >= 1);
    const counts = await markDoorsReadNow(repos.doors, [division], MISSION);
    assert.equal(counts.inPlace, inside.length);
    assert.equal(counts.marked, inside.filter((door) => door.status === "OPEN").length);
    const after = (await listDoors(repos.doors)).doors;
    for (const door of after) {
      const was = before.find(({ doorId }) => doorId === door.doorId)!;
      if (doorInDivisions(door, [division]) && door.status === "OPEN") {
        assert.equal(door.readNow, true, door.doorId);
        assert.equal(door.updatedAt, MISSION);
        assert.deepEqual({ ...door, readNow: false, updatedAt: was.updatedAt }, was, "nothing else on the record changed");
      } else {
        assert.deepEqual(door, was, `${door.doorId} outside the place is untouched`);
      }
    }
    // Marking again changes nothing: they already carry a mark.
    const again = await markDoorsReadNow(repos.doors, [division], LATER);
    assert.equal(again.marked, 0);
    assert.equal(again.alreadyMarked, counts.marked);
  });

  it("a mission that names no division marks nothing", async () => {
    const repos = await seeded();
    assert.deepEqual(await markDoorsReadNow(repos.doors, [], MISSION), { inPlace: 0, marked: 0, alreadyMarked: 0, notRead: 0, raced: 0 });
    assert.deepEqual(await markDoorsReadNow(repos.doors, ["not a division"], MISSION), { inPlace: 0, marked: 0, alreadyMarked: 0, notRead: 0, raced: 0 });
    assert.ok((await listDoors(repos.doors)).doors.every((door) => !door.readNow));
  });

  it("a marked door becomes the ordinary due request of its partition, and an unknown partition asks for nothing", async () => {
    const repos = await seeded();
    const division = (await listDoors(repos.doors)).doors.find((door) => door.ocdId !== null)!.ocdId!;
    await markDoorsReadNow(repos.doors, [division], MISSION);
    const doors = (await listDoors(repos.doors)).doors;
    const known = new Set(MEETING_PARTITION_CONTRACTS.map(({ id }) => id));
    const requests = readNowDueRequests(doors, known, LATER);
    assert.ok(requests.length >= 1);
    for (const request of requests) {
      assert.ok(known.has(request.contractId));
      assert.equal(request.requestedAt, MISSION);
      assert.equal(request.dueAt, MISSION);
      assert.equal(Date.parse(request.expiresAt) - Date.parse(MISSION), 2 * 3_600_000);
      assert.equal(request.withdrawnAt, null);
    }
    assert.deepEqual(readNowDueRequests(doors, new Set(), LATER), []);
    // Past its lifetime a mark asks for nothing.
    assert.deepEqual(readNowDueRequests(doors, known, "2026-10-04T15:00:01.000Z"), []);
    // A door that is not marked asks for nothing.
    assert.deepEqual(readNowDueRequests(doors.map((door) => ({ ...door, readNow: false })), known, LATER), []);
  });

  it("a door that records an outcome after the mark is settled; one that has not stays marked, and an old mark expires", async () => {
    const repos = await seeded();
    const doors = (await listDoors(repos.doors)).doors.filter((door) => door.status === "OPEN" && door.ocdId !== null);
    const [read, waiting] = [doors[0]!, doors.find((door) => door.ocdId !== doors[0]!.ocdId)!];
    await markDoorsReadNow(repos.doors, [read.ocdId!, waiting.ocdId!], MISSION);
    assert.equal(await recordDoorOutcome(repos.doors, read.doorId, "SUCCESS", LATER), true);
    assert.equal(await settleReadNow(repos.doors, LATER), 1, "only the door that recorded an outcome is settled");
    const settled = (await listDoors(repos.doors)).doors;
    assert.equal(settled.find(({ doorId }) => doorId === read.doorId)!.readNow, false);
    assert.equal(settled.find(({ doorId }) => doorId === waiting.doorId)!.readNow, true, "not yet read: still waiting");
    assert.equal(settled.find(({ doorId }) => doorId === read.doorId)!.updatedAt, MISSION, "settling leaves the mark's time alone");
    // Two hours on, whatever is still marked expires.
    const cleared = await settleReadNow(repos.doors, "2026-10-04T15:00:01.000Z");
    assert.ok(cleared >= 1);
    assert.ok((await listDoors(repos.doors)).doors.every((door) => !door.readNow));
  });

  it("a derived member is read by its family's partition; a hand-wired door by its own", async () => {
    const repos = await seeded();
    const hand = (await listDoors(repos.doors)).doors.find((door) => door.meeting?.family === null)!;
    assert.deepEqual(doorPartitionIds(hand), [hand.doorId]);
    assert.deepEqual(doorPartitionIds({ ...hand, meeting: { ...hand.meeting!, family: "meetings:derived:US-OH" } }), ["meetings:derived:US-OH"]);
    assert.deepEqual(doorPartitionIds({ ...hand, meeting: null }), []);
  });

  it("the ordinary pass treats a marked door as due, and the partition's own next attempt spends it", async () => {
    const repos = await seeded();
    const task = ROUTINE_SOURCE_TASKS.find((candidate) => candidate.recordClass === "MEETING" && candidate.contract.schedule?.kind === "SITTING_WINDOW" && candidate.id.startsWith("meetings:"))!;
    const door = (await listDoors(repos.doors)).doors.find((row) => row.doorId === task.id)!;
    assert.ok(door, "a hand-wired door carries its partition's id");
    await markDoorsReadNow(repos.doors, [door.ocdId!], MISSION);
    const requests = readNowDueRequests((await listDoors(repos.doors)).doors, new Set(ROUTINE_SOURCE_TASKS.map(({ id }) => id)), LATER);
    const nowMs = Date.parse(LATER);
    assert.equal(routineDueRequestFor(task, undefined, nowMs, requests)?.contractId, task.id);
    assert.equal(routineDueRequestFor(task, { lastAttemptedAt: "2026-10-04T13:10:00.000Z" }, nowMs, requests), null, "read since the mark: spent");
    assert.equal(routineDueRequestFor(task, { lastAttemptedAt: "2026-10-04T12:30:00.000Z" }, nowMs, requests)?.contractId, task.id, "an attempt before the mark does not spend it");
  });
});
