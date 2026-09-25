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
  routineTaskDue,
  routineUnreceiptedSupervisorAttemptHistory,
  type RoutineSourceTask,
  type RoutineTaskClock,
} from "../lib/civic-data/runner.ts";
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

test("R20: a hot body goes first on its lane, ahead of older twice-daily re-reads and never-published retries", () => {
  const shared = largestRealDomain().slice(0, 3);
  assert.equal(shared.length, 3);
  const [base, never, hot] = shared as [RoutineSourceTask, RoutineSourceTask, RoutineSourceTask];
  const candidates = [
    { task: base, lastConsideredAt: "2026-09-08T00:00:00.000Z", hot: false },
    { task: never, lastConsideredAt: null },
    { task: hot, lastConsideredAt: "2026-09-08T11:05:00.000Z", hot: true },
  ];
  assert.deepEqual(routineFailureDomainFrontier(candidates).map(({ task }) => task.id), [hot.id]);
  // With no hot task due, the least-recently-considered order is unchanged.
  assert.deepEqual(routineFailureDomainFrontier(candidates.slice(0, 2)).map(({ task }) => task.id), [never.id]);
  // Between hot tasks, the least recently considered goes first.
  const twoHot = [
    { task: base, lastConsideredAt: "2026-09-08T11:00:00.000Z", hot: true },
    { task: hot, lastConsideredAt: "2026-09-08T11:05:00.000Z", hot: true },
  ];
  assert.deepEqual(routineFailureDomainFrontier(twoHot).map(({ task }) => task.id), [base.id]);
});

test("R20: on a lane as crowded as Tucson's, every hot body keeps its hour through a burst of twice-daily re-reads, and none starves", () => {
  // Tucson clerksboards, 2026-09-25: 8 bodies in the window, 17 outside it, 2 never published, one read per 5-minute pass.
  const HOUR = 3_600_000;
  const model = ROUTINE_SOURCE_TASKS.find((task) => task.contract.schedule?.kind === "SITTING_WINDOW" && task.recordClass === "MEETING");
  assert.ok(model);
  const lane = (kind: string, count: number) => Array.from({ length: count }, (_, index) => ({
    ...model,
    id: `sim:${kind}:${index}`,
    acquisitionFailureDomain: "meeting-upstream:sim.example",
  }) as RoutineSourceTask);
  const hot = lane("hot", 8);
  const base = lane("base", 17);
  const never = lane("never", 2);
  const start = Date.parse("2026-09-25T10:40:00.000Z");
  const iso = (ms: number) => new Date(ms).toISOString();
  const clocks = new Map<string, RoutineTaskClock>();
  const readAt = (task: RoutineSourceTask, at: number) => clocks.set(task.id, never.includes(task)
    ? { lastAttemptedAt: iso(at) }
    : {
        lastAttemptedAt: iso(at),
        lastSucceededAt: iso(at - 2_500),
        lastSucceededObservedAt: iso(at),
        sittingStarts: hot.includes(task) ? [iso(start + 2 * 24 * HOUR)] : [],
      });
  // Hot bodies were read in the last 40 minutes; every twice-daily body and
  // every never-published retry falls due at once: the worst burst.
  hot.forEach((task, index) => readAt(task, start - (index + 1) * ROUTINE_DATA_ADMISSION_MS));
  base.forEach((task) => readAt(task, start - 12 * HOUR));
  never.forEach((task) => readAt(task, start - 12 * HOUR));
  const reads = new Map<string, number[]>([...hot, ...base, ...never].map((task) => [task.id, []]));
  for (let pass = 0; pass < 96; pass += 1) {
    const now = start + pass * ROUTINE_DATA_ADMISSION_MS;
    const signal = (task: RoutineSourceTask) => hot.includes(task) ? true : base.includes(task) ? false : undefined;
    const due = [...hot, ...base, ...never].filter((task) => routineTaskDue(task, clocks.get(task.id), now, signal(task)));
    const admitted = routineFailureDomainFrontier(due.map((task) => ({
      task,
      lastConsideredAt: clocks.get(task.id)?.lastAttemptedAt ?? null,
      hot: signal(task) === true,
    })), ROUTINE_FAILURE_DOMAIN_FRONTIER_PER_PASS, pass);
    assert.ok(admitted.length <= 1);
    for (const { task } of admitted) {
      readAt(task, now);
      reads.get(task.id)!.push(now);
    }
  }
  hot.forEach((task, index) => {
    const times = [start - (index + 1) * ROUTINE_DATA_ADMISSION_MS, ...reads.get(task.id)!];
    const gaps = times.slice(1).map((at, i) => at - times[i]!);
    assert.ok(Math.max(...gaps) <= HOUR, `${task.id}: every hot read within the hour (${gaps.map((gap) => gap / 60_000).join(", ")} min)`);
  });
  for (const task of [...base, ...never]) assert.ok(reads.get(task.id)!.length >= 1, `${task.id} is read within eight hours of falling due`);
});

test("R20: the runner hands the frontier each due task's hot signal from the same pass", () => {
  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  const call = runner.slice(runner.indexOf("const admitted = routineFailureDomainFrontier("));
  assert.match(call.slice(0, call.indexOf("ROUTINE_FAILURE_DOMAIN_FRONTIER_PER_PASS")), /hot: sittingSignals\.get\(pending\.task\.id\) === true,/);
  assert.ok(runner.indexOf("const sittingSignals = sittingWindowSignals(") < runner.indexOf("const admitted = routineFailureDomainFrontier("));
});
