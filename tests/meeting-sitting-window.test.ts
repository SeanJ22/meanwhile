import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "../lib/db/schema.ts";

import {
  MEETING_SITTING_WINDOW,
  ROUTINE_DATA_ADMISSION_MS,
  ROUTINE_SOURCE_CONTRACTS,
  sittingWindowDueAtMs,
  sittingWindowHot,
} from "../lib/civic-data/contracts.ts";
import { MEETING_PARTITION_CONTRACTS, meetingPartitionId, sittingWindowSourceIds } from "../lib/civic-data/meeting-partitions.ts";
import {
  SITTING_CONCLUSION_BOUND_MS,
  SITTING_WINDOW_ADMISSION_LEAD_MS,
  SITTING_WINDOW_BASE_ADMISSION_LEAD_MS,
  meetingPayloadStatedEnds,
  sittingConclusionMs,
  sittingWindowHotByConclusion,
  statedSittingEndsByScope,
  statedSittingEndsRead,
} from "../lib/civic-data/sitting-window-admission.ts";
import {
  ROUTINE_SOURCE_TASKS,
  routineTaskDeadlineMs,
  routineTaskDue,
  sittingWindowSignals,
  type RoutineSourceTask,
  type RoutineTaskClock,
} from "../lib/civic-data/runner.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PASS = ROUTINE_DATA_ADMISSION_MS;
const LEAD = SITTING_WINDOW_ADMISSION_LEAD_MS;
const BASE_LEAD = SITTING_WINDOW_BASE_ADMISSION_LEAD_MS;
const PIMA = "ocd-division/country:us/state:az/county:pima#governing";
const PIMA_LEGISTAR = meetingPartitionId("legistar", PIMA);
const PIMA_INSITE = meetingPartitionId("legistar-insite", PIMA);
const OUTCOMES = "pima-legistar-outcomes";
const MESA_OUTCOMES = "mesa-legistar-minutes-outcomes";
const MESA_INSITE = meetingPartitionId("legistar-insite", "ocd-division/country:us/state:az/place:mesa#governing");

function task(id: string): RoutineSourceTask {
  const found = ROUTINE_SOURCE_TASKS.find((row) => row.id === id);
  assert.ok(found, `task ${id} is registered`);
  return found;
}

/** A clock whose newest attempt is its proven success, observed at `at`. */
function succeededAt(at: string, sittingStarts?: readonly string[]): RoutineTaskClock {
  return {
    lastAttemptedAt: at,
    lastSucceededAt: new Date(Date.parse(at) - 2_500).toISOString(),
    lastSucceededObservedAt: at,
    ...(sittingStarts ? { sittingStarts } : {}),
  };
}

test("the policy is the owner's: seven days either side, hourly when hot, twice daily otherwise", () => {
  assert.deepEqual(MEETING_SITTING_WINDOW, { kind: "SITTING_WINDOW", windowMs: 7 * DAY, hotEveryMs: HOUR, baseEveryMs: 12 * HOUR });
  assert.ok(MEETING_PARTITION_CONTRACTS.length > 0);
  for (const partition of MEETING_PARTITION_CONTRACTS) {
    assert.deepEqual(partition.schedule, MEETING_SITTING_WINDOW, `${partition.id} follows its own sittings`);
    assert.deepEqual(sittingWindowSourceIds(partition.id), MEETING_PARTITION_CONTRACTS.filter(row => row.bodyId === partition.bodyId).map(row => row.id));
  }
  assert.deepEqual(sittingWindowSourceIds(OUTCOMES), [PIMA_LEGISTAR, PIMA_INSITE]);
  // Mesa's council decisions follow the council's one InSite partition.
  assert.deepEqual(sittingWindowSourceIds(MESA_OUTCOMES), [MESA_INSITE]);
});

test("no other data family's schedule is changed: only meeting partitions and meeting outcomes carry a sitting window", () => {
  const windowed = ROUTINE_SOURCE_CONTRACTS.filter((contract) => contract.schedule !== undefined).map((contract) => contract.id);
  assert.deepEqual(windowed, [OUTCOMES, MESA_OUTCOMES]);
  const at = "2026-09-24T09:00:00.000Z";
  for (const row of ROUTINE_SOURCE_TASKS.filter((candidate) => candidate.contract.schedule === undefined)) {
    // A success claimed seconds before its observed attempt.
    const clock: RoutineTaskClock = { lastAttemptedAt: at, lastSucceededAt: "2026-09-24T08:59:57.500Z" };
    const enriched: RoutineTaskClock = { ...clock, lastSucceededObservedAt: at, sittingStarts: [at] };
    for (const offset of [0, HOUR - 1, HOUR, 6 * HOUR - 1, 6 * HOUR, 30 * DAY]) {
      const now = Date.parse(at) + offset;
      const today = routineTaskDue(row, { ...clock, lastSucceededObservedAt: at }, now);
      assert.equal(routineTaskDue(row, enriched, now), today, `${row.id}: observed source success owns its unchanged family cadence`);
      assert.equal(routineTaskDue(row, enriched, now, true), today, `${row.id}: a sitting signal decides nothing for it`);
      assert.equal(routineTaskDue(row, enriched, now, false), today, `${row.id}: a sitting signal decides nothing for it`);
    }
  }
});

