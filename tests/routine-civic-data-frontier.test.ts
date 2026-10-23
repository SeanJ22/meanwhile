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
  routineAdmissionClock,
  unchangedRoutineProtocolFailure,
  routineUnreceiptedSupervisorAttemptHistory,
  SITTING_WINDOW_LANE_SLOTS_PER_PASS,
  type RoutineSourceTask,
  type RoutineTaskClock,
} from "../lib/civic-data/runner.ts";
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

test("one pass admits one least-recently-considered task per provider domain", () => {
  const shared = largestRealDomain();
  assert.ok(shared.length > 2, "the production registry contains a shared provider domain");
  const unrelated = ROUTINE_SOURCE_TASKS.find(
    (task) => task.acquisitionFailureDomain !== shared[0]?.acquisitionFailureDomain,
  );
  assert.ok(unrelated);

  const candidates = [
    { task: shared[0]!, lastConsideredAt: "2026-09-08T12:00:00.000Z" },
    { task: shared[1]!, lastConsideredAt: null },
    { task: shared[2]!, lastConsideredAt: "2026-09-08T11:00:00.000Z" },
    { task: unrelated, lastConsideredAt: "2026-09-08T12:30:00.000Z" },
  ];
  const admitted = routineFailureDomainFrontier(candidates);

  assert.equal(ROUTINE_FAILURE_DOMAIN_FRONTIER_PER_PASS, 1);
  assert.deepEqual(
    admitted.map(({ task }) => task.id),
    [shared[1]!.id, unrelated.id],
    "a never-considered sibling rotates ahead of a task with a recent unreceipted supervisor attempt",
  );
  assert.equal(
    new Set(admitted.map(({ task }) => task.acquisitionFailureDomain)).size,
    admitted.length,
  );
});

test("repeated supervisor faults rotate fairly within one provider without changing other domains", () => {
  const shared = largestRealDomain().slice(0, 3);
  assert.equal(shared.length, 3);

  const first = routineFailureDomainFrontier(shared.map((task) => ({ task, lastConsideredAt: null })));
  assert.deepEqual(first.map(({ task }) => task.id), [shared[0]!.id]);

  const second = routineFailureDomainFrontier(shared.map((task, index) => ({
    task,
    lastConsideredAt: index === 0 ? "2026-09-08T12:00:00.000Z" : null,
  })));
  assert.deepEqual(second.map(({ task }) => task.id), [shared[1]!.id]);

  const third = routineFailureDomainFrontier(shared.map((task, index) => ({
    task,
    lastConsideredAt: index === 0
      ? "2026-09-08T12:00:00.000Z"
      : index === 1
        ? "2026-09-08T12:05:00.000Z"
        : null,
  })));
  assert.deepEqual(third.map(({ task }) => task.id), [shared[2]!.id]);

  const oldest = routineFailureDomainFrontier(shared.map((task, index) => ({
    task,
    lastConsideredAt: `2026-09-08T12:${String(index).padStart(2, "0")}:00.000Z`,
  })));
  assert.deepEqual(oldest.map(({ task }) => task.id), [shared[0]!.id]);
});

test("an all-unavailable provider rotates deterministically across frozen admission slots", () => {
  const shared = largestRealDomain().slice(0, 3);
  assert.equal(shared.length, 3);
  const candidates = shared.map((task) => ({ task, lastConsideredAt: null }));
  const firstSeed = routineFailureDomainRotationSeed("2026-09-08T12:00:00.000Z");
  const sameSeed = routineFailureDomainRotationSeed("2026-09-08T12:04:59.999Z");
  const nextSeed = routineFailureDomainRotationSeed("2026-09-08T12:05:00.000Z");

  assert.equal(sameSeed, firstSeed, "a restart in one admission slot chooses the same task");
  assert.equal(nextSeed, firstSeed + 1);
  assert.deepEqual(
    routineFailureDomainFrontier(candidates, 1, sameSeed),
    routineFailureDomainFrontier(candidates, 1, firstSeed),
  );
  assert.notEqual(
    routineFailureDomainFrontier(candidates, 1, nextSeed)[0]?.task.id,
    routineFailureDomainFrontier(candidates, 1, firstSeed)[0]?.task.id,
    "when no durable clock can rank a degraded provider, its next partition still receives a turn",
  );
  assert.equal(ROUTINE_DATA_ADMISSION_MS, 5 * 60_000);
  assert.throws(() => routineFailureDomainRotationSeed("not-an-instant"), /ROTATION_TIME_INVALID/);
});

test("the real pass ceiling is based on provider domains, not every partition in a failed provider tail", () => {
  const domains = routineFailureDomainCount();
  assert.ok(domains > 1);
  assert.ok(domains < ROUTINE_SOURCE_TASKS.length);
  const frontier = routineFailureDomainFrontier(
    ROUTINE_SOURCE_TASKS.map((task) => ({ task, lastConsideredAt: null })),
  );
  assert.equal(frontier.length, domains);
  assert.equal(
    routineChildPassWorstCaseMs(
      frontier.length,
      ROUTINE_CHILD_TIMEOUT_MS,
      ROUTINE_CHILD_CONCURRENCY,
      ROUTINE_FAILURE_DOMAIN_FRONTIER_PER_PASS,
    ),
    Math.ceil(domains / ROUTINE_CHILD_CONCURRENCY) * ROUTINE_CHILD_TIMEOUT_MS,
  );
});

