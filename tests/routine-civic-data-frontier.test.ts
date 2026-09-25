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
  routineTaskDeadlineMs,
  routineTaskDue,
  routineUnreceiptedSupervisorAttemptHistory,
  SITTING_WINDOW_LANE_SLOTS_PER_PASS,
  type RoutineSourceTask,
  type RoutineTaskClock,
} from "../lib/civic-data/runner.ts";
import { MEETING_SITTING_WINDOW } from "../lib/civic-data/contracts.ts";
import { sittingWindowHotByConclusion } from "../lib/civic-data/sitting-window-admission.ts";
import { ROUTINE_SAME_DOMAIN_CHILD_GAP_MS } from "../lib/civic-data/bounded-child-pass.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";
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
 * narrowed, bounded read (ROUTINE_SUPERVISOR_HISTORY_FIELDS, _WINDOW): on
 * 2026-09-24 the whole-history read moved 428 MB a pass. These fixtures carry
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
  const meetingLanes = [...kinds].filter(([, set]) => set.has(true)).length;
  assert.equal(bound.commandCount, routineFailureDomainCount() + meetingLanes * (SITTING_WINDOW_LANE_SLOTS_PER_PASS - 1));
  assert.equal(bound.largestFailureDomainSize, SITTING_WINDOW_LANE_SLOTS_PER_PASS);
});