test("a sitting within seven days on either side makes a body hot, to the millisecond", () => {
  const now = Date.parse("2026-09-24T16:00:00.000Z");
  const at = (offset: number) => new Date(now + offset).toISOString();
  assert.equal(sittingWindowHot(MEETING_SITTING_WINDOW, [[at(7 * DAY)]], now), true, "upcoming, exactly seven days");
  assert.equal(sittingWindowHot(MEETING_SITTING_WINDOW, [[at(-7 * DAY)]], now), true, "concluded, exactly seven days");
  assert.equal(sittingWindowHot(MEETING_SITTING_WINDOW, [[at(7 * DAY + 1)]], now), false);
  assert.equal(sittingWindowHot(MEETING_SITTING_WINDOW, [[at(-7 * DAY - 1)]], now), false);
  assert.equal(sittingWindowHot(MEETING_SITTING_WINDOW, [[at(-30 * DAY), at(2 * DAY)]], now), true);
  assert.equal(sittingWindowHot(MEETING_SITTING_WINDOW, [[]], now), false, "a body with no sittings is not hot");
  assert.equal(sittingWindowHot(MEETING_SITTING_WINDOW, [["not a time"]], now), false);
  // Offsets are honoured: 09:00 Arizona is 16:00Z.
  assert.equal(sittingWindowHot(MEETING_SITTING_WINDOW, [["2026-10-01T09:00:00-07:00"]], now), true);
  assert.equal(sittingWindowHot(MEETING_SITTING_WINDOW, [["2026-10-01T09:00:00.001-07:00"]], now), false);
  // Unknown is never read as cold.
  assert.equal(sittingWindowHot(MEETING_SITTING_WINDOW, [undefined], now), undefined);
  assert.equal(sittingWindowHot(MEETING_SITTING_WINDOW, [undefined, [at(DAY)]], now), true);
  assert.equal(sittingWindowHot(MEETING_SITTING_WINDOW, [undefined, [at(30 * DAY)]], now), undefined);
  assert.equal(sittingWindowHot(MEETING_SITTING_WINDOW, [], now), undefined);
});

test("a meeting partition is re-read hourly when hot and twice daily otherwise, never drifting past the hour", () => {
  const partition = task(PIMA_LEGISTAR);
  const at = "2026-09-24T09:00:00.000Z";
  const base = Date.parse(at);
  const clock = succeededAt(at);

  assert.equal(LEAD, 25 * 60_000);
  assert.equal(BASE_LEAD, 2 * HOUR);
  assert.equal(routineTaskDeadlineMs(partition, clock, true), base + HOUR);
  assert.equal(routineTaskDeadlineMs(partition, clock, false), base + 12 * HOUR);
  assert.equal(routineTaskDue(partition, clock, base + HOUR - LEAD - 1, true), false);
  assert.equal(routineTaskDue(partition, clock, base + HOUR - LEAD, true), true);
  assert.equal(routineTaskDue(partition, clock, base + 12 * HOUR - BASE_LEAD - 1, false), false);
  assert.equal(routineTaskDue(partition, clock, base + 12 * HOUR - BASE_LEAD, false), true);
  assert.equal(routineTaskDue(partition, clock, base + HOUR - LEAD, undefined), true, "unknown reads as hot");
  // The registry's own due instant is unchanged; the runner no longer admits on it.
  assert.equal(sittingWindowDueAtMs(MEETING_SITTING_WINDOW, base, true), base + HOUR - PASS);
  assert.equal(sittingWindowDueAtMs(MEETING_SITTING_WINDOW, base, false), base + 12 * HOUR - PASS);
});