test("frontier configuration and identities fail closed", () => {
  const task = ROUTINE_SOURCE_TASKS[0]!;
  assert.throws(
    () => routineFailureDomainFrontier([{ task, lastConsideredAt: null }], 0),
    /FRONTIER_INVALID/,
  );
  assert.throws(
    () => routineFailureDomainFrontier([
      { task, lastConsideredAt: null },
      { task, lastConsideredAt: null },
    ]),
    /DUPLICATE_TASK/,
  );
});

function supervisorHistoryRow(input: {
  readonly finishedAt: string;
  readonly failures: readonly string[];
  readonly receipted?: readonly string[];
}): unknown {
  const receipted = input.receipted ?? [];
  const taskReceipts = receipted.map((taskId, index) => {
    const candidateId = `candidate:${taskId}:${index}`;
    return {
      taskId,
      sourceId: "history-test-source",
      recordClass: "MEETING",
      scope: `history-test:${taskId}`,
      classification: "VERIFIED_SOURCE_SUCCESS",
      receipt: {
        source: taskId,
        candidateId,
        acquisitionSucceeded: true,
        state: "PROMOTED",
        decision: "GOOD",
        promotedVersion: candidateId,
        lastKnownGoodVersion: candidateId,
        structuralReleaseContract: ZERO_RELEASE_EVENTS,
      },
    };
  });
  const startedAt = new Date(Date.parse(input.finishedAt) - 60_000).toISOString();
  return {
    digestId: `history:${input.finishedAt}`,
    runtimeOutcome: {
      kind: "ROUTINE_CIVIC_DATA_SUPERVISOR",
      state: input.failures.length === 0 ? "SUCCEEDED" : "FAILED",
      cycleId: `history-cycle:${input.finishedAt}`,
      startedAt,
      finishedAt: input.finishedAt,
      testedSha: null,
      host: "history-test-host",
      provider: "postgres",
      durable: true,
      attemptedTasks: new Set([...input.failures, ...receipted]).size,
      verifiedSourceSuccesses: taskReceipts.length,
      verifiedSourceFailures: 0,
      taskReceiptEvidence: "EXACT",
      taskReceipts,
      failures: input.failures.map((taskId) => ({
        taskId,
        code: "CHILD_TIMEOUT",
        detail: "bounded child timed out",
      })),
    },
  };
}

test("a parser upgrade ignores an older implementation's supervisor failure but keeps current-code retry evidence", () => {
  const upgraded = "registration-nh", unchanged = "fec-funding";
  const row = supervisorHistoryRow({ finishedAt: "2026-10-09T12:00:00.000Z", failures: [upgraded, unchanged] }) as {
    runtimeOutcome: Record<string, unknown>;
  };
  row.runtimeOutcome.testedSha = "a".repeat(40);
  const ids = new Set([upgraded, unchanged]);
  const options = { taskIds: new Set([upgraded]), codeSha: "b".repeat(40) };
  const before = routineUnreceiptedSupervisorAttemptHistory([row], ids, options);
  assert.equal(before.issues.length, 0);
  assert.equal(before.attempts.has(upgraded), false);
  assert.equal(before.attempts.get(unchanged), "2026-10-09T12:00:00.000Z");
  const current = { ...row, runtimeOutcome: { ...row.runtimeOutcome, testedSha: options.codeSha } };
  assert.equal(routineUnreceiptedSupervisorAttemptHistory([current], ids, options).attempts.get(upgraded), "2026-10-09T12:00:00.000Z");
});

test("a repaired never-published OpenStates baseline bypasses an old-code boot failure while current failures and steady refreshes keep backoff", () => {
  const people = ROUTINE_SOURCE_TASKS.find(task => task.id === "openstates-people-az")!;
  const ordinary = ROUTINE_SOURCE_TASKS.find(task => task.id === "fec-funding")!;
  const meeting = ROUTINE_SOURCE_TASKS.find(task => task.recordClass === "MEETING")!;
  const owner = { ...people, id: "owner-request", ownerInvocation: { requestedAt: "2026-10-09T12:00:00.000Z", instructions: ["saved-send"] } };
  const failedAt = "2026-10-09T12:00:00.000Z", now = Date.parse(failedAt) + 60_000;
  const ordinaryClock = { lastAttemptedAt: "2026-10-01T12:00:00.000Z", lastSucceededAt: "2026-10-01T12:00:00.000Z",
    lastSucceededObservedAt: "2026-10-01T12:00:00.000Z", lastSucceededParserVersion: ordinary.parserVersion };
  const taskIds = routineCodeChangeRetryTaskIds([
    { task: people, ok: true, clock: undefined, error: null },
    { task: ordinary, ok: true, clock: ordinaryClock, error: null },
    { task: meeting, ok: true, clock: undefined, error: null },
    { task: owner, ok: true, clock: undefined, error: null },
    { task: { ...people, id: "unread-clock" }, ok: false, clock: undefined, error: "unavailable" },
  ]);
  assert.deepEqual([...taskIds], [people.id]);
  const row = supervisorHistoryRow({ finishedAt: failedAt, failures: [people.id, ordinary.id] }) as { runtimeOutcome: Record<string, unknown> };
  row.runtimeOutcome.testedSha = "a".repeat(40);
  const registered = new Set([people.id, ordinary.id]);
  const options = { taskIds, codeSha: "b".repeat(40) };
  const old = routineUnreceiptedSupervisorAttemptHistory([row], registered, options);
  assert.equal(old.issues.length, 0);
  assert.equal(old.attempts.has(people.id), false);
  assert.equal(routineTaskDue(people, routineAdmissionClock(undefined, old.attempts.get(people.id), now), now), true);
  assert.equal(old.attempts.get(ordinary.id), failedAt, "a normal refresh retains the prior failure across code changes");
  assert.equal(routineTaskDue(ordinary, routineAdmissionClock(ordinaryClock, old.attempts.get(ordinary.id), now), now), false);
  const current = routineUnreceiptedSupervisorAttemptHistory([{ ...row, runtimeOutcome: { ...row.runtimeOutcome, testedSha: options.codeSha } }], registered, options);
  const admission = routineAdmissionClock(undefined, current.attempts.get(people.id), now);
  assert.equal(routineTaskDue(people, admission, now), false, "a current-code failure keeps the one-hour retry");
  assert.equal(routineTaskDue(people, admission, Date.parse(failedAt) + people.retryMs), true);
  assert.equal(routineTaskDue(people, routineAdmissionClock({ lastAttemptedAt: failedAt }, old.attempts.get(people.id), now), now), false,
    "a durable source failure remains on its retry clock even when an older supervisor failure is discarded");
});

