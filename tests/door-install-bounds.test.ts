import assert from "node:assert/strict";
import test from "node:test";
import { refreshDoorsForPass } from "../lib/doors/install.ts";
import { installDoorRecords } from "../lib/doors/meeting-doors.ts";
import type { DoorRecord } from "../lib/doors/registry.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { Persisted } from "../lib/control-plane/repository/types.ts";
import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import { activeWiring } from "../lib/registry/source-wiring.ts";
import { ocdStateCode } from "../lib/ocd/state-of.ts";
import { fixtureDoorRecords, installFixtureDoors } from "./helpers/meeting-doors-fixture.ts";

const at = "2026-10-20T12:00:00.000Z";

test("a fresh state child installs its own doors from paged country identities and preserves body-id state fallback", async t => {
  t.after(() => installFixtureDoors());
  const held = fixtureDoorRecords();
  const fallback = held.find(door => door.ocdId === null && door.bodyIds[0]?.startsWith("curated:az/"))!;
  const local = held.find(door => ocdStateCode(door.ocdId) === "az" && door.meeting?.agendaSourceType === "CLERKSBOARDS")!;
  assert.ok(fallback && local);
  const own = [fallback, ...Array.from({ length: 299 }, (_, index): DoorRecord => ({
    ...local, doorId: `${local.doorId}-bounded-${index}`, bodyIds: [`${local.bodyIds[0]}-bounded-${index}`],
  }))];
  const repo = createMemoryRepositories().doors;
  for (const door of own) await repo.put(door.doorId, door, at);
  const ownIds = new Set(own.map(door => door.doorId));
  let pages = 0, identities = 0, reads = 0;
  const identity = (id: string, ocdId: string | null, bodyIds: readonly string[]): Persisted<DoorRecord> => ({
    id, revision: 1, updatedAt: at, value: { ocdId, bodyIds } as DoorRecord,
  });
  const scoped = { ...repo,
    list: async (): Promise<never> => { throw Error("country configurations"); },
    listNarrowed: async (): Promise<never> => { throw Error("country identities"); },
    listChangedSince: async (...args: Parameters<NonNullable<typeof repo.listChangedSince>>) => {
      assert.deepEqual(args[2]?.projection, { ocdId: true, bodyIds: true });
      assert.ok(args[2]?.page);
      for (let offset = 0; offset < 5000; offset += 17) {
        const rows = Array.from({ length: Math.min(17, 5000 - offset) }, (_, index) =>
          identity(`foreign:${offset + index}`, "ocd-division/country:us/state:nh", []));
        pages++; identities += rows.length;
        await args[2].page(rows);
      }
      for (let offset = 0; offset < own.length; offset += 17) {
        const rows = own.slice(offset, offset + 17).map(door => identity(door.doorId, door.ocdId, door.bodyIds));
        pages++; identities += rows.length;
        await args[2].page(rows);
      }
      await args[2].page(Array.from({ length: 100 }, (_, index) => identity(`unplaced:${index}`, null, [])));
      return { rows: [], through: at };
    },
    readMany: async (ids: readonly string[]) => {
      assert.ok(ids.length <= 128, "configuration reads remain one bounded batch");
      assert.ok(ids.every(id => ownIds.has(id)), "foreign state configurations never enter this child");
      reads++;
      return repo.readMany!(ids);
    },
  };
  installDoorRecords([]);
  assert.equal(MEETING_PARTITION_CONTRACTS.some(contract => contract.bodyId === fallback.bodyIds[0]), false);
  const result = await refreshDoorsForPass(scoped, { state: "az" });
  assert.equal(result.reason, null);
  assert.ok(pages > 300 && identities === 5300, "the entire growing inventory was visited through bounded pages");
  assert.equal(reads, 3);
  assert.equal(result.rows, own.length);
  assert.deepEqual(new Set(result.doors?.map(door => door.doorId)), ownIds);
  assert.equal(result.partitions?.skippedCount, 100);
  assert.equal(result.partitions?.skipped.length, 25, "unplaceable country identities leave bounded diagnostics and an exact count");
  assert.ok(MEETING_PARTITION_CONTRACTS.some(contract => contract.bodyId === fallback.bodyIds[0]));
  assert.equal(activeWiring().length, own.length);
  assert.ok(activeWiring().every(row => ocdStateCode(row.ocdId) === "az" || row.bodyId === fallback.bodyIds[0]));
});
