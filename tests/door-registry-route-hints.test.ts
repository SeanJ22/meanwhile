import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import { ROUTE_HINTS, routeHintProblems, routeHintsFingerprint } from "@/lib/hunt/meetings-route-hints.ts";
import { listDoors } from "@/lib/doors/registry.ts";
import { routeHintsFromDoors, seedRouteHintDoors } from "@/lib/doors/route-hints.ts";

const AT = "2026-10-04T12:00:00.000Z";

test("every committed route hint becomes a door and reads back exactly as it was, fingerprint included", async () => {
  const repos = createMemoryRepositories();
  const counts = await seedRouteHintDoors({ repo: repos.doors, hints: ROUTE_HINTS, deriveInputAt: AT, at: AT });
  assert.deepEqual(counts.refused, []);
  assert.equal(counts.created, ROUTE_HINTS.length);
  const back = routeHintsFromDoors((await listDoors(repos.doors)).doors);
  assert.equal(back.length, ROUTE_HINTS.length);
  for (const original of ROUTE_HINTS) {
    const read = back.find((h) => h.jurisdictionId === original.jurisdictionId);
    assert.deepEqual(read, original);
    assert.equal(routeHintsFingerprint(read!), routeHintsFingerprint(original));
  }
  assert.deepEqual(routeHintProblems(back), []);
});

test("importing twice changes nothing, and a shut door's hints are not tried", async () => {
  const repos = createMemoryRepositories();
  await seedRouteHintDoors({ repo: repos.doors, hints: ROUTE_HINTS, deriveInputAt: AT, at: AT });
  const again = await seedRouteHintDoors({ repo: repos.doors, hints: ROUTE_HINTS, deriveInputAt: AT, at: AT });
  assert.equal(again.unchanged, ROUTE_HINTS.length);
  const [door] = (await listDoors(repos.doors)).doors;
  await repos.doors.compareAndSet(door.doorId, (await repos.doors.read(door.doorId))!.revision, { ...door, status: "SUSPENDED" }, AT);
  assert.equal(routeHintsFromDoors((await listDoors(repos.doors)).doors).length, ROUTE_HINTS.length - 1);
});

test("the walk reads its hints from the doors once they exist, and from the committed list until then or when the registry cannot be read", async () => {
  const { readRouteHints } = await import("@/lib/doors/route-hints.ts");
  const repos = createMemoryRepositories();
  assert.equal(await readRouteHints(repos.doors, ROUTE_HINTS), ROUTE_HINTS, "an empty registry changes nothing");
  await seedRouteHintDoors({ repo: repos.doors, hints: ROUTE_HINTS.slice(0, 2), deriveInputAt: AT, at: AT });
  const fromDoors = await readRouteHints(repos.doors, ROUTE_HINTS);
  assert.equal(fromDoors.length, 2, "the doors alone decide once they are imported");
  const broken = { list: async () => { throw new Error("store down"); } } as never;
  assert.equal(await readRouteHints(broken, ROUTE_HINTS), ROUTE_HINTS);
});
