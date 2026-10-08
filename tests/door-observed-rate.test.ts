import assert from "node:assert/strict";
import test from "node:test";

import { ROUTINE_SOURCE_TASKS, routineTaskDue, type RoutineTaskClock } from "../lib/civic-data/runner.ts";
import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import { COLD_CHECK_MINUTES, STANDING_CHECK_MINUTES, overdueDoors } from "@/lib/doors/overdue.ts";
import { MIN_OBSERVED_CHECK_MINUTES, checkEveryWithObserved, doorRateRow, observeChange, observedChangeMinutesByDoor, recordDoorChange } from "@/lib/doors/observed-rate.ts";
import { recordDoorOutcome } from "@/lib/doors/outcome.ts";
import { FIXTURE_DOOR_ROWS } from "./helpers/meeting-doors-fixture.ts";
import { seedMeetingDoors } from "@/lib/doors/seed-meetings.ts";
import { applyDerivedRow, editableFieldsOf, listDoors, type DoorRecord } from "@/lib/doors/registry.ts";

const AT = "2026-10-04T00:00:00.000Z";
const at = (hours: number) => new Date(Date.parse(AT) + hours * 3_600_000).toISOString();
const bare = { lastChangedAt: null, observedChangeMinutes: null, observedChanges: 0 } as const;

async function oneDoor() {
  const repos = createMemoryRepositories();
  await seedMeetingDoors({ repo: repos.doors, wiring: FIXTURE_DOOR_ROWS.slice(0, 1), derived: [], deriveInputAt: AT, at: AT });
  return { repos, door: (await listDoors(repos.doors)).doors[0]! };
}

test("the first change only starts the clock; each later one adds a gap to a running average", () => {
  const first = observeChange(bare, at(0));
  assert.deepEqual(first, { lastChangedAt: at(0), observedChangeMinutes: null, observedChanges: 0 });
  const second = observeChange(first, at(6));
  assert.equal(second.observedChangeMinutes, 360);
  assert.equal(second.observedChanges, 1);
  const third = observeChange(second, at(8));
  assert.equal(third.observedChangeMinutes, 240, "(360 + 120) / 2: the first gaps are a plain mean");
  assert.equal(observeChange(third, at(8)).observedChanges, third.observedChanges, "the same instant twice is one change");
  assert.equal(observeChange(third, at(1)).lastChangedAt, third.lastChangedAt, "an older instant never rewinds the door");
});

test("the average follows a habit that changes: recent gaps weigh most", () => {
  let door = observeChange(bare, at(0));
  let hour = 0;
  for (let i = 0; i < 12; i += 1) { hour += 24; door = observeChange(door, at(hour)); }
  assert.equal(door.observedChangeMinutes, 1440);
  for (let i = 0; i < 8; i += 1) { hour += 2; door = observeChange(door, at(hour)); }
  assert.ok(door.observedChangeMinutes! < 300, `eight 2-hour gaps pull a daily door to a few hours, got ${door.observedChangeMinutes}`);
});

test("the check is the faster of policy and observed rate, never under the hourly floor, never slower than policy, and a hand setting stands", () => {
  const door = (observed: number | null, own: number | null = null) => ({ checkEveryMinutes: own, observedChangeMinutes: observed });
  assert.deepEqual(checkEveryWithObserved(door(null), 1440), { minutes: 1440, basis: "POLICY" });
  assert.deepEqual(checkEveryWithObserved(door(240), 1440), { minutes: 240, basis: "OBSERVED" });
  assert.deepEqual(checkEveryWithObserved(door(5), 1440), { minutes: MIN_OBSERVED_CHECK_MINUTES, basis: "OBSERVED" });
  assert.deepEqual(checkEveryWithObserved(door(5000), 1440), { minutes: 1440, basis: "POLICY" }, "a slow door is not read slower than its policy");
  assert.deepEqual(checkEveryWithObserved(door(240, 720), 1440), { minutes: 720, basis: "SET_ON_DOOR" });
  assert.deepEqual(checkEveryWithObserved(door(240), 30), { minutes: 30, basis: "POLICY" }, "a policy already faster than the floor is kept");
});

