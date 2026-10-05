import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import { listDoors } from "@/lib/doors/registry.ts";
import { doorSeedOnFromEnv, seedDoorsOnStart } from "@/lib/doors/seed-all.ts";

const AT = "2026-10-05T16:00:00.000Z";

test("with the switch unset the runner writes nothing", async () => {
  const repos = createMemoryRepositories();
  const out = await seedDoorsOnStart(repos.doors, { env: {}, now: AT });
  assert.equal(out.seeded, false);
  assert.equal((await listDoors(repos.doors)).doors.length, 0);
  assert.equal(doorSeedOnFromEnv({}), false);
});

test("an empty registry is seeded once with meeting, feed and route-hint doors; a second start leaves it alone", async () => {
  const repos = createMemoryRepositories();
  const first = await seedDoorsOnStart(repos.doors, { env: { WTP_DOORS_SEED: "on" }, now: AT });
  assert.equal(first.seeded, true);
  const held = (await listDoors(repos.doors)).doors.length;
  assert.ok(held > 100, `seeded ${held}`);
  const second = await seedDoorsOnStart(repos.doors, { env: { WTP_DOORS_SEED: "on" }, now: AT });
  assert.equal(second.seeded, false);
  assert.equal((await listDoors(repos.doors)).doors.length, held);
});