test("C6: a body is hourly for a meeting in the next seven days or one that concluded in the previous seven", () => {
  const now = Date.parse("2026-09-25T06:00:00.000Z");
  const hot = (startMs: number) => sittingWindowHotByConclusion(MEETING_SITTING_WINDOW, [[new Date(startMs).toISOString()]], now);
  assert.equal(SITTING_CONCLUSION_BOUND_MS, DAY, "a sitting without an end time counts as concluded up to a day after it starts");
  assert.equal(hot(now + 7 * DAY), true, "starts seven days ahead");
  assert.equal(hot(now + 7 * DAY + 1), false);
  assert.equal(hot(now - 7 * DAY), true, "started seven days ago");
  assert.equal(hot(now - 7 * DAY - 23 * HOUR), true, "started almost eight days ago, so it may have concluded within seven");
  assert.equal(hot(now - 8 * DAY), true);
  assert.equal(hot(now - 8 * DAY - 1), false, "concluded more than seven days ago by the bound");
  assert.equal(sittingWindowHotByConclusion(MEETING_SITTING_WINDOW, [undefined], now), undefined, "an unreadable list stays unknown");
  assert.equal(sittingWindowHotByConclusion(MEETING_SITTING_WINDOW, [[]], now), false);
});

test("the success is read in the attempt clock's own units, so a success is never mistaken for a failure", () => {
  const partition = task(PIMA_LEGISTAR);
  const at = "2026-09-24T09:00:00.000Z";
  const base = Date.parse(at);
  // The claimed retrieval precedes the first event by the acquisition's own duration; the success is read from the observed attempt.
  const clock = succeededAt(at);
  assert.ok(Date.parse(clock.lastSucceededAt!) < Date.parse(clock.lastAttemptedAt!));
  assert.equal(routineTaskDue(partition, clock, base + HOUR, false), false, "base: not re-read at the retry hour");
  // A genuinely failed later attempt owes its retry an hour later, admitted 25 minutes early.
  const failed: RoutineTaskClock = { ...clock, lastAttemptedAt: "2026-09-24T10:00:00.000Z" };
  assert.equal(routineTaskDeadlineMs(partition, failed, false), Date.parse("2026-09-24T11:00:00.000Z"));
  assert.equal(routineTaskDue(partition, failed, Date.parse("2026-09-24T10:35:00.000Z") - 1, false), false);
  assert.equal(routineTaskDue(partition, failed, Date.parse("2026-09-24T10:35:00.000Z"), false), true);
  // A published source with no proven success retries on its attempt; a never-run one is due at once.
  assert.equal(routineTaskDue(partition, { lastAttemptedAt: at, sittingStarts: [] }, base + HOUR - LEAD - 1, false), false);
  assert.equal(routineTaskDue(partition, { lastAttemptedAt: at, sittingStarts: [] }, base + HOUR - LEAD, false), true);
  assert.equal(routineTaskDeadlineMs(partition, undefined, false), Number.NEGATIVE_INFINITY, "never run: owed at once");
  assert.equal(routineTaskDue(partition, undefined, base, false), true);
  assert.equal(routineTaskDue(partition, {}, base, false), true);
});

test("a meeting source without an accepted version follows its body's hot or cold retry clock", () => {
  const partition = task(PIMA_LEGISTAR);
  const at = "2026-09-24T09:00:00.000Z";
  const base = Date.parse(at);
  // The store reports no sitting list for a scope it holds no promotion for.
  const never: RoutineTaskClock = { lastAttemptedAt: at };
  for (const hot of [true, undefined]) {
    assert.equal(routineTaskDeadlineMs(partition, never, hot), base + HOUR);
    assert.equal(routineTaskDue(partition, never, base + HOUR - LEAD - 1, hot), false);
    assert.equal(routineTaskDue(partition, never, base + HOUR - LEAD, hot), true);
  }
  assert.equal(routineTaskDeadlineMs(partition, never, false), base + 12 * HOUR);
  assert.equal(routineTaskDue(partition, never, base + 12 * HOUR - BASE_LEAD - 1, false), false);
  assert.equal(routineTaskDue(partition, never, base + 12 * HOUR - BASE_LEAD, false), true);
  // A promoted scope reports its sitting list, even an empty one, so a read
  // that has not proven a success keeps the one-hour retry.
  for (const sittingStarts of [[], [at]]) {
    const published: RoutineTaskClock = { lastAttemptedAt: at, sittingStarts };
    assert.equal(routineTaskDue(partition, published, base + HOUR - LEAD - 1, true), false);
    assert.equal(routineTaskDue(partition, published, base + HOUR - LEAD, true), true);
  }
  // A failed read after a proven success keeps the hour too.
  const failed: RoutineTaskClock = { ...succeededAt(at, []), lastAttemptedAt: new Date(base + HOUR).toISOString() };
  assert.equal(routineTaskDue(partition, failed, base + 2 * HOUR - LEAD - 1, false), false);
  assert.equal(routineTaskDue(partition, failed, base + 2 * HOUR - LEAD, false), true);
  // A never-run partition is read at once.
  assert.equal(routineTaskDue(partition, undefined, base, true), true);
  assert.equal(routineTaskDue(partition, {}, base, true), true);
  // Meeting outcomes carry no sitting list of their own, so they keep their retry.
  const outcomes = task(OUTCOMES);
  assert.ok(outcomes.retryMs < 12 * HOUR);
  assert.equal(routineTaskDue(outcomes, never, base + outcomes.retryMs - LEAD, true), true);
});

