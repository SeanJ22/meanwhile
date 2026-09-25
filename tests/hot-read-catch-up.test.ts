import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  HOT_READ_CATCH_UP_CONCURRENCY,
  hotReadRoundAdmission,
  hotReadRoundWorstCaseMs,
  repairDomainRacesHotReads,
  routinePassWorkDeadlineMs,
  runHotReadCatchUp,
  type HotReadCandidate,
} from "../lib/civic-data/hot-read-catch-up.ts";
import {
  ROUTINE_CLOCK_MAX_REQUESTS_PER_TASK,
  ROUTINE_CLOCK_READ_CONCURRENCY,
  ROUTINE_DATA_ADMISSION_MS,
  ROUTINE_SOURCE_TASKS,
  routineFrontierPassBound,
  routineTaskDeadlineMs,
  routineTaskDue,
  type RoutineSourceTask,
  type RoutineTaskClock,
} from "../lib/civic-data/runner.ts";
import {
  ROUTINE_CHILD_CONCURRENCY,
  ROUTINE_CHILD_TIMEOUT_MS,
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

/** A body with a sitting in two days, last read 34 minutes before the pass: hot, owed by T0 + 26 min. */
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

test("C6: a due hourly read is admitted within its deadline while a long Reader repair is in flight", async () => {
  const task = meetingTasks[0]!;
  const clock = hotClock(T0 - 34 * MIN);
  const clockReads = [{ task, ok: true as const, clock }];
  // The pass's own admission: not yet due at T0, due a minute later, owed by T0 + 26 min.
  assert.equal(routineTaskDue(task, clock, T0, true), false);
  assert.equal(routineTaskDue(task, clock, T0 + MIN, true), true);
  const deadlineMs = routineTaskDeadlineMs(task, clock, true)!;
  assert.equal(deadlineMs, T0 + 26 * MIN);

  const fake = new FakeClock(T0 + 90_000);
  const repairEndsMs = T0 + 28 * MIN;
  const repair = fake.sleepUntil(repairEndsMs).then(() => "repair settled" as const);
  const gate = fake.sleepUntil(T0 + 2 * MIN);
  const launched = new Set<string>();
  const laneLastEndedMs = new Map<string, number>();
  const admissions: { readonly id: string; readonly atMs: number }[] = [];
  const run = runHotReadCatchUp({
    repair,
    unblocked: gate,
    admittedAtMs: T0,
    intervalMs: ROUTINE_DATA_ADMISSION_MS,
    now: fake.now,
    sleepUntil: fake.sleepUntil,
    round: async (atMs) => {
      const admitted = hotReadRoundAdmission({
        nowMs: atMs,
        candidates: [task].filter(({ id }) => !launched.has(id)).map((row) => candidateFor(row, clock)),
        clockReads,
        statedEnds: new Map(),
        laneLastEndedMs,
        rotationSeed: 0,
      });
      for (const row of admitted) {
        launched.add(row.id);
        admissions.push({ id: row.id, atMs });
      }
      if (admitted.length > 0) {
        await fake.sleepUntil(atMs + MIN); // the read itself
        for (const row of admitted) laneLastEndedMs.set(row.acquisitionFailureDomain, fake.now());
      }
      return admitted.map(({ id }) => id);
    },
  });
  await fake.runUntil(run);
  const result = await run;

  assert.equal(result.repair, "repair settled", "the pass still waits for, and reports, its whole repair");
  assert.deepEqual(admissions, [{ id: task.id, atMs: T0 + 5 * MIN }], "admitted on the lane's next five-minute admission");
  assert.ok(admissions[0]!.atMs <= deadlineMs, "admitted before its deadline");
  assert.ok(result.rounds.every(({ atMs }) => atMs < repairEndsMs), "no round after the repair settled");
  assert.deepEqual(result.rounds.map(({ atMs }) => (atMs - T0) / MIN), [5, 10, 15, 20, 25]);
  // Before this change the read waited for the whole repair: the next pass
  // could start no earlier than the repair's end, after the deadline.
  assert.ok(repairEndsMs > deadlineMs, "the same repair held the read past its deadline before");
});

test("C6: a round due while a racing repair runs starts as soon as that repair settles", async () => {
  const fake = new FakeClock(T0 + 30_000);
  const repair = fake.sleepUntil(T0 + 20 * MIN).then(() => 1);
  const gate = fake.sleepUntil(T0 + 7 * MIN);
  const run = runHotReadCatchUp({
    repair,
    unblocked: gate,
    admittedAtMs: T0,
    intervalMs: ROUTINE_DATA_ADMISSION_MS,
    now: fake.now,
    sleepUntil: fake.sleepUntil,
    round: async () => [],
  });
  await fake.runUntil(run);
  assert.deepEqual((await run).rounds.map(({ atMs }) => (atMs - T0) / MIN), [7, 10, 15]);
});

test("C6: an ordinary short repair runs no round, and a failed repair still fails the phase", async () => {
  const fake = new FakeClock(T0 + 30_000);
  let rounds = 0;
  const short = runHotReadCatchUp({
    repair: fake.sleepUntil(T0 + 90_000).then(() => "done"),
    unblocked: Promise.resolve(),
    admittedAtMs: T0,
    intervalMs: ROUTINE_DATA_ADMISSION_MS,
    now: fake.now,
    sleepUntil: fake.sleepUntil,
    round: async () => { rounds += 1; return []; },
  });
  await fake.runUntil(short);
  assert.deepEqual(await short, { repair: "done", rounds: [] });
  assert.equal(rounds, 0);

  const failing = runHotReadCatchUp({
    repair: fake.sleepUntil(T0 + 6 * MIN).then(() => { throw new Error("READER_PASS_FAILED"); }),
    unblocked: Promise.resolve(),
    admittedAtMs: T0,
    intervalMs: ROUTINE_DATA_ADMISSION_MS,
    now: fake.now,
    sleepUntil: fake.sleepUntil,
    round: async () => [],
  });
  await fake.runUntil(failing);
  await assert.rejects(failing, /READER_PASS_FAILED/);

  // A round that throws stops the rounds, never the repair or its result.
  let calls = 0;
  const defective = runHotReadCatchUp({
    repair: fake.sleepUntil(fake.now() + 20 * MIN).then(() => "repaired"),
    unblocked: Promise.resolve(),
    admittedAtMs: fake.now(),
    intervalMs: ROUTINE_DATA_ADMISSION_MS,
    now: fake.now,
    sleepUntil: fake.sleepUntil,
    round: async () => { calls += 1; throw new Error("ROUTINE_FAILURE_DOMAIN_INVALID:x"); },
  });
  await fake.runUntil(defective);
  const result = await defective;
  assert.equal(result.repair, "repaired");
  assert.equal(calls, 1);
  assert.equal(result.rounds.length, 1);
  assert.match(result.rounds[0]!.error ?? "", /ROUTINE_FAILURE_DOMAIN_INVALID/);
  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  assert.match(runner, /code: "HOT_READ_CATCH_UP_FAILED"/, "the runner records a failed round as a supervisor failure");
});

test("C6: a round admits only due sitting-window reads, earliest deadline first, three a lane, after the same-host gap", () => {
  const byLane = new Map<string, RoutineSourceTask[]>();
  for (const task of meetingTasks) byLane.set(task.acquisitionFailureDomain, [...(byLane.get(task.acquisitionFailureDomain) ?? []), task]);
  const [lane, busy] = [...byLane.entries()].sort((left, right) => right[1].length - left[1].length)[0]!;
  assert.ok(busy.length >= 4, `the busiest lane (${lane}) has at least four bodies`);
  const now = T0 + 10 * MIN;
  // Four due hot bodies on one lane, last read 40..43 minutes ago: owed at +20..+17 minutes.
  const candidates = busy.slice(0, 4).map((task, index) => candidateFor(task, hotClock(now - (40 + index) * MIN)));
  const clockReads = candidates.map(({ task, clock }) => ({ task, ok: true as const, clock }));
  const nonMeeting = ROUTINE_SOURCE_TASKS.find((task) => task.contract.schedule === undefined)!;
  const admitted = hotReadRoundAdmission({
    nowMs: now,
    candidates: [...candidates, { task: nonMeeting, clock: undefined, lastConsideredAt: null }],
    clockReads,
    statedEnds: new Map(),
    laneLastEndedMs: new Map(),
    rotationSeed: 0,
  });
  assert.deepEqual(
    admitted.map(({ id }) => id).sort(),
    [candidates[3]!, candidates[2]!, candidates[1]!].map(({ task }) => task.id).sort(),
    "the three earliest deadlines on the lane; never another data family",
  );
  // A lane read less than the same-host gap ago waits for the next round.
  assert.deepEqual(hotReadRoundAdmission({
    nowMs: now,
    candidates,
    clockReads,
    statedEnds: new Map(),
    laneLastEndedMs: new Map([[lane, now - ROUTINE_SAME_DOMAIN_CHILD_GAP_MS + 1]]),
    rotationSeed: 0,
  }), []);
  // Not due yet (read 20 minutes ago): nothing is admitted early.
  const fresh = busy.slice(0, 1).map((task) => candidateFor(task, hotClock(now - 20 * MIN)));
  assert.deepEqual(hotReadRoundAdmission({
    nowMs: now,
    candidates: fresh,
    clockReads: fresh.map(({ task, clock }) => ({ task, ok: true as const, clock })),
    statedEnds: new Map(),
    laneLastEndedMs: new Map(),
    rotationSeed: 0,
  }), []);
});

test("C6: no round may outlast the pilot's own outer limit on the pass", () => {
  const domains = routineReaderRepairDomains();
  const bound = routineFrontierPassBound();
  const outer = routineRunnerOuterTimeoutMs(bound.commandCount, bound.largestFailureDomainSize, {
    neonRequestDeadlineMs: STANDING_NEON_REQUEST_DEADLINE_MS,
    settlementRequestsPerCommand: ROUTINE_DURABLE_RECEIPT_MAX_REQUESTS,
    clockTaskCount: ROUTINE_SOURCE_TASKS.length,
    clockConcurrency: ROUTINE_CLOCK_READ_CONCURRENCY,
    clockRequestsPerTask: ROUTINE_CLOCK_MAX_REQUESTS_PER_TASK,
    coordinationRequests: 3,
    readerSingleDomains: domains.filter(({ mode }) => mode === "SINGLE").length,
    readerSingleTimeoutMs: ROUTINE_READER_SINGLE_TIMEOUT_MS,
    readerMeetingDomains: domains.filter(({ mode }) => mode === "MEETING_AGGREGATE").length,
    readerMeetingTimeoutMs: ROUTINE_READER_MEETING_TIMEOUT_MS,
    readerConcurrency: ROUTINE_READER_CHILD_CONCURRENCY,
  });
  assert.equal(
    routinePassWorkDeadlineMs(T0, domains),
    T0 + outer - ROUTINE_RUNNER_COORDINATION_AND_PERSISTENCE_BUDGET_MS - ROUTINE_RUNNER_OUTER_GRACE_MS,
  );
  // The pilot sizes its limit from exactly these inputs.
  const pilot = readFileSync("scripts/pilot-runner.mts", "utf8");
  assert.match(pilot, /ROUTINE_DATA_TIMEOUT_MS = routineRunnerOuterTimeoutMs\(\s*ROUTINE_PASS_BOUND\.commandCount,\s*ROUTINE_PASS_BOUND\.largestFailureDomainSize,\s*\{\s*neonRequestDeadlineMs: STANDING_NEON_REQUEST_DEADLINE_MS,\s*settlementRequestsPerCommand: ROUTINE_DURABLE_RECEIPT_MAX_REQUESTS,\s*clockTaskCount: ROUTINE_SOURCE_TASKS\.length,\s*clockConcurrency: ROUTINE_CLOCK_READ_CONCURRENCY,\s*clockRequestsPerTask: ROUTINE_CLOCK_MAX_REQUESTS_PER_TASK,[\s\S]*?coordinationRequests: 3,\s*readerSingleDomains: ROUTINE_READER_DOMAINS\.filter\(\(\{ mode \}\) => mode === "SINGLE"\)\.length,\s*readerSingleTimeoutMs: ROUTINE_READER_SINGLE_TIMEOUT_MS,\s*readerMeetingDomains: ROUTINE_READER_DOMAINS\.filter\(\(\{ mode \}\) => mode === "MEETING_AGGREGATE"\)\.length,\s*readerMeetingTimeoutMs: ROUTINE_READER_MEETING_TIMEOUT_MS,\s*readerConcurrency: ROUTINE_READER_CHILD_CONCURRENCY,/);
  // One lane's three reads, one after another with the gaps, settle within the worst case.
  const three = meetingTasks.filter((task) => task.acquisitionFailureDomain === meetingTasks[0]!.acquisitionFailureDomain).slice(0, 3);
  const settlementMs = ROUTINE_DURABLE_RECEIPT_MAX_REQUESTS * STANDING_NEON_REQUEST_DEADLINE_MS;
  assert.ok(hotReadRoundWorstCaseMs(three) >= three.length * (ROUTINE_CHILD_TIMEOUT_MS + settlementMs) + (three.length - 1) * ROUTINE_SAME_DOMAIN_CHILD_GAP_MS);
  assert.equal(hotReadRoundWorstCaseMs([]), 0);
  assert.equal(HOT_READ_CATCH_UP_CONCURRENCY, ROUTINE_CHILD_CONCURRENCY / 2, "four repair children plus two reads at the peak");
});

test("C6: the repairs a catch-up read could race run first", () => {
  const domains = routineReaderRepairDomains();
  const hot = new Set(ROUTINE_SOURCE_TASKS.filter((task) => task.contract.schedule?.kind === "SITTING_WINDOW").map(({ id }) => id));
  const racing = domains.filter((domain) => repairDomainRacesHotReads(domain, hot)).map(({ id }) => id);
  assert.ok(racing.includes("reader-readback:meetings-aggregate"));
  assert.ok(racing.includes("reader-readback:pima-legistar-outcomes"), "the outcome routine follows the Board's sittings");
  assert.ok(!racing.includes("reader-readback:fec-funding"));
  assert.ok(racing.length < domains.length / 4, "most repairs never delay a round");

  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  assert.match(runner, /const readerLaunch = \[\s*\.\.\.readerDomains\.filter\(\(domain\) => repairDomainRacesHotReads\(domain, hotReadTaskIds\)\),\s*\.\.\.readerDomains\.filter\(\(domain\) => !repairDomainRacesHotReads/);
  assert.match(runner, /const readerPass = runBoundedChildPass\(\s*readerLaunch\.map/);
  assert.match(runner, /await runHotReadCatchUp\(\{\s*repair: readerPass,\s*unblocked: hotReadRoundsOpen,\s*admittedAtMs: admissionNowMs,\s*intervalMs: ROUTINE_DATA_ADMISSION_MS,/);
  assert.match(runner, /onSettled: async \(run, index\) => settlePendingRun\(runs\[index\]!, run\)/, "catch-up reads settle exactly as the pass's own");
  assert.match(runner, /if \(atMs \+ hotReadRoundWorstCaseMs\(admittedTasks\) > passWorkDeadlineMs\)/);
  assert.match(runner, /setTimeout\(resolve, Math\.max\(0, atMs - Date\.now\(\)\)\)\.unref\(\)/);
  assert.match(runner, /const hotReadTasks = FORCE\s*\? \[\]/, "a forced pass keeps its exact selection");
});

test("C6: the parent's account of a killed pass counts the reads admitted during repair", () => {
  const evidence = routineSupervisorOuterEvidence({
    output: [
      "RCD_PASS launching 3 isolated command(s) through a bounded pool; concurrency=4",
      "RCD_PASS catch-up at 2026-10-12T15:05:00.000Z: launching 2 due meeting read(s) while Reader repair runs; concurrency=2",
      "RCD_PASS catch-up at 2026-10-12T15:10:00.000Z: launching 1 due meeting read(s) while Reader repair runs; concurrency=2",
    ].join("\n"),
    termination: "TIMED_OUT",
    exitStatus: null,
  });
  assert.equal(evidence.attemptedTasks, 6);
});
