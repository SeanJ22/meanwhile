import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { MEETING_PARTITION_CONTRACTS, refreshMeetingPartitions, sittingWindowSourceIds } from "../lib/civic-data/meeting-partitions.ts";
import { installRegistryWiring, SOURCE_WIRING, type BodySourceWiring } from "../lib/registry/source-wiring.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { seedMeetingDoors } from "../lib/doors/seed-meetings.ts";
import { refreshDoorsForPass } from "../lib/doors/install.ts";

const code = SOURCE_WIRING.slice();
const AT = "2026-10-04T12:00:00.000Z";

function restore(): void {
  installRegistryWiring(null);
  refreshMeetingPartitions(code);
}

describe("DB-13: meeting work follows the doors in use each pass", () => {
  afterEach(restore);

  it("adds a partition for a door the code does not name, and takes it away again", () => {
    const before = MEETING_PARTITION_CONTRACTS.length;
    const example = code.find((row) => row.agendaSourceType !== undefined)!;
    const added: BodySourceWiring = { ...example, bodyId: `${example.bodyId}-added-by-a-door-row` };
    const result = refreshMeetingPartitions([...code, added]);
    assert.equal(result.refreshed, true);
    assert.ok(MEETING_PARTITION_CONTRACTS.length > before);
    assert.ok(MEETING_PARTITION_CONTRACTS.some((contract) => contract.bodyId === added.bodyId));
    assert.ok(sittingWindowSourceIds(MEETING_PARTITION_CONTRACTS.find((c) => c.bodyId === added.bodyId)!.id).length <= 1);
    assert.equal(refreshMeetingPartitions(code).refreshed, true);
    assert.equal(MEETING_PARTITION_CONTRACTS.length, before);
  });

  it("leaves the last good list in place when a door cannot be built", () => {
    const before = MEETING_PARTITION_CONTRACTS.slice();
    const doubled = [...code, code[0]!];
    const result = refreshMeetingPartitions(doubled);
    assert.equal(result.refreshed, false);
    assert.match(result.reason ?? "", /previous list stays in use/);
    assert.deepEqual(MEETING_PARTITION_CONTRACTS.map((c) => c.id), before.map((c) => c.id));
  });

  it("with the switch off nothing is read or rebuilt", async () => {
    const repo = { list: () => { throw new Error("must not be read"); } } as never;
    const result = await refreshDoorsForPass(repo, { mode: "code" });
    assert.equal(result.reading, "code");
    assert.equal(result.partitions, null);
  });

  it("a door added in the registry becomes meeting work on the next pass, with no deploy", async () => {
    const repos = createMemoryRepositories();
    const example = code[0]!;
    const added: BodySourceWiring = { ...example, bodyId: `${example.bodyId}-added-by-a-door-row` };
    await seedMeetingDoors({ repo: repos.doors, wiring: [...code, added], derived: [], deriveInputAt: AT, at: AT });
    const before = MEETING_PARTITION_CONTRACTS.length;
    const pass = await refreshDoorsForPass(repos.doors, { mode: "registry" });
    assert.equal(pass.reading, "registry", pass.reason ?? "");
    assert.equal(pass.partitions?.refreshed, true);
    assert.ok(MEETING_PARTITION_CONTRACTS.length > before);
    assert.ok(MEETING_PARTITION_CONTRACTS.some((contract) => contract.bodyId === added.bodyId));
  });
});
