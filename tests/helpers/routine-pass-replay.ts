import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { MEETING_STATE_CONCURRENCY, MEETING_STATE_TURN_MS, meetingTaskBucket } from "../../lib/civic-data/meeting-batch.ts";
import { routineScopeState } from "../../lib/civic-data/state-scope.ts";
import { DeadlineRuntimePool } from "../../lib/ops/independent-runtime-pass.ts";
import {
  ROUTINE_DATA_ADMISSION_MS,
  routineTaskDeadlineMs,
  sittingWindowSignals,
  type RoutineSourceTask,
  type RoutineTaskClock,
} from "../../lib/civic-data/runner.ts";


const MIN = 60_000;

/** A pass production ran on 2026-09-24 (tests/fixtures/routine-pass-durations-2026-09-24.json). */
export interface RecordedPass {
  readonly durationMs: number;
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

  private schedule(atMs: number, fire: () => void): void {
    this.timers.push({ at: Math.max(atMs, this.nowMs), seq: this.seq++, fire });
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

  /** Run `work` to completion with `Date.now` and `setTimeout` on this clock. */
  async run<T>(work: () => Promise<T>): Promise<T> {
    const realNow = Date.now;
    const realSetTimeout = globalThis.setTimeout;
    Date.now = () => this.nowMs;
    globalThis.setTimeout = ((callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
      this.schedule(this.nowMs + Math.max(0, ms ?? 0), () => callback(...args));
      const handle = { ref: () => handle, unref: () => handle, hasRef: () => false, refresh: () => handle };
      return handle;
    }) as unknown as typeof setTimeout;
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
    }
  }
}

export interface ReplayPassInput {
  readonly clock: ControlledClock;
  /** The pass's frozen admission instant. */
  readonly admittedAtMs: number;
  readonly recorded: RecordedPass | undefined;
  readonly cleanRepairMs: number;
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
  readonly independentReads: number;
  readonly otherDurationMs: number;
  readonly deferredReads: number;
}

export const REPLAY_READS_START_MS = 20_000;

export async function replayPass(input: ReplayPassInput): Promise<ReplayPassResult> {
  const { clock, admittedAtMs } = input;
  const buckets = new Map<string, RoutineSourceTask[]>();
  for (const task of input.launched) {
    const key = task.recordClass === "MEETING"
      ? `meeting:${routineScopeState(task.scope)}:${meetingTaskBucket(task)}`
      : `other:${routineScopeState(task.scope)}`;
    const members = buckets.get(key) ?? [];
    members.push(task);
    buckets.set(key, members);
  }
  const pool = new DeadlineRuntimePool(MEETING_STATE_CONCURRENCY);
  const otherPool = new DeadlineRuntimePool(2);
  const signals = sittingWindowSignals(input.windowed.map(task => ({ task, ok: true as const,
    clock: input.passClocks.get(task.id) })), admittedAtMs);
  let independentReads = 0;
  let deferredReads = 0;
  let sourceEndedAtMs = admittedAtMs;
  const otherDurationMs = input.recorded?.durationMs ?? 0;
  let otherFinished = otherDurationMs === 0;
  if (!otherFinished) void clock.sleepUntil(admittedAtMs + otherDurationMs).then(() => { otherFinished = true; });

  await Promise.all([...buckets.values()].map(async members => {
    let cursor = 0;
    while (cursor < members.length) {
      const first = members[cursor]!;
      const deadline = routineTaskDeadlineMs(first, input.passClocks.get(first.id), signals.get(first.id), clock.now()) ?? Number.POSITIVE_INFINITY;
      const meeting = first.recordClass === "MEETING";
      await (meeting ? pool : otherPool).run(deadline, async () => {
        await clock.sleepUntil(clock.now() + REPLAY_READS_START_MS);
        const until = meeting ? clock.now() + MEETING_STATE_TURN_MS : Number.POSITIVE_INFINITY;
        while (cursor < members.length && clock.now() < until) {
          const task = members[cursor++]!;
          await clock.sleepUntil(clock.now() + input.readMs(task));
          if (!otherFinished) independentReads++;
          input.settled(task, clock.now());
          sourceEndedAtMs = Math.max(sourceEndedAtMs, clock.now());
        }
        if (cursor < members.length) deferredReads += members.length - cursor;
        await clock.sleepUntil(clock.now() + input.cleanRepairMs);
      });
    }
  }));
  return { endedAtMs: clock.now(), sourceEndedAtMs, independentReads, otherDurationMs, deferredReads };
}

/** The replay allows a five-minute admission tick, including release handoffs. */
export function nextAdmissionMs(admittedAtMs: number, endedAtMs: number, pauseMs = 0): number {
  return Math.ceil((Math.max(admittedAtMs + ROUTINE_DATA_ADMISSION_MS, endedAtMs) + pauseMs) / MIN) * MIN;
}
