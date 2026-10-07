import assert from "node:assert/strict";
import test from "node:test";

import { normalizedHash } from "../lib/civic-data/candidate-builders.ts";
import { MEETING_SITTING_WINDOW } from "../lib/civic-data/contracts.ts";
import { meetingPartitionId } from "../lib/civic-data/meeting-partitions.ts";
import { ControlledClock, nextAdmissionMs, recordedPasses, replayPass } from "./helpers/routine-pass-replay.ts";
import {
  ROUTINE_DATA_ADMISSION_MS,
  ROUTINE_FAILURE_DOMAIN_FRONTIER_PER_PASS,
  ROUTINE_SOURCE_TASKS,
  SITTING_WINDOW_LANE_SLOTS_PER_PASS,
  routineFailureDomainFrontier,
  routinePassLaunchOrder,
  routineTaskDeadlineMs,
  routineTaskDue,
  sittingWindowSignals,
  type RoutineSourceTask,
  type RoutineTaskClock,
} from "../lib/civic-data/runner.ts";
import {
  routineDueRequestDeadlineMs,
  routineDueRequestFor,
  routineDueRequestState,
  type RoutineDueRequest,
} from "../lib/civic-data/routine-due-request.ts";
import { SITTING_CONCLUSION_BOUND_MS, sittingWindowHotByConclusion } from "../lib/civic-data/sitting-window-admission.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import {
  VALIDATION_CHECKS,
  sourceProjectionEvidence,
  type RoutineCandidate,
  type ValidationReceipt,
} from "../lib/civic-data/types.ts";

/*
 * The meeting refresh schedule under a controlled clock: a meeting source is checked twice daily, and within 60
 * minutes while its body has a meeting in the next seven days or one that concluded in the previous seven. Every
 * instant is a number the test moves; every decision is the runner's own functions over the real store's clock.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const PASS = ROUTINE_DATA_ADMISSION_MS;
const HASH = "a".repeat(64);
const iso = (ms: number) => new Date(ms).toISOString();

const PIMA_LEGISTAR = meetingPartitionId("legistar", "ocd-division/country:us/state:az/county:pima#governing");
const NEWBURY_ENERGY = meetingPartitionId("schedulepage", "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#energy-committee");

function registered(id: string): RoutineSourceTask {
  const found = ROUTINE_SOURCE_TASKS.find((task) => task.id === id);
  assert.ok(found, `${id} is registered`);
  return found;
}

/** A seeded generator, so every run replays the same timeline. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

type ReadOutcome = "CHANGED" | "UNCHANGED" | "FAILED" | "DIED_WITHOUT_RECEIPT";

function meetingCandidate(task: RoutineSourceTask, id: string, observedMs: number, starts: readonly string[], revision: number): RoutineCandidate {
  const readModel = { meetings: starts.map((startsAt, index) => ({ id: `sitting:${index}`, startsAt, revision })) };
  return {
    id,
    sourceId: task.sourceId,
    recordClass: "MEETING",
    scope: task.scope,
    sourceProjectionEvidence: sourceProjectionEvidence(task.sourceId, "MEETING", task.scope),
    retrieval: {
      succeeded: true,
      requestedUrl: "https://webapi.legistar.com/v1/pima/events",
      finalUrl: "https://webapi.legistar.com/v1/pima/events",
      httpStatus: 200,
      // The claimed retrieval precedes the store's first event, as a real acquisition's does.
      retrievedAt: iso(observedMs - 2_500),
      rawHash: HASH,
    },
    normalization: {
      succeeded: true,
      parserVersion: task.parserVersion,
      schemaVersion: "1",
      normalizedHash: normalizedHash(readModel),
      normalizedPayloadHash: normalizedHash(readModel),
      inputRecords: starts.length,
      outputRecords: starts.length,
      droppedRecords: 0,
      missingRequiredFields: [],
    },
    identities: [{ subjectId: "pima-board", jurisdiction: "US-AZ", identifiers: { body: "pima" }, matchBasis: "OFFICIAL_ID", ambiguous: false }],
    temporal: { version: "2026", expectedVersion: "2026", sourceThrough: iso(observedMs - 2_500), staleAtRetrieval: false },
    semantics: { factKind: "meeting schedule", violations: [] },
    horizon: { kind: "OPEN_FACT_SET", query: "sittings", returnedRecords: starts.length, declaredTotal: null, paginationComplete: true, claimsComplete: false },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [{ consumer: "meetings reader", passed: true, detail: "accepted" }],
    normalizedPayload: readModel,
    readModel,
  };
}

function receipt(value: RoutineCandidate, atMs: number, failed = false): ValidationReceipt {
  return {
    contractVersion: 2,
    decision: failed ? "FAIL" : "GOOD",
    candidateId: value.id,
    sourceId: value.sourceId,
    recordClass: value.recordClass,
    scope: value.scope,
    validatedAt: iso(atMs),
    checks: VALIDATION_CHECKS.map((check, index) => failed && index === 0
      ? { check, verdict: "FAIL" as const, code: `${check}_FAIL`, detail: "the publisher page did not parse" }
      : { check, verdict: "PASS" as const, code: `${check}_PASS`, detail: "persisted proof" }),
    excludedFacts: [],
  };
}

/** The store writes one read makes, exactly as a meeting partition child makes them. */
async function read(
  store: MemoryRoutineDataStore,
  task: RoutineSourceTask,
  outcome: ReadOutcome,
  atMs: number,
  starts: readonly string[],
  revision: number,
): Promise<void> {
  if (outcome === "DIED_WITHOUT_RECEIPT") return;
  const pointer = await store.readPromotion("MEETING", task.scope);
  if (outcome === "UNCHANGED" && pointer) {
    const pointed = (await store.readCandidate(pointer.versionId))!;
    const confirmed = await store.confirmUnchanged({
      sourceId: task.sourceId,
      recordClass: "MEETING",
      scope: task.scope,
      parserVersion: task.parserVersion,
      pointerVersionId: pointer.versionId,
      readModelHash: pointed.candidate.normalization.normalizedHash!,
      basis: "READ_MODEL_RECOMPUTED",
      retrieval: {
        requestedUrl: pointed.candidate.retrieval.requestedUrl,
        finalUrl: pointed.candidate.retrieval.finalUrl,
        httpStatus: 200,
        rawHash: HASH,
        retrievedAt: iso(atMs - 2_500),
      },
    }, iso(atMs));
    assert.equal(confirmed.kind, "CONFIRMED");
    return;
  }
  const value = meetingCandidate(task, `cv-${atMs}`, atMs, starts, revision);
  await store.create({
    candidate: value,
    state: "FETCHED",
    acquisitionSucceeded: true,
    receipt: null,
    promotedVersion: null,
    lastKnownGoodVersion: pointer?.versionId ?? null,
    failureCode: null,
    failureDetail: null,
  }, { candidateId: value.id, sequence: 1, state: "FETCHED", at: iso(atMs), detail: "persisted acquisition" });
  await store.transition(value.id, "NORMALIZED", iso(atMs + 200), "persisted normalization");
  if (outcome === "FAILED") {
    const failed = receipt(value, atMs + 400, true);
    const first = failed.checks[0]!;
    await store.transition(value.id, "SEMANTIC_INVALID", iso(atMs + 400), "refused", failed, { code: first.code, detail: first.detail });
    return;
  }
  const good = receipt(value, atMs + 400);
  await store.transition(value.id, "VALIDATED", iso(atMs + 400), "persisted validation", good);
  await store.promote(value.id, good, iso(atMs + 600));
}

