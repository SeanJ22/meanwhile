import { orderedAutonomousWorkIds } from "./helpers/ordered-autonomous-work.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { autonomousHarness } from "./helpers/autonomous-fleet.ts";
import { runAutonomousCoordinator } from "../lib/control-plane/workers/coordinator.ts";
import { createPlannerSpool } from "../lib/control-plane/scheduler/planner-spool.ts";
import { coordinatorLane } from "../lib/control-plane/scheduler/lane-reading.ts";
import { DiskRows } from "../lib/control-plane/scheduler/disk-rows.ts";
import { projectAggregate } from "../lib/control-plane/repository/types.ts";
import type { WorkItem } from "../lib/control-plane/work-item.ts";

for (const count of [3, 2000]) test(`coordinator keeps ${count} places on disk and reads complete source instructions only for one place`, async () => {
  const h = await autonomousHarness(), planner = await createPlannerSpool();
  let inventoryPages = 0, completeReads = 0, accepted = 0, snapshotCount = 0;
  const item = (i: number): WorkItem => ({ ...h.item, id: `work:${String(i).padStart(5, "0")}`, subject: `place:${i}`,
    autonomousPlan: { ...h.item.autonomousPlan!, ownerInstructions: [`send:${i % 20}`],
      // The fixture generates this fact on demand, rather than holding the country's full work in its own array.
      auditScope: "CAPTURED_ARTIFACT", seedUrls: [`https://place-${i}.example.gov/${"x".repeat(64 * 1024)}`] } });
  const forbidden = async (): Promise<never> => { throw new Error("unscoped country inventory"); };
  const workItems = { ...h.repos.workItems, list: forbidden, listNarrowed: forbidden,
    listChangedSince: async (...args: Parameters<NonNullable<typeof h.repos.workItems.listChangedSince>>) => {
      const options = args[2];
      assert.equal(typeof options?.page, "function", "inventory must deliver bounded pages, never return a country array");
      assert.ok(options?.projection, "the inventory query must project scheduling fields before transfer");
      for (let i = 0; i < count; i++) {
        const value = projectAggregate(item(i), options!.projection!) as WorkItem;
        assert.equal(value.autonomousPlan?.seedUrls, undefined);
        assert.equal(value.autonomousPlan?.sources, undefined);
        await options!.page!([{ id: value.id, revision: 1, updatedAt: h.now(), value }]);
        inventoryPages++;
      }
      return { through: h.now(), rows: [] };
    },
    mustRead: async (id: string) => {
      completeReads++;
      const value = item(Number(id.slice("work:".length)));
      return { id, value, revision: 1, updatedAt: h.now() };
    },
  };
  try {
    const result = await runAutonomousCoordinator({ ...h.runtime, repos: { ...h.repos, workItems } }, {
      planner, maximum: 0,
      acceptsWorkItem: value => {
        accepted++;
        assert.equal(completeReads, accepted, "complete place reads are consumed sequentially");
        assert.ok(value.autonomousPlan!.seedUrls[0]!.length > 64 * 1024);
        assert.ok(value.autonomousPlan!.sources.length > 0, "acceptance retains the original source authority");
        return true;
      },
      onSelectionSnapshot: rows => {
        assert.ok(rows instanceof DiskRows);
        assert.equal(rows.length, count);
        for (const row of rows) {
          snapshotCount++;
          assert.equal(row.autonomousPlan?.seedUrls, undefined);
          assert.equal(row.autonomousPlan?.sources, undefined);
        }
      },
    });
    assert.deepEqual({ inventoryPages, completeReads, accepted, snapshotCount },
      { inventoryPages: count, completeReads: count, accepted: count, snapshotCount: count });
    assert.equal(result.considered, count);
    assert.deepEqual(coordinatorLane(result), { due: count, dispatched: 0, active: 0, waiting: count,
      skippedBy: { COORDINATOR_CYCLE_MAX: count }, oldestWaitingDueAt: null });
    assert.ok(result.decisions instanceof DiskRows);
    assert.ok(result.dispatches instanceof DiskRows);
    assert.ok(result.deferred instanceof DiskRows);
    assert.equal(result.decisions.length, 0);
    assert.equal(result.deferred.length, count, "every deferred place survives without a retained country result array");
    assert.ok(result.deferred.every(row => row.reason === "COORDINATOR_CYCLE_MAX"));
    assert.equal(result.deferred.length, count, "disk results remain repeatable until the owning round closes");
  } finally { await planner.close(); }
});

test("disk scheduling preserves Send/part weights and complete ordering across streamed and collected result views", async () => {
  const h = await autonomousHarness(), planner = await createPlannerSpool();
  const items: WorkItem[] = [];
  for (let i = 0; i < 40; i++) {
    const value = { ...h.item, id: `ordered:${String(39 - i).padStart(2, "0")}`,
      createdAt: new Date(Date.parse(h.item.createdAt) + i % 5 * 1000).toISOString(),
      autonomousPlan: { ...h.item.autonomousPlan!, ownerInstructions: [`send:${i % 4}`],
        contract: { ...h.item.autonomousPlan!.contract, recordClass: i % 3 ? "OFFICIAL_ROSTER" : "VOTING_SITE" } } } as WorkItem;
    items.push(value); await h.repos.workItems.put(value.id, value, h.now());
  }
  // Keep the harness seed out of this inventory without suppressing any requested item.
  const selected = items.map(row => row.id);
  const open = new Map(Array.from({ length: 4 }, (_, i) => [`send:${i}`, new Map([["people-money", i + 1], ["ballot", 4 - i]])] as const));
  const priorities = [{ receiptId: "send:3", priority: 0 }, { receiptId: "send:1", priority: 1 }];
  try {
    const result = await runAutonomousCoordinator(h.runtime, { planner, maximum: 0, squads: { open },
      prioritizedInstructions: priorities, acceptsWorkItem: row => selected.includes(row.id) });
    const weights = new Map([...result.squadWeights].map(row => [`${row.send}/${row.part}`, row.weight]));
    const expected = await orderedAutonomousWorkIds(items, new Map(), priorities, {
      partOf: row => row.autonomousPlan!.contract.recordClass === "VOTING_SITE" ? "ballot" : "people-money",
      weightOf: (send, part) => weights.get(`${send}/${part}`)!,
    });
    assert.deepEqual([...result.deferred].map(row => row.workItemId), expected);
    assert.equal(new Set(expected).size, items.length);
  } finally { await planner.close(); }
});
