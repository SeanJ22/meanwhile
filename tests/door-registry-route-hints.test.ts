import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import { ROUTE_HINTS, routeHintProblems, routeHintsFingerprint } from "@/lib/hunt/meetings-route-hints.ts";
import { readRouteHints, routeHintsDoorId, seedRouteHintDoors } from "@/lib/doors/route-hints.ts";

const AT = "2026-10-04T12:00:00.000Z";

test("every committed route hint becomes a door and reads back exactly as it was, fingerprint included", async () => {
  const repos = createMemoryRepositories();
  const counts = await seedRouteHintDoors({ repo: repos.doors, hints: ROUTE_HINTS, deriveInputAt: AT, at: AT });
  assert.deepEqual(counts.refused, []);
  assert.equal(counts.created, ROUTE_HINTS.length);
  const back = (await Promise.all(ROUTE_HINTS.map(hint => readRouteHints(repos.doors, hint.jurisdictionId)))).flat();
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
  const door = (await repos.doors.mustRead(routeHintsDoorId(ROUTE_HINTS[0].jurisdictionId))).value;
  await repos.doors.compareAndSet(door.doorId, (await repos.doors.read(door.doorId))!.revision, { ...door, status: "SUSPENDED" }, AT);
  assert.deepEqual(await readRouteHints(repos.doors, ROUTE_HINTS[0].jurisdictionId), []);
});

test("a discovery reads only its own live door and never substitutes committed hints for a failed read", async () => {
  const repos = createMemoryRepositories();
  const original = ROUTE_HINTS[0];
  assert.deepEqual(await readRouteHints(repos.doors, original.jurisdictionId), []);
  await seedRouteHintDoors({ repo: repos.doors, hints: ROUTE_HINTS.slice(0, 2), deriveInputAt: AT, at: AT });
  repos.doors.list = async () => { throw new Error("countrywide read"); };
  assert.deepEqual(await readRouteHints(repos.doors, original.jurisdictionId), [original]);
  const row = await repos.doors.mustRead(routeHintsDoorId(original.jurisdictionId));
  const edited = { ...original.routes[0], url: `${original.routes[0].url}&edited=1` };
  await repos.doors.compareAndSet(row.id, row.revision, { ...row.value, config: { ...row.value.config, "route:00": JSON.stringify(edited) } }, AT);
  assert.equal((await readRouteHints(repos.doors, original.jurisdictionId))[0].routes[0].url, edited.url);
  const current = await repos.doors.mustRead(row.id);
  await repos.doors.compareAndSet(current.id, current.revision, { ...current.value, status: "SUSPENDED" }, AT);
  assert.deepEqual(await readRouteHints(repos.doors, original.jurisdictionId, [edited]), []);
  const broken = { read: async () => { throw new Error("store down"); } } as never;
  await assert.rejects(readRouteHints(broken, original.jurisdictionId), /store down/);
});