test("a corrupt supervisor row is explicit and cannot erase valid fairness clocks", () => {
  const [first, second] = largestRealDomain();
  assert.ok(first && second);
  const valid = supervisorHistoryRow({
    finishedAt: "2026-09-08T12:00:00.000Z",
    failures: [first.id],
  });
  const corrupt = {
    digestId: "history:corrupt-newer",
    runtimeOutcome: {
      kind: "ROUTINE_CIVIC_DATA_SUPERVISOR",
      state: "FAILED",
      cycleId: "history-cycle:corrupt",
      startedAt: "2026-09-08T12:04:00.000Z",
      finishedAt: "2026-09-08T12:05:00.000Z",
      host: "history-test-host",
      provider: "postgres",
      durable: true,
      attemptedTasks: 1,
      verifiedSourceSuccesses: 0,
      verifiedSourceFailures: 0,
      taskReceiptEvidence: "EXACT",
      taskReceipts: [],
      failures: null,
    },
  };

  const history = routineUnreceiptedSupervisorAttemptHistory(
    [valid, corrupt],
    new Set([first.id, second.id]),
  );
  assert.equal(history.attempts.get(first.id), "2026-09-08T12:00:00.000Z");
  assert.equal(history.issues.length, 1);
  assert.equal(history.issues[0]?.digestId, "history:corrupt-newer");
  assert.match(history.issues[0]?.detail ?? "", /failures are not an array/);

  const admitted = routineFailureDomainFrontier([
    { task: first, lastConsideredAt: history.attempts.get(first.id) ?? null },
    { task: second, lastConsideredAt: history.attempts.get(second.id) ?? null },
  ]);
  assert.deepEqual(admitted.map(({ task }) => task.id), [second.id]);
});

test("an exact task receipt excludes that task from the supervisor-only attempt clock", () => {
  const [receipted, unreceipted] = largestRealDomain();
  assert.ok(receipted && unreceipted);
  const history = routineUnreceiptedSupervisorAttemptHistory([
    supervisorHistoryRow({
      finishedAt: "2026-09-08T12:00:00.000Z",
      failures: [receipted.id, unreceipted.id],
      receipted: [receipted.id],
    }),
  ], new Set([receipted.id, unreceipted.id]));

  assert.equal(history.issues.length, 0);
  assert.equal(history.attempts.has(receipted.id), false);
  assert.equal(history.attempts.get(unreceipted.id), "2026-09-08T12:00:00.000Z");
});

test("a malformed exact receipt cannot suppress a valid prior supervisor attempt", () => {
  const [task] = largestRealDomain();
  assert.ok(task);
  const valid = supervisorHistoryRow({
    finishedAt: "2026-09-08T12:00:00.000Z",
    failures: [task.id],
  });
  const malformed = supervisorHistoryRow({
    finishedAt: "2026-09-08T12:05:00.000Z",
    failures: [task.id],
    receipted: [task.id],
  }) as { runtimeOutcome: { taskReceipts: { receipt: { promotedVersion: string | null } }[] } };
  malformed.runtimeOutcome.taskReceipts[0]!.receipt.promotedVersion = null;

  const history = routineUnreceiptedSupervisorAttemptHistory(
    [valid, malformed],
    new Set([task.id]),
  );
  assert.equal(history.attempts.get(task.id), "2026-09-08T12:00:00.000Z");
  assert.equal(history.issues.length, 1);
  assert.match(history.issues[0]?.detail ?? "", /receipt/);
});

/**
 * The provider frontier reads its supervisor history through the store's
 * narrowed, bounded read (ROUTINE_SUPERVISOR_HISTORY_FIELDS, _WINDOW). These fixtures carry
 * every field a real outcome does, the Reader readback references included.
 */
