import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import { SOURCE_WIRING } from "@/lib/registry/source-wiring.ts";
import { seedMeetingDoors } from "@/lib/doors/seed-meetings.ts";
import { listDoors } from "@/lib/doors/registry.ts";
import { recordDoorOutcome, recordMemberOutcomes, taskDoorId } from "@/lib/doors/outcome.ts";
import { feedDoorDrafts, seedFeedDoors } from "@/lib/doors/seed-feeds.ts";

const AT = "2026-10-04T12:00:00.000Z";

async function seeded() {
  const repos = createMemoryRepositories();
  await seedMeetingDoors({ repo: repos.doors, wiring: SOURCE_WIRING.slice(0, 3), derived: [], deriveInputAt: AT, at: AT });
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

test("a family read records each member on its own door, and a door that is not in the registry is not invented", async () => {
  const repos = await seeded();
  const [a, b] = (await listDoors(repos.doors)).doors;
  const result = await recordMemberOutcomes(repos.doors, [
    { doorId: a.doorId, outcome: "SUCCESS" },
    { doorId: b.doorId, outcome: "FAILURE" },
    { doorId: "meetings:nowhere:none", outcome: "SUCCESS" },
  ], AT);
  assert.deepEqual(result, { recorded: 2, missing: 1 });
  const after = (await listDoors(repos.doors)).doors;
  assert.equal(after.find((d) => d.doorId === a.doorId)!.lastFailureAt, null);
  assert.equal(after.find((d) => d.doorId === b.doorId)!.lastSuccessAt, null);
  assert.equal(after.find((d) => d.doorId === b.doorId)!.lastFailureAt, AT);
  assert.equal((await repos.doors.read("meetings:nowhere:none")), null);
});

test("the family child's one call records every member's own result and survives an unwritable registry", async () => {
  const repos = await seeded();
  const [a, b] = (await listDoors(repos.doors)).doors;
  const { recordFamilyReads } = await import("@/lib/doors/outcome.ts");
  const done = await recordFamilyReads(repos.doors, [{ ok: true, member: { id: a.doorId } }, { ok: false, member: { id: b.doorId } }], AT);
  assert.deepEqual(done, { recorded: 2, missing: 0 });
  const broken = { read: async () => { throw new Error("store down"); } } as never;
  assert.equal(await recordFamilyReads(broken, [{ ok: true, member: { id: a.doorId } }], AT), null);
});

test("a routine task's read lands on its meeting door or its feed door, and on no door when it has neither", async () => {
  const repos = await seeded();
  const [meeting] = (await listDoors(repos.doors)).doors;
  await seedFeedDoors({ repo: repos.doors, deriveInputAt: AT, at: AT });
  const feed = feedDoorDrafts()[0]!;
  const taskId = String(feed.config!.contractId);
  assert.equal(await taskDoorId(repos.doors, meeting!.doorId), meeting!.doorId);
  assert.equal(await taskDoorId(repos.doors, taskId), feed.doorId);
  assert.equal(await taskDoorId(repos.doors, "no-such-task"), null);
  assert.equal(await recordDoorOutcome(repos.doors, (await taskDoorId(repos.doors, taskId))!, "SUCCESS", "2026-10-04T13:00:00.000Z"), true);
  assert.equal((await repos.doors.read(feed.doorId))!.value.lastSuccessAt, "2026-10-04T13:00:00.000Z");
});
