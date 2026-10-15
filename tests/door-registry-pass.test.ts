import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { MEETING_PARTITION_CONTRACTS, refreshMeetingPartitions, sittingWindowSourceIds } from "../lib/civic-data/meeting-partitions.ts";
import { activeWiring, type BodySourceWiring } from "../lib/registry/source-wiring.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { seedMeetingDoors } from "../lib/doors/seed-meetings.ts";
import { refreshDoorsForPass } from "../lib/doors/install.ts";
import { FIXTURE_DOOR_ROWS, installFixtureDoors } from "./helpers/meeting-doors-fixture.ts";

const code = FIXTURE_DOOR_ROWS.slice();
const AT = "2026-10-04T12:00:00.000Z";

describe("DB-13: meeting work follows the doors in use each pass", () => {
  afterEach(() => installFixtureDoors());

  it("adds a partition for a new door, and takes it away again", () => {
    const before = MEETING_PARTITION_CONTRACTS.length;
    const example = code.find((row) => row.agendaSourceType !== undefined)!;
    const added: BodySourceWiring = { ...example, bodyId: `${example.bodyId}-added-by-a-door-row` };
    const result = refreshMeetingPartitions([...code, added]);
    assert.equal(result.refreshed, true);
    assert.ok(MEETING_PARTITION_CONTRACTS.length > before);
    assert.ok(MEETING_PARTITION_CONTRACTS.some((contract) => contract.bodyId === added.bodyId));
    const own = MEETING_PARTITION_CONTRACTS.filter(contract => contract.bodyId === added.bodyId);
    for (const contract of own) assert.deepEqual([...sittingWindowSourceIds(contract.id)].sort(), own.map(sibling => sibling.id).sort());
    assert.equal(refreshMeetingPartitions(code).refreshed, true);
    assert.equal(MEETING_PARTITION_CONTRACTS.length, before);
  });

  it("leaves out a door that cannot be built, with its reason, and keeps every other door's work", () => {
    const before = MEETING_PARTITION_CONTRACTS.map((c) => c.id).sort();
    const invalid: BodySourceWiring = { ...code[0]!, bodyId: "invalid-door-body", config: {} };
    const result = refreshMeetingPartitions([...code, invalid]);
    assert.equal(result.refreshed, true);
    assert.equal(result.skipped.length, 1);
    assert.match(result.skipped[0]!, /invalid-door-body/);
    assert.deepEqual(MEETING_PARTITION_CONTRACTS.map((c) => c.id).sort(), before);
  });

  it("repeated routes of one source and body retain one partition and one clock", () => {
    const before = MEETING_PARTITION_CONTRACTS.map(contract => contract.id).sort();
    const result = refreshMeetingPartitions([...code, code[0]!]);
    assert.equal(result.refreshed, true);
    assert.deepEqual(result.skipped, []);
    assert.deepEqual(MEETING_PARTITION_CONTRACTS.map(contract => contract.id).sort(), before);
  });

  it("a registry that cannot be read gives the pass no doors and says why", async () => {
    const repo = { list: () => { throw new Error("offline"); }, listPage: () => { throw new Error("offline"); } } as never;
    const result = await refreshDoorsForPass(repo);
    assert.equal(result.rows, 0);
    assert.match(result.reason ?? "", /could not be read/);
    assert.equal(result.partitions, null);
  });

  it("a door added in the registry becomes meeting work on the next pass, with no deploy", async () => {
    const repos = createMemoryRepositories();
    const example = code[0]!;
    const added: BodySourceWiring = { ...example, bodyId: `${example.bodyId}-added-by-a-door-row` };
    await seedMeetingDoors({ repo: repos.doors, wiring: [...code, added], derived: [], deriveInputAt: AT, at: AT });
    const before = MEETING_PARTITION_CONTRACTS.length;
    const pass = await refreshDoorsForPass(repos.doors);
    assert.equal(pass.reason, null);
    assert.equal(pass.partitions?.refreshed, true);
    assert.ok(MEETING_PARTITION_CONTRACTS.length > before);
    assert.ok(MEETING_PARTITION_CONTRACTS.some((contract) => contract.bodyId === added.bodyId));
    assert.ok(activeWiring().some((row) => row.bodyId === added.bodyId));
  });
});
