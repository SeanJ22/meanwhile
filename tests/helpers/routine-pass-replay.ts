import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ROUTINE_CHILD_CONCURRENCY,
  ROUTINE_SAME_DOMAIN_CHILD_GAP_MS,
  runBoundedChildPass,
  type BoundedChildCommand,
  type BoundedChildResult,
} from "../../lib/civic-data/bounded-child-pass.ts";
import {
  HOT_READ_CATCH_UP_CONCURRENCY,
  HOT_READ_CATCH_UP_READ_BUDGET_MS,
  hotReadCatchUpAdmission,
  runHotReadCatchUp,
} from "../../lib/civic-data/hot-read-catch-up.ts";
import {
  ROUTINE_DATA_ADMISSION_MS,
  ROUTINE_PASS_BUDGET_MS,
  type RoutineSourceTask,
  type RoutineTaskClock,
} from "../../lib/civic-data/runner.ts";

/*
 * One routine pass under a controlled clock, run with production's own code as
 * scripts/routine-civic-data-runner.mts composes it. `Date.now` and `setTimeout`
 * read the controlled clock while a replay runs, so nothing waits in real time.
 */

const MIN = 60_000;

/** A pass production ran on 2026-09-24 (tests/fixtures/routine-pass-durations-2026-09-24.json). */
export interface RecordedPass {
  readonly durationMs: number;
  /**
   * From the pass's start to its Reader repair's start: its source reads, every
   * family's. `undefined` where the pass recorded no Reader receipt to date it
   * (9 of 196).
   */
  readonly sourceMs: number | undefined;
}

export function recordedPasses(): readonly RecordedPass[] {
  const fixture = JSON.parse(readFileSync("tests/fixtures/routine-pass-durations-2026-09-24.json", "utf8")) as {
    readonly durationSeconds: readonly number[];
    readonly sourcePhaseSeconds: readonly (number | null)[];
  };
  assert.equal(fixture.durationSeconds.length, 196);
  assert.equal(fixture.sourcePhaseSeconds.length, 196);
  return fixture.durationSeconds.map((seconds, index) => {
    const source = fixture.sourcePhaseSeconds[index];
    assert.ok(source === null || (source! >= 0 && source! <= seconds), `pass ${index}: its source phase lies inside it`);
    return { durationMs: seconds * 1_000, sourceMs: source === null ? undefined : source! * 1_000 };
  });
}

/** A controlled clock: time moves only to the next timer, once every ready continuation has run. */
export class ControlledClock {
  nowMs: number;
  private readonly timers: { readonly at: number; readonly seq: number; readonly fire: () => void }[] = [];
  private seq = 0;

  constructor(startMs: number) {
    this.nowMs = startMs;
  }

  readonly now = (): number => this.nowMs;

  readonly sleepUntil = (atMs: number): Promise<void> =>
    new Promise<void>((resolve) => { this.schedule(atMs, resolve); });

  private schedule(atMs: number, fire: () => void): { readonly at: number; readonly seq: number; readonly fire: () => void } {
    const timer = { at: Math.max(atMs, this.nowMs), seq: this.seq++, fire };
    this.timers.push(timer);
    return timer;
  }

  private next(): { readonly at: number; readonly fire: () => void } | undefined {
    let best = -1;
    for (let index = 0; index < this.timers.length; index += 1) {
      const timer = this.timers[index]!;
      const current = this.timers[best];
      if (current === undefined || timer.at < current.at || (timer.at === current.at && timer.seq < current.seq)) best = index;
    }
    return best < 0 ? undefined : this.timers.splice(best, 1)[0];
  }

