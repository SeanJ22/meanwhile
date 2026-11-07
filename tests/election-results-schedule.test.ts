import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { applyManualEdit, editableFieldsOf, listDoors } from "../lib/doors/registry.ts";
import { seedFeedDoors } from "../lib/doors/seed-feeds.ts";
import { nextElectionResultCheck } from "../lib/election-results/schedule.ts";

test("result clocks count every six hours, revisit calls daily for seven days, then weekly, and stop at certification", () => {
  const calledAt = "2026-11-04T00:00:00.000Z";
  assert.equal(nextElectionResultCheck({ status: "counting", lastCheckedAt: calledAt }, undefined, calledAt), "2026-11-04T06:00:00.000Z");
  assert.equal(nextElectionResultCheck({ status: "called", calledAt, lastCheckedAt: "2026-11-10T00:00:00.000Z" }, undefined,
    "2026-11-10T12:00:00.000Z"), "2026-11-11T00:00:00.000Z");
  assert.equal(nextElectionResultCheck({ status: "called", calledAt, lastCheckedAt: "2026-11-11T00:00:00.000Z" }, undefined,
    "2026-11-11T00:00:00.000Z"), "2026-11-18T00:00:00.000Z");
  assert.equal(nextElectionResultCheck({ status: "certified", calledAt, lastCheckedAt: calledAt }, undefined, calledAt), null);
  for (const status of ["pending", "runoff"]) assert.equal(nextElectionResultCheck({ status, lastCheckedAt: calledAt }, undefined, calledAt),
    "2026-11-04T06:00:00.000Z");
});

test("source clocks use Admin's settings and retain manual settings through registry seeding", async () => {
  const repos = createMemoryRepositories(), at = "2026-11-04T00:00:00.000Z";
  await seedFeedDoors({ repo: repos.doors, deriveInputAt: at, at });
  const held = (await listDoors(repos.doors)).doors.find(row => row.doorId === "feed:election-results:multistate")!;
  const edited = applyManualEdit(held, { ...editableFieldsOf(held), config: { ...held.config, countingMinutes: 120, calledMinutes: 720,
    calledDays: 5, weeklyMinutes: 2_880 } }, "2026-11-04T01:00:00.000Z");
  const current = await repos.doors.mustRead(held.doorId);
  await repos.doors.compareAndSet(held.doorId, current.revision, edited, "2026-11-04T01:00:00.000Z");
  const seeded = await seedFeedDoors({ repo: repos.doors, deriveInputAt: at, at: "2026-11-04T02:00:00.000Z" });
  assert.ok(seeded.keptManualEdit > 0);
  assert.deepEqual((await repos.doors.mustRead(held.doorId)).value.config, edited.config);
  assert.equal(nextElectionResultCheck({ status: "counting", lastCheckedAt: at }, edited, at), "2026-11-04T02:00:00.000Z");
  assert.equal(nextElectionResultCheck({ status: "called", calledAt: at, lastCheckedAt: "2026-11-10T00:00:00.000Z" }, edited,
    "2026-11-10T00:00:00.000Z"), "2026-11-12T00:00:00.000Z");
  assert.equal(nextElectionResultCheck({ status: "counting", lastCheckedAt: at }, { ...edited, checkEveryMinutes: 60 }, at),
    "2026-11-04T01:00:00.000Z");
  assert.equal(nextElectionResultCheck({ status: "counting", lastCheckedAt: at }, { ...edited, status: "SUSPENDED" }, at), null);
});
