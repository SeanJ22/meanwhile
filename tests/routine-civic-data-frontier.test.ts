import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ROUTINE_DATA_ADMISSION_MS,
  ROUTINE_FAILURE_DOMAIN_FRONTIER_PER_PASS,
  ROUTINE_SOURCE_TASKS,
  routineFailureDomainCount,
  routineFailureDomainFrontier,
  routineFailureDomainRotationSeed,
  routineFrontierPassBound,
  routinePassLaunchOrder,
  routineBaselineOwed,
  routineCodeChangeRetryTaskIds,
  routineTaskDeadlineMs,
  routineTaskDue,
  routineTaskNextDueMs,
  routineAdmissionClock,
  unchangedRoutineProtocolFailure,
  routineUnreceiptedSupervisorAttemptHistory,
  SITTING_WINDOW_LANE_SLOTS_PER_PASS,
  type RoutineSourceTask,
  type RoutineTaskClock,
} from "../lib/civic-data/runner.ts";
import { AUTOMATIC_REFRESH_TASKS } from "../lib/civic-data/automatic-refresh.ts";
import { MEETING_SITTING_WINDOW } from "../lib/civic-data/contracts.ts";
import { sittingWindowHotByConclusion } from "../lib/civic-data/sitting-window-admission.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";
import { ControlledClock, nextAdmissionMs, recordedPasses, replayPass } from "./helpers/routine-pass-replay.ts";
import {
  ROUTINE_SUPERVISOR_HISTORY_FIELDS,
  ROUTINE_SUPERVISOR_HISTORY_WINDOW,
} from "../lib/civic-data/supervisor-history.ts";
import { projectRecord } from "../lib/control-plane/repository/types.ts";
import {
  ROUTINE_CHILD_CONCURRENCY,
  ROUTINE_CHILD_TIMEOUT_MS,
  routineChildPassWorstCaseMs,
} from "../lib/civic-data/bounded-child-pass.ts";

function largestRealDomain(): readonly RoutineSourceTask[] {
  const grouped = new Map<string, RoutineSourceTask[]>();
  for (const task of ROUTINE_SOURCE_TASKS) {
    const rows = grouped.get(task.acquisitionFailureDomain) ?? [];
    rows.push(task);
    grouped.set(task.acquisitionFailureDomain, rows);
  }
  return [...grouped.values()].sort((left, right) => right.length - left.length)[0] ?? [];
}

test("missing people and previous-parser government baselines admit every state and share the existing pool in source order", () => {
  const people = ROUTINE_SOURCE_TASKS.filter(task => task.id.startsWith("openstates-people-"));
  const governments = ROUTINE_SOURCE_TASKS.filter(task => task.recordClass === "REGISTRATION");
  assert.ok(people.length >= 50);
  assert.equal(governments.length, 56);
  const due = [...people, ...governments].map(task => {
    const clock = task.recordClass === "REGISTRATION" ? { lastSucceededAt: "2026-10-01T12:00:00.000Z",
      lastSucceededObservedAt: "2026-10-01T12:00:00.000Z", lastSucceededParserVersion: "registration/3" } : undefined;
    assert.equal(routineTaskDue(task, clock, Date.parse("2026-10-02T12:00:00.000Z")), true);
    return { task, lastConsideredAt: null, baselineOwed: routineBaselineOwed(task, clock) };
  });
  const admitted = routineFailureDomainFrontier(due);
  assert.equal(admitted.length, people.length + governments.length, "one national release is shared by independent state projections");
  const refresh = { ...due[0]!, task: { ...due[0]!.task, id: "already-current-refresh" }, baselineOwed: false };
  const ordered = routinePassLaunchOrder([refresh, ...admitted]);
  assert.deepEqual(ordered.slice(0, 4).map(row => row.task.sourceId),
    [people[0]!.sourceId, governments[0]!.sourceId, people[0]!.sourceId, governments[0]!.sourceId]);
  assert.equal(ordered.at(-1)?.task.id, refresh.task.id, "missing baselines precede an already-current cadence refresh");
  assert.equal(new Set(ordered.map(row => row.task.id)).size, ordered.length);
  assert.equal(ROUTINE_CHILD_CONCURRENCY, 4, "the existing worker limit remains unchanged");
  assert.equal(ROUTINE_FAILURE_DOMAIN_FRONTIER_PER_PASS, 1);
  assert.ok(people.every(task => task.cadenceMs === 86400000 && task.retryMs === 3600000));
  assert.ok(governments.every(task => task.cadenceMs === 90 * 86400000 && task.retryMs === 6 * 3600000));
});

