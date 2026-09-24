import assert from "node:assert/strict";
import test from "node:test";

import {
  MEETING_SITTING_WINDOW,
  ROUTINE_DATA_ADMISSION_MS,
  ROUTINE_SOURCE_CONTRACTS,
  sittingWindowDueAtMs,
  sittingWindowHot,
} from "../lib/civic-data/contracts.ts";
import { MEETING_PARTITION_CONTRACTS, meetingPartitionId, sittingWindowSourceIds } from "../lib/civic-data/meeting-partitions.ts";
import {
  ROUTINE_SOURCE_TASKS,
  routineTaskDue,
  sittingWindowSignals,
  type RoutineSourceTask,
  type RoutineTaskClock,
} from "../lib/civic-data/runner.ts";

/*
 * Owner decision, 2026-09-24: meeting sources are checked twice daily, and
 * hourly for any body with a meeting upcoming within seven days or concluded
 * within the past seven days. The window rolls automatically and covers
 * calendars, agendas, changes, cancellations, decisions and minutes. It does
 * not change any other data family's schedule.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PASS = ROUTINE_DATA_ADMISSION_MS;
const PIMA = "ocd-division/country:us/state:az/county:pima#governing";
const PIMA_LEGISTAR = meetingPartitionId("legistar", PIMA);
const PIMA_INSITE = meetingPartitionId("legistar-insite", PIMA);
const OUTCOMES = "pima-legistar-outcomes";

function task(id: string): RoutineSourceTask {
  const found = ROUTINE_SOURCE_TASKS.find((row) => row.id === id);
  assert.ok(found, `task ${id} is registered`);
  return found;
}

/** A clock whose newest attempt is its proven success, observed at `at`. */
function succeededAt(at: string, sittingStarts?: readonly string[]): RoutineTaskClock {
  return {
    lastAttemptedAt: at,
    lastSucceededAt: new Date(Date.parse(at) - 2_500).toISOString(),
    lastSucceededObservedAt: at,
    ...(sittingStarts ? { sittingStarts } : {}),
  };
}

test("the policy is the owner's: seven days either side, hourly when hot, twice daily otherwise", () => {
  assert.deepEqual(MEETING_SITTING_WINDOW, { kind: "SITTING_WINDOW", windowMs: 7 * DAY, hotEveryMs: HOUR, baseEveryMs: 12 * HOUR });
  assert.ok(MEETING_PARTITION_CONTRACTS.length > 0);
  for (const partition of MEETING_PARTITION_CONTRACTS) {
    assert.deepEqual(partition.schedule, MEETING_SITTING_WINDOW, `${partition.id} follows its own sittings`);
    assert.deepEqual(sittingWindowSourceIds(partition.id), [partition.id]);
  }
  assert.deepEqual(sittingWindowSourceIds(OUTCOMES), [PIMA_LEGISTAR, PIMA_INSITE]);
});

test("no other data family's schedule is changed: only meeting partitions and meeting outcomes carry a sitting window", () => {
  const windowed = ROUTINE_SOURCE_CONTRACTS.filter((contract) => contract.schedule !== undefined).map((contract) => contract.id);
  assert.deepEqual(windowed, [OUTCOMES]);
  const at = "2026-09-24T09:00:00.000Z";
  for (const row of ROUTINE_SOURCE_TASKS.filter((candidate) => candidate.contract.schedule === undefined)) {
    // The retired-rule inputs: a success claimed seconds before its observed attempt.
    const clock: RoutineTaskClock = { lastAttemptedAt: at, lastSucceededAt: "2026-09-24T08:59:57.500Z" };
    const enriched: RoutineTaskClock = { ...clock, lastSucceededObservedAt: at, sittingStarts: [at] };
    for (const offset of [0, HOUR - 1, HOUR, 6 * HOUR - 1, 6 * HOUR, 30 * DAY]) {
      const now = Date.parse(at) + offset;
      const today = routineTaskDue(row, clock, now);
      assert.equal(routineTaskDue(row, enriched, now), today, `${row.id}: the new clock fields decide nothing for it`);
      assert.equal(routineTaskDue(row, enriched, now, true), today, `${row.id}: a sitting signal decides nothing for it`);
      assert.equal(routineTaskDue(row, enriched, now, false), today, `${row.id}: a sitting signal decides nothing for it`);
    }
  }
});

