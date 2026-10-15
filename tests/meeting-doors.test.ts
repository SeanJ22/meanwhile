import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import { firewallRoutineContracts, meetingRouteKindContracts } from "../lib/civic-data/meeting-route-kinds.ts";
import { ROUTINE_SOURCE_TASKS } from "../lib/civic-data/runner.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { ensureMeetingDoors, hasHandWiredMeetingDoor, installDoorRecords, MEETING_DOORS_REFRESH_MS } from "../lib/doors/meeting-doors.ts";
import { applyManualEdit, editableFieldsOf } from "../lib/doors/registry.ts";
import { activeWiring, meetingRouteKinds } from "../lib/registry/source-wiring.ts";
import { CAPABILITIES } from "../lib/sources/composite/wiring.ts";
import { fixtureDoorRecords, installFixtureDoors } from "./helpers/meeting-doors-fixture.ts";

const AT = "2026-10-07T13:00:00.000Z";

describe("scoped meeting doors", () => {
  afterEach(() => installFixtureDoors());

  it("reads only one body's indexed rows, including suspended facts but excluding suspended work", async () => {
    const repos = createMemoryRepositories();
    const doors = fixtureDoorRecords();
    for (const door of doors) await repos.doors.put(door.doorId, door, AT);
    const one = doors[0]!;
    const own = doors.filter(door => door.bodyIds[0] === one.bodyIds[0]);
    for (const door of own) {
      const row = (await repos.doors.read(door.doorId))!;
      await repos.doors.compareAndSet(door.doorId, row.revision,
        applyManualEdit(door, { ...editableFieldsOf(door), status: "SUSPENDED" }, AT), AT);
    }
    const queries: unknown[] = [];
    const repo = { ...repos.doors, list: async () => { throw new Error("NATIONAL_READ_FORBIDDEN"); },
      listWhere: async (path: readonly string[], value: string) => { queries.push([path,value]); return repos.doors.listWhere(path,value); } };
    const answer = await ensureMeetingDoors({ bodyId: one.bodyIds[0], repo });
    assert.equal(answer.ready, true);
    assert.deepEqual(queries, [[["bodyIds","0"],one.bodyIds[0]]]);
    assert.ok(MEETING_PARTITION_CONTRACTS.length > 0);
    assert.ok(MEETING_PARTITION_CONTRACTS.every(partition => partition.bodyId === one.bodyIds[0] && partition.suspended));
    assert.ok(ROUTINE_SOURCE_TASKS.every(task => !MEETING_PARTITION_CONTRACTS.some(partition => partition.id === task.id)));
    assert.equal(activeWiring().length, 0);
  });

  it("derived calendar doors keep their own review work instead of masking it as hand wiring", () => {
    const direct = fixtureDoorRecords()[0]!;
    installDoorRecords([{ ...direct, origin: "DERIVED", doorId: `ical:${direct.bodyIds[0]}:route-hash` }]);
    assert.equal(hasHandWiredMeetingDoor(direct.bodyIds[0]!), false);
    assert.equal(activeWiring().length, 1, "the derived calendar still runs through the common adapter path");
    installDoorRecords([direct]);
    assert.equal(hasHandWiredMeetingDoor(direct.bodyIds[0]!), true);
  });

  it("a new state replaces the prior state's inventory and reports a scoped read failure", async () => {
    const repos = createMemoryRepositories();
    for (const door of fixtureDoorRecords()) await repos.doors.put(door.doorId, door, AT);
    assert.equal((await ensureMeetingDoors({ state: "az", repo: repos.doors })).ready, true);
    const arizona = new Set(fixtureDoorRecords().filter(door => door.scopeState === "US-AZ").flatMap(door => door.bodyIds));
    assert.ok(MEETING_PARTITION_CONTRACTS.every(partition => arizona.has(partition.bodyId)));
    assert.equal((await ensureMeetingDoors({ state: "US-NH", repo: repos.doors })).ready, true);
    assert.ok(MEETING_PARTITION_CONTRACTS.every(partition => partition.bodyId.includes("state:nh")));
    const unavailable = { ...repos.doors, listWhere: async () => { throw new Error("offline"); } };
    const result = await ensureMeetingDoors({ state: "US-AZ", repo: unavailable, clock: () => Date.now() + MEETING_DOORS_REFRESH_MS + 1 });
    assert.equal(result.ready, false);
  });
});

describe("the release firewall's meeting contracts", () => {
  it("name one contract per adapter route kind, and every adapter the composite source can build", () => {
    assert.deepEqual([...meetingRouteKinds()].sort(), CAPABILITIES.map(({ name }) => name).sort());
    const kinds = meetingRouteKindContracts();
    assert.equal(kinds.length, meetingRouteKinds().length);
    assert.ok(kinds.every((contract) => contract.acquisitionAdapter.command[0] === "scripts/ingest.ts" && contract.wiring === null));
    const all = firewallRoutineContracts();
    assert.equal(new Set(all.map((contract) => contract.id)).size, all.length);
    assert.equal(new Set(all.map((contract) => contract.acquisitionAdapter.command.join(" "))).size, all.length);
    assert.ok(!all.some((contract) => "wiring" in contract && (contract as { wiring: unknown }).wiring !== null), "no real door is a code contract");
  });
});