function wholeSupervisorOutcomes(): unknown[] {
  const [first, second, third] = largestRealDomain();
  assert.ok(first && second && third);
  const dress = (row: unknown, index: number) => {
    const value = row as { runtimeOutcome: Record<string, unknown> } & Record<string, unknown>;
    return {
      ...value,
      formatVersion: 1,
      writtenAt: `2026-09-08T12:0${index}:30.000Z`,
      headline: `ROUTINE CIVIC DATA CYCLE ${index}`,
      lines: ["a rendered line the frontier never reads"],
      cycleOk: true,
      testedSha: "0123456789abcdef0123456789abcdef01234567",
      runtimeOutcome: {
        ...value.runtimeOutcome,
        attributionBoundary: "source receipts only",
        readerReadbackDenominator: 2,
        readerReadbacksRecordedPass: 1,
        readerReadbacksRecordedFail: 0,
        readerReadbacksCurrentFail: 0,
        readerReadbackNoops: 1,
        readerReadbackRepairFailures: 0,
        readerReadbackEvidence: "EXACT",
        readerReadbacks: [
          { contractId: "a-contract", disposition: "RECORDED", receipt: { status: "PASS", detail: "x".repeat(500) } },
          { contractId: "b-contract", disposition: "NOOP", receipt: null },
        ],
      },
    };
  };
  const malformed = supervisorHistoryRow({
    finishedAt: "2026-09-08T12:03:00.000Z",
    failures: [third.id],
    receipted: [third.id],
  }) as { runtimeOutcome: { taskReceipts: { receipt: { promotedVersion: string | null } }[] } };
  malformed.runtimeOutcome.taskReceipts[0]!.receipt.promotedVersion = null;
  return [
    supervisorHistoryRow({ finishedAt: "2026-09-08T12:00:00.000Z", failures: [first.id] }),
    supervisorHistoryRow({ finishedAt: "2026-09-08T12:01:00.000Z", failures: [first.id, second.id], receipted: [first.id] }),
    supervisorHistoryRow({ finishedAt: "2026-09-08T12:02:00.000Z", failures: [] }),
    malformed,
    {
      digestId: "history:corrupt",
      runtimeOutcome: { kind: "ROUTINE_CIVIC_DATA_SUPERVISOR", state: "FAILED", failures: null, taskReceipts: "no" },
    },
    { digestId: "history:other-kind", runtimeOutcome: { kind: "FRESHNESS_CYCLE", finishedAt: "2026-09-08T12:05:00.000Z" } },
  ].map(dress);
}

test("the narrowed supervisor history holds every field the frontier's history reads", () => {
  const reads = new Set<string>();
  const tracked = wholeSupervisorOutcomes().map((row) => {
    const outcome = (row as { runtimeOutcome: object }).runtimeOutcome;
    const trackedOutcome = new Proxy(outcome, {
      get(target, key, receiver) {
        if (typeof key === "string") reads.add(`runtimeOutcome.${key}`);
        return Reflect.get(target, key, receiver);
      },
    });
    return new Proxy(row as object, {
      get(target, key, receiver) {
        if (typeof key !== "string") return Reflect.get(target, key, receiver);
        reads.add(key);
        return key === "runtimeOutcome" ? trackedOutcome : Reflect.get(target, key, receiver);
      },
    });
  });
  routineUnreceiptedSupervisorAttemptHistory(tracked, new Set(ROUTINE_SOURCE_TASKS.map(({ id }) => id)));
  const kept = ROUTINE_SUPERVISOR_HISTORY_FIELDS as Record<string, true | readonly string[]>;
  const outside = [...reads].filter((path) => {
    const [top, inner] = path.split(".");
    const keep = kept[top!];
    return inner === undefined ? keep === undefined : !(keep === true || (Array.isArray(keep) && keep.includes(inner)));
  });
  assert.deepEqual(outside, [], "every field the history reads survives the store's projection");
  assert.ok(reads.has("runtimeOutcome.failures") && reads.has("runtimeOutcome.taskReceipts"), "and the tracking is not vacuous");
  assert.ok(!reads.has("runtimeOutcome.readerReadbacks"), "the Reader readback references are never read");
});

test("the frontier decides the same from narrowed outcomes as from whole ones", () => {
  const whole = wholeSupervisorOutcomes();
  const narrowed = whole.map((row) => projectRecord(row, ROUTINE_SUPERVISOR_HISTORY_FIELDS));
  const ids = new Set(ROUTINE_SOURCE_TASKS.map(({ id }) => id));
  const fromWhole = routineUnreceiptedSupervisorAttemptHistory(whole, ids);
  const fromNarrowed = routineUnreceiptedSupervisorAttemptHistory(narrowed, ids);
  assert.deepEqual([...fromNarrowed.attempts], [...fromWhole.attempts]);
  assert.deepEqual(fromNarrowed.issues, fromWhole.issues);
  assert.ok(fromWhole.attempts.size > 0 && fromWhole.issues.length >= 2, "the fixtures exercise clocks and corrupt rows");
  const narrowedBytes = JSON.stringify(narrowed).length;
  assert.ok(narrowedBytes < JSON.stringify(whole).length, "and the narrowed rows are smaller");
});

test("the history window spans a day of passes and many rotations of the largest provider domain", () => {
  assert.ok(ROUTINE_SUPERVISOR_HISTORY_WINDOW * ROUTINE_DATA_ADMISSION_MS >= 24 * 3_600_000);
  const rotation = Math.ceil(largestRealDomain().length / ROUTINE_FAILURE_DOMAIN_FRONTIER_PER_PASS);
  assert.ok(
    ROUTINE_SUPERVISOR_HISTORY_WINDOW >= 4 * rotation,
    `window ${ROUTINE_SUPERVISOR_HISTORY_WINDOW} passes vs one rotation of ${rotation} passes`,
  );
});

