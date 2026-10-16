import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MEETING_PARTITION_CONTRACTS, meetingPartitionId } from "../lib/civic-data/meeting-partitions.ts";
import {
  ROUTINE_DUE_REQUEST_HISTORY,
  parseRoutineDueRequests,
  requestRoutineDue,
  routineDueCommand,
  routineDueRequestDeadlineMs,
  routineDueRequestFor,
  routineDueRequestState,
  withdrawRoutineDue,
  type RoutineDueRequest,
} from "../lib/civic-data/routine-due-request.ts";
import {
  ROUTINE_SOURCE_TASKS,
  routineFailureDomainFrontier,
  routinePassLaunchOrder,
  routineTaskDeadlineMs,
  routineTaskDue,
  type RoutineSourceTask,
  type RoutineTaskClock,
} from "../lib/civic-data/runner.ts";
import { fixtureRepositories } from "./helpers/meeting-doors-fixture.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = "2026-09-26T16:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const iso = (ms: number) => new Date(ms).toISOString();
const NEWBURY_ENERGY = meetingPartitionId("schedulepage", "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#energy-committee");

function task(id: string): RoutineSourceTask {
  const found = ROUTINE_SOURCE_TASKS.find((row) => row.id === id);
  assert.ok(found, `${id} is registered`);
  return found;
}

function coldClock(lastReadMs: number): RoutineTaskClock {
  return {
    lastAttemptedAt: iso(lastReadMs),
    lastSucceededAt: iso(lastReadMs - 2_500),
    lastSucceededObservedAt: iso(lastReadMs),
    sittingStarts: ["2026-11-10T23:00:00.000Z"],
  };
}

test("a due request names one registered meeting partition with a sitting window, due within the hour, gone within two", () => {
  assert.ok(MEETING_PARTITION_CONTRACTS.some(({ id }) => id === NEWBURY_ENERGY), "the proposed test case is registered");
  assert.deepEqual(routineDueCommand([`--contract=${NEWBURY_ENERGY}`]), {
    kind: "REQUEST", contractId: NEWBURY_ENERGY, dueInMs: 0, expiresInMs: 90 * MIN,
    reason: "controlled refresh verification (owner instruction 2026-09-25)",
  });
  assert.deepEqual(routineDueCommand([`--contract=${NEWBURY_ENERGY}`, "--due-in-minutes=10", "--expires-in-minutes=120", "--reason=C6 accelerated check"]), {
    kind: "REQUEST", contractId: NEWBURY_ENERGY, dueInMs: 10 * MIN, expiresInMs: 120 * MIN, reason: "C6 accelerated check",
  });
  const refused: readonly [readonly string[], RegExp][] = [
    [[], /EXACT_ARGUMENTS_REQUIRED/],
    [["--contract=census-geography-overlaps"], /REGISTERED_CONTRACT_REQUIRED/],
    [["--contract=pima-legistar-outcomes"], /REGISTERED_CONTRACT_REQUIRED/],
    [["--contract=meetings:nowhere"], /REGISTERED_CONTRACT_REQUIRED/],
    [[`--contract=${NEWBURY_ENERGY}`, `--contract=${NEWBURY_ENERGY}`], /ONE_CONTRACT_REQUIRED/],
    [[`--contract=${NEWBURY_ENERGY}`, "--force"], /EXACT_ARGUMENTS_REQUIRED/],
    [[`--contract=${NEWBURY_ENERGY}`, "--only=x"], /EXACT_ARGUMENTS_REQUIRED/],
    [[`--contract=${NEWBURY_ENERGY}`, "--due-in-minutes=61"], /OUT_OF_RANGE:due-in-minutes/],
    [[`--contract=${NEWBURY_ENERGY}`, "--due-in-minutes=-1"], /OUT_OF_RANGE:due-in-minutes/],
    [[`--contract=${NEWBURY_ENERGY}`, "--expires-in-minutes=121"], /OUT_OF_RANGE:expires-in-minutes/],
    [[`--contract=${NEWBURY_ENERGY}`, "--due-in-minutes=30", "--expires-in-minutes=30"], /EXPIRES_BEFORE_DUE/],
    [[`--contract=${NEWBURY_ENERGY}`, "--reason="], /REASON_INVALID/],
    [["--withdraw=routine-due:not-an-id"], /WITHDRAW_EXACT_ID_REQUIRED/],
    [["--withdraw=routine-due:00000000-0000-4000-8000-000000000000", `--contract=${NEWBURY_ENERGY}`], /WITHDRAW_EXACT_ID_REQUIRED/],
  ];
  for (const [args, expected] of refused) assert.throws(() => routineDueCommand(args), expected, args.join(" "));
});