test("controlled clock through the real store: a Pima-shaped body read across cold, an upcoming meeting, its conclusion and cooling, with changed versions, unchanged confirmations, failed reads and a dead child", async () => {
  const task = registered(PIMA_LEGISTAR);
  assert.equal(task.retryMs, HOUR, "a published meeting partition retries a failed read within the hour");
  const store = new MemoryRoutineDataStore();
  // August 2026, in the past for the store's clock-skew guard; every other instant is the test's own.
  const T0 = Date.parse("2026-08-03T07:00:00.000Z");
  const END = T0 + 19 * DAY;
  const meetingAt = T0 + 9 * DAY + 17 * HOUR; // enters the window at T0+2d17h
  const starts = [iso(T0 - 25 * DAY), iso(meetingAt), iso(T0 + 45 * DAY)];
  const hotAt = (ms: number) => sittingWindowHotByConclusion(MEETING_SITTING_WINDOW, [starts], ms);
  const enters = meetingAt - MEETING_SITTING_WINDOW.windowMs;
  const leaves = meetingAt + SITTING_CONCLUSION_BOUND_MS + MEETING_SITTING_WINDOW.windowMs;
  assert.equal(hotAt(enters - 1), false);
  assert.equal(hotAt(enters), true);
  assert.equal(hotAt(leaves), true, "still hourly seven days after the meeting concluded (the day bound)");
  assert.equal(hotAt(leaves + 1), false);

  // Every seventh read changes the version, every eleventh fails, every
  // thirteenth child dies before writing anything; the rest find nothing new.
  // The partition starts never published and its first read fails.
  const outcomeOf = (index: number): ReadOutcome =>
    index === 0 ? "FAILED"
      : index === 1 ? "CHANGED"
      : index % 13 === 5 ? "DIED_WITHOUT_RECEIPT"
      : index % 11 === 3 ? "FAILED"
      : index % 7 === 0 ? "CHANGED"
      : "UNCHANGED";
  const rand = seeded(20260925);
  const checks: { readonly at: number; readonly outcome: ReadOutcome }[] = [];
  const died: number[] = [];
  let reads = 0;
  let revision = 0;
  let at = T0;
  while (at < END) {
    const clock = await store.clock(task.sourceId, "MEETING", task.scope);
    const hot = sittingWindowSignals([{ task, ok: true, clock }], at).get(task.id);
    if (!routineTaskDue(task, clock, at, hot)) {
      at += PASS;
      continue;
    }
    const deadline = routineTaskDeadlineMs(task, clock, hot)!;
    const outcome = outcomeOf(reads);
    const readAt = at + 20_000 + Math.floor(rand() * 50_000);
    if (outcome === "CHANGED") revision += 1;
    await read(store, task, outcome, readAt, starts, revision);
    // A partition never read is owed at once (-Infinity). Every other read lands
    // by its deadline, or, when the body has just turned hourly, within the hour
    // of the instant it did (the deadline from a twice-daily success has passed).
    const lastCheckAt = checks.at(-1)?.at ?? Number.NEGATIVE_INFINITY;
    const owedBy = hot === true && lastCheckAt < enters && enters <= at ? Math.max(deadline, enters + HOUR) : deadline;
    if (Number.isFinite(deadline)) {
      assert.ok(readAt <= owedBy, `read ${reads} (${outcome}) at ${iso(readAt)} lands by ${iso(owedBy)}`);
    } else assert.equal(reads, 0);
    if (outcome === "DIED_WITHOUT_RECEIPT") died.push(readAt);
    else checks.push({ at: readAt, outcome });
    // The store's clock now holds this read: the next due is the normal rule from its own facts.
    const after = await store.clock(task.sourceId, "MEETING", task.scope);
    const nextHot = sittingWindowSignals([{ task, ok: true, clock: after }], readAt).get(task.id);
    const next = routineTaskDeadlineMs(task, after, nextHot)!;
    const published = after.sittingStarts !== undefined;
    if (outcome === "DIED_WITHOUT_RECEIPT") {
      assert.deepEqual(after, clock, "a child that died wrote nothing, so nothing moved");
    } else if (outcome === "FAILED") {
      assert.equal(after.lastAttemptedAt, iso(readAt));
      assert.equal(next, readAt + (published ? HOUR : 12 * HOUR), "a failed read owes its retry an hour later, or twice daily while never published");
    } else {
      assert.equal(after.lastSucceededObservedAt, iso(readAt), `${outcome}: the store-observed success is this read`);
      assert.equal(next, readAt + (nextHot === false ? 12 * HOUR : HOUR), `${outcome}: owed an hour later while hourly, twelve otherwise`);
    }
    reads += 1;
    at = Math.ceil((Math.max(at + PASS, readAt + 10_000)) / MIN) * MIN;
  }

  // Every outcome was exercised, and an unchanged re-check never moved the pointer.
  const count = (outcome: ReadOutcome) => checks.filter((check) => check.outcome === outcome).length;
  assert.ok(count("UNCHANGED") > 150 && count("CHANGED") > 20 && count("FAILED") > 15 && died.length > 10,
    `outcomes: ${count("UNCHANGED")} unchanged, ${count("CHANGED")} changed, ${count("FAILED")} failed, ${died.length} died`);
  assert.equal((await store.readPromotion("MEETING", task.scope))!.versionId.startsWith("cv-"), true);

  // Judge every gap by the refresh rule, minute by minute: while hourly, a
  // check is owed within 60 minutes of the later of the last check and the
  // minute the body turned hourly; every body is owed one within 12 hours.
  const late: string[] = [];
  const times = [...checks.map((check) => check.at), END];
  let longestHot = 0;
  let longest = 0;
  for (let index = 1; index < times.length; index += 1) {
    const from = times[index - 1]!;
    const to = times[index]!;
    longest = Math.max(longest, to - from);
    if (to - from > 12 * HOUR) late.push(`twice-daily gap ${((to - from) / HOUR).toFixed(2)} h ending ${iso(to)}`);
    let owedFrom = hotAt(from) === true ? from : undefined;
    for (let minute = from + MIN; minute < to; minute += MIN) {
      if (hotAt(minute) !== true) { owedFrom = undefined; continue; }
      owedFrom ??= minute;
      if (minute - owedFrom >= HOUR) { late.push(`hourly check late from ${iso(owedFrom)}`); break; }
    }
    if (hotAt(from) === true && hotAt(to) === true) longestHot = Math.max(longestHot, to - from);
  }
  assert.deepEqual(late, []);
  assert.ok(longestHot <= HOUR && longest <= 12 * HOUR);

  // The phases: never published (a failed first read waits twice daily, not an
  // hour), twice daily while cold, hourly from the instant the meeting came
  // within seven days until seven days after it concluded, then twice daily again.
  assert.ok(checks[1]!.at - checks[0]!.at >= 10 * HOUR, "R20: the never-published retry is twice daily");
  const firstHot = checks.find((check) => check.at >= enters)!;
  assert.ok(firstHot.at - enters <= 6 * MIN, `the body turned hourly at ${iso(enters)} and was read at ${iso(firstHot.at)}`);
  const coldBefore = checks.filter((check) => check.at > checks[1]!.at && check.at < enters);
  assert.ok(coldBefore.length >= 4 && coldBefore.length <= 6, `${coldBefore.length} twice-daily reads while cold, not hourly ones`);
  const coldAfter = checks.filter((check) => check.at > leaves);
  assert.ok(coldAfter.length >= 1 && coldAfter.length <= 3, `${coldAfter.length} reads in the ${((END - leaves) / HOUR).toFixed(1)} h after cooling`);
  for (let index = 1; index < coldAfter.length; index += 1) {
    const gap = coldAfter[index]!.at - coldAfter[index - 1]!.at;
    assert.ok(gap >= 10 * HOUR || coldAfter[index - 1]!.outcome === "FAILED", "cooled: twice daily again");
  }
  // A dead child is re-admitted by the next pass: its own lane does not lose the hour.
  for (const deadAt of died) {
    const next = checks.find((check) => check.at > deadAt);
    if (next && hotAt(deadAt)) assert.ok(next.at - deadAt <= 7 * MIN, `re-read ${((next.at - deadAt) / MIN).toFixed(1)} min after a dead child`);
  }
});

