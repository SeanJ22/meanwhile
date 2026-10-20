import { registryJurisdictions } from "../lib/civic-data/state-scopes.ts";
import { ocdStateCode } from "../lib/ocd/state-of.ts";
import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import { activeWiring, meetingSourceNamesForWiring, wiringForMeetingSource, wiringForTypes, type BodySourceWiring } from "@/lib/registry/source-wiring.ts";
import { seedMeetingDoors } from "@/lib/doors/seed-meetings.ts";
import { compareRows, wiringRowsFromDoors } from "@/lib/doors/rows.ts";
import { refreshDoorsForPass } from "@/lib/doors/install.ts";
import { listDoors } from "@/lib/doors/registry.ts";
import { FIXTURE_DOOR_ROWS, installFixtureDoors } from "./helpers/meeting-doors-fixture.ts";

const AT = "2026-10-04T12:00:00.000Z";

function canonical(rows: readonly BodySourceWiring[]): string[] {
  const sortKeys = (value: unknown): unknown =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, sortKeys(v)]))
      : value;
  return rows.slice().sort(compareRows).map((row) => JSON.stringify(sortKeys(row)));
}

async function seeded() {
  const repos = createMemoryRepositories();
  const counts = await seedMeetingDoors({ repo: repos.doors, wiring: FIXTURE_DOOR_ROWS, derived: [], deriveInputAt: AT, at: AT });
  assert.deepEqual(counts.refused, []);
  return repos;
}

test("the imported rows come back out of the registry exactly as they went in", async () => {
  const repos = await seeded();
  const { doors } = await listDoors(repos.doors);
  assert.deepEqual(canonical(wiringRowsFromDoors(doors)), canonical(FIXTURE_DOOR_ROWS));
});

test("each pass reads the registry: adapters see its rows, and an edit is read on the next pass", async (t) => {
  t.after(() => installFixtureDoors());
  const repos = await seeded();
  for (const state of new Set(FIXTURE_DOOR_ROWS.map(row => (ocdStateCode(row.ocdId) ?? registryJurisdictions(row.bodyId)[0]?.toLowerCase())!))) {
    const pass = await refreshDoorsForPass(repos.doors, { state });
    const expected = FIXTURE_DOOR_ROWS.filter(row => (ocdStateCode(row.ocdId) ?? registryJurisdictions(row.bodyId)[0]?.toLowerCase()) === state);
    assert.equal(pass.reason, null);
    assert.equal(pass.rows, expected.length);
    assert.equal(wiringForTypes(["IQM2"]).length, expected.filter(row => row.agendaSourceType === "IQM2").length);
    assert.deepEqual(canonical(wiringForMeetingSource("legistar")), canonical(expected.filter(row => meetingSourceNamesForWiring(row).includes("legistar"))));
    assert.ok(activeWiring().every(row => (ocdStateCode(row.ocdId) ?? registryJurisdictions(row.bodyId)[0]?.toLowerCase()) === state));
  }

  const door = (await listDoors(repos.doors)).doors.find((d) => d.meeting?.agendaSourceType === "ICAL")!;
  await repos.doors.compareAndSet(door.doorId, (await repos.doors.read(door.doorId))!.revision, { ...door, config: { ...door.config, extra: "x" } }, AT);
  await refreshDoorsForPass(repos.doors, { state: ocdStateCode(door.ocdId!)! });
  assert.ok(activeWiring().some((row) => row.bodyId === door.bodyIds[0] && row.config.extra === "x"), "a door edited in the registry is read from the next pass (DB-13)");

  const empty = await refreshDoorsForPass(createMemoryRepositories().doors);
  assert.equal(empty.rows, 0);
  assert.match(empty.reason ?? "", /holds no meeting door in use/);
  assert.equal(activeWiring().length, 0);
});