  /** Run `work` to completion with `Date.now`, `setTimeout` and `clearTimeout` on this clock. */
  async run<T>(work: () => Promise<T>): Promise<T> {
    const realNow = Date.now;
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    const scheduled = new WeakMap<object, { readonly at: number; readonly seq: number; readonly fire: () => void }>();
    Date.now = () => this.nowMs;
    globalThis.setTimeout = ((callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
      const timer = this.schedule(this.nowMs + Math.max(0, ms ?? 0), () => callback(...args));
      const handle = { ref: () => handle, unref: () => handle, hasRef: () => false, refresh: () => handle };
      scheduled.set(handle, timer);
      return handle;
    }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = ((handle?: object) => {
      const timer = handle ? scheduled.get(handle) : undefined;
      if (!timer) return realClearTimeout(handle as Parameters<typeof clearTimeout>[0]);
      const at = this.timers.indexOf(timer);
      if (at >= 0) this.timers.splice(at, 1);
    }) as typeof clearTimeout;
    try {
      let settled = false;
      const promise = work();
      promise.then(() => { settled = true; }, () => { settled = true; });
      for (;;) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (settled) break;
        const timer = this.next();
        if (timer === undefined) throw new Error("CONTROLLED_CLOCK_STALLED: the work waits on nothing the clock can move");
        this.nowMs = Math.max(this.nowMs, timer.at);
        timer.fire();
      }
      return await promise;
    } finally {
      Date.now = realNow;
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    }
  }
}

/** A read's result as the pool reports it; the replay decides the read's outcome itself in `settled`. */
function exited(command: BoundedChildCommand): BoundedChildResult {
  return { id: command.id, status: 0, signal: null, stdout: "", stderr: "", termination: "EXITED", errorMessage: null };
}

export interface ReplayPassInput {
  readonly clock: ControlledClock;
  /** The pass's frozen admission instant. */
  readonly admittedAtMs: number;
  /**
   * The rest of the pass: the other families' source reads and the Reader
   * repair, from a recorded pass, or `undefined` for a pass with nothing but
   * these source reads.
   */
  readonly recorded: RecordedPass | undefined;
  /** The reads the pass admitted, in launch order. */
  readonly launched: readonly RoutineSourceTask[];
  /** Every sitting-window task, with its clock as this pass read it at admission. */
  readonly windowed: readonly RoutineSourceTask[];
  readonly passClocks: ReadonlyMap<string, RoutineTaskClock | undefined>;
  /** How long one read takes. */
  readonly readMs: (task: RoutineSourceTask) => number;
  /** A read ended at `endedAtMs`: the replay records its outcome. */
  readonly settled: (task: RoutineSourceTask, endedAtMs: number) => void;
}

export interface ReplayPassResult {
  readonly endedAtMs: number;
  readonly sourceEndedAtMs: number;
  readonly catchUpReads: number;
}

/** The source reads start this long after admission (clock reads and coordination come first). */
export const REPLAY_READS_START_MS = 20_000;
const OTHER_FAMILIES = "replay:other-families";

