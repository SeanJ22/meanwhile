import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MEETING_PARTITION_POLICY,
  ROUTINE_REREAD_MIN_LEAD_MS,
  ROUTINE_SOURCE_CONTRACTS,
  cadenceMsAt,
  meetingPartitionFreshnessMs,
  routineCadenceDueAtMs,
  routineFreshnessMs,
  routineRereadLeadMsAt,
  type RoutineSourceContract,
} from "../lib/civic-data/contracts.ts";
import {
  ROUTINE_DATA_ADMISSION_MS,
  ROUTINE_SOURCE_TASKS,
  routineTaskDue,
  type RoutineSourceTask,
  type RoutineTaskClock,
} from "../lib/civic-data/runner.ts";
import { ROUTINE_CHILD_TIMEOUT_MS } from "../lib/civic-data/bounded-child-pass.ts";

/*
 * The Reader marks a record STALE once it is older than its maxAgeMs, which is
 * the contract's cadence at the moment of reading (routineFreshnessMs /
 * meetingPartitionFreshnessMs). A succeeding source re-read exactly on that
 * cadence was therefore STALE every cycle from the cadence instant until the
 * next 5-minute pass admitted it and its fetch landed; for meeting partitions,
 * one STALE partition marks the whole meeting aggregate STALE. The runner now
 * re-reads a succeeding source one lead ahead: max(retry, 15 min), capped at
 * half the cadence. The Reader's rule is untouched.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const iso = (ms: number) => new Date(ms).toISOString();
const succeededClock = (atMs: number): RoutineTaskClock => ({ lastAttemptedAt: iso(atMs), lastSucceededAt: iso(atMs) });

const TASKS_BY_ID = new Map(ROUTINE_SOURCE_TASKS.map((task) => [task.id, task] as const));
const taskFor = (id: string): RoutineSourceTask => TASKS_BY_ID.get(id) ?? assert.fail(`routine task ${id} is registered`);

const MEETING_TASK = ROUTINE_SOURCE_TASKS.find((task) => task.recordClass === "MEETING");
const ELECTION_SWITCH = Date.parse("2026-11-04T00:00:00.000Z");

test("the lead is the contract's retry, never under 15 minutes, never over half the cadence", () => {
  const at = Date.parse("2026-09-23T00:00:00.000Z");
  const expected: Record<string, number> = {
    "fec-funding": 6 * HOUR_MS,
    "nh-members": HOUR_MS,
    "census-acs-population": 6 * HOUR_MS,
    "census-geography-overlaps": 6 * HOUR_MS,
    "nj-morris-filing": HOUR_MS,
    "dotgov": 6 * HOUR_MS,
  };
  for (const [id, lead] of Object.entries(expected)) {
    const contract = ROUTINE_SOURCE_CONTRACTS.find((row) => row.id === id)!;
    assert.equal(routineRereadLeadMsAt(contract, at), lead, id);
  }
  assert.equal(routineRereadLeadMsAt(MEETING_PARTITION_POLICY, at), HOUR_MS, "meeting partitions");
  const quick = { cadence: { description: "hourly", defaultEveryMs: HOUR_MS }, retry: { afterMs: 5 * MINUTE_MS, description: "x" } };
  assert.equal(routineRereadLeadMsAt(quick, at), ROUTINE_REREAD_MIN_LEAD_MS, "a short retry still leads by 15 minutes");
  const tight = { cadence: { description: "20 min", defaultEveryMs: 20 * MINUTE_MS }, retry: { afterMs: HOUR_MS, description: "x" } };
  assert.equal(routineRereadLeadMsAt(tight, at), 10 * MINUTE_MS, "the lead never exceeds half the cadence");
});

test("a succeeding meeting partition is re-read at 23 h, one hour ahead of its daily maxAge", () => {
  assert.ok(MEETING_TASK);
  const succeeded = Date.parse("2026-09-23T15:18:25.821Z");
  const clock = succeededClock(succeeded);
  assert.equal(routineTaskDue(MEETING_TASK, clock, succeeded + 23 * HOUR_MS - 1), false);
  assert.equal(routineTaskDue(MEETING_TASK, clock, succeeded + 23 * HOUR_MS), true);
  assert.equal(meetingPartitionFreshnessMs(iso(succeeded + 23 * HOUR_MS)), DAY_MS, "the Reader still allows one day");
});

test("a failed later attempt keeps its retry clock exactly; the lead applies only to a success", () => {
  for (const [id, retryMs] of [["census-geography-overlaps", 6 * HOUR_MS], ["nh-members", HOUR_MS]] as const) {
    const task = taskFor(id);
    const succeeded = Date.parse("2026-09-23T05:26:51.162Z");
    const failed = Date.parse("2026-09-23T12:00:00.000Z");
    const clock = { lastAttemptedAt: iso(failed), lastSucceededAt: iso(succeeded) };
    assert.equal(routineTaskDue(task, clock, failed + retryMs - 1), false, id);
    assert.equal(routineTaskDue(task, clock, failed + retryMs), true, id);
  }
  assert.ok(MEETING_TASK);
  const neverSucceeded = { lastAttemptedAt: "2026-09-23T12:00:00.000Z" };
  assert.equal(routineTaskDue(MEETING_TASK, neverSucceeded, Date.parse("2026-09-23T12:59:59.999Z")), false);
  assert.equal(routineTaskDue(MEETING_TASK, neverSucceeded, Date.parse("2026-09-23T13:00:00.000Z")), true);
});

test("the daily-then-weekly switch on 2026-11-04 never yields a negative or skipped re-read instant", () => {
  assert.ok(MEETING_TASK);
  const contract = MEETING_TASK.contract;
  // Inside the daily phase: 23 h.
  assert.equal(iso(routineCadenceDueAtMs(contract, Date.parse("2026-11-02T12:00:00.000Z"))), "2026-11-03T11:00:00.000Z");
  // A daily re-read that still falls before the switch is kept.
  assert.equal(iso(routineCadenceDueAtMs(contract, Date.parse("2026-11-03T00:30:00.000Z"))), "2026-11-03T23:30:00.000Z");
  // One whose 23 h would land after the switch follows the weekly cadence the
  // Reader applies from that instant: 7 d less its one-hour lead.
  assert.equal(iso(routineCadenceDueAtMs(contract, Date.parse("2026-11-03T12:00:00.000Z"))), "2026-11-10T11:00:00.000Z");
  const clock = succeededClock(Date.parse("2026-11-03T12:00:00.000Z"));
  assert.equal(routineTaskDue(MEETING_TASK, clock, Date.parse("2026-11-04T11:00:00.000Z")), false);
  assert.equal(routineTaskDue(MEETING_TASK, clock, Date.parse("2026-11-10T10:59:59.999Z")), false);
  assert.equal(routineTaskDue(MEETING_TASK, clock, Date.parse("2026-11-10T11:00:00.000Z")), true);

  // Sweep successes every minute across three days around the switch: the
  // instant is always after the success by at least half a cadence, it is
  // exactly where the runner's rule first flips (so Admin shows when it runs),
  // and it never moves backward as the success moves forward.
  let previousDue = Number.NEGATIVE_INFINITY;
  for (let succeeded = ELECTION_SWITCH - 2 * DAY_MS; succeeded <= ELECTION_SWITCH + DAY_MS; succeeded += MINUTE_MS) {
    const due = routineCadenceDueAtMs(contract, succeeded);
    const label = iso(succeeded);
    assert.ok(due - succeeded >= cadenceMsAt(contract, due) / 2, `${label}: interval under half a cadence`);
    assert.ok(due >= previousDue, `${label}: the instant moved backward`);
    const sweepClock = succeededClock(succeeded);
    assert.equal(routineTaskDue(MEETING_TASK, sweepClock, due - 1), false, `${label}: due before its instant`);
    assert.equal(routineTaskDue(MEETING_TASK, sweepClock, due), true, `${label}: not due at its instant`);
    previousDue = due;
  }

  // The reverse switch (a cadence that tightens) makes the source due at the
  // switch itself, never before its success.
  const tightening = {
    cadence: { description: "weekly, then daily", defaultEveryMs: DAY_MS, phases: [{ through: iso(ELECTION_SWITCH), everyMs: 7 * DAY_MS, description: "weekly" }] },
    retry: { afterMs: HOUR_MS, description: "x" },
  };
  assert.equal(routineCadenceDueAtMs(tightening, ELECTION_SWITCH - 2 * DAY_MS), ELECTION_SWITCH);
  assert.equal(routineCadenceDueAtMs(tightening, ELECTION_SWITCH - 2 * HOUR_MS), ELECTION_SWITCH + 21 * HOUR_MS);
});

test("Admin's next-due and the runner read one function", () => {
  const observability = readFileSync("lib/civic-data/observability.ts", "utf8");
  const nextDue = observability.slice(observability.indexOf("function nextDue("), observability.indexOf("const TERMINAL_REFUSAL_STATES"));
  assert.match(nextDue, /routineCadenceDueAtMs\(contract, succeeded\)/);
  assert.doesNotMatch(nextDue, /succeeded \+ cadenceMsAt/, "a bare cadence here would show an instant the runner does not use");
  const runner = readFileSync("lib/civic-data/runner.ts", "utf8");
  const due = runner.slice(runner.indexOf("export function routineTaskDue("));
  assert.match(due, /nowMs >= routineCadenceDueAtMs\(task\.contract, succeeded\)/);
});

/*
 * Property: a source that succeeds on every attempt never reads older than its
 * Reader maxAgeMs, at any pass boundary or any instant between. Stated model:
 * - passes every ROUTINE_DATA_ADMISSION_MS (5 min); a due source is admitted at
 *   the first pass at or after its instant (no failure-domain contention);
 * - a pointer lands at most ROUTINE_CHILD_TIMEOUT_MS (30 min) after its pass
 *   starts: a child still running then is killed, so nothing lands later;
 * - the claimed retrieval precedes the store's first event by at most 60 s
 *   (production maximum on 2026-09-23: 10.1 s);
 * - adversarially, every first event falls 1 ms after a pass boundary (so the
 *   next admission waits almost a whole pass), every fetch lands at the
 *   ceiling, and every claimed retrieval is the full 60 s early.
 */
