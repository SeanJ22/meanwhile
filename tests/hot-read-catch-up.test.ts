import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  HOT_READ_CATCH_UP_CONCURRENCY,
  HOT_READ_CATCH_UP_READ_BUDGET_MS,
  HOT_READ_CATCH_UP_RECHECK_MS,
  hotReadCatchUpAdmission,
  hotReadCatchUpReadWorstCaseMs,
  repairDomainRacesHotReads,
  routinePassSourceCatchUpDeadlineMs,
  routinePassWorkDeadlineMs,
  runHotReadCatchUp,
  runRoutinePassWithHotReadCatchUp,
  type HotReadCandidate,
} from "../lib/civic-data/hot-read-catch-up.ts";
import {
  ROUTINE_CLOCK_MAX_REQUESTS_PER_TASK,
  ROUTINE_CLOCK_READ_CONCURRENCY,
  ROUTINE_PASS_BUDGET_MS,
  ROUTINE_SOURCE_TASKS,
  routineFrontierPassBound,
  routineTaskDeadlineMs,
  routineTaskDue,
  type RoutineSourceTask,
  type RoutineTaskClock,
} from "../lib/civic-data/runner.ts";
import {
  ROUTINE_CHILD_CONCURRENCY,
  ROUTINE_RUNNER_COORDINATION_AND_PERSISTENCE_BUDGET_MS,
  ROUTINE_RUNNER_OUTER_GRACE_MS,
  ROUTINE_SAME_DOMAIN_CHILD_GAP_MS,
  routineRunnerOuterTimeoutMs,
} from "../lib/civic-data/bounded-child-pass.ts";
import {
  ROUTINE_READER_CHILD_CONCURRENCY,
  ROUTINE_READER_MEETING_TIMEOUT_MS,
  ROUTINE_READER_SINGLE_TIMEOUT_MS,
  routineReaderRepairDomains,
} from "../lib/civic-data/reader-repair-protocol.ts";
import { ROUTINE_DURABLE_RECEIPT_MAX_REQUESTS, routineSupervisorOuterEvidence } from "../lib/civic-data/runner-receipt.ts";
import { STANDING_NEON_REQUEST_DEADLINE_MS } from "../lib/ops/neon-request-deadline.ts";