test("one open request at a time on the owner's config row; withdrawn and expired ones stay as inert history", async () => {
  const repos = await fixtureRepositories();
  const first = await requestRoutineDue(repos, [`--contract=${NEWBURY_ENERGY}`, "--expires-in-minutes=30"], NOW);
  assert.match(first.id, /^routine-due:[0-9a-f-]{36}$/);
  assert.deepEqual({ ...first, id: "x" }, {
    id: "x", contractId: NEWBURY_ENERGY, requestedAt: NOW, dueAt: NOW, expiresAt: iso(NOW_MS + 30 * MIN),
    reason: "controlled refresh verification (owner instruction 2026-09-25)", withdrawnAt: null,
  });
  await assert.rejects(requestRoutineDue(repos, [`--contract=${NEWBURY_ENERGY}`], iso(NOW_MS + 29 * MIN)), /ALREADY_OPEN/);
  const second = await requestRoutineDue(repos, [`--contract=${NEWBURY_ENERGY}`], iso(NOW_MS + 30 * MIN));
  const withdrawn = await withdrawRoutineDue(repos, [`--withdraw=${second.id}`], iso(NOW_MS + 31 * MIN));
  assert.equal(withdrawn.withdrawnAt, iso(NOW_MS + 31 * MIN));
  assert.deepEqual(await withdrawRoutineDue(repos, [`--withdraw=${second.id}`], iso(NOW_MS + 40 * MIN)), withdrawn);
  await assert.rejects(withdrawRoutineDue(repos, ["--withdraw=routine-due:00000000-0000-4000-8000-000000000000"], NOW), /UNKNOWN/);
  const stored = (await repos.adminConfig.mustRead("current")).value;
  assert.deepEqual(stored.routineDueRequests?.map(({ id }) => id), [first.id, second.id]);
  assert.equal(stored.apiFallback.enabled, false, "nothing else on the row moves");
  let at = NOW_MS + 2 * HOUR;
  for (let index = 0; index < ROUTINE_DUE_REQUEST_HISTORY + 3; index += 1, at += 2 * HOUR) {
    await requestRoutineDue(repos, [`--contract=${NEWBURY_ENERGY}`, "--expires-in-minutes=5"], iso(at));
  }
  assert.equal((await repos.adminConfig.mustRead("current")).value.routineDueRequests?.length, ROUTINE_DUE_REQUEST_HISTORY);
});

test("a stored request is durable input: malformed rows are named and ignored, never trusted", () => {
  const good: RoutineDueRequest = {
    id: "routine-due:00000000-0000-4000-8000-000000000001", contractId: NEWBURY_ENERGY, requestedAt: NOW,
    dueAt: NOW, expiresAt: iso(NOW_MS + HOUR), reason: "check", withdrawnAt: null,
  };
  const parsed = parseRoutineDueRequests([
    good,
    { ...good, id: "x" },
    { ...good, dueAt: iso(NOW_MS - 1) },
    { ...good, expiresAt: iso(NOW_MS + 3 * HOUR) },
    { ...good, requestedAt: "2026-09-26 16:00:00" },
    { ...good, reason: "" },
    "not a row",
  ]);
  assert.deepEqual(parsed.requests, [good]);
  assert.equal(parsed.issues.length, 6);
  assert.deepEqual(parseRoutineDueRequests(undefined), { requests: [], issues: [] });
  assert.deepEqual(parseRoutineDueRequests({}).issues, ["routineDueRequests is not a list"]);
});

test("controlled clock: a request brings a cold partition's read forward; the partition's own next read spends it and the normal rule owns the next due", () => {
  const partition = task(NEWBURY_ENERGY);
  const lastRead = NOW_MS - HOUR;
  const clock = coldClock(lastRead);
  const request: RoutineDueRequest = {
    id: "routine-due:00000000-0000-4000-8000-000000000002", contractId: partition.id, requestedAt: NOW,
    dueAt: iso(NOW_MS + 10 * MIN), expiresAt: iso(NOW_MS + 90 * MIN), reason: "check", withdrawnAt: null,
  };
  assert.equal(routineTaskDeadlineMs(partition, clock, false), lastRead + 12 * HOUR);
  assert.equal(routineTaskDue(partition, clock, NOW_MS + 10 * MIN, false), false);
  assert.equal(routineDueRequestState(request, clock, NOW_MS), "WAITING");
  assert.equal(routineDueRequestFor(partition, clock, NOW_MS + 10 * MIN - 1, [request]), null);
  assert.equal(routineDueRequestFor(partition, clock, NOW_MS + 10 * MIN, [request]), request);
  assert.equal(routineDueRequestDeadlineMs(routineTaskDeadlineMs(partition, clock, false), request), NOW_MS + 10 * MIN);
  for (const other of ROUTINE_SOURCE_TASKS.filter(({ id }) => id !== partition.id).slice(0, 40)) {
    assert.equal(routineDueRequestFor(other, clock, NOW_MS + 10 * MIN, [request]), null);
  }
  const readAt = NOW_MS + 11 * MIN;
  const after = coldClock(readAt);
  assert.equal(routineDueRequestState(request, after, readAt + MIN), "SPENT");
  assert.equal(routineDueRequestFor(partition, after, readAt + MIN, [request]), null);
  assert.equal(routineTaskDue(partition, after, readAt + MIN, false), false);
  assert.equal(routineTaskDeadlineMs(partition, after, false), readAt + 12 * HOUR, "the next read is owed twelve hours later, by the normal rule");
  const failed: RoutineTaskClock = { ...clock, lastAttemptedAt: iso(readAt) };
  assert.equal(routineDueRequestState(request, failed, readAt + MIN), "SPENT");
  assert.equal(routineTaskDeadlineMs(partition, failed, false), readAt + HOUR);
  assert.equal(routineDueRequestState(request, clock, NOW_MS + 90 * MIN), "EXPIRED");
  assert.equal(routineDueRequestFor(partition, clock, NOW_MS + 90 * MIN, [request]), null);
  const withdrawn = { ...request, withdrawnAt: iso(NOW_MS + 5 * MIN) };
  assert.equal(routineDueRequestFor(partition, clock, NOW_MS + 10 * MIN, [withdrawn]), null);
});