test("each Google calendar is its own lane; every other host keeps one lane per hostname", async () => {
  const { MEETING_PARTITION_CONTRACTS } = await import("../lib/civic-data/meeting-partitions.ts");
  const google = MEETING_PARTITION_CONTRACTS.filter((p) => p.acquisitionFailureDomain.startsWith("meeting-upstream:calendar.google.com"));
  assert.ok(google.length > 0, "the case this guards: town calendars hosted by Google");
  const lanes = new Set(google.map((p) => p.acquisitionFailureDomain));
  assert.ok(lanes.size >= 2, "two towns' calendars are two lanes, not one hostname");
  for (const lane of lanes) assert.match(lane, /^meeting-upstream:calendar\.google\.com\/[^/\s]+$/);
  // A calendar's own partitions still share its one lane.
  const byFeed = new Map<string, Set<string>>();
  for (const p of google) {
    assert.ok(p.wiring, `${p.id} is a wiring row`);
    const feed = String(p.wiring.config.feedUrl);
    byFeed.set(feed, new Set([...(byFeed.get(feed) ?? []), p.acquisitionFailureDomain]));
  }
  for (const [feed, domains] of byFeed) assert.equal(domains.size, 1, `${feed} is one lane`);
  // A small-town host is still one lane for all its bodies.
  const newLondon = MEETING_PARTITION_CONTRACTS.filter((p) => p.acquisitionFailureDomain === "meeting-upstream:newlondon.nh.gov");
  assert.ok(newLondon.length > 1);
});

test("C6: a meeting lane is read earliest deadline first, up to three a pass; every other lane keeps one least-recently-considered", () => {
  const meetingLanes = new Map<string, RoutineSourceTask[]>();
  for (const task of ROUTINE_SOURCE_TASKS) {
    if (task.contract.schedule?.kind !== "SITTING_WINDOW") continue;
    meetingLanes.set(task.acquisitionFailureDomain, [...(meetingLanes.get(task.acquisitionFailureDomain) ?? []), task]);
  }
  const lane = [...meetingLanes.values()].sort((left, right) => right.length - left.length)[0]!;
  assert.ok(lane.length >= 5);
  const [a, b, c, d, e] = lane as [RoutineSourceTask, RoutineSourceTask, RoutineSourceTask, RoutineSourceTask, RoutineSourceTask];
  assert.equal(SITTING_WINDOW_LANE_SLOTS_PER_PASS, 3);
  // The oldest-considered task has the latest deadline: deadline order wins.
  const admitted = routineFailureDomainFrontier([
    { task: a, lastConsideredAt: "2026-09-08T00:00:00.000Z", deadlineMs: Date.parse("2026-09-08T12:00:00.000Z") },
    { task: b, lastConsideredAt: "2026-09-08T11:05:00.000Z", deadlineMs: Date.parse("2026-09-08T12:05:00.000Z") },
    { task: c, lastConsideredAt: "2026-09-08T11:00:00.000Z", deadlineMs: Date.parse("2026-09-08T12:00:30.000Z") },
    { task: d, lastConsideredAt: null, deadlineMs: Date.parse("2026-09-08T11:59:00.000Z") },
    { task: e, lastConsideredAt: "2026-09-08T10:00:00.000Z", deadlineMs: Date.parse("2026-09-08T12:10:00.000Z") },
  ]);
  assert.deepEqual(admitted.map(({ task }) => task.id).sort(), [a.id, c.id, d.id].sort());
  // A task owed at once (never run) goes first.
  const never = routineFailureDomainFrontier([
    { task: a, lastConsideredAt: null, deadlineMs: Number.NEGATIVE_INFINITY },
    { task: b, lastConsideredAt: "2026-09-08T11:05:00.000Z", deadlineMs: Date.parse("2026-09-08T11:00:00.000Z") },
    { task: c, lastConsideredAt: "2026-09-08T11:00:00.000Z", deadlineMs: Date.parse("2026-09-08T12:00:00.000Z") },
    { task: d, lastConsideredAt: "2026-09-08T10:00:00.000Z", deadlineMs: Date.parse("2026-09-08T12:30:00.000Z") },
  ]);
  assert.deepEqual(never.map(({ task }) => task.id).sort(), [a.id, b.id, c.id].sort());
  // A lane of tasks without deadlines keeps one a pass, least recently considered.
  const shared = largestRealDomain().filter((task) => task.contract.schedule?.kind !== "SITTING_WINDOW");
  if (shared.length >= 2) {
    const plain = routineFailureDomainFrontier([
      { task: shared[0]!, lastConsideredAt: "2026-09-08T12:00:00.000Z" },
      { task: shared[1]!, lastConsideredAt: "2026-09-08T11:00:00.000Z" },
    ]);
    assert.deepEqual(plain.map(({ task }) => task.id), [shared[1]!.id]);
  }
});