const PASS_MS = ROUTINE_DATA_ADMISSION_MS;
const LANDS_WITHIN_MS = ROUTINE_CHILD_TIMEOUT_MS;
const CLAIM_GAP_MS = 60_000;

type DuePredicate = (clock: RoutineTaskClock, nowMs: number) => boolean;

function oldestReaderAge(
  maxAgeAt: (atMs: number) => number,
  phaseBoundaries: readonly number[],
  isDue: DuePredicate,
  startMs: number,
  horizonMs: number,
): { readonly violation: string | null; readonly versions: number } {
  let retrievedAt = startMs - CLAIM_GAP_MS;
  let firstEventAt = startMs;
  let landedAt = startMs;
  let versions = 0;
  const ceilToPass = (ms: number) => Math.ceil(ms / PASS_MS) * PASS_MS;
  const check = (atMs: number) =>
    atMs - retrievedAt <= maxAgeAt(atMs)
      ? null
      : `${iso(atMs)}: age ${((atMs - retrievedAt) / HOUR_MS).toFixed(3)} h over maxAge ${(maxAgeAt(atMs) / HOUR_MS).toFixed(3)} h`;
  while (landedAt < horizonMs) {
    const clock = succeededClock(firstEventAt);
    let pass = ceilToPass(landedAt);
    while (!isDue(clock, pass)) pass += PASS_MS;
    const nextFirstEvent = pass + PASS_MS + 1;
    const nextLanded = pass + LANDS_WITHIN_MS;
    const instants = [nextLanded - 1, ...phaseBoundaries.filter((b) => b > landedAt && b <= nextLanded).map((b) => b - 1)];
    for (let boundary = ceilToPass(landedAt); boundary < nextLanded; boundary += PASS_MS) instants.push(boundary);
    for (const instant of instants) {
      const violation = check(instant);
      if (violation !== null) return { violation, versions };
    }
    retrievedAt = nextFirstEvent - CLAIM_GAP_MS;
    firstEventAt = nextFirstEvent;
    landedAt = nextLanded;
    versions += 1;
  }
  return { violation: null, versions };
}

