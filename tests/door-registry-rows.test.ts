import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import { SOURCE_WIRING, activeWiring, meetingSourceNamesForWiring, installRegistryWiring, wiringForMeetingSource, wiringForTypes } from "@/lib/registry/source-wiring.ts";
import { seedMeetingDoors } from "@/lib/doors/seed-meetings.ts";
import { doorRowsFor, wiringParity, wiringRowsFromDoors } from "@/lib/doors/rows.ts";
import { doorReadModeFromEnv, installDoorWiringFromRegistry } from "@/lib/doors/install.ts";
import { listDoors } from "@/lib/doors/registry.ts";

const AT = "2026-10-04T12:00:00.000Z";

async function seeded() {
  const repos = createMemoryRepositories();
  const counts = await seedMeetingDoors({ repo: repos.doors, wiring: SOURCE_WIRING, derived: [], deriveInputAt: AT, at: AT });
  assert.deepEqual(counts.refused, []);
  return repos;
}

test("the registry's rows are exactly the code's wiring rows", async () => {
  const repos = await seeded();
  const { doors } = await listDoors(repos.doors);
  assert.deepEqual(wiringParity(SOURCE_WIRING, wiringRowsFromDoors(doors)), []);
  for (const type of ["CIVICPLUS", "ICAL", "LEGISTAR", "CLERKSBOARDS", "SCHEDULEPAGE"] as const) {
    assert.deepEqual(wiringParity(SOURCE_WIRING.filter((r) => r.agendaSourceType === type), doorRowsFor([type], doors)), [], type);
  }
});

test("a registry that differs from the code is not used, and the switch is off by default", async () => {
  const repos = await seeded();
  assert.equal(doorReadModeFromEnv({}), "code");
  assert.equal(doorReadModeFromEnv({ WTP_DOORS_READ: "Registry" }), "registry");
  const off = await installDoorWiringFromRegistry(repos.doors, { mode: "code" });
  assert.equal(off.reading, "code");
  assert.equal(activeWiring(), SOURCE_WIRING);

  const on = await installDoorWiringFromRegistry(repos.doors, { mode: "registry" });
  assert.equal(on.reading, "registry", on.reason ?? "");
  assert.notEqual(activeWiring(), SOURCE_WIRING);
  assert.equal(wiringForTypes(["IQM2"]).length, SOURCE_WIRING.filter((r) => r.agendaSourceType === "IQM2").length);
  assert.deepEqual(wiringParity(wiringForMeetingSource("legistar"), SOURCE_WIRING.filter((r) => meetingSourceNamesForWiring(r).includes("legistar"))), []);

  const bad = (await listDoors(repos.doors)).doors[0];
  await repos.doors.compareAndSet(bad.doorId, (await repos.doors.read(bad.doorId))!.revision, { ...bad, config: { ...bad.config, extra: "x" } }, AT);
  const mismatch = await installDoorWiringFromRegistry(repos.doors, { mode: "registry" });
  assert.equal(mismatch.reading, "code");
  assert.ok(mismatch.differences.length > 0);
  assert.equal(activeWiring(), SOURCE_WIRING, "a mismatch leaves the code's list in force");

  const empty = await installDoorWiringFromRegistry(createMemoryRepositories().doors, { mode: "registry" });
  assert.equal(empty.reading, "code", "an unseeded registry changes nothing");
  installRegistryWiring(null);
});