test("unread and overdue meeting deadlines precede national baseline work", () => {
  const now = Date.parse("2026-10-09T12:00:00.000Z");
  const people = ROUTINE_SOURCE_TASKS.find(task => task.id.startsWith("openstates-people-"))!;
  const meeting = ROUTINE_SOURCE_TASKS.find(task => task.recordClass === "MEETING")!;
  assert.equal(routineBaselineOwed(meeting, undefined), false);
  const jobs = [
    { task: people, deadlineMs: undefined, baselineOwed: true },
    { task: meeting, deadlineMs: now - 1, baselineOwed: false },
    { task: { ...meeting, id: "unbuilt-meeting" }, deadlineMs: Number.NEGATIVE_INFINITY, baselineOwed: false },
    { task: { ...meeting, id: "later-meeting" }, deadlineMs: now + 1, baselineOwed: false },
  ];
  assert.deepEqual(routinePassLaunchOrder(jobs, now).map(row => row.task.id), ["unbuilt-meeting", meeting.id, people.id, "later-meeting"]);
});

test("a state's overdue voting sites start ahead of meetings owed more recently, and first reads keep their place", () => {
  // Release 92-95 passes: hundreds of overdue meeting reads always led, so voting-sites waited for memory until the
  // pass ended (WORKER_MEMORY_DEADLINE) every pass while its daily read went days overdue.
  const now = Date.parse("2026-10-24T08:47:56.000Z"), HOUR = 3_600_000, DAY = 24 * HOUR;
  const meeting = ROUTINE_SOURCE_TASKS.find(task => task.recordClass === "MEETING")!;
  const sites = AUTOMATIC_REFRESH_TASKS.find(task => task.id === "voting-sites:CA")!;
  const people = ROUTINE_SOURCE_TASKS.find(task => task.id.startsWith("openstates-people-"))!;
  const meetings = Array.from({ length: 300 }, (_, index) => ({ task: { ...meeting, id: `meeting-${index}` }, deadlineMs: now - 3 * HOUR + index * 30_000, lastConsideredAt: null }));
  const californiaClock = { lastAttemptedAt: "2026-10-07T09:45:58.000Z", lastSucceededObservedAt: "2026-10-07T09:45:58.000Z" };
  const californiaOwed = routineTaskNextDueMs(sites, californiaClock, now);
  assert.ok(californiaOwed > Date.parse(californiaClock.lastSucceededObservedAt) && californiaOwed <= Date.parse(californiaClock.lastSucceededObservedAt) + DAY);
  assert.equal(routineTaskDue(sites, californiaClock, now), true);
  const jobs = [
    ...meetings,
    { task: sites, owedAtMs: californiaOwed, lastConsideredAt: californiaClock.lastAttemptedAt },
    { task: { ...sites, id: "voting-sites:recent" }, owedAtMs: now - HOUR, lastConsideredAt: "2026-10-23T07:00:00.000Z" },
    { task: people, owedAtMs: undefined, baselineOwed: true, lastConsideredAt: null },
    { task: { ...meeting, id: "unbuilt-meeting" }, deadlineMs: Number.NEGATIVE_INFINITY, lastConsideredAt: null },
  ];
  const order = routinePassLaunchOrder(jobs, now).map(row => row.task.id);
  assert.deepEqual(order.slice(0, 2), ["unbuilt-meeting", "voting-sites:CA"]);
  assert.ok(order.indexOf("voting-sites:recent") > order.indexOf("meeting-0") && order.indexOf("voting-sites:recent") < order.indexOf("meeting-299"),
    "work owed an hour ago sits among meetings owed as long");
  assert.equal(order.indexOf(people.id), meetings.length + 3, "a never-read baseline keeps its place behind overdue meetings");
});

test("routineTaskDue decides by the same instant the pass orders by", () => {
  const sites = AUTOMATIC_REFRESH_TASKS.find(task => task.id === "voting-sites:AZ")!;
  const read = "2026-10-22T00:34:19.699Z", HOUR = 3_600_000;
  for (const clock of [undefined, { lastAttemptedAt: read, lastSucceededObservedAt: read },
    { lastAttemptedAt: "2026-10-23T05:00:00.000Z", lastSucceededObservedAt: read, failureStreak: 3 },
    { lastAttemptedAt: read, lastSucceededObservedAt: read, lastSucceededParserVersion: "official-voting-sites/3" }]) {
    for (const offset of [-HOUR, 0, HOUR, 4 * HOUR, 25 * HOUR, 50 * HOUR]) {
      const at = Date.parse(read) + offset;
      assert.equal(routineTaskDue(sites, clock, at), at >= routineTaskNextDueMs(sites, clock, at), `${JSON.stringify(clock)} at ${offset}`);
    }
  }
});