function simulateTucsonLane(recordedPasses: boolean): { misses: string[]; maxHotGap: number; maxBaseGap: number; peakHot: number } {
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  const MIN = 60_000;
  const model = ROUTINE_SOURCE_TASKS.find((task) => task.recordClass === "MEETING" && task.contract.schedule?.kind === "SITTING_WINDOW");
  assert.ok(model);
  // The 196 passes production ran on 2026-09-24 (5:00 AM to 11:00 PM MST): each
  // pass lasts as long as its slowest child, reader repairs and every other
  // family included (p50 1:34, p99 10:58, max 15:52).
  const recorded = JSON.parse(readFileSync("tests/fixtures/routine-pass-durations-2026-09-24.json", "utf8")) as { durationSeconds: number[] };
  assert.equal(recorded.durationSeconds.length, 196);
  assert.equal(Math.max(...recorded.durationSeconds), 952);
  let seed = 20260925;
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  const start = Date.parse("2026-09-25T07:00:00.000Z");
  const end = start + 30 * DAY;
  // 27 bodies on one host, as Tucson's board site: 2 never published, 3 meeting
  // twice a month (always hourly) and 22 monthly, meeting across 24 days of the
  // month, so up to 19 are hourly at once: more than Tucson's projected peak of
  // 16 (2026-10-14, counting conclusion as a day after start).
  type Body = { readonly task: RoutineSourceTask; readonly starts: readonly string[] | undefined };
  const bodies: Body[] = Array.from({ length: 27 }, (_, index) => {
    const task = { ...model, id: `sim:${index}`, acquisitionFailureDomain: "meeting-upstream:sim.tucson.example" } as RoutineSourceTask;
    if (index < 2) return { task, starts: undefined };
    const every = index < 5 ? 15 * DAY : 30 * DAY;
    const first = start - 45 * DAY + Math.floor(rand() * 24) * DAY + Math.floor(rand() * 10 + 8) * HOUR;
    const starts: string[] = [];
    for (let at = first; at < end + 30 * DAY; at += every) starts.push(new Date(at).toISOString());
    return { task, starts };
  });
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
  // Twice-daily bodies fall due over the first two hours, one every five
  // minutes, as Tucson's did after the B3 switch; hourly ones were read within
  // the last 40 minutes.
  bodies.forEach((body, index) => record(body, hot(body, start) === true ? start - (index % 8 + 1) * 5 * MIN : start - 12 * HOUR + 30 * MIN + index * 5 * MIN));

  // A pass starts on the first one-minute tick at least five minutes after the
  // last one started and after it ended. Its duration is a recorded production
  // pass, or this lane's own reads if longer: each read 10-60 s, the second
  // after the first plus the same-host gap. The runner is down 8 minutes for a
  // release handoff on day 3.
  const TICK = MIN;
  let at = start;
  let pass = 0;
  let longest = 0;
  while (at < end) {
    const due = bodies.filter((body) => routineTaskDue(body.task, clocks.get(body.task.id), at, hot(body, at)));
    const admitted = routineFailureDomainFrontier(due.map((body) => ({
      task: body.task,
      lastConsideredAt: clocks.get(body.task.id)?.lastAttemptedAt ?? null,
      deadlineMs: routineTaskDeadlineMs(body.task, clocks.get(body.task.id), hot(body, at)),
    })), ROUTINE_FAILURE_DOMAIN_FRONTIER_PER_PASS, pass);
    assert.ok(admitted.length <= SITTING_WINDOW_LANE_SLOTS_PER_PASS);
    let laneAt = at + 20_000;
    admitted.forEach(({ task }, index) => {
      if (index > 0) laneAt += ROUTINE_SAME_DOMAIN_CHILD_GAP_MS;
      laneAt += 10_000 + Math.floor(rand() * 50_000);
      record(bodies.find((body) => body.task.id === task.id)!, laneAt);
    });
    const sampled = recorded.durationSeconds[Math.floor(rand() * recorded.durationSeconds.length)]! * 1000;
    const duration = Math.max(recordedPasses ? sampled : 0, laneAt - at);
    longest = Math.max(longest, duration);
    const handoff = at >= start + 3 * DAY && at < start + 3 * DAY + 10 * MIN ? 8 * MIN : 0;
    at = Math.ceil((Math.max(at + ROUTINE_DATA_ADMISSION_MS, at + duration) + handoff) / TICK) * TICK;
    pass += 1;
  }
  assert.ok(pass > 7_000);
  if (recordedPasses) assert.ok(longest >= 952_000, "the simulation ran the longest recorded pass");

  // Each gap is judged minute by minute against the owner's rule: while a body
  // is hourly, a read is owed within 60 minutes of the later of its last read
  // and the minute it turned hourly; every body is owed one within 12 hours.
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
        if (minute - owedFrom >= HOUR) {
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
  return { misses, maxHotGap, maxBaseGap, peakHot };
}

test("C6: 30 days on a lane shaped like Tucson's, passes of normal length, the same-host gap and a release handoff: every hourly body is read within 60:00 and every other within 12:00:00", () => {
  const { misses, maxHotGap, maxBaseGap, peakHot } = simulateTucsonLane(false);
  assert.ok(peakHot >= 19, `the simulated peak (${peakHot} hourly bodies) is heavier than Tucson's projected 16`);
  assert.deepEqual(misses, [], `${misses.length} late reads; longest hourly gap ${(maxHotGap / 60_000).toFixed(2)} min`);
  assert.ok(maxHotGap <= 3_600_000 && maxBaseGap <= 12 * 3_600_000);
});

test("C6 residual, open: with production's recorded passes (up to 15:52, drawn at random) a Tucson-shaped lane still misses the hour, rarely and by at most two minutes", () => {
  // Passes held open by reader repairs and other families (2026-09-24) are not
  // meeting scheduling; until they are bounded, this is the residual C6 carries.
  const { misses, maxBaseGap } = simulateTucsonLane(true);
  assert.ok(misses.length <= 3, `${misses.length} late reads: ${misses.slice(0, 5).join(" | ")}`);
  for (const miss of misses) assert.match(miss, /hourly, unread 6[01]\.\d\d min/, miss);
  assert.ok(maxBaseGap <= 12 * 3_600_000, "no twice-daily read is late");
});

test("C6: the runner hands the frontier each due task's deadline from the same pass's clocks and sitting signals", () => {
  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  const call = runner.slice(runner.indexOf("const admitted = routineFailureDomainFrontier("));
  assert.match(
    call.slice(0, call.indexOf("ROUTINE_FAILURE_DOMAIN_FRONTIER_PER_PASS")),
    /deadlineMs: routineTaskDeadlineMs\(pending\.task, clock, sittingSignals\.get\(pending\.task\.id\)\),/,
  );
  assert.ok(runner.indexOf("const sittingSignals = sittingWindowSignals(") < runner.indexOf("const admitted = routineFailureDomainFrontier("));
});
