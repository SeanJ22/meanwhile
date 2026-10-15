import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import { FIXTURE_DOOR_ROWS } from "./helpers/meeting-doors-fixture.ts";
import { seedMeetingDoors } from "@/lib/doors/seed-meetings.ts";
import { listDoors } from "@/lib/doors/registry.ts";
import { recordDoorOutcome, taskDoorIds } from "@/lib/doors/outcome.ts";
import { feedDoorDrafts, seedFeedDoors } from "@/lib/doors/seed-feeds.ts";

const AT = "2026-10-04T12:00:00.000Z";

async function seeded() {
  const repos = createMemoryRepositories();
  await seedMeetingDoors({ repo: repos.doors, wiring: FIXTURE_DOOR_ROWS.slice(0, 3), derived: [], deriveInputAt: AT, at: AT });
  return repos;
}

test("a success and a failure are each written to their own door and nothing else changes", async () => {
  const repos = await seeded();
  const [a, b] = (await listDoors(repos.doors)).doors;
  assert.equal(await recordDoorOutcome(repos.doors, a.doorId, "SUCCESS", "2026-10-04T13:00:00.000Z"), true);
  assert.equal(await recordDoorOutcome(repos.doors, a.doorId, "FAILURE", "2026-10-04T14:00:00.000Z"), true);
  const after = (await listDoors(repos.doors)).doors;
  const doorA = after.find((d) => d.doorId === a.doorId)!;
  const doorB = after.find((d) => d.doorId === b.doorId)!;
  assert.equal(doorA.lastSuccessAt, "2026-10-04T13:00:00.000Z");
  assert.equal(doorA.lastFailureAt, "2026-10-04T14:00:00.000Z");
  assert.equal(doorA.status, a.status);
  assert.equal(doorA.editedAt, a.editedAt, "a system write is not a hand edit");
  assert.equal(doorB.lastSuccessAt, null);
  assert.equal(doorB.lastFailureAt, null);
});

test("independent body reads record each result on its own door, and a door that is not in the registry is not invented", async () => {
  const repos = await seeded();
  const [a, b] = (await listDoors(repos.doors)).doors;
  const results = await Promise.all([
    { doorId: a.doorId, outcome: "SUCCESS" },
    { doorId: b.doorId, outcome: "FAILURE" },
    { doorId: "meetings:nowhere:none", outcome: "SUCCESS" },
  ].map(row => recordDoorOutcome(repos.doors, row.doorId, row.outcome as "SUCCESS" | "FAILURE", AT)));
  assert.deepEqual(results, [true, true, false]);
  const after = (await listDoors(repos.doors)).doors;
  assert.equal(after.find((d) => d.doorId === a.doorId)!.lastFailureAt, null);
  assert.equal(after.find((d) => d.doorId === b.doorId)!.lastSuccessAt, null);
  assert.equal(after.find((d) => d.doorId === b.doorId)!.lastFailureAt, AT);
  assert.equal((await repos.doors.read("meetings:nowhere:none")), null);
});

test("a routine task's read lands on its meeting door or its feed door, and on no door when it has neither", async () => {
  const repos = await seeded();
  const [meeting] = (await listDoors(repos.doors)).doors;
  await seedFeedDoors({ repo: repos.doors, deriveInputAt: AT, at: AT });
  const feed = feedDoorDrafts()[0]!;
  const taskId = String(feed.config!.contractId);
  assert.deepEqual(await taskDoorIds(repos.doors, meeting!.doorId), [meeting!.doorId]);
  assert.deepEqual(await taskDoorIds(repos.doors, taskId), [feed.doorId]);
  assert.deepEqual(await taskDoorIds(repos.doors, "no-such-task"), []);
  assert.equal(await recordDoorOutcome(repos.doors, (await taskDoorIds(repos.doors, taskId))[0]!, "SUCCESS", "2026-10-04T13:00:00.000Z"), true);
  assert.equal((await repos.doors.read(feed.doorId))!.value.lastSuccessAt, "2026-10-04T13:00:00.000Z");
});