function subjects(): readonly { readonly id: string; readonly task: RoutineSourceTask; readonly contract: Pick<RoutineSourceContract, "cadence" | "retry">; readonly maxAgeAt: (atMs: number) => number }[] {
  assert.ok(MEETING_TASK);
  return [
    ...ROUTINE_SOURCE_CONTRACTS.map((contract) => ({
      id: contract.id,
      task: taskFor(contract.id),
      contract,
      maxAgeAt: (atMs: number) => routineFreshnessMs(contract.id, iso(atMs)),
    })),
    {
      id: "meeting partitions",
      task: MEETING_TASK,
      contract: MEETING_PARTITION_POLICY,
      maxAgeAt: (atMs: number) => meetingPartitionFreshnessMs(iso(atMs)),
    },
  ];
}

const START = Date.parse("2026-09-23T00:00:00.000Z");
const HORIZON = Date.parse("2027-01-15T00:00:00.000Z");
const START_OFFSETS_MS = [0, HOUR_MS, 5 * HOUR_MS + 35 * MINUTE_MS, 11 * HOUR_MS, 17 * HOUR_MS + 5 * MINUTE_MS, 22 * HOUR_MS + 55 * MINUTE_MS];

test("a source that succeeds on every attempt never reads older than its Reader maxAge", () => {
  for (const { id, task, contract, maxAgeAt } of subjects()) {
    const boundaries = (contract.cadence.phases ?? []).map((phase) => Date.parse(phase.through));
    for (const offset of START_OFFSETS_MS) {
      const result = oldestReaderAge(
        maxAgeAt,
        boundaries,
        (clock, nowMs) => routineTaskDue(task, clock, nowMs),
        START + offset,
        HORIZON,
      );
      assert.equal(result.violation, null, `${id} from +${offset / MINUTE_MS} min`);
      assert.ok(result.versions >= 3, `${id}: the simulation crossed at least three re-reads`);
    }
  }
});

test("the old on-the-cadence rule fails the same property (negative control)", () => {
  const onCadence = (contract: Pick<RoutineSourceContract, "cadence" | "retry">): DuePredicate => (clock, nowMs) =>
    nowMs - Date.parse(clock.lastSucceededAt!) >= cadenceMsAt(contract, nowMs);
  for (const { id, contract, maxAgeAt } of subjects()) {
    const boundaries = (contract.cadence.phases ?? []).map((phase) => Date.parse(phase.through));
    const result = oldestReaderAge(maxAgeAt, boundaries, onCadence(contract), START, HORIZON);
    assert.notEqual(result.violation, null, `${id}: re-reading on the cadence must leave a STALE window`);
  }
});
