import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import { applyDerivedRow, applyManualEdit, editableFieldsOf, listDoors, type DoorRecord, type DoorRepository } from "@/lib/doors/registry.ts";
import { doorSyncLine, readDoorImport, seedAllDoors, syncHeldDoors } from "@/lib/doors/seed-all.ts";

const AT = "2026-10-05T16:00:00.000Z";
const LATER = "2026-10-05T16:05:00.000Z";

/** Hands every stored value back with its keys in reverse order, as a JSON column may. */
function reordering(repo: DoorRepository): DoorRepository {
  const flip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(flip);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).reverse().map(([k, v]) => [k, flip(v)]));
  };
  return Object.assign(Object.create(repo) as DoorRepository, {
    read: async (id: string) => {
      const row = await repo.read(id);
      return row === null ? null : { ...row, value: flip(row.value) as DoorRecord };
    },
    listWhere: async (path: readonly string[], value: string) => (await repo.listWhere(path, value)).map((row) => ({ ...row, value: flip(row.value) as DoorRecord })),
    list: async () => { throw new Error("state seeding must not list the country"); },
  });
}

test("every pass brings the held doors into an empty registry with no switch, and a second pass writes nothing", async () => {
  const repos = createMemoryRepositories();
  const first = await syncHeldDoors(repos.doors, "US-AZ", { now: AT });
  assert.equal(first.synced, true);
  const held = (await listDoors(repos.doors)).doors.length;
  assert.ok(held > 50, `held ${held}`);
  assert.ok(first.synced && first.result.total === held);
  const second = await syncHeldDoors(reordering(repos.doors), "US-AZ", { now: LATER });
  assert.ok(second.synced);
  const { imported, meetings, feeds, routeHints } = second.result;
  assert.deepEqual([imported.created + meetings.created + feeds.created + routeHints.created, imported.updated + meetings.updated + feeds.updated + routeHints.updated], [0, 0],
    "settings handed back in another key order are the same settings");
  assert.match(doorSyncLine(second), new RegExp(`^${held} doors held; 0 added, 0 updated this pass; door import: 0 added, 0 updated, ${imported.unchanged} already there, 0 kept their hand edit$`));
});

test("a door that left the registry comes back on the next pass", async () => {
  const repos = createMemoryRepositories();
  await syncHeldDoors(repos.doors, "US-AZ", { now: AT });
  const before = (await listDoors(repos.doors)).doors;
  const gone = before.find((door) => door.kind === "route-hints")!;
  const rows = (await repos.doors.list()).filter((row) => row.id !== gone.doorId);
  const fresh = createMemoryRepositories();
  for (const row of rows) await fresh.doors.put(row.id, row.value, AT);
  const out = await syncHeldDoors(fresh.doors, "US-AZ", { now: LATER });
  assert.ok(out.synced && out.result.routeHints.created === 1);
  assert.equal((await listDoors(fresh.doors)).doors.length, before.length);
});

test("key order alone never counts as a change", () => {
  const draft = { doorId: "d", kind: "ical", ocdId: null, bodyIds: [], hosts: ["a.gov"], config: { icalUrl: "https://a.gov/c.ics", jurisdiction: "A" },
    holds: ["meetings"], checkEveryMinutes: 60, notes: "", meeting: null, status: "OPEN" as const, readNow: false };
  const stored = applyDerivedRow(null, draft, AT, AT)!;
  const flipped = { ...stored, config: { jurisdiction: "A", icalUrl: "https://a.gov/c.ics" } };
  assert.equal(applyDerivedRow(flipped, editableFieldsOf(stored), LATER, LATER), null);
});

test("the one-time door import adds every hand-wired door once, and keeps a door edited in the registry since", async () => {
  const repos = createMemoryRepositories();
  const imported = readDoorImport();
  const file = { ...imported, rows: imported.rows.filter(row => row.ocdId?.includes("/state:az")) };
  // An edit made after the rows were taken from code.
  const EDITED = new Date(Date.parse(file.generatedAt) + 60_000).toISOString();
  assert.ok(file.rows.length > 0, `${file.rows.length} state rows`);
  const first = await seedAllDoors({ repo: repos.doors, state: "US-AZ", imported: file, derived: [], now: AT });
  assert.deepEqual(first.imported.refused, []);
  assert.ok(first.imported.created >= file.rows.length, "every row becomes at least one door");
  assert.equal(first.imported.updated, 0);
  const door = (await listDoors(repos.doors)).doors.find((d) => d.meeting != null)!;
  const row = (await repos.doors.read(door.doorId))!;
  await repos.doors.compareAndSet(door.doorId, row.revision, applyManualEdit(door, { ...editableFieldsOf(door), notes: "checked by hand" }, EDITED), EDITED);
  const second = await seedAllDoors({ repo: repos.doors, state: "US-AZ", imported: file, derived: [], now: EDITED });
  assert.equal(second.imported.created, 0);
  assert.equal(second.imported.updated, 0);
  assert.equal(second.imported.unchanged + second.imported.keptManualEdit, first.imported.created);
  assert.equal((await repos.doors.read(door.doorId))!.value.notes, "checked by hand");
});