test("a request only brings a read forward: on its lane it goes by deadline, never ahead of a read owed sooner", () => {
  const lanes = new Map<string, RoutineSourceTask[]>();
  for (const row of ROUTINE_SOURCE_TASKS.filter((candidate) => candidate.recordClass === "MEETING" && candidate.contract.schedule?.kind === "SITTING_WINDOW")) {
    lanes.set(row.acquisitionFailureDomain, [...(lanes.get(row.acquisitionFailureDomain) ?? []), row]);
  }
  const lane = [...lanes.values()].sort((left, right) => right.length - left.length)[0]!;
  const [requested, overdue, soon, later, latest] = lane as [RoutineSourceTask, RoutineSourceTask, RoutineSourceTask, RoutineSourceTask, RoutineSourceTask];
  const request: RoutineDueRequest = {
    id: "routine-due:00000000-0000-4000-8000-000000000003", contractId: requested.id, requestedAt: NOW,
    dueAt: NOW, expiresAt: iso(NOW_MS + HOUR), reason: "check", withdrawnAt: null,
  };
  const deadline = routineDueRequestDeadlineMs(routineTaskDeadlineMs(requested, coldClock(NOW_MS - HOUR), false), request);
  assert.equal(deadline, NOW_MS);
  const admitted = routineFailureDomainFrontier([
    { task: requested, lastConsideredAt: iso(NOW_MS - HOUR), deadlineMs: deadline },
    { task: overdue, lastConsideredAt: iso(NOW_MS - 2 * HOUR), deadlineMs: NOW_MS - 5 * MIN },
    { task: soon, lastConsideredAt: iso(NOW_MS - 50 * MIN), deadlineMs: NOW_MS + 5 * MIN },
    { task: later, lastConsideredAt: iso(NOW_MS - 40 * MIN), deadlineMs: NOW_MS + 20 * MIN },
    { task: latest, lastConsideredAt: iso(NOW_MS - 30 * MIN), deadlineMs: NOW_MS + 25 * MIN },
  ]);
  assert.equal(admitted.length, 5, "every due meeting body stays admitted even when it shares a publisher");
  assert.deepEqual(routinePassLaunchOrder(admitted, NOW_MS).map(({ task: row }) => row.id),
    [overdue.id, requested.id, soon.id, later.id, latest.id], "an owner request never displaces an earlier deadline");
  assert.equal(routineDueRequestDeadlineMs(NOW_MS - HOUR, request), NOW_MS - HOUR);
  assert.equal(routineDueRequestDeadlineMs(NOW_MS + HOUR, null), NOW_MS + HOUR);
});

test("the runner honours a request only in its ordinary pass: the same due check, frontier, launch order and outcome", () => {
  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  assert.match(runner, /if \(!FORCE\) \{\s+try \{\s+const read = await readRoutineDueRequests\(\);/);
  assert.match(runner, /RCD_DUE_REQUEST CANNOT_TELL — \$\{[^}]+\}; every task keeps its normal schedule/);
  assert.match(runner, /const dueRequest = FORCE \? null : routineDueRequestFor\(task, durableClock, admissionNowMs, dueRequests\);/);
  assert.match(runner, /!routineTaskDue\(task, durableClock, admissionNowMs, sittingHot, observedEveryMs\) && dueRequest === null/);
  assert.match(runner, /deadlineMs: routineDueRequestDeadlineMs\(\s+routineTaskDeadlineMs\(pending\.task, clock, sittingSignals\.get\(pending\.task\.id\)\),/);
  assert.match(runner, /for \(const \{ task \} of placeSourceLaunchOrder\(routinePassLaunchOrder\(admitted, admissionNowMs\)\)\) pendingRuns\.push/);
  assert.match(runner, /\.\.\.input\.dueRequestLines,/);
  assert.match(runner, /admitted by this ordinary pass/);
  const source = readFileSync("lib/civic-data/routine-due-request.ts", "utf8");
  assert.doesNotMatch(source, /PostgresRoutineDataStore|civic_data_candidate|confirmUnchanged|\.promote\(|\.create\(/);
});