/** Run one pass under the controlled clock (call inside `clock.run`). */
export async function replayPass(input: ReplayPassInput): Promise<ReplayPassResult> {
  const { clock, admittedAtMs, recorded } = input;
  const byId = new Map(input.windowed.map((task) => [task.id, task]));
  for (const task of input.launched) byId.set(task.id, task);
  // As the runner keeps them, one process a pass: every task read this pass,
  // the pass's own reads not yet settled, and when each lane's last read ended.
  const launchedIds = new Set(input.launched.map(({ id }) => id));
  const unsettledSource = new Set(input.launched.map(({ id }) => id));
  const laneLastEndedMs = new Map<string, number>();
  // What the recorded pass spent beyond these reads: its source phase ran the
  // other families' reads beside them, one child of the four. The removed
  // inventory readback contributes no time to the new pass.
  const sourceMs = recorded?.sourceMs ?? REPLAY_READS_START_MS;
  const otherFamiliesMs = Math.max(0, sourceMs - REPLAY_READS_START_MS);
  const command = (task: RoutineSourceTask): BoundedChildCommand => ({
    id: task.id, failureDomain: task.acquisitionFailureDomain, executable: "replay", args: [],
  });
  const launch = async (child: BoundedChildCommand, bounds: { readonly deadlineMs?: number }): Promise<BoundedChildResult> => {
    const task = byId.get(child.id);
    const endedAtMs = clock.now() + (task === undefined ? otherFamiliesMs : input.readMs(task));
    assert.ok(endedAtMs <= (bounds.deadlineMs ?? Infinity), "the recorded source/read fits its enforced wall budget");
    await clock.sleepUntil(endedAtMs);
    return exited(child);
  };
  const settle = (task: RoutineSourceTask) => {
    unsettledSource.delete(task.id);
    laneLastEndedMs.set(task.acquisitionFailureDomain, clock.now());
    input.settled(task, clock.now());
  };
  const options = { cwd: "", env: process.env, sameDomainGapMs: ROUTINE_SAME_DOMAIN_CHILD_GAP_MS };
  const sourceDeadlineMs = admittedAtMs + ROUTINE_PASS_BUDGET_MS - Math.floor(ROUTINE_PASS_BUDGET_MS / 3);

  await clock.sleepUntil(admittedAtMs + REPLAY_READS_START_MS);
  const sourceTasks: (RoutineSourceTask | undefined)[] = [...(otherFamiliesMs > 0 ? [undefined] : []), ...input.launched];
  const source = runBoundedChildPass([
    ...(otherFamiliesMs > 0 ? [{ id: OTHER_FAMILIES, failureDomain: OTHER_FAMILIES, executable: "replay", args: [] }] : []),
    ...input.launched.map(command),
  ], {
    ...options,
    deadlineMs: sourceDeadlineMs,
    concurrency: ROUTINE_CHILD_CONCURRENCY,
    onSettled: (_result, index) => {
      const task = sourceTasks[index];
      if (task !== undefined) settle(task);
    },
  }, launch);

  const clockReads = input.windowed.map((task) => ({ task, ok: true as const, clock: input.passClocks.get(task.id) }));
  const limitMs = sourceDeadlineMs;
  const pass = await runHotReadCatchUp({
    work: source,
    unblocked: Promise.resolve(),
    now: clock.now,
    sleepUntil: clock.sleepUntil,
    concurrency: HOT_READ_CATCH_UP_CONCURRENCY,
    admit: (nowMs, slots, runningLanes) => hotReadCatchUpAdmission({
      nowMs,
      candidates: input.windowed
        .filter(({ id }) => !launchedIds.has(id))
        .map((task) => ({ task, clock: input.passClocks.get(task.id), lastConsideredAt: input.passClocks.get(task.id)?.lastAttemptedAt ?? null })),
      clockReads,
      statedEnds: new Map(),
      laneLastEndedMs,
      busyLanes: new Set([...runningLanes, ...[...unsettledSource].map((id) => byId.get(id)!.acquisitionFailureDomain)]),
      slots,
      limitMs,
    }),
    read: async (task, atMs) => {
      launchedIds.add(task.id);
      const readDeadlineMs = Math.min(limitMs, atMs + HOT_READ_CATCH_UP_READ_BUDGET_MS);
      await runBoundedChildPass([command(task)], { ...options, deadlineMs: readDeadlineMs, concurrency: 1, onSettled: () => settle(task) }, launch);
    },
  });
  assert.equal(pass.error, undefined);
  return { endedAtMs: clock.now(), sourceEndedAtMs: clock.now(), catchUpReads: pass.reads.length };
}

/** The pilot admits the lane on the first one-minute tick at least five minutes after the last pass started and after it ended. */
export function nextAdmissionMs(admittedAtMs: number, endedAtMs: number, pauseMs = 0): number {
  return Math.ceil((Math.max(admittedAtMs + ROUTINE_DATA_ADMISSION_MS, endedAtMs) + pauseMs) / MIN) * MIN;
}