test("a sitting within seven days on either side makes a body hot, to the millisecond", () => {
  const now = Date.parse("2026-09-24T16:00:00.000Z");
  const at = (offset: number) => new Date(now + offset).toISOString();
  assert.equal(sittingWindowHot(MEETING_SITTING_WINDOW, [[at(7 * DAY)]], now), true, "upcoming, exactly seven days");
  assert.equal(sittingWindowHot(MEETING_SITTING_WINDOW, [[at(-7 * DAY)]], now), true, "concluded, exactly seven days");
  assert.equal(sittingWindowHot(MEETING_SITTING_WINDOW, [[at(7 * DAY + 1)]], now), false);
  assert.equal(sittingWindowHot(MEETING_SITTING_WINDOW, [[at(-7 * DAY - 1)]], now), false);
  assert.equal(sittingWindowHot(MEETING_SITTING_WINDOW, [[at(-30 * DAY), at(2 * DAY)]], now), true);
  assert.equal(sittingWindowHot(MEETING_SITTING_WINDOW, [[]], now), false, "a body with no sittings is not hot");
  assert.equal(sittingWindowHot(MEETING_SITTING_WINDOW, [["not a time"]], now), false);
  // Offsets are honoured: 09:00 Arizona is 16:00Z.
  assert.equal(sittingWindowHot(MEETING_SITTING_WINDOW, [["2026-10-01T09:00:00-07:00"]], now), true);
  assert.equal(sittingWindowHot(MEETING_SITTING_WINDOW, [["2026-10-01T09:00:00.001-07:00"]], now), false);
  // Unknown is never read as cold.
  assert.equal(sittingWindowHot(MEETING_SITTING_WINDOW, [undefined], now), undefined);
  assert.equal(sittingWindowHot(MEETING_SITTING_WINDOW, [undefined, [at(DAY)]], now), true);
  assert.equal(sittingWindowHot(MEETING_SITTING_WINDOW, [undefined, [at(30 * DAY)]], now), undefined);
  assert.equal(sittingWindowHot(MEETING_SITTING_WINDOW, [], now), undefined);
});

test("a meeting partition is re-read hourly when hot and twice daily otherwise, never drifting past the hour", () => {
  const partition = task(PIMA_LEGISTAR);
  const at = "2026-09-24T09:00:00.000Z";
  const base = Date.parse(at);
  const clock = succeededAt(at);
  assert.equal(routineTaskDue(partition, clock, base + HOUR - PASS - 1, true), false);
  assert.equal(routineTaskDue(partition, clock, base + HOUR - PASS, true), true);
  assert.equal(routineTaskDue(partition, clock, base + 12 * HOUR - PASS - 1, false), false);
  assert.equal(routineTaskDue(partition, clock, base + 12 * HOUR - PASS, false), true);
  assert.equal(routineTaskDue(partition, clock, base + HOUR - PASS, undefined), true, "unknown reads as hot");
  assert.equal(sittingWindowDueAtMs(MEETING_SITTING_WINDOW, base, true), base + HOUR - PASS);
  assert.equal(sittingWindowDueAtMs(MEETING_SITTING_WINDOW, base, false), base + 12 * HOUR - PASS);
});