test("C6: no production lane mixes sitting-window tasks with any other task, so deadline order and the extra slots touch meeting lanes only", () => {
  const kinds = new Map<string, Set<boolean>>();
  for (const task of ROUTINE_SOURCE_TASKS) {
    const set = kinds.get(task.acquisitionFailureDomain) ?? new Set<boolean>();
    set.add(task.contract.schedule?.kind === "SITTING_WINDOW");
    kinds.set(task.acquisitionFailureDomain, set);
  }
  const mixed = [...kinds].filter(([, set]) => set.size > 1).map(([lane]) => lane);
  assert.deepEqual(mixed, []);
  const bound = routineFrontierPassBound();
  /* A meeting lane admits up to its slots and never more tasks than it holds: a one-task lane (a state's derived family) counts one. */
  const sizes = new Map<string, number>();
  for (const task of ROUTINE_SOURCE_TASKS) sizes.set(task.acquisitionFailureDomain, (sizes.get(task.acquisitionFailureDomain) ?? 0) + 1);
  const extra = [...kinds]
    .filter(([, set]) => set.has(true))
    .reduce((sum, [lane]) => sum + Math.min(sizes.get(lane)!, SITTING_WINDOW_LANE_SLOTS_PER_PASS) - 1, 0);
  assert.equal(bound.commandCount, routineFailureDomainCount() + extra);
  assert.equal(bound.largestFailureDomainSize, SITTING_WINDOW_LANE_SLOTS_PER_PASS);
  assert.equal(
    routineFrontierPassBound([{ acquisitionFailureDomain: "derived-family:US-OH", contract: { schedule: MEETING_SITTING_WINDOW } as never }]).commandCount,
    1,
    "one task on its own lane is one command, however many slots a meeting lane may take",
  );
});

const TUCSON_BOARDS = "meeting-upstream:clerksboards.tucsonaz.gov";

interface TucsonLaneResult {
  readonly misses: readonly string[];
  readonly maxHotGap: number;
  readonly maxBaseGap: number;
  readonly peakHot: number;
  readonly longestPassMs: number;
  readonly reads: number;
  /** Reads started by catch-up while a pass was held open. */
  readonly catchUpReads: number;
}

async function simulateTucsonLane(withRecordedPasses: boolean, initialSeed = 20260925): Promise<TucsonLaneResult> {
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  const MIN = 60_000;
  const lane = ROUTINE_SOURCE_TASKS.filter((task) => task.acquisitionFailureDomain === TUCSON_BOARDS);
  assert.equal(lane.length, 27);
  for (const task of lane) assert.deepEqual(task.contract.schedule, MEETING_SITTING_WINDOW);
  const recorded = recordedPasses();
  assert.equal(Math.max(...recorded.map(({ durationMs }) => durationMs)), 952_000);
  let seed = initialSeed;
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  const start = Date.parse("2026-09-25T07:00:00.000Z");
  const end = start + 30 * DAY;
  type Body = { readonly task: RoutineSourceTask; readonly starts: readonly string[] | undefined };
  const bodies: Body[] = lane.map((task, index) => {
    if (index < 2) return { task, starts: undefined };
    const every = index < 5 ? 15 * DAY : 30 * DAY;
    const first = start - 45 * DAY + Math.floor(rand() * 24) * DAY + Math.floor(rand() * 10 + 8) * HOUR;
    const starts: string[] = [];
    for (let at = first; at < end + 30 * DAY; at += every) starts.push(new Date(at).toISOString());
    return { task, starts };
  });
  const byId = new Map(bodies.map((body) => [body.task.id, body]));
  const hot = (body: Body, at: number) =>
    body.starts === undefined ? undefined : sittingWindowHotByConclusion(MEETING_SITTING_WINDOW, [body.starts], at);
  let peakHot = 0;
  for (let at = start; at < end; at += HOUR) peakHot = Math.max(peakHot, bodies.filter((body) => hot(body, at) === true).length);

  const clocks = new Map<string, RoutineTaskClock>();
  const reads = new Map<string, number[]>(bodies.map(({ task }) => [task.id, []]));
  const record = (body: Body, at: number) => {
    const iso = new Date(at).toISOString();
    clocks.set(body.task.id, body.starts === undefined
      ? { lastAttemptedAt: iso }
      : { lastAttemptedAt: iso, lastSucceededAt: new Date(at - 2_500).toISOString(), lastSucceededObservedAt: iso, sittingStarts: body.starts });
    reads.get(body.task.id)!.push(at);
  };
  bodies.forEach((body, index) => record(body, hot(body, start) === true ? start - (index % 8 + 1) * 5 * MIN : start - 12 * HOUR + 30 * MIN + index * 5 * MIN));

  // Each pass is admitted by the runner's own functions and run by
  // tests/helpers/routine-pass-replay.ts: this lane's reads (10-60 s each, one
  // at a time with the same-host gap) beside the rest of a recorded pass, then
  // its Reader repair, with catch-up reads while either holds the pass open.
  // The runner is down 8 minutes for a release handoff on day 3.
  const clock = new ControlledClock(start);
  let pass = 0;
  let longestPassMs = 0;
  let catchUpReads = 0;
  await clock.run(async () => {
    let at = start;
    while (at < end) {
      await clock.sleepUntil(at);
      const due = bodies.filter((body) => routineTaskDue(body.task, clocks.get(body.task.id), at, hot(body, at)));
      const admitted = routineFailureDomainFrontier(due.map((body) => ({
        task: body.task,
        lastConsideredAt: clocks.get(body.task.id)?.lastAttemptedAt ?? null,
        deadlineMs: routineTaskDeadlineMs(body.task, clocks.get(body.task.id), hot(body, at)),
      })), ROUTINE_FAILURE_DOMAIN_FRONTIER_PER_PASS, pass);
      assert.ok(admitted.length <= SITTING_WINDOW_LANE_SLOTS_PER_PASS);
      const result = await replayPass({
        clock,
        admittedAtMs: at,
        recorded: withRecordedPasses ? recorded[Math.floor(rand() * recorded.length)] : undefined,
        cleanRepairMs: 0,
        launched: routinePassLaunchOrder(admitted).map(({ task }) => task),
        windowed: lane,
        passClocks: new Map(lane.map((task) => [task.id, clocks.get(task.id)])),
        readMs: () => 10_000 + Math.floor(rand() * 50_000),
        settled: (task, endedAtMs) => record(byId.get(task.id)!, endedAtMs),
      });
      longestPassMs = Math.max(longestPassMs, result.endedAtMs - at);
      catchUpReads += result.catchUpReads;
      const handoff = at >= start + 3 * DAY && at < start + 3 * DAY + 10 * MIN ? 8 * MIN : 0;
      at = nextAdmissionMs(at, result.endedAtMs, handoff);
      pass += 1;
    }
  });
  assert.ok(pass > 7_000);
  if (withRecordedPasses) assert.ok(longestPassMs >= 952_000, "the simulation ran the longest recorded pass");

  // Each gap is judged minute by minute against the owner's rule: while a body
  // is hourly, a read is owed within 60 minutes of the later of its last read
  // and the minute it turned hourly; every body is owed one within 12 hours.
  // Every obligation due after the run's first instant is judged; one due
  // before it belongs to the seeded history, which the run did not make.
  const misses: string[] = [];
  let hotGaps = 0;
  let maxHotGap = 0;
  let maxBaseGap = 0;
  for (const body of bodies) {
    const times = [...reads.get(body.task.id)!, end];
    for (let index = 1; index < times.length; index += 1) {
      const from = times[index - 1]!;
      const to = times[index]!;
      maxBaseGap = Math.max(maxBaseGap, to - from);
      if (to - from > 12 * HOUR) misses.push(`${body.task.id} twice-daily ${((to - from) / HOUR).toFixed(2)} h at ${new Date(to).toISOString()}`);
      let owedFrom = hot(body, from) === true ? from : undefined;
      for (let minute = from + MIN; minute < to; minute += MIN) {
        if (hot(body, minute) !== true) { owedFrom = undefined; continue; }
        owedFrom ??= minute;
        if (minute - owedFrom >= HOUR && owedFrom + HOUR >= start) {
          misses.push(`${body.task.id} hourly, unread ${((to - owedFrom) / MIN).toFixed(2)} min from ${new Date(owedFrom).toISOString()}`);
          break;
        }
      }
      if (hot(body, from) === true && hot(body, to) === true) {
        hotGaps += 1;
        maxHotGap = Math.max(maxHotGap, to - from);
      }
    }
  }
  assert.ok(hotGaps > 5_000);
  // Every read the run made (each body's first entry is its seeded history).
  const made = [...reads.values()].reduce((sum, times) => sum + times.length - 1, 0);
  return { misses, maxHotGap, maxBaseGap, peakHot, longestPassMs, reads: made, catchUpReads };
}