interface SimBody {
  readonly task: RoutineSourceTask;
  /** Sitting starts; `undefined` for a partition never published. */
  readonly starts: readonly string[] | undefined;
  /** Hot intervals by the refresh rule, for judging (checked against the real function). */
  readonly hot: readonly (readonly [number, number])[];
}

interface SimResult {
  readonly hourlyLate: readonly string[];
  readonly twiceDailyLate: readonly string[];
  readonly peakHot: number;
  readonly passes: number;
  readonly longestPassMs: number;
  readonly reads: number;
  readonly failedReads: number;
  readonly deadChildren: number;
  readonly maxHotGapMs: number;
  readonly maxGapMs: number;
  /** Reads started by catch-up while a pass was held open. */
  readonly catchUpReads: number;
}

function hotIntervals(starts: readonly string[]): (readonly [number, number])[] {
  // Hot from seven days before a start to seven days after it concludes (the
  // day bound when no end is stated): [start - 7d, start + 1d + 7d].
  const raw = starts.map((start) => {
    const at = Date.parse(start);
    return [at - MEETING_SITTING_WINDOW.windowMs, at + SITTING_CONCLUSION_BOUND_MS + MEETING_SITTING_WINDOW.windowMs] as const;
  }).sort((left, right) => left[0] - right[0]);
  const merged: [number, number][] = [];
  for (const [from, to] of raw) {
    const last = merged.at(-1);
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  return merged;
}

async function simulateRegistry(options: {
  readonly recordedPasses: boolean;
  readonly days: number;
  readonly seed?: number;
}): Promise<SimResult> {
  const rand = seeded(options.seed ?? (options.recordedPasses ? 925 : 924));
  const start = Date.parse("2026-10-05T07:00:00.000Z");
  const end = start + options.days * DAY;
  const recorded = recordedPasses();
  const windowed = ROUTINE_SOURCE_TASKS.filter((task) => task.contract.schedule?.kind === "SITTING_WINDOW");
  const followed = new Set(windowed.filter((task) => task.recordClass !== "MEETING").flatMap((task) =>
    (task.contract.schedule?.kind === "SITTING_WINDOW" ? task.contract.schedule.follows ?? [] : [])
      .map(({ meetingSource, bodyId }) => meetingPartitionId(meetingSource, bodyId))));

  // About half the meeting partitions published, about half of those hourly; each published body meets weekly,
  // fortnightly, monthly or rarely (crossing into and out of the window during the run).
  const bodies = new Map<string, SimBody>();
  const partitions = windowed.filter((task) => task.recordClass === "MEETING");
  for (const task of partitions) {
    const draw = rand();
    const kind = followed.has(task.id) ? "weekly" : draw < 0.45 ? "never" : draw < 0.55 ? "weekly" : draw < 0.7 ? "fortnightly" : draw < 0.9 ? "monthly" : "rare";
    if (kind === "never") { bodies.set(task.id, { task, starts: undefined, hot: [] }); continue; }
    const every = kind === "weekly" ? 7 * DAY : kind === "fortnightly" ? 14 * DAY : kind === "monthly" ? 30 * DAY : 90 * DAY;
    const first = start - 60 * DAY + Math.floor(rand() * (every / DAY)) * DAY + Math.floor(8 + rand() * 11) * HOUR;
    const starts: string[] = [];
    for (let at = first; at < end + 30 * DAY; at += every) if (at > start - 30 * DAY) starts.push(iso(at));
    bodies.set(task.id, { task, starts, hot: hotIntervals(starts) });
  }
  // Meeting outcomes follow their Board partitions' sittings.
  for (const task of windowed.filter((row) => row.recordClass !== "MEETING")) {
    const sources = (task.contract.schedule?.kind === "SITTING_WINDOW" ? task.contract.schedule.follows ?? [] : [])
      .map(({ meetingSource, bodyId }) => bodies.get(meetingPartitionId(meetingSource, bodyId))!);
    bodies.set(task.id, { task, starts: undefined, hot: hotIntervals(sources.flatMap((body) => body.starts ?? [])) });
  }
  // The judge's intervals are the runner's own rule, at their edges.
  for (const body of [...bodies.values()].filter(({ starts }) => starts !== undefined).slice(0, 12)) {
    for (const [from, to] of body.hot) {
      assert.equal(sittingWindowHotByConclusion(MEETING_SITTING_WINDOW, [body.starts!], from), true);
      assert.equal(sittingWindowHotByConclusion(MEETING_SITTING_WINDOW, [body.starts!], to), true);
      assert.equal(sittingWindowHotByConclusion(MEETING_SITTING_WINDOW, [body.starts!], to + 1), false);
    }
  }
  const hotAt = (body: SimBody, ms: number) => body.hot.some(([from, to]) => ms >= from && ms <= to);

  // Clocks as the store reports them after each kind of read.
  const clocks = new Map<string, RoutineTaskClock>();
  const checks = new Map<string, number[]>([...bodies.keys()].map((id) => [id, []]));
  const record = (body: SimBody, at: number, failed: boolean) => {
    const prior = clocks.get(body.task.id);
    const published = body.starts !== undefined || body.task.recordClass !== "MEETING";
    const sittings = body.starts !== undefined ? { sittingStarts: body.starts } : {};
    clocks.set(body.task.id, failed || !published
      ? { ...prior, lastAttemptedAt: iso(at), ...sittings }
      : { lastAttemptedAt: iso(at), lastSucceededAt: iso(at - 2_500), lastSucceededObservedAt: iso(at), ...sittings });
    checks.get(body.task.id)!.push(at);
  };
  // Hourly bodies were read in the last 40 minutes; twice-daily ones fall due over the first two hours.
  [...bodies.values()].forEach((body, index) => {
    record(body, hotAt(body, start) ? start - (index % 8 + 1) * 5 * MIN : start - 12 * HOUR + 10 * MIN + (index % 24) * 5 * MIN, false);
  });

  // One Tucson board partition's child dies without a receipt on every read for
  // six hours of day 2; 3% of all other reads fail at the source.
  const tucson = partitions.filter((task) => task.acquisitionFailureDomain === "meeting-upstream:clerksboards.tucsonaz.gov");
  assert.ok(tucson.length >= 20);
  const crashing = tucson.find((task) => bodies.get(task.id)!.starts !== undefined && hotAt(bodies.get(task.id)!, start + DAY + 2 * HOUR))!;
  assert.ok(crashing, "a published, hourly Tucson body crash-loops");
  const crashFrom = start + DAY;
  const crashTo = crashFrom + 6 * HOUR;

  let pass = 0;
  let longestPassMs = 0;
  let peakHot = 0;
  let reads = 0;
  let failedReads = 0;
  let deadChildren = 0;
  let catchUpReads = 0;
  const all = [...bodies.values()];
  const tasks = all.map(({ task }) => task);
  // Each pass is admitted by the runner's own functions and run by
  // tests/helpers/routine-pass-replay.ts: the runner's pool of four children
  // (a lane's reads one at a time with the same-host gap) beside the rest of a
  // recorded pass, then its Reader repair, with catch-up reads while either
  // holds the pass open.
  const clock = new ControlledClock(start);
  await clock.run(async () => {
    let at = start;
    while (at < end) {
      await clock.sleepUntil(at);
      const clockReads = all.map((body) => ({ task: body.task, ok: true, clock: clocks.get(body.task.id) }));
      const signals = sittingWindowSignals(clockReads, at);
      peakHot = Math.max(peakHot, all.filter((body) => hotAt(body, at)).length);
      const due = all.filter((body) => routineTaskDue(body.task, clocks.get(body.task.id), at, signals.get(body.task.id)));
      const admitted = routineFailureDomainFrontier(due.map((body) => ({
        task: body.task,
        lastConsideredAt: clocks.get(body.task.id)?.lastAttemptedAt ?? null,
        deadlineMs: routineTaskDeadlineMs(body.task, clocks.get(body.task.id), signals.get(body.task.id)),
      })), ROUTINE_FAILURE_DOMAIN_FRONTIER_PER_PASS, pass);
      for (const lane of new Set(admitted.map(({ task }) => task.acquisitionFailureDomain))) {
        assert.ok(admitted.filter(({ task }) => task.acquisitionFailureDomain === lane).length <= SITTING_WINDOW_LANE_SLOTS_PER_PASS);
      }
      const result = await replayPass({
        clock,
        admittedAtMs: at,
        recorded: options.recordedPasses ? recorded[Math.floor(rand() * recorded.length)] : undefined,
        cleanRepairMs: 15_000,
        launched: routinePassLaunchOrder(admitted).map(({ task }) => task),
        windowed: tasks,
        passClocks: new Map(tasks.map((task) => [task.id, clocks.get(task.id)])),
        readMs: () => 10_000 + Math.floor(rand() * 50_000),
        settled: (task, endedAtMs) => {
          reads += 1;
          if (task.id === crashing.id && endedAtMs >= crashFrom && endedAtMs < crashTo) { deadChildren += 1; return; }
          const failed = rand() < 0.03;
          if (failed) failedReads += 1;
          record(bodies.get(task.id)!, endedAtMs, failed);
        },
      });
      longestPassMs = Math.max(longestPassMs, result.endedAtMs - at);
      catchUpReads += result.catchUpReads;
      const handoff = at >= start + 3 * DAY && at < start + 3 * DAY + 10 * MIN ? 8 * MIN : 0;
      at = nextAdmissionMs(at, result.endedAtMs, handoff);
      pass += 1;
    }
  });

  const hourlyLate: string[] = [];
  const twiceDailyLate: string[] = [];
  let maxHotGapMs = 0;
  let maxGapMs = 0;
  for (const body of all) {
    const times = [...checks.get(body.task.id)!, end];
    for (let index = 1; index < times.length; index += 1) {
      const from = times[index - 1]!;
      const to = times[index]!;
      // The crash-looping body's own source is broken; its lane mates are judged.
      if (body.task.id === crashing.id && to > crashFrom && from < crashTo + HOUR) continue;
      maxGapMs = Math.max(maxGapMs, to - from);
      if (to - from > 12 * HOUR) twiceDailyLate.push(`${body.task.id} ${((to - from) / HOUR).toFixed(2)} h ending ${iso(to)}`);
      for (const [hotFrom, hotTo] of body.hot) {
        // Every obligation due after the run's first instant is judged; one due
        // before it belongs to the seeded history, which the run did not make.
        const owed = Math.max(from, hotFrom);
        if (owed + HOUR >= start && owed + HOUR < to && owed + HOUR <= hotTo) {
          hourlyLate.push(`${body.task.id} unread ${((Math.min(to, hotTo) - owed) / MIN).toFixed(2)} min from ${iso(owed)}`);
        }
        if (hotFrom <= from && to <= hotTo) maxHotGapMs = Math.max(maxHotGapMs, to - from);
      }
    }
  }
  return { hourlyLate, twiceDailyLate, peakHot, passes: pass, longestPassMs, reads, failedReads, deadChildren, maxHotGapMs, maxGapMs, catchUpReads };
}

test("controlled clock, whole registry: every sitting-window task on its real lane shares the four-child pool, with failed reads, a crash-looping partition and a release handoff; clean passes read every hourly body within 60:00 and every body within 12:00:00", async () => {
  const result = await simulateRegistry({ recordedPasses: false, days: 14 });
  assert.ok(result.peakHot >= 60, `${result.peakHot} hourly bodies at the peak (production had 49 on 2026-09-25)`);
  assert.ok(result.failedReads > 50 && result.deadChildren > 10, `${result.failedReads} failed reads, ${result.deadChildren} dead children`);
  assert.deepEqual(result.twiceDailyLate, []);
  assert.deepEqual(result.hourlyLate, [], `longest hourly gap ${(result.maxHotGapMs / MIN).toFixed(2)} min`);
  assert.ok(result.maxHotGapMs <= HOUR && result.maxGapMs <= 12 * HOUR);
});

test("controlled clock, whole registry under the passes production ran (2026-09-24, up to 15:52), with catch-up while a pass is held open: every hourly body is read within 60:00 and prioritising hourly bodies never pushes any body past 12 hours", async () => {
  // Two seeds; each must keep every hourly body within the hour.
  for (const seed of [925, 9]) {
    const result = await simulateRegistry({ recordedPasses: true, days: 14, seed });
    const detail = `seed ${seed}: longest hourly gap ${(result.maxHotGapMs / MIN).toFixed(2)} min, longest gap ${(result.maxGapMs / HOUR).toFixed(2)} h, ` +
      `longest pass ${(result.longestPassMs / MIN).toFixed(2)} min, ${result.reads} reads, ${result.catchUpReads} by catch-up`;
    assert.ok(result.longestPassMs >= 952_000, `the run drew the longest recorded pass (${detail})`);
    assert.equal(result.twiceDailyLate.length, 0, `no body waits past 12 hours for the hourly ones (${detail}): ${result.twiceDailyLate.slice(0, 6).join(" | ")}`);
    assert.equal(result.hourlyLate.length, 0, `late hourly reads (${detail}): ${result.hourlyLate.slice(0, 6).join(" | ")}`);
    assert.ok(result.maxHotGapMs <= HOUR && result.maxGapMs <= 12 * HOUR, detail);
    assert.ok(result.catchUpReads > 0, `the long passes admitted reads by catch-up (${detail})`);
  }
});

test("a failed read never waits longer than the schedule it failed: a published derived family retries within the hour while hourly", () => {
  const family = ROUTINE_SOURCE_TASKS.find((task) => task.id.startsWith("meetings:derived:"))!;
  const partition = registered(PIMA_LEGISTAR);
  assert.equal(family.retryMs, 6 * HOUR);
  const at = Date.parse("2026-10-05T12:00:00.000Z");
  const success = at - 30 * MIN;
  const failed: RoutineTaskClock = {
    lastAttemptedAt: iso(at),
    lastSucceededAt: iso(success - 2_500),
    lastSucceededObservedAt: iso(success),
    sittingStarts: [iso(at + 2 * DAY)],
  };
  // Hourly: the retry is owed within the hour, not six hours later.
  assert.equal(routineTaskDeadlineMs(family, failed, true), at + HOUR);
  assert.equal(routineTaskDeadlineMs(family, failed, undefined), at + HOUR, "unknown reads as hourly");
  // Twice daily: its own six-hour retry, which is sooner than twelve.
  assert.equal(routineTaskDeadlineMs(family, failed, false), at + 6 * HOUR);
  // Published with no proven success: the same cap.
  const unproven: RoutineTaskClock = { lastAttemptedAt: iso(at), sittingStarts: [iso(at + 2 * DAY)] };
  assert.equal(routineTaskDeadlineMs(family, unproven, true), at + HOUR);
  // Never published keeps its twice-daily retry, and a meeting partition's one-hour retry is unchanged.
  assert.equal(routineTaskDeadlineMs(family, { lastAttemptedAt: iso(at) }, true), at + 12 * HOUR);
  assert.equal(routineTaskDeadlineMs(partition, failed, true), at + HOUR);
  assert.equal(routineTaskDeadlineMs(partition, failed, false), at + HOUR);
});

test("a pass starts the read owed soonest first; tasks without a deadline keep their registry place at the front", () => {
  const rows = [
    { id: "census", deadlineMs: undefined },
    { id: "late-deadline", deadlineMs: 50 },
    { id: "never-read", deadlineMs: Number.NEGATIVE_INFINITY },
    { id: "fec", deadlineMs: undefined },
    { id: "soon", deadlineMs: 10 },
    { id: "tie-a", deadlineMs: 30 },
    { id: "tie-b", deadlineMs: 30 },
  ];
  assert.deepEqual(routinePassLaunchOrder(rows).map(({ id }) => id), ["census", "fec", "never-read", "soon", "tie-a", "tie-b", "late-deadline"]);
  assert.deepEqual(routinePassLaunchOrder([]), []);
});

test("rehearsal of the accelerated production test: a due request brings a cold partition forward, the ordinary pass reads it, and the next due is the normal rule's", async () => {
  const partition = registered(NEWBURY_ENERGY);
  assert.equal(partition.acquisitionFailureDomain, "meeting-upstream:www.newburyenergynh.org", "the proposed test case is alone on its lane");
  assert.equal(ROUTINE_SOURCE_TASKS.filter((task) => task.acquisitionFailureDomain === partition.acquisitionFailureDomain).length, 1);
  const store = new MemoryRoutineDataStore();
  const T0 = Date.parse("2026-08-10T15:00:00.000Z");
  const starts = [iso(T0 + 40 * DAY)];
  // Published and cold: last read (a new version) at T0.
  await read(store, partition, "CHANGED", T0, starts, 1);
  const pointed = (await store.readPromotion("MEETING", partition.scope))!.versionId;
  const others = ROUTINE_SOURCE_TASKS.filter((task) => task.contract.schedule?.kind === "SITTING_WINDOW" && task.id !== partition.id).slice(0, 30);

  /** One ordinary pass at `at`: the runner's own due check, request, frontier and launch order. */
  const pass = async (at: number, requests: readonly RoutineDueRequest[]) => {
    const clock = await store.clock(partition.sourceId, "MEETING", partition.scope);
    const hot = sittingWindowSignals([{ task: partition, ok: true, clock }], at).get(partition.id);
    const request = routineDueRequestFor(partition, clock, at, requests);
    // The request moves no other task.
    for (const other of others) assert.equal(routineDueRequestFor(other, clock, at, requests), null);
    if (!routineTaskDue(partition, clock, at, hot) && request === null) return { admitted: false, clock, hot };
    const admitted = routinePassLaunchOrder(routineFailureDomainFrontier([{
      task: partition,
      lastConsideredAt: clock.lastAttemptedAt ?? null,
      deadlineMs: routineDueRequestDeadlineMs(routineTaskDeadlineMs(partition, clock, hot), request),
    }]));
    assert.deepEqual(admitted.map(({ task }) => task.id), [partition.id]);
    return { admitted: true, clock, hot };
  };

  // Without a request the partition waits for its twice-daily read.
  const requestedAt = T0 + 2 * HOUR;
  assert.equal((await pass(requestedAt, [])).admitted, false);
  const request: RoutineDueRequest = {
    id: "routine-due:00000000-0000-4000-8000-00000000000a", contractId: partition.id, requestedAt: iso(requestedAt),
    dueAt: iso(requestedAt), expiresAt: iso(requestedAt + 90 * MIN), reason: "rehearsal", withdrawnAt: null,
  };
  // The first ordinary pass after the request admits it; the read finds nothing new.
  const first = await pass(requestedAt + 3 * MIN, [request]);
  assert.equal(first.admitted, true);
  assert.equal(first.hot, false, "a cold body: without the request it was owed at T0 + 12 h");
  assert.equal(routineTaskDeadlineMs(partition, first.clock, first.hot), T0 + 12 * HOUR);
  const readAt = requestedAt + 3 * MIN + 40_000;
  await read(store, partition, "UNCHANGED", readAt, starts, 1);

  // Spent by that read; the next pass leaves it, and the next due is the normal rule from the read.
  const after = await store.clock(partition.sourceId, "MEETING", partition.scope);
  assert.equal(routineDueRequestState(request, after, readAt + 2 * MIN), "SPENT");
  assert.equal((await pass(readAt + 2 * MIN, [request])).admitted, false);
  assert.equal(routineTaskDeadlineMs(partition, after, false), readAt + 12 * HOUR);
  assert.equal((await store.readPromotion("MEETING", partition.scope))!.versionId, pointed, "an unchanged read keeps readers on their version");
  // Twice daily again: eligible two hours early, never sooner.
  assert.equal((await pass(readAt + 10 * HOUR - MIN, [request])).admitted, false);
  assert.equal((await pass(readAt + 10 * HOUR, [request])).admitted, true);

  // A changed read spends a request the same way, and moves the pointer.
  const second: RoutineDueRequest = { ...request, id: "routine-due:00000000-0000-4000-8000-00000000000b", requestedAt: iso(readAt + HOUR), dueAt: iso(readAt + HOUR), expiresAt: iso(readAt + 2 * HOUR) };
  assert.equal((await pass(readAt + HOUR + 5 * MIN, [request, second])).admitted, true);
  const changedAt = readAt + HOUR + 5 * MIN + 30_000;
  await read(store, partition, "CHANGED", changedAt, starts, 2);
  const moved = await store.clock(partition.sourceId, "MEETING", partition.scope);
  assert.equal(routineDueRequestState(second, moved, changedAt + MIN), "SPENT");
  assert.equal(routineTaskDeadlineMs(partition, moved, false), changedAt + 12 * HOUR);
  assert.notEqual((await store.readPromotion("MEETING", partition.scope))!.versionId, pointed);
});