test("the success is read in the attempt clock's own units, so a success is never mistaken for a failure", () => {
  const partition = task(PIMA_LEGISTAR);
  const at = "2026-09-24T09:00:00.000Z";
  const base = Date.parse(at);
  // The claimed retrieval precedes the first event by the acquisition's own
  // duration; read against it, every success looked like a later failed attempt
  // and the one-hour retry, not the schedule, decided the next read.
  const clock = succeededAt(at);
  assert.ok(Date.parse(clock.lastSucceededAt!) < Date.parse(clock.lastAttemptedAt!));
  assert.equal(routineTaskDue(partition, clock, base + HOUR, false), false, "base: not re-read at the retry hour");
  // A genuinely failed later attempt keeps its one-hour retry exactly.
  const failed: RoutineTaskClock = { ...clock, lastAttemptedAt: "2026-09-24T10:00:00.000Z" };
  assert.equal(routineTaskDue(partition, failed, Date.parse("2026-09-24T11:00:00.000Z") - 1, false), false);
  assert.equal(routineTaskDue(partition, failed, Date.parse("2026-09-24T11:00:00.000Z"), false), true);
  // A source that never succeeded retries on its attempt; a never-run one is due at once.
  assert.equal(routineTaskDue(partition, { lastAttemptedAt: at }, base + HOUR - 1, false), false);
  assert.equal(routineTaskDue(partition, { lastAttemptedAt: at }, base + HOUR, false), true);
  assert.equal(routineTaskDue(partition, undefined, base, false), true);
  assert.equal(routineTaskDue(partition, {}, base, false), true);
});

test("the window rolls: a sitting coming within seven days makes a twice-daily source due at that instant", () => {
  const partition = task(PIMA_LEGISTAR);
  const at = "2026-09-24T09:00:00.000Z";
  const sitting = "2026-10-01T15:00:00.000Z";
  const clock = succeededAt(at, [sitting]);
  const entersWindow = Date.parse(sitting) - 7 * DAY;
  const reads = (now: number) => [{ task: partition, ok: true, clock }].map((read) => ({ ...read, now }));
  const hotAt = (now: number) => sittingWindowSignals(reads(now), now).get(partition.id);
  assert.equal(hotAt(entersWindow - 1), false);
  assert.equal(routineTaskDue(partition, clock, entersWindow - 1, hotAt(entersWindow - 1)), false);
  assert.equal(hotAt(entersWindow), true);
  assert.equal(routineTaskDue(partition, clock, entersWindow, hotAt(entersWindow)), true);
  // And it cools seven days after the sitting.
  const leavesWindow = Date.parse(sitting) + 7 * DAY;
  assert.equal(hotAt(leavesWindow), true);
  assert.equal(hotAt(leavesWindow + 1), false);
});

test("Pima outcomes follow both Board partitions; an unreadable partition never cools them", () => {
  const now = Date.parse("2026-09-24T16:00:00.000Z");
  const soon = new Date(now + 2 * DAY).toISOString();
  const far = new Date(now + 40 * DAY).toISOString();
  const read = (id: string, clock: RoutineTaskClock | undefined, ok = true) => ({ task: task(id), ok, clock });
  const signal = (legistar: ReturnType<typeof read>, insite: ReturnType<typeof read>) =>
    sittingWindowSignals([read(OUTCOMES, succeededAt("2026-09-24T09:00:00.000Z")), legistar, insite], now).get(OUTCOMES);
  assert.equal(signal(read(PIMA_LEGISTAR, { sittingStarts: [far] }), read(PIMA_INSITE, { sittingStarts: [soon] })), true);
  assert.equal(signal(read(PIMA_LEGISTAR, { sittingStarts: [far] }), read(PIMA_INSITE, { sittingStarts: [] })), false);
  assert.equal(signal(read(PIMA_LEGISTAR, { sittingStarts: [far] }), read(PIMA_INSITE, undefined, false)), undefined);
  assert.equal(
    sittingWindowSignals([read(OUTCOMES, succeededAt("2026-09-24T09:00:00.000Z"))], now).get(OUTCOMES),
    undefined,
    "partitions absent from this pass are unknown, and unknown reads as hot",
  );
  const outcomes = task(OUTCOMES);
  const clock = succeededAt("2026-09-24T09:00:00.000Z");
  const base = Date.parse("2026-09-24T09:00:00.000Z");
  assert.equal(routineTaskDue(outcomes, clock, base + 12 * HOUR - PASS - 1, false), false);
  assert.equal(routineTaskDue(outcomes, clock, base + 12 * HOUR - PASS, false), true);
  assert.equal(routineTaskDue(outcomes, clock, base + HOUR - PASS, true), true);
});