test("C6: 30 days on a lane shaped like Tucson's, passes of normal length, the same-host gap and a release handoff: every hourly body is read within 60:00 and every other within 12:00:00", async () => {
  const { misses, maxHotGap, maxBaseGap, peakHot } = await simulateTucsonLane(false);
  assert.ok(peakHot >= 19, `the simulated peak (${peakHot} hourly bodies) is heavier than Tucson's projected 16`);
  assert.deepEqual(misses, [], `${misses.length} late reads; longest hourly gap ${(maxHotGap / 60_000).toFixed(2)} min`);
  assert.ok(maxHotGap <= 3_600_000 && maxBaseGap <= 12 * 3_600_000);
});

test("C6: 30 days on Tucson's board lane under production's recorded passes (up to 15:52, drawn at random), with catch-up while a pass is held open: every hourly body is read within 60:00 and every other within 12:00:00", async () => {
  for (const seed of [20260925, 10]) {
    const { misses, maxHotGap, maxBaseGap, longestPassMs, reads, catchUpReads } = await simulateTucsonLane(true, seed);
    const detail = `seed ${seed}: longest hourly gap ${(maxHotGap / 60_000).toFixed(2)} min, longest gap ${(maxBaseGap / 3_600_000).toFixed(2)} h, ` +
      `longest pass ${(longestPassMs / 60_000).toFixed(2)} min, ${reads} reads, ${catchUpReads} by catch-up`;
    assert.equal(misses.length, 0, `late reads (${detail}): ${misses.slice(0, 5).join(" | ")}`);
    assert.ok(maxHotGap <= 3_600_000, detail);
    assert.ok(maxBaseGap <= 12 * 3_600_000, detail);
    assert.ok(catchUpReads > 0, `the long passes admitted reads by catch-up (${detail})`);
  }
});