const MIN = 60_000;
const T0 = Date.parse("2026-10-12T15:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

/** A controlled clock: time moves only to the next timer, after every ready continuation has run. */
class FakeClock {
  nowMs: number;
  private readonly timers: { readonly at: number; readonly resolve: () => void }[] = [];

  constructor(start: number) {
    this.nowMs = start;
  }

  readonly now = (): number => this.nowMs;

  readonly sleepUntil = (at: number): Promise<void> =>
    new Promise<void>((resolve) => { this.timers.push({ at, resolve }); });

  async runUntil(done: Promise<unknown>): Promise<void> {
    let finished = false;
    void done.then(() => { finished = true; }, () => { finished = true; });
    for (let step = 0; step < 10_000; step += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      if (finished) return;
      this.timers.sort((left, right) => left.at - right.at);
      const next = this.timers.shift();
      if (next === undefined) throw new Error("the controlled clock has no timer left and the work never finished");
      this.nowMs = Math.max(this.nowMs, next.at);
      next.resolve();
    }
    throw new Error("the controlled clock did not settle");
  }
}

const meetingTasks = ROUTINE_SOURCE_TASKS.filter((task) =>
  task.recordClass === "MEETING" && task.contract.schedule?.kind === "SITTING_WINDOW");

/** A body with a sitting in two days, last read at `lastReadMs`: hot, owed an hour later, eligible 25 minutes before that. */
function hotClock(lastReadMs: number): RoutineTaskClock {
  return {
    lastAttemptedAt: iso(lastReadMs),
    lastSucceededAt: iso(lastReadMs - 2_500),
    lastSucceededObservedAt: iso(lastReadMs),
    sittingStarts: [iso(T0 + 2 * 24 * 60 * MIN)],
  };
}

function candidateFor(task: RoutineSourceTask, clock: RoutineTaskClock): HotReadCandidate {
  return { task, clock, lastConsideredAt: clock.lastAttemptedAt ?? null };
}

function busiestLane(): readonly [string, readonly RoutineSourceTask[]] {
  const byLane = new Map<string, RoutineSourceTask[]>();
  for (const task of meetingTasks) byLane.set(task.acquisitionFailureDomain, [...(byLane.get(task.acquisitionFailureDomain) ?? []), task]);
  return [...byLane.entries()].sort((left, right) => right[1].length - left[1].length)[0]!;
}

/**
 * Catch-up over `candidates` with the production admission and dispatcher; each
 * read takes `readMs` and is recorded as it starts.
 */
function catchUpOver(input: {
  readonly fake: FakeClock;
  readonly candidates: readonly HotReadCandidate[];
  readonly work: Promise<unknown>;
  readonly unblocked: Promise<void>;
  readonly readMs: number;
  readonly started: { readonly id: string; readonly atMs: number }[];
}) {
  const launched = new Set<string>();
  const laneLastEndedMs = new Map<string, number>();
  const clockReads = input.candidates.map(({ task, clock }) => ({ task, ok: true as const, clock }));
  return runHotReadCatchUp({
    work: input.work,
    unblocked: input.unblocked,
    now: input.fake.now,
    sleepUntil: input.fake.sleepUntil,
    concurrency: HOT_READ_CATCH_UP_CONCURRENCY,
    admit: (nowMs, slots, runningLanes) => hotReadCatchUpAdmission({
      nowMs,
      candidates: input.candidates.filter(({ task }) => !launched.has(task.id)),
      clockReads,
      statedEnds: new Map(),
      laneLastEndedMs,
      busyLanes: runningLanes,
      slots,
      limitMs: Number.POSITIVE_INFINITY,
    }),
    read: async (task, atMs) => {
      launched.add(task.id);
      input.started.push({ id: task.id, atMs });
      await input.fake.sleepUntil(atMs + input.readMs);
      laneLastEndedMs.set(task.acquisitionFailureDomain, input.fake.now());
    },
  });
}

test("C6: a due hourly read is admitted within its deadline while a long Reader repair is in flight", async () => {
  const task = meetingTasks[0]!;
  const clock = hotClock(T0 - 34 * MIN);
  // The pass's own admission: not yet due at T0, due a minute later, owed by T0 + 26 min.
  assert.equal(routineTaskDue(task, clock, T0, true), false);
  assert.equal(routineTaskDue(task, clock, T0 + MIN, true), true);
  const deadlineMs = routineTaskDeadlineMs(task, clock, true)!;
  assert.equal(deadlineMs, T0 + 26 * MIN);

  const fake = new FakeClock(T0 + 90_000);
  const repairEndsMs = T0 + 28 * MIN;
  const started: { readonly id: string; readonly atMs: number }[] = [];
  const run = catchUpOver({
    fake,
    candidates: [candidateFor(task, clock)],
    work: fake.sleepUntil(repairEndsMs).then(() => "repair settled" as const),
    unblocked: fake.sleepUntil(T0 + 2 * MIN),
    readMs: MIN,
    started,
  });
  await fake.runUntil(run);
  const result = await run;

  assert.equal(result.work, "repair settled", "the pass still waits for, and reports, its whole repair");
  assert.equal(result.error, undefined);
  assert.deepEqual(started, [{ id: task.id, atMs: T0 + 2 * MIN }], "started the moment the racing repairs settled");
  assert.ok(started[0]!.atMs <= deadlineMs, "started before its deadline");
  assert.deepEqual(result.reads, [{ atMs: T0 + 2 * MIN, taskId: task.id }]);
  // Without catch-up the read waited for the whole repair: the next pass could
  // start no earlier than the repair's end, after the deadline.
  assert.ok(repairEndsMs > deadlineMs, "the same repair held the read past its deadline before");
});

test("C6: a read due while a racing repair runs starts as soon as that repair settles", async () => {
  const task = meetingTasks[0]!;
  const fake = new FakeClock(T0 + 30_000);
  const started: { readonly id: string; readonly atMs: number }[] = [];
  const run = catchUpOver({
    fake,
    candidates: [candidateFor(task, hotClock(T0 - 34 * MIN))],
    work: fake.sleepUntil(T0 + 20 * MIN).then(() => 1),
    unblocked: fake.sleepUntil(T0 + 7 * MIN),
    readMs: 30_000,
    started,
  });
  await fake.runUntil(run);
  assert.deepEqual(started.map(({ atMs }) => (atMs - T0) / MIN), [7]);
});

test("C6: a lane with many due reads keeps reading, one read at a time a minute apart, while a pass is held open; lanes take the two children earliest deadline first", async () => {
  const [lane, busy] = busiestLane();
  assert.ok(busy.length >= 5, `the busiest lane (${lane}) has at least five bodies`);
  const other = meetingTasks.find((task) => task.acquisitionFailureDomain !== lane)!;
  const third = meetingTasks.find((task) => task.acquisitionFailureDomain !== lane && task.acquisitionFailureDomain !== other.acquisitionFailureDomain)!;
  const now = T0 + 5 * MIN;
  // Five due bodies on the busy lane, owed at +20..+16 minutes (the soonest last
  // in registry order); one on each of two other lanes, owed at +24 and +25.
  const laneCandidates = busy.slice(0, 5).map((task, index) => candidateFor(task, hotClock(now - (40 + index) * MIN)));
  const candidates = [
    ...laneCandidates,
    candidateFor(third, hotClock(now - 35 * MIN)),
    candidateFor(other, hotClock(now - 36 * MIN)),
  ];
  const fake = new FakeClock(now);
  const started: { readonly id: string; readonly atMs: number }[] = [];
  const run = catchUpOver({ fake, candidates, work: fake.sleepUntil(now + 30 * MIN), unblocked: Promise.resolve(), readMs: 30_000, started });
  await fake.runUntil(run);

  const onLane = started.filter(({ id }) => busy.some((task) => task.id === id));
  assert.deepEqual(
    onLane.map(({ id }) => id),
    [...laneCandidates].reverse().map(({ task }) => task.id),
    "the lane's reads go soonest owed first",
  );
  // One at a time: each starts 30 s (the read) + 60 s (the same-host gap) after the last.
  assert.deepEqual(onLane.map(({ atMs }) => (atMs - now) / 1_000), [0, 90, 180, 270, 360]);
  // The busy lane (owed soonest) and the next-soonest lane take the two
  // children first, whatever the registry order; the last lane starts when the
  // first read settles.
  assert.deepEqual(started.slice(0, 2), [{ id: laneCandidates[4]!.task.id, atMs: now }, { id: other.id, atMs: now }]);
  assert.deepEqual(started.find(({ id }) => id === third.id), { id: third.id, atMs: now + 30_000 });
  assert.equal(HOT_READ_CATCH_UP_CONCURRENCY, 2);
});

test("C6: catch-up runs beside the source reads, and the Reader repair starts only once every read begun there has settled", async () => {
  const task = meetingTasks[0]!;
  const clock = hotClock(T0 - 44 * MIN); // due from T0 - 9 min: read beside the source reads
  const late = meetingTasks.find((row) => row.acquisitionFailureDomain !== task.acquisitionFailureDomain)!;
  const lateClock = hotClock(T0 - 26 * MIN); // due from T0 + 9 min
  const fake = new FakeClock(T0);
  const started: { readonly id: string; readonly atMs: number; readonly phase: string }[] = [];
  let repairStartedAtMs = Number.NaN;
  const launched = new Set<string>();
  const laneLastEndedMs = new Map<string, number>();
  const candidates = [candidateFor(task, clock), candidateFor(late, lateClock)];
  const clockReads = candidates.map((row) => ({ task: row.task, ok: true as const, clock: row.clock }));
  const run = runRoutinePassWithHotReadCatchUp({
    source: fake.sleepUntil(T0 + 10 * MIN).then(() => "source settled" as const),
    startRepair: (source) => {
      assert.equal(source, "source settled", "the repair receives the source reads' result");
      repairStartedAtMs = fake.now();
      return { repair: fake.sleepUntil(fake.now() + 4 * MIN).then(() => "repair settled" as const), unblocked: fake.sleepUntil(fake.now() + MIN) };
    },
    now: fake.now,
    sleepUntil: fake.sleepUntil,
    concurrency: HOT_READ_CATCH_UP_CONCURRENCY,
    admit: (phase, nowMs, slots, runningLanes) => {
      const plan = hotReadCatchUpAdmission({
        nowMs,
        candidates: candidates.filter((row) => !launched.has(row.task.id)),
        clockReads,
        statedEnds: new Map(),
        laneLastEndedMs,
        busyLanes: runningLanes,
        slots,
        limitMs: Number.POSITIVE_INFINITY,
      });
      for (const row of plan.start) started.push({ id: row.id, atMs: nowMs, phase });
      return plan;
    },
    read: async (row, atMs) => {
      launched.add(row.id);
      await fake.sleepUntil(atMs + 3 * MIN);
      laneLastEndedMs.set(row.acquisitionFailureDomain, fake.now());
    },
  });
  await fake.runUntil(run);
  const result = await run;
  assert.equal(result.source, "source settled");
  assert.equal(result.repair, "repair settled");
  assert.deepEqual(result.errors, []);
  assert.deepEqual(started, [
    { id: task.id, atMs: T0, phase: "SOURCE" },
    // Due at T0 + 9 min, seen by the minute's recheck.
    { id: late.id, atMs: T0 + 9 * MIN, phase: "SOURCE" },
  ]);
  assert.ok(HOT_READ_CATCH_UP_RECHECK_MS <= MIN);
  // The source reads ended at +10; the read begun at +9 ran until +12, and only then did the repair start.
  assert.equal(repairStartedAtMs, T0 + 12 * MIN);
});

test("C6: a short phase with nothing due starts no read, a failed phase still fails, and a catch-up defect stops catch-up without costing the phase", async () => {
  const fake = new FakeClock(T0 + 30_000);
  let admissions = 0;
  const idle = runHotReadCatchUp({
    work: fake.sleepUntil(T0 + 90_000).then(() => "done"),
    unblocked: Promise.resolve(),
    now: fake.now,
    sleepUntil: fake.sleepUntil,
    concurrency: HOT_READ_CATCH_UP_CONCURRENCY,
    admit: (nowMs) => { admissions += 1; return { start: [], recheckAtMs: nowMs + HOT_READ_CATCH_UP_RECHECK_MS }; },
    read: async () => { throw new Error("never called"); },
  });
  await fake.runUntil(idle);
  assert.deepEqual(await idle, { work: "done", reads: [] });
  assert.equal(admissions, 1, "one look, then the phase ended before the next");

  const failing = runHotReadCatchUp({
    work: fake.sleepUntil(T0 + 6 * MIN).then(() => { throw new Error("READER_PASS_FAILED"); }),
    unblocked: Promise.resolve(),
    now: fake.now,
    sleepUntil: fake.sleepUntil,
    concurrency: HOT_READ_CATCH_UP_CONCURRENCY,
    admit: (nowMs) => ({ start: [], recheckAtMs: nowMs + HOT_READ_CATCH_UP_RECHECK_MS }),
    read: async () => undefined,
  });
  await fake.runUntil(failing);
  await assert.rejects(failing, /READER_PASS_FAILED/);

  // An admission that throws stops catch-up, never the phase or its result.
  let calls = 0;
  const defective = runHotReadCatchUp({
    work: fake.sleepUntil(fake.now() + 20 * MIN).then(() => "repaired"),
    unblocked: Promise.resolve(),
    now: fake.now,
    sleepUntil: fake.sleepUntil,
    concurrency: HOT_READ_CATCH_UP_CONCURRENCY,
    admit: () => { calls += 1; throw new Error("ROUTINE_FAILURE_DOMAIN_INVALID:x"); },
    read: async () => undefined,
  });
  await fake.runUntil(defective);
  const result = await defective;
  assert.equal(result.work, "repaired");
  assert.equal(calls, 1);
  assert.match(result.error ?? "", /ROUTINE_FAILURE_DOMAIN_INVALID/);

  // A read that throws does the same once it settles; the other read in flight still settles.
  const task = meetingTasks[0]!;
  const second = meetingTasks.find((row) => row.acquisitionFailureDomain !== task.acquisitionFailureDomain)!;
  let settled = 0;
  const broken = runHotReadCatchUp({
    work: fake.sleepUntil(fake.now() + 20 * MIN).then(() => "repaired"),
    unblocked: Promise.resolve(),
    now: fake.now,
    sleepUntil: fake.sleepUntil,
    concurrency: HOT_READ_CATCH_UP_CONCURRENCY,
    admit: (nowMs, slots) => ({ start: settled === 0 && slots === 2 ? [task, second] : [], recheckAtMs: nowMs + MIN }),
    read: async (row, atMs) => {
      await fake.sleepUntil(atMs + (row === task ? 10_000 : 40_000));
      settled += 1;
      if (row === task) throw new Error("SETTLEMENT_DEFECT");
    },
  });
  await fake.runUntil(broken);
  const brokenResult = await broken;
  assert.equal(brokenResult.work, "repaired");
  assert.equal(settled, 2);
  assert.deepEqual(brokenResult.reads.map(({ taskId }) => taskId), [task.id, second.id]);
  assert.match(brokenResult.error ?? "", /SETTLEMENT_DEFECT/);
  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  assert.match(runner, /code: "HOT_READ_CATCH_UP_FAILED"/, "the runner records a catch-up defect as a supervisor failure");
});

test("C6: catch-up starts only due sitting-window reads, one a lane, the lane's soonest owed first, after the same-host gap and never on a lane the pass is still reading", () => {
  const [lane, busy] = busiestLane();
  assert.ok(busy.length >= 4, `the busiest lane (${lane}) has at least four bodies`);
  const now = T0 + 10 * MIN;
  // Four due hot bodies on one lane, last read 40..43 minutes ago: owed at +20..+17 minutes.
  const candidates = busy.slice(0, 4).map((task, index) => candidateFor(task, hotClock(now - (40 + index) * MIN)));
  const clockReads = candidates.map(({ task, clock }) => ({ task, ok: true as const, clock }));
  const nonMeeting = ROUTINE_SOURCE_TASKS.find((task) => task.contract.schedule === undefined)!;
  const base = {
    nowMs: now,
    candidates: [...candidates, { task: nonMeeting, clock: undefined, lastConsideredAt: null }],
    clockReads,
    statedEnds: new Map(),
    laneLastEndedMs: new Map<string, number>(),
    busyLanes: new Set<string>(),
    slots: HOT_READ_CATCH_UP_CONCURRENCY,
    limitMs: Number.POSITIVE_INFINITY,
  };
  const admitted = hotReadCatchUpAdmission(base);
  assert.deepEqual(admitted.start.map(({ id }) => id), [candidates[3]!.task.id], "the lane's soonest owed; never another data family");
  assert.deepEqual(admitted.pastLimit, []);
  // A lane read less than the same-host gap ago waits for the gap, and is looked at again as it ends.
  const endedMs = now - ROUTINE_SAME_DOMAIN_CHILD_GAP_MS + 1_000;
  const gapped = hotReadCatchUpAdmission({ ...base, laneLastEndedMs: new Map([[lane, endedMs]]) });
  assert.deepEqual(gapped.start, []);
  assert.equal(gapped.recheckAtMs, endedMs + ROUTINE_SAME_DOMAIN_CHILD_GAP_MS);
  // A lane the pass is still reading, or no free child, starts nothing.
  assert.deepEqual(hotReadCatchUpAdmission({ ...base, busyLanes: new Set([lane]) }).start, []);
  assert.deepEqual(hotReadCatchUpAdmission({ ...base, slots: 0 }).start, []);
  // Not due yet (read 20 minutes ago): nothing starts early, and it is looked at again within the minute.
  const fresh = busy.slice(0, 1).map((task) => candidateFor(task, hotClock(now - 20 * MIN)));
  const early = hotReadCatchUpAdmission({ ...base, candidates: fresh, clockReads: fresh.map(({ task, clock }) => ({ task, ok: true as const, clock })) });
  assert.deepEqual(early.start, []);
  assert.equal(early.recheckAtMs, now + HOT_READ_CATCH_UP_RECHECK_MS);
  // A read that could outlast the pass's limit waits for the next pass.
  const limited = hotReadCatchUpAdmission({ ...base, limitMs: now + hotReadCatchUpReadWorstCaseMs() - 1 });
  assert.deepEqual(limited.start, []);
  assert.deepEqual(limited.pastLimit.map(({ id }) => id), [candidates[3]!.task.id]);
});

test("C6: known-due catch-up reads fit the server's 20-minute source and 25-minute repair caps", () => {
  const [, tasks] = busiestLane();
  const task = tasks[0]!;
  const candidates = [candidateFor(task, hotClock(T0 - 44 * MIN))];
  const sourceDeadlineMs = T0 + ROUTINE_PASS_BUDGET_MS * 2 / 3;
  const repairDeadlineMs = T0 + ROUTINE_PASS_BUDGET_MS * 5 / 6;
  const base = {
    nowMs: T0 + MIN,
    candidates,
    clockReads: candidates.map(({ task, clock }) => ({ task, ok: true as const, clock })),
    statedEnds: new Map(),
    laneLastEndedMs: new Map<string, number>(),
    busyLanes: new Set<string>(),
    slots: HOT_READ_CATCH_UP_CONCURRENCY,
    limitMs: sourceDeadlineMs,
  };
  assert.deepEqual(hotReadCatchUpAdmission(base).start.map(({ id }) => id), [task.id]);
  const latestStartMs = repairDeadlineMs - hotReadCatchUpReadWorstCaseMs();
  assert.deepEqual(hotReadCatchUpAdmission({ ...base, nowMs: latestStartMs, limitMs: repairDeadlineMs }).start.map(({ id }) => id), [task.id]);
  assert.deepEqual(hotReadCatchUpAdmission({ ...base, nowMs: latestStartMs + 1, limitMs: repairDeadlineMs }).pastLimit.map(({ id }) => id), [task.id]);
});

test("C6: catch-up reads reserve repair time without restoring the retired pilot timeout", () => {
  const domains = routineReaderRepairDomains();
  const bound = routineFrontierPassBound();
  const outer = routineRunnerOuterTimeoutMs(bound.commandCount, bound.largestFailureDomainSize, {
    neonRequestDeadlineMs: STANDING_NEON_REQUEST_DEADLINE_MS,
    settlementRequestsPerCommand: ROUTINE_DURABLE_RECEIPT_MAX_REQUESTS,
    clockTaskCount: ROUTINE_SOURCE_TASKS.length,
    clockConcurrency: ROUTINE_CLOCK_READ_CONCURRENCY,
    clockRequestsPerTask: ROUTINE_CLOCK_MAX_REQUESTS_PER_TASK,
    coordinationRequests: 4,
    readerSingleDomains: domains.filter(({ mode }) => mode === "SINGLE").length,
    readerSingleTimeoutMs: ROUTINE_READER_SINGLE_TIMEOUT_MS,
    readerMeetingDomains: domains.filter(({ mode }) => mode === "MEETING_AGGREGATE").length,
    readerMeetingTimeoutMs: ROUTINE_READER_MEETING_TIMEOUT_MS,
    readerConcurrency: ROUTINE_READER_CHILD_CONCURRENCY,
  });
  const work = T0 + outer - ROUTINE_RUNNER_COORDINATION_AND_PERSISTENCE_BUDGET_MS - ROUTINE_RUNNER_OUTER_GRACE_MS;
  assert.equal(routinePassWorkDeadlineMs(T0, domains), work);
  // The Reader repair's worst case: its singles four at a time, then the meeting aggregate.
  const readerWorst = Math.ceil(domains.filter(({ mode }) => mode === "SINGLE").length / ROUTINE_READER_CHILD_CONCURRENCY) * ROUTINE_READER_SINGLE_TIMEOUT_MS +
    domains.filter(({ mode }) => mode === "MEETING_AGGREGATE").length * ROUTINE_READER_MEETING_TIMEOUT_MS;
  assert.equal(routinePassSourceCatchUpDeadlineMs(T0, domains), work - readerWorst);
  // The parent launcher imposes no whole-pass timeout.
  const pilot = readFileSync("scripts/pilot-runner.mts", "utf8");
  assert.match(pilot, /await runRuntimeChildren\(/);
  const launcher = readFileSync("scripts/pilot-runtime-child.mts", "utf8");
  assert.doesNotMatch(launcher, /\btimeout\s*:/);
  // A read has its own enforced wall limit; the generic idle timeout cannot block admission.
  const settlementMs = ROUTINE_DURABLE_RECEIPT_MAX_REQUESTS * STANDING_NEON_REQUEST_DEADLINE_MS;
  assert.equal(HOT_READ_CATCH_UP_READ_BUDGET_MS, 5 * MIN);
  assert.equal(hotReadCatchUpReadWorstCaseMs(), HOT_READ_CATCH_UP_READ_BUDGET_MS + settlementMs);
  assert.equal(HOT_READ_CATCH_UP_CONCURRENCY, ROUTINE_CHILD_CONCURRENCY / 2, "four pass children plus two reads at the peak");
});

test("C6: the repairs a catch-up read could race run first", () => {
  const domains = routineReaderRepairDomains();
  const hot = new Set(ROUTINE_SOURCE_TASKS.filter((task) => task.contract.schedule?.kind === "SITTING_WINDOW").map(({ id }) => id));
  const racing = domains.filter((domain) => repairDomainRacesHotReads(domain, hot)).map(({ id }) => id);
  assert.ok(racing.some(id => /^reader-readback:meetings-aggregate:[A-Z]{2}:/.test(id)));
  assert.ok(domains.some(domain => racing.includes(domain.id) && domain.contracts.some(contract => contract.id === "pima-legistar-outcomes")), "the outcome routine follows the Board's sittings");
  assert.ok(!racing.includes("reader-readback:fec-funding"));
  assert.ok(racing.length < domains.length, "unrelated state repairs never delay catch-up");

  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  assert.match(runner, /const readerLaunch = \[\s*\.\.\.readerDomains\.filter\(\(domain\) => repairDomainRacesHotReads\(domain, hotReadTaskIds\)\),\s*\.\.\.readerDomains\.filter\(\(domain\) => !repairDomainRacesHotReads/);
  assert.match(runner, /const active = planned\.domains;\s*return runBoundedChildPass\(\s*active\.map/);
  assert.match(runner, /return \{ repair: readerPass, unblocked: Promise\.resolve\(\) \};/);
  assert.match(runner, /repairingContractIds\.add\(contract.id\)/);
  assert.match(runner, /!launchedTaskIds\.has\(id\) && !repairingContractIds\.has\(id\)/);
  assert.match(runner, /for \(const contract of domain.contracts\) repairingContractIds\.delete\(contract.id\)/);
  assert.match(runner, /await runRoutinePassWithHotReadCatchUp\(\{\s*source: sourcePass,\s*startRepair: runs =>/);
  assert.match(runner, /onSettled: async \(result\) => settlePendingRun\(run, result\)/, "catch-up reads settle exactly as the pass's own");
  assert.match(runner, /\.\.\.\[\.\.\.unsettledSourceRuns\]\.map\(\(id\) => pendingByTaskId\.get\(id\)!\.task\.acquisitionFailureDomain\)/, "never beside a read of the same lane");
  assert.match(runner, /limitMs: hotReadLimitsMs\[phase\]/);
  assert.match(runner, /setTimeout\(resolve, Math\.max\(0, atMs - Date\.now\(\)\)\)\.unref\(\)/);
  assert.match(runner, /const hotReadTasks = FORCE \|\| PUBLISH_NOW\s*\? \[\]/, "a forced pass keeps its exact selection");
});

test("C6: the parent's account of a killed pass counts the reads admitted during repair", () => {
  const evidence = routineSupervisorOuterEvidence({
    output: [
      "RCD_PASS launching 3 isolated command(s) through a bounded pool; concurrency=4",
      "RCD_PASS catch-up at 2026-10-12T15:05:00.000Z: launching 1 due meeting read(s) while the pass is held open; concurrency=2",
      "RCD_PASS catch-up at 2026-10-12T15:06:30.000Z: launching 1 due meeting read(s) while the pass is held open; concurrency=2",
      "RCD_PASS catch-up at 2026-10-12T15:10:00.000Z: launching 1 due meeting read(s) while the pass is held open; concurrency=2",
    ].join("\n"),
    termination: "TIMED_OUT",
    exitStatus: null,
  });
  assert.equal(evidence.attemptedTasks, 6);
  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  assert.match(runner, /`RCD_PASS catch-up at \$\{new Date\(atMs\)\.toISOString\(\)\}: launching 1 due meeting read\(s\) while the pass is held open; `/);
});
