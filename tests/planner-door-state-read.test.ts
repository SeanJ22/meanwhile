import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { BOOTSTRAP_DDL } from "../lib/control-plane/repository/pg-schema.ts";
import { CONTROL_READS_BACKFILL_DDL } from "../lib/control-plane/repository/control-reads-backfill.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { seedMeetingDoors } from "../lib/doors/seed-meetings.ts";
import { listDoors, type DoorRecord } from "../lib/doors/registry.ts";
import { wiringRowsFromDoors, meetingDoorHosts } from "../lib/doors/rows.ts";
import { buildOutcomePartitions } from "../lib/civic-data/outcome-partitions.ts";
import { readPlannerMeetingDoors, refreshPlannerDoorsForPass } from "../lib/civic-data/planner-door-state-read.ts";
import type { ReadOnlyQuery } from "../lib/control-plane/admin-view/promoted-slices.ts";
import { FIXTURE_DOOR_ROWS, installFixtureDoors } from "./helpers/meeting-doors-fixture.ts";

test("planner door startup reads only its state's meeting doors on the production schema", async t => {
  const db = new PGlite();
  t.after(async () => { installFixtureDoors(); await db.close(); });
  // These are the actual table and state-index definitions applied by the
  // production control-plane migrations; the test declares no substitute schema.
  await db.exec(BOOTSTRAP_DDL.find(ddl => ddl.startsWith("CREATE TABLE IF NOT EXISTS cp_doors ("))!);
  await db.exec(CONTROL_READS_BACKFILL_DDL[0]);
  await db.exec(CONTROL_READS_BACKFILL_DDL.find(ddl => ddl.startsWith("CREATE INDEX IF NOT EXISTS cp_doors_planning_state"))!);
  const repos = createMemoryRepositories();
  const at = "2026-10-21T00:00:00.000Z";
  await seedMeetingDoors({ repo: repos.doors, wiring: FIXTURE_DOOR_ROWS.filter(row => row.agendaSourceType === "ICAL"), derived: [], deriveInputAt: at, at });
  const seed = (await listDoors(repos.doors)).doors[0]!;
  assert.ok(seed);
  const rows: DoorRecord[] = Array.from({ length: 103 }, (_, n) => ({ ...seed,
    doorId: `id-meeting-${String(n).padStart(3, "0")}`, ocdId: `ocd-division/country:us/state:id/county:fixture-${n}`,
    bodyIds: [`ocd-division/country:us/state:id/county:fixture-${n}#governing`],
    status: n === 0 ? "SHUT" : n === 1 ? "SUSPENDED" : "OPEN",
    config: { ...seed.config, slug: `fixture-${n}` },
    meeting: { ...seed.meeting!, family: n === 2 ? "US-ID" : null },
  }));
  const elsewhere: DoorRecord = { ...rows[0], doorId: "nh-meeting", ocdId: "ocd-division/country:us/state:nh", bodyIds: ["ocd-division/country:us/state:nh#governing"] };
  const vote: DoorRecord = { ...rows[0], doorId: "id-voting-source", meeting: null, kind: "official-voting-source",
    config: { votingSource: "x".repeat(2_000_000) } };
  for (const row of [...rows, elsewhere, vote]) await db.query("INSERT INTO cp_doors(id,revision,updated_at,value) VALUES($1,1,$2,$3)", [row.doorId, at, JSON.stringify(row)]);
  await db.query("INSERT INTO cp_doors(id,revision,updated_at,value) VALUES('id-malformed',1,$1,$2)", [at,
    JSON.stringify({ ocdId: rows[0].ocdId, meeting: {}, formatVersion: 0 })]);
  let calls = 0, bytes = 0;
  const query: ReadOnlyQuery = async statements => {
    calls++;
    const results = await Promise.all(statements.map(async statement => (await db.query<Record<string, unknown>>(statement.text, [...statement.params])).rows));
    bytes += Buffer.byteLength(JSON.stringify(results));
    return results;
  };
  const read = await readPlannerMeetingDoors("ID", query);
  assert.equal(calls, 2, "meeting reads are keyset paged");
  assert.equal(read.length, rows.length);
  assert.ok(read.every(row => row.ocdId?.includes("/state:id")));
  assert.ok(bytes < 200_000, `the unrelated two-megabyte voting inventory stays in the database (${bytes} bytes read)`);
  assert.deepEqual(wiringRowsFromDoors(read), wiringRowsFromDoors([...rows, vote]));
  assert.deepEqual(meetingDoorHosts(read), meetingDoorHosts([...rows, vote]));
  assert.deepEqual(buildOutcomePartitions(read), buildOutcomePartitions([...rows, vote]));
  const refreshed = await refreshPlannerDoorsForPass("id", query);
  assert.equal(refreshed.rows, wiringRowsFromDoors(rows).length);
  assert.equal(refreshed.reason, null);
  assert.deepEqual(await readPlannerMeetingDoors("system", query), []);
  await assert.rejects(readPlannerMeetingDoors("all", query), /PLANNER_DOOR_STATE_INVALID/);
  const failed = await refreshPlannerDoorsForPass("id", async () => { throw new Error("transport failed"); });
  assert.equal(failed.partitions, null);
  assert.match(failed.reason ?? "", /transport failed/);
});