test("a sibling source's sitting keeps an unaccepted source on the hourly deadline from its own attempt", () => {
  const own = task(PIMA_LEGISTAR), sibling = task(PIMA_INSITE);
  const attemptedAt = "2026-09-24T09:00:00.000Z", base = Date.parse(attemptedAt);
  const never: RoutineTaskClock = { lastAttemptedAt: attemptedAt };
  const held = succeededAt("2026-09-24T08:00:00.000Z", ["2026-09-26T15:00:00.000Z"]);
  const signals = sittingWindowSignals([{ task: own, ok: true, clock: never }, { task: sibling, ok: true, clock: held }], base);
  assert.equal(signals.get(own.id), true);
  assert.equal(routineTaskDeadlineMs(own, never, signals.get(own.id)), base + HOUR);
  assert.equal(routineTaskDue(own, never, base + HOUR - LEAD - 1, signals.get(own.id)), false);
  assert.equal(routineTaskDue(own, never, base + HOUR - LEAD, signals.get(own.id)), true);
  assert.equal(routineTaskDeadlineMs(sibling, held, signals.get(sibling.id)), base);
});

test("the window rolls: a sitting coming within seven days makes a twice-daily source due at that instant", () => {
  const partition = task(PIMA_LEGISTAR);
  const at = "2026-09-24T09:00:00.000Z";
  const sitting = "2026-10-01T15:00:00.000Z";
  const clock = succeededAt(at, [sitting]);
  const entersWindow = Date.parse(sitting) - 7 * DAY;
  const reads = (now: number) => [{ task: partition, ok: true, clock }].map((read) => ({ ...read, now }));
  const hotAt = (now: number) => sittingWindowSignals([...reads(now), { task: task(PIMA_INSITE), ok: true, clock }], now).get(partition.id);
  assert.equal(hotAt(entersWindow - 1), false);
  assert.equal(routineTaskDue(partition, clock, entersWindow - 1, hotAt(entersWindow - 1)), false);
  assert.equal(hotAt(entersWindow), true);
  assert.equal(routineTaskDue(partition, clock, entersWindow, hotAt(entersWindow)), true);
  // And it cools seven days after the sitting concludes, bounded at a day after it starts.
  const leavesWindow = Date.parse(sitting) + SITTING_CONCLUSION_BOUND_MS + 7 * DAY;
  assert.equal(hotAt(leavesWindow), true);
  assert.equal(hotAt(leavesWindow + 1), false);
});

test("Pima outcomes follow both Board partitions; an unreadable partition never cools them", () => {
  const now = Date.parse("2026-09-24T16:00:00.000Z");
  const soon = new Date(now + 2 * DAY).toISOString();
  const far = new Date(now + 40 * DAY).toISOString();
  const read = (id: string, clock: RoutineTaskClock | undefined, ok = true) => ({ task: task(id), ok, clock });
  const signal = (legistar: ReturnType<typeof read>, insite: ReturnType<typeof read>) =>
    sittingWindowSignals([read(OUTCOMES, succeededAt("2026-09-24T09:00:00.000Z")), legistar, insite], now).get(OUTCOMES);
  assert.equal(signal(read(PIMA_LEGISTAR, { sittingStarts: [far] }), read(PIMA_INSITE, { sittingStarts: [soon] })), true);
  assert.equal(signal(read(PIMA_LEGISTAR, { sittingStarts: [far] }), read(PIMA_INSITE, { sittingStarts: [] })), false);
  assert.equal(signal(read(PIMA_LEGISTAR, { sittingStarts: [far] }), read(PIMA_INSITE, undefined, false)), undefined);
  assert.equal(
    sittingWindowSignals([read(OUTCOMES, succeededAt("2026-09-24T09:00:00.000Z"))], now).get(OUTCOMES),
    undefined,
    "partitions absent from this pass are unknown, and unknown reads as hot",
  );
  const outcomes = task(OUTCOMES);
  const clock = succeededAt("2026-09-24T09:00:00.000Z");
  const base = Date.parse("2026-09-24T09:00:00.000Z");
  assert.equal(routineTaskDue(outcomes, clock, base + 12 * HOUR - BASE_LEAD - 1, false), false);
  assert.equal(routineTaskDue(outcomes, clock, base + 12 * HOUR - BASE_LEAD, false), true);
  assert.equal(routineTaskDue(outcomes, clock, base + HOUR - LEAD, true), true);
});