test("C6: the runner hands the frontier each due task's deadline from the same pass's clocks and sitting signals", () => {
  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  const call = runner.slice(runner.indexOf("const admitted = routineFailureDomainFrontier("));
  assert.match(
    call.slice(0, call.indexOf("ROUTINE_FAILURE_DOMAIN_FRONTIER_PER_PASS")),
    // An owner due request (routine-due-request.ts) can only make the deadline earlier.
    /deadlineMs: routineDueRequestDeadlineMs\(\s+routineTaskDeadlineMs\(pending\.task, clock, sittingSignals\.get\(pending\.task\.id\)\),/,
  );
  assert.ok(runner.indexOf("const sittingSignals = sittingWindowSignals(") < runner.indexOf("const admitted = routineFailureDomainFrontier("));
});

test("an unreceipted child in a single-task pass waits its existing retry interval across restarts", () => {
  const task = ROUTINE_SOURCE_TASKS.find(task => task.contract?.schedule?.kind !== "SITTING_WINDOW")!;
  const finishedAt = "2026-10-01T20:00:00.000Z";
  const at = Date.parse(finishedAt);
  const clock = { lastAttemptedAt: "2026-09-01T12:00:00.000Z", lastSucceededAt: "2026-09-01T12:00:00.000Z" };
  const history = routineUnreceiptedSupervisorAttemptHistory([
    supervisorHistoryRow({ finishedAt, failures: [task.id] }),
  ], new Set([task.id]));
  assert.equal(routineTaskDue(task, clock, at), true, "unchanged source clock alone would restart immediately");
  for (const sourceClock of [undefined, clock]) {
    const admission = routineAdmissionClock(sourceClock, history.attempts.get(task.id), at);
    assert.equal(routineTaskDue(task, admission, at + task.retryMs - 1), false);
    assert.equal(routineTaskDue(task, admission, at + task.retryMs), true);
  }
  assert.equal(clock.lastAttemptedAt, "2026-09-01T12:00:00.000Z", "no durable source clock is changed");
  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  const attemptsRead = runner.indexOf("latestUnreceiptedSupervisorAttempts(selectedTasks, routineCodeChangeRetryTaskIds(clockReads))");
  assert.ok(attemptsRead >= 0 && attemptsRead < runner.indexOf("for (const read of clockReads)"));
});

test("an unfinished round's receipt failure waits for changed inputs rather than unchanged retries", () => {
  const failedAt = "2026-10-01T20:00:00.000Z", sha = "a".repeat(40);
  const task = { ...ROUTINE_SOURCE_TASKS[0]!, id: "national-place:12345", ownerInvocation: {
    publicationPending: true as const, requestedAt: "2026-10-01T19:00:00.000Z", instructions: ["send"] } };
  const failure = { testedSha: sha, huntSourceProgress: { taskId: task.id, instructionIds: ["send"],
    stage: "FAILED", at: failedAt, detail: "RECEIPT_COUNT_INVALID: observed 0" } };
  const now = Date.parse(failedAt) + 24 * 3_600_000;
  assert.equal(unchangedRoutineProtocolFailure(task, undefined, [failure], sha, now), true,
    "expiry of the old retry interval does not change the failed input");
  assert.equal(unchangedRoutineProtocolFailure(task, undefined, [failure], "b".repeat(40), now), false);
  assert.equal(unchangedRoutineProtocolFailure({ ...task, ownerInvocation: { ...task.ownerInvocation,
    requestedAt: new Date(now).toISOString() } }, undefined, [failure], sha, now), false);
  assert.equal(unchangedRoutineProtocolFailure(task, { lastSucceededObservedAt: new Date(now).toISOString() }, [failure], sha, now), false);
  assert.equal(unchangedRoutineProtocolFailure(task, undefined, [{ ...failure, huntSourceProgress: {
    ...failure.huntSourceProgress, detail: "RECEIPT_COUNT_INVALID: Child process HTTP status 429: Retry-After" } }], sha, now), false, "provider errors retain backoff");
  assert.equal(unchangedRoutineProtocolFailure(task, undefined, [{ ...failure, huntSourceProgress: {
    ...failure.huntSourceProgress, at: new Date(now + 1).toISOString() } }], sha, now), false);
});

test("source progress supersedes a supervisor failure and invalid future outcomes cannot delay work", () => {
  const at = Date.parse("2026-10-01T20:00:00.000Z");
  const failed = new Date(at - 60_000).toISOString();
  for (const clock of [
    { lastAttemptedAt: failed },
    { lastSucceededAt: failed },
    { lastSucceededObservedAt: failed },
  ]) assert.equal(routineAdmissionClock(clock, failed, at), clock);
  const clock = { lastAttemptedAt: "2026-09-01T12:00:00.000Z" };
  for (const invalid of [undefined, "bad", new Date(at + 1).toISOString()]) {
    assert.equal(routineAdmissionClock(clock, invalid, at), clock);
  }
});

test("unreceipted meeting retries keep the existing sitting cadence", () => {
  const task = ROUTINE_SOURCE_TASKS.find(task => task.contract?.schedule?.kind === "SITTING_WINDOW")!;
  const at = Date.parse("2026-10-01T20:00:00.000Z");
  const failed = new Date(at).toISOString();
  const clock = { lastAttemptedAt: new Date(at - 3_600_000).toISOString(), lastSucceededObservedAt: new Date(at - 3_600_000).toISOString(), sittingStarts: [failed] };
  const admission = routineAdmissionClock(clock, failed, at);
  assert.equal(routineTaskDue(task, admission, at, true), false);
  assert.equal(routineTaskDue(task, admission, at + 3_600_000, true), true);
});