test("a changed promotion is written onto its door in the same write as the success; an unchanged one is not a change", async () => {
  const { repos, door } = await oneDoor();
  await recordDoorOutcome(repos.doors, door.doorId, "SUCCESS", at(1), true);
  await recordDoorOutcome(repos.doors, door.doorId, "SUCCESS", at(2), false);
  await recordDoorOutcome(repos.doors, door.doorId, "SUCCESS", at(7), true);
  const after = (await listDoors(repos.doors)).doors[0]!;
  assert.equal(after.lastSuccessAt, at(7));
  assert.equal(after.lastChangedAt, at(7));
  assert.equal(after.observedChangeMinutes, 360);
  assert.equal(after.editedAt, door.editedAt, "a system write is not a hand edit");
  assert.equal(after.updatedAt, door.updatedAt);
  assert.equal(await recordDoorChange(repos.doors, "meetings:nowhere:none", at(9)), false);
  assert.equal(await recordDoorChange(repos.doors, door.doorId, at(9)), true);
  assert.equal((await listDoors(repos.doors)).doors[0]!.observedChangeMinutes, 240, "(360 + 120) / 2");
});

test("a derive step and a hand edit keep what was observed", async () => {
  const { door } = await oneDoor();
  const seen: DoorRecord = { ...door, ...observeChange(observeChange(bare, at(0)), at(6)) };
  const derived = applyDerivedRow(seen, { ...editableFieldsOf(seen), notes: "changed note" }, at(9), at(9));
  assert.equal(derived?.observedChangeMinutes, 360);
  assert.equal(derived?.lastChangedAt, at(6));
  assert.equal(derived?.observedChanges, 1);
});

test("an observed door is overdue by the check it produces, and Admin's row says which rate produced it", async () => {
  const { door } = await oneDoor();
  assert.equal(door.meeting != null, true);
  const succeeded: DoorRecord = { ...door, lastSuccessAt: at(0), observedChangeMinutes: 180, observedChanges: 3, lastChangedAt: at(0) };
  const plain: DoorRecord = { ...door, lastSuccessAt: at(0) };
  const now = at(4); // four hours on: past a 3-hour observed check, well inside the 12-hour cold check
  assert.equal(overdueDoors([plain], new Map(), now).length, 0);
  const late = overdueDoors([succeeded], new Map(), now);
  assert.equal(late.length, 1);
  assert.equal(late[0]!.checkEveryMinutes, 180);
  assert.equal(late[0]!.overdueByMinutes, 60);
  assert.deepEqual(doorRateRow(succeeded, COLD_CHECK_MINUTES), { doorId: door.doorId, observedChangeMinutes: 180, changesSeen: 3, lastChangedAt: at(0), checkEveryMinutes: 180, basis: "OBSERVED" });
  assert.equal(doorRateRow(plain, STANDING_CHECK_MINUTES).basis, "POLICY");
  assert.equal(observedChangeMinutesByDoor([succeeded, plain]).get(door.doorId), 180);
  assert.equal(observedChangeMinutesByDoor([{ ...succeeded, checkEveryMinutes: 600 }]).size, 0, "a door with a hand setting is not sped up");
});

test("the runner reads a changing non-meeting door as often as it changes, and leaves a meeting's sitting-window schedule alone", () => {
  const task = ROUTINE_SOURCE_TASKS.find((t) => !t.ownerInvocation && !t.contract?.schedule && t.cadenceMs >= 20 * 3_600_000)!;
  assert.ok(task, "a daily non-meeting task exists");
  const now = Date.parse(AT) + 6 * 3_600_000;
  const clock: RoutineTaskClock = { lastAttemptedAt: AT, lastSucceededAt: AT, lastSucceededObservedAt: AT } as RoutineTaskClock;
  assert.equal(routineTaskDue(task, clock, now), false, "daily by policy: not due after six hours");
  assert.equal(routineTaskDue(task, clock, now, undefined, 4 * 3_600_000), true, "a door that changes every four hours is due");
  const halfHourOn = Date.parse(AT) + 30 * 60_000;
  assert.equal(routineTaskDue(task, clock, halfHourOn, undefined, 10 * 60_000), false, "the hourly floor holds: a door seen changing every ten minutes is still not read twice in an hour");
  assert.equal(routineTaskDue(task, clock, Date.parse(AT) + 61 * 60_000, undefined, 10 * 60_000), true);
});