test("C6: a sitting concludes at its publisher-stated end; only a sitting with none takes the day bound, which is never stored or shown", () => {
  const now = Date.parse("2026-09-25T06:00:00.000Z");
  const iso = (ms: number) => new Date(ms).toISOString();
  // A three-day hearing that ended 6.5 days ago stays hourly by its stated end;
  // the day bound alone would have cooled it.
  const long = iso(now - 9 * DAY);
  const longEnds = new Map([[long, now - 6.5 * DAY]]);
  assert.equal(sittingWindowHotByConclusion(MEETING_SITTING_WINDOW, [[long]], now), false);
  assert.equal(sittingWindowHotByConclusion(MEETING_SITTING_WINDOW, [[long]], now, longEnds), true);
  // A two-hour meeting that ended 7 days and an hour ago is not hourly by its
  // stated end, though the day bound would have kept it.
  const short = iso(now - 7 * DAY - 3 * HOUR);
  const shortEnds = new Map([[short, now - 7 * DAY - HOUR]]);
  assert.equal(sittingWindowHotByConclusion(MEETING_SITTING_WINDOW, [[short]], now), true);
  assert.equal(sittingWindowHotByConclusion(MEETING_SITTING_WINDOW, [[short]], now, shortEnds), false);
  // An end before its start is not an end.
  assert.equal(sittingConclusionMs(short, new Map([[short, Date.parse(short) - 1]])), Date.parse(short) + DAY);
  // The payload twin reads only stated pairs, the latest end per start.
  const ends = meetingPayloadStatedEnds({ meetings: [
    { startsAt: long, endsAt: iso(now - 6.5 * DAY) },
    { startsAt: short },
    { startsAt: short, endsAt: "not a time" },
    { startsAt: 5, endsAt: iso(now) },
  ] });
  assert.deepEqual([...ends], [[long, now - 6.5 * DAY]]);
  assert.deepEqual([...meetingPayloadStatedEnds({})], []);
  assert.deepEqual([...statedSittingEndsByScope([{ scope: "s", pairs: [[long, iso(now - 6.5 * DAY)], [short, null], ["x"]] }, { scope: "t", pairs: [] }])],
    [["s", new Map([[long, now - 6.5 * DAY]])]]);
});

test("C6: the stated-ends read is built in Postgres, returns only stated pairs, and never selects a payload whole", () => {
  const text = statedSittingEndsRead(drizzle.mock({ schema }), ["body:a"]).toSQL().sql;
  assert.match(text, /"scope" in \(\$\d+\)/);
  assert.match(text, /jsonb_build_array\(m->'startsAt', m->'endsAt'\)/);
  assert.match(text, /jsonb_typeof\(m->'endsAt'\) = 'string'/);
  assert.doesNotMatch(text.slice(0, text.indexOf(" from \"civic_data_promotions\"")), /select (?:"civic_data_promotions"\.)?"payload"[,\s]/);
});

test("C6: the runner reads the stated ends once a pass and hands them to the sitting window by task", () => {
  const now = Date.parse("2026-09-25T06:00:00.000Z");
  const partition = task(PIMA_LEGISTAR);
  const start = new Date(now - 9 * DAY).toISOString();
  const read = { task: partition, ok: true, clock: succeededAt("2026-09-25T05:30:00.000Z", [start]) };
  assert.equal(sittingWindowSignals([read, { ...read, task: task(PIMA_INSITE) }], now).get(partition.id), false);
  assert.equal(sittingWindowSignals([read, { ...read, task: task(PIMA_INSITE) }], now, new Map([[partition.id, new Map([[start, now - 6 * DAY]])]])).get(partition.id), true);
  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  const readCall = "statedSittingEndsRead(getDb(),";
  const admissionCall = "sittingWindowSignals(sittingClockReads, admissionNowMs, statedEndsByTask, admittedSittingSourceIds)";
  assert.equal(runner.split(readCall).length - 1, 1, "stated ends are read only once for the selected body scopes");
  assert.ok(runner.indexOf(admissionCall) > runner.indexOf(readCall), "admission uses the stated ends and captured sibling identities after their scoped read");
  assert.match(runner, /sameDomainGapMs: ROUTINE_SAME_DOMAIN_CHILD_GAP_MS/);
});
